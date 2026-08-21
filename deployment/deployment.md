# Deployment Guide — FaceVision

## Overview

FaceVision consists of three components:
- **Frontend** — Next.js 16 web UI (browser-based ONNX face detection)
- **Backend** — FastAPI + PostgreSQL (detection history, stats, face comparison)
- **Database** — PostgreSQL 16 (detection records, gallery, settings)

## Quick Start (Development)

### Prerequisites
- Docker Desktop / Docker Engine 24+
- Node.js 20+ (for local frontend runs)
- Python 3.12+ (for local backend runs)
- PostgreSQL client tools (`psql`) for manual migrations

### 1. Start PostgreSQL (docker)

```powershell
cd deployment/docker
docker compose -f docker-compose.dev.yml up -d
```

Verify PostgreSQL is ready:
```powershell
docker logs facevision-postgres-dev --tail 5
```

### 2. Apply database migrations

```powershell
# Option A: via psql script
.\deployment\scripts\migrate.ps1

# Option B: via docker exec
docker exec -i facevision-postgres-dev psql -U facevision -d facevision < database/migrations/001_init_schema.sql
docker exec -i facevision-postgres-dev psql -U facevision -d facevision < database/seeders/001_demo_data.sql
```

### 3. Start the backend (local)

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env
python run.py
```

Health check: http://localhost:8000/api/health

### 4. Start the frontend (local)

```powershell
cd frontend
npm install
npm run dev
```

Visit: http://localhost:3000

## Full Docker Deployment (Production)

```powershell
# One command to start everything:
.\deployment\scripts\start.ps1 -Env prod
```

Or manually:
```powershell
cd deployment/docker
docker compose up -d --build
```

Services:
- Frontend (Nginx): http://localhost
- Frontend (direct): http://localhost:3000
- Backend API: http://localhost:8000/api
- Swagger Docs: http://localhost:8000/docs

### Stop all services

```powershell
.\deployment\scripts\stop.ps1 -Env prod
```

## Environment Variables

### Backend (`backend/.env`)

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | `postgresql+psycopg2://facevision:facevision@localhost:5432/facevision` | PostgreSQL connection |
| `HOST` | `0.0.0.0` | Bind address |
| `PORT` | `8000` | Server port |
| `CORS_ORIGINS` | `http://localhost:3000` | Allowed origins (comma-separated) |

### Frontend (`.env.local`)

| Variable | Default | Description |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `http://localhost:8000/api` | Backend API base URL |
| `NEXT_PUBLIC_ENABLE_HISTORY_SYNC` | `true` | Sync detection history to backend |

### Database (`database/.env`)

| Variable | Default | Description |
|---|---|---|
| `POSTGRES_USER` | `facevision` | Database role |
| `POSTGRES_PASSWORD` | `facevision` | Role password |
| `POSTGRES_DB` | `facevision` | Default database |
| `POSTGRES_PORT` | `5432` | Exposed port |

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/health` | Service health check |
| `POST` | `/api/detections` | Save a new detection record |
| `GET` | `/api/detections` | List detection records (paginated) |
| `GET` | `/api/detections/{id}` | Get one detection with faces |
| `DELETE` | `/api/detections/{id}` | Delete a detection record |
| `GET` | `/api/history` | Detection history alias |
| `DELETE` | `/api/history` | Clear all history |
| `GET` | `/api/stats` | Aggregated detection stats |

## Database Schema

### Core Tables
- **detection_records** — each detection run (upload/camera frame)
- **face_records** — individual faces per detection with bbox + landmarks
- **face_gallery** — named known-face entries
- **gallery_face_samples** — reference samples per gallery entry
- **app_settings** — per-session preferences (JSON)
- **users** — optional user accounts

### Views
- **daily_detection_stats** — daily rollup of counts/modes/averages

See full schema: `database/migrations/001_init_schema.sql`

## Production Checklist

- [ ] Change default database password
- [ ] Enable HTTPS (add SSL cert + update nginx config)
- [ ] Set `CORS_ORIGINS` to your production domain
- [ ] Enable `pgvector` extension if you want to use face embeddings
- [ ] Persist `postgres_data` volume (backup strategy)
- [ ] Use `NEXT_PUBLIC_API_URL` pointing to your TLS-secured backend
- [ ] Set `NODE_ENV=production` (already done in Dockerfile)
- [ ] Add rate limiting / authentication for write endpoints

## Troubleshooting

### PostgreSQL: connection refused
Wait 10–15 seconds after starting the container, or run the healthcheck:
```powershell
docker inspect --format='{{.State.Health.Status}}' facevision-postgres-dev
```

### ONNX model fails to load in the browser
- Ensure `frontend/public/models/face_detection_yunet_2023mar.onnx` exists
- Check browser console for CORS errors
- Nginx caches `.onnx` files for 30 days; clear cache if the model changes

### WebGPU not available
The detector automatically degrades from WebGPU → WASM. Check the runtime badge in the UI.
