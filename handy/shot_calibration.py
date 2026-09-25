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
        self.controller = AimController(scheme)
        self.samples = []
        self.history = [deque() for _ in range(cameras)]
        self.stamps = [None] * cameras
        self.last_fresh = [float("-inf")] * cameras
        self.last_shot = float("-inf")
        self.aim = Aim()
        self.testing = self.initial.fitted
        self.hits = set()
        self.viewport = (960, 540)
        self.last_hit = False
        self.last_impact = None
        self.shot_count = 0
        self.message = (
            "Welcome back. Hit five bullseyes and your game starts."
            if self.testing
            else "Point at the lit target. Fold your thumb to fire."
        )
        self.fitted = False

    @property
    def target(self):
        if self.testing:
            return CHECK_TARGETS[min(len(self.hits), REQUIRED_HITS - 1)]
        return TARGETS[len(self.samples) % len(TARGETS)]

    @property
    def preview(self):
        return self.fitted or self.initial.fitted

    @property
    def ready(self):
        return (self.fitted and len(self.samples) >= 3) or self.initial.fitted

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
                points = [points[camera] for points, t in self.samples
                          if t == target and points[camera] is not None][-3:]
                if points:
                    source.append(
                        tuple(statistics.median(p[a] for p in points) for a in (0, 1))
                    )
                    targets.append(target)
            profiles.append(self._fit_camera(fallback, source, targets))
        # One camera the fit cannot use must not fail it for the others: a
        # second camera is supposed to cost nothing, and a side-on one used to
        # cost every fit. It sits out instead - but somebody has to aim.
        if not any(profile.aim_fitted for profile in profiles):
            return False
        self.rig = Rig(tuple(profiles))
        return True

    def _fit_camera(self, fallback, source, targets):
        """This camera's map, or the camera told to sit the game out."""
        matrix = None
        if len(source) >= 2:
            matrix = (homography.fit_affine(source, targets) if len(source) >= 3
                      else homography.fit_scaled(source, targets))
        if matrix is not None:
            gain = max(homography.gain(matrix, p) for p in source)
            error = homography.residual(matrix, source, targets)
            if math.isfinite(gain) and gain <= GAIN_LIMIT and error <= 0.12:
                return replace(fallback, mapping=matrix, aim_fitted=True,
                               fit_error=error, generalisation=0.0, gain=gain)
        # An infinite gain is how a camera is told to sit the game out: fusion
        # stops listening to it, and so does the accuracy check.
        return replace(fallback, aim_fitted=False, gain=float("inf"))

    def suspend(self):
        """A pause cannot carry an old aim into a new thumb pull."""
        self.history = [deque() for _ in self.history]
        self.controller = AimController(self.scheme)
        self.aim = Aim()

    def undo(self):
        if self.hits:
            self.hits.remove(max(self.hits))
            self.message = "Hit undone. Shoot this target again."
            return
        if self.samples:
            self.samples.pop()
        self.rig = self.initial
        self.fitted = self._fit() if len(self.samples) >= 2 else False
        self.history = [deque() for _ in self.history]
        self.controller.reset_position()
        self.testing = self.ready
        self.message = "Shot undone. Aim at the target and try again."

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
        # A camera which missed this frame sits it out rather than contribute
        # an old position - and only it: waiting for every camera to see the
        # hand at once held a whole shot hostage to the worst-placed one.
        seeing = [i for i, frame in enumerate(frames)
                  if frame.subjects and now - self.last_fresh[i] < 0.15]
        self.aim = self.controller.update(
            [(frames[i], self.rig.cameras[i]) for i in seeing], now)
        # Keep the last thumb-up aim, rather than the fingertip after firing.
        # The window rolls only while the thumb is up; once the fold begins it
        # holds still, however long the fold takes. It used to go on expiring,
        # so a fold that paused part way reached the trigger with nothing left
        # and the shot just fired was thrown away. Raising the thumb again
        # rolls the window on, so an abandoned fold leaves nothing behind.
        if self.aim.armed and self.aim.travel < 0.35:
            for i in seeing:
                while self.history[i] and now - self.history[i][0][0] > 0.25:
                    self.history[i].popleft()
                point = self.scheme.pointer(frames[i].subjects[0])
                if all(math.isfinite(v) for v in point):
                    self.history[i].append((now, point))
        if not self.aim.fired or now - self.last_shot < 0.45:
            return False
        self.last_shot = now
        self.last_hit = False
        if not any(self.history):
            self.message = "Raise your thumb, aim, then fold it to fire."
            return False
        # A camera with no aim from before this pull has no say in this shot.
        points = tuple(
            tuple(statistics.median(p[a] for _, p in h) for a in (0, 1)) if h else None
            for h in self.history
        )
        self.shot_count += 1
        target = self.target
        if self.testing:
            projected = [
                landed
                for profile, point in zip(self.rig.cameras, points)
                if point is not None and profile.usable
                and (landed := profile.project(point)) is not None
            ]
            width, height = self.viewport
            # An aim the map cannot place at all is past its horizon: a miss,
            # and one worth learning from.
            error = float("inf")
            if projected:
                shot = tuple(statistics.median(p[i] for p in projected) for i in (0, 1))
                error = math.hypot(
                    (shot[0] - target[0]) * width, (shot[1] - target[1]) * height
                )
                self.last_impact = (shot, now)
            if error <= min(width, height) * HIT_RADIUS:
                self.hits.add(len(self.hits))
                self.last_hit = True
                self.history = [deque() for _ in self.history]
                self.message = (
                    "Your aim is set. Here we go!" if self.complete
                    else f"Good shot. {len(self.hits)} of {REQUIRED_HITS}."
                )
                return True
            # A miss can refine the mapping, but progress restarts whenever the
            # mapping changes. Verification shots themselves never train it.
            self.samples.append((points, target))
            if len(self.samples) < 2:
                self.testing = False
                self.hits.clear()
                self.message = "Let’s fine-tune your aim. Point at the next target and fire."
                return True
            if self._fit():
                self.hits.clear()
                self.fitted = True
                self.controller.reset_position()
                self.message = "Aim adjusted. Hit five bullseyes to check it."
            else:
                self.samples.pop()
                self.message = "Just off the bullseye. Raise your thumb and try again."
            self.history = [deque() for _ in self.history]
            return True
        self.samples.append((points, target))
        if len(self.samples) >= 2:
            if not self._fit():
                self.samples.pop()
                self.message = ("Those shots were too similar. Aim right at the lit "
                                "target, or undo the last one.")
                return False
            self.fitted = True
            self.controller.reset_position()
        self.history = [deque() for _ in self.history]
        self.testing = self.ready
        self.message = (
            "Aim learned. Hit five bullseyes and your game starts." if self.testing
            else "There’s your crosshair. One more." if self.fitted
            else "Good. Now the next target."
        )
        return True
