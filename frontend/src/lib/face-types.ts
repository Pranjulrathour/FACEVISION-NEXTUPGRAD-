export type FaceLandmarks = {
  rightEye: { x: number; y: number };
  leftEye: { x: number; y: number };
  nose: { x: number; y: number };
  rightMouth: { x: number; y: number };
  leftMouth: { x: number; y: number };
};

export type Face = {
  box: { x: number; y: number; width: number; height: number };
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
  compareThreshold: number;
};

// v1

// v2
