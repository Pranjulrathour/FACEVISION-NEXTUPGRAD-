"""Integration coverage that GET /api/v1/metrics actually reflects real
requests routed through the app, not just the unit-level core/metrics.py
logic (covered separately in test_metrics.py)."""
import app.core.metrics as metrics_module
from fastapi.testclient import TestClient

from app.main import app


def test_metrics_endpoint_reflects_requests_by_route_template():
    metrics_module.reset()
    with TestClient(app) as client:
        client.get("/api/v1/health")
        client.get("/api/v1/health")

        response = client.get("/api/v1/metrics")
        assert response.status_code == 200
        body = response.json()
        assert "uptimeSeconds" in body
        # The /metrics call itself is recorded only after it returns, so at
        # request time it only reflects the two prior /health calls.
        health_stats = body["routes"]["GET /api/v1/health"]  # no path params to template
        assert health_stats["requestCount"] == 2
        assert health_stats["errorCount"] == 0
        assert "p95Ms" in health_stats


def test_metrics_endpoint_available_under_legacy_prefix_too():
    metrics_module.reset()
    with TestClient(app) as client:
        response = client.get("/api/metrics")
        assert response.status_code == 200


def test_distinct_detection_ids_group_into_one_templated_route_key():
    """Two different detection IDs must group under one key
    ("GET /api/v1/detections/{detection_id}"), not fragment into two --
    otherwise every unique ID would blow up the number of tracked routes."""
    metrics_module.reset()
    with TestClient(app) as client:
        client.get("/api/v1/detections/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
        client.get("/api/v1/detections/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")

        response = client.get("/api/v1/metrics")
        routes = response.json()["routes"]
        assert routes["GET /api/v1/detections/{detection_id}"]["requestCount"] == 2
