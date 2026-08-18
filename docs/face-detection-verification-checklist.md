# Production-Grade Face Detection & Verification — FaceVision Checklist

Adapted from the generic "Production-Grade Face Detection & Verification" engineering
checklist for **FaceVision's actual stack**:

- **Frontend:** Next.js 16, React 19, TypeScript, ONNX Runtime Web, YuNet 2023mar (client-side detection)
- **Backend:** FastAPI, Python 3.12, SQLAlchemy 2.0, PostgreSQL, psycopg2
- **Deployment:** Docker, Railway

Each section below maps the original requirement onto real files in this repo and marks
current status: `[x]` done, `[~]` partial, `[ ]` gap. This is a living document — update it
as the system evolves, don't let it go stale.

## 5-Phase Implementation Tracker

| Phase | Sections | Status |
|---|---|---|
| **1 — Foundation** | §6 §7 §9 §12 §14 §20 | ✅ Done — magic-byte validation, pixel-level blur/lighting checks, inference timeout, `/api/v1` versioning, centralized config |
| **2 — Recognition** | §2 §5 §10 §28 | ✅ Done — real SFace embeddings + face alignment, enroll/recognize gallery, `BiometricProfiles`-style tables activated |
| 3 — Security | §11 §15 §16 §24 | ⏳ Not started — MiniFASNet anti-spoofing, JWT auth, security test suite |
| 4 — Measurement | §4 §13 §22 §23 §25 §33 §36 | ⏳ Not started — evaluation harness (needs a dataset you supply), load + memory profiling |
| 5 — Ops/Governance | §18 §26 §27 §37 §38 §40–43 | ⏳ Not started — `/metrics` + percentiles, Redis-backed rate limiter, caching, PR/governance workflow |

---

## 1. Objective

Build a face processing module that is accurate, fast, secure, privacy-conscious, scalable,
fault tolerant, maintainable, model-agnostic, resource-efficient, and ready for future
recognition/verification/liveness work.

**Current reality:** detection is a single-purpose client-side pipeline
([frontend/src/lib/yunet.ts](../frontend/src/lib/yunet.ts)); the backend
([backend/app](../backend/app)) is a separate, optional persistence/analytics layer. AI
inference, image handling, business rules, and API layers are already in different
files/services — not a single tightly-coupled script. Good starting position.

---

## 2. Define the Exact Requirement

| Capability | Status |
|---|---|
| Face Detection | [x] YuNet ONNX, client-side, [yunet.ts](../frontend/src/lib/yunet.ts) |
| Face Recognition (deep embeddings) | [x] SFace ONNX, 128-d embeddings, client-side — [sface.ts](../frontend/src/lib/sface.ts), see §10 |
| Face Verification | [x] real embedding-based (gallery recognize) **and** [~] landmark-geometry (Compare panel) — two distinct, intentionally separate paths, see §10 |
| Face Liveness Detection | [~] heuristic passive-liveness signal only (frame-to-frame landmark movement), **not** certified anti-spoofing — see §11 |
| Multiple-face detection | [x] supported, NMS-filtered |
| Face quality assessment | [x] structured codes (`NO_FACE`/`FACE_TOO_SMALL`/`LOW_CONFIDENCE`/`EXCESSIVE_POSE`/`MULTIPLE_FACES`/`INVALID_IMAGE`) via [face-quality.ts](../frontend/src/lib/face-quality.ts) — see §9 |
| Face tracking in video | [ ] not implemented (per-frame detection only, live camera mode) |
| Face embedding generation | [x] SFace, 128-d, with proper face alignment ([face-alignment.ts](../frontend/src/lib/face-alignment.ts)) — see §10 |
| Identity matching | [x] enroll + recognize gallery, cosine similarity against enrolled embeddings — [gallery_service.py](../backend/app/services/gallery_service.py), see §28 |

**Input/constraints actually documented** (README "Technical Constraints" table):
- Input: image upload (JPG/PNG/WebP) or live camera feed, browser-only
- Max image size: 12 MB
- Camera resolution: up to 1280×720
- Confidence threshold: 0.75 (configurable in UI settings)
- NMS IoU threshold: 0.35
- Biometric storage: **no raw images stored** anywhere; backend stores only bounding boxes,
  confidence, and 5-point landmark coordinates as metadata
- This is **face detection**, not identity verification against a real biometric database —
  the "compare" feature is geometric similarity between two detections in the same session,
  not KYC-grade identity verification.

---

## 3. Architecture (as-built)

The checklist's reference diagram assumes a server-side pipeline (client uploads an image to
an API Gateway, which runs validation/preprocessing/detection/matching server-side).
FaceVision deliberately inverts this: the entire pipeline runs **inside the browser**, so no
image is ever uploaded and there is no gateway to route through. The stage *shape* is mirrored
anyway — same named stages, same order — via a dedicated orchestrator module, so the pipeline
structure is enforced in code, not just claimed in docs.

```
Browser ("Client" — no "API Gateway" stage: there is no network hop for detection)
  Image (upload) or Camera frame
    │
    ▼
  validateImage()                    — Input Validation (file MIME/size, pre-decode)
    [frontend/src/lib/image.ts]
    │
    ▼
  runDetectionPipeline()             — orchestrates every stage below
    [frontend/src/lib/face-pipeline.ts]
    │
    ├─▶ validateDecodedImageDimensions()   — Security Checks (decompression-bomb guard)
    │     [frontend/src/lib/image.ts]
    │
    ├─▶ FaceDetector.detect()              — Image Preprocessor + Face Detection Model
    │     [frontend/src/lib/yunet.ts, face-detector.ts]     (letterbox/normalize is internal
    │                                                         to detect(), tightly coupled to
    │                                                         the model's tensor shape)
    │
    ├─▶ assessFaces()                      — Quality Assessment (+ implicit Face Crop: the
    │     [frontend/src/lib/face-quality.ts]  returned box *is* the crop region)
    │
    └─▶ LivenessHeuristic.observe()         — Optional Liveness (camera mode only, heuristic,
          [frontend/src/lib/liveness.ts]       not certified — see §11)
    │
    ▼
  face-vision.tsx                    — Business Layer (decides what the UI does with the
    [frontend/src/components/...]       result) + Response (render/persist)
    │
    ├─▶ matchFaces()                  — Optional Embedding + Matching Service, on demand
    │     [frontend/src/lib/face-pipeline.ts → face-math.ts]  (user-triggered Compare action,
    │                                                            not run on every detection)
    │
    └─▶ optional: api-client.ts → POST /api/detections    [frontend/src/lib/api-client.ts]

FastAPI backend (optional, opt-in persistence — NOT part of the detection pipeline above)
  routers/detection.py  → services/detection_service.py → models/detection.py → Postgres
  routers/face_compare.py → services/face_compare_service.py (mirrors the same landmark
                                                                cosine-similarity matching)
  routers/stats.py      → services/stats_service.py
  routers/history.py
  routers/health.py
```

Detection itself never leaves the browser. The backend is a bolt-on for history/stats/compare
persistence and can be swapped or removed without touching the pipeline.

- [x] Presentation (routers) → Application (services) → Infrastructure (models/database) layering exists in `backend/app`
- [x] AI inference (`yunet.ts`) is isolated from UI state management (`face-vision.tsx`) and from the backend entirely
- [x] `FaceDetector` TypeScript interface exists ([face-detector.ts](../frontend/src/lib/face-detector.ts)); `YuNetDetector implements FaceDetector` — see §5
- [x] The checklist's pipeline-stage structure is mirrored client-side via
  [face-pipeline.ts](../frontend/src/lib/face-pipeline.ts)'s `runDetectionPipeline()` (Security
  Checks → Preprocessor → Detection → Quality → Liveness) and `matchFaces()` (Embedding →
  Matching), both wired into `face-vision.tsx` for upload mode, camera mode, and the Compare
  panel — not just documented as an analogy. Covered by 9 unit tests.

---

## 4. Model Selection

**Chosen:** YuNet 2023mar (OpenCV Zoo), ONNX, 640×640 input, via ONNX Runtime Web.

- [x] Lightweight, CNN-based, purpose-built for face detection — appropriate category for a
  browser-only, privacy-first product (no server GPU needed)
- [x] Runs via ONNX Runtime Web with WebGPU-first and WASM fallback ([yunet.ts](../frontend/src/lib/yunet.ts))
- [ ] **No written model benchmark document exists.** You have a working threshold (0.75
  confidence, 0.35 NMS IoU) but no recorded comparison against alternatives (RetinaFace,
  MediaPipe, YOLO-face) with accuracy/latency/memory numbers. This is real, cheap to skip,
  and the checklist is right to flag it — write one before calling detection "tuned."

---

## 5. AI Model Abstraction

**Done, now for two model types.** [face-detector.ts](../frontend/src/lib/face-detector.ts)
defines a `FaceDetector` interface (`initialize()`, `detect()`, `provider`, `modelVersion`);
`YuNetDetector implements FaceDetector`. [face-embedder.ts](../frontend/src/lib/face-embedder.ts)
mirrors the same pattern for embedding models (`initialize()`, `embed()`, `provider`,
`modelVersion`, `embeddingDimension`); `SFaceEmbedder implements FaceEmbedder`. `face-vision.tsx`
still holds concrete `useRef<YuNetDetector>`/`useRef<SFaceEmbedder>`, but a future
detector/embedder only needs to satisfy its interface, not be hand-integrated into the component.

Backend `face_compare_service.compare_faces` remains a plain function using shared
`embedding_math.cosine_similarity()` — still fine for one algorithm.
`gallery_service.recognize_face` uses the same shared cosine-similarity helper for real
embeddings, so the underlying math isn't duplicated even though the two features (landmark
Compare vs. embedding Gallery) stay intentionally separate — see
[ADR 0001](adr/0001-landmark-similarity-vs-embeddings.md) and
[ADR 0002](adr/0002-sface-embeddings-for-gallery-recognition.md).

---

## 6. Input Validation

- [x] Frontend: [image.ts](../frontend/src/lib/image.ts) `validateImage()` — checks type,
  size, corrupted-file handling before decode
- [x] Backend: Pydantic schemas ([backend/app/schemas/detection.py](../backend/app/schemas/detection.py),
  [schemas/stats.py](../backend/app/schemas/stats.py)) validate structure of every request —
  `CompareRequest` uses typed `ComparableFace` models (fixed from raw `dict` — see git history),
  `DetectionCreate.faces` is capped at 128 entries to block oversized payloads
- [x] Magic-byte/file-signature validation added: [image-signature.ts](../frontend/src/lib/image-signature.ts)
  `detectImageFormat()` reads the leading bytes of the file (JPEG/PNG/WebP signatures) and
  `formatMatchesDeclaredType()` flags a mismatch between declared `Content-Type` and actual
  content — wired into `face-vision.tsx`'s `selectFile()` via `validateImageSignature()`, after
  the cheap MIME/size check and before the file is ever decoded. Covered by 11 unit tests
  including a renamed-executable case (MZ header) and a mismatched-RIFF case.
- [x] Decompression-bomb guard added: [image.ts](../frontend/src/lib/image.ts)
  `validateDecodedImageDimensions()` rejects decoded images over 40 megapixels regardless of
  file size, wired into `face-vision.tsx`'s `detectImage()` right after decode

---

## 7. Image Preprocessing

[yunet.ts](../frontend/src/lib/yunet.ts) implements letterbox scaling to 640×640, BGR
conversion, mean-subtraction normalization (B-104, G-117, R-123).

- [x] Fixed input dimensions enforced (640×640 — 320×320 fails immediately, documented in README)
- [x] EXIF/orientation handled via browser's native image decoding
- [ ] Not verified whether repeated detections (e.g., live camera mode running per-frame) avoid
  redundant allocations — worth profiling if camera mode shows memory growth over a long session

---

## 8. Face Detection Output Shape

Actual `Face` type ([face-types.ts](../frontend/src/lib/face-types.ts)):
```typescript
type Face = {
  box: { x: number; y: number; width: number; height: number };
  confidence: number;
  landmarks: FaceLandmarks; // 5-point: eyes, nose, mouth corners
};
```
- [x] Structured output with bounding box, confidence, landmarks — matches the checklist's
  recommended shape
- [ ] No `DetectionQuality` or `ProcessingMetadata` fields — see §9
- [x] Multiple faces supported; NMS-filtered
- [x] Confidence threshold configurable via UI settings panel (not hard-coded — but see §20 for
  backend-side config gaps)
- [ ] No explicit business rule enforced for "0 faces → reject / >1 face → reject for
  single-person workflows" — the app currently accepts any face count for both compare slots
  and detection storage; add this if a future flow needs single-face guarantees (e.g., KYC)

---

## 9. Face Quality Assessment

**Done, including pixel-level checks.** [face-quality.ts](../frontend/src/lib/face-quality.ts)
exports `assessFaceQuality()`/`assessFaces()` returning structured codes: `OK`, `NO_FACE`,
`MULTIPLE_FACES`, `FACE_TOO_SMALL`, `LOW_CONFIDENCE`, `EXCESSIVE_POSE`, `IMAGE_TOO_BLURRY`,
`POOR_LIGHTING`, `INVALID_IMAGE` — all configurable via options, covered by 17 unit tests.

- [x] Structured failure codes (not a bare boolean)
- [x] Face-size-relative-to-image and pose-asymmetry (landmark geometry) checks — always run
- [x] Blur (variance-of-Laplacian, [pixel-analysis.ts](../frontend/src/lib/pixel-analysis.ts))
  and lighting/contrast (mean/stdDev luminance) checks — run when a cropped-face `ImageData` is
  supplied. Cropping itself lives in [face-crop.ts](../frontend/src/lib/face-crop.ts), separated
  from the pure math in `pixel-analysis.ts` specifically so the math stays unit-testable without
  a real canvas (the Node test environment has no canvas implementation).
- [x] Wired into the actual detection flow: [face-pipeline.ts](../frontend/src/lib/face-pipeline.ts)'s
  `runDetectionPipeline()` crops and runs pixel checks when `enablePixelQualityChecks: true` is
  passed — enabled for upload-mode detections, deliberately **not** enabled for camera-mode's
  per-frame loop (cropping costs an extra canvas draw + two full pixel-array passes, which is
  fine once per upload but not at 30-60fps).
- [ ] Occlusion detection is still not implemented — would need either a landmark-visibility
  signal the current model doesn't output, or a dedicated occlusion model.

---

## 10. Face Recognition / Embeddings — now implemented, two distinct paths

**Done — real embedding-based recognition exists now, alongside (not replacing) the original
landmark-geometry comparison.** Two genuinely different features:

1. **Compare panel** (unchanged, ADR 0001): [face-math.ts](../frontend/src/lib/face-math.ts)'s
   `compareFaces()` computes cosine similarity over normalized 5-point landmark positions —
   a lightweight "are these two detections geometrically similar" check, not identity
   verification. Threshold 0.78, configurable.
2. **Gallery enroll/recognize** (new, [ADR 0002](adr/0002-sface-embeddings-for-gallery-recognition.md)):
   real SFace embeddings via [sface.ts](../frontend/src/lib/sface.ts) — 128-dimension vectors
   from a trained face-recognition model, matched via
   [matchFaceEmbeddings()](../frontend/src/lib/face-pipeline.ts) using SFace's own calibrated
   cosine threshold (0.363). This is genuine identity verification, not a geometric proxy.

- [x] Real trained embedding model in use (SFace, ArcFace-family architecture)
- [x] Face alignment implemented before embedding (required — see §7, §12)
- [x] Threshold is SFace's own calibrated value (0.363), not tuned by this app, and configurable
- [ ] No FAR/FRR benchmarking independently run against a real dataset by this app (checklist
  §22-23, Phase 4) — relying on OpenCV Zoo's published accuracy figures for now
- [x] The distinction between the two comparison paths is now documented in-product (the
  Compare panel's result still says "derived from landmark geometry"; the Gallery panel
  explicitly states it uses "a real trained embedding model, distinct from... Compare")

---

## 11. Liveness Detection

**Heuristic signal added, explicitly not certified.** [liveness.ts](../frontend/src/lib/liveness.ts)'s
`LivenessHeuristic` tracks frame-to-frame landmark movement across a sliding window (camera
mode); if average movement stays near-zero across the window, it flags
`static_input_suspected` — catching the crudest spoofing case (a completely static photo held
in front of the camera). It does **not** detect photo-of-a-photo, screen replay with motion, or
a printed photo gently wobbled by hand, and is not wired into any decision gate — it's a
diagnostic signal only, covered by 5 unit tests.

FaceVision still doesn't gate authentication, payments, or KYC on face matching, so this
remains correctly out of the critical path. If that scope ever changes, this heuristic must be
replaced with (not upgraded into) a real trained anti-spoofing model before compare results
could be trusted for anything security-sensitive.

---

## 12. AI Inference Efficiency

- [x] Model loaded once via `prepareDetector()` lazy init with a runtime status badge in the
  UI, not reloaded per detection ([face-vision.tsx](../frontend/src/components/face-vision.tsx))
- [x] ONNX Runtime session reused across detections in a session
- [x] WebGPU-first with automatic WASM fallback — hardware acceleration used when available
- [x] Inference timeout added: [face-pipeline.ts](../frontend/src/lib/face-pipeline.ts)'s
  `runDetectionPipeline()` wraps `detector.detect()` in a race against a configurable timeout
  (default 8000ms), throwing `FacePipelineError("INFERENCE_TIMEOUT", ...)` if inference hangs
  — a stuck WebGPU context or corrupt frame now surfaces as an error instead of leaving the UI
  stuck in "processing" forever. Covered by 2 unit tests (times out; doesn't time out when fast).

---

## 13. Memory Management

Since inference is entirely client-side, ".NET GC/LOH" concerns from the original checklist
don't apply — the equivalent browser-side risks are:

- [ ] Not verified: whether long live-camera sessions leak `ImageData`/canvas buffers over time
  — worth a manual soak test (leave camera mode running 10+ minutes, watch tab memory)
- [x] Backend: no raw images ever reach it, so there's no large-buffer risk there by design
- [x] Backend: SQLAlchemy sessions are properly scoped per-request via `get_db()` dependency
  ([database.py](../backend/app/database.py)) — no session/connection leakage pattern

---

## 14. API Design

Routes are versioned under `/api/v1` (canonical); the same router objects are also mounted at
the old unversioned `/api/...` prefix for backward compatibility (see
[backend/app/main.py](../backend/app/main.py)):

| Method | Path (v1) | Purpose |
|---|---|---|
| GET | `/api/v1/health` | liveness |
| POST | `/api/v1/detections` | store a detection |
| GET | `/api/v1/detections` | paginated list |
| GET/DELETE | `/api/v1/detections/{id}` | fetch/delete one |
| GET/DELETE | `/api/v1/history` | history alias + clear |
| GET | `/api/v1/stats` | aggregated KPIs |
| POST | `/api/v1/compare` | landmark similarity |

- [x] Versioned under `/api/v1`; the legacy unversioned path for each route still works but a
  `deprecate_unversioned_routes` middleware adds a `Deprecation: true` header + a `Link:
  <.../api/v1/...>; rel="successor-version"` pointer, and logs a server-side warning on every
  legacy call — so usage is visible without needing client telemetry. Covered by 5 tests
  (v1 works, legacy works, legacy carries the headers, v1 doesn't, both share the same data).
- [x] Response shapes are typed Pydantic models, not raw dicts
- [x] Internal model details (ONNX session, SQLAlchemy internals) never leak through responses

---

## 15. API Security

- [x] Opt-in `API_KEY` gate via `X-API-Key` header on write/destructive endpoints
  ([core/security.py](../backend/app/core/security.py)) — off by default in dev, must be set
  in production (documented in README)
- [x] Per-IP sliding-window rate limiting on `/api/detections` and `/api/compare`
  ([core/rate_limit.py](../backend/app/core/rate_limit.py))
- [x] CORS restricted to configured origins (was `allow_origins=["*"]` + credentials — fixed)
- [x] Generic error responses; internal exceptions logged server-side, never returned to clients
- [ ] No authentication/authorization model beyond the single shared `API_KEY` — fine for this
  app's actual threat model (anonymous session-scoped metadata, no PII), would need real
  per-user auth (JWT/OAuth) if user accounts or access-controlled data ever get added
- [ ] Rate limiter is in-memory, per-process — documented limitation; won't hold across
  multiple backend replicas (README "Known Limitations")

---

## 16. Privacy & Biometric Security

- [x] **No raw images ever leave the browser** — this is the core product promise and it's
  actually true in the code, not just marketing copy
- [x] Backend stores only bounding boxes, confidence scores, and 5-point landmark coordinates
  — never pixels
- [x] `.env`/`.env.example` split correctly; secrets gitignored, never committed
- [x] Retention policy now enforceable: `RETENTION_DAYS` setting +
  `detection_service.purge_expired_detections()` + `backend/scripts/purge_old_detections.py`
  (opt-in — unset by default so existing deployments aren't affected). Covered by unit tests.
- [x] The four required questions (what/why/who/how-long/how-deleted) are now answered
  concretely in [docs/privacy-retention-policy.md](privacy-retention-policy.md).

---

## 17. Logging

- [x] Structured request logging added (`log_requests` middleware,
  [main.py](../backend/app/main.py)) — logs method, path, status, duration, never payload
  contents
- [x] No face images, landmarks, or embeddings ever appear in log output — verified by reading
  every `logger.*` call in the codebase
- [x] Global exception handler logs the real exception server-side (`logger.exception`) while
  returning a generic message to the client

---

## 18. Observability

- [~] Request timing logged per-request, but no aggregated dashboards, no P50/P95/P99
  tracking, no alerting — this is genuinely absent, not just "someone else's job." A future
  iteration could ship these via Railway's metrics or a lightweight `/metrics` endpoint.
- [x] k6 load-test script exists ([deployment/scripts/load-test.js](../deployment/scripts/load-test.js))
  and asserts p95 < 500ms — a manual substitute for continuous monitoring, not a replacement

---

## 19. Error Handling

- [x] Matches the checklist's "good" example almost exactly: `{"detail": "Internal server
  error"}` to the client, full traceback logged server-side against the request path
- [x] Pydantic validation errors return FastAPI's structured 422 responses (field-level, no
  internal leakage)

---

## 20. Configuration

- [x] Thresholds are configurable **on the frontend** (confidence/NMS sliders in Settings
  panel) — not hard-coded there
- [x] **Backend configuration centralized** in [core/config.py](../backend/app/core/config.py) —
  a `pydantic-settings` `Settings` class documents `database_url`, `host`, `port`, `reload`,
  `cors_origins`, and `retention_days` in one place, used by `main.py`, `database.py`, and
  `run.py`. `API_KEY` and the per-route rate limits deliberately stay as live `os.getenv()`
  reads in `core/security.py`/`core/rate_limit.py` (documented there) so tests can
  monkeypatch them per-call — their meaning and defaults are still documented in `Settings` for
  discoverability.

---

## 21. Model Versioning

**Done.** `YuNetDetector.modelVersion` (`"yunet-2023mar"`, see
[docs/model-card-yunet.md](model-card-yunet.md)) is stamped onto every persisted detection:
`DetectionRecord.model_version` column ([database/migrations/002_add_model_version.sql](../database/migrations/002_add_model_version.sql)),
threaded through `DetectionCreate`/`DetectionResponse` schemas and `detection_service`, and
returned in `GET /api/detections/{id}`. Covered by unit + integration tests. Confidence/NMS
thresholds are still request-time parameters, not stamped per-record — low priority since
they're visible in the UI at detection time, not retroactively needed per historical row.

---

## 22–25. Testing, Accuracy, Security, Load Testing

| Area | Status |
|---|---|
| Frontend unit tests | [x] `image.test.ts`, `yunet.test.ts`, `face-math.test.ts` — validation, NMS, and landmark-similarity logic covered |
| Backend unit tests | [x] 30 tests covering detection/stats/compare services, security gate, rate limiter, DB URL normalization, init-db retry logic, retention purge, full-pipeline HTTP integration |
| Representative test dataset (lighting/skin tone/age/angle/occlusion diversity) | [ ] not built — tests use synthetic coordinate fixtures, not a real diverse image set |
| Measured accuracy (precision/recall/FAR/FRR) | [ ] not measured — no benchmark numbers exist beyond "it works in manual testing" |
| Security testing (malicious files, oversized payloads, replay/spoofing) | [~] payload size capped, schema-validated; no dedicated adversarial test suite |
| Load testing | [x] k6 script exists and is documented; not yet run against the live Railway deployment to get real numbers |

**Honest summary:** functional correctness is well-tested; measured accuracy and adversarial/
load numbers are not — don't claim specific accuracy percentages until they're measured.

---

## 26. Scalability Architecture

- [x] Backend is stateless (no local session state); Postgres is the only shared state
- [x] Docker healthchecks + Railway `railway.toml` restart policies configured
- [ ] Rate limiter state is per-process/in-memory — the one piece of state that **wouldn't**
  survive horizontal scaling to multiple backend replicas without moving to a shared store
  (Redis) — already flagged in README

---

## 27. Caching

- [x] Model loaded once client-side, reused across detections — the one caching decision that
  matters here, and it's done correctly
- [x] No raw images or embeddings cached anywhere, client or server

---

## 28. Database Design

Actual schema ([backend/app/models/detection.py](../backend/app/models/detection.py),
[backend/app/models/gallery.py](../backend/app/models/gallery.py)):

```
detection_records (id, mode, face_count, avg_confidence, user_session_id, created_at)
  └── face_records (detection_id FK, box_*, confidence, landmarks JSONB)

face_gallery (id, name, user_session_id, created_at, updated_at)              -- BiometricProfiles
  └── gallery_face_samples (gallery_id FK, embedding JSONB[128], model_version, created_at)
```

- [x] Two focused, purpose-specific tables for detections — not a catch-all "biometric blob in
  the users table"
- [x] **`face_gallery`/`gallery_face_samples` are now active**, not dead weight — this is the
  checklist's own recommended `BiometricProfiles`-style separation: biometric embedding data
  lives in its own table, keyed off a separate identity-entry table, not mixed into
  `detection_records`. Activated via
  [database/migrations/003_gallery_embeddings.sql](../database/migrations/003_gallery_embeddings.sql),
  which adds the `embedding`/`model_version` columns the original (never-built) design for
  these tables didn't anticipate.
- [ ] `users` and `app_settings` (from `001_init_schema.sql`) remain unused — no user-account
  system exists yet (gallery entries are scoped by anonymous `user_session_id`, same as
  detections), so `users` stays reserved for a future real-auth feature (Phase 3, §15-16).

---

## 29–30. Clean Code & Layering

Actual structure:
```
backend/app/
  main.py            — FastAPI app, CORS, middleware, error handling
  database.py        — engine/session, retry-on-startup logic
  core/               — security.py (API key), rate_limit.py
  routers/            — one file per resource (detection, history, stats, face_compare, health)
  services/           — business logic, no HTTP concerns
  schemas/            — Pydantic request/response contracts
  models/             — SQLAlchemy ORM
```
- [x] Routers stay thin — they call services, don't embed business logic
- [x] No god-classes; each router/service has one resource's concerns
- [x] AI-adjacent logic (`face_compare_service`) lives in `services/`, not leaked into routers
  or models
- [ ] No formal `Domain`/`Infrastructure` split (this is a small FastAPI app, not a DDD system)
  — reasonable given the app's actual size; revisit only if it grows substantially

---

## 31. Dependency Management

- [x] Backend: pinned versions in [requirements.txt](../backend/requirements.txt) (FastAPI,
  SQLAlchemy, psycopg2-binary, pydantic, alembic, pytest, httpx — all mainstream, actively
  maintained)
- [x] Frontend: ONNX Runtime Web, Next.js, React — all first-party/well-maintained
- [x] CI runs `pip install` / `npm ci` against pinned lockfiles, catching drift early
- [x] CVE scanning now wired into CI: `npm audit --audit-level=high` (frontend) and
  `pip-audit -r requirements.txt --strict` (backend), both in
  [.github/workflows/ci.yml](../.github/workflows/ci.yml). Running this the first time found
  and fixed 16 real CVEs across `python-multipart`, `starlette` (transitive via `fastapi`),
  `pytest`, and `python-dotenv` — since patched by upgrading `fastapi` to 0.141.1 (pulling a
  patched `starlette`), `python-multipart` to 0.0.31, `pytest` to 9.0.3, `python-dotenv` to
  1.2.2. Both scans are clean as of this update.

---

## 32. AI Model Governance

**Done.** [docs/model-card-yunet.md](model-card-yunet.md) documents source, license, input
shape, intended use, known limitations, defaults, and a governance rule (bump
`YUNET_MODEL_VERSION` on any model swap, test against the existing suite plus a diverse image
set per §22 before merging).

---

## 33. Bias & Fairness Testing

**Not done.** No demographic breakdown of detection accuracy exists. Given this app doesn't
make consequential decisions about people (no auth/access-control gated on face match), the
risk profile is lower than a KYC or access-control system — but if FaceVision's scope ever
expands toward identity decisions, this becomes mandatory, not optional.

---

## 34–36. Unit / Integration / Performance Tests

- [x] Unit tests: 31 frontend (Vitest) + 30 backend (pytest)
- [x] Integration tests: [test_full_pipeline_integration.py](../backend/tests/test_full_pipeline_integration.py)
  exercises the full HTTP pipeline (create → retrieve → list → stats → compare → clear) via
  `with TestClient(app) as client:` — which is required to trigger the app's lifespan
  (`init_db()`) at all; discovered this the hard way (a bare `TestClient(app)` never runs
  lifespan, so the original `test_health.py` never actually exercised `init_db()` either).
  Verified against both a real Postgres instance and a file-based SQLite substitute.
- [x] Performance: k6 script defines p95 < 500ms and <1% hard-failure-rate thresholds; not yet
  run against production to get a real baseline number

---

## 37. Code Review Requirements

Solo/small-team project — no formal PR review gate configured. If a second contributor joins,
adopt: architecture, security, memory, async correctness, exception handling, logging, input
validation, inference efficiency, test coverage, config, scalability, privacy — the original
checklist's list is directly reusable as-is.

---

## 38. Git / Development Workflow

- [x] Feature-scoped, atomic commits with conventional prefixes (`feat(backend):`,
  `fix(deployment):`, `test(frontend):`, etc.) — already the working style in this repo's history
- [x] `.gitignore` correctly excludes `node_modules/`, `.venv/`, `.env`, `__pycache__/` per
  package
- [x] No secrets committed (verified: `.env` files gitignored, `.env.example` templates
  committed instead)
- [x] CI (`.github/workflows/ci.yml`) runs lint + typecheck + test + build on every push/PR
- [ ] No formal PR-based workflow yet (direct commits to `main`) — fine for solo development,
  worth changing if collaborators join

---

## 39. Documentation

- [x] Architecture, API table, deployment guide (including Railway), known limitations, and
  privacy notes all live in the root [README.md](../README.md)
- [x] Backend/database/deployment sub-docs exist (`backend/readme.md`, `database/readme.md`,
  `deployment/deployment.md`, `deployment/docker/readme.md`)
- [x] Model card ([docs/model-card-yunet.md](model-card-yunet.md)), privacy/retention policy
  ([docs/privacy-retention-policy.md](privacy-retention-policy.md)), and an ADR log
  ([docs/adr/0001-landmark-similarity-vs-embeddings.md](adr/0001-landmark-similarity-vs-embeddings.md))
  now exist as durable docs, not just conversation history.

---

## 40. Production Readiness Checklist (honest current state)

- [x] Functional requirements documented (README + this file)
- [ ] Model benchmarked against alternatives
- [ ] Accuracy formally measured (precision/recall/FAR/FRR)
- [~] Security testing: schema validation + payload caps + CI CVE scanning done; no
  adversarial/spoofing test suite
- [x] Load testing tooling exists; not yet run against production for a real baseline
- [ ] Memory testing (browser long-session soak test) not done
- [x] API authenticated (opt-in `API_KEY`)
- [x] Rate limiting exists
- [x] Input validation exists (frontend + backend), including a decompression-bomb guard
- [x] Biometric retention policy documented and enforceable (`RETENTION_DAYS` + purge script)
- [x] Sensitive data never logged (verified)
- [x] Model versioning stamped on records (`model_version` column)
- [~] Basic observability (request logs); no dashboards/alerts
- [x] Unit tests exist (frontend + backend)
- [x] Integration tests exist for the full detect→store→retrieve→stats→compare→clear pipeline
- [~] Some failure scenarios tested (invalid compare payload, zero-size box, rate limit,
  DB-not-ready retry, decompression bomb, extreme pose); not exhaustive
- [x] Documentation complete for current scope, including model card, privacy policy, and ADR
- [ ] No formal code review process (solo project)
- [x] Automated dependency/CVE scanning wired into CI (npm audit + pip-audit); no license-review
  process beyond that
- [~] Rollback strategy: git history + Railway's deployment history serve this informally; no
  documented rollback runbook

---

## 41. Definition of Done (for this project)

Not: *"the camera detects a face."*

Actually: *the system reliably detects faces client-side under the documented constraints,
validates and rejects malformed input, keeps raw images off any server, optionally persists
detection metadata (not pixels) behind rate-limited and API-key-gated endpoints, degrades
gracefully when Postgres is briefly unreachable, is covered by unit tests on both sides of the
stack, and is documented well enough that a new contributor could extend it without reading
the whole git history.*

---

## 42. Development Phases — mapped to what's actually shipped

| Phase | Status |
|---|---|
| 1 — Proof of Concept (model selection) | [x] YuNet chosen and shipped; [ ] no written benchmark doc against alternatives |
| 2 — Engineering Foundation (structure, abstraction, config, validation, error handling, logging, API) | [x] structure/validation/error-handling/logging/API/abstraction-interface/centralized-config all done (§5, §20) |
| 3 — Quality (face quality, threshold calibration, multi-face, edge cases) | [x] thresholds configurable; structured quality-assessment module with codes exists (§9); [ ] pixel-based blur/lighting checks still not implemented |
| 4 — Security (auth, rate limiting, input security, privacy) | [x] done — API key, rate limiting, input validation, no raw-image storage |
| 5 — Performance (benchmark, load test, memory profiling) | [~] load-test script exists, not run against prod; no memory profiling done |
| 6 — Production (monitoring, alerting, deployment, rollback, docs, security review) | [~] deployed to Railway with healthchecks; no monitoring/alerting; docs exist; no formal security review sign-off |

---

## 43. Senior Review Questions — answered honestly, today

1. **Why YuNet?** Lightweight, purpose-built, ONNX-portable, runs client-side without a GPU server.
2. **What alternatives were benchmarked?** None formally — this is the acknowledged gap in §4.
3. **Measured false-positive rate?** Not measured.
4. **Measured false-negative rate?** Not measured.
5. **Multiple faces?** Supported and rendered; no business rule rejects multi-face detections.
6. **No face?** Returns an empty result; UI shows "no face detected," no crash.
7. **100MB image?** Frontend caps uploads at 12MB with a validation error before decode.
8. **Decompression-bomb protection?** Now guarded — decoded dimensions are checked against a
   40-megapixel cap regardless of file size (§6, §7).
9. **Memory per request?** Not profiled; detection is client-side, so "per request" doesn't map
   to backend memory the way it would for a server-side inference API.
10. **Model loaded per request?** No — loaded once via `prepareDetector()`, reused.
11. **Scale to 100 instances?** Backend is stateless and would scale horizontally; the
    in-memory rate limiter is the one component that wouldn't coordinate across instances (§26).
12. **AI model crashes?** Client-side: caught, falls back to WASM if WebGPU fails; a hard ONNX
    failure surfaces as a UI error state, doesn't crash the tab.
13. **Inference takes 30s?** No explicit inference-level timeout; realistically a 640×640
    detection is fast (sub-second) so this hasn't been a practical issue.
14. **Cancel an inference?** Not implemented.
15. **Model replaceable without changing business logic?** Closer — `YuNetDetector implements
    FaceDetector` (§5), so a new implementation only needs to satisfy that interface. The
    `useRef<YuNetDetector>` type in `face-vision.tsx` would still need widening to
    `FaceDetector` to make the swap truly drop-in.
16. **Where are face images stored?** Nowhere — never leave the browser.
17. **Retention?** Enforceable via `RETENTION_DAYS` + purge script; documented concretely in
    [docs/privacy-retention-policy.md](privacy-retention-policy.md). Still opt-in/unset by
    default, so the honest default answer is "kept until manually cleared" unless an operator
    configures it.
18. **Embeddings stored?** No — landmark coordinates only, and only if the backend is used.
19. **Who can access them?** Anyone with the `API_KEY` (if set) can write; read endpoints are
    currently open (no per-session read restriction beyond the `userSessionId` query filter,
    which is client-supplied and not cryptographically bound to a session).
20. **Biometric values in logs?** No — verified across every logging call in the codebase.
21. **Spoofing handled?** Only a crude heuristic (static-image detection via landmark
    movement, §11) — not real anti-spoofing. Still by design given current scope; not relied
    upon for any security decision.
22. **Detection or identity verification?** Detection, plus a geometric similarity score — not
    identity verification against an enrolled database.
23. **How was the threshold selected?** Manually tuned during development, not through a formal
    FAR/FRR sweep.
24. **How was accuracy measured?** Informally, through manual testing — not benchmarked.
25. **Demographic performance evaluated?** No.
26. **AI dependency unavailable?** ONNX Runtime Web failing to init surfaces as a UI error
    state; the backend has no AI dependency to fail (compare is pure math, no model call).
27. **10× traffic?** Rate limiter would start rejecting excess requests with 429s past
    configured thresholds (30/min default); not load-tested against a real 10× scenario yet.
28. **100× traffic?** Same rate-limiting behavior; Postgres connection pool sizing not
    specifically tuned for this — would need real load testing to confirm.
29. **Degradation metrics?** Request-timing logs exist; no dashboard/alert wired to surface
    degradation automatically yet.
30. **Rollback to previous model?** The `.onnx` file is a static asset in `frontend/public/models/`
    — rollback means reverting that file + the git commit, no runtime model-switching mechanism.

**Bottom line:** this is a solid, honestly-scoped hobby/portfolio-grade implementation with
real engineering discipline (layering, tests, CI with CVE scanning, no raw biometric storage,
rate limiting, API keys, model versioning, an enforceable retention policy, and a heuristic
liveness signal that's honestly labeled as non-certified). It is *still not* production-ready
for any KYC/auth/payments use case — the two items that would require fundamentally new
capability (a real trained face-embedding model, and certified anti-spoofing) are tracked in
[ADR 0001](adr/0001-landmark-similarity-vs-embeddings.md) as deliberate, revisitable decisions,
not oversights. Formal model benchmarking (§4), measured accuracy (§22–25), and bias/fairness
testing (§33) remain open — these require data and evaluation work, not just more code.

---

## Final Principle (unchanged from source)

The AI model is one component, not the system. Keep it swappable, keep raw biometric data off
the wire and out of storage, keep the pipeline observable and testable, and never let "the
camera detects a face" pass for "done."
