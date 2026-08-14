from fastapi import APIRouter

router = APIRouter()


@router.get("/health")
def health_check():
    return {"status": "ok", "service": "FaceVision API"}


@router.get("/ping")
def ping():
    return {"ping": "pong"}
