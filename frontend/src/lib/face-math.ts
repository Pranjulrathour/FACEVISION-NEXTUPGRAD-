import type { Face, FaceLandmarks, FaceMatchResult } from "./face-types";

export function euclideanDistance(
  p1: { x: number; y: number },
  p2: { x: number; y: number }
): number {
  return Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
}

export function normalizeLandmarks(
  landmarks: FaceLandmarks,
  box: { x: number; y: number; width: number; height: number }
): number[] {
  const points = [
    landmarks.rightEye,
    landmarks.leftEye,
    landmarks.nose,
    landmarks.rightMouth,
    landmarks.leftMouth,
  ];
  return points.map((p) => [
    (p.x - box.x) / box.width,
    (p.y - box.y) / box.height,
  ]).flat();
}

export function cosineSimilarity(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0,
    normA = 0,
    normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function compareFaces(
  faceA: Face,
  faceB: Face,
  threshold = 0.78
): FaceMatchResult {
  const vecA = normalizeLandmarks(faceA.landmarks, faceA.box);
  const vecB = normalizeLandmarks(faceB.landmarks, faceB.box);
  const similarity = cosineSimilarity(vecA, vecB);
  return {
    similarity: Math.max(0, Math.min(1, similarity)),
    isMatch: similarity >= threshold,
    threshold,
  };
}

export function interocularDistance(landmarks: FaceLandmarks): number {
  return euclideanDistance(landmarks.leftEye, landmarks.rightEye);
}

export function estimateFaceAngle(landmarks: FaceLandmarks): number {
  const dx = landmarks.rightEye.x - landmarks.leftEye.x;
  const dy = landmarks.rightEye.y - landmarks.leftEye.y;
  return (Math.atan2(dy, dx) * 180) / Math.PI;
}

export function estimateYawn(landmarks: FaceLandmarks): number {
  const mouthWidth = euclideanDistance(landmarks.leftMouth, landmarks.rightMouth);
  const mouthMidpoint = {
    x: (landmarks.leftMouth.x + landmarks.rightMouth.x) / 2,
    y: (landmarks.leftMouth.y + landmarks.rightMouth.y) / 2,
  };
  const noseToMouth = euclideanDistance(landmarks.nose, mouthMidpoint);
  if (noseToMouth === 0) return 0;
  return mouthWidth / noseToMouth;
}

/**
 * Match two face **embeddings** (e.g. from SFaceEmbedder, checklist §10) —
 * distinct from compareFaces() above, which compares landmark geometry.
 * Default threshold is SFace's own calibrated cosine-similarity operating
 * point (0.363), not a value tuned by this app.
 */
export function matchEmbeddings(
  embeddingA: ArrayLike<number>,
  embeddingB: ArrayLike<number>,
  threshold = 0.363
): FaceMatchResult {
  const similarity = cosineSimilarity(embeddingA, embeddingB);
  return {
    similarity: Math.max(-1, Math.min(1, similarity)),
    isMatch: similarity >= threshold,
    threshold,
  };
}

export function deepEqualFace(a: Face, b: Face): boolean {
  return (
    a.box.x === b.box.x &&
    a.box.y === b.box.y &&
    a.box.width === b.box.width &&
    a.box.height === b.box.height &&
    Math.abs(a.confidence - b.confidence) < 0.00001
  );
}
