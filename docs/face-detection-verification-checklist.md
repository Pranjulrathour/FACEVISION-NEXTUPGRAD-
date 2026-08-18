# Production-Grade Face Detection & Verification — FaceVision Checklist

Adapted from the generic "Production-Grade Face Detection & Verification" engineering
checklist for **FaceVision's actual stack**:

- **Frontend:** Next.js 16, React 19, TypeScript, ONNX Runtime Web, YuNet 2023mar (client-side detection)
- **Backend:** FastAPI, Python 3.12, SQLAlchemy 2.0, PostgreSQL, psycopg2
- **Deployment:** Docker, Railway

Each section below maps the original requirement onto real files in this repo and marks
current status: `[x]` done, `[~]` partial, `[ ]` gap. This is a living document — update it
as the system evolves, don't let it go stale.

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
| Face Recognition (deep embeddings) | [ ] not implemented |
| Face Verification | [~] landmark-geometry cosine similarity only, **not** a learned embedding model — see §10 |
| Face Liveness Detection | [ ] not implemented — see §11 |
| Multiple-face detection | [x] supported, NMS-filtered |
| Face quality assessment | [~] confidence threshold only, no blur/brightness/pose checks — see §9 |
| Face tracking in video | [ ] not implemented (per-frame detection only, live camera mode) |
| Face embedding generation | [ ] not implemented (uses 5-point landmark geometry instead) |
| Identity matching | [~] similarity score only, no enrolled-identity gallery wired up (schema has unused `face_gallery`/`gallery_face_samples` tables) |

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

```
Browser
  Image / Camera
    → YuNetDetector (ONNX Runtime Web, WebGPU→WASM)   [frontend/src/lib/yunet.ts]
    → Canvas overlay (boxes, landmarks)                [frontend/src/components/face-vision.tsx]
    → optional: api-client.ts → POST /api/detections    [frontend/src/lib/api-client.ts]

FastAPI backend (optional, opt-in persistence)
  routers/detection.py  → services/detection_service.py → models/detection.py → Postgres
  routers/face_compare.py → services/face_compare_service.py (landmark cosine similarity)
  routers/stats.py      → services/stats_service.py
  routers/history.py
  routers/health.py
```

Detection itself never leaves the browser. The backend is a bolt-on for history/stats/compare
persistence and can be swapped or removed without touching the detector.

- [x] Presentation (routers) → Application (services) → Infrastructure (models/database) layering exists in `backend/app`
- [x] AI inference (`yunet.ts`) is isolated from UI state management (`face-vision.tsx`) and from the backend entirely
- [ ] No formal `IFaceDetector`-style interface exists yet in TypeScript — `YuNetDetector` is a concrete class, not swapped behind an interface (see §5)

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

**Gap.** `YuNetDetector` in [yunet.ts](../frontend/src/lib/yunet.ts) is called directly from
`face-vision.tsx`. There's no `FaceDetector` interface, so swapping models later means editing
the component, not just adding a new implementation.

Recommended (not yet done):
```typescript
interface FaceDetector {
  init(): Promise<void>;
  detect(image: ImageData): Promise<Face[]>;
}

class YuNetDetector implements FaceDetector { ... }
// future: class RetinaFaceDetector implements FaceDetector { ... }
```
Same idea applies on the backend for `face_compare_service.compare_faces` — it's a plain
function, fine for one algorithm, but if a real embedding-based verifier is added later, wrap
both behind a shared `FaceVerifier` protocol (Python `typing.Protocol`) so routers don't care
which implementation is active.

---

## 6. Input Validation

- [x] Frontend: [image.ts](../frontend/src/lib/image.ts) `validateImage()` — checks type,
  size, corrupted-file handling before decode
- [x] Backend: Pydantic schemas ([backend/app/schemas/detection.py](../backend/app/schemas/detection.py),
  [schemas/stats.py](../backend/app/schemas/stats.py)) validate structure of every request —
  `CompareRequest` uses typed `ComparableFace` models (fixed from raw `dict` — see git history),
  `DetectionCreate.faces` is capped at 128 entries to block oversized payloads
- [ ] No explicit magic-byte/file-signature validation beyond browser `File.type` — a renamed
  file could bypass MIME checks before hitting the ONNX decoder. Low risk here since decoding
  happens client-side and a malformed image just fails to decode, but worth knowing
- [ ] No decompression-bomb protection on the frontend upload path (a 1KB file that decodes to
  a huge bitmap could stall the tab) — not currently guarded

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

**Real gap.** Only confidence threshold is checked. No blur, brightness, contrast, pose, or
occlusion scoring exists. Failure reasons returned today are generic (empty result vs. some
faces) — not the structured `NO_FACE` / `FACE_TOO_SMALL` / `IMAGE_TOO_BLURRY` style codes the
checklist recommends.

If FaceVision ever needs "is this a usable photo" logic (e.g., for a future verification
flow), this needs its own module — don't bolt it onto `YuNetDetector`.

---

## 10. Face Recognition / Embeddings — important distinction

**FaceVision does not do embedding-based face recognition.** [face-math.ts](../frontend/src/lib/face-math.ts)'s
`compareFaces()` computes cosine similarity over **normalized 5-point landmark positions**,
mirrored server-side in [face_compare_service.py](../backend/app/services/face_compare_service.py).

This is a legitimate lightweight "are these two detections geometrically similar" check, but
it is **not** the same as a learned face-embedding model (e.g., ArcFace/FaceNet-style), and
should never be marketed or relied upon as identity verification. The README's own roadmap
note (pgvector `embedding_vector` column, reserved but unused) already acknowledges this gap
correctly — worth keeping that framing honest in any product copy.

- [x] Threshold (0.78) is configurable, not hard-coded
- [ ] No FAR/FRR benchmarking has been done on this similarity metric — because it's landmark
  geometry, not a trained embedding space, standard face-recognition benchmarking methodology
  doesn't directly apply; if this ever needs to be a real verification feature, that means
  adopting an actual embedding model, not tuning the current threshold further

---

## 11. Liveness Detection

**Not implemented — and correctly out of scope today**, since FaceVision doesn't gate
authentication, payments, or KYC on face matching. If that ever changes, liveness becomes
mandatory before compare results could be trusted for anything security-sensitive — a static
photo of a photo currently passes detection + "compare" with a high similarity score, which is
fine for a demo/portfolio feature and unsafe for any real auth decision.

---

## 12. AI Inference Efficiency

- [x] Model loaded once via `prepareDetector()` lazy init with a runtime status badge in the
  UI, not reloaded per detection ([face-vision.tsx](../frontend/src/components/face-vision.tsx))
- [x] ONNX Runtime session reused across detections in a session
- [x] WebGPU-first with automatic WASM fallback — hardware acceleration used when available
- [ ] No explicit cancellation/timeout wired into a single inference call (camera mode relies
  on `requestAnimationFrame` cadence rather than an inference-level timeout) — acceptable for
  a client-side, user-initiated action; would matter more for a server-side inference path,
  which this app doesn't have

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

Actual routes (all under `/api`, see [backend/app/main.py](../backend/app/main.py)):

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | liveness |
| POST | `/api/detections` | store a detection |
| GET | `/api/detections` | paginated list |
| GET/DELETE | `/api/detections/{id}` | fetch/delete one |
| GET/DELETE | `/api/history` | history alias + clear |
| GET | `/api/stats` | aggregated KPIs |
| POST | `/api/compare` | landmark similarity |

- [x] Clean, versioned-by-convention (not literally `/v1/` yet — worth adding if you expect
  breaking changes; low priority for a single-consumer app)
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
- [ ] No formal retention policy is enforced — `detection_records`/`face_records` persist
  indefinitely unless a user calls `DELETE /api/history` themselves. There's no scheduled
  purge job. Landmark coordinates are geometric metadata, not raw biometric templates, but
  they're still tied to a `user_session_id` and should have a documented retention answer
  (even if the honest answer today is "kept until manually cleared")
- [ ] No documented answer yet to: what's stored / why / who can access it / how long / how
  deleted — the checklist's four questions in §16 don't have a written answer anywhere. Worth
  a short paragraph in the README's Privacy section.

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

- [~] Thresholds are configurable **on the frontend** (confidence/NMS sliders in Settings
  panel) — good, not hard-coded there
- [ ] **Backend configuration is not centralized.** `os.getenv(...)` calls are scattered
  across `main.py`, `database.py`, `core/security.py`, `core/rate_limit.py` instead of one
  `Settings` object (e.g., `pydantic-settings` `BaseSettings`). Works fine today, but a env-var
  typo in one of five different files is easier to miss than a typo in one schema. Worth
  consolidating if the backend grows.

---

## 21. Model Versioning

**Gap.** Nothing in a detection response records which YuNet model file, ONNX Runtime Web
version, or confidence/NMS config produced it. If the bundled `.onnx` file is ever swapped,
there's no way to trace historical detections back to "which model version made this call."
Cheap fix: stamp a `modelVersion` string (e.g., `"yunet-2023mar"`) onto stored detection
records.

---

## 22–25. Testing, Accuracy, Security, Load Testing

| Area | Status |
|---|---|
| Frontend unit tests | [x] `image.test.ts`, `yunet.test.ts`, `face-math.test.ts` — validation, NMS, and landmark-similarity logic covered |
| Backend unit tests | [x] 18 tests covering detection/stats/compare services, security gate, rate limiter, DB URL normalization, init-db retry logic |
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
[database/migrations/001_init_schema.sql](../database/migrations/001_init_schema.sql)):

```
detection_records (id, mode, face_count, avg_confidence, user_session_id, created_at)
  └── face_records (detection_id FK, box_*, confidence, landmarks JSONB)
```

- [x] Two focused, purpose-specific tables — not a catch-all "biometric blob in the users table"
- [ ] The SQL migration also defines `users`, `face_gallery`, `gallery_face_samples`,
  `app_settings` — none of these are used by any current model/router. Reserved for a future
  identity-gallery feature, but currently dead weight; documented as a known limitation rather
  than silently ignored

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
- [ ] No documented license/CVE review process — `npm audit` and `pip-audit`-style scanning
  isn't wired into CI yet; the one real vulnerability found so far (vitest CVE) was caught
  manually, not automatically

---

## 32. AI Model Governance

**Gap.** No model card exists for the bundled `face_detection_yunet_2023mar.onnx`. Recommended
minimal card (add as `docs/model-card-yunet.md` when time allows):

```
Model: YuNet 2023mar
Source: OpenCV Zoo (https://github.com/opencv/opencv_zoo)
License: Apache 2.0 (already noted in README)
Input: 640×640 RGB, BGR-converted, mean-subtracted
Intended use: browser-side face bounding-box + 5-point landmark detection
Known limitations: not evaluated for demographic parity; not a liveness or recognition model
Runtime: ONNX Runtime Web 1.27, WebGPU-first / WASM fallback
Confidence threshold: 0.75 (default, user-configurable)
NMS IoU threshold: 0.35 (default, user-configurable)
```

---

## 33. Bias & Fairness Testing

**Not done.** No demographic breakdown of detection accuracy exists. Given this app doesn't
make consequential decisions about people (no auth/access-control gated on face match), the
risk profile is lower than a KYC or access-control system — but if FaceVision's scope ever
expands toward identity decisions, this becomes mandatory, not optional.

---

## 34–36. Unit / Integration / Performance Tests

- [x] Unit tests: 12 frontend (Vitest) + 18 backend (pytest) — see §22
- [~] Integration tests: FastAPI's `TestClient` is used for health-endpoint tests only; no
  end-to-end test exercises the full detect→store→retrieve→stats pipeline against a real
  Postgres instance in CI (the CI Postgres service exists but current tests don't hit it with
  a full-pipeline scenario)
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
- [ ] No dedicated model card (see §32) or architecture-decision-record (ADR) log — decisions
  like "why landmark similarity instead of embeddings" live in conversation history and this
  checklist, not a durable doc yet

---

## 40. Production Readiness Checklist (honest current state)

- [x] Functional requirements documented (README + this file)
- [ ] Model benchmarked against alternatives
- [ ] Accuracy formally measured (precision/recall/FAR/FRR)
- [~] Security testing: schema validation + payload caps done; no adversarial/spoofing test suite
- [x] Load testing tooling exists; not yet run against production for a real baseline
- [ ] Memory testing (browser long-session soak test) not done
- [x] API authenticated (opt-in `API_KEY`)
- [x] Rate limiting exists
- [x] Input validation exists (frontend + backend)
- [ ] Biometric retention policy not formally documented (informally: "kept until user clears
  history")
- [x] Sensitive data never logged (verified)
- [ ] Model versioning not stamped on records
- [~] Basic observability (request logs); no dashboards/alerts
- [x] Unit tests exist (frontend + backend)
- [~] Integration tests exist for health only, not full pipeline
- [~] Some failure scenarios tested (invalid compare payload, zero-size box, rate limit,
  DB-not-ready retry); not exhaustive
- [x] Documentation complete for current scope
- [ ] No formal code review process (solo project)
- [ ] No automated dependency/license/CVE scanning in CI
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
| 2 — Engineering Foundation (structure, abstraction, config, validation, error handling, logging, API) | [x] structure/validation/error-handling/logging/API done; [ ] AI abstraction interface not formalized (§5); [ ] config not centralized (§20) |
| 3 — Quality (face quality, threshold calibration, multi-face, edge cases) | [~] thresholds configurable and tuned informally; [ ] no structured quality-assessment module (§9) |
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
8. **Decompression-bomb protection?** Not explicitly guarded — see §6 gap.
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
15. **Model replaceable without changing business logic?** Not yet — no interface abstraction
    exists (§5); today it would require editing `face-vision.tsx`.
16. **Where are face images stored?** Nowhere — never leave the browser.
17. **Retention?** Detection metadata persists until a user clears history; no formal policy doc.
18. **Embeddings stored?** No — landmark coordinates only, and only if the backend is used.
19. **Who can access them?** Anyone with the `API_KEY` (if set) can write; read endpoints are
    currently open (no per-session read restriction beyond the `userSessionId` query filter,
    which is client-supplied and not cryptographically bound to a session).
20. **Biometric values in logs?** No — verified across every logging call in the codebase.
21. **Spoofing handled?** No — no liveness detection exists (§11), by design given current scope.
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
real engineering discipline (layering, tests, CI, no raw biometric storage, rate limiting, API
keys). It is *not* production-ready for any KYC/auth/payments use case — and per this
checklist's own standard, it shouldn't be sold as one until §§9, 11, 21, 22–25, 32–33 are
addressed.

---

## Final Principle (unchanged from source)

The AI model is one component, not the system. Keep it swappable, keep raw biometric data off
the wire and out of storage, keep the pipeline observable and testable, and never let "the
camera detects a face" pass for "done."
