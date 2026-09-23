"""What setup learned about each camera, and where it is kept.

The hand travels a different box in front of every camera, and every camera
sits somewhere different relative to the screen being aimed at. Setup
(:mod:`shot_calibration`) fits one map per camera from the shots the player
takes; this module holds those maps, the defaults the game plays on before
there are any, and the file they are saved to.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from . import fusion, homography
from .homography import Matrix, Point
from .storage import write_atomically

DEFAULT_MAPPING = homography.box_mapping((0.15, 0.15), (0.85, 0.85))

#: The calibration file's format, written into it so a later change can tell
#: what it is reading. Every file from before the field existed is version 1.
BOOK_VERSION = 2

#: The whole camera image, in the normalised coordinates a fingertip arrives
#: in. The hand can turn up anywhere the camera sees, so a map worth reusing
#: has an image everywhere in it.
CAMERA_FRAME: tuple[Point, Point] = ((0.0, 0.0), (1.0, 1.0))


@dataclass(frozen=True)
class Calibration:
    """One camera's hand-to-screen map, and what it knows about its own errors."""

    mapping: Matrix = DEFAULT_MAPPING
    fit_error: float = 0.0  # mean miss of the fit, as a fraction of the screen
    generalisation: float = 0.0  # mean held-out miss: the honest accuracy figure
    #: Did the aim map come from this player's own trace, or is it the fallback?
    #: The error figures cannot answer that: when the fallback is a previously
    #: successful calibration they are inherited from it, non-zero and flattering.
    aim_fitted: bool = False
    gain: float = 1.0  # how much this camera's map magnifies movement

    def __post_init__(self) -> None:
        if len(self.mapping) != 9:
            raise ValueError("a mapping is nine numbers, row-major")
        # Python's json reads and writes NaN and Infinity without a murmur, and
        # one NaN in a map is a NaN crosshair: the filter carries it for the
        # rest of the session and the game loop's round() raises on it. So
        # nothing non-finite gets in, whether from disk, a browser or a fit.
        numbers = (*self.mapping, self.fit_error, self.generalisation)
        if not all(_finite(value) for value in numbers):
            raise ValueError("a calibration holds finite numbers only")
        # Bar one: an infinite gain is how a camera is told to sit the game out.
        if not (_finite(self.gain) or self.gain == float("inf")) or self.gain < 0:
            raise ValueError("a gain is a magnification: zero or more")

    @property
    def usable(self) -> bool:
        """False for a camera placed where its map has to stretch beyond sense."""
        return self.gain <= fusion.GAIN_LIMIT

    def project(self, point: Point) -> Point | None:
        """Map a camera-space point onto the screen, without clamping.

        Fusion needs the raw answer: clamping each camera first would pull
        their estimates together at the edge and hide how far apart they are.
        None where the map has no answer at all - past its horizon, see
        ``apply``.
        """
        return homography.apply(self.mapping, point)

    def local_gain(self, point: Point) -> float:
        """How much this camera's map magnifies movement right here."""
        return homography.gain(self.mapping, point)

    def to_dict(self) -> dict:
        return {
            "mapping": list(self.mapping),
            "fit_error": self.fit_error,
            "generalisation": self.generalisation,
            "aim_fitted": self.aim_fitted,
            # An idle camera's infinite gain is written as null: JSON proper
            # has no Infinity, and the file is saved strictly.
            "gain": self.gain if math.isfinite(self.gain) else None,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "Calibration":
        """Read one camera back. Anything it does not know is ignored: saves from
        the old pose-by-pose setup carry the trigger poses, pointer tuning,
        landmark jitter and depth slide it measured, and nothing reads them
        now - nor does a browser that stores only what the game uses have to
        supply them."""
        if "mapping" in data:
            mapping = tuple(float(value) for value in data["mapping"])
        else:
            # A file from before the map was projective: read its box instead.
            mapping = homography.box_mapping(tuple(data["aim_min"]),
                                             tuple(data["aim_max"]))
        gain = data.get("gain", 1.0)
        return cls(
            mapping=mapping,
            fit_error=float(data.get("fit_error", 0.0)),
            generalisation=float(data.get("generalisation", 0.0)),
            # A file written before the flag existed cannot vouch for its fit.
            # Its error figures used to be read as proof, but a non-zero figure
            # says only that something was fitted: the old pose fitter left a
            # real player a map whose horizon crossed the camera frame, and it
            # was reused, unchecked, on every launch.
            aim_fitted=bool(data.get("aim_fitted", False)),
            gain=float("inf") if gain is None else float(gain),
        )


def _finite(value) -> bool:
    """A real, finite number; anything else - a string, None - is not."""
    try:
        return math.isfinite(value)
    except TypeError:
        return False


def default_calibration(scheme) -> Calibration:
    """A believable starting point for one camera under ``scheme``: a map
    spanning the box its pointer actually sweeps. This is what the game runs on
    when setup was skipped, so it has to be playable, not merely well-formed.
    """
    cx, cy = scheme.pointer_centre
    span = scheme.pointer_span
    return Calibration(
        mapping=homography.box_mapping((cx - span, cy - span), (cx + span, cy + span)))


def default_rig(scheme, cameras: int) -> "Rig":
    """One scheme-appropriate default per camera."""
    return Rig(tuple(default_calibration(scheme) for _ in range(cameras)))


def _whole(value) -> int:
    """An integer as JSON writes one; True and 480.0 are not."""
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError(f"expected a whole number, not {value!r}")
    return value


@dataclass(frozen=True)
class Setup:
    """What a rig was fitted on, besides the player.

    A fitted map is only true of the picture it was fitted on. Mirroring sends
    x to 1 - x, and the map then aims every movement backwards; another camera
    index is another placement; another capture size can crop the frame to
    another shape. Each leaves a saved map aiming confidently somewhere else,
    with nothing on screen to say why - so a rig records what it was fitted on,
    and is reused only on the same.
    """

    mirror: bool
    camera_indices: tuple[int, ...]
    capture: tuple[int, int]  # the requested width and height, in pixels

    def to_dict(self) -> dict:
        return {"mirror": self.mirror, "camera_indices": list(self.camera_indices),
                "capture": list(self.capture)}

    @classmethod
    def from_dict(cls, data: dict) -> "Setup":
        mirror = data["mirror"]
        if not isinstance(mirror, bool):
            raise ValueError(f"mirror is true or false, not {mirror!r}")
        width, height = data["capture"]
        return cls(mirror=mirror,
                   camera_indices=tuple(_whole(i) for i in data["camera_indices"]),
                   capture=(_whole(width), _whole(height)))

    def differences(self, other: "Setup") -> str:
        """How ``other`` differs from this one, in words; empty if it does not."""
        changes = []
        if other.mirror != self.mirror:
            changes.append("the image " + ("mirrored" if self.mirror else "unmirrored"))
        if other.camera_indices != self.camera_indices:
            changes.append("camera " + ", ".join(map(str, self.camera_indices)))
        if other.capture != self.capture:
            changes.append("a {}x{} capture".format(*self.capture))
        return " and ".join(changes)


@dataclass(frozen=True)
class Rig:
    """The calibration of every camera in the setup, in camera order."""

    cameras: tuple[Calibration, ...] = (Calibration(),)
    #: What it was fitted on; None when it never said - the built-in defaults,
    #: or a save from before the record existed.
    setup: Setup | None = None

    def __post_init__(self) -> None:
        if not self.cameras:
            raise ValueError("a rig needs at least one camera")
        if self.setup is not None and len(self.setup.camera_indices) != len(self):
            raise ValueError("a rig's setup names one camera per calibration")

    def __len__(self) -> int:
        return len(self.cameras)

    def __getitem__(self, index: int) -> Calibration:
        return self.cameras[index]

    def resized(self, count: int, fill: Calibration | None = None) -> "Rig":
        """Fit the rig to ``count`` cameras, padding with ``fill`` if it grows."""
        cameras = list(self.cameras[:count])
        cameras += [fill or Calibration() for _ in range(count - len(cameras))]
        # A rig trimmed or padded is no longer the one fitted on its setup.
        return Rig(tuple(cameras), self.setup if count == len(self) else None)

    @property
    def usable(self) -> tuple[bool, ...]:
        return tuple(camera.usable for camera in self.cameras)

    @property
    def fitted(self) -> bool:
        """Whether the aim was fitted to a player: every camera listened to was.

        A camera told to sit the game out has no say either way - but at least
        one camera has to be listened to, or nobody is aiming.
        """
        listened = [camera for camera in self.cameras if camera.usable]
        return bool(listened) and all(camera.aim_fitted for camera in listened)

    def mismatch(self, setup: Setup,
                 frame: tuple[Point, Point] = CAMERA_FRAME) -> str | None:
        """Why this saved rig cannot be played on ``setup``; None if it can.

        Reusing a rig skips setup, and with it the shots that would show a bad
        map up - so it takes proof, not merely the absence of doubt: the rig
        must say it was fitted, have been fitted on this very setup, and have
        an image everywhere the camera can see.
        """
        wanted = len(setup.camera_indices)
        if len(self) != wanted:
            return f"it is for {len(self)} camera(s) but {wanted} in use"
        if not self.fitted:
            return "it does not say its aim was fitted to anyone"
        if self.setup is None:
            return "it does not say which cameras and image it was fitted on"
        if self.setup != setup:
            return f"it was fitted with {self.setup.differences(setup)}"
        for index, camera in enumerate(self.cameras, start=1):
            if camera.usable and not homography.defined_over(camera.mapping, *frame):
                return (f"camera {index}'s map has its horizon in view, and would "
                        f"throw the crosshair across the screen")
        return None

    def to_dict(self) -> dict:
        data: dict[str, Any] = {"cameras": [c.to_dict() for c in self.cameras]}
        if self.setup is not None:
            data["setup"] = self.setup.to_dict()
        return data

    @classmethod
    def from_dict(cls, data: dict) -> "Rig":
        # A file from before the second camera holds one calibration, bare.
        entries = data["cameras"] if "cameras" in data else [data]
        setup = Setup.from_dict(data["setup"]) if "setup" in data else None
        return cls(tuple(Calibration.from_dict(entry) for entry in entries), setup)


@dataclass
class RigBook:
    """Every scheme's rig, in one file, keyed by :func:`schemes.calibration_key`.

    Only the hand is ever calibrated now - the sniper's scope rides on the hand's
    setup - but a file that also holds a rig for a scheme since removed still
    loads, and keeps it.
    """

    rigs: dict[str, Rig] = field(default_factory=dict)

    def get(self, scheme: str) -> Rig | None:
        return self.rigs.get(scheme)

    def set(self, scheme: str, rig: Rig) -> None:
        self.rigs[scheme] = rig

    def to_dict(self) -> dict:
        return {"version": BOOK_VERSION,
                "schemes": {key: rig.to_dict() for key, rig in self.rigs.items()}}

    def save(self, path: Path) -> bool:
        """Write the book out. False, with a line printed, if the disk said no.

        ``load`` treats an unreadable file as an empty book; a write that cannot
        happen is no worse. It costs the player the setup they just did - which
        is why it says so - but the alternative was a traceback landing the
        instant setup succeeded, and the round never starting at all.
        """
        try:
            # Strict JSON: nothing non-finite should exist to write, and if it
            # somehow does, losing the save beats poisoning every later load.
            write_atomically(path, json.dumps(self.to_dict(), indent=2,
                                              allow_nan=False) + "\n")
        except (OSError, ValueError) as error:
            print(f"Could not save the calibration to {path}: {error}\n"
                  f"This session is calibrated; the next one will ask again.")
            return False
        return True

    @classmethod
    def load(cls, path: Path) -> "RigBook":
        """Read the book, one scheme's rig at a time.

        A file that cannot be read at all starts an empty book. An entry that
        cannot be read - a rig from an older version, a hand edit gone wrong -
        is skipped on its own. It used to take every other scheme's rig down
        with it, and the next save then made the loss permanent.
        """
        try:
            data = json.loads(path.read_text())
        except (OSError, ValueError):
            return cls()
        if not isinstance(data, dict):
            return cls()
        # A file from before there was more than one way to aim holds one rig.
        entries = data["schemes"] if "schemes" in data else {"pistol": data}
        if not isinstance(entries, dict):
            return cls()
        rigs = {}
        for key, entry in entries.items():
            try:
                rigs[str(key)] = Rig.from_dict(entry)
            except (ValueError, KeyError, TypeError, AttributeError) as error:
                print(f"Skipping the saved {key} calibration in {path}: "
                      f"it could not be read ({error}).")
        return cls(rigs)
