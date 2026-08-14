from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from typing import Optional

from app.database import get_db
from app.services import detection_service
from app.routers.detection import _to_response
from app.schemas.detection import DetectionListResponse

router = APIRouter()


@router.get("", response_model=DetectionListResponse)
def get_history(
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    mode: Optional[str] = None,
    userSessionId: Optional[str] = Query(None, alias="userSessionId"),
    db: Session = Depends(get_db),
):
    items, total = detection_service.list_detections(
        db, limit=limit, offset=offset, mode=mode, user_session_id=userSessionId
    )
    return DetectionListResponse(
        items=[_to_response(r) for r in items],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.delete("")
def clear_history(
    userSessionId: Optional[str] = Query(None, alias="userSessionId"),
    db: Session = Depends(get_db),
):
    count = detection_service.clear_all(db, user_session_id=userSessionId)
    return {"deleted": count}
