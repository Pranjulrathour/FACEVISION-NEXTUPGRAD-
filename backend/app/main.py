import logging
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.core.config import get_settings
from app.core.metrics import record_request
from app.routers import auth, detection, history, stats, gallery, health, metrics
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

API_V1_PREFIX = "/api/v1"
LEGACY_API_PREFIX = "/api"


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
    # A path-templated key (e.g. "/api/v1/detections/{detection_id}"), not
    # the literal request path -- otherwise every distinct detection ID
    # would fragment metrics into its own bucket. Built from path_params
    # rather than the matched route's own .path, since that reflects the
    # sub-router's un-prefixed template ("/{detection_id}") in this
    # FastAPI version's lazy router-inclusion, not the full mounted path.
    # Falls back to the literal path when nothing matched (404s), capped
    # in record_request() so that can't grow without bound under scanner
    # traffic.
    templated_path = request.url.path
    for param_name, param_value in (request.scope.get("path_params") or {}).items():
        templated_path = templated_path.replace(f"/{param_value}", f"/{{{param_name}}}", 1)
    route_key = f"{request.method} {templated_path}"
    record_request(route_key, duration_ms, response.status_code)
    return response


@app.middleware("http")
async def deprecate_unversioned_routes(request: Request, call_next):
    """Mark the pre-v1 unversioned paths (/api/...) as deprecated (§14)
    without breaking them — anything already integrated against the old
    paths keeps working, but gets a standard Deprecation header (RFC 8594)
    pointing at the v1 replacement, plus a one-line server log so usage of
    the legacy paths is visible without needing client-side telemetry."""
    path = request.url.path
    is_legacy = path.startswith(LEGACY_API_PREFIX) and not path.startswith(API_V1_PREFIX)
    response = await call_next(request)
    if is_legacy:
        v1_path = API_V1_PREFIX + path[len(LEGACY_API_PREFIX):]
        response.headers["Deprecation"] = "true"
        response.headers["Link"] = f'<{v1_path}>; rel="successor-version"'
        logger.warning("Deprecated unversioned route called: %s %s (use %s)", request.method, path, v1_path)
    return response


for prefix in (API_V1_PREFIX, LEGACY_API_PREFIX):
    app.include_router(health.router, prefix=prefix, tags=["health"])
    app.include_router(metrics.router, prefix=f"{prefix}/metrics", tags=["metrics"])
    app.include_router(detection.router, prefix=f"{prefix}/detections", tags=["detections"])
    app.include_router(history.router, prefix=f"{prefix}/history", tags=["history"])
    app.include_router(stats.router, prefix=f"{prefix}/stats", tags=["stats"])
    app.include_router(gallery.router, prefix=f"{prefix}/gallery", tags=["gallery"])
    app.include_router(auth.router, prefix=f"{prefix}/auth", tags=["auth"])


@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    logger.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error"},
    )
