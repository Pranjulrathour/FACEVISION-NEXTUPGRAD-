import type { FaceDetector } from "./face-detector";
import type { Face, FaceLandmarks } from "./face-types";

export const YUNET_MODEL_URL = "/models/face_detection_yunet_2023mar.onnx";
export const YUNET_MODEL_VERSION = "yunet-2023mar";
const INPUT_SIZE = 640;
// YuNet's raw box is already a reasonably tight face box (WIDER FACE-style
// annotation), so this only needs to add a little headroom for
// forehead/hair/chin — not double the box size. The previous values here
// (0.35/0.25/0.22/0.22) added up to ~60% extra height, which reads as
// "way too big and floating above the head" on a close-up webcam frame,
// even though the underlying detection was accurate — reported as the box
// looking "deviated" from the face. Tightened based on that report.
const BOX_PADDING_TOP = 0.12;
const BOX_PADDING_BOTTOM = 0.08;
const BOX_PADDING_LEFT = 0.08;
const BOX_PADDING_RIGHT = 0.08;

type Ort = typeof import("onnxruntime-web");
type Session = import("onnxruntime-web").InferenceSession;

export class YuNetDetector implements FaceDetector {
  private session: Session | null = null;
  private ort: Ort | null = null;
  private activeProvider: "webgpu" | "wasm" | null = null;
  private providerDegraded = false;

  readonly modelVersion = YUNET_MODEL_VERSION;

  async initialize(): Promise<"webgpu" | "wasm"> {
    this.ort = await import("onnxruntime-web");
    this.ort.env.wasm.numThreads = 1;
    try {
      this.session = await this.ort.InferenceSession.create(YUNET_MODEL_URL, {
        executionProviders: ["webgpu"],
        graphOptimizationLevel: "all",
        logSeverityLevel: 3,
      });
      this.activeProvider = "webgpu";
      return "webgpu";
    } catch (firstErr) {
      this.session = await this.ort.InferenceSession.create(YUNET_MODEL_URL, {
        executionProviders: ["wasm"],
        graphOptimizationLevel: "all",
        logSeverityLevel: 3,
      });
      this.activeProvider = "wasm";
      return "wasm";
    }
  }

  private async reinitializeAsWasm(): Promise<void> {
    if (!this.ort) throw new Error("Detector is not ready.");
    this.session = await this.ort.InferenceSession.create(YUNET_MODEL_URL, {
      executionProviders: ["wasm"],
      graphOptimizationLevel: "all",
      logSeverityLevel: 3,
    });
    this.activeProvider = "wasm";
    this.providerDegraded = true;
  }

  async detect(
    source: CanvasImageSource,
    width: number,
    height: number,
    confidenceThreshold = 0.75,
    nmsThreshold = 0.35
  ): Promise<Face[]> {
    if (!this.session || !this.ort) throw new Error("Detector is not ready.");
    const scale = Math.min(INPUT_SIZE / width, INPUT_SIZE / height);
    const scaledWidth = Math.max(1, Math.round(width * scale));
    const scaledHeight = Math.max(1, Math.round(height * scale));
    const dx = (INPUT_SIZE - scaledWidth) / 2;
    const dy = (INPUT_SIZE - scaledHeight) / 2;
    const canvas = document.createElement("canvas");
    canvas.width = INPUT_SIZE; canvas.height = INPUT_SIZE;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Canvas is unavailable in this browser.");
    context.fillStyle = "#000"; context.fillRect(0, 0, INPUT_SIZE, INPUT_SIZE);
    context.drawImage(source, dx, dy, scaledWidth, scaledHeight);
    const pixels = context.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE).data;
    const input = new Float32Array(1 * 3 * INPUT_SIZE * INPUT_SIZE);
    for (let index = 0; index < INPUT_SIZE * INPUT_SIZE; index += 1) {
      input[index] = pixels[index * 4 + 2] - 104;
      input[INPUT_SIZE * INPUT_SIZE + index] = pixels[index * 4 + 1] - 117;
      input[2 * INPUT_SIZE * INPUT_SIZE + index] = pixels[index * 4] - 123;
    }
    const tensor = new this.ort.Tensor("float32", input, [1, 3, INPUT_SIZE, INPUT_SIZE]);
    let output: Record<string, import("onnxruntime-web").Tensor>;
    try {
      output = await this.session.run({ input: tensor });
    } catch (runErr) {
      if (this.activeProvider === "webgpu" && !this.providerDegraded) {
        console.warn("[FaceVision] WebGPU inference failed, degrading to WASM:", runErr instanceof Error ? runErr.message : runErr);
        await this.reinitializeAsWasm();
        output = await this.session.run({ input: tensor });
      } else {
        throw runErr;
      }
    }
    const faces = decodeYuNet(output, scale, scaledWidth, scaledHeight, dx, dy, confidenceThreshold);
    return nonMaximumSuppression(faces, nmsThreshold);
  }

  get provider(): "webgpu" | "wasm" | null {
    return this.activeProvider;
  }
}

function buildLandmarks(
  kps: Float32Array,
  index: number,
  stride: number,
  columns: number,
  dx: number,
  dy: number,
  scale: number
): FaceLandmarks {
  const col = index % columns;
  const row = Math.floor(index / columns);
  // No +0.5 cell-center offset here -- verified against OpenCV's own YuNet
  // decode (modules/objdetect/src/face_detect.cpp): landmark coordinates
  // are (kps_offset + grid_index) * stride, not
  // (grid_index + 0.5 + kps_offset) * stride. The +0.5 that was here before
  // doesn't match the model's actual regression target and introduced a
  // small systematic offset (~0.5*stride pixels per axis, pre-scale).
  const baseX = col * stride;
  const baseY = row * stride;
  return {
    rightEye: { x: (baseX + kps[index * 10] * stride - dx) / scale, y: (baseY + kps[index * 10 + 1] * stride - dy) / scale },
    leftEye: { x: (baseX + kps[index * 10 + 2] * stride - dx) / scale, y: (baseY + kps[index * 10 + 3] * stride - dy) / scale },
    nose: { x: (baseX + kps[index * 10 + 4] * stride - dx) / scale, y: (baseY + kps[index * 10 + 5] * stride - dy) / scale },
    rightMouth: { x: (baseX + kps[index * 10 + 6] * stride - dx) / scale, y: (baseY + kps[index * 10 + 7] * stride - dy) / scale },
    leftMouth: { x: (baseX + kps[index * 10 + 8] * stride - dx) / scale, y: (baseY + kps[index * 10 + 9] * stride - dy) / scale },
  };
}

export function expandBox(x: number, y: number, width: number, height: number): { x: number; y: number; width: number; height: number } {
  const padLeft = width * BOX_PADDING_LEFT;
  const padRight = width * BOX_PADDING_RIGHT;
  const padTop = height * BOX_PADDING_TOP;
  const padBottom = height * BOX_PADDING_BOTTOM;
  return {
    x: x - padLeft,
    y: y - padTop,
    width: width + padLeft + padRight,
    height: height + padTop + padBottom,
  };
}

export function decodeYuNet(
  output: Record<string, import("onnxruntime-web").Tensor>,
  scale: number,
  contentWidth: number,
  contentHeight: number,
  dx: number,
  dy: number,
  confidenceThreshold: number
): Face[] {
  const faces: Face[] = [];
  for (const stride of [8, 16, 32]) {
    const cls = output[`cls_${stride}`]?.data as Float32Array | undefined;
    const objectness = output[`obj_${stride}`]?.data as Float32Array | undefined;
    const boxes = output[`bbox_${stride}`]?.data as Float32Array | undefined;
    const kps = output[`kps_${stride}`]?.data as Float32Array | undefined;
    if (!cls || !objectness || !boxes) continue;
    const columns = INPUT_SIZE / stride;
    for (let index = 0; index < cls.length; index += 1) {
      const confidence = Math.sqrt(cls[index] * objectness[index]);
      if (confidence < confidenceThreshold) continue;
      // (index%columns + bbox[0])*stride and the row equivalent give the
      // box's CENTER (cx, cy), not its top-left corner -- verified against
      // OpenCV's own YuNet decode (modules/objdetect/src/face_detect.cpp:
      // cx/cy computed this way, then `x1 = cx - w/2.f; y1 = cy - h/2.f;`).
      // This code was using cx/cy directly as the top-left corner, which
      // drew every box shifted right/down by roughly half its own
      // width/height -- reported as the frame looking "deviated" from the
      // face, reproducible on any face since it's a fixed geometric offset,
      // not something detection-quality-dependent.
      const width = Math.exp(boxes[index * 4 + 2]) * stride;
      const height = Math.exp(boxes[index * 4 + 3]) * stride;
      const centerX = (index % columns + boxes[index * 4]) * stride - dx;
      const centerY = (Math.floor(index / columns) + boxes[index * 4 + 1]) * stride - dy;
      const x = centerX - width / 2;
      const y = centerY - height / 2;
      const clippedX = Math.max(0, Math.min(x, contentWidth));
      const clippedY = Math.max(0, Math.min(y, contentHeight));
      const clippedWidth = Math.max(0, Math.min(width, contentWidth - clippedX));
      const clippedHeight = Math.max(0, Math.min(height, contentHeight - clippedY));
      if (clippedWidth <= 0 || clippedHeight <= 0) continue;
      const originalX = clippedX / scale;
      const originalY = clippedY / scale;
      const originalWidth = clippedWidth / scale;
      const originalHeight = clippedHeight / scale;
      const rawBox = { x: originalX, y: originalY, width: originalWidth, height: originalHeight };
      const padded = expandBox(originalX, originalY, originalWidth, originalHeight);
      const landmarks = kps
        ? buildLandmarks(kps, index, stride, columns, dx, dy, scale)
        : {
            rightEye: { x: padded.x + padded.width * 0.3, y: padded.y + padded.height * 0.35 },
            leftEye: { x: padded.x + padded.width * 0.7, y: padded.y + padded.height * 0.35 },
            nose: { x: padded.x + padded.width * 0.5, y: padded.y + padded.height * 0.5 },
            rightMouth: { x: padded.x + padded.width * 0.35, y: padded.y + padded.height * 0.75 },
            leftMouth: { x: padded.x + padded.width * 0.65, y: padded.y + padded.height * 0.75 },
          };
      faces.push({ box: padded, rawBox, confidence, landmarks });
    }
  }
  return faces;
}

export function nonMaximumSuppression(faces: Face[], threshold = 0.35): Face[] {
  const kept: Face[] = [];
  for (const face of [...faces].sort((first, second) => second.confidence - first.confidence)) {
    const overlaps = kept.some((candidate) => iou(face, candidate) > threshold);
    if (!overlaps) kept.push(face);
  }
  return kept;
}

function iou(first: Face, second: Face): number {
  const x1 = Math.max(first.box.x, second.box.x), y1 = Math.max(first.box.y, second.box.y);
  const x2 = Math.min(first.box.x + first.box.width, second.box.x + second.box.width);
  const y2 = Math.min(first.box.y + first.box.height, second.box.y + second.box.height);
  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = first.box.width * first.box.height + second.box.width * second.box.height - intersection;
  return union ? intersection / union : 0;
}

// v1

// v2

// v3

// v4

// v5

// v6

// v7

// v8

// v9
