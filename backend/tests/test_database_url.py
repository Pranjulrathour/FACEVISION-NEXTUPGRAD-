from app.database import normalize_database_url


def test_rewrites_legacy_postgres_scheme():
    url = "postgres://user:pass@host:5432/db"
    assert normalize_database_url(url) == "postgresql://user:pass@host:5432/db"


def test_leaves_postgresql_scheme_untouched():
    url = "postgresql+psycopg2://user:pass@host:5432/db"
    assert normalize_database_url(url) == url


def test_leaves_sqlite_url_untouched():
    url = "sqlite:///:memory:"
    assert normalize_database_url(url) == url
