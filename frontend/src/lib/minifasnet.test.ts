import { describe, expect, it } from "vitest";
import {
  imageDataToBgrChwTensor,
  interpretAntiSpoofProbabilities,
  softmax,
} from "./minifasnet";

describe("imageDataToBgrChwTensor", () => {
  it("packs a single pixel into BGR channel-planar layout, scaled to [0,1]", () => {
    const data = new Uint8ClampedArray([255, 128, 0, 255]); // R=255 G=128 B=0
    const tensor = imageDataToBgrChwTensor(data, 1, 1);
    expect(tensor).toHaveLength(3);
    expect(tensor[0]).toBeCloseTo(0); // B plane
    expect(tensor[1]).toBeCloseTo(128 / 255); // G plane
    expect(tensor[2]).toBeCloseTo(1); // R plane
  });

  it("scales raw 0-255 values down to the [0,1] range", () => {
    const data = new Uint8ClampedArray([0, 0, 255, 255]);
    const tensor = imageDataToBgrChwTensor(data, 1, 1);
    expect(tensor[0]).toBeCloseTo(1); // B channel = 255/255
    expect(Math.max(...Array.from(tensor))).toBeLessThanOrEqual(1);
    expect(Math.min(...Array.from(tensor))).toBeGreaterThanOrEqual(0);
  });

  it("ignores the alpha channel", () => {
    const opaque = imageDataToBgrChwTensor(new Uint8ClampedArray([10, 20, 30, 255]), 1, 1);
    const transparent = imageDataToBgrChwTensor(new Uint8ClampedArray([10, 20, 30, 0]), 1, 1);
    expect(Array.from(opaque)).toEqual(Array.from(transparent));
  });

  it("packs multiple pixels in channel-planar (not interleaved) order", () => {
    const data = new Uint8ClampedArray([
      10, 20, 30, 255,
      40, 50, 60, 255,
    ]);
    const tensor = imageDataToBgrChwTensor(data, 2, 1);
    expect(tensor).toHaveLength(6);
    // B plane (2 values), then G plane, then R plane
    expect(tensor[0]).toBeCloseTo(30 / 255);
    expect(tensor[1]).toBeCloseTo(60 / 255);
    expect(tensor[2]).toBeCloseTo(20 / 255);
    expect(tensor[3]).toBeCloseTo(50 / 255);
    expect(tensor[4]).toBeCloseTo(10 / 255);
    expect(tensor[5]).toBeCloseTo(40 / 255);
  });
});

describe("softmax", () => {
  it("produces a probability distribution summing to 1", () => {
    const result = softmax([1, 2, 3]);
    const sum = result.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1);
  });

  it("gives the highest probability to the largest logit", () => {
    const result = softmax([0, 5, -3]);
    expect(result[1]).toBeGreaterThan(result[0]);
    expect(result[1]).toBeGreaterThan(result[2]);
  });

  it("is numerically stable for large logit values", () => {
    const result = softmax([1000, 1001, 999]);
    expect(result.every((p) => Number.isFinite(p))).toBe(true);
    expect(result.reduce((a, b) => a + b, 0)).toBeCloseTo(1);
  });

  it("returns a uniform distribution for identical logits", () => {
    const result = softmax([2, 2, 2]);
    expect(result[0]).toBeCloseTo(1 / 3);
    expect(result[1]).toBeCloseTo(1 / 3);
    expect(result[2]).toBeCloseTo(1 / 3);
  });
});

describe("interpretAntiSpoofProbabilities", () => {
  it("labels index 1 as real when it has the highest probability", () => {
    const result = interpretAntiSpoofProbabilities([0.1, 0.8, 0.1]);
    expect(result.label).toBe("real");
    expect(result.confidence).toBeCloseTo(0.8);
  });

  it("labels index 0 as fake (print-attack class)", () => {
    const result = interpretAntiSpoofProbabilities([0.7, 0.2, 0.1]);
    expect(result.label).toBe("fake");
    expect(result.confidence).toBeCloseTo(0.7);
  });

  it("labels index 2 as fake (replay-attack class)", () => {
    const result = interpretAntiSpoofProbabilities([0.1, 0.2, 0.7]);
    expect(result.label).toBe("fake");
    expect(result.confidence).toBeCloseTo(0.7);
  });
});
