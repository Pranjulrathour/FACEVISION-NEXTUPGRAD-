from pydantic import BaseModel
from typing import List, Optional

from app.schemas.detection import FaceBox, FaceLandmarks


class DailyStat(BaseModel):
    day: str
    count: int


class StatsSummary(BaseModel):
    totalDetections: int
    totalFacesDetected: int
    avgConfidence: float
    topMode: Optional[str]
    detectionHistory: List[DailyStat]


class ComparableFace(BaseModel):
    box: FaceBox
    landmarks: FaceLandmarks


class CompareRequest(BaseModel):
    faceA: ComparableFace
    faceB: ComparableFace
    threshold: float = 0.78


class CompareResponse(BaseModel):
    similarity: float
    isMatch: bool
    threshold: float
