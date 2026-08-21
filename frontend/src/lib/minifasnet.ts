import type { AntiSpoofClassifier, AntiSpoofResult } from "./anti-spoof-classifier";

/**
 * MiniFASNetV2 anti-spoofing model (checklist §11) — a real trained model,
 * not a heuristic. Ported from minivision-ai/Silent-Face-Anti-Spoofing
 * (Apache 2.0); ONNX conversion via QingHeYang/Silent-Face-Anti-Spoofing-onnx
 * (same license, format conversion only).
 *
 * ⚠️ Not a certified/iBeta-tested liveness solution — see
 * docs/model-card-minifasnet.md and
 * docs/face-detection-verification-checklist.md §11 for what this does and
 * doesn't cover.
 *
 * Model facts (verified directly against the downloaded ONNX graph, not
 * assumed from docs):
 *   - Input tensor "input": [batch, 3, 80, 80], float32
 *   - Expects a face crop expanded by scale=2.7 around the detected box's
 *     center (see antispoof-crop.ts) — NOT a plain bounding-box crop
 *   - Preprocessing: BGR channel order, CHW, pixel values scaled to [0,1]
 *     (raw ToTensor() — no mean/std normalization), confirmed against the
 *     original repo's predict() source
 *   - Output tensor "output": [batch, 3] — RAW LOGITS. The graph ends in a
 *     MatMul, not a Softmax node (confirmed by inspecting the graph's node
 *     list); the original PyTorch code applies F.softmax() separately, so
 *     this class does too, explicitly, in JS.
 *   - Class mapping: argmax index 1 = real face; 0 or 2 = fake (print/replay
 *     attack) — confirmed against the original repo's test.py
 */
export const MINIFASNET_MODEL_URL = "/models/minifasnet_v2.onnx";
export const MINIFASNET_MODEL_VERSION = "minifasnet-v2-2.7-80x80";
export const MINIFASNET_CROP_SCALE = 2.7;
export const MINIFASNET_INPUT_SIZE = 80;
const REAL_CLASS_INDEX = 1;

type Ort = typeof import("onnxruntime-web");
type Session = import("onnxruntime-web").InferenceSession;

/** Pure pixel-packing logic, split out for unit testing (mirrors sface.ts's
 * imageDataToChwTensor, but BGR order and 0-1 scaled instead of RGB/raw 0-255
 * — a different model with different training-time preprocessing). */
export function imageDataToBgrChwTensor(
  data: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number
): Float32Array {
  const pixelCount = width * height;
  const tensor = new Float32Array(3 * pixelCount);
  for (let i = 0; i < pixelCount; i += 1) {
    // BGR order: channel 0 = B, 1 = G, 2 = R. Source ImageData is RGBA.
    tensor[i] = data[i * 4 + 2] / 255; // B
    tensor[pixelCount + i] = data[i * 4 + 1] / 255; // G
    tensor[2 * pixelCount + i] = data[i * 4] / 255; // R
  }
  return tensor;
}

/** Numerically-stable softmax, split out for unit testing. */
export function softmax(logits: ArrayLike<number>): number[] {
  let max = -Infinity;
  for (let i = 0; i < logits.length; i += 1) if (logits[i] > max) max = logits[i];
  const exps: number[] = [];
  let sum = 0;
  for (let i = 0; i < logits.length; i += 1) {
    const e = Math.exp(logits[i] - max);
    exps.push(e);
    sum += e;
  }
  return exps.map((e) => e / sum);
}

/** Interpret a 3-class probability vector into the real/fake label this
 * model uses, split out for unit testing. */
export function interpretAntiSpoofProbabilities(probabilities: number[]): AntiSpoofResult {
  let bestIndex = 0;
  for (let i = 1; i < probabilities.length; i += 1) {
    if (probabilities[i] > probabilities[bestIndex]) bestIndex = i;
  }
  return {
    label: bestIndex === REAL_CLASS_INDEX ? "real" : "fake",
    confidence: probabilities[bestIndex],
  };
}

export class MiniFASNetClassifier implements AntiSpoofClassifier {
  private session: Session | null = null;
  private ort: Ort | null = null;
  private activeProvider: "webgpu" | "wasm" | null = null;

  readonly modelVersion = MINIFASNET_MODEL_VERSION;

  async initialize(): Promise<"webgpu" | "wasm"> {
    this.ort = await import("onnxruntime-web");
    this.ort.env.wasm.numThreads = 1;
    // wasm-only, same rationale as SFaceEmbedder.initialize() -- keeps this
    // model off the detector's webgpu session entirely, since two webgpu
    // sessions racing was the actual production crash, not a hypothetical.
    this.session = await this.ort.InferenceSession.create(MINIFASNET_MODEL_URL, {
      executionProviders: ["wasm"],
      graphOptimizationLevel: "all",
      logSeverityLevel: 3,
    });
    this.activeProvider = "wasm";
    return "wasm";
  }

  async classify(patch: ImageData): Promise<AntiSpoofResult> {
    if (!this.session || !this.ort) throw new Error("Anti-spoof classifier is not ready.");
    if (patch.width !== MINIFASNET_INPUT_SIZE || patch.height !== MINIFASNET_INPUT_SIZE) {
      throw new Error(
        `MiniFASNetClassifier expects a ${MINIFASNET_INPUT_SIZE}x${MINIFASNET_INPUT_SIZE} crop, got ${patch.width}x${patch.height}.`
      );
    }

    const input = imageDataToBgrChwTensor(patch.data, patch.width, patch.height);
    const tensor = new this.ort.Tensor("float32", input, [
      1,
      3,
      MINIFASNET_INPUT_SIZE,
      MINIFASNET_INPUT_SIZE,
    ]);
    const output = await this.session.run({ input: tensor });
    const logits = output.output.data as Float32Array;
    return interpretAntiSpoofProbabilities(softmax(logits));
  }

  get provider(): "webgpu" | "wasm" | null {
    return this.activeProvider;
  }
}
