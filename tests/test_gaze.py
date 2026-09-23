"""The eye scheme, end to end through the real calibration and aiming."""

import math

import numpy as np
import pytest

from eyes import frame_of, make_face
from handy.aiming import AimController
from handy.calibration import MAX_FIT_ERROR, CalibrationSession
from handy.faces import FaceFrame
from handy.schemes import GAZE

WINDOW = np.array([1280, 720])


def looker(iris_sign: float = 1.0, head: float = 0.55, eyes: float = 0.42,
           deadzone: float = 0.18):
    """A person looking at the screen.

    The head only turns for the targets far from centre; the eyes track
    everything. That is what makes the mix worth measuring: no single weighting
    of head against eyes is exactly right, so calibration has to find the one
    that describes this person best.
    """

    def look(screen):
        across, down = screen[0] - 0.5, screen[1] - 0.5
        yaw = head * math.copysign(max(abs(across) - deadzone, 0.0), across)
        pitch = head * math.copysign(max(abs(down) - deadzone, 0.0), down)
        return make_face(iris=(iris_sign * eyes * across, iris_sign * eyes * down),
                         yaw=yaw, pitch=pitch, blink=(0.05, 0.05))

    return look


def walk_setup(look, cameras=1, dwell=0.4, wink=(0.9, 0.06)):
    """Drive the real session with the eye scheme, as the game does."""
    session = CalibrationSession(GAZE, cameras=cameras, grid=3, dwell=dwell,
                                 settle=0.2)
    clock = 0.0
    while not session.is_done:
        step = session.step
        for _ in range(2000):
            clock += 1 / 30
            if step.records == "trigger":
                blink = (0.05, 0.05) if step.key == "cocked" else wink
                frames = [frame_of(make_face(blink=blink))] * cameras
            else:
                frames = [frame_of(look(step.target))] * cameras
            session.update(frames, clock)
            if session.step is not step or session.is_done:
                break
    return session.result()


PROBES = [(0.2, 0.2), (0.5, 0.5), (0.8, 0.3), (0.35, 0.8), (0.65, 0.65)]


def aim_error(calibration, look) -> float:
    """Worst miss across the screen, in pixels."""
    control = AimController(GAZE, min_cutoff=1e4, beta=0.0)
    worst = 0.0
    for index, target in enumerate(PROBES):
        for step in range(6):
            aim = control.update([(frame_of(look(target)), calibration)],
                                 index * 1.0 + step * 0.03)
        worst = max(worst, float(np.hypot(*((np.array(aim.position) - target) * WINDOW))))
    return worst


# --- setup -----------------------------------------------------------------

def test_the_eye_scheme_skips_the_reach_steps():
    """Your eyes do not move towards the screen, so there is nothing to measure."""
    session = CalibrationSession(GAZE, grid=3)
    assert [step.records for step in session.steps].count("reach") == 0
    assert len(session.steps) == 9 + 2


def test_looking_around_the_grid_produces_a_working_map():
    rig = walk_setup(looker())
    calibration = rig[0]

    assert calibration.fit_error < MAX_FIT_ERROR
    assert calibration.usable
    assert aim_error(calibration, looker()) < 140


def test_calibration_finds_how_much_of_a_look_is_eyes():
    """It is not guessed at: several weightings are tried and the best kept."""
    rig = walk_setup(looker(eyes=0.42))
    assert rig[0].tuning[0] > 0.0, "the eyes and the head pull the same way here"


def test_it_recovers_the_sign_when_the_eyes_read_the_other_way():
    """Whether an iris offset adds to or fights the head turn is a convention.

    Guessing it wrong would make the two cancel; measuring it cannot.
    """
    rig = walk_setup(looker(iris_sign=-1.0))
    assert rig[0].tuning[0] < 0.0
    assert rig[0].fit_error < MAX_FIT_ERROR


def test_the_chosen_weighting_beats_ignoring_the_eyes_entirely():
    from handy import homography
    from handy.calibration import Calibration

    look = looker()
    fitted = walk_setup(look)[0]
    head_only = Calibration(mapping=fitted.mapping, signal=fitted.signal,
                            cocked=fitted.cocked, folded=fitted.folded,
                            tuning=(0.0, 0.0))

    assert aim_error(fitted, look) < aim_error(head_only, look)
    assert homography.gain(fitted.mapping, look((0.5, 0.5)).gaze(fitted.tuning)) > 0


def test_a_weighting_where_the_eyes_fight_the_head_is_turned_down():
    """Both fit the traced grid; only one of them can be aimed with.

    A symmetric sweep of nine markers cannot tell the two apart by fit alone -
    so the one that magnifies movement least wins, and that is the one where the
    head and the eyes pull together.
    """
    from handy import homography

    look = looker()
    chosen = walk_setup(look)[0]
    centre = look((0.5, 0.5))

    def magnification(tuning):
        matrix = homography.fit(
            [look(target).gaze(tuning) for target in
             [(x, y) for y in (0.08, 0.5, 0.92) for x in (0.08, 0.5, 0.92)]],
            [(x, y) for y in (0.08, 0.5, 0.92) for x in (0.08, 0.5, 0.92)])
        return homography.gain(matrix, centre.gaze(tuning))

    flipped = tuple(-weight for weight in chosen.tuning)
    assert magnification(chosen.tuning) < magnification(flipped)


# --- the trigger -----------------------------------------------------------

def test_a_wink_fires_and_a_blink_does_not():
    rig = walk_setup(looker())
    calibration = rig[0]
    control = AimController(GAZE, min_cutoff=1e4, beta=0.0)
    look = looker()

    def hold(blink, frames=4, start=0.0):
        shots = 0
        for step in range(frames):
            face = look((0.5, 0.5))
            watching = make_face(iris=face.iris_offset(), yaw=face.yaw,
                                 pitch=face.pitch, blink=blink)
            shots += control.update([(frame_of(watching), calibration)],
                                    start + step * 0.05).fired
        return shots

    assert hold((0.05, 0.05), start=0.0) == 0, "eyes open"
    assert hold((0.92, 0.06), start=1.0) == 1, "a wink fires once"
    assert hold((0.92, 0.06), start=2.0) == 0, "and holding it does not repeat"
    assert hold((0.05, 0.05), start=3.0) == 0, "back to open, re-armed"
    assert hold((0.90, 0.88), start=4.0) == 0, "a natural blink shuts both eyes"


def test_losing_the_face_stops_everything():
    rig = walk_setup(looker())
    control = AimController(GAZE)
    assert not control.update([(FaceFrame(), rig[0])], 0.0).tracking


def test_two_cameras_watching_the_same_face_are_fused():
    rig = walk_setup(looker(), cameras=2)
    control = AimController(GAZE, min_cutoff=1e4, beta=0.0)
    face = frame_of(looker()((0.4, 0.6)))

    aim = control.update([(face, rig[0]), (face, rig[1])], 0.0)
    assert aim.cameras == 2 and aim.tracking


# --- honesty about a fit that cannot aim ------------------------------------

def test_a_hopeless_eye_signal_is_rejected_not_played_on():
    """Noise fits nine points beautifully and predicts a tenth terribly.

    The gate is the held-out error: a trace that cannot predict itself must
    fall back to the defaults and say so, never ship a map that aims at nothing.
    """
    rng = np.random.default_rng(1)

    def static_face(_target):
        # A face that never actually tracks the markers: pure noise.
        return make_face(iris=tuple(rng.normal(0, 0.05, 2)),
                         yaw=rng.normal(0, 0.03), pitch=rng.normal(0, 0.03),
                         blink=(0.05, 0.05))

    from handy.calibration import default_calibration

    rig = walk_setup(static_face)
    assert rig[0].mapping == default_calibration(GAZE).mapping
    assert rig[0].generalisation == 0.0, "nothing measured is nothing claimed"


def test_a_working_trace_reports_its_held_out_accuracy():
    rig = walk_setup(looker())
    assert 0.0 <= rig[0].generalisation < 0.08
    assert rig[0].fit_error <= rig[0].generalisation + 1e-9, \
        "training error flatters; the held-out figure is the honest one"


def test_the_gaze_map_is_affine_not_projective():
    """Six parameters, not eight: the projective pair only ever fits noise."""
    rig = walk_setup(looker())
    assert rig[0].mapping[6] == 0.0 and rig[0].mapping[7] == 0.0


def test_the_gaze_scheme_smooths_harder_than_the_pistol():
    from handy.schemes import PISTOL

    assert GAZE.smoothing[0] < PISTOL.smoothing[0]
    assert GAZE.smoothing[1] < PISTOL.smoothing[1]


def test_setup_no_longer_tells_the_player_to_freeze_their_head():
    """Calibrating with a frozen head teaches a map that breaks the moment the
    head moves naturally in play - the exact 'points somewhere else' symptom."""
    assert "still" not in GAZE.aim.detail
    assert "naturally" in GAZE.aim.detail


# --- no axis may come out reversed ------------------------------------------

def backwards_looker(flip_x=False, flip_y=False, head=0.55, eyes=0.42,
                     deadzone=0.18, noise=0.0, seed=0):
    """A player whose signal runs the wrong way round on one or both axes.

    Every sign convention in this pipeline - MediaPipe's Y-up 3D space, its
    anatomical blendshape names against image-space landmarks, the mirrored
    preview - is a chance to get an axis backwards. What matters is that the
    game cannot ship a reversed map whatever the conventions turn out to be.
    """
    rng = np.random.default_rng(seed)
    sx, sy = (-1.0 if flip_x else 1.0), (-1.0 if flip_y else 1.0)

    def look(screen):
        across, down = screen[0] - 0.5, screen[1] - 0.5
        yaw = sx * head * math.copysign(max(abs(across) - deadzone, 0.0), across)
        pitch = sy * head * math.copysign(max(abs(down) - deadzone, 0.0), down)
        shake = rng.normal(0, noise, 2) if noise else (0.0, 0.0)
        return make_face(iris=(sx * eyes * across + shake[0],
                               sy * eyes * down + shake[1]),
                         yaw=yaw, pitch=pitch, blink=(0.05, 0.05))

    return look


def points_the_right_way(calibration, look) -> bool:
    """Does the crosshair go right when the player looks right, and down for down?"""
    left = calibration.to_play_area(GAZE.pointer(look((0.1, 0.5)), calibration.tuning))
    right = calibration.to_play_area(GAZE.pointer(look((0.9, 0.5)), calibration.tuning))
    top = calibration.to_play_area(GAZE.pointer(look((0.5, 0.1)), calibration.tuning))
    bottom = calibration.to_play_area(GAZE.pointer(look((0.5, 0.9)), calibration.tuning))
    return left[0] < right[0] and top[1] < bottom[1]


@pytest.mark.parametrize("flip_x, flip_y", [(False, False), (True, False),
                                            (False, True), (True, True)])
def test_no_axis_survives_calibration_reversed(flip_x, flip_y):
    look = backwards_looker(flip_x=flip_x, flip_y=flip_y)
    calibration = walk_setup(look)[0]

    assert calibration.fit_error or calibration.generalisation is not None
    assert points_the_right_way(calibration, look), (
        f"reversed with flip_x={flip_x} flip_y={flip_y}")


@pytest.mark.parametrize("noise", [0.01, 0.03, 0.06])
def test_a_noisy_backwards_player_still_gets_the_right_way_round(noise):
    """The humblest fit only asks that the signal moved WITH the target."""
    look = backwards_looker(flip_x=True, noise=noise, seed=4)
    calibration = walk_setup(look)[0]
    assert points_the_right_way(calibration, look), f"reversed at noise {noise}"


def test_a_signal_that_never_moves_cannot_be_fitted_and_says_so():
    from handy.calibration import default_calibration

    calibration = walk_setup(lambda _target: make_face(blink=(0.05, 0.05)))[0]
    assert calibration.mapping == default_calibration(GAZE).mapping


# --- the trigger has to actually fire ---------------------------------------

def winks(calibration, rest, wink, rounds=4, period=6):
    """Count shots from a player winking on the given profile."""
    control = AimController(GAZE, min_cutoff=1e4, beta=0.0,
                            fire_above=GAZE.fire_above, arm_below=GAZE.arm_below,
                            median=GAZE.trigger_median)
    shots = 0
    for step in range(rounds * period):
        blink = wink if step % period >= period - 2 else rest
        shots += control.update([(frame_of(make_face(blink=blink)), calibration)],
                                step * 0.05).fired
    return shots


REAL_WINKERS = [
    ("clean wink", (0.25, 0.25), (0.92, 0.08)),
    # Most people cannot wink without the other eye closing somewhat.
    ("sloppy wink", (0.25, 0.25), (0.90, 0.50)),
    # A face whose eyes simply rest a little asymmetric reads a standing wink.
    ("asymmetric resting face", (0.45, 0.18), (0.95, 0.20)),
    ("modest blendshape swing", (0.20, 0.22), (0.60, 0.15)),
]


@pytest.mark.parametrize("label, rest, wink", REAL_WINKERS,
                         ids=[case[0] for case in REAL_WINKERS])
def test_every_kind_of_winker_can_fire_without_calibrating(label, rest, wink):
    """On the defaults, before any setup: it has to work or the game is dead."""
    from handy.calibration import default_calibration

    assert winks(default_calibration(GAZE), rest, wink) == 4, label


@pytest.mark.parametrize("label, rest, wink", REAL_WINKERS,
                         ids=[case[0] for case in REAL_WINKERS])
def test_the_same_players_never_fire_on_a_natural_blink(label, rest, wink):
    from handy.calibration import default_calibration

    closed = max(wink)
    blink = (closed, closed * 0.92)  # both eyes, near enough together
    assert winks(default_calibration(GAZE), rest, blink) == 0, label


def test_a_standing_asymmetry_cannot_jam_the_trigger_unarmed():
    """The failure that fires nothing and says nothing: rest inside the band."""
    from handy.calibration import default_calibration

    calibration = default_calibration(GAZE)
    control = AimController(GAZE, min_cutoff=1e4, beta=0.0)
    resting = (0.45, 0.18)

    for step in range(30):
        aim = control.update([(frame_of(make_face(blink=resting)), calibration)],
                             step * 0.05)
    assert aim.armed, "a face at rest must end up armed, wherever its rest sits"
    assert abs(aim.pull) < 0.2, "and its pull must read as near zero"


def test_an_unsteady_wink_is_still_measured_as_a_wink():
    """Refusing an unsteady pose leaves the player a trigger that never fires."""
    rng = np.random.default_rng(2)

    def unsteady(step):
        return make_face(blink=(0.85 + rng.normal(0, 0.09), 0.10 + rng.normal(0, 0.09)))

    rig = walk_setup(looker(), wink=(0.85, 0.10))
    assert rig[0].trigger_fitted
    assert rig[0].cocked < rig[0].folded


def test_poses_that_really_are_identical_are_refused_and_flagged():
    rig = walk_setup(looker(), wink=(0.05, 0.05))
    assert not rig[0].trigger_fitted, "nothing was learned, and it must say so"


# --- a wink is fast, and the tracker is not perfect ------------------------

def eye_controller():
    return AimController(GAZE, min_cutoff=1e4, beta=0.0, fire_above=GAZE.fire_above,
                         arm_below=GAZE.arm_below, median=GAZE.trigger_median)


def play_sequence(sequence, calibration=None, step_seconds=0.048):
    """Feed a scripted run of frames at the face model's real ~21 results/s."""
    from handy.calibration import default_calibration

    calibration = calibration or default_calibration(GAZE)
    control = eye_controller()
    shots = 0
    for index, item in enumerate(sequence):
        frame = FaceFrame() if item == "lost" else frame_of(make_face(blink=item))
        shots += control.update([(frame, calibration)], index * step_seconds).fired
    return shots


REST, WINK, BLINK = (0.24, 0.25), (0.90, 0.30), (0.90, 0.88)


def test_a_wink_seen_in_a_single_detection_still_fires():
    """At ~21 results a second a quick wink may land in one frame. The thumb's
    median-of-three would swallow it; the eye does not use one."""
    assert not GAZE.trigger_median
    assert play_sequence([REST] * 10 + [WINK] + [REST] * 10) == 1


@pytest.mark.parametrize("held", [1, 2, 4, 8])
def test_a_wink_fires_exactly_once_however_long_it_is_held(held):
    assert play_sequence([REST] * 10 + [WINK] * held + [REST] * 10) == 1


def test_the_face_dropping_out_during_the_wink_does_not_lose_the_shot():
    assert play_sequence([REST] * 10 + [WINK, "lost", WINK, WINK] + [REST] * 10) == 1
    assert play_sequence([REST] * 10 + ["lost", WINK, WINK] + [REST] * 10) == 1


def test_a_blink_never_fires_at_the_eyes_thresholds():
    assert play_sequence([REST] * 10 + [BLINK] * 3 + [REST] * 10) == 0
    assert play_sequence(([REST] * 8 + [BLINK] * 2) * 6) == 0, "six blinks, no shots"


def test_the_eye_fires_on_a_smaller_fraction_of_its_calibrated_travel():
    """Setup measures a deliberate, held wink; the quick wink of play is smaller."""
    from handy.schemes import PISTOL

    assert GAZE.fire_above < PISTOL.fire_above
    assert GAZE.arm_below < GAZE.fire_above


def test_a_quick_play_wink_fires_on_a_calibration_made_from_a_perfect_one():
    from handy.calibration import Calibration

    deliberate = Calibration(signal="wink", cocked=0.01, folded=0.80)  # setup's wink
    assert play_sequence([REST] * 10 + [(0.80, 0.40)] * 2 + [REST] * 10,
                         deliberate) == 1


# --- sensitivity -----------------------------------------------------------

@pytest.mark.parametrize("label, wink", [
    ("three-quarters closed", (0.62, 0.28)), ("half closed", (0.50, 0.26)),
    ("gentle wink", (0.42, 0.25)), ("sloppy wink, other eye half", (0.90, 0.50))])
def test_an_eye_only_has_to_come_most_of_the_way_down(label, wink):
    assert play_sequence([REST] * 10 + [wink] * 2 + [REST] * 10) == 1, label


@pytest.mark.parametrize("label, blink", [
    ("clean blink", (0.90, 0.88)), ("uneven blink", (0.90, 0.74)),
    ("onset skew", (0.55, 0.40)), ("onset skew, wider", (0.65, 0.45))])
def test_the_lids_of_a_blink_moving_out_of_step_is_not_a_wink(label, blink):
    """A blink's two lids never close in perfect step; the brief asymmetry must
    not fire. What a blink never has is an eye that stays open - so the wink is
    gated on that."""
    assert play_sequence(([REST] * 8 + [blink] * 2) * 5) == 0, label


def test_a_blink_on_an_asymmetric_face_does_not_fire_on_the_way_back():
    """The gate reads a blink as zero; the resting level must not chase it down
    so fast that returning to an asymmetric rest looks like a pull."""
    rest, blink = (0.45, 0.18), (0.95, 0.87)
    assert play_sequence(([rest] * 10 + [blink] * 3) * 5) == 0
