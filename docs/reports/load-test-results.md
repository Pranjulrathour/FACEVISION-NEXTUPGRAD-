# Load Test Results — Live Railway Deployment (Checklist §22–25, Phase 4)

Run via `k6 run -e BASE_URL=https://face-vision-backend-production.up.railway.app
deployment/scripts/load-test.js` against the real production backend (not a local
copy) — ramping 0→20 virtual users over 20s, holding 20 VUs for 40s, ramping down
over 10s (70s total steady-load window).

## Headline result: this run found a real production bug, not just capacity numbers

The raw k6 output looks alarming (`http_req_failed` rate 66.66%), but that number
is dominated by two *different* things, one expected and one a genuine bug — they
need to be read separately, not as one "66% failure" capacity statistic:

| Request type | Result | Why |
|---|---|---|
| `GET /api/v1/health` | 544/544 succeeded (200) | No DB dependency, unauthenticated by design |
| `POST /api/v1/detections` | 544/544 rejected (**401**, not the 200/429 the test expected) | **Expected, not a bug** — production has `API_KEY` configured, and this test never sends one. This is the security gate (§15) working correctly against an unauthenticated caller. |
| `GET /api/v1/stats` | 544/544 failed (**500**) | **A real, previously-undiscovered production bug** — see below. |

### The real bug: `detection_records.model_version` was missing on the live database

Follow-up probing (outside the k6 run) found `GET /api/v1/detections` and
`GET /api/v1/history` *also* return 500 on production, while `GET /api/v1/gallery`
returns a normal 200. Root cause, confirmed by local reproduction:

- `app/database.py`'s `init_db()` only ever calls `Base.metadata.create_all()`,
  which **creates tables that don't exist yet but never alters an existing
  table**. `detection_records` was already present on the live database from an
  earlier deploy, from before `model_version` was added to the model
  (`database/migrations/002_add_model_version.sql` — documented as an optional,
  manually-applied migration, and apparently never actually run against
  production).
- Any endpoint that loads a *full* `DetectionRecord` ORM entity (stats' history
  aggregation, the detections list, the history list) selects every mapped
  column, including the missing one, and Postgres raises `column
  detection_records.model_version does not exist` — surfaced to the client as a
  generic 500 by the app's global exception handler (by design, so internals
  never leak — see checklist §15).
- Reproduced locally by dropping the column and re-running the same requests;
  fixed locally by re-adding it. See
  `backend/tests/test_column_migrations.py`.

**Fix shipped in this pass**: `init_db()` now also runs a small set of the exact
same idempotent `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` statements from
migrations 002–004 on every startup (`apply_idempotent_column_migrations()` in
`app/database.py`) — safe to run repeatedly, only touches tables that already
exist. The next deploy self-heals this without anyone needing to run `psql`
manually. **Action needed**: after this fix is deployed, re-probe
`GET /api/v1/stats` on production to confirm it now returns 200 — this report's
numbers were captured *before* that fix shipped.

## Latency (the numbers that are actually meaningful from this run)

Only `health` had a clean, unauthenticated, bug-free path — its latency is the
trustworthy signal from this run:

| Metric | Value |
|---|---|
| Total requests | 1632 (544 × 3 request types) |
| Requests/sec | 22.8 |
| `http_req_duration` avg | 345.76ms |
| `http_req_duration` p90 | 417.89ms |
| `http_req_duration` p95 | 502.99ms (fails the 500ms threshold in `load-test.js`, but see caveat below) |
| `http_req_duration` max | 1.47s |

**Caveat**: this p95/p90/avg blends `health` (DB-free, fast) with `stats` (500,
likely fast-failing rather than slow) and `detections` (401, fast-failing) — it
is *not* a clean measurement of "how fast does a real detection write take under
load." A follow-up run after the fix above (with a real `API_KEY` so
`POST /api/v1/detections` actually reaches the database) is needed for a
trustworthy write-path latency number — tracked as a follow-up, not done in this
pass.

## What this run did *not* test

- **Authenticated write load** — needs a real `API_KEY` value for this
  deployment, which this pass didn't have; the create-detection path was only
  exercised as an unauthenticated 401 fast-path.
- **Sustained load beyond 70 seconds** — this was a short capacity probe, not an
  extended soak test.
- **Concurrent database connection pool exhaustion** — the discovered bug meant
  the DB-touching endpoints were failing fast on a schema error, not actually
  stressing the connection pool; this remains genuinely unverified (checklist
  §23: "Postgres connection pool sizing not specifically tuned... would need
  real load testing to confirm").

## Honest takeaway

This is exactly what a real load test is supposed to do: it found a genuine,
previously-invisible production incident (three read endpoints silently broken)
that manual testing and the existing test suite — which all run against a
*freshly created* local database — had no way to catch. The capacity/latency
question this test originally set out to answer is still open and needs a
re-run once the schema fix is live and a real `API_KEY` is available.
