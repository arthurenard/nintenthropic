import json

import numpy as np
import pytest

from handy import homography
from handy.calibration import (GRID_MARGIN, Calibration, CalibrationSession,
                               Rig, aim_steps, default_calibration,
                               reach_steps, trigger_steps)
from handy.schemes import PISTOL
from handy.recognition import Frame
from hands import make_hand, frame_of

DEFAULT = default_calibration(PISTOL)

# A camera off to the side of the screen: the hand plane arrives rotated,
# sheared and foreshortened. This is the case a two-point box cannot express.
OFF_AXIS = homography.fit(
    [(0.30, 0.42), (0.62, 0.36), (0.68, 0.66), (0.34, 0.72)],
    [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)])


def hand_position_for(screen: tuple[float, float]) -> tuple[float, float]:
    """Where the hand has to be, for that off-axis camera, to point at ``screen``."""
    inverse = np.linalg.inv(np.asarray(OFF_AXIS).reshape(3, 3))
    homogeneous = inverse @ np.array([*screen, 1.0])
    return tuple(homogeneous[:2] / homogeneous[2])


def run_step(session, hand_for, start=0.0, fps=30):
    """Hold one pose until the session accepts it, and return the clock."""
    clock, step = start, session.step
    for frame in range(600):
        clock += 1 / fps
        session.update([frame_of(hand_for(frame))], clock)
        if session.step is not step or session.is_done:
            return clock
    raise AssertionError(f"step {step.key!r} never completed")


def calibrate(grid=3, place=hand_position_for, cocked=None, folded=None,
              dwell=0.4, jitter=0.0, seed=1):
    """Play a whole session: trace the grid, then hold the two thumb poses."""
    rng = np.random.default_rng(seed)
    session = CalibrationSession(PISTOL, cameras=1, grid=grid, dwell=dwell, settle=0.2)
    cocked = cocked or (lambda _: make_hand(thumb_degrees=15))
    folded = folded or (lambda _: make_hand(thumb_degrees=72))

    clock = 0.0
    for step in session.steps:
        if step.target is not None:
            spot = place(step.target)

            def hold(_frame, spot=spot):
                shaken = tuple(spot + rng.normal(0, jitter, 2)) if jitter else spot
                return make_hand(index_tip=shaken)

            clock = run_step(session, hold, start=clock)
        else:
            clock = run_step(session, cocked if step.key == "cocked" else folded,
                             start=clock)
    assert session.is_done
    return session.result()[0]


# --- the grid --------------------------------------------------------------

def test_the_grid_covers_the_screen_without_touching_the_very_edge():
    targets = [step.target for step in aim_steps(PISTOL, 3)]
    assert len(targets) == 9
    assert min(x for x, _ in targets) == pytest.approx(GRID_MARGIN)
    assert max(x for x, _ in targets) == pytest.approx(1 - GRID_MARGIN)
    assert min(y for _, y in targets) == pytest.approx(GRID_MARGIN)
    assert max(y for _, y in targets) == pytest.approx(1 - GRID_MARGIN)


def test_a_bigger_grid_asks_for_more_points():
    assert len(aim_steps(PISTOL, 2)) == 4
    assert len(aim_steps(PISTOL, 4)) == 16


def test_the_grid_snakes_so_the_hand_never_jumps_back_across_the_screen():
    targets = [step.target for step in aim_steps(PISTOL, 3)]
    for previous, current in zip(targets, targets[1:]):
        step = abs(previous[0] - current[0]) + abs(previous[1] - current[1])
        assert step <= 0.5 + 1e-9, f"long jump from {previous} to {current}"


def test_a_grid_needs_at_least_two_points_a_side():
    with pytest.raises(ValueError):
        aim_steps(PISTOL, 1)


def test_a_session_asks_for_the_grid_and_both_thumb_poses():
    session = CalibrationSession(PISTOL, cameras=1, grid=3)
    assert len(session.steps) == 9 + len(reach_steps(PISTOL)) + len(trigger_steps(PISTOL))
    assert len(session.aim_targets) == 9


# --- the fitted map --------------------------------------------------------

def test_a_traced_grid_recovers_the_camera_placement():
    """The heart of it: an off-axis camera is learned, not approximated."""
    result = calibrate(grid=3)

    assert result.fit_error < 0.01
    for screen in ((0.1, 0.1), (0.5, 0.5), (0.9, 0.2), (0.25, 0.85)):
        landed = result.to_play_area(hand_position_for(screen))
        assert landed == pytest.approx(screen, abs=0.02)


def worst_miss(calibration) -> float:
    """The furthest a probe point lands from where it was aimed, 0..1 of screen."""
    probes = [(0.2, 0.2), (0.8, 0.3), (0.5, 0.9), (0.15, 0.6), (0.65, 0.45)]
    return max(np.hypot(*np.subtract(
        calibration.to_play_area(hand_position_for(p)), p)) for p in probes)


def test_nine_points_average_out_the_shake_that_four_cannot():
    """Extra points buy least squares something to average. Over one trace it is
    a coin flip, so this compares the average over many."""
    seeds = range(12)
    coarse = [worst_miss(calibrate(grid=2, jitter=0.008, seed=s)) for s in seeds]
    fine = [worst_miss(calibrate(grid=3, jitter=0.008, seed=s)) for s in seeds]

    assert np.mean(fine) < np.mean(coarse)
    assert max(fine) < 0.1, "even the worst nine-point trace stays usable"


def test_a_four_point_trace_is_still_scored_against_a_marker_it_never_saw():
    """Four correspondences determine a homography exactly, so its residual -
    and, when the held-out score fell back to the residual, its "honest" figure
    too - came out at 1e-16 whatever the shake. A map fitted entirely to noise
    passed the quality gate and told the player it was accurate to 0.0% of the
    screen. Every reported figure now has to have been earned on a marker the
    fit never trained on."""
    coarse = calibrate(grid=2, jitter=0.01, seed=3)
    fine = calibrate(grid=3, jitter=0.01, seed=3)

    for result in (coarse, fine):
        assert result.aim_fitted
        assert result.generalisation > 0.001, "no fit certifies itself for free"
        assert result.generalisation > result.fit_error, "held out costs more"


def test_a_four_point_trace_too_shaky_to_predict_itself_is_refused():
    """The gate has to be able to bite at every grid size, not just nine points."""
    coarse = calibrate(grid=2, jitter=0.04, seed=1)

    assert not coarse.aim_fitted, "it fell back rather than certify noise"
    assert coarse.mapping == DEFAULT.mapping


def test_the_map_still_works_when_the_camera_is_square_on():
    """A well-aligned webcam is just the easy case of the same fit."""
    def square(screen):
        return (0.2 + 0.6 * screen[0], 0.25 + 0.5 * screen[1])

    result = calibrate(grid=3, place=square)

    assert result.fit_error < 0.01
    assert result.to_play_area(square((0.5, 0.5))) == pytest.approx((0.5, 0.5), abs=0.02)


def test_aiming_past_the_calibrated_grid_is_clamped_to_the_screen():
    result = calibrate(grid=3)
    corner = result.to_play_area(hand_position_for((-0.4, 1.6)))
    assert corner == pytest.approx((0.0, 1.0), abs=1e-9)


def test_a_hand_that_never_moved_keeps_the_default_map():
    result = calibrate(grid=3, place=lambda _: (0.5, 0.5))
    assert result.mapping == DEFAULT.mapping


def test_a_wildly_inconsistent_trace_is_rejected():
    rng = np.random.default_rng(0)

    def scattered(_target):
        return tuple(rng.uniform(0.3, 0.7, 2))

    result = calibrate(grid=3, place=scattered)
    assert result.mapping == DEFAULT.mapping
    assert not result.aim_fitted


def test_a_failed_recalibration_says_so_even_when_it_falls_back_on_a_good_one():
    """The error figures cannot answer "did this fit?": on failure the session
    returns the FALLBACK's figures, and when the fallback is the previous, good
    calibration those are non-zero and flattering. A player who pressed 'c'
    because aiming felt wrong was told setup had succeeded, and handed back the
    identical map."""
    rng = np.random.default_rng(0)
    good = calibrate(grid=3)
    assert good.aim_fitted and good.generalisation > 0.0

    session = CalibrationSession(PISTOL, cameras=1, grid=3, dwell=0.4, settle=0.2,
                                 fallback=Rig((good,)))
    clock = 0.0
    for step in session.steps:
        if step.target is None:
            clock = run_step(session, lambda _f: make_hand(thumb_degrees=15),
                             start=clock)
        else:
            clock = run_step(
                session,
                lambda _f: make_hand(index_tip=tuple(rng.uniform(0.3, 0.7, 2))),
                start=clock)
    failed = session.result()[0]

    assert failed.mapping == good.mapping, "it did fall back on the old map"
    assert failed.generalisation == good.generalisation, "and on its old figures"
    assert not failed.aim_fitted, "but it must not claim the old map as measured"


# --- the calibration record ------------------------------------------------

def test_travel_is_zero_when_cocked_and_one_when_fired():
    calibration = Calibration(signal="angle", cocked=18.0, folded=64.0)
    measure = PISTOL.signal("angle").measure
    assert calibration.travel(measure(make_hand(thumb_degrees=18))) == pytest.approx(0.0)
    assert calibration.travel(measure(make_hand(thumb_degrees=64))) == pytest.approx(1.0)
    assert calibration.travel(measure(make_hand(thumb_degrees=41))) == pytest.approx(0.5)


def test_travel_handles_a_signal_that_runs_the_other_way():
    """Reach shrinks as the thumb folds; travel still runs 0 -> 1."""
    calibration = Calibration(signal="reach", cocked=1.0, folded=0.4)
    measure = PISTOL.signal("reach").measure
    assert calibration.travel(measure(make_hand(reach=1.0))) == pytest.approx(0.0)
    assert calibration.travel(measure(make_hand(reach=0.4))) == pytest.approx(1.0)
    assert calibration.travel(measure(make_hand(reach=0.7))) == pytest.approx(0.5)


def test_a_degenerate_record_is_refused():
    with pytest.raises(ValueError):
        Calibration(mapping=(1.0, 0.0, 0.0))
    with pytest.raises(ValueError):
        Calibration(cocked=30.0, folded=30.0)


@pytest.mark.parametrize("field, value", [
    ("mapping", (float("nan"), 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0)),
    ("mapping", (1e309, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0)),
    ("cocked", float("inf")),
    ("tuning", (0.0, float("nan"))),
    ("tuning", (0.0,)),
    ("jitter", float("nan")),
    ("fit_error", float("inf")),
    ("generalisation", float("nan")),
    ("gain", float("nan")),
    ("gain", -1.0),
    ("slide", ("a", "b")),
    ("slide", (0.0, 0.0, 0.0)),
    ("slide", (float("nan"), 0.0)),
])
def test_a_calibration_holds_finite_numbers_only(field, value):
    """Python's json reads and writes NaN and Infinity without a murmur. One
    NaN in a map is a NaN crosshair - the filter carries it for the rest of the
    session and the game loop's round() raises on it."""
    with pytest.raises(ValueError):
        Calibration(**{field: value})


def test_an_infinite_gain_is_how_a_camera_sits_the_game_out(tmp_path):
    """The one non-finite number with a meaning. It is written as null, so the
    file stays strict JSON that anything can read."""
    idle = Calibration(gain=float("inf"))
    assert not idle.usable
    path = tmp_path / "calibration.json"
    Rig((Calibration(gain=2.0), idle)).save(path)

    def refuse(name):
        raise AssertionError(f"{name} written to disk")

    raw = json.loads(path.read_text(), parse_constant=refuse)
    assert raw["cameras"][1]["gain"] is None
    assert Rig.load(path)[1] == idle


def test_a_file_with_nan_or_infinity_in_it_is_refused(tmp_path):
    path = tmp_path / "calibration.json"
    entry = {**DEFAULT.to_dict(), "aim_fitted": True}
    entry["mapping"] = [float("nan")] + entry["mapping"][1:]
    path.write_text(json.dumps({"cameras": [entry]}))
    assert "NaN" in path.read_text(), "which the json module happily wrote"
    assert Rig.load(path) is None


def test_a_saved_setup_without_the_trigger_poses_still_loads():
    """The built-in thumb trigger ignores the calibrated poses, and a browser
    that stored only what it uses was refused on every start, for ever."""
    loaded = Calibration.from_dict({"mapping": [1, 0, 0, 0, 1, 0, 0, 0, 1],
                                    "aim_fitted": True})
    assert loaded.aim_fitted and loaded.mapping == homography.IDENTITY
    assert (loaded.signal, loaded.cocked, loaded.folded) == (
        Calibration().signal, Calibration().cocked, Calibration().folded)


def test_a_rig_survives_a_round_trip_through_disk(tmp_path):
    original = Rig((calibrate(grid=3), Calibration(gain=3.2, slide=(0.04, -0.02))))
    path = tmp_path / "calibration.json"
    original.save(path)
    assert Rig.load(path) == original


def test_whether_the_aim_was_really_fitted_survives_the_round_trip(tmp_path):
    fitted = calibrate(grid=3)
    assert fitted.aim_fitted
    path = tmp_path / "calibration.json"
    Rig((fitted, DEFAULT)).save(path)
    loaded = Rig.load(path)

    assert loaded[0].aim_fitted
    assert not loaded[1].aim_fitted, "the defaults were never fitted to anyone"


def test_a_file_from_before_the_flag_existed_is_read_by_its_error_figures(tmp_path):
    """The only trace a real fit left in an older save is a non-zero error."""
    path = tmp_path / "old.json"
    common = {"mapping": [1, 0, 0, 0, 1, 0, 0, 0, 1], "signal": "angle",
              "cocked": 20.0, "folded": 70.0}
    path.write_text(json.dumps({"cameras": [
        {**common, "fit_error": 0.01, "generalisation": 0.02},
        {**common, "fit_error": 0.0, "generalisation": 0.0},
    ]}))
    rig = Rig.load(path)

    assert rig[0].aim_fitted
    assert not rig[1].aim_fitted


def test_a_file_from_before_the_map_was_projective_still_loads(tmp_path):
    """Old saves stored a plain box. Read it rather than throwing it away."""
    path = tmp_path / "old.json"
    path.write_text(json.dumps({"aim_min": [0.2, 0.3], "aim_max": [0.8, 0.7],
                                               "signal": "angle", "cocked": 17.0, "folded": 68.0}))
    rig = Rig.load(path)
    assert rig is not None and len(rig) == 1
    loaded = rig[0]

    assert loaded.cocked == 17.0
    assert loaded.to_play_area((0.2, 0.3)) == pytest.approx((0.0, 0.0))
    assert loaded.to_play_area((0.8, 0.7)) == pytest.approx((1.0, 1.0))


def test_a_missing_or_broken_file_reads_as_nothing(tmp_path):
    assert Rig.load(tmp_path / "absent.json") is None
    broken = tmp_path / "broken.json"
    broken.write_text("{not json")
    assert Rig.load(broken) is None
    # The trigger poses are optional (the built-in thumb ignores them); the
    # map is the one thing a calibration cannot do without.
    incomplete = tmp_path / "incomplete.json"
    incomplete.write_text(json.dumps({"signal": "angle", "cocked": 20.0,
                                      "folded": 70.0}))
    assert Rig.load(incomplete) is None


# --- the guided session ----------------------------------------------------

def test_the_session_walks_every_step_in_order():
    session = CalibrationSession(PISTOL, cameras=1, grid=2, dwell=0.3, settle=0.1)
    clock = 0.0
    for index in range(len(session.steps)):
        assert session.update([frame_of(make_hand())], clock).index == index
        clock = run_step(session, lambda _: make_hand(), start=clock)
    assert session.is_done


def test_nothing_is_sampled_while_the_next_instruction_settles():
    """The frames right after a step still show the old pose: they must not count."""
    session = CalibrationSession(PISTOL, cameras=1, grid=2, dwell=0.5, settle=1.0)
    clock = run_step(session, lambda _: make_hand(index_tip=(0.3, 0.3)))

    settling = session.update([frame_of(make_hand(index_tip=(0.3, 0.3)))], clock + 0.1)
    assert settling.settling and settling.fraction == 0.0

    assert not session.update([frame_of(make_hand())], clock + 1.1).settling
    assert session.update([frame_of(make_hand())], clock + 1.4).fraction > 0


def test_a_step_needs_the_full_dwell():
    session = CalibrationSession(PISTOL, cameras=1, grid=2, dwell=1.0)
    progress = session.update([frame_of(make_hand())], 0.0)
    assert progress.fraction == 0.0 and progress.tracking

    assert session.update([frame_of(make_hand())], 0.5).fraction == pytest.approx(0.5)
    assert session.update([frame_of(make_hand())], 0.9).index == 0
    assert session.update([frame_of(make_hand())], 1.1).index == 1


def test_losing_the_hand_restarts_the_step():
    session = CalibrationSession(PISTOL, cameras=1, grid=2, dwell=1.0)
    session.update([frame_of(make_hand())], 0.0)
    assert session.update([frame_of(make_hand())], 0.8).fraction == pytest.approx(0.8)

    dropped = session.update([Frame()], 0.9)
    assert not dropped.tracking and dropped.fraction == 0.0

    assert session.update([frame_of(make_hand())], 1.0).fraction == pytest.approx(0.0)
    assert session.update([frame_of(make_hand())], 1.5).fraction == pytest.approx(0.5)


def test_the_overlay_always_knows_the_whole_grid():
    session = CalibrationSession(PISTOL, cameras=1, grid=3)
    progress = session.update([frame_of(make_hand())], 0.0)
    assert len(progress.all_targets) == 9


# --- the trigger poses -----------------------------------------------------

def test_the_two_thumb_poses_become_the_trigger_thresholds():
    result = calibrate(cocked=lambda step: make_hand(thumb_degrees=14 + step % 3),
                       folded=lambda step: make_hand(thumb_degrees=78 + step % 3))
    assert result.signal == "angle"
    assert result.cocked == pytest.approx(15.0, abs=1.5)
    # The measured fold was ~79 degrees, but the stored span is capped: a
    # deliberate setup pose must not make every quick play-stroke a near miss.
    assert result.folded == pytest.approx(
        result.cocked + PISTOL.signal("angle").max_span, abs=1.5)


def test_a_thumb_that_folds_without_rotating_falls_back_to_reach():
    """Some players tuck the thumb in rather than rotate it. Measure that instead."""
    result = calibrate(cocked=lambda _: make_hand(thumb_degrees=20, reach=1.15),
                       folded=lambda _: make_hand(thumb_degrees=22, reach=0.30))
    assert result.signal == "reach"
    assert result.cocked == pytest.approx(1.15, abs=0.02)
    # Direction preserved, span capped - see the angle test above.
    assert result.folded == pytest.approx(
        result.cocked - PISTOL.signal("reach").max_span, abs=0.02)


def test_two_poses_that_look_alike_keep_the_safe_defaults():
    result = calibrate(cocked=lambda _: make_hand(thumb_degrees=20, reach=1.0),
                       folded=lambda _: make_hand(thumb_degrees=22, reach=0.99))
    assert (result.signal, result.cocked, result.folded) == (
        DEFAULT.signal, DEFAULT.cocked, DEFAULT.folded)


def test_an_abandoned_session_still_yields_a_usable_calibration():
    session = CalibrationSession(PISTOL, cameras=1, grid=3, dwell=1.0)
    session.update([frame_of(make_hand())], 0.0)
    assert session.result()[0] == DEFAULT


# --- two cameras -----------------------------------------------------------

def second_view(screen):
    """A second camera watching from somewhere else: a different, skewed map."""
    x, y = hand_position_for(screen)
    return (0.30 + 0.42 * x + 0.10 * y, 0.22 + 0.06 * x + 0.55 * y)


def calibrate_pair(place_two=second_view, dwell=0.4, drop_second=False):
    """Run one walkthrough with two cameras watching it."""
    session = CalibrationSession(PISTOL, cameras=2, grid=3, dwell=dwell, settle=0.2)
    clock = 0.0
    for step in session.steps:
        target = session.step
        for _ in range(600):
            clock += 1 / 30
            if step.records == "trigger":
                hands = [frame_of(make_hand(thumb_degrees=15 if step.key == "cocked"
                                            else 72))] * 2
            else:
                spot = place_two(step.target)
                first = frame_of(make_hand(index_tip=hand_position_for(step.target)))
                second = Frame() if drop_second else frame_of(make_hand(index_tip=spot))
                hands = [first, second]
            session.update(hands, clock)
            if session.step is not target or session.is_done:
                break
    assert session.is_done
    return session.result()


def test_one_walkthrough_calibrates_every_camera():
    rig = calibrate_pair()
    assert len(rig) == 2
    for camera in rig.cameras:
        assert camera.fit_error < 0.02
        assert camera.usable
    # Each camera learned its own map, not a shared one.
    assert rig[0].mapping != rig[1].mapping


def test_each_camera_measures_its_own_shake_and_gain():
    rig = calibrate_pair()
    for camera in rig.cameras:
        assert camera.jitter >= 0.0
        assert 0.0 < camera.gain < 50.0


def test_a_camera_that_saw_nothing_is_left_out_rather_than_guessed_at():
    rig = calibrate_pair(drop_second=True)
    assert rig[0].usable
    assert not rig[1].usable, "no map of its own means no vote"


def test_a_lone_camera_that_saw_nothing_still_plays_on_the_defaults():
    session = CalibrationSession(PISTOL, cameras=1, grid=2, dwell=0.4, settle=0.1)
    session.update([Frame()], 0.0)
    assert session.result()[0].usable


def test_the_overlay_reports_which_cameras_have_the_hand():
    session = CalibrationSession(PISTOL, cameras=2, grid=2, dwell=1.0)
    progress = session.update([frame_of(make_hand()), Frame()], 0.0)
    assert progress.seen == (True, False)
    assert progress.tracking, "one camera is enough to keep going"


def test_a_rig_is_trimmed_or_padded_to_the_cameras_actually_plugged_in():
    rig = calibrate_pair()
    assert len(rig.resized(1)) == 1
    assert len(rig.resized(3)) == 3
    assert rig.resized(3)[2] == Calibration(), "the new one starts on defaults"


def test_the_reach_steps_measure_how_each_camera_slides_with_depth():
    """Stretching the arm moves the hand in each camera's view differently.

    That difference is the whole reason a second camera earns its place: it is
    what lets the game tell distance from displacement later on.
    """
    session = CalibrationSession(PISTOL, cameras=2, grid=3, dwell=0.4, settle=0.2)
    # How each camera sees the hand when the arm is drawn in versus stretched out.
    drift = {"reach_near": (-0.03, 0.01), "reach_far": (0.03, -0.01)}
    clock = 0.0
    for step in session.steps:
        target = session.step
        for _ in range(600):
            clock += 1 / 30
            if step.records == "trigger":
                hands = [frame_of(make_hand(thumb_degrees=15 if step.key == "cocked"
                                            else 72))] * 2
            else:
                shift = drift.get(step.key, (0.0, 0.0))
                first = hand_position_for(step.target)
                second = second_view(step.target)
                hands = [
                    frame_of(make_hand(index_tip=(first[0] + shift[0],
                                                  first[1] + shift[1]))),
                    frame_of(make_hand(index_tip=(second[0] - shift[0] * 1.8,
                                                  second[1] + shift[1]))),
                ]
            session.update(hands, clock)
            if session.step is not target or session.is_done:
                break
    rig = session.result()

    slides = [camera.slide for camera in rig.cameras]
    assert all(any(abs(value) > 1e-3 for value in slide) for slide in slides)
    # Different viewpoints slide different ways: that is what makes them useful.
    baseline = ((slides[0][0] - slides[1][0]) ** 2
                + (slides[0][1] - slides[1][1]) ** 2) ** 0.5
    assert baseline > 0.01


def test_without_the_reach_steps_a_camera_reports_no_slide():
    session = CalibrationSession(PISTOL, cameras=1, grid=2, dwell=0.4)
    session.update([frame_of(make_hand())], 0.0)
    assert session.result()[0].slide == (0.0, 0.0)


def test_a_calibration_that_cannot_be_written_does_not_lose_the_session(tmp_path,
                                                                       capsys):
    """RigBook.load forgives an unreadable file; save used to throw.

    It is called immediately after a successful setup, so an unwritable path
    turned the one moment the player has just got right into a traceback.
    """
    from handy.calibration import Rig, RigBook

    blocked = tmp_path / "a-file"
    blocked.write_text("not a directory")

    book = RigBook()
    book.set("pistol", Rig((Calibration(),)))
    assert book.save(blocked / "calibration.json") is False
    assert "Could not save the calibration" in capsys.readouterr().out
    assert book.get("pistol") is not None, "this session is still calibrated"


def test_a_calibration_that_can_be_written_says_so(tmp_path):
    from handy.calibration import Rig, RigBook

    path = tmp_path / "deep" / "calibration.json"
    book = RigBook()
    book.set("pistol", Rig((Calibration(gain=1.5),)))
    assert book.save(path) is True
    assert RigBook.load(path).get("pistol").cameras[0].gain == 1.5
