"""Weekly refresh (PRD §6.3): re-query each preset; rebuild those whose newest obs_release_date changed.

The static preset files live in web/public/presets, so run this from a full checkout (locally or in CI),
commit the changed presets and push: Railway redeploys the web service. Inside the api container it still
refreshes the pinned API cache.

    python scripts/refresh.py            # rebuild only presets with new data
    python scripts/refresh.py --force    # rebuild all
"""
import asyncio
import json
import sys
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from argus.cache import DiskCache  # noqa: E402
from argus.config import get_settings  # noqa: E402
from argus.sia import CoverageService, SIA_TTL_S, latest_release  # noqa: E402
from argus.targets import TARGETS  # noqa: E402
from precompute_presets import OUT, main as precompute  # noqa: E402


async def stale_targets(force: bool) -> list[str]:
    s = get_settings()
    cache = DiskCache(s.cache_dir, int(s.cache_max_gb * 1024**3))
    stale = []
    async with httpx.AsyncClient(follow_redirects=False) as http:
        cov = CoverageService(cache, http)
        for tid, t in TARGETS.items():
            mf = OUT / tid / "manifest.json"
            old = json.loads(mf.read_text())["release_marker"] if mf.exists() else None
            # Bypass the 24 h SIA cache so this run sees this week's data.
            key = f"{'+'.join(s.collection_list)}_{t.ra:.3f}_{t.dec:.3f}".replace("-", "m")
            cache.put("sia", key, json.dumps({"at": 0 - SIA_TTL_S, "rows": []}).encode())
            new = latest_release(await cov.query(t.ra, t.dec, s.collection_list))
            print(f"{tid}: preset {old} · archive {new}")
            if force or old != new:
                stale.append(tid)
    return stale


if __name__ == "__main__":
    ids = asyncio.run(stale_targets("--force" in sys.argv))
    if ids:
        print("rebuilding:", ", ".join(ids))
        asyncio.run(precompute(ids))
    else:
        print("all presets current")
