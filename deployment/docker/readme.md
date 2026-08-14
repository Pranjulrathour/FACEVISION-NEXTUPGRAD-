# Docker Deployment — FaceVision

This folder contains container definitions for **development** and **production** deployments.

## File Map

| File | Purpose |
|---|---|
| `Dockerfile.frontend` | Multi-stage Next.js build (standalone output) |
| `Dockerfile.backend` | FastAPI + uvicorn on Python 3.12-slim |
| `docker-compose.dev.yml` | **PostgreSQL only** (for local frontend/backend dev) |
| `docker-compose.yml` | **Full stack**: postgres + backend + frontend + nginx |

## Architecture (Production compose)

```
                    ┌─────────────────┐
                    │      nginx      │ :80 / :443
                    └────────┬────────┘
                             │
               ┌─────────────┴─────────────┐
               │                           │
        ┌──────▼──────┐            ┌──────▼──────┐
        │  frontend   │ :3000      │   backend   │ :8000
        │  (Next.js)  │            │  (FastAPI)  │
        └─────────────┘            └──────┬──────┘
                                          │
                                   ┌──────▼──────┐
                                   │  postgres   │ :5432
                                   └─────────────┘
```

## Commands

```powershell
# ---- Development (PostgreSQL only) ----
cd deployment/docker
docker compose -f docker-compose.dev.yml up -d      # start
docker compose -f docker-compose.dev.yml logs -f    # watch logs
docker compose -f docker-compose.dev.yml down       # stop

# ---- Production (Full stack) ----
docker compose up -d --build                        # start + build
docker compose logs -f backend                      # backend logs
docker compose logs -f frontend                     # frontend logs
docker compose exec postgres psql -U facevision -d facevision   # DB shell
docker compose down                                 # stop (keep data)
docker compose down -v                              # stop + DELETE data volume
```

## Persistence

- **PostgreSQL data** lives in the named volume `facevision_postgres_data`.
- Migrations in `database/migrations` are auto-applied the **first time** the dev container starts (via `/docker-entrypoint-initdb.d/`).
- For production compose, run migrations manually or add a `depends_on` migration service.

## Image Sizes (approx.)
- `facevision-frontend`: ~250 MB (standalone Next.js build on Alpine)
- `facevision-backend`: ~450 MB (Python slim + psycopg2 build deps)
- `facevision-postgres`: ~250 MB (postgres:16-alpine)

## Custom Build Args

For the frontend image, you may inject build-time vars:
```bash
docker build \
  -f deployment/docker/Dockerfile.frontend \
  --build-arg NEXT_PUBLIC_API_URL=https://api.yourdomain.com/api \
  -t facevision-frontend:latest .
```
