"""Finding and opening the cameras the game will use.

Counting cameras on a Mac is not as simple as counting the ones plugged in.
macOS also registers virtual cameras that stay installed after whatever fed them
is unplugged, and Continuity cameras for phones that are merely nearby. All of
them answer when opened; only some of them are showing anything.
"""

from __future__ import annotations

import contextlib
import json
import os
import subprocess
import sys
import time
from dataclasses import dataclass

import cv2
import numpy as np


class CameraError(RuntimeError):
    """Raised when a camera cannot be opened or read."""


@dataclass(frozen=True)
class Device:
    """A camera index, and what is known about it."""

    index: int
    name: str = ""
    width: int = 0
    height: int = 0
    live: bool | None = None  # None when it was found but never opened

    @property
    def label(self) -> str:
        return self.name or f"camera {self.index}"

    def __str__(self) -> str:
        size = f"{self.width}x{self.height}" if self.width else "not opened"
        if self.live is None:
            state = size
        else:
            state = f"{size}, {'live' if self.live else 'frozen picture'}"
        return f"{self.index}: {self.label}  ({state})"


@contextlib.contextmanager
def _quiet():
    """Silence OpenCV's chatter about the indices that are not there."""
    previous = os.environ.get("OPENCV_LOG_LEVEL")
    os.environ["OPENCV_LOG_LEVEL"] = "FATAL"
    try:
        yield
    finally:
        if previous is None:
            os.environ.pop("OPENCV_LOG_LEVEL", None)
        else:
            os.environ["OPENCV_LOG_LEVEL"] = previous


def system_camera_names() -> list[str]:
    """Camera names as macOS lists them, in the order OpenCV indexes them.

    Worth having because the indices alone are misleading: the built-in camera
    is very often not index 0.
    """
    if sys.platform != "darwin":
        return []
    try:
        finished = subprocess.run(
            ["system_profiler", "SPCameraDataType", "-json"],
            capture_output=True, text=True, timeout=15, check=False)
    except (OSError, subprocess.SubprocessError):
        return []
    if finished.returncode != 0:
        return []
    try:
        entries = json.loads(finished.stdout).get("SPCameraDataType", [])
        return [str(entry.get("_name", "")).strip() for entry in entries]
    except (ValueError, AttributeError, TypeError):
        return []


def is_live(capture, samples: int = 5, gap: float = 0.05) -> bool:
    """True when the picture actually changes from frame to frame.

    A virtual camera with nothing plugged into it, or one showing a "connect
    your device" card, hands out the same bytes for ever. A real sensor never
    does: pointed at a blank wall it still has noise. This is the difference
    between a camera that exists and a camera that is working.
    """
    first = None
    for index in range(samples):
        ok, frame = capture.read()
        if not ok or frame is None:
            return False
        if first is None:
            first = frame
        elif not np.array_equal(first, frame):
            return True
        if index < samples - 1:
            time.sleep(gap)
    return False


def _inspect(index: int, name: str, check_live: bool) -> Device | None:
    capture = cv2.VideoCapture(index)
    try:
        if not capture.isOpened():
            return None
        ok, frame = capture.read()
        if not ok or frame is None:
            return None
        live = is_live(capture) if check_live else None
        return Device(index=index, name=name, width=frame.shape[1],
                      height=frame.shape[0], live=live)
    finally:
        capture.release()


def probe(limit: int = 4, check_live: bool = True) -> list[Device]:
    """Every camera index that opens and hands over a frame."""
    names = system_camera_names()
    found = []
    with _quiet():
        for index in range(max(limit, len(names))):
            device = _inspect(index, names[index] if index < len(names) else "",
                              check_live)
            if device is not None:
                found.append(device)
    return found


def first_live(limit: int = 4) -> Device | None:
    """The first camera that is actually showing something.

    Stops as soon as it finds one, so the cameras further down the list are
    never opened - which matters, because opening a Continuity camera wakes the
    phone it belongs to.
    """
    names = system_camera_names()
    with _quiet():
        for index in range(max(limit, len(names))):
            device = _inspect(index, names[index] if index < len(names) else "",
                              check_live=True)
            if device is not None and device.live:
                return device
    return None


def open_camera(index: int, width: int, height: int) -> cv2.VideoCapture:
    capture = cv2.VideoCapture(index)
    if not capture.isOpened():
        raise CameraError(
            f"Could not open camera {index}. On macOS, grant camera access to your "
            "terminal in System Settings > Privacy & Security > Camera, then restart "
            "the terminal. Run with --list-cameras to see what is available."
        )
    capture.set(cv2.CAP_PROP_FRAME_WIDTH, width)
    capture.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
    return capture
