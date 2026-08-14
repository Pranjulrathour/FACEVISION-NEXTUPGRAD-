from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime

from app.models.detection import DetectionRecord, FaceRecord
from app.schemas.detection import DetectionCreate


def create_detection(db: Session, payload: DetectionCreate) -> DetectionRecord:
    record = DetectionRecord(
        id=payload.id,
        mode=payload.mode,
        face_count=payload.faceCount,
        average_confidence=payload.averageConfidence,
        image_name=payload.imageName,
        user_session_id=payload.userSessionId,
    )
    db.add(record)
    for face in payload.faces:
        fr = FaceRecord(
            detection_id=payload.id,
            confidence=face.confidence,
            box_x=face.box.x,
            box_y=face.box.y,
            box_width=face.box.width,
            box_height=face.box.height,
            landmarks={
                "rightEye": {"x": face.landmarks.rightEye.x, "y": face.landmarks.rightEye.y},
                "leftEye": {"x": face.landmarks.leftEye.x, "y": face.landmarks.leftEye.y},
                "nose": {"x": face.landmarks.nose.x, "y": face.landmarks.nose.y},
                "rightMouth": {"x": face.landmarks.rightMouth.x, "y": face.landmarks.rightMouth.y},
                "leftMouth": {"x": face.landmarks.leftMouth.x, "y": face.landmarks.leftMouth.y},
            },
        )
        db.add(fr)
    db.commit()
    db.refresh(record)
    return record


def get_detection(db: Session, detection_id: str) -> Optional[DetectionRecord]:
    return db.query(DetectionRecord).filter(DetectionRecord.id == detection_id).first()


def list_detections(
    db: Session,
    limit: int = 50,
    offset: int = 0,
    mode: Optional[str] = None,
    user_session_id: Optional[str] = None,
) -> tuple[List[DetectionRecord], int]:
    query = db.query(DetectionRecord)
    if mode:
        query = query.filter(DetectionRecord.mode == mode)
    if user_session_id:
        query = query.filter(DetectionRecord.user_session_id == user_session_id)
    total = query.count()
    items = (
        query.order_by(DetectionRecord.timestamp.desc())
        .limit(limit)
        .offset(offset)
        .all()
    )
    return items, total


def delete_detection(db: Session, detection_id: str) -> bool:
    record = get_detection(db, detection_id)
    if not record:
        return False
    db.delete(record)
    db.commit()
    return True


def clear_all(db: Session, user_session_id: Optional[str] = None) -> int:
    query = db.query(DetectionRecord)
    if user_session_id:
        query = query.filter(DetectionRecord.user_session_id == user_session_id)
    count = query.count()
    query.delete(synchronize_session=False)
    db.commit()
    return count
