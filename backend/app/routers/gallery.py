from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import Optional

from app.core.auth import get_current_user_optional, resolve_scope_id
from app.core.rate_limit import rate_limiter
from app.core.security import require_api_key
from app.database import get_db
from app.models.user import User
from app.schemas.gallery import (
    EnrollRequest,
    GalleryEntryResponse,
    GalleryListResponse,
    RecognizeRequest,
    RecognizeResponse,
)
from app.services import gallery_service

router = APIRouter()
_enroll_rate_limit = rate_limiter("GALLERY_ENROLL_RATE_LIMIT_PER_MIN", default=15)
_recognize_rate_limit = rate_limiter("GALLERY_RECOGNIZE_RATE_LIMIT_PER_MIN", default=30)


def _to_response(entry) -> GalleryEntryResponse:
    return GalleryEntryResponse(
        id=entry.id,
        name=entry.name,
        sampleCount=len(entry.samples),
        createdAt=entry.created_at,
        updatedAt=entry.updated_at,
    )


@router.post(
    "/enroll",
    response_model=GalleryEntryResponse,
    dependencies=[Depends(require_api_key), Depends(_enroll_rate_limit)],
)
def enroll(
    payload: EnrollRequest,
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_optional),
):
    scope_id = resolve_scope_id(payload.userSessionId, current_user)
    entry = gallery_service.enroll_face(
        db,
        name=payload.name,
        embedding=payload.embedding,
        model_version=payload.modelVersion,
        user_session_id=scope_id,
    )
    return _to_response(entry)


@router.get("", response_model=GalleryListResponse)
def list_entries(
    userSessionId: Optional[str] = Query(None, alias="userSessionId"),
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_optional),
):
    scope_id = resolve_scope_id(userSessionId, current_user)
    items, total = gallery_service.list_gallery(db, user_session_id=scope_id)
    return GalleryListResponse(items=[_to_response(e) for e in items], total=total)


@router.delete("/{entry_id}", dependencies=[Depends(require_api_key)])
def delete_entry(
    entry_id: int,
    userSessionId: Optional[str] = Query(None, alias="userSessionId"),
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_optional),
):
    scope_id = resolve_scope_id(userSessionId, current_user)
    deleted = gallery_service.delete_gallery_entry(db, entry_id, user_session_id=scope_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Gallery entry not found")
    return {"deleted": True, "id": entry_id}


@router.post(
    "/recognize",
    response_model=RecognizeResponse,
    dependencies=[Depends(_recognize_rate_limit)],
)
def recognize(
    payload: RecognizeRequest,
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_optional),
):
    scope_id = resolve_scope_id(payload.userSessionId, current_user)
    result = gallery_service.recognize_face(
        db,
        embedding=payload.embedding,
        user_session_id=scope_id,
        threshold=payload.threshold,
    )
    return RecognizeResponse(
        matched=result.matched,
        name=result.name,
        similarity=result.similarity,
        galleryEntryId=result.gallery_entry_id,
        threshold=payload.threshold,
    )
