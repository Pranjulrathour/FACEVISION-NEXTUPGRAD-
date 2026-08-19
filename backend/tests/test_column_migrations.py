"""Regression coverage for a real production incident (checklist §4 Phase 4
load testing): create_all() only creates tables that don't exist yet, so a
database provisioned before a column was added to its model silently never
gets that column -- any query loading a full ORM entity then fails with
"column ... does not exist". GET /api/v1/stats, /detections, and /history
all 500'd on the live deployment because detection_records was missing
model_version. See app/database.py's apply_idempotent_column_migrations()
and its module comment for the full story."""
from sqlalchemy import text

from app.database import apply_idempotent_column_migrations, engine


def _drop_column_if_exists(table: str, column: str) -> None:
    with engine.begin() as connection:
        connection.execute(text(f"ALTER TABLE {table} DROP COLUMN IF EXISTS {column}"))


def _column_exists(table: str, column: str) -> bool:
    with engine.begin() as connection:
        return bool(
            connection.execute(
                text(
                    "SELECT 1 FROM information_schema.columns "
                    "WHERE table_name = :table AND column_name = :column"
                ),
                {"table": table, "column": column},
            ).scalar()
        )


def test_adds_a_column_that_was_dropped_to_simulate_pre_existing_drift():
    _drop_column_if_exists("detection_records", "model_version")
    assert _column_exists("detection_records", "model_version") is False

    apply_idempotent_column_migrations()

    assert _column_exists("detection_records", "model_version") is True


def test_is_safe_to_run_repeatedly_when_columns_already_exist():
    apply_idempotent_column_migrations()
    apply_idempotent_column_migrations()  # must not raise the second time

    assert _column_exists("detection_records", "model_version") is True
    assert _column_exists("gallery_face_samples", "embedding") is True
    assert _column_exists("users", "password_hash") is True
