import json

import cv2
import numpy as np
import pytest

from handy.calibration import (Calibration, Rig, RigBook, Setup,
                               default_calibration)
from handy.schemes import PISTOL

DEFAULT = default_calibration(PISTOL)
IDENTITY = (1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0)

# A camera off to the side of the screen: the hand plane arrives rotated,
# sheared and foreshortened, as an older setup could save it.
OFF_AXIS = tuple(float(value) for value in cv2.getPerspectiveTransform(
    np.float32([(0.30, 0.42), (0.62, 0.36), (0.68, 0.66), (0.34, 0.72)]),
    np.float32([(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)])).reshape(9))

#: What a successful setup hands back for that camera.
SIDE_ON = Calibration(mapping=OFF_AXIS, fit_error=0.011, aim_fitted=True, gain=2.4)


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


@pytest.mark.parametrize("field, value", [
    ("mapping", (float("nan"), 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0)),
    ("mapping", (1e309, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0)),
    ("fit_error", float("inf")),
    ("generalisation", float("nan")),
    ("gain", float("nan")),
    ("gain", -1.0),
])
def test_a_calibration_holds_finite_numbers_only(field, value):
    """Python's json reads and writes NaN and Infinity without a murmur. One
    NaN in a map is a NaN crosshair - the filter carries it for the rest of the
    session and the game loop's round() raises on it."""
    with pytest.raises(ValueError):
        Calibration(**{field: value})


def test_an_infinite_gain_is_how_a_camera_sits_the_game_out(tmp_path):
    """The one non-finite number with a meaning. It is written as null, so the
    file stays strict JSON that anything can read."""
    idle = Calibration(gain=float("inf"))
    assert not idle.usable
    path = tmp_path / "calibration.json"
    loaded = round_trip(Rig((Calibration(gain=2.0), idle)), path)

    def refuse(name):
        raise AssertionError(f"{name} written to disk")

    raw = json.loads(path.read_text(), parse_constant=refuse)
    assert raw["schemes"]["pistol"]["cameras"][1]["gain"] is None
    assert loaded[1] == idle


def test_a_file_with_nan_or_infinity_in_it_is_refused(tmp_path):
    entry = {**DEFAULT.to_dict(), "aim_fitted": True}
    entry["mapping"] = [float("nan")] + entry["mapping"][1:]
    path = tmp_path / "calibration.json"
    assert load_legacy(path, {"cameras": [entry]}) is None
    assert "NaN" in path.read_text(), "which the json module happily wrote"


def test_a_saved_setup_without_the_trigger_poses_still_loads():
    """The built-in thumb trigger ignores the calibrated poses, and a browser
    that stored only what it uses was refused on every start, for ever."""
    loaded = Calibration.from_dict({"mapping": [1, 0, 0, 0, 1, 0, 0, 0, 1],
                                    "aim_fitted": True})
    assert loaded.aim_fitted and loaded.mapping == IDENTITY


def test_a_rig_survives_a_round_trip_through_disk(tmp_path):
    original = Rig((SIDE_ON, Calibration(gain=3.2, generalisation=0.02)))
    assert round_trip(original, tmp_path / "calibration.json") == original


def test_whether_the_aim_was_really_fitted_survives_the_round_trip(tmp_path):
    loaded = round_trip(Rig((SIDE_ON, DEFAULT)), tmp_path / "calibration.json")

    assert loaded[0].aim_fitted
    assert not loaded[1].aim_fitted, "the defaults were never fitted to anyone"


def test_a_file_from_before_the_flag_existed_cannot_vouch_for_its_fit(tmp_path):
    """Its error figures used to be read as proof of a fit. A non-zero figure
    says something was fitted, not that it was any good: the old pose fitter
    left a real player a map whose horizon crossed the camera frame, and it
    was reused, unchecked, on every launch."""
    common = {"mapping": [1, 0, 0, 0, 1, 0, 0, 0, 1], "signal": "angle",
              "cocked": 20.0, "folded": 70.0}
    rig = load_legacy(tmp_path / "old.json", {"cameras": [
        {**common, "fit_error": 0.01, "generalisation": 0.02},
        {**common, "fit_error": 0.0, "generalisation": 0.0},
    ]})

    assert not rig[0].aim_fitted
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
    # The trigger poses are optional (the built-in thumb ignores them); the
    # map is the one thing a calibration cannot do without.
    assert load_legacy(tmp_path / "incomplete.json",
                       {"signal": "angle", "cocked": 20.0, "folded": 70.0}) is None


def test_a_rig_is_trimmed_or_padded_to_the_cameras_actually_plugged_in():
    rig = Rig((SIDE_ON, SIDE_ON))
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


# --- the book of every scheme's rig ------------------------------------------

def a_book_on_disk(path):
    book = RigBook()
    book.set("pistol", Rig((Calibration(gain=1.5, aim_fitted=True),)))
    book.set("gaze", Rig((Calibration(),)))
    book.save(path)
    return json.loads(path.read_text())


def test_a_book_that_still_holds_an_eye_rig_loads_the_hand_rig(tmp_path):
    """Saves from when there was an eye scheme hold a second entry beside it."""
    path = tmp_path / "calibration.json"
    a_book_on_disk(path)
    assert RigBook.load(path).get("pistol").cameras[0].gain == 1.5


@pytest.mark.parametrize("stale", [
    {"cameras": [{"mapping": [1, 0, 0, 0, 1, 0, 0, 0],
                  "signal": "wink", "cocked": 0.6, "folded": 0.6}]},
    {"cameras": []},
    None,
    "gaze",
    [1, 2, 3],
])
def test_one_unreadable_entry_does_not_take_the_others_down(tmp_path, stale):
    """Any entry that failed to read discarded the whole book - a stale gaze
    rig took the valid pistol rig with it - and the next save wrote that
    emptiness over everything."""
    path = tmp_path / "calibration.json"
    data = a_book_on_disk(path)
    data["schemes"]["gaze"] = stale
    data["schemes"]["marksman"] = stale
    path.write_text(json.dumps(data))

    book = RigBook.load(path)
    assert book.get("pistol").cameras[0].gain == 1.5
    assert book.get("gaze") is None and book.get("marksman") is None

    # And saving it back keeps what could be read.
    book.save(path)
    assert RigBook.load(path).get("pistol").cameras[0].gain == 1.5


def test_the_book_says_which_format_it_is(tmp_path):
    from handy.calibration import BOOK_VERSION

    assert a_book_on_disk(tmp_path / "calibration.json")["version"] == BOOK_VERSION


def test_a_save_replaces_the_book_whole_or_not_at_all(tmp_path, monkeypatch):
    """The book was written in place: truncated first, filled after. A crash
    or a full disk in between left half a file, which reads as an empty book,
    and the next save then made the loss permanent."""
    import os

    path = tmp_path / "calibration.json"
    a_book_on_disk(path)
    before = path.read_text()

    def disk_full(source, destination):
        raise OSError(28, "No space left on device")

    monkeypatch.setattr(os, "replace", disk_full)
    book = RigBook.load(path)
    book.set("pistol", Rig((Calibration(gain=2.5),)))
    assert book.save(path) is False
    assert path.read_text() == before, "the old book is untouched"
    assert list(tmp_path.iterdir()) == [path], "and nothing is left beside it"


# --- reusing a saved rig -----------------------------------------------------

HERE = Setup(mirror=True, camera_indices=(0,), capture=(1280, 720))
FITTED = Calibration(aim_fitted=True, fit_error=0.01, gain=2.0)

# What the old pose fitter saved on a real machine: fitted by its own account,
# with a horizon that crosses the camera frame at x = 0.82 on the top edge.
LEGACY_ENTRY = {
    "mapping": [2.871934573670249, -0.061145355513888985, -1.2142552975804075,
                -0.9041251222717106, 2.3601729633571686, -0.8949543501390803,
                -1.2131671258909114, 0.4386268157484197, 1.0],
    "signal": "reach", "cocked": 2.702939951868207, "folded": 2.1529399518682073,
    "tuning": [0.0, 0.0], "fit_error": 0.022942265668913647,
    "generalisation": 0.04382763316070792, "trigger_fitted": True,
    "jitter": 0.007017964000998796, "gain": 5.4213851778088005,
    "slide": [0.04323528411084698, -0.020166283693333564]}


def test_a_rig_remembers_the_setup_it_was_fitted_on(tmp_path):
    path = tmp_path / "calibration.json"
    book = RigBook()
    book.set("pistol", Rig((FITTED,), HERE))
    book.save(path)

    saved = json.loads(path.read_text())["schemes"]["pistol"]["setup"]
    assert saved == {"mirror": True, "camera_indices": [0], "capture": [1280, 720]}
    assert RigBook.load(path).get("pistol") == Rig((FITTED,), HERE)


def test_a_setup_record_says_exactly_what_it_means():
    good = {"mirror": True, "camera_indices": [0, 2], "capture": [640, 480]}
    assert Setup.from_dict(good) == Setup(True, (0, 2), (640, 480))
    for bad in ({**good, "mirror": "false"}, {**good, "camera_indices": [0.5]},
                {**good, "capture": [640]}, {**good, "capture": [640, "480"]}):
        with pytest.raises((ValueError, TypeError)):
            Setup.from_dict(bad)
    with pytest.raises(ValueError):
        Rig((FITTED,), Setup(True, (0, 1), (640, 480)))  # two indices, one camera


def test_a_rig_fitted_on_this_very_setup_is_reused():
    assert Rig((FITTED,), HERE).mismatch(HERE) is None


@pytest.mark.parametrize("elsewhere", [
    Setup(mirror=False, camera_indices=(0,), capture=(1280, 720)),
    Setup(mirror=True, camera_indices=(1,), capture=(1280, 720)),
    Setup(mirror=True, camera_indices=(0,), capture=(640, 480)),
])
def test_a_rig_is_not_reused_on_a_different_setup(elsewhere):
    """Mirroring sends x to 1 - x and the fitted map then aims every movement
    backwards; another camera is another placement; another capture size can
    crop the frame to another shape. Each leaves a saved map aiming
    confidently somewhere else, with nothing on screen to say why."""
    assert Rig((FITTED,), HERE).mismatch(elsewhere) is not None


def test_a_rig_that_never_said_what_it_was_fitted_on_is_not_reused():
    assert "cameras" in Rig((FITTED,)).mismatch(HERE)


def test_a_rig_for_another_number_of_cameras_is_not_reused():
    two = Setup(mirror=True, camera_indices=(0, 1), capture=(1280, 720))
    assert "2 camera" in Rig((FITTED, FITTED), two).mismatch(HERE)


def test_a_rig_nobody_was_fitted_to_is_not_reused():
    assert Rig((DEFAULT,), HERE).mismatch(HERE) is not None
    assert Rig((Calibration(aim_fitted=False, fit_error=0.02),), HERE).mismatch(HERE)


def test_a_camera_sitting_the_game_out_does_not_stop_the_rest_being_reused():
    """A camera placed too side-on is told to sit out with an infinite gain; it
    was never fitted, and has no say in whether the others can be trusted."""
    two = Setup(mirror=True, camera_indices=(0, 1), capture=(1280, 720))
    idle = Calibration(gain=float("inf"))
    assert Rig((FITTED, idle), two).mismatch(two) is None
    assert Rig((idle, idle), two).mismatch(two) is not None, "but someone must aim"


def test_a_map_whose_horizon_is_in_view_is_not_reused():
    """Even stamped and claiming a fit, a map that folds over inside the camera
    frame throws the crosshair to the opposite corner when the hand strays."""
    folded = Calibration.from_dict({**LEGACY_ENTRY, "aim_fitted": True})
    assert "horizon" in Rig((folded,), HERE).mismatch(HERE)


def test_the_legacy_save_from_a_real_machine_is_not_reused(tmp_path):
    """The file this whole change is about: no aim_fitted flag, no setup, and a
    horizon in view. Every one of those alone now sends the player to setup."""
    path = tmp_path / "calibration.json"
    path.write_text(json.dumps({"schemes": {
        "pistol": {"cameras": [LEGACY_ENTRY]},
        "marksman": {"cameras": [LEGACY_ENTRY]}}}))
    saved = RigBook.load(path).get("pistol")

    assert not saved.cameras[0].aim_fitted
    assert saved.mismatch(HERE) is not None
