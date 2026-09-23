"""Jitter filtering for the crosshair.

A plain exponential average forces a bad trade: enough smoothing to hold the
crosshair still on a target also makes it lag behind fast movement. The One Euro
filter[1] adapts instead - it smooths hard when the hand is slow, where jitter is
visible and precision matters, and lets go when the hand moves fast, where lag is
visible and jitter is not.

[1] Casiez, Roussel & Vogel, "1e Filter: A Simple Speed-based Low-pass Filter for
    Noisy Input in Interactive Systems", CHI 2012.
"""

from __future__ import annotations

import math


def smoothing_factor(cutoff: float, dt: float) -> float:
    """Exponential-average weight for a low-pass at ``cutoff`` Hz over ``dt`` s."""
    tau = 1.0 / (2.0 * math.pi * cutoff)
    return 1.0 / (1.0 + tau / dt)


class LowPass:
    """A one-pole low-pass whose weight is supplied per sample."""

    def __init__(self) -> None:
        self.value: float | None = None

    def __call__(self, sample: float, alpha: float) -> float:
        if self.value is None:
            self.value = sample
        else:
            self.value += alpha * (sample - self.value)
        return self.value

    def reset(self) -> None:
        self.value = None


class OneEuroFilter:
    """Speed-adaptive low-pass filter for a single scalar.

    ``min_cutoff`` sets how still the signal is held when the hand barely moves -
    lower is steadier. ``beta`` sets how quickly the filter opens up as the hand
    speeds up - higher is more responsive but jumpier.
    """

    def __init__(self, min_cutoff: float = 1.2, beta: float = 0.8,
                 derivative_cutoff: float = 1.0) -> None:
        if min_cutoff <= 0 or derivative_cutoff <= 0:
            raise ValueError("cutoffs must be positive")
        if beta < 0:
            raise ValueError("beta must not be negative")
        self.min_cutoff = min_cutoff
        self.beta = beta
        self.derivative_cutoff = derivative_cutoff
        self._value = LowPass()
        self._speed = LowPass()
        self._last_time: float | None = None

    def __call__(self, sample: float, timestamp: float) -> float:
        if not (math.isfinite(sample) and math.isfinite(timestamp)):
            # One NaN folded into the average would stay there for good, and
            # every later output with it. Hold what we have instead.
            return sample if self._value.value is None else self._value.value
        if self._last_time is None:
            # First sample: nothing to derive a speed from yet.
            self._last_time = timestamp
            self._speed(0.0, 1.0)
            return self._value(sample, 1.0)

        dt = timestamp - self._last_time
        if dt <= 0.0:
            # A clock that stalled or ran backwards: no time has passed to move
            # in. Starting afresh here would pass the raw sample straight
            # through - one unfiltered jump - and throw away the speed estimate;
            # winding the clock back would mismeasure the next real frame too.
            return self._value.value
        self._last_time = timestamp

        previous = self._value.value
        rate = 0.0 if previous is None else (sample - previous) / dt
        speed = self._speed(rate, smoothing_factor(self.derivative_cutoff, dt))

        cutoff = self.min_cutoff + self.beta * abs(speed)
        return self._value(sample, smoothing_factor(cutoff, dt))

    def reset(self) -> None:
        self._value.reset()
        self._speed.reset()
        self._last_time = None


class PointFilter:
    """One Euro filter applied to a 2D point, one axis each."""

    def __init__(self, min_cutoff: float = 1.2, beta: float = 0.8) -> None:
        self._x = OneEuroFilter(min_cutoff, beta)
        self._y = OneEuroFilter(min_cutoff, beta)

    def __call__(self, point: tuple[float, float],
                 timestamp: float) -> tuple[float, float]:
        return self._x(point[0], timestamp), self._y(point[1], timestamp)

    def reset(self) -> None:
        self._x.reset()
        self._y.reset()


class MedianOf3:
    """Drops single-frame outliers from a scalar without adding real lag.

    The window is filled on the first sample rather than grown into. A window of
    two has no middle - ``sorted(pair)[1]`` is simply the larger of them - so a
    part-filled filter used to pass an upward spike straight through, on the
    frame right after every reset. That is precisely the worst moment for it:
    the trigger resets this filter when it loses its subject, seeds its resting
    level on the first frame back, and would then read one misread second frame
    as a firing stroke - a shot the player never took, at the moment tracking
    returned. Repeating the first reading costs one frame of lag, once, and
    nothing after that.
    """

    def __init__(self) -> None:
        self._history: list[float] = []

    def __call__(self, sample: float) -> float:
        self._history = (self._history or [sample, sample])[-2:] + [sample]
        return sorted(self._history)[1]

    def reset(self) -> None:
        self._history.clear()
