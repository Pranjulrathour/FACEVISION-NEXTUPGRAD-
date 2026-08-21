from pydantic import BaseModel
from typing import List, Optional


class DailyStat(BaseModel):
    day: str
    count: int


class StatsSummary(BaseModel):
    totalDetections: int
    totalFacesDetected: int
    avgConfidence: float
    topMode: Optional[str]
    detectionHistory: List[DailyStat]
