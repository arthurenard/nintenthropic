import random
import statistics

import pytest

from handy.filtering import MedianOf3, OneEuroFilter, PointFilter, smoothing_factor


def test_smoothing_factor_opens_up_with_the_cutoff():
    slow = smoothing_factor(cutoff=0.5, dt=1 / 30)
    fast = smoothing_factor(cutoff=5.0, dt=1 / 30)
    assert 0 < slow < fast < 1


def test_first_sample_passes_straight_through():
    assert OneEuroFilter()(0.42, 0.0) == 0.42


def test_a_constant_signal_stays_constant():
    filt = OneEuroFilter()
    for step in range(30):
        value = filt(1.0, step / 30)
    assert value == pytest.approx(1.0)


def test_a_still_hand_is_held_much_steadier_than_the_raw_signal():
    rng = random.Random(4)
    filt = OneEuroFilter(min_cutoff=1.0, beta=0.5)
    raw, smoothed = [], []
    for step in range(120):
        sample = 0.5 + rng.gauss(0, 0.01)  # a hand trying to hold still
        raw.append(sample)
        smoothed.append(filt(sample, step / 30))

    settled = slice(30, None)
    assert statistics.pstdev(smoothed[settled]) < statistics.pstdev(raw[settled]) / 3
    assert statistics.fmean(smoothed[settled]) == pytest.approx(0.5, abs=0.01)


def test_a_fast_sweep_is_tracked_more_closely_than_by_a_fixed_low_pass():
    """The point of One Euro: speed buys responsiveness, stillness buys precision."""
    adaptive = OneEuroFilter(min_cutoff=1.0, beta=2.0)
    fixed = OneEuroFilter(min_cutoff=1.0, beta=0.0)
    for step in range(20):
        t = step / 30
        target = t * 3.0  # a brisk sweep across the screen
        fast_value = adaptive(target, t)
        slow_value = fixed(target, t)

    assert abs(target - fast_value) < abs(target - slow_value)


def test_a_stalled_clock_does_not_divide_by_zero():
    filt = OneEuroFilter()
    filt(1.0, 5.0)
    assert filt(2.0, 5.0) == 1.0  # same timestamp: no time has passed to move in


def test_a_clock_that_stalls_or_runs_back_holds_the_value_and_the_speed():
    """A repeated or backwards timestamp used to be read as a fresh start: the
    raw sample passed straight through - one unfiltered jump of the crosshair -
    the speed estimate was zeroed, and the clock was wound back, so the next
    real frame was measured against the wrong moment."""
    rng = random.Random(1)
    filt = OneEuroFilter(min_cutoff=1.0, beta=0.5)
    for step in range(60):
        held = filt(0.5 + rng.uniform(-0.01, 0.01), step / 30)
    now = 59 / 30

    assert filt(0.9, now) == held, "a repeated timestamp moves nothing"
    assert filt(0.9, now - 0.5) == held, "nor does one from the past"
    # And the next real frame is measured from the last real one, not from
    # the stale timestamp: one frame's step, not a sixth of a second's.
    step = filt(0.51, now + 1 / 30)
    assert step == pytest.approx(held, abs=0.01)


def test_one_bad_sample_cannot_poison_the_filter_for_good():
    """NaN folded into the average stays there: every later output was NaN,
    and the game loop's round() raised on it."""
    filt = OneEuroFilter()
    filt(0.5, 0.0)
    assert filt(float("nan"), 1 / 30) == 0.5
    assert filt(float("inf"), 2 / 30) == 0.5
    assert filt(0.5, 3 / 30) == pytest.approx(0.5)
    assert filt(0.6, 4 / 30) > 0.5, "and it carries on filtering afterwards"


def test_reset_forgets_the_history():
    filt = OneEuroFilter()
    for step in range(10):
        filt(1.0, step / 30)
    filt.reset()
    assert filt(9.0, 10.0) == 9.0


def test_point_filter_smooths_both_axes():
    points = PointFilter(min_cutoff=1.0, beta=0.0)
    points((0.0, 0.0), 0.0)
    x, y = points((1.0, 1.0), 1 / 30)
    assert 0.0 < x < 1.0 and x == pytest.approx(y)


def test_median_of_three_swallows_a_single_spike():
    median = MedianOf3()
    assert median(10.0) == 10.0
    assert median(10.5) == 10.0  # the window is full from the first sample
    assert median(90.0) == 10.5  # the spike never reaches the output
    assert median(10.2) == 10.5


def test_the_very_second_sample_cannot_be_a_spike_either():
    """A window of two has no middle: `sorted(pair)[1]` is the LARGER of the
    two, so a part-filled filter passed an upward spike straight through - on
    the frame after every reset, which is exactly when the trigger has just
    re-acquired its subject and seeded its resting level."""
    median = MedianOf3()
    median(0.0)
    assert median(0.9) == 0.0, "one wild frame out of two is still one wild frame"


def test_the_median_starts_afresh_after_a_reset():
    median = MedianOf3()
    for sample in (0.9, 0.9, 0.9):
        median(sample)
    median.reset()
    assert median(0.0) == 0.0, "no stale samples voting from before the reset"
    assert median(0.9) == 0.0, "and the window is full again from that first one"


def test_rejects_nonsense_parameters():
    with pytest.raises(ValueError):
        OneEuroFilter(min_cutoff=0)
    with pytest.raises(ValueError):
        OneEuroFilter(beta=-1)
