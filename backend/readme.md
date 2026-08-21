# Backend API — FaceVision

FastAPI backend that stores detection history, aggregates statistics, and exposes a landmark-based face comparison endpoint.

## Local Run

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env
python run.py
```

- Swagger UI:  http://localhost:8000/docs
- ReDoc:      http://localhost:8000/redoc
- OpenAPI:    http://localhost:8000/openapi.json
- Health:     http://localhost:8000/api/health

## Project Structure

```
backend/
├── app/
│   ├── main.py                 # FastAPI app + lifespan + CORS
│   ├── database.py             # SQLAlchemy engine + session
│   ├── models/detection.py     # ORM: DetectionRecord, FaceRecord
│   ├── schemas/                # Pydantic request/response models
│   ├── services/
│   │   ├── detection_service.py
│   │   └── stats_service.py
│   └── routers/
│       ├── health.py           # /api/health, /api/ping
│       ├── detection.py        # CRUD /api/detections
│       ├── history.py          # alias + clear /api/history
│       └── stats.py            # /api/stats
├── tests/
│   ├── test_health.py
│   └── test_stats_service.py
├── run.py                      # uvicorn launcher
├── requirements.txt
└── .env.example
```

## Workflow — saving a detection

1. Frontend runs YuNet ONNX model entirely in the browser (no image leaves the device).
2. Frontend POSTs the metadata only (bboxes, landmarks, counts, confidences, optional image name) to:
   `POST /api/detections`
3. Backend stores rows in `detection_records` + `face_records`.
4. Stats endpoints aggregate from these tables in real-time.

## Testing

```powershell
cd backend
pip install -r requirements.txt
pytest -v
```
