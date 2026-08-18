from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.auth import create_access_token, require_current_user
from app.core.rate_limit import rate_limiter
from app.database import get_db
from app.models.user import User
from app.schemas.auth import LoginRequest, RegisterRequest, TokenResponse, UserResponse
from app.services import auth_service
from app.services.auth_service import EmailAlreadyRegisteredError

router = APIRouter()
# Auth endpoints are prime brute-force/enumeration targets (checklist §24)
# -- rate limit tighter than the general write endpoints.
_auth_rate_limit = rate_limiter("AUTH_RATE_LIMIT_PER_MIN", default=10)


def _to_user_response(user: User) -> UserResponse:
    return UserResponse(
        id=user.id,
        email=user.email,
        displayName=user.display_name,
        createdAt=user.created_at,
    )


@router.post("/register", response_model=TokenResponse, dependencies=[Depends(_auth_rate_limit)])
def register(payload: RegisterRequest, db: Session = Depends(get_db)):
    try:
        user = auth_service.register_user(db, payload.email, payload.password, payload.displayName)
    except EmailAlreadyRegisteredError:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")
    token = create_access_token(user.id)
    return TokenResponse(accessToken=token, user=_to_user_response(user))


@router.post("/login", response_model=TokenResponse, dependencies=[Depends(_auth_rate_limit)])
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    user = auth_service.authenticate_user(db, payload.email, payload.password)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")
    token = create_access_token(user.id)
    return TokenResponse(accessToken=token, user=_to_user_response(user))


@router.get("/me", response_model=UserResponse)
def me(current_user: User = Depends(require_current_user)):
    return _to_user_response(current_user)
