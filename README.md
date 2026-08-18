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

The frontend ships with 6 integrated panels:

1. **Workspace** — Upload or live camera. Face cards with confidence badges. Export annotated PNG. Compare A/B slot chips, Enroll/Recognize actions.
2. **History** — Thumbnail timeline of the last 100 detections; click to reload any previous result.
3. **Stats** — 4 KPI cards + 7-day bar chart of faces detected per day.
4. **Compare** — Landmark-cosine similarity between two selected faces. Two slots, adjustable threshold, animated match meter.
5. **Gallery** — Enroll a detected face under a name (real SFace embedding, not an image), then recognize it in future detections. See [ADR 0002](docs/adr/0002-sface-embeddings-for-gallery-recognition.md) for how this differs from Compare.
6. **Settings** — Toggle history, labels, landmarks, custom frame/landmark colors, compare threshold.

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

Routes are versioned under `/api/v1` (canonical). The unversioned `/api/...` paths still work
identically but return a `Deprecation: true` header + `Link` pointer to the `/v1` replacement —
kept for backward compatibility, not recommended for new integrations.

| Method | Route (v1) | Description |
|---|---|---|
| `GET` | `/api/v1/health` | Liveness check |
| `POST` | `/api/v1/detections` | Store a detection (faces + metadata) |
| `GET` | `/api/v1/detections?limit=&offset=&mode=` | Paginated list |
| `GET` | `/api/v1/detections/{id}` | One record with faces |
| `DELETE` | `/api/v1/detections/{id}` | Delete one record |
| `GET` | `/api/v1/history` | Alias + filtering |
| `DELETE` | `/api/v1/history` | Clear all history |
| `GET` | `/api/v1/stats` | KPI summary + 7-day trend |
| `POST` | `/api/v1/compare` | Landmark cosine similarity match (Compare panel) |
| `POST` | `/api/v1/gallery/enroll` | Enroll an SFace embedding under a name (Gallery panel) |
| `GET` | `/api/v1/gallery` | List enrolled identities |
| `DELETE` | `/api/v1/gallery/{id}` | Remove an enrolled identity |
| `POST` | `/api/v1/gallery/recognize` | Match an embedding against the gallery |

Interactive Swagger UI: http://localhost:8000/docs

### Security & rate limiting

| Env var | Default | Effect |
|---|---|---|
| `API_KEY` | unset (disabled) | When set, `X-API-Key` is required on `POST /api/v1/detections`, `DELETE /api/v1/detections/{id}`, and `DELETE /api/v1/history` (and their deprecated `/api/...` aliases) |
| `DETECTIONS_RATE_LIMIT_PER_MIN` | `30` | Per-IP limit on `POST /api/v1/detections` |
| `COMPARE_RATE_LIMIT_PER_MIN` | `30` | Per-IP limit on `POST /api/v1/compare` |
| `RETENTION_DAYS` | unset (disabled) | If set, `python backend/scripts/purge_old_detections.py` deletes detections older than this many days. See [docs/privacy-retention-policy.md](docs/privacy-retention-policy.md). |

Set `API_KEY` before any real deployment — it is intentionally a no-op in local dev so the anonymous-write flow keeps working out of the box. All backend configuration is centralized in [backend/app/core/config.py](backend/app/core/config.py).

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

CI also runs `npm audit --audit-level=high` and `pip-audit -r requirements.txt --strict` on every push — dependency CVEs fail the build, not just a manual check.

### Load testing

```powershell
k6 run deployment/scripts/load-test.js
# against a different host:
k6 run -e BASE_URL=http://localhost:8000 deployment/scripts/load-test.js
```

Ramps to 20 virtual users hitting `/api/v1/health`, `/api/v1/detections`, and `/api/v1/stats`; asserts p95 latency < 500ms and a <1% hard-failure rate (429s from the rate limiter are treated as expected, not failures).

## Known Limitations

- **No auth by default.** `API_KEY` is opt-in (see [Security & rate limiting](#security--rate-limiting)) — set it before deploying anywhere public.
- **Single-node Postgres.** No replication/failover configured; back up the `facevision_postgres_data` volume yourself.
- **`users`/`app_settings` remain reserved-but-unused** — `face_gallery`/`gallery_face_samples` are now active (see [ADR 0002](docs/adr/0002-sface-embeddings-for-gallery-recognition.md)), but no real user-account system exists; gallery entries are scoped by anonymous session ID, same as detection history.
- **Rate limiting is in-memory, per-process.** Fine for a single backend instance; won't share limits across multiple replicas — swap for a Redis-backed limiter before horizontally scaling.
- **Passive liveness signal is heuristic, not certified.** See [docs/face-detection-verification-checklist.md §11](docs/face-detection-verification-checklist.md#11-liveness-detection) — do not rely on it for any security decision.
- **"Compare" is landmark-geometry similarity, not face recognition** — the Gallery panel's enroll/recognize feature is real embedding-based recognition instead. See [ADR 0001](docs/adr/0001-landmark-similarity-vs-embeddings.md) and [ADR 0002](docs/adr/0002-sface-embeddings-for-gallery-recognition.md).
- **Gallery recognition is a linear scan**, not a vector index (pgvector/FAISS) — fine at personal scale, would need revisiting for a large number of enrolled identities.
- **`POST /api/v1/gallery/recognize` is intentionally not gated behind `API_KEY`** (a visitor needs to check faces against the gallery to use the feature) — it's rate-limited instead.

Full engineering checklist, gap analysis, and honest production-readiness assessment: [docs/face-detection-verification-checklist.md](docs/face-detection-verification-checklist.md).

## Deployment Documentation

- **Full guide:** [`deployment/deployment.md`](deployment/deployment.md)
- **Docker / compose:** [`deployment/docker/readme.md`](deployment/docker/readme.md)
- **Postgres schema:** [`database/readme.md`](database/readme.md)
- **FastAPI backend:** [`backend/readme.md`](backend/readme.md)

## Deploy to Railway

Three services in one Railway project: managed Postgres, backend, frontend. Each app service uses its own `railway.toml` + `Dockerfile` committed at its package root — Railway just needs the right **Root Directory** set per service.

### 1. Database
- New → Database → **PostgreSQL** (Railway's managed plugin). No Dockerfile needed.
- Copy the plugin's `DATABASE_URL` reference variable for the backend service below.

### 2. Backend service
- New → GitHub Repo → this repo, set **Root Directory** = `backend`.
- Railway auto-detects [`backend/railway.toml`](backend/railway.toml) → builds [`backend/Dockerfile`](backend/Dockerfile).
- Environment variables:

  | Variable | Value |
  |---|---|
  | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (Railway variable reference to the Postgres plugin) |
  | `API_KEY` | a real secret — required for production, see [Security & rate limiting](#security--rate-limiting) |
  | `CORS_ORIGINS` | the frontend service's public URL once it exists, e.g. `https://facevision-frontend.up.railway.app` |
  | `DETECTIONS_RATE_LIMIT_PER_MIN` / `COMPARE_RATE_LIMIT_PER_MIN` | optional, default `30` |

  `PORT` is injected automatically by Railway — `run.py` already reads it. The legacy `postgres://` scheme some Railway plugins emit is normalized automatically (see `app/database.py`).
- Health check: `/api/health` (already wired via `railway.toml`).
- First deploy creates `detection_records` + `face_records` via SQLAlchemy `create_all()` on startup — the full SQL migration (extra reserved tables, views, triggers) is optional and only needed if you extend those features; apply it manually with `psql "$DATABASE_URL" -f database/migrations/001_init_schema.sql` if you want it.

### 3. Frontend service
- New → GitHub Repo → this repo again, set **Root Directory** = `frontend`.
- Railway auto-detects [`frontend/railway.toml`](frontend/railway.toml) → builds [`frontend/Dockerfile`](frontend/Dockerfile).
- Build-time variable (not just runtime — it's inlined into the JS bundle): `NEXT_PUBLIC_API_URL` = the backend service's public URL + `/api`, e.g. `https://facevision-backend.up.railway.app/api`.
- Health check: `/` (already wired via `railway.toml`).
- `PORT` is injected automatically; Next's standalone server reads it directly.

### Order matters
Deploy backend first (get its public URL) → set it as `NEXT_PUBLIC_API_URL` on the frontend → deploy frontend (get its public URL) → set it as `CORS_ORIGINS` on the backend → redeploy the backend once so CORS picks it up.

## License

Private build for Pranjul Rathour.
