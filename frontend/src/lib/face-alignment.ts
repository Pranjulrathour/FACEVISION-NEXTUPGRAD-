import type { FaceLandmarks } from "./face-types";

/**
 * Face alignment for embedding models (checklist §10) — warps a detected
 * face's 5 landmarks onto SFace's fixed 112×112 reference template before
 * feeding it to the embedding network. Recognition models are trained on
 * faces normalized to a canonical pose; skipping this step and just
 * cropping the bounding box produces embeddings that don't match the
 * model's training distribution.
 *
 * Reference points are OpenCV's own `FaceRecognizerSF::alignCrop` template
 * (opencv/modules/objdetect/src/face_recognize.cpp,
 * `getSimilarityTransformMatrix`'s `dst` array) — the exact points the
 * SFace model bundled with this app was trained/calibrated against.
 */

export type Point2D = { x: number; y: number };

export const ALIGNED_FACE_SIZE = 112;

const REFERENCE_LANDMARKS: readonly Point2D[] = [
  { x: 38.2946, y: 51.6963 }, // right eye
  { x: 73.5318, y: 51.5014 }, // left eye
  { x: 56.0252, y: 71.7366 }, // nose tip
  { x: 41.5493, y: 92.3655 }, // right mouth corner
  { x: 70.7299, y: 92.2041 }, // left mouth corner
];

export type SimilarityTransform = { a: number; b: number; tx: number; ty: number };

function average(points: readonly Point2D[]): Point2D {
  const sum = points.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
  return { x: sum.x / points.length, y: sum.y / points.length };
}

/**
 * Least-squares best-fit 2D similarity transform (uniform scale + rotation
 * + translation, no shear) mapping srcPoints onto dstPoints. Closed-form
 * solution (a restricted 2D Procrustes fit) — derived directly rather than
 * via a general SVD, since a 2-parameter (a, b) linear least-squares
 * solve is sufficient for a similarity (not full affine) transform:
 *
 *   minimize sum_i || dst_i' - M * src_i' ||^2,  M = [[a, -b], [b, a]]
 *
 * where src_i'/dst_i' are the mean-centered point sets. a and b are the
 * dot/cross-product terms below, divided by the source points' variance.
 */
export function computeSimilarityTransform(
  srcPoints: readonly Point2D[],
  dstPoints: readonly Point2D[]
): SimilarityTransform {
  if (srcPoints.length !== dstPoints.length || srcPoints.length === 0) {
    throw new Error("computeSimilarityTransform requires equal, non-empty point sets.");
  }

  const meanSrc = average(srcPoints);
  const meanDst = average(dstPoints);

  let dotSum = 0;
  let crossSum = 0;
  let srcVariance = 0;

  for (let i = 0; i < srcPoints.length; i += 1) {
    const x = srcPoints[i].x - meanSrc.x;
    const y = srcPoints[i].y - meanSrc.y;
    const dx = dstPoints[i].x - meanDst.x;
    const dy = dstPoints[i].y - meanDst.y;
    dotSum += x * dx + y * dy;
    crossSum += x * dy - y * dx;
    srcVariance += x * x + y * y;
  }

  if (srcVariance === 0) {
    // Degenerate case: all source points identical (e.g. a zero-size
    // face box). Fall back to a pure translation so callers get a usable
    // (if not meaningful) transform instead of a divide-by-zero NaN.
    return { a: 1, b: 0, tx: meanDst.x - meanSrc.x, ty: meanDst.y - meanSrc.y };
  }

  const a = dotSum / srcVariance;
  const b = crossSum / srcVariance;
  const tx = meanDst.x - a * meanSrc.x + b * meanSrc.y;
  const ty = meanDst.y - b * meanSrc.x - a * meanSrc.y;
  return { a, b, tx, ty };
}

export function landmarksToOrderedPoints(landmarks: FaceLandmarks): Point2D[] {
  return [
    landmarks.rightEye,
    landmarks.leftEye,
    landmarks.nose,
    landmarks.rightMouth,
    landmarks.leftMouth,
  ];
}

export function referenceLandmarkPoints(): Point2D[] {
  return [...REFERENCE_LANDMARKS];
}

/**
 * Warp the detected face onto the 112×112 aligned template using a real
 * canvas transform. Not unit-tested directly (no canvas in the Node test
 * env, same reasoning as face-crop.ts) — computeSimilarityTransform() above
 * carries the actual math and is fully covered by unit tests.
 */
export function alignFace(source: CanvasImageSource, landmarks: FaceLandmarks): ImageData | null {
  if (typeof document === "undefined") return null;

  const { a, b, tx, ty } = computeSimilarityTransform(
    landmarksToOrderedPoints(landmarks),
    referenceLandmarkPoints()
  );

  const canvas = document.createElement("canvas");
  canvas.width = ALIGNED_FACE_SIZE;
  canvas.height = ALIGNED_FACE_SIZE;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;

  // Canvas transform convention: x' = a*x + c*y + e, y' = b*x + d*y + f.
  // Our similarity matrix is [[a, -b], [b, a]], so c = -b, d = a.
  context.setTransform(a, b, -b, a, tx, ty);
  context.drawImage(source, 0, 0);
  return context.getImageData(0, 0, ALIGNED_FACE_SIZE, ALIGNED_FACE_SIZE);
}
