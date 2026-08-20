from datetime import datetime
from typing import Optional

from pydantic import BaseModel, EmailStr, Field


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=8, max_length=128)
    displayName: Optional[str] = Field(default=None, max_length=100)
    anonymousSessionId: Optional[str] = Field(default=None, max_length=200)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=1, max_length=128)
    anonymousSessionId: Optional[str] = Field(default=None, max_length=200)


class DeleteAccountRequest(BaseModel):
    """Requires re-entering the password rather than relying on the bearer
    token alone -- a destructive, irreversible action shouldn't go through
    on a stolen/leaked token without the caller proving they still know
    the password, the same way most real account-deletion flows work."""

    password: str = Field(..., min_length=1, max_length=128)


class UserResponse(BaseModel):
    id: str
    email: str
    displayName: Optional[str] = None
    createdAt: datetime


class TokenResponse(BaseModel):
    accessToken: str
    tokenType: str = "bearer"
    user: UserResponse
    claimedGalleryEntries: int = 0
