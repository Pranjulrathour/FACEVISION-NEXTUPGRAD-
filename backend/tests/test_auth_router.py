import uuid

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as test_client:
        yield test_client


def _email() -> str:
    return f"user-{uuid.uuid4().hex[:12]}@example.com"


def test_register_login_me_full_lifecycle(client):
    email = _email()
    register_response = client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": "correct-password-123", "displayName": "Test User"},
    )
    assert register_response.status_code == 200
    body = register_response.json()
    assert body["user"]["email"] == email
    token = body["accessToken"]

    me_response = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me_response.status_code == 200
    assert me_response.json()["email"] == email

    login_response = client.post(
        "/api/v1/auth/login", json={"email": email, "password": "correct-password-123"}
    )
    assert login_response.status_code == 200
    assert "accessToken" in login_response.json()


def test_register_duplicate_email_returns_409(client):
    email = _email()
    client.post("/api/v1/auth/register", json={"email": email, "password": "password-123"})
    duplicate = client.post("/api/v1/auth/register", json={"email": email, "password": "different-123"})
    assert duplicate.status_code == 409


def test_login_wrong_password_returns_401(client):
    email = _email()
    client.post("/api/v1/auth/register", json={"email": email, "password": "correct-password-123"})
    response = client.post("/api/v1/auth/login", json={"email": email, "password": "wrong-password"})
    assert response.status_code == 401


def test_login_nonexistent_user_returns_401_not_404(client):
    # Same status for "no such user" and "wrong password" -- avoids leaking
    # which emails are registered (checklist §24 enumeration).
    response = client.post("/api/v1/auth/login", json={"email": _email(), "password": "anything"})
    assert response.status_code == 401


def test_me_without_token_returns_401(client):
    response = client.get("/api/v1/auth/me")
    assert response.status_code == 401


def test_me_with_malformed_authorization_header_returns_401(client):
    response = client.get("/api/v1/auth/me", headers={"Authorization": "NotBearer sometoken"})
    assert response.status_code == 401


def test_me_with_tampered_token_returns_401(client):
    email = _email()
    register_response = client.post(
        "/api/v1/auth/register", json={"email": email, "password": "correct-password-123"}
    )
    token = register_response.json()["accessToken"]
    header, payload, signature = token.split(".")
    mid = len(signature) // 2
    swapped_char = "A" if signature[mid] != "A" else "B"
    tampered_signature = signature[:mid] + swapped_char + signature[mid + 1 :]
    tampered = f"{header}.{payload}.{tampered_signature}"
    response = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {tampered}"})
    assert response.status_code == 401


def test_register_rejects_short_password(client):
    response = client.post(
        "/api/v1/auth/register", json={"email": _email(), "password": "short"}
    )
    assert response.status_code == 422


def test_register_rejects_invalid_email(client):
    response = client.post(
        "/api/v1/auth/register", json={"email": "not-an-email", "password": "password-123"}
    )
    assert response.status_code == 422


def _register_and_login(client) -> tuple[str, str]:
    email = _email()
    response = client.post(
        "/api/v1/auth/register", json={"email": email, "password": "correct-password-123"}
    )
    body = response.json()
    return f"Bearer {body['accessToken']}", email


def _delete_me(client, auth_header: str | None, password: str):
    """TestClient.delete() doesn't accept a json body in this
    httpx/starlette version -- DELETE requests need a body here (the
    password confirmation), so go through .request() directly."""
    headers = {"Authorization": auth_header} if auth_header else {}
    return client.request("DELETE", "/api/v1/auth/me", json={"password": password}, headers=headers)


def test_delete_account_requires_authentication(client):
    response = _delete_me(client, None, "anything")
    assert response.status_code == 401


def test_delete_account_with_wrong_password_returns_401_and_keeps_the_account(client):
    auth_header, email = _register_and_login(client)

    response = _delete_me(client, auth_header, "wrong-password")
    assert response.status_code == 401

    # Account must still exist -- login should still work.
    login_response = client.post(
        "/api/v1/auth/login", json={"email": email, "password": "correct-password-123"}
    )
    assert login_response.status_code == 200


def test_delete_account_with_correct_password_deletes_it(client):
    auth_header, email = _register_and_login(client)

    response = _delete_me(client, auth_header, "correct-password-123")
    assert response.status_code == 200
    assert response.json()["deleted"] is True

    # Same token must no longer work, and the email is free to re-register.
    me_response = client.get("/api/v1/auth/me", headers={"Authorization": auth_header})
    assert me_response.status_code == 401

    login_response = client.post(
        "/api/v1/auth/login", json={"email": email, "password": "correct-password-123"}
    )
    assert login_response.status_code == 401

    reregister_response = client.post(
        "/api/v1/auth/register", json={"email": email, "password": "a-new-password-123"}
    )
    assert reregister_response.status_code == 200


def test_delete_account_also_removes_the_users_gallery_entries(client):
    auth_header, _ = _register_and_login(client)
    client.post(
        "/api/v1/gallery/enroll",
        json={"name": "Soon to be deleted", "embedding": [0.3] * 128},
        headers={"Authorization": auth_header},
    )

    response = _delete_me(client, auth_header, "correct-password-123")
    assert response.status_code == 200
    assert response.json()["galleryEntriesDeleted"] == 1


def test_register_claims_gallery_entries_enrolled_under_the_given_anonymous_session(client):
    anon_id = f"anon-{uuid.uuid4().hex[:12]}"
    client.post(
        "/api/v1/gallery/enroll",
        json={"name": "Pre-signup face", "embedding": [0.5] * 128, "userSessionId": anon_id},
    )
    response = client.post(
        "/api/v1/auth/register",
        json={"email": _email(), "password": "correct-password-123", "anonymousSessionId": anon_id},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["claimedGalleryEntries"] == 1

    gallery_response = client.get(
        "/api/v1/gallery", headers={"Authorization": f"Bearer {body['accessToken']}"}
    )
    assert gallery_response.json()["total"] == 1
    assert gallery_response.json()["items"][0]["name"] == "Pre-signup face"


def test_register_without_anonymous_session_id_claims_nothing(client):
    response = client.post(
        "/api/v1/auth/register", json={"email": _email(), "password": "correct-password-123"}
    )
    assert response.status_code == 200
    assert response.json()["claimedGalleryEntries"] == 0


def test_login_claims_gallery_entries_enrolled_under_the_given_anonymous_session(client):
    email = _email()
    client.post("/api/v1/auth/register", json={"email": email, "password": "correct-password-123"})

    anon_id = f"anon-{uuid.uuid4().hex[:12]}"
    client.post(
        "/api/v1/gallery/enroll",
        json={"name": "Enrolled before logging back in", "embedding": [0.6] * 128, "userSessionId": anon_id},
    )
    response = client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": "correct-password-123", "anonymousSessionId": anon_id},
    )
    assert response.status_code == 200
    assert response.json()["claimedGalleryEntries"] == 1


def test_claiming_never_touches_another_users_gallery_entries(client):
    victim_anon_id = f"anon-{uuid.uuid4().hex[:12]}"
    client.post(
        "/api/v1/gallery/enroll",
        json={"name": "Someone else's face", "embedding": [0.7] * 128, "userSessionId": victim_anon_id},
    )

    attacker_response = client.post(
        "/api/v1/auth/register",
        json={
            "email": _email(),
            "password": "correct-password-123",
            "anonymousSessionId": f"anon-{uuid.uuid4().hex[:12]}",
        },
    )
    attacker_token = attacker_response.json()["accessToken"]
    attacker_gallery = client.get(
        "/api/v1/gallery", headers={"Authorization": f"Bearer {attacker_token}"}
    )
    assert attacker_gallery.json()["total"] == 0


def test_register_rejects_an_anonymous_session_id_over_200_chars(client):
    response = client.post(
        "/api/v1/auth/register",
        json={
            "email": _email(),
            "password": "correct-password-123",
            "anonymousSessionId": "a" * 201,
        },
    )
    assert response.status_code == 422


def test_delete_account_with_wrong_password_does_not_touch_gallery_entries(client):
    """The password check must happen before any cleanup -- a rejected
    deletion request should leave the account's data fully intact, not
    partially wiped."""
    auth_header, _ = _register_and_login(client)
    client.post(
        "/api/v1/gallery/enroll",
        json={"name": "Should survive", "embedding": [0.4] * 128},
        headers={"Authorization": auth_header},
    )

    failed = _delete_me(client, auth_header, "wrong-password")
    assert failed.status_code == 401

    list_response = client.get("/api/v1/gallery", headers={"Authorization": auth_header})
    assert list_response.json()["total"] == 1
