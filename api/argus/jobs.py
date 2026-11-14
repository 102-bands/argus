"""In-process blink job runner with dedupe and SSE events (PRD §6.2, §8.2)."""
import asyncio
import json
import logging
import time
import uuid
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field

from . import memory, physics
from .cache import DiskCache
from .config import Settings
from .pipeline import (StackAccumulator, calibrate_and_align, compress, content_key, cutout_half_px, encode_frame,
                       grid_header, make_grid)
from .pixels import Cutout, PixelSource, crop_cutout, decode_cutout, encode_cutout
from .sia import Exposure, latest_release, sample_evenly

log = logging.getLogger("argus.jobs")
JOB_KEEP_S = 30 * 60
FIELD_SIZES = (1, 2, 3, 5, 8, 10, 15)  # arcmin; the choices in web/src/components/Controls.tsx


class Busy(Exception):
    pass


@dataclass
class BlinkSpec:
    ra: float
    dec: float
    size_arcmin: float
    detectors: list[str]
    products: list[str]
    collections: list[str]


@dataclass
class Job:
    id: str
    key: str
    spec: BlinkSpec
    rows: list[Exposure]
    epoch_ids: list[int]
    events: list[dict] = field(default_factory=list)
    status: str = "queued"
    created: float = field(default_factory=time.time)
    changed: asyncio.Event = field(default_factory=asyncio.Event)
    progressed: float = field(default_factory=time.monotonic)
    created_mono: float = field(default_factory=time.monotonic)
    watched: float = field(default_factory=time.monotonic)  # last time an SSE stream was open on it
    cancelled: bool = False

    def emit(self, event: str, data: dict) -> None:
        self.events.append({"event": event, "data": json.dumps(data, separators=(",", ":"))})
        self.changed.set()
        self.changed = asyncio.Event()


def manifest_key(settings: Settings, spec: BlinkSpec, release: str) -> str:
    return content_key(settings.pipeline_version, ",".join(spec.collections), round(spec.ra, 5), round(spec.dec, 5),
                       spec.size_arcmin, ",".join(sorted(spec.products)), ",".join(spec.detectors), "manifest", release)


def frame_key(settings: Settings, spec: BlinkSpec, product: str, detector: str, epoch: int, release: str) -> str:
    return content_key(settings.pipeline_version, ",".join(spec.collections), round(spec.ra, 5), round(spec.dec, 5),
                       spec.size_arcmin, product, detector, epoch, release)


def describe_epochs(rows: list[Exposure], epoch_ids: list[int]) -> list[dict]:
    by = defaultdict(list)
    for r, e in zip(rows, epoch_ids):
        by[e].append(r)
    out = []
    for e in sorted(by):
        rs = by[e]
        t0, t1 = min(r.t_min for r in rs), max(r.t_max for r in rs)
        counts = defaultdict(int)
        for r in rs:
            counts[r.detector] += 1
        out.append({"id": e, "label": physics.epoch_label(0.5 * (t0 + t1)), "t_start": t0, "t_end": t1,
                    "n_by_detector": dict(sorted(counts.items()))})
    return out


class JobRunner:
    def __init__(self, settings: Settings, cache: DiskCache, source: PixelSource):
        self.settings = settings
        self.cache = cache
        self.source = source
        self.jobs: dict[str, Job] = {}
        self.by_key: dict[str, Job] = {}
        self.running = asyncio.Semaphore(settings.max_running_jobs)
        self.pool = ThreadPoolExecutor(max_workers=settings.max_concurrent_fetch, thread_name_prefix="argus-px")

    def get(self, job_id: str) -> Job | None:
        self._gc()
        return self.jobs.get(job_id)

    def _gc(self) -> None:
        now = time.time()
        for jid, j in list(self.jobs.items()):
            if j.status in ("done", "error") and now - j.created > JOB_KEEP_S:
                self.jobs.pop(jid, None)
                if self.by_key.get(j.key) is j:
                    self.by_key.pop(j.key, None)

    def prepare(self, spec: BlinkSpec, rows: list[Exposure]) -> tuple[str, list[Exposure], list[int]]:
        rows = [r for r in rows if r.detector in spec.detectors]
        epoch_ids = physics.group_epochs([r.t_mid for r in rows])
        rows, epoch_ids = sample_evenly(rows, epoch_ids, self.settings.max_exposures_per_job)
        return manifest_key(self.settings, spec, latest_release(rows)), rows, epoch_ids

    def submit(self, spec: BlinkSpec, key: str, rows: list[Exposure], epoch_ids: list[int]) -> Job:
        self._gc()
        existing = self.by_key.get(key)
        if existing and existing.status not in ("error",):
            return existing
        active = sum(1 for j in self.jobs.values() if j.status in ("queued", "running"))
        if active >= self.settings.max_running_jobs + self.settings.max_queued_jobs:
            raise Busy()
        job = Job(id=str(uuid.uuid4()), key=key, spec=spec, rows=rows, epoch_ids=epoch_ids)
        self.jobs[job.id] = job
        self.by_key[key] = job
        asyncio.get_running_loop().create_task(self._run(job))
        return job

    def _abandoned(self, job: Job) -> bool:
        """True when no SSE stream has been open on the job for the grace period.

        Without this, clicking through fields left every old job running; they shared the download
        slots and the newest one hit the timeout. Streams refresh `watched` every few seconds; a
        timestamp is used because the SSE library does not reliably close generators on disconnect.
        """
        grace = self.settings.abandon_grace_s
        return grace > 0 and time.monotonic() - job.watched > grace

    def _stop(self, job: Job, code: str, detail: str) -> None:
        job.cancelled = True  # queued exposures in the thread pool skip their fetch
        job.status = "error"
        job.emit("error", {"code": code, "detail": detail})

    async def _run(self, job: Job) -> None:
        # Wait for a slot, but give up on the job if its viewer leaves while it is queued.
        while True:
            if self._abandoned(job):
                log.info("job %s abandoned while queued", job.id)
                return self._stop(job, "cancelled", "Nobody was watching this job, so it stopped.")
            try:
                await asyncio.wait_for(self.running.acquire(), timeout=5)
                break
            except asyncio.TimeoutError:
                pass
        try:
            job.status = "running"
            job.progressed = time.monotonic()
            work = asyncio.ensure_future(self._work(job))
            try:
                # Time out on a stall, not on total time: a busy archive makes jobs slow, not stuck.
                while not work.done():
                    await asyncio.wait({work}, timeout=5)
                    if work.done():
                        break
                    now = time.monotonic()
                    if self._abandoned(job):
                        log.info("job %s abandoned; cancelling", job.id)
                        return self._stop(job, "cancelled", "Nobody was watching this job, so it stopped.")
                    if now - job.progressed > self.settings.job_timeout_s or now - job.created_mono > self.settings.job_max_s:
                        return self._stop(job, "timeout", "The archive stopped answering. Try again in a minute.")
                work.result()
                job.status = "done"
            finally:
                if not work.done():
                    work.cancel()
        except Exception as e:  # noqa: BLE001 - reported to the client, logged here
            log.exception("job %s failed", job.id)
            self._stop(job, "pipeline", type(e).__name__)
        finally:
            self.running.release()
            # Hand the job's cutout memory back to the OS (see memory.py) once nothing else is running.
            if not any(j.status == "running" for j in self.jobs.values()):
                await asyncio.get_running_loop().run_in_executor(None, memory.release)

    def sweep(self) -> None:
        """Drop finished jobs older than JOB_KEEP_S and release memory; called on a timer."""
        self._gc()
        memory.release()

    async def _work(self, job: Job) -> None:
        spec, s = job.spec, self.settings
        grid, n = make_grid(spec.ra, spec.dec, spec.size_arcmin)
        half = cutout_half_px(n)
        release = latest_release(job.rows)
        epochs = describe_epochs(job.rows, job.epoch_ids)
        total = len(job.rows)
        job.emit("progress", {"done": 0, "total": total, "epochs": epochs})
        loop = asyncio.get_running_loop()
        done = 0
        frames: list[dict] = []
        photometry: list[dict] = []

        # Any cached cutout of this exposure at the same centre and at least this size can be cropped.
        halves = sorted({half} | {cutout_half_px(make_grid(spec.ra, spec.dec, sz)[1])
                                  for sz in FIELD_SIZES if sz >= spec.size_arcmin})

        def cut_key(exp: Exposure, h: int) -> str:
            return content_key("cut", exp.obs_id, round(spec.ra, 5), round(spec.dec, 5), h)

        def get_cutout(exp: Exposure) -> Cutout | None:
            for h in halves:
                data = self.cache.get("cut", cut_key(exp, h), ram=False)
                cut = data and crop_cutout(decode_cutout(data), spec.ra, spec.dec, half)
                if cut:
                    return cut
            if job.cancelled:
                return None
            cut = self.source.fetch(exp, spec.ra, spec.dec, half)
            if cut is not None and cut.header is not None:
                self.cache.put("cut", cut_key(exp, half), encode_cutout(cut), ram=False)
            return cut

        def work(exp: Exposure):
            if job.cancelled:
                return None
            cut = get_cutout(exp)
            return None if cut is None else calibrate_and_align(cut, grid, n)

        # Submit everything at once, in epoch order, so the pool never idles on one epoch's slowest
        # exposure; an epoch's frames go out as soon as its last exposure is in.
        by_epoch = {ep["id"]: ep for ep in epochs}
        remaining = Counter(job.epoch_ids)
        accs: dict[int, dict[tuple[str, str], StackAccumulator]] = defaultdict(dict)
        order = sorted(range(total), key=lambda i: (job.epoch_ids[i], job.rows[i].t_mid))
        futs = {loop.run_in_executor(self.pool, work, job.rows[i]): i for i in order}
        pending = set(futs)
        try:
            while pending:
                finished, pending = await asyncio.wait(pending, return_when=asyncio.FIRST_COMPLETED)
                for fut in sorted(finished, key=futs.__getitem__):
                    i = futs[fut]
                    exp, e = job.rows[i], job.epoch_ids[i]
                    try:
                        aligned = fut.result()
                    except Exception as err:  # noqa: BLE001 - one bad exposure must not sink the job
                        log.warning("exposure %s failed: %s", exp.obs_id, err)
                        aligned = None
                    done += 1
                    job.progressed = time.monotonic()
                    if done % 5 == 0 or done == total:
                        job.emit("progress", {"done": done, "total": total})
                    if aligned is not None:
                        acc = accs[e]
                        if "broadband" in spec.products:
                            acc.setdefault(("broadband", "all"), StackAccumulator(n)).add(aligned, exp.t_mid)
                        if "per_detector" in spec.products:
                            acc.setdefault(("per_detector", exp.detector), StackAccumulator(n)).add(aligned, exp.t_mid)
                        if aligned.flux_ujy == aligned.flux_ujy:  # not NaN
                            photometry.append({"mjd": exp.t_mid, "detector": exp.detector,
                                               "lambda_um": round(aligned.lam_um, 4), "flux_ujy": aligned.flux_ujy,
                                               "err": aligned.err_ujy, "saturated": aligned.saturated, "epoch": e})
                    remaining[e] -= 1
                    if remaining[e] == 0:
                        for (product, det), acc in sorted(accs.pop(e, {}).items()):
                            frames.append(self._emit_frame(job, spec, grid, n, by_epoch[e], product, det, acc, release))
        finally:
            for fut in pending:
                fut.cancel()
        frames.sort(key=lambda f: (f["epoch"], f["product"], f["detector"]))

        manifest = {
            "key": job.key, "ra": spec.ra, "dec": spec.dec, "size_arcmin": spec.size_arcmin, "n": n,
            "collections": spec.collections, "release_marker": release, "pipeline_version": s.pipeline_version,
            "grid": grid_header(grid, n), "epochs": epochs, "frames": frames,
            "photometry": sorted(photometry, key=lambda p: p["mjd"]), "n_exposures": total, "created": time.time(),
        }
        self.cache.put("manifest", job.key, json.dumps(manifest).encode())
        job.emit("done", {"manifest_key": job.key, "n_frames": len(frames)})

    def _emit_frame(self, job, spec, grid, n, ep, product, det, acc, release) -> dict:
        pixels, layer = acc.result()
        key = frame_key(self.settings, spec, product, det, ep["id"], release)
        lams = sorted(acc.lams)
        meta = {"key": key, "product": product, "detector": det, "epoch": ep["id"], "epoch_label": ep["label"],
                "t_mid": sum(acc.times) / len(acc.times), "lambda_um": round(sum(lams) / len(lams), 4),
                "lambda_range": [round(lams[0], 4), round(lams[-1], 4)], "n_exp": acc.count,
                "flags": {"saturated": acc.n_saturated > 0, "n_saturated": acc.n_saturated}}
        raw = encode_frame(pixels, layer, {**meta, "wcs": grid_header(grid, n)})
        self.cache.put("frame", key, compress(raw))
        job.emit("frame", meta)
        return meta
