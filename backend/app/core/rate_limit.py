import os
import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request, status

_WINDOW_SECONDS = 60
_SWEEP_INTERVAL_SECONDS = 300
_hits: dict[str, deque] = defaultdict(deque)
_last_sweep = time.monotonic()


def _client_key(request: Request, limiter_id: str) -> str:
    """Composite key: (which limiter, which client). Without limiter_id,
    every rate_limiter() instance shares the same _hits bucket per IP --
    hitting /gallery/enroll would silently consume the budget meant for
    /detections and vice versa, since they'd all collapse to the same
    per-IP key. Each call site's env-var name is already unique per route,
    so it doubles as a stable limiter identifier."""
    host = request.client.host if request.client else "unknown"
    return f"{limiter_id}:{host}"


def _sweep_stale_entries(now: float) -> None:
    """Drop entries whose window has fully expired.

    A client that visits once and never returns leaves a stale deque behind
    forever, since per-key trimming only runs when that same key is seen
    again. Left unchecked, `_hits` grows without bound over the process
    lifetime under normal internet traffic (scanners, one-off visitors).
    This runs on a coarse interval rather than every request to keep the
    common-case cost at O(1).
    """
    global _last_sweep
    if now - _last_sweep < _SWEEP_INTERVAL_SECONDS:
        return
    _last_sweep = now
    stale_keys = [
        key
        for key, hits in _hits.items()
        if not hits or now - hits[-1] > _WINDOW_SECONDS
    ]
    for key in stale_keys:
        del _hits[key]


def rate_limiter(max_per_minute_env: str, default: int):
    """Dependency factory: sliding-window rate limit, keyed per client IP.

    Limit is configurable via env var so it can be tuned per deployment
    without a code change; defaults keep the app usable out of the box.
    """
    limit = int(os.getenv(max_per_minute_env, str(default)))

    def _dependency(request: Request) -> None:
        if limit <= 0:
            return
        now = time.monotonic()
        _sweep_stale_entries(now)
        key = _client_key(request, max_per_minute_env)
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
