import { describe, expect, it } from "vitest";
import { imageDataToChwTensor, SFACE_COSINE_MATCH_THRESHOLD, SFACE_EMBEDDING_DIMENSION } from "./sface";

describe("imageDataToChwTensor", () => {
  it("packs a single pixel into RGB channel-planar layout", () => {
    const data = new Uint8ClampedArray([10, 20, 30, 255]); // R, G, B, A
    const tensor = imageDataToChwTensor(data, 1, 1);
    expect(tensor).toHaveLength(3);
    expect(tensor[0]).toBe(10); // R plane
    expect(tensor[1]).toBe(20); // G plane
    expect(tensor[2]).toBe(30); // B plane
  });

  it("packs a 2x1 image into CHW order (all R values, then all G, then all B)", () => {
    const data = new Uint8ClampedArray([
      10, 20, 30, 255, // pixel 0: R=10 G=20 B=30
      40, 50, 60, 255, // pixel 1: R=40 G=50 B=60
    ]);
    const tensor = imageDataToChwTensor(data, 2, 1);
    expect(tensor).toHaveLength(6);
    // R plane (2 values), then G plane (2 values), then B plane (2 values)
    expect(Array.from(tensor)).toEqual([10, 40, 20, 50, 30, 60]);
  });

  it("does not scale or normalize pixel values (raw 0-255 range preserved)", () => {
    const data = new Uint8ClampedArray([0, 128, 255, 255]);
    const tensor = imageDataToChwTensor(data, 1, 1);
    expect(tensor[0]).toBe(0);
    expect(tensor[1]).toBe(128);
    expect(tensor[2]).toBe(255);
  });

  it("ignores the alpha channel entirely", () => {
    const opaque = imageDataToChwTensor(new Uint8ClampedArray([50, 60, 70, 255]), 1, 1);
    const transparent = imageDataToChwTensor(new Uint8ClampedArray([50, 60, 70, 0]), 1, 1);
    expect(Array.from(opaque)).toEqual(Array.from(transparent));
  });
});

describe("model constants", () => {
  it("exposes the calibrated embedding dimension and match threshold", () => {
    expect(SFACE_EMBEDDING_DIMENSION).toBe(128);
    expect(SFACE_COSINE_MATCH_THRESHOLD).toBeCloseTo(0.363);
  });
});
