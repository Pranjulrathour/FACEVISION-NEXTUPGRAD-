from fastapi import APIRouter, Depends
from app.core.rate_limit import rate_limiter
from app.services import face_compare_service
from app.schemas.stats import CompareRequest, CompareResponse

router = APIRouter()
_compare_rate_limit = rate_limiter("COMPARE_RATE_LIMIT_PER_MIN", default=30)


@router.post("", response_model=CompareResponse, dependencies=[Depends(_compare_rate_limit)])
def compare(payload: CompareRequest):
    return face_compare_service.compare_faces(
        payload.faceA.model_dump(), payload.faceB.model_dump(), payload.threshold
    )
