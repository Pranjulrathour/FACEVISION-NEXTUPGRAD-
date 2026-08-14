from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from typing import Optional

from app.database import get_db
from app.services import stats_service
from app.schemas.stats import StatsSummary

router = APIRouter()


@router.get("", response_model=StatsSummary)
def get_stats(
    userSessionId: Optional[str] = Query(None, alias="userSessionId"),
    db: Session = Depends(get_db),
):
    return stats_service.get_summary(db, user_session_id=userSessionId)
