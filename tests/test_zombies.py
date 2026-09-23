import numpy as np
import pytest

from handy.game import Rect, RoundOptions
from handy.maps.zombies import (BITE_DAMAGE, BODY_HEALTH, CONTACT_DISTANCE,
                                FULL_HEALTH, LOW_HEALTH, MAX_WALKERS,
                                MUZZLE_FLASH, NEAR_PLANE, WAVE_SECONDS,
                                Perspective, Walker, ZombieRound, draw_emblem,
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
        assert figure.hit_zone(figure.x, figure.ground_y - 2) == "body", gait


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


def test_the_dead_are_drawn_to_the_size_of_the_living():
    from handy.maps.zombies import draw_stains

    round_ = make_round()
    figure = walker_at(5.0).figure(VIEW, 0.0)
    round_.stains = [(figure.x, figure.ground_y, figure.height * 0.18, 0.0, 5)]
    canvas = np.zeros((AREA.bottom + 56, AREA.width + 48, 3), np.uint8)
    draw_stains(canvas, round_, 30.0)
    lit = np.argwhere(canvas.any(axis=2))
    width = lit[:, 1].max() - lit[:, 1].min()
    assert width > figure.height * 0.6, "a body lying down is as long as one standing"


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
    from handy.maps.zombies import draw_stains

    round_ = make_round()
    figure = walker_at(5.0).figure(VIEW, 0.0)
    round_.stains = [(figure.x, figure.ground_y, figure.height * 0.18, 0.0, 5)]
    fresh = np.zeros((AREA.bottom + 56, AREA.width + 48, 3), np.uint8)
    old = fresh.copy()
    draw_stains(fresh, round_, 0.5)
    draw_stains(old, round_, 60.0)
    assert fresh.max() > old.max() + 40, "the moon's rim goes as it settles"
    red_fresh = (fresh[:, :, 2].astype(int) - fresh[:, :, 0]) > 30
    red_old = (old[:, :, 2].astype(int) - old[:, :, 0]) > 30
    assert red_fresh.sum() > red_old.sum(), "only the fresh kill is saturated"
