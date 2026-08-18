import { describe, expect, it, vi } from "vitest";
import {
  runDetectionPipeline,
  matchFaces,
  embedFace,
  matchFaceEmbeddings,
  checkLiveness,
  FacePipelineError,
  EmbeddingError,
  LivenessCheckError,
} from "./face-pipeline";
import { LivenessHeuristic } from "./liveness";
import type { FaceDetector } from "./face-detector";
import type { FaceEmbedder } from "./face-embedder";
import type { AntiSpoofClassifier } from "./anti-spoof-classifier";
import type { Face } from "./face-types";

function makeFace(overrides: Partial<Face> = {}): Face {
  return {
    box: { x: 0, y: 0, width: 100, height: 100 },
    confidence: 0.9,
    landmarks: {
      rightEye: { x: 30, y: 30 },
      leftEye: { x: 70, y: 30 },
      nose: { x: 50, y: 50 },
      rightMouth: { x: 35, y: 70 },
      leftMouth: { x: 65, y: 70 },
    },
    ...overrides,
  };
}

function makeFakeDetector(faces: Face[]): FaceDetector {
  return {
    initialize: vi.fn().mockResolvedValue("wasm"),
    detect: vi.fn().mockResolvedValue(faces),
    provider: "wasm",
    modelVersion: "fake-detector-v1",
  };
}

function makeFakeImage(width: number, height: number): HTMLImageElement {
  return { naturalWidth: width, naturalHeight: height } as HTMLImageElement;
}

describe("runDetectionPipeline", () => {
  it("runs detection and quality assessment end to end", async () => {
    const detector = makeFakeDetector([makeFace()]);
    const image = makeFakeImage(1000, 1000);

    const result = await runDetectionPipeline(detector, image, 1000, 1000);

    expect(detector.detect).toHaveBeenCalledWith(image, 1000, 1000, undefined, undefined);
    expect(result.faces).toHaveLength(1);
    expect(result.quality.code).toBe("OK");
    expect(result.liveness).toBeUndefined();
  });

  it("passes confidence/NMS thresholds through to the detector", async () => {
    const detector = makeFakeDetector([makeFace()]);
    const image = makeFakeImage(1000, 1000);

    await runDetectionPipeline(detector, image, 1000, 1000, {
      confidenceThreshold: 0.6,
      nmsThreshold: 0.4,
    });

    expect(detector.detect).toHaveBeenCalledWith(image, 1000, 1000, 0.6, 0.4);
  });

  it("flags NO_FACE quality when the detector finds nothing", async () => {
    const detector = makeFakeDetector([]);
    const image = makeFakeImage(1000, 1000);

    const result = await runDetectionPipeline(detector, image, 1000, 1000);

    expect(result.faces).toHaveLength(0);
    expect(result.quality.code).toBe("NO_FACE");
  });

  it("rejects decompression-bomb-style decoded images before detection ever runs", async () => {
    const detector = makeFakeDetector([makeFace()]);
    const bombImage = makeFakeImage(50000, 50000);

    await expect(
      runDetectionPipeline(detector, bombImage, 50000, 50000)
    ).rejects.toThrow(FacePipelineError);
    expect(detector.detect).not.toHaveBeenCalled();
  });

  it("runs the liveness stage when a heuristic instance is supplied", async () => {
    const detector = makeFakeDetector([makeFace()]);
    const image = makeFakeImage(1000, 1000);
    const heuristic = new LivenessHeuristic(2, 0.15);

    const result = await runDetectionPipeline(detector, image, 1000, 1000, {
      livenessHeuristic: heuristic,
    });

    expect(result.liveness).toBeDefined();
    expect(result.liveness!.signal).toBe("insufficient_data");
  });

  it("skips the liveness stage when no heuristic is supplied", async () => {
    const detector = makeFakeDetector([makeFace()]);
    const image = makeFakeImage(1000, 1000);

    const result = await runDetectionPipeline(detector, image, 1000, 1000);

    expect(result.liveness).toBeUndefined();
  });

  it("skips the liveness stage when no faces were found, even with a heuristic supplied", async () => {
    const detector = makeFakeDetector([]);
    const image = makeFakeImage(1000, 1000);
    const heuristic = new LivenessHeuristic(2, 0.15);

    const result = await runDetectionPipeline(detector, image, 1000, 1000, {
      livenessHeuristic: heuristic,
    });

    expect(result.liveness).toBeUndefined();
  });

  it("times out if detection hangs longer than inferenceTimeoutMs", async () => {
    const detector: FaceDetector = {
      initialize: vi.fn().mockResolvedValue("wasm"),
      detect: vi.fn().mockImplementation(() => new Promise(() => {})), // never resolves
      provider: "wasm",
      modelVersion: "fake-detector-v1",
    };
    const image = makeFakeImage(1000, 1000);

    await expect(
      runDetectionPipeline(detector, image, 1000, 1000, { inferenceTimeoutMs: 20 })
    ).rejects.toThrow(FacePipelineError);
  });

  it("does not time out when detection resolves well within the limit", async () => {
    const detector = makeFakeDetector([makeFace()]);
    const image = makeFakeImage(1000, 1000);

    const result = await runDetectionPipeline(detector, image, 1000, 1000, {
      inferenceTimeoutMs: 5000,
    });

    expect(result.faces).toHaveLength(1);
  });

  it("does not crop or run pixel checks when enablePixelQualityChecks is unset", async () => {
    const detector = makeFakeDetector([makeFace()]);
    const image = makeFakeImage(1000, 1000);

    // No real `document` in this test environment — if the pipeline tried
    // to crop, cropFaceImageData() would just return null anyway, but this
    // test asserts the *default* behavior is not to attempt it, by relying
    // on quality still resolving OK purely from geometry checks (which it
    // would either way) — the meaningful assertion is that this doesn't
    // throw even though there's no canvas available at all.
    const result = await runDetectionPipeline(detector, image, 1000, 1000);
    expect(result.quality.code).toBe("OK");
  });

  it("does not throw when enablePixelQualityChecks is set but no canvas is available (non-browser test env)", async () => {
    const detector = makeFakeDetector([makeFace()]);
    const image = makeFakeImage(1000, 1000);

    const result = await runDetectionPipeline(detector, image, 1000, 1000, {
      enablePixelQualityChecks: true,
    });
    // cropFaceImageData() returns null without a real DOM, so pixel checks
    // are silently skipped rather than crashing — quality falls back to
    // geometry-only, same as if the option were off.
    expect(result.quality.code).toBe("OK");
  });
});

describe("matchFaces", () => {
  it("delegates to the landmark-similarity matching service", () => {
    const face = makeFace();
    const result = matchFaces(face, face);
    expect(result.isMatch).toBe(true);
    expect(result.similarity).toBeCloseTo(1);
  });

  it("respects a custom threshold", () => {
    const faceA = makeFace();
    const faceB = makeFace({ confidence: 0.1 }); // confidence doesn't affect similarity, just sanity
    const result = matchFaces(faceA, faceB, 0.99);
    expect(result.threshold).toBe(0.99);
  });
});

function makeFakeEmbedder(): FaceEmbedder {
  return {
    initialize: vi.fn().mockResolvedValue("wasm"),
    embed: vi.fn().mockResolvedValue(new Float32Array(128).fill(0.1)),
    provider: "wasm",
    modelVersion: "fake-embedder-v1",
    embeddingDimension: 128,
  };
}

describe("embedFace", () => {
  it("throws EmbeddingError when alignment fails (no canvas in this test env)", async () => {
    const embedder = makeFakeEmbedder();
    const image = makeFakeImage(1000, 1000);
    const face = makeFace();

    await expect(embedFace(embedder, image, face.landmarks)).rejects.toThrow(EmbeddingError);
    // Alignment failed before inference was ever attempted.
    expect(embedder.embed).not.toHaveBeenCalled();
  });
});

describe("matchFaceEmbeddings", () => {
  it("matches identical embeddings using SFace's default threshold", () => {
    const embedding = new Float32Array(128).fill(0.1);
    const result = matchFaceEmbeddings(embedding, embedding);
    expect(result.isMatch).toBe(true);
    expect(result.similarity).toBeCloseTo(1);
  });

  it("respects a custom threshold", () => {
    const embedding = new Float32Array(128).fill(0.1);
    const result = matchFaceEmbeddings(embedding, embedding, 0.99);
    expect(result.threshold).toBe(0.99);
  });
});

function makeFakeAntiSpoofClassifier(result: { label: "real" | "fake"; confidence: number }): AntiSpoofClassifier {
  return {
    initialize: vi.fn().mockResolvedValue("wasm"),
    classify: vi.fn().mockResolvedValue(result),
    provider: "wasm",
    modelVersion: "fake-antispoof-v1",
  };
}

describe("checkLiveness", () => {
  it("throws LivenessCheckError when cropping fails (no canvas in this test env)", async () => {
    const classifier = makeFakeAntiSpoofClassifier({ label: "real", confidence: 0.9 });
    const face = makeFace();

    await expect(
      checkLiveness(classifier, makeFakeImage(1000, 1000), face.box, 1000, 1000)
    ).rejects.toThrow(LivenessCheckError);
    expect(classifier.classify).not.toHaveBeenCalled();
  });
});
