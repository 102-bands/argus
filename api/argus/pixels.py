"""PixelSource: S3 partial reads (default) or IRSA cutouts (PRD §5.4).

Both return the same Cutout. Calls are blocking and run in worker threads; a global
semaphore keeps at most MAX_CONCURRENT_FETCH downloads in flight across the server.
"""
import io
import logging
import random
import threading
import time
import warnings
from dataclasses import dataclass
from typing import Protocol

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


class S3Source:
    name = "s3"

    def __init__(self, sem: threading.BoundedSemaphore, retries: int = 3):
        import s3fs

        self.fs = s3fs.S3FileSystem(anon=True)
        self.sem = sem
        self.retries = retries

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

    def _fetch(self, exp, ra, dec, half_px):
        ctx = _quiet()
        try:
            with self.fs.open(exp.s3_url.removeprefix("s3://"), "rb", block_size=S3_BLOCK, cache_type="readahead") as f, \
                    fits.open(f, lazy_load_hdus=True, memmap=False) as hdul:
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
                sub = wcs[y0:y1, x0:x1]
        finally:
            ctx.__exit__(None, None, None)
        return Cutout(arrs["IMAGE"].astype(np.float32), arrs["FLAGS"].astype(np.int64),
                      arrs["VARIANCE"].astype(np.float32), arrs["ZODI"].astype(np.float32), sub, lam, names)


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


def make_source(kind: str, max_concurrent: int) -> PixelSource:
    sem = threading.BoundedSemaphore(max_concurrent)
    warnings.simplefilter("ignore", FITSFixedWarning)
    return S3Source(sem) if kind == "s3" else CutoutSource(sem)
