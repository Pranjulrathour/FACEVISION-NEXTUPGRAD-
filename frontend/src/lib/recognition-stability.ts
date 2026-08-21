/**
 * Hysteresis for the auto-recognition display: requires a new result to
 * repeat for a few consecutive checks before it's allowed to change an
 * already-confirmed label.
 *
 * A live face's similarity score naturally fluctuates a little from one
 * camera frame to the next (lighting, angle, motion blur) -- if it sits
 * close to the match threshold, that fluctuation alone flips the raw
 * verdict between "matched" and "unregistered" (or between two different
 * enrolled names) on almost every ~5s recheck, which reads as the shown
 * name flickering rather than as a real, sustained change. Requiring
 * agreement across a few checks before actually updating what's shown
 * fixes that without needing a higher, less sensitive match threshold
 * (which would just trade false flickers for false negatives).
 */

export type RecognitionStreak = { key: string; count: number };

export const REQUIRED_CONSECUTIVE_AGREEMENT = 2;

/** Advances the streak for a face slot given its latest raw result key
 * (e.g. "matched:Alice" or "unregistered") -- a repeat of the same key
 * extends the streak, anything else restarts it at 1. */
export function nextRecognitionStreak(
  previous: RecognitionStreak | undefined,
  key: string
): RecognitionStreak {
  if (previous && previous.key === key) {
    return { key, count: previous.count + 1 };
  }
  return { key, count: 1 };
}

/** Whether the latest raw result should actually be applied to what's
 * displayed. A face slot with no confirmed label yet (still "checking",
 * or never checked) always applies immediately -- there's nothing
 * confident to protect from flicker, and making someone wait through
 * multiple checks just to see their name for the very first time would
 * be a worse trade than the flicker this exists to prevent. Once a label
 * is confirmed, a change needs the streak to reach the required count. */
export function shouldApplyRecognitionResult(
  streak: RecognitionStreak,
  hasConfirmedLabel: boolean
): boolean {
  if (!hasConfirmedLabel) return true;
  return streak.count >= REQUIRED_CONSECUTIVE_AGREEMENT;
}
