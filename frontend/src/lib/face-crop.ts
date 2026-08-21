import type { Face } from "./face-types";

type FaceBox = Face["box"];

/**
 * Extracts the pixel region for a detected face's bounding box as ImageData
 * — the "Face Crop" half of checklist §9's "Quality Assessment + Face Crop"
 * stage. Requires a real browser canvas, so unlike pixel-analysis.ts this
 * isn't unit-tested directly (no canvas implementation in the Node test
 * environment); it's exercised through the app itself. Keep this function
 * a thin, obviously-correct wrapper for exactly that reason — push any
 * logic worth testing into pixel-analysis.ts instead.
 */
export function cropFaceImageData(
  source: CanvasImageSource,
  box: FaceBox,
  sourceWidth: number,
  sourceHeight: number
): ImageData | null {
  if (typeof document === "undefined") return null;

  const x = Math.max(0, Math.floor(box.x));
  const y = Math.max(0, Math.floor(box.y));
  const width = Math.max(1, Math.min(Math.ceil(box.width), sourceWidth - x));
  const height = Math.max(1, Math.min(Math.ceil(box.height), sourceHeight - y));
  if (width <= 0 || height <= 0) return null;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;

  context.drawImage(source, x, y, width, height, 0, 0, width, height);
  return context.getImageData(0, 0, width, height);
}

const THUMBNAIL_SIZE = 200;
const THUMBNAIL_JPEG_QUALITY = 0.82;

/**
 * Crops a detected face's box into a small square JPEG data URL for the
 * Gallery panel's "what does this person look like" thumbnail (checklist
 * §28-adjacent -- a deliberate departure from the app's earlier
 * "embedding only, never an image" design; see
 * docs/privacy-retention-policy.md). Squashes the box to a fixed square
 * regardless of its original aspect ratio, same as a typical profile-
 * photo crop -- exact geometry doesn't matter for a small identification
 * thumbnail the way it does for the embedding/liveness crops elsewhere in
 * this file. Same DOM-dependent, thin-wrapper, not-unit-tested pattern as
 * cropFaceImageData() above.
 */
export function captureFaceThumbnail(
  source: CanvasImageSource,
  box: FaceBox,
  sourceWidth: number,
  sourceHeight: number
): string | null {
  if (typeof document === "undefined") return null;

  const x = Math.max(0, Math.floor(box.x));
  const y = Math.max(0, Math.floor(box.y));
  const width = Math.max(1, Math.min(Math.ceil(box.width), sourceWidth - x));
  const height = Math.max(1, Math.min(Math.ceil(box.height), sourceHeight - y));
  if (width <= 0 || height <= 0) return null;

  const canvas = document.createElement("canvas");
  canvas.width = THUMBNAIL_SIZE;
  canvas.height = THUMBNAIL_SIZE;
  const context = canvas.getContext("2d");
  if (!context) return null;

  context.drawImage(source, x, y, width, height, 0, 0, THUMBNAIL_SIZE, THUMBNAIL_SIZE);
  return canvas.toDataURL("image/jpeg", THUMBNAIL_JPEG_QUALITY);
}
