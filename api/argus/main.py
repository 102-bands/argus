"""FastAPI app factory and routes (PRD §8)."""
import asyncio
import json
import logging
import re
import time
from contextlib import asynccontextmanager
from typing import Annotated

import brotli
import httpx
from fastapi import FastAPI, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from slowapi.errors import RateLimitExceeded
from sse_starlette.sse import EventSourceResponse
from starlette.exceptions import HTTPException

from . import __version__
from .cache import DiskCache, RamLRU
from .config import get_settings
from .jobs import Busy, BlinkSpec, JobRunner, describe_epochs
from .models import BlinkRequest, validate_collections
from .physics import CoordError, group_epochs, parse_dec, parse_ra
from .pixels import make_source
from .security import SecurityMiddleware, limiter
from .sia import CoverageService, latest_release
from .targets import TARGETS

log = logging.getLogger("argus")
UUID4 = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
HEX64 = re.compile(r"^[0-9a-f]{64}$")


def problem(status: int, title: str, detail: str = "", headers: dict | None = None) -> JSONResponse:
    return JSONResponse({"type": "about:blank", "title": title, "status": status, "detail": detail},
                        status_code=status, media_type="application/problem+json", headers=headers)


def cached_json(data, max_age: int) -> JSONResponse:
    return JSONResponse(data, headers={"Cache-Control": f"public, max-age={max_age}"})


@asynccontextmanager
async def lifespan(app: FastAPI):
    s = get_settings()
    cache = DiskCache(s.cache_dir, int(s.cache_max_gb * 1024**3), RamLRU(s.ram_cache_mb * 1024**2))
    client = httpx.AsyncClient(follow_redirects=False, timeout=httpx.Timeout(30, connect=30))
    app.state.settings = s
    app.state.cache = cache
    app.state.http = client
    app.state.coverage = CoverageService(cache, client)
    app.state.jobs = JobRunner(s, cache, make_source(s.pixel_source, s.max_concurrent_fetch))
    yield
    await client.aclose()
    app.state.jobs.pool.shutdown(wait=False, cancel_futures=True)


def _coords(ra: str, dec: str) -> tuple[float, float]:
    return parse_ra(ra), parse_dec(dec)


def _collections(request: Request, raw: str | None) -> list[str]:
    if not raw:
        return request.app.state.settings.collection_list
    return validate_collections([c.strip() for c in raw.split(",") if c.strip()])


def create_app() -> FastAPI:
    s = get_settings()
    app = FastAPI(title="Argus API", version=__version__, lifespan=lifespan, docs_url="/api/docs",
                  openapi_url="/api/openapi.json", redoc_url=None)
    app.state.limiter = limiter
    app.add_middleware(CORSMiddleware, allow_origins=s.origin_list, allow_methods=["GET", "POST"],
                       allow_headers=["Content-Type"], allow_credentials=False, max_age=600)
    app.add_middleware(SecurityMiddleware)

    @app.middleware("http")
    async def access_log(request: Request, call_next):
        # Method, path, status, duration only. No IPs or user agents (PRD §11.3).
        t = time.perf_counter()
        response = await call_next(request)
        log.info("%s %s %s %.0fms", request.method, request.url.path, response.status_code,
                 1000 * (time.perf_counter() - t))
        return response

    @app.exception_handler(RateLimitExceeded)
    async def _rate(request, exc):
        return problem(429, "Too many requests", "Slow down a little.", {"Retry-After": "60"})

    @app.exception_handler(RequestValidationError)
    async def _invalid(request, exc):
        msgs = "; ".join(f"{'.'.join(str(p) for p in e['loc'][1:])}: {e['msg']}" for e in exc.errors())
        return problem(422, "Invalid request", msgs)

    @app.exception_handler(CoordError)
    async def _coord(request, exc):
        return problem(422, "Invalid coordinates", str(exc))

    @app.exception_handler(ValueError)
    async def _value(request, exc):
        return problem(422, "Invalid request", str(exc))

    @app.exception_handler(HTTPException)
    async def _http(request, exc):
        return problem(exc.status_code, str(exc.detail))

    @app.exception_handler(httpx.HTTPError)
    async def _upstream(request, exc):
        return problem(502, "The NASA archive is busy", "IRSA did not answer. Try again in a minute.",
                       {"Retry-After": "30"})

    @app.get("/api/health")
    async def health(request: Request):
        st = request.app.state.settings
        return JSONResponse({"status": "ok", "version": __version__, "pixel_source": st.pixel_source,
                             "collections": st.collection_list}, headers={"Cache-Control": "no-store"})

    @app.get("/api/targets")
    @limiter.limit("120/minute")
    async def targets(request: Request):
        return cached_json([t.public() for t in TARGETS.values()], 86400)

    @app.get("/api/releases")
    @limiter.limit("60/minute")
    async def releases(request: Request):
        st = request.app.state.settings
        t = TARGETS["barnard"]
        rows = await request.app.state.coverage.query(t.ra, t.dec, st.collection_list)
        return cached_json({"collections": st.collection_list, "latest_obs_release_date": latest_release(rows),
                            "pipeline_version": st.pipeline_version}, 3600)

    @app.get("/api/coverage")
    @limiter.limit("30/minute")
    async def coverage(request: Request, ra: Annotated[str, Query(max_length=40)],
                       dec: Annotated[str, Query(max_length=40)], collections: str | None = None):
        r, d = _coords(ra, dec)
        rows = await request.app.state.coverage.query(r, d, _collections(request, collections))
        epochs = describe_epochs(rows, group_epochs([x.t_mid for x in rows]))
        return cached_json({"ra": r, "dec": d, "n_exposures": len(rows), "epochs": epochs,
                            "latest_obs_release_date": latest_release(rows)}, 86400)

    @app.post("/api/blink")
    @limiter.limit("10/minute")
    async def blink(request: Request, body: BlinkRequest):
        st = request.app.state.settings
        spec = BlinkSpec(ra=body.ra, dec=body.dec, size_arcmin=body.size_arcmin, detectors=body.detector_set(),
                         products=sorted(set(body.products)), collections=body.collections or st.collection_list)
        rows = await request.app.state.coverage.query(spec.ra, spec.dec, spec.collections)
        runner: JobRunner = request.app.state.jobs
        key, rows, epoch_ids = runner.prepare(spec, rows)
        if not rows:
            return problem(404, "No coverage", "SPHEREx hasn't imaged this spot in the releases we use yet.")
        cached = request.app.state.cache.get("manifest", key)
        if cached is not None:
            return Response(cached, media_type="application/json")
        try:
            job = runner.submit(spec, key, rows, epoch_ids)
        except Busy:
            return problem(503, "Argus is busy", "Too many jobs are running. Try again shortly.", {"Retry-After": "30"})
        n_epochs = len(set(epoch_ids))
        per_epoch = (1 if "broadband" in spec.products else 0) + (len(spec.detectors) if "per_detector" in spec.products else 0)
        return JSONResponse({"job_id": job.id, "manifest_key": key, "frames_expected": n_epochs * per_epoch},
                            status_code=202)

    @app.get("/api/blink/{job_id}/events")
    @limiter.limit("30/minute")
    async def events(request: Request, job_id: str):
        if not UUID4.match(job_id):
            return problem(404, "Not found")
        job = request.app.state.jobs.get(job_id)
        if job is None:
            return problem(404, "Not found", "The job finished more than 30 minutes ago or never existed.")

        async def stream():
            i = 0
            while True:
                while i < len(job.events):
                    yield job.events[i]
                    i += 1
                if job.status in ("done", "error"):
                    return
                if await request.is_disconnected():
                    return
                try:
                    await asyncio.wait_for(job.changed.wait(), timeout=15)
                except asyncio.TimeoutError:
                    pass

        return EventSourceResponse(stream(), ping=15, headers={"Cache-Control": "no-store"})

    @app.get("/api/manifest/{key}")
    @limiter.limit("120/minute")
    async def manifest(request: Request, key: str):
        if not HEX64.match(key):
            return problem(404, "Not found")
        data = request.app.state.cache.get("manifest", key)
        if data is None:
            return problem(404, "Not found")
        return Response(data, media_type="application/json",
                        headers={"Cache-Control": "public, max-age=31536000, immutable"})

    @app.get("/api/frame/{key}")
    @limiter.limit("600/minute")
    async def frame(request: Request, key: str):
        if not HEX64.match(key):
            return problem(404, "Not found")
        data = request.app.state.cache.get("frame", key)
        if data is None:
            return problem(404, "Not found")
        headers = {"Cache-Control": "public, max-age=31536000, immutable", "Vary": "Accept-Encoding"}
        if "br" in request.headers.get("accept-encoding", ""):
            headers["Content-Encoding"] = "br"
        else:
            data = brotli.decompress(data)
        return Response(data, media_type="application/octet-stream", headers=headers)

    @app.get("/api/lightcurve")
    @limiter.limit("30/minute")
    async def lightcurve(request: Request, key: Annotated[str, Query(pattern=r"^[0-9a-f]{64}$")],
                         detector: str | None = None):
        """Photometry from a finished blink job, by its manifest key."""
        data = request.app.state.cache.get("manifest", key)
        if data is None:
            return problem(404, "Not found", "Run the blink for this position first.")
        pts = json.loads(data)["photometry"]
        if detector:
            pts = [p for p in pts if p["detector"] == detector]
        return cached_json(pts, 86400)

    return app


app = create_app()
