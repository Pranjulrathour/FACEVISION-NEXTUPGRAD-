# ADR 0006: Mandatory sign-in gate + claim-anonymous-gallery-on-signup

## Status

Accepted. Supersedes the "anonymous session scoping is not removed" position taken in
[ADR 0003](0003-minifasnet-liveness-and-jwt-auth.md) — an account is now required before the
camera/gallery screen is reachable at all.

## Context

ADR 0003 added JWT accounts as an *additive* layer on top of anonymous `user_session_id`
scoping: signing in was optional, and gallery data followed whichever identity (account or
anonymous browser session) a request happened to carry. That left two open problems:

1. **Recognition wasn't durable across visits in the way the product needs.** A person could
   enroll a face, but "come back and be recognized" only worked on the *same browser*, because
   nothing forced the recognition path through an account. There was also no persistent, glanceable
   answer for a face the gallery didn't know — recognition was a manual, per-click action with a
   transient status message, not a standing label.
2. **Anonymous gallery data had no owner.** Anyone could enroll/recognize without an account, so
   there was no durable identity to hand that data to later, and no way to guarantee two visits
   from the same person actually shared a gallery unless they happened to reuse the same browser
   session id.

## Decision

### The home screen now requires a session

`frontend/src/app/login/page.tsx` is a dedicated sign-in/create-account page. `face-vision.tsx`
gates its entire render behind a mount-time check: no stored session → redirect to `/login`
immediately; a stored session is also verified against `GET /auth/me` so an expired/revoked
token gets the same treatment instead of silently failing later. A network error or 5xx from that
check does **not** sign the user out — only a real `401` does — so a backend blip can't punish a
legitimately signed-in user.

This isn't a new backend capability — `resolve_scope_id()` already preferred the authenticated
user's real id over a client-supplied session id (ADR 0003). What's new is that the frontend can
no longer reach the gallery/recognition UI *without* going through that path, so recognition
durably follows the account rather than the browser.

### Recognition became automatic, not click-triggered

Every detected face is now auto-checked against the gallery — once per upload-mode detection, and
on a 5-second-per-face-slot throttle (`frontend/src/lib/recognition-throttle.ts`) during live
camera mode — and always lands on a definite, persistent label: `Recognized: <name>` or
**`Not registered`**. The manual "Recognize" button still works (now sharing the same
`runRecognitionCheck` path) for an on-demand re-check. The throttle window was sized to stay well
under the recognize endpoint's rate limit even with a few faces on screen at once; that limit's
default was raised from 30/min to 60/min (`backend/app/routers/gallery.py`) to give this
comfortable headroom.

### Anonymous gallery entries are claimed, not orphaned

Making sign-in mandatory would otherwise strand any faces enrolled anonymously *before* this
change (including this project's own test data). `RegisterRequest`/`LoginRequest` gained an
optional `anonymousSessionId`; both endpoints call
`gallery_service.claim_anonymous_entries()`, a bulk `UPDATE` reassigning matching rows from the
raw anonymous id to the account's `user:{id}` scope. It's a no-op when there's nothing to claim
and idempotent if called twice. The frontend reports how many entries were claimed
(`TokenResponse.claimedGalleryEntries`) via a one-time welcome message handed from `/login` to the
home screen (`auth-client.ts`'s `setPendingWelcomeMessage`/`consumePendingWelcomeMessage`).

Detections/history remain anonymous-session-scoped only (unchanged from ADR 0003) — this ADR
deliberately doesn't extend claiming to them, since the mandatory gate and the "remember this
face" requirement are both about the gallery specifically.

## Consequences

- **No more anonymous gallery usage going forward.** Every new gallery entry is now created by an
  authenticated user; the anonymous `user_session_id` path in `gallery_service.py` still exists
  (and is still exercised by `claim_anonymous_entries`'s source rows and by the test suite) but is
  no longer reachable through the UI. It was not deleted, since it's still the correct scoping
  primitive for a request with no bearer token.
- **A returning user's recognition now follows their account across devices/browsers**, not just
  the browser that did the enrolling — the actual product requirement this ADR exists to satisfy.
- **One additional network round trip per recognized face**, bounded by the throttle. Verified
  live (not just unit-tested) that this doesn't visibly lag the UI or trip the rate limiter under
  normal single- or few-face use.
- **Local dev/test data migration was hand-verified**, not just unit-tested: a face enrolled
  anonymously before this change was confirmed, via a live register call through the actual
  `/login` page, to reappear under the new account with the same name.
- **`api-client.ts` had zero unit coverage before this change**; it now has direct tests for
  `register`/`login`/`getMe`, including the 401-vs-network-failure distinction the session guard
  depends on (`api-client.test.ts`).
