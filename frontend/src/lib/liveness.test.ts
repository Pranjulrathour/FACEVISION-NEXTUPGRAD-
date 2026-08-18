import { describe, expect, it } from "vitest";
import { LivenessHeuristic } from "./liveness";
import type { FaceLandmarks } from "./face-types";

function landmarksAt(offsetX: number, offsetY = 0): FaceLandmarks {
  return {
    rightEye: { x: 30 + offsetX, y: 30 + offsetY },
    leftEye: { x: 70 + offsetX, y: 30 + offsetY },
    nose: { x: 50 + offsetX, y: 50 + offsetY },
    rightMouth: { x: 35 + offsetX, y: 70 + offsetY },
    leftMouth: { x: 65 + offsetX, y: 70 + offsetY },
  };
}

describe("LivenessHeuristic", () => {
  it("reports insufficient_data until the window fills up", () => {
    const heuristic = new LivenessHeuristic(4, 0.15);
    expect(heuristic.observe(landmarksAt(0)).signal).toBe("insufficient_data");
    expect(heuristic.observe(landmarksAt(0)).signal).toBe("insufficient_data");
    expect(heuristic.observe(landmarksAt(0)).signal).toBe("insufficient_data");
  });

  it("flags identical landmarks across every frame as static_input_suspected", () => {
    const heuristic = new LivenessHeuristic(4, 0.15);
    let last;
    for (let i = 0; i < 4; i += 1) {
      last = heuristic.observe(landmarksAt(0));
    }
    expect(last!.signal).toBe("static_input_suspected");
  });

  it("flags naturally varying landmarks as dynamic_movement_detected", () => {
    const heuristic = new LivenessHeuristic(4, 0.15);
    let last;
    const jitters = [0, 0.5, -0.3, 0.8];
    for (const jitter of jitters) {
      last = heuristic.observe(landmarksAt(jitter, jitter * 0.5));
    }
    expect(last!.signal).toBe("dynamic_movement_detected");
  });

  it("reset() clears history so the window must refill", () => {
    const heuristic = new LivenessHeuristic(3, 0.15);
    heuristic.observe(landmarksAt(0));
    heuristic.observe(landmarksAt(0));
    heuristic.observe(landmarksAt(0));
    heuristic.reset();
    expect(heuristic.observe(landmarksAt(0)).signal).toBe("insufficient_data");
  });

  it("only considers the most recent windowSize frames (sliding window)", () => {
    const heuristic = new LivenessHeuristic(3, 0.15);
    // First a big jump, then it settles static — after the window slides
    // past the jump, it should detect static again.
    heuristic.observe(landmarksAt(0));
    heuristic.observe(landmarksAt(100)); // one big jump
    heuristic.observe(landmarksAt(100));
    const result = heuristic.observe(landmarksAt(100));
    expect(result.signal).toBe("static_input_suspected");
  });
});
