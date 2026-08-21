import math
from typing import List


def cosine_similarity(a: List[float], b: List[float]) -> float:
    """Shared cosine-similarity helper -- used for real embedding-vector
    matching (gallery_service.py). Kept dependency-free (no numpy) since
    vectors here are small (a handful to 128 dimensions) and this app
    doesn't otherwise need a numerical library."""
    if len(a) != len(b) or not a:
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(x * x for x in b))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)
