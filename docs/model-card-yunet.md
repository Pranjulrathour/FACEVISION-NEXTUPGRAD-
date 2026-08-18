# Model Card — YuNet 2023mar

| Field | Value |
|---|---|
| Model | YuNet 2023mar |
| Version stamp used in this app | `yunet-2023mar` (see [frontend/src/lib/yunet.ts](../frontend/src/lib/yunet.ts) `YUNET_MODEL_VERSION`) |
| Source | [OpenCV Zoo](https://github.com/opencv/opencv_zoo) |
| License | Apache 2.0 |
| File | `frontend/public/models/face_detection_yunet_2023mar.onnx` |
| Format | ONNX |
| Input | `1×3×640×640`, NCHW, BGR channel order, mean-subtracted (B-104, G-117, R-123) |
| Runtime | ONNX Runtime Web 1.27, WebGPU execution provider first, automatic WASM fallback |
| Outputs used | `cls_{8,16,32}`, `obj_{8,16,32}`, `bbox_{8,16,32}`, `kps_{8,16,32}` (classification, objectness, box regression, 5-point landmarks per stride) |

## Intended use

Real-time face bounding-box and 5-point landmark (right eye, left eye, nose, right mouth
corner, left mouth corner) detection, running entirely client-side in a browser, on uploaded
images or a live camera feed.

## Known limitations

- **Not a recognition or verification model.** Outputs a bounding box, confidence score, and
  landmark positions — not an identity embedding. FaceVision's "compare" feature derives a
  geometric similarity score from these landmarks (see
  [docs/adr/0001-landmark-similarity-vs-embeddings.md](adr/0001-landmark-similarity-vs-embeddings.md)),
  which is not equivalent to a trained face-recognition model's accuracy or security properties.
- **Not a liveness/anti-spoofing model.** A printed photo or a screen replay can pass
  detection. See [docs/face-detection-verification-checklist.md §11](face-detection-verification-checklist.md#11-liveness-detection).
- **Not evaluated for demographic accuracy parity** (skin tone, age, gender) by this project —
  see §33 of the same checklist. No claim of demographic fairness is made.
- **Fixed 640×640 input.** Other resolutions fail immediately; the app enforces this via
  letterbox scaling before inference, not by resizing the model itself.
- **Minimum practical face size** is roughly what's detectable at 640×640 input resolution —
  very small or heavily occluded faces in the source image may be missed. No formal minimum
  pixel threshold has been benchmarked.

## Configuration defaults (user-adjustable in the Settings panel)

| Parameter | Default | Meaning |
|---|---|---|
| Confidence threshold | 0.75 | Minimum `sqrt(cls × objectness)` score to keep a detection |
| NMS IoU threshold | 0.35 | Overlap threshold for non-maximum suppression |

## Benchmark status

**No formal benchmark document exists comparing YuNet against alternatives** (RetinaFace,
MediaPipe, YOLO-face) on accuracy, latency, or memory for this app's actual use case. The
current thresholds were tuned manually during development, not derived from a measured
precision/recall/FAR/FRR sweep. This is a known, explicitly acknowledged gap — see
[docs/face-detection-verification-checklist.md §4](face-detection-verification-checklist.md#4-technology--model-selection).

## Governance

- **Model file changes must bump `YUNET_MODEL_VERSION`** in `yunet.ts` so historical detection
  records stay traceable to the model version that produced them (`model_version` column on
  `detection_records`, added in `database/migrations/002_add_model_version.sql`).
- **Model swaps must be tested against the existing unit test suite** (`yunet.test.ts`) at
  minimum before merging, and ideally against a small representative image set covering the
  diversity dimensions listed in the checklist's §22 (lighting, angle, occlusion, resolution).
