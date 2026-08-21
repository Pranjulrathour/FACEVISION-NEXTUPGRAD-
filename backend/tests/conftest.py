"""Test-session setup.

Rate limits are captured once at router-import time (module-level
`rate_limiter(...)` calls in each router) so production behavior is
predictable from a single env read at startup -- not re-read per request.
That means a per-test `monkeypatch.setenv(...)` can't affect them, since by
the time any test runs, `app.main` (and therefore every router) has
already been imported and its limiters already constructed.

Running the full test suite legitimately sends many requests to
rate-limited auth/gallery endpoints from the same fake TestClient "IP"
within the same 60s window -- more than a real single user would in
production, but that's the nature of a fast automated test run, not a
reason to weaken the real default. Raise the ceiling here, before
anything imports app.main, so tests get a permissive budget without
touching the production-facing defaults in each router module.
"""
import os

for _env_var in (
    "DETECTIONS_RATE_LIMIT_PER_MIN",
    "GALLERY_ENROLL_RATE_LIMIT_PER_MIN",
    "GALLERY_RECOGNIZE_RATE_LIMIT_PER_MIN",
    "AUTH_RATE_LIMIT_PER_MIN",
):
    os.environ.setdefault(_env_var, "100000")
