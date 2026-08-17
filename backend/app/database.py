import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from dotenv import load_dotenv

load_dotenv()


def normalize_database_url(url: str) -> str:
    """Rewrite the legacy "postgres://" scheme to "postgresql://".

    Railway/Heroku-style managed Postgres plugins hand out URLs using the
    legacy scheme, which SQLAlchemy 1.4+/2.x rejects outright.
    """
    if url.startswith("postgres://"):
        return url.replace("postgres://", "postgresql://", 1)
    return url


DATABASE_URL = normalize_database_url(
    os.getenv(
        "DATABASE_URL",
        "postgresql+psycopg2://facevision:facevision@localhost:5432/facevision",
    )
)

engine = create_engine(DATABASE_URL, pool_pre_ping=True, echo=False)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    from app.models.detection import DetectionRecord, FaceRecord

    Base.metadata.create_all(bind=engine)
