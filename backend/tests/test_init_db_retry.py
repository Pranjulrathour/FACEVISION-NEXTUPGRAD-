from unittest.mock import MagicMock, patch

import pytest
from sqlalchemy.exc import OperationalError

from app.database import init_db


def _op_error():
    return OperationalError("statement", {}, Exception("connection refused"))


@patch("app.database.time.sleep", return_value=None)
@patch("app.database.Base")
def test_init_db_retries_on_operational_error_then_succeeds(mock_base, mock_sleep):
    mock_base.metadata.create_all.side_effect = [_op_error(), _op_error(), None]

    init_db(max_attempts=5, base_delay_seconds=0.01)

    assert mock_base.metadata.create_all.call_count == 3
    assert mock_sleep.call_count == 2


@patch("app.database.time.sleep", return_value=None)
@patch("app.database.Base")
def test_init_db_raises_after_exhausting_attempts(mock_base, mock_sleep):
    mock_base.metadata.create_all.side_effect = _op_error()

    with pytest.raises(OperationalError):
        init_db(max_attempts=3, base_delay_seconds=0.01)

    assert mock_base.metadata.create_all.call_count == 3
    assert mock_sleep.call_count == 2


@patch("app.database.time.sleep", return_value=None)
@patch("app.database.Base")
def test_init_db_succeeds_immediately_without_retry(mock_base, mock_sleep):
    mock_base.metadata.create_all.return_value = None

    init_db(max_attempts=5, base_delay_seconds=0.01)

    assert mock_base.metadata.create_all.call_count == 1
    assert mock_sleep.call_count == 0
