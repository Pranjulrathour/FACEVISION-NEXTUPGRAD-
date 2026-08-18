import { describe, expect, it } from "vitest";
import { computeBlurScore, computeLuminanceStats, type PixelBuffer } from "./pixel-analysis";

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

describe("computeLuminanceStats", () => {
  it("reports high mean for a bright white image", () => {
    const stats = computeLuminanceStats(solidColorBuffer(10, 10, [255, 255, 255]));
    expect(stats.mean).toBeCloseTo(255, 0);
    expect(stats.stdDev).toBeCloseTo(0, 0);
  });

  it("reports low mean for a dark image", () => {
    const stats = computeLuminanceStats(solidColorBuffer(10, 10, [10, 10, 10]));
    expect(stats.mean).toBeCloseTo(10, 0);
  });

  it("reports zero stdDev for a perfectly flat image", () => {
    const stats = computeLuminanceStats(solidColorBuffer(20, 20, [128, 128, 128]));
    expect(stats.stdDev).toBe(0);
  });

  it("reports nonzero stdDev for a high-contrast checkerboard", () => {
    const stats = computeLuminanceStats(checkerboardBuffer(20, 20));
    expect(stats.stdDev).toBeGreaterThan(50);
  });

  it("handles an empty buffer without dividing by zero", () => {
    const stats = computeLuminanceStats({ data: new Uint8ClampedArray(0), width: 0, height: 0 });
    expect(stats.mean).toBe(0);
    expect(stats.stdDev).toBe(0);
  });
});

describe("computeBlurScore", () => {
  it("scores a perfectly flat (uniform) image as maximally blurry (zero variance)", () => {
    const score = computeBlurScore(solidColorBuffer(30, 30, [128, 128, 128]));
    expect(score).toBe(0);
  });

  it("scores a high-frequency checkerboard as sharp (high variance)", () => {
    const flatScore = computeBlurScore(solidColorBuffer(30, 30, [128, 128, 128]));
    const sharpScore = computeBlurScore(checkerboardBuffer(30, 30));
    expect(sharpScore).toBeGreaterThan(flatScore);
    expect(sharpScore).toBeGreaterThan(1000);
  });

  it("returns 0 for buffers too small to have interior pixels", () => {
    expect(computeBlurScore(solidColorBuffer(2, 2, [100, 100, 100]))).toBe(0);
    expect(computeBlurScore(solidColorBuffer(1, 1, [100, 100, 100]))).toBe(0);
  });
});
