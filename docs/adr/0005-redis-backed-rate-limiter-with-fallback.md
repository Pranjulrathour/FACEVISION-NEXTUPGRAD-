# ADR 0005: Redis-backed rate limiter, with automatic in-memory fallback

## Status

Accepted.

## Context

Checklist §26 (Scalability Architecture) flagged the one piece of real
state standing between this backend and horizontal scaling: the rate
limiter's `_hits` dict lives in process memory. Run two backend replicas
behind a load balancer and each one enforces its own independent budget —
a client could get up to `N × replica_count` requests through instead of
`N`, silently defeating the limit the moment the app scales past one
instance.

There is no Redis instance provisioned for this project today, and adding
one is a real recurring cost, not a code-only decision.

## Decision

Add real Redis-backed rate limiting (`app/core/rate_limit.py`), but make
it entirely opt-in via a `REDIS_URL` environment variable:

- **Unset** (today's default): behavior is byte-for-byte identical to
  before this change — the in-memory sliding-window limiter, unchanged.
  No new cost, no new infrastructure, no risk introduced by this ADR.
- **Set**: requests are checked against a Redis sorted-set-backed sliding
  window (same window semantics as the in-memory version: a rejected
  request is not itself recorded, so a client hammering past the limit
  doesn't dig itself deeper), shared across every process/replica pointed
  at that Redis instance.
- **Set but unreachable**: falls back to the in-memory check for that
  request, with a rate-limited warning log (backs off retrying the
  connection for 30s at a time) rather than either failing the request or
  crashing the app. A Redis outage should degrade rate-limit coordination
  across replicas, not take down the API.

`redis` (the client library) is a normal `requirements.txt` dependency
now — it's small, and importing it costs nothing at runtime when
`REDIS_URL` is unset (the `import redis` call itself is deferred until a
connection is actually attempted). `fakeredis` is a test-only dependency
(`requirements-eval.txt`) so the Redis code path has real test coverage
(`tests/test_rate_limit_redis.py`) without needing a live Redis server in
CI or local dev.

## Consequences

- **Ready to flip on, not yet flipped on.** This app still runs as a
  single instance today, so the in-memory limiter is still what's actually
  enforcing limits in production. The value delivered now is that scaling
  to multiple replicas no longer requires a code change — just provisioning
  Redis and setting `REDIS_URL`.
- **Two code paths to keep in sync.** Any future change to the rate-limit
  algorithm (window length, key scheme) must be applied to both
  `_check_in_memory()` and `_check_redis()` — they're deliberately written
  to mirror each other's semantics exactly; a divergence would mean
  behavior differs depending on whether Redis is configured, which would
  be a confusing, environment-dependent bug.
- **Redis becomes a soft dependency for coordinated rate limiting**, not a
  hard one for availability — by design, per the fallback behavior above.
  This is the right tradeoff for a rate limiter (an availability feature
  gracefully degrading) but would be the *wrong* tradeoff for something
  where silent fallback could mask a real problem (e.g. this pattern is
  not copied to authentication or biometric data handling anywhere in this
  app).
