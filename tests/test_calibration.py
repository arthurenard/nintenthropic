import json

import cv2
import numpy as np
import pytest

from handy.calibration import Calibration, Rig, RigBook, default_calibration
from handy.schemes import PISTOL

DEFAULT = default_calibration(PISTOL)

# A camera off to the side of the screen: the hand plane arrives rotated,
# sheared and foreshortened, as an older setup could save it.
OFF_AXIS = tuple(float(value) for value in cv2.getPerspectiveTransform(
    np.float32([(0.30, 0.42), (0.62, 0.36), (0.68, 0.66), (0.34, 0.72)]),
    np.float32([(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)])).reshape(9))

#: What a successful setup hands back for that camera.
FITTED = Calibration(mapping=OFF_AXIS, fit_error=0.011, aim_fitted=True, gain=2.4)


def round_trip(rig: Rig, path) -> Rig | None:
    book = RigBook()
    book.set("pistol", rig)
    book.save(path)
    return RigBook.load(path).get("pistol")


def load_legacy(path, payload) -> Rig | None:
    """A file from before the book held one rig per scheme: a bare rig."""
    path.write_text(json.dumps(payload))
    return RigBook.load(path).get("pistol")


# --- the calibration record ------------------------------------------------

def test_a_degenerate_record_is_refused():
    with pytest.raises(ValueError):
        Calibration(mapping=(1.0, 0.0, 0.0))


def test_a_rig_survives_a_round_trip_through_disk(tmp_path):
    original = Rig((FITTED, Calibration(gain=3.2, generalisation=0.02)))
    assert round_trip(original, tmp_path / "calibration.json") == original


def test_whether_the_aim_was_really_fitted_survives_the_round_trip(tmp_path):
    loaded = round_trip(Rig((FITTED, DEFAULT)), tmp_path / "calibration.json")

    assert loaded[0].aim_fitted
    assert not loaded[1].aim_fitted, "the defaults were never fitted to anyone"


def test_a_file_from_before_the_flag_existed_is_read_by_its_error_figures(tmp_path):
    """The only trace a real fit left in an older save is a non-zero error."""
    common = {"mapping": [1, 0, 0, 0, 1, 0, 0, 0, 1], "signal": "angle",
              "cocked": 20.0, "folded": 70.0}
    rig = load_legacy(tmp_path / "old.json", {"cameras": [
        {**common, "fit_error": 0.01, "generalisation": 0.02},
        {**common, "fit_error": 0.0, "generalisation": 0.0},
    ]})

    assert rig[0].aim_fitted
    assert not rig[1].aim_fitted


def test_a_file_from_the_pose_by_pose_setup_still_loads(tmp_path):
    """Saves from the old guided setup carry a pointer tuning, the two trigger
    poses, the landmark jitter and the depth slide it measured; nothing reads
    any of them now."""
    rig = load_legacy(tmp_path / "old.json", {"cameras": [{
        "mapping": [1, 0, 0, 0, 1, 0, 0, 0, 1], "signal": "angle",
        "cocked": 20.0, "folded": 70.0, "tuning": [0.2, 0.45],
        "trigger_fitted": True, "jitter": 0.003, "slide": [0.04, -0.02],
        "fit_error": 0.01, "aim_fitted": True, "gain": 2.5}]})
    assert rig is not None and rig[0].aim_fitted and rig[0].gain == 2.5


def test_a_file_from_before_the_map_was_projective_still_loads(tmp_path):
    """Old saves stored a plain box. Read it rather than throwing it away."""
    rig = load_legacy(tmp_path / "old.json",
                      {"aim_min": [0.2, 0.3], "aim_max": [0.8, 0.7],
                       "signal": "angle", "cocked": 17.0, "folded": 68.0})
    assert rig is not None and len(rig) == 1
    loaded = rig[0]

    assert loaded.project((0.2, 0.3)) == pytest.approx((0.0, 0.0))
    assert loaded.project((0.8, 0.7)) == pytest.approx((1.0, 1.0))


def test_a_missing_or_broken_file_reads_as_nothing(tmp_path):
    assert RigBook.load(tmp_path / "absent.json").get("pistol") is None
    broken = tmp_path / "broken.json"
    broken.write_text("{not json")
    assert RigBook.load(broken).get("pistol") is None
    assert load_legacy(tmp_path / "incomplete.json",
                       {"signal": "angle", "fit_error": 0.01}) is None


def test_a_rig_is_trimmed_or_padded_to_the_cameras_actually_plugged_in():
    rig = Rig((FITTED, FITTED))
    assert len(rig.resized(1)) == 1
    assert len(rig.resized(3)) == 3
    assert rig.resized(3)[2] == Calibration(), "the new one starts on defaults"


def test_a_calibration_that_cannot_be_written_does_not_lose_the_session(tmp_path,
                                                                       capsys):
    """RigBook.load forgives an unreadable file; save used to throw.

    It is called immediately after a successful setup, so an unwritable path
    turned the one moment the player has just got right into a traceback.
    """
    blocked = tmp_path / "a-file"
    blocked.write_text("not a directory")

    book = RigBook()
    book.set("pistol", Rig((Calibration(),)))
    assert book.save(blocked / "calibration.json") is False
    assert "Could not save the calibration" in capsys.readouterr().out
    assert book.get("pistol") is not None, "this session is still calibrated"


def test_a_calibration_that_can_be_written_says_so(tmp_path):
    path = tmp_path / "deep" / "calibration.json"
    book = RigBook()
    book.set("pistol", Rig((Calibration(gain=1.5),)))
    assert book.save(path) is True
    assert RigBook.load(path).get("pistol").cameras[0].gain == 1.5


def test_a_book_that_still_holds_an_eye_rig_loads_the_hand_rig(tmp_path):
    """Saves from when there was an eye scheme hold a second entry beside it."""
    path = tmp_path / "calibration.json"
    book = RigBook()
    book.set("pistol", Rig((FITTED,)))
    book.set("gaze", Rig((Calibration(),)))
    book.save(path)
    assert RigBook.load(path).get("pistol") == Rig((FITTED,))
