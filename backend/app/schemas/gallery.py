from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field

# SFace produces 128-dimension embeddings (see frontend/src/lib/sface.ts).
# Enforced here so a malformed/wrong-model embedding is rejected at the API
# boundary rather than silently stored and producing nonsense similarity
# scores later.
EMBEDDING_DIMENSION = 128

# SFace's own calibrated cosine-similarity operating point (OpenCV Zoo's
# demo.py), not a value tuned by this app.
DEFAULT_MATCH_THRESHOLD = 0.363


class EnrollRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    embedding: List[float] = Field(..., min_length=EMBEDDING_DIMENSION, max_length=EMBEDDING_DIMENSION)
    modelVersion: Optional[str] = None
    userSessionId: Optional[str] = None


class GalleryEntryResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True, protected_namespaces=())

    id: int
    name: str
    sampleCount: int
    createdAt: datetime
    updatedAt: datetime


class GalleryListResponse(BaseModel):
    items: List[GalleryEntryResponse]
    total: int


class RecognizeRequest(BaseModel):
    embedding: List[float] = Field(..., min_length=EMBEDDING_DIMENSION, max_length=EMBEDDING_DIMENSION)
    userSessionId: Optional[str] = None
    threshold: float = DEFAULT_MATCH_THRESHOLD


class RecognizeResponse(BaseModel):
    matched: bool
    name: Optional[str] = None
    similarity: float
    galleryEntryId: Optional[int] = None
    threshold: float
