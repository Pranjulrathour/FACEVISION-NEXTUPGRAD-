/**
 * Gates how often live face recognition re-checks a given face slot.
 * Auto-recognition runs on every camera tick, but each check costs a
 * face-embedding pass plus a network round trip and counts against the
 * backend's per-minute rate limit -- checking every animation frame would
 * blow through both. Kept as a pure function (no timers, no state) so the
 * throttle decision itself is unit-testable without mocking the camera
 * loop it's used from.
 */

// 5s keeps the "show a face, see it labeled" feel responsive while
// staying well under the backend's recognize rate limit even with a
// few faces on screen at once (see GALLERY_RECOGNIZE_RATE_LIMIT_PER_MIN
// in backend/app/routers/gallery.py).
export const RECOGNIZE_THROTTLE_MS = 5000;

export function shouldAutoRecognize(
  now: number,
  lastCheckedAt: number | undefined,
  inFlight: boolean,
  throttleMs: number = RECOGNIZE_THROTTLE_MS
): boolean {
  if (inFlight) return false;
  if (lastCheckedAt === undefined) return true;
  return now - lastCheckedAt >= throttleMs;
}
