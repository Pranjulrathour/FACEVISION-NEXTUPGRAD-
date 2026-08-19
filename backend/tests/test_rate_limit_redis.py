"""Redis-backed rate limiting (checklist §26) -- uses fakeredis so this
runs without a real Redis server. See app/core/rate_limit.py's module
comment for why this exists: the in-memory limiter doesn't coordinate
across multiple backend replicas."""
import fakeredis
import pytest
from fastapi import HTTPException

import app.core.rate_limit as rate_limit_module
from app.core.rate_limit import rate_limiter


class _FakeClient:
    def __init__(self, host):
        self.host = host


class _FakeRequest:
    def __init__(self, host):
        self.client = _FakeClient(host)


@pytest.fixture(autouse=True)
def _reset_redis_client_cache():
    """The module caches the Redis client (and a retry-backoff timestamp)
    at module scope so repeated requests don't reconnect every time --
    exactly what would leak state between these tests if not reset."""
    rate_limit_module._redis_client_cache = None
    rate_limit_module._redis_next_retry_at = 0.0
    yield
    rate_limit_module._redis_client_cache = None
    rate_limit_module._redis_next_retry_at = 0.0


def _patch_redis_with_fake(monkeypatch):
    fake = fakeredis.FakeStrictRedis()

    class _FakeRedisModule:
        class Redis:
            @staticmethod
            def from_url(*args, **kwargs):
                return fake

    monkeypatch.setitem(__import__("sys").modules, "redis", _FakeRedisModule())
    return fake


def test_uses_redis_backend_when_redis_url_is_set(monkeypatch):
    monkeypatch.setenv("REDIS_URL", "redis://fake:6379/0")
    monkeypatch.setenv("TEST_REDIS_RATE_LIMIT", "2")
    _patch_redis_with_fake(monkeypatch)

    limiter = rate_limiter("TEST_REDIS_RATE_LIMIT", default=100)
    request = _FakeRequest("5.5.5.5")

    limiter(request)
    limiter(request)
    with pytest.raises(HTTPException) as exc:
        limiter(request)
    assert exc.value.status_code == 429


def test_redis_backend_tracks_clients_independently(monkeypatch):
    monkeypatch.setenv("REDIS_URL", "redis://fake:6379/0")
    monkeypatch.setenv("TEST_REDIS_RATE_LIMIT_2", "1")
    _patch_redis_with_fake(monkeypatch)

    limiter = rate_limiter("TEST_REDIS_RATE_LIMIT_2", default=100)
    limiter(_FakeRequest("6.6.6.1"))
    limiter(_FakeRequest("6.6.6.2"))  # different client, should not raise


def test_redis_backend_does_not_record_a_rejected_attempt(monkeypatch):
    """Matches _check_in_memory()'s semantics: a request that gets 429'd
    must not itself consume budget, or a client hammering past the limit
    would dig itself progressively deeper instead of recovering once the
    window rolls forward."""
    monkeypatch.setenv("REDIS_URL", "redis://fake:6379/0")
    monkeypatch.setenv("TEST_REDIS_RATE_LIMIT_3", "1")
    fake = _patch_redis_with_fake(monkeypatch)

    limiter = rate_limiter("TEST_REDIS_RATE_LIMIT_3", default=100)
    request = _FakeRequest("7.7.7.7")

    limiter(request)
    for _ in range(5):
        with pytest.raises(HTTPException):
            limiter(request)

    key = f"ratelimit:TEST_REDIS_RATE_LIMIT_3:7.7.7.7"
    assert fake.zcard(key) == 1


def test_falls_back_to_in_memory_when_redis_url_is_unset(monkeypatch):
    monkeypatch.delenv("REDIS_URL", raising=False)
    monkeypatch.setenv("TEST_NO_REDIS_LIMIT", "1")

    limiter = rate_limiter("TEST_NO_REDIS_LIMIT", default=100)
    request = _FakeRequest("8.8.8.8")

    limiter(request)
    with pytest.raises(HTTPException):
        limiter(request)


def test_falls_back_to_in_memory_when_redis_is_unreachable(monkeypatch):
    """REDIS_URL is set but nothing is listening -- a real (not fake)
    connection attempt to a closed port should fail fast and the request
    should still be allowed through via the in-memory fallback rather than
    erroring out or hanging."""
    monkeypatch.setenv("REDIS_URL", "redis://127.0.0.1:1")  # port 1: nothing listens here
    monkeypatch.setenv("TEST_UNREACHABLE_REDIS_LIMIT", "1")

    limiter = rate_limiter("TEST_UNREACHABLE_REDIS_LIMIT", default=100)
    request = _FakeRequest("9.9.9.9")

    limiter(request)  # falls back to in-memory, allowed
    with pytest.raises(HTTPException):
        limiter(request)  # second call still enforced via the in-memory fallback
