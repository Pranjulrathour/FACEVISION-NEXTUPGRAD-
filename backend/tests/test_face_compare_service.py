from app.services.face_compare_service import compare_faces


def _face(cx: float = 0.5):
    box = {"x": 0, "y": 0, "width": 100, "height": 100}
    landmarks = {
        "rightEye": {"x": 30, "y": 30},
        "leftEye": {"x": 70, "y": 30},
        "nose": {"x": cx * 100, "y": 50},
        "rightMouth": {"x": 35, "y": 70},
        "leftMouth": {"x": 65, "y": 70},
    }
    return {"box": box, "landmarks": landmarks}


def test_identical_faces_match():
    face = _face()
    result = compare_faces(face, face)
    assert result["similarity"] == 1.0
    assert result["isMatch"] is True


def test_missing_landmarks_returns_no_match():
    face_a = _face()
    face_b = {"box": {"x": 0, "y": 0, "width": 100, "height": 100}, "landmarks": {}}
    result = compare_faces(face_a, face_b)
    assert result["similarity"] == 0.0
    assert result["isMatch"] is False


def test_zero_size_box_returns_no_match_instead_of_dividing_by_zero():
    face_a = _face()
    face_b = {"box": {"x": 0, "y": 0, "width": 0, "height": 0}, "landmarks": face_a["landmarks"]}
    result = compare_faces(face_a, face_b)
    assert result["similarity"] == 0.0
    assert result["isMatch"] is False
