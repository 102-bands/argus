"""Validation and security behaviour of the API without network (PRD §8.1, §11)."""
import pytest
from fastapi.testclient import TestClient

from argus.main import create_app
from argus.models import BlinkRequest
from argus.security import OutboundBlocked, check_outbound


@pytest.fixture(scope="module")
def client(tmp_path_factory, monkeypatch_module=None):
    import os

    os.environ["CACHE_DIR"] = str(tmp_path_factory.mktemp("cache"))
    from argus.config import get_settings

    get_settings.cache_clear()
    with TestClient(create_app()) as c:
        yield c


def test_health_and_headers(client):
    r = client.get("/api/health")
    assert r.status_code == 200 and r.json()["status"] == "ok"
    assert r.headers["x-content-type-options"] == "nosniff"
    assert "server" not in r.headers


def test_targets(client):
    ids = [t["id"] for t in client.get("/api/targets").json()]
    assert ids == ["barnard", "eps-indi-b", "wise-0855", "rw-aur", "r-dra"]


@pytest.mark.parametrize("body", [
    {"ra": 360, "dec": 0}, {"ra": 10, "dec": 91}, {"ra": 10, "dec": 0, "size_arcmin": 20},
    {"ra": 10, "dec": 0, "detectors": ["D7"]}, {"ra": 10, "dec": 0, "collections": ["evil"]},
])
def test_blink_validation(client, body):
    r = client.post("/api/blink", json=body)
    assert r.status_code == 422
    assert r.headers["content-type"].startswith("application/problem+json")


def test_bad_ids_404(client):
    assert client.get("/api/frame/../../etc").status_code == 404
    assert client.get("/api/frame/" + "g" * 64).status_code == 404
    assert client.get("/api/blink/not-a-uuid/events").status_code == 404


def test_body_limit(client):
    r = client.post("/api/blink", content=b"x" * 5000, headers={"content-type": "application/json"})
    assert r.status_code == 413


def test_sexagesimal_request():
    b = BlinkRequest(ra="08h55m10.831s", dec="-07d14m42.53s")
    assert b.ra == pytest.approx(133.79513, abs=1e-5)
    assert b.detector_set() == ["D1", "D2", "D3", "D4", "D5", "D6"]


@pytest.mark.parametrize("url", [
    "http://irsa.ipac.caltech.edu/x", "https://evil.com/x", "https://irsa.ipac.caltech.edu.evil.com/x",
    "https://user@irsa.ipac.caltech.edu/x", "s3://other-bucket/k", "file:///etc/passwd",
])
def test_outbound_blocked(url):
    with pytest.raises(OutboundBlocked):
        check_outbound(url)


def test_outbound_allowed():
    check_outbound("https://irsa.ipac.caltech.edu/ibe/data/spherex/qr3/x.fits")
    check_outbound("s3://nasa-irsa-spherex/qr3/x.fits")
