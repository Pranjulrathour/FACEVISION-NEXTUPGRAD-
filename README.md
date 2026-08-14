# FaceVision · Private On-Device Face Detection

```
███████╗░█████╗░░█████╗░███████╗██╗░░░██╗██╗░██████╗██╗░█████╗░███╗░░██╗
██╔════╝██╔══██╗██╔══██╗██╔════╝██║░░░██║██║██╔════╝██║██╔══██╗████╗░██║
█████╗░░███████║██║░░╚═╝█████╗░░╚██╗░██╔╝██║╚█████╗░██║██║░░██║██╔██╗██║
██╔══╝░░██╔══██║██║░░██╗██╔══╝░░░╚████╔╝░██║░╚═══██╗██║██║░░██║██║╚████║
██║░░░░░██║░░██║╚█████╔╝███████╗░░╚██╔╝░░██║██████╔╝██║╚█████╔╝██║░╚███║
╚═╝░░░░░╚═╝░░╚═╝░╚════╝░╚══════╝░░░╚═╝░░░╚═╝╚═════╝░╚═╝░╚════╝░╚═╝░░╚══╝
```

> Privacy-first browser-side face detection powered by YuNet (ONNX Runtime Web with WebGPU + WASM fallback).

## Architecture

| Layer | Stack |
|-------|-------|
| **Frontend** | Next.js 16 · React 19 · TypeScript · Tailwind CSS · ONNX Runtime Web |
| **Backend** | FastAPI · Uvicorn · SQLAlchemy 2 |
| **Database** | PostgreSQL 16 · pgvector-ready · Alembic |
| **Detector** | `face_detection_yunet_2023mar.onnx` — 640×640 input · WebGPU primary, WASM fallback |
| **Deployment** | Docker · nginx reverse proxy · multi-stage builds |

Directory layout:

```
FACEVISION/
├── frontend/        # Next.js web app (browser-side detection)
├── backend/         # FastAPI server (history / stats / face comparison)
├── database/        # PostgreSQL migrations, seeders, alembic
└── deployment/      # Dockerfiles, compose files, nginx, scripts, docs
```

## Privacy First

FaceVision runs the YuNet ONNX model **entirely inside your browser**. Images from your camera or hard drive **never leave the device**.

The FastAPI backend stores **metadata only**:
- Bounding-box geometry (x, y, width, height)
- 5-point landmark positions (eyes / nose / mouth corners)
- Confidence scores
- Optional image name (not the image itself)
- Aggregate statistics

You can disable history persistence entirely from the **Settings** panel.

## Live UI Features

The frontend ships with 5 integrated panels:

1. **Workspace** — Upload or live camera. Face cards with confidence badges. Export annotated PNG. Compare A/B slot chips.
2. **History** — Thumbnail timeline of the last 100 detections; click to reload any previous result.
3. **Stats** — 4 KPI cards + 7-day bar chart of faces detected per day.
4. **Compare** — Landmark-cosine similarity. Two slots, adjustable threshold, animated match meter.
5. **Settings** — Toggle history, labels, landmarks, custom frame/landmark colors, compare threshold.

## Quick Start (Local Dev)

### 1. PostgreSQL (docker, one command)

```powershell
cd deployment/docker
docker compose -f docker-compose.dev.yml up -d
```

Connection string: `postgresql+psycopg2://facevision:facevision@localhost:5432/facevision`

### 2. Backend (FastAPI)

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env
python run.py
# -> http://localhost:8000/docs
```

### 3. Frontend (Next.js)

```powershell
cd frontend
npm install
npm run dev
# -> http://localhost:3000
```

### 4. Full stack (docker)

```powershell
.\deployment\scripts\start.ps1 -Env prod
```

## Model Details

| Property | Value |
|---|---|
| Model file | `frontend/public/models/face_detection_yunet_2023mar.onnx` |
| Input shape | `1 × 3 × 640 × 640` (NCHW) |
| Execution providers | WebGPU → auto degrade → WASM |
| Min input size | 128 px (smaller faces may be missed) |
| 5 landmarks | Right eye · Left eye · Nose · Right mouth corner · Left mouth corner |

*Tensor dimension is locked to 640×640. 320×320 will fail immediately. See [`frontend/src/lib/yunet.ts`](file:///d:/PABLO%20ESCOBAR/FACEVISION/frontend/src/lib/yunet.ts)*

## Backend API

| Method | Route | Description |
|---|---|---|
| `GET` | `/api/health` | Liveness check |
| `POST` | `/api/detections` | Store a detection (faces + metadata) |
| `GET` | `/api/detections?limit=&offset=&mode=` | Paginated list |
| `GET` | `/api/detections/{id}` | One record with faces |
| `DELETE` | `/api/detections/{id}` | Delete one record |
| `GET` | `/api/history` | Alias + filtering |
| `DELETE` | `/api/history` | Clear all history |
| `GET` | `/api/stats` | KPI summary + 7-day trend |
| `POST` | `/api/compare` | Landmark cosine similarity match |

Interactive Swagger UI: http://localhost:8000/docs

## Verification

```powershell
# Frontend
cd frontend
npm run typecheck     # TypeScript (strict)
npm run lint          # ESLint
npm test              # Vitest unit tests

# Backend
cd backend
pip install -r requirements.txt
pytest -v
```

## Deployment Documentation

- **Full guide:** [`deployment/DEPLOYMENT.md`](file:///d:/PABLO%20ESCOBAR/FACEVISION/deployment/DEPLOYMENT.md)
- **Docker / compose:** [`deployment/docker/README.md`](file:///d:/PABLO%20ESCOBAR/FACEVISION/deployment/docker/README.md)
- **Postgres schema:** [`database/README.md`](file:///d:/PABLO%20ESCOBAR/FACEVISION/database/README.md)
- **FastAPI backend:** [`backend/README.md`](file:///d:/PABLO%20ESCOBAR/FACEVISION/backend/README.md)

## License

Private build for Pranjul Rathour.
