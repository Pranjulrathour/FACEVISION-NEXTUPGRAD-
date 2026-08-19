import logging
import os
import time
import uuid
from collections import defaultdict, deque
from typing import Optional

from fastapi import HTTPException, Request, status

logger = logging.getLogger("facevision")

_WINDOW_SECONDS = 60
_SWEEP_INTERVAL_SECONDS = 300
_hits: dict[str, deque] = defaultdict(deque)
_last_sweep = time.monotonic()

# Redis-backed limiting (checklist §26): the in-memory _hits dict above is
# per-process, so it doesn't coordinate across multiple backend replicas --
# each instance would enforce its own independent budget. Set REDIS_URL to
# share the budget across replicas; leave it unset and nothing changes
# (this whole block is a no-op, same behavior as before). If Redis is set
# but unreachable, every rate_limiter() call falls back to the in-memory
# check for that request rather than failing closed -- a Redis outage
# should degrade rate-limit coordination, not take down the API.
_redis_client_cache: Optional[object] = None
_redis_next_retry_at = 0.0
_REDIS_RETRY_BACKOFF_SECONDS = 30


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


def _check_in_memory(key: str, limit: int) -> bool:
    """Sliding-window check against the per-process _hits dict. Returns
    True (and records the hit) if under the limit; False (without
    recording) if not -- a rejected request doesn't consume budget, so a
    client hammering past the limit doesn't dig itself a deeper hole."""
    now = time.monotonic()
    _sweep_stale_entries(now)
    hits = _hits[key]
    while hits and now - hits[0] > _WINDOW_SECONDS:
        hits.popleft()
    if len(hits) >= limit:
        return False
    hits.append(now)
    return True


def _get_redis_client():
    """Lazily constructs and caches a Redis client if REDIS_URL is set.
    Returns None if unset, or if the redis package/connection isn't usable
    right now -- callers must fall back to the in-memory check in that
    case. Read per-call (not just once at import time) so tests can
    monkeypatch REDIS_URL freely, and a failed connection attempt is
    retried after a short backoff rather than cached as permanently
    unavailable (so a recovered Redis gets picked back up automatically).
    """
    global _redis_client_cache, _redis_next_retry_at
    redis_url = os.getenv("REDIS_URL")
    if not redis_url:
        return None
    if _redis_client_cache is not None:
        return _redis_client_cache
    now = time.monotonic()
    if now < _redis_next_retry_at:
        return None
    try:
        import redis  # optional dependency -- only imported if REDIS_URL is actually set

        client = redis.Redis.from_url(redis_url, socket_connect_timeout=2, socket_timeout=2)
        client.ping()
        _redis_client_cache = client
        return client
    except Exception as exc:
        logger.warning(
            "REDIS_URL is set but Redis is unreachable (%s) -- falling back to the "
            "in-memory rate limiter until the next retry in %ds.",
            exc,
            _REDIS_RETRY_BACKOFF_SECONDS,
        )
        _redis_next_retry_at = now + _REDIS_RETRY_BACKOFF_SECONDS
        return None


def _check_redis(client, key: str, limit: int, window_seconds: int) -> bool:
    """Same sliding-window semantics as _check_in_memory(), backed by a
    per-key Redis sorted set (member score = wall-clock seconds) so the
    budget is shared across every process/replica pointed at the same
    Redis instance. Two round trips rather than one pipelined round trip,
    deliberately: a rejected request must NOT be recorded (matching
    _check_in_memory()'s behavior), so the count has to be checked before
    deciding whether to add this attempt."""
    now = time.time()
    client.zremrangebyscore(key, 0, now - window_seconds)
    count = client.zcard(key)
    if count >= limit:
        return False
    member = f"{now}:{uuid.uuid4().hex}"
    client.zadd(key, {member: now})
    client.expire(key, window_seconds)
    return True


def rate_limiter(max_per_minute_env: str, default: int):
    """Dependency factory: sliding-window rate limit, keyed per client IP.

    Limit is configurable via env var so it can be tuned per deployment
    without a code change; defaults keep the app usable out of the box.
    Backed by Redis when REDIS_URL is set (shared across replicas),
    in-memory otherwise or if Redis is temporarily unreachable.
    """
    limit = int(os.getenv(max_per_minute_env, str(default)))

    def _dependency(request: Request) -> None:
        if limit <= 0:
            return
        key = _client_key(request, max_per_minute_env)
        redis_client = _get_redis_client()
        if redis_client is not None:
            try:
                allowed = _check_redis(redis_client, f"ratelimit:{key}", limit, _WINDOW_SECONDS)
            except Exception as exc:
                logger.warning(
                    "Redis rate-limit check failed (%s) -- falling back to the "
                    "in-memory limiter for this request.",
                    exc,
                )
                allowed = _check_in_memory(key, limit)
        else:
            allowed = _check_in_memory(key, limit)
        if not allowed:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Rate limit exceeded, try again shortly",
            )

    return _dependency
