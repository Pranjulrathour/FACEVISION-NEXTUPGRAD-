import { describe, expect, it } from "vitest";
import { expandBox, nonMaximumSuppression } from "./yunet";
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

describe("expandBox", () => {
  // Regression coverage for a real bug report: the box visually "floating"
  // above/away from the face on close-up webcam frames. Root cause was
  // over-large padding fractions (0.35/0.25/0.22/0.22 — ~60% extra height)
  // rather than a coordinate bug; these pin the tightened values so a
  // future edit can't silently regress back to the oversized box.
  it("stays within a modest fraction of the raw box size", () => {
    const raw = { x: 100, y: 100, width: 200, height: 240 };
    const padded = expandBox(raw.x, raw.y, raw.width, raw.height);

    expect(padded.width).toBeLessThan(raw.width * 1.2);
    expect(padded.height).toBeLessThan(raw.height * 1.25);
  });

  it("expands symmetrically left/right and asymmetrically top/bottom", () => {
    const raw = { x: 100, y: 100, width: 200, height: 200 };
    const padded = expandBox(raw.x, raw.y, raw.width, raw.height);

    const leftGrowth = raw.x - padded.x;
    const rightGrowth = padded.x + padded.width - (raw.x + raw.width);
    const topGrowth = raw.y - padded.y;
    const bottomGrowth = padded.y + padded.height - (raw.y + raw.height);

    expect(leftGrowth).toBeCloseTo(rightGrowth, 5);
    expect(topGrowth).toBeGreaterThan(bottomGrowth);
  });

  it("keeps the padded box centered on the same horizontal axis as the raw box", () => {
    const raw = { x: 50, y: 50, width: 150, height: 180 };
    const padded = expandBox(raw.x, raw.y, raw.width, raw.height);

    const rawCenterX = raw.x + raw.width / 2;
    const paddedCenterX = padded.x + padded.width / 2;
    expect(paddedCenterX).toBeCloseTo(rawCenterX, 5);
  });
});
