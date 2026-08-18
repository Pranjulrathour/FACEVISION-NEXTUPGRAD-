"""End-to-end integration test: exercise the full HTTP pipeline —
create → retrieve → list → stats → compare → clear — against a real
database connection (whatever DATABASE_URL/CI's Postgres service provides),
not mocks.

This intentionally uses the real FastAPI app + TestClient rather than
calling services directly, so it also exercises routing, dependency
injection, CORS/rate-limit/auth wiring, and response-schema validation as
one path — the individual unit tests elsewhere cover isolated logic, this
one covers the pieces working together.
"""
import uuid

import pytest
from fastapi.testclient import TestClient

from app.main import app

# Using `with TestClient(app) as client:` (rather than a bare `TestClient(app)`)
# is required here: FastAPI/Starlette only runs the app's lifespan — and
# therefore init_db()'s table creation — inside that context manager. A bare
# TestClient never creates the tables, so any test touching the database
# would fail with "no such table" the moment it runs against a fresh DB.
@pytest.fixture(scope="module")
def client():
    with TestClient(app) as test_client:
        yield test_client


def _unique_id() -> str:
    return f"pipeline-test-{uuid.uuid4().hex[:12]}"


def _sample_payload(detection_id: str) -> dict:
    return {
        "id": detection_id,
        "mode": "upload",
        "faceCount": 1,
        "averageConfidence": 0.91,
        "imageName": "pipeline-test.jpg",
        "userSessionId": detection_id,
        "modelVersion": "yunet-2023mar",
        "faces": [
            {
                "box": {"x": 10, "y": 10, "width": 100, "height": 100},
                "confidence": 0.91,
                "landmarks": {
                    "rightEye": {"x": 30, "y": 30},
                    "leftEye": {"x": 70, "y": 30},
                    "nose": {"x": 50, "y": 50},
                    "rightMouth": {"x": 35, "y": 70},
                    "leftMouth": {"x": 65, "y": 70},
                },
            }
        ],
    }


@pytest.fixture()
def created_detection(client):
    detection_id = _unique_id()
    payload = _sample_payload(detection_id)
    response = client.post("/api/detections", json=payload)
    assert response.status_code == 200, response.text
    yield detection_id, payload
    # Best-effort cleanup even if a test assertion fails midway.
    client.delete(f"/api/detections/{detection_id}")


def test_full_detection_lifecycle(client, created_detection):
    detection_id, payload = created_detection

    get_response = client.get(f"/api/detections/{detection_id}")
    assert get_response.status_code == 200
    body = get_response.json()
    assert body["id"] == detection_id
    assert body["model_version"] == "yunet-2023mar"
    assert len(body["faces"]) == 1

    list_response = client.get(
        "/api/detections", params={"userSessionId": detection_id}
    )
    assert list_response.status_code == 200
    list_body = list_response.json()
    assert list_body["total"] == 1
    assert list_body["items"][0]["id"] == detection_id

    stats_response = client.get(
        "/api/stats", params={"userSessionId": detection_id}
    )
    assert stats_response.status_code == 200
    stats_body = stats_response.json()
    assert stats_body["totalDetections"] == 1
    assert stats_body["totalFacesDetected"] == 1

    delete_response = client.delete(f"/api/detections/{detection_id}")
    assert delete_response.status_code == 200

    missing_response = client.get(f"/api/detections/{detection_id}")
    assert missing_response.status_code == 404


def test_duplicate_detection_id_is_rejected(client, created_detection):
    detection_id, payload = created_detection

    duplicate_response = client.post("/api/detections", json=payload)
    assert duplicate_response.status_code == 400


def test_compare_endpoint_full_pipeline(client):
    face = _sample_payload(_unique_id())["faces"][0]
    response = client.post(
        "/api/compare",
        json={"faceA": face, "faceB": face, "threshold": 0.5},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["isMatch"] is True
    assert body["similarity"] == pytest.approx(1.0)


def test_history_clear_removes_session_data(client):
    detection_id = _unique_id()
    payload = _sample_payload(detection_id)
    create_response = client.post("/api/detections", json=payload)
    assert create_response.status_code == 200

    clear_response = client.delete(
        "/api/history", params={"userSessionId": detection_id}
    )
    assert clear_response.status_code == 200
    assert clear_response.json()["deleted"] == 1

    missing_response = client.get(f"/api/detections/{detection_id}")
    assert missing_response.status_code == 404
