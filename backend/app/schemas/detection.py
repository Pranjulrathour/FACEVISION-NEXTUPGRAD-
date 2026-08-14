from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any

MAX_FACES_PER_DETECTION = 128


class Point(BaseModel):
    x: float
    y: float


class FaceLandmarks(BaseModel):
    rightEye: Point
    leftEye: Point
    nose: Point
    rightMouth: Point
    leftMouth: Point


class FaceBox(BaseModel):
    x: float
    y: float
    width: float
    height: float


class FaceCreate(BaseModel):
    box: FaceBox
    confidence: float
    landmarks: FaceLandmarks


class FaceResponse(BaseModel):
    id: int
    box: FaceBox
    confidence: float
    landmarks: Dict[str, Any]

    class Config:
        from_attributes = True


class DetectionCreate(BaseModel):
    id: str
    mode: str
    faceCount: int
    averageConfidence: float
    faces: List[FaceCreate] = Field(..., max_length=MAX_FACES_PER_DETECTION)
    imageName: Optional[str] = None
    userSessionId: Optional[str] = None


class DetectionResponse(BaseModel):
    id: str
    timestamp: int
    mode: str
    face_count: int
    average_confidence: float
    image_name: Optional[str] = None
    faces: List[FaceResponse] = []

    class Config:
        from_attributes = True


class DetectionListResponse(BaseModel):
    items: List[DetectionResponse]
    total: int
    limit: int
    offset: int
