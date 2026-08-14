from unittest.mock import MagicMock

from app.services.stats_service import get_summary


def _make_db_mock():
    db = MagicMock()
    empty_query = MagicMock()
    empty_query.count.return_value = 0
    empty_query.with_entities.return_value.scalar.return_value = 0
    empty_query.filter.return_value = empty_query
    empty_query.join.return_value = empty_query
    empty_query.group_by.return_value.all.return_value = []
    empty_query.all.return_value = []
    empty_query.scalar.return_value = 0.0
    db.query.return_value = empty_query
    return db


def test_get_summary_with_session_filter_does_not_raise():
    db = _make_db_mock()
    summary = get_summary(db, user_session_id="session-123")
    assert summary["totalDetections"] == 0
    assert summary["topMode"] == "-"
    assert summary["detectionHistory"] == []


def test_get_summary_without_session_filter_does_not_raise():
    db = _make_db_mock()
    summary = get_summary(db, user_session_id=None)
    assert summary["totalDetections"] == 0
