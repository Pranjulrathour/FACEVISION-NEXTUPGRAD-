# ADR 0004: Self-healing idempotent column migrations at startup

## Status

Accepted.

## Context

Phase 4 load testing (checklist §22-25) against the live Railway deployment found
that `GET /api/v1/stats`, `/detections`, and `/history` all returned 500. Root
cause: `app/database.py`'s `init_db()` only calls `Base.metadata.create_all()`,
which creates tables that don't exist yet but **never alters an existing
table**. `detection_records` was already present on the live database from an
earlier deploy — from before `model_version` was added to the model
(`database/migrations/002_add_model_version.sql`, documented in the README as
an optional, manually-applied migration). That migration was apparently never
actually run against production. Any endpoint loading a full `DetectionRecord`
ORM entity then failed with a Postgres `column ... does not exist` error,
masked as a generic 500 by the app's intentionally-generic exception handler.

`GET /api/v1/gallery` was unaffected — it doesn't load the same entity shape —
which is what made this a targeted, non-obvious bug rather than an
everything-is-down outage.

## Decision

`init_db()` now also runs `apply_idempotent_column_migrations()` on every
startup, immediately after `create_all()`. It re-executes the exact same
`ALTER TABLE ... ADD COLUMN IF NOT EXISTS` statements already committed as
`database/migrations/002-004`, guarded per-statement: it checks whether the
target table exists (via `to_regclass`) before attempting the alter, so a
missing table doesn't abort the rest, and `IF NOT EXISTS` makes every
statement safe to run unconditionally on every single deploy, forever.

This does **not** replace `database/migrations/*.sql` as the source of truth —
those files remain the readable, git-tracked history of what changed and why.
This only closes the specific gap where a column-adding migration exists in
the repo but was never actually applied to a live database, by making the
*next deploy* apply it automatically instead of requiring someone to remember
to run `psql` by hand.

## Consequences

- **This specific incident self-heals on the next deploy** — no manual `psql`
  step required against production. (If Railway isn't configured to
  auto-deploy from `main`, a manual redeploy trigger is still needed once to
  pick up this fix itself — that's a one-time bootstrapping step, not an
  ongoing requirement.)
- **New columns added to existing tables in the future must be added to
  `_IDEMPOTENT_COLUMN_MIGRATIONS`** in `app/database.py` (alongside writing the
  corresponding `database/migrations/NNN_*.sql` file, unchanged) — otherwise
  this exact class of drift will recur for the *next* column, silently, until
  something notices via testing against real production data (which, per this
  incident, only a real load/smoke test against the live deployment catches —
  tests against a freshly-created local database can't reproduce drift that
  only exists on an already-running production database).
- **Not a general migration framework.** This is a narrow, deliberately
  low-tech fix for exactly one recurring failure mode (missing columns on
  otherwise-existing tables). It does not handle column type changes, drops,
  renames, or anything requiring data backfill — those still need a real,
  manually-run migration and should not be added to this list.
- **Runs on every process start**, including local dev and CI test runs. Each
  statement is a cheap, idempotent no-op once the column exists, so this adds
  negligible startup latency — verified by the full test suite still running
  in ~11s.
