import pytest

from handy.aiming import (Aim, AimController, Recoil, angle_between,
                          palm_span, thumb_angle, thumb_extension)
from handy.calibration import Calibration
from handy.homography import box_mapping
from handy.schemes import PISTOL
from handy.recognition import Frame
from hands import make_hand, frame_of

PROFILE = Calibration(mapping=box_mapping((0.2, 0.2), (0.8, 0.8)),
                      signal="angle", cocked=20.0, folded=70.0)


def controller(**kwargs) -> AimController:
    # beta=0 and a wide-open cutoff keep the filter out of the way of assertions.
    kwargs.setdefault("min_cutoff", 1e4)
    kwargs.setdefault("beta", 0.0)
    return AimController(PISTOL, **kwargs)


def views(*frames, profile=None):
    """Pair each camera's frame with that camera's calibration."""
    return [(frame, profile or PROFILE) for frame in frames]


class Pistol:
    """Drives a controller with a synthetic hand on a 30 fps clock.

    Poses are held for a few frames, as a real hand would, rather than teleported
    between them one frame at a time.
    """

    FRAME = 1 / 30

    def __init__(self, **kwargs) -> None:
        self.control = controller(**kwargs)
        self.clock = 0.0
        self.shots = 0

    def hold(self, degrees: float, frames: int = 3, **hand) -> Aim:
        for _ in range(frames):
            self.clock += self.FRAME
            aim = self.control.update(
                views(frame_of(make_hand(thumb_degrees=degrees, **hand))), self.clock)
            self.shots += aim.fired
        return aim

    def lose_hand(self, frames: int = 2) -> Aim:
        for _ in range(frames):
            self.clock += self.FRAME
            aim = self.control.update(views(Frame()), self.clock)
        return aim


def test_angle_between_handles_the_right_angle_and_the_degenerate_case():
    assert angle_between((1, 0), (0, 1)) == pytest.approx(90.0)
    assert angle_between((1, 0), (-1, 0)) == pytest.approx(180.0)
    assert angle_between((1, 0), (1, 0)) == pytest.approx(0.0)
    assert angle_between((0, 0), (0, 0)) == 0.0


def test_thumb_angle_measures_rotation_away_from_the_hands_up_axis():
    assert thumb_angle(make_hand(thumb_degrees=0)) == pytest.approx(0.0)
    assert thumb_angle(make_hand(thumb_degrees=25)) == pytest.approx(25.0)
    assert thumb_angle(make_hand(thumb_degrees=-80)) == pytest.approx(80.0)


def test_thumb_angle_survives_the_player_tilting_their_hand():
    """The whole point of measuring against the hand instead of the screen."""
    upright = thumb_angle(make_hand(thumb_degrees=30, roll=0))
    tilted = thumb_angle(make_hand(thumb_degrees=30, roll=55))
    assert tilted == pytest.approx(upright)


def test_thumb_angle_and_extension_ignore_distance_from_the_camera():
    near = make_hand(thumb_degrees=35, reach=0.9, scale=1.0)
    far = make_hand(thumb_degrees=35, reach=0.9, scale=0.4)
    assert thumb_angle(far) == pytest.approx(thumb_angle(near))
    assert thumb_extension(far) == pytest.approx(thumb_extension(near))


def test_extension_is_measured_in_palm_spans():
    assert palm_span(make_hand()) == pytest.approx(0.2)
    assert thumb_extension(make_hand(reach=0.75)) == pytest.approx(0.75)


def test_no_hand_means_no_aim():
    aim = controller().update(views(Frame()), 0.0)
    assert aim == Aim()
    assert not aim.tracking


def test_thumb_up_arms_and_rotating_it_down_fires_once():
    pistol = Pistol()
    cocked = pistol.hold(20)
    assert cocked.armed and cocked.travel == pytest.approx(0.0)

    down = pistol.hold(70)
    assert not down.armed and down.travel == pytest.approx(1.0)
    assert pistol.shots == 1

    pistol.hold(70, frames=15)
    assert pistol.shots == 1, "holding the thumb down must not machine-gun"


def test_a_thumb_still_pointing_up_never_fires():
    """The complaint that started this: no shot while the thumb is up."""
    pistol = Pistol()
    for degrees in (20, 22, 25, 30, 28, 24, 31, 19):
        pistol.hold(degrees, frames=2)
    assert pistol.shots == 0


def test_a_partial_thumb_return_still_earns_the_next_shot():
    """The stroke is what counts. A thumb that comes half way back up has
    plainly ended its pull; demanding a return to some absolute line was
    silently eating every second shot."""
    pistol = Pistol()
    pistol.hold(20)
    pistol.hold(75)
    assert pistol.shots == 1

    assert pistol.hold(45).armed, "a substantial return re-arms"
    pistol.hold(75)
    assert pistol.shots == 2, "and the next fold fires from there"

    assert pistol.hold(18).armed
    pistol.hold(75)
    assert pistol.shots == 3


def test_a_small_dip_after_firing_does_not_re_arm():
    pistol = Pistol()
    pistol.hold(20)
    pistol.hold(75)
    assert pistol.shots == 1
    # Wobbling a few degrees around the fold is not a return.
    for angle in (72, 74, 71, 75, 73, 72):
        assert not pistol.hold(angle, frames=2).armed
    assert pistol.shots == 1


def test_a_burst_of_shots_is_one_shot_per_fold():
    pistol = Pistol()
    for _ in range(5):
        pistol.hold(20)
        pistol.hold(75)
    assert pistol.shots == 5


def test_a_single_misread_frame_cannot_fire_the_gun():
    pistol = Pistol()
    pistol.hold(20)
    pistol.hold(120, frames=1)  # one wild misread from the model
    pistol.hold(20, frames=2)
    assert pistol.shots == 0, "one bad frame is outvoted by its neighbours"


def test_a_thumb_that_rests_half_folded_keeps_firing():
    """Re-arming used to seat the trough at whatever level the thumb came back
    to. Firing wants a rise of fire_above (0.50 of travel) and re-arming wants a
    fall of only arm_below (0.30), so any return in between re-armed the gun
    into a state no stroke could ever fire from: one shot per round, under a
    crosshair that said ARMED."""
    pistol = Pistol()
    pistol.hold(20)          # cocked: travel 0
    pistol.hold(70)          # the calibrated fired pose: travel 1
    assert pistol.shots == 1

    # From here the thumb only ever comes back half way - travel 0.6, a 0.40
    # return: deep enough to re-arm, shallower than the firing stroke.
    for _ in range(10):
        assert pistol.hold(50).armed, "half way back is plainly the end of a pull"
        pistol.hold(70)
    assert pistol.shots == 11, "every full pull after the first fired too"


def test_the_resting_level_never_drifts_above_the_calibrated_fired_pose():
    """The trough creeps upward to absorb posture. Left uncapped it creeps past
    the point where even the pose setup measured as `fired` clears it."""
    pistol = Pistol()
    pistol.hold(20)
    pistol.hold(70)
    pistol.hold(50, frames=120)  # four seconds resting half folded
    assert pistol.control._trough <= 1.0 - pistol.control.fire_above + 1e-9

    shots = pistol.shots
    pistol.hold(70)
    assert pistol.shots == shots + 1, "the fired pose still fires, minutes later"


def test_losing_the_hand_for_real_disarms():
    pistol = Pistol()
    assert pistol.hold(20).armed
    pistol.lose_hand(frames=15)  # half a second: properly gone
    pistol.hold(75)
    assert pistol.shots == 0, "no shot on re-acquisition from a stale armed state"


def test_a_dropped_frame_or_two_does_not_cost_the_shot():
    """Trackers drop frames, and an eye closing is exactly when a face is lost.

    Resetting on one missing frame disarmed the trigger and re-seeded its rest
    at the pull itself - which turned the shot into nothing."""
    pistol = Pistol()
    assert pistol.hold(20).armed
    pistol.lose_hand(frames=2)  # a 70 ms blip
    assert pistol.hold(75).fired or pistol.shots == 1


def test_the_aim_is_mapped_through_the_calibrated_box():
    # The box runs 0.2..0.8, so those edges are the edges of the window. The
    # filter never lands exactly, hence the tolerance.
    for tip, expected in (((0.2, 0.5), 0.0), ((0.8, 0.5), 1.0), ((0.5, 0.5), 0.5)):
        pistol = Pistol()
        assert pistol.hold(20, frames=8, index_tip=tip).position[0] == pytest.approx(expected, abs=1e-3)


def test_aiming_outside_the_box_is_clamped_to_the_edge():
    pistol = Pistol()
    aim = pistol.hold(20, frames=8, index_tip=(0.02, 0.99))
    assert aim.position == pytest.approx((0.0, 1.0), abs=1e-3)


def test_rejects_thresholds_without_hysteresis():
    with pytest.raises(ValueError):
        AimController(PISTOL, fire_above=0.3, arm_below=0.8)


# --- recoil ----------------------------------------------------------------

def test_a_gun_that_has_not_fired_sits_still():
    assert Recoil().offset(12.3) == (0.0, 0.0)


def test_the_shot_kicks_the_crosshair_upwards_then_it_settles():
    recoil = Recoil(kick=30.0, rise=0.04, decay=0.2)
    recoil.fire(0.0)

    peak = recoil.offset(0.04)[1]
    assert peak == pytest.approx(-30.0), "up is negative on screen"
    assert peak < recoil.offset(0.25)[1] < 0.0, "it is settling back down"
    assert recoil.offset(2.0)[1] == pytest.approx(0.0, abs=0.5)


def test_firing_again_before_it_settles_stacks():
    """Emptying the magazine as fast as the thumb allows costs accuracy."""
    single = Recoil(kick=30.0)
    single.fire(0.0)
    double = Recoil(kick=30.0)
    double.fire(0.0)
    double.fire(0.05)

    assert abs(double.offset(0.09)[1]) > abs(single.offset(0.09)[1])


def test_the_stack_is_capped():
    recoil = Recoil(kick=20.0)
    for shot in range(30):
        recoil.fire(shot * 0.01)
    assert abs(recoil.offset(0.3)[1]) <= 2.5 * 20.0


def test_zero_kick_disables_it_entirely():
    recoil = Recoil(kick=0.0)
    recoil.fire(0.0)
    assert recoil.offset(0.04) == (0.0, 0.0)


def test_old_shots_are_forgotten_rather_than_accumulated():
    recoil = Recoil(kick=25.0)
    for shot in range(200):
        recoil.fire(shot * 0.5)
        recoil.offset(shot * 0.5)
    assert len(recoil._shots) < 10


def test_a_disabled_recoil_remembers_no_shots_at_all():
    """`--recoil 0` used to return before the pruning line, so the shot list was
    the one thing in the frame loop that grew without bound - for the whole of
    an endless round."""
    recoil = Recoil(kick=0.0)
    for shot in range(500):
        recoil.fire(shot * 0.5)
        recoil.offset(shot * 0.5)
    assert recoil._shots == []


# --- two cameras -----------------------------------------------------------

SECOND = Calibration(mapping=box_mapping((0.1, 0.1), (0.9, 0.9)),
                     signal="angle", cocked=20.0, folded=70.0)


def test_two_cameras_are_combined_into_one_crosshair():
    aim = controller()
    left = frame_of(make_hand(thumb_degrees=20, index_tip=(0.35, 0.5)))
    right = frame_of(make_hand(thumb_degrees=20, index_tip=(0.50, 0.5)))

    result = aim.update([(left, PROFILE), (right, SECOND)], 0.0)

    assert result.cameras == 2
    assert result.tracking and 0.0 < result.position[0] < 1.0
    assert result.spread > 0.0, "their disagreement is measured, not hidden"


def test_a_camera_that_lost_the_hand_is_simply_skipped():
    aim = controller()
    seen = frame_of(make_hand(thumb_degrees=20, index_tip=(0.5, 0.5)))

    result = aim.update([(seen, PROFILE), (Frame(), SECOND)], 0.0)

    assert result.cameras == 1 and result.tracking
    assert result.spread == 0.0


def test_the_gun_still_works_when_every_camera_loses_the_hand():
    aim = controller()
    aim.update([(frame_of(make_hand(thumb_degrees=20)), PROFILE)], 0.0)
    blip = aim.update([(Frame(), PROFILE), (Frame(), SECOND)], 0.1)
    assert not blip.tracking, "nothing to aim with this frame"
    assert blip.armed, "but a blip does not throw the armed state away"
    gone = aim.update([(Frame(), PROFILE), (Frame(), SECOND)], 1.0)
    assert gone == Aim(), "a real loss forgets everything"


def test_one_camera_behaves_exactly_as_it_did_before_the_second_arrived():
    """Adding the machinery must not change the single-camera game."""
    single = controller()
    frames = [frame_of(make_hand(thumb_degrees=deg, index_tip=(0.4, 0.6)))
              for deg in (20, 20, 75, 75, 20, 20, 75, 75)]
    shots = sum(single.update([(frame, PROFILE)], index * 0.05).fired
                for index, frame in enumerate(frames))
    assert shots == 2


# --- sensitivity: quick, lazy, real-world folds -----------------------------

def noisy_pistol(profile=PROFILE, seed=0):
    import numpy as np

    rng = np.random.default_rng(seed)
    control = AimController(PISTOL, min_cutoff=1e4, beta=0.0)

    def play(angles, noise=2.0):
        shots = 0
        for index, angle in enumerate(angles):
            wobble = angle + rng.normal(0, noise)
            frame = frame_of(make_hand(thumb_degrees=wobble))
            shots += control.update([(frame, profile)], index / 30).fired
        return shots

    return play


def fold_sequence(peak, frames, repeats=4):
    import numpy as np

    rest = [18.0] * 10
    stroke = (list(np.linspace(18, peak, frames)) + [peak]
              + list(np.linspace(peak, 18, frames)))
    return rest + (stroke + rest[:6]) * repeats


@pytest.mark.parametrize("label, peak, frames", [
    ("snappy full fold", 75, 2), ("quick lazy fold", 55, 3),
    ("slow lazy fold", 50, 6)])
def test_every_kind_of_fold_fires_every_time(label, peak, frames):
    """The complaint: 'hard to shoot sometimes'. A lazy 50-degree fold is still
    unmistakably a fold, and it must fire - reliably, not sometimes."""
    assert noisy_pistol()(fold_sequence(peak, frames)) == 4, label


def test_neither_tremor_nor_slow_drift_ever_fires():
    import numpy as np

    play = noisy_pistol()
    tremor = [18 + 4 * np.sin(i / 3) for i in range(600)]
    assert play(tremor, noise=2.5) == 0, "20 s of wobble at rest"
    assert noisy_pistol(seed=1)(list(np.linspace(18, 55, 600))) == 0, \
        "20 s of postural drift"


def test_a_held_fold_is_one_shot():
    sequence = fold_sequence(75, 3, repeats=1)[:-16] + [74.0] * 90
    assert noisy_pistol()(sequence) == 1


def test_a_heroic_calibration_fold_cannot_raise_the_bar():
    """Setup says 'thumb DOWN, as if firing' and people oblige with a thumb
    slammed to ninety degrees. The scale that sets must stay within what a
    comfortable play stroke spans, or every quick pull is a near miss."""
    from handy.calibration import Calibration

    deep = Calibration(signal="angle", cocked=16.0, folded=16.0 + 45.0)
    assert noisy_pistol(profile=deep)(fold_sequence(50, 6)) == 4


def test_calibration_caps_the_span_it_stores():
    from handy.calibration import CalibrationSession

    session = CalibrationSession(PISTOL, cameras=1, grid=2, dwell=0.3,
                                 settle=0.1)
    clock = 0.0
    while not session.is_done:
        step = session.step
        for _ in range(600):
            clock += 1 / 30
            degrees = 88.0 if step.key == "fired" else 16.0
            session.update([frame_of(make_hand(thumb_degrees=degrees))], clock)
            if session.step is not step or session.is_done:
                break
    fitted = session.result()[0]
    assert fitted.trigger_fitted
    span = abs(fitted.folded - fitted.cocked)
    assert span <= PISTOL.signal("angle").max_span + 1e-9
