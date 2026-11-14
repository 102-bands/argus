"""Precompute the five presets as static files (PRD §4.1 P0, G5: works even if IRSA is down).

Writes web/public/presets/<id>/manifest.json and frames/<key>.bin (uncompressed; the static server compresses).
Also fills the API disk cache, pinned, so the API serves presets instantly.

    uv run python scripts/precompute_presets.py [target ...]
"""
import asyncio
import json
import shutil
import sys
import time
from pathlib import Path

import brotli
import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from argus.cache import DiskCache  # noqa: E402
from argus.config import get_settings  # noqa: E402
from argus.gaia import cone_sync  # noqa: E402
from argus.jobs import BlinkSpec, JobRunner  # noqa: E402
from argus.models import DETECTORS  # noqa: E402
from argus.pixels import make_source  # noqa: E402
from argus.sia import CoverageService  # noqa: E402
from argus.targets import TARGETS  # noqa: E402

OUT = Path(__file__).resolve().parents[2] / "web" / "public" / "presets"


async def build(target_id: str, runner: JobRunner, coverage: CoverageService, cache: DiskCache, http) -> None:
    t = TARGETS[target_id]
    s = get_settings()
    spec = BlinkSpec(ra=t.ra, dec=t.dec, size_arcmin=t.size, detectors=list(DETECTORS),
                     products=["broadband", "per_detector"], collections=s.collection_list)
    rows = await coverage.query(t.ra, t.dec, spec.collections)
    key, rows, epoch_ids = runner.prepare(spec, rows)
    print(f"{target_id}: {len(rows)} exposures, {len(set(epoch_ids))} epochs", flush=True)
    started = time.time()
    if cache.get("manifest", key) is None:
        job = runner.submit(spec, key, rows, epoch_ids)
        last = 0
        while job.status in ("queued", "running"):
            await asyncio.sleep(5)
            done = sum(1 for e in job.events if e["event"] == "frame")
            if done != last:
                print(f"  {done} frames, {time.time() - started:.0f}s", flush=True)
                last = done
        if job.status != "done":
            raise RuntimeError(f"{target_id} failed: {job.events[-1]}")
    manifest = json.loads(cache.get("manifest", key))

    gaia = await cone_sync(t.cat_ra, t.cat_dec, t.size * 0.75, http)
    dest = OUT / target_id
    shutil.rmtree(dest, ignore_errors=True)
    (dest / "frames").mkdir(parents=True)
    for f in manifest["frames"]:
        data = cache.get("frame", f["key"])
        cache.put("frame", f["key"], data, pinned=True)
        (dest / "frames" / f"{f['key']}.bin").write_bytes(brotli.decompress(data))
    cache.put("manifest", key, json.dumps(manifest).encode(), pinned=True)
    manifest["target"] = t.public()
    manifest["gaia"] = gaia
    (dest / "manifest.json").write_text(json.dumps(manifest, separators=(",", ":")))
    size = sum(p.stat().st_size for p in dest.rglob("*") if p.is_file())
    print(f"  wrote {dest} ({size / 1024:.0f} KB) in {time.time() - started:.0f}s", flush=True)


async def main(ids: list[str]) -> None:
    s = get_settings()
    s.job_timeout_s = s.job_max_s = 3600  # offline batch: no web limits
    cache = DiskCache(s.cache_dir, int(s.cache_max_gb * 1024**3))
    async with httpx.AsyncClient(follow_redirects=False) as http:
        coverage = CoverageService(cache, http)
        runner = JobRunner(s, cache, make_source(s.pixel_source, s.max_concurrent_fetch))
        for tid in ids:
            await build(tid, runner, coverage, cache, http)
        index = [TARGETS[i].public() for i in TARGETS if (OUT / i / "manifest.json").exists()]
        (OUT / "index.json").write_text(json.dumps(index, indent=1))


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1:] or list(TARGETS)))
