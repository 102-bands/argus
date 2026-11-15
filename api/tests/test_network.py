"""Live archive checks (PRD §14.2). Run with: uv run pytest -m network"""
import asyncio

import httpx
import numpy as np
import pytest

from argus.cache import DiskCache
from argus.pipeline import calibrate_and_align, cutout_half_px, make_grid
from argus.pixels import make_source
from argus.sia import CoverageService
from argus.targets import TARGETS

pytestmark = pytest.mark.network
COLL = ["spherex_dr1", "spherex_qr3"]


def _coverage(tmp_path, ra, dec):
    async def run():
        async with httpx.AsyncClient() as c:
            return await CoverageService(DiskCache(tmp_path, 10**8), c).query(ra, dec, COLL)
    return asyncio.run(run())


def test_m101_coverage(tmp_path):
    rows = _coverage(tmp_path, 210.8023, 54.3490)
    assert len(rows) > 100
    assert {r.detector for r in rows} == {"D1", "D2", "D3", "D4", "D5", "D6"}


@pytest.mark.parametrize("kind", ["s3", "cutout"])
def test_one_exposure(tmp_path, kind):
    t = TARGETS["rw-aur"]
    rows = _coverage(tmp_path, t.ra, t.dec)
    grid, n = make_grid(t.ra, t.dec, 3)
    cut = make_source(kind, 2).fetch(rows[0], t.ra, t.dec, cutout_half_px(n))
    a = calibrate_and_align(cut, grid, n)
    assert a is not None and a.image.shape == (n, n)
    assert 0.7 < a.lam_um < 5.1


def test_s3_prefetch_matches_plain(tmp_path):
    t = TARGETS["rw-aur"]
    rows = _coverage(tmp_path, t.ra, t.dec)
    half = cutout_half_px(make_grid(t.ra, t.dec, 3)[1])
    for exp in (rows[0], rows[-1]):
        a = make_source("s3", 2, prefetch=True).fetch(exp, t.ra, t.dec, half)
        b = make_source("s3", 2, prefetch=False).fetch(exp, t.ra, t.dec, half)
        for k in ("image", "flags", "variance", "zodi"):
            np.testing.assert_array_equal(getattr(a, k), getattr(b, k))
        assert a.lam_um == b.lam_um


def test_gaia_barnard():
    from argus.gaia import cone_sync

    t = TARGETS["barnard"]
    rows = asyncio.run(cone_sync(t.cat_ra, t.cat_dec, 1.0))
    assert any(r["source_id"] == "4472832130942575872" for r in rows)
