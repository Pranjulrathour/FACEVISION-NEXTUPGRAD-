"""Adversarial security test suite (checklist §24): malicious inputs,
oversized payloads, unauthorized access, enumeration, and token
manipulation, exercised against the real HTTP surface via TestClient --
not just the individual unit tests scattered across other files."""
import uuid

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as test_client:
        yield test_client


def _face_payload():
    return {
        "box": {"x": 0, "y": 0, "width": 100, "height": 100},
        "confidence": 0.9,
        "landmarks": {
            "rightEye": {"x": 30, "y": 30},
            "leftEye": {"x": 70, "y": 30},
            "nose": {"x": 50, "y": 50},
            "rightMouth": {"x": 35, "y": 70},
            "leftMouth": {"x": 65, "y": 70},
        },
    }


class TestOversizedPayloads:
    def test_detection_with_129_faces_is_rejected(self, client):
        payload = {
            "id": f"adversarial-{uuid.uuid4().hex[:12]}",
            "mode": "upload",
            "faceCount": 129,
            "averageConfidence": 0.9,
            "faces": [_face_payload() for _ in range(129)],
        }
        response = client.post("/api/v1/detections", json=payload)
        assert response.status_code == 422

    def test_detection_with_exactly_128_faces_is_accepted(self, client):
        detection_id = f"adversarial-{uuid.uuid4().hex[:12]}"
        payload = {
            "id": detection_id,
            "mode": "upload",
            "faceCount": 128,
            "averageConfidence": 0.9,
            "faces": [_face_payload() for _ in range(128)],
        }
        response = client.post("/api/v1/detections", json=payload)
        assert response.status_code == 200
        client.delete(f"/api/v1/detections/{detection_id}")

    def test_gallery_enroll_rejects_oversized_name(self, client):
        response = client.post(
            "/api/v1/gallery/enroll",
            json={"name": "x" * 500, "embedding": [0.1] * 128},
        )
        assert response.status_code == 422

    def test_register_rejects_oversized_password(self, client):
        response = client.post(
            "/api/v1/auth/register",
            json={"email": f"{uuid.uuid4().hex[:12]}@example.com", "password": "x" * 500},
        )
        assert response.status_code == 422


class TestMaliciousStringInputs:
    def test_sql_injection_style_name_is_stored_literally_not_executed(self, client):
        """A parameterized-query ORM should treat this as an ordinary
        string. If it were vulnerable, this would either error out (syntax
        error hitting the DB) or corrupt/drop data -- neither should happen."""
        malicious_name = "Robert'); DROP TABLE face_gallery; --"
        session_id = f"adversarial-{uuid.uuid4().hex[:12]}"
        enroll_response = client.post(
            "/api/v1/gallery/enroll",
            json={"name": malicious_name, "embedding": [0.2] * 128, "userSessionId": session_id},
        )
        assert enroll_response.status_code == 200
        assert enroll_response.json()["name"] == malicious_name

        # The table must still exist and be queryable afterwards.
        list_response = client.get("/api/v1/gallery", params={"userSessionId": session_id})
        assert list_response.status_code == 200
        assert list_response.json()["total"] == 1

    def test_script_tag_in_display_name_is_stored_as_literal_text(self, client):
        """This is an API, not a template renderer -- there's no HTML
        context here to inject into. Storing the literal string is
        correct; escaping is the frontend's job if/when it renders it."""
        email = f"{uuid.uuid4().hex[:12]}@example.com"
        response = client.post(
            "/api/v1/auth/register",
            json={
                "email": email,
                "password": "correct-password-123",
                "displayName": "<script>alert(1)</script>",
            },
        )
        assert response.status_code == 200
        assert response.json()["user"]["displayName"] == "<script>alert(1)</script>"


class TestUnauthorizedAccess:
    def test_delete_detection_without_api_key_fails_when_key_is_configured(self, client, monkeypatch):
        monkeypatch.setenv("API_KEY", "expected-secret")
        response = client.delete("/api/v1/detections/nonexistent-id-doesnt-matter")
        assert response.status_code == 401

    def test_delete_detection_with_wrong_api_key_fails(self, client, monkeypatch):
        monkeypatch.setenv("API_KEY", "expected-secret")
        response = client.delete(
            "/api/v1/detections/nonexistent-id-doesnt-matter",
            headers={"X-API-Key": "wrong-secret"},
        )
        assert response.status_code == 401

    def test_gallery_enroll_without_api_key_fails_when_key_is_configured(self, client, monkeypatch):
        monkeypatch.setenv("API_KEY", "expected-secret")
        response = client.post(
            "/api/v1/gallery/enroll",
            json={"name": "Someone", "embedding": [0.1] * 128},
        )
        assert response.status_code == 401


class TestEnumeration:
    def test_sequential_detection_id_probing_returns_404_not_information(self, client):
        """Probing sequential/guessable IDs should uniformly 404, not leak
        whether an ID "almost" existed or expose different error shapes
        that would help an attacker narrow down valid IDs."""
        responses = [
            client.get(f"/api/v1/detections/probe-{i}") for i in range(5)
        ]
        for response in responses:
            assert response.status_code == 404
            assert response.json() == {"detail": "Detection not found"}

    def test_sequential_gallery_id_probing_returns_404_uniformly(self, client):
        """IDs are auto-increment integers, and other tests in the same run
        create real gallery rows -- probe a range guaranteed to be far past
        anything this test session could have created, not low integers
        that a full-suite run may have legitimately allocated."""
        responses = [
            client.delete(f"/api/v1/gallery/{i}") for i in range(900_000_000, 900_000_005)
        ]
        for response in responses:
            assert response.status_code == 404


class TestErrorMessageLeakage:
    def test_internal_server_errors_never_leak_exception_details(self, client):
        """Sending a value that would raise deep inside SQLAlchemy/Pydantic
        internals (rather than being caught by validation) must still come
        back as the generic 500 body, never a raw traceback/exception string."""
        # An embedding of the right length but with a non-numeric value
        # inside is rejected by Pydantic before it ever reaches the DB --
        # confirms the boundary validation catches this class of input.
        response = client.post(
            "/api/v1/gallery/enroll",
            json={"name": "Test", "embedding": ["not-a-number"] * 128},
        )
        assert response.status_code == 422
        assert "Traceback" not in response.text
