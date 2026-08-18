import logging
import time

from sqlalchemy import create_engine
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import sessionmaker, declarative_base

from app.core.config import get_settings, normalize_database_url

logger = logging.getLogger("facevision")

DATABASE_URL = get_settings().database_url

engine = create_engine(DATABASE_URL, pool_pre_ping=True, echo=False)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


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

    for attempt in range(1, max_attempts + 1):
        try:
            Base.metadata.create_all(bind=engine)
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
