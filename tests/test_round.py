"""The machinery every map shares."""

import pytest

from handy.game import MISS, Hit, Rect, Round, RoundOptions

AREA = Rect(0, 0, 1280, 620)


class ScriptedRound(Round):
    """A map that hits whatever the test tells it to."""

    PERFECT_LABEL = "kills"

    def __init__(self, options, script=()):
        super().__init__(options)
        self.script = list(script)
        self.ticks = 0
        self.lost = False

    @property
    def is_lost(self):
        return self.lost

    def advance(self, now):
        self.ticks += 1

    def resolve(self, x, y, now):
        return self.script.pop(0) if self.script else MISS


def make_round(script=(), **options) -> ScriptedRound:
    return ScriptedRound(RoundOptions(area=AREA, seed=1, **options), script)


def test_rect_contains_its_edges():
    rect = Rect(10, 20, 100, 50)
    assert rect.contains(10, 20) and rect.contains(110, 70)
    assert not rect.contains(9, 20) and not rect.contains(111, 70)
    assert rect.centre_x == 60


# --- the clock -------------------------------------------------------------

def test_the_clock_starts_on_the_first_frame_not_at_construction():
    round_ = make_round(duration=60)
    assert round_.started_at is None and round_.elapsed(500.0) == 0.0

    round_.update(500.0)  # a monotonic clock starts at an arbitrary point
    assert round_.started_at == 500.0
    assert round_.elapsed(510.0) == pytest.approx(10.0)
    assert round_.remaining(510.0) == pytest.approx(50.0)


def test_the_round_ends_when_the_time_runs_out():
    round_ = make_round(duration=30)
    round_.update(0.0)
    assert not round_.is_over(29.9)
    assert round_.is_over(30.0)
    assert round_.remaining(45.0) == 0.0, "the clock never runs negative"


def test_an_endless_round_never_ends():
    round_ = make_round(duration=None)
    round_.update(0.0)
    assert round_.remaining(10_000.0) is None
    assert not round_.is_over(10_000.0)


def test_a_map_you_can_fail_ends_the_round_early():
    round_ = make_round(duration=60)
    round_.update(0.0)
    round_.lost = True
    assert round_.is_over(1.0)


def test_a_finished_round_stops_moving():
    round_ = make_round(duration=5)
    round_.update(0.0)
    ticks = round_.ticks
    round_.update(20.0)
    assert round_.ticks == ticks, "nothing advances once the round is over"


# --- shots -----------------------------------------------------------------

def test_a_landed_shot_scores_and_counts():
    round_ = make_round(script=[Hit(points=25, ring=0, perfect=True, label="X")])
    impact = round_.shoot(5, 5, 0.1)

    assert impact.score == 25 and impact.is_hit and impact.label == "X"
    assert (round_.score, round_.hits, round_.shots, round_.perfect) == (25, 1, 1, 1)


def test_a_miss_costs_a_shot_and_breaks_the_streak():
    round_ = make_round(script=[Hit(points=10, ring=1), Hit(points=10, ring=1), MISS])
    for _ in range(3):
        round_.shoot(1, 1, 0.1)

    assert round_.shots == 3 and round_.hits == 2
    assert round_.streak == 0 and round_.best_streak == 2


def test_a_hit_that_is_not_perfect_still_counts_as_a_hit():
    round_ = make_round(script=[Hit(points=8, ring=2)])
    round_.shoot(1, 1, 0.0)
    assert round_.hits == 1 and round_.perfect == 0


def test_accuracy_tracks_hits_over_shots():
    round_ = make_round(script=[Hit(points=10, ring=0), MISS])
    assert round_.accuracy == 0.0
    round_.shoot(1, 1, 0.1)
    round_.shoot(1, 1, 0.2)
    assert round_.accuracy == pytest.approx(0.5)


def test_old_impacts_are_forgotten():
    round_ = make_round()
    round_.shoot(10, 10, 0.0)
    round_.update(0.5)
    assert len(round_.impacts) == 1
    round_.update(Round.IMPACT_TTL + 0.1)
    assert round_.impacts == []


def test_the_summary_reports_the_round_in_the_maps_own_words():
    round_ = make_round(duration=45, script=[Hit(points=10, ring=0, perfect=True), MISS])
    round_.shoot(1, 1, 0.1)
    round_.shoot(1, 1, 0.2)

    summary = round_.summary()
    assert summary.score == 10 and summary.shots == 2 and summary.hits == 1
    assert summary.accuracy == pytest.approx(0.5)
    assert summary.perfect == 1 and summary.perfect_label == "kills"
    assert summary.duration == 45 and summary.outcome == ""


# --- sound cues ------------------------------------------------------------

def test_cues_are_handed_over_once():
    round_ = make_round()
    round_.cues.extend(["groan", "hurt"])
    assert round_.take_cues() == ["groan", "hurt"]
    assert round_.take_cues() == []
