"""Validity check (PRD §7.7, G2): fitted centroid per epoch vs the Gaia-propagated position.

Reads a precomputed preset (web/public/presets/<id>/). Passes if every epoch agrees within 0.5 px.

    uv run python scripts/validate_motion.py barnard
"""
import json
import struct
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from argus.physics import mjd_to_year, propagate  # noqa: E402
from argus.pipeline import make_grid  # noqa: E402
from argus.targets import TARGETS  # noqa: E402

PRESETS = Path(__file__).resolve().parents[2] / "web" / "public" / "presets"
TOL_PX = 0.5


def read_frame(path: Path) -> np.ndarray:
    raw = path.read_bytes()
    hl = struct.unpack("<I", raw[:4])[0]
    h = json.loads(raw[4:4 + hl])
    n = h["w"]
    return np.frombuffer(raw[4 + hl:4 + hl + 2 * n * n], "<f2").astype(float).reshape(n, n)


def centroid(img: np.ndarray, x0: float, y0: float, r: int = 4) -> tuple[float, float]:
    """Background-subtracted, flux-weighted centroid in a box around (x0, y0)."""
    xi, yi = int(round(x0)), int(round(y0))
    box = img[yi - r:yi + r + 1, xi - r:xi + r + 1]
    b = np.nan_to_num(box - np.nanmedian(img), nan=0).clip(min=0)
    yy, xx = np.indices(b.shape)
    return xi - r + (xx * b).sum() / b.sum(), yi - r + (yy * b).sum() / b.sum()


def main(tid: str) -> int:
    t = TARGETS[tid]
    m = json.loads((PRESETS / tid / "manifest.json").read_text())
    grid, n = make_grid(m["ra"], m["dec"], m["size_arcmin"])
    worst = 0.0
    print(f"{t.name}: epoch  predicted(x,y)   measured(x,y)   offset px")
    # Measure in the target's own band: WISE 0855 is invisible in D1-D4, so a broadband centroid
    # is pulled by field stars.
    want = ("broadband", "all") if t.band == "all" else ("per_detector", t.band)
    print(f"  band: {want[1]}")
    for f in sorted((f for f in m["frames"] if (f["product"], f["detector"]) == want), key=lambda f: f["epoch"]):
        ra, dec = propagate(t.cat_ra, t.cat_dec, t.pmra, t.pmdec, mjd_to_year(f["t_mid"]) - t.cat_epoch)
        px, py = (float(v) for v in grid.world_to_pixel_values(ra, dec))
        mx, my = centroid(read_frame(PRESETS / tid / "frames" / f"{f['key']}.bin"), px, py, r=3 if t.band != "all" else 4)
        off = float(np.hypot(mx - px, my - py))
        worst = max(worst, off)
        print(f"  {f['epoch_label']}   ({px:5.2f},{py:5.2f})   ({mx:5.2f},{my:5.2f})   {off:.2f}")
    ok = worst <= TOL_PX
    print(f"worst offset {worst:.2f} px -> {'PASS' if ok else 'FAIL'} (tolerance {TOL_PX} px)")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else "barnard"))
