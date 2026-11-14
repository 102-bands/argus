"""Website endpoints: counters, contact form, admin messages."""
import os

import pytest
from fastapi.testclient import TestClient

from argus.config import get_settings
from argus.main import create_app
from argus.security import limiter
from argus.store import Store


@pytest.fixture()
def client(tmp_path):
    old = {k: os.environ.get(k) for k in ("CACHE_DIR", "ADMIN_TOKEN")}
    os.environ["CACHE_DIR"] = str(tmp_path)
    os.environ["ADMIN_TOKEN"] = "s3cret-token"
    get_settings.cache_clear()
    limiter._storage.reset()  # rate-limit counts are per process; start each test clean
    with TestClient(create_app()) as c:
        yield c
    for k, v in old.items():
        os.environ.pop(k, None) if v is None else os.environ.__setitem__(k, v)
    get_settings.cache_clear()


def test_counters_start_at_zero_and_only_whitelisted_events_count(client):
    s = client.get("/api/stats").json()
    assert s["fields_analysed"] == 0 and s["since"]
    assert client.post("/api/count", json={"event": "field"}).status_code == 204
    assert client.post("/api/count", json={"event": "visit"}).status_code == 204
    assert client.post("/api/count", json={"event": "live_searches"}).status_code == 422  # server-side only
    s = client.get("/api/stats").json()
    assert (s["fields_analysed"], s["visits"], s["live_searches"]) == (1, 1, 0)


def test_job_hook_counts_live_searches_and_exposures(client):
    hook = client.app.state.jobs.on_done
    hook(None, 120)
    s = client.get("/api/stats").json()
    assert s["live_searches"] == 1 and s["exposures_processed"] == 120


GOOD = {"name": "Ada", "email": "ada@example.org", "topic": "feedback", "message": "Lovely blink tool, thanks!"}


def test_contact_validation_honeypot_and_admin(client):
    # Rejected attempts count towards the 5/hour limit too (throttles spam), so this test stays under it.
    assert client.post("/api/contact", json={**GOOD, "email": "not-an-email"}).status_code == 422
    assert client.post("/api/contact", json={**GOOD, "message": "short"}).status_code == 422
    assert client.post("/api/contact", json={**GOOD, "website": "http://spam"}).json() == {"ok": True}
    assert client.post("/api/contact", json=GOOD).json() == {"ok": True}
    assert client.get("/api/admin/messages").status_code == 401
    assert client.get("/api/admin/messages", headers={"Authorization": "Bearer nope"}).status_code == 401
    msgs = client.get("/api/admin/messages", headers={"Authorization": "Bearer s3cret-token"}).json()["messages"]
    assert len(msgs) == 1 and msgs[0]["name"] == "Ada" and not msgs[0]["handled"]  # the honeypot one was dropped
    r = client.post(f"/api/admin/messages/{msgs[0]['id']}/handled", headers={"Authorization": "Bearer s3cret-token"})
    assert r.json() == {"ok": True}


def test_contact_rate_limited(client):
    codes = [client.post("/api/contact", json=GOOD).status_code for _ in range(7)]
    assert codes[:5] == [200] * 5 and 429 in codes[5:]


def test_admin_disabled_without_token(tmp_path):
    old = os.environ.get("ADMIN_TOKEN")
    os.environ["CACHE_DIR"] = str(tmp_path)
    os.environ["ADMIN_TOKEN"] = ""
    get_settings.cache_clear()
    with TestClient(create_app()) as c:
        assert c.get("/api/admin/messages", headers={"Authorization": "Bearer "}).status_code == 404
    os.environ["ADMIN_TOKEN"] = old or ""
    get_settings.cache_clear()


def test_store_persists(tmp_path):
    s = Store(tmp_path / "a.db")
    s.incr("downloads", 3)
    s.incr("bogus")
    s.close()
    assert Store(tmp_path / "a.db").stats()["downloads"] == 3
