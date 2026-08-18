/**
 * Pixel-level image analysis for face-quality assessment (checklist §9).
 *
 * These are pure functions over an ImageData-shaped object (grayscale
 * conversion, mean/variance, a Laplacian-variance blur estimate) — no DOM
 * or canvas dependency, so they're fully unit-testable without a browser.
 * The DOM-dependent part (actually cropping a face region into an
 * ImageData) lives separately in face-crop.ts.
 */

export type PixelBuffer = {
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
};

export type LuminanceStats = {
  mean: number;
  stdDev: number;
};

function toGrayscale(image: PixelBuffer): Float32Array {
  const pixelCount = image.width * image.height;
  const gray = new Float32Array(pixelCount);
  for (let i = 0; i < pixelCount; i += 1) {
    const r = image.data[i * 4];
    const g = image.data[i * 4 + 1];
    const b = image.data[i * 4 + 2];
    // Standard luma weighting (ITU-R BT.601).
    gray[i] = 0.299 * r + 0.587 * g + 0.114 * b;
  }
  return gray;
}

/** Mean brightness and standard deviation (contrast proxy) across an image,
 * in the 0-255 luminance range. */
export function computeLuminanceStats(image: PixelBuffer): LuminanceStats {
  const gray = toGrayscale(image);
  if (gray.length === 0) return { mean: 0, stdDev: 0 };
  let sum = 0;
  for (const v of gray) sum += v;
  const mean = sum / gray.length;
  let variance = 0;
  for (const v of gray) variance += (v - mean) ** 2;
  variance /= gray.length;
  return { mean, stdDev: Math.sqrt(variance) };
}

/**
 * Variance of the Laplacian — a standard, widely-used blur-detection
 * heuristic (OpenCV's own `cv2.Laplacian(...).var()` blur-check idiom).
 * Sharp edges produce large second derivatives; a blurry image has few
 * strong edges, so its Laplacian variance is low. This is a heuristic, not
 * a learned quality model — thresholds need tuning per use case, which is
 * why it's exposed as a raw score rather than a fixed pass/fail.
 */
export function computeBlurScore(image: PixelBuffer): number {
  const { width, height } = image;
  if (width < 3 || height < 3) return 0;
  const gray = toGrayscale(image);

  let sum = 0;
  let sumSquares = 0;
  let count = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const idx = y * width + x;
      const laplacian =
        -4 * gray[idx] + gray[idx - 1] + gray[idx + 1] + gray[idx - width] + gray[idx + width];
      sum += laplacian;
      sumSquares += laplacian * laplacian;
      count += 1;
    }
  }
  if (count === 0) return 0;
  const mean = sum / count;
  return sumSquares / count - mean * mean;
}
