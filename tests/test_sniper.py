import math

import numpy as np
import pytest

from handy.game import Rect, RoundOptions
from handy.maps.sniper import (DUST_SECONDS, ELEVATION, MAX_FALLEN, MUZZLE_VELOCITY,
                               SCOPE_CENTRE_Y, SCOPE_RADIUS, SCOPE_ZOOM, SENTRY_POSTS,
                               ZERO_RANGE, Hostile, SniperRound, Valley, View,
                               bullet_drop, draw_emblem, draw_hud, draw_world,
                               flight_time, frame_for, hud_origin, mils, wind_drift)

AREA = Rect(24, 240, 1232, 424)  # a 1280x720 window's play area
FRAME = frame_for(AREA, 1.0)
VALLEY = Valley(*FRAME)


def make_round(**options) -> SniperRound:
    options.setdefault("seed", 4)
    return SniperRound(RoundOptions(area=AREA, **options))


# --- the projection --------------------------------------------------------

def test_the_frame_is_recovered_from_the_play_area():
    assert FRAME == (1280, 720)


def test_apparent_size_halves_when_the_distance_doubles():
    assert VALLEY.size_px(1.8, 400.0) == pytest.approx(VALLEY.size_px(1.8, 200.0) / 2)


def test_further_away_stands_higher_and_nearer_the_centre():
    near, far = VALLEY.project(30.0, 200.0), VALLEY.project(30.0, 800.0)
    assert far[1] < near[1]
    assert abs(far[0] - VALLEY.centre_x) < abs(near[0] - VALLEY.centre_x)
    assert VALLEY.project(0.0, 1e6)[1] == pytest.approx(VALLEY.horizon, abs=0.1)


def test_ground_distance_inverts_the_projection():
    _, y = VALLEY.project(0.0, 350.0)
    assert VALLEY.ground_distance(y) == pytest.approx(350.0)
    assert VALLEY.ground_distance(VALLEY.horizon - 5) == math.inf


# --- the view: screen <-> world in both modes --------------------------------

def test_the_wide_view_is_the_identity():
    wide = View.wide(*FRAME)
    assert wide.to_screen(300.0, 200.0) == (300.0, 200.0)
    assert wide.to_base(300.0, 200.0) == (300.0, 200.0)


def test_the_scoped_view_magnifies_around_its_centre():
    scoped = View(FRAME[0], FRAME[1], (500.0, 400.0), SCOPE_ZOOM)
    assert scoped.to_screen(500.0, 400.0) == (FRAME[0] / 2, FRAME[1] / 2)
    sx, sy = scoped.to_screen(510.0, 400.0)
    assert sx - FRAME[0] / 2 == pytest.approx(10.0 * SCOPE_ZOOM)
    assert scoped.to_base(sx, sy) == pytest.approx((510.0, 400.0))


def test_a_figure_is_six_times_taller_through_the_scope():
    sentry = Hostile("sentry", 0.0, post=SENTRY_POSTS[0])
    wide = sentry.figure(View.wide(*FRAME), 1.0, VALLEY)
    scoped = sentry.figure(View(FRAME[0], FRAME[1], (wide.x, wide.hip_y), SCOPE_ZOOM), 1.0, VALLEY)
    assert scoped.height == pytest.approx(wide.height * SCOPE_ZOOM)


def test_the_view_pans_with_look():
    round_ = make_round()
    round_.look((0.3, 0.5), scoped=True)
    left = round_.view.centre
    round_.look((0.7, 0.5), scoped=True)
    right = round_.view.centre
    assert round_.view.zoom == SCOPE_ZOOM
    assert right[0] > left[0]
    assert right[1] == pytest.approx(left[1])


def test_unscoped_look_keeps_the_wide_view():
    round_ = make_round()
    round_.look((0.1, 0.9), scoped=False)
    assert round_.view == View.wide(*FRAME)
    assert round_.scoped is False


def test_the_glass_never_shows_past_the_edge_of_the_world():
    round_ = make_round()
    radius = SCOPE_RADIUS * FRAME[1]
    cx, cy = View.scope_anchor(*FRAME)
    round_.look((0.0, 0.0), scoped=True)
    x, y = round_.view.to_base(cx - radius, cy - radius)
    assert x >= 0 and y >= 0
    round_.look((1.0, 1.0), scoped=True)
    x, y = round_.view.to_base(cx + radius, cy + radius)
    assert x <= FRAME[0] + 1e-6 and y <= FRAME[1] + 1e-6


def test_scoped_shot_is_the_middle_of_the_glass():
    round_ = make_round()
    round_.look((0.8, 0.3), scoped=True)
    anchor = View.scope_anchor(*FRAME)
    assert round_.scoped_shot == anchor == (FRAME[0] // 2, int(SCOPE_CENTRE_Y * FRAME[1]))
    # The pan point lands exactly there, so the reticle sits on what is aimed at.
    assert round_.view.to_screen(*round_.view.centre) == anchor
    assert SCOPE_RADIUS + SCOPE_CENTRE_Y < 1.0  # the glass is inside the frame


def test_an_anchored_view_is_inverted_by_to_base():
    view = View(FRAME[0], FRAME[1], (400.0, 300.0), SCOPE_ZOOM, anchor=(640, 403))
    assert view.to_screen(400.0, 300.0) == (640, 403)
    assert view.to_base(*view.to_screen(417.0, 288.0)) == pytest.approx((417.0, 288.0))


def test_scoping_in_and_out_raises_cues():
    round_ = make_round()
    round_.look((0.5, 0.5), True)
    round_.look((0.5, 0.5), True)
    round_.look((0.5, 0.5), False)
    assert round_.take_cues() == ["scope_in", "scope_out"]


# --- ballistics ------------------------------------------------------------

def test_time_of_flight_grows_faster_than_the_distance():
    assert flight_time(200.0) > 200.0 / MUZZLE_VELOCITY
    assert flight_time(800.0) > 2 * flight_time(400.0)


def test_the_rifle_is_zeroed_and_drops_beyond_the_zero():
    assert bullet_drop(ZERO_RANGE) == pytest.approx(0.0, abs=1e-9)
    assert bullet_drop(300.0) > 0.0
    assert bullet_drop(600.0) > 4 * bullet_drop(300.0)  # faster than linear
    assert 2.0 < mils(bullet_drop(400.0), 400.0) < 9.0  # a hold you can read off the reticle


def test_wind_drift_is_proportional_to_the_wind_and_grows_with_range():
    assert wind_drift(400.0, 0.0) == 0.0
    assert wind_drift(400.0, 6.0) == pytest.approx(2 * wind_drift(400.0, 3.0))
    assert wind_drift(400.0, -3.0) == pytest.approx(-wind_drift(400.0, 3.0))
    assert wind_drift(600.0, 4.0) > 2 * wind_drift(300.0, 4.0)


# --- hit zones --------------------------------------------------------------

def test_the_silhouette_and_the_hitbox_are_the_same_measurements():
    figure = Hostile("sentry", 0.0, post=(0.0, 300.0)).figure(View.wide(*FRAME), 0.0, VALLEY)
    assert figure.hit_zone(*figure.head) == "head"
    assert figure.hit_zone(figure.x, figure.hip_y) == "body"
    assert figure.hit_zone(figure.x, figure.ground_y + 30) is None
    assert figure.hit_zone(figure.x + figure.height, figure.hip_y) is None


def test_the_dead_cannot_be_hit_again():
    hostile = Hostile("sentry", 0.0, post=(0.0, 300.0), dead_at=1.0, fell_at=(0.0, 300.0))
    assert hostile.figure(View.wide(*FRAME), 0.5, VALLEY).alive
    figure = hostile.figure(View.wide(*FRAME), 2.0, VALLEY)
    assert not figure.alive and figure.hit_zone(figure.x, figure.ground_y - 1) is None


def test_a_vehicle_has_a_cab_window_and_a_hull():
    truck = Hostile("vehicle", 0.0, start=400.0, speed=0.0)
    figure = truck.figure(View.wide(*FRAME), 0.0, VALLEY)
    assert figure.hit_zone(*figure.head) == "head"
    assert figure.hit_zone(figure.x, figure.ground_y - figure.height * 0.5) == "body"
    assert figure.hit_zone(figure.x, figure.ground_y + 20) is None


def test_patrols_walk_the_road_and_leave_it_at_the_end():
    patrol = Hostile("patrol", 0.0, start=0.0, speed=2.0)
    first, later = patrol.world_at(0.0), patrol.world_at(10.0)
    assert math.hypot(later[0] - first[0], later[1] - first[1]) == pytest.approx(20.0, abs=0.5)
    assert not patrol.gone(10.0)
    assert patrol.gone(10_000.0)


# --- shooting -----------------------------------------------------------------

def aimed_round(scoped: bool = True):
    """A round with one sentry at 300 m, the wind still, the scope on its head."""
    round_ = make_round()
    round_.hostiles = [Hostile("sentry", 0.0, post=(0.0, 300.0))]
    round_.wind = round_.wind_target = 0.0
    round_.update(0.0)
    return round_


def test_a_scoped_shot_through_the_view_lands_where_the_reticle_shows():
    round_ = aimed_round()
    sentry = round_.hostiles[0]
    # Put the reticle exactly where the head will be when the round gets there,
    # allowing for the drop, and check that it is a headshot.
    distance = 300.0
    lands = flight_time(distance)
    head = sentry.figure(View.wide(*FRAME), lands, VALLEY).head
    drop_px = VALLEY.focal * bullet_drop(distance) / distance
    aim = (head[0], head[1] - drop_px)
    round_.look((aim[0] / (FRAME[0] - 1), aim[1] / (FRAME[1] - 1)), scoped=True)
    # Breathing moves the centre a little, so aim through the actual view.
    round_.view = View(FRAME[0], FRAME[1], aim, SCOPE_ZOOM)
    hit = round_.resolve(*round_.scoped_shot, 0.0)
    assert hit.label == "HEADSHOT" and hit.perfect
    assert sentry.dead_at == pytest.approx(lands)


def test_the_hit_is_booked_now_but_the_body_falls_when_the_round_arrives():
    round_ = aimed_round()
    sentry = round_.hostiles[0]
    head = sentry.figure(View.wide(*FRAME), flight_time(300.0), VALLEY).head
    round_.view = View(FRAME[0], FRAME[1], (head[0], head[1] - VALLEY.focal * bullet_drop(300.0) / 300.0),
                       SCOPE_ZOOM)
    round_.scoped = True
    round_.shoot(*round_.scoped_shot, 0.0)
    assert round_.score > 0 and round_.kills == 1
    assert sentry.alive_at(0.1)
    round_.update(0.1)
    assert sentry in round_.hostiles
    round_.update(flight_time(300.0) + 0.01)
    assert sentry not in round_.hostiles and sentry in round_.fallen
    round_.update(flight_time(300.0) + 1.0)
    cues = round_.take_cues()
    assert "sniper_shot" in cues and "headshot_ping" in cues and "bolt_cycle" in cues


def test_aiming_dead_on_at_range_lands_low_because_of_the_drop():
    round_ = aimed_round()
    sentry = round_.hostiles[0]
    head = sentry.figure(View.wide(*FRAME), flight_time(300.0), VALLEY).head
    round_.view = View(FRAME[0], FRAME[1], head, SCOPE_ZOOM)
    round_.scoped = True
    hit = round_.resolve(*round_.scoped_shot, 0.0)
    assert hit.label != "HEADSHOT"  # the round fell below the head


def test_a_crosswind_pushes_the_round_off_the_head():
    round_ = aimed_round()
    round_.wind = 8.0
    sentry = round_.hostiles[0]
    head = sentry.figure(View.wide(*FRAME), flight_time(300.0), VALLEY).head
    round_.view = View(FRAME[0], FRAME[1], (head[0], head[1] - VALLEY.focal * bullet_drop(300.0) / 300.0),
                       SCOPE_ZOOM)
    round_.scoped = True
    hit = round_.resolve(*round_.scoped_shot, 0.0)
    assert hit.label != "HEADSHOT"


def test_a_miss_is_a_shot_in_flight_that_lands_on_the_ground_later():
    round_ = make_round()
    round_.hostiles = []
    round_.look((0.5, 0.7), scoped=True)
    hit = round_.resolve(*round_.scoped_shot, 0.0)
    assert not hit.landed
    shot = round_.flights[-1]
    assert shot.zone is None and shot.lands > 0.0
    assert 60.0 < shot.distance < 1800.0
    assert shot.lands == pytest.approx(flight_time(shot.distance))


def test_shooting_from_the_hip_scatters():
    landings = set()
    for seed in range(6):
        round_ = make_round(seed=seed)
        round_.hostiles = []
        round_.look((0.5, 0.7), scoped=False)
        round_.resolve(640, 500, 0.0)
        landings.add(tuple(round(v) for v in round_.flights[-1].target))
    assert len(landings) > 1


def test_distance_pays():
    near = aimed_round()
    far = aimed_round()
    far.hostiles = [Hostile("sentry", 0.0, post=(0.0, 550.0))]
    points = []
    for round_, distance in ((near, 300.0), (far, 550.0)):
        head = round_.hostiles[0].figure(View.wide(*FRAME), flight_time(distance), VALLEY).head
        round_.view = View(FRAME[0], FRAME[1],
                           (head[0], head[1] - VALLEY.focal * bullet_drop(distance) / distance), SCOPE_ZOOM)
        round_.scoped = True
        points.append(round_.resolve(*round_.scoped_shot, 0.0).points)
    assert points[1] > points[0] > 0


def test_the_round_spawns_and_the_wind_moves():
    round_ = make_round(duration=60.0)
    winds = set()
    for tick in range(0, 1500):
        now = tick / 30
        round_.look((0.5 + 0.2 * math.sin(now), 0.6), scoped=tick % 2 == 0)
        round_.update(now)
        winds.add(round(round_.wind, 2))
    assert round_.remaining_hostiles > 0
    assert any(h.kind == "vehicle" for h in round_.hostiles + round_.fallen) or round_.stage(50.0) >= 3
    assert len(winds) > 5
    assert all(abs(w) <= 8.0 for w in winds)


def test_range_under_the_reticle_reads_the_hostile_or_the_ground():
    round_ = aimed_round()
    sentry = round_.hostiles[0]
    figure = sentry.figure(View.wide(*FRAME), 0.0, VALLEY)
    round_.view = View(FRAME[0], FRAME[1], (figure.x, figure.hip_y), SCOPE_ZOOM)
    distance, found = round_.range_under_reticle(0.0)
    assert found is sentry and distance == pytest.approx(300.0)
    round_.view = View(FRAME[0], FRAME[1], (200.0, VALLEY.horizon + 100.0), SCOPE_ZOOM)
    distance, found = round_.range_under_reticle(0.0)
    assert found is None and distance == pytest.approx(VALLEY.ground_distance(VALLEY.horizon + 100.0))


# --- drawing ----------------------------------------------------------------

@pytest.mark.parametrize("scoped", [False, True])
def test_draw_world_runs_at_every_stage(scoped):
    round_ = make_round(duration=60.0)
    canvas = np.zeros((360, 640, 3), np.uint8)
    for tick in range(0, 60 * 30, 7):
        now = tick / 30
        round_.look((0.5 + 0.3 * math.sin(now * 0.7), 0.55 + 0.2 * math.cos(now * 0.5)), scoped)
        round_.update(now)
        if tick % 21 == 0:
            round_.shoot(*(round_.scoped_shot if scoped else (320, 230)), now)
        draw_world(canvas, round_, now)
        draw_hud(canvas, round_, (160, 16), now)
    assert canvas.any()
    if scoped:
        assert not canvas[2, 2].any()  # black outside the glass
        cx, cy = View.scope_anchor(640, 360)
        assert canvas[cy, cx - 40].any()  # lit inside it
        assert not canvas[2, 320].any()  # the glass is clear of the clock at the top
    else:
        assert round_.craters  # the ground keeps the marks of the misses


def test_the_valley_stops_keeping_bodies_after_a_while():
    """Every fallen hostile is rebuilt into a Figure and repainted on every
    frame. Uncapped, an endless round walked draw_world past its budget and
    never came back: 243 bodies and 6.7 ms after ten minutes, still climbing."""
    round_ = make_round(duration=None)
    for index in range(MAX_FALLEN * 3):
        hostile = round_._spawn(0.0, 1)
        hostile.dead_at = index * 0.5
        round_.hostiles.append(hostile)
        round_.update(index * 0.5 + 0.01)

    assert len(round_.fallen) == MAX_FALLEN
    assert round_.fallen[-1].dead_at > round_.fallen[0].dead_at, "the oldest go"


def test_the_world_lays_a_panel_under_the_score_block():
    round_ = make_round()
    canvas = np.zeros((720, 1280, 3), np.uint8)
    round_.look((0.5, 0.5), False)
    draw_world(canvas, round_, 1.0)
    x, y = hud_origin(1280, 720, 1.0)
    assert (x, y) == (320 + 16 + 28, 16)
    panel = canvas[y + 40, x + 40].astype(int).sum()
    sky = canvas[y + 40, x + 600].astype(int).sum()
    assert panel < sky * 0.6


def test_the_wind_lifts_dust_and_drifts_the_clouds():
    round_ = make_round()
    for tick in range(0, 120):
        round_.update(tick / 30)
    assert round_.dust
    assert all(4.0 - p[2] < DUST_SECONDS for p in round_.dust)
    assert round_.sky_drift != 0.0


def test_a_fallen_hostile_stays_where_it_fell():
    round_ = aimed_round()
    round_.update(0.0)
    sentry = round_.hostiles[0]
    round_._kill(sentry, 0.5, 0.0)
    round_.update(1.0)
    assert sentry in round_.fallen and sentry not in round_.hostiles
    assert sentry.world_at(5.0) == sentry.fell_at
    figure = sentry.figure(View.wide(*FRAME), 5.0, VALLEY)
    assert not figure.alive and figure.hit_zone(figure.x, figure.ground_y - 1) is None


def test_the_scope_in_transition_and_scope_out_draw():
    round_ = make_round()
    canvas = np.zeros((360, 640, 3), np.uint8)
    round_.update(0.0)
    round_.look((0.5, 0.6), True)
    draw_world(canvas, round_, 0.05)  # mid-transition: blurred, iris opening
    round_.update(0.5)
    round_.look((0.5, 0.6), False)
    draw_world(canvas, round_, 0.55)  # fading back to the wide view
    assert canvas.any()


def test_draw_world_adopts_the_canvas_size():
    round_ = make_round()
    canvas = np.zeros((300, 500, 3), np.uint8)
    draw_world(canvas, round_, 0.0)
    assert round_.frame == (500, 300)
    round_.look((0.5, 0.5), True)
    assert round_.scoped_shot == View.scope_anchor(500, 300)


def test_the_emblem_draws():
    panel = np.zeros((164, 404, 3), np.uint8)
    draw_emblem(panel)
    assert panel.any()
    assert ELEVATION > 0


# --- the light, the fallen and the panel ---------------------------------------

def test_shadows_lie_towards_you_and_to_the_left():
    """The sun is low on the right, so every figure's shadow falls left and
    down the screen, and it is long: several times the figure's height."""
    sentry = Hostile("sentry", 0.0, post=(10.0, 400.0))
    figure = sentry.figure(View.wide(*FRAME), 0.0, VALLEY)
    assert figure.shadow is not None
    assert figure.shadow[0] < figure.x
    assert figure.shadow[1] > figure.ground_y
    assert math.hypot(figure.shadow[0] - figure.x, figure.shadow[1] - figure.ground_y) > figure.height


def test_a_kill_leaves_a_collapsed_figure_and_dust():
    round_ = aimed_round()
    round_.update(0.0)
    sentry = round_.hostiles[0]
    before = len(round_.dust)
    round_._kill(sentry, 0.5, 0.0)
    assert len(round_.dust) > before
    round_.update(2.5)
    figure = sentry.figure(View.wide(*FRAME), 2.5, VALLEY)
    assert not figure.alive
    assert figure.fallen_for == pytest.approx(2.0)
    alive = Hostile("sentry", 0.0, post=sentry.post).figure(View.wide(*FRAME), 2.5, VALLEY)
    assert figure.height < alive.height * 0.5  # lying down, not standing


def test_the_hud_panel_holds_the_camera_and_the_score_block():
    from handy.maps.sniper import hud_panel
    x0, y0, x1, y1 = hud_panel(1280, 720, 1.0)
    margin = 16
    assert x0 < margin and y0 < margin            # the camera's corner is inside
    assert y1 > margin + 720 // 4                 # and so is its bottom edge
    hx, hy = hud_origin(1280, 720, 1.0)
    assert x0 < hx < x1 and y0 < hy < y1


def test_the_panel_is_solid_in_both_modes():
    for scoped in (False, True):
        round_ = make_round()
        canvas = np.zeros((720, 1280, 3), np.uint8)
        round_.look((0.5, 0.5), scoped)
        round_.update(0.0)
        draw_world(canvas, round_, 1.0)
        x, y = hud_origin(1280, 720, 1.0)
        assert canvas[y + 40, x + 40].max() < 40


def test_the_readout_sits_on_a_dark_band_at_the_foot_of_the_glass():
    round_ = make_round()
    round_.look((0.5, 0.5), True)
    round_.update(0.0)
    canvas = np.zeros((720, 1280, 3), np.uint8)
    draw_world(canvas, round_, 5.0)  # long after the scope-in transition
    cx, cy = View.scope_anchor(1280, 720)
    radius = SCOPE_RADIUS * 720
    band = canvas[int(cy + radius * 0.8) - 3:int(cy + radius * 0.8) + 3, cx - 120:cx - 90].mean()
    glass = canvas[int(cy - radius * 0.3) - 3:int(cy - radius * 0.3) + 3, cx - 120:cx - 90].mean()
    assert band < glass * 0.6
