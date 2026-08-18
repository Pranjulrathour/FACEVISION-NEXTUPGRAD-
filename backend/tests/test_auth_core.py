import time

import jwt
import pytest

from app.core.auth import (
    create_access_token,
    decode_access_token,
    hash_password,
    verify_password,
)


def test_hash_password_produces_a_verifiable_but_different_string():
    hashed = hash_password("correct-password")
    assert hashed != "correct-password"
    assert verify_password("correct-password", hashed) is True


def test_verify_password_rejects_wrong_password():
    hashed = hash_password("correct-password")
    assert verify_password("wrong-password", hashed) is False


def test_verify_password_fails_closed_on_malformed_hash():
    assert verify_password("anything", "not-a-real-bcrypt-hash") is False


def test_hash_password_is_salted_differently_each_time():
    a = hash_password("same-password")
    b = hash_password("same-password")
    assert a != b


def test_create_and_decode_access_token_roundtrip():
    token = create_access_token("user_abc123")
    user_id = decode_access_token(token)
    assert user_id == "user_abc123"


def test_decode_access_token_rejects_garbage_input():
    assert decode_access_token("not-a-jwt") is None
    assert decode_access_token("") is None


def test_decode_access_token_rejects_a_tampered_signature():
    token = create_access_token("user_abc123")
    header, payload, signature = token.split(".")
    # Flip a character in the middle of the signature -- flipping only the
    # last base64url character can occasionally leave the decoded bytes
    # unchanged (trailing bits can be padding), so mutate somewhere that's
    # guaranteed to change the underlying signature bytes.
    mid = len(signature) // 2
    swapped_char = "A" if signature[mid] != "A" else "B"
    tampered_signature = signature[:mid] + swapped_char + signature[mid + 1 :]
    tampered = f"{header}.{payload}.{tampered_signature}"
    assert decode_access_token(tampered) is None


def test_decode_access_token_rejects_an_expired_token(monkeypatch):
    monkeypatch.setenv("JWT_EXPIRE_MINUTES", "0")
    token = create_access_token("user_abc123")
    time.sleep(0.05)
    assert decode_access_token(token) is None


def test_decode_access_token_rejects_a_token_signed_with_a_different_secret():
    from app.core import auth as auth_module

    forged = jwt.encode(
        {"sub": "user_abc123"}, "a-completely-different-secret", algorithm="HS256"
    )
    assert decode_access_token(forged) is None
