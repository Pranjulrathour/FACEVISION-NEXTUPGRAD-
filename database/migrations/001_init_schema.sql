-- FaceVision Database Schema - PostgreSQL
-- Initial Migration: 001_init

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- USERS (Optional - for session tracking)
-- ============================================
CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(64) PRIMARY KEY,
    email VARCHAR(255) UNIQUE,
    display_name VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_seen_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- ============================================
-- DETECTION RECORDS
-- ============================================
CREATE TABLE IF NOT EXISTS detection_records (
    id VARCHAR(64) PRIMARY KEY,
    timestamp BIGINT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    mode VARCHAR(32) NOT NULL DEFAULT 'upload',
    face_count INTEGER NOT NULL DEFAULT 0,
    average_confidence DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    image_name VARCHAR(255),
    user_session_id VARCHAR(128),
    image_data_url TEXT
);

CREATE INDEX IF NOT EXISTS idx_detection_records_timestamp ON detection_records(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_detection_records_mode ON detection_records(mode);
CREATE INDEX IF NOT EXISTS idx_detection_records_user_session ON detection_records(user_session_id);
CREATE INDEX IF NOT EXISTS idx_detection_records_created_at ON detection_records(created_at DESC);

-- ============================================
-- FACE RECORDS (per-detection)
-- ============================================
CREATE TABLE IF NOT EXISTS face_records (
    id SERIAL PRIMARY KEY,
    detection_id VARCHAR(64) NOT NULL REFERENCES detection_records(id) ON DELETE CASCADE,
    confidence DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    box_x DOUBLE PRECISION NOT NULL DEFAULT 0,
    box_y DOUBLE PRECISION NOT NULL DEFAULT 0,
    box_width DOUBLE PRECISION NOT NULL DEFAULT 0,
    box_height DOUBLE PRECISION NOT NULL DEFAULT 0,
    landmarks JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- embedding_vector column intentionally omitted: pgvector isn't installed on the
    -- plain postgres:16-alpine image used here. To add real face-recognition embeddings,
    -- switch to the `pgvector/pgvector:pg16` image, run `CREATE EXTENSION vector;`, then
    -- `ALTER TABLE face_records ADD COLUMN embedding_vector vector(128);`.
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_face_records_detection_id ON face_records(detection_id);
CREATE INDEX IF NOT EXISTS idx_face_records_confidence ON face_records(confidence DESC);

-- ============================================
-- FACE GALLERY (known faces for recognition)
-- ============================================
CREATE TABLE IF NOT EXISTS face_gallery (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    user_session_id VARCHAR(128),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_face_gallery_user_session ON face_gallery(user_session_id);

-- ============================================
-- GALLERY FACE SAMPLES
-- ============================================
CREATE TABLE IF NOT EXISTS gallery_face_samples (
    id SERIAL PRIMARY KEY,
    gallery_id INTEGER NOT NULL REFERENCES face_gallery(id) ON DELETE CASCADE,
    landmarks JSONB NOT NULL DEFAULT '{}'::jsonb,
    box_coords JSONB NOT NULL DEFAULT '{}'::jsonb,
    sample_image_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_gallery_face_samples_gallery_id ON gallery_face_samples(gallery_id);

-- ============================================
-- SETTINGS (per user/session)
-- ============================================
CREATE TABLE IF NOT EXISTS app_settings (
    id SERIAL PRIMARY KEY,
    user_session_id VARCHAR(128) UNIQUE NOT NULL,
    settings JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- SUMMARY VIEWS
-- ============================================
CREATE OR REPLACE VIEW daily_detection_stats AS
SELECT
    DATE(created_at) as day,
    COUNT(*) as detection_count,
    COALESCE(SUM(face_count), 0) as total_faces,
    COALESCE(AVG(average_confidence), 0) as avg_confidence,
    COUNT(CASE WHEN mode = 'camera' THEN 1 END) as camera_count,
    COUNT(CASE WHEN mode = 'upload' THEN 1 END) as upload_count
FROM detection_records
GROUP BY DATE(created_at)
ORDER BY day DESC;

-- ============================================
-- UPDATED_AT TRIGGER
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_face_gallery_updated_at ON face_gallery;
CREATE TRIGGER trg_update_face_gallery_updated_at
    BEFORE UPDATE ON face_gallery
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_update_app_settings_updated_at ON app_settings;
CREATE TRIGGER trg_update_app_settings_updated_at
    BEFORE UPDATE ON app_settings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
