from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, JSON, BigInteger
from sqlalchemy.orm import relationship
from datetime import datetime

from app.database import Base


class DetectionRecord(Base):
    __tablename__ = "detection_records"

    id = Column(String, primary_key=True, index=True)
    timestamp = Column(BigInteger, index=True, default=lambda: int(datetime.utcnow().timestamp() * 1000))
    created_at = Column(DateTime, default=datetime.utcnow)
    mode = Column(String, index=True)
    face_count = Column(Integer, default=0)
    average_confidence = Column(Float, default=0.0)
    image_name = Column(String, nullable=True)
    user_session_id = Column(String, index=True, nullable=True)

    faces = relationship(
        "FaceRecord",
        back_populates="detection",
        cascade="all, delete-orphan",
    )


class FaceRecord(Base):
    __tablename__ = "face_records"

    id = Column(Integer, primary_key=True, autoincrement=True)
    detection_id = Column(String, ForeignKey("detection_records.id", ondelete="CASCADE"), index=True)
    confidence = Column(Float)
    box_x = Column(Float)
    box_y = Column(Float)
    box_width = Column(Float)
    box_height = Column(Float)
    landmarks = Column(JSON)

    detection = relationship("DetectionRecord", back_populates="faces")
