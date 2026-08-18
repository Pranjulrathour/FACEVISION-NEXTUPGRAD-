import { describe, expect, it } from "vitest";
import {
  computeSimilarityTransform,
  landmarksToOrderedPoints,
  referenceLandmarkPoints,
  type Point2D,
} from "./face-alignment";
import type { FaceLandmarks } from "./face-types";

function applyTransform(t: { a: number; b: number; tx: number; ty: number }, p: Point2D): Point2D {
  return {
    x: t.a * p.x - t.b * p.y + t.tx,
    y: t.b * p.x + t.a * p.y + t.ty,
  };
}

describe("computeSimilarityTransform", () => {
  it("maps identical point sets to the identity transform", () => {
    const points: Point2D[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 5, y: 10 },
    ];
    const t = computeSimilarityTransform(points, points);
    for (const p of points) {
      const mapped = applyTransform(t, p);
      expect(mapped.x).toBeCloseTo(p.x, 5);
      expect(mapped.y).toBeCloseTo(p.y, 5);
    }
  });

  it("recovers a pure translation", () => {
    const src: Point2D[] = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }];
    const dst: Point2D[] = src.map((p) => ({ x: p.x + 50, y: p.y + 20 }));
    const t = computeSimilarityTransform(src, dst);
    expect(t.a).toBeCloseTo(1, 5);
    expect(t.b).toBeCloseTo(0, 5);
    for (let i = 0; i < src.length; i += 1) {
      const mapped = applyTransform(t, src[i]);
      expect(mapped.x).toBeCloseTo(dst[i].x, 5);
      expect(mapped.y).toBeCloseTo(dst[i].y, 5);
    }
  });

  it("recovers a pure uniform scale", () => {
    const src: Point2D[] = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }];
    const dst: Point2D[] = src.map((p) => ({ x: p.x * 2, y: p.y * 2 }));
    const t = computeSimilarityTransform(src, dst);
    expect(t.a).toBeCloseTo(2, 5);
    expect(t.b).toBeCloseTo(0, 5);
  });

  it("recovers a 90-degree rotation", () => {
    // 90° CCW rotation in a y-down (canvas) coordinate system: (x, y) -> (-y, x)
    const src: Point2D[] = [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }];
    const dst: Point2D[] = src.map((p) => ({ x: -p.y, y: p.x }));
    const t = computeSimilarityTransform(src, dst);
    for (let i = 0; i < src.length; i += 1) {
      const mapped = applyTransform(t, src[i]);
      expect(mapped.x).toBeCloseTo(dst[i].x, 5);
      expect(mapped.y).toBeCloseTo(dst[i].y, 5);
    }
  });

  it("handles a combined scale + rotation + translation", () => {
    const angle = Math.PI / 6; // 30 degrees
    const scale = 1.7;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const src: Point2D[] = [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: 2, y: 3 }, { x: -1, y: -2 }];
    const dst: Point2D[] = src.map((p) => ({
      x: scale * (cos * p.x - sin * p.y) + 15,
      y: scale * (sin * p.x + cos * p.y) - 7,
    }));
    const t = computeSimilarityTransform(src, dst);
    for (let i = 0; i < src.length; i += 1) {
      const mapped = applyTransform(t, src[i]);
      expect(mapped.x).toBeCloseTo(dst[i].x, 4);
      expect(mapped.y).toBeCloseTo(dst[i].y, 4);
    }
  });

  it("falls back to a translation-only transform for degenerate (zero-variance) source points", () => {
    const src: Point2D[] = [{ x: 5, y: 5 }, { x: 5, y: 5 }, { x: 5, y: 5 }];
    const dst: Point2D[] = [{ x: 10, y: 10 }, { x: 20, y: 20 }, { x: 30, y: 30 }];
    const t = computeSimilarityTransform(src, dst);
    expect(Number.isFinite(t.a)).toBe(true);
    expect(Number.isFinite(t.b)).toBe(true);
    expect(Number.isFinite(t.tx)).toBe(true);
    expect(Number.isFinite(t.ty)).toBe(true);
  });

  it("throws on mismatched or empty point-set lengths", () => {
    expect(() => computeSimilarityTransform([], [])).toThrow();
    expect(() => computeSimilarityTransform([{ x: 0, y: 0 }], [])).toThrow();
  });
});

describe("landmarksToOrderedPoints / referenceLandmarkPoints", () => {
  it("returns 5 points in a consistent order for both source and reference", () => {
    const landmarks: FaceLandmarks = {
      rightEye: { x: 1, y: 1 },
      leftEye: { x: 2, y: 2 },
      nose: { x: 3, y: 3 },
      rightMouth: { x: 4, y: 4 },
      leftMouth: { x: 5, y: 5 },
    };
    expect(landmarksToOrderedPoints(landmarks)).toHaveLength(5);
    expect(referenceLandmarkPoints()).toHaveLength(5);
  });

  it("reference points fall within the 112x112 aligned face size", () => {
    for (const p of referenceLandmarkPoints()) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(112);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(112);
    }
  });
});
