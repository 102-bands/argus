"""SPHEREx coverage via IRSA SIA2 (PRD §5.1, §6.2 step 1)."""
import io
import json
import time
import warnings
from dataclasses import asdict, dataclass

import httpx
import numpy as np
from astropy.io.votable import parse_single_table

from .security import check_outbound

SIA_URL = "https://irsa.ipac.caltech.edu/SIA"
SIA_TTL_S = 24 * 3600


@dataclass(frozen=True)
class Exposure:
    obs_id: str
    detector: str  # "D1".."D6"
    t_min: float
    t_max: float
    em_min_um: float
    em_max_um: float
    access_url: str
    s3_url: str
    release_date: str
    collection: str

    @property
    def t_mid(self) -> float:
        return 0.5 * (self.t_min + self.t_max)


def _s3_url(cloud_access: str, access_url: str) -> str:
    try:
        aws = json.loads(cloud_access)["aws"]
        return f"s3://{aws['bucket_name']}/{aws['key']}"
    except (ValueError, KeyError, TypeError):
        return access_url.replace("https://irsa.ipac.caltech.edu/ibe/data/spherex/", "s3://nasa-irsa-spherex/")


def parse_votable(content: bytes) -> list[Exposure]:
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        table = parse_single_table(io.BytesIO(content)).to_table(use_names_over_ids=True)
    out = []
    for row in table:
        band = str(row["energy_bandpassname"])
        if not band.startswith("SPHEREx-D"):
            continue
        access_url = str(row["access_url"])
        s3 = _s3_url(str(row["cloud_access"]), access_url)
        check_outbound(access_url)
        check_outbound(s3)
        out.append(Exposure(
            obs_id=str(row["obs_id"]),
            detector=band.removeprefix("SPHEREx-"),
            t_min=float(row["t_min"]),
            t_max=float(row["t_max"]),
            em_min_um=float(row["em_min"]) * 1e6,
            em_max_um=float(row["em_max"]) * 1e6,
            access_url=access_url,
            s3_url=s3,
            release_date=str(row["obs_release_date"]),
            collection=str(row["obs_collection"]),
        ))
    out.sort(key=lambda e: (e.t_min, e.detector))
    return out


class CoverageService:
    def __init__(self, cache, client: httpx.AsyncClient):
        self.cache = cache
        self.client = client

    async def query(self, ra: float, dec: float, collections: list[str]) -> list[Exposure]:
        key = f"{'+'.join(sorted(collections))}_{ra:.3f}_{dec:.3f}".replace("-", "m")
        cached = self.cache.get("sia", key)
        if cached is not None:
            payload = json.loads(cached)
            if time.time() - payload["at"] < SIA_TTL_S:
                return [Exposure(**e) for e in payload["rows"]]
        params = [("POS", f"CIRCLE {ra:.6f} {dec:.6f} 0.001"), ("RESPONSEFORMAT", "VOTABLE")]
        params += [("COLLECTION", c) for c in collections]
        r = await self.client.get(SIA_URL, params=params, timeout=httpx.Timeout(120, connect=30))
        r.raise_for_status()
        rows = parse_votable(r.content)
        self.cache.put("sia", key, json.dumps({"at": time.time(), "rows": [asdict(e) for e in rows]}).encode())
        return rows


def latest_release(rows: list[Exposure]) -> str:
    return max((e.release_date for e in rows), default="")


def sample_evenly(rows: list[Exposure], epoch_ids: list[int], cap: int) -> tuple[list[Exposure], list[int]]:
    """Keep at most cap exposures, sampled evenly within each epoch (PRD §8.2)."""
    if len(rows) <= cap:
        return rows, epoch_ids
    n_ep = max(epoch_ids) + 1
    per = max(cap // n_ep, 1)
    keep_r, keep_e = [], []
    for ep in range(n_ep):
        idx = [i for i, e in enumerate(epoch_ids) if e == ep]
        if len(idx) > per:
            idx = [idx[int(j)] for j in np.linspace(0, len(idx) - 1, per)]
        keep_r += [rows[i] for i in idx]
        keep_e += [ep] * len(idx)
    return keep_r, keep_e
