"""Learn hand-to-screen aim by shooting, with a preview after two points.

The thumb is a built-in gesture; only the pointing map is fitted. Samples come
from just before the pull, to avoid learning the hand's movement during firing.
"""

from collections import deque
from dataclasses import replace
import math
import statistics

from . import homography
from .aiming import Aim, AimController
from .calibration import Rig, default_rig
from .fusion import GAIN_LIMIT

TARGETS = (
    (0.15, 0.22),
    (0.85, 0.62),
    (0.85, 0.22),
    (0.15, 0.62),
    (0.50, 0.38),
    (0.50, 0.20),
    (0.80, 0.45),
    (0.20, 0.45),
)
CHECK_TARGETS = ((0.30, 0.28), (0.72, 0.32), (0.24, 0.56), (0.76, 0.59), (0.50, 0.40))
REQUIRED_HITS = 5
TARGET_RADIUS = 0.075
# Inner two scoring rings: a meaningful accuracy check, not just touching a boss.
HIT_RADIUS = TARGET_RADIUS * 0.4


class ShotCalibration:
    """Learn in Target Range, then verify five centre hits before auto-start."""

    def __init__(self, scheme, cameras=1, previous=None):
        self.scheme = scheme
        self.initial = previous or default_rig(scheme, cameras)
        self.rig = self.initial
        self.controller = AimController(scheme, native_thumb=True)
        self.samples = []
        self.history = [deque() for _ in range(cameras)]
        self.stamps = [None] * cameras
        self.last_fresh = [float("-inf")] * cameras
        self.last_shot = float("-inf")
        self.aim = Aim()
        self.testing = all(c.aim_fitted for c in self.initial.cameras)
        self.hits = set()
        self.viewport = (960, 540)
        self.last_hit = False
        self.last_impact = None
        self.shot_count = 0
        self.message = (
            "Saved aim loaded. Hit five target centres to start your game."
            if self.testing
            else "Point naturally at the lit target and fold your thumb. Your crosshair appears after two shots."
        )
        self.fitted = False

    @property
    def target(self):
        if self.testing:
            return CHECK_TARGETS[min(len(self.hits), REQUIRED_HITS - 1)]
        return TARGETS[len(self.samples) % len(TARGETS)]

    @property
    def preview(self):
        return self.fitted or all(c.aim_fitted for c in self.initial.cameras)

    @property
    def ready(self):
        return (self.fitted and len(self.samples) >= 3) or all(
            c.aim_fitted for c in self.initial.cameras
        )

    @property
    def complete(self):
        return len(self.hits) >= REQUIRED_HITS

    def _fit(self):
        profiles = []
        # Use recent observations at each target, so revisiting it refines the
        # fit without giving frequently visited targets disproportionate weight.
        for camera, fallback in enumerate(self.initial.cameras):
            source, targets = [], []
            for target in dict.fromkeys(t for _, t in self.samples):
                points = [points[camera] for points, t in self.samples if t == target][
                    -3:
                ]
                if points:
                    source.append(
                        tuple(statistics.median(p[a] for p in points) for a in (0, 1))
                    )
                    targets.append(target)
            matrix = (
                homography.fit_affine(source, targets)
                if len(source) >= 3
                else homography.fit_scaled(source, targets)
            )
            if matrix is None:
                return False
            gain = max(homography.gain(matrix, p) for p in source)
            error = homography.residual(matrix, source, targets)
            if not math.isfinite(gain) or gain > GAIN_LIMIT or error > 0.12:
                return False
            profiles.append(
                replace(
                    fallback,
                    mapping=matrix,
                    aim_fitted=True,
                    fit_error=error,
                    generalisation=0.0,
                    gain=gain,
                    slide=(0.0, 0.0),
                )
            )
        self.rig = Rig(tuple(profiles))
        return True

    def suspend(self):
        """A pause cannot carry an old aim into a new thumb pull."""
        self.history = [deque() for _ in self.history]
        self.controller = AimController(self.scheme, native_thumb=True)
        self.aim = Aim()

    def undo(self):
        if self.hits:
            self.hits.remove(max(self.hits))
            self.message = "Last accuracy hit undone. Shoot this target again."
            return
        if self.samples:
            self.samples.pop()
        self.rig = self.initial
        self.fitted = self._fit() if len(self.samples) >= 2 else False
        self.history = [deque() for _ in self.history]
        self.controller.reset_position()
        self.testing = self.ready
        self.message = "Shot undone. Point at the target and try again."

    def update(self, frames, now):
        fresh = False
        for i, frame in enumerate(frames):
            if frame.timestamp_ms != self.stamps[i]:
                self.stamps[i] = frame.timestamp_ms
                self.last_fresh[i] = now
                fresh = True
            if not frame.subjects or now - self.last_fresh[i] > 0.35:
                self.history[i].clear()
        if not fresh:
            if now - max(self.last_fresh) > 0.35:
                self.aim = self.controller.update([], now)
            return False
        # Do not let a camera which missed this shot contribute an old position.
        if not all(
            f.subjects and now - self.last_fresh[i] < 0.15 for i, f in enumerate(frames)
        ):
            self.aim = self.controller.update([], now)
            return False
        self.aim = self.controller.update(list(zip(frames, self.rig.cameras)), now)
        for i, frame in enumerate(frames):
            while self.history[i] and now - self.history[i][0][0] > 0.25:
                self.history[i].popleft()
            # Keep the last thumb-up aim, rather than the fingertip after firing.
            if self.aim.armed and self.aim.travel < 0.35:
                point = self.scheme.pointer(frame.subjects[0])
                if all(math.isfinite(v) for v in point):
                    self.history[i].append((now, point))
        if not self.aim.fired or now - self.last_shot < 0.45:
            return False
        self.last_shot = now
        self.last_hit = False
        if not all(self.history):
            self.message = (
                "Raise your thumb, aim, then fold it. Keep your hand in view."
            )
            return False
        points = tuple(
            tuple(statistics.median(p[a] for _, p in h) for a in (0, 1))
            for h in self.history
        )
        self.shot_count += 1
        target = self.target
        if self.testing:
            projected = [
                profile.project(point)
                for profile, point in zip(self.rig.cameras, points)
            ]
            shot = tuple(statistics.median(p[i] for p in projected) for i in (0, 1))
            width, height = self.viewport
            error = math.hypot(
                (shot[0] - target[0]) * width, (shot[1] - target[1]) * height
            )
            self.last_impact = (shot, now)
            if error <= min(width, height) * HIT_RADIUS:
                self.hits.add(len(self.hits))
                self.last_hit = True
                self.history = [deque() for _ in self.history]
                self.message = f"{len(self.hits)} / {REQUIRED_HITS} accurate hits. " + (
                    "Aim ready. Starting your game!"
                    if self.complete
                    else "Hit the next target’s centre."
                )
                return True
            # A miss can refine the mapping, but progress restarts whenever the
            # mapping changes. Verification shots themselves never train it.
            self.samples.append((points, target))
            if len(self.samples) < 2:
                self.testing = False
                self.hits.clear()
                self.message = "Let’s adjust the aim. Point naturally at the next target and shoot."
                return True
            if self._fit():
                self.hits.clear()
                self.fitted = True
                self.controller.reset_position()
                self.message = "Aim adjusted. Land five centre hits to check it."
            else:
                self.samples.pop()
                self.message = (
                    "Missed the centre. Raise your thumb and try this target again."
                )
            self.history = [deque() for _ in self.history]
            return True
        self.samples.append((points, target))
        if len(self.samples) >= 2:
            if not self._fit():
                self.samples.pop()
                self.message = "Those aims were too similar or inconsistent. Move toward the target and retry, or undo the last shot."
                return False
            self.fitted = True
            self.controller.reset_position()
        self.history = [deque() for _ in self.history]
        self.testing = self.ready
        self.message = (
            "Aim learned. Hit five target centres to start your game automatically."
            if self.testing
            else "Point naturally at the next target. Your crosshair appears after two shots."
        )
        return True
