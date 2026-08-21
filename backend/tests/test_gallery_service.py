import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models.gallery import FaceGalleryEntry, GalleryFaceSample  # noqa: F401
from app.services import gallery_service


@pytest.fixture()
def db():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    try:
        yield session
    finally:
        session.close()


def _embedding(seed: float) -> list:
    # 128-dim vector, deterministic per seed, easy to reason about in tests.
    return [seed] * 128


def test_enroll_creates_a_new_gallery_entry(db):
    entry = gallery_service.enroll_face(db, "Alice", _embedding(1.0), "sface-2021dec", "session-1")
    assert entry.id is not None
    assert entry.name == "Alice"
    assert len(entry.samples) == 1


def test_enrolling_same_name_twice_adds_a_sample_not_a_duplicate_entry(db):
    gallery_service.enroll_face(db, "Alice", _embedding(1.0), "sface-2021dec", "session-1")
    entry = gallery_service.enroll_face(db, "Alice", _embedding(1.1), "sface-2021dec", "session-1")
    items, total = gallery_service.list_gallery(db, user_session_id="session-1")
    assert total == 1
    assert len(items[0].samples) == 2


def test_different_sessions_do_not_share_enrollment(db):
    gallery_service.enroll_face(db, "Alice", _embedding(1.0), "sface-2021dec", "session-1")
    gallery_service.enroll_face(db, "Alice", _embedding(1.0), "sface-2021dec", "session-2")
    items, total = gallery_service.list_gallery(db, user_session_id="session-1")
    assert total == 1


def test_list_gallery_without_session_filter_returns_everyone(db):
    gallery_service.enroll_face(db, "Alice", _embedding(1.0), "v1", "session-1")
    gallery_service.enroll_face(db, "Bob", _embedding(2.0), "v1", "session-2")
    items, total = gallery_service.list_gallery(db)
    assert total == 2


def test_enroll_stores_the_reference_image(db):
    entry = gallery_service.enroll_face(db, "Alice", _embedding(1.0), "v1", "session-1", image="data:image/jpeg;base64,AAA")
    assert entry.image_data == "data:image/jpeg;base64,AAA"


def test_enroll_without_an_image_leaves_it_unset(db):
    entry = gallery_service.enroll_face(db, "Alice", _embedding(1.0), "v1", "session-1")
    assert entry.image_data is None


def test_enrolling_another_sample_with_a_new_image_replaces_the_old_one(db):
    gallery_service.enroll_face(db, "Alice", _embedding(1.0), "v1", "session-1", image="data:image/jpeg;base64,OLD")
    entry = gallery_service.enroll_face(db, "Alice", _embedding(1.1), "v1", "session-1", image="data:image/jpeg;base64,NEW")
    assert entry.image_data == "data:image/jpeg;base64,NEW"


def test_enrolling_another_sample_without_an_image_keeps_the_existing_one(db):
    gallery_service.enroll_face(db, "Alice", _embedding(1.0), "v1", "session-1", image="data:image/jpeg;base64,OLD")
    entry = gallery_service.enroll_face(db, "Alice", _embedding(1.1), "v1", "session-1")
    assert entry.image_data == "data:image/jpeg;base64,OLD"


def test_rename_gallery_entry_updates_the_name(db):
    entry = gallery_service.enroll_face(db, "Alice", _embedding(1.0), "v1", "session-1")
    renamed = gallery_service.rename_gallery_entry(db, entry.id, "Alicia", "session-1")
    assert renamed is not None
    assert renamed.name == "Alicia"


def test_rename_gallery_entry_scoped_to_wrong_session_fails(db):
    entry = gallery_service.enroll_face(db, "Alice", _embedding(1.0), "v1", "session-1")
    assert gallery_service.rename_gallery_entry(db, entry.id, "Alicia", "session-2") is None


def test_rename_nonexistent_entry_returns_none(db):
    assert gallery_service.rename_gallery_entry(db, 999999, "Anyone", None) is None


def test_delete_gallery_entry_removes_it_and_its_samples(db):
    entry = gallery_service.enroll_face(db, "Alice", _embedding(1.0), "v1", "session-1")
    assert gallery_service.delete_gallery_entry(db, entry.id, "session-1") is True
    items, total = gallery_service.list_gallery(db, user_session_id="session-1")
    assert total == 0


def test_delete_gallery_entry_scoped_to_wrong_session_fails(db):
    entry = gallery_service.enroll_face(db, "Alice", _embedding(1.0), "v1", "session-1")
    assert gallery_service.delete_gallery_entry(db, entry.id, "session-2") is False


def test_delete_nonexistent_entry_returns_false(db):
    assert gallery_service.delete_gallery_entry(db, 999999, None) is False


def test_recognize_matches_an_identical_enrolled_embedding(db):
    gallery_service.enroll_face(db, "Alice", _embedding(1.0), "v1", "session-1")
    result = gallery_service.recognize_face(db, _embedding(1.0), "session-1", threshold=0.363)
    assert result.matched is True
    assert result.name == "Alice"
    assert result.similarity == pytest.approx(1.0)


def test_recognize_returns_no_match_when_gallery_is_empty(db):
    result = gallery_service.recognize_face(db, _embedding(1.0), "session-1", threshold=0.363)
    assert result.matched is False
    assert result.name is None


def test_recognize_returns_no_match_below_threshold(db):
    gallery_service.enroll_face(db, "Alice", _embedding(1.0), "v1", "session-1")
    # An orthogonal-ish embedding (very different vector) should score low.
    dissimilar = [1.0] + [-1.0] * 127
    result = gallery_service.recognize_face(db, dissimilar, "session-1", threshold=0.363)
    assert result.matched is False


def test_recognize_picks_the_best_match_among_multiple_identities(db):
    gallery_service.enroll_face(db, "Alice", _embedding(1.0), "v1", "session-1")
    gallery_service.enroll_face(db, "Bob", _embedding(-1.0), "v1", "session-1")
    result = gallery_service.recognize_face(db, _embedding(1.0), "session-1", threshold=0.363)
    assert result.matched is True
    assert result.name == "Alice"


def test_recognize_scoped_to_session_ignores_other_sessions_enrollments(db):
    gallery_service.enroll_face(db, "Alice", _embedding(1.0), "v1", "session-1")
    result = gallery_service.recognize_face(db, _embedding(1.0), "session-2", threshold=0.363)
    assert result.matched is False


def test_claim_anonymous_entries_moves_them_to_the_new_scope(db):
    gallery_service.enroll_face(db, "Alice", _embedding(1.0), "v1", "anon-session-1")
    claimed = gallery_service.claim_anonymous_entries(db, "anon-session-1", "user:abc")
    assert claimed == 1
    items, total = gallery_service.list_gallery(db, user_session_id="user:abc")
    assert total == 1
    assert items[0].name == "Alice"


def test_claim_anonymous_entries_with_no_anonymous_id_is_a_noop(db):
    assert gallery_service.claim_anonymous_entries(db, None, "user:abc") == 0


def test_claiming_twice_is_idempotent(db):
    gallery_service.enroll_face(db, "Alice", _embedding(1.0), "v1", "anon-session-1")
    first = gallery_service.claim_anonymous_entries(db, "anon-session-1", "user:abc")
    second = gallery_service.claim_anonymous_entries(db, "anon-session-1", "user:abc")
    assert first == 1
    assert second == 0
