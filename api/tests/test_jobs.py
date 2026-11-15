"""Job loop: every epoch produces frames without a per-epoch barrier; cutouts are reused across field sizes."""
import asyncio
import io
import json
import threading

import numpy as np
from astropy.io import fits

from argus.cache import DiskCache
from argus.config import Settings
from argus.jobs import BlinkSpec, Job, JobRunner
from argus.pixels import _extract, crop_cutout, decode_cutout, encode_cutout
from argus.sia import Exposure
from test_pixels import DEC, EXP, RA, RAW


class FakeSource:
    name = "fake"

    def __init__(self):
        self.calls = 0
        self.lock = threading.Lock()

    def fetch(self, exp, ra, dec, half_px):
        with self.lock:
            self.calls += 1
        with fits.open(io.BytesIO(RAW)) as hdul:
            return _extract(hdul, exp, ra, dec, half_px)


def _rows() -> tuple[list[Exposure], list[int]]:
    rows, eps = [], []
    for e, t0 in enumerate((60900.0, 61100.0, 61300.0)):  # three visits, months apart
        for k in range(4):
            t = t0 + k * 0.1
            rows.append(Exposure(obs_id=f"o{e}{k}", detector=f"D{k + 1}", t_min=t, t_max=t + 0.01, em_min_um=1.0,
                                 em_max_um=2.0, access_url="https://irsa.ipac.caltech.edu/x",
                                 s3_url="s3://nasa-irsa-spherex/x", release_date="r", collection="c"))
            eps.append(e)
    return rows, eps


def _run(runner: JobRunner, size: float) -> Job:
    rows, eps = _rows()
    spec = BlinkSpec(ra=RA, dec=DEC, size_arcmin=size, detectors=["D1", "D2", "D3", "D4", "D5", "D6"],
                     products=["broadband", "per_detector"], collections=["c"])
    job = Job(id="j", key=f"k{size}", spec=spec, rows=rows, epoch_ids=eps)
    asyncio.run(runner._work(job))
    return job


def test_all_epochs_framed_and_cutouts_reused(tmp_path):
    src = FakeSource()
    runner = JobRunner(Settings(), DiskCache(tmp_path, 1 << 30), src)
    job = _run(runner, 3.0)
    assert src.calls == 12
    names = [e["event"] for e in job.events]
    assert names[-1] == "done"
    frames = [json.loads(e["data"]) for e in job.events if e["event"] == "frame"]
    assert sorted({f["epoch"] for f in frames}) == [0, 1, 2]
    assert len(frames) == 3 * (1 + 4)  # broadband + 4 detectors per epoch
    # A smaller field at the same centre is cut from the cached 3' cutouts: no new fetches.
    _run(runner, 2.0)
    assert src.calls == 12


def test_crop_matches_direct_cutout():
    with fits.open(io.BytesIO(RAW)) as hdul:
        big = _extract(hdul, EXP, RA, DEC, 40)
        small = _extract(hdul, EXP, RA, DEC, 15)
    got = crop_cutout(decode_cutout(encode_cutout(big)), RA, DEC, 15)
    for k in ("image", "flags", "variance", "zodi"):
        np.testing.assert_array_equal(getattr(got, k), getattr(small, k))
    assert got.box == small.box and got.wcs.wcs.crpix.tolist() == small.wcs.wcs.crpix.tolist()
    assert crop_cutout(small, RA, DEC, 40) is None  # can't grow a cutout
