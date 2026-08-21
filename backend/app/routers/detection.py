from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import Optional

from app.core.rate_limit import rate_limiter
from app.database import get_db
from app.schemas.detection import DetectionCreate, DetectionResponse, DetectionListResponse
from app.services import detection_service

router = APIRouter()
_write_rate_limit = rate_limiter("DETECTIONS_RATE_LIMIT_PER_MIN", default=30)


def _to_response(record) -> DetectionResponse:
    from app.schemas.detection import FaceResponse, FaceBox

    faces = []
    for f in record.faces:
        faces.append(
            FaceResponse(
                id=f.id,
                box=FaceBox(
                    x=f.box_x or 0,
                    y=f.box_y or 0,
                    width=f.box_width or 0,
                    height=f.box_height or 0,
                ),
                confidence=f.confidence or 0,
                landmarks=f.landmarks or {},
            )
        )
    return DetectionResponse(
        id=record.id,
        timestamp=record.timestamp or 0,
        mode=record.mode or "upload",
        face_count=record.face_count or 0,
        average_confidence=record.average_confidence or 0,
        image_name=record.image_name,
        model_version=record.model_version,
        faces=faces,
    )


@router.post(
    "",
    response_model=DetectionResponse,
    dependencies=[Depends(_write_rate_limit)],
)
def create(payload: DetectionCreate, db: Session = Depends(get_db)):
    existing = detection_service.get_detection(db, payload.id)
    if existing:
        raise HTTPException(status_code=400, detail="Detection with this ID already exists")
    record = detection_service.create_detection(db, payload)
    return _to_response(record)


@router.get("", response_model=DetectionListResponse)
def list_items(
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


@router.get("/{detection_id}", response_model=DetectionResponse)
def get_one(detection_id: str, db: Session = Depends(get_db)):
    record = detection_service.get_detection(db, detection_id)
    if not record:
        raise HTTPException(status_code=404, detail="Detection not found")
    return _to_response(record)


@router.delete("/{detection_id}")
def delete_one(detection_id: str, db: Session = Depends(get_db)):
    deleted = detection_service.delete_detection(db, detection_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Detection not found")
    return {"deleted": True, "id": detection_id}
