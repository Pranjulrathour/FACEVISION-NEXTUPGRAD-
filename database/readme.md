# Database Guide — FaceVision

## Schema Overview

```
users ──────────────────────────────────────────┐
                                                 │
detection_records (id PK, mode, face_count, …)  │
    ├── user_session_id  ────────────────────────┘
    └─○ face_records (detection_id FK, box*, landmarks JSONB)

face_gallery (name, user_session_id)
    └─○ gallery_face_samples (gallery_id FK, landmarks, bbox)

app_settings (user_session_id UNIQUE, settings JSONB)

daily_detection_stats (VIEW: date → count / faces / modes)
```

## Setup (local)

### Option A — Docker (recommended)

```powershell
cd deployment/docker
docker compose -f docker-compose.dev.yml up -d
```

Connection string:
```
postgresql+psycopg2://facevision:facevision@localhost:5432/facevision
```

### Option B — Native PostgreSQL

1. Install PostgreSQL 16+
2. Create role + database:
   ```sql
   CREATE ROLE facevision WITH LOGIN PASSWORD 'facevision';
   CREATE DATABASE facevision OWNER facevision;
   ```
3. Apply migrations (see below)

## Migrations

SQL files live in `database/migrations/`. Apply in order.

### PowerShell script

```powershell
.\deployment\scripts\migrate.ps1 001_init_schema.sql
```

### Manual via psql

```powershell
$env:PGPASSWORD = "facevision"
psql -h localhost -U facevision -d facevision -f database/migrations/001_init_schema.sql
```

### Optional: seed demo data

```powershell
psql -h localhost -U facevision -d facevision -f database/seeders/001_demo_data.sql
```

## Verify

```sql
-- Check tables exist
SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';

-- Row counts
SELECT
  'detection_records' AS t, count(*) FROM detection_records
UNION ALL SELECT 'face_records', count(*) FROM face_records
UNION ALL SELECT 'face_gallery', count(*) FROM face_gallery;

-- Daily stats view
SELECT * FROM daily_detection_stats LIMIT 7;
```

## Column Reference — `face_records.landmarks` (JSONB)

```json
{
  "rightEye":  { "x": 180.0, "y": 170.0 },
  "leftEye":   { "x": 260.0, "y": 168.0 },
  "nose":      { "x": 220.0, "y": 210.0 },
  "rightMouth":{ "x": 185.0, "y": 270.0 },
  "leftMouth": { "x": 255.0, "y": 268.0 }
}
```

## Backups

```powershell
# Create a backup
docker exec facevision-postgres-dev pg_dump -U facevision facevision > backup.sql

# Restore
docker exec -i facevision-postgres-dev psql -U facevision -d facevision < backup.sql
```

## Future: pgvector embeddings

The `face_records.embedding_vector vector(128)` column is already reserved.
When you want true face recognition instead of landmark similarity:

1. Install the extension:
   ```sql
   CREATE EXTENSION vector;
   ```
2. Produce 128-D face embeddings via `facenet-pytorch` / `insightface` in the backend service.
3. Query:
   ```sql
   SELECT id, 1 - (embedding_vector <=> $1) AS similarity
   FROM face_records
   ORDER BY similarity DESC
   LIMIT 5;
   ```
