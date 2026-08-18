export type AntiSpoofLabel = "real" | "fake";

export type AntiSpoofResult = {
  label: AntiSpoofLabel;
  /** Softmax probability of the predicted label, in [0, 1]. */
  confidence: number;
};

/**
 * Contract for a real trained anti-spoofing model — distinct from
 * liveness.ts's LivenessHeuristic, which is a movement-based heuristic
 * with no trained model behind it. Mirrors the FaceDetector/FaceEmbedder
 * interface pattern (checklist §5).
 */
export interface AntiSpoofClassifier {
  initialize(): Promise<"webgpu" | "wasm" | "cpu">;

  /** Classify an already-cropped-and-resized face patch (see
   * antispoof-crop.ts's cropForAntiSpoof() — this model expects a specific
   * expanded-box crop convention, not an arbitrary face crop). */
  classify(patch: ImageData): Promise<AntiSpoofResult>;

  readonly provider: "webgpu" | "wasm" | "cpu" | null;
  readonly modelVersion: string;
}
