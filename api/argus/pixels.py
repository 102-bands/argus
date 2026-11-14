"""PixelSource: S3 partial reads (default) or IRSA cutouts (PRD §5.4).

Both return the same Cutout. Calls are blocking and run in worker threads; a global
semaphore keeps at most MAX_CONCURRENT_FETCH downloads in flight across the server.
"""
import asyncio
import io
import json
import logging
import random
import re
import threading
import time
import warnings
from dataclasses import dataclass
from typing import Protocol

import brotli
import fsspec.asyn
import httpx
import numpy as np
from astropy.io import fits
from astropy.wcs import WCS, FITSFixedWarning

from .physics import PIXEL_ARCSEC, decode_flag_names
from .security import check_outbound
from .sia import Exposure

log = logging.getLogger("argus.pixels")

S3_BLOCK = 256 * 1024  # see docs/memory/gotchas.md: the 5 MB default reads most of the file
HDUS = ("IMAGE", "FLAGS", "VARIANCE", "ZODI")
MAX_RESPONSE_BYTES = 32 * 1024 * 1024


@dataclass
class Cutout:
    image: np.ndarray
    flags: np.ndarray
    variance: np.ndarray
    zodi: np.ndarray
    wcs: WCS
    lam_um: float
    flag_names: dict[int, str]
    # Set by S3 reads so a cached cutout can be cropped for a smaller field (see crop_cutout).
    header: str | None = None  # full IMAGE header
    box: tuple[int, int, int, int] | None = None  # x0, y0, x1, y1 in detector pixels


class PixelSource(Protocol):
    name: str

    def fetch(self, exp: Exposure, ra: float, dec: float, half_px: int) -> Cutout | None: ...


def _quiet():
    ctx = warnings.catch_warnings()
    ctx.__enter__()
    warnings.simplefilter("ignore")
    logging.getLogger("astropy").setLevel(logging.WARNING)
    return ctx


def _wavelength(header, hdul, x: float, y: float, fallback: float) -> float:
    try:
        w = WCS(header, fobj=hdul, key="W")
        w.sip = None
        lam, _ = w.pixel_to_world_values(x, y)
        lam = float(lam)
        return lam if np.isfinite(lam) else fallback
    except Exception:  # noqa: BLE001 - a missing λ only weakens the label
        return fallback


class PrefetchFile(io.RawIOBase):
    """Read-only file over byte ranges fetched in advance; anything else is fetched on demand.

    astropy still does all the FITS parsing, so a wrong guess about where data lives costs one
    extra request (`misses`), never a wrong pixel.
    """

    MISS_BLOCK = 64 * 1024

    def __init__(self, size: int, chunks: dict[int, bytes], fetch, name: str = "prefetch"):
        super().__init__()
        self.size = size
        self.chunks = sorted(chunks.items())
        self.fetch = fetch  # (start, end) -> bytes
        self.pos = 0
        self.misses = 0
        self.mode = "rb"
        self.name = name

    def readable(self) -> bool:
        return True

    def seekable(self) -> bool:
        return True

    def tell(self) -> int:
        return self.pos

    def seek(self, offset: int, whence: int = 0) -> int:
        self.pos = {0: offset, 1: self.pos + offset, 2: self.size + offset}[whence]
        return self.pos

    def _find(self, a: int, b: int) -> bytes | None:
        for s, d in self.chunks:
            if s <= a and b <= s + len(d):
                return d[a - s:b - s]
        return None

    def read(self, n: int = -1) -> bytes:
        end = self.size if n is None or n < 0 else min(self.pos + n, self.size)
        if end <= self.pos:
            return b""
        d = self._find(self.pos, end)
        if d is None:
            hi = min(max(end, self.pos + self.MISS_BLOCK), self.size)
            self.chunks.append((self.pos, self.fetch(self.pos, hi)))
            self.chunks.sort(key=lambda c: c[0])
            self.misses += 1
            d = self._find(self.pos, end)
        self.pos = end
        return d

    def readinto(self, b) -> int:
        d = self.read(len(b))
        b[:len(d)] = d
        return len(d)


BLOCK = 2880
HEAD_BYTES = 64 * 1024
TAIL_BYTES = 64 * 1024
# SPHEREx L2 files end with ... VARIANCE, ZODI, EPSF, WCS-WAVE. Header and data sizes after FLAGS,
# measured on DR1 and QR3 files (docs/memory/gotchas.md). Only used to guess where to prefetch.
TAIL_LAYOUT = {"zodi_hdr": 11520, "var_hdr": 11520, "epsf_hdr": 5760, "epsf_data": 3862080, "wave": 5760}
_TFORM = re.compile(r"\s*(\d*)([LXBIJKAEDCMPQ])")
_TFORM_BYTES = {"L": 1, "X": 1, "B": 1, "I": 2, "J": 4, "K": 8, "E": 4, "D": 8, "C": 8, "M": 16, "A": 1, "P": 8, "Q": 16}


def _padded(n: int) -> int:
    return -(-n // BLOCK) * BLOCK


def _header_at(buf: bytes, off: int) -> tuple[fits.Header, int] | None:
    """Parse the FITS header starting at buf[off]; returns it and its length, or None if incomplete."""
    i = off
    while i + BLOCK <= len(buf):
        block = buf[i:i + BLOCK]
        for c in range(0, BLOCK, 80):
            if block[c:c + 8] == b"END     ":
                end = i + BLOCK
                return fits.Header.fromstring(buf[off:end].decode("ascii", "replace")), end - off
        i += BLOCK
    return None


def _image_bytes(h: fits.Header) -> int:
    return abs(h.get("BITPIX", 8)) // 8 * h.get("NAXIS1", 0) * h.get("NAXIS2", 0) if h.get("NAXIS", 0) else 0


def _row_span(data_off: int, nx: int, bpp: int, x0: int, x1: int, y0: int, y1: int) -> tuple[int, int]:
    return data_off + (y0 * nx + x0) * bpp, data_off + ((y1 - 1) * nx + x1) * bpp


def _heap_span(h: fits.Header, table: bytes, data_off: int, y0: int, y1: int) -> tuple[int, int] | None:
    """Byte range of the compressed FLAGS tiles covering rows y0..y1 (tile-compressed BINTABLE)."""
    row, col_off, kind = h["NAXIS1"], 0, None
    for i in range(1, h["TFIELDS"] + 1):
        m = _TFORM.match(h[f"TFORM{i}"])  # e.g. "1J", "8A", "1PB(5678)"
        if not m:
            return None
        rep, code = int(m[1] or 1), m[2]
        if h[f"TTYPE{i}"].strip() == "COMPRESSED_DATA":
            kind = code
            break
        col_off += rep * _TFORM_BYTES[code]
    if kind not in ("P", "Q"):
        return None
    tile_h = h.get("ZTILE2", 1)
    t0, t1 = y0 // tile_h, (y1 - 1) // tile_h
    if (t1 + 1) * row > len(table):
        return None
    lo, hi = None, 0
    for t in range(t0, t1 + 1):
        a = t * row + col_off
        cnt, off = (np.frombuffer(table[a:a + 8], ">i4") if kind == "P" else np.frombuffer(table[a:a + 16], ">i8"))
        lo = off if lo is None else min(lo, off)
        hi = max(hi, off + cnt)
    heap = data_off + h.get("THEAP", h["NAXIS1"] * h["NAXIS2"])
    return heap + int(lo), heap + int(hi)


class S3Source:
    name = "s3"

    def __init__(self, sem: threading.BoundedSemaphore, retries: int = 3, prefetch: bool = True):
        import s3fs

        # The aiobotocore default pool (10 connections) would cap the parallel range reads.
        self.fs = s3fs.S3FileSystem(anon=True, config_kwargs={"max_pool_connections": 128})
        self.sem = sem
        self.retries = retries
        self.prefetch = prefetch
        self.requests = 0  # total S3 requests, for scripts/bench_fetch.py

    def fetch(self, exp: Exposure, ra: float, dec: float, half_px: int) -> Cutout | None:
        check_outbound(exp.s3_url)
        for attempt in range(self.retries):
            try:
                with self.sem:
                    return self._fetch(exp, ra, dec, half_px)
            except (OSError, TimeoutError) as e:
                if attempt == self.retries - 1:
                    raise
                log.warning("s3 retry %s %s: %s", attempt + 1, exp.obs_id, e)
                time.sleep(2**attempt + random.random())
        return None

    # --- range requests, run concurrently on s3fs's event loop -------------------------------------
    async def _get_many(self, path: str, ranges: list[str]) -> list[tuple[bytes, str]]:
        bucket, key, _ = self.fs.split_path(path)

        async def one(rng: str) -> tuple[bytes, str]:
            resp = await self.fs._call_s3("get_object", Bucket=bucket, Key=key, Range=rng)
            try:
                return await resp["Body"].read(), resp.get("ContentRange", "")
            finally:
                resp["Body"].close()

        self.requests += len(ranges)
        return await asyncio.gather(*(one(r) for r in ranges))

    def _get(self, path: str, spans: list[tuple[int, int]]) -> list[bytes]:
        if not spans:
            return []
        out = fsspec.asyn.sync(self.fs.loop, self._get_many, path, [f"bytes={a}-{b - 1}" for a, b in spans])
        return [d for d, _ in out]

    def _plan(self, path: str, ra: float, dec: float, half_px: int) -> PrefetchFile | None:
        """Fetch what one cutout needs in three parallel rounds (12-15+ sequential reads before).

        1. file head (PRIMARY + IMAGE header) and tail (WCS-WAVE, for λ);
        2. the cutout rows of IMAGE, VARIANCE, ZODI, their headers, the FLAGS header and tile table;
        3. the compressed FLAGS tiles for those rows.
        """
        (head, _), (tail, crange) = fsspec.asyn.sync(
            self.fs.loop, self._get_many, path, [f"bytes=0-{HEAD_BYTES - 1}", f"bytes=-{TAIL_BYTES}"])
        size = int(crange.rsplit("/", 1)[1])
        chunks = {0: head, size - len(tail): tail}
        pf = PrefetchFile(size, chunks, lambda a, b: self._get(path, [(a, b)])[0], name=path)
        prim = _header_at(head, 0)
        img = prim and _header_at(head, prim[1] + _padded(_image_bytes(prim[0])))
        if not img:
            return pf  # unusual layout: astropy reads on demand
        h, hlen = img
        img_hdr = prim[1] + _padded(_image_bytes(prim[0]))
        img_data = img_hdr + hlen
        nx, ny, bpp = h["NAXIS1"], h["NAXIS2"], abs(h["BITPIX"]) // 8
        x, y = (float(v) for v in WCS(h).world_to_pixel_values(ra, dec))
        xc, yc = int(round(x)), int(round(y))
        x0, x1 = max(xc - half_px, 0), min(xc + half_px + 1, nx)
        y0, y1 = max(yc - half_px, 0), min(yc + half_px + 1, ny)
        if x1 - x0 < 3 or y1 - y0 < 3:
            return None
        img_size = _padded(nx * ny * bpp)
        flags_hdr = img_data + img_size
        L = TAIL_LAYOUT
        epsf_hdr = size - L["wave"] - L["epsf_data"] - L["epsf_hdr"]
        zodi_data = epsf_hdr - img_size
        var_data = zodi_data - L["zodi_hdr"] - img_size
        spans = [
            _row_span(img_data, nx, bpp, x0, x1, y0, y1),
            (flags_hdr, min(flags_hdr + HEAD_BYTES, size)),
            (var_data - L["var_hdr"], var_data), _row_span(var_data, nx, bpp, x0, x1, y0, y1),
            (zodi_data - L["zodi_hdr"], zodi_data), _row_span(zodi_data, nx, bpp, x0, x1, y0, y1),
            (epsf_hdr, epsf_hdr + L["epsf_hdr"]),
        ]
        spans = [(a, b) for a, b in spans if 0 <= a < b <= size]
        for (a, _), d in zip(spans, self._get(path, spans)):
            pf.chunks.append((a, d))
        pf.chunks.sort(key=lambda c: c[0])
        fl = pf._find(flags_hdr, min(flags_hdr + HEAD_BYTES, size))
        parsed = fl and _header_at(fl, 0)
        if parsed and parsed[0].get("ZIMAGE"):
            heap = _heap_span(parsed[0], fl[parsed[1]:], flags_hdr + parsed[1], y0, y1)
            if heap:
                pf.chunks.append((heap[0], self._get(path, [heap])[0]))
                pf.chunks.sort(key=lambda c: c[0])
        return pf

    def _fetch(self, exp, ra, dec, half_px):
        path = exp.s3_url.removeprefix("s3://")
        ctx = _quiet()
        try:
            if self.prefetch:
                pf = self._plan(path, ra, dec, half_px)
                if pf is None:
                    return None
                with fits.open(pf, lazy_load_hdus=True, memmap=False) as hdul:
                    out = _extract(hdul, exp, ra, dec, half_px)
                self.requests += pf.misses
                if pf.misses:
                    log.debug("prefetch missed %d ranges for %s", pf.misses, exp.obs_id)
                return out
            with self.fs.open(path, "rb", block_size=S3_BLOCK, cache_type="readahead") as f, \
                    fits.open(f, lazy_load_hdus=True, memmap=False) as hdul:
                return _extract(hdul, exp, ra, dec, half_px)
        finally:
            ctx.__exit__(None, None, None)


def _extract(hdul, exp: Exposure, ra: float, dec: float, half_px: int) -> Cutout | None:
    hdr = hdul["IMAGE"].header
    wcs = WCS(hdr)
    x, y = (float(v) for v in wcs.world_to_pixel_values(ra, dec))
    ny, nx = hdr["NAXIS2"], hdr["NAXIS1"]
    xc, yc = int(round(x)), int(round(y))
    x0, x1 = max(xc - half_px, 0), min(xc + half_px + 1, nx)
    y0, y1 = max(yc - half_px, 0), min(yc + half_px + 1, ny)
    if x1 - x0 < 3 or y1 - y0 < 3:
        return None
    arrs = {n: np.asarray(hdul[n].section[y0:y1, x0:x1]) for n in HDUS}
    names = decode_flag_names(hdul["FLAGS"].header)
    lam = _wavelength(hdr, hdul, x, y, 0.5 * (exp.em_min_um + exp.em_max_um))
    return Cutout(arrs["IMAGE"].astype(np.float32), arrs["FLAGS"].astype(np.int64),
                  arrs["VARIANCE"].astype(np.float32), arrs["ZODI"].astype(np.float32),
                  wcs[y0:y1, x0:x1], lam, names, hdr.tostring(), (x0, y0, x1, y1))


# --- cutout cache: reuse an exposure's pixels when only the field size changes ----------------------
_ARRAYS = ("image", "flags", "variance", "zodi")


def encode_cutout(c: Cutout) -> bytes:
    buf = io.BytesIO()
    meta = {"header": c.header, "box": c.box, "lam_um": c.lam_um, "flag_names": c.flag_names}
    np.savez(buf, **{k: getattr(c, k) for k in _ARRAYS}, meta=np.frombuffer(json.dumps(meta).encode(), np.uint8))
    return brotli.compress(buf.getvalue(), quality=4)


def decode_cutout(data: bytes) -> Cutout:
    z = np.load(io.BytesIO(brotli.decompress(data)))
    meta = json.loads(z["meta"].tobytes())
    hdr = fits.Header.fromstring(meta["header"])
    x0, y0, x1, y1 = meta["box"]
    return Cutout(*(z[k] for k in _ARRAYS), WCS(hdr)[y0:y1, x0:x1], meta["lam_um"],
                  {int(k): v for k, v in meta["flag_names"].items()}, meta["header"], (x0, y0, x1, y1))


def crop_cutout(c: Cutout, ra: float, dec: float, half_px: int) -> Cutout | None:
    """The cutout _extract would return for (ra, dec, half_px), cut from a larger cached one; None if it doesn't fit."""
    if c.header is None or c.box is None:
        return None
    hdr = fits.Header.fromstring(c.header)
    wcs = WCS(hdr)
    x, y = (float(v) for v in wcs.world_to_pixel_values(ra, dec))
    xc, yc = int(round(x)), int(round(y))
    x0, x1 = max(xc - half_px, 0), min(xc + half_px + 1, hdr["NAXIS1"])
    y0, y1 = max(yc - half_px, 0), min(yc + half_px + 1, hdr["NAXIS2"])
    bx0, by0, bx1, by1 = c.box
    if x1 - x0 < 3 or y1 - y0 < 3 or x0 < bx0 or y0 < by0 or x1 > bx1 or y1 > by1:
        return None
    sl = (slice(y0 - by0, y1 - by0), slice(x0 - bx0, x1 - bx0))
    return Cutout(*(getattr(c, k)[sl] for k in _ARRAYS), wcs[y0:y1, x0:x1], c.lam_um, c.flag_names,
                  c.header, (x0, y0, x1, y1))


class CutoutSource:
    """IRSA cutout service with backoff on 503 (≈ 25 % of requests, PRD §5.4 path B)."""

    name = "cutout"
    BACKOFF = (1, 2, 4, 8)

    def __init__(self, sem: threading.BoundedSemaphore):
        self.sem = sem
        self.client = httpx.Client(timeout=httpx.Timeout(30, connect=30), follow_redirects=False)

    def fetch(self, exp: Exposure, ra: float, dec: float, half_px: int) -> Cutout | None:
        size_deg = (2 * half_px + 1) * PIXEL_ARCSEC / 3600.0
        url = check_outbound(f"{exp.access_url}?center={ra:.6f},{dec:.6f}d&size={size_deg:.5f}")
        content = None
        for i, delay in enumerate((*self.BACKOFF, None)):
            with self.sem:
                r = self.client.get(url)
            if r.status_code == 200:
                content = r.content
                break
            if r.status_code == 500:  # no overlap with this exposure
                return None
            if r.status_code not in (502, 503, 504) or delay is None:
                r.raise_for_status()
            time.sleep(delay * (0.5 + random.random()))
        if content is None or len(content) > MAX_RESPONSE_BYTES:
            return None
        ctx = _quiet()
        try:
            with fits.open(io.BytesIO(content)) as hdul:
                hdr = hdul["IMAGE"].header
                wcs = WCS(hdr)
                x, y = (float(v) for v in wcs.world_to_pixel_values(ra, dec))
                arrs = {n: np.asarray(hdul[n].data) for n in HDUS}
                names = decode_flag_names(hdul["FLAGS"].header)
                lam = _wavelength(hdr, hdul, x, y, 0.5 * (exp.em_min_um + exp.em_max_um))
        finally:
            ctx.__exit__(None, None, None)
        return Cutout(arrs["IMAGE"].astype(np.float32), arrs["FLAGS"].astype(np.int64),
                      arrs["VARIANCE"].astype(np.float32), arrs["ZODI"].astype(np.float32), wcs, lam, names)


def make_source(kind: str, max_concurrent: int, prefetch: bool = True) -> PixelSource:
    sem = threading.BoundedSemaphore(max_concurrent)
    warnings.simplefilter("ignore", FITSFixedWarning)
    return S3Source(sem, prefetch=prefetch) if kind == "s3" else CutoutSource(sem)
