import { describe, expect, it } from "vitest";
import { assessFaceQuality, assessFaces } from "./face-quality";
import type { PixelBuffer } from "./pixel-analysis";
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

function solidColorBuffer(width: number, height: number, [r, g, b]: [number, number, number]): PixelBuffer {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = 255;
  }
  return { data, width, height };
}

function checkerboardBuffer(width: number, height: number): PixelBuffer {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = y * width + x;
      const value = (x + y) % 2 === 0 ? 255 : 0;
      data[idx * 4] = value;
      data[idx * 4 + 1] = value;
      data[idx * 4 + 2] = value;
      data[idx * 4 + 3] = 255;
    }
  }
  return { data, width, height };
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

  it("skips pixel-based checks entirely when no face image data is supplied", () => {
    // A face that would fail blur/lighting checks if pixel data were
    // provided still passes when it isn't -- pixel checks are opt-in.
    const result = assessFaceQuality(makeFace(), 1000, 1000);
    expect(result.code).toBe("OK");
  });

  it("flags an underexposed (too dark) face crop", () => {
    const dark = solidColorBuffer(50, 50, [5, 5, 5]);
    const result = assessFaceQuality(makeFace(), 1000, 1000, {}, dark);
    expect(result.code).toBe("POOR_LIGHTING");
  });

  it("flags an overexposed (too bright) face crop", () => {
    const bright = solidColorBuffer(50, 50, [250, 250, 250]);
    const result = assessFaceQuality(makeFace(), 1000, 1000, {}, bright);
    expect(result.code).toBe("POOR_LIGHTING");
  });

  it("flags a low-contrast (washed out) face crop", () => {
    const flat = solidColorBuffer(50, 50, [128, 128, 128]);
    const result = assessFaceQuality(makeFace(), 1000, 1000, {}, flat);
    expect(result.code).toBe("POOR_LIGHTING");
  });

  it("flags a blurry face crop even when lighting is fine", () => {
    // A smooth linear gradient (left to right): wide enough range for
    // healthy brightness/contrast, but a linear ramp has zero second
    // derivative everywhere in its interior, so the blur score stays ~0 —
    // no sharp edges anywhere, unlike a real photo of a face.
    const width = 50, height = 50;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const value = 50 + (x / width) * 150;
        const idx = y * width + x;
        data[idx * 4] = value;
        data[idx * 4 + 1] = value;
        data[idx * 4 + 2] = value;
        data[idx * 4 + 3] = 255;
      }
    }
    const result = assessFaceQuality(makeFace(), 1000, 1000, {}, { data, width, height });
    expect(result.code).toBe("IMAGE_TOO_BLURRY");
  });

  it("passes a sharp, well-lit face crop through pixel checks", () => {
    const sharp = checkerboardBuffer(50, 50);
    const result = assessFaceQuality(makeFace(), 1000, 1000, {}, sharp);
    expect(result.code).toBe("OK");
  });

  it("respects custom pixel-check thresholds", () => {
    const dark = solidColorBuffer(50, 50, [15, 15, 15]);
    expect(assessFaceQuality(makeFace(), 1000, 1000, {}, dark).code).toBe("POOR_LIGHTING");
    expect(
      assessFaceQuality(makeFace(), 1000, 1000, { minBrightness: 5, minContrast: 0 }, dark).code
    ).toBe("IMAGE_TOO_BLURRY"); // clears lighting now, but a solid color still has zero blur score
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
