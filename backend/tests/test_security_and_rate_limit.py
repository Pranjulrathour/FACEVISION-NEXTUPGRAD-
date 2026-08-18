import pytest
from fastapi import HTTPException

from app.core.rate_limit import rate_limiter
from app.core.security import require_api_key


class _FakeClient:
    def __init__(self, host):
        self.host = host


class _FakeRequest:
    def __init__(self, host):
        self.client = _FakeClient(host)


def test_require_api_key_noop_when_unset(monkeypatch):
    monkeypatch.delenv("API_KEY", raising=False)
    require_api_key(x_api_key=None)  # should not raise


def test_require_api_key_rejects_wrong_key(monkeypatch):
    monkeypatch.setenv("API_KEY", "secret123")
    with pytest.raises(HTTPException) as exc:
        require_api_key(x_api_key="wrong")
    assert exc.value.status_code == 401


def test_require_api_key_accepts_correct_key(monkeypatch):
    monkeypatch.setenv("API_KEY", "secret123")
    require_api_key(x_api_key="secret123")  # should not raise


def test_rate_limiter_allows_up_to_limit_then_blocks(monkeypatch):
    monkeypatch.setenv("TEST_RATE_LIMIT", "3")
    limiter = rate_limiter("TEST_RATE_LIMIT", default=100)
    request = _FakeRequest("1.2.3.4")

    limiter(request)
    limiter(request)
    limiter(request)
    with pytest.raises(HTTPException) as exc:
        limiter(request)
    assert exc.value.status_code == 429


def test_rate_limiter_tracks_clients_independently(monkeypatch):
    monkeypatch.setenv("TEST_RATE_LIMIT_2", "1")
    limiter = rate_limiter("TEST_RATE_LIMIT_2", default=100)
    limiter(_FakeRequest("1.1.1.1"))
    limiter(_FakeRequest("2.2.2.2"))  # different client, should not raise


def test_rate_limiters_for_different_routes_do_not_share_a_budget(monkeypatch):
    """Regression test: rate_limiter() instances used to share one global
    per-IP bucket regardless of which route they guarded, so exhausting
    one endpoint's limit silently exhausted every other endpoint's limit
    too for the same client. Each limiter must track its own budget."""
    monkeypatch.setenv("TEST_RATE_LIMIT_A", "1")
    monkeypatch.setenv("TEST_RATE_LIMIT_B", "1")
    limiter_a = rate_limiter("TEST_RATE_LIMIT_A", default=100)
    limiter_b = rate_limiter("TEST_RATE_LIMIT_B", default=100)
    same_client = "9.9.9.9"

    limiter_a(_FakeRequest(same_client))
    with pytest.raises(HTTPException):
        limiter_a(_FakeRequest(same_client))

    # limiter_b for the same client should still have its own full budget.
    limiter_b(_FakeRequest(same_client))
