"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, type MetricsSnapshot } from "@/lib/api-client";

const REFRESH_INTERVAL_MS = 10_000;
const UNREACHABLE_MESSAGE = "Could not reach the backend's /metrics endpoint. Is it running and reachable?";

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m ${Math.floor(seconds % 60)}s`;
}

export default function MetricsDashboard() {
  const [snapshot, setSnapshot] = useState<MetricsSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastFetchedAt, setLastFetchedAt] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);
  // Bumping this triggers the effect below to fetch again — used by the
  // manual "Refresh now" button, kept separate from calling setState
  // directly so the effect body itself never invokes a function that sets
  // state (matches the fetch-on-mount pattern used elsewhere in this app).
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void api.getMetrics().then((result) => {
      if (cancelled) return;
      if (result) {
        setSnapshot(result);
        setError(null);
        setLastFetchedAt(new Date());
      } else {
        setError(UNREACHABLE_MESSAGE);
      }
      setLoading(false);
    });
    const interval = setInterval(() => {
      void api.getMetrics().then((result) => {
        if (cancelled) return;
        if (result) {
          setSnapshot(result);
          setError(null);
          setLastFetchedAt(new Date());
        } else {
          setError(UNREACHABLE_MESSAGE);
        }
      });
    }, REFRESH_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [refreshToken]);

  const routeEntries = snapshot ? Object.entries(snapshot.routes) : [];
  const sortedRoutes = [...routeEntries].sort((a, b) => b[1].requestCount - a[1].requestCount);
  const totalRequests = routeEntries.reduce((sum, [, r]) => sum + r.requestCount, 0);
  const totalErrors = routeEntries.reduce((sum, [, r]) => sum + r.errorCount, 0);

  return (
    <main className="metrics-page">
      <div className="metrics-shell">
        <header className="metrics-header">
          <div>
            <Link className="brand" href="/">
              <span>◉</span> FaceVision
            </Link>
            <h1>Observability</h1>
            <p className="muted">
              Live request counts, error rates, and latency percentiles per route — read directly
              from <code>GET /api/v1/metrics</code>. No external service, no signup.
            </p>
          </div>
          <button className="ghost-btn" onClick={() => setRefreshToken((n) => n + 1)}>
            ↻ Refresh now
          </button>
        </header>

        {loading && <p className="muted">Loading…</p>}

        {error && (
          <div className="metrics-error">
            <strong>Backend unreachable.</strong> {error}
          </div>
        )}

        {snapshot && (
          <>
            <div className="metrics-summary">
              <div className="metrics-kpi">
                <strong>{formatUptime(snapshot.uptimeSeconds)}</strong>
                <span>Uptime</span>
              </div>
              <div className="metrics-kpi">
                <strong>{totalRequests.toLocaleString()}</strong>
                <span>Requests tracked</span>
              </div>
              <div className="metrics-kpi">
                <strong className={totalErrors > 0 ? "metrics-bad" : undefined}>{totalErrors}</strong>
                <span>5xx errors</span>
              </div>
              <div className="metrics-kpi">
                <strong>{routeEntries.length}</strong>
                <span>Distinct routes</span>
              </div>
            </div>

            <div className="metrics-table-wrap">
              <table className="metrics-table">
                <thead>
                  <tr>
                    <th>Route</th>
                    <th>Requests</th>
                    <th>Errors</th>
                    <th>Error rate</th>
                    <th>p50</th>
                    <th>p95</th>
                    <th>p99</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedRoutes.length === 0 && (
                    <tr>
                      <td colSpan={7} className="muted">
                        No requests recorded yet — hit the API a few times and refresh.
                      </td>
                    </tr>
                  )}
                  {sortedRoutes.map(([route, m]) => (
                    <tr key={route}>
                      <td className="metrics-route">{route}</td>
                      <td>{m.requestCount.toLocaleString()}</td>
                      <td className={m.errorCount > 0 ? "metrics-bad" : undefined}>{m.errorCount}</td>
                      <td className={m.errorRate > 0 ? "metrics-bad" : undefined}>
                        {(m.errorRate * 100).toFixed(2)}%
                      </td>
                      <td>{m.p50Ms.toFixed(1)}ms</td>
                      <td>{m.p95Ms.toFixed(1)}ms</td>
                      <td>{m.p99Ms.toFixed(1)}ms</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="muted small">
              Grouped by path template (e.g. <code>{"{detection_id}"}</code>), not the literal
              request path, so per-record traffic doesn&apos;t fragment the stats. Percentiles are
              computed over the most recent 1000 samples per route, not a lifetime histogram.
              {lastFetchedAt && ` Last refreshed ${lastFetchedAt.toLocaleTimeString()} — auto-refreshes every 10s.`}
            </p>
          </>
        )}
      </div>
    </main>
  );
}
