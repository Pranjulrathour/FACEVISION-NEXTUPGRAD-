from functools import lru_cache
from typing import List, Optional

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


def normalize_database_url(url: str) -> str:
    """Rewrite the legacy "postgres://" scheme to "postgresql://".

    Railway/Heroku-style managed Postgres plugins hand out URLs using the
    legacy scheme, which SQLAlchemy 1.4+/2.x rejects outright.
    """
    if url.startswith("postgres://"):
        return url.replace("postgres://", "postgresql://", 1)
    return url


class Settings(BaseSettings):
    """Single source of truth for backend configuration.

    Previously these were read via scattered os.getenv() calls across
    main.py, database.py, and core/*.py — easy to lose track of what's
    actually configurable. This class documents every deploy-time setting
    in one place. API_KEY and the per-route rate limits stay dynamically
    readable in core/security.py and core/rate_limit.py (tests rely on
    monkeypatching the environment per-call), but their defaults and
    meaning are documented here too.
    """

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg2://facevision:facevision@localhost:5432/facevision"
    host: str = "0.0.0.0"
    port: int = 8000
    reload: bool = False
    cors_origins_raw: str = Field(default="http://localhost:3000", validation_alias="CORS_ORIGINS")

    # Documented here for discoverability; read live via os.getenv() in
    # core/security.py and core/rate_limit.py so tests can monkeypatch them
    # per-call without needing a fresh Settings instance.
    api_key: Optional[str] = None
    detections_rate_limit_per_min: int = 30

    # Retention: None/0 means "no automatic purge" so existing deployments
    # don't suddenly start deleting data just by upgrading.
    retention_days: Optional[int] = None

    # JWT auth (§15, §16). Documented here; read live via os.getenv() in
    # core/auth.py for the same monkeypatch-testability reason as API_KEY.
    # Unset in production is a real misconfiguration (see core/auth.py's
    # runtime warning), but auto-generating an ephemeral secret keeps local
    # dev working without a setup step -- tokens just won't survive a
    # backend restart, which is an acceptable dev-only tradeoff.
    jwt_secret: Optional[str] = None
    jwt_expire_minutes: int = 60 * 24 * 7  # 7 days

    @property
    def cors_origins(self) -> List[str]:
        return [origin.strip() for origin in self.cors_origins_raw.split(",") if origin.strip()]

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.database_url = normalize_database_url(self.database_url)


@lru_cache
def get_settings() -> Settings:
    return Settings()
