from fastapi import APIRouter
from app.services import face_compare_service
from app.schemas.stats import CompareRequest, CompareResponse

router = APIRouter()


@router.post("", response_model=CompareResponse)
def compare(payload: CompareRequest):
    return face_compare_service.compare_faces(
        payload.faceA.model_dump(), payload.faceB.model_dump(), payload.threshold
    )
