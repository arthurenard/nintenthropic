"""The game loop: capture, recognise, aim, score, draw."""

from __future__ import annotations

import contextlib
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
from .calibration import Rig, RigBook, Setup, default_calibration, default_rig
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
CONTROL_KEYS = ("q quit", "r restart", "b maps", "c recalibrate", "s screenshot")

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

    # Aiming. None means: the control scheme's own defaults.
    min_cutoff: float | None = None
    beta: float | None = None
    fire_above: float | None = None
    arm_below: float | None = None

    # Calibration
    calibrate: bool = False
    skip_calibration: bool = False
    calibration_path: Path | None = None

    # Round
    duration: float | None = 60.0

    # Sound and feel
    volume: float = 1.0
    mute: bool = False
    recoil: float = 26.0

    # Map
    map_key: str | None = None
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
    quit_width, maps_width = unit(132), unit(136)
    gap = unit(16)

    quit_button = scene.Button(
        Rect(width - margin - quit_width, margin, quit_width, button_height), "QUIT")
    maps_button = scene.Button(
        Rect(quit_button.rect.x - gap - maps_width, margin, maps_width,
             button_height), "MAPS")

    top = inset.bottom + unit(28)
    play_area = Rect(unit(24), top, width - 2 * unit(24), height - top - unit(56))
    return Layout(
        window=Rect(0, 0, width, height),
        inset=inset,
        play_area=play_area,
        hud=(inset.right + unit(28), margin),
        quit_button=quit_button,
        maps_button=maps_button,
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


#: Maps that lay one panel of their own under the camera and the whole readout,
#: as part of the world (Overwatch Ridge: see ``sniper.hud_panel``). The app's
#: panel on top of theirs was a double panel with a seam down the middle.
OWN_HUD_PANEL = frozenset({"sniper"})

#: Where a map's own readout under the score block starts, in 720-tall units
#: below the origin it is handed (Dead of Night's health bar), and the size of
#: the strip the app lays under it. The strip sits at the foot of the camera,
#: where High Noon keeps its tally on a slab of its own.
READOUT_FIRST = 146
READOUT_SIZE = (268, 60)


def hud_panels(view: View, layout: Layout) -> tuple[Rect | None, Rect | None]:
    """The panels under the score block and under the map's own readout.

    Each is sized to what sits on it, so the map is covered no further than
    the readout reaches: the score panel stops short of the clock beside it,
    and a map's readout gets a strip of its own at the camera's foot. None
    where there is nothing to carry, or where the map lays its own panel.
    """
    if view.map.key in OWN_HUD_PANEL:
        return None, None
    scale = layout.scale
    x, top = layout.hud[0], layout.inset.y
    room = (scene.timer_left(layout.window.width, view.remaining, scale)
            - round(12 * scale) - x)
    score = Rect(x, top, max(1, min(scene.hud_block_width(view.round, scale), room)),
                 round((scene.HUD_LINES["tally"] + 18) * scale))
    if view.map.draw_hud is None:
        return score, None
    width, height = (round(value * scale) for value in READOUT_SIZE)
    y = max(layout.inset.bottom - height, score.bottom + round(10 * scale))
    return score, Rect(x, y, width, height)


def render(canvas: np.ndarray, view: View, layout: Layout) -> None:
    """Compose one frame, bottom layer first. The map owns everything below the HUD."""
    view.map.draw_world(canvas, view.round, view.now)

    scale = layout.scale
    panel, readout = hud_panels(view, layout)
    for rect in (panel, readout):
        if rect is not None:
            scene.draw_chrome_panel(canvas, rect, scale, tab=scene.ACCENT)
    scene.draw_camera_insets(canvas, view.cameras, view.hands, layout.inset,
                             view.camera_states,
                             view.scheme.draw if view.scheme else None, scale)
    note = scene.camera_note(view.camera_states)
    if note is not None:
        # Under the cameras it is about, in the gap above the play area.
        scene.draw_tag(canvas, note[0], (layout.inset.x,
                                         layout.inset.bottom + round(26 * scale)),
                       note[1], scale)
    # On a panel of the app's own the block carries the panel's tab; on a map's
    # panel, the rule down its side that the map's readout continues.
    scene.draw_hud(canvas, view.round, view.aim, layout.hud, view.fps, view.debug,
                   view.camera_states, scale, view.fire_at, rule=panel is None)
    if view.map.draw_hud is not None:
        origin = layout.hud
        if readout is not None:
            # On its strip, lined up with the text above and inset as it is.
            origin = (readout.x + round(14 * scale),
                      readout.y + round((14 - READOUT_FIRST) * scale))
        view.map.draw_hud(canvas, view.round, origin, view.now)
    scene.draw_timer(canvas, view.remaining, scale)
    crosshair = view.crosshair
    for button in (layout.quit_button, layout.maps_button):
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
                             pull=view.aim.travel, fire_at=view.fire_at)


def save_screenshot(image: np.ndarray, directory: Path) -> Path:
    """Write the frame into ``directory`` and say where. OSError if it could not.

    The name carries milliseconds, and never reuses a file already there: at
    one-second resolution two quick presses wrote the same name, and the
    first frame was quietly replaced by the second.
    """
    directory.mkdir(parents=True, exist_ok=True)
    now = time.time()
    stem = (f"handy-{time.strftime('%Y%m%d-%H%M%S', time.localtime(now))}"
            f"-{int(now * 1000) % 1000:03d}")
    path, copy = directory / f"{stem}.png", 1
    while path.exists():
        path, copy = directory / f"{stem}-{copy}.png", copy + 1
    # imwrite reports a failure by returning False, not by raising, and was
    # believed regardless: "Saved" was printed for files that never existed.
    if not cv2.imwrite(str(path), image):
        raise OSError(f"could not write {path}")
    return path


def take_screenshot(canvas: np.ndarray, settings: Settings,
                    scale: float = 1.0) -> Path | None:
    """The 's' key: save the frame, or say on screen why not, and play on.

    A folder that cannot be written to used to raise out of the round - which
    ended it, lost the score, and had main() blame the network.
    """
    try:
        path = save_screenshot(canvas, settings.screenshot_dir)
    except (OSError, cv2.error) as error:
        print(f"Could not save a screenshot in {settings.screenshot_dir}: {error}")
        show_notice(canvas, ["SCREENSHOT NOT SAVED",
                             "The screenshot folder cannot be written to.",
                             "Choose another with --screenshot-dir."],
                    seconds=2.0, scale=scale)
        return None
    print(f"Saved {path}")
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

    The first camera is the one the player faces; any others see the hand from
    somewhere else, and fusion weighs each one's answer by how steady its map is.
    """

    def __init__(self, captures: list[cv2.VideoCapture],
                 streams: list[GestureStream], mirror: bool = True) -> None:
        self.captures = captures
        self.streams = streams
        self.mirror = mirror
        self._last: list[np.ndarray | None] = [None] * len(captures)
        self._failing_since: list[float | None] = [None] * len(captures)

    def __len__(self) -> int:
        return len(self.captures)

    #: How long a camera may go without handing over a frame before the game
    #: gives up on it. A webcam that hiccups - a USB retry, a Continuity camera
    #: catching its breath - drops a frame or a few and carries on, and ending
    #: the round over that costs the player their score for a fault that fixes
    #: itself. Measured in time, not tries: a backend that has failed answers
    #: in microseconds, so four tries in a row were over long before any
    #: hiccup could have passed.
    LOST_AFTER = 1.5

    #: The pause between tries when there is no earlier frame to show instead.
    RETRY_PAUSE = 0.01

    def _grab(self, capture, index: int) -> tuple[np.ndarray, bool]:
        """One frame from one camera, and whether it is a new one.

        While a camera is failing, its last good frame stands in, so the game
        keeps drawing and answering keys; only a camera that has handed over
        nothing for :attr:`LOST_AFTER` seconds raises CameraError. With no
        frame yet to fall back on, it retries with short pauses instead.

        ``read`` reports success in two parts and both have to be believed: a
        backend that answers ``(True, None)`` used to get as far as ``cvtColor``
        inside the recogniser, and a bare OpenCV error instead of the clean
        CameraError that was one line away.
        """
        while True:
            ok, image = capture.read()
            if ok and image is not None:
                self._last[index] = image
                self._failing_since[index] = None
                return image, True
            now = time.monotonic()
            if self._failing_since[index] is None:
                self._failing_since[index] = now
            elif now - self._failing_since[index] >= self.LOST_AFTER:
                raise CameraError(
                    f"Lost the stream from camera {index + 1} - it handed over no "
                    f"frames for {self.LOST_AFTER:g} seconds. Unplugging and "
                    f"replugging it, or restarting the game, usually brings it "
                    f"back.")
            if self._last[index] is not None:
                return self._last[index], False
            time.sleep(self.RETRY_PAUSE)

    def read(self) -> tuple[list[np.ndarray], list[Frame]]:
        """The newest image and hands from each camera."""
        images, hands = [], []
        for index, (capture, stream) in enumerate(zip(self.captures, self.streams)):
            image, fresh = self._grab(capture, index)
            if self.mirror:
                # Mirroring makes the range behave like a looking glass.
                image = cv2.flip(image, 1)
            if fresh:
                # A stand-in frame is not shown to the recogniser again: it
                # has nothing new to say about it.
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
                    previous: Rig | None) -> Rig | None:
    """Use Target Range to learn the aim and verify five centre hits."""
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


def trigger_thresholds(settings: Settings, scheme) -> tuple[float, float]:
    """Fire and re-arm points: the player's flags, else the scheme's own."""
    fire = (settings.fire_above if settings.fire_above is not None
            else getattr(scheme, "fire_above", 0.65))
    arm = (settings.arm_below if settings.arm_below is not None
           else getattr(scheme, "arm_below", 0.35))
    return fire, arm


def make_controller(settings: Settings, scheme) -> AimController:
    cutoff, beta = scheme.smoothing
    fire, arm = trigger_thresholds(settings, scheme)
    return AimController(scheme, fire_above=fire, arm_below=arm,
                         min_cutoff=(settings.min_cutoff
                                     if settings.min_cutoff is not None else cutoff),
                         beta=settings.beta if settings.beta is not None else beta)


class FreshAim:
    """The aim controller, handed each recognition result once.

    The loops run as fast as the cameras do, and a recogniser's ``latest()``
    keeps answering with the same result until the next one lands. Fed twice,
    one misread frame is two of the three readings the trigger's median looks
    at - a majority, and a shot the player never took. So the controller only
    hears from a camera whose result is new; in between, the last aim stands,
    and never fires again.
    """

    def __init__(self, controller: AimController, rig: Rig) -> None:
        self.controller = controller
        self.rig = rig
        self._stamps: tuple[int, ...] | None = None
        self._aim = Aim()

    def update(self, hands: list, now: float) -> Aim:
        stamps = tuple(frame.timestamp_ms for frame in hands)
        if stamps == self._stamps:
            return replace(self._aim, fired=False)
        self._stamps = stamps
        self._aim = self.controller.update(list(zip(hands, self.rig.cameras)), now)
        return self._aim


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
    # Draw the world once before the round's clock can start. The first draw
    # of a map at a new size builds its scenery - seconds, for the richest -
    # and the warm-up thread may not have got to it yet. The clock starts on
    # the round's first update, so a build done inside the first frame came
    # out of the player's sixty seconds. Once warm, this is a millisecond.
    chosen.draw_world(canvas, round_, time.monotonic())
    trigger = FreshAim(controller, rig)

    while True:
        images, hands = eyes.read()
        now = time.monotonic()
        aim = trigger.update(hands, now)
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
        elif key == ord("c"):
            return round_, "recalibrate"
        elif key == ord("n") and chosen.key == "zombies":
            return round_, "enemy"
        elif key == ord("s"):
            take_screenshot(canvas, settings, layout.scale)


def choose_map(eyes: Eyes, canvas: np.ndarray, settings: Settings, layout: Layout,
               controller: AimController, rig: Rig, scheme,
               scores: HighScores) -> tuple[str, Map | None]:
    """The map chooser. Shoot a card to play it."""
    cards = scene.map_cards(layout.window, len(maps.MAPS), layout.scale)
    mouse = Mouse()
    cv2.setMouseCallback(WINDOW_TITLE, mouse.on_event)
    recoil = Recoil(kick=0.0)
    trigger = FreshAim(controller, rig)

    while True:
        images, hands = eyes.read()
        now = time.monotonic()
        aim = trigger.update(hands, now)
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
        scene.draw_button(canvas, layout.quit_button, highlighted=(
            crosshair is not None and layout.quit_button.contains(*crosshair)),
            scale=scale)
        scene.draw_footer(
            canvas, "shoot a card to play   |   q quit   c recalibrate", scale)
        if crosshair is not None:
            scene.draw_crosshair(canvas, *crosshair, armed=aim.armed, since_shot=None,
                                 scale=scale)
        cv2.imshow(WINDOW_TITLE, canvas)

        if aim.fired and crosshair is not None:
            if layout.quit_button.contains(*crosshair):
                return "quit", None
            if aimed is not None:
                return "play", maps.MAPS[aimed]
        if mouse.take_click():
            if layout.quit_button.contains(mouse.x, mouse.y):
                return "quit", None
            picked = _card_under(cards, (mouse.x, mouse.y))
            if picked is not None:
                return "play", maps.MAPS[picked]

        key = cv2.waitKey(1) & 0xFF
        if key in _QUIT_KEYS or window_closed():
            return "quit", None
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


#: How long the score card ignores the gun. A player still firing when the
#: clock ran out has to get the chance to notice the round is over.
RESULTS_GRACE = 1.0


def show_results(eyes: Eyes, canvas: np.ndarray, settings: Settings,
                 layout: Layout, controller: AimController, rig: Rig,
                 summary: Summary, best: int, is_best: bool) -> str:
    """Hold on the score card until the player shoots to play again, or quits.

    A shot counts only once the card has been up for :data:`RESULTS_GRACE`,
    and only from a trigger seen cocked since then. The controller carries on
    from the round, so a player shooting at time-up re-armed and fired
    straight through the card: "again", 0.3 s after the round ended, and the
    score was never seen.
    """
    recoil = Recoil(kick=0.0)  # the round is over; no kick to fight
    mouse = Mouse()
    cv2.setMouseCallback(WINDOW_TITLE, mouse.on_event)
    trigger = FreshAim(controller, rig)
    shown_at = time.monotonic()
    cocked = False

    while True:
        images, hands = eyes.read()
        now = time.monotonic()
        aim = trigger.update(hands, now)
        crosshair = crosshair_for(aim, layout, recoil, now)
        settled = now - shown_at >= RESULTS_GRACE
        shot = aim.fired and cocked
        cocked = cocked or (settled and aim.armed)

        scene.draw_results(canvas, summary, best, is_best,
                           hint="shoot to play again   |   q quit   c recalibrate",
                           scale=layout.scale)
        for button in (layout.quit_button, layout.maps_button):
            scene.draw_button(canvas, button, highlighted=(
                crosshair is not None and button.contains(*crosshair)),
                scale=layout.scale)
        if crosshair is not None:
            # Not shown armed until a shot would count.
            scene.draw_crosshair(canvas, *crosshair, armed=aim.armed and settled,
                                 since_shot=None, scale=layout.scale)
        cv2.imshow(WINDOW_TITLE, canvas)

        if shot and crosshair is not None:
            if layout.quit_button.contains(*crosshair):
                return "quit"
            if layout.maps_button.contains(*crosshair):
                return "maps"
            return "again"
        if mouse.take_click():
            if layout.quit_button.contains(mouse.x, mouse.y):
                return "quit"
            if layout.maps_button.contains(mouse.x, mouse.y):
                return "maps"

        key = cv2.waitKey(1) & 0xFF
        if key in _QUIT_KEYS or window_closed():
            return "quit"
        if key in (ord("r"), ord(" ")):
            return "again"
        if key == ord("b"):
            return "maps"
        if key == ord("c"):
            return "recalibrate"
        if key == ord("s"):
            take_screenshot(canvas, settings, layout.scale)


def rig_setup(settings: Settings, indices: tuple[int, ...]) -> Setup:
    """What a rig fitted now is fitted on: this image, these cameras, this size."""
    return Setup(mirror=settings.mirror, camera_indices=tuple(indices),
                 capture=(settings.capture_width, settings.capture_height))


def saved_rig(book: RigBook, settings: Settings, scheme,
              indices: tuple[int, ...]) -> Rig | None:
    """The saved rig for this scheme, if it was fitted on exactly this setup.

    Reusing a rig skips setup, so it takes proof - see ``Rig.mismatch``.
    Anything less runs setup again: a minute of shooting targets, against a
    session spent aiming with a map that points somewhere else.
    """
    if settings.calibrate:
        return None  # asked for a fresh one
    saved = book.get(schemes.calibration_key(scheme))
    if saved is None:
        return None
    problem = saved.mismatch(rig_setup(settings, indices))
    if problem is not None:
        print(f"Saved {scheme.title.lower()} calibration not reused: {problem}.")
        return None
    return saved


def warm_maps(layout: Layout, settings: Settings) -> None:
    """Build every map's static backdrop once, off the main thread.

    Each map caches the scenery it does not redraw - road, sky, station - the
    first time it is drawn at a given size, and the richest take a couple of
    seconds to build. Done on the first frame of play that is a freeze the
    player feels; done here, it happens while they are still choosing a map.
    A map drawn before its turn simply builds it twice, which is harmless.
    """
    scratch = np.zeros((layout.window.height, layout.window.width, 3), np.uint8)
    for chosen in maps.MAPS:
        try:
            round_ = new_round(settings, layout, chosen)
            round_.update(0.0)
            chosen.draw_world(scratch, round_, 0.0)
            if isinstance(round_, maps.western.WesternRound):
                # High Noon's street is a new picture every hour of the round,
                # not just the first: build the rest now, not as each turns.
                maps.western.build_hours(round_, layout.window.width,
                                         layout.window.height)
            # And the dimmed art the results card will sit on: a tenth of a
            # second to build, and the moment it is wanted is the moment the
            # round ends.
            scene.ambient_backdrop_for(chosen.draw_emblem, layout.window.width,
                                       layout.window.height)
        except Exception as error:  # never let a map's bug kill the warm-up
            print(f"Could not pre-build {chosen.title}: {error}")


def start_warm_up(layout: Layout, settings: Settings) -> threading.Thread:
    """Run :func:`warm_maps` on a worker thread, and hand the thread back."""
    thread = threading.Thread(target=warm_maps, args=(layout, settings), daemon=True,
                              name="warm-maps")
    thread.start()
    return thread


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
    # The download comes before any camera is woken: a network failure, or a
    # Ctrl+C while waiting on one, used to leave the camera light on.
    prefetch_models(settings)
    indices, note = choose_cameras(settings)
    settings = replace(settings, cameras=indices)

    book = RigBook.load(calibration_path(settings))
    scores = HighScores.load(scores_path(settings))
    announce(settings.cameras, note)

    with contextlib.ExitStack() as cleanup:
        # Everything opened from here on is handed back however the game ends.
        # The cameras used to be opened before the try that released them, so
        # a second camera that would not open left the first one running.
        captures = []
        for index in settings.cameras:
            capture = open_camera(index, settings.capture_width,
                                  settings.capture_height)
            cleanup.callback(capture.release)
            captures.append(capture)
        cleanup.callback(display.restore_system_chrome)
        cleanup.callback(cv2.destroyAllWindows)

        width, height = open_window(settings)
        settings = replace(settings, window_width=width, window_height=height)
        layout = layout_for(width, height)
        canvas = np.zeros((height, width, 3), np.uint8)
        start_warm_up(layout, settings)
        try:
            _session(settings, layout, captures, canvas, book, scores)
        except CameraError:
            # A camera that has gone mid-game is said on the screen the
            # player is looking at, not only in the terminal behind it.
            show_notice(canvas, ["CAMERA LOST",
                                 "The camera stopped sending pictures.",
                                 "Reconnect it and start the game again."],
                        seconds=6.0, scale=layout.scale)
            raise


def _bundles_to_fetch(settings: Settings, scheme) -> list[str]:
    """The bundles :func:`model_bundles` would download for ``scheme``."""
    if settings.model_path is None:
        return list(scheme.models)
    # --model stands in for the hand bundle; the scope's face model does not
    # come with it.
    return ["face_landmarker"] if scheme.key == "marksman" else []


def prefetch_models(settings: Settings) -> None:
    """Fetch the bundles this launch can ask for, before the window opens.

    The download is the only part of the game that touches the network, and the
    only place a first run fails without the player having done anything wrong.
    Left where it was - inside the session, behind a fullscreen window - the
    failure arrived as a stack trace under a black screen, and a stalled one
    froze the window. Done here it is a line in the terminal the player is
    still looking at.

    What the opening screen needs has to arrive, or the game cannot start.
    What a map further on needs - the face model behind Overwatch Ridge's
    scope, reachable from every chooser - is fetched too, but a failure there
    is only a warning: the pistol maps are playable without it, and choosing
    the map tries again (and says so on screen if it still cannot).
    """
    needed = _bundles_to_fetch(settings, schemes.for_map(settings.map_key))
    later = [name for chosen in maps.MAPS
             for name in _bundles_to_fetch(settings, schemes.for_map(chosen.key))]
    for name in dict.fromkeys(needed):
        ensure_model(name)
    for name in dict.fromkeys(later):
        if name in needed:
            continue
        try:
            ensure_model(name)
        except OSError as error:
            print(f"Could not fetch the {name.replace('_', ' ')} model ({error}). "
                  f"The maps that need it will try again when chosen.")


class ModelError(RuntimeError):
    """A model bundle that is there, but that MediaPipe will not load."""


def open_streams(stack: contextlib.ExitStack, scheme, paths: list[Path],
                 count: int) -> list:
    """One tracking stream per camera, closed with ``stack``.

    A bundle MediaPipe cannot read - a damaged download, a --model that is not
    a .task file at all - fails here with a bare RuntimeError ("Unable to open
    zip archive"), which used to escape as a traceback. It leaves as a
    ModelError that says which file, and what to do about it.
    """
    try:
        return [stack.enter_context(scheme.open_stream(*paths))
                for _ in range(count)]
    except RuntimeError as error:
        listed = ", ".join(str(path) for path in paths)
        raise ModelError(
            f"Could not load the tracking model ({listed}): {error}. A --model "
            f"has to be a MediaPipe .task bundle; a damaged download can be "
            f"deleted, and the game fetches it again.") from error


def model_bundles(settings: Settings, scheme) -> list[Path]:
    """Resolve tracking models, preserving a hand override when adding the scope."""
    if settings.model_path is None:
        return [ensure_model(name) for name in scheme.models]
    if scheme.key == "marksman":
        return [settings.model_path, ensure_model("face_landmarker")]
    return [settings.model_path]


def _session(settings: Settings, layout: Layout, captures: list,
             canvas: np.ndarray, book: RigBook, scores: HighScores) -> None:
    """Play with hand tracking that adapts to each map, until the player quits."""
    scheme = schemes.for_map(settings.map_key)
    print(f"Controls: {scheme.title.lower()}.")
    model_paths = model_bundles(settings, scheme)
    rig = saved_rig(book, settings, scheme, settings.cameras)
    chosen = maps.by_key(settings.map_key) if settings.map_key else None
    last: Round | None = None
    last_map: Map | None = None

    with contextlib.ExitStack() as stack:
        # However the session ends, no map is in play afterwards.
        stack.callback(scene.set_ambient_art, None)
        stream_stack = stack.enter_context(contextlib.ExitStack())
        streams = open_streams(stream_stack, scheme, model_paths, len(captures))
        audio = stack.enter_context(
            Audio(volume=settings.volume, enabled=not settings.mute))
        eyes = Eyes(captures, streams, mirror=settings.mirror)
        # Synthesised off the main thread: the full set is seconds of DSP, and
        # a stub kit covers the menus until the real one is swapped in. Not
        # synthesised at all when there is no sound to play it through.
        sounds = Sounds(audio, RINGS, background=True, synthesise=audio.is_on)
        if not audio.is_on and audio.reason != "muted":
            print(f"Playing without sound: {audio.reason}")
        needs_setup = rig is None and not settings.skip_calibration

        def calibrate() -> bool:
            """Run setup now. False only if the window has gone."""
            nonlocal rig, needs_setup
            measured = run_calibration(eyes, canvas, layout, scheme, rig)
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
            # Say what it was fitted on: the next launch reuses it only there.
            measured = replace(measured, setup=rig_setup(settings, settings.cameras))
            rig = measured
            book.set(schemes.calibration_key(scheme), measured)
            book.save(calibration_path(settings))
            print(describe(measured))
            # Say it on screen: anything that fell back to the defaults is a
            # part of the game quietly not doing what it should, and a player
            # who does not know that blames the aim.
            # Not inferred from the error figures: when setup falls back it
            # falls back to the PREVIOUS rig, whose errors are those of a fit
            # that did work - so a failed recalibration would look successful.
            unfitted = [index + 1
                        for index, camera in enumerate(measured.cameras)
                        if not camera.aim_fitted]
            if unfitted:
                show_notice(canvas, [
                    "SETUP DID NOT FULLY SUCCEED",
                    "AIM: could not fit camera " + ", ".join(map(str, unfitted)),
                    # With other cameras fitted, the one that failed is left
                    # out of the aim altogether; with none fitted, setup fell
                    # back on the previous or default map, and that is what
                    # aims.
                    "Playing on defaults. Press c to try again."
                    if len(unfitted) == len(measured.cameras) else
                    "It sits this one out. Press c to try again.",
                ], scale=layout.scale)
            return True

        while True:
            layout, canvas = refit(layout, canvas)
            wanted = schemes.for_map(chosen.key if chosen else None)
            if wanted.key != scheme.key:
                # Both read the same hand geometry and trigger. Keep the rig
                # and setup state; replace only the tracking streams - once
                # the new ones' bundles are in hand, so a download that fails
                # leaves the old streams running.
                try:
                    paths = model_bundles(settings, wanted)
                except OSError as error:
                    # Not the end of the game: every other map still plays.
                    # It used to be, from an uncaught URLError.
                    print(f"{chosen.title.title()} needs a model that could "
                          f"not be downloaded: {error}")
                    show_notice(canvas, [
                        "MAP UNAVAILABLE",
                        f"{chosen.title.title()} needs a model that could "
                        f"not be downloaded.",
                        "Check the network and choose it again.",
                    ], scale=layout.scale)
                    chosen = None
                    continue
                stream_stack.close()
                streams = open_streams(stream_stack, wanted, paths, len(captures))
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
            if choice == "maps":
                chosen = None
            needs_setup = choice == "recalibrate"

    if last is not None and last_map is not None:
        print(f"{last_map.title}: {last.result_line()}")


def describe(rig: Rig) -> str:
    """What setup measured, per camera, in words the player can act on."""
    lines = []
    for index, camera in enumerate(rig.cameras, start=1):
        if not camera.aim_fitted:
            fit = ("DEFAULTS - setup could not fit this camera. Sit closer to "
                   "it, light your hand, and recalibrate (c)")
        elif camera.generalisation:
            # Only a save from the old pose-by-pose setup carries this figure.
            fit = (f"predicts a fresh marker within "
                   f"{camera.generalisation * 100:.1f}% of the screen")
        else:
            fit = f"fit {camera.fit_error * 100:.1f}% of screen"
        verdict = "" if camera.usable else "  IGNORED: its view is too side-on"
        lines.append(f"  camera {index}: {fit}, gain {camera.gain:.1f}, "
                     f"built-in thumb gesture (no calibration){verdict}")
    usable = sum(rig.usable)
    headline = ("Calibrated one camera." if len(rig) == 1 else
                f"Calibrated {len(rig)} cameras, {usable} in use.")
    return "\n".join([headline, *lines])
