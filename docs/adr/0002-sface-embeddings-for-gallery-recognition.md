# ADR 0002: SFace embeddings for gallery enrollment/recognition

## Status

Accepted. Supersedes [ADR 0001](0001-landmark-similarity-vs-embeddings.md) **only for the
gallery enroll/recognize feature** — the original Compare panel still uses landmark-geometry
similarity (ADR 0001 remains accurate for that feature specifically).

## Context

ADR 0001 documented that FaceVision had no trained face-embedding model and used landmark
geometry as a lightweight stand-in. Checklist §2 ("Identity matching") and §28
("BiometricProfiles") call for real identity matching against enrolled people — landmark
geometry cannot provide this (two different people with similar poses score falsely high; the
same person at a different angle scores falsely low). This requires an actual trained face
embedding model.

## Decision

Bundle **SFace** (`face_recognition_sface_2021dec.onnx`, OpenCV Zoo, Apache 2.0, ~37MB) as a
second ONNX model, lazy-loaded only when the user opens Gallery/enrolls/recognizes a face — not
on initial page load, so the base detection experience stays as fast as before.

Verified directly against the downloaded model graph (not assumed from docs):
- Input tensor `data`: `[1, 3, 112, 112]`, float32
- Output tensor `fc1`: `[1, 128]` — a 128-dimension embedding
- Preprocessing: RGB, CHW, raw 0-255 pixel values, no mean subtraction — confirmed against
  OpenCV's own `FaceRecognizerSF` C++ source (`dnn::blobFromImage` call)
- Calibrated match threshold: cosine similarity ≥ 0.363 (OpenCV Zoo's own `demo.py`, not tuned
  by this app)

**Face alignment is required** before embedding — SFace (like ArcFace-family models) is trained
on faces warped to a canonical 112×112 pose, not raw bounding-box crops. Implemented as a
closed-form 2D similarity transform (`frontend/src/lib/face-alignment.ts`) mapping YuNet's 5
landmarks onto OpenCV's fixed reference template
(`face_recognize.cpp`'s `getSimilarityTransformMatrix`), verified with 9 unit tests covering
identity/translation/scale/rotation/combined cases against the closed-form math directly.

Gallery data model: reuses (and finally activates) the previously-unused `face_gallery` /
`gallery_face_samples` tables (see `database/migrations/003_gallery_embeddings.sql`). Embedding
vectors are stored as plain JSON arrays, matched via a linear cosine-similarity scan
(`backend/app/services/gallery_service.py`) rather than a vector index (pgvector, FAISS) —
deliberately simple for a personal-scale gallery; revisit if enrollment ever needs to scale
past a small number of identities.

## Consequences

- **This is now real identity verification**, not a geometric proxy — FAR/FRR for this feature
  can be meaningfully benchmarked against SFace's published numbers (still not independently
  measured by this app — see checklist §22-23, Phase 4).
- **Privacy model extended, not broken**: raw images still never leave the browser. What's new
  is that a 128-float embedding vector — derived biometric data — is now sent to the backend
  *when a user explicitly enrolls a face*. This is opt-in, not automatic, and documented
  concretely in [docs/privacy-retention-policy.md](../privacy-retention-policy.md).
- **Repo size grew by ~37MB** (the SFace model, committed to git — consistent with how YuNet is
  already handled). Lazy-loaded, so this doesn't affect the base app's load time.
- **A second model to govern**: see [docs/model-card-sface.md](../model-card-sface.md), same
  pattern as YuNet's model card.
- **Compare (ADR 0001) is intentionally left alone** — it's a separate, lighter-weight feature
  and migrating it to embeddings wasn't part of this decision's scope. Revisit only if there's
  a concrete reason to unify the two comparison paths.
