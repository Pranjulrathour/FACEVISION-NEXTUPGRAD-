# Model Card — MiniFASNet V2

| Field | Value |
|---|---|
| Model | MiniFASNet V2 |
| Version stamp used in this app | `minifasnet-v2-2.7-80x80` (see [frontend/src/lib/minifasnet.ts](../frontend/src/lib/minifasnet.ts) `MINIFASNET_MODEL_VERSION`) |
| Source | [minivision-ai/Silent-Face-Anti-Spoofing](https://github.com/minivision-ai/Silent-Face-Anti-Spoofing) (original training/inference code), ONNX export from [QingHeYang/Silent-Face-Anti-Spoofing-onnx](https://github.com/QingHeYang/Silent-Face-Anti-Spoofing-onnx) |
| License | Apache 2.0 (both the original repo and the ONNX conversion repo state Apache 2.0) |
| File | `frontend/public/models/minifasnet_v2.onnx` (~1.7MB) |
| Format | ONNX |
| Input | tensor `input`, shape `[batch_size, 3, 80, 80]`, float32, **BGR** channel order, `/255` scaled — verified against `onnxruntime.InferenceSession.get_inputs()` and against the original repo's `anti_spoof_predict.py` preprocessing (no RGB conversion, unlike YuNet/SFace) |
| Output | tensor `output`, shape `[batch_size, 3]` — **raw logits, not probabilities**. Verified via `onnx.load()` node inspection: the graph's terminal nodes are `[Concat, Reshape, MatMul, BatchNormalization, MatMul]`, ending in `MatMul` with no `Softmax` node present anywhere in the graph |
| Class mapping | index `1` = real, indices `0` and `2` = fake — confirmed against the original repo's `test.py` calling code (the exported graph itself does not encode this mapping) |
| Runtime | ONNX Runtime Web, WebGPU execution provider first, automatic WASM fallback (same pattern as YuNet/SFace) |
| Loading | Lazy — only fetched when the user clicks "Check Liveness" on a detected face, not on initial page load and not automatically alongside detection |

## Required preprocessing: model-specific crop expansion

MiniFASNet does **not** use the raw detection bounding box, and does **not** use SFace's
landmark-aligned 112×112 warp. It expects a box expanded by a fixed `scale=2.7` around the
detected face center, ported exactly (including edge/corner clamping) from the original repo's
`_get_new_box` in `generate_patches.py`. Implemented in
[antispoof-crop.ts](../frontend/src/lib/antispoof-crop.ts), covered by 6 unit tests for centered
expansion, boundary clamping near frame edges/corners, full-frame faces, and non-square images.

Softmax is applied client-side after inference
([minifasnet.ts](../frontend/src/lib/minifasnet.ts)'s `softmax()`, numerically stable via
max-subtraction) since the exported graph outputs raw logits.

## Intended use

A user-triggered, real (trained) anti-spoofing signal on a single detected face — "Check
Liveness" button, one face at a time. See
[ADR 0003](adr/0003-minifasnet-liveness-and-jwt-auth.md) for why this is additive to, not a
replacement for, the existing passive movement-heuristic in `liveness.ts`.

## Known limitations

- **Not wired into any automatic gate.** Enrolling or recognizing a face in the Gallery does
  **not** require a passing liveness check — it's an independent, user-triggered signal only.
  Treat a "real" result as informational, not as a security guarantee for enroll/recognize.
- **Not independently benchmarked by this app.** Relying on the original repo's published
  accuracy figures; no FAR/FRR or presentation-attack-detection (PAD) evaluation run here
  (checklist §22-23, Phase 4).
- **Single-frame, single-model check.** The original Silent-Face-Anti-Spoofing project ensembles
  multiple MiniFASNet variants (different crop scales) for its published accuracy; this app only
  bundles the one 2.7-scale variant, not the full ensemble, to keep the bundle small and the
  integration simple. Expect lower robustness than the paper's reported numbers.
- **No temporal/video-based liveness signal from this model** — it classifies one static crop.
  (The separate heuristic in `liveness.ts` does look at movement across frames, but is not this
  model.)
- **Crop quality depends on the same YuNet detection box** used for everything else — extreme
  angles, occlusion, or a poor detection will degrade the crop and therefore the classification,
  with no additional quality gate applied before this check runs.

## Governance

- **Model file changes must bump `MINIFASNET_MODEL_VERSION`** in `minifasnet.ts` — unlike gallery
  embeddings, liveness results aren't currently persisted anywhere, but keep the version constant
  accurate for any future persistence or telemetry that references it.
- **Model swaps must re-verify both the crop scale and the class-index mapping** — these are not
  encoded in the ONNX graph itself (confirmed by direct inspection) and were reverse-engineered
  from the original repo's Python calling code. A different checkpoint or a different variant in
  the same family could use a different scale or class ordering; don't assume they transfer.
