"""Epochs → calibrate → reproject → stack → encode (PRD §6.2, §7.4)."""
import hashlib
import json
import struct
from dataclasses import dataclass, field

import brotli
import numpy as np
from astropy.wcs import WCS
from reproject import reproject_interp

from .physics import PIXEL_ARCSEC, SATURATION_BITS, aperture_photometry, bits_to_mask, display_bad, fov_pixels
from .pixels import Cutout

SAT_MASK = bits_to_mask(SATURATION_BITS)

# Per-pixel flag layer sent with each frame (uint8): bit 0 = masked in every exposure, bit 1 = saturation seen.
LAYER_ALL_MASKED = 1
LAYER_SATURATED = 2


def make_grid(ra: float, dec: float, size_arcmin: float) -> tuple[WCS, int]:
    """Common TAN grid centred on (ra, dec), 6.15″ pixels, north up, east left."""
    n = fov_pixels(size_arcmin)
    w = WCS(naxis=2)
    w.wcs.ctype = ["RA---TAN", "DEC--TAN"]
    w.wcs.crval = [ra, dec]
    w.wcs.crpix = [(n + 1) / 2.0, (n + 1) / 2.0]
    w.wcs.cdelt = [-PIXEL_ARCSEC / 3600.0, PIXEL_ARCSEC / 3600.0]
    return w, n


def grid_header(w: WCS, n: int) -> dict:
    return {"ctype": list(w.wcs.ctype), "crval": [float(v) for v in w.wcs.crval],
            "crpix": [float(v) for v in w.wcs.crpix], "cdelt": [float(v) for v in w.wcs.cdelt], "n": n}


def cutout_half_px(n: int) -> int:
    # Enough margin for any detector rotation (√2) plus interpolation edge.
    return int(np.ceil(n * 0.75)) + 3


@dataclass
class Aligned:
    image: np.ndarray  # zodi-subtracted, NaN where masked
    weight: np.ndarray
    variance: np.ndarray
    flags: np.ndarray  # int64, nearest-neighbour
    lam_um: float
    flux_ujy: float
    err_ujy: float
    saturated: bool


def calibrate_and_align(cut: Cutout, grid: WCS, n: int) -> Aligned | None:
    """I' = IMAGE − ZODI, mask display bits, w = 1/VARIANCE, then reproject onto the grid (PRD §6.2)."""
    img = cut.image - cut.zodi
    bad = display_bad(cut.flags) | ~np.isfinite(img) | ~(cut.variance > 0)
    img = np.where(bad, np.nan, img)
    var = np.where(bad, np.nan, cut.variance)
    shape = (n, n)
    a_img, foot = reproject_interp((img, cut.wcs), grid, shape_out=shape, order="bilinear")
    if not np.any(foot > 0):
        return None
    a_var, _ = reproject_interp((var, cut.wcs), grid, shape_out=shape, order="bilinear")
    a_flags, _ = reproject_interp((cut.flags.astype(np.float64), cut.wcs), grid, shape_out=shape,
                                  order="nearest-neighbor")
    a_flags = np.nan_to_num(a_flags, nan=0).astype(np.int64)
    with np.errstate(divide="ignore", invalid="ignore"):
        w = np.where(np.isfinite(a_img) & (a_var > 0), 1.0 / a_var, 0.0)

    flux, err, sat = _photometry(a_img, a_var, a_flags, n)
    return Aligned(a_img.astype(np.float32), w, a_var.astype(np.float32), a_flags, cut.lam_um, flux, err, sat)


def _photometry(img, var, flags, n):
    """Recentre on the brightest blob within 3 px of the centre, then aperture photometry (PRD §7.8)."""
    c = (n - 1) / 2.0
    r = 3
    y0, x0 = int(c) - r, int(c) - r
    box = img[max(y0, 0):y0 + 2 * r + 1, max(x0, 0):x0 + 2 * r + 1]
    x, y = c, c
    if box.size and np.isfinite(box).any():
        b = np.nan_to_num(box - np.nanmedian(box), nan=0).clip(min=0)
        if b.sum() > 0:
            yy, xx = np.indices(b.shape)
            x = x0 + float((xx * b).sum() / b.sum())
            y = y0 + float((yy * b).sum() / b.sum())
    flux, err = aperture_photometry(img, var, x, y)
    yy, xx = np.indices(img.shape)
    ap = np.hypot(xx - x, yy - y) <= 2.0
    sat = bool(np.any(flags[ap] & SAT_MASK))
    return flux, err, sat


@dataclass
class StackAccumulator:
    """Running sums so memory stays at a few grids, not N exposures (PRD §10.1)."""
    n: int
    swi: np.ndarray = None
    sw: np.ndarray = None
    sat_any: np.ndarray = None
    count: int = 0
    lams: list = field(default_factory=list)
    times: list = field(default_factory=list)
    n_saturated: int = 0

    def __post_init__(self):
        self.swi = np.zeros((self.n, self.n))
        self.sw = np.zeros((self.n, self.n))
        self.sat_any = np.zeros((self.n, self.n), dtype=bool)

    def add(self, a: Aligned, t_mid: float) -> None:
        self.swi += a.weight * np.nan_to_num(a.image, nan=0.0)
        self.sw += a.weight
        self.sat_any |= (a.flags & SAT_MASK) != 0
        self.count += 1
        self.lams.append(a.lam_um)
        self.times.append(t_mid)
        self.n_saturated += int(a.saturated)

    def result(self) -> tuple[np.ndarray, np.ndarray]:
        with np.errstate(invalid="ignore", divide="ignore"):
            mean = np.where(self.sw > 0, self.swi / self.sw, np.nan)
        layer = np.zeros((self.n, self.n), dtype=np.uint8)
        layer[self.sw <= 0] |= LAYER_ALL_MASKED
        layer[self.sat_any] |= LAYER_SATURATED
        return mean.astype(np.float32), layer


def encode_frame(pixels: np.ndarray, layer: np.ndarray, header: dict) -> bytes:
    """[u32 LE header length][JSON header][pad to 2][float16 pixels, row 0 = south][uint8 flag layer] (PRD §6.2 step 7).

    Returns the raw (uncompressed) payload; compress with brotli for the API.
    """
    finite = pixels[np.isfinite(pixels)]
    lo, hi = (float(np.percentile(finite, 0.5)), float(np.percentile(finite, 99.5))) if finite.size else (0.0, 1.0)
    h, w = pixels.shape
    head = json.dumps({**header, "w": w, "h": h, "lo": lo, "hi": hi,
                       "layers": ["f16", "u8flags"]}, separators=(",", ":")).encode()
    pad = b" " * ((4 + len(head)) % 2)
    return b"".join([struct.pack("<I", len(head) + len(pad)), head, pad,
                     pixels.astype("<f2").tobytes(), layer.astype(np.uint8).tobytes()])


def compress(raw: bytes) -> bytes:
    return brotli.compress(raw, quality=9)


def content_key(*parts) -> str:
    """sha256 over pipeline version, collections, position, size, product, detector, epoch, release (PRD §10.3)."""
    return hashlib.sha256("|".join(str(p) for p in parts).encode()).hexdigest()
