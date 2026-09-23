"""Natural thumb gestures and incremental shooting calibration."""

from dataclasses import replace

import numpy as np
import pytest

from handy.aiming import AimController, thumb_pull
from handy.calibration import Calibration, Rig
from handy.schemes import PISTOL
from handy.shot_calibration import ShotCalibration
from hands import frame_of, make_hand


@pytest.mark.parametrize("scale", [0.4, 1, 2])
@pytest.mark.parametrize("roll", [-80, 0, 65])
def test_thumb_gesture_is_size_and_rotation_independent(scale, roll):
    assert thumb_pull(make_hand(20, scale=scale, roll=roll)) < 0.3
    assert thumb_pull(make_hand(70, scale=scale, roll=roll)) > 0.5
    assert thumb_pull(make_hand(20, reach=0.4, scale=scale, roll=roll)) > 0.5


def test_the_thumb_trigger_requires_release():
    controller = AimController(PISTOL)
    profile = Calibration()
    shots = []
    # Acquiring an already folded thumb is never a shot; holding it isn't either.
    for i, degrees in enumerate([70] * 8 + [20] * 4 + [70] * 8 + [20] * 4 + [70] * 4):
        aim = controller.update([(frame_of(make_hand(degrees)), profile)], i * 0.05)
        if aim.fired:
            shots.append(i)
    assert len(shots) == 2
    controller.update([], 10)
    assert not controller.update([(frame_of(make_hand(70)), profile)], 11).fired


def feed_shot(session, now, stamp, point=None, kick=False):
    target = session.target
    point = point or (0.2 + 0.6 * target[0], 0.25 + 0.5 * target[1])
    for degrees in [20] * 8 + [70] * 4:
        stamp += 1
        now += 0.05
        tip = (0.95, 0.95) if kick and degrees == 70 else point
        frame = replace(frame_of(make_hand(degrees, index_tip=tip)), timestamp_ms=stamp)
        session.update([frame], now)
    return now, stamp


def test_fit_uses_aim_before_thumb_pull_not_hand_kick():
    session = ShotCalibration(PISTOL)
    now, stamp = 0, 0
    for _ in range(8):
        now, stamp = feed_shot(session, now, stamp, kick=True)
    assert session.ready
    assert session.rig[0].project((0.5, 0.5)) == pytest.approx((0.5, 0.5), abs=0.001)
    session.undo()
    assert len(session.hits) == 4 and session.ready
    assert len(session.samples) == 3


def test_stale_or_missing_tracking_cannot_record_shots():
    session = ShotCalibration(PISTOL)
    frame = replace(frame_of(make_hand(20)), timestamp_ms=1)
    session.update([frame], 0)
    session.update([frame], 0.5)
    assert not session.aim.tracking
    folded = replace(frame_of(make_hand(70)), timestamp_ms=2)
    session.update([folded], 0.6)
    assert not session.samples


def test_undo_returns_to_previous_fit_instead_of_losing_saved_setup():
    previous = Rig((Calibration(aim_fitted=True),))
    session = ShotCalibration(PISTOL, previous=previous)
    now, stamp = feed_shot(session, 0, 0)
    session.undo()
    assert session.rig == previous and session.ready


def test_native_setup_starts_after_five_verified_hits(monkeypatch):
    from handy import app, scene

    session_ref = []
    clock = [0.0]

    class Eyes:
        def __len__(self):
            return 1

        def read(self):
            session = session_ref[-1] if session_ref else None
            target = session.target if session else (0.12, 0.18)
            i = round(clock[0] / 0.05)
            hand = make_hand(
                70 if i % 12 >= 8 else 20,
                index_tip=(0.2 + 0.6 * target[0], 0.25 + 0.5 * target[1]),
            )
            return [np.zeros((480, 640, 3), np.uint8)], [
                replace(frame_of(hand), timestamp_ms=i)
            ]

    def tick():
        clock[0] += 0.05
        assert clock[0] < 10, "setup loop failed to accept shots"
        return clock[0]

    real_draw = scene.draw_shot_calibration

    def draw(canvas, session, *args):
        session_ref.append(session)
        real_draw(canvas, session, *args)

    monkeypatch.setattr(app.time, "monotonic", tick)
    monkeypatch.setattr(scene, "draw_shot_calibration", draw)
    monkeypatch.setattr(app.cv2, "imshow", lambda *args: None)
    monkeypatch.setattr(app, "window_closed", lambda: False)
    monkeypatch.setattr(app.cv2, "waitKey", lambda _: 255)
    rig = app.run_calibration(
        Eyes(),
        np.zeros((720, 1280, 3), np.uint8),
        app.layout_for(1280, 720),
        PISTOL,
        None,
    )
    assert rig[0].aim_fitted
    assert session_ref[-1].complete
    assert len(session_ref[-1].hits) == 5


def test_verification_miss_cannot_count_a_training_point_as_a_hit():
    session = ShotCalibration(PISTOL)
    now, stamp = 0, 0
    for _ in range(3):
        now, stamp = feed_shot(session, now, stamp)
    assert session.testing and not session.hits
    now, stamp = feed_shot(session, now, stamp)
    assert len(session.hits) == 1
    target = session.target
    wrong = (0.2 + 0.6 * (target[0] + 0.08), 0.25 + 0.5 * target[1])
    now, stamp = feed_shot(session, now, stamp, point=wrong)
    assert not session.last_hit and not session.complete
    if session.fitted:
        assert not session.hits  # every new fit must be independently rechecked


def fold(session, poses, fps=30):
    """Play (thumb degrees, fingertip) poses one frame each, fresh every frame."""
    now, stamp = 0.0, 0
    for degrees, tip in poses:
        stamp += 1
        now += 1 / fps
        frame = replace(frame_of(make_hand(degrees, index_tip=tip)), timestamp_ms=stamp)
        session.update([frame], now)


@pytest.mark.parametrize("pause", [0, 7, 10, 20])
def test_a_fold_that_pauses_part_way_still_counts(pause):
    """Aim samples were kept only while the thumb was up, and expired after a
    quarter of a second. A fold that paused part way for longer than that
    reached the trigger with nothing left, and the shot just fired was thrown
    away - with a message telling the player to raise their thumb."""
    session = ShotCalibration(PISTOL)
    target = session.target
    tip = (0.2 + 0.6 * target[0], 0.25 + 0.5 * target[1])
    assert 0.35 < thumb_pull(make_hand(42)) < 0.5, "part way: armed, not fired"

    fold(session, [(20, tip)] * 10 + [(42, tip)] * pause + [(70, tip)] * 4)

    assert session.shot_count == 1 and len(session.samples) == 1
    assert session.samples[0][0][0] == pytest.approx(tip)


def test_a_fold_given_up_part_way_does_not_leave_its_aim_behind():
    """Holding the aim through a fold must not hold it through the next one."""
    session = ShotCalibration(PISTOL)
    target = session.target
    old, new = (0.3, 0.3), (0.2 + 0.6 * target[0], 0.25 + 0.5 * target[1])

    fold(session, [(20, old)] * 10 + [(42, old)] * 10 + [(20, new)] * 10
         + [(70, new)] * 4)

    assert session.samples[0][0][0] == pytest.approx(new)


def feed_pair(session, now, stamp, second, first=None):
    """One shot seen by two cameras. ``second`` places the hand for camera two
    given the target, or returns None when that camera cannot see it."""
    target = session.target
    one = first or (0.2 + 0.6 * target[0], 0.25 + 0.5 * target[1])
    two = second(target)
    for degrees in [20] * 8 + [70] * 4:
        stamp += 1
        now += 0.05
        frames = [frame_of(make_hand(degrees, index_tip=one)),
                  frame_of(make_hand(degrees, index_tip=two)) if two else frame_of()]
        session.update([replace(f, timestamp_ms=stamp) for f in frames], now)
    return now, stamp


def shoot_until_complete(session, second, shots=16):
    now, stamp = 0.0, 0
    for _ in range(shots):
        now, stamp = feed_pair(session, now, stamp, second)
        if session.complete:
            break
    return session


def test_a_badly_placed_second_camera_sits_out_instead_of_failing_the_fit():
    """One camera the fit could not use failed it for the whole rig: a second
    camera nearly side-on gave forty shots and not a single fit. A second
    camera is supposed to cost nothing; now it is told to sit the game out."""
    def side_on(target):  # it barely sees the sideways sweep at all
        return (0.5 + 0.03 * target[0], 0.3 + 0.4 * target[1])

    session = shoot_until_complete(ShotCalibration(PISTOL, cameras=2), side_on)

    assert session.complete, session.message
    good, idle = session.rig.cameras
    assert good.aim_fitted and good.usable
    assert not idle.aim_fitted and not idle.usable
    assert session.rig.fitted


def test_a_camera_that_cannot_see_every_shot_does_not_hold_up_the_rest():
    """Every camera had to see the hand on every shot or the shot never
    happened: a second camera that could not see the left of the room kept
    the first target lit for ever."""
    def right_half_only(target):
        return None if target[0] < 0.5 else (0.3 + 0.4 * target[0],
                                             0.3 + 0.4 * target[1])

    session = shoot_until_complete(ShotCalibration(PISTOL, cameras=2),
                                   right_half_only)

    assert session.complete, session.message
    assert session.rig.cameras[0].aim_fitted


def test_both_cameras_learn_when_both_see_the_shots():
    def good(target):
        return (0.3 + 0.4 * target[0], 0.3 + 0.4 * target[1])

    session = shoot_until_complete(ShotCalibration(PISTOL, cameras=2), good)
    assert session.complete
    assert all(camera.aim_fitted and camera.usable for camera in session.rig.cameras)


def test_the_fit_still_fails_when_no_camera_can_aim():
    session = ShotCalibration(PISTOL, cameras=2)
    now, stamp = 0.0, 0
    for _ in range(2):  # a hand that never moved, in both views
        now, stamp = feed_pair(session, now, stamp, lambda _: (0.5, 0.5),
                               first=(0.5, 0.5))
    assert not session.fitted and len(session.samples) == 1
    assert "too similar" in session.message


def test_eye_scope_uses_held_closure_and_filters_brief_blinks():
    from handy.aiming import EyeScope
    from handy.schemes import MARKSMAN
    from handy.marksman import Marksman
    from eyes import make_face

    scope = EyeScope()
    assert not scope.update(0.1, 0)
    assert not scope.update(0.9, 0.1)
    assert not scope.update(0.9, 0.2)
    assert not scope.update(0.1, 0.25)
    # Both eyes may squint; no wink asymmetry or gaze direction is required.
    closure = MARKSMAN.scope(Marksman(make_hand(), make_face(blink=(0.85, 0.7))))
    assert closure == 0.85
    assert not scope.update(closure, 1)
    assert scope.update(closure, 1.2)
    assert scope.update(0.4, 1.3)  # hysteresis
    assert not scope.update(0.1, 1.4)
    scope.update(0.9, 2)
    assert scope.update(0.9, 2.2)
    assert not scope.update(None, 2.5)


def test_scoped_hand_motion_is_four_times_slower_without_an_entry_jump():
    from handy.maps import SNIPER
    from handy.game import RoundOptions, Rect

    rifle = SNIPER.create(RoundOptions(Rect(0, 0, 960, 540)))
    rifle.scope_sensitivity = 0.25
    rifle.look((0.4, 0.4), False)
    rifle.look((0.4, 0.4), True)
    assert rifle.pan == (0.4, 0.4)
    rifle.look((0.6, 0.5), True)
    assert rifle.pan == pytest.approx((0.45, 0.425))
    rifle.look((0.6, 0.5), False)
    assert rifle.pan == (0.6, 0.5)


def test_scoped_tracking_reacquisition_keeps_the_view_still():
    from handy.maps import SNIPER
    from handy.game import RoundOptions, Rect

    rifle = SNIPER.create(RoundOptions(Rect(0, 0, 960, 540)))
    rifle.scope_sensitivity = 0.25
    rifle.look((0.4, 0.4), True)
    rifle.look(None, True)
    rifle.look((0.9, 0.9), True)
    assert rifle.pan == (0.4, 0.4)
    rifle.look((0.8, 0.8), True)
    assert rifle.pan == pytest.approx((0.375, 0.375))


def test_old_face_result_cannot_hold_scope_while_hand_tracking_continues():
    from types import SimpleNamespace
    from handy.marksman import MarksmanStream
    from handy.faces import FaceFrame
    from eyes import make_face

    stream = object.__new__(MarksmanStream)
    hand = make_hand()
    stream._hands = SimpleNamespace(
        latest=lambda: replace(frame_of(hand), timestamp_ms=1000)
    )
    stream._faces = SimpleNamespace(
        latest=lambda: FaceFrame(faces=(make_face(blink=(0.9, 0.1)),), timestamp_ms=500)
    )
    frame = stream.latest()
    assert frame.subjects[0].hand == hand
    assert frame.subjects[0].face is None and frame.faces == ()


def test_scope_freshness_accounts_for_separate_model_startup_times():
    from types import SimpleNamespace
    from handy.marksman import MarksmanStream
    from handy.faces import FaceFrame
    from eyes import make_face

    stream = object.__new__(MarksmanStream)
    face = make_face(blink=(0.9, 0.1))
    stream._hands = SimpleNamespace(
        _started=10.0, latest=lambda: replace(frame_of(make_hand()), timestamp_ms=1000)
    )
    stream._faces = SimpleNamespace(
        _started=10.5, latest=lambda: FaceFrame(faces=(face,), timestamp_ms=500)
    )
    assert stream.latest().subjects[0].face == face
