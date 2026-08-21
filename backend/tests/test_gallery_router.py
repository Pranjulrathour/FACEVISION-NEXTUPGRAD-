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


def test_enroll_with_an_image_returns_it_and_persists_it_through_list(client):
    session_id = _session_id()
    tiny_image = "data:image/jpeg;base64,/9j/AAA="

    enroll_response = client.post(
        "/api/v1/gallery/enroll",
        json={"name": "Alice", "embedding": _embedding(1.0), "userSessionId": session_id, "image": tiny_image},
    )
    assert enroll_response.status_code == 200
    assert enroll_response.json()["image"] == tiny_image

    list_response = client.get("/api/v1/gallery", params={"userSessionId": session_id})
    assert list_response.json()["items"][0]["image"] == tiny_image


def test_enroll_without_an_image_returns_null(client):
    session_id = _session_id()
    response = client.post(
        "/api/v1/gallery/enroll",
        json={"name": "Alice", "embedding": _embedding(1.0), "userSessionId": session_id},
    )
    assert response.json()["image"] is None


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


def test_rename_entry_updates_the_name(client):
    session_id = _session_id()
    enroll_response = client.post(
        "/api/v1/gallery/enroll",
        json={"name": "Alice", "embedding": _embedding(1.0), "userSessionId": session_id},
    )
    entry_id = enroll_response.json()["id"]

    rename_response = client.patch(
        f"/api/v1/gallery/{entry_id}",
        json={"name": "Alicia", "userSessionId": session_id},
    )
    assert rename_response.status_code == 200
    assert rename_response.json()["name"] == "Alicia"

    list_response = client.get("/api/v1/gallery", params={"userSessionId": session_id})
    assert list_response.json()["items"][0]["name"] == "Alicia"


def test_rename_nonexistent_entry_returns_404(client):
    response = client.patch("/api/v1/gallery/999999999", json={"name": "Anyone"})
    assert response.status_code == 404


def test_rename_rejects_an_empty_name(client):
    session_id = _session_id()
    enroll_response = client.post(
        "/api/v1/gallery/enroll",
        json={"name": "Alice", "embedding": _embedding(1.0), "userSessionId": session_id},
    )
    entry_id = enroll_response.json()["id"]

    response = client.patch(
        f"/api/v1/gallery/{entry_id}",
        json={"name": "", "userSessionId": session_id},
    )
    assert response.status_code == 422


def test_gallery_routes_available_under_legacy_prefix_too(client):
    session_id = _session_id()
    response = client.get("/api/gallery", params={"userSessionId": session_id})
    assert response.status_code == 200
    assert response.headers.get("Deprecation") == "true"


def _register(client) -> tuple[str, str]:
    """Registers a fresh user and returns (auth_header_value, user_id)."""
    email = f"gallery-auth-{uuid.uuid4().hex[:12]}@example.com"
    response = client.post(
        "/api/v1/auth/register", json={"email": email, "password": "correct-password-123"}
    )
    body = response.json()
    return f"Bearer {body['accessToken']}", body["user"]["id"]


def test_authenticated_enroll_ignores_client_supplied_session_id(client):
    """Checklist §16/§24: an authenticated caller's data must be scoped to
    their real user id, not whatever userSessionId they happen to send --
    otherwise a logged-in user could plant their enrollment under someone
    else's guessed session id, or read/delete data by claiming to be a
    session they don't own."""
    auth_header, _ = _register(client)
    attacker_supplied_session = "victim-session-id-guessed"

    enroll_response = client.post(
        "/api/v1/gallery/enroll",
        json={"name": "Authenticated Alice", "embedding": _embedding(3.0), "userSessionId": attacker_supplied_session},
        headers={"Authorization": auth_header},
    )
    assert enroll_response.status_code == 200

    # The entry must NOT show up under the anonymous session id the client
    # tried to claim -- it was scoped to the real user id instead.
    anon_list = client.get("/api/v1/gallery", params={"userSessionId": attacker_supplied_session})
    assert anon_list.json()["total"] == 0

    # But it does show up when listing as that same authenticated user.
    auth_list = client.get("/api/v1/gallery", headers={"Authorization": auth_header})
    assert auth_list.json()["total"] >= 1
    assert any(e["name"] == "Authenticated Alice" for e in auth_list.json()["items"])


def test_two_authenticated_users_cannot_see_each_others_gallery(client):
    auth_a, _ = _register(client)
    auth_b, _ = _register(client)

    client.post(
        "/api/v1/gallery/enroll",
        json={"name": "User A's contact", "embedding": _embedding(4.0)},
        headers={"Authorization": auth_a},
    )

    list_as_b = client.get("/api/v1/gallery", headers={"Authorization": auth_b})
    assert list_as_b.json()["total"] == 0


def test_authenticated_user_cannot_delete_another_users_entry_by_guessing_id(client):
    auth_a, _ = _register(client)
    auth_b, _ = _register(client)

    enroll_response = client.post(
        "/api/v1/gallery/enroll",
        json={"name": "User A's contact", "embedding": _embedding(5.0)},
        headers={"Authorization": auth_a},
    )
    entry_id = enroll_response.json()["id"]

    delete_as_b = client.delete(f"/api/v1/gallery/{entry_id}", headers={"Authorization": auth_b})
    assert delete_as_b.status_code == 404

    # Still there when A checks.
    list_as_a = client.get("/api/v1/gallery", headers={"Authorization": auth_a})
    assert any(e["id"] == entry_id for e in list_as_a.json()["items"])


def test_authenticated_user_cannot_rename_another_users_entry_by_guessing_id(client):
    auth_a, _ = _register(client)
    auth_b, _ = _register(client)

    enroll_response = client.post(
        "/api/v1/gallery/enroll",
        json={"name": "User A's contact", "embedding": _embedding(6.0)},
        headers={"Authorization": auth_a},
    )
    entry_id = enroll_response.json()["id"]

    rename_as_b = client.patch(
        f"/api/v1/gallery/{entry_id}",
        json={"name": "Renamed by B"},
        headers={"Authorization": auth_b},
    )
    assert rename_as_b.status_code == 404

    list_as_a = client.get("/api/v1/gallery", headers={"Authorization": auth_a})
    assert any(e["id"] == entry_id and e["name"] == "User A's contact" for e in list_as_a.json()["items"])
