-- FaceVision Database Schema - PostgreSQL
-- Migration: 002_add_model_version
--
-- Adds model/version traceability to detection_records so a historical
-- detection can be tied back to which detector produced it (e.g.
-- "yunet-2023mar"). Without this, swapping the bundled ONNX model would
-- leave no way to distinguish which records came from which model version.

ALTER TABLE detection_records
    ADD COLUMN IF NOT EXISTS model_version VARCHAR(64);

CREATE INDEX IF NOT EXISTS idx_detection_records_model_version
    ON detection_records(model_version);
