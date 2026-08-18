-- FaceVision Database Schema - PostgreSQL
-- Migration: 003_gallery_embeddings
--
-- Activates the previously-unused face_gallery / gallery_face_samples
-- tables (see 001_init_schema.sql) for real enroll+recognize identity
-- matching (checklist §2, §28). The original gallery_face_samples columns
-- (landmarks, box_coords, sample_image_url) anticipated a different,
-- never-built design; this adds what the actual SFace-embedding-based
-- implementation needs alongside them, without dropping the old columns.

ALTER TABLE gallery_face_samples
    ADD COLUMN IF NOT EXISTS embedding JSONB,
    ADD COLUMN IF NOT EXISTS model_version VARCHAR(64);

CREATE INDEX IF NOT EXISTS idx_gallery_face_samples_model_version
    ON gallery_face_samples(model_version);
