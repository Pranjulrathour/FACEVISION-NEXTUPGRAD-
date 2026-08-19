"""In-process request metrics (checklist §18): latency percentiles and
error rates per route, with no external service or signup required. This
is intentionally simple -- a real multi-instance deployment would want a
shared store (same class of problem as the rate limiter in
core/rate_limit.py), but for a single instance this gives real p50/p95/p99
numbers instead of just "some request logs exist."
"""
import threading
import time
from collections import defaultdict, deque

_MAX_SAMPLES_PER_ROUTE = 1000
_MAX_DISTINCT_ROUTES = 200
_lock = threading.Lock()
_durations_ms: dict[str, deque] = defaultdict(lambda: deque(maxlen=_MAX_SAMPLES_PER_ROUTE))
_total_count: dict[str, int] = defaultdict(int)
_error_count: dict[str, int] = defaultdict(int)
_started_at = time.time()


def record_request(route_key: str, duration_ms: float, status_code: int) -> None:
    """Records one request's latency/outcome against `route_key` (expected
    to be "METHOD /template/path", i.e. the matched route's path template,
    not the literal request path with real IDs interpolated in -- otherwise
    every distinct detection ID would fragment into its own bucket).

    Caps the number of distinct route keys tracked so a scanner hammering
    random nonexistent paths (which fall back to the literal path as their
    key, since no route matched) can't grow this dict without bound --
    once the cap is hit, only already-known keys keep recording.
    """
    with _lock:
        if route_key not in _durations_ms and len(_durations_ms) >= _MAX_DISTINCT_ROUTES:
            return
        _durations_ms[route_key].append(duration_ms)
        _total_count[route_key] += 1
        if status_code >= 500:
            _error_count[route_key] += 1


def _percentile(sorted_values: list, pct: float) -> float:
    if not sorted_values:
        return 0.0
    index = min(len(sorted_values) - 1, int(round(pct * (len(sorted_values) - 1))))
    return sorted_values[index]


def snapshot() -> dict:
    """Returns a point-in-time view -- percentiles are computed over
    whatever samples are currently held (up to _MAX_SAMPLES_PER_ROUTE most
    recent per route), not a lifetime histogram."""
    with _lock:
        routes = {}
        for key in sorted(_durations_ms.keys()):
            samples = sorted(_durations_ms[key])
            total = _total_count[key]
            errors = _error_count[key]
            routes[key] = {
                "requestCount": total,
                "errorCount": errors,
                # >=500 only -- a 4xx is normal traffic (bad input, missing
                # resource, rate-limited), not an operational failure the
                # way a 5xx is.
                "errorRate": round(errors / total, 4) if total else 0.0,
                "p50Ms": round(_percentile(samples, 0.50), 2),
                "p95Ms": round(_percentile(samples, 0.95), 2),
                "p99Ms": round(_percentile(samples, 0.99), 2),
                "sampledRequests": len(samples),
            }
        uptime_seconds = round(time.time() - _started_at, 1)
    return {
        "uptimeSeconds": uptime_seconds,
        "routes": routes,
    }


def reset() -> None:
    """Test-only: clears all recorded state."""
    with _lock:
        _durations_ms.clear()
        _total_count.clear()
        _error_count.clear()
