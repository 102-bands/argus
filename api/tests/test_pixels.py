"""Prefetching S3 reader: same pixels as reading the whole file, offline (synthetic SPHEREx-like FITS)."""
import io
import threading

import numpy as np
import pytest
from astropy.io import fits

from argus.pixels import HDUS, PrefetchFile, S3Source, _header_at, _heap_span, _extract
from argus.sia import Exposure

N = 200
RA, DEC = 150.0, 2.0


def _fits_bytes() -> bytes:
    rng = np.random.default_rng(1)
    h = fits.Header()
    h.update(CTYPE1="RA---TAN", CTYPE2="DEC--TAN", CRVAL1=RA, CRVAL2=DEC, CRPIX1=80.5, CRPIX2=120.5,
             CDELT1=-6.15 / 3600, CDELT2=6.15 / 3600)
    img = rng.normal(size=(N, N)).astype(np.float32)
    # Mostly harmless bits (0, 1 and SOURCE=21), a few hard-masked (6), so most pixels survive the mask.
    flags = (rng.integers(0, 4, size=(N, N)) | ((rng.random((N, N)) < 0.3) << 21)
             | ((rng.random((N, N)) < 0.02) << 6)).astype(np.int32)
    hdus = [fits.PrimaryHDU(), fits.ImageHDU(img, h, name="IMAGE"),
            fits.CompImageHDU(flags, name="FLAGS", compression_type="RICE_1", tile_shape=(1, N)),
            fits.ImageHDU(np.abs(img) + 1, h, name="VARIANCE"), fits.ImageHDU(img * 0.1, h, name="ZODI"),
            fits.ImageHDU(np.zeros((4, 8), np.uint8), name="EPSF")]
    buf = io.BytesIO()
    fits.HDUList(hdus).writeto(buf)
    return buf.getvalue()


RAW = _fits_bytes()
EXP = Exposure(obs_id="x", collection="c", detector="D1", t_min=0.0, t_max=1.0, em_min_um=1.0, em_max_um=2.0,
               access_url="https://irsa.ipac.caltech.edu/x", s3_url="s3://nasa-irsa-spherex/x", release_date="r")


def _reference(half: int):
    with fits.open(io.BytesIO(RAW)) as hdul:
        return _extract(hdul, EXP, RA, DEC, half)


def _same(a, b):
    for k in ("image", "flags", "variance", "zodi"):
        np.testing.assert_array_equal(getattr(a, k), getattr(b, k))
    assert a.lam_um == b.lam_um


def test_prefetch_file_fetches_misses():
    calls = []
    pf = PrefetchFile(len(RAW), {0: RAW[:5000]}, lambda a, b: calls.append((a, b)) or RAW[a:b])
    assert pf.read(100) == RAW[:100] and not calls
    pf.seek(len(RAW) - 50)
    assert pf.read() == RAW[-50:] and pf.misses == 1
    with fits.open(PrefetchFile(len(RAW), {}, lambda a, b: RAW[a:b]), lazy_load_hdus=True, memmap=False) as hdul:
        _same(_extract(hdul, EXP, RA, DEC, 20), _reference(20))


def test_heap_span_covers_requested_flag_rows():
    prim, plen = _header_at(RAW, 0)
    img, ilen = _header_at(RAW, plen)
    fl_off = plen + ilen + -(-N * N * 4 // 2880) * 2880
    fh, flen = _header_at(RAW, fl_off)
    assert fh["ZIMAGE"]
    a, b = _heap_span(fh, RAW[fl_off + flen:], fl_off + flen, 50, 90)
    assert fl_off + flen < a < b <= len(RAW)
    # Every tile for rows 50..89 (one row per tile) lies inside [a, b); COMPRESSED_DATA is column 1.
    table_end = fl_off + flen + fh["NAXIS1"] * fh["NAXIS2"]
    rows = np.frombuffer(RAW[fl_off + flen:table_end], np.uint8).reshape(fh["NAXIS2"], fh["NAXIS1"])
    heap0 = fl_off + flen + fh.get("THEAP", fh["NAXIS1"] * fh["NAXIS2"])
    for t in range(50, 90):
        cnt, off = np.frombuffer(rows[t, :8].tobytes(), ">i4")
        assert a <= heap0 + off and heap0 + off + cnt <= b


class _MemS3(S3Source):
    """S3Source whose range requests are served from memory (no network)."""

    def __init__(self, raw: bytes):
        super().__init__(threading.BoundedSemaphore(4))
        self.raw = raw

    async def _get_many(self, path, ranges):
        out = []
        for r in ranges:
            spec = r.removeprefix("bytes=")
            if spec.startswith("-"):
                a, b = len(self.raw) - int(spec[1:]), len(self.raw)
            else:
                lo, hi = spec.split("-")
                a, b = int(lo), int(hi) + 1
            out.append((self.raw[a:b], f"bytes {a}-{b - 1}/{len(self.raw)}"))
        self.requests += len(ranges)
        return out


@pytest.mark.parametrize("half", [5, 20, 60])
def test_s3_prefetch_matches_full_read(half):
    src = _MemS3(RAW)
    got = src._fetch(EXP, RA, DEC, half)
    _same(got, _reference(half))
    assert set(HDUS) == {"IMAGE", "FLAGS", "VARIANCE", "ZODI"}


def test_sia_retries_on_502(tmp_path, monkeypatch):
    import asyncio as aio

    import httpx

    from argus import sia
    from argus.cache import DiskCache

    monkeypatch.setattr(sia, "SIA_BACKOFF_S", (0, 0, 0))
    calls = []

    def handler(req):
        calls.append(1)
        return httpx.Response(502 if len(calls) < 3 else 404)

    async def go():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as c:
            svc = sia.CoverageService(DiskCache(tmp_path, 1 << 20), c)
            with pytest.raises(httpx.HTTPStatusError) as e:
                await svc.query(1.0, 2.0, ["c"])
            return e.value.response.status_code

    assert aio.run(go()) == 404 and len(calls) == 3
