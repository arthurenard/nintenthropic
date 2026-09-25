import time

import cv2
import numpy as np
import pytest

from handy.game import Rect, RoundOptions
from handy.maps.zombies import (BITE_DAMAGE, BODY_HEALTH, CONTACT_DISTANCE,
                                FULL_HEALTH, LOW_HEALTH, MAX_WALKERS,
                                FALL, MOONLIGHT, MUZZLE_FLASH, NEAR_PLANE, SETTLED,
                                STAGGER, WAVE_SECONDS, Perspective, Walker, ZombieRound,
                                _bloom, _draw_fallen, _environment, _fill, _fixed, _look,
                                _skyline, draw_emblem, draw_hud, draw_stains, draw_walker,
                                draw_world)

AREA = Rect(0, 224, 1232, 440)
VIEW = Perspective.for_area(AREA)
#: Every way a walker can move; the spawner picks among exactly these.
GAITS = ("shamble", "lurch", "limp", "crawl")


def make_round(**options) -> ZombieRound:
    options.setdefault("seed", 4)
    return ZombieRound(RoundOptions(area=AREA, **options))


def walker_at(distance: float, lane: float = 0.0, **kwargs) -> Walker:
    defaults = dict(speed=0.8, phase=0.0, sway=0.0, build=1.0)
    return Walker(lane=lane, distance=distance, **{**defaults, **kwargs})


# --- the projection --------------------------------------------------------

def test_the_near_plane_stands_on_the_bottom_of_the_play_area():
    assert VIEW.ground_y(NEAR_PLANE) == pytest.approx(AREA.bottom)


def test_distance_reads_as_distance():
    """Further away is smaller, and stands higher up the picture."""
    near, far = 4.0, 20.0
    assert VIEW.height_px(far) < VIEW.height_px(near)
    assert VIEW.ground_y(far) < VIEW.ground_y(near)
    assert VIEW.ground_y(1000.0) == pytest.approx(VIEW.horizon, abs=1.0)


def test_apparent_size_halves_when_the_distance_doubles():
    assert VIEW.height_px(20.0) == pytest.approx(VIEW.height_px(10.0) / 2)


def test_lanes_spread_out_as_they_come_closer():
    assert VIEW.screen_x(0.0, 10.0) == AREA.centre_x
    assert (VIEW.screen_x(2.0, 4.0) - AREA.centre_x
            > VIEW.screen_x(2.0, 12.0) - AREA.centre_x)


# --- what you can hit ------------------------------------------------------

def test_the_silhouette_and_the_hitbox_are_the_same_measurements():
    figure = walker_at(8.0).figure(VIEW, 0.0)

    assert figure.hit_zone(*figure.head) == "head"
    assert figure.hit_zone(figure.x, figure.hip_y) == "body"
    assert figure.hit_zone(figure.x, figure.ground_y + 40) is None
    assert figure.hit_zone(figure.x + figure.height, figure.hip_y) is None


def painted(walker: Walker, now: float = 0.0) -> np.ndarray:
    """The walker's parts as the game fills them, alone on black: every piece
    of its head white and the rest of it red, without the moon or the eyes."""
    canvas = np.zeros((AREA.bottom + 56, AREA.width, 3), np.uint8)
    figure = walker.figure(VIEW, now)
    pieces = figure.mesh.pieces
    _fill(canvas, pieces, _fixed(figure.outline),
          [(255, 255, 255) if piece.zone == "head" else (0, 0, 255) for piece in pieces])
    return canvas


def drawn(walker: Walker, now: float = 0.0) -> np.ndarray:
    """Which pixels the game paints the walker over - the moon's rim, the
    shading, the face and the eyes included. Drawn once on black and once on
    white, a pixel of the figure differs from both; its shadow, which only
    darkens, and the glow of its eyes, which only adds light, do not."""
    on = []
    for ground in (0, 255):
        canvas = np.full((AREA.bottom + 56, AREA.width, 3), ground, np.uint8)
        draw_walker(canvas, walker, VIEW, now)
        on.append(canvas)
    return (on[0].max(axis=2) > 8) & (on[1].min(axis=2) < 247)


def spawned(enemy: str, count: int, distance: float, seed: int = 3):
    """Walkers as the spawner makes them, every gait and build, stood in the road."""
    round_ = make_round(seed=seed, enemy=enemy)
    for index in range(count):
        walker = round_._spawn(wave=1 + index % 5)
        walker.distance, walker.lane = distance, 0.0
        yield walker


def unhittable(walker: Walker, now: float = 0.0, samples: int = 1500) -> tuple[int, int]:
    """How many of (a fair sample of) the pixels drawn for it a shot misses."""
    figure = walker.figure(VIEW, now)
    ys, xs = np.nonzero(drawn(walker, now))
    pick = np.random.default_rng(0).permutation(len(xs))[:samples]
    missed = sum(figure.hit_zone(float(xs[i]), float(ys[i])) is None for i in pick)
    return missed, len(pick)


@pytest.mark.parametrize("enemy", ["zombies", "robots"])
def test_a_shot_at_the_middle_of_the_drawn_skull_is_a_headshot(enemy):
    """However far forward it leans - and a lurcher leans a long way - the head
    that is tested is the head that was painted."""
    gaits = set()
    for walker in spawned(enemy, 120, 4.0):
        figure = walker.figure(VIEW, 0.0)
        ys, xs = np.nonzero(painted(walker).min(axis=2) > 127)
        assert figure.hit_zone(xs.mean(), ys.mean()) == "head", (walker.gait, walker.hunch)
        gaits.add(walker.gait)
    assert gaits == ({"shamble"} if enemy == "robots" else set(GAITS))


@pytest.mark.parametrize("enemy", ["zombies", "robots"])
def test_every_pixel_of_the_drawn_skull_is_a_head_shot(enemy):
    """Crown, jaw and hair: nothing painted as head scores as body."""
    for walker in spawned(enemy, 30, 3.0):
        figure = walker.figure(VIEW, 0.0)
        ys, xs = np.nonzero(painted(walker).min(axis=2) > 127)
        body = sum(figure.hit_zone(float(x), float(y)) != "head" for x, y in zip(xs, ys))
        assert body <= 0.005 * len(xs), (walker.gait, body, len(xs))


@pytest.mark.parametrize("enemy", ["zombies", "robots"])
@pytest.mark.parametrize("distance", [2.2, 6.0, 13.0])
def test_every_part_of_the_drawn_figure_can_be_hit(enemy, distance):
    """The moonlit edge, the reaching hands, the fingers, the torn hem: what is
    drawn is what can be shot, near and far."""
    for walker in spawned(enemy, 16 if distance < 3 else 40, distance):
        missed, total = unhittable(walker)
        assert missed <= 0.02 * total, (walker.gait, missed, total)
        figure = walker.figure(VIEW, 0.0)
        for *_, wrist in figure.arms():
            assert figure.hit_zone(*wrist) is not None, walker.gait


@pytest.mark.parametrize("enemy", ["zombies", "robots"])
def test_a_staggering_one_is_hit_where_it_is_drawn(enemy):
    """Thrown aside by a body shot, arms flung up: the hitbox goes with it."""
    for walker in spawned(enemy, 12, 3.5):
        walker.staggered_until = STAGGER - 0.06  # hit a few hundredths ago
        missed, total = unhittable(walker, now=0.0)
        assert missed <= 0.02 * total, (walker.gait, missed, total)
        assert walker.figure(VIEW, 0.0).recoil > 0.5


@pytest.mark.parametrize("enemy", ["zombies", "robots"])
def test_the_hitbox_has_no_empty_room_in_it(enemy):
    """The body can be hit where it is drawn, not in the air around it: every
    point that counts as a body shot is within a hair of something painted.
    (The head keeps its fixed, generous circle - that is the game.)"""
    for walker in spawned(enemy, 24, 4.0):
        figure = walker.figure(VIEW, 0.0)
        mask = drawn(walker).astype(np.uint8)
        far = cv2.distanceTransform(1 - mask, cv2.DIST_L2, 3)
        x0, y0, x1, y1 = (int(v) for v in figure.bounds)
        body = [(x, y) for y in range(y0, y1, 2) for x in range(x0, x1, 2)
                if figure.hit_zone(x, y) == "body"]
        empty = sum(far[y, x] > figure.margin + 1.5 for x, y in body)
        assert empty <= 0.02 * len(body), (walker.gait, empty, len(body))


def test_the_moon_rims_only_the_side_it_is_on():
    """A cold edge down the side towards the moon, up and to the right, and
    none down the far side: lit, not outlined like a sticker."""
    walker = walker_at(3.0, lane=-1.0)
    canvas = np.full((AREA.bottom + 56, AREA.width, 3), 40, np.uint8)
    draw_walker(canvas, walker, VIEW, 0.0)
    mask = drawn(walker)
    figure = walker.figure(VIEW, 0.0)
    near, far = [], []
    for y in range(int(figure.head[1]), int(figure.ground_y - figure.height * 0.1), 3):
        columns = np.flatnonzero(mask[y])
        if len(columns) < 6:
            continue
        brightness = canvas[y].max(axis=1)
        far.append(int(brightness[columns[:2]].max()))
        near.append(int(brightness[columns[-2:]].max()))
    assert np.median(near) > 150, "a bright rim down the side towards the moon"
    assert np.percentile(far, 95) < 110, "and no bright edge down the far side"


def test_each_one_is_dressed_by_its_seed_alone():
    """The same seed, the same rags, every time; and a crowd of them is not one
    mannequin over and over: builds, clothes, sleeves and hair all vary."""
    assert _look(1234) == _look(1234)
    looks = [_look(seed) for seed in range(80)]
    assert {look.clothes for look in looks} == {"shirt", "jacket", "coat", "gown"}
    assert len({round(look.width, 2) for look in looks}) > 15
    assert any(not all(look.sleeves) for look in looks), "some have lost a sleeve"
    assert {look.hair for look in looks} == {0, 1, 2}
    assert len({look.cloth for look in looks}) >= 4


def test_the_same_night_draws_the_same_way_twice():
    """A --seed replays a night to the pixel: nothing in how they look is
    left to chance, or to the world's own generator."""
    frames = []
    for _ in range(2):
        round_ = make_round(density=3, seed=9)
        for tick in range(30):
            round_.update(tick * 0.25)
        canvas = np.zeros((AREA.bottom + 56, AREA.width + 48, 3), np.uint8)
        draw_world(canvas, round_, 7.5)
        frames.append(canvas)
    assert round_.walkers and np.array_equal(*frames)


def test_the_head_sits_above_the_shoulders_and_is_the_smaller_target():
    figure = walker_at(6.0).figure(VIEW, 0.0)
    assert figure.head[1] < figure.shoulder_y < figure.hip_y < figure.ground_y
    assert figure.head_radius < figure.half_shoulder


def test_a_walker_far_enough_away_is_a_much_harder_shot():
    near = walker_at(4.0).figure(VIEW, 0.0)
    far = walker_at(24.0).figure(VIEW, 0.0)
    assert far.head_radius < near.head_radius / 4


def test_the_fog_swallows_the_distant_ones():
    assert walker_at(3.0).figure(VIEW, 0.0).fog == 0.0
    assert walker_at(30.0).figure(VIEW, 0.0).fog > 0.7


# --- shooting them ---------------------------------------------------------

def test_a_head_shot_drops_one_outright():
    round_ = make_round()
    round_.walkers = [walker_at(9.0)]
    figure = round_.walkers[0].figure(VIEW, 0.0)

    impact = round_.shoot(*figure.head, 0.0)

    assert impact.label == "HEADSHOT" and impact.ring == 0
    assert round_.walkers == [] and round_.kills == 1
    assert round_.perfect == 1


def test_body_shots_only_slow_them_down():
    round_ = make_round()
    round_.walkers = [walker_at(9.0)]
    walker = round_.walkers[0]
    figure = walker.figure(VIEW, 0.0)

    for shot in range(BODY_HEALTH - 1):
        impact = round_.shoot(figure.x, figure.hip_y, shot * 0.2)
        assert impact.is_hit and impact.ring == 2
        assert walker in round_.walkers
        assert walker.staggered_until > shot * 0.2, "it is knocked off its stride"

    final = round_.shoot(figure.x, figure.hip_y, 1.0)
    assert final.label == "DOWN" and final.ring == 1
    assert round_.walkers == [] and round_.perfect == 0


def test_a_stagger_wears_off():
    walker = walker_at(9.0, staggered_until=1.0)
    before = walker.distance
    walker.advance(0.1, now=0.5)  # staggered: barely moves
    crawled = before - walker.distance
    walker.advance(0.1, now=2.0)  # recovered: full pace
    assert (walker.distance + crawled) < before - crawled


def test_the_far_shot_is_worth_more_than_the_near_one():
    near_round, far_round = make_round(), make_round()
    for round_, distance in ((near_round, 3.0), (far_round, 25.0)):
        round_.walkers = [walker_at(distance)]
        figure = round_.walkers[0].figure(VIEW, 0.0)
        round_.shoot(*figure.head, 0.0)
    assert far_round.score > near_round.score * 1.5


def test_the_nearest_one_takes_the_shot():
    round_ = make_round()
    near, far = walker_at(4.0), walker_at(16.0)
    round_.walkers = [far, near]
    figure = near.figure(VIEW, 0.0)

    round_.shoot(figure.x, figure.hip_y, 0.0)
    assert near.health < BODY_HEALTH and far.health == BODY_HEALTH


def test_shooting_the_empty_road_is_just_a_miss():
    round_ = make_round()
    round_.walkers = [walker_at(9.0, lane=5.0)]
    assert not round_.shoot(AREA.x + 5, AREA.bottom - 5, 0.0).is_hit
    assert round_.streak == 0


# --- them reaching you -----------------------------------------------------

def test_one_that_reaches_you_takes_a_bite_out_of_you():
    round_ = make_round()
    arrived = walker_at(CONTACT_DISTANCE - 0.1)
    round_.walkers = [arrived]

    round_.update(0.0)

    assert round_.health == FULL_HEALTH - BITE_DAMAGE
    assert arrived not in round_.walkers, "you shove it off"
    assert "hurt" in round_.take_cues()


def test_enough_bites_and_the_night_is_over():
    round_ = make_round(duration=600)
    for tick in range(FULL_HEALTH // BITE_DAMAGE + 1):
        round_.walkers.append(walker_at(0.5))
        round_.update(tick * 0.1)

    assert round_.health == 0
    assert round_.is_lost and round_.is_over(1.0)
    assert round_.summary().outcome == "OVERRUN"
    assert not round_.summary().won


def test_the_health_bar_has_a_segment_for_every_bite_you_can_take():
    round_ = make_round(duration=600)
    bites, notches = 0, []
    while not round_.is_lost:
        hud = np.zeros((720, 400, 3), np.uint8)
        draw_hud(hud, round_, (20, 0), 0.0)
        row = hud[153, 21:260]  # through the middle of the bar, inside its frame
        notches.append(np.flatnonzero((row == (20, 20, 20)).all(axis=1)))
        lit = np.flatnonzero(((row != (30, 28, 27)) & (row != (20, 20, 20))).any(axis=1))
        if bites:
            assert lit.max() + 1 in notches[0], "after a bite the bar stops on a notch"
        round_.walkers.append(walker_at(0.5))
        round_.update(bites * 0.1)
        bites += 1
    assert bites == 6
    assert len(notches[0]) + 1 == bites


def test_making_it_to_the_end_of_the_round_is_surviving():
    """And the card has to be able to tell that apart from being overrun: both
    are outcomes, and one of them is a win."""
    round_ = make_round(duration=30)
    round_.update(0.0)
    assert round_.summary().outcome == "SURVIVED"
    assert round_.summary().won


def test_a_kill_leaves_a_stain_on_the_road():
    round_ = make_round()
    round_.walkers = [walker_at(8.0)]
    round_.shoot(*round_.walkers[0].figure(VIEW, 0.0).head, 0.0)
    assert len(round_.stains) == 1


def test_the_road_does_not_fill_up_with_stains_forever():
    round_ = make_round()
    for index in range(200):
        round_.walkers = [walker_at(8.0, lane=index % 5)]
        round_.shoot(*round_.walkers[0].figure(VIEW, 0.0).head, index * 0.01)
    assert len(round_.stains) <= 90


# --- the night getting worse ----------------------------------------------

def test_waves_come_round_on_the_clock():
    round_ = make_round(duration=600)
    round_.update(0.0)
    assert round_.wave(0.0) == 1
    assert round_.wave(WAVE_SECONDS + 0.1) == 2
    assert round_.wave(WAVE_SECONDS * 3 + 0.1) == 4


def test_later_waves_come_faster_and_harder():
    """Same fifteen seconds of wave one, versus fifteen seconds of wave four."""
    round_ = make_round(duration=600, density=2)
    spawns = {1: 0, 4: 0}
    speeds = {1: [], 4: []}

    now = 0.0
    while now < WAVE_SECONDS * 4:
        now += 0.1
        standing = len(round_.walkers)
        round_.update(now)
        wave = round_.wave(now)
        if len(round_.walkers) > standing and wave in spawns:
            spawns[wave] += 1
            speeds[wave].append(round_.walkers[-1].speed)
        # A player who is keeping up clears the road before anything arrives.
        round_.walkers = [w for w in round_.walkers if w.distance > 5.0]

    assert spawns[4] > spawns[1], "they arrive more often"
    assert max(speeds[4]) > max(speeds[1]), "and they walk faster"


def test_the_road_never_becomes_completely_impossible():
    round_ = make_round(duration=6000, density=3)
    for tick in range(1200):
        round_.update(tick * 0.25)
        round_.walkers = [w for w in round_.walkers if w.distance > 3.0]  # you shoot
    assert len(round_.walkers) <= MAX_WALKERS


def test_a_spawn_announces_itself():
    round_ = make_round()
    round_.update(0.0)
    assert "groan" in round_.take_cues()


def test_they_walk_towards_you_and_line_up_on_you():
    walker = walker_at(20.0, lane=6.0)
    for _ in range(200):
        walker.advance(0.05, now=0.0)
    assert walker.distance < 20.0
    assert abs(walker.lane) < 6.0, "it is coming for you, not past you"


# --- drawing ---------------------------------------------------------------

def test_the_world_draws_at_every_stage():
    round_ = make_round(density=3)
    for tick in range(40):
        round_.update(tick * 0.25)
    round_.walkers.append(walker_at(3.0))
    round_.shoot(*round_.walkers[0].figure(VIEW, 0.0).head, 10.0)
    round_.bitten_at = 10.0

    canvas = np.zeros((AREA.bottom + 56, AREA.width + 48, 3), np.uint8)
    draw_world(canvas, round_, 10.1)
    assert canvas.any()


def test_the_moon_bloom_is_the_full_size_blur_to_within_a_couple_of_levels():
    height, width, moon = 400, 640, (486, 60)
    for radius in (136, 48, 20):
        full = np.zeros((height, width, 3), np.uint8)
        cv2.circle(full, moon, radius, MOONLIGHT, -1, cv2.LINE_AA)
        full = cv2.GaussianBlur(full, (0, 0), radius / 2.0).astype(int)
        assert np.abs(_bloom(height, width, moon, radius, MOONLIGHT) - full).max() <= 2


def test_the_backdrop_builds_in_well_under_a_second():
    """It is built on the first frame at a new window size, where any delay is
    a freeze the player feels; the moon's glow alone used to take three
    seconds of it."""
    area = Rect(31, 294, 1450, 578)
    started = time.perf_counter()
    _environment.__wrapped__((area.x, area.y, area.width, area.height), 1512, 945, 0,
                             _skyline(area, 0))
    assert time.perf_counter() - started < 1.0


def test_a_walker_too_small_to_see_is_skipped_without_error():
    round_ = make_round()
    round_.walkers = [walker_at(4000.0)]
    canvas = np.zeros((AREA.bottom + 56, AREA.width + 48, 3), np.uint8)
    draw_world(canvas, round_, 0.0)  # must not raise
    assert canvas.any()


def test_the_card_art_draws():
    panel = np.zeros((220, 360, 3), np.uint8)
    draw_emblem(panel)
    assert panel.any()


# --- how they come, and how it gets worse ----------------------------------

def test_every_gait_keeps_its_head_above_its_feet_and_inside_its_hitbox():
    for gait in GAITS:
        figure = walker_at(6.0, gait=gait, seed=3).figure(VIEW, 0.0)
        assert figure.head[1] < figure.ground_y
        assert figure.hit_zone(*figure.head) == "head", gait
        # What it stands on: its feet, or a crawler's hands on the road.
        planted = ([leg[3][:2] for leg in figure.legs()] if gait != "crawl"
                   else [arm[2] for arm in figure.arms()])
        for point in planted:
            assert point[1] > figure.ground_y - figure.height * 0.1, gait
            assert figure.hit_zone(*point) == "body", gait


def test_a_crawler_is_the_low_target():
    standing = walker_at(6.0).figure(VIEW, 0.0)
    crawling = walker_at(6.0, gait="crawl").figure(VIEW, 0.0)
    assert crawling.head[1] > standing.hip_y, "its head is below a standing hip"


def test_later_waves_start_closer():
    round_ = make_round(seed=2)
    first = [round_._spawn(1).distance for _ in range(40)]
    fourth = [round_._spawn(4).distance for _ in range(40)]
    assert max(fourth) < max(first) and min(fourth) < min(first)


def test_the_walkers_come_in_every_shape():
    round_ = make_round(seed=5)
    gaits = {round_._spawn(3).gait for _ in range(200)}
    assert gaits == set(GAITS)


def test_a_stain_remembers_when_it_was_made():
    round_ = make_round()
    round_.walkers = [walker_at(8.0)]
    round_.shoot(*round_.walkers[0].figure(VIEW, 0.0).head, 4.5)
    x, y, radius, at, _seed = round_.stains[0]
    assert at == 4.5 and radius > 0


def test_the_heartbeat_shows_only_when_you_are_nearly_done():
    canvas = np.zeros((AREA.bottom + 56, AREA.width + 48, 3), np.uint8)
    round_ = make_round()
    draw_world(canvas, round_, 0.0)
    corner_well = canvas[4, 4].astype(int)
    round_.health = LOW_HEALTH - 1
    draw_world(canvas, round_, 0.0)  # on the beat
    corner_low = canvas[4, 4].astype(int)
    assert corner_low[2] > corner_well[2], "red at the edges"


def test_the_muzzle_flash_is_over_in_a_blink():
    round_ = make_round()
    round_.walkers = [walker_at(4.0)]
    figure = round_.walkers[0].figure(VIEW, 0.0)
    round_.shoot(figure.x, figure.hip_y, 1.0)
    assert round_.last_shot() == 1.0
    canvas = np.zeros((AREA.bottom + 56, AREA.width + 48, 3), np.uint8)
    draw_world(canvas, round_, 1.0)  # must draw the lit frame without error
    draw_world(canvas, round_, 1.0 + MUZZLE_FLASH * 2)
    assert canvas.any()


# --- round two: legibility ---------------------------------------------------

def test_the_night_opens_with_a_few_already_on_the_road():
    round_ = make_round(density=3)
    round_.update(0.0)
    assert len(round_.walkers) == 3
    round_.update(0.1)
    assert len(round_.walkers) == 3, "after that they come one at a time"


def test_score_popups_stack_instead_of_overlapping():
    from handy.game import Impact
    from handy.maps.zombies import draw_popups

    canvas = np.zeros((AREA.bottom + 56, AREA.width + 48, 3), np.uint8)
    impacts = [Impact(x=400, y=500, score=100, at=0.0, ring=0, label="HEADSHOT"),
               Impact(x=404, y=503, score=80, at=0.05, ring=1, label="DOWN")]
    draw_popups(canvas, impacts, 0.1, 1.1, VIEW)
    lit = np.argwhere(canvas.any(axis=2))
    assert lit[:, 0].min() < 400, "the second popup was pushed up clear of the first"


def test_pools_keep_spreading_and_dry_to_black_over_the_night():
    from handy.maps.zombies import draw_stains

    round_ = make_round()
    round_.stains = [(AREA.centre_x, AREA.bottom - 60, 20.0, 0.0, 5)]
    fresh = np.zeros((AREA.bottom + 56, AREA.width + 48, 3), np.uint8)
    fresh[:] = 60
    old = fresh.copy()
    draw_stains(fresh, round_, 0.5)
    draw_stains(old, round_, 50.0)
    red_fresh = (fresh[:, :, 2].astype(int) - fresh[:, :, 0]) > 8
    red_old = (old[:, :, 2].astype(int) - old[:, :, 0]) > 8
    assert red_old.sum() > red_fresh.sum(), "the pool has spread"
    assert old[red_old].mean() < fresh[red_fresh].mean(), "and darkened"


def test_the_eyes_catch_the_moon_even_a_long_way_off():
    from handy.maps.zombies import EYESHINE, draw_walker

    canvas = np.zeros((AREA.bottom + 56, AREA.width + 48, 3), np.uint8)
    walker = walker_at(22.0)
    draw_walker(canvas, walker, VIEW, 0.0)
    figure = walker.figure(VIEW, 0.0)
    hx, hy = int(figure.head[0]), int(figure.head[1])
    patch = canvas[hy - 4:hy + 5, hx - 6:hx + 7].astype(int)
    assert (patch[:, :, 1] >= EYESHINE[1] - 40).any(), "something pale at the head"


# --- round three: the look ---------------------------------------------------

def test_the_help_text_sits_on_a_dark_strip_under_the_road():
    canvas = np.zeros((AREA.bottom + 56, AREA.width + 48, 3), np.uint8)
    draw_world(canvas, make_round(), 0.0)
    road = canvas[AREA.bottom - 30:AREA.bottom - 10].mean()
    strip = canvas[AREA.bottom + 10:].mean()
    assert strip < road * 0.5, "the strip is much darker than the road above it"


def test_rain_falls_with_depth_and_leaves_rings_on_the_road():
    from handy.maps.zombies import draw_rain

    canvas = np.zeros((AREA.bottom + 56, AREA.width + 48, 3), np.uint8)
    draw_rain(canvas, AREA, 2.0, drops=120, view=VIEW)
    near = canvas[AREA.bottom - 120:AREA.bottom].astype(int)
    far = canvas[int(VIEW.horizon):int(VIEW.horizon) + 40].astype(int)
    assert near.max() > far.max(), "the near streaks are the bright ones"
    assert not canvas[:AREA.y - 1].any(), "nothing falls over the HUD"


def test_a_walker_has_a_dark_core_and_a_moonlit_edge():
    from handy.maps.zombies import draw_walker

    canvas = np.zeros((AREA.bottom + 56, AREA.width + 48, 3), np.uint8)
    walker = walker_at(3.0)
    draw_walker(canvas, walker, VIEW, 0.0)
    figure = walker.figure(VIEW, 0.0)
    x, y = int(figure.x), int((figure.shoulder_y + figure.hip_y) / 2)
    core = canvas[y, x].astype(int)
    assert core.max() < 90, "the body is dark"
    band = canvas[y - 6:y + 6, x:x + int(figure.half_shoulder * 1.3)].astype(int)
    assert band[:, :, 0].max() > 150, "a cold, bright rim on the moon side"


def killed(distance: float = 5.0, at: float = 0.0, **options) -> tuple[ZombieRound, Walker]:
    """A round with one of them just put down by a head shot."""
    round_ = make_round(duration=600, **options)
    walker = walker_at(distance, robot=options.get("enemy") == "robots")
    round_.walkers = [walker]
    round_.shoot(*walker.figure(VIEW, at).head, at)
    return round_, walker


def test_the_dead_are_drawn_to_the_size_of_the_living():
    round_, walker = killed(5.0)
    figure = walker.figure(VIEW, 0.0)
    round_.stains = []  # the body alone, without its pool
    canvas = np.zeros((AREA.bottom + 56, AREA.width + 48, 3), np.uint8)
    draw_stains(canvas, round_, 30.0)
    lit = np.argwhere(canvas.any(axis=2))
    width = lit[:, 1].max() - lit[:, 1].min()
    tall = lit[:, 0].max() - lit[:, 0].min()
    assert width > figure.height * 0.8, "a body lying down is as long as one standing"
    assert tall < figure.height * 0.4, "and lies low across the road"


def test_a_kill_goes_over_before_it_lies_still():
    """Put down, it falls - still partly upright a moment later - and within
    half a second lies flat on the road, where it stays."""
    round_, walker = killed(4.0, at=1.0)
    figure = walker.figure(VIEW, 1.0)

    def standing(now: float) -> float:
        canvas = np.zeros((AREA.bottom + 56, AREA.width + 48, 3), np.uint8)
        _draw_fallen(canvas, VIEW, walker, 1.0, True, now)
        rows = np.flatnonzero(canvas.max(axis=(1, 2)) > 8)
        return (figure.ground_y - rows.min()) / figure.height

    assert FALL <= 0.5, "feedback in play is short"
    assert standing(1.0 + FALL * 0.3) > 0.6, "still going over"
    assert standing(1.0 + FALL + 0.05) < 0.4, "then flat"
    assert standing(1.0 + FALL + 5.0) < 0.4, "and it stays down"


def test_the_settled_dead_become_part_of_the_road():
    """A kill that has stopped changing is painted into the road once, and the
    road looks exactly as it would drawn from scratch."""
    round_ = make_round(duration=600)
    for index in range(3):
        walker = walker_at(5.0 + index, lane=index - 1.0)
        round_.walkers = [walker]
        round_.shoot(*walker.figure(VIEW, float(index)).head, float(index))
    later = 2.0 + SETTLED + 5.0
    frames = []
    for fresh in (True, False, True):
        if fresh:
            round_.road = None
        canvas = np.zeros((AREA.bottom + 56, AREA.width + 48, 3), np.uint8)
        draw_world(canvas, round_, later)
        frames.append(canvas)
    assert round_.road is not None and round_.road[2] >= 2.0, "all three are in the road"
    assert np.array_equal(frames[0], frames[1]) and np.array_equal(frames[1], frames[2])
    blank = np.zeros_like(frames[0])
    draw_stains(blank, round_, later, after=later - SETTLED)
    assert not blank.any(), "and none of them is drawn again each frame"


def test_a_machine_goes_over_and_lies_there_without_bleeding():
    round_, walker = killed(4.0, at=1.0, enemy="robots")
    assert not round_.stains, "no blood from a machine"
    figure = walker.figure(VIEW, 1.0)
    canvas = np.zeros((AREA.bottom + 56, AREA.width + 48, 3), np.uint8)
    draw_stains(canvas, round_, 3.0)
    rows = np.flatnonzero(canvas.max(axis=(1, 2)) > 8)
    assert rows.size and figure.ground_y - rows.min() < figure.height * 0.4, "a wreck, lying"


# --- round four: finish ------------------------------------------------------

def test_rain_only_ever_brightens_what_is_behind_it():
    from handy.maps.zombies import draw_rain

    canvas = np.zeros((AREA.bottom + 56, AREA.width + 48, 3), np.uint8)
    canvas[:] = 200  # a bright moon-sized patch everywhere
    draw_rain(canvas, AREA, 2.0, drops=200, view=VIEW)
    assert canvas.min() >= 200, "no streak is drawn darker than the moon"
    assert canvas.max() > 200, "the streaks are there, as light"


def test_the_muzzle_flash_has_a_visible_source_at_the_bottom_of_the_picture():
    from handy.maps.zombies import draw_muzzle_burst

    canvas = np.zeros((AREA.bottom + 56, AREA.width + 48, 3), np.uint8)
    draw_muzzle_burst(canvas, AREA, 0.3)
    lit = np.argwhere(canvas.any(axis=2))
    assert lit[:, 0].max() >= AREA.bottom - 3, "it sits on the bottom edge of the road"
    assert abs(lit[:, 1].mean() - AREA.centre_x) < 20, "dead centre, where the gun is"
    assert canvas[..., 2].max() > canvas[..., 0].max(), "and it is warm"


def test_score_popups_are_anchored_over_the_hit():
    from handy.game import Impact
    from handy.maps.zombies import draw_popups

    canvas = np.zeros((AREA.bottom + 56, AREA.width + 48, 3), np.uint8)
    draw_popups(canvas, [Impact(x=400, y=500, score=120, at=0.0, ring=0, label="HEADSHOT")],
                0.2, 1.1, VIEW)
    lit = np.argwhere(canvas.any(axis=2))
    assert abs(lit[:, 1].mean() - 400) < 12, "centred on the head"
    assert 500 - 90 < lit[:, 0].max() < 500, "sitting just above it"


def test_score_popups_land_big_and_settle():
    from handy.game import Impact
    from handy.maps.zombies import draw_popups

    def ink(age: float) -> int:
        canvas = np.zeros((AREA.bottom + 56, AREA.width + 48, 3), np.uint8)
        draw_popups(canvas, [Impact(x=400, y=500, score=120, at=0.0, ring=0)], age, 1.1,
                    VIEW)
        return int(canvas.any(axis=2).sum())

    assert ink(0.0) > ink(0.2) * 1.3, "oversized on the frame it lands"
    assert ink(1.05) < ink(0.2), "and fading out at the end"


def test_old_bodies_sink_into_the_road_and_fresh_ones_keep_their_blood():
    round_, _ = killed(5.0)
    fresh = np.zeros((AREA.bottom + 56, AREA.width + 48, 3), np.uint8)
    old = fresh.copy()
    draw_stains(fresh, round_, FALL + 0.1)
    draw_stains(old, round_, 60.0)
    assert fresh.max() > old.max() + 40, "the moon's rim goes as it settles"
    red_fresh = (fresh[:, :, 2].astype(int) - fresh[:, :, 0]) > 30
    red_old = (old[:, :, 2].astype(int) - old[:, :, 0]) > 30
    assert red_fresh.sum() > red_old.sum(), "only the fresh kill is saturated"
