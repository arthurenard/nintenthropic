import json

import pytest

from handy import homography
from handy.calibration import Calibration, Rig, default_calibration
from handy.schemes import PISTOL

DEFAULT = default_calibration(PISTOL)

# A camera off to the side of the screen: the hand plane arrives rotated,
# sheared and foreshortened. This is the case a two-point box cannot express.
OFF_AXIS = homography.fit(
    [(0.30, 0.42), (0.62, 0.36), (0.68, 0.66), (0.34, 0.72)],
    [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)])

#: What a successful setup hands back for that camera.
FITTED = Calibration(mapping=OFF_AXIS, fit_error=0.011, aim_fitted=True, gain=2.4)


# --- the calibration record ------------------------------------------------

def test_a_degenerate_record_is_refused():
    with pytest.raises(ValueError):
        Calibration(mapping=(1.0, 0.0, 0.0))


def test_a_rig_survives_a_round_trip_through_disk(tmp_path):
    original = Rig((FITTED, Calibration(gain=3.2, generalisation=0.02)))
    path = tmp_path / "calibration.json"
    original.save(path)
    assert Rig.load(path) == original


def test_whether_the_aim_was_really_fitted_survives_the_round_trip(tmp_path):
    path = tmp_path / "calibration.json"
    Rig((FITTED, DEFAULT)).save(path)
    loaded = Rig.load(path)

    assert loaded[0].aim_fitted
    assert not loaded[1].aim_fitted, "the defaults were never fitted to anyone"


def test_a_file_from_before_the_flag_existed_is_read_by_its_error_figures(tmp_path):
    """The only trace a real fit left in an older save is a non-zero error."""
    path = tmp_path / "old.json"
    common = {"mapping": [1, 0, 0, 0, 1, 0, 0, 0, 1], "signal": "angle",
              "cocked": 20.0, "folded": 70.0}
    path.write_text(json.dumps({"cameras": [
        {**common, "fit_error": 0.01, "generalisation": 0.02},
        {**common, "fit_error": 0.0, "generalisation": 0.0},
    ]}))
    rig = Rig.load(path)

    assert rig[0].aim_fitted
    assert not rig[1].aim_fitted


def test_a_file_from_the_pose_by_pose_setup_still_loads(tmp_path):
    """Saves from the old guided setup carry a pointer tuning, the two trigger
    poses, the landmark jitter and the depth slide it measured; nothing reads
    any of them now."""
    path = tmp_path / "old.json"
    path.write_text(json.dumps({"cameras": [{
        "mapping": [1, 0, 0, 0, 1, 0, 0, 0, 1], "signal": "angle",
        "cocked": 20.0, "folded": 70.0, "tuning": [0.2, 0.45],
        "trigger_fitted": True, "jitter": 0.003, "slide": [0.04, -0.02],
        "fit_error": 0.01, "aim_fitted": True, "gain": 2.5}]}))
    rig = Rig.load(path)
    assert rig is not None and rig[0].aim_fitted and rig[0].gain == 2.5


def test_a_file_from_before_the_map_was_projective_still_loads(tmp_path):
    """Old saves stored a plain box. Read it rather than throwing it away."""
    path = tmp_path / "old.json"
    path.write_text(json.dumps({"aim_min": [0.2, 0.3], "aim_max": [0.8, 0.7],
                                               "signal": "angle", "cocked": 17.0, "folded": 68.0}))
    rig = Rig.load(path)
    assert rig is not None and len(rig) == 1
    loaded = rig[0]

    assert loaded.project((0.2, 0.3)) == pytest.approx((0.0, 0.0))
    assert loaded.project((0.8, 0.7)) == pytest.approx((1.0, 1.0))


def test_a_missing_or_broken_file_reads_as_nothing(tmp_path):
    assert Rig.load(tmp_path / "absent.json") is None
    broken = tmp_path / "broken.json"
    broken.write_text("{not json")
    assert Rig.load(broken) is None
    incomplete = tmp_path / "incomplete.json"
    incomplete.write_text(json.dumps({"signal": "angle", "fit_error": 0.01}))
    assert Rig.load(incomplete) is None


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
    from handy.calibration import RigBook

    blocked = tmp_path / "a-file"
    blocked.write_text("not a directory")

    book = RigBook()
    book.set("pistol", Rig((Calibration(),)))
    assert book.save(blocked / "calibration.json") is False
    assert "Could not save the calibration" in capsys.readouterr().out
    assert book.get("pistol") is not None, "this session is still calibrated"


def test_a_calibration_that_can_be_written_says_so(tmp_path):
    from handy.calibration import RigBook

    path = tmp_path / "deep" / "calibration.json"
    book = RigBook()
    book.set("pistol", Rig((Calibration(gain=1.5),)))
    assert book.save(path) is True
    assert RigBook.load(path).get("pistol").cameras[0].gain == 1.5


def test_a_book_that_still_holds_an_eye_rig_loads_the_hand_rig(tmp_path):
    """Saves from when there was an eye scheme hold a second entry beside it."""
    from handy.calibration import RigBook

    path = tmp_path / "calibration.json"
    book = RigBook()
    book.set("pistol", Rig((FITTED,)))
    book.set("gaze", Rig((Calibration(),)))
    book.save(path)
    assert RigBook.load(path).get("pistol") == Rig((FITTED,))
