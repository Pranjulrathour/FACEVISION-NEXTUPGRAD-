import { describe, expect, it } from "vitest";
import {
  cosineSimilarity,
  deepEqualFace,
  estimateFaceAngle,
  euclideanDistance,
} from "./face-math";
import type { Face } from "./face-types";

function makeFace(overrides: Partial<Face> = {}): Face {
  return {
    box: { x: 0, y: 0, width: 100, height: 100 },
    confidence: 0.9,
    landmarks: {
      rightEye: { x: 30, y: 30 },
      leftEye: { x: 70, y: 30 },
      nose: { x: 50, y: 50 },
      rightMouth: { x: 35, y: 70 },
      leftMouth: { x: 65, y: 70 },
    },
    ...overrides,
  };
}

describe("deepEqualFace", () => {
  it("returns true for identical faces", () => {
    const face = makeFace();
    expect(deepEqualFace(face, makeFace())).toBe(true);
  });

  it("returns false when box position differs", () => {
    const a = makeFace();
    const b = makeFace({ box: { x: 5, y: 0, width: 100, height: 100 } });
    expect(deepEqualFace(a, b)).toBe(false);
  });

  it("tolerates tiny floating-point confidence drift", () => {
    const a = makeFace({ confidence: 0.9 });
    const b = makeFace({ confidence: 0.9000001 });
    expect(deepEqualFace(a, b)).toBe(true);
  });

  it("returns false when confidence differs meaningfully", () => {
    const a = makeFace({ confidence: 0.9 });
    const b = makeFace({ confidence: 0.5 });
    expect(deepEqualFace(a, b)).toBe(false);
  });
});

describe("euclideanDistance", () => {
  it("computes distance between two points", () => {
    expect(euclideanDistance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });
});

describe("cosineSimilarity", () => {
  it("returns 1 for identical vectors", () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1);
  });

  it("returns 0 for mismatched lengths or empty vectors", () => {
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
    expect(cosineSimilarity([], [])).toBe(0);
  });
});

describe("estimateFaceAngle", () => {
  it("returns 180 degrees for level eyes (rightEye left of leftEye)", () => {
    const landmarks = makeFace().landmarks;
    expect(estimateFaceAngle(landmarks)).toBeCloseTo(180);
  });

  it("returns 0 degrees when eyes are swapped left-to-right", () => {
    const landmarks = makeFace().landmarks;
    const swapped = { ...landmarks, rightEye: landmarks.leftEye, leftEye: landmarks.rightEye };
    expect(estimateFaceAngle(swapped)).toBeCloseTo(0);
  });
});
