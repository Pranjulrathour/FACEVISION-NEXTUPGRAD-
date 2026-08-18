import { describe, expect, it } from "vitest";
import { computeExpandedBox } from "./antispoof-crop";

describe("computeExpandedBox", () => {
  it("expands a centered box by the scale factor when there's room", () => {
    const box = { x: 400, y: 400, width: 100, height: 100 };
    const result = computeExpandedBox(box, 2.7, 1000, 1000);
    expect(result.width).toBeCloseTo(270, 1);
    expect(result.height).toBeCloseTo(270, 1);
    // Centered around the original box's center (450, 450).
    expect(result.x + result.width / 2).toBeCloseTo(450, 1);
    expect(result.y + result.height / 2).toBeCloseTo(450, 1);
  });

  it("clamps scale so the expanded box never exceeds the image bounds", () => {
    const box = { x: 10, y: 10, width: 80, height: 80 };
    const result = computeExpandedBox(box, 2.7, 100, 100);
    expect(result.width).toBeLessThanOrEqual(100);
    expect(result.height).toBeLessThanOrEqual(100);
  });

  it("shifts the crop to stay within bounds for a face near the left edge", () => {
    const box = { x: 0, y: 400, width: 100, height: 100 };
    const result = computeExpandedBox(box, 2.7, 1000, 1000);
    expect(result.x).toBeGreaterThanOrEqual(0);
    expect(result.x + result.width).toBeLessThanOrEqual(1000);
  });

  it("shifts the crop to stay within bounds for a face near the bottom-right corner", () => {
    const box = { x: 900, y: 900, width: 90, height: 90 };
    const result = computeExpandedBox(box, 2.7, 1000, 1000);
    expect(result.x).toBeGreaterThanOrEqual(0);
    expect(result.y).toBeGreaterThanOrEqual(0);
    expect(result.x + result.width).toBeLessThanOrEqual(1000);
    expect(result.y + result.height).toBeLessThanOrEqual(1000);
  });

  it("returns a box no larger than the source image for a face filling the whole frame", () => {
    const box = { x: 0, y: 0, width: 1000, height: 1000 };
    const result = computeExpandedBox(box, 2.7, 1000, 1000);
    expect(result.width).toBeLessThanOrEqual(1000);
    expect(result.height).toBeLessThanOrEqual(1000);
  });

  it("handles a non-square source image without distortion beyond the requested scale", () => {
    const box = { x: 100, y: 50, width: 60, height: 60 };
    const result = computeExpandedBox(box, 2.7, 800, 400);
    expect(result.width).toBeCloseTo(result.height, 1); // scale applies uniformly to a square box
  });
});
