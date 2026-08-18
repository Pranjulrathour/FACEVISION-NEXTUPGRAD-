import type { FaceEmbedder } from "./face-embedder";

/**
 * SFace face-recognition embedding model (checklist §10) — a real trained
 * identity embedding, not the landmark-geometry similarity used elsewhere
 * in this app (see docs/adr/0001-landmark-similarity-vs-embeddings.md,
 * superseded for this specific model by
 * docs/adr/0002-sface-embeddings-for-gallery-recognition.md).
 *
 * Model facts (verified directly against the downloaded ONNX graph, not
 * assumed from docs — see docs/model-card-sface.md):
 *   - Source: OpenCV Zoo, face_recognition_sface_2021dec.onnx, Apache 2.0
 *   - Input: tensor "data", shape [1, 3, 112, 112], float32, RGB, CHW,
 *     raw 0-255 pixel values (no mean subtraction, no /255 scaling) —
 *     confirmed against OpenCV's own C++ FaceRecognizerSF preprocessing
 *     (dnn::blobFromImage with scalefactor=1, mean=(0,0,0), swapRB=true
 *     converting its native BGR Mat to the RGB order the network expects).
 *   - Output: tensor "fc1", shape [1, 128] — a 128-dimension embedding.
 *   - Recommended match threshold: cosine similarity >= 0.363 (OpenCV
 *     Zoo's own calibrated default, not something tuned by this app).
 *
 * Requires an already-aligned 112x112 face (see face-alignment.ts) — this
 * class does not crop or align, it only runs inference on what it's given.
 */
export const SFACE_MODEL_URL = "/models/face_recognition_sface_2021dec.onnx";
export const SFACE_MODEL_VERSION = "sface-2021dec";
export const SFACE_EMBEDDING_DIMENSION = 128;
export const SFACE_COSINE_MATCH_THRESHOLD = 0.363;

const INPUT_SIZE = 112;

type Ort = typeof import("onnxruntime-web");
type Session = import("onnxruntime-web").InferenceSession;

/**
 * Pure pixel-packing logic, split out from the class below purely so it's
 * unit-testable without a real ONNX runtime or canvas (mirrors the
 * pixel-analysis.ts / face-crop.ts split used for quality assessment).
 * Converts RGBA ImageData into the RGB, CHW, float32 layout SFace expects.
 */
export function imageDataToChwTensor(
  data: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number
): Float32Array {
  const pixelCount = width * height;
  const tensor = new Float32Array(3 * pixelCount);
  for (let i = 0; i < pixelCount; i += 1) {
    tensor[i] = data[i * 4];
    tensor[pixelCount + i] = data[i * 4 + 1];
    tensor[2 * pixelCount + i] = data[i * 4 + 2];
  }
  return tensor;
}

export class SFaceEmbedder implements FaceEmbedder {
  private session: Session | null = null;
  private ort: Ort | null = null;
  private activeProvider: "webgpu" | "wasm" | null = null;

  readonly modelVersion = SFACE_MODEL_VERSION;
  readonly embeddingDimension = SFACE_EMBEDDING_DIMENSION;

  async initialize(): Promise<"webgpu" | "wasm"> {
    this.ort = await import("onnxruntime-web");
    this.ort.env.wasm.numThreads = 1;
    try {
      this.session = await this.ort.InferenceSession.create(SFACE_MODEL_URL, {
        executionProviders: ["webgpu"],
        graphOptimizationLevel: "all",
        logSeverityLevel: 3,
      });
      this.activeProvider = "webgpu";
      return "webgpu";
    } catch {
      this.session = await this.ort.InferenceSession.create(SFACE_MODEL_URL, {
        executionProviders: ["wasm"],
        graphOptimizationLevel: "all",
        logSeverityLevel: 3,
      });
      this.activeProvider = "wasm";
      return "wasm";
    }
  }

  async embed(alignedFace: ImageData): Promise<Float32Array> {
    if (!this.session || !this.ort) throw new Error("Embedder is not ready.");
    if (alignedFace.width !== INPUT_SIZE || alignedFace.height !== INPUT_SIZE) {
      throw new Error(
        `SFaceEmbedder expects a ${INPUT_SIZE}x${INPUT_SIZE} aligned face, got ${alignedFace.width}x${alignedFace.height}.`
      );
    }

    const input = imageDataToChwTensor(alignedFace.data, alignedFace.width, alignedFace.height);
    const tensor = new this.ort.Tensor("float32", input, [1, 3, INPUT_SIZE, INPUT_SIZE]);
    const output = await this.session.run({ data: tensor });
    const raw = output.fc1.data as Float32Array;
    return new Float32Array(raw);
  }

  get provider(): "webgpu" | "wasm" | null {
    return this.activeProvider;
  }
}
