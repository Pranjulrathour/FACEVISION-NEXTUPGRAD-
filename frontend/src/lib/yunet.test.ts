import { describe, expect, it } from "vitest";
import { decodeYuNet, expandBox, nonMaximumSuppression } from "./yunet";
import type { Face } from "./face-types";

/**
 * Builds a synthetic single-stride model output with one "hot" grid cell,
 * mirroring the real onnxruntime-web Tensor shape (`{ data: Float32Array }`)
 * closely enough for decodeYuNet(), which only ever reads `.data`.
 */
function makeStrideOutput(
  stride: number,
  cellIndex: number,
  bbox: [number, number, number, number]
) {
  const columns = 640 / stride;
  const cellCount = columns * columns;
  const cls = new Float32Array(cellCount);
  const obj = new Float32Array(cellCount);
  const boxes = new Float32Array(cellCount * 4);
  cls[cellIndex] = 1;
  obj[cellIndex] = 1;
  boxes[cellIndex * 4] = bbox[0];
  boxes[cellIndex * 4 + 1] = bbox[1];
  boxes[cellIndex * 4 + 2] = bbox[2];
  boxes[cellIndex * 4 + 3] = bbox[3];
  return {
    [`cls_${stride}`]: { data: cls },
    [`obj_${stride}`]: { data: obj },
    [`bbox_${stride}`]: { data: boxes },
    // No kps_<stride> key -- exercises the geometric-fallback landmark path.
  } as unknown as Record<string, import("onnxruntime-web").Tensor>;
}

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

describe("decodeYuNet", () => {
  // Regression coverage for a real, high-impact bug report: the box was
  // drawn shifted right/down from the actual face on every live-camera
  // detection. Root cause, verified against OpenCV's own YuNet decode
  // (modules/objdetect/src/face_detect.cpp): (grid_index + bbox_offset) *
  // stride is the box's CENTER, not its top-left corner -- this code was
  // using it as the corner directly, unconditionally shifting every box by
  // roughly half its own width/height. These pin the corrected corner math
  // so a future edit can't silently reintroduce the center/corner mix-up.
  it("converts the model's center-point regression into a top-left corner, not the raw center", () => {
    const stride = 8;
    const columns = 640 / stride;
    const col = 10;
    const row = 10;
    const cellIndex = row * columns + col;
    // bbox offsets of 0 => center lands exactly on the grid point; width/height
    // regression of 0 => exp(0) * stride = stride (a known, simple size).
    const output = makeStrideOutput(stride, cellIndex, [0, 0, 0, 0]);

    const faces = decodeYuNet(output, 1, 640, 640, 0, 0, 0.5);

    expect(faces).toHaveLength(1);
    const expectedCenterX = col * stride;
    const expectedCenterY = row * stride;
    const expectedRawCorner = expandBox(
      expectedCenterX - stride / 2,
      expectedCenterY - stride / 2,
      stride,
      stride
    );
    // The box's stored x/y must be derived from the CORNER (center -
    // half-size), not the raw center itself -- this is exactly what the
    // bug got wrong, so also assert it's clearly NOT the unadjusted center.
    expect(faces[0].box.x).not.toBeCloseTo(expectedCenterX, 5);
    expect(faces[0].box.x).toBeCloseTo(expectedRawCorner.x, 5);
    expect(faces[0].box.y).toBeCloseTo(expectedRawCorner.y, 5);
  });

  it("centers the decoded box's midpoint on the model's regressed center point", () => {
    const stride = 16;
    const columns = 640 / stride;
    const col = 15;
    const row = 12;
    const cellIndex = row * columns + col;
    const output = makeStrideOutput(stride, cellIndex, [0.25, -0.1, 0, 0]);

    const faces = decodeYuNet(output, 1, 640, 640, 0, 0, 0.5);

    expect(faces).toHaveLength(1);
    // expandBox pads left/right by an equal fraction of width, so the
    // horizontal center survives padding unchanged -- a stable thing to
    // assert regardless of the exact padding constants in effect.
    const expectedCenterX = (col + 0.25) * stride;
    const box = faces[0].box;
    expect(box.x + box.width / 2).toBeCloseTo(expectedCenterX, 4);
  });
});
