"""Build preset files at another field size by asking a running Argus API (e.g. production, next to the data).

Writes web/public/presets/<id>/manifest-<size>.json and adds its frames to frames/. The existing manifest.json
(the size precompute_presets.py built) stays, so both sizes load instantly. Live jobs cap exposures (120), so
these presets use fewer exposures than the precomputed ones.

    uv run python scripts/presets_from_api.py --size 8 --api https://argus102.space/api [target ...]
"""
import argparse
import json
import sys
import time
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from argus.targets import TARGETS  # noqa: E402

OUT = Path(__file__).resolve().parents[2] / "web" / "public" / "presets"


def follow(c: httpx.Client, job_id: str) -> None:
    event = ""
    with c.stream("GET", f"/blink/{job_id}/events", timeout=None) as s:
        for line in s.iter_lines():
            if line.startswith("event:"):
                event = line.split(":", 1)[1].strip()
            elif line.startswith("data:") and event in ("done", "error"):
                if event == "error":
                    raise RuntimeError(line[5:])
                return
    raise RuntimeError("event stream ended early")


def build(c: httpx.Client, tid: str, size: float) -> None:
    t = TARGETS[tid]
    started = time.time()
    r = c.post("/blink", json={"ra": t.ra, "dec": t.dec, "size_arcmin": size})
    r.raise_for_status()
    if r.status_code == 202:
        job = r.json()
        print(f"{tid}: job {job['job_id']}", flush=True)
        follow(c, job["job_id"])
        manifest = c.get(f"/manifest/{job['manifest_key']}").raise_for_status().json()
    else:
        manifest = r.json()
    dest = OUT / tid
    (dest / "frames").mkdir(parents=True, exist_ok=True)
    for f in manifest["frames"]:
        data = c.get(f"/frame/{f['key']}", headers={"Accept-Encoding": "identity"}).raise_for_status().content
        (dest / "frames" / f"{f['key']}.bin").write_bytes(data)
    manifest["target"] = t.public()
    manifest["gaia"] = c.get("/gaia", params={"ra": t.cat_ra, "dec": t.cat_dec,
                                               "radius_arcmin": min(size * 0.75, 15)}).raise_for_status().json()
    name = f"manifest-{size:g}.json"
    (dest / name).write_text(json.dumps(manifest, separators=(",", ":")))
    print(f"  {tid}: {len(manifest['frames'])} frames, {manifest['n_exposures']} exposures -> {name} "
          f"in {time.time() - started:.0f}s", flush=True)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("targets", nargs="*", default=list(TARGETS))
    ap.add_argument("--size", type=float, default=8.0)
    ap.add_argument("--api", default="https://argus102.space/api")
    a = ap.parse_args()
    with httpx.Client(base_url=a.api, timeout=httpx.Timeout(120, connect=30)) as c:
        for tid in a.targets:
            for attempt in range(3):
                try:
                    build(c, tid, a.size)
                    break
                except (httpx.HTTPError, RuntimeError) as e:
                    print(f"  {tid}: attempt {attempt + 1} failed: {e}", flush=True)
                    time.sleep(10)
    return 0


if __name__ == "__main__":
    sys.exit(main())
