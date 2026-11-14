"""Serve the built frontend from the API process, so Railway runs one service (PRD §11.3 headers).

Static files come from WEB_DIR (web/dist in the image). Unknown paths without a file extension get
index.html (client-side routes like /t/barnard); missing assets get a 404. A pre-gzipped `<file>.gz`
next to a file is sent when the browser accepts gzip.
"""
import mimetypes
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse, Response

mimetypes.add_type("application/wasm", ".wasm")
mimetypes.add_type("application/octet-stream", ".bin")


def _cache_control(rel: str) -> str:
    if rel.startswith("assets/") or (rel.startswith("presets/") and "/frames/" in rel):
        return "public, max-age=31536000, immutable"  # content-hashed or content-keyed names
    if rel.endswith(".html") or not rel:
        return "no-cache"
    return "public, max-age=3600"


def mount_web(app: FastAPI, root: Path) -> None:
    root = root.resolve()
    index = root / "index.html"

    @app.api_route("/{path:path}", methods=["GET", "HEAD"], include_in_schema=False)
    async def site(path: str, request: Request) -> Response:
        if path == "api" or path.startswith("api/"):
            return JSONResponse({"type": "about:blank", "title": "Not found", "status": 404}, status_code=404,
                                media_type="application/problem+json")
        f = (root / path).resolve()
        rel = path
        if not f.is_relative_to(root) or not f.is_file():
            if "." in path.rsplit("/", 1)[-1]:
                return Response("Not found", status_code=404, media_type="text/plain")
            f, rel = index, "index.html"
        headers = {"Cache-Control": _cache_control(rel), "Vary": "Accept-Encoding"}
        media = mimetypes.guess_type(f.name)[0] or "application/octet-stream"
        gz = f.with_name(f.name + ".gz")
        if "gzip" in request.headers.get("accept-encoding", "") and gz.is_file():
            return FileResponse(gz, media_type=media, headers={**headers, "Content-Encoding": "gzip"})
        return FileResponse(f, media_type=media, headers=headers)
