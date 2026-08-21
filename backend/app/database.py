import logging
import time

from sqlalchemy import create_engine, text
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import sessionmaker, declarative_base

from app.core.config import get_settings, normalize_database_url

logger = logging.getLogger("facevision")

DATABASE_URL = get_settings().database_url

engine = create_engine(DATABASE_URL, pool_pre_ping=True, echo=False)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# create_all() (below) only creates tables that don't exist yet -- it never
# alters a table that's already there. A deployment whose database was
# provisioned before one of these columns was added to its model (e.g. via
# create_all() on an earlier version, with the corresponding
# database/migrations/*.sql never run manually against that database) ends
# up with a live table silently missing a column the current code expects.
# Any query that loads a full ORM entity (not just a narrow SELECT) then
# fails with "column ... does not exist" -- a real incident this surfaced
# in production for detection_records.model_version (checklist §4 Phase 4
# load testing). These match database/migrations/002-004 exactly and are
# safe to run on every startup (IF NOT EXISTS / idempotent).
_IDEMPOTENT_COLUMN_MIGRATIONS = (
    "ALTER TABLE detection_records ADD COLUMN IF NOT EXISTS model_version VARCHAR(64)",
    "ALTER TABLE gallery_face_samples ADD COLUMN IF NOT EXISTS embedding JSONB",
    "ALTER TABLE gallery_face_samples ADD COLUMN IF NOT EXISTS model_version VARCHAR(64)",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255)",
    "ALTER TABLE face_gallery ADD COLUMN IF NOT EXISTS image_data TEXT",
)


def apply_idempotent_column_migrations() -> None:
    """Self-heals the exact class of drift described above. Each statement
    only runs if the target table already exists (a fresh create_all() will
    have already given new tables every current column, so this is a no-op
    for them) -- guarded per-statement so one missing table doesn't abort
    the rest."""
    with engine.begin() as connection:
        for statement in _IDEMPOTENT_COLUMN_MIGRATIONS:
            table_name = statement.split("ALTER TABLE ", 1)[1].split(" ", 1)[0]
            table_exists = connection.execute(
                text("SELECT to_regclass(:name)"), {"name": table_name}
            ).scalar()
            if table_exists:
                connection.execute(text(statement))


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db(max_attempts: int = 5, base_delay_seconds: float = 1.0) -> None:
    """Create tables, retrying with backoff if Postgres isn't accepting
    connections yet.

    A cold-started database (or one whose connection string just changed)
    can take a few seconds to become reachable. Without this retry, a
    single transient connection failure here raises during FastAPI's
    lifespan startup, which crashes the whole process — and under a
    restart-on-failure policy, that produces a crash-loop indistinguishable
    from the app being broken.
    """
    from app.models.detection import DetectionRecord, FaceRecord
    from app.models.gallery import FaceGalleryEntry, GalleryFaceSample
    from app.models.user import User

    for attempt in range(1, max_attempts + 1):
        try:
            Base.metadata.create_all(bind=engine)
            apply_idempotent_column_migrations()
            return
        except OperationalError:
            if attempt == max_attempts:
                raise
            delay = base_delay_seconds * (2 ** (attempt - 1))
            logger.warning(
                "Database not ready yet (attempt %d/%d), retrying in %.1fs",
                attempt,
                max_attempts,
                delay,
            )
            time.sleep(delay)
