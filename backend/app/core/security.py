import os

from fastapi import Header, HTTPException, status


def require_api_key(x_api_key: str | None = Header(default=None)) -> None:
    """Gate write endpoints behind an API key when API_KEY is configured.

    If API_KEY is unset (local/dev default), the gate is a no-op so the
    existing anonymous-write flow keeps working out of the box. Set API_KEY
    before any real deployment to require callers to send X-API-Key.
    """
    expected = os.getenv("API_KEY")
    if not expected:
        return
    if x_api_key != expected:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid API key",
        )
