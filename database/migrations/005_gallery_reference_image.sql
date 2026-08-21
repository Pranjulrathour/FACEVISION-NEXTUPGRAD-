-- FaceVision Database Schema - PostgreSQL
-- Migration: 005_gallery_reference_image
--
-- Adds an optional reference photo per enrolled identity, stored as a
-- data URL ("data:image/jpeg;base64,...") so the Gallery panel can show
-- a real thumbnail instead of just a name. This is a deliberate departure
-- from the app's earlier "embedding only, never an image" design -- see
-- docs/privacy-retention-policy.md for what that trade-off means and why
-- it was made. Applied automatically at startup by
-- app/database.py's apply_idempotent_column_migrations(), same as
-- migrations 002-004; this file exists for the record, not to be run
-- manually.

ALTER TABLE face_gallery
    ADD COLUMN IF NOT EXISTS image_data TEXT;
