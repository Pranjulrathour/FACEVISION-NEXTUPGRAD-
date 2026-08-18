"""Verifies §14's versioned-routes requirement: /api/v1/... is canonical,
/api/... (unversioned) still works but is marked deprecated."""
import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as test_client:
        yield test_client


def test_v1_health_route_works(client):
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_legacy_health_route_still_works(client):
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_legacy_route_carries_deprecation_headers(client):
    response = client.get("/api/health")
    assert response.headers.get("Deprecation") == "true"
    assert "/api/v1/health" in response.headers.get("Link", "")


def test_v1_route_does_not_carry_deprecation_headers(client):
    response = client.get("/api/v1/health")
    assert "Deprecation" not in response.headers


def test_v1_and_legacy_detections_routes_share_the_same_data(client):
    payload = {
        "id": "versioning-test-1",
        "mode": "upload",
        "faceCount": 0,
        "averageConfidence": 0,
        "faces": [],
    }
    create_response = client.post("/api/v1/detections", json=payload)
    assert create_response.status_code == 200

    legacy_get = client.get("/api/detections/versioning-test-1")
    assert legacy_get.status_code == 200
    assert legacy_get.json()["id"] == "versioning-test-1"

    client.delete("/api/v1/detections/versioning-test-1")
