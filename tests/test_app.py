from pathlib import Path

import numpy as np
import pytest

from handy import maps
from handy.aiming import Aim
from handy.app import (Mouse, Settings, View, aim_pixels, layout_for, new_round,
                       render)
from handy.recognition import Frame

WIDTH, HEIGHT = 1280, 720


@pytest.fixture
def layout():
    return layout_for(WIDTH, HEIGHT)


def test_the_camera_is_a_small_picture_in_picture_in_the_top_left(layout):
    """Like FaceTime's: small in play, where the world matters more."""
    from handy import app

    assert layout.inset.x == layout.inset.y == layout.margin == 24
    assert layout.inset.height == app.PIP_HEIGHT
    assert layout.inset.width / layout.inset.height == pytest.approx(16 / 9, abs=0.02)
    assert layout.inset.width < WIDTH // 6


def test_play_area_sits_below_the_inset_and_inside_the_window(layout):
    assert layout.play_area.y >= layout.inset.bottom
    assert layout.play_area.right <= WIDTH and layout.play_area.bottom <= HEIGHT
    assert layout.play_area.width > 0 and layout.play_area.height > 0


def test_one_pause_control_sits_in_the_top_right_corner(layout):
    """Chrome lives in the corners: score top-left, clock top-centre, Pause
    top-right - one control, big enough to shoot."""
    from handy import scene

    rect = layout.pause_button.rect
    assert rect.right == WIDTH - layout.margin and rect.y == layout.margin
    assert rect.width == rect.height >= scene.SHOOTABLE
    assert rect.bottom < layout.play_area.y
    assert layout.pause_button.icon == "pause"


def test_quit_button_is_in_the_top_right_and_clear_of_the_inset(layout):
    button = layout.quit_button
    assert button.rect.right <= WIDTH and button.rect.x > WIDTH // 2
    assert button.rect.bottom < layout.play_area.y
    assert button.contains(button.rect.x + 5, button.rect.y + 5)
    assert not button.contains(layout.inset.x, layout.inset.y)


def test_aim_spans_the_whole_window_so_the_quit_button_is_shootable(layout):
    assert aim_pixels(Aim(position=(0.0, 0.0)), layout) == (0, 0)
    assert aim_pixels(Aim(position=(1.0, 1.0)), layout) == (WIDTH - 1, HEIGHT - 1)

    corner = aim_pixels(Aim(position=(1.0, 0.0)), layout)
    # The top-right corner of the window is inside no button, but sweeping in
    # from it reaches Pause (and on the chooser, Quit), so the crosshair can
    # get there.
    for button in (layout.pause_button, layout.quit_button):
        assert corner[0] > button.rect.x
        assert button.contains(corner[0] - layout.margin - 10, button.rect.y + 20)


def test_no_hand_means_no_crosshair(layout):
    assert aim_pixels(Aim(), layout) is None


def test_mouse_click_is_consumed_once():
    mouse = Mouse()
    import cv2

    mouse.on_event(cv2.EVENT_MOUSEMOVE, 10, 20, 0, None)
    assert (mouse.x, mouse.y) == (10, 20)
    assert not mouse.take_click()

    mouse.on_event(cv2.EVENT_LBUTTONDOWN, 30, 40, 0, None)
    assert mouse.take_click()
    assert not mouse.take_click()


@pytest.mark.parametrize("chosen", maps.MAPS, ids=lambda m: m.key)
def test_render_draws_the_camera_into_the_inset(layout, chosen):
    settings = Settings(seed=1)
    round_ = new_round(settings, layout, chosen)
    round_.update(0.0)

    camera = np.full((720, 1280, 3), (17, 200, 91), np.uint8)  # a flat, obvious colour
    canvas = np.zeros((HEIGHT, WIDTH, 3), np.uint8)
    view = View(map=chosen, round=round_, aim=Aim(position=(0.5, 0.5), armed=True),
                crosshair=(640, 360), cameras=[camera], hands=[Frame()], now=0.2,
                fps=30.0, debug=True, remaining=42.0)

    render(canvas, view, layout)

    inset = canvas[layout.inset.y:layout.inset.bottom, layout.inset.x:layout.inset.right]
    assert np.array_equal(inset[inset.shape[0] // 2, inset.shape[1] // 2], (17, 200, 91))
    assert canvas.any()


@pytest.mark.parametrize("chosen", maps.MAPS, ids=lambda m: m.key)
def test_render_survives_a_frame_with_nothing_tracked(layout, chosen):
    settings = Settings(seed=1)
    canvas = np.zeros((HEIGHT, WIDTH, 3), np.uint8)
    view = View(map=chosen, round=new_round(settings, layout, chosen), aim=Aim(),
                crosshair=None, cameras=[np.zeros((720, 1280, 3), np.uint8)],
                hands=[Frame()], now=0.0)

    render(canvas, view, layout)  # must not raise

    assert canvas.any()


def test_every_map_builds_a_round_inside_the_play_area(layout):
    settings = Settings(seed=1, duration=45)
    for chosen in maps.MAPS:
        round_ = new_round(settings, layout, chosen)
        assert round_.area == layout.play_area
        assert round_.duration == 45


def test_the_game_knows_what_each_camera_is_contributing():
    from handy import scene
    from handy.app import camera_states
    from handy.calibration import Calibration, Rig
    from handy.recognition import Frame, Hand

    hand = Frame(hands=(Hand(landmarks=tuple((0.5, 0.5) for _ in range(21)),
                             handedness="Right", gesture=None, score=0.0),))
    rig = Rig((Calibration(), Calibration(), Calibration(gain=500.0)))

    assert camera_states(rig, [hand, Frame(), hand]) == (
        scene.FUSED, scene.NO_HAND, scene.IGNORED)


def test_a_camera_beyond_the_calibrated_rig_is_still_described():
    from handy import scene
    from handy.app import camera_states
    from handy.calibration import Rig
    from handy.recognition import Frame

    assert camera_states(Rig(), [Frame(), Frame()]) == (scene.NO_HAND, scene.NO_HAND)


def test_the_footer_names_the_scheme_the_map_and_the_keys(layout):
    """The scope's hint belongs under the marksman, never under the plain pistol."""
    from handy import maps, schemes
    from handy.app import CONTROL_KEYS, View, render
    from handy.recognition import Frame

    from handy.marksman import MarksmanFrame

    empty = {"pistol": Frame(), "marksman": MarksmanFrame()}
    canvases = {}
    for scheme in schemes.SCHEMES:
        canvas = np.zeros((HEIGHT, WIDTH, 3), np.uint8)
        settings = Settings(seed=1)
        render(canvas, View(map=maps.ZOMBIES,
                            round=new_round(settings, layout, maps.ZOMBIES),
                            aim=Aim(position=(0.5, 0.6)), crosshair=None,
                            cameras=[np.zeros((720, 1280, 3), np.uint8)],
                            hands=[empty[scheme.key]], now=0.0, scheme=scheme),
               layout)
        canvases[scheme.key] = canvas

    assert not np.array_equal(canvases["pistol"], canvases["marksman"])
    assert CONTROL_KEYS and maps.ZOMBIES.footer, "both still have their say"


def test_the_round_hints_fit_the_window_and_end_with_the_pause_key(layout):
    from handy import app, scene

    for width in (1280, 960, 640):
        items = app.hint_items("Point at a target. Fold your thumb to fire.",
                               "Head shots drop them", width, 1.0)
        assert scene.hints_width(items, 1.0) <= width - 2 * layout.margin
    assert app.hint_items("", "", 1280, 1.0)[0] == ("P", "Pause")


def test_maps_are_looked_up_by_key():
    assert maps.by_key("zombies") is maps.ZOMBIES
    assert maps.by_key("range") is maps.RANGE
    with pytest.raises(KeyError):
        maps.by_key("moon")


# --- finding the cameras ---------------------------------------------------

def fake_live(monkeypatch, device):
    """Stand in for the search that picks the first camera showing a picture."""
    from handy import app

    calls = []

    def first_live(limit=4):
        calls.append(limit)
        return device

    monkeypatch.setattr(app, "first_live", first_live)
    return calls


def a_camera(index=1, name="MacBook Pro Camera"):
    from handy.cameras import Device

    return Device(index=index, name=name, width=1280, height=720, live=True)


def test_naming_cameras_turns_the_search_off(monkeypatch):
    from handy.app import Settings, choose_cameras

    calls = fake_live(monkeypatch, a_camera())
    assert choose_cameras(Settings(cameras=(2,)))[0] == (2,)
    assert calls == [], "no point looking when you have been told"


def test_the_camera_that_is_actually_showing_something_is_the_one_used(monkeypatch):
    """Index 0 is very often a virtual camera with nothing behind it."""
    from handy.app import Settings, choose_cameras

    fake_live(monkeypatch, a_camera(index=1))
    indices, note = choose_cameras(Settings())

    assert indices == (1,)
    assert "MacBook Pro Camera" in note


def test_finding_nothing_live_still_tries_index_zero_for_the_error_message(monkeypatch):
    from handy.app import Settings, choose_cameras

    fake_live(monkeypatch, None)
    indices, note = choose_cameras(Settings())

    assert indices == (0,)
    assert "--list-cameras" in note


def test_a_deskful_of_named_cameras_is_capped(monkeypatch):
    from handy.app import MAX_CAMERAS, Settings, choose_cameras

    fake_live(monkeypatch, a_camera())
    indices, _ = choose_cameras(Settings(cameras=tuple(range(8))))
    assert len(indices) == MAX_CAMERAS


def test_two_cameras_are_used_when_both_are_named(monkeypatch):
    from handy.app import Settings, choose_cameras

    fake_live(monkeypatch, a_camera())
    assert choose_cameras(Settings(cameras=(1, 2)))[0] == (1, 2)


def test_a_saved_rig_for_the_wrong_number_of_cameras_is_not_reused(tmp_path):
    from handy.app import Settings, rig_setup, saved_rig
    from handy.calibration import Calibration, Rig, RigBook
    from handy.schemes import MARKSMAN, PISTOL

    fitted = Calibration(aim_fitted=True)
    settings = Settings(cameras=(0, 1))
    book = RigBook()
    book.set("pistol", Rig((fitted, fitted), rig_setup(settings, (0, 1))))

    assert saved_rig(book, settings, PISTOL, (0, 1)) is not None
    assert saved_rig(book, settings, PISTOL, (0,)) is None, "was calibrated for two"
    assert saved_rig(book, settings, MARKSMAN, (0, 1)) is not None, "the scope shares it"


def launch_on_the_range(monkeypatch, model_path, path, **changes):
    """One launch straight into the range, quitting on the first round."""
    import itertools

    import cv2

    from handy import app

    headless(monkeypatch)
    keys = itertools.chain([255], itertools.repeat(ord("q")))
    monkeypatch.setattr(cv2, "waitKey", lambda *args: next(keys))
    app.run(app.Settings(cameras=(0,), map_key="range",
                         mute=True, model_path=model_path, calibration_path=path,
                         **changes))


def test_a_setup_is_reused_only_on_the_image_it_was_fitted_on(monkeypatch,
                                                                tmp_path,
                                                                model_path):
    """The saved rig was reused on a camera count alone. Launch with the image
    unmirrored and the map fitted on the mirrored one aimed every movement
    backwards, for the whole session, with nothing said."""
    from handy import app
    from handy.calibration import Calibration, Rig

    setups = []
    monkeypatch.setattr(app, "run_calibration", lambda *args, **kwargs: (
        setups.append(1) or Rig((Calibration(aim_fitted=True),))))
    path = tmp_path / "calibration.json"

    launch_on_the_range(monkeypatch, model_path, path)
    assert len(setups) == 1, "nothing saved yet: setup runs"
    launch_on_the_range(monkeypatch, model_path, path)
    assert len(setups) == 1, "the same setup reuses it"
    launch_on_the_range(monkeypatch, model_path, path, mirror=False)
    assert len(setups) == 2, "a flipped image sets up again"
    launch_on_the_range(monkeypatch, model_path, path, capture_width=640, capture_height=480)
    assert len(setups) == 3, "and so does another capture size"


def test_an_old_unverified_save_sends_the_player_to_setup(monkeypatch, tmp_path,
                                                          model_path):
    """What a real machine had on disk: a pose-calibration map with no fitted
    flag, no record of its setup, and its horizon inside the camera frame. It
    was reused on every launch, and a hand a little past the screen edge threw
    the crosshair into the opposite corner."""
    import json

    from handy import app
    from handy.calibration import Calibration, Rig

    legacy = {"mapping": [2.871934573670249, -0.061145355513888985,
                          -1.2142552975804075, -0.9041251222717106,
                          2.3601729633571686, -0.8949543501390803,
                          -1.2131671258909114, 0.4386268157484197, 1.0],
              "signal": "reach", "cocked": 2.70, "folded": 2.15,
              "fit_error": 0.023, "generalisation": 0.044, "gain": 5.42}
    path = tmp_path / "calibration.json"
    path.write_text(json.dumps({"schemes": {"pistol": {"cameras": [legacy]}}}))
    setups = []
    monkeypatch.setattr(app, "run_calibration", lambda *args, **kwargs: (
        setups.append(1) or Rig((Calibration(aim_fitted=True),))))

    launch_on_the_range(monkeypatch, model_path, path)
    assert setups, "the old map was played on without a single check"


# --- the startup path ------------------------------------------------------

class FakeCapture:
    """Stands in for a webcam: always ready, always the same blank frame."""

    def __init__(self, index: int = 0, works: bool = True) -> None:
        self.index = index
        self.works = works
        self.released = False

    def isOpened(self) -> bool:  # noqa: N802 - this is OpenCV's own spelling
        return self.works

    def set(self, *_args) -> None:
        pass

    def read(self):
        return True, np.zeros((720, 1280, 3), np.uint8)

    def release(self) -> None:
        self.released = True


def headless(monkeypatch, key: str = "q", works: bool = True) -> list[FakeCapture]:
    """Run the real loop with fake webcams and no window.

    Only ``cv2.VideoCapture`` is replaced, deliberately: everything above it -
    including how the game opens a camera - is the real code, so a signature
    that no longer matches its caller shows up here as a failure.
    """
    import cv2

    opened: list[FakeCapture] = []

    def capture_for(index):
        opened.append(FakeCapture(index, works))
        return opened[-1]

    monkeypatch.setattr(cv2, "VideoCapture", capture_for)
    for name in ("namedWindow", "setMouseCallback", "imshow", "destroyAllWindows",
                 "setWindowProperty"):
        monkeypatch.setattr(cv2, name, lambda *args, **kwargs: None)
    monkeypatch.setattr(cv2, "waitKey", lambda *args: ord(key))
    monkeypatch.setattr(cv2, "getWindowProperty", lambda *args: 1.0)
    # The game always fills the screen and measures the window it got.
    monkeypatch.setattr(cv2, "getWindowImageRect", lambda *args: (0, 0, 960, 540))
    return opened


def test_the_game_opens_the_camera_the_search_picked(monkeypatch, tmp_path,
                                                     model_path):
    """Not index 0 by reflex: the one that was found to be working."""
    from handy import app

    fake_live(monkeypatch, a_camera(index=1))
    opened = headless(monkeypatch)
    app.run(app.Settings(
        map_key="range", mute=True, skip_calibration=True, model_path=model_path,
        calibration_path=tmp_path / "calibration.json",
        window_width=960, window_height=540))

    assert [capture.index for capture in opened] == [1]


@pytest.mark.parametrize("map_key", ["range", "sniper"])
def test_either_tracker_starts_and_shuts_down(monkeypatch, tmp_path, model_path,
                                              face_model_path, map_key):
    """The sniper opens a face model beside the hand's; both must close again."""
    from handy import app

    # Both bundles are cached before the window opens, by the fixtures.
    opened = headless(monkeypatch)
    app.run(app.Settings(
        cameras=(0,), map_key=map_key, mute=True,
        skip_calibration=True, calibration_path=tmp_path / "calibration.json",
        window_width=960, window_height=540))

    assert opened and all(capture.released for capture in opened)


@pytest.mark.parametrize("cameras", [(0,), (0, 1)], ids=["one", "two"])
def test_the_game_starts_plays_a_frame_and_shuts_down(monkeypatch, tmp_path,
                                                      model_path, cameras):
    """A suite of pure units never imports the entry point. This does.

    It is the only test that would have caught a stale ``open_camera`` left
    behind, shadowing the imported one with an older signature.
    """
    from handy import app

    opened = headless(monkeypatch)
    app.run(app.Settings(
        cameras=cameras, map_key="range", mute=True, skip_calibration=True,
        model_path=model_path, calibration_path=tmp_path / "calibration.json",
        screenshot_dir=tmp_path / "shots", window_width=960, window_height=540))

    assert [capture.index for capture in opened] == list(cameras)
    assert all(capture.released for capture in opened), "all handed back"


def test_a_camera_that_will_not_open_is_reported_not_crashed(monkeypatch, tmp_path,
                                                             model_path):
    from handy import app
    from handy.cameras import CameraError

    headless(monkeypatch, works=False)

    with pytest.raises(CameraError, match="Could not open camera 3"):
        app.run(app.Settings(cameras=(3,), model_path=model_path,
                             skip_calibration=True, mute=True,
                             calibration_path=tmp_path / "calibration.json"))


def test_mirroring_cannot_be_flipped_mid_round(monkeypatch, tmp_path, model_path):
    """It used to be bound to 'm'. Every calibration is fitted against one
    handedness of the landmark stream, and flipping the image sends x to 1 - x,
    which the fitted homography then maps to the opposite side of the screen:
    the crosshair ran backwards for the rest of the round, with the footer
    advertising the key as a normal control. It is a launch-time choice now."""
    from handy import app

    assert not any("mirror" in hint for hint in app.CONTROL_KEYS)

    headless(monkeypatch, key="m")
    seen: list[bool] = []

    original = app.Eyes.read

    def read(self):
        seen.append(self.mirror)
        if len(seen) > 3:
            raise KeyboardInterrupt  # enough frames for a flip to have shown up
        return original(self)

    monkeypatch.setattr(app.Eyes, "read", read)
    with pytest.raises(KeyboardInterrupt):
        app.run(app.Settings(cameras=(0, 1), map_key="range", mute=True,
                             skip_calibration=True, model_path=model_path,
                             calibration_path=tmp_path / "calibration.json"))

    assert set(seen) == {True}, "the key no longer flips the stream under the map"


def test_the_mirror_setting_still_reaches_the_cameras(monkeypatch, tmp_path,
                                                      model_path):
    """--no-mirror has to keep working; it is now the only way to say it."""
    from handy import app

    headless(monkeypatch)
    seen: list[bool] = []

    def read(self):
        seen.append(self.mirror)
        raise KeyboardInterrupt

    monkeypatch.setattr(app.Eyes, "read", read)
    with pytest.raises(KeyboardInterrupt):
        app.run(app.Settings(cameras=(0,), map_key="range", mute=True, mirror=False,
                             skip_calibration=True, model_path=model_path,
                             calibration_path=tmp_path / "calibration.json"))
    assert seen == [False]


# --- the screens actually draw what they are for ----------------------------

class OneFrameEyes:
    """A fake Eyes: every camera hands over one blank frame per read, and its
    recogniser a new (empty) result for each."""

    def __init__(self, count: int = 1) -> None:
        self.count = count
        self.mirror = True
        self.reads = 0

    def __len__(self) -> int:
        return self.count

    def read(self):
        from handy.recognition import Frame

        self.reads += 1
        blank = np.zeros((720, 1280, 3), np.uint8)
        return [blank] * self.count, [Frame(timestamp_ms=self.reads)] * self.count


def test_the_map_chooser_draws_the_cards(monkeypatch, layout):
    """The one regression that already happened: buttons painted, cards forgotten."""
    import cv2

    from handy import app, scene, schemes
    from handy.calibration import default_rig
    from handy.highscores import HighScores

    drawn = []
    real = scene.draw_map_select
    monkeypatch.setattr(scene, "draw_map_select",
                        lambda *args, **kwargs: (drawn.append(args), real(*args)))
    monkeypatch.setattr(cv2, "imshow", lambda *args: None)
    monkeypatch.setattr(cv2, "setMouseCallback", lambda *args: None)
    monkeypatch.setattr(cv2, "waitKey", lambda *args: ord("q"))
    monkeypatch.setattr(cv2, "getWindowProperty", lambda *args: 1.0)

    canvas = np.zeros((HEIGHT, WIDTH, 3), np.uint8)
    reason, picked = app.choose_map(
        OneFrameEyes(), canvas, Settings(), layout,
        app.make_controller(Settings(), schemes.PISTOL),
        default_rig(schemes.PISTOL, 1), schemes.PISTOL,
        HighScores.load(__import__("pathlib").Path("nowhere/scores.json")))

    assert reason == "quit" and picked is None
    assert drawn, "the cards were never drawn"
    _, cards, entries, *_rest = drawn[0]
    assert len(cards) == len(entries) == len(maps.MAPS)


def test_the_chooser_reads_each_maps_best_from_the_bucket_it_is_written_to(
        monkeypatch, tmp_path, layout):
    """The four public game cards show the best for the selected duration."""
    import cv2

    from handy import app, scene, schemes
    from handy.calibration import default_rig
    from handy.highscores import HighScores

    scores = HighScores.load(tmp_path / "scores.json")
    scores.record(maps.ZOMBIES.key, 60.0, 120)
    scores.record(maps.SNIPER.key, 60.0, 340)
    assert set(scores.best) == {"zombies:60s", "sniper:60s"}

    drawn = []
    monkeypatch.setattr(scene, "draw_map_select",
                        lambda canvas, cards, entries, *rest: drawn.append(entries))
    for name in ("imshow", "setMouseCallback"):
        monkeypatch.setattr(cv2, name, lambda *args: None)
    monkeypatch.setattr(cv2, "waitKey", lambda *args: ord("q"))
    monkeypatch.setattr(cv2, "getWindowProperty", lambda *args: 1.0)

    app.choose_map(OneFrameEyes(), np.zeros((HEIGHT, WIDTH, 3), np.uint8),
                   Settings(duration=60.0), layout,
                   app.make_controller(Settings(), schemes.PISTOL),
                   default_rig(schemes.PISTOL, 1), schemes.PISTOL, scores)

    best = {title: line for title, _blurb, line, _art in drawn[0]}
    assert best[maps.ZOMBIES.title] == "Best 120"
    assert best[maps.SNIPER.title] == "Best 340"
    assert best[maps.WESTERN.title] == "Not played yet"


def test_the_card_under_the_crosshair_rises_over_a_quarter_second():
    from handy import app

    lifts = [0.0, 0.0, 1.0]
    lifts = app.ease_lifts(lifts, 0, app.CARD_LIFT / 2)
    assert lifts == [0.5, 0.0, 0.5], "one rising, the one it left settling"
    lifts = app.ease_lifts(lifts, 0, app.CARD_LIFT)
    assert lifts == [1.0, 0.0, 0.0]
    assert app.best_line(1240) == "Best 1,240"


def centre_of(button) -> tuple[float, float]:
    """``button``'s middle, as the fraction of the window an aim gives."""
    rect = button.rect
    return ((rect.x + rect.width // 2) / (WIDTH - 1),
            (rect.y + rect.height // 2) / (HEIGHT - 1))


@pytest.mark.parametrize("choice,expected", [
    (1, "again"), (2, "maps"), (3, "quit"),
])
def test_every_choice_on_the_pause_sheet_answers_a_shot(monkeypatch, choice, expected):
    """Shooting Pause brings the sheet up; each of its choices means something
    when shot - after the trigger has come up again, as every shot needs."""
    from handy import app, maps, schemes, scene
    from handy.aiming import Aim
    from handy.calibration import default_rig
    import cv2

    monkeypatch.setattr(cv2, "imshow", lambda *args: None)
    monkeypatch.setattr(cv2, "setMouseCallback", lambda *args: None)
    monkeypatch.setattr(cv2, "waitKey", lambda *args: 255)
    monkeypatch.setattr(cv2, "getWindowProperty", lambda *args: 1.0)

    layout = layout_for(WIDTH, HEIGHT)
    _, buttons = scene.pause_sheet(WIDTH, HEIGHT, layout.scale)
    script = iter([Aim(position=centre_of(layout.pause_button), fired=True),
                   Aim(position=centre_of(buttons[choice]), armed=True),
                   Aim(position=centre_of(buttons[choice]), fired=True)])
    monkeypatch.setattr(app.AimController, "update",
                        lambda self, views, now: next(script, Aim()))

    _, reason = app.play(
        OneFrameEyes(), np.zeros((HEIGHT, WIDTH, 3), np.uint8),
        Settings(recoil=0.0), layout,
        app.make_controller(Settings(), schemes.PISTOL),
        default_rig(schemes.PISTOL, 1), SpySounds(), maps.RANGE,
        schemes.PISTOL)
    assert reason == expected, f"shooting {buttons[choice].label} should mean {expected}"


# --- choosing how to aim, at launch -----------------------------------------

def test_the_cli_defaults_to_hand_controls():
    from handy import schemes
    from handy.cli import parse_args

    assert schemes.keys() == ("pistol",)
    assert parse_args(["--control", "pistol"]) == parse_args([])


# --- filling the screen -----------------------------------------------------

def stub_window(monkeypatch, rects, frames=None):
    """Silence the real window and script what it reports its size to be.

    `rects` scripts cv2.getWindowImageRect; `frames` scripts what AppKit says
    the screen's visible frame is (None: "not on a Mac", so cv2 is asked).
    """
    import cv2

    from handy import app, display

    frames = list(frames or [None])
    visible = iter(frames)
    monkeypatch.setattr(display, "visible_frame",
                        lambda: next(visible, frames[-1]))
    calls = []
    monkeypatch.setattr(cv2, "namedWindow", lambda *args: calls.append(("named", args)))
    monkeypatch.setattr(cv2, "setWindowProperty",
                        lambda *args: calls.append(("prop", args)))
    monkeypatch.setattr(cv2, "imshow", lambda *args: None)
    monkeypatch.setattr(cv2, "waitKey", lambda *args: 255)
    sizes = iter(rects)
    monkeypatch.setattr(cv2, "getWindowImageRect",
                        lambda *args: next(sizes, rects[-1]))
    return app, calls


def test_the_window_is_drawn_at_the_size_it_actually_became(monkeypatch):
    """A grey band means the frame was smaller than the window. Measure, then draw."""
    # The window grows over the first frames, then settles.
    app, calls = stub_window(monkeypatch, [(0, 0, 1280, 720), (0, 0, 1512, 982),
                                           (0, 0, 1512, 982)])

    assert app.open_window(app.Settings()) == (1512, 982)
    assert any(kind == "prop" for kind, _ in calls), "the window was sent fullscreen"


def test_the_window_never_letterboxes(monkeypatch):
    """Whatever is drawn is stretched to the window: FREERATIO, not KEEPRATIO."""
    import cv2

    app, calls = stub_window(monkeypatch, [(0, 0, 1512, 945)])
    app.open_window(app.Settings())
    named = [args for kind, args in calls if kind == "named"]
    assert named and named[0][1] & cv2.WINDOW_FREERATIO


def test_the_notch_is_respected_not_the_panel(monkeypatch):
    """A notched MacBook reports a 982-tall panel but gives fullscreen 945."""
    from handy import display

    monkeypatch.setattr(display, "screen_size", lambda: (1512, 982))
    app, _ = stub_window(monkeypatch, [(0, 0, 1512, 982)] * 3 + [(0, 0, 1512, 945)])
    assert app.open_window(app.Settings()) == (1512, 945), "the late reading wins"


def test_the_screen_is_believed_over_opencv_on_a_mac(monkeypatch):
    """Cocoa's getWindowImageRect echoes the image shown, so it cannot see a band.

    Measured on a notched MacBook: the window asked for 1512x982 is clipped to
    the 1512x949 visible frame, the picture is aspect-fit to 1461x949, and
    getWindowImageRect still says 1512x982. AppKit's visible frame is the truth.
    """
    from handy import display

    monkeypatch.setattr(display, "screen_size", lambda: (1512, 982))
    app, _ = stub_window(monkeypatch, [(0, 0, 1512, 982)], frames=[(1512, 949)])
    assert app.open_window(app.Settings()) == (1512, 949)
    assert app.measure_window() == (1512, 949)


def test_the_surface_is_rebuilt_when_the_window_changes(monkeypatch):
    import cv2

    from handy import app

    from handy import display

    layout = layout_for(1280, 720)
    canvas = np.zeros((720, 1280, 3), np.uint8)
    monkeypatch.setattr(display, "visible_frame", lambda: None)
    monkeypatch.setattr(cv2, "getWindowImageRect", lambda *args: (0, 0, 1512, 945))
    new_layout, new_canvas = app.refit(layout, canvas)
    assert (new_layout.window.width, new_layout.window.height) == (1512, 945)
    assert new_canvas.shape[:2] == (945, 1512)

    monkeypatch.setattr(cv2, "getWindowImageRect", lambda *args: (0, 0, 1512, 945))
    same_layout, same_canvas = app.refit(new_layout, new_canvas)
    assert same_layout is new_layout and same_canvas is new_canvas


def test_a_window_that_cannot_be_measured_falls_back_to_the_screen(monkeypatch):
    from handy import display

    app, _ = stub_window(monkeypatch, [(0, 0, 0, 0)])
    monkeypatch.setattr(display, "screen_size", lambda: (1728, 1117))

    assert app.open_window(app.Settings()) == (1728, 1117)


def test_a_configured_size_seeds_the_window_when_nothing_can_be_measured(monkeypatch):
    app, _ = stub_window(monkeypatch, [(0, 0, 0, 0)])
    assert app.open_window(app.Settings(window_width=960,
                                        window_height=540)) == (960, 540)


def test_the_interface_grows_with_the_screen():
    """Fixed pixel sizes on a big panel give tiny buttons and unreadable text."""
    small = layout_for(1280, 720)
    large = layout_for(3024, 1964)

    assert small.scale == 1.0 and large.scale > 1.5
    assert large.quit_button.rect.width > small.quit_button.rect.width * 1.5
    assert large.quit_button.rect.height > small.quit_button.rect.height * 1.5
    for layout, width in ((small, 1280), (large, 3024)):
        assert layout.pause_button.rect.x > layout.inset.right, "no overlap"
        assert layout.quit_button.rect.right <= width


def test_the_buttons_never_overlap_each_other_at_any_size():
    from handy import scene

    for width, height in ((1280, 720), (1440, 900), (1512, 982), (1920, 1080),
                          (2560, 1440), (3024, 1964)):
        layout = layout_for(width, height)
        clock = scene.clock_pill(width, 48.0, layout.scale, layout.margin)
        for button in (layout.pause_button, layout.quit_button):
            assert clock.right < button.rect.x, f"{width}x{height}"
            assert button.rect.right <= width and button.rect.x > layout.inset.right
            assert button.rect.height >= scene.SHOOTABLE * layout.scale - 1
        assert layout.play_area.bottom <= height


def test_a_rejected_fit_is_announced_on_screen(monkeypatch, tmp_path, model_path):
    """The terminal is not where the player is looking."""
    import itertools

    import cv2

    from handy import app
    from handy.calibration import Calibration, Rig

    notices = []
    monkeypatch.setattr(app, "show_notice",
                        lambda canvas, lines, seconds=3.0, scale=1.0:
                        notices.append(lines))
    # Setup "runs" and comes back with a camera on the defaults.
    monkeypatch.setattr(app, "run_calibration",
                        lambda *args, **kwargs: Rig((Calibration(),)))
    headless(monkeypatch)
    keys = itertools.chain([255], itertools.repeat(ord("q")))
    monkeypatch.setattr(cv2, "waitKey", lambda *args: next(keys))

    app.run(app.Settings(cameras=(0,), map_key="range", mute=True,
                         model_path=model_path, calibrate=True,
                         calibration_path=tmp_path / "calibration.json"))

    assert notices, "the player was never told"
    joined = " ".join(notices[0])
    assert "DID NOT FULLY SUCCEED" in joined
    assert "AIM" in joined and "TRIGGER" not in joined


def test_custom_hand_model_can_be_used_with_the_automatic_eye_scope(monkeypatch):
    from handy import app, schemes

    fetched = []
    monkeypatch.setattr(app, "ensure_model", lambda name: fetched.append(name) or Path("/tmp/face.task"))
    settings = Settings(model_path=Path("/tmp/hand.task"))
    assert app.model_bundles(settings, schemes.PISTOL) == [Path("/tmp/hand.task")]
    assert app.model_bundles(settings, schemes.MARKSMAN) == [Path("/tmp/hand.task"), Path("/tmp/face.task")]
    assert fetched == ["face_landmarker"]


def test_without_an_override_every_bundle_a_scheme_names_is_fetched(monkeypatch):
    from pathlib import Path

    from handy import app, schemes

    monkeypatch.setattr(app, "ensure_model", lambda name: Path(f"/models/{name}"))
    assert app.model_bundles(Settings(), schemes.MARKSMAN) == [
        Path("/models/gesture_recognizer"), Path("/models/face_landmarker")]


def test_a_recalibration_that_fell_back_on_the_old_map_is_announced(monkeypatch,
                                                                    tmp_path,
                                                                    model_path):
    """The check used to read the error figures, which on failure are inherited
    from the fallback - the previous, successful calibration. So a failed
    recalibration reported no trouble at all, printed the old accuracy as if it
    had just been measured, and handed the player back the identical map."""
    import itertools

    import cv2

    from handy import app
    from handy.calibration import Calibration, Rig

    notices = []
    monkeypatch.setattr(app, "show_notice",
                        lambda canvas, lines, seconds=3.0, scale=1.0:
                        notices.append(lines))
    # What a fallback to a previously good rig looks like: real figures, but
    # nothing was fitted this time round.
    stale = Calibration(fit_error=0.011, generalisation=0.028, aim_fitted=False)
    monkeypatch.setattr(app, "run_calibration",
                        lambda *args, **kwargs: Rig((stale,)))
    headless(monkeypatch)
    keys = itertools.chain([255], itertools.repeat(ord("q")))
    monkeypatch.setattr(cv2, "waitKey", lambda *args: next(keys))

    app.run(app.Settings(cameras=(0,), map_key="range", mute=True,
                         model_path=model_path, calibrate=True,
                         calibration_path=tmp_path / "calibration.json"))

    assert notices, "the player was never told"
    assert "AIM: could not fit camera 1" in notices[0]
    assert "DEFAULTS" in app.describe(Rig((stale,))), "and the terminal agrees"


def test_backing_out_of_setup_says_the_game_is_on_defaults(monkeypatch, tmp_path,
                                                           model_path):
    """Esc and 'q' both skip setup, and 'q' quits on every other screen - so
    this is as often a reflex as a decision. It used to leave the player aiming
    on the built-in defaults with nothing on screen to say so, and no hint that
    'c' brings setup back."""
    import itertools

    import cv2

    from handy import app

    notices = []
    monkeypatch.setattr(app, "show_notice",
                        lambda canvas, lines, seconds=3.0, scale=1.0:
                        notices.append(lines))
    monkeypatch.setattr(app, "run_calibration", lambda *args, **kwargs: None)
    headless(monkeypatch)
    keys = itertools.chain([255], itertools.repeat(ord("q")))
    monkeypatch.setattr(cv2, "waitKey", lambda *args: next(keys))

    app.run(app.Settings(cameras=(0,), map_key="range", mute=True,
                         model_path=model_path, calibrate=True,
                         calibration_path=tmp_path / "calibration.json"))

    assert notices, "backing out was silent"
    joined = " ".join(notices[0])
    assert "SKIPPED" in joined and "defaults" in joined and "c" in joined


def test_the_results_screen_sits_on_the_art_of_the_map_just_played(monkeypatch,
                                                                   tmp_path,
                                                                   model_path):
    """The whole ambient-backdrop feature was unreachable: nothing in handy/
    ever called set_ambient_art, so every results card was drawn on the neutral
    grid its own docstring says it was written to get away from."""
    from handy import app, maps, scene

    headless(monkeypatch)
    seen = []

    def read(self):
        seen.append(scene._ambient_art)
        raise KeyboardInterrupt

    monkeypatch.setattr(app.Eyes, "read", read)
    monkeypatch.setattr(scene, "_ambient_art", None, raising=False)
    with pytest.raises(KeyboardInterrupt):
        app.run(app.Settings(cameras=(0,), map_key="zombies",
                             mute=True, skip_calibration=True,
                             model_path=model_path,
                             calibration_path=tmp_path / "calibration.json"))

    assert seen == [maps.ZOMBIES.draw_emblem], "the map in play is behind the menus"
    assert scene._ambient_art is None, "and the session put it back on the way out"


def test_the_window_is_measured_from_its_own_content_view_first(monkeypatch):
    """The screen's visible frame can be a point off the window; a point is a
    sliver of band. The content view the picture is drawn into is the truth."""
    from handy import app, display

    monkeypatch.setattr(display, "window_content_size", lambda title: (1512, 949))
    monkeypatch.setattr(display, "visible_frame", lambda: (1512, 950))
    assert app.measure_window() == (1512, 949)

    monkeypatch.setattr(display, "window_content_size", lambda title: None)
    assert app.measure_window() == (1512, 950), "then the screen, then OpenCV"


def test_the_menu_bar_is_hidden_while_the_game_runs_and_restored_after(monkeypatch):

    from handy import app, display

    calls = []
    monkeypatch.setattr(display, "hide_system_chrome", lambda: calls.append("hide") or True)
    monkeypatch.setattr(display, "restore_system_chrome", lambda: calls.append("restore"))
    stub_window(monkeypatch, [(0, 0, 1512, 949)])
    monkeypatch.setattr(display, "window_content_size", lambda title: (1512, 949))
    app.open_window(app.Settings())
    assert calls == ["hide"], "hidden before the window is measured"


def test_the_maps_are_pre_built_so_the_first_frame_does_not_freeze():
    """The richest backdrop takes seconds to build; the player must never wait."""
    import time

    from handy import app, maps

    layout = layout_for(960, 540)
    settings = Settings(seed=1, window_width=960, window_height=540)
    app.warm_maps(layout, settings)

    canvas = np.zeros((540, 960, 3), np.uint8)
    for chosen in maps.MAPS:
        round_ = app.new_round(settings, layout, chosen)
        round_.update(0.0)
        started = time.perf_counter()
        chosen.draw_world(canvas, round_, 0.5)
        assert time.perf_counter() - started < 0.05, f"{chosen.key} first frame is slow"


def test_every_hour_of_high_noon_is_pre_built_not_just_the_first():
    """The street is a new picture each hour of the round; building one as
    the hour turns was a 75 ms stutter every ten seconds."""
    from handy import app, maps
    from handy.maps import western

    layout = layout_for(960, 540)
    settings = Settings(seed=3, window_width=960, window_height=540)
    app.warm_maps(layout, settings)

    round_ = app.new_round(settings, layout, maps.WESTERN)
    round_.update(0.0)
    canvas = np.zeros((540, 960, 3), np.uint8)
    built = western._backdrop.cache_info().misses
    for hour in range(western.HOURS):
        maps.WESTERN.draw_world(canvas, round_, settings.duration * (hour + 0.5) / western.HOURS)
    assert western._backdrop.cache_info().misses == built


@pytest.mark.real_warm_up
def test_the_game_warms_the_maps_up_off_the_main_thread(monkeypatch, tmp_path,
                                                         model_path):
    """The suite skips the warm-up everywhere else, so it is checked here."""
    import threading

    from handy import app

    warmed: list[tuple[str, tuple[int, int]]] = []
    done = threading.Event()

    def warm_maps(layout, settings):
        warmed.append((threading.current_thread().name,
                       (layout.window.width, layout.window.height)))
        done.set()

    monkeypatch.setattr(app, "warm_maps", warm_maps)
    headless(monkeypatch)
    monkeypatch.setattr(app, "open_window", lambda settings: (960, 540))
    app.run(app.Settings(cameras=(0,), map_key="range", mute=True,
                         skip_calibration=True, model_path=model_path,
                         calibration_path=tmp_path / "calibration.json"))

    assert done.wait(10), "the maps were never warmed"
    assert warmed == [("warm-maps", (960, 540))]


def test_the_suite_never_touches_the_players_own_calibration_or_scores():
    """A test that forgot its tmp_path used to write into ~/.cache/handy."""
    import os
    import pwd

    from handy import app

    real_home = Path(pwd.getpwuid(os.getuid()).pw_dir)
    for path in (app.calibration_path(Settings()), app.scores_path(Settings())):
        assert not path.is_relative_to(real_home), path


def test_a_shooting_map_still_calibrates_before_play(monkeypatch, tmp_path,
                                                     model_path):
    from handy import app
    from handy.calibration import default_rig
    from handy.schemes import PISTOL

    headless(monkeypatch)
    order = []
    monkeypatch.setattr(app, "run_calibration",
                        lambda *args, **kwargs: order.append("setup")
                        or default_rig(PISTOL, 1))
    real_play = app.play

    def spying_play(*args, **kwargs):
        order.append("play")
        return real_play(*args, **kwargs)

    monkeypatch.setattr(app, "play", spying_play)
    app.run(app.Settings(cameras=(0,), map_key="range",
                         mute=True, calibrate=True, model_path=model_path,
                         calibration_path=tmp_path / "calibration.json",
                         window_width=960, window_height=540))
    assert order[:2] == ["setup", "play"], "aiming still earns its setup first"


# --- the half of the loop that only runs after a round finishes -------------

def key_sequence(monkeypatch, keys):
    """Feed ``cv2.waitKey`` a script, holding the last key for ever after."""
    import cv2

    script = list(keys)
    remaining = iter(script)

    def press(*_args):
        nonlocal last
        try:
            last = next(remaining)
        except StopIteration:
            pass
        return last

    last = script[0] if script else 255
    monkeypatch.setattr(cv2, "waitKey", press)


NOTHING = 255  # what waitKey returns when no key was pressed


def test_a_finished_round_scores_sounds_and_shows_the_results(monkeypatch, tmp_path,
                                                              model_path):
    """The whole tail of `_session` was dead: every test quit before the clock
    ran out, so `last.summary()`, `sounds.round_over()`, the high score written
    from a real round and the results screen itself never executed.

    A round of 0.05 s ends on its own, which is the only way into any of it.
    """
    from handy import app, scene
    from handy.audio import Sounds
    from handy.highscores import HighScores

    headless(monkeypatch)
    drawn: list[tuple] = []
    monkeypatch.setattr(scene, "draw_results",
                        lambda canvas, summary, best, is_best, **kwargs:
                        drawn.append((summary, best, is_best)))
    over: list[int] = []
    monkeypatch.setattr(Sounds, "round_over", lambda self: over.append(1))
    # Play the round out (no key), then quit off the results screen.
    key_sequence(monkeypatch, [NOTHING] * 400 + [ord("q")])

    scores_file = tmp_path / "calibration.json"
    app.run(app.Settings(cameras=(0,), map_key="range",
                         duration=0.05, mute=True, skip_calibration=True,
                         recoil=0.0, model_path=model_path,
                         calibration_path=scores_file))

    assert drawn, "the results screen never drew"
    summary, best, is_best = drawn[0]
    assert summary.duration == 0.05 and summary.score >= 0
    assert over == [1], "the round-over sound belongs to the end of a round"
    assert best == 0 and is_best is False, "an unshot round is nobody's record"
    saved = HighScores.load(app.scores_path(app.Settings(
        calibration_path=scores_file)))
    assert saved.best == {}, "zero is not a high score"


def test_a_real_score_from_a_real_round_reaches_the_score_file(monkeypatch,
                                                               tmp_path,
                                                               model_path):
    """`scores.record` is called from the app exactly once, right here."""
    from handy import app, maps, scene
    from handy.game import Round

    headless(monkeypatch)
    drawn: list[tuple] = []
    monkeypatch.setattr(scene, "draw_results",
                        lambda canvas, summary, best, is_best, **kwargs:
                        drawn.append((summary, best, is_best)))
    # A round that ends with points on the board, however it was played.
    monkeypatch.setattr(Round, "score", 250)
    key_sequence(monkeypatch, [NOTHING] * 400 + [ord("q")])

    settings = app.Settings(cameras=(0,), map_key="range",
                            duration=0.05, mute=True, skip_calibration=True,
                            recoil=0.0, model_path=model_path,
                            calibration_path=tmp_path / "calibration.json")
    app.run(settings)

    assert drawn and drawn[0][2] is True, "250 points is a first record"
    from handy.highscores import HighScores
    saved = HighScores.load(app.scores_path(settings))
    assert saved.best_for(maps.RANGE.key, 0.05) == 250


@pytest.mark.parametrize("key,expected", [
    (ord("q"), "quit"), (ord("b"), "maps"),
    (ord("r"), "again"), (ord(" "), "again"), (ord("c"), "recalibrate"),
])
def test_every_key_on_the_results_screen_means_something(monkeypatch, key, expected):
    """All five exits from `show_results`, none of which had ever run."""
    from handy import app, scene, schemes
    from handy.calibration import default_rig
    from handy.game import Summary

    import cv2
    monkeypatch.setattr(cv2, "imshow", lambda *args: None)
    monkeypatch.setattr(cv2, "setMouseCallback", lambda *args: None)
    monkeypatch.setattr(cv2, "getWindowProperty", lambda *args: 1.0)
    monkeypatch.setattr(scene, "draw_results", lambda *args, **kwargs: None)
    key_sequence(monkeypatch, [key])

    layout = layout_for(WIDTH, HEIGHT)
    summary = Summary(score=10, shots=2, hits=1, accuracy=0.5, best_streak=1,
                      perfect=0, duration=60.0)
    choice = app.show_results(
        OneFrameEyes(), np.zeros((HEIGHT, WIDTH, 3), np.uint8), Settings(),
        layout, app.make_controller(Settings(), schemes.PISTOL),
        default_rig(schemes.PISTOL, 1), summary, best=5, is_best=True)

    assert choice == expected


def test_the_results_screen_saves_a_screenshot_on_s(monkeypatch, tmp_path):
    from handy import app, scene, schemes
    from handy.calibration import default_rig
    from handy.game import Summary

    import cv2
    monkeypatch.setattr(cv2, "imshow", lambda *args: None)
    monkeypatch.setattr(cv2, "setMouseCallback", lambda *args: None)
    monkeypatch.setattr(cv2, "getWindowProperty", lambda *args: 1.0)
    monkeypatch.setattr(scene, "draw_results", lambda *args, **kwargs: None)
    key_sequence(monkeypatch, [ord("s"), ord("q")])

    layout = layout_for(WIDTH, HEIGHT)
    summary = Summary(score=10, shots=2, hits=1, accuracy=0.5, best_streak=1,
                      perfect=0, duration=60.0)
    app.show_results(OneFrameEyes(), np.zeros((HEIGHT, WIDTH, 3), np.uint8),
                     Settings(screenshot_dir=tmp_path), layout,
                     app.make_controller(Settings(), schemes.PISTOL),
                     default_rig(schemes.PISTOL, 1), summary, 5, True)

    saved = list(tmp_path.glob("*.png"))
    assert saved, "s saved nothing"
    import cv2
    image = cv2.imread(str(saved[0]))
    assert image.shape[0] < HEIGHT and image.shape[1] < WIDTH, (
        "the card as it is shared, not the whole screen with its crosshair")


#: Eight seconds of the card with nothing pressed, then q: a card that never
#: answers ends its test instead of hanging it.
EIGHT_SECONDS_THEN_QUIT = (NOTHING,) * 240 + (113,)


def on_the_card(monkeypatch, trigger, keys=EIGHT_SECONDS_THEN_QUIT):
    """Run the real score card at thirty frames a second of a synthetic clock.

    ``trigger(t)`` is the aim ``t`` seconds after the card appeared. Returns
    the card's answer and how long it had been up when it gave it.
    """
    from handy import app, scene, schemes
    from handy.calibration import default_rig
    from handy.game import Summary

    import cv2
    monkeypatch.setattr(cv2, "imshow", lambda *args: None)
    monkeypatch.setattr(cv2, "setMouseCallback", lambda *args: None)
    monkeypatch.setattr(cv2, "getWindowProperty", lambda *args: 1.0)
    monkeypatch.setattr(scene, "draw_results", lambda *args, **kwargs: None)
    key_sequence(monkeypatch, list(keys))
    clock = {"now": 1000.0}

    def monotonic():
        clock["now"] += 1 / 30
        return clock["now"]

    monkeypatch.setattr(app.time, "monotonic", monotonic)
    start = clock["now"]
    monkeypatch.setattr(app.AimController, "update",
                        lambda self, views, now: trigger(now - start))
    summary = Summary(score=10, shots=2, hits=1, accuracy=0.5, best_streak=1,
                      perfect=0, duration=60.0)

    choice = app.show_results(
        OneFrameEyes(), np.zeros((HEIGHT, WIDTH, 3), np.uint8), Settings(),
        layout_for(WIDTH, HEIGHT), app.make_controller(Settings(), schemes.PISTOL),
        default_rig(schemes.PISTOL, 1), summary, 5, True)
    return choice, clock["now"] - start


def pull_at(position, fire_at: float):
    """A player holding the gun cocked on ``position``, pulling at ``fire_at``."""
    from handy.aiming import Aim

    def trigger(t):
        if t < fire_at:
            return Aim(position=position, armed=True)
        if t < fire_at + 1 / 30:
            return Aim(position=position, fired=True)
        return Aim(position=position)
    return trigger


def card_choice(index: int) -> tuple[float, float]:
    """The middle of one of the score card's choices, as an aim reads it (the
    card these tests show carries no map, so no banner)."""
    from handy import scene

    return centre_of(scene.results_buttons(WIDTH, HEIGHT, 1.0, banner=False)[index])


@pytest.mark.parametrize("index,expected", [(0, "again"), (1, "maps")])
def test_every_choice_on_the_card_answers_a_shot(monkeypatch, index, expected):
    assert on_the_card(monkeypatch, pull_at(card_choice(index), 1.5))[0] == expected


def test_shooting_the_card_anywhere_but_a_choice_does_nothing(monkeypatch):
    """The card is not a target: a stray shot used to play again, and a
    player reading their score lost it to a twitch of the thumb."""
    choice, after = on_the_card(monkeypatch, pull_at((0.5, 0.2), 1.5))
    assert choice == "quit" and after > 3.0


def test_shooting_save_keeps_the_card_up_and_saves_it(monkeypatch, tmp_path):
    from handy import app

    saved = []
    monkeypatch.setattr(app, "save_card", lambda *args: saved.append(args) or tmp_path)
    choice, _ = on_the_card(monkeypatch, pull_at(card_choice(2), 1.5))
    assert choice == "quit" and len(saved) == 1


def test_a_player_still_shooting_at_time_up_gets_to_see_the_score(monkeypatch):
    """The round's trigger carries on into the card, and a player still firing
    when the clock ran out re-armed and fired 0.3 s later - straight through
    the card, and into the next round, without ever seeing the score."""
    from handy.aiming import Aim

    def still_shooting(t):
        if t < 0.25:
            return Aim(position=(0.5, 0.6), armed=True)  # re-armed at time-up
        if t < 0.3:
            return Aim(position=(0.5, 0.6), fired=True)  # and fired again
        return Aim(position=(0.5, 0.6))  # thumb down, reading the card

    choice, after = on_the_card(monkeypatch, still_shooting,
                                keys=[NOTHING] * 90 + [ord("q")])
    assert choice == "quit", "the stray shot played again"
    assert after >= 3.0


def test_a_shot_on_the_card_needs_a_trigger_cocked_after_it_appeared(monkeypatch):
    """A shot fired inside the grace period is not banked: the gun has to be
    cocked again, on the card, before a pull counts."""
    from handy.aiming import Aim

    PLAY_AGAIN = card_choice(0)

    def fire_recock_fire(t):
        if t < 0.3:
            return Aim(position=PLAY_AGAIN, armed=True)
        if t < 0.34:
            return Aim(position=PLAY_AGAIN, fired=True)  # ignored: too soon
        if t < 1.6:
            return Aim(position=PLAY_AGAIN)  # thumb held down past the grace
        if t < 1.8:
            return Aim(position=PLAY_AGAIN, armed=True)  # cocked on the card
        if t < 1.84:
            return Aim(position=PLAY_AGAIN, fired=True)
        return Aim(position=PLAY_AGAIN)

    choice, after = on_the_card(monkeypatch, fire_recock_fire)
    assert choice == "again" and after >= 1.8


def test_a_player_who_waits_needs_only_one_pull(monkeypatch):
    """Cocked all along and pulling once the card has been read: that shot
    counts at once; nobody has to fire twice."""
    from handy import app

    choice, after = on_the_card(monkeypatch, pull_at(card_choice(0),
                                                     app.RESULTS_GRACE + 0.2))
    assert choice == "again" and after < app.RESULTS_GRACE + 0.3


# --- the map chooser, which only quitting had ever exited --------------------

def chooser(monkeypatch, *, key=NOTHING, aim=None, click=None, count=1):
    """Run the real `choose_map` once and return how it ended."""
    from handy import app, scene, schemes
    from handy.calibration import default_rig
    from pathlib import Path

    from handy.highscores import HighScores

    import cv2
    monkeypatch.setattr(cv2, "imshow", lambda *args: None)
    monkeypatch.setattr(cv2, "getWindowProperty", lambda *args: 1.0)
    monkeypatch.setattr(scene, "draw_map_select", lambda *args, **kwargs: None)
    key_sequence(monkeypatch, [key])

    layout = layout_for(WIDTH, HEIGHT)
    if aim is not None:
        monkeypatch.setattr(app.AimController, "update",
                            lambda self, views, now, _aim=aim: _aim)
    if click is None:
        monkeypatch.setattr(cv2, "setMouseCallback", lambda *args: None)
    else:
        def register(_title, callback):
            callback(cv2.EVENT_LBUTTONDOWN, click[0], click[1], 0, None)
        monkeypatch.setattr(cv2, "setMouseCallback", register)

    return app.choose_map(
        OneFrameEyes(), np.zeros((HEIGHT, WIDTH, 3), np.uint8), Settings(), layout,
        app.make_controller(Settings(), schemes.PISTOL),
        default_rig(schemes.PISTOL, 1), schemes.PISTOL,
        HighScores(path=Path("/nowhere/scores.json")))


def card_centre(index: int) -> tuple[int, int]:
    from handy import app, maps

    card = app.chooser_cards(layout_for(WIDTH, HEIGHT), len(maps.MAPS))[index]
    return card.x + card.width // 2, card.y + card.height // 2


@pytest.mark.parametrize("index", range(len(maps.MAPS)))
def test_shooting_a_card_chooses_that_map(monkeypatch, index):
    """The chooser's whole purpose, and it had never once been exercised."""
    from handy import maps
    from handy.aiming import Aim

    x, y = card_centre(index)
    aim = Aim(position=(x / (WIDTH - 1), y / (HEIGHT - 1)), fired=True)
    assert chooser(monkeypatch, aim=aim) == ("play", maps.MAPS[index])


@pytest.mark.parametrize("index", range(len(maps.MAPS)))
def test_clicking_a_card_chooses_that_map(monkeypatch, index):
    from handy import maps

    assert chooser(monkeypatch, click=card_centre(index)) == ("play", maps.MAPS[index])


@pytest.mark.parametrize("index", range(len(maps.MAPS)))
def test_a_number_key_chooses_that_map(monkeypatch, index):
    from handy import maps

    assert chooser(monkeypatch, key=ord(str(index + 1))) == ("play", maps.MAPS[index])


@pytest.mark.parametrize("key,expected", [
    (ord("q"), "quit"), (ord("c"), "recalibrate"),
])
def test_the_chooser_keys_all_mean_something(monkeypatch, key, expected):
    assert chooser(monkeypatch, key=key) == (expected, None)


def test_the_chooser_quit_button_answers_a_shot_and_a_click(monkeypatch):
    from handy.aiming import Aim

    rect = layout_for(WIDTH, HEIGHT).quit_button.rect
    centre = (rect.x + rect.width // 2, rect.y + rect.height // 2)
    shot = Aim(position=(centre[0] / (WIDTH - 1), centre[1] / (HEIGHT - 1)),
               fired=True)
    assert chooser(monkeypatch, aim=shot) == ("quit", None)
    assert chooser(monkeypatch, click=centre) == ("quit", None)


def test_a_map_picked_in_the_chooser_is_the_map_that_gets_played(monkeypatch,
                                                                 tmp_path,
                                                                 model_path):
    """The branch of `_session` that consumes the chooser's answer: it had never
    returned anything but "quit", so nothing had ever come back out of it."""
    from handy import app, maps

    headless(monkeypatch)
    monkeypatch.setattr(app, "choose_map",
                        lambda *args, **kwargs: ("play", maps.ORBIT))
    played: list = []

    def spying_play(eyes, canvas, settings, layout, controller, rig, sounds,
                    chosen, scheme):
        played.append(chosen)
        return app.new_round(settings, layout, chosen), "quit"

    monkeypatch.setattr(app, "play", spying_play)
    app.run(app.Settings(cameras=(0,), mute=True,
                         skip_calibration=True, model_path=model_path,
                         calibration_path=tmp_path / "calibration.json"))

    assert played == [maps.ORBIT]


def test_asking_the_chooser_to_recalibrate_runs_setup_and_comes_back(monkeypatch,
                                                                     tmp_path,
                                                                     model_path):
    """`reason == "recalibrate"` in the chooser: setup runs, then the chooser
    is shown again rather than the game falling into a map."""
    from handy import app
    from handy.calibration import default_rig
    from handy.schemes import PISTOL

    headless(monkeypatch)
    answers = iter([("recalibrate", None), ("quit", None)])
    monkeypatch.setattr(app, "choose_map", lambda *args, **kwargs: next(answers))
    setups: list[int] = []
    monkeypatch.setattr(app, "run_calibration",
                        lambda *args, **kwargs: setups.append(1)
                        or default_rig(PISTOL, 1))
    app.run(app.Settings(cameras=(0,), mute=True,
                         skip_calibration=True, model_path=model_path,
                         calibration_path=tmp_path / "calibration.json"))

    assert setups == [1], "c in the chooser did not reach setup"
    assert next(answers, "drained") == "drained", "the chooser was not shown again"


# --- what a shot at the world (rather than at a button) actually does --------

class SpySounds:
    """Counts every noise the round asks for."""

    def __init__(self) -> None:
        self.calls: list[tuple] = []

    def __getattr__(self, name):
        def record(*args):
            self.calls.append((name, *args))
        return record

    def names(self) -> list[str]:
        return [call[0] for call in self.calls]


def play_once(monkeypatch, *, aim=None, key=NOTHING, keys=None, chosen=None,
              settings=None, sounds=None):
    """One pass of the real `play` loop, ended by whatever it is given."""
    from handy import app, maps, schemes
    from handy.calibration import default_rig

    import cv2
    monkeypatch.setattr(cv2, "imshow", lambda *args: None)
    monkeypatch.setattr(cv2, "setMouseCallback", lambda *args: None)
    monkeypatch.setattr(cv2, "getWindowProperty", lambda *args: 1.0)
    key_sequence(monkeypatch, keys or [key])
    if aim is not None:
        monkeypatch.setattr(app.AimController, "update",
                            lambda self, views, now, _aim=aim: _aim)

    settings = settings or Settings(recoil=26.0, seed=1)
    layout = layout_for(WIDTH, HEIGHT)
    return app.play(OneFrameEyes(), np.zeros((HEIGHT, WIDTH, 3), np.uint8),
                    settings, layout,
                    app.make_controller(settings, schemes.PISTOL),
                    default_rig(schemes.PISTOL, 1), sounds or SpySounds(),
                    chosen or maps.RANGE, schemes.PISTOL)


def test_a_shot_at_the_world_is_fired_scored_and_heard(monkeypatch):
    """`test_every_button_answers_a_shot_in_play` only ever fired at buttons, so
    the four lines that make a shot a shot - the crack, the hit test, the map's
    own hit sound and the recoil - had never run."""
    from handy import app, maps
    from handy.aiming import Aim
    from handy.game import Round

    sounds = SpySounds()
    kicks: list[float] = []
    monkeypatch.setattr(app.Recoil, "fire", lambda self, now: kicks.append(now))
    shots: list[tuple] = []
    real_shoot = Round.shoot

    def spying_shoot(self, x, y, now):
        shots.append((x, y))
        return real_shoot(self, x, y, now)

    monkeypatch.setattr(Round, "shoot", spying_shoot)
    # Dead centre of the play area, and away from every button.
    aim = Aim(position=(0.5, 0.6), fired=True, armed=False)
    round_, reason = play_once(monkeypatch, aim=aim, key=ord("q"),
                               chosen=maps.RANGE, sounds=sounds)

    assert shots, "the round was never asked whether the shot landed"
    assert round_.shots == 1
    assert "shot" in sounds.names(), "the pistol was silent"
    assert kicks, "the crosshair did not kick"
    # And it was voiced as either a hit or a miss, never both.
    assert ("hit" in sounds.names()) != ("miss" in sounds.names())


def test_a_hit_asks_the_map_for_its_own_hit_sound(monkeypatch):
    """`Map.play_hit` is reached from exactly one line, and only on a hit."""
    from handy import maps
    from handy.aiming import Aim
    from handy.game import Impact, Round

    monkeypatch.setattr(Round, "shoot",
                        lambda self, x, y, now: Impact(x=x, y=y, score=10, at=now,
                                                       ring=0))
    sounds = SpySounds()
    play_once(monkeypatch, aim=Aim(position=(0.5, 0.6), fired=True), key=ord("q"),
              chosen=maps.RANGE, sounds=sounds)

    assert ("hit", 0) in sounds.calls, "the gold ring's ping never played"
    assert "miss" not in sounds.names()


class ScriptedEyes:
    """A fake Eyes whose recogniser hands back these results, one per read -
    the same result object twice, when a camera outruns its recogniser."""

    def __init__(self, frames) -> None:
        self.frames = list(frames)
        self.mirror = True

    def __len__(self) -> int:
        return 1

    def read(self):
        frame = self.frames.pop(0) if len(self.frames) > 1 else self.frames[0]
        return [np.zeros((720, 1280, 3), np.uint8)], [frame]


def test_a_result_is_heard_by_the_trigger_once(monkeypatch):
    from handy import app, schemes
    from handy.calibration import default_rig
    from handy.recognition import Frame

    heard: list[int] = []

    class Controller:
        def update(self, views, now):
            heard.append(views[0][0].timestamp_ms)
            return Aim(position=(0.5, 0.5), armed=True, fired=True)

    trigger = app.FreshAim(Controller(), default_rig(schemes.PISTOL, 1))
    shots = [trigger.update([Frame(timestamp_ms=stamp)], 0.0).fired
             for stamp in (1, 1, 1, 2, 2, 3)]

    assert heard == [1, 2, 3]
    assert shots == [True, False, False, True, False, True], "a result fires once"


def test_a_misread_delivered_twice_is_not_a_shot(monkeypatch):
    """Each loop fed `latest()` to the trigger whether or not it was new. One
    misread frame read twice is two of the median's three readings, and the
    gun fired on its own."""
    import cv2
    from hands import make_hand

    from handy import app, maps, schemes
    from handy.calibration import default_rig
    from handy.recognition import Frame

    up, down = make_hand(thumb_degrees=12.0), make_hand(thumb_degrees=70.0)
    misread = Frame(hands=(down,), timestamp_ms=4)
    results = [Frame(hands=(up,), timestamp_ms=1), Frame(hands=(up,), timestamp_ms=2),
               Frame(hands=(up,), timestamp_ms=3), misread, misread,
               Frame(hands=(up,), timestamp_ms=5), Frame(hands=(up,), timestamp_ms=6)]

    monkeypatch.setattr(cv2, "imshow", lambda *args: None)
    monkeypatch.setattr(cv2, "setMouseCallback", lambda *args: None)
    monkeypatch.setattr(cv2, "getWindowProperty", lambda *args: 1.0)
    key_sequence(monkeypatch, [NOTHING] * len(results) + [ord("q")])
    settings = Settings(recoil=0.0, seed=1)
    round_, reason = app.play(
        ScriptedEyes(results), np.zeros((HEIGHT, WIDTH, 3), np.uint8), settings,
        layout_for(WIDTH, HEIGHT), app.make_controller(settings, schemes.PISTOL),
        default_rig(schemes.PISTOL, 1), SpySounds(), maps.RANGE, schemes.PISTOL)

    assert reason == "quit"
    assert round_.shots == 0, "the gun fired on a single misread frame"


def test_a_miss_thuds(monkeypatch):
    from handy import maps
    from handy.aiming import Aim
    from handy.game import Impact, Round

    monkeypatch.setattr(Round, "shoot",
                        lambda self, x, y, now: Impact(x=x, y=y, score=0, at=now))
    sounds = SpySounds()
    play_once(monkeypatch, aim=Aim(position=(0.5, 0.6), fired=True), key=ord("q"),
              chosen=maps.RANGE, sounds=sounds)

    assert "miss" in sounds.names() and "hit" not in sounds.names()


@pytest.mark.parametrize("key,expected", [
    (ord("r"), "again"), (ord("b"), "maps"),
    (ord("c"), "recalibrate"), (ord("q"), "quit"),
])
def test_every_key_in_a_round_means_something(monkeypatch, key, expected):
    """r, b and c had never been pressed inside `play`."""
    _, reason = play_once(monkeypatch, key=key)
    assert reason == expected


def paused_round(monkeypatch, keys, aims=None, frame_seconds=1.0):
    """Play the range on a clock that moves ``frame_seconds`` a frame, the keys
    pressed one a frame, and record what each frame showed: the round time
    the world was drawn at, the clock on screen, and whether the sheet was up."""
    import cv2

    from handy import app, maps, schemes, scene
    from handy.calibration import default_rig

    clock = {"now": 1000.0}
    script = iter(keys)

    def next_frame(*_args):
        clock["now"] += frame_seconds
        return next(script, ord("q"))

    monkeypatch.setattr(app.time, "monotonic", lambda: clock["now"])
    monkeypatch.setattr(cv2, "waitKey", next_frame)
    for name in ("imshow", "setMouseCallback"):
        monkeypatch.setattr(cv2, name, lambda *args: None)
    monkeypatch.setattr(cv2, "getWindowProperty", lambda *args: 1.0)
    frames: list[dict] = []
    real_render, real_sheet = app.render, scene.draw_pause_sheet

    def spy_render(canvas, view, layout):
        frames.append({"now": view.now, "remaining": view.remaining, "sheet": False})
        real_render(canvas, view, layout)

    def spy_sheet(canvas, *args, **kwargs):
        frames[-1]["sheet"] = True
        real_sheet(canvas, *args, **kwargs)

    monkeypatch.setattr(app, "render", spy_render)
    monkeypatch.setattr(scene, "draw_pause_sheet", spy_sheet)
    if aims is not None:
        aim_script = iter(aims)
        monkeypatch.setattr(app.AimController, "update",
                            lambda self, views, now: next(aim_script, Aim()))
    settings = Settings(duration=60.0, seed=1, recoil=0.0)
    round_, reason = app.play(
        OneFrameEyes(), np.zeros((HEIGHT, WIDTH, 3), np.uint8), settings,
        layout_for(WIDTH, HEIGHT), app.make_controller(settings, schemes.PISTOL),
        default_rig(schemes.PISTOL, 1), SpySounds(), maps.RANGE, schemes.PISTOL)
    return round_, reason, frames


@pytest.mark.parametrize("key", [ord("p"), 27], ids=["p", "esc"])
def test_p_or_esc_pauses_the_round_and_stops_its_clock(monkeypatch, key):
    """The sheet comes up, the clock on it stops, and the world holds still
    behind it until the same key puts it away."""
    keys = [NOTHING, key] + [NOTHING] * 5 + [key, NOTHING, ord("q")]
    _, reason, frames = paused_round(monkeypatch, keys)
    assert reason == "quit"
    sheet = [frame for frame in frames if frame["sheet"]]
    assert len(sheet) == 6, "up from the frame after the key until it is pressed again"
    assert len({frame["now"] for frame in sheet}) == 1, "the world held still"
    assert len({frame["remaining"] for frame in sheet}) == 1, "and so did the clock"
    assert frames[-1]["remaining"] == pytest.approx(frames[0]["remaining"] - 3.0), (
        "only the frames played came off the clock, not the ones paused")


def test_q_still_quits_from_the_pause_sheet(monkeypatch):
    _, reason, frames = paused_round(monkeypatch, [ord("p"), NOTHING, ord("q")])
    assert reason == "quit" and frames[-1]["sheet"]


def test_a_shot_at_the_world_behind_the_sheet_goes_nowhere(monkeypatch):
    """With the sheet up, the gun is for its buttons: a shot anywhere else is
    not a shot at the paused world."""
    world = (0.5, 0.95)  # below the sheet, over the range
    aims = [Aim(position=world, armed=True), Aim(position=world, armed=True),
            Aim(position=world, fired=True), Aim(position=world)]
    round_, reason, frames = paused_round(monkeypatch,
                                          [ord("p"), NOTHING, NOTHING, NOTHING, ord("q")],
                                          aims=aims)
    assert reason == "quit" and round_.shots == 0


def test_resume_on_the_sheet_goes_back_to_the_round(monkeypatch):
    from handy import scene

    _, buttons = scene.pause_sheet(WIDTH, HEIGHT, 1.0)
    resume = centre_of(buttons[0])
    aims = [Aim(), Aim(position=resume, armed=True), Aim(position=resume, fired=True)]
    _, reason, frames = paused_round(monkeypatch,
                                     [ord("p"), NOTHING, NOTHING, NOTHING, ord("q")],
                                     aims=aims)
    assert reason == "quit"
    assert [frame["sheet"] for frame in frames] == [False, True, True, False, False]


@pytest.mark.parametrize("width,height", ((1280, 720), (1512, 945), (2560, 1440)))
def test_the_pause_sheets_choices_are_big_enough_to_shoot(width, height):
    from handy import scene

    layout = layout_for(width, height)
    sheet, buttons = scene.pause_sheet(width, height, layout.scale)
    assert [button.label for button in buttons] == ["Resume", "Restart", "Choose a Game",
                                                    "Quit"]
    assert sheet.x >= 0 and sheet.right <= width and sheet.y >= 0 and sheet.bottom <= height
    for button in buttons:
        assert button.rect.height >= scene.SHOOTABLE * layout.scale - 1
        assert sheet.x < button.rect.x and button.rect.right < sheet.right
        assert sheet.y < button.rect.y and button.rect.bottom < sheet.bottom
        label = scene.measure(button.label, scene.HEADLINE, layout.scale)
        assert label + 2 * scene.type_size(scene.HEADLINE, layout.scale) < button.rect.width
    for upper, lower in zip(buttons, buttons[1:]):
        assert upper.rect.bottom < lower.rect.y


def test_s_saves_a_screenshot_without_ending_the_round(monkeypatch, tmp_path):
    _, reason = play_once(monkeypatch, keys=[ord("s"), ord("q")],
                          settings=Settings(screenshot_dir=tmp_path, seed=1))
    assert reason == "quit", "s must not be an exit; only the window closing is"
    assert list(tmp_path.glob("*.png"))


def test_a_screenshot_that_cannot_be_written_is_said_and_the_round_goes_on(
        monkeypatch, tmp_path, capsys):
    """A folder that cannot be made raised out of the round, which lost the
    score - and main() then blamed the network for it."""
    from handy import app

    blocker = tmp_path / "a file, not a folder"
    blocker.write_text("")
    notices: list[list[str]] = []
    monkeypatch.setattr(app, "show_notice", lambda canvas, lines, seconds=3.0,
                        scale=1.0: notices.append(lines))

    _, reason = play_once(monkeypatch, keys=[ord("s"), ord("q")],
                          settings=Settings(screenshot_dir=blocker / "shots", seed=1))

    assert reason == "quit", "the round carried on after the failed save"
    assert notices and "SCREENSHOT NOT SAVED" in notices[0]
    assert "Saved" not in capsys.readouterr().out


def test_the_results_card_survives_a_failed_screenshot(monkeypatch, tmp_path):
    from handy import app, scene, schemes
    from handy.calibration import default_rig
    from handy.game import Summary

    import cv2
    for name in ("imshow", "setMouseCallback"):
        monkeypatch.setattr(cv2, name, lambda *args: None)
    monkeypatch.setattr(cv2, "getWindowProperty", lambda *args: 1.0)
    monkeypatch.setattr(scene, "draw_results", lambda *args, **kwargs: None)
    monkeypatch.setattr(app, "show_notice", lambda *args, **kwargs: None)
    key_sequence(monkeypatch, [ord("s"), ord("q")])
    blocker = tmp_path / "file"
    blocker.write_text("")

    summary = Summary(score=10, shots=2, hits=1, accuracy=0.5, best_streak=1,
                      perfect=0, duration=60.0)
    assert app.show_results(
        OneFrameEyes(), np.zeros((HEIGHT, WIDTH, 3), np.uint8),
        Settings(screenshot_dir=blocker / "shots"), layout_for(WIDTH, HEIGHT),
        app.make_controller(Settings(), schemes.PISTOL),
        default_rig(schemes.PISTOL, 1), summary, 5, True) == "quit"


def test_a_screenshot_imwrite_refused_is_not_reported_as_saved(monkeypatch, tmp_path):
    """imwrite says no by returning False, and "Saved" was printed regardless."""
    import cv2

    from handy import app

    monkeypatch.setattr(cv2, "imwrite", lambda *args: False)
    with pytest.raises(OSError):
        app.save_screenshot(np.zeros((4, 4, 3), np.uint8), tmp_path)


def test_two_screenshots_in_the_same_second_are_two_files(monkeypatch, tmp_path):
    """Named to the second, a quick second press overwrote the first frame."""
    from handy import app

    monkeypatch.setattr(app.time, "time", lambda: 1_790_000_000.25)
    first = app.save_screenshot(np.zeros((4, 4, 3), np.uint8), tmp_path)
    second = app.save_screenshot(np.full((4, 4, 3), 9, np.uint8), tmp_path)

    assert first != second
    assert len(list(tmp_path.glob("*.png"))) == 2
    assert first.stem.endswith("-250"), "the milliseconds are in the name"


def test_a_model_mediapipe_cannot_read_is_named_not_a_traceback(monkeypatch,
                                                                tmp_path, capsys):
    """A corrupt --model raised a bare RuntimeError out of the session."""
    from handy import app, cli

    bogus = tmp_path / "hand.task"
    bogus.write_bytes(b"not a zip archive")
    headless(monkeypatch)
    monkeypatch.setattr(app, "open_window", lambda settings: (960, 540))

    assert cli.main(["--camera", "0", "--model", str(bogus), "--mute",
                     "--no-calibration", "--map", "zombies",
                     "--calibration-file", str(tmp_path / "calibration.json")]) == 1
    err = capsys.readouterr().err
    assert "hand.task" in err and ".task bundle" in err
    assert "network" not in err


def test_a_round_that_runs_out_of_time_ends_by_itself(monkeypatch):
    """The `is_over` exit: the only way a round ends without a key."""
    _, reason = play_once(monkeypatch, key=NOTHING,
                          settings=Settings(duration=0.0001, seed=1, recoil=0.0))
    assert reason == "over"


def test_a_slow_first_frame_does_not_come_out_of_the_round(monkeypatch):
    """Dead of Night's first draw costs seconds cold, and play could begin
    before the warm-up got to it. The clock had already started: a simulated
    start showed 56.66 s of 60 left on the second frame."""
    from dataclasses import replace

    from handy import app, maps, scene

    clock = {"now": 1000.0}

    def monotonic():
        clock["now"] += 1 / 60  # every look at the clock is a moment later
        return clock["now"]

    monkeypatch.setattr(app.time, "monotonic", monotonic)
    draws = []

    def cold_then_warm(canvas, round_, now):
        if not draws:
            clock["now"] += 3.5  # building the scenery, the first time only
        draws.append(now)
        maps.RANGE.draw_world(canvas, round_, now)

    shown: list[float] = []
    monkeypatch.setattr(scene, "draw_clock",
                        lambda canvas, remaining, scale=1.0, top=0: shown.append(remaining))
    play_once(monkeypatch, keys=[NOTHING, NOTHING, NOTHING, ord("q")],
              chosen=replace(maps.RANGE, draw_world=cold_then_warm),
              settings=Settings(duration=60.0, seed=1, recoil=0.0))

    assert len(shown) == 4
    assert min(shown) > 59.5, f"the clock ran while the scenery was built: {shown}"


# --- setup, at the app level -------------------------------------------------

def test_the_rig_setup_measured_is_the_rig_that_gets_saved(monkeypatch, tmp_path,
                                                           model_path):
    """The app-level wiring: what the setup loop returns is written to the book
    under this scheme's key, and the next launch finds it there."""
    from handy import app, homography
    from handy.calibration import Calibration, Rig, RigBook

    measured = Rig((Calibration(
        mapping=homography.box_mapping((0.2, 0.25), (0.8, 0.75)), fit_error=0.01,
        aim_fitted=True, gain=1.7),))

    headless(monkeypatch)
    monkeypatch.setattr(app, "run_calibration",
                        lambda *args, **kwargs: measured)
    path = tmp_path / "calibration.json"
    app.run(app.Settings(cameras=(0,), map_key="range",
                         mute=True, model_path=model_path,
                         calibration_path=path))

    saved = RigBook.load(path).get("pistol")
    assert saved is not None, "a successful setup was never written out"
    assert saved.cameras[0].gain == pytest.approx(measured.cameras[0].gain)
    assert saved.cameras[0].mapping == pytest.approx(measured.cameras[0].mapping)


# --- a camera that hiccups, and one that has actually gone ------------------

class FlakyCapture:
    """A webcam that fails the first ``bad`` reads of every frame."""

    def __init__(self, bad: int, answer=(False, None)) -> None:
        self.bad = bad
        self.answer = answer
        self.reads = 0

    def read(self):
        self.reads += 1
        if self.reads <= self.bad:
            return self.answer
        return True, np.zeros((720, 1280, 3), np.uint8)


class NullStream:
    def __init__(self) -> None:
        self.submitted = 0

    def submit(self, image) -> None:
        self.submitted += 1

    def latest(self):
        from handy.recognition import Frame

        return Frame()


@pytest.fixture
def camera_clock(monkeypatch):
    """Monotonic time that only moves when the game sleeps or a frame is read,
    so seconds of a failing camera pass in no time at all."""
    from handy import app

    clock = {"now": 1000.0}
    monkeypatch.setattr(app.time, "monotonic", lambda: clock["now"])
    monkeypatch.setattr(app.time, "sleep",
                        lambda seconds: clock.update(now=clock["now"] + seconds))
    return clock


class GoneCapture:
    """A webcam that hands over ``good`` frames and then nothing, each read
    taking ``cost`` seconds of the clock - a failing backend answers in
    microseconds."""

    def __init__(self, clock, good: int = 1, cost: float = 0.0,
                 back_after: float | None = None) -> None:
        self.clock, self.good, self.cost = clock, good, cost
        self.back_at = None if back_after is None else clock["now"] + back_after
        self.reads = 0

    def read(self):
        self.reads += 1
        self.clock["now"] += self.cost
        if self.reads <= self.good or (self.back_at is not None
                                       and self.clock["now"] >= self.back_at):
            return True, np.full((720, 1280, 3), self.reads % 250, np.uint8)
        return False, None


def test_a_dropped_frame_does_not_cost_the_round(camera_clock):
    """One hiccup from a USB webcam used to end the game and the score with it."""
    from handy.app import Eyes

    capture = FlakyCapture(bad=2)
    stream = NullStream()
    images, hands = Eyes([capture], [stream], mirror=False).read()

    assert len(images) == 1 and images[0].shape == (720, 1280, 3)
    assert capture.reads == 3, "it gave up instead of trying again"
    assert stream.submitted == 1


def test_a_failing_backend_is_given_time_not_a_count_of_tries(camera_clock):
    """Four tries back to back were over in microseconds - a failing backend
    answers at once - so no hiccup was ever short enough to be ridden out."""
    from handy.app import Eyes

    capture = GoneCapture(camera_clock, good=0, back_after=1.0)
    images, _ = Eyes([capture], [NullStream()], mirror=False).read()

    assert images[0].shape == (720, 1280, 3)
    assert capture.reads > 4


def test_the_last_good_frame_stands_in_while_the_camera_hiccups(camera_clock):
    """The game keeps drawing, and answering keys, while a camera catches up."""
    from handy.app import Eyes

    capture = GoneCapture(camera_clock, good=1, cost=0.05)
    stream = NullStream()
    eyes = Eyes([capture], [stream], mirror=False)
    first, _ = eyes.read()
    later = [eyes.read()[0][0] for _ in range(10)]  # half a second of failures

    assert all(image is first[0] for image in later), "the last picture stands in"
    assert stream.submitted == 1, "and is not recognised twice"


def test_a_camera_that_answers_true_with_no_image_is_still_a_lost_camera(camera_clock):
    """`ok` alone was believed, so a backend answering (True, None) got as far as
    cvtColor and raised a bare cv2.error instead of the CameraError beside it."""
    from handy.app import Eyes
    from handy.cameras import CameraError

    capture = FlakyCapture(bad=10**9, answer=(True, None))
    started = camera_clock["now"]
    with pytest.raises(CameraError) as raised:
        Eyes([capture], [NullStream()], mirror=False).read()

    assert "camera 1" in str(raised.value)
    assert camera_clock["now"] - started >= Eyes.LOST_AFTER, "it gave the camera time"


def test_a_camera_that_has_really_gone_still_ends_the_round(camera_clock):
    from handy.app import Eyes
    from handy.cameras import CameraError

    eyes = Eyes([GoneCapture(camera_clock, good=1, cost=0.05)], [NullStream()],
                mirror=False)
    eyes.read()
    started = camera_clock["now"]
    with pytest.raises(CameraError):
        while camera_clock["now"] - started < 10:
            eyes.read()
    assert camera_clock["now"] - started < Eyes.LOST_AFTER + 0.2


def test_a_camera_lost_mid_game_is_said_on_screen_and_handed_back(monkeypatch,
                                                                  tmp_path,
                                                                  model_path):
    """The window used to vanish with the message only in the terminal behind it."""
    from handy import app
    from handy.cameras import CameraError

    opened = headless(monkeypatch)
    notices: list[list[str]] = []
    monkeypatch.setattr(app, "show_notice", lambda canvas, lines, seconds=3.0,
                        scale=1.0: notices.append(lines))

    def gone(self):
        raise CameraError("Lost the stream from camera 1")

    monkeypatch.setattr(app.Eyes, "read", gone)
    with pytest.raises(CameraError):
        app.run(app.Settings(cameras=(0,), map_key="zombies", mute=True,
                             skip_calibration=True, model_path=model_path,
                             calibration_path=tmp_path / "calibration.json"))

    assert notices and notices[-1][0] == "CAMERA LOST"
    assert opened and all(capture.released for capture in opened)


# --- whatever stops the launch, no camera is left on ------------------------

def test_a_second_camera_that_will_not_open_hands_the_first_back(monkeypatch,
                                                                 tmp_path):
    import cv2

    from handy import app
    from handy.cameras import CameraError

    opened = headless(monkeypatch)

    def capture_for(index):
        opened.append(FakeCapture(index, works=index == 0))
        return opened[-1]

    monkeypatch.setattr(cv2, "VideoCapture", capture_for)
    monkeypatch.setattr(app, "ensure_model", lambda name: Path(name))
    with pytest.raises(CameraError, match="camera 1"):
        app.run(app.Settings(cameras=(0, 1), mute=True, skip_calibration=True,
                             calibration_path=tmp_path / "calibration.json"))

    assert [capture.index for capture in opened] == [0, 1]
    assert opened[0].released, "the camera that did open was left running"


@pytest.mark.parametrize("failure", [OSError("no network"), KeyboardInterrupt()],
                         ids=["no-network", "ctrl-c"])
def test_no_camera_is_woken_until_the_models_are_in(monkeypatch, tmp_path, failure):
    """A download that failed, or a Ctrl+C while waiting on one, left the
    camera light on: the cameras were opened first."""
    from handy import app

    opened = headless(monkeypatch)

    def fetch(name):
        raise failure

    monkeypatch.setattr(app, "ensure_model", fetch)
    with pytest.raises(type(failure)):
        app.run(app.Settings(cameras=(0,), mute=True, skip_calibration=True,
                             calibration_path=tmp_path / "calibration.json"))
    assert opened == []


def test_a_failure_after_the_cameras_open_still_hands_them_back(monkeypatch,
                                                                tmp_path):
    from handy import app

    opened = headless(monkeypatch)
    monkeypatch.setattr(app, "ensure_model", lambda name: Path(name))

    def interrupted(settings):
        raise KeyboardInterrupt

    monkeypatch.setattr(app, "open_window", interrupted)
    with pytest.raises(KeyboardInterrupt):
        app.run(app.Settings(cameras=(0, 1), mute=True, skip_calibration=True,
                             calibration_path=tmp_path / "calibration.json"))
    assert len(opened) == 2 and all(capture.released for capture in opened)


# --- the model download happens before the screen goes black ----------------

def test_the_model_is_resolved_before_the_window_opens(monkeypatch, tmp_path):
    """No network on a first run gave a raw URLError traceback - thrown from
    inside the session, with the camera open and the window already fullscreen.

    With the scheme known up front there is nothing to wait for, so the fetch
    happens while the player is still looking at the terminal.
    """
    from handy import app

    order: list[str] = []
    monkeypatch.setattr(app, "ensure_model",
                        lambda name: order.append(f"fetch {name}") or Path(name))
    monkeypatch.setattr(app, "open_window",
                        lambda settings: order.append("window") or (960, 540))
    monkeypatch.setattr(app, "choose_cameras", lambda settings: ((0,), ""))
    monkeypatch.setattr(app, "open_camera", lambda *args: FakeCapture(0))
    monkeypatch.setattr(app, "_session", lambda *args, **kwargs: None)
    monkeypatch.setattr(app.threading, "Thread",
                        lambda *args, **kwargs: type("T", (), {"start": lambda s: None})())
    import cv2
    monkeypatch.setattr(cv2, "destroyAllWindows", lambda: None)

    app.run(app.Settings(cameras=(0,), map_key="sniper", mute=True,
                         skip_calibration=True,
                         calibration_path=tmp_path / "calibration.json"))

    assert order == ["fetch gesture_recognizer", "fetch face_landmarker", "window"]


def test_every_model_a_map_can_ask_for_is_fetched_at_launch(monkeypatch):
    """Overwatch Ridge's face model was fetched only for `--map sniper`, so a
    first-time player who shot its card in the chooser downloaded it on the
    game's own thread - a frozen window, or offline an uncaught OSError that
    ended the game."""
    from handy import app

    fetched: list[str] = []
    monkeypatch.setattr(app, "ensure_model",
                        lambda name: fetched.append(name) or Path(name))
    for settings in (app.Settings(), app.Settings(map_key="zombies"),
                     app.Settings(map_key="sniper")):
        fetched.clear()
        app.prefetch_models(settings)
        assert fetched == ["gesture_recognizer", "face_landmarker"], settings


def test_a_hand_model_of_your_own_still_leaves_the_scope_to_fetch(monkeypatch):
    from handy import app

    fetched: list[str] = []
    monkeypatch.setattr(app, "ensure_model",
                        lambda name: fetched.append(name) or Path(name))
    app.prefetch_models(app.Settings(model_path=Path("/mine.task")))
    assert fetched == ["face_landmarker"], "--model stands in for the hand only"


def test_the_pistol_maps_do_not_wait_on_the_scope_model(monkeypatch, capsys):
    """The face model is for one map. Failing to fetch it must not stop the
    other three - but the hand model the game opens with has to arrive."""
    from handy import app

    def fetch(name):
        if name == "face_landmarker":
            raise OSError("no network")
        return Path(name)

    monkeypatch.setattr(app, "ensure_model", fetch)
    app.prefetch_models(app.Settings(map_key="zombies"))  # must not raise
    assert "face landmarker" in capsys.readouterr().out

    with pytest.raises(OSError):
        app.prefetch_models(app.Settings(map_key="sniper"))


def test_a_map_whose_model_cannot_be_had_is_refused_on_screen(monkeypatch,
                                                              tmp_path):
    """Shooting Overwatch Ridge offline used to end the game with an uncaught
    OSError. It is now a notice, and the chooser again."""
    from contextlib import contextmanager
    from dataclasses import replace

    from handy import app, maps, schemes
    from handy.calibration import RigBook
    from handy.highscores import HighScores

    @contextmanager
    def tracker():
        yield NullStream()

    pistol = replace(schemes.PISTOL, open_stream=lambda *_: tracker())
    scoped = replace(schemes.MARKSMAN, open_stream=lambda *_: tracker())
    monkeypatch.setattr(schemes, "for_map",
                        lambda key: scoped if key == "sniper" else pistol)

    def bundles(settings, scheme):
        if scheme.key == "marksman":
            raise OSError("no network")
        return [Path("hand.task")]

    monkeypatch.setattr(app, "model_bundles", bundles)
    monkeypatch.setattr(app, "refit", lambda layout, canvas: (layout, canvas))
    headless(monkeypatch)
    notices: list[list[str]] = []
    monkeypatch.setattr(app, "show_notice", lambda canvas, lines, seconds=3.0,
                        scale=1.0: notices.append(lines))
    answers = iter([("play", maps.SNIPER), ("quit", None)])
    monkeypatch.setattr(app, "choose_map", lambda *_: next(answers))
    monkeypatch.setattr(app, "play", lambda *args: pytest.fail("a map was played"))

    settings = app.Settings(cameras=(0,), mute=True, skip_calibration=True,
                            calibration_path=tmp_path / "setup.json")
    assert app._session(settings, layout_for(960, 540), [FakeCapture()],
                        np.zeros((540, 960, 3), np.uint8), RigBook(),
                        HighScores(tmp_path / "scores.json")) is None

    assert notices and notices[0][0] == "MAP UNAVAILABLE"
    assert next(answers, "drained") == "drained", "the chooser came back"


def test_every_map_can_describe_its_own_result(layout):
    """Whatever a map's round measures, it can say how the round went."""
    from handy import maps
    from handy.app import Settings, new_round

    settings = Settings(seed=5)
    for chosen in maps.MAPS:
        line = new_round(settings, layout, chosen).result_line()
        assert isinstance(line, str) and line.strip(), chosen.key


@pytest.mark.parametrize("has_setup", [False, True])
def test_sniper_reuses_hand_setup_and_releases_face_tracker_on_leaving(monkeypatch, tmp_path, has_setup):
    from contextlib import contextmanager
    from dataclasses import replace
    from handy import app, maps, schemes
    from handy.calibration import Calibration, Rig, RigBook
    from handy.highscores import HighScores

    events = []

    @contextmanager
    def tracker(name):
        events.append(("open", name))
        try:
            yield NullStream()
        finally:
            events.append(("close", name))

    pistol = replace(schemes.PISTOL, open_stream=lambda *_: tracker("hand"))
    scoped = replace(schemes.MARKSMAN, open_stream=lambda *_: tracker("hand+face"))
    monkeypatch.setattr(schemes, "for_map", lambda key: scoped if key == "sniper" else pistol)
    monkeypatch.setattr(app, "model_bundles", lambda *_: [Path("unused")])
    monkeypatch.setattr(app, "refit", lambda layout, canvas: (layout, canvas))
    headless(monkeypatch)
    settings = app.Settings(cameras=(0,), mute=True, calibration_path=tmp_path / "setup.json")
    # Stamped with the setup it was fitted on, as every rig setup saves is.
    rig = Rig((Calibration(aim_fitted=True),),
              app.rig_setup(settings, (0,)))
    book = RigBook()
    if has_setup:
        book.set("pistol", rig)
    choices = iter((maps.SNIPER, maps.RANGE))
    monkeypatch.setattr(app, "choose_map", lambda *_: ("play", next(choices)))
    setups = []
    monkeypatch.setattr(app, "run_calibration", lambda eyes, canvas, layout, scheme, previous: setups.append(scheme.key) or rig)
    played = []

    def play(eyes, canvas, settings, layout, controller, current, sounds, chosen, scheme):
        played.append((chosen.key, scheme.key))
        assert current == rig
        assert events[-1] == ("open", "hand+face" if chosen.key == "sniper" else "hand")
        return None, "maps" if chosen.key == "sniper" else "quit"

    monkeypatch.setattr(app, "play", play)
    app._session(settings, layout_for(960, 540), [FakeCapture()],
                 np.zeros((540, 960, 3), np.uint8), book, HighScores(tmp_path / "scores.json"))
    assert setups == ([] if has_setup else ["marksman"])
    assert book.get("pistol") == rig
    assert book.get("marksman") is None
    assert played == [("sniper", "marksman"), ("range", "pistol")]
    assert events == [("open", "hand"), ("close", "hand"),
                      ("open", "hand+face"), ("close", "hand+face"),
                      ("open", "hand"), ("close", "hand")]


def test_sniper_startup_prefetches_eye_model_with_hand_override(monkeypatch):
    from handy import app
    fetched = []
    monkeypatch.setattr(app, "ensure_model", lambda name: fetched.append(name))
    app.prefetch_models(app.Settings(map_key="sniper", model_path=Path("hand.task")))
    assert fetched == ["face_landmarker"]


# --- the chrome keeps out of the way, at every size --------------------------

SIZES = ((1280, 720), (1512, 945), (2560, 1440))


def overlaps(a, b) -> bool:
    return a.x < b.right and b.x < a.right and a.y < b.bottom and b.y < a.bottom


@pytest.mark.parametrize("width,height", SIZES)
def test_no_chooser_card_runs_under_the_camera_or_the_quit_button(width, height):
    """The first card's art used to sit under the camera preview."""
    from handy import app

    layout = layout_for(width, height)
    cards = app.chooser_cards(layout, len(maps.MAPS))
    assert len(cards) == len(maps.MAPS)
    for card in cards:
        assert not overlaps(card, layout.inset)
        assert not overlaps(card, layout.quit_button.rect)
        assert card.x >= 0 and card.right <= width and card.bottom <= height
    for left, right in zip(cards, cards[1:]):
        assert left.right < right.x
    # The grid stands on the margins the camera and QUIT stand on.
    assert cards[0].x == layout.inset.x
    assert cards[-1].right == layout.quit_button.rect.right


@pytest.mark.parametrize("width,height", SIZES)
def test_the_chooser_title_and_cards_keep_clear_of_the_corners(width, height):
    """The title sits between the picture and Quit; the cards below them, above
    the hints; everything shootable at least as big as a finger pistol needs."""
    from handy import app, scene

    layout = layout_for(width, height)
    title = scene.measure(scene.CHOOSER_TITLE, scene.TITLE_1, layout.scale)
    assert layout.inset.right < (width - title) // 2
    assert (width + title) // 2 < layout.quit_button.rect.x
    cards = app.chooser_cards(layout, len(maps.MAPS))
    footer = scene.footer_baseline(height, layout.scale) - scene.type_size(
        scene.FOOTNOTE, layout.scale) * 2
    for card in cards:
        assert card.y > layout.inset.bottom and card.bottom < footer
        assert card.height >= scene.SHOOTABLE * layout.scale
    assert layout.quit_button.rect.height >= scene.SHOOTABLE * layout.scale - 1


def chrome_view(chosen, layout, **fields):
    settings = Settings(seed=1)
    round_ = new_round(settings, layout, chosen)
    round_.update(0.0)
    fields.setdefault("remaining", 48.0)
    return View(map=chosen, round=round_, aim=Aim(position=(0.5, 0.5), armed=True),
                crosshair=(10, 10), cameras=[np.zeros((720, 1280, 3), np.uint8)],
                hands=[Frame()], now=0.2, **fields)


@pytest.mark.parametrize("width,height", SIZES)
@pytest.mark.parametrize("chosen", maps.MAPS, ids=lambda m: m.key)
def test_the_corner_chrome_keeps_to_the_corners(chosen, width, height):
    """Score top-left beside the picture, clock top-centre, Pause top-right:
    none of it overlapping, all of it above the targets."""
    from handy import app, scene

    layout = layout_for(width, height)
    for remaining in (48.0, 600.0, None):
        view = chrome_view(chosen, layout, remaining=remaining)
        panel, strip = app.hud_panels(view, layout)
        clock = scene.clock_pill(width, remaining, layout.scale, layout.margin)
        assert layout.inset.right < panel.x and panel.right < clock.x
        assert panel.y == layout.inset.y == clock.y == layout.pause_button.rect.y
        assert clock.right < layout.pause_button.rect.x
        assert abs(clock.x + clock.width / 2 - width / 2) <= 1
        for rect in (panel, strip):
            if rect is not None:
                assert rect.bottom < layout.play_area.y
                assert not overlaps(rect, layout.inset)


def test_the_hints_open_the_round_then_fade():
    from handy.app import Hints

    hints = Hints(100.0)
    assert hints.alpha(100.0) == 1.0
    assert hints.alpha(100.0 + Hints.OPENING - Hints.FADE - 0.01) == 1.0
    assert 0.0 < hints.alpha(100.0 + Hints.OPENING - Hints.FADE / 2) < 1.0
    assert hints.alpha(100.0 + Hints.OPENING) == 0.0
    hints.show(200.0, Hints.NUDGE)  # a key that does nothing brings them back
    assert hints.alpha(200.0) == 1.0 and hints.alpha(200.0 + Hints.NUDGE) == 0.0
    hints.show(300.0, Hints.LINGER)
    hints.show(300.0, 0.1)  # a shorter call never cuts a longer one short
    assert hints.alpha(300.0 + Hints.LINGER - Hints.FADE - 0.01) == 1.0


def test_a_faded_hint_line_gives_the_foot_of_the_frame_back_to_the_world(layout):
    """The keys ran along the foot of every frame of every round; now they
    come and go, and once gone nothing of the interface is left down there."""
    from dataclasses import replace

    view = chrome_view(maps.WESTERN, layout, scheme=None)
    shown, faded, world = (np.zeros((HEIGHT, WIDTH, 3), np.uint8) for _ in range(3))
    render(shown, replace(view, hints=1.0), layout)
    render(faded, replace(view, hints=0.0), layout)
    maps.WESTERN.draw_world(world, view.round, view.now)
    band = slice(HEIGHT - 80, HEIGHT)
    assert not np.array_equal(shown[band], faded[band])
    assert np.array_equal(faded[band], world[band])


def test_the_play_loop_brings_the_hints_back_for_a_key_it_does_not_know(monkeypatch):
    import cv2

    from handy import app, schemes
    from handy.calibration import default_rig

    monkeypatch.setattr(cv2, "imshow", lambda *args: None)
    monkeypatch.setattr(cv2, "setMouseCallback", lambda *args: None)
    monkeypatch.setattr(cv2, "getWindowProperty", lambda *args: 1.0)
    clock = iter(range(100, 10_000, 3))  # three seconds a frame: past the opening fast
    monkeypatch.setattr(app.time, "monotonic", lambda: float(next(clock)))
    monkeypatch.setattr(app.AimController, "update",
                        lambda self, views, now: Aim(position=(0.5, 0.5)))
    shown = []
    monkeypatch.setattr(app, "render", lambda canvas, view, layout: shown.append(view.hints))
    key_sequence(monkeypatch, [NOTHING, NOTHING, NOTHING, ord("x"), NOTHING, ord("q")])

    app.play(OneFrameEyes(), np.zeros((HEIGHT, WIDTH, 3), np.uint8),
             Settings(duration=None, recoil=0.0), layout_for(WIDTH, HEIGHT),
             app.make_controller(Settings(), schemes.PISTOL),
             default_rig(schemes.PISTOL, 1), SpySounds(), maps.RANGE, schemes.PISTOL)

    assert shown[0] == 1.0, "the round opens with them"
    assert shown[3] == 0.0, "then they fade"
    assert shown[4] == 1.0, "and an unknown key brings them back"


def test_the_results_screen_names_the_map_that_was_played(monkeypatch):
    import cv2

    from handy import app, scene, schemes
    from handy.calibration import default_rig
    from handy.game import Summary

    monkeypatch.setattr(cv2, "imshow", lambda *args: None)
    monkeypatch.setattr(cv2, "setMouseCallback", lambda *args: None)
    monkeypatch.setattr(cv2, "getWindowProperty", lambda *args: 1.0)
    seen = []
    monkeypatch.setattr(scene, "draw_results",
                        lambda canvas, summary, best, is_best, **kwargs: seen.append(kwargs))
    key_sequence(monkeypatch, [ord("q")])

    summary = Summary(score=10, shots=2, hits=1, accuracy=0.5, best_streak=1,
                      perfect=0, duration=60.0)
    app.show_results(OneFrameEyes(), np.zeros((HEIGHT, WIDTH, 3), np.uint8), Settings(),
                     layout_for(WIDTH, HEIGHT),
                     app.make_controller(Settings(), schemes.PISTOL),
                     default_rig(schemes.PISTOL, 1), summary, 5, True, maps.ORBIT)

    assert seen[0]["title"] == maps.ORBIT.title
    assert seen[0]["emblem"] is maps.ORBIT.draw_emblem
    assert seen[0]["elapsed"] >= 0.0, "so the card can arrive and count up"
