"""The game loop: capture, recognise, aim, score, draw."""

from __future__ import annotations

import contextlib
import math
import threading
import time
from collections import deque
from dataclasses import dataclass, replace
from pathlib import Path

import cv2
import numpy as np

from . import maps, scene, schemes
from .aiming import Aim, AimController, Recoil, EyeScope
from .audio import Audio, Sounds
from .calibration import CalibrationSession, Rig, RigBook, default_calibration, default_rig
from .shot_calibration import ShotCalibration
from . import display
from .cameras import CameraError, first_live, open_camera
from .game import Rect, Round, RoundOptions, Summary
from .highscores import HighScores
from .maps import Map
from .maps.archery import RINGS
from .models import ensure_model
from .recognition import Frame, GestureStream

WINDOW_TITLE = "Handy"
# No mirror key. Every calibration is fitted against one handedness of the
# landmark stream, and flipping the image mid-round maps x to 1 - x, which the
# fitted homography then sends to the opposite side of the screen: the
# crosshair runs backwards for the rest of the round with nothing said. It is a
# launch-time choice (--no-mirror) so the setup that follows agrees with it.
CONTROL_KEYS = ("q quit", "r restart", "b maps", "e controls", "c recalibrate",
                "s screenshot")
CONTROLS = "   ".join(CONTROL_KEYS)

_QUIT_KEYS = {ord("q"), 27}  # q and Esc
_ESCAPE = 27


@dataclass(frozen=True)
class Settings:
    """Everything the range needs, assembled by the CLI."""

    # Capture
    cameras: tuple[int, ...] = ()  # empty means: find them and use them all
    capture_width: int = 1280
    capture_height: int = 720
    mirror: bool = True
    model_path: Path | None = None

    # Window. The game always fills the screen; these are only the fallback
    # used when the screen cannot be measured, and the size tests draw at.
    window_width: int | None = None
    window_height: int | None = None

    # Aiming. None means: the control scheme's own defaults - a fingertip is a
    # clean signal, a gaze needs a much heavier hand on the filter.
    min_cutoff: float | None = None
    beta: float | None = None
    fire_above: float | None = None
    arm_below: float | None = None

    # Calibration
    calibration_grid: int = 2
    calibrate: bool = False
    skip_calibration: bool = False
    calibration_path: Path | None = None

    # Round
    duration: float | None = 60.0

    # Sound and feel
    volume: float = 1.0
    mute: bool = False
    recoil: float = 26.0

    # Map and controls
    map_key: str | None = None
    control: str | None = "pistol"  # None means: ask on the selection screen
    enemy: str = "zombies"

    # Targets
    targets: int = 3
    spawn_interval: float = 1.1
    lifetime: float = 5.0
    seed: int | None = None

    debug: bool = False
    screenshot_dir: Path = Path("screenshots")


#: The window size everything was drawn for. Every fixed measurement in the
#: interface is expressed against this and scaled to the screen in hand.
REFERENCE_HEIGHT = 720

#: Beyond these the interface stops looking like itself.
SCALE_LIMITS = (0.7, 2.4)


def ui_scale(height: int) -> float:
    """How much to grow the interface for a screen of this height."""
    low, high = SCALE_LIMITS
    return min(max(height / REFERENCE_HEIGHT, low), high)


@dataclass(frozen=True)
class Layout:
    """Where each piece of the window lives."""

    window: Rect
    inset: Rect
    play_area: Rect
    hud: tuple[int, int]
    quit_button: scene.Button
    maps_button: scene.Button
    controls_button: scene.Button
    scale: float = 1.0


def layout_for(width: int, height: int) -> Layout:
    """Camera in the top-left quarter-by-quarter, targets below it.

    Everything fixed is measured in units of a 720-tall window and scaled, so a
    laptop panel and a large display get the same interface rather than the same
    pixel counts - buttons you can hit and text you can read on both.
    """
    scale = ui_scale(height)

    def unit(value: float) -> int:
        return max(1, round(value * scale))

    margin = unit(16)
    inset = Rect(margin, margin, width // 4, height // 4)
    button_height = unit(46)
    quit_width, maps_width, controls_width = unit(132), unit(136), unit(164)
    gap = unit(16)

    quit_button = scene.Button(
        Rect(width - margin - quit_width, margin, quit_width, button_height), "QUIT")
    maps_button = scene.Button(
        Rect(quit_button.rect.x - gap - maps_width, margin, maps_width,
             button_height), "MAPS")
    controls_button = scene.Button(
        Rect(maps_button.rect.x - gap - controls_width, margin, controls_width,
             button_height), "CONTROLS")

    top = inset.bottom + unit(28)
    play_area = Rect(unit(24), top, width - 2 * unit(24), height - top - unit(56))
    return Layout(
        window=Rect(0, 0, width, height),
        inset=inset,
        play_area=play_area,
        hud=(inset.right + unit(28), margin),
        quit_button=quit_button,
        maps_button=maps_button,
        controls_button=controls_button,
        scale=scale,
    )


@dataclass
class Mouse:
    """Pointer state, filled in by OpenCV's callback."""

    x: int = 0
    y: int = 0
    clicked: bool = False

    def on_event(self, event: int, x: int, y: int, flags: int, _param) -> None:
        self.x, self.y = x, y
        if event == cv2.EVENT_LBUTTONDOWN:
            self.clicked = True

    def take_click(self) -> bool:
        """Consume a pending click, if there is one."""
        clicked, self.clicked = self.clicked, False
        return clicked


class FpsMeter:
    """Frames per second, averaged over a short sliding window."""

    def __init__(self, window: int = 30) -> None:
        self._ticks: deque[float] = deque(maxlen=window)

    def tick(self) -> float | None:
        self._ticks.append(time.perf_counter())
        if len(self._ticks) < 2:
            return None
        span = self._ticks[-1] - self._ticks[0]
        return (len(self._ticks) - 1) / span if span > 0 else None


def new_round(settings: Settings, layout: Layout, chosen: Map) -> Round:
    return chosen.create(RoundOptions(
        area=layout.play_area,
        duration=settings.duration,
        seed=settings.seed,
        density=settings.targets,
        spawn_interval=settings.spawn_interval,
        lifetime=settings.lifetime,
        scale=layout.scale,
        enemy=settings.enemy,
    ))


def camera_states(rig: Rig, hands: list) -> tuple[str, ...]:
    """What each camera is contributing right now, in the scene's own words."""
    states = []
    for index, frame in enumerate(hands):
        calibration = rig[index] if index < len(rig) else None
        if calibration is not None and not calibration.usable:
            states.append(scene.IGNORED)
        elif frame.subjects:
            states.append(scene.FUSED)
        else:
            states.append(scene.NO_HAND)
    return tuple(states)


@dataclass(frozen=True)
class View:
    """A snapshot of the range, everything ``render`` needs and nothing more."""

    map: Map
    round: Round
    aim: Aim
    crosshair: tuple[int, int] | None
    cameras: list[np.ndarray]
    hands: list[Frame]
    now: float
    last_shot: float | None = None
    fps: float | None = None
    debug: bool = False
    remaining: float | None = None
    camera_states: tuple[str, ...] = ()
    scheme: object | None = None
    fire_at: float = 0.65  # the trigger threshold, for the crosshair's ring
    scoped: bool = False  # looking down a scope: the map draws the reticle


def aim_pixels(aim: Aim, layout: Layout) -> tuple[int, int] | None:
    """Aim in window pixels. Spans the whole window, so buttons are shootable too."""
    if aim.position is None:
        return None
    return (round(aim.position[0] * (layout.window.width - 1)),
            round(aim.position[1] * (layout.window.height - 1)))


def render(canvas: np.ndarray, view: View, layout: Layout) -> None:
    """Compose one frame, bottom layer first. The map owns everything below the HUD."""
    view.map.draw_world(canvas, view.round, view.now)

    scale = layout.scale
    # The HUD column: inset, score block and the map's own readouts, on a panel.
    hud_right = min(layout.hud[0] + round(430 * scale), layout.controls_button.rect.x - round(16 * scale))
    scene.draw_hud_backing(canvas, Rect(layout.inset.x - round(8 * scale),
                                        layout.inset.y - round(8 * scale),
                                        hud_right - layout.inset.x + round(8 * scale),
                                        layout.play_area.y - layout.inset.y - round(6 * scale)),
                           scale)
    scene.draw_camera_insets(canvas, view.cameras, view.hands, layout.inset,
                             view.camera_states,
                             view.scheme.draw if view.scheme else None, scale)
    scene.draw_hud(canvas, view.round, view.aim, layout.hud, view.fps, view.debug,
                   view.camera_states, scale, view.fire_at)
    if view.map.draw_hud is not None:
        view.map.draw_hud(canvas, view.round, layout.hud, view.now)
    scene.draw_timer(canvas, view.remaining, scale)
    crosshair = view.crosshair
    for button in (layout.quit_button, layout.maps_button, layout.controls_button):
        scene.draw_button(canvas, button, highlighted=(
            crosshair is not None and button.contains(*crosshair)), scale=scale)
    segments = [[view.scheme.footer] if view.scheme and view.scheme.footer else [],
                [view.map.footer] if view.map.footer else [],
                list(CONTROL_KEYS)]
    scene.draw_footer(canvas, scene.fit_hints(segments, layout.window.width, scale),
                      scale)

    describe = getattr(view.scheme, "describe_subject", None) if view.scheme else None
    if view.debug and describe is not None and view.hands and view.hands[0].subjects:
        scene.draw_text(canvas, describe(view.hands[0].subjects[0]),
                        (layout.hud[0], layout.hud[1] + round(206 * scale)),
                        scene.MUTED, scale=0.5 * scale)

    if crosshair is not None and not view.scoped:
        since_shot = None if view.last_shot is None else view.now - view.last_shot
        scene.draw_crosshair(canvas, *crosshair, armed=view.aim.armed,
                             since_shot=since_shot, scale=scale,
                             pull=view.aim.pull, fire_at=view.fire_at)


def save_screenshot(image: np.ndarray, directory: Path) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f"handy-{time.strftime('%Y%m%d-%H%M%S')}.png"
    cv2.imwrite(str(path), image)
    return path


DEFAULT_CALIBRATION_PATH = Path.home() / ".cache" / "handy" / "calibration.json"

#: More than this and each extra camera costs a recogniser for very little gain.
MAX_CAMERAS = 3


def choose_cameras(settings: Settings) -> tuple[tuple[int, ...], str]:
    """Which cameras to play with, and what to say about the choice.

    Named cameras are taken as given. Otherwise one camera is found and used -
    the first that is actually showing a picture.

    Deliberately not "every camera found". A Mac registers virtual cameras that
    stay installed long after whatever fed them was unplugged, and Continuity
    cameras for phones that merely happen to be nearby. They all answer when
    opened, and one of them is usually index 0, so picking them automatically
    means aiming the game at a frozen placeholder. A second camera is worth
    having, but it has to be asked for by name.
    """
    if settings.cameras:
        return settings.cameras[:MAX_CAMERAS], ""

    device = first_live()
    if device is None:
        return (0,), ("No camera showed a live picture. Trying index 0; run "
                      "--list-cameras to see what is connected.")
    return (device.index,), f"Using {device.label} (index {device.index})."


class Eyes:
    """Every camera and its recogniser, read as one.

    The first camera is the one the player faces; any others are there to see the
    hand from somewhere else, which is what lets the game tell distance from
    displacement.
    """

    def __init__(self, captures: list[cv2.VideoCapture],
                 streams: list[GestureStream], mirror: bool = True) -> None:
        self.captures = captures
        self.streams = streams
        self.mirror = mirror

    def __len__(self) -> int:
        return len(self.captures)

    #: How many times a camera may fail to hand over a frame before the round
    #: is given up on. A webcam that hiccups - a USB retry, a Continuity camera
    #: catching its breath - drops a frame or two and carries on, and ending the
    #: round over one dropped frame costs the player their score for a fault
    #: that had already fixed itself. Several failures in a row is a camera that
    #: has actually gone.
    ATTEMPTS = 4

    def _grab(self, capture, index: int) -> np.ndarray:
        """One frame from one camera, retried a few times before giving up.

        ``read`` reports success in two parts and both have to be believed: a
        backend that answers ``(True, None)`` used to get as far as ``cvtColor``
        inside the recogniser, and a bare OpenCV error instead of the clean
        CameraError that was one line away.
        """
        for _ in range(self.ATTEMPTS):
            ok, image = capture.read()
            if ok and image is not None:
                return image
        raise CameraError(
            f"Lost the stream from camera {index + 1} - it stopped handing over "
            f"frames after {self.ATTEMPTS} tries. Unplugging and replugging it, "
            f"or restarting the game, usually brings it back.")

    def read(self) -> tuple[list[np.ndarray], list[Frame]]:
        """The newest image and hands from each camera."""
        images, hands = [], []
        for index, (capture, stream) in enumerate(zip(self.captures, self.streams)):
            image = self._grab(capture, index)
            if self.mirror:
                # Mirroring makes the range behave like a looking glass.
                image = cv2.flip(image, 1)
            stream.submit(image)
            images.append(image)
            hands.append(stream.latest())
        return images, hands


def window_closed() -> bool:
    return cv2.getWindowProperty(WINDOW_TITLE, cv2.WND_PROP_VISIBLE) < 1


#: How long to give macOS to finish its fullscreen animation before trusting
#: the window's reported size, and how many identical readings count as settled.
SETTLE_SECONDS = 2.5
SETTLE_READINGS = 8


def measure_window() -> tuple[int, int] | None:
    """The area the window's picture can fill right now, or None if unknown.

    On macOS the answer is the screen's visible frame, asked of AppKit. It is
    not OpenCV's getWindowImageRect: on the Cocoa backend that call echoes the
    size of the last image shown, whatever the window did with it, so it can
    never notice a band. Elsewhere getWindowImageRect is all there is.
    """
    # First choice: the window's own content view - the very surface the
    # picture is drawn into. The screen's visible frame can be a point off it.
    size = display.window_content_size(WINDOW_TITLE)
    if size is not None:
        return size
    size = display.visible_frame()
    if size is not None:
        return size
    try:
        _, _, width, height = cv2.getWindowImageRect(WINDOW_TITLE)
    except cv2.error:
        return None
    size = (int(width), int(height))
    return size if display.believable(size) else None


def open_window(settings: Settings) -> tuple[int, int]:
    """Open the game's window, filling the screen, and return the size to draw at.

    What a band is, measured on a notched 14" MacBook Pro (panel 1512x982
    points, menu bar 33): OpenCV's WINDOW_FULLSCREEN asks for the whole panel,
    macOS clips the window to the 1512x949 under the menu bar, and the Cocoa
    backend then scales the picture to fit *preserving its aspect ratio* -
    WINDOW_FREERATIO is ignored - so a 1512x982 frame lands as 1461x949 with a
    51-point grey band down the right. Meanwhile getWindowImageRect keeps
    reporting 1512x982, because it reports the image, not the window.

    So the frame is drawn at exactly the size the window can show, measured
    from the screen itself (display.visible_frame), and the only stretch the
    backend can apply is none. FREERATIO is still requested for backends that
    honour it, and the measurement is repeated until it holds still in case
    the menu bar is in the middle of hiding.
    """
    expected = (settings.window_width, settings.window_height)
    if not display.believable(expected):
        expected = display.screen_size()

    cv2.namedWindow(WINDOW_TITLE, cv2.WINDOW_NORMAL | cv2.WINDOW_FREERATIO)
    # A fullscreen game shows no menu bar. Ask before measuring, because the
    # visible frame grows once the bar is gone.
    display.hide_system_chrome()
    cv2.setWindowProperty(WINDOW_TITLE, cv2.WND_PROP_FULLSCREEN, cv2.WINDOW_FULLSCREEN)

    started = time.monotonic()
    last, stable = None, 0
    while time.monotonic() - started < SETTLE_SECONDS:
        size = measure_window()
        if size is None:
            break
        probe = np.zeros((size[1], size[0], 3), np.uint8)
        cv2.imshow(WINDOW_TITLE, probe)
        cv2.waitKey(30)
        stable = stable + 1 if size == last else 1
        last = size
        if stable >= SETTLE_READINGS:
            return size

    if last is not None:
        return last
    print(f"Could not measure the window; drawing at {expected[0]}x{expected[1]}.")
    return expected


def refit(layout: Layout, canvas: np.ndarray) -> tuple[Layout, np.ndarray]:
    """Re-measure the window between screens and rebuild the surface if it moved.

    A display can change under a running game - a projector plugged in, the
    fullscreen animation finishing late - and a frame drawn for the old size
    would be stretched to the new one. Cheap to check, so it is checked.
    """
    size = measure_window()
    if size is None or size == (layout.window.width, layout.window.height):
        return layout, canvas
    print(f"Window is now {size[0]}x{size[1]}; redrawing to fit.")
    return layout_for(*size), np.zeros((size[1], size[0], 3), np.uint8)


def show_notice(canvas: np.ndarray, lines: list[str], seconds: float = 3.0,
                scale: float = 1.0) -> None:
    """Hold a message over the current frame until a key or the time runs out."""
    scene.draw_notice(canvas, lines, scale)
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        cv2.imshow(WINDOW_TITLE, canvas)
        if (cv2.waitKey(40) & 0xFF) != 255 or window_closed():
            return


def calibration_path(settings: Settings) -> Path:
    return settings.calibration_path or DEFAULT_CALIBRATION_PATH


def scores_path(settings: Settings) -> Path:
    return calibration_path(settings).with_name("scores.json")


def run_calibration(eyes: Eyes, canvas: np.ndarray, layout: Layout, scheme,
                    grid: int, previous: Rig | None) -> Rig | None:
    """Use Target Range to learn the aim and verify five centre hits."""
    if scheme.key not in ("pistol", "marksman"):
        return run_pose_calibration(eyes, canvas, layout, scheme, grid, previous)
    session = ShotCalibration(scheme, cameras=len(eyes), previous=previous)
    while True:
        images, frames = eyes.read()
        session.viewport = (canvas.shape[1], canvas.shape[0])
        session.update(frames, time.monotonic())
        scene.draw_shot_calibration(canvas, session, images, frames, scheme.draw,
                                    layout.scale)
        cv2.imshow(WINDOW_TITLE, canvas)
        key = cv2.waitKey(1) & 0xFF
        if key in (_ESCAPE, ord("q")) or window_closed():
            return None
        if session.complete:
            return session.rig
        if key in (8, 127, ord("b")):
            session.undo()
        elif key == ord("r"):
            session = ShotCalibration(scheme, cameras=len(eyes))



def run_pose_calibration(eyes: Eyes, canvas: np.ndarray, layout: Layout, scheme,
                         grid: int, previous: Rig | None) -> Rig | None:
    """Walk the player through the setup poses. None if they skip out of it."""
    session = CalibrationSession(scheme, cameras=len(eyes), grid=grid,
                                 fallback=previous, quick=grid == 2)
    started = time.monotonic()

    while not session.is_done:
        images, hands = eyes.read()
        now = time.monotonic()
        progress = session.update(hands, now)
        pulse = 0.5 + 0.5 * math.sin((now - started) * 4.0)
        scene.draw_calibration(canvas, progress, images, hands, pulse, scheme.draw,
                               layout.scale)
        cv2.imshow(WINDOW_TITLE, canvas)

        key = cv2.waitKey(1) & 0xFF
        if key == _ESCAPE or key == ord("q") or window_closed():
            return None
        if key == ord("r"):
            session.retry(now)
        elif key in (8, 127, ord("b")):
            session.back(now)

    return session.result()


def trigger_thresholds(settings: Settings, scheme) -> tuple[float, float]:
    """Fire and re-arm points: the player's flags, else the scheme's own."""
    fire = (settings.fire_above if settings.fire_above is not None
            else getattr(scheme, "fire_above", 0.65))
    arm = (settings.arm_below if settings.arm_below is not None
           else getattr(scheme, "arm_below", 0.35))
    return fire, arm


def make_controller(settings: Settings, scheme) -> AimController:
    cutoff, beta = getattr(scheme, "smoothing", (1.2, 0.8))
    fire, arm = trigger_thresholds(settings, scheme)
    return AimController(scheme, fire_above=fire, arm_below=arm,
                         min_cutoff=(settings.min_cutoff
                                     if settings.min_cutoff is not None else cutoff),
                         beta=settings.beta if settings.beta is not None else beta,
                         median=getattr(scheme, "trigger_median", True),
                         native_thumb=scheme.key in ("pistol", "marksman"))


def crosshair_for(aim: Aim, layout: Layout, recoil: Recoil,
                  now: float) -> tuple[int, int] | None:
    """The aim point after the gun has kicked, clamped to the window."""
    point = aim_pixels(aim, layout)
    if point is None:
        return None
    shift_x, shift_y = recoil.offset(now)
    return (min(max(round(point[0] + shift_x), 0), layout.window.width - 1),
            min(max(round(point[1] + shift_y), 0), layout.window.height - 1))


#: Sound cues a map's round can raise, and what they sound like.
CUES = {
    "groan": lambda sounds: sounds.groan(),
    "hurt": lambda sounds: sounds.hurt(),
}


def play(eyes: Eyes, canvas: np.ndarray, settings: Settings, layout: Layout,
         controller: AimController, rig: Rig, sounds: Sounds, chosen: Map,
         scheme) -> tuple[Round, str]:
    """One round on one map. Returns the finished round and why it ended."""
    round_ = new_round(settings, layout, chosen)
    if chosen.key == "sniper":
        round_.scope_sensitivity = 0.25
    recoil = Recoil(kick=settings.recoil)
    mouse = Mouse()
    fps = FpsMeter()
    last_shot: float | None = None
    was_armed = False
    scope = EyeScope()
    reads_scope = getattr(scheme, "scope", None)
    cv2.setMouseCallback(WINDOW_TITLE, mouse.on_event)

    while True:
        images, hands = eyes.read()
        now = time.monotonic()
        aim = controller.update(list(zip(hands, rig.cameras)), now)
        crosshair = crosshair_for(aim, layout, recoil, now)

        # Looking down the scope: the eye decides, the map moves its view to
        # follow the hand, and the shot lands where the reticle is fixed.
        scoped = False
        if reads_scope is not None:
            primary = hands[0].subjects[0] if hands and hands[0].subjects else None
            reading = reads_scope(primary) if primary is not None else None
            scoped = scope.update(reading, now)
        round_.look(aim.position, scoped)
        if scoped and round_.scoped_shot is not None and aim.tracking:
            crosshair = round_.scoped_shot

        round_.update(now)
        for cue in round_.take_cues():
            if cue in CUES:
                CUES[cue](sounds)
            else:
                sounds.play_named(cue)

        if aim.armed and not was_armed:
            sounds.cock()  # hearing the pistol re-cock beats reading the HUD
        was_armed = aim.armed

        if aim.fired and crosshair is not None:
            if layout.quit_button.contains(*crosshair):
                return round_, "quit"  # shot the quit button
            if layout.maps_button.contains(*crosshair):
                return round_, "maps"
            if layout.controls_button.contains(*crosshair):
                return round_, "controls"
            sounds.shot()
            impact = round_.shoot(*crosshair, now)
            if chosen.key == "zombies" and round_.options.enemy == "robots" and impact.is_hit:
                sounds.play_named("debris_hit")
            else:
                chosen.play_hit(sounds, impact) if impact.is_hit else sounds.miss()
            recoil.fire(now)
            last_shot = now

        if mouse.take_click():
            if layout.quit_button.contains(mouse.x, mouse.y):
                return round_, "quit"
            if layout.maps_button.contains(mouse.x, mouse.y):
                return round_, "maps"
            if layout.controls_button.contains(mouse.x, mouse.y):
                return round_, "controls"

        render(canvas, View(map=chosen, round=round_, aim=aim, crosshair=crosshair,
                            cameras=images, hands=hands, now=now,
                            last_shot=last_shot, fps=fps.tick(),
                            debug=settings.debug,
                            remaining=round_.remaining(now),
                            camera_states=camera_states(rig, hands),
                            scheme=scheme, scoped=scoped,
                            fire_at=trigger_thresholds(settings, scheme)[0]), layout)
        cv2.imshow(WINDOW_TITLE, canvas)

        if round_.is_over(now):
            return round_, "over"

        key = cv2.waitKey(1) & 0xFF
        if key in _QUIT_KEYS or window_closed():
            return round_, "quit"
        if key == ord("r"):
            return round_, "again"
        elif key == ord("b"):
            return round_, "maps"
        elif key == ord("e"):
            return round_, "controls"
        elif key == ord("c"):
            return round_, "recalibrate"
        elif key == ord("n") and chosen.key == "zombies":
            return round_, "enemy"
        elif key == ord("s"):
            print(f"Saved {save_screenshot(canvas, settings.screenshot_dir)}")


def choose_map(eyes: Eyes, canvas: np.ndarray, settings: Settings, layout: Layout,
               controller: AimController, rig: Rig, scheme,
               scores: HighScores) -> tuple[str, Map | None]:
    """The map chooser. Shoot a card to play it, or the button to change controls."""
    cards = scene.map_cards(layout.window, len(maps.MAPS), layout.scale)
    mouse = Mouse()
    cv2.setMouseCallback(WINDOW_TITLE, mouse.on_event)
    recoil = Recoil(kick=0.0)

    while True:
        images, hands = eyes.read()
        now = time.monotonic()
        aim = controller.update(list(zip(hands, rig.cameras)), now)
        crosshair = crosshair_for(aim, layout, recoil, now)

        entries = []
        for chosen in maps.MAPS:
            best = scores.best_for(chosen.key, settings.duration)
            entries.append((chosen.title, chosen.blurb,
                            f"best {best}" if best else "not yet played",
                            chosen.draw_emblem))
        scale = layout.scale
        aimed = _card_under(cards, crosshair)
        scene.draw_map_select(canvas, cards, tuple(entries), aimed, scale)
        states = camera_states(rig, hands)
        scene.draw_camera_insets(canvas, images, hands, layout.inset, states,
                                 scheme.draw, scale)
        summary, color = scene.camera_summary(states)
        scene.draw_text(canvas, summary,
                        (layout.inset.right + round(28 * scale),
                         layout.inset.y + round(24 * scale)), color, scale=0.55 * scale)
        scene.draw_text(canvas, f"controls: {scheme.title.lower()}",
                        (layout.inset.right + round(28 * scale),
                         layout.inset.y + round(48 * scale)),
                        scene.MUTED, scale=0.5 * scale)
        for button in (layout.quit_button, layout.controls_button):
            scene.draw_button(canvas, button, highlighted=(
                crosshair is not None and button.contains(*crosshair)), scale=scale)
        scene.draw_footer(
            canvas, "shoot a card to play   |   e controls   q quit   c recalibrate",
            scale)
        if crosshair is not None:
            scene.draw_crosshair(canvas, *crosshair, armed=aim.armed, since_shot=None,
                                 scale=scale)
        cv2.imshow(WINDOW_TITLE, canvas)

        if aim.fired and crosshair is not None:
            if layout.quit_button.contains(*crosshair):
                return "quit", None
            if layout.controls_button.contains(*crosshair):
                return "controls", None
            if aimed is not None:
                return "play", maps.MAPS[aimed]
        if mouse.take_click():
            if layout.quit_button.contains(mouse.x, mouse.y):
                return "quit", None
            if layout.controls_button.contains(mouse.x, mouse.y):
                return "controls", None
            picked = _card_under(cards, (mouse.x, mouse.y))
            if picked is not None:
                return "play", maps.MAPS[picked]

        key = cv2.waitKey(1) & 0xFF
        if key in _QUIT_KEYS or window_closed():
            return "quit", None
        if key == ord("e"):
            return "controls", None
        if key == ord("c"):
            return "recalibrate", None
        if key in (ord(str(index + 1)) for index in range(len(maps.MAPS))):
            return "play", maps.MAPS[int(chr(key)) - 1]


def _card_under(cards: tuple, point: tuple[int, int] | None) -> int | None:
    if point is None:
        return None
    for index, card in enumerate(cards):
        if card.contains(*point):
            return index
    return None


def show_results(eyes: Eyes, canvas: np.ndarray, settings: Settings,
                 layout: Layout, controller: AimController, rig: Rig,
                 summary: Summary, best: int, is_best: bool) -> str:
    """Hold on the score card until the player shoots to play again, or quits."""
    recoil = Recoil(kick=0.0)  # the round is over; no kick to fight
    mouse = Mouse()
    cv2.setMouseCallback(WINDOW_TITLE, mouse.on_event)

    while True:
        images, hands = eyes.read()
        now = time.monotonic()
        aim = controller.update(list(zip(hands, rig.cameras)), now)
        crosshair = crosshair_for(aim, layout, recoil, now)

        scene.draw_results(canvas, summary, best, is_best,
                           hint="shoot to play again   |   q quit   c recalibrate",
                           scale=layout.scale)
        for button in (layout.quit_button, layout.maps_button,
                       layout.controls_button):
            scene.draw_button(canvas, button, highlighted=(
                crosshair is not None and button.contains(*crosshair)),
                scale=layout.scale)
        if crosshair is not None:
            scene.draw_crosshair(canvas, *crosshair, armed=aim.armed, since_shot=None,
                                 scale=layout.scale)
        cv2.imshow(WINDOW_TITLE, canvas)

        if aim.fired and crosshair is not None:
            if layout.quit_button.contains(*crosshair):
                return "quit"
            if layout.maps_button.contains(*crosshair):
                return "maps"
            if layout.controls_button.contains(*crosshair):
                return "controls"
            return "again"
        if mouse.take_click():
            if layout.quit_button.contains(mouse.x, mouse.y):
                return "quit"
            if layout.maps_button.contains(mouse.x, mouse.y):
                return "maps"
            if layout.controls_button.contains(mouse.x, mouse.y):
                return "controls"

        key = cv2.waitKey(1) & 0xFF
        if key in _QUIT_KEYS or window_closed():
            return "quit"
        if key in (ord("r"), ord(" ")):
            return "again"
        if key == ord("b"):
            return "maps"
        if key == ord("e"):
            return "controls"
        if key == ord("c"):
            return "recalibrate"
        if key == ord("s"):
            print(f"Saved {save_screenshot(canvas, settings.screenshot_dir)}")


def cameras_for(scheme, indices: tuple[int, ...]) -> tuple[int, ...]:
    """Which of the available cameras this scheme will actually use."""
    limit = getattr(scheme, "max_cameras", None)
    return indices if limit is None else tuple(indices[:limit])


def saved_rig(book: RigBook, settings: Settings, scheme,
              in_use: int) -> Rig | None:
    """The saved rig for this scheme, if it still matches the cameras in use."""
    if settings.calibrate:
        return None  # asked for a fresh one
    saved = book.get(schemes.calibration_key(scheme))
    if saved is None:
        return None
    if len(saved) != in_use:
        print(f"Saved {scheme.title.lower()} calibration is for {len(saved)} "
              f"camera(s) but {in_use} in use: setup again.")
        return None
    return saved


SCHEME_EMBLEMS = {"pistol": scene.pistol_emblem, "gaze": scene.gaze_emblem,
                  "marksman": scene.marksman_emblem}


def select_scheme(canvas: np.ndarray, layout: Layout):
    """Hand control instructions, acknowledged by mouse or keyboard.

    Runs before any camera stream is open - each scheme needs its own model and
    recogniser, so nothing is listening yet and there is no crosshair to shoot
    with. A click or a number key is the whole interaction.
    """
    cards = scene.map_cards(layout.window, len(schemes.CONTROLS), layout.scale)
    entries = tuple((scheme.title, scheme.blurb, scheme.footer,
                     SCHEME_EMBLEMS[scheme.key]) for scheme in schemes.CONTROLS)
    mouse = Mouse()
    cv2.setMouseCallback(WINDOW_TITLE, mouse.on_event)

    while True:
        hovered = _card_under(cards, (mouse.x, mouse.y))
        scene.draw_scheme_select(canvas, cards, entries, hovered, layout.scale)
        scene.draw_footer(canvas, "1 finger pistol   |   sniper adds an eye scope automatically"
                          "   |   q quit", layout.scale)
        cv2.imshow(WINDOW_TITLE, canvas)

        if mouse.take_click() and hovered is not None:
            return schemes.CONTROLS[hovered]

        key = cv2.waitKey(30) & 0xFF
        if key in _QUIT_KEYS or window_closed():
            return None
        if key in (ord(str(index + 1)) for index in range(len(schemes.CONTROLS))):
            return schemes.CONTROLS[int(chr(key)) - 1]


def next_scheme(current) -> object:
    """Return to hand controls; the selected map owns the scope extension."""
    return schemes.PISTOL


def warm_maps(layout: Layout, settings: Settings) -> None:
    """Build every map's static backdrop once, off the main thread.

    Each map caches the scenery it does not redraw - road, sky, station - the
    first time it is drawn at a given size, and the richest take a couple of
    seconds to build. Done on the first frame of play that is a freeze the
    player feels; done here, it happens while they are still choosing how to
    aim. A map drawn before its turn simply builds it twice, which is harmless.
    """
    scratch = np.zeros((layout.window.height, layout.window.width, 3), np.uint8)
    for chosen in maps.MAPS:
        try:
            round_ = new_round(settings, layout, chosen)
            round_.update(0.0)
            chosen.draw_world(scratch, round_, 0.0)
            # And the dimmed art the results card will sit on: a tenth of a
            # second to build, and the moment it is wanted is the moment the
            # round ends.
            scene.ambient_backdrop_for(chosen.draw_emblem, layout.window.width,
                                       layout.window.height)
        except Exception as error:  # never let a map's bug kill the warm-up
            print(f"Could not pre-build {chosen.title}: {error}")


def announce(indices: tuple[int, ...], note: str) -> None:
    if note:
        print(note)
    if len(indices) == 1:
        print("A second camera off to the side makes the aim steadier. "
              "See --list-cameras, then pass --camera twice.")
    else:
        listed = ", ".join(str(index) for index in indices)
        print(f"Using {len(indices)} cameras (indices {listed}), fused.")


def run(settings: Settings) -> None:
    """Open the game and play until the user quits."""
    indices, note = choose_cameras(settings)
    settings = replace(settings, cameras=indices)
    captures = [open_camera(index, settings.capture_width, settings.capture_height)
                for index in settings.cameras]

    book = RigBook.load(calibration_path(settings))
    scores = HighScores.load(scores_path(settings))
    announce(settings.cameras, note)
    prefetch_models(settings)

    width, height = open_window(settings)
    settings = replace(settings, window_width=width, window_height=height)
    layout = layout_for(width, height)
    canvas = np.zeros((height, width, 3), np.uint8)
    threading.Thread(target=warm_maps, args=(layout, settings), daemon=True,
                     name="warm-maps").start()
    try:
        if settings.control:
            scheme = schemes.by_key(settings.control)
        elif len(schemes.CONTROLS) == 1:
            scheme = schemes.PISTOL
        else:
            scheme = select_scheme(canvas, layout)
        if scheme is not None and scheme.key in ("pistol", "marksman"):
            scheme = schemes.for_map(settings.map_key)
        while scheme is not None:
            print(f"Controls: {scheme.title.lower()}.")
            # Each scheme watches for something different, so switching between
            # them means new recognisers - hence a session per scheme.
            scheme = _session(scheme, settings, layout, captures, canvas, book,
                              scores)
    finally:
        for capture in captures:
            capture.release()
        cv2.destroyAllWindows()
        display.restore_system_chrome()


def prefetch_models(settings: Settings) -> None:
    """Fetch the bundles this launch will certainly need, before the window opens.

    The download is the only part of the game that touches the network, and the
    only place a first run fails without the player having done anything wrong.
    Left where it was - inside the session, behind a fullscreen window - the
    failure arrived as a stack trace under a black screen. Done here it is a
    line in the terminal the player is still looking at.

    Only what is certain: with no ``--control`` the player has yet to choose a
    scheme, and downloading a face model for someone who is about to pick the
    pistol is not an improvement.
    """
    if settings.model_path is not None:
        if settings.map_key == "sniper":
            ensure_model("face_landmarker")
        return
    scheme = None
    if settings.control:
        scheme = schemes.by_key(settings.control)
        if scheme.key == "pistol":
            scheme = schemes.for_map(settings.map_key)
    elif settings.map_key == "sniper":
        scheme = schemes.for_map(settings.map_key)
    if scheme is None:
        return
    for name in scheme.models:
        ensure_model(name)


def model_bundles(settings: Settings, scheme) -> list[Path]:
    """Resolve tracking models, preserving a hand override when adding the scope."""
    if settings.model_path is None:
        return [ensure_model(name) for name in scheme.models]
    if scheme.key == "marksman":
        return [settings.model_path, ensure_model("face_landmarker")]
    if len(scheme.models) != 1:
        wanted = ", ".join(name.replace("_", " ") for name in scheme.models)
        raise ValueError(
            f"--model names one bundle, but {scheme.title.lower()} needs "
            f"{len(scheme.models)} ({wanted}). Drop --model to let the game "
            f"fetch them, or choose a control scheme that uses one.")
    return [settings.model_path]


def _session(scheme, settings: Settings, layout: Layout,
             captures: list, canvas: np.ndarray, book: RigBook,
             scores: HighScores):
    """Play with hand tracking that adapts to each map. None means stop."""
    if scheme.key in ("pistol", "marksman"):
        scheme = schemes.for_map(settings.map_key)
    model_paths = model_bundles(settings, scheme)
    indices = cameras_for(scheme, settings.cameras)
    captures = captures[:len(indices)]
    if len(indices) < len(settings.cameras):
        spare = len(settings.cameras) - len(indices)
        print(f"{scheme.title.title()} uses {len(indices)} camera; "
              f"{spare} left idle - a second view has nothing to add to it.")
    rig = saved_rig(book, settings, scheme, len(indices))
    chosen = maps.by_key(settings.map_key) if settings.map_key else None
    last: Round | None = None
    last_map: Map | None = None
    switch_to = None

    with contextlib.ExitStack() as stack:
        # However this session ends, no map is in play afterwards: the scheme
        # chooser and the next session's menus go back to the plain grid.
        stack.callback(scene.set_ambient_art, None)
        stream_stack = stack.enter_context(contextlib.ExitStack())
        streams = [stream_stack.enter_context(scheme.open_stream(*model_paths))
                   for _ in captures]
        audio = stack.enter_context(
            Audio(volume=settings.volume, enabled=not settings.mute))
        eyes = Eyes(captures, streams, mirror=settings.mirror)
        # Synthesised off the main thread: the full set is seconds of DSP, and
        # a stub kit covers the menus until the real one is swapped in.
        sounds = Sounds(audio, RINGS, background=True)
        if not audio.is_on and audio.reason != "muted":
            print(f"Playing without sound: {audio.reason}")
        needs_setup = rig is None and not settings.skip_calibration

        def calibrate() -> bool:
            """Run setup now. False only if the window has gone."""
            nonlocal rig, needs_setup
            measured = run_calibration(eyes, canvas, layout, scheme,
                                       settings.calibration_grid, rig)
            if measured is None:
                # Backed out - and 'q' quits on every other screen, so this is
                # as often a reflex as a decision. Asking again before every
                # round would be nagging; saying nothing at all left the player
                # aiming on defaults with no idea why, and with no hint that
                # 'c' brings setup back. So: ask once, say so, move on.
                needs_setup = False
                if rig is None:
                    show_notice(canvas, [
                        "SETUP SKIPPED",
                        "Playing on the built-in defaults; the aim will be "
                        "approximate.",
                        "Press c whenever you want to run it.",
                    ], scale=layout.scale)
                return not window_closed()
            needs_setup = False
            rig = measured
            book.set(schemes.calibration_key(scheme), measured)
            book.save(calibration_path(settings))
            print(describe(measured, native_thumb=scheme.key in ("pistol", "marksman")))
            # Say it on screen: anything that fell back to the defaults is a
            # part of the game quietly not doing what it should, and a player
            # who does not know that blames the aim.
            # Not inferred from the error figures: when setup falls back it
            # falls back to the PREVIOUS rig, whose errors are those of a fit
            # that did work - so a failed recalibration would look successful.
            unfitted = [index + 1
                        for index, camera in enumerate(measured.cameras)
                        if not camera.aim_fitted]
            untriggered = [index + 1
                           for index, camera in enumerate(measured.cameras)
                           if not camera.trigger_fitted and scheme.key not in ("pistol", "marksman")]
            if unfitted or untriggered:
                trouble = []
                if unfitted:
                    trouble.append("AIM: could not fit camera "
                                   + ", ".join(map(str, unfitted)))
                if untriggered:
                    trouble.append("TRIGGER: the two poses looked too alike")
                show_notice(canvas, [
                    "SETUP DID NOT FULLY SUCCEED", *trouble,
                    "Playing on defaults there. Press c to try again.",
                ], scale=layout.scale)
            return True

        while True:
            layout, canvas = refit(layout, canvas)
            if scheme.key in ("pistol", "marksman"):
                wanted = schemes.for_map(chosen.key if chosen else None)
                if wanted.key != scheme.key:
                    # Both read the same hand geometry and trigger. Keep the
                    # rig and setup state; replace only the tracking streams.
                    paths = model_bundles(settings, wanted)
                    stream_stack.close()
                    streams = [stream_stack.enter_context(wanted.open_stream(*paths))
                               for _ in captures]
                    scheme = wanted
                    eyes = Eyes(captures, streams, mirror=settings.mirror)
            # The menus that follow a round sit on the map's own art, dimmed;
            # the chooser and the setup screen belong to no map, so they get
            # the plain grid back.
            scene.set_ambient_art(chosen.draw_emblem if chosen else None)
            current = (rig or default_rig(scheme, len(eyes))).resized(
                len(eyes), fill=default_calibration(scheme))
            controller = make_controller(settings, scheme)
            if chosen is None:
                reason, picked = choose_map(eyes, canvas, settings, layout,
                                            controller, current, scheme, scores)
                if reason == "quit":
                    break
                if reason == "controls":
                    switch_to = next_scheme(scheme)
                    break
                if reason == "recalibrate":
                    if not calibrate():
                        break
                    continue
                chosen = picked
                continue

            last_map = chosen
            # Setup runs here, at the moment aiming is about to matter - never
            # as a toll booth in front of the chooser.
            if needs_setup and not calibrate():
                break
            current = (rig or default_rig(scheme, len(eyes))).resized(
                len(eyes), fill=default_calibration(scheme))
            controller = make_controller(settings, scheme)
            last, reason = play(eyes, canvas, settings, layout, controller,
                                current, sounds, chosen, scheme)
            if reason == "quit":
                break
            if reason == "controls":
                switch_to = next_scheme(scheme)
                break
            if reason == "recalibrate":
                needs_setup = True
                continue
            if reason == "again":
                continue
            if reason == "enemy":
                settings = replace(settings, enemy=("robots" if settings.enemy == "zombies"
                                                    else "zombies"))
                continue
            if reason == "maps":
                chosen = None
                continue

            summary = last.summary()
            sounds.round_over()
            previous_best = scores.best_for(chosen.key, summary.duration)
            is_best = scores.record(chosen.key, summary.duration, summary.score)
            choice = show_results(eyes, canvas, settings, layout, controller,
                                  current, summary, previous_best, is_best)
            if choice == "quit":
                break
            if choice == "controls":
                switch_to = next_scheme(scheme)
                break
            if choice == "maps":
                chosen = None
            needs_setup = choice == "recalibrate"

    if last is not None and last_map is not None:
        print(f"{last_map.title}: {last.result_line()}")
    return switch_to


def describe(rig: Rig, *, native_thumb=False) -> str:
    """What setup measured, per camera, in words the player can act on."""
    lines = []
    for index, camera in enumerate(rig.cameras, start=1):
        if not camera.aim_fitted:
            fit = ("DEFAULTS - the trace could not predict itself. Sit closer "
                   "to the camera, light your face, and recalibrate (c)")
        elif camera.generalisation:
            fit = (f"predicts a fresh marker within "
                   f"{camera.generalisation * 100:.1f}% of the screen")
        else:
            fit = f"fit {camera.fit_error * 100:.1f}% of screen"
        slide = math.hypot(*camera.slide)
        verdict = "" if camera.usable else "  IGNORED: its view is too side-on"
        if native_thumb:
            lines.append(f"  camera {index}: {fit}, gain {camera.gain:.1f}, "
                         f"built-in thumb gesture (no calibration){verdict}")
            continue
        trigger = ("measured" if camera.trigger_fitted
                   else "DEFAULTS - the two poses were too alike to tell apart")
        lines.append(
            f"  camera {index}: {fit}, gain {camera.gain:.1f}, "
            f"depth slide {slide * 100:.1f}% of screen, "
            f"trigger on {camera.signal} {camera.cocked:.2f} -> "
            f"{camera.folded:.2f} ({trigger}){verdict}")
    usable = sum(rig.usable)
    headline = ("Calibrated one camera." if len(rig) == 1 else
                f"Calibrated {len(rig)} cameras, {usable} in use.")
    return "\n".join([headline, *lines])
