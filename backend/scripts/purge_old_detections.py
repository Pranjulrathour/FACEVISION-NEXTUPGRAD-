"""Retention-policy enforcement: delete detection records older than
RETENTION_DAYS.

Run manually or on a schedule (Railway cron, a system cron job, etc.):

    python scripts/purge_old_detections.py

Does nothing if RETENTION_DAYS is unset — this is a deliberate opt-in so
existing deployments don't start silently deleting data just because this
script exists. Set RETENTION_DAYS in the environment to enable it.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.config import get_settings  # noqa: E402
from app.database import SessionLocal  # noqa: E402
from app.services.detection_service import purge_expired_detections  # noqa: E402


def main() -> None:
    settings = get_settings()
    if not settings.retention_days or settings.retention_days <= 0:
        print("RETENTION_DAYS is not set (or <= 0) — retention policy disabled, nothing to do.")
        return

    db = SessionLocal()
    try:
        deleted = purge_expired_detections(db, settings.retention_days)
        print(f"Purged {deleted} detection record(s) older than {settings.retention_days} day(s).")
    finally:
        db.close()


if __name__ == "__main__":
    main()
