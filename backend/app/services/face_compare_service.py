import math
from typing import List, Dict, Any


def _euclidean(p1: Dict[str, float], p2: Dict[str, float]) -> float:
    return math.sqrt((p2["x"] - p1["x"]) ** 2 + (p2["y"] - p1["y"]) ** 2)


def _normalize(landmarks: Dict[str, Any], box: Dict[str, float]) -> List[float]:
    keys = ["rightEye", "leftEye", "nose", "rightMouth", "leftMouth"]
    vec = []
    for k in keys:
        p = landmarks[k]
        vec.append((p["x"] - box["x"]) / box["width"])
        vec.append((p["y"] - box["y"]) / box["height"])
    return vec


def _cosine(a: List[float], b: List[float]) -> float:
    if len(a) != len(b) or not a:
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(x * x for x in b))
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)


def compare_faces(face_a: dict, face_b: dict, threshold: float = 0.78) -> dict:
    box_a = face_a.get("box", {})
    box_b = face_b.get("box", {})
    lm_a = face_a.get("landmarks", {})
    lm_b = face_b.get("landmarks", {})

    if not box_a.get("width") or not box_a.get("height") or not box_b.get("width") or not box_b.get("height"):
        return {"similarity": 0.0, "isMatch": False, "threshold": threshold}

    required = ["rightEye", "leftEye", "nose", "rightMouth", "leftMouth"]
    if not all(k in lm_a and k in lm_b for k in required):
        return {"similarity": 0.0, "isMatch": False, "threshold": threshold}

    vec_a = _normalize(lm_a, box_a)
    vec_b = _normalize(lm_b, box_b)
    sim = max(0.0, min(1.0, _cosine(vec_a, vec_b)))
    return {
        "similarity": float(sim),
        "isMatch": sim >= threshold,
        "threshold": threshold,
    }
