"""Mirrors the same cases as frontend/src/lib/face-alignment.test.ts and
yunet.test.ts, for the Python port used by the offline LFW evaluation
harness (backend/evaluation/onnx_face_pipeline.py) -- see that file's
module docstring for why this is a port rather than shared code."""
import math

import numpy as np
import pytest

from evaluation.onnx_face_pipeline import (
    Box,
    Face,
    Landmarks,
    compute_similarity_transform,
    cosine_similarity,
    expand_box,
    largest_face,
    non_maximum_suppression,
)


def apply_transform(t, p):
    return (
        t.a * p[0] - t.b * p[1] + t.tx,
        t.b * p[0] + t.a * p[1] + t.ty,
    )


class TestComputeSimilarityTransform:
    def test_identity_for_identical_point_sets(self):
        points = np.array([[0, 0], [10, 0], [5, 10]], dtype=np.float64)
        t = compute_similarity_transform(points, points)
        for p in points:
            mapped = apply_transform(t, p)
            assert mapped[0] == pytest.approx(p[0], abs=1e-5)
            assert mapped[1] == pytest.approx(p[1], abs=1e-5)

    def test_recovers_pure_translation(self):
        src = np.array([[0, 0], [10, 0], [0, 10]], dtype=np.float64)
        dst = src + np.array([50, 20])
        t = compute_similarity_transform(src, dst)
        assert t.a == pytest.approx(1, abs=1e-5)
        assert t.b == pytest.approx(0, abs=1e-5)
        for s, d in zip(src, dst):
            mapped = apply_transform(t, s)
            assert mapped[0] == pytest.approx(d[0], abs=1e-5)
            assert mapped[1] == pytest.approx(d[1], abs=1e-5)

    def test_recovers_pure_uniform_scale(self):
        src = np.array([[0, 0], [10, 0], [0, 10]], dtype=np.float64)
        dst = src * 2
        t = compute_similarity_transform(src, dst)
        assert t.a == pytest.approx(2, abs=1e-5)
        assert t.b == pytest.approx(0, abs=1e-5)

    def test_recovers_90_degree_rotation(self):
        src = np.array([[1, 0], [0, 1], [-1, 0]], dtype=np.float64)
        dst = np.array([[-p[1], p[0]] for p in src], dtype=np.float64)
        t = compute_similarity_transform(src, dst)
        for s, d in zip(src, dst):
            mapped = apply_transform(t, s)
            assert mapped[0] == pytest.approx(d[0], abs=1e-5)
            assert mapped[1] == pytest.approx(d[1], abs=1e-5)

    def test_combined_scale_rotation_translation(self):
        angle = math.pi / 6
        scale = 1.7
        cos, sin = math.cos(angle), math.sin(angle)
        src = np.array([[1, 0], [0, 1], [2, 3], [-1, -2]], dtype=np.float64)
        dst = np.array(
            [[scale * (cos * p[0] - sin * p[1]) + 15, scale * (sin * p[0] + cos * p[1]) - 7] for p in src],
            dtype=np.float64,
        )
        t = compute_similarity_transform(src, dst)
        for s, d in zip(src, dst):
            mapped = apply_transform(t, s)
            assert mapped[0] == pytest.approx(d[0], abs=1e-4)
            assert mapped[1] == pytest.approx(d[1], abs=1e-4)

    def test_degenerate_zero_variance_source_falls_back_to_finite_translation(self):
        src = np.array([[5, 5], [5, 5], [5, 5]], dtype=np.float64)
        dst = np.array([[10, 10], [20, 20], [30, 30]], dtype=np.float64)
        t = compute_similarity_transform(src, dst)
        assert all(math.isfinite(v) for v in (t.a, t.b, t.tx, t.ty))

    def test_raises_on_mismatched_or_empty_point_sets(self):
        with pytest.raises(ValueError):
            compute_similarity_transform(np.empty((0, 2)), np.empty((0, 2)))
        with pytest.raises(ValueError):
            compute_similarity_transform(np.array([[0, 0]]), np.empty((0, 2)))


class TestExpandBox:
    def test_stays_within_a_modest_fraction_of_the_raw_box(self):
        padded = expand_box(100, 100, 200, 240)
        assert padded.width < 200 * 1.2
        assert padded.height < 240 * 1.25

    def test_symmetric_left_right_asymmetric_top_bottom(self):
        raw = Box(100, 100, 200, 200)
        padded = expand_box(raw.x, raw.y, raw.width, raw.height)
        left_growth = raw.x - padded.x
        right_growth = (padded.x + padded.width) - (raw.x + raw.width)
        top_growth = raw.y - padded.y
        bottom_growth = (padded.y + padded.height) - (raw.y + raw.height)
        assert left_growth == pytest.approx(right_growth, abs=1e-5)
        assert top_growth > bottom_growth


class TestNonMaximumSuppression:
    def _face(self, box, confidence):
        landmarks = Landmarks((0, 0), (0, 0), (0, 0), (0, 0), (0, 0))
        return Face(box=Box(*box), confidence=confidence, landmarks=landmarks)

    def test_keeps_the_most_confident_overlapping_face(self):
        faces = non_maximum_suppression(
            [self._face((10, 10, 100, 100), 0.91), self._face((12, 12, 100, 100), 0.82)]
        )
        assert len(faces) == 1
        assert faces[0].confidence == 0.91


class TestCosineSimilarity:
    def test_identical_vectors_score_one(self):
        v = np.array([1.0, 2.0, 3.0])
        assert cosine_similarity(v, v) == pytest.approx(1.0, abs=1e-6)

    def test_orthogonal_vectors_score_zero(self):
        assert cosine_similarity(np.array([1.0, 0.0]), np.array([0.0, 1.0])) == pytest.approx(0.0, abs=1e-6)

    def test_zero_vector_is_handled_without_dividing_by_zero(self):
        assert cosine_similarity(np.zeros(3), np.array([1.0, 2.0, 3.0])) == 0.0


class TestLargestFace:
    def test_returns_none_for_empty_list(self):
        assert largest_face([]) is None

    def test_picks_the_largest_by_area(self):
        landmarks = Landmarks((0, 0), (0, 0), (0, 0), (0, 0), (0, 0))
        small = Face(Box(0, 0, 10, 10), 0.9, landmarks)
        large = Face(Box(0, 0, 50, 50), 0.6, landmarks)
        assert largest_face([small, large]) is large
