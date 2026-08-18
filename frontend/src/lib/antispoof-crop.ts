import type { Face } from "./face-types";

type Box = Face["box"];
type ExpandedBox = { x: number; y: number; width: number; height: number };

/**
 * Face-box expansion for MiniFASNet (checklist §11) — ports the exact
 * `_get_new_box` algorithm from the original Silent-Face-Anti-Spoofing
 * repo (minivision-ai, Apache 2.0, `src/generate_patches.py`), since the
 * anti-spoofing model was trained on this specific crop convention (face
 * box expanded around its center by a fixed scale factor, not a plain
 * bounding-box crop) — feeding it something else would silently produce
 * unreliable predictions.
 *
 * Verified against the upstream source's formulas, not guessed:
 *   scale = min((src_h-1)/box_h, (src_w-1)/box_w, scale)
 *   new_width = box_w * scale; new_height = box_h * scale
 *   center = (x + box_w/2, y + box_h/2)
 *   left_top = center - new_size/2, then clamped to stay within image bounds
 */
export function computeExpandedBox(
  box: Box,
  scale: number,
  srcWidth: number,
  srcHeight: number
): ExpandedBox {
  const clampedScale = Math.min((srcHeight - 1) / box.height, (srcWidth - 1) / box.width, scale);
  const newWidth = box.width * clampedScale;
  const newHeight = box.height * clampedScale;
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;

  const leftTopX = clamp(centerX - newWidth / 2, 0, Math.max(0, srcWidth - newWidth));
  const leftTopY = clamp(centerY - newHeight / 2, 0, Math.max(0, srcHeight - newHeight));

  return {
    x: leftTopX,
    y: leftTopY,
    width: Math.min(newWidth, srcWidth),
    height: Math.min(newHeight, srcHeight),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Crop the expanded box into an 80x80 ImageData (MiniFASNetV2's expected
 * input size). DOM-dependent (canvas), so — like face-crop.ts — this isn't
 * unit-tested directly; computeExpandedBox() above carries the actual
 * geometry logic and is fully covered by unit tests.
 */
export function cropForAntiSpoof(
  source: CanvasImageSource,
  box: Box,
  srcWidth: number,
  srcHeight: number,
  scale = 2.7,
  outputSize = 80
): ImageData | null {
  if (typeof document === "undefined") return null;
  const expanded = computeExpandedBox(box, scale, srcWidth, srcHeight);
  if (expanded.width <= 0 || expanded.height <= 0) return null;

  const canvas = document.createElement("canvas");
  canvas.width = outputSize;
  canvas.height = outputSize;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;

  context.drawImage(
    source,
    expanded.x,
    expanded.y,
    expanded.width,
    expanded.height,
    0,
    0,
    outputSize,
    outputSize
  );
  return context.getImageData(0, 0, outputSize, outputSize);
}
