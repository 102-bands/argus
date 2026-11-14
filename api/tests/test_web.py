"""The built site served by the API process (single Railway service): routes, gzip, caching, CSP."""
import gzip
import os

import pytest
from fastapi.testclient import TestClient

from argus.config import get_settings
from argus.main import create_app


@pytest.fixture(scope="module")
def client(tmp_path_factory):
    web = tmp_path_factory.mktemp("dist")
    (web / "index.html").write_text("<!doctype html><title>Argus</title>")
    (web / "assets").mkdir()
    js = b"console.log('argus');" * 200
    (web / "assets" / "index-abc.js").write_bytes(js)
    (web / "assets" / "index-abc.js.gz").write_bytes(gzip.compress(js))
    old = {k: os.environ.get(k) for k in ("CACHE_DIR", "WEB_DIR")}
    os.environ["CACHE_DIR"] = str(tmp_path_factory.mktemp("cache"))
    os.environ["WEB_DIR"] = str(web)
    get_settings.cache_clear()
    with TestClient(create_app()) as c:
        yield c
    for k, v in old.items():
        os.environ.pop(k, None) if v is None else os.environ.__setitem__(k, v)
    get_settings.cache_clear()


def test_index_and_client_routes(client):
    for path in ("/", "/t/barnard", "/about"):
        r = client.get(path)
        assert r.status_code == 200 and "<title>Argus</title>" in r.text
        assert r.headers["cache-control"] == "no-cache"
        assert "default-src 'self'" in r.headers["content-security-policy"]
        assert r.headers["content-security-policy"].endswith("frame-ancestors 'none'")


def test_assets_gzip_and_immutable(client):
    r = client.get("/assets/index-abc.js", headers={"Accept-Encoding": "gzip"})
    assert r.status_code == 200 and r.headers["content-encoding"] == "gzip"
    assert "immutable" in r.headers["cache-control"]
    assert r.text.startswith("console.log")  # client decodes


def test_missing_asset_404_and_traversal(client):
    assert client.get("/assets/missing.js").status_code == 404
    assert client.get("/..%2F..%2Fpyproject.toml").status_code in (404, 200)
    assert "pyproject" not in client.get("/..%2F..%2Fpyproject.toml").text


def test_api_keeps_strict_csp_and_json_404(client):
    r = client.get("/api/health")
    assert r.status_code == 200 and r.headers["content-security-policy"] == "frame-ancestors 'none'; default-src 'none'"
    r = client.get("/api/does-not-exist")
    assert r.status_code == 404 and r.headers["content-type"].startswith("application/problem+json")


def test_embed_may_be_framed(client):
    r = client.get("/embed/t/barnard")
    assert r.status_code == 200 and r.headers["content-security-policy"].endswith("frame-ancestors *")
