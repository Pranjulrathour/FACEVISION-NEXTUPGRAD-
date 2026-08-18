import type { Face } from "./face-types";
import { computeBlurScore, computeLuminanceStats, type PixelBuffer } from "./pixel-analysis";

/**
 * Structured quality/failure codes, matching the shape recommended by the
 * face-detection engineering checklist (docs/face-detection-verification-checklist.md
 * §9) instead of a bare success/failure boolean.
 *
 * Geometry checks (box size relative to the image, landmark symmetry) never
 * need pixel data and always run. The pixel-based checks (blur, lighting)
 * only run when a cropped-face ImageData is supplied — there is no learned
 * quality-scoring model bundled in this app, so these are heuristics
 * (variance-of-Laplacian for blur, mean/stdDev luminance for lighting), not
 * a substitute for a trained face-quality model.
 */
export type FaceQualityCode =
  | "OK"
  | "NO_FACE"
  | "MULTIPLE_FACES"
  | "FACE_TOO_SMALL"
  | "LOW_CONFIDENCE"
  | "EXCESSIVE_POSE"
  | "IMAGE_TOO_BLURRY"
  | "POOR_LIGHTING"
  | "INVALID_IMAGE";

export type FaceQualityResult = {
  code: FaceQualityCode;
  /** True only when code === "OK" — convenience for callers that just want a boolean gate. */
  isUsable: boolean;
  detail: string;
};

export type FaceQualityOptions = {
  /** Minimum face box width as a fraction of image width. Default 0.05 (5%). */
  minRelativeFaceSize?: number;
  /** Minimum detector confidence to consider a face usable. Default 0.75, matching the app's default detection threshold. */
  minConfidence?: number;
  /** Maximum allowed left/right eye-to-nose horizontal distance ratio before flagging extreme yaw. Default 3 (i.e. one side ≤ 3x the other). */
  maxPoseAsymmetryRatio?: number;
  /** If true, more than one face in the frame is treated as a quality failure (useful for single-person workflows). Default false. */
  rejectMultipleFaces?: boolean;
  /** Minimum acceptable variance-of-Laplacian blur score. Heuristic — tune
   * per camera/use case. Default 40, chosen conservatively low so only
   * clearly out-of-focus crops get flagged; only checked when a cropped
   * face ImageData is supplied. */
  minBlurScore?: number;
  /** Acceptable mean-luminance range (0-255) before flagging under/over-exposure.
   * Defaults roughly cover "not near-black" to "not near-white". */
  minBrightness?: number;
  maxBrightness?: number;
  /** Minimum luminance standard deviation before flagging a low-contrast
   * (washed out / flat) crop. */
  minContrast?: number;
};

const DEFAULTS: Required<FaceQualityOptions> = {
  minRelativeFaceSize: 0.05,
  minConfidence: 0.75,
  maxPoseAsymmetryRatio: 3,
  rejectMultipleFaces: false,
  minBlurScore: 40,
  minBrightness: 25,
  maxBrightness: 230,
  minContrast: 10,
};

function ok(): FaceQualityResult {
  return { code: "OK", isUsable: true, detail: "Face quality checks passed." };
}

function fail(code: FaceQualityCode, detail: string): FaceQualityResult {
  return { code, isUsable: false, detail };
}

/** Assess a single face's usability. Call assessFaces() first if you need
 * to handle the zero/multiple-face cases for a whole detection result.
 *
 * @param faceImageData Optional cropped-face pixel buffer (e.g. from
 * face-crop.ts's `cropFaceImageData()`). When supplied, adds blur and
 * lighting checks on top of the always-on geometry checks. Omit it and
 * this function still runs the geometry-only checks it always has. */
export function assessFaceQuality(
  face: Face,
  imageWidth: number,
  imageHeight: number,
  options: FaceQualityOptions = {},
  faceImageData?: PixelBuffer
): FaceQualityResult {
  const opts = { ...DEFAULTS, ...options };

  if (imageWidth <= 0 || imageHeight <= 0) {
    return fail("INVALID_IMAGE", "Image dimensions are invalid.");
  }

  if (face.confidence < opts.minConfidence) {
    return fail(
      "LOW_CONFIDENCE",
      `Detection confidence ${face.confidence.toFixed(2)} is below the ${opts.minConfidence} threshold.`
    );
  }

  const relativeWidth = face.box.width / imageWidth;
  const relativeHeight = face.box.height / imageHeight;
  if (relativeWidth < opts.minRelativeFaceSize || relativeHeight < opts.minRelativeFaceSize) {
    return fail(
      "FACE_TOO_SMALL",
      `Face occupies only ${(Math.min(relativeWidth, relativeHeight) * 100).toFixed(1)}% of the frame.`
    );
  }

  const { leftEye, rightEye, nose } = face.landmarks;
  const leftDistance = Math.abs(leftEye.x - nose.x);
  const rightDistance = Math.abs(nose.x - rightEye.x);
  const smaller = Math.min(leftDistance, rightDistance);
  const larger = Math.max(leftDistance, rightDistance);
  if (smaller > 0 && larger / smaller > opts.maxPoseAsymmetryRatio) {
    return fail(
      "EXCESSIVE_POSE",
      "Eye-to-nose asymmetry suggests an extreme head angle; ask the user to face the camera more directly."
    );
  }

  if (faceImageData) {
    const { mean, stdDev } = computeLuminanceStats(faceImageData);
    if (mean < opts.minBrightness) {
      return fail("POOR_LIGHTING", `Face crop is too dark (mean luminance ${mean.toFixed(0)}/255).`);
    }
    if (mean > opts.maxBrightness) {
      return fail("POOR_LIGHTING", `Face crop is overexposed (mean luminance ${mean.toFixed(0)}/255).`);
    }
    if (stdDev < opts.minContrast) {
      return fail("POOR_LIGHTING", `Face crop is low-contrast/washed out (stdDev ${stdDev.toFixed(1)}).`);
    }

    const blurScore = computeBlurScore(faceImageData);
    if (blurScore < opts.minBlurScore) {
      return fail("IMAGE_TOO_BLURRY", `Blur score ${blurScore.toFixed(1)} is below the ${opts.minBlurScore} threshold.`);
    }
  }

  return ok();
}

/** Assess an entire detection result (0, 1, or many faces) at once.
 * @param primaryFaceImageData Optional cropped-face pixel buffer for the
 * highest-confidence face — see assessFaceQuality() for what it enables. */
export function assessFaces(
  faces: Face[],
  imageWidth: number,
  imageHeight: number,
  options: FaceQualityOptions = {},
  primaryFaceImageData?: PixelBuffer
): FaceQualityResult {
  const opts = { ...DEFAULTS, ...options };

  if (faces.length === 0) {
    return fail("NO_FACE", "No face was detected in the image.");
  }
  if (opts.rejectMultipleFaces && faces.length > 1) {
    return fail("MULTIPLE_FACES", `${faces.length} faces detected; this workflow expects exactly one.`);
  }
  // Assess the most prominent (highest-confidence) face for single-face-style checks.
  const primary = [...faces].sort((a, b) => b.confidence - a.confidence)[0];
  return assessFaceQuality(primary, imageWidth, imageHeight, options, primaryFaceImageData);
}
