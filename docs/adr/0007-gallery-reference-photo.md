# ADR 0007: Store a small reference photo per gallery identity

## Status

Accepted. Partially supersedes the "raw images never leave the browser" claim in
[ADR 0002](0002-sface-embeddings-for-gallery-recognition.md)'s Consequences section — that claim
no longer holds for gallery enrollment specifically. Detections/history are unaffected: those
still never involve an image leaving the browser.

## Context

The Gallery panel listed enrolled identities as name + sample count only. With more than a
couple of entries, there was no way to tell them apart at a glance — the user explicitly asked
for a visual alongside each enrolled candidate.

Three ways to give the list a visual were considered:

1. **A thumbnail saved only in this browser** (never sent to the backend) — keeps the backend's
   "no image" guarantee intact, at the cost of the photo not following the identity to another
   device/browser, and of a second, uncoordinated place gallery data can live.
2. **Store the photo on the backend**, alongside the existing embedding — the option taken.
3. **A generated, non-photographic placeholder** (initials, a color, a landmark sketch) — zero
   new privacy exposure, but doesn't answer "what does this person actually look like."

Option 2 was chosen explicitly by the user after being told what it gives up: this app's
enrollment flow had, until now, stored only a derived embedding vector, never an image, and that
was stated as a real privacy property in several places (README, in-app copy, ADR 0002,
`docs/privacy-retention-policy.md`). Storing a photo is a genuine, deliberate reversal of that
property for the gallery feature specifically — not an oversight, and not something to have
defaulted into without saying so.

## Decision

- `face_gallery.image_data` (`TEXT`, nullable) stores a JPEG data URL
  (`"data:image/jpeg;base64,..."`). Applied via the existing idempotent-column-migration
  mechanism ([ADR 0004](0004-self-healing-column-migrations.md)) —
  `database/migrations/005_gallery_reference_image.sql` is the paper record, `database.py`'s
  `apply_idempotent_column_migrations()` is what actually runs it.
- The frontend captures the photo at enroll time: `face-crop.ts`'s `captureFaceThumbnail()` crops
  the detected face's box out of the current frame, squashes it into a fixed 200×200 canvas
  (a plain profile-photo-style crop — exact aspect ratio doesn't matter for a small
  identification thumbnail), and encodes it as JPEG at 0.82 quality. Typically a few KB to a few
  tens of KB, not the original photo/video resolution.
- `EnrollRequest.image` is optional and capped at 300,000 characters
  (`MAX_IMAGE_DATA_URL_LENGTH`, `backend/app/schemas/gallery.py`) — generous for the thumbnail
  size above, while still rejecting an attempt to smuggle something much larger through this
  field.
- Enrolling a second sample under an existing name **replaces** the stored photo when a new one
  is given, and **leaves the existing one untouched** when it isn't (`gallery_service.py`'s
  `enroll_face()`) — re-enrolling without a captured image can't accidentally erase what's
  already there.
- Deletion is unchanged: the photo is just another column on `face_gallery`, so
  `DELETE /api/v1/gallery/{id}` and the account-deletion cascade both remove it along with
  everything else on that row, with no separate cleanup path to keep in sync.

## Consequences

- `docs/privacy-retention-policy.md`, the in-app Gallery panel copy, and the Live Features table
  in the README were updated to state plainly that a reference photo is now stored — none of
  them describe this as "no image" any more.
- The embedding vector remains the only thing actually used for *recognition* — the photo is
  purely a human-facing "which one is this" aid in the Gallery list and plays no role in matching.
- Anyone with read access to the gallery table (an authenticated user viewing their own entries,
  or a backend operator with direct database access) can now see an actual likeness of an
  enrolled person, not just derived numbers. This is a real increase in what a database compromise
  or an over-broad access grant would expose, accepted as part of this trade-off.
- No change to who can *reach* this data: the same `resolve_scope_id()`-based per-account
  isolation from ADR 0006 governs the image exactly like the rest of the row.
