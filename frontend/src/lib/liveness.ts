import type { FaceLandmarks } from "./face-types";

/**
 * ⚠️ HEURISTIC PASSIVE-LIVENESS SIGNAL — NOT A CERTIFIED ANTI-SPOOFING
 * SOLUTION. Do not use this to gate authentication, payments, KYC, or any
 * other security-sensitive decision (see docs/face-detection-verification-checklist.md §11).
 *
 * There is no trained liveness/anti-spoofing model in this app. This module
 * only tracks whether landmark positions move at all across consecutive
 * camera frames. A printed photo or a frozen/looping video feed held
 * perfectly still will show near-zero landmark movement; a live person
 * naturally has micro-movements. This catches the crudest spoofing attempt
 * (a completely static image held in front of the camera) and nothing
 * more — it says nothing about photo-of-a-photo, screen replay with
 * motion, or a printed photo that's gently wobbled by hand.
 */
export type LivenessSignal = "insufficient_data" | "static_input_suspected" | "dynamic_movement_detected";

export type LivenessObservation = {
  signal: LivenessSignal;
  detail: string;
};

const DEFAULT_WINDOW_SIZE = 8;
const DEFAULT_STATIC_EPSILON = 0.15; // px of average landmark movement below which a frame counts as "static"

export class LivenessHeuristic {
  private readonly windowSize: number;
  private readonly staticEpsilon: number;
  private history: FaceLandmarks[] = [];

  constructor(windowSize = DEFAULT_WINDOW_SIZE, staticEpsilon = DEFAULT_STATIC_EPSILON) {
    this.windowSize = windowSize;
    this.staticEpsilon = staticEpsilon;
  }

  reset(): void {
    this.history = [];
  }

  /** Feed the next frame's landmarks. Returns the current liveness signal. */
  observe(landmarks: FaceLandmarks): LivenessObservation {
    this.history.push(landmarks);
    if (this.history.length > this.windowSize) this.history.shift();

    if (this.history.length < this.windowSize) {
      return {
        signal: "insufficient_data",
        detail: `Collecting frames (${this.history.length}/${this.windowSize}).`,
      };
    }

    const avgMovement = averageLandmarkMovement(this.history);
    if (avgMovement < this.staticEpsilon) {
      return {
        signal: "static_input_suspected",
        detail: `Average landmark movement (${avgMovement.toFixed(3)}px) across the last ${this.windowSize} frames is near zero — possible static image.`,
      };
    }
    return {
      signal: "dynamic_movement_detected",
      detail: `Average landmark movement: ${avgMovement.toFixed(2)}px — natural micro-movement detected.`,
    };
  }
}

const LANDMARK_KEYS: (keyof FaceLandmarks)[] = ["rightEye", "leftEye", "nose", "rightMouth", "leftMouth"];

function averageLandmarkMovement(frames: FaceLandmarks[]): number {
  if (frames.length < 2) return 0;
  let totalMovement = 0;
  let comparisons = 0;
  for (let i = 1; i < frames.length; i += 1) {
    const prev = frames[i - 1];
    const curr = frames[i];
    for (const key of LANDMARK_KEYS) {
      const dx = curr[key].x - prev[key].x;
      const dy = curr[key].y - prev[key].y;
      totalMovement += Math.sqrt(dx * dx + dy * dy);
      comparisons += 1;
    }
  }
  return comparisons > 0 ? totalMovement / comparisons : 0;
}
