"""The wheel, the physics and the race."""

import math
import random

import pytest

from handy.game import Rect, RoundOptions
from handy.karting import (BOOST_COOLDOWN, BOOST_LONG_SECONDS, BOOST_SECONDS,
                           BOOST_TOP, BUMP_COOLDOWN, CONTACT_LOSS, CORNER_SPAN,
                           CORNER_STRENGTHS, DRIFT_ENGAGE, DRIFT_EXIT,
                           DRIFT_GRIP, DRIFT_HOLD, DRIFT_LIFT, DRIFT_LONG,
                           DRIFT_STEER, FULL_LOCK_DEGREES, GRAVEL_SHOULDER,
                           GRIP_REACH, LAP_SPAN, LAST_CAR_GRACE, MAX_STEP,
                           MAX_STRAIGHT, OPEN_REACH, RIVAL_PACE,
                           GRAVEL_BED, PLAYER_EDGE, ROAD_HALF_WIDTH,
                           SQUEAL_COOLDOWN, TEETH_COUNT, TEETH_LENGTH,
                           TOOTH_BITE, TOP_SPEED, WALL,
                           Kart, RaceRound, Segment, Track, Wheel,
                           WheelController, build_track, corner_grip,
                           cornering_speed, crossed_at, engine_period,
                           flat_out_reach, gravel_cap, gravel_steer,
                           hand_openness, hand_throttle, is_open,
                           holding_lock, lateral_margin, pinned_speed,
                           progress_gap, rank_key, rubber_band, sane,
                           shape_steer, slipstream_pull, teeth_of)
from handy.recognition import Hand

OPTIONS = RoundOptions(area=Rect(0, 0, 100, 100), seed=7)


def grip(x, y, open_hand=False, gesture=None):
    """A hand gripping the air at (x, y), fist or flat."""
    reach = 0.20 if open_hand else 0.11
    points = [(x, y)] * 21
    points[0] = (x, y)
    points[9] = (x, y - 0.10)                      # palm span 0.10
    for tip in (8, 12, 16, 20):
        points[tip] = (x, y - reach)
    return Hand(landmarks=tuple(points), handedness="Right", gesture=gesture,
                score=0.9)


def wheel_at(controller, left, right, t, open_hands=False):
    return controller.update([grip(*left, open_hand=open_hands),
                              grip(*right, open_hand=open_hands)], t)


# --- the wheel ---------------------------------------------------------------

def test_level_hands_steer_straight():
    wheel = wheel_at(WheelController(min_cutoff=1e4, beta=0.0),
                     (0.3, 0.5), (0.7, 0.5), 0.0)
    assert wheel.steer == pytest.approx(0.0, abs=0.02)
    assert wheel.hands == 2 and wheel.tracking


def test_rolling_the_wheel_steers_and_saturates_at_full_lock():
    controller = WheelController(min_cutoff=1e4, beta=0.0)
    quarter = math.tan(math.radians(FULL_LOCK_DEGREES / 2)) * 0.2
    for step in range(4):
        right_down = wheel_at(controller, (0.3, 0.5 - quarter), (0.7, 0.5 + quarter),
                              step / 30)
    assert 0.4 < right_down.steer < 0.6, "half lock steers about half"
    for step in range(8):
        slammed = wheel_at(controller, (0.3, 0.2), (0.7, 0.8), 0.5 + step / 30)
    assert slammed.steer == pytest.approx(1.0), "beyond full lock clamps"


def test_the_wheel_order_is_by_position_not_handedness():
    """Crossed-over labels must not flip the steering."""
    controller = WheelController(min_cutoff=1e4, beta=0.0)
    left, right = grip(0.3, 0.6), grip(0.7, 0.4)
    a = controller.update([left, right], 0.0)
    b = controller.update([right, left], 1 / 30)
    assert a.steer == pytest.approx(b.steer, abs=0.05)
    assert a.steer < 0, "right hand higher than left turns left"


def test_open_hands_brake_and_a_single_frame_does_not():
    controller = WheelController(min_cutoff=1e4, beta=0.0)
    assert not wheel_at(controller, (0.3, 0.5), (0.7, 0.5), 0.0, open_hands=True).brake
    assert wheel_at(controller, (0.3, 0.5), (0.7, 0.5), 0.04, open_hands=True).brake
    assert not wheel_at(controller, (0.3, 0.5), (0.7, 0.5), 0.08).brake


def test_one_open_hand_is_not_a_brake():
    controller = WheelController(min_cutoff=1e4, beta=0.0)
    for step in range(4):
        wheel = controller.update([grip(0.3, 0.5, open_hand=True), grip(0.7, 0.5)],
                                  step / 30)
    assert not wheel.brake


def test_the_recognisers_own_verdict_wins_when_present():
    assert is_open(grip(0.5, 0.5, gesture="Open_Palm"))
    assert not is_open(grip(0.5, 0.5, open_hand=True, gesture="Closed_Fist"))
    assert is_open(grip(0.5, 0.5, open_hand=True))          # geometry fallback
    assert hand_openness(grip(0.5, 0.5, open_hand=True)) > hand_openness(grip(0.5, 0.5))


def test_losing_one_hand_degrades_gracefully_and_both_coasts_to_neutral():
    controller = WheelController(min_cutoff=1e4, beta=0.0)
    for step in range(6):
        wheel_at(controller, (0.3, 0.35), (0.7, 0.65), step / 30)   # hard right
    one = controller.update([grip(0.7, 0.65)], 0.3)
    assert one.hands == 1 and one.steer > 0.2, "one hand still steers"
    for step in range(40):
        wheel = controller.update([], 0.5 + step / 30)
    assert wheel.hands == 0 and abs(wheel.steer) < 0.05, "released: coasts straight"


# --- the track and the kart --------------------------------------------------

def test_every_track_closes_its_loop():
    """A lap must come back to its own start line - in POSITION, not just in
    heading. A circuit whose finish line lands half a lap from its start is a
    spiral, and every minimap drawn from it is a lie."""
    for seed in range(1, 12):
        track = build_track(seed)
        x, y, turned = track.closure()
        assert abs(turned) == pytest.approx(math.tau, abs=1e-9), \
            f"seed {seed}: a lap is exactly one turn of heading"
        assert math.hypot(x, y) < track.length * 0.01, \
            f"seed {seed}: the finish line is {math.hypot(x, y):.0f} units " \
            "from the start line"
        assert track.length > 1500


def test_every_circuit_has_corners_worth_braking_for():
    """No circuit may be a three-lap cruise: each one needs corners that
    cannot be taken flat out, and long enough to punish trying."""
    for seed in range(1, 12):
        track = build_track(seed)
        teeth = teeth_of(track.segments)
        assert len(teeth) >= TEETH_COUNT, \
            f"seed {seed}: nothing here demands a lift"
        straights = [seg.length for seg in track.segments if not seg.curvature]
        assert max(straights) > 200.0, f"seed {seed}: nowhere to stretch its legs"


def test_the_kart_accelerates_to_top_speed_and_brakes_to_rest():
    from handy.karting import Segment, Track

    track = Track((Segment(1e6, 0.0),))   # a drag strip: no curvature to fight
    kart = Kart()
    for _ in range(60 * 20):
        kart.advance(track, 1 / 60, throttle=1.0, brake=False, steer=0.0)
    assert kart.v == pytest.approx(TOP_SPEED, rel=0.12)
    for _ in range(60 * 3):
        kart.advance(track, 1 / 60, throttle=0.0, brake=True, steer=0.0)
    assert kart.v == 0.0


def test_gravel_is_slow_and_the_wall_is_worse():
    track = build_track(7)
    kart = Kart(v=TOP_SPEED, x=ROAD_HALF_WIDTH * 1.5)
    for _ in range(60 * 3):
        kart.advance(track, 1 / 60, throttle=1.0, brake=False, steer=0.0)
    assert kart.v <= TOP_SPEED * 0.45 + 1e-6, "off the road you crawl"

    fast = Kart(v=TOP_SPEED, x=0.0)
    before = fast.v
    for _ in range(60):
        fast.advance(track, 1 / 60, throttle=1.0, brake=False, steer=1.0)
    assert abs(fast.x) <= 2.1 + 1e-9 and fast.v < before, "the wall scrubs speed"


def scripted_driver(round_):
    ahead = round_.track.curvature_ahead(round_.player.s, 55.0)
    return max(-1.0, min(1.0, -ahead * 170 - round_.player.x * 1.4
                         + round_.track.curvature_at(round_.player.s) * 300
                         * (round_.player.v / TOP_SPEED)))


def test_a_competent_driver_finishes_and_laps_are_timed():
    round_ = RaceRound(OPTIONS)
    now = 0.0
    while not round_.finished and now < 400:
        now += 1 / 60
        round_.update(now, 1 / 60, Wheel(steer=scripted_driver(round_), hands=2))
    assert round_.finished, "the race must be completable"
    assert len(round_.lap_times) == round_.laps
    assert all(20 < lap < 200 for lap in round_.lap_times)
    assert round_.best_lap() == min(round_.lap_times)
    assert 1 <= round_.position() <= len(round_.everyone())


def test_the_countdown_holds_the_field_then_releases_it():
    round_ = RaceRound(OPTIONS)
    round_.update(0.0, 1 / 60, Wheel(steer=0.0, hands=2))
    round_.update(1.0, 1 / 60, Wheel(steer=0.0, hands=2))
    assert round_.player.v == 0.0 and round_.countdown(1.0) is not None
    round_.update(3.2, 1 / 60, Wheel(steer=0.0, hands=2))
    assert round_.countdown(3.2) is None
    for step in range(30):
        round_.update(3.3 + step / 60, 1 / 60, Wheel(steer=0.0, hands=2))
    assert round_.player.v > 0.0, "GO means go"
    assert "race_go" in round_.take_cues()


def test_braking_with_open_hands_actually_stops_the_kart():
    round_ = RaceRound(OPTIONS)
    now = 0.0
    while now < 12.0:
        now += 1 / 60
        round_.update(now, 1 / 60, Wheel(steer=scripted_driver(round_), hands=2))
    rolling = round_.player.v
    assert rolling > TOP_SPEED * 0.35, "rolling well before the brake test"
    while now < 15.0:
        now += 1 / 60
        round_.update(now, 1 / 60, Wheel(steer=0.0, brake=True, hands=2))
    assert round_.player.v == 0.0, "open hands stop the kart"


def test_rivals_race_their_own_race():
    round_ = RaceRound(OPTIONS)
    now = 0.0
    while now < 30.0:
        now += 1 / 60
        round_.update(now, 1 / 60, Wheel(steer=scripted_driver(round_), hands=2))
    assert all(kart.s != pytest.approx(8.0 + 7.5 * i, abs=1.0)
               for i, kart in enumerate(round_.field_)), "they moved"
    assert all(abs(kart.x) < 2.2 for kart in round_.field_), "and stayed on course"


def test_the_world_and_hud_draw_at_every_stage():
    import numpy as np

    from handy.maps import kart as art

    round_ = RaceRound(OPTIONS)
    canvas = np.zeros((540, 960, 3), np.uint8)
    now = 0.0
    for target in (1.0, 5.0, 40.0):
        while now < target:
            now += 1 / 60
            round_.update(now, 1 / 60, Wheel(steer=scripted_driver(round_), hands=2))
        art.draw_world(canvas, round_, now)
        art.draw_hud(canvas, round_, Wheel(steer=0.3, brake=True, hands=2), now)
        assert canvas.any()
    art.draw_results(canvas, round_)
    assert canvas.any()


def test_a_refused_wheel_calibration_says_so_on_the_hud():
    """`Wheel.level_hint` was raised by the controller, carried through every
    frame, and then read by nobody: a player whose grip was too crooked to
    believe at the lights drove the whole race against a steering pull with
    nothing on screen to explain it. The wheel widget's status lamp says
    LEVEL, and it is the only thing on the HUD that changes when it does."""
    import numpy as np

    from handy.maps import kart as art

    round_ = RaceRound(OPTIONS)
    now = 0.0
    while now < 12.0:
        now += 1 / 60
        round_.update(now, 1 / 60, Wheel(steer=scripted_driver(round_), hands=2))

    def hud(**wheel) -> np.ndarray:
        canvas = np.zeros((540, 960, 3), np.uint8)
        art.draw_hud(canvas, round_, Wheel(hands=2, **wheel), now)
        return canvas

    quiet, warned = hud(), hud(level_hint=True)
    assert not np.array_equal(quiet, warned), "the refusal is drawn nowhere"
    # ... and only in the wheel widget, down in the bottom-left corner.
    changed = np.argwhere(np.any(quiet != warned, axis=2))
    assert changed[:, 0].min() > 540 * 0.75 and changed[:, 1].max() < 960 * 0.25

    # A braking driver is still told they are braking: the brake is the state
    # they are creating right now, the neutral is one they cannot act on until
    # the next set of lights.
    assert np.array_equal(hud(brake=True), hud(brake=True, level_hint=True))


# --- the real drive loop, headless -------------------------------------------

def test_the_drive_loop_runs_and_quits(monkeypatch, tmp_path):
    import itertools

    import cv2
    import numpy as np

    from handy import app, karting, maps
    from handy.audio import Audio, Sounds

    class FakeCapture:
        def read(self):
            return True, np.zeros((720, 1280, 3), np.uint8)

    for name in ("imshow", "setMouseCallback"):
        monkeypatch.setattr(cv2, name, lambda *args, **kwargs: None)
    keys = itertools.chain([255] * 8, itertools.repeat(ord("q")))
    monkeypatch.setattr(cv2, "waitKey", lambda *args: next(keys))
    monkeypatch.setattr(cv2, "getWindowProperty", lambda *args: 1.0)

    layout = app.layout_for(960, 540)
    settings = app.Settings(seed=3, window_width=960, window_height=540)
    canvas = np.zeros((540, 960, 3), np.uint8)
    sounds = Sounds(Audio(enabled=False), 5)

    round_, reason = karting.drive([FakeCapture()], canvas, settings, layout,
                                   maps.KART, sounds)
    assert reason == "quit"
    assert round_.countdown is not None
    assert canvas.any(), "the race was drawn"


def test_the_kart_map_is_registered_as_a_driving_map():
    from handy import maps

    assert maps.KART.mode == "drive"
    assert maps.by_key("kart") is maps.KART
    assert all(getattr(m, "mode", "shoot") == "shoot"
               for m in maps.MAPS if m.key != "kart")


# --- feel: steering curve, drift, slipstream ---------------------------------

def test_the_steering_curve_is_gentle_near_centre_and_firm_at_lock():
    assert shape_steer(0.0) == 0.0
    assert abs(shape_steer(0.08)) < 0.06, "a wobble is not a swerve"
    assert shape_steer(0.5) == pytest.approx(0.45, abs=0.03), "half lock bites"
    assert shape_steer(1.0) == pytest.approx(1.0)
    assert shape_steer(-0.5) == -shape_steer(0.5), "odd symmetry"
    xs = [i / 50 for i in range(51)]
    assert all(shape_steer(a) <= shape_steer(b) + 1e-12
               for a, b in zip(xs, xs[1:])), "monotonic"


def test_centre_wobble_barely_steers_but_half_lock_still_does():
    controller = WheelController(min_cutoff=1e4, beta=0.0)
    wobble = math.tan(math.radians(4.0)) * 0.2   # +-4 degrees of hand jitter
    for step in range(8):
        sign = 1 if step % 2 else -1
        wheel = wheel_at(controller, (0.3, 0.5 - sign * wobble),
                         (0.7, 0.5 + sign * wobble), step / 30)
        assert abs(wheel.steer) < 0.06, "wobble must not wander the kart"
    quarter = math.tan(math.radians(FULL_LOCK_DEGREES / 2)) * 0.2
    for step in range(6):
        wheel = wheel_at(controller, (0.3, 0.5 - quarter), (0.7, 0.5 + quarter),
                         1.0 + step / 30)
    assert wheel.steer > 0.42, "half lock still reaches about 0.45"


def test_lifting_with_the_lock_on_breaks_into_a_drift():
    """Lift-and-turn: the weight goes forward, the back end follows it round.
    Wheel angle alone does not do it - see the test below."""
    track = Track((Segment(1e6, 0.0),))
    kart = Kart(v=TOP_SPEED)
    deltas, before = [], 0.0
    for _ in range(90):
        kart.advance(track, 1 / 60, throttle=DRIFT_LIFT - 0.2, brake=False,
                     steer=0.95)
        deltas.append(kart.x - before)
        before = kart.x
    assert kart.drifting, "lifting with the lock on breaks the back loose"
    assert kart.v < TOP_SPEED, "sliding bleeds speed - that is the wager"
    assert deltas[30] >= deltas[2], "the slide rotates at least as well as grip"
    kart.advance(track, 1 / 60, throttle=1.0, brake=False, steer=0.0)
    assert not kart.drifting, "straightening ends the drift"
    assert kart.boost > 0.0, "a long, clean exit banks a boost"


def test_lock_alone_at_full_throttle_never_drifts():
    """The gate that keeps the drift a DECISION. A hairpin taken at its limit
    needs nine tenths of lock anyway, so a drift armed by wheel angle alone
    would be handed to every kart that merely went round the corner - and to
    every player whose hands happen to shake. The throttle has to come off."""
    track = Track((Segment(1e6, 0.0),))
    planted = Kart(v=TOP_SPEED)
    for _ in range(180):
        planted.advance(track, 1 / 60, throttle=1.0, brake=False, steer=1.0)
    assert not planted.drifting, "flat out, the kart stays planted"
    assert planted.boost == 0.0, "and no exhaust boost falls out of the sky"


def test_a_twitch_of_the_lock_does_not_drift_and_slow_karts_cannot():
    track = Track((Segment(1e6, 0.0),))
    twitchy = Kart(v=TOP_SPEED)
    twitchy.advance(track, 1 / 60, 0.3, False, 1.0)     # a single frame
    assert not twitchy.drifting
    slow = Kart(v=TOP_SPEED * 0.3)
    for _ in range(30):
        slow.advance(track, 1 / 60, 0.3, False, 1.0)
    assert not slow.drifting, "no drifting at parking speed"


def test_the_boost_pushes_past_top_speed_then_fades():
    track = Track((Segment(1e6, 0.0),))
    kart = Kart(v=TOP_SPEED, boost=BOOST_SECONDS)
    for _ in range(30):
        kart.advance(track, 1 / 60, 1.0, False, 0.0)
    assert kart.v > TOP_SPEED * 1.03, "the boost beats the limiter"
    assert kart.v <= TOP_SPEED * BOOST_TOP + 1e-6
    for _ in range(300):
        kart.advance(track, 1 / 60, 1.0, False, 0.0)
    assert kart.boost == 0.0 and kart.v < TOP_SPEED * 1.01, "and then it fades"


def test_the_boost_has_somewhere_to_go():
    """A boost that spends itself against the limiter is a firework, not an
    overtake: the kick must still be climbing well into the boost."""
    track = Track((Segment(1e6, 0.0),))
    kart = Kart(v=TOP_SPEED, boost=BOOST_SECONDS)
    ceiling = TOP_SPEED * BOOST_TOP
    climbing = 0
    for _ in range(int(BOOST_SECONDS * 60)):
        kart.advance(track, 1 / 60, 1.0, False, 0.0)
        climbing += kart.v < ceiling - 0.05
    assert climbing / (BOOST_SECONDS * 60) > 0.5, \
        "the kick spent most of the boost pinned against the ceiling"


def test_slipstream_pulls_close_behind_on_straights_only():
    track = build_track(7)                       # opens with a 260-unit straight
    leader = Kart(s=20.0, x=0.1, v=58.0)
    tucked = Kart(s=12.0, x=0.0, v=58.0)
    assert slipstream_pull(tucked, [leader, tucked], track) > 0.3
    far = Kart(s=-40.0 % track.length, x=0.0, v=58.0)
    assert slipstream_pull(far, [leader, far], track) == 0.0, "too far back"
    offset = Kart(s=12.0, x=0.9, v=58.0)
    assert slipstream_pull(offset, [leader, offset], track) == 0.0, "clean air"
    bendy = Track((Segment(1e6, 0.006),))
    assert slipstream_pull(tucked, [leader, tucked], bendy) == 0.0, "no tow in bends"


def test_the_tow_actually_speeds_the_player_up():
    def racing_round(player_s):
        round_ = RaceRound(OPTIONS)
        round_.countdown_from = -10.0            # past the lights
        round_.update(0.0, 1 / 60, Wheel(hands=2))
        round_.player.s, round_.player.x, round_.player.v = player_s, 0.35, 58.0
        round_.field_[0].s, round_.field_[0].x = player_s + 8.0, 0.35
        round_.field_[0].v = 58.0
        for i, kart in enumerate(round_.field_[1:]):
            kart.s = 1000.0 + 40.0 * i           # everyone else far away
        return round_

    towed, alone = racing_round(10.0), racing_round(10.0)
    alone.field_[0].s = 400.0                    # same straight, no tow
    towed.update(0.1, 1 / 30, Wheel(hands=2))
    alone.update(0.1, 1 / 30, Wheel(hands=2))
    assert towed.player.v > alone.player.v, "the tow is worth real speed"


# --- fairness: rubber band and full-field simulation -------------------------

def test_the_rubber_band_never_exceeds_eight_percent():
    for gap in (-1e6, -500.0, -60.0, 0.0, 60.0, 500.0, 1e6):
        assert 0.92 <= rubber_band(gap) <= 1.08
    assert rubber_band(300.0) > 1.0 > rubber_band(-300.0), "it helps the losers"
    assert rubber_band(0.0) == pytest.approx(1.0)


def test_three_full_races_every_rival_finishes_with_a_sane_spread():
    for seed in (3, 7, 11):
        round_ = RaceRound(RoundOptions(area=Rect(0, 0, 100, 100), seed=seed))
        now, dt = 0.0, 1 / 30
        while now < 480.0 and (not round_.finished or
                               any(k.finished_at is None for k in round_.field_)):
            now += dt
            round_.update(now, dt, Wheel(steer=scripted_driver(round_), hands=2))
        assert round_.finished, f"seed {seed}: the player finished"
        finishes = [kart.finished_at for kart in round_.field_]
        assert all(f is not None for f in finishes), \
            f"seed {seed}: every rival must finish - no corner pile-ups"
        laps = [f / round_.laps for f in finishes]
        # A rival may be as far behind as its PACE says it is and no further:
        # the grid is a ladder of top speeds, not a field falling apart. The
        # bound tracks RIVAL_PACE rather than a number typed once, so widening
        # the ladder for beginners cannot quietly excuse a kart that spent the
        # race in the gravel.
        assert max(laps) / min(laps) < RIVAL_PACE[1] / RIVAL_PACE[0] + 0.02, \
            f"seed {seed}: pace spread is sane"
        assert max(finishes) < round_.player.finished_at + 120.0


# --- the soundtrack of the race ----------------------------------------------

def test_the_countdown_beeps_each_second_then_releases():
    round_ = RaceRound(OPTIONS)
    beeps = 0
    for step in range(30):
        round_.update(step * 0.1, 1 / 60, Wheel(hands=2))
        beeps += round_.take_cues().count("countdown_beep")
    assert beeps == 3, "one beep per second of countdown"
    round_.update(3.05, 1 / 60, Wheel(hands=2))
    assert "race_go" in round_.take_cues()


def test_engine_cues_climb_with_speed_and_quicken():
    assert engine_period(0.0) > engine_period(TOP_SPEED / 2) > \
        engine_period(TOP_SPEED), "faster engine, faster cadence"
    round_ = RaceRound(OPTIONS)
    heard, now = [], 0.0
    while now < 20.0:
        now += 1 / 60
        round_.update(now, 1 / 60, Wheel(steer=scripted_driver(round_), hands=2))
        heard += [cue for cue in round_.take_cues() if cue.startswith("engine_")]
    assert heard[0] == "engine_low", "it starts at idle"
    assert "engine_high" in heard, "and screams at speed"
    assert heard.index("engine_low") < heard.index("engine_mid") \
        < heard.index("engine_high")


def test_gravel_skid_and_brake_squeal_cues():
    round_ = RaceRound(OPTIONS)
    now = 0.0
    while now < 12.0:                             # up to speed
        now += 1 / 60
        round_.update(now, 1 / 60, Wheel(hands=2))
    round_.take_cues()

    cues = []
    for _ in range(40):                           # two wheels on the gravel
        round_.player.x = ROAD_HALF_WIDTH * 1.5
        now += 1 / 60
        round_.update(now, 1 / 60, Wheel(hands=2))
        cues += round_.take_cues()
    assert "gravel" in cues

    round_.player.x, round_.player.v = 0.0, TOP_SPEED
    cues = []
    for _ in range(40):                           # lift with the lock on
        now += 1 / 60
        round_.update(now, 1 / 60,
                      Wheel(steer=1.0, throttle=DRIFT_LIFT - 0.2, hands=2))
        round_.player.v = max(round_.player.v, TOP_SPEED * 0.7)
        cues += round_.take_cues()
    assert "skid" in cues, "the drift is heard"

    round_.player.x, round_.player.v = 0.0, TOP_SPEED
    now += 1 / 60
    round_.update(now, 1 / 60, Wheel(brake=True, hands=2))
    assert "brake_squeal" in round_.take_cues(), "hard braking from speed squeals"


# --- playability: the webcam wheel is forgiving ------------------------------

class MediocreDriver:
    """Late, noisy and slow to decide - a fair model of a webcam wheel."""

    def __init__(self, seed: int) -> None:
        self.rng = random.Random(seed)
        self.queue: list[tuple[float, float]] = []
        self.held = 0.0
        self.next_decision = 0.0

    def steer(self, round_, now: float) -> float:
        self.queue.append((now, scripted_driver(round_)
                           + self.rng.uniform(-0.15, 0.15)))
        while self.queue and self.queue[0][0] <= now - 0.25:   # 250 ms of lag
            if now >= self.next_decision:                       # 15 Hz decisions
                self.held = self.queue[0][1]
                self.next_decision = now + 1 / 15
            self.queue.pop(0)
        return max(-1.0, min(1.0, self.held))


class Driver:
    """A reference human at the wheel, with the human parts left in.

    One driver, five dials, so that "a better driver" in these tests means a
    better DRIVER and not a different experiment. It sees the road ``lag``
    seconds late (the camera, the recogniser and the smoothing, end to end),
    makes up its mind ``rate`` times a second, shakes the wheel by ``wobble``
    at 4 Hz, loses its hands ``dropout`` of the time - and, if it knows how,
    trails the throttle into the corners (``lift``) and commits to the
    lift-and-turn that breaks the back end loose (``drift``, ``commit``).

    The wheel it returns is a real Wheel, throttle axis and all, so what these
    tests measure is what a player at a webcam can actually do.
    """

    #: The profiles the fairness tests are argued in terms of. A tenth of a
    #: second of lag is a good webcam on a good day; a third of a second with
    #: a fifth of a lock of wobble is a living room with the curtains open.
    ACE = dict(lag=0.12, wobble=0.03, rate=25.0, drift=True, lift=0.95)
    LAGGY = dict(lag=0.25, wobble=0.06, rate=12.0, drift=True, lift=0.95,
                 dropout=0.02)
    TYPICAL = dict(lag=0.22, wobble=0.14, rate=12.0, drift=True, commit=0.35,
                   lift=1.25, dropout=0.03)
    SLOPPY = dict(lag=0.30, wobble=0.20, rate=10.0, drift=False, lift=1.5,
                  dropout=0.05, cap=0.75)
    #: Lifts properly but never provokes the slide - the drift's control group.
    GRIPPER = dict(lag=0.12, wobble=0.03, rate=25.0, drift=False, lift=0.95,
                   cap=0.75)
    #: Never lifts, never drifts: the flat-out hero the corners exist for.
    CHARGER = dict(lag=0.12, wobble=0.03, rate=25.0, drift=False, lift=0.0)
    #: The CHARGER with the pedal put back and nothing else changed - the
    #: same eyes, the same hands, the same steering law. The pair of them is
    #: the only honest way to ask whether the throttle is worth anything.
    LIFTER = dict(lag=0.12, wobble=0.03, rate=25.0, drift=False, lift=0.95)

    def __init__(self, seed=0, lag=0.15, wobble=0.0, rate=20.0, drift=True,
                 commit=1.0, lift=1.05, dropout=0.0, cap=1.0, brakes=True):
        self.rng = random.Random(seed)
        self.lag, self.wobble, self.rate = lag, wobble, rate
        self.drift, self.commit, self.lift = drift, commit, lift
        self.dropout, self.cap, self.brakes = dropout, cap, brakes
        self.seen: list[tuple] = []
        self.next_decision = 0.0
        self.held = Wheel(hands=2)
        self.phase = self.rng.uniform(0.0, math.tau)
        self.committed = False
        self.was_tight = False

    def wheel(self, round_, now: float) -> Wheel:
        kart = round_.player
        self.seen.append((now, kart.s, kart.x, kart.v, kart.drifting))
        while len(self.seen) > 2 and self.seen[1][0] <= now - self.lag:
            self.seen.pop(0)
        if now < self.next_decision:
            return self.held
        self.next_decision = now + 1.0 / self.rate
        _, s, x, v, drifting = self.seen[0]

        track, ratio = round_.track, v / TOP_SPEED
        ahead = track.curvature_ahead(s, 55.0)
        here = track.curvature_at(s)
        steer = -ahead * 170 - x * 1.4 + here * 300 * ratio
        throttle, brake = 1.0, False

        corner = here if abs(here) > abs(ahead) else ahead
        tight = abs(corner) >= 0.0085 and ratio > 0.55
        if tight and not self.was_tight:
            self.committed = self.rng.random() < self.commit
        self.was_tight = tight
        exiting = abs(track.curvature_ahead(s, 26.0)) < 0.004
        if self.drift and self.committed and tight and not exiting:
            steer = math.copysign(max(abs(steer), DRIFT_STEER + 0.10), corner)
            if not drifting and ratio > 0.70:
                throttle = DRIFT_LIFT - 0.35        # lift: the back steps out
        elif self.drift and drifting and exiting:
            steer = math.copysign(min(abs(steer), DRIFT_EXIT - 0.10), steer)
        if self.lift and throttle == 1.0:
            # The pedal, trimmed in proportion to how much speed there is to
            # lose - and the brake only when easing off cannot lose it in
            # time. A driver who stamps on and off a switch is not the thing
            # these tests are trying to measure.
            limit = cornering_speed(ahead) * self.lift
            if v > limit:
                throttle = max(0.0, 1.0 - (v - limit) / (TOP_SPEED * 0.10))
                brake = self.brakes and v > limit * 1.25
        steer += self.wobble * math.sin(now * 4.0 * math.tau + self.phase)
        steer += self.rng.uniform(-self.wobble, self.wobble)
        if self.rng.random() < self.dropout:
            self.held = Wheel(steer=self.held.steer * 0.9, throttle=0.4, hands=0)
            return self.held
        self.held = Wheel(steer=max(-self.cap, min(self.cap, steer)),
                          brake=brake, throttle=throttle, hands=2)
        return self.held


def drive_a_race(seed, profile, laps=None, limit=700.0):
    """Run one whole race with a reference driver. Returns (round, report)."""
    round_ = RaceRound(RoundOptions(area=Rect(0, 0, 100, 100), seed=seed))
    if laps is not None:
        round_.laps = laps
    driver = Driver(seed=seed, **profile)
    now, dt = 0.0, 1 / 30
    report = {"gravel": 0.0, "boosts": 0, "bumps": 0, "cues": []}
    boost = 0.0
    while now < limit and not round_.finished:
        now += dt
        round_.update(now, dt, driver.wheel(round_, now))
        cues = round_.take_cues()
        report["cues"] += cues
        report["bumps"] += cues.count("bump")
        if round_.racing and abs(round_.player.x) > ROAD_HALF_WIDTH:
            report["gravel"] += dt
        if round_.player.boost > boost:
            report["boosts"] += 1
        boost = round_.player.boost
    report["time"] = round_.player.finished_at
    report["place"] = round_.position()
    return round_, report


def test_a_mediocre_driver_still_finishes_three_laps_in_time():
    for seed in (5, 9):
        round_ = RaceRound(RoundOptions(area=Rect(0, 0, 100, 100), seed=seed))
        driver = MediocreDriver(seed)
        now, dt = 0.0, 1 / 30
        while now < 360.0 and not round_.finished:
            now += dt
            round_.update(now, dt,
                          Wheel(steer=driver.steer(round_, now), hands=2))
        assert round_.finished, f"seed {seed}: the game must forgive a shaky wheel"
        assert round_.player.finished_at < 360.0, "three laps inside six minutes"
        assert len(round_.lap_times) == round_.laps


# --- round 2: pace, grid, drift economy, ghosts, physical gaps ---------------

def test_pace_scales_top_speed_and_decides_the_rivals_order():
    for seed in (3, 11):
        round_ = RaceRound(RoundOptions(area=Rect(0, 0, 100, 100), seed=seed))
        tops = [kart.top_speed for kart in round_.field_]
        assert max(tops) / min(tops) > 1.03, "the spread survives into top speed"
        now, dt = 0.0, 1 / 30
        while now < 480.0 and any(k.finished_at is None for k in round_.field_):
            now += dt
            round_.update(now, dt, Wheel(steer=scripted_driver(round_), hands=2))
        fastest = max(round_.field_, key=lambda k: k.pace)
        slowest = min(round_.field_, key=lambda k: k.pace)
        assert fastest.finished_at < slowest.finished_at, \
            f"seed {seed}: the quick rival beats the slow one"


def test_the_grid_is_shuffled_not_a_procession():
    grids = {}
    for seed in (3, 7, 11):
        round_ = RaceRound(RoundOptions(area=Rect(0, 0, 100, 100), seed=seed))
        grids[seed] = tuple(kart.s for kart in round_.field_)
    assert any(grid != tuple(sorted(grid)) for grid in grids.values()), \
        "rival numbers must not always line up front-to-back"
    assert len(set(grids.values())) > 1, "different seeds draw different grids"


def test_the_drift_hold_clock_starts_at_the_slide():
    track = Track((Segment(1e6, 0.0),))
    kart = Kart(v=TOP_SPEED)
    frames = int(round((DRIFT_ENGAGE + DRIFT_HOLD * 0.5) * 60))
    for _ in range(frames):                     # engaged, but held half the dues
        kart.advance(track, 1 / 60, DRIFT_LIFT - 0.2, False, 0.95)
    assert kart.drifting
    kart.advance(track, 1 / 60, 1.0, False, 0.0)
    assert kart.boost == 0.0, "pre-engage time must not count toward the hold"


def test_the_boost_has_a_cooldown():
    track = Track((Segment(1e6, 0.0),))
    kart = Kart(v=TOP_SPEED)

    def drift_and_exit():
        kart.v = max(kart.v, TOP_SPEED * 0.9)
        for _ in range(int((DRIFT_ENGAGE + DRIFT_HOLD) * 60) + 6):
            kart.advance(track, 1 / 60, DRIFT_LIFT - 0.2, False, 0.95)
            kart.v = max(kart.v, TOP_SPEED * 0.9)
        kart.advance(track, 1 / 60, 1.0, False, 0.0)

    drift_and_exit()
    assert kart.boost > 0.0, "the first clean exit pays"
    kart.boost = 0.0
    drift_and_exit()
    assert kart.boost == 0.0, "no second boost inside the cooldown"
    for _ in range(int(BOOST_COOLDOWN * 60) + 10):
        kart.advance(track, 1 / 60, 1.0, False, 0.0)
    drift_and_exit()
    assert kart.boost > 0.0, "the exhaust pays again once the cooldown is spent"


def test_the_drift_economy_is_earned_not_showered():
    round_ = RaceRound(RoundOptions(area=Rect(0, 0, 100, 100), seed=5))
    driver = MediocreDriver(5)
    now, dt = 0.0, 1 / 30
    skids = boosts = 0
    prev_boost = 0.0
    while now < 360.0 and not round_.finished:
        now += dt
        round_.update(now, dt, Wheel(steer=driver.steer(round_, now), hands=2))
        skids += round_.take_cues().count("skid")
        if round_.player.boost > prev_boost:
            boosts += 1
        prev_boost = round_.player.boost
    assert round_.finished
    assert boosts <= 14, f"a wobbly wheel banked {boosts} boosts - too generous"
    assert skids <= 35, f"{skids} skid cues is audio spam"


def test_one_lost_hand_holds_the_wheel_instead_of_phantom_steering():
    controller = WheelController(min_cutoff=1e4, beta=0.0)
    for step in range(6):
        wheel_at(controller, (0.3, 0.5), (0.7, 0.5), step / 30)  # dead straight
    one = controller.update([grip(0.72, 0.5)], 0.25)   # far off-centre wrist
    assert one.hands == 1
    assert abs(one.steer) < 0.06, "an off-centre wrist must not shove the kart"
    for step in range(60):                              # grace expires: ease off
        wheel_at(controller, (0.3, 0.35), (0.7, 0.65), 1.0 + step / 30)
    held = controller.update([grip(0.7, 0.65)], 3.1)
    assert held.steer > 0.4, "inside the grace the last steer is held"
    late = held.steer
    for step in range(90):
        late = controller.update([grip(0.7, 0.65)], 4.0 + step / 30).steer
    assert abs(late) < 0.1, "after the grace it eases toward neutral"


def test_finished_karts_are_ghosts_and_bumps_do_not_spam():
    round_ = RaceRound(OPTIONS)
    rival = round_.field_[0]
    bumps = 0
    for step in range(12):                    # 0.2 s of grinding contact
        round_.player.s, round_.player.x = 100.0, 0.0
        rival.s, rival.x = 100.5, 0.05
        round_._collide(10.0 + step / 60)
        bumps += round_.take_cues().count("bump")
    assert bumps == 1, "contact is one bump, not a drum roll"

    round_.player.finished_at = 20.0          # parked on the line
    round_.player.s, round_.player.x = 100.0, 0.0
    rival.s, rival.x, rival.v = 100.5, 0.05, 40.0
    round_._collide(30.0)
    assert rival.x == 0.05 and rival.v == 40.0, "the finished player is a ghost"
    assert "bump" not in round_.take_cues()


def test_the_rubber_band_gap_is_physical_not_a_lap_counter():
    track = build_track(7)
    leader = Kart(lap=1, s=2.0)
    chaser = Kart(lap=0, s=track.length - 3.0)
    assert progress_gap(leader, chaser, track) == pytest.approx(5.0), \
        "five units across the line is still five units"
    assert abs(rubber_band(5.0) - 1.0) < 0.002, "and pulls almost nothing"
    assert progress_gap(chaser, leader, track) == pytest.approx(-5.0)


# --- round 3: hot grip, the price of never braking, tamed traffic ------------

def test_grip_fades_with_speed_and_the_drift_keeps_its_floor():
    assert corner_grip(0.3) == 1.0 and corner_grip(0.62) == 1.0
    assert 1.0 > corner_grip(0.68) > corner_grip(0.74) > corner_grip(0.8)
    assert corner_grip(1.0) <= 0.55, "flat out the front end is half gone"
    assert corner_grip(1.0, drifting=True) == pytest.approx(DRIFT_GRIP), \
        "sideways, the kart keeps its drift grip however hot it is"
    assert cornering_speed(0.009) < TOP_SPEED * 0.8, \
        "a hairpin now demands a genuine lift"
    assert cornering_speed(0.0) > TOP_SPEED


def test_gravel_is_sticky_the_same_lock_steers_less():
    track = Track((Segment(1e6, 0.0),))
    on_road, in_trap = Kart(v=30.0, x=0.5), Kart(v=30.0, x=WALL)
    on_road.advance(track, 1 / 60, 0.0, False, steer=1.0)
    in_trap.advance(track, 1 / 60, 0.0, False, steer=1.0)
    assert (in_trap.x - WALL) < (on_road.x - 0.5) * 0.7, \
        "the sand trap holds what falls into it"


def test_a_boosted_hairpin_entry_cannot_be_saved_by_lock_alone():
    track = Track((Segment(1e6, 0.009),))
    kart = Kart(v=TOP_SPEED * 1.05, boost=5.0)   # flat out, exhaust roaring
    for _ in range(240):                          # four seconds of full lock
        kart.advance(track, 1 / 60, 1.0, False, steer=1.0)
        if kart.on_wall:
            break
    assert kart.on_wall, "carrying boost speed into a hairpin finds the wall"
    assert kart.v < TOP_SPEED, "and the wall takes its cut"


def hairpin_policy_wheel(round_, margin, steer):
    """A steer, plus a brake only when genuinely too hot for what is coming."""
    brake = False
    if margin is not None:
        ahead = round_.track.curvature_ahead(round_.player.s, 45.0)
        brake = round_.player.v > cornering_speed(ahead) * margin
    return Wheel(steer=steer, brake=brake, hands=2)


def race_with_policy(seed, margin, sloppy=True):
    round_ = RaceRound(RoundOptions(area=Rect(0, 0, 100, 100), seed=seed))
    driver = MediocreDriver(seed)
    now, dt = 0.0, 1 / 30
    gravel = bumps = 0
    while now < 480.0 and not round_.finished:
        now += dt
        steer = driver.steer(round_, now) if sloppy else scripted_driver(round_)
        round_.update(now, dt, hairpin_policy_wheel(round_, margin, steer))
        bumps += round_.take_cues().count("bump")
        if not round_.finished and abs(round_.player.x) > ROAD_HALF_WIDTH:
            gravel += 1
    return round_.player.finished_at, gravel * dt, bumps


def test_lifting_for_the_hairpins_beats_charging_them():
    """The teeth, measured over whole races by the same driver twice.

    The wheel this game is played with is laggy, so the corners cannot punish
    a mistake in a quarter of a second - see the lateral margin tests. They
    punish it the honest way instead: arrive flat out and the bend carries you
    across the road and off it, and the gravel keeps the difference. Lifting
    has to be the quicker way round - every seed, on the clock and in the
    gravel - or the throttle is a decoration and the lap is a cruise."""
    for seed in (3, 5, 7, 11, 13):
        _, charged = drive_a_race(seed, Driver.CHARGER)
        _, lifted = drive_a_race(seed, Driver.LIFTER)
        assert charged["time"] and lifted["time"]
        assert lifted["time"] < charged["time"] - 2.0, \
            f"seed {seed}: the flat-out hero must pay for the heat"
        assert charged["gravel"] > lifted["gravel"] + 1.0, \
            f"seed {seed}: and the price is paid in the gravel"
        assert lifted["bumps"] <= 20, \
            f"seed {seed}: traffic is racing, not a bumper-car din"
        assert charged["bumps"] <= charged["time"] / BUMP_COOLDOWN, \
            f"seed {seed}: even a charger's noises are rate-limited"


def test_a_hairpin_cannot_be_taken_flat_out():
    """The invariant behind the corner vocabulary, on the real circuits: hold
    top speed and full corrective lock into the tightest bend a generator can
    draw and the road still runs out before the corner does."""
    for seed in (3, 5, 7, 11, 13):
        track = build_track(seed)
        teeth = teeth_of(track.segments)
        assert len(teeth) >= TEETH_COUNT
        for tooth in teeth:
            seconds = tooth.length / TOP_SPEED
            margin = lateral_margin(tooth.curvature, 1.0)
            assert margin < seconds, \
                f"seed {seed}: {tooth.length:.0f} units of {tooth.curvature} " \
                f"can be held flat out for {margin:.1f}s of a {seconds:.1f}s corner"
            assert margin >= 2.0, \
                f"seed {seed}: only {margin:.1f}s to notice - no human can drive that"


def test_a_grinding_train_pays_the_shunt_toll_once():
    round_ = RaceRound(OPTIONS)
    rival = round_.field_[0]
    round_.player.v = 40.0
    rival.v = 0.0                                 # a proper rear-ender
    for step in range(12):                        # 0.2 s of constant contact
        round_.player.s, round_.player.x = 100.0, 0.0
        rival.s, rival.x = 102.0, 0.05
        round_._collide(10.0 + step / 60)
    assert round_.player.v == pytest.approx(40.0 * (1.0 - CONTACT_LOSS)), \
        "grinding costs one shunt, not twelve compounded"


def test_contact_shoves_rather_than_stops():
    """Touching another kart is racing, not a brick wall: the shunt costs a
    slice of speed at worst, punts the kart in front up the road, and knocks
    the pair apart instead of locking them together."""
    round_ = RaceRound(OPTIONS)
    rival = round_.field_[0]
    round_.player.s, round_.player.x, round_.player.v = 100.0, 0.0, 55.0
    rival.s, rival.x, rival.v = 102.0, 0.05, 20.0
    round_._collide(10.0)
    assert round_.player.v >= 55.0 * (1.0 - CONTACT_LOSS) - 1e-9, \
        "a shunt is a shove, never a stop"
    assert rival.v > 20.0, "the kart in front is punted along, not parked on"
    assert abs(round_.player.x - rival.x) > 0.05, "and they end up apart"

    # A brush at matched speed is almost free - side by side down a straight
    # is racing, not a crash.
    gentle = RaceRound(OPTIONS)
    other = gentle.field_[0]
    gentle.player.s, gentle.player.x, gentle.player.v = 100.0, 0.0, 50.0
    other.s, other.x, other.v = 102.0, 0.05, 49.5
    gentle._collide(10.0)
    assert gentle.player.v > 50.0 * 0.99, "a brush costs almost nothing"


def test_a_mistake_is_recoverable():
    """Parked against the barrier in the deep gravel, full lock the other way
    has to bring you back to the road and back up to speed."""
    track = Track((Segment(1e6, 0.0),))
    kart = Kart(v=0.0, x=WALL)
    now = 0.0
    while now < 12.0 and abs(kart.x) > ROAD_HALF_WIDTH:
        kart.advance(track, 1 / 60, throttle=1.0, brake=False, steer=-1.0)
        now += 1 / 60
    assert abs(kart.x) <= ROAD_HALF_WIDTH, "the sand trap is not a life sentence"
    assert now < 6.0, f"crawling back took {now:.1f}s - too long to be a mistake"
    for _ in range(6 * 60):
        kart.advance(track, 1 / 60, throttle=1.0, brake=False, steer=0.0)
    assert kart.v > TOP_SPEED * 0.85, "and the race is not over"


def test_deep_gravel_costs_more_than_a_clipped_kerb():
    track = Track((Segment(1e6, 0.0),))
    clipped = Kart(v=TOP_SPEED, x=ROAD_HALF_WIDTH * 1.03)
    buried = Kart(v=TOP_SPEED, x=WALL)
    for _ in range(90):
        clipped.advance(track, 1 / 60, 1.0, False, 0.0)
        buried.advance(track, 1 / 60, 1.0, False, 0.0)
    assert clipped.v > buried.v * 1.5, "a wheel on the dirt is not a beached kart"
    assert clipped.v < TOP_SPEED, "but it is not free either"


def test_the_chase_band_is_gentler_than_the_mercy_band():
    chase = rubber_band(400.0) - 1.0              # rivals hurrying after you
    mercy = 1.0 - rubber_band(-400.0)             # rivals easing off ahead
    assert 0.0 < chase < mercy * 0.7, \
        "a good drive banks a real gap instead of a photo finish"
    assert rubber_band(1e9) <= 1.02 and rubber_band(-1e9) >= 0.92


def test_a_clean_drift_boost_is_worth_real_distance():
    track = Track((Segment(1e6, 0.0),))
    boosted = Kart(v=TOP_SPEED, boost=BOOST_SECONDS)
    plain = Kart(v=TOP_SPEED)
    for _ in range(5 * 60):
        boosted.advance(track, 1 / 60, 1.0, False, 0.0)
        plain.advance(track, 1 / 60, 1.0, False, 0.0)
    assert boosted.s - plain.s > 7.0, "a banked boost buys a visible gap"
    assert BOOST_COOLDOWN <= 4.0, "and pays out often enough to chase laps with"


def test_the_rivals_keep_racing_after_the_player_parks():
    round_ = RaceRound(OPTIONS)
    round_.countdown_from = -10.0                 # lights long since out
    round_.update(0.0, 1 / 60, Wheel(hands=2))
    round_.player.finished_at = 1.0
    round_.player.lap = round_.laps
    parked_s, parked_v = round_.player.s, round_.player.v
    before = [kart.s for kart in round_.field_]
    for kart in round_.field_:
        kart.v = 30.0
    for step in range(30):
        round_.update(1.0 + step / 30, 1 / 30, Wheel(hands=2))
    moved = [(kart.s - s0) % round_.track.length
             for kart, s0 in zip(round_.field_, before)]
    assert all(m > 5.0 for m in moved), "the podium under P-you must settle"
    assert round_.player.s == parked_s and round_.player.v == parked_v, \
        "while the parked player stays parked"


def test_the_results_screen_keeps_the_race_alive(monkeypatch):
    import itertools
    import time

    import cv2
    import numpy as np

    from handy import app, karting, maps
    from handy.audio import Audio, Sounds

    class ParkedRound(RaceRound):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, **kwargs)
            self.updates_after_finish = 0

        def update(self, now, dt, wheel):
            if self.finished:
                self.updates_after_finish += 1
            super().update(now, dt, wheel)

    now0 = time.monotonic()
    round_ = ParkedRound(RoundOptions(area=Rect(0, 0, 960, 540), seed=3))
    round_.countdown_from = round_.started_at = round_._lap_started = now0 - 90
    round_.player.finished_at = now0 - 1.0
    round_.player.lap = round_.laps
    round_.lap_times = [30.0, 30.0, 30.0]
    for kart in round_.field_:
        kart.v = 40.0
    before = [kart.progress for kart in round_.field_]

    class FakeCapture:
        def read(self):
            return True, np.zeros((720, 1280, 3), np.uint8)

    class NoHands:
        """A recogniser that never sees hands: deterministic and model-free."""

        def submit(self, image): pass

        def latest(self):
            from handy.recognition import Frame

            return Frame()

        def close(self): pass

        def __enter__(self): return self

        def __exit__(self, *exc): return None

    import handy.recognition

    monkeypatch.setattr(handy.recognition, "GestureStream",
                        lambda *args, **kwargs: NoHands())
    for name in ("imshow", "setMouseCallback"):
        monkeypatch.setattr(cv2, name, lambda *args, **kwargs: None)
    keys = itertools.chain([255] * 12, itertools.repeat(ord("q")))
    monkeypatch.setattr(cv2, "waitKey", lambda *args: next(keys))
    monkeypatch.setattr(cv2, "getWindowProperty", lambda *args: 1.0)
    monkeypatch.setattr(app, "new_round", lambda *args, **kwargs: round_)

    layout = app.layout_for(960, 540)
    settings = app.Settings(seed=3, window_width=960, window_height=540)
    canvas = np.zeros((540, 960, 3), np.uint8)
    sounds = Sounds(Audio(enabled=False), 5)
    got, reason = karting.drive([FakeCapture()], canvas, settings, layout,
                                maps.KART, sounds)
    assert reason == "quit" and got is round_
    assert round_.updates_after_finish >= 3, \
        "the results screen must keep ticking the race"
    after = [kart.progress for kart in round_.field_]
    assert any(b > a for a, b in zip(before, after)), \
        "rivals kept lapping under the podium"


# --- the critic's last three findings, pinned --------------------------------

def test_a_webcam_blip_does_not_cut_the_throttle():
    controller = WheelController(min_cutoff=1e4, beta=0.0)
    for step in range(6):
        wheel_at(controller, (0.3, 0.45), (0.7, 0.55), step / 30)
    blip = controller.update([], 0.25)      # two dropped frames
    assert blip.held and blip.tracking, "inside the grace the wheel is held"
    gone = controller.update([], 2.0)
    assert not gone.tracking, "a real loss is a real loss"


def test_hitting_the_wall_is_heard():
    round_ = RaceRound(OPTIONS)
    now = 0.0
    while round_.countdown(now) is not None:
        now += 1 / 60
        round_.update(now, 1 / 60, Wheel(steer=0.0, hands=2))
    for _ in range(60 * 8):                 # full lock into the wall
        now += 1 / 60
        round_.update(now, 1 / 60, Wheel(steer=1.0, hands=2))
        if "bump" in round_.cues:
            break
    assert "bump" in round_.take_cues(), "a 45% speed loss deserves a noise"


def test_finishing_while_braking_cannot_skip_the_podium(monkeypatch, tmp_path):
    """Crossing the line with open hands must land ON the results, not through
    them: the restart gesture only arms after a non-braking frame."""
    import itertools

    import cv2
    import numpy as np

    from handy import app, karting, maps
    from handy.audio import Audio, Sounds
    from handy.recognition import Frame

    class FakeCapture:
        def read(self):
            return True, np.zeros((720, 1280, 3), np.uint8)

    # The stream always reports two open hands: a player who finished braking.
    class OpenHands:
        def submit(self, image): pass
        def latest(self):
            return Frame(hands=(grip(0.3, 0.5, open_hand=True),
                                grip(0.7, 0.5, open_hand=True)))
        def close(self): pass
        def __enter__(self): return self
        def __exit__(self, *exc): return None

    monkeypatch.setattr(karting, "GestureStream",
                        lambda *args, **kwargs: OpenHands(), raising=False)
    import handy.recognition
    monkeypatch.setattr(handy.recognition, "GestureStream",
                        lambda *args, **kwargs: OpenHands())
    for name in ("imshow", "setMouseCallback"):
        monkeypatch.setattr(cv2, name, lambda *args, **kwargs: None)
    keys = itertools.repeat(255)
    monkeypatch.setattr(cv2, "waitKey", lambda *args: next(keys))
    monkeypatch.setattr(cv2, "getWindowProperty", lambda *args: 1.0)

    layout = app.layout_for(960, 540)
    settings = app.Settings(seed=3, window_width=960, window_height=540)
    canvas = np.zeros((540, 960, 3), np.uint8)

    class AlwaysBraking:
        def update(self, hands, t, reading=None):
            return Wheel(steer=0.0, brake=True, hands=2)

    # Race already finished; the loop should sit on the results with the brake
    # held and NOT return "again" - it exits only via the scripted quit key.
    round_ = karting.RaceRound(app.RoundOptions(area=layout.play_area, seed=3))
    round_.player.finished_at = 1.0
    round_.player.lap = round_.laps
    monkeypatch.setattr(karting, "WheelController", lambda *a, **k: AlwaysBraking())
    monkeypatch.setattr(app, "new_round", lambda *args: round_)
    keys = itertools.chain([255] * 30, itertools.repeat(ord("q")))
    monkeypatch.setattr(cv2, "waitKey", lambda *args: next(keys))

    _, reason = karting.drive([FakeCapture()], canvas, settings, layout,
                              maps.KART, Sounds(Audio(enabled=False), 5))
    assert reason == "quit", "held brake never restarted the race"


# --- the countdown is the calibration ----------------------------------------

def test_the_lights_wait_for_both_hands():
    round_ = RaceRound(OPTIONS)
    for step in range(30):
        round_.update(step / 30, 1 / 30, Wheel(steer=0.0, hands=0))
    assert round_.waiting_for_hands, "no hands, no countdown"
    assert round_.player.v == 0.0

    round_.update(2.0, 1 / 30, Wheel(steer=0.0, hands=2))
    assert not round_.waiting_for_hands, "gripping the wheel starts the lights"
    assert round_.countdown(2.5) is not None


def test_a_tilted_grip_becomes_straight_ahead():
    """The neutral question: a player whose comfortable grip rolls 12 degrees
    (or whose camera is tilted) must not fight a permanent pull."""
    controller = WheelController(min_cutoff=1e4, beta=0.0)
    quarter = math.tan(math.radians(12.0))

    def tilted(offset_deg, t):
        dy = math.tan(math.radians(offset_deg)) * 0.4   # wrists sit 0.4 apart
        return wheel_at(controller, (0.3, 0.5 - dy / 2), (0.7, 0.5 + dy / 2), t)

    rolls = [tilted(12.0, step / 30).roll for step in range(20)]
    assert all(abs(r - 12.0) < 1.0 for r in rolls), "the raw roll is reported"
    controller.set_neutral(rolls)
    assert controller.neutral == pytest.approx(12.0, abs=1.0)

    settled = [tilted(12.0, 1.0 + step / 30) for step in range(10)][-1]
    assert abs(settled.steer) < 0.05, "the same grip now steers straight"
    turned = [tilted(40.0, 2.0 + step / 30) for step in range(10)][-1]
    assert turned.steer > 0.3, "and turning past it still steers"
    del quarter


def test_an_implausible_neutral_is_refused():
    controller = WheelController(min_cutoff=1e4, beta=0.0)
    controller.set_neutral([40.0] * 20)     # mid-turn, not a resting grip
    assert controller.neutral == 0.0
    controller.set_neutral([])
    assert controller.neutral == 0.0


def test_the_drive_loop_learns_neutral_through_the_countdown(monkeypatch):
    import itertools

    import cv2
    import numpy as np

    from handy import app, karting, maps
    from handy.audio import Audio, Sounds
    from handy.recognition import Frame

    dy = math.tan(math.radians(10.0)) * 0.4   # a 10-degree tilt over 0.4 apart

    class TiltedHands:
        def submit(self, image): pass

        def latest(self):
            return Frame(hands=(grip(0.3, 0.5 - dy / 2), grip(0.7, 0.5 + dy / 2)))

        def close(self): pass

        def __enter__(self): return self

        def __exit__(self, *exc): return None

    import handy.recognition

    monkeypatch.setattr(handy.recognition, "GestureStream",
                        lambda *args, **kwargs: TiltedHands())

    class FakeCapture:
        def read(self):
            return True, np.zeros((720, 1280, 3), np.uint8)

    for name in ("imshow", "setMouseCallback"):
        monkeypatch.setattr(cv2, name, lambda *args, **kwargs: None)
    # The countdown runs on the wall clock; shorten it so scripted frames,
    # which spin far faster than real time, actually get past it.
    monkeypatch.setattr(karting.RaceRound, "COUNTDOWN", 0.15)
    import time as _time

    keys = itertools.chain([255] * 120, itertools.repeat(ord("q")))

    def paced_key(*args):
        _time.sleep(0.005)
        return next(keys)
    monkeypatch.setattr(cv2, "waitKey", paced_key)
    monkeypatch.setattr(cv2, "getWindowProperty", lambda *args: 1.0)

    captured = {}
    original = karting.WheelController.set_neutral

    def spy(self, rolls, clamp=False):
        captured["rolls"] = list(rolls)
        taken = original(self, rolls, clamp)
        captured["neutral"] = self.neutral
        return taken

    monkeypatch.setattr(karting.WheelController, "set_neutral", spy)

    layout = app.layout_for(960, 540)
    settings = app.Settings(seed=3, window_width=960, window_height=540)
    canvas = np.zeros((540, 960, 3), np.uint8)
    karting.drive([FakeCapture()], canvas, settings, layout, maps.KART,
                  Sounds(Audio(enabled=False), 5))

    assert captured.get("rolls"), "the countdown gathered the resting grip"
    assert captured["neutral"] == pytest.approx(10.0, abs=1.5)


# --- round 4: the flag decides the podium ------------------------------------

def test_the_classification_is_ranked_by_the_flag_not_the_overshoot():
    """Every finisher is frozen a random sliver past the line, so ranking by
    distance ranks the winner by luck. The clock is the only honest order."""
    round_ = RaceRound(OPTIONS)
    winner, second, running = round_.player, round_.field_[0], round_.field_[1]
    winner.lap, winner.finished_at, winner.s = round_.laps, 100.0, 0.2
    second.lap, second.finished_at, second.s = round_.laps, 118.0, 40.0
    running.lap, running.s = round_.laps - 1, round_.track.length - 1.0

    assert round_.standings()[:2] == [winner, second], \
        "the kart that took the flag first is the winner, overshoot or not"
    assert round_.position() == 1
    assert round_.standings()[-1].finished_at is None, \
        "a kart still on the road is behind everyone who has finished"
    assert rank_key(winner) < rank_key(second) < rank_key(running)


def test_the_winner_of_the_race_is_the_winner_on_the_podium():
    """The whole loop, not a fixture: whoever crosses the line first must be
    P1 in position(), in the standings, and therefore in the points."""
    for seed in (3, 7, 11):
        round_, _ = drive_a_race(seed, Driver.ACE)
        now, dt = round_.player.finished_at, 1 / 30
        while now < 900.0 and any(k.finished_at is None for k in round_.field_):
            now += dt
            round_.update(now, dt, Wheel(hands=2))
            round_.take_cues()
        times = [kart.finished_at for kart in round_.everyone()]
        assert all(t is not None for t in times), f"seed {seed}: nobody DNFs"
        assert round_.player.finished_at == min(times), \
            f"seed {seed}: the reference driver should have won on the road"
        assert round_.position() == 1, \
            f"seed {seed}: won the race, classified P{round_.position()}"
        assert round_.standings()[0] is round_.player
        order = [kart.finished_at for kart in round_.standings()]
        assert order == sorted(order), "the classification is the finish order"


def test_a_photo_finish_is_decided_inside_the_frame():
    """Two karts over the line on the same frame are not a dead heat: the one
    that overshot further got there first."""
    ahead = Kart(v=50.0, s=6.0)
    behind = Kart(v=50.0, s=1.0)
    assert crossed_at(ahead, 10.0, 1 / 30) < crossed_at(behind, 10.0, 1 / 30)
    assert crossed_at(Kart(v=0.0, s=0.0), 10.0, 1 / 30) == 10.0, "a parked kart"
    stale = crossed_at(Kart(v=50.0, s=500.0), 10.0, 1 / 30)
    assert stale == pytest.approx(10.0 - 1 / 30), "never before this frame"


# --- round 4: the wheel is read from a picture -------------------------------

def test_an_unmirrored_camera_does_not_invert_the_wheel():
    """--no-mirror reverses left and right in the picture. The same physical
    turn of the hands has to steer the same way regardless."""
    mirrored = WheelController(min_cutoff=1e4, beta=0.0)
    raw = WheelController(min_cutoff=1e4, beta=0.0, mirrored=False)
    for step in range(6):
        # A clockwise turn: the driver's right hand drops, the left rises.
        # Mirrored, the right hand is on the right of the picture; raw, it is
        # on the left.
        seen = wheel_at(mirrored, (0.3, 0.45), (0.7, 0.55), step / 30)
        flipped = wheel_at(raw, (0.3, 0.55), (0.7, 0.45), step / 30)
    assert seen.steer > 0.2, "turning the wheel right steers right"
    assert flipped.steer == pytest.approx(seen.steer, abs=0.02), \
        "and it still does with the raw camera"
    assert flipped.roll == pytest.approx(seen.roll, abs=0.5), \
        "the reported roll is the wheel's, not the picture's"


def test_the_drive_loop_tells_the_wheel_which_way_the_picture_faces(monkeypatch):
    """--no-mirror has to reach the wheel, or the kart steers backwards with
    nothing on screen to say why."""
    import itertools

    import cv2
    import numpy as np

    from handy import app, karting, maps
    from handy.audio import Audio, Sounds
    from handy.recognition import Frame

    class FakeCapture:
        def read(self):
            return True, np.zeros((720, 1280, 3), np.uint8)

    class NoHands:
        def submit(self, image): pass

        def latest(self): return Frame()

        def close(self): pass

        def __enter__(self): return self

        def __exit__(self, *exc): return None

    import handy.recognition

    monkeypatch.setattr(handy.recognition, "GestureStream",
                        lambda *a, **kw: NoHands())
    for name in ("imshow", "setMouseCallback"):
        monkeypatch.setattr(cv2, name, lambda *args, **kwargs: None)
    pressed = {"keys": iter(())}
    monkeypatch.setattr(cv2, "waitKey", lambda *args: next(pressed["keys"]))
    monkeypatch.setattr(cv2, "getWindowProperty", lambda *args: 1.0)

    built = []
    real = karting.WheelController
    monkeypatch.setattr(karting, "WheelController",
                        lambda *a, **kw: built.append(kw) or real(*a, **kw))

    layout = app.layout_for(960, 540)
    canvas = np.zeros((540, 960, 3), np.uint8)
    for mirror in (True, False):
        built.clear()
        pressed["keys"] = itertools.chain([255] * 2, itertools.repeat(ord("q")))
        karting.drive([FakeCapture()], canvas,
                      app.Settings(seed=3, mirror=mirror, window_width=960,
                                   window_height=540),
                      layout, maps.KART, Sounds(Audio(enabled=False), 5))
        assert built and built[0].get("mirrored") is mirror


# --- round 4: one recognition is one reading ---------------------------------

def test_a_replayed_recognition_is_not_a_second_reading():
    """The recogniser runs behind the render loop and hands out the same
    result for several frames. Counting it twice turns one mistaken open palm
    into a brake."""
    controller = WheelController(min_cutoff=1e4, beta=0.0)
    hands = [grip(0.3, 0.5, open_hand=True), grip(0.7, 0.5, open_hand=True)]
    assert not controller.update(hands, 0.00, reading=7).brake
    assert not controller.update(hands, 0.02, reading=7).brake, \
        "the same recognition replayed is not a second reading"
    assert not controller.update(hands, 0.04, reading=7).brake
    assert controller.update(hands, 0.06, reading=8).brake, \
        "a genuinely new reading arms the brake"


def test_a_bridged_dropout_does_not_bank_an_open_hand():
    """Hands open, tracking blips out, hands come back open: the debounce
    starts again rather than firing the brake on the first frame back."""
    controller = WheelController(min_cutoff=1e4, beta=0.0)
    assert not wheel_at(controller, (0.3, 0.5), (0.7, 0.5), 0.0, open_hands=True).brake
    blip = controller.update([], 0.05)
    assert blip.held and not blip.brake
    assert not wheel_at(controller, (0.3, 0.5), (0.7, 0.5), 0.1,
                        open_hands=True).brake, "the streak did not survive"
    assert wheel_at(controller, (0.3, 0.5), (0.7, 0.5), 0.15, open_hands=True).brake


def test_the_roll_is_never_a_stale_angle():
    controller = WheelController(min_cutoff=1e4, beta=0.0)
    for step in range(6):
        turned = wheel_at(controller, (0.3, 0.35), (0.7, 0.65), step / 30)
    assert turned.roll > 20.0
    assert controller.update([grip(0.7, 0.65)], 0.25).roll == 0.0, \
        "one hand is no wheel to read"
    assert controller.update([], 0.3).roll == 0.0, "and no hands is no wheel"


# --- round 4: the calibration answers back ------------------------------------

def test_a_refused_calibration_says_so_and_can_be_taken_again():
    controller = WheelController(min_cutoff=1e4, beta=0.0)
    assert controller.set_neutral([40.0] * 9) is False, "mid-turn is not level"
    assert controller.neutral == 0.0 and controller.needs_level
    assert controller.set_neutral([8.0] * 9) is True, "a second chance is taken"
    assert controller.neutral == pytest.approx(8.0)
    assert not controller.needs_level


def test_the_last_word_clamps_rather_than_leaving_a_phantom_pull():
    controller = WheelController(min_cutoff=1e4, beta=0.0)
    assert controller.set_neutral([40.0] * 9, clamp=True) is True
    assert controller.neutral == pytest.approx(controller.MAX_NEUTRAL), \
        "half a phantom pull beats a whole one"
    assert controller.needs_level, "and the HUD is told to ask for level hands"
    hinted = wheel_at(controller, (0.3, 0.5), (0.7, 0.5), 0.0)
    assert hinted.level_hint, "the hint rides along on the wheel"


def test_the_drive_loop_asks_again_when_the_grip_was_refused(monkeypatch):
    """A player caught mid-turn at the lights must not fight a phantom pull
    for the whole race: the calibration is retried after GO."""
    import itertools
    import time as _time

    import cv2
    import numpy as np

    from handy import app, karting, maps
    from handy.audio import Audio, Sounds
    from handy.recognition import Frame

    tilt = {"deg": 40.0}                          # mid-turn when the lights go

    class Hands:
        def submit(self, image): pass

        def latest(self):
            dy = math.tan(math.radians(tilt["deg"])) * 0.4
            return Frame(hands=(grip(0.3, 0.5 - dy / 2), grip(0.7, 0.5 + dy / 2)),
                         timestamp_ms=int(_time.monotonic() * 1000))

        def close(self): pass

        def __enter__(self): return self

        def __exit__(self, *exc): return None

    class FakeCapture:
        def read(self):
            return True, np.zeros((720, 1280, 3), np.uint8)

    import handy.recognition

    monkeypatch.setattr(handy.recognition, "GestureStream",
                        lambda *a, **kw: Hands())
    monkeypatch.setattr(karting.RaceRound, "COUNTDOWN", 0.1)
    monkeypatch.setattr(karting, "RECALIBRATE", 0.6)
    for name in ("imshow", "setMouseCallback"):
        monkeypatch.setattr(cv2, name, lambda *args, **kwargs: None)
    monkeypatch.setattr(cv2, "getWindowProperty", lambda *args: 1.0)

    taken = []
    original = karting.WheelController

    class Spy(original):
        def set_neutral(self, rolls, clamp=False):
            got = super().set_neutral(rolls, clamp)
            taken.append((got, round(self.neutral, 1)))
            return got

    monkeypatch.setattr(karting, "WheelController", Spy)

    keys = itertools.chain([255] * 200, itertools.repeat(ord("q")))

    def paced(*args):
        _time.sleep(0.004)
        if len(taken) == 1:                       # refused once: settle level
            tilt["deg"] = 6.0
        return next(keys)

    monkeypatch.setattr(cv2, "waitKey", paced)

    layout = app.layout_for(960, 540)
    settings = app.Settings(seed=3, window_width=960, window_height=540)
    karting.drive([FakeCapture()], np.zeros((540, 960, 3), np.uint8), settings,
                  layout, maps.KART, Sounds(Audio(enabled=False), 5))

    assert taken, "the calibration was attempted"
    assert taken[0][0] is False, "a 40-degree grip is refused"
    assert any(got for got, _ in taken), "and asked for again"
    assert taken[-1][1] == pytest.approx(6.0, abs=1.5), \
        "the level grip the player settled into became straight-ahead"


# --- round 4: the podium is not a flicker ------------------------------------

def results_run(monkeypatch, wheels, dwell, frames=40):
    """Run the real drive loop parked on the results screen with a scripted
    wheel, and report why it left."""
    import itertools

    import cv2
    import numpy as np

    from handy import app, karting, maps
    from handy.audio import Audio, Sounds
    from handy.recognition import Frame

    class FakeCapture:
        def read(self):
            return True, np.zeros((720, 1280, 3), np.uint8)

    class NoHands:
        def submit(self, image): pass

        def latest(self): return Frame()

        def close(self): pass

        def __enter__(self): return self

        def __exit__(self, *exc): return None

    class Scripted:
        def __init__(self, *args, **kwargs):
            self.seen = 0

        def update(self, hands, t, reading=None):
            self.seen += 1
            return wheels(self.seen)

    import handy.recognition

    monkeypatch.setattr(handy.recognition, "GestureStream",
                        lambda *a, **kw: NoHands())
    monkeypatch.setattr(karting, "WheelController", Scripted)
    monkeypatch.setattr(karting, "RESULTS_DWELL", dwell)
    for name in ("imshow", "setMouseCallback"):
        monkeypatch.setattr(cv2, name, lambda *args, **kwargs: None)
    keys = itertools.chain([255] * frames, itertools.repeat(ord("q")))
    monkeypatch.setattr(cv2, "waitKey", lambda *args: next(keys))
    monkeypatch.setattr(cv2, "getWindowProperty", lambda *args: 1.0)

    layout = app.layout_for(960, 540)
    round_ = karting.RaceRound(RoundOptions(area=layout.play_area, seed=3))
    round_.player.finished_at, round_.player.lap = 1.0, round_.laps
    round_.lap_times = [30.0, 30.0, 30.0]
    monkeypatch.setattr(app, "new_round", lambda *args, **kwargs: round_)

    settings = app.Settings(seed=3, window_width=960, window_height=540)
    _, reason = karting.drive([FakeCapture()], np.zeros((540, 960, 3), np.uint8),
                              settings, layout, maps.KART,
                              Sounds(Audio(enabled=False), 5))
    return reason


def test_relaxing_your_arms_does_not_wipe_the_podium(monkeypatch):
    """Open hands alone are half the gesture. A driver who crosses the line
    and lets go must still get to read the classification."""
    assert results_run(monkeypatch,
                       lambda n: Wheel(brake=True, hands=2), 0.0) == "quit"


def test_open_then_closed_hands_start_the_next_race(monkeypatch):
    assert results_run(monkeypatch,
                       lambda n: Wheel(brake=n <= 5, hands=2), 0.0) == "again"


def test_the_podium_is_yours_for_a_moment_before_any_gesture(monkeypatch):
    """The whole gesture, performed immediately, must still not skip a podium
    nobody has had time to read."""
    assert results_run(monkeypatch, lambda n: Wheel(brake=n <= 2, hands=2),
                       dwell=30.0) == "quit"


# --- round 4: the drift is a decision ----------------------------------------

def slide_for(seconds, exit_steer=0.0):
    """Hold a drift for `seconds` of actual slide, then straighten."""
    track = Track((Segment(1e6, 0.0),))
    kart = Kart(v=TOP_SPEED)
    for _ in range(int((DRIFT_ENGAGE + seconds) * 60) + 1):
        kart.advance(track, 1 / 60, DRIFT_LIFT - 0.2, False, 0.95)
        kart.v = max(kart.v, TOP_SPEED * 0.9)     # hold the momentum up
    kart.advance(track, 1 / 60, 1.0, False, exit_steer)
    return kart


def test_a_long_slide_is_worth_more_than_a_snatched_one():
    short = slide_for(DRIFT_HOLD + 0.1)
    long_ = slide_for(DRIFT_LONG + 0.1)
    assert short.boost == pytest.approx(BOOST_SECONDS, abs=1 / 30)
    assert long_.boost == pytest.approx(BOOST_LONG_SECONDS, abs=1 / 30)
    assert BOOST_LONG_SECONDS > BOOST_SECONDS, "staying sideways pays better"
    assert slide_for(DRIFT_HOLD * 0.5).boost == 0.0, "and a flick pays nothing"


def test_the_brake_snaps_the_back_end_loose():
    """Braking with the lock already on is the way into a hairpin: the slide
    starts at once instead of after the usual hold."""
    track = Track((Segment(1e6, 0.0),))
    lifted, braked = Kart(v=TOP_SPEED), Kart(v=TOP_SPEED)
    for _ in range(6):                            # a tenth of a second
        lifted.advance(track, 1 / 60, DRIFT_LIFT - 0.2, False, 0.95)
        braked.advance(track, 1 / 60, 0.0, True, 0.95)
    assert braked.drifting, "brake plus lock breaks the back end loose at once"
    assert not lifted.drifting, "a lift alone has to be held for a beat"


def test_the_drift_carries_speed_the_scrub_does_not():
    """Sideways, a kart keeps its momentum; ploughing on at full lock with the
    front end overloaded scrubs it away. That is the whole trade."""
    track = Track((Segment(1e6, 0.0),))
    plough = Kart(v=TOP_SPEED)
    for _ in range(20):
        plough.advance(track, 1 / 60, 1.0, False, 1.0)
    assert not plough.drifting
    assert plough.v < TOP_SPEED * 0.98, "leaning on the front end costs speed"

    gentle = Kart(v=TOP_SPEED)
    for _ in range(20):
        gentle.advance(track, 1 / 60, 1.0, False, 0.1)
    assert gentle.v > plough.v, "a kart on a straight keeps what it has"


# --- round 4: fairness -------------------------------------------------------

SEEDS = (3, 5, 7, 11, 13)


def test_the_better_driver_wins_and_the_band_cannot_buy_it_back():
    """Position must track skill, not luck: the same rivals, the same
    circuits, two drivers of clearly different skill."""
    wins = 0
    for seed in SEEDS:
        _, good = drive_a_race(seed, Driver.ACE)
        _, poor = drive_a_race(seed, Driver.SLOPPY)
        assert good["time"] < poor["time"], f"seed {seed}: skill has to show"
        assert good["place"] <= poor["place"], \
            f"seed {seed}: the quicker driver was classified P{good['place']} " \
            f"behind P{poor['place']}"
        wins += good["place"] == 1
    assert wins >= 4, f"the good driver won only {wins} of five"


def test_the_grid_is_a_ladder_the_player_climbs():
    """The finding that mattered most: with the field packed inside ten
    percent of itself, every human alive finished P6 of 6 and the result said
    nothing about the driving. A skill spread of tens of seconds needs a grid
    spread of tens of seconds to land in - so the sloppy driver must find
    karts behind them, the good one karts ahead, and moving between the two
    must move the player up the sheet."""
    ladders = 0
    for seed in SEEDS:
        _, ace = drive_a_race(seed, Driver.ACE)
        _, mid = drive_a_race(seed, Driver.TYPICAL)
        _, poor = drive_a_race(seed, Driver.SLOPPY)
        assert poor["place"] < 6, \
            f"seed {seed}: even a poor drive must beat somebody"
        assert ace["place"] <= mid["place"] <= poor["place"], \
            f"seed {seed}: places {ace['place']}, {mid['place']}, {poor['place']}"
        ladders += ace["place"] < poor["place"]
    assert ladders >= 3, \
        f"skill changed the classification in only {ladders} of five races"


def test_a_quarter_second_of_lag_can_still_win_the_race():
    """The blocking finding: a driver running a sane control law finished LAST
    in 14 of 14 races from 200 ms of lag up, because the road was crossed in
    0.85 s and a fifth of a second of it was spent blind. The lateral loop is
    now slow enough that a late, shaky, occasionally hand-less driver is a
    RACER: at 250 ms they must still be able to win."""
    places, times = [], []
    for seed in SEEDS:
        _, laggy = drive_a_race(seed, Driver.LAGGY)
        places.append(laggy["place"])
        times.append(laggy["time"])
    assert all(t is not None for t in times), "and finish, at every seed"
    assert min(places) == 1, f"P1 unreachable at 250 ms of lag: {places}"
    assert max(places) <= 3, f"a quarter second must not cost the race: {places}"


def test_the_drift_is_the_way_round_a_corner_not_a_tax():
    """Sideways has to be FASTER. The whole mechanic used to cost 8.8% of the
    race time it was meant to save: the boost hit the limiter in a seventh of
    a second and the slide bled harder than the understeer it replaced."""
    drifted = gripped = 0
    for seed in SEEDS:
        _, sliding = drive_a_race(seed, Driver.ACE)
        _, gripping = drive_a_race(seed, Driver.GRIPPER)
        assert sliding["boosts"] >= 3, \
            f"seed {seed}: a whole race of hairpins banked " \
            f"{sliding['boosts']} boosts"
        drifted += sliding["time"]
        gripped += gripping["time"]
    assert drifted < gripped * 0.97, \
        f"drifting cost {100 * (drifted / gripped - 1):+.1f}% of the race"


def test_the_slipstream_is_worth_the_same_to_the_slowest_kart():
    """The tow is a fraction of your OWN top speed. A ceiling in absolute
    units would hand the slowest kart on the grid the biggest gift."""
    track = build_track(7)
    slow = Kart(s=12.0, v=50.0, pace=0.9, top_speed=TOP_SPEED * 0.9)
    leader = Kart(s=20.0, v=50.0)
    assert slipstream_pull(slow, [leader, slow], track) > 0.0
    round_ = RaceRound(OPTIONS)
    round_.countdown_from = -10.0
    round_.update(0.0, 1 / 60, Wheel(hands=2))
    rival = round_.field_[0]
    rival.pace, rival.top_speed = 0.9, TOP_SPEED * 0.9
    rival.s, rival.x, rival.v = 10.0, 0.0, rival.top_speed
    for other in round_.field_[1:]:
        other.s = 1500.0
    round_.player.s, round_.player.x, round_.player.v = 18.0, 0.0, TOP_SPEED
    for _ in range(30):
        round_._slipstream(1 / 30)
    assert rival.v <= rival.top_speed * 1.05 + 1e-6, \
        "the tow may never lift a kart above its own ceiling by more than 5%"
    assert rival.v < TOP_SPEED, "and never past the fastest kart on the grid"


# --- round 4: nothing the outside world can do breaks the race ---------------

def test_junk_input_cannot_break_the_physics():
    track = build_track(3)
    kart = Kart(v=TOP_SPEED)
    rng = random.Random(4)
    junk = [float("nan"), float("inf"), -float("inf"), 1e12, -1e12, -1.0, 0.5]
    for step in range(6000):
        kart.advance(track, rng.choice([1 / 60, 0.0, -1.0, 1e9, float("nan")]),
                     throttle=rng.choice(junk), brake=step % 11 == 0,
                     steer=rng.choice(junk))
        assert math.isfinite(kart.v) and math.isfinite(kart.x)
        assert math.isfinite(kart.s) and math.isfinite(kart.drift_time)
        assert 0.0 <= kart.v <= TOP_SPEED * BOOST_TOP + 1e-9
        assert abs(kart.x) <= WALL + 1e-9
        assert 0.0 <= kart.s < track.length
        assert kart.lap >= 0


def test_sane_refuses_every_shape_of_nonsense():
    assert sane(float("nan"), -1.0, 1.0) == 0.0
    assert sane(float("inf"), -1.0, 1.0, default=0.5) == 0.5
    assert sane(None, 0.0, 1.0) == 0.0
    assert sane(5.0, -1.0, 1.0) == 1.0 and sane(-5.0, -1.0, 1.0) == -1.0
    assert sane(0.25, 0.0, 1.0) == 0.25


def test_a_race_is_always_completable_and_nobody_dnfs():
    """Whatever the wheel does - garbage, nothing at all - three laps have to
    be finishable, by the player and by every rival."""
    def lets_go(now):
        # Grips the wheel for the lights, then folds their arms for the race.
        return Wheel(steer=0.0, hands=2 if now < 4.0 else 0)

    for seed, wheel_for in ((5, lambda now: Wheel(steer=float("nan"), hands=2)),
                            (9, lets_go)):
        round_ = RaceRound(RoundOptions(area=Rect(0, 0, 100, 100), seed=seed))
        now, dt = 0.0, 1 / 20
        while now < 900.0 and (not round_.finished or
                               any(k.finished_at is None for k in round_.field_)):
            now += dt
            round_.update(now, dt, wheel_for(now))
            round_.take_cues()
        assert round_.finished, f"seed {seed}: even a passenger finishes"
        assert all(k.finished_at is not None for k in round_.field_), \
            f"seed {seed}: no rival may be stranded"
        assert 1 <= round_.position() <= len(round_.everyone())


def test_an_enormous_frame_cannot_teleport_a_kart_through_the_circuit():
    track = build_track(3)
    kart = Kart(v=TOP_SPEED)
    kart.advance(track, 5.0, 1.0, False, 0.0)     # a five-second stall
    assert kart.s <= TOP_SPEED * MAX_STEP * BOOST_TOP + 1e-9
    assert kart.lap == 0, "a stalled frame is not a free lap"


def test_a_track_must_be_a_track():
    with pytest.raises(ValueError):
        Track(())
    with pytest.raises(ValueError):
        Track((Segment(0.0, 0.0),))
    track = Track((Segment(100.0, 0.0), Segment(50.0, 0.004)))
    assert track.curvature_at(0.0) == 0.0
    assert track.curvature_at(149.999) == 0.004
    assert track.curvature_at(150.0) == 0.0, "the line wraps to the start"
    assert track.curvature_at(-1.0) == 0.004, "and backwards, too"


def test_seed_zero_is_a_seed_like_any_other():
    zero = RaceRound(RoundOptions(area=Rect(0, 0, 100, 100), seed=0))
    seven = RaceRound(RoundOptions(area=Rect(0, 0, 100, 100), seed=7))
    assert zero.seed == 0 and seven.seed == 7
    assert zero.track.segments != seven.track.segments, \
        "--seed 0 must not quietly race circuit 7"
    again = RaceRound(RoundOptions(area=Rect(0, 0, 100, 100), seed=0))
    assert again.track.segments == zero.track.segments
    assert [k.pace for k in again.field_] == [k.pace for k in zero.field_], \
        "one seed decides the circuit and the grid together"


# --- round 4: every noise the race makes is a noise the game owns ------------

def test_the_race_only_raises_cues_the_sound_set_can_play():
    from handy.audio import NAMED_CUES

    allowed = set(NAMED_CUES["kart"])
    round_ = RaceRound(RoundOptions(area=Rect(0, 0, 100, 100), seed=7))
    driver = MediocreDriver(7)
    heard, now, dt = set(), 0.0, 1 / 30
    while now < 600.0 and not round_.finished:
        now += dt
        round_.update(now, dt, hairpin_policy_wheel(
            round_, 1.15, driver.steer(round_, now)))
        heard.update(round_.take_cues())
    assert heard, "a race is not silent"
    assert heard <= allowed, f"unknown cues: {sorted(heard - allowed)}"
    for expected in ("race_go", "countdown_beep", "lap_chime", "race_finish",
                     "crowd", "gravel", "engine_low", "engine_high"):
        assert expected in heard, f"a race with no {expected}"


# --- round 5: the second review's findings, pinned ---------------------------

def test_the_lateral_loop_leaves_time_to_react():
    """The blocking finding, as a number. A hairpin used to carry a kart from
    the crown of the road to the edge in 0.85 s at full opposite lock, so a
    fifth of a second of camera lag was a quarter of the road spent blind and
    every realistic driver finished last. Every corner in the vocabulary must
    now take at least two seconds to throw a kart away, flat out."""
    for k in CORNER_STRENGTHS:
        assert lateral_margin(k, 1.0) >= 2.0, \
            f"curvature {k} crosses the road in {lateral_margin(k, 1.0):.2f}s"
    assert lateral_margin(0.0) == float("inf"), "a straight never runs out"
    assert lateral_margin(max(CORNER_STRENGTHS), 0.6) == float("inf"), \
        "and a corner taken at its own speed is simply held"


def test_a_quarter_second_asleep_at_the_wheel_is_recoverable():
    """The same finding from the seat: arrive at the tightest bend flat out,
    do nothing at all for 250 ms - the whole of a webcam's lag - then lift and
    wind the lock on. The kart has to still be on the road, and get round.

    The reaction is a DRIVER's: full lock while the kart is still running
    wide, the pedal off while it is still too fast for the bend, and both of
    them handed back as soon as they have done their job. Holding full lock
    and a closed throttle for five seconds is not a late correction, it is a
    different mistake - it steers a recovered kart off the inside of the road
    and parks it there, which is what the kart obediently did while this test
    called it a pass."""
    k = max(CORNER_STRENGTHS)
    track = Track((Segment(1e6, k),))
    kart = Kart(v=TOP_SPEED)
    for _ in range(15):
        kart.advance(track, 1 / 60, 1.0, False, 0.0)     # 250 ms of nothing
    assert abs(kart.x) < ROAD_HALF_WIDTH, "the lag alone must not cost the road"
    worst = abs(kart.x)
    for _ in range(300):
        ratio = kart.v / TOP_SPEED
        # Wind on what the corner asks for, plus whatever it takes to get
        # back to the crown of the road; ease the pedal only while the bend
        # is still faster than the tyres can hold.
        lock = holding_lock(k, ratio) - kart.x * 1.5
        throttle = 0.25 if kart.v > cornering_speed(k) else 1.0
        kart.advance(track, 1 / 60, throttle, False,
                     max(-1.0, min(1.0, lock)))
        worst = max(worst, abs(kart.x))
    assert worst <= ROAD_HALF_WIDTH, \
        f"a late but correct reaction still ran to {worst:.2f} of road"
    assert kart.v > TOP_SPEED * 0.5, "and the corner was driven, not survived"


def test_the_drift_gates_are_reachable_on_a_webcam_wheel():
    """Both gates in degrees of forearm, which is the unit the player has.
    A gate at 46 of 50 degrees is a gate pinned against the stops through the
    smoothing; an exit gate at 18 degrees is a gate nobody hits on the way out
    of a corner, which is exactly where the boost is supposed to be banked."""
    def roll_for(target):
        low, high = 0.0, 1.0
        for _ in range(60):
            mid = (low + high) / 2
            low, high = (mid, high) if shape_steer(mid) < target else (low, mid)
        return low * FULL_LOCK_DEGREES

    engage, release = roll_for(DRIFT_STEER), roll_for(DRIFT_EXIT)
    assert engage <= FULL_LOCK_DEGREES * 0.85, \
        f"the drift needs {engage:.0f} of {FULL_LOCK_DEGREES:.0f} degrees"
    assert release >= FULL_LOCK_DEGREES * 0.4, \
        f"the boost needs the wheel back inside {release:.0f} degrees"
    assert engage - release >= 10.0, "and the two must not be the same place"


def test_the_gravel_edge_is_a_slope_not_a_cliff():
    """Crossing the white line by a millimetre used to cost 45% of the speed
    cap and 70% of the steering in one step - a one-way trap on any real
    corner. It has to ramp, and full lock has to beat the push all the way."""
    steps = [gravel_cap(ROAD_HALF_WIDTH + i / 200) for i in range(0, 120)]
    assert steps[0] == pytest.approx(1.0), "the road itself is not the gravel"
    for before, after in zip(steps, steps[1:]):
        assert after <= before, "the cap only ever falls"
        assert before - after < 0.06, f"a {before - after:.2f} step is a cliff"
    assert gravel_cap(ROAD_HALF_WIDTH + GRAVEL_SHOULDER) < 0.6, \
        "and past the shoulder it is the gravel proper"
    assert gravel_steer(ROAD_HALF_WIDTH * 0.99) == 1.0
    assert gravel_steer(WALL) >= 0.5, "the sand must never steer for you"


def test_the_sand_trap_always_lets_go():
    """The old cliff was a one-way door: from 1.02 units out on a hairpin, at
    full opposite lock, a kart NEVER came back - pinned at 1.09 and 30.9 u/s
    while the corner out-pushed the 30% of steering the sand had left it. Only
    the brake escaped it, and the AI never brakes for it, so the trap punished
    the human exclusively.

    Two things have to be true now. Full lock alone must at least stop the
    slide - the kart climbs back out of the sand and onto the shoulder rather
    than being dragged to the barrier - and the driver's own tool, a lift,
    must finish the job on any corner, from anywhere, in a couple of seconds.
    """
    shoulder = ROAD_HALF_WIDTH + GRAVEL_SHOULDER
    for k in CORNER_STRENGTHS:
        for start in (1.02, 1.1, 1.3, WALL):
            track = Track((Segment(1e6, -k),))       # pushing the kart wide
            kart = Kart(v=TOP_SPEED * gravel_cap(start), x=start)
            worst = start
            for _ in range(9 * 60):
                kart.advance(track, 1 / 60, 1.0, False, -1.0)
                worst = max(worst, kart.x)
            assert worst <= max(shoulder, start) + 1e-9, \
                f"k={k} from {start}: dragged out to x={worst:.2f}"

            lifting = Kart(v=TOP_SPEED * gravel_cap(start), x=start)
            now = 0.0
            while now < 4.0 and abs(lifting.x) > ROAD_HALF_WIDTH:
                lifting.advance(track, 1 / 60, 0.3, False, -1.0)
                now += 1 / 60
            assert abs(lifting.x) <= ROAD_HALF_WIDTH, \
                f"k={k} from {start}: a lift left it at x={lifting.x:.2f}"
            assert lifting.v > 8.0, "and the kart is still racing, not beached"


def test_the_wall_bump_is_not_a_drum_roll():
    """A kart chattering across the wall boundary fired 37 bump cues in one
    race. Contact with the barrier and contact with a kart are the same noise
    and share the same clock."""
    round_ = RaceRound(OPTIONS)
    round_.countdown_from = -10.0
    round_.update(0.0, 1 / 60, Wheel(hands=2))
    now, bumps = 0.0, 0
    for step in range(240):                    # four seconds of scraping
        now += 1 / 60
        round_.player.v = TOP_SPEED * 0.6
        round_.player.x = WALL if step % 2 else WALL - 0.02
        round_.update(now, 1 / 60, Wheel(steer=1.0, hands=2))
        bumps += round_.take_cues().count("bump")
    assert bumps <= 1 + 4.0 / BUMP_COOLDOWN, \
        f"{bumps} bumps in four seconds of one long scrape"


def test_a_race_ends_even_for_a_driver_who_never_drives():
    """A player holding both hands open holds the brake. The race used to run
    forever: v stayed 0, `finished` stayed False, the podium never came and
    the only way out of the game was the keyboard."""
    round_ = RaceRound(RoundOptions(area=Rect(0, 0, 100, 100), seed=5))
    now, dt = 0.0, 1 / 20
    while now < 900.0 and not round_.finished:
        now += dt
        round_.update(now, dt, Wheel(steer=0.0, brake=True, throttle=0.0,
                                     hands=2))
        round_.take_cues()
    assert round_.player.v == 0.0, "the driver really never moved"
    assert round_.finished, "and the race still ended"
    assert round_.flagged_off, "classified where they stood"
    assert round_.position() == len(round_.everyone()), "which is last"
    assert all(k.finished_at is not None for k in round_.field_)
    assert round_.player.finished_at <= max(
        k.finished_at for k in round_.field_) + LAST_CAR_GRACE + 1.0, \
        "the flag falls a grace after the last rival, not whenever"


def test_the_podium_appears_for_a_driver_who_never_drives(monkeypatch):
    """... and the loop shows it, rather than sitting on a live race nobody
    is driving."""
    round_ = RaceRound(RoundOptions(area=Rect(0, 0, 100, 100), seed=5))
    now, dt = 0.0, 1 / 20
    while now < 900.0 and not round_.finished:
        now += dt
        round_.update(now, dt, Wheel(steer=0.0, brake=True, throttle=0.0,
                                     hands=2))
        round_.take_cues()
    assert round_.finished and round_.flagged_off
    import numpy as np

    from handy.maps import kart as art
    canvas = np.zeros((540, 960, 3), np.uint8)
    art.draw_results(canvas, round_)
    assert canvas.any(), "the classification is drawn like any other"


def test_every_circuit_a_seed_can_draw_is_a_real_circuit():
    """The oval of last resort fired on 0.8% of seeds and was never checked
    against a single invariant: 1925-unit laps, 40% under the floor, with zero
    corners worth lifting for. Every seed, every invariant, no exceptions."""
    for seed in range(0, 600):
        track = build_track(seed)
        length = track.length
        assert LAP_SPAN[0] <= length <= LAP_SPAN[1], \
            f"seed {seed}: a {length:.0f}-unit lap"
        assert len(teeth_of(track.segments)) >= TEETH_COUNT, \
            f"seed {seed}: nothing here demands a lift"
        straights = [s.length for s in track.segments if not s.curvature]
        assert max(straights) <= MAX_STRAIGHT + 1e-6, f"seed {seed}: an airfield"
        x, y, turned = track.closure()
        assert abs(abs(turned) - math.tau) < 1e-9, f"seed {seed}: not a loop"
        assert math.hypot(x, y) < length * 0.01, f"seed {seed}: a spiral"


def test_the_ring_of_last_resort_is_a_real_circuit():
    """The fallback itself, on its own terms: it closes exactly, it is long
    enough to race, and it has teeth."""
    from handy.karting import _ring

    for seed in range(40):
        ring = _ring(random.Random(seed))
        track = Track(ring, name="ring")
        assert LAP_SPAN[0] <= track.length <= LAP_SPAN[1]
        assert len(teeth_of(ring)) >= TEETH_COUNT
        assert max(s.length for s in ring if not s.curvature) <= MAX_STRAIGHT
        x, y, turned = track.closure()
        assert abs(abs(turned) - math.tau) < 1e-9
        assert math.hypot(x, y) < 1e-6, "a regular ring closes exactly"


def test_the_corner_vocabulary_has_no_kinks_in_it():
    """A corner has teeth only if it lasts longer than the road takes to run
    out. Nothing shorter than the span floor may be drawn at all."""
    for seed in range(0, 200):
        track = build_track(seed)
        for segment in track.segments:
            if segment.curvature:
                assert segment.length >= CORNER_SPAN[0] * 0.5, \
                    f"seed {seed}: a {segment.length:.0f}-unit corner"
        hairpins = [s for s in track.segments
                    if abs(s.curvature) >= max(CORNER_STRENGTHS) * 0.95]
        assert any(s.length >= TEETH_LENGTH for s in hairpins), \
            f"seed {seed}: no hairpin worth the name"


def test_the_throttle_is_an_axis_not_a_switch():
    """Hands are a pedal: a fist is flat out, flat palms are the brake, and
    half-open fingers are the lift that makes a corner drivable. Without it
    the only speed control on the wheel is on/off, which is a large part of
    why a fifth of a second of lag used to be fatal."""
    assert hand_throttle(grip(0.5, 0.5)) == pytest.approx(1.0)
    assert hand_throttle(grip(0.5, 0.5, open_hand=True)) == pytest.approx(0.0)
    assert hand_throttle(grip(0.5, 0.5, gesture="Closed_Fist")) == 1.0
    assert hand_throttle(grip(0.5, 0.5, gesture="Open_Palm")) == 0.0
    half = grip(0.5, 0.5)
    reach = (GRIP_REACH + OPEN_REACH) / 2 * 0.10          # palm span is 0.10
    points = list(half.landmarks)
    for tip in (8, 12, 16, 20):
        points[tip] = (0.5, 0.5 - reach)
    lifted = hand_throttle(Hand(landmarks=tuple(points), handedness="Right",
                                gesture=None, score=0.9))
    assert 0.3 < lifted < 0.7, f"a half-open hand is a half lift, not {lifted}"


def test_the_wheel_reports_the_lift_and_the_kart_obeys_it():
    controller = WheelController(min_cutoff=1e4, beta=0.0)
    for step in range(20):
        gripped = wheel_at(controller, (0.3, 0.5), (0.7, 0.5), step / 30)
    assert gripped.throttle == pytest.approx(1.0, abs=0.02)
    for step in range(20):
        open_ = wheel_at(controller, (0.3, 0.5), (0.7, 0.5), 1.0 + step / 30,
                         open_hands=True)
    assert open_.brake and open_.throttle == 0.0

    track = Track((Segment(1e6, 0.0),))
    flat, lifting = Kart(v=TOP_SPEED * 0.8), Kart(v=TOP_SPEED * 0.8)
    for _ in range(120):
        flat.advance(track, 1 / 60, 1.0, False, 0.0)
        lifting.advance(track, 1 / 60, 0.35, False, 0.0)
    assert lifting.v < flat.v - 3.0, "a lift is a real shedding of speed"
    assert lifting.v > TOP_SPEED * 0.4, "and a lift is not the brake"


def test_the_grid_spread_is_wide_enough_to_be_a_ladder():
    """The numbers behind the ladder: rivals must differ by tens of seconds
    over a race, because a driver's own skill is worth tens of seconds."""
    assert RIVAL_PACE[1] - RIVAL_PACE[0] >= 0.15, "a peloton is not a grid"
    round_ = RaceRound(RoundOptions(area=Rect(0, 0, 100, 100), seed=7))
    now, dt = 0.0, 1 / 30
    while now < 900.0 and any(k.finished_at is None for k in round_.field_):
        now += dt
        round_.update(now, dt, Wheel(steer=scripted_driver(round_), hands=2))
        round_.take_cues()
    finishes = sorted(k.finished_at for k in round_.field_)
    assert finishes[-1] - finishes[0] > 30.0, \
        f"the whole field finished inside {finishes[-1] - finishes[0]:.0f}s"


def test_there_is_no_latency_cliff_left_to_fall_off():
    """The lag sweep, kept. The same driver, the same circuits, nothing
    changed but how old the picture is when it reaches them: a control law
    that won at 80 ms and finished last from 200 ms up was not a difficulty
    curve, it was a cliff with every real webcam on the wrong side of it."""
    pace = {}
    for lag in (0.0, 0.12, 0.25, 0.35):
        times, places = [], []
        for seed in SEEDS:
            _, report = drive_a_race(seed, dict(Driver.LAGGY, lag=lag))
            assert report["time"] is not None, f"{lag}s of lag did not finish"
            times.append(report["time"])
            places.append(report["place"])
        pace[lag] = sum(times) / len(times)
        assert max(places) < len(SEEDS) + 1, f"lag {lag}: places {places}"
    quickest = min(pace.values())
    assert pace[0.35] < quickest * 1.10, \
        f"a third of a second of lag cost {100 * (pace[0.35] / quickest - 1):.0f}%"
    assert pace[0.25] < quickest * 1.06, f"and 250 ms cost too much: {pace}"


def test_one_hand_blinking_does_not_snatch_the_throttle():
    """The pedal is both hands averaged and eased: a single frame in which the
    recogniser loses its grip on one hand must cost a little throttle, not the
    whole of it."""
    controller = WheelController(min_cutoff=1e4, beta=0.0)
    for step in range(20):
        wheel_at(controller, (0.3, 0.5), (0.7, 0.5), step / 30)
    blink = controller.update([grip(0.3, 0.5, open_hand=True), grip(0.7, 0.5)],
                              20 / 30)          # the very next frame
    assert not blink.brake, "one open hand is not the brake"
    assert blink.throttle > 0.7, f"one blink cut the throttle to {blink.throttle}"


# --- round 6: the pedals, the teeth, the reachable grid ----------------------

def flat_out_lap(track, start, span, laps_of_it=1):
    """Drive a stretch of road with everything a driver has EXCEPT the pedal.

    Full commitment, the lock the bend asks for plus whatever it takes to get
    back to the crown of the road, and the throttle nailed to the floor from
    the moment the kart arrives. Returns how far into the stretch the kart put
    a wheel on the dirt, or None if it kept the road all the way.
    """
    kart = Kart(s=start, x=0.0, v=pinned_speed())
    while (kart.s - start) % track.length < span:
        ratio = kart.v / TOP_SPEED
        lock = holding_lock(track.curvature_at(kart.s), ratio) - kart.x * 2.2
        kart.advance(track, 1 / 60, 1.0, False, max(-1.0, min(1.0, lock)))
        if abs(kart.x) > ROAD_HALF_WIDTH:
            return (kart.s - start) % track.length
    return None


def test_the_physics_will_not_do_the_players_lifting_for_them():
    """The blocking finding of round 3, as the number that made it.

    Pinned to the throttle with the wheel against the stops, a kart used to
    settle at 51.5 units/s - 83% of top speed, in EVERY curvature in the
    vocabulary, including the hairpin whose limit is 45.7. The physics lifted
    for the player, more cheaply and later than they could lift for
    themselves, which is exactly why never lifting beat driving properly.
    Sawing at the wheel now costs what it should cost, and the flat-out
    equilibrium sits UNDER the tightest corner in the vocabulary.
    """
    track = Track((Segment(1e6, 0.0),))
    kart = Kart(v=TOP_SPEED)
    for _ in range(40 * 60):                      # forty seconds against the stops
        kart.advance(track, 1 / 60, 1.0, False, 1.0)
        kart.x = 0.0                              # a rolling road, not a corner
    hairpin = cornering_speed(max(CORNER_STRENGTHS))
    assert kart.v < hairpin, \
        f"pinned and wound over, a kart holds {kart.v:.1f} against a {hairpin:.1f} corner"
    assert kart.v < pinned_speed(), "and it is slower than simply driving straight"


def test_holding_the_lock_a_corner_asks_for_is_free():
    """The other half of it, and the half that keeps the corners real.

    The scrub is for asking the front tyres for MORE than the bend needs -
    sawing, or winding on lock the tyres cannot convert. A driver holding
    exactly the lock that cancels the corner is doing the one thing there is
    to do, and billing them for it is the physics driving the kart. So a
    hairpin taken flat is not quietly scrubbed back to a speed it can hold:
    it runs the kart out of road, which is a price the driver can SEE.
    """
    k = max(CORNER_STRENGTHS)
    holding = Kart(v=pinned_speed())
    sawing = Kart(v=pinned_speed())
    track = Track((Segment(1e6, 0.0),))
    for _ in range(90):
        ratio = holding.v / TOP_SPEED
        holding.advance(track, 1 / 60, 1.0, False, holding_lock(0.0, ratio))
        sawing.advance(track, 1 / 60, 1.0, False, 1.0)
        holding.x = sawing.x = 0.0
    assert holding.v > sawing.v + 4.0, "sawing at the wheel is what costs speed"
    assert holding.v == pytest.approx(pinned_speed(), abs=0.6), \
        "and driving the road in front of you costs nothing"

    # In the bend itself, where the lock the corner asks for IS full lock,
    # nothing is scrubbed away and the corner has to keep its own teeth.
    bend = Track((Segment(1e6, k),))
    flat = Kart(v=pinned_speed())
    for _ in range(60):
        ratio = flat.v / TOP_SPEED
        flat.advance(bend, 1 / 60, 1.0, False,
                     max(-1.0, min(1.0, holding_lock(k, ratio) - flat.x * 2.2)))
    assert flat.v > cornering_speed(k), \
        "a flat-out kart in a hairpin is over the limit, not politely under it"


def test_a_certified_tooth_runs_a_flat_out_kart_out_of_road():
    """What `teeth_of` promises, driven rather than asserted.

    The old certificate compared `cornering_speed` - a speed no kart on the
    circuit ever reached - with a fraction of TOP_SPEED, and stamped bends a
    flat-out kart sailed through without seeing the kerb. Every tooth on every
    circuit must now put a driver who never lifted onto the dirt BEFORE the
    corner runs out, or the invariant the generator enforces is not the
    invariant the player experiences.
    """
    for seed in range(1, 12):
        track = build_track(seed)
        teeth = teeth_of(track.segments)
        assert len(teeth) >= TEETH_COUNT, f"seed {seed}: a circuit with no teeth"
        starts, acc = [], 0.0
        for segment in track.segments:
            starts.append(acc)
            acc += segment.length
        for start, segment in zip(starts, track.segments):
            if segment not in teeth:
                continue
            lost = flat_out_lap(track, start, segment.length)
            assert lost is not None, \
                f"seed {seed}: a certified tooth let a flat-out kart through"
            assert lost <= segment.length * TOOTH_BITE, \
                f"seed {seed}: the road ran out {lost:.0f} into a " \
                f"{segment.length:.0f}-unit corner - too late to be a corner"
            assert lost == pytest.approx(flat_out_reach(segment.curvature),
                                         abs=1.0), \
                "the certificate has to be measured in the units the kart drives"


def test_pinned_speed_is_the_speed_a_kart_actually_reaches():
    """TOP_SPEED is the ceiling; this is the number the corners are argued
    against, because it is the speed a corner is ARRIVED at."""
    assert 0.85 * TOP_SPEED < pinned_speed() < TOP_SPEED, \
        "drag settles the balance a little under the ceiling"
    track = Track((Segment(1e6, 0.0),))
    kart = Kart(v=TOP_SPEED * 0.4)
    for _ in range(30 * 60):
        kart.advance(track, 1 / 60, 1.0, False, 0.0)
    assert kart.v == pytest.approx(pinned_speed(), abs=0.05), \
        "and it is measured from the physics, not guessed alongside it"


def test_the_lift_is_a_pedal_and_not_a_decoration():
    """Off the throttle, a kart slows. Without this the whole trailing-throttle
    axis bought a driver three units/s^2 of drag while the front tyres scrubbed
    nineteen - so the fastest way round was to pin the pedal and let the
    understeer do the driving."""
    track = Track((Segment(1e6, 0.0),))
    lifted, held, braked = (Kart(v=pinned_speed()) for _ in range(3))
    for _ in range(60):
        lifted.advance(track, 1 / 60, 0.0, False, 0.0)
        held.advance(track, 1 / 60, 1.0, False, 0.0)
        braked.advance(track, 1 / 60, 0.0, True, 0.0)
    assert held.v == pytest.approx(pinned_speed(), abs=0.2), "pinned is pinned"
    assert pinned_speed() - lifted.v > 12.0, \
        f"a whole second off the throttle shed {pinned_speed() - lifted.v:.1f} units/s"
    assert lifted.v > braked.v + 5.0, "but a lift is not the brake"
    assert lifted.v > TOP_SPEED * 0.5, "and it is a trim, not an anchor"


def test_never_lifting_is_never_the_way_round():
    """The round-2 measurement, inverted. The same driver twice - same lag,
    same hands, same steering law - one of whom uses the pedal. The one who
    does has to be quicker on EVERY seed, or the throttle is a trap."""
    for seed in range(1, 9):
        _, flat = drive_a_race(seed, Driver.CHARGER)
        _, pedal = drive_a_race(seed, Driver.LIFTER)
        assert flat["time"] and pedal["time"]
        assert pedal["time"] < flat["time"], \
            f"seed {seed}: never lifting was {flat['time'] - pedal['time']:+.1f}s"
        assert flat["gravel"] > pedal["gravel"] + 1.0, \
            f"seed {seed}: and arriving flat has to cost road position"


def test_the_top_of_the_grid_is_reachable_on_every_seed():
    """P1 used to be dealt in `__post_init__`: any rival drawn above 0.955 of
    the player's own top speed was simply out of reach, so a perfect drive
    finished fourth behind three slower karts. The player keeps a little in
    hand now and the ceiling is under one, so the front row is a drive."""
    fastest = TOP_SPEED * RIVAL_PACE[1] * rubber_band(1e9)
    assert fastest < TOP_SPEED * PLAYER_EDGE, \
        "no rival, hurried by the band, may out-run the player's own kart"
    for seed in range(1, 13):
        _, race = drive_a_race(seed, Driver.ACE)
        assert race["place"] == 1, f"seed {seed}: a perfect drive finished P{race['place']}"


def test_the_grid_is_still_a_ladder_and_not_a_procession():
    """Reachable is not the same as free: the better driver has to be ahead of
    the worse one, and the worse one has to be able to lose places."""
    places = []
    for seed in range(1, 13):
        _, ace = drive_a_race(seed, Driver.ACE)
        _, sloppy = drive_a_race(seed, Driver.SLOPPY)
        assert ace["time"] < sloppy["time"], f"seed {seed}: skill is worth seconds"
        places.append(sloppy["place"])
    assert max(places) >= 3, "a sloppy drive has to be able to cost places"
    assert sum(places) / len(places) > 1.2, \
        "and the field cannot be scenery the player drives past"


def test_the_brake_squeal_has_a_clock_like_every_other_cue():
    """The brake is a pair of open palms and the recogniser changes its mind
    about them; on the rising edge alone this fired six times a second."""
    round_ = RaceRound(OPTIONS)
    now, dt = 0.0, 1 / 60
    while now < 8.0:
        now += dt
        round_.update(now, dt, Wheel(hands=2))
    round_.take_cues()
    heard = []
    for i in range(600):                          # ten seconds of brake chatter
        now += dt
        round_.update(now, dt, Wheel(hands=2, brake=(i // 3) % 2 == 0))
        round_.player.v = max(round_.player.v, TOP_SPEED * 0.8)
        if "brake_squeal" in round_.take_cues():
            heard.append(now)
    assert heard, "hard braking from speed still squeals"
    gaps = [b - a for a, b in zip(heard, heard[1:])]
    assert min(gaps) >= SQUEAL_COOLDOWN - 1e-6, \
        f"two squeals {min(gaps):.3f}s apart is a rattle, not a car"
    assert len(heard) <= 10.0 / SQUEAL_COOLDOWN + 1


def test_the_gravel_is_a_bed_not_a_stutter():
    """The gravel sample runs about nine tenths of a second and is built to
    overlap itself. At one trigger every 0.35s it was three copies deep."""
    round_ = RaceRound(OPTIONS)
    now, dt = 0.0, 1 / 60
    while now < 8.0:
        now += dt
        round_.update(now, dt, Wheel(hands=2))
    round_.take_cues()
    heard = []
    for _ in range(600):
        now += dt
        round_.player.x = ROAD_HALF_WIDTH * 1.4
        round_.update(now, dt, Wheel(hands=2))
        if "gravel" in round_.take_cues():
            heard.append(now)
    assert heard, "the dirt is still heard"
    gaps = [b - a for a, b in zip(heard, heard[1:])]
    assert min(gaps) >= GRAVEL_BED - 1e-6, "one bed, not a shower of one-shots"
    assert len(heard) <= 10.0 / GRAVEL_BED + 1


def test_a_slide_worth_a_boost_is_paid_for_it():
    """Nearly half of every slide a driver banked used to pay nothing at all -
    twelve skids a race and seven boosts - because the exhaust was still
    cooling down from the last one. A mechanic that pays at random is a
    mechanic that teaches nothing."""
    round_ = RaceRound(RoundOptions(area=Rect(0, 0, 100, 100), seed=3))
    driver = Driver(seed=3, **Driver.ACE)
    now, dt = 0.0, 1 / 30
    earned = lost_to_cooldown = 0
    while now < 400.0 and not round_.finished:
        now += dt
        kart = round_.player
        was, held, cooling = kart.drifting, kart.drift_time, kart.boost_cooldown
        round_.update(now, dt, driver.wheel(round_, now))
        round_.take_cues()
        if was and not kart.drifting and held >= DRIFT_HOLD:
            if cooling > 0.0:
                lost_to_cooldown += 1
            else:
                earned += 1
    assert earned >= 4, "a race full of slides has to pay for some of them"
    assert lost_to_cooldown <= earned * 0.2, \
        f"{lost_to_cooldown} of {earned + lost_to_cooldown} earned slides paid nothing"


def test_the_field_shows_the_player_how_to_drift():
    """The whole skill ceiling of this game rests on one mechanic, and the
    only place a player can see what it looks like is a rival going past
    sideways. So the rivals attack the hairpins the way the player is meant
    to: lift with the lock on, hold the slide, unwind, take the boost."""
    round_ = RaceRound(RoundOptions(area=Rect(0, 0, 100, 100), seed=5))
    now, dt = 0.0, 1 / 60
    sideways = {id(kart): 0 for kart in round_.field_}
    frames = 0
    while now < 200.0 and not round_.finished:
        now += dt
        round_.update(now, dt, Wheel(steer=scripted_driver(round_), hands=2))
        round_.take_cues()
        frames += 1
        for kart in round_.field_:
            sideways[id(kart)] += kart.drifting
    slid = [count for count in sideways.values() if count > frames * 0.02]
    assert len(slid) >= 3, \
        "a field that never slides teaches the player the mechanic does not exist"


def test_a_race_is_an_arcade_race_not_a_forearm_workout():
    """Every second of it is spent with both arms up holding an invisible
    wheel. Three minutes of that is a plank, not an arcade session."""
    lengths = [build_track(seed).length for seed in range(1, 40)]
    assert max(lengths) <= LAP_SPAN[1], "the generator honours its own span"
    assert sum(lengths) / len(lengths) < 3200.0, "a lap is a lap, not an errand"
    times = []
    for seed in range(1, 9):
        _, race = drive_a_race(seed, Driver.TYPICAL)
        times.append(race["time"])
    assert max(times) < 200.0, f"a {max(times):.0f}s race is a workout"
    assert sum(times) / len(times) < 180.0, "and the average one has to be shorter"


# --- the drift must be a decision, never a free lunch ------------------------

def test_sliding_never_out_grips_gripping_by_much():
    """Lateral authority sideways must be near parity with gripping.

    It used to be DRIFT_SLIDE * DRIFT_GRIP = 1.45 * 0.55 against a gripping
    kart's 0.50 - a 160% advantage - AND the slide was exempt from the
    steering scrub. Being sideways was therefore strictly better than driving
    properly, so the fastest line was to never stop sliding, and any input
    noisy enough to trip the gate got rewarded for being noisy. A drift is
    paid for by the boost at the end of it, not by better cornering.
    """
    from handy.karting import DRIFT_SLIDE, corner_grip

    for ratio in (0.7, 0.8, 0.9, 1.0):
        gripping = corner_grip(ratio)
        sliding = DRIFT_SLIDE * corner_grip(ratio, drifting=True)
        assert sliding >= gripping, "a slide must not be worse than understeer"
        assert sliding <= gripping * 1.25, (
            f"at {ratio:.1f} speed the slide is worth {sliding / gripping:.0%} "
            "of gripping - that is a free lunch, not a decision")


def test_holding_a_slide_everywhere_is_not_a_dominant_strategy():
    """Race the same brain two ways: sliding through every bend, and never
    sliding at all. Sliding may win - it banks boosts - but it must not run
    away with the race, or the game rewards flailing over driving."""
    import math

    from handy.karting import DRIFT_LIFT, DRIFT_STEER, holding_lock

    def race(seed, slide):
        round_ = RaceRound(RoundOptions(area=Rect(0, 0, 960, 540), seed=seed))
        now = 0.0
        while not round_.finished and now < 600:
            now += 1 / 60
            player = round_.player
            ahead = round_.track.curvature_ahead(player.s, 60.0)
            want = holding_lock(ahead, player.v / TOP_SPEED) if ahead else 0.0
            steer = max(-1.0, min(1.0, want * 1.05 - player.x * 0.9))
            throttle = 1.0 - 0.42 * min(1.0, abs(ahead) / 0.007)
            if slide and abs(ahead) > 0.003:
                steer = math.copysign(max(abs(steer), DRIFT_STEER + 0.08),
                                      steer or 1.0)
                throttle = min(throttle, DRIFT_LIFT - 0.06)
            elif not slide:
                throttle = max(throttle, DRIFT_LIFT + 0.10)
            round_.update(now, 1 / 60, Wheel(steer=steer, throttle=throttle,
                                             hands=2))
        assert round_.finished, f"seed {seed} never finished"
        return now

    seeds = (1, 2, 3, 4)
    gripped = sum(race(seed, False) for seed in seeds) / len(seeds)
    slid = sum(race(seed, True) for seed in seeds) / len(seeds)
    assert slid < gripped * 1.06, (
        f"sliding everywhere wins by {gripped - slid:.1f} s "
        f"({100 * (gripped - slid) / gripped:.1f}%) - too dominant")
