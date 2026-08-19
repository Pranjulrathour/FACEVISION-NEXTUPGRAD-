# Evaluation Methodology (Checklist §4 §22 §23 §25 §33 §36 — Phase 4)

This documents how the app's actual accuracy numbers in
[docs/reports/evaluation-sface-lfw.md](reports/evaluation-sface-lfw.md) were
produced, so the numbers can be trusted, reproduced, or challenged — not
just cited.

## What was measured

Face **verification** accuracy of the real production pipeline: YuNet
detection → face alignment → SFace embedding → cosine similarity, exactly
as used by the Gallery enroll/recognize feature (see
[ADR 0002](adr/0002-sface-embeddings-for-gallery-recognition.md)).

## Why a Python harness exists alongside the browser app

The production app runs 100% client-side in the browser via ONNX Runtime
Web — there is no server-side inference, by design (see the app's core
privacy promise). Running a real accuracy benchmark over thousands of
image pairs through a real browser would be extremely slow and hard to
automate headlessly. Instead,
[backend/evaluation/onnx_face_pipeline.py](../backend/evaluation/onnx_face_pipeline.py)
is a **direct line-by-line Python port** of the same detection/alignment
logic in `frontend/src/lib/yunet.ts` and `face-alignment.ts`, run against
the *same* `.onnx` model files already committed in
`frontend/public/models/`, via `onnxruntime` (Python) instead of
`onnxruntime-web`.

This is a port, not shared code, because the two run in genuinely
different runtimes. Correctness of the port is established two ways:

1. **Unit tests mirror the TS test suites exactly** —
   [backend/tests/test_onnx_face_pipeline_eval.py](../backend/tests/test_onnx_face_pipeline_eval.py)
   runs the identical similarity-transform/NMS/box-expansion cases as
   `face-alignment.test.ts` and `yunet.test.ts`, with the same expected
   inputs/outputs.
2. **End-to-end sanity check**: on the first few real image pairs, genuine
   pairs scored 0.64–0.76 cosine similarity and impostor pairs scored
   0.03–0.13 — a large, correctly-separated gap in the expected direction,
   before the full run was trusted.

## Dataset: LFW verification pairs

**Labeled Faces in the Wild (LFW)**, University of Massachusetts Amherst —
the standard academic face-verification benchmark, released for
non-commercial research use. This evaluation is exactly that: an offline,
non-commercial accuracy measurement, not a redistributed product feature.

The canonical host (`vis-www.cs.umass.edu`) was not reachable from this
environment, so the dataset was pulled from a Hugging Face mirror,
[`logasja/lfw`](https://huggingface.co/datasets/logasja/lfw), `pairs/test`
split: **2200 real image pairs** (1100 genuine — same person, different
photo; 1100 impostor — different people), the standard LFW balanced
verification protocol. The parquet file is not committed to the repo
(`backend/evaluation/data/` is gitignored) — re-download it to reproduce.

## How to reproduce

```bash
cd backend
python -m venv .venv && .venv/Scripts/activate  # or source .venv/bin/activate
pip install -r requirements.txt
pip install -r requirements-eval.txt  # numpy/Pillow/onnxruntime/scikit-learn/pandas/pyarrow -- evaluation-only, not shipped in production
curl -L -o evaluation/data/lfw_pairs_test.parquet \
  https://huggingface.co/datasets/logasja/lfw/resolve/main/pairs/test-00000-of-00001.parquet
python evaluation/run_lfw_eval.py
```

Regenerates `backend/evaluation/data/lfw_eval_results.json` and
`docs/reports/evaluation-sface-lfw.md`.

## Honest caveats — read before citing these numbers anywhere

- **LFW is not demographically balanced or annotated.** It's built from
  news photography (mostly mid-2000s), and is well-documented in the
  fairness literature as skewed toward light-skinned adult men. A high
  accuracy number on LFW is evidence the pipeline *works*, not evidence
  it's *fair across demographics* — checklist §25/§33 remain genuinely
  unmeasured. Claiming demographic fairness would require a dataset with
  actual demographic labels (e.g. BFW, RFW) and is explicitly out of
  scope for this pass.
- **The 0.363 match threshold is OpenCV Zoo's own published calibration**
  (see [docs/model-card-sface.md](model-card-sface.md)), not tuned against
  LFW by this app. The report's "empirically best threshold for this
  dataset" row shows what LFW alone would calibrate to (≈0.28) — a gap
  from 0.363 is expected, not a bug, since different calibration datasets
  produce different optimal cutoffs.
- **This measures verification (1:1 "are these the same person"), not the
  Gallery's actual identify-against-N-enrollments use case** — the
  underlying embedding/matching math is identical, but the real feature
  also depends on how many identities are enrolled and their pairwise
  similarity, which this dataset doesn't model.
- **No confidence interval reported.** 2200 pairs is a real sample, not a
  toy one, but the numbers are point estimates, not statistically
  bounded — treat a claim like "96.9% accuracy" as "measured once on this
  dataset," not as a guaranteed production error rate.
- **Detection succeeded on all 2200 pairs (0 skipped)** in this run — a
  meaningfully different, harder dataset (heavy occlusion, extreme angles)
  would likely show a nonzero detection-failure rate; this number is
  dataset-specific, not a universal detector reliability claim.
