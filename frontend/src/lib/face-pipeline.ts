import type { FaceDetector } from "./face-detector";
import type { Face, FaceMatchResult } from "./face-types";
import { validateDecodedImageDimensions } from "./image";
import { assessFaces, type FaceQualityOptions, type FaceQualityResult } from "./face-quality";
import { LivenessHeuristic, type LivenessObservation } from "./liveness";
import { compareFaces } from "./face-math";

/**
 * Client-side face processing pipeline, mirroring the stage structure from
 * docs/face-detection-verification-checklist.md §3:
 *
 *   Input Validation -> Security Checks -> Image Preprocessor
 *   -> Face Detection Model -> Quality Assessment (+ Face Crop)
 *   -> Optional Liveness -> Optional Embedding -> Matching Service
 *   -> Business Layer -> Response
 *
 * Two stages from that diagram don't apply here by design: "Client" and
 * "API Gateway" assume a network hop to a server. FaceVision runs this
 * entire pipeline inside the browser — no image is ever uploaded, so
 * there is no gateway to route through and no server-side client to
 * distrust. This module exists so that fact is structural (one pipeline
 * entry point, staged and testable) rather than just a README claim.
 *
 * "Input Validation" on the raw File (MIME type, byte size) happens one
 * level up, in the caller, via validateImage() in image.ts, before the
 * file is ever decoded into an image element — runDetectionPipeline()
 * only sees already-decoded images, so it starts at the Security Checks
 * stage.
 */

export type DetectionPipelineResult = {
  faces: Face[];
  /** Quality Assessment stage output — see face-quality.ts. */
  quality: FaceQualityResult;
  /** Optional Liveness stage output — only present when a livenessHeuristic
   * was supplied and at least one face was detected. Heuristic only, not
   * certified anti-spoofing — see docs/face-detection-verification-checklist.md §11. */
  liveness?: LivenessObservation;
};

export type DetectionPipelineOptions = {
  confidenceThreshold?: number;
  nmsThreshold?: number;
  qualityOptions?: FaceQualityOptions;
  /** Pass a persistent instance (e.g. one per camera session) so liveness
   * can track movement across frames. Omit for single-shot upload
   * detections, where frame-to-frame liveness doesn't apply. */
  livenessHeuristic?: LivenessHeuristic;
};

export type FacePipelineErrorCode = "SECURITY_CHECK_FAILED";

function isDecodedImageSource(
  source: HTMLImageElement | HTMLVideoElement
): source is HTMLImageElement {
  return typeof (source as HTMLImageElement).naturalWidth === "number";
}

export class FacePipelineError extends Error {
  constructor(public readonly code: FacePipelineErrorCode, message: string) {
    super(message);
    this.name = "FacePipelineError";
  }
}

/**
 * Runs the Security Checks -> Preprocessor -> Detection -> Quality ->
 * Liveness stages for one frame/image, then hands back a structured
 * result (the Business Layer + Response stages are the caller's
 * responsibility — deciding what a given app does with the faces/quality/
 * liveness signal is product logic, not pipeline logic).
 */
export async function runDetectionPipeline(
  detector: FaceDetector,
  source: HTMLImageElement | HTMLVideoElement,
  width: number,
  height: number,
  options: DetectionPipelineOptions = {}
): Promise<DetectionPipelineResult> {
  // --- Security Checks stage ---
  // Guards against a decompression-bomb-style file: validateImage() (called
  // by the UI before this pipeline even runs) can only inspect file bytes,
  // not decoded pixel dimensions. Video frames don't carry this risk (their
  // dimensions come from the camera negotiation, not a decoded file), so
  // this only applies to decoded-image sources.
  //
  // Checked via duck-typing (naturalWidth/naturalHeight presence) rather
  // than `instanceof HTMLImageElement`: the latter only matches real DOM
  // elements, not test doubles or any other object shaped like one, and
  // silently no-ops for anything else — exactly the kind of check that
  // looks correct until it's exercised by something other than a live
  // browser <img>.
  if (isDecodedImageSource(source)) {
    const dimensionError = validateDecodedImageDimensions(source);
    if (dimensionError) {
      throw new FacePipelineError("SECURITY_CHECK_FAILED", dimensionError);
    }
  }

  // --- Image Preprocessor + Face Detection Model stages ---
  // Letterbox scaling, BGR conversion, and mean-subtraction normalization
  // happen inside detector.detect() — tightly coupled to the model's
  // expected tensor shape, so preprocessing isn't split into a separate
  // module here. See yunet.ts for that stage's implementation.
  const faces = await detector.detect(
    source,
    width,
    height,
    options.confidenceThreshold,
    options.nmsThreshold
  );

  // --- Quality Assessment stage (+ implicit Face Crop) ---
  // The bounding box on each detected Face already describes its crop
  // region; there is no separate cropped-image artifact produced here.
  const quality = assessFaces(faces, width, height, options.qualityOptions);

  // --- Optional Liveness stage ---
  let liveness: LivenessObservation | undefined;
  if (options.livenessHeuristic && faces.length > 0) {
    const primary = [...faces].sort((a, b) => b.confidence - a.confidence)[0];
    liveness = options.livenessHeuristic.observe(primary.landmarks);
  }

  return { faces, quality, liveness };
}

/**
 * Optional Embedding + Matching Service stages. FaceVision has no trained
 * embedding model — "embedding" here means the landmark-geometry
 * normalization performed inside compareFaces() (face-math.ts), not a
 * learned identity vector. See docs/adr/0001-landmark-similarity-vs-embeddings.md
 * for why, and don't rely on this for real identity verification.
 */
export function matchFaces(faceA: Face, faceB: Face, threshold?: number): FaceMatchResult {
  return compareFaces(faceA, faceB, threshold);
}
