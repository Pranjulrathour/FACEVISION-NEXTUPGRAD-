from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, JSON
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship
from datetime import datetime

from app.database import Base


class FaceGalleryEntry(Base):
    """An enrolled identity (checklist §2 'Identity matching', §28
    'BiometricProfiles'). Named entries the app recognizes future
    detections against — this is what finally puts the previously-unused
    face_gallery table (see database/migrations/001_init_schema.sql) to
    work."""

    __tablename__ = "face_gallery"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(100), nullable=False)
    user_session_id = Column(String(128), index=True, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    samples = relationship(
        "GalleryFaceSample",
        back_populates="gallery_entry",
        cascade="all, delete-orphan",
    )


class GalleryFaceSample(Base):
    """One enrolled embedding for a gallery entry. A person can have
    multiple samples (different angles/lighting) enrolled under the same
    name; recognition matches against every sample and returns the best
    score.

    Stores the embedding vector only -- never a raw image. See
    docs/privacy-retention-policy.md for what this means for retention."""

    __tablename__ = "gallery_face_samples"

    id = Column(Integer, primary_key=True, autoincrement=True)
    gallery_id = Column(Integer, ForeignKey("face_gallery.id", ondelete="CASCADE"), index=True)
    embedding = Column(
        JSONB().with_variant(JSON, "sqlite"), nullable=False
    )  # list[float], SFace = 128-d
    model_version = Column(String(64), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    gallery_entry = relationship("FaceGalleryEntry", back_populates="samples")
