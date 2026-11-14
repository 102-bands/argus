"""Settings from environment variables only (PRD §11.1, §13)."""
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

# Collections a client may ask for. Anything else is rejected, never passed through (PRD §8.1).
ALLOWED_COLLECTIONS = frozenset(
    {"spherex_dr1", "spherex_qr3", "spherex_dr1_deep", "spherex_qr3_deep"}
)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    collections: str = "spherex_dr1,spherex_qr3"
    pixel_source: Literal["s3", "cutout"] = "s3"
    s3_prefetch: bool = True  # 3 parallel rounds per exposure; false = astropy reads on demand
    pipeline_version: int = 2
    cache_dir: Path = Path("./data")
    cache_max_gb: float = 4.0
    ram_cache_mb: int = 64
    max_concurrent_fetch: int = 24  # requests mostly wait on latency, not bandwidth
    max_running_jobs: int = 2
    max_queued_jobs: int = 20
    max_exposures_per_job: int = 120
    job_timeout_s: int = 600  # no progress for this long ends a job; slow but moving jobs continue
    job_max_s: int = 3600
    abandon_grace_s: int = 30  # cancel a job this long after its last viewer leaves
    rss_limit_mb: int = 1500
    allowed_origins: str = "http://localhost:5173"
    admin_token: str = ""  # unlocks /admin (contact messages); empty = admin disabled
    web_dir: Path | None = None  # built frontend (web/dist); set in the Docker image, unset in dev

    @property
    def collection_list(self) -> list[str]:
        return sorted(c.strip() for c in self.collections.split(",") if c.strip())

    @property
    def origin_list(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
