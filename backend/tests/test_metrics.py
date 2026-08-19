"""Checklist §18: request-latency percentiles and error rates."""
import app.core.metrics as metrics_module
from app.core.metrics import record_request, snapshot


def setup_function():
    metrics_module.reset()


def test_snapshot_is_empty_with_no_recorded_requests():
    result = snapshot()
    assert result["routes"] == {}
    assert result["uptimeSeconds"] >= 0


def test_records_request_count_and_error_count():
    record_request("GET /x", 10.0, 200)
    record_request("GET /x", 20.0, 200)
    record_request("GET /x", 30.0, 500)

    routes = snapshot()["routes"]
    assert routes["GET /x"]["requestCount"] == 3
    assert routes["GET /x"]["errorCount"] == 1
    assert routes["GET /x"]["errorRate"] == round(1 / 3, 4)


def test_4xx_does_not_count_as_an_error():
    record_request("GET /y", 5.0, 404)
    record_request("GET /y", 5.0, 429)

    routes = snapshot()["routes"]
    assert routes["GET /y"]["errorCount"] == 0
    assert routes["GET /y"]["errorRate"] == 0.0


def test_percentiles_reflect_the_recorded_distribution():
    for ms in range(1, 101):  # 1..100 ms, evenly spread
        record_request("GET /z", float(ms), 200)

    routes = snapshot()["routes"]
    stats = routes["GET /z"]
    assert stats["p50Ms"] == 50 or stats["p50Ms"] == 51
    assert stats["p95Ms"] >= 94
    assert stats["p99Ms"] >= 98
    assert stats["sampledRequests"] == 100


def test_caps_the_number_of_distinct_routes_tracked():
    for i in range(metrics_module._MAX_DISTINCT_ROUTES + 10):
        record_request(f"GET /scan-{i}", 1.0, 404)

    routes = snapshot()["routes"]
    assert len(routes) == metrics_module._MAX_DISTINCT_ROUTES


def test_existing_route_keeps_recording_even_after_the_cap_is_reached():
    record_request("GET /known", 1.0, 200)
    for i in range(metrics_module._MAX_DISTINCT_ROUTES + 10):
        record_request(f"GET /scan-{i}", 1.0, 404)
    record_request("GET /known", 2.0, 200)

    routes = snapshot()["routes"]
    assert routes["GET /known"]["requestCount"] == 2
