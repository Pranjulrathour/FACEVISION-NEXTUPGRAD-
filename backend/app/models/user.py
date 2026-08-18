from sqlalchemy import Column, String, DateTime
from datetime import datetime

from app.database import Base


class User(Base):
    """Real user accounts (checklist §15, §16) — activates the previously
    unused `users` table. Registration is optional: the app still works
    fully anonymously via user_session_id, same as before. An authenticated
    user gets their gallery/detection data scoped to a real, non-guessable
    identity instead of a client-supplied session ID."""

    __tablename__ = "users"

    id = Column(String(64), primary_key=True)
    email = Column(String(255), unique=True, index=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    display_name = Column(String(100), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    last_seen_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
