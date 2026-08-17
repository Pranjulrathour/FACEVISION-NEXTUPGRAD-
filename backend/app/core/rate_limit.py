import os
import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request, status

_WINDOW_SECONDS = 60
_hits: dict[str, deque] = defaultdict(deque)


def _client_key(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def rate_limiter(max_per_minute_env: str, default: int):
    """Dependency factory: sliding-window rate limit, keyed per client IP.

    Limit is configurable via env var so it can be tuned per deployment
    without a code change; defaults keep the app usable out of the box.
    """
    limit = int(os.getenv(max_per_minute_env, str(default)))

    def _dependency(request: Request) -> None:
        if limit <= 0:
            return
        key = _client_key(request)
        now = time.monotonic()
        hits = _hits[key]
        while hits and now - hits[0] > _WINDOW_SECONDS:
            hits.popleft()
        if len(hits) >= limit:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Rate limit exceeded, try again shortly",
            )
        hits.append(now)

    return _dependency
