"""Pure physics functions (PRD §7). No I/O; every function is unit-tested."""
import math
import re
from datetime import datetime, timedelta, timezone

import numpy as np

PIXEL_ARCSEC = 6.15
# Solid angle of one pixel in sr, and the MJy/sr -> µJy factor for one pixel (PRD §7.8).
PIXEL_SR = (PIXEL_ARCSEC / 206265.0) ** 2
MJYSR_TO_UJY = PIXEL_SR * 1e12  # ≈ 889
MJD_UNIX_EPOCH = 40587.0
JD_MINUS_MJD = 2400000.5

# Mira R Dra ephemeris (research §3).
R_DRA_PERIOD_D = 246.12
R_DRA_EPOCH_JD = 2457370.0

_SEXA = re.compile(
    r"^\s*([+-]?)(\d{1,3})(?:[h:d°\s]+)(\d{1,2})(?:[m:'′\s]+)(\d{1,2}(?:\.\d*)?)\s*[s\"″]?\s*$",
    re.IGNORECASE,
)


class CoordError(ValueError):
    pass


def _parse_sexagesimal(text: str) -> tuple[float, float]:
    """Return (sign, absolute value in the unit's degrees/hours) from 'd m s'."""
    m = _SEXA.match(text)
    if not m:
        raise CoordError(f"cannot read {text!r}")
    sign = -1.0 if m.group(1) == "-" else 1.0
    a, b, c = float(m.group(2)), float(m.group(3)), float(m.group(4))
    if b >= 60 or c >= 60:
        raise CoordError(f"minutes and seconds must be < 60 in {text!r}")
    return sign, a + b / 60.0 + c / 3600.0


def parse_ra(value: str | float) -> float:
    """RA in decimal degrees from degrees or 'hh mm ss' (PRD §7.1)."""
    if isinstance(value, (int, float)):
        ra = float(value)
    else:
        s = value.strip()
        try:
            ra = float(s)
        except ValueError:
            sign, hours = _parse_sexagesimal(s)
            if sign < 0:
                raise CoordError("RA cannot be negative") from None
            ra = 15.0 * hours
    if not (0.0 <= ra < 360.0) or not math.isfinite(ra):
        raise CoordError("RA must be in [0, 360)")
    return ra


def parse_dec(value: str | float) -> float:
    """Dec in decimal degrees from degrees or '±dd mm ss' (PRD §7.1)."""
    if isinstance(value, (int, float)):
        dec = float(value)
    else:
        s = value.strip()
        try:
            dec = float(s)
        except ValueError:
            sign, deg = _parse_sexagesimal(s)
            dec = sign * deg
    if not (-90.0 <= dec <= 90.0) or not math.isfinite(dec):
        raise CoordError("Dec must be in [-90, 90]")
    return dec


def parse_coords(text: str) -> tuple[float, float]:
    """Parse 'ra dec' as decimal ('133.79 -7.24') or sexagesimal ('08h55m10.8s -07d14m42s')."""
    s = text.strip().replace(",", " ")
    parts = s.split()
    if len(parts) == 2:
        return parse_ra(parts[0]), parse_dec(parts[1])
    if len(parts) == 6:
        return parse_ra(" ".join(parts[:3])), parse_dec(" ".join(parts[3:]))
    raise CoordError("expected 'RA Dec'")


def fov_pixels(size_arcmin: float) -> int:
    """Side of the output grid in pixels for a field of size_arcmin (PRD §7.2); 3' -> 29."""
    return max(int(round(60.0 * size_arcmin / PIXEL_ARCSEC)), 3)


def proper_motion_offset(pmra_cosdec_mas: float, pmdec_mas: float, dt_years: float) -> tuple[float, float, float]:
    """Return (Δα* arcsec, Δδ arcsec, total arcsec) after dt_years (PRD §7.7)."""
    da = pmra_cosdec_mas * dt_years / 1000.0
    dd = pmdec_mas * dt_years / 1000.0
    return da, dd, math.hypot(da, dd)


def propagate(ra: float, dec: float, pmra_cosdec_mas: float, pmdec_mas: float, dt_years: float) -> tuple[float, float]:
    """Linear proper-motion propagation; parallax ignored (≤ 0.09 px, PRD §7.7)."""
    da, dd, _ = proper_motion_offset(pmra_cosdec_mas, pmdec_mas, dt_years)
    new_dec = dec + dd / 3600.0
    cosd = math.cos(math.radians((dec + new_dec) / 2.0))
    new_ra = (ra + da / 3600.0 / max(cosd, 1e-9)) % 360.0
    return new_ra, new_dec


def mjd_to_datetime(mjd: float) -> datetime:
    return datetime(1970, 1, 1, tzinfo=timezone.utc) + timedelta(days=mjd - MJD_UNIX_EPOCH)


def mjd_to_year(mjd: float) -> float:
    dt = mjd_to_datetime(mjd)
    start = datetime(dt.year, 1, 1, tzinfo=timezone.utc)
    end = datetime(dt.year + 1, 1, 1, tzinfo=timezone.utc)
    return dt.year + (dt - start) / (end - start)


def year_to_mjd(year: float) -> float:
    y = int(math.floor(year))
    start = datetime(y, 1, 1, tzinfo=timezone.utc)
    end = datetime(y + 1, 1, 1, tzinfo=timezone.utc)
    dt = start + (end - start) * (year - y)
    return (dt - datetime(1970, 1, 1, tzinfo=timezone.utc)).total_seconds() / 86400.0 + MJD_UNIX_EPOCH


def group_epochs(mjds: list[float] | np.ndarray, gap_days: float = 20.0) -> list[int]:
    """Epoch index for each time: a new epoch starts where consecutive times are > gap_days apart (PRD §6.2).

    Returns indices aligned with the input order; epochs are numbered in time order.
    """
    t = np.asarray(mjds, dtype=float)
    if t.size == 0:
        return []
    order = np.argsort(t, kind="stable")
    sorted_t = t[order]
    breaks = np.concatenate([[0], (np.diff(sorted_t) > gap_days).astype(int)])
    sorted_ids = np.cumsum(breaks)
    out = np.empty_like(sorted_ids)
    out[order] = sorted_ids
    return out.tolist()


def epoch_label(mjd: float) -> str:
    """'2025-11' style label from an epoch's mid time."""
    return mjd_to_datetime(mjd).strftime("%Y-%m")


def weighted_stack(images: np.ndarray, weights: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Inverse-variance weighted mean over axis 0 and its σ (PRD §7.4). Σw = 0 gives NaN."""
    w = np.where(np.isfinite(images) & np.isfinite(weights), weights, 0.0)
    x = np.where(w > 0, images, 0.0)
    sw = w.sum(axis=0)
    with np.errstate(invalid="ignore", divide="ignore"):
        mean = np.where(sw > 0, (w * x).sum(axis=0) / sw, np.nan)
        sigma = np.where(sw > 0, 1.0 / np.sqrt(sw), np.nan)
    return mean, sigma


def flux_ujy(pixels_mjysr_minus_bg: np.ndarray) -> float:
    """Aperture flux in µJy from background-subtracted MJy/sr pixels (PRD §7.8)."""
    return float(MJYSR_TO_UJY * np.nansum(pixels_mjysr_minus_bg))


def flux_err_ujy(variance_pixels: np.ndarray) -> float:
    return float(MJYSR_TO_UJY * math.sqrt(float(np.nansum(variance_pixels))))


def ab_mag(flux_ujy_value: float) -> float:
    """AB magnitude from µJy; 3631 Jy -> 0.0."""
    if flux_ujy_value <= 0:
        return float("nan")
    return 23.9 - 2.5 * math.log10(flux_ujy_value)


def aperture_photometry(image: np.ndarray, variance: np.ndarray, x: float, y: float,
                        r_ap: float = 2.0, r_in: float = 4.0, r_out: float = 7.0) -> tuple[float, float]:
    """Circular aperture flux and error in µJy with a median annulus background (PRD §7.8)."""
    yy, xx = np.indices(image.shape)
    r = np.hypot(xx - x, yy - y)
    ap = r <= r_ap
    ann = (r >= r_in) & (r <= r_out) & np.isfinite(image)
    bg = float(np.nanmedian(image[ann])) if ann.any() else 0.0
    vals = image[ap] - bg
    if not np.isfinite(vals).any():
        return float("nan"), float("nan")
    return flux_ujy(vals), flux_err_ujy(variance[ap])


def mira_phase(mjd: float, period_d: float = R_DRA_PERIOD_D, epoch_jd: float = R_DRA_EPOCH_JD) -> float:
    """Pulsation phase in [0, 1) (PRD §7.8)."""
    jd = mjd + JD_MINUS_MJD
    return ((jd - epoch_jd) / period_d) % 1.0


def decode_flag_names(header) -> dict[int, str]:
    """Bit -> name from FLAGS header keys MSKNnnnn (never hard-coded, PRD §5.1)."""
    names = {}
    for key in header:
        if key.startswith("MSKN") and key[4:].isdigit():
            names[int(key[4:])] = str(header[key])
    return names


# Display mask (PRD §5.1, revised in docs/memory/decisions.md #7). Saturated star cores carry
# TRANSIENT/OVERFLOW/SUR_ERROR/BLOOM, so the PRD's single list blanked every bright target.
# HARD bits are detector defects, always masked. SOFT bits are masked only where SOURCE (21) is not set.
# TRANSIENT (0), OVERFLOW (1), NONLINEAR (15) and BLOOM (26) are never masked; they are shown as badges.
HARD_MASK_BITS = (6, 7, 9, 10, 11, 14)
SOFT_MASK_BITS = (2, 17, 19)
SOURCE_BIT = 21
DEFAULT_MASK_BITS = HARD_MASK_BITS + SOFT_MASK_BITS
SATURATION_BITS = (1, 26)


def bits_to_mask(bits) -> int:
    m = 0
    for b in bits:
        m |= 1 << b
    return m


def display_bad(flags: np.ndarray) -> np.ndarray:
    """True where a pixel is hidden from the display stack."""
    hard = (flags & bits_to_mask(HARD_MASK_BITS)) != 0
    soft = ((flags & bits_to_mask(SOFT_MASK_BITS)) != 0) & ((flags & (1 << SOURCE_BIT)) == 0)
    return hard | soft
