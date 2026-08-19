"""Python mirror of the frontend's client-side face pipeline, used ONLY for
offline batch evaluation (checklist §4/§22/§23) against a real labeled
dataset -- the production app never runs Python inference; all real
inference is client-side ONNX Runtime Web (see frontend/src/lib/yunet.ts,
face-alignment.ts, sface.ts).

Every function here is a direct, deliberate port of the equivalent
TypeScript logic, kept close enough that a diff against the source is
straightforward:
  - decode_yunet / non_max_suppression / expand_box  <- frontend/src/lib/yunet.ts
  - compute_similarity_transform                      <- frontend/src/lib/face-alignment.ts
  - image_to_bgr_mean_tensor                           <- yunet.ts's per-pixel packing
  - image_to_rgb_chw_tensor                            <- frontend/src/lib/sface.ts

Ported rather than shared because the frontend runs onnxruntime-web in the
browser and this evaluation harness runs onnxruntime (Python) offline --
there is no realistic way to share the literal code across those runtimes,
so correctness instead relies on: (a) keeping this file's line-by-line
comments pointing at the TS source, and (b) unit tests in
backend/tests/evaluation/test_onnx_face_pipeline.py that mirror the exact
same cases as the TS test suites (face-alignment.test.ts, yunet.test.ts).
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Optional

import numpy as np
from PIL import Image

YUNET_INPUT_SIZE = 640
SFACE_INPUT_SIZE = 112
ALIGNED_FACE_SIZE = 112

# Tightened 2026-08-19 alongside frontend/src/lib/yunet.ts -- see that
# file's comment for why (box was reported as visibly "deviated" from the
# face; root cause was over-large padding, not a coordinate bug).
BOX_PADDING_TOP = 0.12
BOX_PADDING_BOTTOM = 0.08
BOX_PADDING_LEFT = 0.08
BOX_PADDING_RIGHT = 0.08

SFACE_COSINE_MATCH_THRESHOLD = 0.363

# OpenCV FaceRecognizerSF::alignCrop reference template -- identical to
# REFERENCE_LANDMARKS in face-alignment.ts.
REFERENCE_LANDMARKS = np.array(
    [
        [38.2946, 51.6963],  # right eye
        [73.5318, 51.5014],  # left eye
        [56.0252, 71.7366],  # nose tip
        [41.5493, 92.3655],  # right mouth corner
        [70.7299, 92.2041],  # left mouth corner
    ],
    dtype=np.float64,
)


@dataclass
class Box:
    x: float
    y: float
    width: float
    height: float


@dataclass
class Landmarks:
    right_eye: tuple[float, float]
    left_eye: tuple[float, float]
    nose: tuple[float, float]
    right_mouth: tuple[float, float]
    left_mouth: tuple[float, float]

    def ordered_points(self) -> np.ndarray:
        return np.array(
            [self.right_eye, self.left_eye, self.nose, self.right_mouth, self.left_mouth],
            dtype=np.float64,
        )


@dataclass
class Face:
    box: Box
    confidence: float
    landmarks: Landmarks


@dataclass
class SimilarityTransform:
    a: float
    b: float
    tx: float
    ty: float


def compute_similarity_transform(src_points: np.ndarray, dst_points: np.ndarray) -> SimilarityTransform:
    """Direct port of computeSimilarityTransform() in face-alignment.ts."""
    if src_points.shape != dst_points.shape or src_points.shape[0] == 0:
        raise ValueError("compute_similarity_transform requires equal, non-empty point sets.")

    mean_src = src_points.mean(axis=0)
    mean_dst = dst_points.mean(axis=0)

    x = src_points[:, 0] - mean_src[0]
    y = src_points[:, 1] - mean_src[1]
    dx = dst_points[:, 0] - mean_dst[0]
    dy = dst_points[:, 1] - mean_dst[1]

    dot_sum = float(np.sum(x * dx + y * dy))
    cross_sum = float(np.sum(x * dy - y * dx))
    src_variance = float(np.sum(x * x + y * y))

    if src_variance == 0:
        return SimilarityTransform(a=1.0, b=0.0, tx=mean_dst[0] - mean_src[0], ty=mean_dst[1] - mean_src[1])

    a = dot_sum / src_variance
    b = cross_sum / src_variance
    tx = mean_dst[0] - a * mean_src[0] + b * mean_src[1]
    ty = mean_dst[1] - b * mean_src[0] - a * mean_src[1]
    return SimilarityTransform(a=a, b=b, tx=tx, ty=ty)


def align_face(image: Image.Image, landmarks: Landmarks, size: int = ALIGNED_FACE_SIZE) -> Image.Image:
    """Warp `image` onto the 112x112 reference template using the same
    similarity transform as alignFace() in face-alignment.ts.

    Canvas's setTransform(a, b, -b, a, tx, ty) + drawImage draws using the
    FORWARD mapping dst = M @ src + t. PIL's Image.transform(AFFINE) wants
    the INVERSE mapping (src = M^-1 @ (dst - t)) since it samples the
    source per destination pixel. M = [[a, -b], [b, a]] is a scaled
    rotation, so M^-1 = (1 / (a^2+b^2)) * [[a, b], [-b, a]].
    """
    t = compute_similarity_transform(landmarks.ordered_points(), REFERENCE_LANDMARKS)
    denom = t.a * t.a + t.b * t.b
    if denom == 0:
        raise ValueError("Degenerate similarity transform (zero scale).")
    ia = t.a / denom
    ib = t.b / denom
    coeffs = (
        ia, ib, -ia * t.tx - ib * t.ty,
        -ib, ia, ib * t.tx - ia * t.ty,
    )
    return image.transform((size, size), Image.AFFINE, coeffs, resample=Image.BILINEAR)


def _letterbox(image: Image.Image, input_size: int = YUNET_INPUT_SIZE):
    width, height = image.size
    scale = min(input_size / width, input_size / height)
    scaled_width = max(1, round(width * scale))
    scaled_height = max(1, round(height * scale))
    dx = (input_size - scaled_width) / 2
    dy = (input_size - scaled_height) / 2
    canvas = Image.new("RGB", (input_size, input_size), (0, 0, 0))
    resized = image.convert("RGB").resize((scaled_width, scaled_height), Image.BILINEAR)
    canvas.paste(resized, (round(dx), round(dy)))
    return canvas, scale, scaled_width, scaled_height, dx, dy


def image_to_bgr_mean_tensor(canvas: Image.Image) -> np.ndarray:
    """Mirrors yunet.ts detect()'s per-pixel packing: channel0=B-104,
    channel1=G-117, channel2=R-123, CHW, float32."""
    arr = np.asarray(canvas, dtype=np.float32)  # H,W,3 in R,G,B order
    r = arr[:, :, 0] - 123
    g = arr[:, :, 1] - 117
    b = arr[:, :, 2] - 104
    tensor = np.stack([b, g, r], axis=0)  # C,H,W
    return tensor[np.newaxis, ...]  # 1,C,H,W


def image_to_rgb_chw_tensor(aligned: Image.Image) -> np.ndarray:
    """Mirrors sface.ts's imageDataToChwTensor(): RGB, CHW, raw 0-255."""
    arr = np.asarray(aligned.convert("RGB"), dtype=np.float32)  # H,W,3
    tensor = np.transpose(arr, (2, 0, 1))  # C,H,W
    return tensor[np.newaxis, ...]


def _build_landmarks(kps: np.ndarray, index: int, stride: int, columns: int, dx: float, dy: float, scale: float) -> Landmarks:
    col = index % columns
    row = index // columns
    base_x = (col + 0.5) * stride
    base_y = (row + 0.5) * stride
    base = kps[index]

    def pt(off: int) -> tuple[float, float]:
        return (
            (base_x + base[off] * stride - dx) / scale,
            (base_y + base[off + 1] * stride - dy) / scale,
        )

    return Landmarks(
        right_eye=pt(0), left_eye=pt(2), nose=pt(4), right_mouth=pt(6), left_mouth=pt(8),
    )


def expand_box(x: float, y: float, width: float, height: float) -> Box:
    """Direct port of expandBox() in yunet.ts (post-2026-08-19 tightening)."""
    pad_left = width * BOX_PADDING_LEFT
    pad_right = width * BOX_PADDING_RIGHT
    pad_top = height * BOX_PADDING_TOP
    pad_bottom = height * BOX_PADDING_BOTTOM
    return Box(
        x=x - pad_left,
        y=y - pad_top,
        width=width + pad_left + pad_right,
        height=height + pad_top + pad_bottom,
    )


def decode_yunet(
    outputs: dict[str, np.ndarray],
    scale: float,
    content_width: float,
    content_height: float,
    dx: float,
    dy: float,
    confidence_threshold: float,
) -> list[Face]:
    """Direct port of decodeYuNet() in yunet.ts."""
    faces: list[Face] = []
    for stride in (8, 16, 32):
        cls = outputs.get(f"cls_{stride}")
        obj = outputs.get(f"obj_{stride}")
        boxes = outputs.get(f"bbox_{stride}")
        kps = outputs.get(f"kps_{stride}")
        if cls is None or obj is None or boxes is None:
            continue
        cls = cls.reshape(-1)
        obj = obj.reshape(-1)
        boxes = boxes.reshape(-1, 4)
        kps = kps.reshape(-1, 10) if kps is not None else None
        columns = YUNET_INPUT_SIZE // stride

        confidence = np.sqrt(np.clip(cls * obj, 0, None))
        candidate_indices = np.where(confidence >= confidence_threshold)[0]
        for index in candidate_indices:
            col = index % columns
            row = index // columns
            box = boxes[index]
            x = (col + box[0]) * stride - dx
            y = (row + box[1]) * stride - dy
            width = math.exp(box[2]) * stride
            height = math.exp(box[3]) * stride
            clipped_x = max(0.0, min(x, content_width))
            clipped_y = max(0.0, min(y, content_height))
            clipped_width = max(0.0, min(width, content_width - clipped_x))
            clipped_height = max(0.0, min(height, content_height - clipped_y))
            if clipped_width <= 0 or clipped_height <= 0:
                continue
            original_x = clipped_x / scale
            original_y = clipped_y / scale
            original_width = clipped_width / scale
            original_height = clipped_height / scale
            padded = expand_box(original_x, original_y, original_width, original_height)

            if kps is not None:
                landmarks = _build_landmarks(kps, int(index), stride, columns, dx, dy, scale)
            else:
                landmarks = Landmarks(
                    right_eye=(padded.x + padded.width * 0.3, padded.y + padded.height * 0.35),
                    left_eye=(padded.x + padded.width * 0.7, padded.y + padded.height * 0.35),
                    nose=(padded.x + padded.width * 0.5, padded.y + padded.height * 0.5),
                    right_mouth=(padded.x + padded.width * 0.35, padded.y + padded.height * 0.75),
                    left_mouth=(padded.x + padded.width * 0.65, padded.y + padded.height * 0.75),
                )
            faces.append(Face(box=padded, confidence=float(confidence[index]), landmarks=landmarks))
    return faces


def _iou(a: Box, b: Box) -> float:
    x1 = max(a.x, b.x)
    y1 = max(a.y, b.y)
    x2 = min(a.x + a.width, b.x + b.width)
    y2 = min(a.y + a.height, b.y + b.height)
    intersection = max(0.0, x2 - x1) * max(0.0, y2 - y1)
    union = a.width * a.height + b.width * b.height - intersection
    return intersection / union if union else 0.0


def non_maximum_suppression(faces: list[Face], threshold: float = 0.35) -> list[Face]:
    """Direct port of nonMaximumSuppression() in yunet.ts."""
    kept: list[Face] = []
    for face in sorted(faces, key=lambda f: f.confidence, reverse=True):
        if not any(_iou(face.box, candidate.box) > threshold for candidate in kept):
            kept.append(face)
    return kept


class YuNetOnnxDetector:
    """Thin onnxruntime wrapper around decode_yunet/non_maximum_suppression --
    the ONNX session I/O only; all the actual decode math lives in the pure
    functions above so it can be unit-tested without a model file."""

    def __init__(self, model_path: str):
        import onnxruntime as ort

        options = ort.SessionOptions()
        options.log_severity_level = 3
        self.session = ort.InferenceSession(model_path, sess_options=options, providers=["CPUExecutionProvider"])

    def detect(self, image: Image.Image, confidence_threshold: float = 0.75, nms_threshold: float = 0.35) -> list[Face]:
        canvas, scale, scaled_width, scaled_height, dx, dy = _letterbox(image)
        tensor = image_to_bgr_mean_tensor(canvas)
        outputs = self.session.run(None, {"input": tensor})
        output_names = [o.name for o in self.session.get_outputs()]
        output_map = dict(zip(output_names, outputs))
        faces = decode_yunet(output_map, scale, scaled_width, scaled_height, dx, dy, confidence_threshold)
        return non_maximum_suppression(faces, nms_threshold)


class SFaceOnnxEmbedder:
    """Thin onnxruntime wrapper for SFace embedding — see sface.ts for the
    verified input/output contract this mirrors."""

    def __init__(self, model_path: str):
        import onnxruntime as ort

        options = ort.SessionOptions()
        options.log_severity_level = 3
        self.session = ort.InferenceSession(model_path, sess_options=options, providers=["CPUExecutionProvider"])

    def embed(self, aligned_face: Image.Image) -> np.ndarray:
        tensor = image_to_rgb_chw_tensor(aligned_face)
        output = self.session.run(["fc1"], {"data": tensor})
        return output[0].reshape(-1)


def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    denom = float(np.linalg.norm(a) * np.linalg.norm(b))
    if denom == 0:
        return 0.0
    return float(np.dot(a, b) / denom)


def largest_face(faces: list[Face]) -> Optional[Face]:
    if not faces:
        return None
    return max(faces, key=lambda f: f.box.width * f.box.height)
