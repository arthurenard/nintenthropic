"""The machinery every map shares."""

import pytest

from handy import maps
from handy.game import MISS, Hit, Rect, Round, RoundOptions
from handy.maps.sniper import ROAD

AREA = Rect(0, 0, 1280, 620)


class ScriptedRound(Round):
    """A map that hits whatever the test tells it to."""

    PERFECT_LABEL = "kills"

    def __init__(self, options, script=()):
        super().__init__(options)
        self.script = list(script)
        self.ticks = 0
        self.begun = []
        self.lost = False

    @property
    def is_lost(self):
        return self.lost

    def begin(self, now):
        self.begun.append(now)

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


def test_the_map_is_told_once_what_the_clock_read_when_play_began():
    round_ = make_round(duration=60)
    round_.update(500.0)
    round_.update(501.0)
    assert round_.begun == [500.0]


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


# --- every map, whatever the clock reads -----------------------------------

#: What ``time.monotonic()`` reads on a Mac that has been up three and a half
#: days - the clock the game actually runs on. The tests above start at zero.
LATE = 304_000.0
MAP_AREA = Rect(31, 294, 1450, 578)


def play(chosen, start: float, seconds: float, fps: int = 30):
    """Run a map from a clock reading ``start``, yielding (round time, round)."""
    round_ = chosen.create(RoundOptions(area=MAP_AREA, seed=5, duration=60.0))
    for frame in range(int(seconds * fps) + 1):
        round_.update(start + frame / fps)
        yield frame / fps, round_


def first_seen(chosen, start: float, seconds: float, present) -> float | None:
    """Round time of the first frame on which ``present(round_)`` holds."""
    return next((t for t, round_ in play(chosen, start, seconds) if present(round_)), None)


def census(round_) -> tuple:
    """What the map has out in front of the player, counted by kind."""
    things = [*getattr(round_, "walkers", ()), *getattr(round_, "targets", ()),
              *getattr(round_, "dust_devils", ()), *getattr(round_, "tumbleweeds", ())]
    if getattr(round_, "drone", None) is not None:
        things.append(round_.drone)
    return tuple(sorted(getattr(thing, "kind", type(thing).__name__) for thing in things))


@pytest.mark.parametrize("chosen", maps.MAPS, ids=lambda chosen: chosen.key)
def test_a_map_plays_the_same_from_any_clock(chosen):
    early = [census(round_) for t, round_ in play(chosen, 0.0, 12.0) if t % 1.0 < 1e-9]
    late = [census(round_) for t, round_ in play(chosen, LATE, 12.0) if t % 1.0 < 1e-9]
    assert late == early


def test_the_opening_patrols_are_still_walking_on_a_late_clock():
    for start in (0.0, LATE):
        *_, (t, round_) = play(maps.SNIPER, start, 1.0)
        patrols = [h for h in round_.hostiles if h.kind == "patrol"]
        assert len(patrols) == 2
        assert all(0.0 <= h.arc(start + t) <= ROAD.length for h in patrols)


def test_the_first_truck_comes_eight_seconds_in_on_any_clock():
    for start in (0.0, LATE):
        seen = first_seen(maps.SNIPER, start, 10.0,
                          lambda round_: any(h.kind == "vehicle" for h in round_.hostiles))
        assert seen == pytest.approx(8.0, abs=0.04)


def test_the_drone_goes_out_six_seconds_in_on_any_clock():
    seen = first_seen(maps.ORBIT, LATE, 8.0, lambda round_: round_.drone is not None)
    assert seen == pytest.approx(6.0, abs=0.04)


def test_the_weather_on_main_street_waits_for_its_cue_on_any_clock():
    devil = first_seen(maps.WESTERN, LATE, 4.0, lambda round_: bool(round_.dust_devils))
    weed = first_seen(maps.WESTERN, LATE, 4.0, lambda round_: bool(round_.tumbleweeds))
    assert devil == pytest.approx(2.0, abs=0.04)
    assert weed == pytest.approx(1.0, abs=0.04)
