from fastapi import APIRouter

from app.core.metrics import snapshot

router = APIRouter()


@router.get("")
def get_metrics():
    """Checklist §18: request-latency percentiles and error rates per
    route, tracked in-process since this app started. Unauthenticated,
    same as /health -- this exposes request counts/timings, not the
    routes themselves (already public via /docs), and no biometric data."""
    return snapshot()
