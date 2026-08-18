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

**Raw image pixels are never sent to, or stored by, the backend.** Detection runs entirely in
the browser; only the metadata above is optionally persisted.

## Why is it stored?

Solely to power the app's own History and Stats panels — letting a user revisit past
detections and see aggregate trends within their own browser session. There is no analytics,
advertising, or third-party sharing use case.

## Who can access it?

- **The backend operator** (whoever runs the FastAPI service) can query the database directly
  — there's no per-record encryption beyond normal database access controls (see
  [README.md Production Checklist](../README.md#production-checklist) for hardening steps).
- **API callers**: read endpoints (`GET /api/detections`, `GET /api/history`, `GET /api/stats`)
  are currently unauthenticated by default — anyone who can reach the backend URL can read
  data for a given `userSessionId` if they know or guess it. Session IDs are randomly generated
  (not sequential/enumerable in practice) but this is **not** access-controlled the way a real
  user-account system would be. Write/destructive endpoints (`POST /api/detections`,
  `DELETE /api/detections/{id}`, `DELETE /api/history`) can be gated behind `API_KEY` (see
  [README.md § Security & rate limiting](../README.md#security--rate-limiting)).

## How long is it stored?

**Indefinitely by default**, until a user clears their own history (`DELETE /api/history`) or
an operator runs the retention-purge script. As of this update, retention is enforceable via:

- `RETENTION_DAYS` environment variable (unset by default — retention disabled, matching prior
  behavior so existing deployments don't suddenly start deleting data on upgrade)
- `backend/scripts/purge_old_detections.py` — deletes `detection_records` (and their cascaded
  `face_records`) older than `RETENTION_DAYS`, when set
- Run manually, or schedule it (cron, Railway scheduled job, etc.) for automatic enforcement

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
