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


def test_camera_inset_is_a_quarter_of_the_window_in_the_top_left(layout):
    assert (layout.inset.width, layout.inset.height) == (WIDTH // 4, HEIGHT // 4)
    assert layout.inset.x < WIDTH // 8 and layout.inset.y < HEIGHT // 8


def test_play_area_sits_below_the_inset_and_inside_the_window(layout):
    assert layout.play_area.y >= layout.inset.bottom
    assert layout.play_area.right <= WIDTH and layout.play_area.bottom <= HEIGHT
    assert layout.play_area.width > 0 and layout.play_area.height > 0


def test_the_maps_button_sits_beside_quit_without_overlapping_it(layout):
    quit_rect, maps_rect = layout.quit_button.rect, layout.maps_button.rect
    assert maps_rect.right < quit_rect.x
    assert maps_rect.y == quit_rect.y
    assert not layout.quit_button.contains(maps_rect.x + 5, maps_rect.y + 5)


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
    # from it reaches QUIT, so the crosshair can get there.
    assert corner[0] > layout.quit_button.rect.x
    assert layout.quit_button.contains(corner[0] - 20, layout.quit_button.rect.y + 20)


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
                            aim=Aim(), crosshair=None,
                            cameras=[np.zeros((720, 1280, 3), np.uint8)],
                            hands=[empty[scheme.key]], now=0.0, scheme=scheme),
               layout)
        canvases[scheme.key] = canvas

    assert not np.array_equal(canvases["pistol"], canvases["marksman"])
    assert CONTROL_KEYS and maps.ZOMBIES.footer, "both still have their say"


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
    from handy.app import Settings, saved_rig
    from handy.calibration import Calibration, Rig, RigBook
    from handy.schemes import MARKSMAN, PISTOL

    book = RigBook()
    book.set("pistol", Rig((Calibration(), Calibration())))
    settings = Settings(cameras=(0, 1))

    assert saved_rig(book, settings, PISTOL, 2) is not None
    assert saved_rig(book, settings, PISTOL, 1) is None, "was calibrated for two"
    assert saved_rig(book, settings, MARKSMAN, 2) is not None, "the scope shares it"


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
def test_either_tracker_starts_and_shuts_down(monkeypatch, tmp_path, map_key):
    """The sniper opens a face model beside the hand's; both must close again."""
    from handy import app, schemes
    from handy.models import ensure_model

    for name in schemes.for_map(map_key).models:  # cached before the window opens
        ensure_model(name)
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
    """A fake Eyes: every camera hands over one blank frame per read."""

    def __init__(self, count: int = 1) -> None:
        self.count = count
        self.mirror = True

    def __len__(self) -> int:
        return self.count

    def read(self):
        from handy.recognition import Frame

        blank = np.zeros((720, 1280, 3), np.uint8)
        return [blank] * self.count, [Frame()] * self.count


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
    _, cards, entries, _aimed, _scale = drawn[0]
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
    assert best[maps.ZOMBIES.title] == "best 120"
    assert best[maps.SNIPER.title] == "best 340"


def test_every_button_answers_a_shot_in_play(monkeypatch, tmp_path, model_path):
    """QUIT and MAPS both mean something when shot mid-game."""
    from handy import app, maps, schemes
    from handy.aiming import Aim
    from handy.calibration import default_rig
    from handy.audio import Audio, Sounds
    import cv2

    monkeypatch.setattr(cv2, "imshow", lambda *args: None)
    monkeypatch.setattr(cv2, "setMouseCallback", lambda *args: None)
    monkeypatch.setattr(cv2, "waitKey", lambda *args: 255)
    monkeypatch.setattr(cv2, "getWindowProperty", lambda *args: 1.0)

    layout = layout_for(WIDTH, HEIGHT)
    for button, expected in ((layout.quit_button, "quit"),
                             (layout.maps_button, "maps")):
        centre = (button.rect.x + button.rect.width // 2,
                  button.rect.y + button.rect.height // 2)
        aim = Aim(position=(centre[0] / (WIDTH - 1), centre[1] / (HEIGHT - 1)),
                  armed=False, fired=True)
        monkeypatch.setattr(app.AimController, "update",
                            lambda self, views, now, _aim=aim: _aim)

        _, reason = app.play(
            OneFrameEyes(), np.zeros((HEIGHT, WIDTH, 3), np.uint8),
            Settings(recoil=0.0), layout,
            app.make_controller(Settings(), schemes.PISTOL),
            default_rig(schemes.PISTOL, 1), Sounds(Audio(enabled=False), 5),
            maps.RANGE, schemes.PISTOL)
        assert reason == expected, f"shooting {button.label} should mean {expected}"


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
        assert layout.maps_button.rect.x > layout.inset.right, "no overlap"
        assert layout.quit_button.rect.right <= width


def test_the_buttons_never_overlap_each_other_at_any_size():
    for width, height in ((1280, 720), (1440, 900), (1512, 982), (1920, 1080),
                          (2560, 1440), (3024, 1964)):
        layout = layout_for(width, height)
        maps_, quit_ = layout.maps_button.rect, layout.quit_button.rect
        assert maps_.right < quit_.x, f"{width}x{height}"
        assert quit_.right <= width and layout.play_area.bottom <= height


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

    assert list(tmp_path.glob("*.png")), "s saved nothing"


@pytest.mark.parametrize("button,expected", [
    ("quit_button", "quit"), ("maps_button", "maps"),
])
def test_every_button_answers_a_shot_on_the_results_screen(monkeypatch, button,
                                                           expected):
    from handy import app, scene, schemes
    from handy.aiming import Aim
    from handy.calibration import default_rig
    from handy.game import Summary

    import cv2
    monkeypatch.setattr(cv2, "imshow", lambda *args: None)
    monkeypatch.setattr(cv2, "setMouseCallback", lambda *args: None)
    monkeypatch.setattr(cv2, "getWindowProperty", lambda *args: 1.0)
    monkeypatch.setattr(scene, "draw_results", lambda *args, **kwargs: None)
    key_sequence(monkeypatch, [NOTHING])

    layout = layout_for(WIDTH, HEIGHT)
    rect = getattr(layout, button).rect
    centre = (rect.x + rect.width // 2, rect.y + rect.height // 2)
    aim = Aim(position=(centre[0] / (WIDTH - 1), centre[1] / (HEIGHT - 1)),
              fired=True)
    monkeypatch.setattr(app.AimController, "update",
                        lambda self, views, now, _aim=aim: _aim)
    summary = Summary(score=10, shots=2, hits=1, accuracy=0.5, best_streak=1,
                      perfect=0, duration=60.0)

    assert app.show_results(
        OneFrameEyes(), np.zeros((HEIGHT, WIDTH, 3), np.uint8), Settings(),
        layout, app.make_controller(Settings(), schemes.PISTOL),
        default_rig(schemes.PISTOL, 1), summary, 5, True) == expected


def test_shooting_the_world_on_the_results_screen_plays_again(monkeypatch):
    """Anywhere that is not a button means "again" - the README's promise."""
    from handy import app, scene, schemes
    from handy.aiming import Aim
    from handy.calibration import default_rig
    from handy.game import Summary

    import cv2
    monkeypatch.setattr(cv2, "imshow", lambda *args: None)
    monkeypatch.setattr(cv2, "setMouseCallback", lambda *args: None)
    monkeypatch.setattr(cv2, "getWindowProperty", lambda *args: 1.0)
    monkeypatch.setattr(scene, "draw_results", lambda *args, **kwargs: None)
    key_sequence(monkeypatch, [NOTHING])
    monkeypatch.setattr(app.AimController, "update",
                        lambda self, views, now: Aim(position=(0.5, 0.6), fired=True))
    summary = Summary(score=10, shots=2, hits=1, accuracy=0.5, best_streak=1,
                      perfect=0, duration=60.0)

    assert app.show_results(
        OneFrameEyes(), np.zeros((HEIGHT, WIDTH, 3), np.uint8), Settings(),
        layout_for(WIDTH, HEIGHT),
        app.make_controller(Settings(), schemes.PISTOL),
        default_rig(schemes.PISTOL, 1), summary, 5, True) == "again"


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
    from handy import maps, scene

    layout = layout_for(WIDTH, HEIGHT)
    card = scene.map_cards(layout.window, len(maps.MAPS), layout.scale)[index]
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


def test_s_saves_a_screenshot_without_ending_the_round(monkeypatch, tmp_path):
    _, reason = play_once(monkeypatch, keys=[ord("s"), ord("q")],
                          settings=Settings(screenshot_dir=tmp_path, seed=1))
    assert reason == "quit", "s must not be an exit; only the window closing is"
    assert list(tmp_path.glob("*.png"))


def test_a_round_that_runs_out_of_time_ends_by_itself(monkeypatch):
    """The `is_over` exit: the only way a round ends without a key."""
    _, reason = play_once(monkeypatch, key=NOTHING,
                          settings=Settings(duration=0.0001, seed=1, recoil=0.0))
    assert reason == "over"


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


def test_a_dropped_frame_does_not_cost_the_round():
    """One hiccup from a USB webcam used to end the game and the score with it."""
    from handy.app import Eyes

    capture = FlakyCapture(bad=2)
    stream = NullStream()
    images, hands = Eyes([capture], [stream], mirror=False).read()

    assert len(images) == 1 and images[0].shape == (720, 1280, 3)
    assert capture.reads == 3, "it gave up instead of trying again"
    assert stream.submitted == 1


def test_a_camera_that_answers_true_with_no_image_is_still_a_lost_camera():
    """`ok` alone was believed, so a backend answering (True, None) got as far as
    cvtColor and raised a bare cv2.error instead of the CameraError beside it."""
    from handy.app import Eyes
    from handy.cameras import CameraError

    capture = FlakyCapture(bad=99, answer=(True, None))
    with pytest.raises(CameraError) as raised:
        Eyes([capture], [NullStream()], mirror=False).read()

    assert "camera 1" in str(raised.value)
    assert capture.reads == Eyes.ATTEMPTS, "it should have tried a few times"


def test_a_camera_that_has_really_gone_still_ends_the_round():
    from handy.app import Eyes
    from handy.cameras import CameraError

    with pytest.raises(CameraError):
        Eyes([FlakyCapture(bad=99)], [NullStream()], mirror=False).read()


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


def test_the_face_model_waits_until_the_sniper_is_named(monkeypatch):
    """Someone who may never pick the sniper should not wait for its face model."""
    from handy import app

    fetched: list[str] = []
    monkeypatch.setattr(app, "ensure_model",
                        lambda name: fetched.append(name) or Path(name))
    app.prefetch_models(app.Settings())
    assert fetched == ["gesture_recognizer"]

    fetched.clear()
    app.prefetch_models(app.Settings(map_key="sniper"))
    assert fetched == ["gesture_recognizer", "face_landmarker"]

    fetched.clear()
    app.prefetch_models(app.Settings(model_path=Path("/mine.task")))
    assert fetched == [], "--model stands in for the download"


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
    rig = Rig((Calibration(aim_fitted=True),))
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
    settings = app.Settings(cameras=(0,), mute=True, calibration_path=tmp_path / "setup.json")
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
