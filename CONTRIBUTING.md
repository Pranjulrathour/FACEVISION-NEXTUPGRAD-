# Contributing to FaceVision

This is currently a solo project (checklist §37/§38) — there's no formal PR
review gate configured, and commits go straight to `main`. This document
exists so a second contributor has a concrete checklist to work from on
day one instead of reverse-engineering the project's conventions from git
history, and so the same review standard gets applied even without a
formal gate enforcing it.

## Before you open a PR

Run the same checks CI runs, locally, first:

```bash
# Frontend
cd frontend
npm ci
npm run lint
npm run typecheck
npm test -- --run
npm run build

# Backend
cd backend
pip install -r requirements.txt -r requirements-eval.txt
pytest -q
pip install pip-audit==2.7.3 && pip-audit -r requirements.txt --strict
```

## Review checklist

Adapted from the original engineering checklist this project follows
([docs/face-detection-verification-checklist.md](docs/face-detection-verification-checklist.md)).
When reviewing a change (your own, before opening a PR, or someone else's),
walk through whichever of these actually apply to the diff:

- **Architecture** — does this respect the existing layering (frontend
  pipeline stages in `frontend/src/lib/`, backend
  routers → services → models in `backend/app/`)? No new inward-dependency
  violations.
- **Security** — new endpoint? Does it need `require_api_key`/rate limiting/
  auth? New input? Is it validated (Pydantic schema, size caps)? See
  `backend/tests/test_security_adversarial.py` for the existing adversarial
  coverage style.
- **Privacy** — does this send anything new to the backend? If so, is it
  documented in [docs/privacy-retention-policy.md](docs/privacy-retention-policy.md)?
  Raw images must never leave the browser — this is the core product promise.
- **Memory/async correctness** — any new client-side inference path?
  Check it against the pattern in `frontend/src/lib/face-pipeline.ts`
  (timeouts, lazy model loading).
- **Exception handling** — backend errors must never leak internals to the
  client (`{"detail": "Internal server error"}`, full traceback server-side
  only — see `app/main.py`'s `global_exception_handler`).
- **Logging** — no biometric values or secrets in log lines, ever.
- **Test coverage** — new logic should have unit tests; new endpoints need
  at least one integration test via `TestClient`. Pure math/logic should be
  extracted into a testable function rather than buried in a
  component/router (see any `*.test.ts`/`test_*.py` file for the pattern).
- **Config** — no new hardcoded URLs/thresholds/secrets; add them to
  `Settings` (backend) or a documented env var.
- **Scalability** — does this add new per-process state? If so, does it
  need to survive horizontal scaling (see `app/core/rate_limit.py`'s
  Redis-with-in-memory-fallback pattern for how this project handles that)?
- **Docs** — does this change a model, an architecture decision, or a
  privacy-relevant behavior? If so, it needs a model card update, an ADR
  (`docs/adr/NNNN-*.md`), or a privacy-policy update, respectively — not
  just a commit message.

## Commit style

Conventional, scoped prefixes matching this repo's existing history:
`feat(frontend): ...`, `fix(backend): ...`, `test(backend): ...`,
`docs: ...`, `chore: ...`. Keep commits atomic — one logical change per
commit, not a grab-bag.

## Opening a PR

- Target `main`.
- Fill in the PR template (`.github/PULL_REQUEST_TEMPLATE.md`) — it mirrors
  the review checklist above.
- Make sure CI is green before requesting review.
