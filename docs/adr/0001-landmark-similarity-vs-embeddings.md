# ADR 0001: Landmark-geometry similarity instead of a trained face-embedding model

## Status

Accepted (current implementation). Open to revisiting — see "Revisit trigger" below.

## Context

FaceVision's "Compare" feature lets a user pick two detected faces and see a similarity score.
The checklist this ADR responds to (§10, §43 Q22-23) explicitly requires this distinction to be
documented rather than left implicit: is this feature actual face **verification** (comparing
learned identity embeddings, the way KYC/access-control systems do), or something lighter?

## Decision

Compute similarity as the cosine similarity between two faces' 5-point landmark positions,
each normalized relative to that face's own bounding box:

- Frontend: [frontend/src/lib/face-math.ts](../../frontend/src/lib/face-math.ts) `compareFaces()`
- Backend (mirrors the same math for persisted comparisons): [backend/app/services/face_compare_service.py](../../backend/app/services/face_compare_service.py)

No face-embedding model (e.g. ArcFace, SFace, FaceNet-style) is bundled or called. YuNet
itself only outputs a bounding box and 5 landmark points — it does not produce an identity
embedding.

## Why

- **Zero additional model weight.** Bundling a real recognition model means shipping and
  loading a second ONNX model client-side (typically several MB), plus a second inference
  pass per face, plus new preprocessing (face alignment/cropping specific to that model's
  expected input) — nontrivial scope, not a drop-in addition to the existing YuNet pipeline.
- **Matches the product's actual claim.** FaceVision markets itself as a privacy-first
  *detection* app, not an identity-verification product. A geometric similarity score is
  honest about what it can and can't do; calling it "face recognition" without a trained
  embedding model backing it would overstate its capability and safety.
- **Landmark data alone is enough for the current use case** — a lightweight "these two crops
  look like the same framing/pose" signal for a demo feature, not a security decision.

## Consequences

- **This is not usable for any real identity-verification decision** (authentication, KYC,
  access control). Two different people with similarly-posed faces can score a false "match";
  the same person photographed from a very different angle can score a false "non-match."
  Standard face-recognition FAR/FRR benchmarking methodology doesn't meaningfully apply here,
  because this isn't an embedding space — there's no trained decision boundary to benchmark.
- **The threshold (default 0.78)** was chosen by manual testing, not a calibrated
  operating point on a measured ROC curve.
- **The SQL schema already reserves room to change this later**: `face_records.embedding_vector`
  (commented out, see `database/migrations/001_init_schema.sql`) anticipates adding pgvector +
  a real embedding model without a schema rewrite, if this decision is revisited.

## Revisit trigger

Revisit this decision if FaceVision's scope ever expands toward:
- Matching a face against a known gallery of enrolled identities (the currently-unused
  `face_gallery`/`gallery_face_samples` tables hint this was anticipated)
- Any workflow where a false "match" or false "non-match" has real consequences for a person

At that point, adopt a real trained embedding model (e.g. SFace or ArcFace via ONNX Runtime,
both from permissively-licensed sources like OpenCV Zoo), not a refinement of the current
landmark-similarity threshold — the landmark approach cannot be tuned into a verification-grade
system, it needs to be replaced.
