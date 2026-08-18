import uuid

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as test_client:
        yield test_client


def _embedding(seed: float) -> list:
    return [seed] * 128


def _session_id() -> str:
    return f"gallery-test-{uuid.uuid4().hex[:12]}"


def test_enroll_list_recognize_delete_full_lifecycle(client):
    session_id = _session_id()

    enroll_response = client.post(
        "/api/v1/gallery/enroll",
        json={"name": "Alice", "embedding": _embedding(1.0), "modelVersion": "sface-2021dec", "userSessionId": session_id},
    )
    assert enroll_response.status_code == 200
    entry = enroll_response.json()
    assert entry["name"] == "Alice"
    assert entry["sampleCount"] == 1
    entry_id = entry["id"]

    list_response = client.get("/api/v1/gallery", params={"userSessionId": session_id})
    assert list_response.status_code == 200
    assert list_response.json()["total"] == 1

    recognize_response = client.post(
        "/api/v1/gallery/recognize",
        json={"embedding": _embedding(1.0), "userSessionId": session_id},
    )
    assert recognize_response.status_code == 200
    body = recognize_response.json()
    assert body["matched"] is True
    assert body["name"] == "Alice"

    delete_response = client.delete(f"/api/v1/gallery/{entry_id}", params={"userSessionId": session_id})
    assert delete_response.status_code == 200

    list_after_delete = client.get("/api/v1/gallery", params={"userSessionId": session_id})
    assert list_after_delete.json()["total"] == 0


def test_recognize_with_no_enrollments_returns_no_match(client):
    session_id = _session_id()
    response = client.post(
        "/api/v1/gallery/recognize",
        json={"embedding": _embedding(1.0), "userSessionId": session_id},
    )
    assert response.status_code == 200
    assert response.json()["matched"] is False


def test_enroll_rejects_wrong_embedding_dimension(client):
    response = client.post(
        "/api/v1/gallery/enroll",
        json={"name": "Bob", "embedding": [1.0, 2.0, 3.0], "userSessionId": _session_id()},
    )
    assert response.status_code == 422


def test_delete_nonexistent_entry_returns_404(client):
    response = client.delete("/api/v1/gallery/999999999")
    assert response.status_code == 404


def test_gallery_routes_available_under_legacy_prefix_too(client):
    session_id = _session_id()
    response = client.get("/api/gallery", params={"userSessionId": session_id})
    assert response.status_code == 200
    assert response.headers.get("Deprecation") == "true"
