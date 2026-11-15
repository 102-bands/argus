"""Time S3Source.fetch with and without prefetching on cached coverage (no SIA call).

    uv run python scripts/bench_fetch.py [coverage-file] [n] [--mode both|prefetch|plain]
    uv run python scripts/bench_fetch.py --job RA DEC [SIZE]   # full live job through a running API

coverage-file: a file under data/sia/ (written by any earlier coverage query). Each exposure is
fetched with both readers; the arrays must match exactly.
"""
import argparse
import json
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from argus.pipeline import cutout_half_px, make_grid  # noqa: E402
from argus.pixels import S3Source  # noqa: E402
from argus.sia import Exposure  # noqa: E402


def run(src: S3Source, rows, ra, dec, half, threads):
    t = time.time()
    src.requests = 0
    def one(e):
        try:
            return src.fetch(e, ra, dec, half)
        except Exception as err:  # noqa: BLE001 - count it and keep timing the rest
            print(f"  failed {e.obs_id}: {type(err).__name__}", flush=True)
            return FAILED

    with ThreadPoolExecutor(threads) as pool:
        cuts = list(pool.map(one, rows))
    return cuts, time.time() - t, src.requests


FAILED = object()


def time_job(ra: float, dec: float, size: float, api: str = "http://localhost:8000/api") -> int:
    """POST /blink and follow its SSE stream; prints time to first frame and to done."""
    import httpx

    t = time.time()
    r = httpx.post(f"{api}/blink", json={"ra": ra, "dec": dec, "size_arcmin": size}, timeout=180)
    if r.status_code == 200:
        print(f"cached manifest in {time.time() - t:.1f} s")
        return 0
    r.raise_for_status()
    job = r.json()
    print(f"job {job['job_id']} accepted in {time.time() - t:.1f} s; {job['frames_expected']} frames expected")
    first = None
    event = ""
    with httpx.stream("GET", f"{api}/blink/{job['job_id']}/events", timeout=None) as s:
        for line in s.iter_lines():
            if line.startswith("event:"):
                event = line.split(":", 1)[1].strip()
            elif line.startswith("data:"):
                d = json.loads(line[5:])
                if event == "frame" and first is None:
                    first = time.time() - t
                    print(f"first frame after {first:.1f} s")
                elif event == "progress" and "epochs" not in d:
                    print(f"  {d['done']}/{d['total']} after {time.time() - t:.0f} s", flush=True)
                elif event in ("done", "error"):
                    print(f"{event} after {time.time() - t:.1f} s: {d}")
                    return 0 if event == "done" else 1
    return 1


def main() -> int:
    if len(sys.argv) > 1 and sys.argv[1] == "--job":
        ra, dec, *rest = (float(v) for v in sys.argv[2:])
        return time_job(ra, dec, rest[0] if rest else 3.0)
    ap = argparse.ArgumentParser()
    ap.add_argument("coverage", nargs="?", default="data/sia/sp/spherex_dr1+spherex_qr3_12.000_21.000")
    ap.add_argument("n", nargs="?", type=int, default=12)
    ap.add_argument("--mode", default="both", choices=("both", "prefetch", "plain"))
    ap.add_argument("--threads", type=int, default=12)
    ap.add_argument("--size", type=float, default=3.0, help="field size in arcmin")
    a = ap.parse_args()
    path = Path(a.coverage)
    _, ra, dec = path.name.rsplit("_", 2)
    ra, dec = float(ra), float(dec.replace("m", "-"))
    rows = [Exposure(**r) for r in json.loads(path.read_bytes())["rows"]][: a.n]
    half = cutout_half_px(make_grid(ra, dec, a.size)[1])
    print(f"{len(rows)} exposures at ({ra}, {dec}), half {half} px, {a.threads} threads")
    results = {}
    for mode in (("plain", "prefetch") if a.mode == "both" else (a.mode,)):
        src = S3Source(threading.BoundedSemaphore(a.threads), prefetch=mode == "prefetch")
        cuts, secs, reqs = run(src, rows, ra, dec, half, a.threads)
        results[mode] = cuts
        ok = sum(c is not None and c is not FAILED for c in cuts)
        bad = sum(c is FAILED for c in cuts)
        print(f"{mode:9s} {secs:6.1f} s total  {secs * a.threads / len(rows):5.1f} s/exposure/thread  "
              f"{f'{reqs / len(rows):4.1f}' if mode == 'prefetch' else ' n/a'} requests/exposure  ({ok} cutouts, {bad} failed)")
    if len(results) == 2:
        same = all(
            (p is None and q is None) or (p is not None and q is not None and all(
                np.array_equal(getattr(p, k), getattr(q, k), equal_nan=k != "flags")
                for k in ("image", "flags", "variance", "zodi")) and p.lam_um == q.lam_um)
            for p, q in zip(results["plain"], results["prefetch"]) if p is not FAILED and q is not FAILED)
        print("arrays identical:", same)
        return 0 if same else 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
