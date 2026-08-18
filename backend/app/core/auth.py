import logging
import os
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

import bcrypt
import jwt
from fastapi import Depends, Header, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.user import User

logger = logging.getLogger("facevision")

_JWT_ALGORITHM = "HS256"
# Ephemeral, process-lifetime fallback secret -- only used when JWT_SECRET
# isn't configured. Tokens signed with it stop working the moment the
# backend restarts, which is fine for local dev and explicitly NOT fine
# for production; see the warning below.
_EPHEMERAL_SECRET = secrets.token_hex(32)
_warned_ephemeral = False


def _jwt_secret() -> str:
    global _warned_ephemeral
    configured = os.getenv("JWT_SECRET")
    if configured:
        return configured
    if not _warned_ephemeral:
        logger.warning(
            "JWT_SECRET is not set -- using an ephemeral per-process secret. "
            "Tokens will stop working on every restart. Set JWT_SECRET before "
            "any real deployment."
        )
        _warned_ephemeral = True
    return _EPHEMERAL_SECRET


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except ValueError:
        # Malformed/corrupt hash -- fail closed, never raise past the caller
        # as an unhandled exception that could leak into a 500 with detail.
        return False


def create_access_token(user_id: str) -> str:
    expire_minutes = int(os.getenv("JWT_EXPIRE_MINUTES", "10080"))  # 7 days
    payload = {
        "sub": user_id,
        "exp": datetime.now(timezone.utc) + timedelta(minutes=expire_minutes),
        "iat": datetime.now(timezone.utc),
    }
    return jwt.encode(payload, _jwt_secret(), algorithm=_JWT_ALGORITHM)


def decode_access_token(token: str) -> Optional[str]:
    """Returns the user id encoded in the token, or None if the token is
    missing, malformed, expired, or has an invalid signature -- every
    failure mode collapses to the same "not authenticated" result rather
    than leaking which specific thing was wrong."""
    try:
        payload = jwt.decode(token, _jwt_secret(), algorithms=[_JWT_ALGORITHM])
        return payload.get("sub")
    except jwt.PyJWTError:
        return None


def new_user_id() -> str:
    return f"user_{uuid.uuid4().hex}"


def _extract_bearer_token(authorization: Optional[str]) -> Optional[str]:
    if not authorization:
        return None
    parts = authorization.split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None
    return parts[1].strip() or None


def get_current_user_optional(
    authorization: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
) -> Optional[User]:
    """Resolves the authenticated user from a Bearer token if present and
    valid; returns None otherwise (never raises) -- endpoints that support
    both anonymous and authenticated use call this, not require_current_user."""
    token = _extract_bearer_token(authorization)
    if not token:
        return None
    user_id = decode_access_token(token)
    if not user_id:
        return None
    return db.query(User).filter(User.id == user_id).first()


def require_current_user(
    user: Optional[User] = Depends(get_current_user_optional),
) -> User:
    """For endpoints that must have a real authenticated user (e.g. GET /me)."""
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    return user


def resolve_scope_id(
    client_session_id: Optional[str],
    current_user: Optional[User],
) -> Optional[str]:
    """Decide which identifier actually scopes a request's data (checklist
    §16). If the caller presents a valid bearer token, their data is scoped
    to that real, non-guessable user id -- the client-supplied
    userSessionId is ignored, closing the "guess someone else's session id"
    read/write leak for anyone who bothers to log in. Anonymous callers
    (no token) keep the existing session-id-based scoping unchanged."""
    if current_user:
        return f"user:{current_user.id}"
    return client_session_id
