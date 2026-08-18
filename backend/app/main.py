import logging
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.core.config import get_settings
from app.routers import detection, history, stats, face_compare, health
from app.database import init_db

logger = logging.getLogger("facevision")
logging.basicConfig(level=logging.INFO)

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(
    title="FaceVision API",
    description="Private face detection backend with FastAPI + PostgreSQL",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def log_requests(request: Request, call_next):
    start = time.monotonic()
    response = await call_next(request)
    duration_ms = (time.monotonic() - start) * 1000
    logger.info(
        "%s %s -> %s (%.1fms)",
        request.method,
        request.url.path,
        response.status_code,
        duration_ms,
    )
    return response


app.include_router(health.router, prefix="/api", tags=["health"])
app.include_router(detection.router, prefix="/api/detections", tags=["detections"])
app.include_router(history.router, prefix="/api/history", tags=["history"])
app.include_router(stats.router, prefix="/api/stats", tags=["stats"])
app.include_router(face_compare.router, prefix="/api/compare", tags=["compare"])


@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    logger.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error"},
    )
