# ADR 0003: MiniFASNet liveness model + JWT user accounts

## Status

Accepted. Adds a real anti-spoofing model alongside (not replacing) the existing passive
heuristic, and adds an optional authenticated-user layer alongside (not replacing) anonymous
`user_session_id` scoping.

## Context

Checklist §11 flagged that FaceVision's only liveness signal was a heuristic (frame-to-frame
landmark movement in camera mode) — explicitly documented as "not certified anti-spoofing" and
not relied on for any security decision. A printed photo or a phone screen showing a face could
be enrolled or recognized identically to a live person.

Checklist §15/§16 flagged that the `users` table from `001_init_schema.sql` was unused — gallery
entries and detections were scoped only by a client-supplied `user_session_id`, which is
unauthenticated and guessable/spoofable by anyone who can read or infer another user's session
id. There was no way for a person to durably own their gallery entries across devices/sessions,
and no way to prevent one client from reading/deleting another's data if it guessed or was handed
a session id.

## Decision

### Liveness: MiniFASNet V2

Bundle **MiniFASNet V2** (`minifasnet_v2.onnx`, ~1.7MB, from
[minivision-ai/Silent-Face-Anti-Spoofing](https://github.com/minivision-ai/Silent-Face-Anti-Spoofing),
Apache 2.0) as a third client-side ONNX model, lazy-loaded only when the user clicks "Check
Liveness" on a detected face — same lazy-load pattern as SFace.

Verified directly against the downloaded model graph (not assumed from docs):
- Input `input`: `[batch_size, 3, 80, 80]`, float32, BGR channel order, `/255` scaled (confirmed
  against the original repo's `anti_spoof_predict.py` preprocessing, not RGB like SFace/YuNet)
- Output `output`: `[batch_size, 3]`, float32 — **raw logits, not softmax probabilities**;
  confirmed via `onnx.load()` node inspection: the graph's terminal nodes are
  `[Concat, Reshape, MatMul, BatchNormalization, MatMul]`, ending in `MatMul`, with no `Softmax`
  node anywhere in the graph. Softmax is applied client-side
  (`frontend/src/lib/minifasnet.ts`'s `softmax()`).
- Class index 1 = real, indices 0 and 2 = fake (confirmed against the original repo's `test.py`
  calling code, which the exported graph itself does not encode).

**Face cropping is model-specific**, not a reuse of the existing detection box or SFace's aligned
crop: MiniFASNet expects a box expanded by a fixed `scale=2.7` around the detected face (ported
exactly from the original repo's `_get_new_box` in `generate_patches.py`, including its edge/
corner clamping behavior), not a tight bounding-box crop and not SFace's landmark-warped 112×112
alignment. Implemented in `frontend/src/lib/antispoof-crop.ts`.

This is **additive, not a replacement** for the existing heuristic
(`frontend/src/lib/liveness.ts`) — the heuristic still runs automatically in camera mode as a
zero-cost passive signal; MiniFASNet is a heavier, user-triggered, actually-trained
anti-spoofing check.

### Auth: JWT + bcrypt, additive to session scoping

Add a real `users` table (extending the existing but previously-unused schema with a
`password_hash` column via `004_users_password_hash.sql`), `POST /auth/register`,
`POST /auth/login`, `GET /auth/me`, and JWT bearer tokens (PyJWT, HS256, bcrypt-hashed passwords)
in `backend/app/core/auth.py`.

Anonymous `user_session_id` scoping is **not removed** — a user can still use Gallery without an
account, same as before. What changes: when a request carries a valid `Authorization: Bearer`
token, `resolve_scope_id()` in `auth.py` **always** derives the scope from the authenticated
user's real id (`f"user:{user.id}"`), ignoring whatever `userSessionId` the client sent in the
same request. This closes the specific gap §16 raised: an authenticated user can no longer plant
data under, or be tricked into trusting, a client-claimed session id — their identity is
server-derived from a cryptographically verified token, not client-asserted.

Login/register failure responses are deliberately identical (401, no distinguishing detail)
whether the email doesn't exist or the password is wrong, to avoid an account-enumeration oracle
(checklist §24).

## Consequences

- **Liveness now has a real, benchmarkable signal** for users who explicitly request it — not
  just a heuristic. It is still not wired into any automatic gate (enroll/recognize don't require
  a passing liveness check) — that's a deliberate scope boundary for this ADR, not an oversight;
  revisit only if the product requires liveness-gated enrollment.
- **A third model to govern** — see [docs/model-card-minifasnet.md](../model-card-minifasnet.md).
- **Repo size grew by ~1.7MB** (small relative to SFace's ~37MB).
- **New attack surface**: password storage (mitigated: bcrypt, per-password salt, fails closed on
  malformed hashes), JWT forgery/tampering/expiry (mitigated: HS256 signature verification,
  `exp` claim enforced, covered by `test_auth_core.py`), and login enumeration (mitigated: uniform
  401 responses, covered by `test_auth_router.py`).
- **A real, pre-existing bug was found and fixed while building this**: the rate limiter's
  in-memory `_hits` dict was keyed only by client IP, shared across every `rate_limiter()` call
  site regardless of route — meaning hitting `/gallery/enroll` could silently consume the budget
  meant for `/detections`. Fixed by keying on `(limiter_id, ip)` instead
  (`backend/app/core/rate_limit.py`); regression test in `test_security_and_rate_limit.py`.
- **No frontend login/register UI was added in this pass** — the backend fully supports auth, but
  `face-vision.tsx` has no form for it yet. This is a known, tracked gap (see checklist §15/§16
  status), not a silent omission.
- **Privacy policy extended**: password hashes and email addresses are now a category of stored
  data that didn't exist before — documented in
  [docs/privacy-retention-policy.md](../privacy-retention-policy.md).
