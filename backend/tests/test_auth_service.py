import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models.user import User  # noqa: F401
from app.services import auth_service
from app.services.auth_service import EmailAlreadyRegisteredError


@pytest.fixture()
def db():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    try:
        yield session
    finally:
        session.close()


def test_register_user_creates_a_user_with_a_hashed_password(db):
    user = auth_service.register_user(db, "alice@example.com", "correct-password", "Alice")
    assert user.email == "alice@example.com"
    assert user.password_hash != "correct-password"


def test_register_user_rejects_a_duplicate_email(db):
    auth_service.register_user(db, "alice@example.com", "password1", "Alice")
    with pytest.raises(EmailAlreadyRegisteredError):
        auth_service.register_user(db, "alice@example.com", "password2", "Alice Two")


def test_authenticate_user_succeeds_with_correct_credentials(db):
    auth_service.register_user(db, "alice@example.com", "correct-password", "Alice")
    user = auth_service.authenticate_user(db, "alice@example.com", "correct-password")
    assert user is not None
    assert user.email == "alice@example.com"


def test_authenticate_user_fails_with_wrong_password(db):
    auth_service.register_user(db, "alice@example.com", "correct-password", "Alice")
    assert auth_service.authenticate_user(db, "alice@example.com", "wrong-password") is None


def test_authenticate_user_fails_for_nonexistent_email(db):
    assert auth_service.authenticate_user(db, "nobody@example.com", "anything") is None
