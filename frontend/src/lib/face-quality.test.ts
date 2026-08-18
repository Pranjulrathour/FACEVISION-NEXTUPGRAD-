import { describe, expect, it } from "vitest";
import { assessFaceQuality, assessFaces } from "./face-quality";
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

describe("assessFaceQuality", () => {
  it("passes a well-formed, front-facing, confident, adequately-sized face", () => {
    const result = assessFaceQuality(makeFace(), 1000, 1000);
    expect(result.code).toBe("OK");
    expect(result.isUsable).toBe(true);
  });

  it("flags low confidence", () => {
    const result = assessFaceQuality(makeFace({ confidence: 0.4 }), 1000, 1000);
    expect(result.code).toBe("LOW_CONFIDENCE");
    expect(result.isUsable).toBe(false);
  });

  it("flags a face that's too small relative to the image", () => {
    const face = makeFace({ box: { x: 0, y: 0, width: 10, height: 10 } });
    const result = assessFaceQuality(face, 1000, 1000);
    expect(result.code).toBe("FACE_TOO_SMALL");
  });

  it("flags extreme pose asymmetry", () => {
    const face = makeFace({
      // Head turned far to one side: right eye almost touching the nose,
      // left eye still far away — a 40:1 distance ratio.
      landmarks: {
        rightEye: { x: 49, y: 30 },
        leftEye: { x: 10, y: 30 },
        nose: { x: 50, y: 50 },
        rightMouth: { x: 35, y: 70 },
        leftMouth: { x: 65, y: 70 },
      },
    });
    const result = assessFaceQuality(face, 1000, 1000);
    expect(result.code).toBe("EXCESSIVE_POSE");
  });

  it("flags invalid image dimensions", () => {
    const result = assessFaceQuality(makeFace(), 0, 0);
    expect(result.code).toBe("INVALID_IMAGE");
  });

  it("respects custom thresholds", () => {
    const face = makeFace({ confidence: 0.6 });
    expect(assessFaceQuality(face, 1000, 1000).code).toBe("LOW_CONFIDENCE");
    expect(assessFaceQuality(face, 1000, 1000, { minConfidence: 0.5 }).code).toBe("OK");
  });
});

describe("assessFaces", () => {
  it("flags zero faces as NO_FACE", () => {
    expect(assessFaces([], 1000, 1000).code).toBe("NO_FACE");
  });

  it("allows multiple faces by default", () => {
    const result = assessFaces([makeFace(), makeFace()], 1000, 1000);
    expect(result.code).toBe("OK");
  });

  it("rejects multiple faces when configured for single-person workflows", () => {
    const result = assessFaces([makeFace(), makeFace()], 1000, 1000, { rejectMultipleFaces: true });
    expect(result.code).toBe("MULTIPLE_FACES");
  });

  it("assesses the highest-confidence face when multiple are present", () => {
    const strong = makeFace({ confidence: 0.95 });
    const weak = makeFace({ confidence: 0.3 });
    const result = assessFaces([weak, strong], 1000, 1000);
    expect(result.code).toBe("OK");
  });
});
