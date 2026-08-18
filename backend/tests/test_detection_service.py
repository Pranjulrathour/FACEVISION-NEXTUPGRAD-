from datetime import datetime, timedelta

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models.detection import DetectionRecord, FaceRecord
from app.services import detection_service
from app.schemas.detection import DetectionCreate, FaceCreate, FaceBox, FaceLandmarks, Point


@pytest.fixture()
def db():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    try:
        yield session
    finally:
        session.close()


def _sample_payload(detection_id="det-1", model_version="yunet-2023mar"):
    landmarks = FaceLandmarks(
        rightEye=Point(x=30, y=30),
        leftEye=Point(x=70, y=30),
        nose=Point(x=50, y=50),
        rightMouth=Point(x=35, y=70),
        leftMouth=Point(x=65, y=70),
    )
    return DetectionCreate(
        id=detection_id,
        mode="upload",
        faceCount=1,
        averageConfidence=0.9,
        faces=[FaceCreate(box=FaceBox(x=0, y=0, width=100, height=100), confidence=0.9, landmarks=landmarks)],
        imageName="test.jpg",
        userSessionId="session-1",
        modelVersion=model_version,
    )


def test_create_detection_persists_model_version(db):
    record = detection_service.create_detection(db, _sample_payload())
    assert record.model_version == "yunet-2023mar"
    assert len(record.faces) == 1


def test_create_detection_without_model_version_defaults_to_none(db):
    payload = _sample_payload(model_version=None)
    record = detection_service.create_detection(db, payload)
    assert record.model_version is None


def test_get_detection_roundtrip(db):
    detection_service.create_detection(db, _sample_payload("det-2"))
    fetched = detection_service.get_detection(db, "det-2")
    assert fetched is not None
    assert fetched.id == "det-2"


def test_list_detections_filters_by_mode(db):
    detection_service.create_detection(db, _sample_payload("det-3"))
    items, total = detection_service.list_detections(db, mode="upload")
    assert total == 1
    items, total = detection_service.list_detections(db, mode="camera")
    assert total == 0


def test_delete_detection_removes_faces_via_cascade(db):
    detection_service.create_detection(db, _sample_payload("det-4"))
    assert detection_service.delete_detection(db, "det-4") is True
    assert detection_service.get_detection(db, "det-4") is None
    assert detection_service.delete_detection(db, "det-4") is False


def test_clear_all_scoped_to_session(db):
    detection_service.create_detection(db, _sample_payload("det-5"))
    deleted = detection_service.clear_all(db, user_session_id="other-session")
    assert deleted == 0
    deleted = detection_service.clear_all(db, user_session_id="session-1")
    assert deleted == 1


def test_purge_expired_detections_only_removes_old_rows(db):
    detection_service.create_detection(db, _sample_payload("det-old"))
    detection_service.create_detection(db, _sample_payload("det-new"))

    old_record = detection_service.get_detection(db, "det-old")
    old_record.created_at = datetime.utcnow() - timedelta(days=100)
    db.commit()

    deleted = detection_service.purge_expired_detections(db, retention_days=90)

    assert deleted == 1
    assert detection_service.get_detection(db, "det-old") is None
    assert detection_service.get_detection(db, "det-new") is not None


def test_purge_expired_detections_disabled_when_non_positive(db):
    detection_service.create_detection(db, _sample_payload("det-old"))
    old_record = detection_service.get_detection(db, "det-old")
    old_record.created_at = datetime.utcnow() - timedelta(days=1000)
    db.commit()

    assert detection_service.purge_expired_detections(db, retention_days=0) == 0
    assert detection_service.purge_expired_detections(db, retention_days=-5) == 0
    assert detection_service.get_detection(db, "det-old") is not None
