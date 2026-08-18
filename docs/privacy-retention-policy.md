# Privacy & Biometric Data Retention Policy

Answers the four required questions from
[docs/face-detection-verification-checklist.md §16](face-detection-verification-checklist.md#16-privacy--biometric-security),
concretely rather than left open.

## What is stored?

Nothing biometric that leaves the user's control silently. Specifically, **if and only if** a
backend is configured and reachable (`NEXT_PUBLIC_API_URL` is set and the app can reach it):

- Bounding box coordinates (`x`, `y`, `width`, `height`) per detected face
- Detection confidence score
- 5-point landmark coordinates (right eye, left eye, nose, right mouth corner, left mouth
  corner) as JSON, in `face_records.landmarks`
- Detection mode (`upload`/`camera`), timestamp, an optional image filename (never the image
  itself), and the model version that produced the detection
- A per-browser, randomly generated session identifier (`user_session_id`) — not a real user
  account, no email/name/PII

**If a user explicitly enrolls a face in the Gallery** (checklist §2, §28 — see
[ADR 0002](adr/0002-sface-embeddings-for-gallery-recognition.md)):
- A 128-dimension SFace embedding vector (`gallery_face_samples.embedding`) — this is real
  derived biometric data, not geometric metadata like the landmarks above. Storing it is what
  makes recognition against that identity possible later.
- The name the user typed for that identity (`face_gallery.name`) — chosen freely by the user,
  not verified against any real-world identity document.
- This only happens on an explicit "Enroll" action; it is never automatic.

**Raw image pixels are never sent to, or stored by, the backend, in either case.** Detection and
embedding computation both run entirely in the browser; only the metadata/vectors above are
optionally persisted, and only when the user takes an explicit action.

**If a user explicitly registers an account** (checklist §15/§16 — see
[ADR 0003](adr/0003-minifasnet-liveness-and-jwt-auth.md)):
- Email address (`users.email`) — used only as a login identifier, never displayed publicly or
  shared with any third party.
- A bcrypt password hash (`users.password_hash`) — **never the plaintext password**. Hashing is
  one-way and salted per-password; the original password cannot be recovered from the stored
  hash. Password verification failure (wrong password, or a malformed/corrupted hash) is treated
  identically as "not authenticated" — it never crashes or leaks which case occurred.
- An optional display name (`users.display_name`), chosen freely by the user.
- This only happens on an explicit "register" action against `POST /api/v1/auth/register`; it
  is never automatic, and using the app's detection/gallery features does not require an account.
- Once logged in, a signed JWT (issued by the backend, stored client-side by whatever the caller
  chooses — no browser storage mechanism is imposed by the API itself) is used to authenticate
  subsequent requests. The token contains only the user's internal id and an expiry timestamp —
  no email, password, or biometric data is embedded in it.

## Why is it stored?

Detection metadata: to power the app's own History and Stats panels — letting a user revisit
past detections and see aggregate trends within their own browser session. Gallery embeddings:
solely to let a user recognize a previously-enrolled identity in later detections — the entire
point of the feature they explicitly opted into. Account credentials: solely to let a user's
gallery data follow them (via a verified identity) rather than a guessable/unauthenticated
session id — see "Who can access it?" below. There is no analytics, advertising, or third-party
sharing use case for any of these.

## Who can access it?

- **The backend operator** (whoever runs the FastAPI service) can query the database directly
  — there's no per-record encryption beyond normal database access controls (see
  [README.md Production Checklist](../README.md#production-checklist) for hardening steps).
- **API callers**: read endpoints (`GET /api/detections`, `GET /api/history`, `GET /api/stats`,
  `GET /api/gallery`) are currently unauthenticated by default — anyone who can reach the
  backend URL can read data for a given `userSessionId` if they know or guess it. Session IDs
  are randomly generated (not sequential/enumerable in practice) but this is **not**
  access-controlled the way a real user-account system would be. Write/destructive endpoints
  (`POST /api/detections`, `DELETE /api/detections/{id}`, `DELETE /api/history`,
  `POST /api/gallery/enroll`, `DELETE /api/gallery/{id}`) can be gated behind `API_KEY` (see
  [README.md § Security & rate limiting](../README.md#security--rate-limiting)). Note:
  `POST /api/gallery/recognize` is intentionally **not** gated behind `API_KEY` (a visitor
  needs to be able to check a face against the gallery to use the feature at all) — it is
  rate-limited instead.
- **Authenticated users**: if a caller presents a valid JWT (obtained via
  `POST /api/v1/auth/login` or `.../register`), their gallery reads/writes are scoped to their
  real user id — derived from the verified token, not from any client-supplied
  `userSessionId` — so one authenticated user cannot read or delete another authenticated
  user's gallery entries by guessing an id or a session string. This does not change the
  anonymous-session behavior described above for callers who don't authenticate.

## How long is it stored?

**Indefinitely by default**, until a user clears their own history (`DELETE /api/history`) or
an operator runs the retention-purge script. As of this update, retention is enforceable via:

- `RETENTION_DAYS` environment variable (unset by default — retention disabled, matching prior
  behavior so existing deployments don't suddenly start deleting data on upgrade)
- `backend/scripts/purge_old_detections.py` — deletes `detection_records` (and their cascaded
  `face_records`) older than `RETENTION_DAYS`, when set
- Run manually, or schedule it (cron, Railway scheduled job, etc.) for automatic enforcement
- **Gallery entries are not covered by `RETENTION_DAYS`** — an enrolled identity persists
  indefinitely until the user (or an operator) explicitly deletes it via
  `DELETE /api/gallery/{id}`. This is a deliberate difference from detection history: an
  enrolled identity is meant to be durable (that's the point of enrolling it), not something
  that silently expires. If you want gallery entries to also expire automatically, that's a
  gap to fill, not something the current purge script does.

**User accounts are not covered by `RETENTION_DAYS`** either — an account persists indefinitely
until deleted by an operator directly against the database (there is currently no
self-service "delete my account" endpoint; this is a tracked gap, not a design decision).

## How is it deleted?

- **User-initiated**: `DELETE /api/history?userSessionId=...` (wired to the app's "Clear
  History" UI action) or `DELETE /api/detections/{id}` for a single record
- **Operator-initiated / scheduled**: `python backend/scripts/purge_old_detections.py` with
  `RETENTION_DAYS` set
- Deletion is a real SQL `DELETE`, not a soft-delete/tombstone — once removed, the row and its
  cascaded face records are gone from the database (subject to normal database backup
  retention on the infrastructure side, which is outside this app's control — see the
  README's Known Limitations on backup strategy).

## What's explicitly *not* covered by this policy

- Database backups/snapshots taken by the hosting platform (e.g. Railway) are outside this
  app's control — a deleted record may still exist in a backup until that backup itself
  expires per the platform's own retention.
- Browser-side `localStorage` history (used when no backend is configured, or as a local
  cache) is controlled entirely by the user's own browser and is cleared by normal browser
  data-clearing actions, not by this app's backend deletion endpoints.
