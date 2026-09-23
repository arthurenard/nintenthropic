"""What setup learned about each camera, and where it is kept.

The hand travels a different box in front of every camera, and every camera
sits somewhere different relative to the screen being aimed at. Setup
(:mod:`shot_calibration`) fits one map per camera from the shots the player
takes; this module holds those maps, the defaults the game plays on before
there are any, and the file they are saved to.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

from . import fusion, homography
from .homography import Matrix, Point

#: Pointer settings whose fits land this close together are treated as equally
#: good, and decided on other grounds.
FIT_TIE = 0.004

DEFAULT_MAPPING = homography.box_mapping((0.15, 0.15), (0.85, 0.85))


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
    jitter: float = 0.004  # this camera's own landmark shake, measured at setup
    gain: float = 1.0  # how much this camera's map magnifies movement
    slide: Point = (0.0, 0.0)  # where its estimate goes when the hand changes depth

    def __post_init__(self) -> None:
        if len(self.mapping) != 9:
            raise ValueError("a mapping is nine numbers, row-major")

    @property
    def usable(self) -> bool:
        """False for a camera placed where its map has to stretch beyond sense."""
        return self.gain <= fusion.GAIN_LIMIT

    def project(self, point: Point) -> Point:
        """Map a camera-space point onto the screen, without clamping.

        Fusion needs the raw answer: clamping first would hide exactly the
        disagreement between cameras that the depth solve reads.
        """
        return homography.apply(self.mapping, point)

    def to_play_area(self, point: Point) -> Point:
        """Map a camera-space point onto the screen, 0..1, clamped at the edges."""
        return clamp(self.project(point))

    def local_gain(self, point: Point) -> float:
        """How much this camera's map magnifies movement right here."""
        return homography.gain(self.mapping, point)

    def to_dict(self) -> dict:
        return {
            "mapping": list(self.mapping),
            "fit_error": self.fit_error,
            "generalisation": self.generalisation,
            "aim_fitted": self.aim_fitted,
            "jitter": self.jitter,
            "gain": self.gain,
            "slide": list(self.slide),
        }

    @classmethod
    def from_dict(cls, data: dict) -> "Calibration":
        """Read one camera back. Anything it does not know is ignored: saves from
        before the thumb was a built-in gesture carry the trigger poses setup
        used to measure, and nothing reads them now."""
        if "mapping" in data:
            mapping = tuple(float(value) for value in data["mapping"])
        else:
            # A file from before the map was projective: read its box instead.
            mapping = homography.box_mapping(tuple(data["aim_min"]),
                                             tuple(data["aim_max"]))
        return cls(
            mapping=mapping,
            fit_error=float(data.get("fit_error", 0.0)),
            generalisation=float(data.get("generalisation", 0.0)),
            # A file written before the flag existed: a non-zero error figure is
            # the only trace a real fit left in it, so read it that way.
            aim_fitted=bool(data.get("aim_fitted",
                                     bool(data.get("fit_error"))
                                     or bool(data.get("generalisation")))),
            jitter=float(data.get("jitter", 0.004)),
            gain=float(data.get("gain", 1.0)),
            slide=tuple(data.get("slide", (0.0, 0.0))),
        )


def clamp(point: Point) -> Point:
    return tuple(min(max(value, 0.0), 1.0) for value in point)


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


@dataclass(frozen=True)
class Rig:
    """The calibration of every camera in the setup, in camera order."""

    cameras: tuple[Calibration, ...] = (Calibration(),)

    def __post_init__(self) -> None:
        if not self.cameras:
            raise ValueError("a rig needs at least one camera")

    def __len__(self) -> int:
        return len(self.cameras)

    def __getitem__(self, index: int) -> Calibration:
        return self.cameras[index]

    def resized(self, count: int, fill: Calibration | None = None) -> "Rig":
        """Fit the rig to ``count`` cameras, padding with ``fill`` if it grows."""
        cameras = list(self.cameras[:count])
        cameras += [fill or Calibration() for _ in range(count - len(cameras))]
        return Rig(tuple(cameras))

    @property
    def usable(self) -> tuple[bool, ...]:
        return tuple(camera.usable for camera in self.cameras)

    def save(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        payload = {"cameras": [camera.to_dict() for camera in self.cameras]}
        path.write_text(json.dumps(payload, indent=2) + "\n")

    @classmethod
    def from_dict(cls, data: dict) -> "Rig":
        # A file from before the second camera holds one calibration, bare.
        entries = data["cameras"] if "cameras" in data else [data]
        return cls(tuple(Calibration.from_dict(entry) for entry in entries))

    @classmethod
    def load(cls, path: Path) -> "Rig | None":
        """Read a saved rig, or None if it is missing or unusable."""
        try:
            return cls.from_dict(json.loads(path.read_text()))
        except (OSError, ValueError, KeyError, TypeError):
            return None


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
        return {"schemes": {key: {"cameras": [c.to_dict() for c in rig.cameras]}
                            for key, rig in self.rigs.items()}}

    def save(self, path: Path) -> bool:
        """Write the book out. False, with a line printed, if the disk said no.

        ``load`` treats an unreadable file as an empty book; a write that cannot
        happen is no worse. It costs the player the setup they just did - which
        is why it says so - but the alternative was a traceback landing the
        instant setup succeeded, and the round never starting at all.
        """
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(self.to_dict(), indent=2) + "\n")
        except OSError as error:
            print(f"Could not save the calibration to {path}: {error}\n"
                  f"This session is calibrated; the next one will ask again.")
            return False
        return True

    @classmethod
    def load(cls, path: Path) -> "RigBook":
        """Read the book. Anything unreadable simply starts an empty one."""
        try:
            data = json.loads(path.read_text())
        except (OSError, ValueError):
            return cls()
        try:
            if "schemes" in data:
                return cls({key: Rig.from_dict(entry)
                            for key, entry in data["schemes"].items()})
            # A file from before there was more than one way to aim.
            return cls({"pistol": Rig.from_dict(data)})
        except (ValueError, KeyError, TypeError, AttributeError):
            return cls()
