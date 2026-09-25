"""Local browser adapter for the four-game arcade and its Target Range warm-up.

No desktop window or server-owned camera. The browser sends a small mirrored
camera frame to the loopback server; inference and rendering stay on this Mac.
Run with ``python -m handy.browser`` (or ``python -m handy --browser``).
"""

from __future__ import annotations

import argparse
from dataclasses import replace
import json
import math
import secrets
import sys
import threading
import time
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

import cv2
import numpy as np

from . import maps, scene, schemes
from .aiming import Aim, AimController, EyeScope
from .calibration import Rig, default_rig
from .maps import orbit, zombies
from .maps.archery import RINGS
from .shot_calibration import REQUIRED_HITS, ShotCalibration
from .game import Rect, RoundOptions
from .models import ensure_model
from .recognition import Frame, HAND_CONNECTIONS

WEB_ROOT = Path(__file__).with_name("web")
WIDTH, HEIGHT = 960, 540
MAX_BODY = 1_500_000
#: Seconds without a request after which the open game is presumed abandoned.
IDLE_TIMEOUT = 60.0
#: Seconds a camera frame waits for its own hand (and face) reading. MediaPipe
#: answers in about 6 ms; reading without waiting aimed from the frame before,
#: a whole camera frame late. Bounded, because a frame the recogniser drops is
#: never answered: after this long the newest reading there is stands in.
RESULT_WAIT = 0.025


def number(value, low, high):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError("Expected a number")
    if not math.isfinite(value) or not low <= value <= high:
        raise ValueError(f"Expected a number between {low} and {high}")
    return value


#: The most pixels a frame is drawn with: a 1920 by 1080 frame's worth. Drawing
#: and encoding grow with the area - at this size 5 to 8 ms a frame on an
#: M-series Mac, against about 2 at 960 wide - and a Retina stage would
#: otherwise ask for four times as many.
MAX_PIXELS = 1920 * 1080
#: The crosshair's scale on a 960-wide frame; it grows with the frame.
CROSSHAIR = 0.75


def stage_size(size):
    """The canvas (width, height) to draw a stage ``size`` device pixels big.

    The stage's own shape and resolution, so the page can show each frame
    pixel for pixel instead of stretching it: never fewer pixels than the
    960-wide frame the maps were designed at, nor more than ``MAX_PIXELS``.
    Shapes beyond 1:4 and 8:1 are drawn at the nearest one the renderer
    supports. A short or narrow window is not a mistake to refuse: the page
    sends its size with every frame, and one refusal would end the game.
    """
    if not isinstance(size, (list, tuple)) or len(size) != 2:
        raise ValueError("Expected a stage width and height")
    width, height = (number(side, 0, math.inf) for side in size)
    aspect = min(max(width / height if height else 8, 0.25), 8)
    # The designed frame: 960 wide, or 900 tall for a stage narrower than that.
    base = min(900, WIDTH / aspect)
    zoom = min(width / (base * aspect), height / base)
    zoom = max(1, min(zoom, math.sqrt(MAX_PIXELS / (base * base * aspect))))
    height = round(base * zoom)
    return min(round(height * aspect), MAX_PIXELS // height), height


def jpeg(image):
    ok, encoded = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, 82])
    if not ok:
        raise ValueError("Could not encode the game frame")
    return encoded.tobytes()


#: The frame exchange's format, both ways: a four-byte big-endian length, that
#: many bytes of JSON, then a JPEG or nothing. Base64 inside JSON made every
#: picture a third larger and cost an encode and a decode on each side.
FRAME_TYPE = "application/x-handy-frame"


def pack(data, image=b""):
    head = json.dumps(data, allow_nan=False).encode()
    return len(head).to_bytes(4, "big") + head + image


def unpack(body):
    """The JSON fields of a frame message, and the JPEG after them."""
    size = int.from_bytes(body[:4], "big")
    if len(body) < 4 or size > len(body) - 4:
        raise ValueError("Invalid frame")
    return json.loads(body[4 : 4 + size]), body[4 + size :]


#: Start-of-frame markers: every JPEG coding - baseline, progressive, lossless,
#: arithmetic - declares the image size in one of these.
FRAME_MARKERS = frozenset(range(0xC0, 0xD0)) - {0xC4, 0xC8, 0xCC}


def jpeg_size(raw):
    """The (width, height) a JPEG declares, read from its header alone.

    Decoding first and checking after would let a few hundred bytes that claim
    to be 30000 by 30000 pixels allocate gigabytes before any check ran.
    """
    at = 2  # past the start-of-image marker
    while at + 4 <= len(raw) and raw[at] == 0xFF:
        marker = raw[at + 1]
        if marker == 0xFF:  # padding before a marker
            at += 1
        elif marker == 0x01 or 0xD0 <= marker <= 0xD7:  # markers without a length
            at += 2
        elif marker in (0xD9, 0xDA):  # the image ended, or its data began
            break
        else:
            length = int.from_bytes(raw[at + 2 : at + 4], "big")
            if marker in FRAME_MARKERS and length >= 7 and at + 9 <= len(raw):
                height = int.from_bytes(raw[at + 5 : at + 7], "big")
                return int.from_bytes(raw[at + 7 : at + 9], "big"), height
            if length < 2:
                break
            at += 2 + length
    raise ValueError("Invalid camera frame")


def saved_rig(saved):
    """The one-camera rig the page stored, or an error if it is unusable.

    It comes back from browser storage - perhaps written by an older version,
    perhaps edited by hand. ``Calibration`` itself refuses anything
    non-finite, so what is left to check here is the camera count.
    """
    rig = Rig.from_dict(saved)
    if len(rig) != 1:
        raise ValueError("Browser calibration uses one camera")
    return rig




#: Shots the warm-up learns from before it checks the aim.
LEARNING_SHOTS = 3


def setup_words(setup, event):
    """What the warm-up says now: a short instruction and the line under it.

    Worded here rather than taken from ``ShotCalibration.message``, which the
    desktop draws in its own voice and layout. ``event`` is what the last shot
    did (see ``BrowserSession._setup_event``), or None before the first.
    """
    left = REQUIRED_HITS - len(setup.hits)
    if setup.complete:
        return "Aim set.", "Here we go."
    if event == "raise":
        return "Raise your thumb first.", "Then aim, and fold it to fire."
    if event == "retry":
        return "Try that one again.", "Point right at the lit target."
    if event == "undo":
        return "Shot undone.", "Point at the lit target and fire again."
    if setup.testing:
        if event == "hit":
            return ("Nice." if left > 1 else "One more."), (
                f"{left} centre hits to go." if left > 1 else "Hit the centre to start."
            )
        if event == "miss":
            return "Just off the centre.", "Try this one again."
        if event == "adjusted":
            return "Aim adjusted.", "Five centre hits start your game."
        if event == "learned":
            return "Got it.", "Now hit five centres to start your game."
        if setup.hits:
            return f"{left} to go.", "Aim for the centre."
        return "Hit five centres.", "Five centre hits start your game."
    if event == "relearn":
        return "Let’s tune your aim.", "Shoot the lit target."
    shots = len(setup.samples)
    if shots == 0:
        return "Shoot the lit target.", "Point at it, then fold your thumb to fire."
    if shots == 1:
        return "Now the next one.", "Your crosshair appears after this shot."
    return "One more.", "Then you’ll check your aim."


def title_case(words):
    """'PANE HELD' as a player reads it: 'Pane Held'."""
    return " ".join(word.capitalize() for word in words.split())


def readouts(chosen, round_, now):
    """The few numbers a map's round lives by, for the page's score panel.

    Each is a label and a value; a meter also has a ``max``, and one that
    should worry the player a ``tone``. Read from what each round exposes -
    the desktop draws the same numbers in its own HUD. A value a round does
    not have (another version of a map, say) is left out rather than failing
    the frame.
    """
    found = []

    def add(label, value, **extra):
        if value is not None:
            extra = {name: v for name, v in extra.items() if v is not None}
            found.append({"label": label, "value": value, **extra})

    def read(name, *args):
        attribute = getattr(round_, name, None)
        try:
            return attribute(*args) if callable(attribute) else attribute
        except (TypeError, ValueError, ArithmeticError):
            return None

    if chosen.key == "zombies":
        health = read("health")
        if health is not None:
            full = getattr(zombies, "FULL_HEALTH", 100)
            low = getattr(zombies, "LOW_HEALTH", full / 3)
            add("Health", health, max=full, tone="danger" if health <= low else None)
        add("Wave", read("wave", now))
        add("Down", read("kills"))
    elif chosen.key == "orbit":
        pane = read("integrity")
        if pane is not None:
            full = getattr(orbit, "FULL_INTEGRITY", 100)
            low = getattr(orbit, "ALARM_INTEGRITY", full / 3)
            add("Pane", pane, max=full, tone="danger" if pane <= low else None)
        add("Cleared", read("cleared"))
    elif chosen.key == "sniper":
        wind = read("wind")
        if wind is not None:
            arrow = "→" if wind > 0.05 else "←" if wind < -0.05 else ""
            add("Wind", f"{abs(wind):.1f} m/s {arrow}".strip())
        add("Stage", read("stage", now))
        add("Hostiles", read("remaining_hostiles"))
    elif chosen.key == "western":
        add("Bandits", read("bandits_down"))
        add("Bottles", read("bottles_broken"))
        folk = read("townsfolk_hit")
        add("Townsfolk", folk, tone="danger" if folk else None)
    return found


#: The one stat of each map's own on the results card, after the shared three.
RESULT_STAT = {
    "zombies": ("Down", "kills"),
    "western": ("Bandits", "bandits_down"),
    "orbit": ("Cleared", "cleared"),
    "sniper": ("Down", "kills"),
}


def results(chosen, round_):
    """The results card's outcome and its three or four stats."""
    summary = round_.summary()
    stats = [
        {"label": "Accuracy", "value": f"{summary.accuracy:.0%}"},
        {"label": "Best Streak", "value": str(summary.best_streak)},
        {"label": title_case(summary.perfect_label), "value": str(summary.perfect)},
    ]
    label, name = RESULT_STAT.get(chosen.key, (None, None))
    value = getattr(round_, name, None) if name else None
    if isinstance(value, int):
        stats.append({"label": label, "value": f"{value:,}"})
    return {
        "outcome": title_case(summary.outcome) if summary.outcome else "Time’s Up",
        "won": summary.won,
        "lost": bool(summary.outcome) and not summary.won,
        "hits": summary.hits,
        "shots": summary.shots,
        "stats": stats,
    }


class CueRecorder:
    """Stands in for the desktop's ``Sounds`` when a map voices a hit.

    Each map says how its hits sound by calling its sound set (``Map.play_hit``);
    handed this instead, the call writes down the name the page plays it by.
    """

    def __init__(self, cues):
        self.cues = cues

    def hit(self, ring):
        self.cues.append(f"hit_{min(max(ring, 0), RINGS - 1)}")

    def flesh(self, headshot):
        self.cues.append("flesh_head" if headshot else "flesh_body")

    def play_named(self, name):
        self.cues.append(name)

    def groan(self):
        self.cues.append("groan")

    def hurt(self):
        self.cues.append("hurt")


class BrowserSession:
    def __init__(self, config):
        view = config.get("viewSize")
        # The size the stage last asked for, and the size frames are drawn at:
        # they differ while a round laid out for the old size plays on.
        self.view = stage_size((WIDTH, HEIGHT) if view is None else view)
        self.width, self.height = self.view
        try:
            self.map = maps.by_key(config.get("map", maps.DEFAULT.key))
        except KeyError as error:
            raise ValueError("Choose one of the four games.") from error
        if self.map.key not in maps.keys():
            raise ValueError("Choose one of the four games.")
        self.control = config.get("control", "mouse")
        if self.control not in ("mouse", *schemes.keys()):
            raise ValueError("Play with your hand or your mouse; that control isn’t supported.")
        enemy = config.get("enemy", "zombies")
        if enemy not in ("zombies", "robots"):
            raise ValueError("Choose zombies or robots.")
        duration = number(config.get("duration", 60), 15, 300)
        self.options = RoundOptions(
            Rect(0, 0, self.width, self.height),
            duration=duration,
            scale=self.height / 720,
            enemy=enemy,
        )
        self.round = self._new_round()
        self.canvas = np.zeros((self.height, self.width, 3), np.uint8)
        self.stream = None
        self.scheme = None
        self.rig = None
        self.saved_rig = None
        self.forget_saved = False  # the page's stored setup could not be used
        self.controller = None
        self.scope = EyeScope()
        self.calibration = None
        self.state = "playing"
        self.notice = ""
        self.clock = 0.0
        self.last_tick = time.monotonic()
        self.last_shot = -10.0
        self.last_reading = None
        self.frame = Frame()
        self.last_camera_at = float("-inf")
        self.id = secrets.token_urlsafe(18)
        # What the warm-up's last shot did, and a count the page watches to
        # celebrate each good hit once.
        self.setup_event = None
        self.moment = {"kind": None, "id": 0}
        self.setup_seen = None
        # Models are loaded only after the player explicitly chooses a camera mode.
        if self.control != "mouse":
            self.scheme = schemes.for_map(self.map.key)
            self.rig = default_rig(self.scheme, 1)
            saved = config.get("calibration")
            loaded = False
            if saved:
                try:
                    self.rig = saved_rig(saved)
                    loaded = True
                except (LookupError, ValueError, TypeError, ArithmeticError) as error:
                    # An older version's format, or a damaged value. Refusing to
                    # start would refuse every start after it too, since the page
                    # sends the same setup each time. The player can still aim:
                    # set up afresh, and have the page forget the stored one.
                    print(
                        f"Ignoring a saved browser setup: {error!r}",
                        file=sys.stderr,
                        flush=True,
                    )
                    self.forget_saved = True
            self._controller()
            self.stream = self.scheme.open_stream(
                *(ensure_model(m) for m in self.scheme.models)
            )
            # A returning player whose aim was set up and checked on this camera
            # goes straight into the game when the page asks for it; Adjust Aim
            # is one click away if the camera or the chair has moved since. An
            # aim that was never fitted, or that the fit would have refused,
            # goes through the warm-up as before.
            if (
                config.get("useSavedAim") is True
                and loaded
                and self.rig[0].aim_fitted
                and self.rig[0].usable
            ):
                self._play()
            else:
                self.begin_calibration()

    def close(self):
        if self.stream:
            self.stream.close()
            self.stream = None

    @property
    def zoom(self):
        """How much bigger each frame is than the 960-wide one maps were made at."""
        return max(self.width / WIDTH, self.height / 900)

    def _resize(self, size):
        """Draw at ``size`` from now on; False if that is the size already."""
        if size == (self.width, self.height):
            return False
        self.width, self.height = size
        self.canvas = np.zeros((self.height, self.width, 3), np.uint8)
        self.options = replace(
            self.options, area=Rect(0, 0, *size), scale=self.height / 720
        )
        return True

    def _new_round(self):
        round_ = self.map.create(self.options)
        # The desktop rifle infers a frame including its surrounding HUD.
        # Set the browser's actual canvas before the very first scoped shot.
        if self.map.key == "sniper":
            round_.set_frame(self.width, self.height)
            round_.scope_sensitivity = 0.25 if self.control == "pistol" else 1.0
        return round_

    def _controller(self):
        self.last_aim = Aim()
        self.controller = AimController(
            self.scheme,
            fire_above=self.scheme.fire_above,
            arm_below=self.scheme.arm_below,
            min_cutoff=self.scheme.smoothing[0],
            beta=self.scheme.smoothing[1],
        )

    def begin_calibration(self):
        if self.scheme is None:
            raise ValueError("Aim setup is for playing with your hand.")
        self._setup(ShotCalibration(self.scheme, previous=self.rig))
        self.state = "calibration"

    def _setup(self, calibration, event=None):
        """Start the warm-up afresh, or say what it did outside a shot."""
        self.calibration = calibration
        self.saved_rig = None
        self._note(event)

    def _note(self, event):
        self.setup_event = event
        self.setup_seen = self._setup_snapshot()
        if event:
            self.moment = {"kind": event, "id": self.moment["id"] + 1}
        self.notice = " ".join(setup_words(self.calibration, event))

    def _setup_snapshot(self):
        s = self.calibration
        return (s.shot_count, len(s.samples), len(s.hits), s.testing, s.message)

    def _setup_event(self, before, after):
        """What changed in the warm-up between two frames: a shot, and its fate.

        ``hit`` a centre hit; ``learned`` the shot that fitted the aim; ``shot``
        any other learning shot; ``retry`` a learning shot the fit refused;
        ``adjusted`` a missed check that refitted the aim, ``miss`` one that
        could not, ``relearn`` one that sent the warm-up back to learning;
        ``raise`` a pull with no aim before it. None when nothing happened.
        """
        shots, samples, hits, testing, message = before
        if after[2] > hits:
            return "hit"
        if after[0] == shots:
            return "raise" if after[4] != message else None
        if testing:
            if not after[3]:
                return "relearn"
            return "adjusted" if after[1] > samples else "miss"
        if after[1] <= samples:
            return "retry"
        return "learned" if after[3] else "shot"

    def _play(self):
        """A fresh round of the chosen map, on whatever aim setup settled on."""
        # A round is laid out for one frame size, so a stage resized during
        # one - into or out of full screen, say - is drawn sharp from the next.
        self._resize(self.view)
        self.round = self._new_round()
        self.state = "playing"
        self.notice = ""
        self.clock = 0.0
        self.last_shot = -10.0
        self.scope = EyeScope()
        if self.scheme:
            self._controller()

    def action(self, name, data):
        # A double click, or a click that raced a change of state - setup ending
        # itself on the fifth hit, a round running out - asks for something that
        # already happened or no longer applies. Answer with where the game is:
        # an error would end the session in the page.
        calibrating = self.state == "calibration"
        warming_up = calibrating or (
            self.state == "paused" and self.resume_state == "calibration"
        )
        if (
            (name == "calibrate" and calibrating)
            or (name in ("undo", "reset", "finish") and not calibrating)
            or (name == "play" and self.state != "over")
            or (name == "restart" and warming_up)
        ):
            return self.info()
        if name == "calibrate":
            self.begin_calibration()
        elif name in ("undo", "reset", "finish"):
            s = self.calibration
            if name == "undo":
                s.undo()
                self._note("undo")
            elif name == "reset":
                self._setup(ShotCalibration(self.scheme))
            else:
                # Five verified hits: the warm-up is over and the game starts.
                if not s.complete:
                    raise ValueError("Hit five centres first.")
                self.rig = s.rig
                self.saved_rig = {"cameras": [self.rig[0].to_dict()]}
                self._play()
        elif name in ("play", "restart"):
            # Play starts the next round once one is over; restart abandons
            # the one being played, paused or not.
            self._play()
        elif name == "pause":
            if self.state in ("playing", "calibration"):
                self.resume_state = self.state
                self.state = "paused"
                if self.resume_state == "calibration":
                    self.calibration.suspend()
        elif name == "resume":
            if self.state == "paused":
                self.state = self.resume_state
        else:
            raise ValueError("Unknown action")
        self.last_tick = time.monotonic()
        return self.info()

    def info(self):
        data = {
            "id": self.id,
            "state": self.state,
            "notice": self.notice,
            "control": self.control,
            "calibration": self.saved_rig,
            "hasSavedAim": bool(self.rig and self.rig[0].aim_fitted),
        }
        if self.state == "calibration" or (
            self.state == "paused" and self.resume_state == "calibration"
        ):
            s = self.calibration
            title, detail = setup_words(s, self.setup_event)
            data["step"] = {
                "shots": s.shot_count,
                "learningShots": len(s.samples),
                "learnTotal": LEARNING_SHOTS,
                "complete": s.complete,
                "ready": s.ready,
                "preview": s.preview,
                "testing": s.testing,
                "hits": len(s.hits),
                "total": REQUIRED_HITS,
                "armed": s.aim.armed,
                # Where the lit face hangs, 0..1 of the stage, for the page's
                # celebration of a hit on it.
                "target": list(s.target),
                "title": title,
                "detail": detail,
                "moment": self.moment,
            }
        data.update(
            score=self.round.score,
            remaining=self.round.remaining(self.clock),
            health=getattr(self.round, "health", None),
            accuracy=round(self.round.accuracy * 100),
            result=self.round.result_line(),
            readouts=readouts(self.map, self.round, self.clock),
        )
        if self.state == "over":
            data["summary"] = results(self.map, self.round)
        return data

    def tick(self, data, wall_time=None, camera=None):
        """Advance the game one frame and draw it.

        ``camera`` is the page's JPEG, if it sent one. The answer carries the
        drawn frame as JPEG bytes under ``image``.
        """
        wall = time.monotonic() if wall_time is None else wall_time
        dt = max(0, min(wall - self.last_tick, 0.1))
        self.last_tick = wall
        if self.state not in ("paused", "over"):
            self.clock += dt
        now = self.clock
        # A stage with no size yet measures 0 by 0; the page leaves it out.
        view = data.get("viewSize")
        if view is not None:
            self.view = stage_size(view)
        if self.state == "calibration" and self._resize(self.view):
            if self.calibration:
                self.calibration.hits.clear()
        if self.stream and camera:
            # The UI sends 640x480 JPEGs. Reject other encodings and oversized frames.
            if not camera.startswith(b"\xff\xd8"):
                raise ValueError("Expected a JPEG camera frame")
            width, height = jpeg_size(camera)
            if not (0 < width <= 1280 and 0 < height <= 720):
                raise ValueError("Camera frame must be at most 1280 by 720")
            try:
                image = cv2.imdecode(np.frombuffer(camera, np.uint8), cv2.IMREAD_COLOR)
            except cv2.error as error:
                raise ValueError("Invalid camera frame") from error
            if image is None or image.shape[0] > 720 or image.shape[1] > 1280:
                raise ValueError("Camera frame must be at most 1280 by 720")
            current = self.stream.wait(self.stream.submit(image), RESULT_WAIT)
            if current.timestamp_ms != self.last_reading:
                self.frame = current
                self.last_reading = current.timestamp_ms
                self.last_camera_at = wall
                fresh = True
            else:
                fresh = False
        else:
            fresh = False
        frame = self.frame if wall - self.last_camera_at < 0.4 else Frame()
        tracking = bool(frame.subjects) if self.stream else True
        cues = []
        position = None
        aim = None
        fire = False
        scoped = False
        if self.scheme and self.state != "calibration":
            if fresh or not tracking:
                self.last_aim = self.controller.update([(frame, self.rig[0])], now)
                aim = self.last_aim
            else:
                aim = replace(self.last_aim, fired=False)
            position = aim.position if aim.tracking else None
            fire = aim.fired
            if self.scheme.scope:
                reading = (
                    self.scheme.scope(frame.subjects[0]) if frame.subjects else None
                )
                scoped = self.scope.update(reading, now)
        elif self.control == "mouse":
            position = (
                number(data.get("x", 0.5), 0, 1),
                number(data.get("y", 0.5), 0, 1),
            )
            fire = data.get("fire") is True
            scoped = data.get("scope") is True
        scoped = scoped and self.map.key == "sniper"
        if self.state == "calibration":
            s = self.calibration
            s.viewport = (self.width, self.height)
            s.update([frame], now)
            seen = self._setup_snapshot()
            if seen != self.setup_seen:
                event = self._setup_event(self.setup_seen, seen)
                if event:
                    self._note(event)
                    cues.append("shot")
                    if event == "hit":
                        cues.append("hit_0")  # the gold rings: a small celebration
                self.setup_seen = seen
            scene.draw_calibration_range(self.canvas, s, now)
            if s.preview and s.aim.position:
                scene.draw_crosshair(
                    self.canvas,
                    s.aim.position[0] * self.width,
                    s.aim.position[1] * self.height,
                    s.aim.armed,
                    None,
                    CROSSHAIR * self.zoom,
                    pull=s.aim.travel,
                    fire_at=self.scheme.fire_above,
                )
            if s.complete:
                self.action("finish", {})
        elif self.state == "playing":
            self.round.look(position, scoped)
            self.round.update(now)
            crosshair = (
                (position[0] * self.width, position[1] * self.height)
                if position
                else None
            )
            if scoped and self.round.scoped_shot is not None and crosshair:
                crosshair = self.round.scoped_shot
            if (
                fire
                and crosshair
                and now - self.last_shot >= 0.12
                and not self.round.is_over(now)
            ):
                impact = self.round.shoot(*crosshair, now)
                self.last_shot = now
                # The desktop's sounds for a shot (app.play): the pistol, then
                # the hit as the map voices it, or the miss.
                cues.append("shot")
                if not impact.is_hit:
                    cues.append("miss")
                elif self.map.key == "zombies" and self.options.enemy == "robots":
                    cues.append("debris_hit")
                else:
                    self.map.play_hit(CueRecorder(cues), impact)
            self.map.draw_world(self.canvas, self.round, now)
            # The page draws the mouse's crosshair itself, where the pointer is
            # now rather than where it was a round trip ago. A hand's is drawn
            # here: only the server knows where its filtered aim will land.
            if crosshair and not scoped and aim:
                scene.draw_crosshair(
                    self.canvas,
                    *crosshair,
                    aim.armed,
                    now - self.last_shot,
                    CROSSHAIR * self.zoom,
                    pull=aim.travel,
                    fire_at=self.scheme.fire_above,
                )
            cues.extend(self.round.take_cues())
            if self.round.is_over(now):
                self.state = "over"
                cues.append("round_over")
        armed = None
        if self.state == "calibration":
            armed = self.calibration.aim.armed
        elif aim is not None:
            armed = aim.armed
        result = self.info()
        result.update(
            # The hand's trigger: the page clicks when it re-arms, as the
            # desktop does, and shows it during the warm-up.
            armed=armed,
            tracking=tracking,
            hands=[list(hand.landmarks) for hand in getattr(frame, "hands", ())],
            scopeTracked=(
                bool(frame.subjects and getattr(frame.subjects[0], "face", None))
                if self.scheme and self.scheme.scope
                else None
            ),
            cues=cues,
            image=jpeg(self.canvas),
        )
        return result


class BrowserServer(ThreadingHTTPServer):
    daemon_threads = True
    # Ctrl+C must not wait for handler threads: one may hold a keep-alive
    # connection open for the page's next frame, or be loading a model.
    block_on_close = False

    def __init__(self, address, idle_timeout=IDLE_TIMEOUT):
        self.token = secrets.token_urlsafe(32)
        self.session = None
        # Guards ``session`` and everything done to it. Held for one frame at a
        # time - milliseconds - and never while a session is being built.
        self.lock = threading.Lock()
        self.closed = False
        self.idle_timeout = idle_timeout
        self.seen = 0.0  # when a request last reached the open session
        self.expired = None  # the id of the last session closed for silence
        super().__init__(address, Handler)

    def start(self, config):
        """Open a new game in place of any other, and describe it."""
        # Built outside the lock: loading the models - on first use, downloading
        # them - takes seconds, and every other request would wait behind it:
        # another tab's frames, a closing tab's stop, and Ctrl+C.
        session = BrowserSession(config)
        with self.lock:
            if self.closed:
                # Ctrl+C arrived while the models loaded; nothing would close it.
                session.close()
                raise ValueError("Handy is closing.")
            previous, self.session = self.session, session
            self.seen = time.monotonic()
        # Unreachable now, and no frame can be using it: frames hold the lock.
        if previous:
            previous.close()
        return {**session.info(), "forgetSavedSetup": session.forget_saved}

    def call(self, path, data, camera=None):
        """Run one request against the open game."""
        if path not in ("/api/frame", "/api/action", "/api/stop"):
            raise ValueError("Unknown operation")
        with self.lock:
            session = self.session
            if session is None or data.get("id") != session.id:
                if self.expired is not None and data.get("id") == self.expired:
                    raise ValueError(
                        "This game closed after a minute away. "
                        "Choose a game to start again."
                    )
                raise ValueError(
                    "This game ended, or moved to another tab. "
                    "Choose a game to play here."
                )
            self.seen = time.monotonic()
            if path == "/api/frame":
                return session.tick(data, camera=camera)
            if path == "/api/action":
                return session.action(data.get("action"), data)
            session.close()
            self.session = None
            return {"ok": True}

    def service_actions(self):
        # serve_forever calls this between requests, and at least twice a second.
        self.close_idle(time.monotonic())

    def close_idle(self, now):
        """Close the open game if no request has reached it for a while.

        A tab that crashed, or a laptop put to sleep, never says goodbye, and
        its MediaPipe graphs would stay loaded until the next start or Ctrl+C.
        A paused game keeps polling for frames, so it never comes close.
        """
        # Never wait here: this runs on the thread that accepts connections.
        if not self.lock.acquire(blocking=False):
            return
        try:
            session = self.session
            if session is None or now - self.seen < self.idle_timeout:
                return
            self.session, self.expired = None, session.id
        finally:
            self.lock.release()
        session.close()

    def server_close(self):
        super().server_close()
        self.closed = True
        # A frame holds the lock for milliseconds. Should one ever wedge, leave
        # its session to the exiting process rather than hang Ctrl+C on it.
        if not self.lock.acquire(timeout=2):
            return
        try:
            session, self.session = self.session, None
        finally:
            self.lock.release()
        if session:
            session.close()


class Handler(BaseHTTPRequestHandler):
    # Keep-alive: the page posts about 30 frames a second, and a fresh connection
    # (and thread) for each one left hundreds of sockets in TIME_WAIT. It works
    # because every response below says how long it is.
    protocol_version = "HTTP/1.1"
    # A client that connects and then stalls - mid-request, or idle between
    # requests - gives its thread back after this many seconds.
    timeout = 10

    def log_message(self, *_args):
        pass

    def handle(self):
        try:
            super().handle()
        except (ConnectionError, TimeoutError):
            # The tab closed, reloaded or stalled mid-request. Nobody is left to
            # answer, and a traceback in the terminal would only alarm the player.
            self.close_connection = True

    def send(self, status, body, content_type="application/json"):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header(
            "Content-Security-Policy",
            "default-src 'self'; img-src 'self' data:; media-src 'self' blob:; object-src 'none'; frame-ancestors 'none'",
        )
        # Another site's page may not even embed a response from here: an image
        # or script load would pull it into that page's process, where a side
        # channel such as Spectre could read it despite the same-origin policy.
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        if status >= 400:
            # A refusal may leave the request body unread, and whatever follows
            # it on this connection could not be trusted as the next request.
            self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(body)

    def respond(self, status, data):
        self.send(status, json.dumps(data, allow_nan=False).encode())

    def valid_host(self):
        port = self.server.server_port
        return self.headers.get("Host") in (f"127.0.0.1:{port}", f"localhost:{port}")

    def same_origin(self):
        """False for a request another page made, other than a link to here.

        Browsers label what they send with where it came from. A server on
        another port of this machine counts as the same *site*, so only the
        same origin passes. Following a link or bookmark to the arcade is fine:
        the page that linked here cannot read what it opened. Clients that send
        no labels at all, such as scripts, still need the Host and the token.
        """
        origin = self.headers.get("Origin")
        if origin is not None and origin != f"http://{self.headers.get('Host')}":
            return False
        if self.headers.get("Sec-Fetch-Site") in (None, "same-origin", "none"):
            return True
        return (
            self.command == "GET"
            and self.headers.get("Sec-Fetch-Mode") == "navigate"
            and self.headers.get("Sec-Fetch-Dest") == "document"
        )

    def do_GET(self):
        if not self.valid_host() or not self.same_origin():
            self.respond(403, {"error": "Open Handy at the address in your terminal."})
            return
        path = urlsplit(self.path).path
        if path == "/api/config":
            self.respond(
                200,
                {
                    "token": self.server.token,
                    "handConnections": HAND_CONNECTIONS,
                    "maps": [
                        {
                            "key": m.key,
                            "title": m.title,
                            "description": m.blurb,
                        }
                        for m in maps.MAPS
                    ],
                },
            )
        elif path.startswith("/art/"):
            try:
                chosen = maps.by_key(path.removeprefix("/art/"))
                art = np.zeros((200, 360, 3), np.uint8)
                chosen.draw_emblem(art)
                self.send(200, jpeg(art), "image/jpeg")
            except KeyError:
                self.respond(404, {"error": "Unknown map"})
        elif path in ("/", "/app.js", "/capture.js", "/style.css"):
            name = "index.html" if path == "/" else path[1:]
            mime = {
                "index.html": "text/html",
                "app.js": "text/javascript",
                "capture.js": "text/javascript",
                "style.css": "text/css",
            }[name]
            self.send(200, (WEB_ROOT / name).read_bytes(), mime + "; charset=utf-8")
        else:
            self.respond(404, {"error": "Not found"})

    def do_POST(self):
        # Compared as bytes: a header carrying non-ASCII would make the string
        # comparison raise instead of simply failing.
        if (
            not self.valid_host()
            or not self.same_origin()
            or not secrets.compare_digest(
                self.headers.get("X-Handy-Token", "").encode(),
                self.server.token.encode(),
            )
        ):
            self.respond(403, {"error": "Reload the page to reconnect."})
            return
        try:
            size = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            size = 0
        if not 0 < size <= MAX_BODY:
            self.respond(400, {"error": "That request was empty, or too large."})
            return
        # Read outside the try below, as the answer is written outside it: only
        # these two touch the tab's connection, and its failures are handle()'s.
        # A model download failing the same way inside is a real error.
        body = self.rfile.read(size)
        frame = self.path == "/api/frame"
        try:
            data, camera = unpack(body) if frame else (json.loads(body), None)
            if not isinstance(data, dict):
                raise ValueError("Expected a JSON object")
            if self.path == "/api/start":
                result = self.server.start(data)
            else:
                result = self.server.call(self.path, data, camera)
        except (ValueError, KeyError, TypeError, OverflowError) as error:
            self.respond(400, {"error": str(error)})
            return
        except Exception as error:
            # Keep the interface usable after a model, device, or renderer fails.
            print(f"Browser request failed: {error!r}", file=sys.stderr, flush=True)
            self.respond(
                500,
                {
                    "error": "Something went wrong. The terminal running Handy "
                    "says what; you can also play with your mouse."
                },
            )
            return
        if frame:
            image = result.pop("image")
            self.send(200, pack(result, image), FRAME_TYPE)
        else:
            self.respond(200, result)


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Play Handy in your browser, on this computer"
    )
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument(
        "--no-open", action="store_true", help="do not open a browser automatically"
    )
    args = parser.parse_args(argv)
    if not 1 <= args.port <= 65535:
        parser.error("port must be between 1 and 65535")
    try:
        server = BrowserServer(("127.0.0.1", args.port))
    except OSError as error:
        parser.exit(1, f"Could not start Handy: {error}. Try --port 8766.\n")
    url = f"http://127.0.0.1:{args.port}"
    print(
        f"Handy is ready: {url}\nKeep this terminal open. Ctrl+C stops the game.",
        flush=True,
    )
    if not args.no_open:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
