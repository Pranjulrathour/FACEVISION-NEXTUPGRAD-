# Model Card — SFace

| Field | Value |
|---|---|
| Model | SFace |
| Version stamp used in this app | `sface-2021dec` (see [frontend/src/lib/sface.ts](../frontend/src/lib/sface.ts) `SFACE_MODEL_VERSION`) |
| Source | [OpenCV Zoo](https://github.com/opencv/opencv_zoo/tree/main/models/face_recognition_sface), original research: [zhongyy/SFace](https://github.com/zhongyy/SFace) |
| License | Apache 2.0 |
| File | `frontend/public/models/face_recognition_sface_2021dec.onnx` (~37MB) |
| Format | ONNX |
| Input | tensor `data`, shape `[1, 3, 112, 112]`, float32, RGB, CHW, raw 0-255 pixel values (verified directly against the model graph and against OpenCV's `FaceRecognizerSF` C++ preprocessing source — no mean subtraction, no `/255` scaling) |
| Output | tensor `fc1`, shape `[1, 128]` — a 128-dimension embedding vector |
| Runtime | ONNX Runtime Web, WebGPU execution provider first, automatic WASM fallback |
| Calibrated match threshold | cosine similarity ≥ 0.363 (OpenCV Zoo's own `demo.py` default — not tuned by this app) |
| Loading | Lazy — only fetched when the user opens the Gallery panel or clicks Enroll/Recognize, not on initial page load |

## Required preprocessing: face alignment

Unlike YuNet (which only needs letterbox scaling), SFace requires the input face to be warped
onto a canonical 112×112 pose before embedding — feeding it a raw bounding-box crop produces a
low-quality, not-meaningfully-comparable vector. This app implements that warp in
[face-alignment.ts](../frontend/src/lib/face-alignment.ts) using OpenCV's own fixed reference
landmark template (from `FaceRecognizerSF::alignCrop`'s `getSimilarityTransformMatrix`), not an
approximation.

## Intended use

Real face-identity embeddings for the gallery enroll/recognize feature — a person enrolls a
name against one or more embedding samples, and future detections are matched against the
gallery via cosine similarity. See
[ADR 0002](adr/0002-sface-embeddings-for-gallery-recognition.md) for why this is a distinct
feature from the landmark-geometry-based Compare panel.

## Known limitations

- **Not evaluated for demographic accuracy parity** by this project (see checklist §33) —
  relying on OpenCV Zoo's published accuracy figures, not independently measured here.
- **No formal FAR/FRR benchmark run by this app** against a real evaluation dataset (checklist
  §22-23, Phase 4) — the 0.363 threshold is OpenCV's own calibration, used as-is.
- **Alignment quality depends on YuNet's landmark accuracy.** If the upstream detector's 5
  landmarks are imprecise (extreme angles, occlusion), the alignment — and therefore the
  embedding — degrades. No fallback or quality gate is applied before embedding beyond the
  existing detection-confidence/pose checks in `face-quality.ts`.
- **Not a liveness/anti-spoofing check.** A printed photo's face can be enrolled or recognized
  just as a live person's can — see checklist §11 and the separate liveness heuristic.

## Governance

- **Model file changes must bump `SFACE_MODEL_VERSION`** in `sface.ts` so enrolled gallery
  samples stay traceable to the model version that produced their embedding
  (`gallery_face_samples.model_version` column). Embeddings from different model versions are
  **not** directly comparable — swapping the model without a migration plan would silently
  break recognition against previously-enrolled samples.
- **Model swaps must re-verify the alignment template** — a different embedding model may
  expect a different reference landmark layout or input size; don't assume SFace's 112×112
  ArcFace-style template transfers to a new model without checking its own documentation/source.
