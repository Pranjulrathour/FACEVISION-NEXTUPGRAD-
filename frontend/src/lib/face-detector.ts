import type { Face } from "./face-types";

/**
 * Contract every face detector implementation must satisfy. Introduced so
 * the app depends on this interface rather than the concrete YuNetDetector
 * class — swapping to a different model/runtime later means adding a new
 * implementation, not editing every call site.
 */
export interface FaceDetector {
  /** Load the model/runtime. Must be called once before detect(). */
  initialize(): Promise<"webgpu" | "wasm" | "cpu">;

  /** Run detection on the given image source. */
  detect(
    source: CanvasImageSource,
    width: number,
    height: number,
    confidenceThreshold?: number,
    nmsThreshold?: number
  ): Promise<Face[]>;

  /** Which execution provider is actually active, or null if not yet initialized. */
  readonly provider: "webgpu" | "wasm" | "cpu" | null;

  /** Stable identifier for the active model, stamped onto stored detections
   * for traceability (see docs/model-card-yunet.md). */
  readonly modelVersion: string;
}
