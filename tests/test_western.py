import math

import numpy as np
import pytest

from handy.game import Rect, RoundOptions
from handy.maps.western import (AWNING_Y, BANDIT_POINTS, BOTTLE_POINTS,
                                CAN_POINTS, DOOR_H, FIGURE_RISE,
                                FIGURES_AT_ONCE, HOURS, MAX_HOLES,
                                QUICK_DRAW_BONUS, RAIL_REFILL, RAIL_SLOTS,
                                SHARD_LIFE, SIGN_POINTS, SIGN_SWING, TOWNSFOLK_PENALTY,
                                Can, Figure, Impact, Shard, Spot, Tumbleweed,
                                WesternRound, _backdrop, _draw_person,
                                draw_emblem, draw_impact, draw_world)

AREA = Rect(31, 294, 1450, 578)


def make_round(**options) -> WesternRound:
    options.setdefault("seed", 7)
    round_ = WesternRound(RoundOptions(area=AREA, **options))
    round_.update(0.0)
    return round_


def figure_at(round_, kind: str, bandit: bool, now: float, variant: int = 0) -> Figure:
    spot = next(s for s in round_.street.spots if s.kind == kind)
    figure = Figure(spot=spot, bandit=bandit, variant=variant, appeared_at=now, lifetime=2.0)
    round_.figures.append(figure)
    return figure


# --- the street ------------------------------------------------------------

def test_the_street_is_laid_out_inside_the_play_area():
    street = make_round().street
    assert AREA.y < street.ground_y < street.walk_y < street.rail_y < AREA.bottom
    assert AREA.x < street.rail_x[0] < street.rail_x[1] < AREA.right
    assert street.buildings
    kinds = {s.kind for s in street.spots}
    assert kinds == {"door", "window", "barrel"}


def test_the_same_seed_builds_the_same_street():
    assert make_round(seed=9).street == make_round(seed=9).street
    assert make_round(seed=9).street != make_round(seed=10).street


def who_comes_out(fire) -> list:
    """Who stepped out, where and when, over half a minute of a seeded round;
    ``fire(round_, frame, now)`` is called every frame to take the player's shots."""
    round_ = WesternRound(RoundOptions(area=AREA, seed=7))
    seen = []
    for frame in range(30 * 30):
        now = 1000.0 + frame / 30
        round_.update(now)
        fire(round_, frame, now)
        for figure in round_.figures:
            key = (round(figure.appeared_at - 1000.0, 2), figure.spot.x, figure.bandit,
                   figure.variant, figure.lifetime)
            if key not in seen:
                seen.append(key)
    return seen


def test_what_the_player_shoots_does_not_change_who_comes_out_next():
    def fire(round_, frame, now):
        if frame == 15:
            round_.shoot(AREA.x + 5, AREA.y + 3, now)  # into the open sky
        elif frame == 45:
            bottle = round_.bottles[0]  # glass everywhere, and a refill to come
            round_.shoot(bottle.x, bottle.y, now)
        elif frame == 75 and round_.signs:
            round_.shoot(round_.signs[0].x, round_.signs[0].y, now)

    quiet = who_comes_out(lambda *_: None)
    assert len(quiet) > 10
    assert who_comes_out(fire) == quiet


# --- the rail ------------------------------------------------------------------

def test_the_rail_starts_full():
    round_ = make_round()
    assert len(round_.bottles) + len(round_.cans) == RAIL_SLOTS
    assert {b.slot for b in round_.bottles} | {c.slot for c in round_.cans} == set(range(RAIL_SLOTS))


def test_a_bottle_shatters_and_pays():
    round_ = make_round()
    bottle = round_.bottles[0]
    impact = round_.shoot(bottle.x, bottle.y, 1.0)
    assert impact.score == BOTTLE_POINTS
    assert bottle not in round_.bottles
    assert round_.bottles_broken == 1
    assert round_.shards, "glass should be in the air"
    assert "bottle_break" in round_.take_cues()


def test_the_slot_refills_after_a_moment():
    round_ = make_round()
    bottle = round_.bottles[0]
    round_.shoot(bottle.x, bottle.y, 1.0)
    round_.update(1.0 + RAIL_REFILL * 0.5)
    assert bottle.slot not in {b.slot for b in round_.bottles} | {c.slot for c in round_.cans}
    round_.update(1.0 + RAIL_REFILL + 0.05)
    assert bottle.slot in {b.slot for b in round_.bottles} | {c.slot for c in round_.cans}


def test_a_can_spins_off_and_is_not_hit_twice():
    round_ = make_round(seed=2)
    for _ in range(20):
        if round_.cans:
            break
        round_.update(round_._last_tick + RAIL_REFILL + 0.1)
        for bottle in list(round_.bottles):
            round_.shoot(bottle.x, bottle.y, round_._last_tick)
    can = round_.cans[0]
    now = round_._last_tick + 0.01
    assert round_.shoot(can.x, can.y, now).score == CAN_POINTS
    assert can.hit_at == now
    assert "ricochet" in round_.take_cues()
    assert not round_.shoot(can.x, can.y, now + 0.01).is_hit
    round_.update(now + 2.0)
    assert can not in round_.cans


# --- shards -----------------------------------------------------------------------

def test_shards_fall_bounce_and_fade():
    shard = Shard(x=100, y=100, vx=50, vy=-200, size=3, color=(0, 0, 0), born=0.0, floor=300)
    shard.step(0.1, 1500.0)
    assert shard.vy > -200 and shard.x > 100
    for _ in range(40):
        shard.step(0.05, 1500.0)
    assert shard.y <= shard.floor + 1e-6
    assert shard.life(0.0) == 1.0
    assert shard.life(SHARD_LIFE) == 0.0


def test_shards_are_swept_up_once_they_have_faded():
    round_ = make_round()
    bottle = round_.bottles[0]
    round_.shoot(bottle.x, bottle.y, 1.0)
    round_.update(1.5)
    assert round_.shards
    round_.update(1.0 + SHARD_LIFE + 0.1)
    assert not round_.shards


# --- signs ------------------------------------------------------------------------

def test_a_sign_swings_and_pays_once_per_swing():
    round_ = make_round()
    if not round_.signs:
        pytest.skip("this seed hung no signs")
    sign = round_.signs[0]
    before = sign.velocity
    assert round_.shoot(sign.x, sign.y, 1.0).score == SIGN_POINTS
    assert sign.velocity != before
    assert round_.shoot(sign.x, sign.y, 1.1).score == 0
    sign.step(0.1, 1.2)
    assert sign.angle != 0.0 or sign.velocity != 0.0


def test_a_swinging_sign_pays_once_and_the_rest_are_not_hits():
    round_ = make_round(seed=1)
    sign = round_.signs[0]
    for index in range(10):  # ten shots in a second, all on the board
        now = 1.0 + index * 0.07
        round_.update(now)
        assert round_.shoot(sign.x, sign.y, now).is_hit == (index == 0)
    assert (round_.score, round_.hits, round_.shots) == (SIGN_POINTS, 1, 10)
    assert round_.best_streak == 1


def test_a_sign_is_never_kicked_over_its_bracket():
    round_ = make_round(seed=1)
    sign = round_.signs[0]
    highest = 0.0
    for kick in range(6):  # the same way every time, as hard as a shot kicks
        sign.velocity += 7.0
        for step in range(10):
            sign.step(1 / 30, kick + step / 30)
            highest = max(highest, abs(sign.angle))
    assert highest <= SIGN_SWING < math.pi / 2


# --- bandits and townsfolk -----------------------------------------------------------

def test_figures_are_spawned_and_expire():
    round_ = make_round()
    for step in range(1, 60):
        round_.update(step * 0.1)
    assert round_.figures, "someone should have stepped out by now"
    figure = round_.figures[0]
    assert figure.rise(figure.appeared_at + FIGURE_RISE + 0.1) == 1.0
    assert figure.is_gone(figure.appeared_at + figure.lifetime + 0.01)
    round_.update(figure.appeared_at + figure.lifetime + 0.01)
    assert figure not in round_.figures


def test_a_figure_steps_out_and_back():
    round_ = make_round()
    figure = figure_at(round_, "door", True, 5.0)
    assert figure.rise(5.0) == 0.0
    assert not figure.is_shootable(5.0)
    assert figure.is_shootable(5.0 + FIGURE_RISE)
    assert figure.rise(5.0 + figure.lifetime - 0.01) < 1.0
    assert figure.feet(5.0)[1] > figure.feet(5.0 + FIGURE_RISE)[1]


def test_a_quick_draw_pays_the_full_bonus():
    round_ = make_round()
    figure = figure_at(round_, "door", True, 5.0)
    now = 5.0 + FIGURE_RISE + 0.05
    impact = round_.shoot(figure.x, figure.y, now)
    assert impact.label == "QUICK DRAW"
    assert BANDIT_POINTS < impact.score <= BANDIT_POINTS + QUICK_DRAW_BONUS
    assert round_.perfect == 1
    assert round_.bandits_down == 1
    assert figure.down_at == now
    assert "bandit_down" in round_.take_cues()


def test_a_slow_bandit_is_worth_less():
    quick = make_round()
    slow = make_round()
    f1 = figure_at(quick, "window", True, 5.0)
    f2 = figure_at(slow, "window", True, 5.0)
    f2.lifetime = 4.0
    fast = quick.shoot(f1.x, f1.y, 5.0 + FIGURE_RISE + 0.1).score
    late = slow.shoot(f2.x, f2.y, 5.0 + FIGURE_RISE + 1.6).score
    assert fast > late >= BANDIT_POINTS
    assert slow.impacts[-1].label == "BANDIT"


def test_a_bandit_goes_down_once():
    round_ = make_round()
    figure = figure_at(round_, "barrel", True, 5.0)
    now = 5.0 + FIGURE_RISE + 0.1
    assert round_.shoot(figure.x, figure.y, now).is_hit
    assert not round_.shoot(figure.x, figure.y, now + 0.01).is_hit


def test_shooting_townsfolk_costs_you():
    round_ = make_round()
    round_.score = 200
    figure = figure_at(round_, "door", False, 5.0, variant=1)
    impact = round_.shoot(figure.x, figure.y, 5.0 + FIGURE_RISE + 0.1)
    assert not impact.is_hit
    assert "TOWNSFOLK" in impact.label
    assert round_.score == 200 - TOWNSFOLK_PENALTY
    assert round_.townsfolk_hit == 1
    assert round_.streak == 0
    assert round_.outcome() == ""
    assert not round_.summary().won, "a bystander down is not a clean street"
    assert make_round().summary().won, "and an untouched one is"


def test_the_penalty_never_takes_the_score_below_zero():
    round_ = make_round()
    figure = figure_at(round_, "door", False, 5.0)
    round_.shoot(figure.x, figure.y, 5.0 + FIGURE_RISE + 0.1)
    assert round_.score == 0


def test_a_hidden_figure_cannot_be_hit():
    round_ = make_round()
    figure = figure_at(round_, "door", True, 5.0)
    assert not round_.shoot(figure.x, figure.y, 5.0).is_hit


def test_a_miss_is_a_miss_with_a_sound():
    round_ = make_round()
    street = round_.street
    assert not round_.shoot(AREA.x + 5, street.walk_y + 10, 1.0).is_hit
    cues = round_.take_cues()
    assert "rifle_crack" in cues and "ricochet" in cues


def test_the_bell_tolls_when_the_round_opens():
    round_ = make_round()
    assert "bell_toll" in round_.take_cues()


def test_targets_lists_the_things_worth_shooting():
    round_ = make_round()
    round_.update(5.0)
    bandit = figure_at(round_, "door", True, 4.5)
    folk = figure_at(round_, "window", False, 4.5)
    bandit.lifetime = folk.lifetime = 6.0
    round_.update(5.0)
    # A bandit who has only just shown himself is not put ahead of the rail.
    assert round_.targets[0] is not bandit
    round_.update(7.0)
    targets = round_.targets
    assert targets.index(bandit) < targets.index(round_.bottles[0])
    assert targets[-1] is folk
    assert all(hasattr(t, "x") and hasattr(t, "y") for t in targets)


# --- drawing ----------------------------------------------------------------------------

@pytest.mark.parametrize("seconds", [0.0, 3.0, 22.0, 48.0, 61.0])
def test_draw_world_runs_at_every_stage(seconds):
    rng = np.random.default_rng(1)
    round_ = make_round(seed=11)
    now = 0.0
    while now < seconds:
        now += 1 / 30
        round_.update(now)
        if int(now * 2) != int((now - 1 / 30) * 2) and round_.targets:
            target = round_.targets[0]
            round_.shoot(target.x + rng.normal(0, 5), target.y + rng.normal(0, 5), now)
    canvas = np.zeros((945, 1512, 3), np.uint8)
    draw_world(canvas, round_, now)
    assert canvas.any()
    assert canvas[AREA.y + 5:AREA.bottom - 5, AREA.x + 5:AREA.right - 5].std() > 10


def test_draw_world_with_everyone_out_and_glass_in_the_air():
    round_ = make_round()
    for spot in round_.street.spots:
        round_.figures.append(Figure(spot=spot, bandit=len(round_.figures) % 2 == 0,
                                     variant=len(round_.figures) % 3, appeared_at=0.0,
                                     lifetime=9.0))
    bottle = round_.bottles[0]
    round_.shoot(bottle.x, bottle.y, 0.5)
    round_.update(0.8)
    canvas = np.zeros((945, 1512, 3), np.uint8)
    draw_world(canvas, round_, 0.8)
    assert canvas.any()


def test_draw_world_at_a_small_odd_size():
    area = Rect(10, 60, 300, 140)
    round_ = WesternRound(RoundOptions(area=area, seed=3))
    round_.update(0.0)
    round_.update(2.0)
    canvas = np.zeros((220, 320, 3), np.uint8)
    draw_world(canvas, round_, 2.0)
    assert canvas.any()


def test_the_emblem_draws():
    panel = np.zeros((164, 404, 3), np.uint8)
    draw_emblem(panel)
    assert panel.any()
    assert panel.std() > 10


def test_the_emblem_is_cached_and_fits_any_panel():
    small = np.zeros((80, 200, 3), np.uint8)
    draw_emblem(small)
    assert small.std() > 10
    again = np.zeros((164, 404, 3), np.uint8)
    draw_emblem(again)
    first = np.zeros((164, 404, 3), np.uint8)
    draw_emblem(first)
    assert np.array_equal(again, first)


# --- the town's layout never collides with itself ----------------------------------------

def test_name_boards_sit_clear_of_doors_windows_and_awnings():
    for seed in range(1, 12):
        street = make_round(seed=seed).street
        h = AREA.height
        for b in street.buildings:
            front = street.ground_y - b.top
            assert front >= 0.45 * h
            # Under the cornice there must be room for a name board above the awning.
            assert b.top + 0.15 * h <= street.ground_y - AWNING_Y * h + 0.001 * h
            if b.windows:
                assert front >= 0.55 * h
                assert b.style == "flat"
        for spot in street.spots:
            if spot.kind == "door":
                assert spot.clip.height == int(DOOR_H * h)
                assert spot.height >= 0.25 * h, "bandits must be big enough to see"


def test_hanging_signs_hang_clear_of_the_doors():
    for seed in range(1, 12):
        street = make_round(seed=seed).street
        doors = [s for s in street.spots if s.kind == "door"]
        for px, _ in street.sign_pivots:
            for door in doors:
                assert abs(px - door.x) > 0.17 * AREA.height


# --- weather and motion --------------------------------------------------------------

def test_tumbleweeds_roll_through_and_leave():
    round_ = make_round()
    for step in range(1, 120):
        round_.update(step * 0.1)
        if round_.tumbleweeds:
            break
    assert round_.tumbleweeds, "a tumbleweed should have blown in by now"
    weed = round_.tumbleweeds[0]
    x0 = weed.x
    round_.update(round_._last_tick + 0.1)
    assert weed.x != x0
    assert weed.hop(weed.born) == 0.0
    far = Tumbleweed(x=AREA.right + 1000, y=AREA.bottom, radius=20, vx=100, born=0.0)
    assert far.is_gone(AREA)
    assert not weed.is_gone(AREA)


def test_dust_motes_are_laid_out_for_the_round():
    round_ = make_round()
    assert round_.motes.shape[1] == 4
    assert (round_.motes[:, 0] >= 0).all() and (round_.motes[:, 0] <= 1).all()


def test_a_tumbling_can_never_draws_below_the_play_area():
    round_ = make_round()
    street = round_.street
    can = Can(slot=0, x=street.slot_x(0), base_y=street.rail_y, height=0.08 * AREA.height, hit_at=0.0)
    round_.cans.append(can)
    canvas = np.zeros((945, 1512, 3), np.uint8)
    draw_world(canvas, round_, 1.1)     # by now it has fallen a long way
    strip = canvas[AREA.bottom + 8:, :]
    assert strip.max() < 90, "the footer strip must stay dark"


# --- floaters ---------------------------------------------------------------------

def test_score_floaters_are_outlined_numerals_with_no_box():
    canvas = np.full((300, 400, 3), 200, np.uint8)
    draw_impact(canvas, Impact(x=200, y=200, score=30, at=0.0, ring=1, label="BOTTLE"), 0.05, 1.2)
    yellow = (canvas[..., 2] > 200) & (canvas[..., 1] > 180) & (canvas[..., 0] < 120)
    assert yellow.sum() > 40, "the numeral is yellow"
    dark = (canvas.min(axis=2) < 90).sum()
    assert 0 < dark < 1500, "only an outline is dark, never a slab"
    gone = np.full((300, 400, 3), 200, np.uint8)
    draw_impact(gone, Impact(x=200, y=200, score=30, at=0.0, ring=1, label="BOTTLE"), 1.3, 1.2)
    assert np.array_equal(gone, np.full((300, 400, 3), 200, np.uint8))


def test_floaters_drift_upwards_and_fade():
    def rows_with_ink(age):
        canvas = np.full((300, 400, 3), 200, np.uint8)
        draw_impact(canvas, Impact(x=200, y=200, score=30, at=0.0, ring=1), age, 1.2)
        ys = np.nonzero(canvas.min(axis=2) < 90)[0]
        return ys, canvas
    early, _ = rows_with_ink(0.2)
    late, _ = rows_with_ink(0.7)
    _, faded = rows_with_ink(1.1)
    assert late.mean() < early.mean(), "it rises"
    assert faded.min() > 90, "and fades: nothing is fully dark any more"


def test_floaters_are_kept_out_of_the_name_board_band():
    canvas = np.full((300, 400, 3), 200, np.uint8)
    draw_impact(canvas, Impact(x=200, y=130, score=30, at=0.0, ring=1), 0.3, 1.2, avoid=(60, 160))
    ys = np.nonzero(canvas.min(axis=2) < 90)[0]
    assert ys.min() > 160


def test_penalty_floaters_read_as_a_warning():
    canvas = np.full((300, 400, 3), 200, np.uint8)
    draw_impact(canvas, Impact(x=200, y=200, score=0, at=0.0, ring=None, label="TOWNSFOLK  -50"), 0.1, 1.2)
    red = canvas[..., 2].astype(int) - canvas[..., 0].astype(int)
    assert (red > 100).sum() > 50


# --- what the round leaves behind -----------------------------------------------------

def test_misses_leave_holes_in_the_wood_and_the_dirt():
    round_ = make_round()
    round_.figures.clear()
    street = round_.street
    round_.shoot(AREA.centre_x, street.ground_y - 20, 1.0)
    round_.shoot(AREA.x + 40, street.walk_y + 40, 1.1)
    kinds = [h.wood for h in round_.holes]
    assert kinds == [True, False]
    for i in range(MAX_HOLES + 20):
        round_.shoot(AREA.x + 5 + i % 7, street.walk_y + 40, 2.0 + i * 0.01)
    assert len(round_.holes) == MAX_HOLES


def test_a_shot_outside_the_play_area_leaves_no_hole():
    round_ = make_round()
    round_.shoot(5, 5, 1.0)
    assert not round_.holes


def test_a_hit_can_dents_the_rail():
    round_ = make_round()
    street = round_.street
    round_.bottles.clear()
    round_.cans.clear()
    can = Can(slot=0, x=street.slot_x(0), base_y=street.rail_y, height=0.08 * AREA.height)
    round_.cans.append(can)
    round_.shoot(can.x, can.y, 1.0)
    assert round_.holes and round_.holes[-1].wood
    assert abs(round_.holes[-1].y - street.rail_y) < 0.02 * AREA.height


def test_broken_glass_stays_on_the_table():
    round_ = make_round()
    bottle = round_.bottles[0]
    round_.shoot(bottle.x, bottle.y, 1.0)
    for step in range(1, 40):
        round_.update(1.0 + step * 0.05)
    assert not round_.shards
    assert round_.litter, "what fell should still be lying there"
    assert all(y > round_.street.rail_y for _, y, _ in round_.litter)


def test_the_light_changes_over_the_round():
    round_ = make_round(duration=60.0)
    assert round_.hour(0.0) == 0
    assert round_.hour(59.9) == HOURS - 1
    assert round_.hour(30.0) == HOURS // 2
    endless = make_round(duration=None)
    assert endless.hour(500.0) == 0
    area = (AREA.x, AREA.y, AREA.width, AREA.height)
    noon = _backdrop(area, 1512, 945, 7, 0)
    late = _backdrop(area, 1512, 945, 7, HOURS - 1)
    sky = (slice(AREA.y, AREA.y + 40), slice(AREA.x, AREA.right))
    assert late[sky][..., 0].mean() < noon[sky][..., 0].mean(), "less blue in the late sky"
    assert late[sky][..., 2].mean() >= noon[sky][..., 2].mean() - 5, "and no less red"


def test_the_tally_sits_in_the_hud_band_above_the_street():
    round_ = make_round()
    round_.bandits_down = 3
    canvas = np.zeros((945, 1512, 3), np.uint8)
    draw_world(canvas, round_, 1.0)
    band = canvas[:AREA.y - 2, 1512 // 4:1512 // 2]
    assert band.any(), "the count is drawn under the score, not on the fronts"
    assert (band.max(axis=2) > 200).sum() > 50, "and lettered brightly"


def test_only_so_many_figures_are_out_at_once():
    round_ = make_round()
    for step in range(1, 300):
        round_.update(step * 0.05)
        assert len(round_.figures) <= FIGURES_AT_ONCE


def test_doorways_are_lit_in_a_staggered_pattern():
    street = make_round().street
    lit = [b.door_lit for b in street.buildings if b.door_x is not None]
    assert True in lit and False in lit
    styles = {b.door_style for b in street.buildings}
    assert styles == {"batwing", "open"}
    assert len({b.trim for b in street.buildings}) > 1
    assert len({b.roof for b in street.buildings}) > 1


def test_a_bandit_is_hit_on_the_poncho_and_the_hat_but_not_beside_him():
    round_ = make_round()
    figure = figure_at(round_, "door", True, 5.0)
    now = 5.0 + FIGURE_RISE + 0.1
    fx, fy = figure.feet(now)
    h = figure.spot.height
    assert figure.contains(fx + h * 0.2, fy - h * 0.5, now)
    assert figure.contains(fx, fy - h * 0.95, now)
    assert not figure.contains(fx + h * 0.24, fy - h * 0.95, now)


@pytest.mark.parametrize("bandit, variant", [(True, 0), (False, 0), (False, 1)])
def test_what_is_drawn_of_a_figure_can_be_hit(bandit, variant):
    """The crown of a bandit's hat and the hands the townsfolk hold up stand
    well outside the body; a shot on either must count."""
    height, fx, fy = 170.0, 300.0, 400.0
    spot = Spot("door", fx, fy, height, Rect(0, 0, 600, 600))
    figure = Figure(spot=spot, bandit=bandit, variant=variant, appeared_at=0.0, lifetime=10.0)
    canvas = np.zeros((600, 600, 3), np.uint8)
    _draw_person(canvas, fx, fy, height, bandit, variant)
    ys, xs = np.nonzero(canvas.any(axis=2))
    missed = sum(not figure.contains(x, y, 1.0) for x, y in zip(xs, ys))
    assert missed <= 0.05 * len(xs)
    if bandit:
        assert figure.contains(fx, fy - height * 1.07, 1.0), "the crown of the hat"
    else:
        for side in (-1, 1):
            assert figure.contains(fx + side * height * 0.3, fy - height, 1.0), "a raised hand"


def test_every_hour_of_the_street_draws():
    round_ = make_round(seed=11, duration=60.0)
    canvas = np.zeros((945, 1512, 3), np.uint8)
    for hour in range(HOURS):
        now = hour * 60.0 / HOURS + 0.5
        round_.update(now)
        draw_world(canvas, round_, now)
        assert canvas[AREA.y + 5:AREA.bottom - 5, AREA.x + 5:AREA.right - 5].std() > 10


# --- light and volume -------------------------------------------------------------

def test_shadows_shear_to_the_right_and_toward_you():
    from handy.maps.western import LEAN_NOON, _sheared
    base = 100.0
    pts = _sheared([(10, 100), (10, 60)], base, LEAN_NOON)
    assert pts[0] == (10, 100), "a point on the ground stays put"
    x, y = pts[1]
    assert x > 10 and y > 100, "the higher the point, the further right and nearer it lands"
    later = _sheared([(10, 60)], base, LEAN_NOON * 2)[0]
    assert later[0] > x, "a lower sun throws it further"


def test_a_bandit_in_a_doorway_throws_a_shadow_on_the_boards():
    from handy.maps.western import draw_figure
    round_ = make_round()
    round_.figures.clear()
    figure = figure_at(round_, "door", True, 5.0)
    now = 5.0 + FIGURE_RISE + 0.2
    street = round_.street
    plain = np.full((945, 1512, 3), 180, np.uint8)
    drawn = plain.copy()
    draw_figure(drawn, figure, now)
    fx, fy = figure.feet(now)
    boards = (slice(int(fy) + 4, street.walk_y - 2), slice(int(fx) + 20, int(fx) + 70))
    assert drawn[boards].mean() < plain[boards].mean() - 15, "the boards to his right are in his shadow"


def test_a_bandit_has_a_lit_side_and_a_shaded_side():
    from handy.maps.western import draw_figure
    round_ = make_round()
    round_.figures.clear()
    figure = figure_at(round_, "door", True, 5.0, variant=0)
    now = 5.0 + FIGURE_RISE + 0.2
    canvas = np.full((945, 1512, 3), 120, np.uint8)
    draw_figure(canvas, figure, now)
    fx, fy = figure.feet(now)
    H = figure.spot.height
    left = canvas[int(fy - 0.46 * H), int(fx - 0.2 * H)].astype(int)
    right = canvas[int(fy - 0.46 * H), int(fx + 0.21 * H)].astype(int)
    assert left.sum() > right.sum() + 20, "the poncho is lit on the sun side"
    assert left[2] >= left[0], "and the light is warm"


def test_bottles_throw_a_shadow_along_the_rail():
    from handy.maps.western import GLASS_COLORS, Bottle, draw_bottle
    canvas = np.full((400, 400, 3), 190, np.uint8)
    bottle = Bottle(slot=0, x=150, base_y=300, height=90, color=GLASS_COLORS[0])
    draw_bottle(canvas, bottle)
    right = canvas[300:310, 168:195].mean()
    assert right < 180, "a shadow lies on the plank to the right of the bottle"
    column = canvas[230:290, 134:166]
    assert column.max(axis=2).max() > 230, "and the glass carries a specular stripe"
    assert column.min(axis=2).min() < 90, "over a dark rim"


def test_a_bottle_bursts_into_a_proper_spray():
    round_ = make_round()
    bottle = round_.bottles[0]
    round_.shoot(bottle.x, bottle.y, 1.0)
    assert len(round_.shards) >= 20
    assert max(s.size for s in round_.shards) > 4


def test_floaters_are_one_bold_line_with_no_type_label():
    canvas = np.full((300, 400, 3), 200, np.uint8)
    draw_impact(canvas, Impact(x=200, y=200, score=30, at=0.0, ring=1, label="BOTTLE"), 0.3, 1.2)
    white = ((canvas[..., 0] > 235) & (canvas[..., 1] > 235) & (canvas[..., 2] > 235)).sum()
    assert white == 0, "no white BOTTLE caption above the number"
    ys = np.nonzero(canvas.min(axis=2) < 90)[0]
    assert ys.max() - ys.min() < 60, "a single line of lettering"


def test_a_quick_draw_is_named_on_its_one_line():
    plain = np.full((300, 600, 3), 200, np.uint8)
    draw_impact(plain, Impact(x=300, y=200, score=200, at=0.0, ring=0, label="BANDIT"), 0.3, 1.2)
    quick = np.full((300, 600, 3), 200, np.uint8)
    draw_impact(quick, Impact(x=300, y=200, score=200, at=0.0, ring=0, label="QUICK DRAW"), 0.3, 1.2)
    wide = np.nonzero(quick.min(axis=2) < 90)[1]
    narrow = np.nonzero(plain.min(axis=2) < 90)[1]
    assert wide.max() - wide.min() > (narrow.max() - narrow.min()) * 1.8


def test_floaters_pop_then_settle():
    def ink_rows(age):
        canvas = np.full((300, 400, 3), 200, np.uint8)
        draw_impact(canvas, Impact(x=200, y=200, score=30, at=0.0, ring=1), age, 1.2)
        ys = np.nonzero(canvas.min(axis=2) < 90)[0]
        return ys.max() - ys.min()
    assert ink_rows(0.01) > ink_rows(0.3) * 1.2, "it lands big and settles"


def test_the_street_has_ruts_debris_and_sheared_barrel_shadows():
    round_ = make_round(seed=7)
    street = round_.street
    area = (AREA.x, AREA.y, AREA.width, AREA.height)
    noon = _backdrop(area, 1512, 945, 7, 0)
    bx, by, bw = street.barrels[0]
    beside = noon[by - 6:by - 2, bx + bw // 2 + 10:bx + bw // 2 + 40].mean()
    clear = noon[by - 6:by - 2, bx - bw // 2 - 60:bx - bw // 2 - 30].mean()
    assert beside < clear - 10, "the barrel's shadow lies to its right, where the sun puts it"
    sand = noon[street.walk_y + 40:AREA.bottom, AREA.x:AREA.right]
    assert sand.std() > 8, "the sand carries ruts, prints and debris rather than a flat gradient"


def test_the_card_carries_a_carved_sign():
    panel = np.zeros((164, 404, 3), np.uint8)
    draw_emblem(panel)
    sign = panel[120:158, 110:300]
    assert (sign.min(axis=2) < 60).sum() > 200, "dark carved letters"
    wood = sign.reshape(-1, 3).mean(axis=0)
    assert wood[2] > wood[0] + 20, "on warm wood"
    sky = panel[:20, 180:220]
    assert sky[..., 2].mean() > sky[..., 0].mean(), "under a dusk sky"
