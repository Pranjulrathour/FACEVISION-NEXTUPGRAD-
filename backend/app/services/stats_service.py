from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import Optional
from datetime import datetime, timedelta
from collections import defaultdict

from app.models.detection import DetectionRecord, FaceRecord


def get_summary(db: Session, user_session_id: Optional[str] = None) -> dict:
    query = db.query(DetectionRecord)
    if user_session_id:
        query = query.filter(DetectionRecord.user_session_id == user_session_id)

    total_detections = query.count()
    total_faces = query.with_entities(func.sum(DetectionRecord.face_count)).scalar() or 0

    avg_conf_query = db.query(func.avg(FaceRecord.confidence)).join(
        DetectionRecord, DetectionRecord.id == FaceRecord.detection_id
    )
    if user_session_id:
        avg_conf_query = avg_conf_query.filter(
            DetectionRecord.user_session_id == user_session_id
        )
    avg_conf = avg_conf_query.scalar() or 0.0

    mode_query = db.query(DetectionRecord.mode, func.count(DetectionRecord.id))
    if user_session_id is not None:
        mode_query = mode_query.filter(
            DetectionRecord.user_session_id == user_session_id
        )
    mode_counts = mode_query.group_by(DetectionRecord.mode).all()
    top_mode = "-"
    if mode_counts:
        top_mode = max(mode_counts, key=lambda x: x[1])[0]

    week_ago = datetime.utcnow() - timedelta(days=7)
    recent_query = db.query(DetectionRecord).filter(
        DetectionRecord.created_at >= week_ago
    )
    if user_session_id is not None:
        recent_query = recent_query.filter(
            DetectionRecord.user_session_id == user_session_id
        )
    recent = recent_query.all()
    by_day = defaultdict(int)
    for r in recent:
        d = r.created_at.strftime("%Y-%m-%d") if r.created_at else "-"
        by_day[d] += r.face_count or 0

    history = [
        {"day": day, "count": count} for day, count in sorted(by_day.items())
    ]

    return {
        "totalDetections": total_detections,
        "totalFacesDetected": total_faces,
        "avgConfidence": float(avg_conf),
        "topMode": top_mode,
        "detectionHistory": history,
    }
