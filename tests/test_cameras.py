"""Telling a working camera from one that merely answers."""

import json
import subprocess

import numpy as np
import pytest

from handy import cameras
from handy.cameras import Device, first_live, is_live, probe, system_camera_names


class FakeCapture:
    """A camera that hands out the frames it was given."""

    def __init__(self, frames, opened=True):
        self.frames = list(frames)
        self.opened = opened
        self.released = False

    def isOpened(self):  # noqa: N802 - OpenCV's own spelling
        return self.opened

    def read(self):
        if not self.frames:
            return False, None
        frame = self.frames[0] if len(self.frames) == 1 else self.frames.pop(0)
        return True, frame

    def set(self, *_args):
        pass

    def release(self):
        self.released = True


def still(value=40):
    return np.full((720, 1280, 3), value, np.uint8)


def noisy(seed=0):
    rng = np.random.default_rng(seed)
    return [rng.integers(0, 255, (16, 16, 3), dtype=np.uint8) for _ in range(6)]


# --- is it actually showing anything? --------------------------------------

def test_a_frozen_placeholder_is_not_a_live_camera():
    """A virtual camera with nothing plugged in repeats one frame for ever."""
    assert not is_live(FakeCapture([still()]), gap=0.0)


def test_a_real_sensor_is_never_perfectly_still():
    assert is_live(FakeCapture(noisy()), gap=0.0)


def test_one_changed_pixel_is_enough():
    first, second = still(), still()
    second[0, 0, 0] = 41
    assert is_live(FakeCapture([first, second, second, second, second]), gap=0.0)


def test_a_camera_that_stops_delivering_is_not_live():
    assert not is_live(FakeCapture([]), gap=0.0)


# --- naming them -----------------------------------------------------------

def test_macos_camera_names_are_read_in_index_order(monkeypatch):
    payload = json.dumps({"SPCameraDataType": [
        {"_name": "Camo Camera"}, {"_name": "MacBook Pro Camera"},
        {"_name": "iPhone Camera"}]})
    monkeypatch.setattr(cameras.sys, "platform", "darwin")
    monkeypatch.setattr(subprocess, "run", lambda *a, **k: subprocess.CompletedProcess(
        a, 0, stdout=payload, stderr=""))

    assert system_camera_names() == ["Camo Camera", "MacBook Pro Camera",
                                     "iPhone Camera"]


def test_a_machine_that_cannot_be_asked_simply_has_no_names(monkeypatch):
    monkeypatch.setattr(cameras.sys, "platform", "linux")
    assert system_camera_names() == []

    monkeypatch.setattr(cameras.sys, "platform", "darwin")
    monkeypatch.setattr(subprocess, "run", lambda *a, **k: (_ for _ in ()).throw(
        OSError("no such tool")))
    assert system_camera_names() == []


def test_nonsense_from_the_system_is_ignored(monkeypatch):
    monkeypatch.setattr(cameras.sys, "platform", "darwin")
    monkeypatch.setattr(subprocess, "run", lambda *a, **k: subprocess.CompletedProcess(
        a, 0, stdout="not json at all", stderr=""))
    assert system_camera_names() == []


# --- choosing between them -------------------------------------------------

@pytest.fixture
def desk(monkeypatch):
    """A Mac with a dead virtual camera at index 0 and the real one at index 1."""
    opened = []

    def capture_for(index):
        opened.append(index)
        if index == 0:
            return FakeCapture([still()])            # Camo, nothing plugged in
        if index == 1:
            return FakeCapture(noisy(index))         # the built-in camera
        if index == 2:
            return FakeCapture(noisy(index))         # a phone, nearby
        return FakeCapture([], opened=False)

    monkeypatch.setattr(cameras.cv2, "VideoCapture", capture_for)
    monkeypatch.setattr(cameras, "system_camera_names",
                        lambda: ["Camo Camera", "MacBook Pro Camera", "iPhone Camera"])
    monkeypatch.setattr(cameras.time, "sleep", lambda _seconds: None)
    return opened


def test_the_search_skips_the_camera_that_is_not_showing_anything(desk):
    found = first_live()
    assert found is not None
    assert found.index == 1 and found.name == "MacBook Pro Camera"


def test_the_search_stops_before_waking_the_phone(desk):
    first_live()
    assert 2 not in desk, "a Continuity camera must not be opened needlessly"


def test_listing_them_reports_every_one_with_its_name_and_state(desk):
    found = probe()
    by_index = {device.index: device for device in found}

    assert by_index[0].name == "Camo Camera" and by_index[0].live is False
    assert by_index[1].name == "MacBook Pro Camera" and by_index[1].live is True
    assert "frozen picture" in str(by_index[0])
    assert "live" in str(by_index[1])


def test_a_camera_with_no_name_still_describes_itself():
    assert "camera 3" in str(Device(index=3, width=640, height=480))


def test_a_desk_with_nothing_working_finds_nothing(monkeypatch):
    monkeypatch.setattr(cameras.cv2, "VideoCapture",
                        lambda index: FakeCapture([still()]))
    monkeypatch.setattr(cameras, "system_camera_names", lambda: ["Camo Camera"])
    monkeypatch.setattr(cameras.time, "sleep", lambda _seconds: None)

    assert first_live() is None
    assert all(device.live is False for device in probe())


# --- keeping OpenCV quiet while it is asked about indices that are not there -

def test_opencv_is_really_silenced_while_the_cameras_are_counted(monkeypatch):
    """The quiet used to set OPENCV_LOG_LEVEL, which OpenCV reads once, when it
    starts - long before the search - so every missing index still printed."""
    logging = cameras.cv2.utils.logging
    levels = []

    def capture_for(index):
        levels.append(logging.getLogLevel())
        return FakeCapture([], opened=False)

    monkeypatch.setattr(cameras.cv2, "VideoCapture", capture_for)
    monkeypatch.setattr(cameras, "system_camera_names", lambda: [])
    before = logging.getLogLevel()

    assert probe() == [] and first_live() is None
    assert levels and set(levels) == {logging.LOG_LEVEL_SILENT}
    assert logging.getLogLevel() == before, "and the level is put back after"


def test_the_log_level_comes_back_even_when_the_search_fails():
    logging = cameras.cv2.utils.logging
    before = logging.getLogLevel()
    with pytest.raises(RuntimeError), cameras._quiet():
        raise RuntimeError("a backend blew up")
    assert logging.getLogLevel() == before
