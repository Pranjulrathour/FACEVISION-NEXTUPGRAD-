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
