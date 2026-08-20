from dataclasses import dataclass
from typing import List, Optional

from sqlalchemy.orm import Session, joinedload

from app.models.gallery import FaceGalleryEntry, GalleryFaceSample
from app.services.embedding_math import cosine_similarity


def enroll_face(
    db: Session,
    name: str,
    embedding: List[float],
    model_version: Optional[str],
    user_session_id: Optional[str],
) -> FaceGalleryEntry:
    """Enroll one embedding sample under `name`. Reuses an existing entry
    with the same name+session if one exists (so enrolling a second photo
    of the same person adds a sample rather than creating a duplicate
    identity), otherwise creates a new gallery entry."""
    entry = (
        db.query(FaceGalleryEntry)
        .filter(
            FaceGalleryEntry.name == name,
            FaceGalleryEntry.user_session_id == user_session_id,
        )
        .first()
    )
    if entry is None:
        entry = FaceGalleryEntry(name=name, user_session_id=user_session_id)
        db.add(entry)
        db.flush()

    sample = GalleryFaceSample(
        gallery_id=entry.id,
        embedding=embedding,
        model_version=model_version,
    )
    db.add(sample)
    db.commit()
    db.refresh(entry)
    return entry


def list_gallery(db: Session, user_session_id: Optional[str] = None) -> tuple[List[FaceGalleryEntry], int]:
    query = db.query(FaceGalleryEntry).options(joinedload(FaceGalleryEntry.samples))
    if user_session_id is not None:
        query = query.filter(FaceGalleryEntry.user_session_id == user_session_id)
    items = query.order_by(FaceGalleryEntry.created_at.desc()).all()
    return items, len(items)


def get_gallery_entry(db: Session, entry_id: int) -> Optional[FaceGalleryEntry]:
    return db.query(FaceGalleryEntry).filter(FaceGalleryEntry.id == entry_id).first()


def delete_gallery_entry(db: Session, entry_id: int, user_session_id: Optional[str] = None) -> bool:
    query = db.query(FaceGalleryEntry).filter(FaceGalleryEntry.id == entry_id)
    if user_session_id is not None:
        query = query.filter(FaceGalleryEntry.user_session_id == user_session_id)
    entry = query.first()
    if not entry:
        return False
    db.delete(entry)
    db.commit()
    return True


def delete_all_entries_for_scope(db: Session, user_session_id: str) -> int:
    """Bulk delete every gallery entry scoped to `user_session_id` (used
    for account deletion -- checklist §15/§16 "right to be forgotten" for
    an authenticated user's enrolled identities). A bulk query.delete()
    skips the ORM-level cascade on FaceGalleryEntry.samples, but the
    gallery_face_samples.gallery_id FK already has ondelete="CASCADE" at
    the database level, so samples are still removed."""
    deleted = (
        db.query(FaceGalleryEntry)
        .filter(FaceGalleryEntry.user_session_id == user_session_id)
        .delete(synchronize_session=False)
    )
    db.commit()
    return deleted


@dataclass
class RecognitionResult:
    matched: bool
    name: Optional[str]
    similarity: float
    gallery_entry_id: Optional[int]


def recognize_face(
    db: Session,
    embedding: List[float],
    user_session_id: Optional[str],
    threshold: float,
) -> RecognitionResult:
    """Compare `embedding` against every enrolled sample (scoped to
    user_session_id when given) and return the best match.

    A linear scan over all samples, not a nearest-neighbor index (pgvector,
    FAISS, etc.) — deliberately simple for a personal-scale gallery where
    "few enrolled identities" is the expected case; revisit if the gallery
    ever needs to scale to a large number of enrolled people."""
    query = db.query(GalleryFaceSample).join(FaceGalleryEntry)
    if user_session_id is not None:
        query = query.filter(FaceGalleryEntry.user_session_id == user_session_id)
    samples = query.options(joinedload(GalleryFaceSample.gallery_entry)).all()

    best_sample: Optional[GalleryFaceSample] = None
    best_score = -1.0
    for sample in samples:
        score = cosine_similarity(embedding, sample.embedding)
        if score > best_score:
            best_score = score
            best_sample = sample

    if best_sample is not None and best_score >= threshold:
        return RecognitionResult(
            matched=True,
            name=best_sample.gallery_entry.name,
            similarity=best_score,
            gallery_entry_id=best_sample.gallery_id,
        )
    return RecognitionResult(
        matched=False,
        name=None,
        similarity=max(best_score, 0.0),
        gallery_entry_id=None,
    )
