export type FaceLandmarks = {
  rightEye: { x: number; y: number };
  leftEye: { x: number; y: number };
  nose: { x: number; y: number };
  rightMouth: { x: number; y: number };
  leftMouth: { x: number; y: number };
};

export type Face = {
  box: { x: number; y: number; width: number; height: number };
  /** The detector's box before expandBox()'s cosmetic UI padding (§ yunet.ts)
   * is added. MiniFASNet's anti-spoofing crop (antispoof-crop.ts) was
   * calibrated against the original Silent-Face-Anti-Spoofing repo's own
   * detector, which returns a tight box, not one already padded for
   * display -- feeding it `box` instead double-counts padding (this
   * padding, then antispoof-crop's own 2.7x expansion on top of an
   * already-larger box), zooming out further than the model expects.
   * Optional and falls back to `box` at the call site -- Face objects
   * constructed without a real detector (tests, older records loaded
   * from history) won't have one. */
  rawBox?: { x: number; y: number; width: number; height: number };
  confidence: number;
  landmarks: FaceLandmarks;
};

export type RuntimeState = "idle" | "loading" | "ready" | "error";

export type DetectionMode = "upload" | "camera";

export type DetectionRecord = {
  id: string;
  timestamp: number;
  mode: DetectionMode;
  faceCount: number;
  averageConfidence: number;
  faces: Face[];
  imageName?: string;
  imageDataUrl?: string;
  /** Which detector/model produced this record (e.g. "yunet-2023mar"), for
   * traceability if the bundled model is ever swapped. */
  modelVersion?: string;
};

export type FaceMatchResult = {
  similarity: number;
  isMatch: boolean;
  threshold: number;
};

export type StatsSummary = {
  totalDetections: number;
  totalFacesDetected: number;
  avgConfidence: number;
  topMode: DetectionMode | "-";
  detectionHistory: { day: string; count: number }[];
};

export type AppSettings = {
  saveHistory: boolean;
  autoDetect: boolean;
  showLandmarks: boolean;
  showConfidenceLabel: boolean;
  frameColor: string;
  landmarkColor: string;
};

/** An enrolled identity in the recognition gallery (checklist §2, §28) —
 * only ever carries a name and a sample count, never an image. */
export type GalleryEntry = {
  id: number;
  name: string;
  sampleCount: number;
  createdAt: string;
  updatedAt: string;
};

export type RecognitionResult = {
  matched: boolean;
  name: string | null;
  similarity: number;
  galleryEntryId: number | null;
  threshold: number;
};

/** Live recognition state shown under a detected face box. "checking" is
 * shown the moment a check starts (so the label never looks frozen);
 * "unregistered" is a real, terminal result -- distinct from simply not
 * having checked yet -- so a shown face always ends up with a definite
 * answer instead of silently staying blank. */
export type RecognitionLabel =
  | { status: "checking" }
  | { status: "matched"; name: string; similarity: number }
  | { status: "unregistered" };

// v1

// v2
