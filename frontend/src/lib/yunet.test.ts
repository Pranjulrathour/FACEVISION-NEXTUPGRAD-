import { describe, expect, it } from "vitest";
import { nonMaximumSuppression } from "./yunet";
import type { Face } from "./face-types";

function makeFace(box: Face["box"], confidence: number): Face {
  return {
    box,
    confidence,
    landmarks: {
      rightEye: { x: box.x + box.width * 0.3, y: box.y + box.height * 0.35 },
      leftEye: { x: box.x + box.width * 0.7, y: box.y + box.height * 0.35 },
      nose: { x: box.x + box.width * 0.5, y: box.y + box.height * 0.5 },
      rightMouth: { x: box.x + box.width * 0.35, y: box.y + box.height * 0.75 },
      leftMouth: { x: box.x + box.width * 0.65, y: box.y + box.height * 0.75 },
    },
  };
}

describe("nonMaximumSuppression", () => {
  it("keeps the most confident overlapping face", () => {
    const faces = nonMaximumSuppression([
      makeFace({ x: 10, y: 10, width: 100, height: 100 }, 0.91),
      makeFace({ x: 12, y: 12, width: 100, height: 100 }, 0.82),
    ]);
    expect(faces).toHaveLength(1); expect(faces[0].confidence).toBe(0.91);
  });
});
