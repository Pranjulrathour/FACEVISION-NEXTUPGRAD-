/**
 * Contract every face embedding model implementation must satisfy —
 * mirrors face-detector.ts's FaceDetector pattern (checklist §5) so a
 * future embedding model swap means adding a new implementation, not
 * editing every call site.
 */
export interface FaceEmbedder {
  /** Load the model/runtime. Must be called once before embed(). */
  initialize(): Promise<"webgpu" | "wasm" | "cpu">;

  /** Compute an embedding vector from an already-aligned face image
   * (see face-alignment.ts's alignFace() — feeding an unaligned crop
   * produces a low-quality/meaningless embedding). */
  embed(alignedFace: ImageData): Promise<Float32Array>;

  /** Which execution provider is actually active, or null if not yet initialized. */
  readonly provider: "webgpu" | "wasm" | "cpu" | null;

  /** Stable identifier for the active model, for traceability on stored
   * gallery entries — analogous to FaceDetector.modelVersion. */
  readonly modelVersion: string;

  /** Dimensionality of the embedding vectors this implementation produces. */
  readonly embeddingDimension: number;
}
