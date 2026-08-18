import type { Face } from "./face-types";

/**
 * Structured quality/failure codes, matching the shape recommended by the
 * face-detection engineering checklist (docs/face-detection-verification-checklist.md
 * §9) instead of a bare success/failure boolean.
 *
 * These are geometry/heuristic-based checks (box size relative to the
 * image, landmark symmetry) — there is no learned quality-scoring model
 * bundled in this app. They catch obviously bad detections; they are not a
 * substitute for a trained face-quality model.
 */
export type FaceQualityCode =
  | "OK"
  | "NO_FACE"
  | "MULTIPLE_FACES"
  | "FACE_TOO_SMALL"
  | "LOW_CONFIDENCE"
  | "EXCESSIVE_POSE"
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
};

const DEFAULTS: Required<FaceQualityOptions> = {
  minRelativeFaceSize: 0.05,
  minConfidence: 0.75,
  maxPoseAsymmetryRatio: 3,
  rejectMultipleFaces: false,
};

function ok(): FaceQualityResult {
  return { code: "OK", isUsable: true, detail: "Face quality checks passed." };
}

function fail(code: FaceQualityCode, detail: string): FaceQualityResult {
  return { code, isUsable: false, detail };
}

/** Assess a single face's usability. Call assessFaces() first if you need
 * to handle the zero/multiple-face cases for a whole detection result. */
export function assessFaceQuality(
  face: Face,
  imageWidth: number,
  imageHeight: number,
  options: FaceQualityOptions = {}
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

  return ok();
}

/** Assess an entire detection result (0, 1, or many faces) at once. */
export function assessFaces(
  faces: Face[],
  imageWidth: number,
  imageHeight: number,
  options: FaceQualityOptions = {}
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
  return assessFaceQuality(primary, imageWidth, imageHeight, options);
}
