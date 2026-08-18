-- FaceVision Database Schema - PostgreSQL
-- Migration: 004_users_password_hash
--
-- Activates the previously-unused `users` table for real JWT-based
-- authentication (checklist §15, §16). Registration/login is optional --
-- anonymous usage via user_session_id continues to work unchanged.

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255);
