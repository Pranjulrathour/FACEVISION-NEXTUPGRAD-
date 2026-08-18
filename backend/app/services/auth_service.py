from typing import Optional

from sqlalchemy.orm import Session

from app.core.auth import hash_password, new_user_id, verify_password
from app.models.user import User


class EmailAlreadyRegisteredError(Exception):
    pass


def register_user(
    db: Session, email: str, password: str, display_name: Optional[str]
) -> User:
    existing = db.query(User).filter(User.email == email).first()
    if existing:
        raise EmailAlreadyRegisteredError(email)

    user = User(
        id=new_user_id(),
        email=email,
        password_hash=hash_password(password),
        display_name=display_name,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def authenticate_user(db: Session, email: str, password: str) -> Optional[User]:
    user = db.query(User).filter(User.email == email).first()
    if not user or not verify_password(password, user.password_hash):
        # Deliberately identical failure path for "no such user" and "wrong
        # password" -- distinguishing them lets an attacker enumerate valid
        # email addresses by timing/response differences (checklist §24).
        return None
    return user
