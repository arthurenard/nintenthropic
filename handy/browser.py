"""Local browser adapter for the existing six-map engine.

No desktop window or server-owned camera. The browser sends a small mirrored
camera frame to the loopback server; inference and rendering stay on this Mac.
Run with ``python -m handy.browser`` (or ``python -m handy --browser``).
"""

from __future__ import annotations

import argparse
import base64
import binascii
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
from .shot_calibration import ShotCalibration
from .game import Rect, RoundOptions
from .karting import Wheel, WheelController
from .models import ensure_model
from .recognition import Frame, GestureStream, HAND_CONNECTIONS

WEB_ROOT = Path(__file__).with_name("web")
WIDTH, HEIGHT = 960, 540
MAX_BODY = 1_500_000
#: Seconds without a request after which the open game is presumed abandoned.
IDLE_TIMEOUT = 60.0


def number(value, low, high):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError("Expected a number")
    if not math.isfinite(value) or not low <= value <= high:
        raise ValueError(f"Expected a number between {low} and {high}")
    return value


def stage_size(aspect):
    """The canvas (width, height) for a stage of this width-to-height shape.

    Shapes beyond 1:4 and 8:1 are drawn at the nearest one the renderer
    supports. A short or narrow window is not a mistake to refuse: the page
    sends its shape with every frame, and one refusal would end the game.
    """
    aspect = min(max(number(aspect, 0, math.inf), 0.25), 8)
    height = min(900, round(WIDTH / aspect))
    return round(height * aspect), height


def jpeg(image):
    ok, encoded = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, 82])
    if not ok:
        raise ValueError("Could not encode the game frame")
    return encoded.tobytes()


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
    """The one-camera rig the page stored, or an error if any of it is unusable.

    It comes back from browser storage - perhaps written by an older version,
    perhaps edited by hand - so every number must be finite, and every pair a pair.
    """
    rig = Rig.from_dict(saved)
    if len(rig) != 1:
        raise ValueError("Browser calibration uses one camera")
    for name, value in rig[0].to_dict().items():
        if isinstance(value, (bool, str)):
            continue
        values = value if isinstance(value, list) else [value]
        if name in ("tuning", "slide") and len(values) != 2:
            raise ValueError(f"The saved {name} is not a pair")
        for item in values:
            if (
                isinstance(item, bool)
                or not isinstance(item, (int, float))
                or not math.isfinite(item)
            ):
                raise ValueError(f"The saved {name} is not a finite number")
    return rig


class BrowserSession:
    def __init__(self, config):
        aspect = config.get("viewAspect")
        self.width, self.height = stage_size(
            WIDTH / HEIGHT if aspect is None else aspect
        )
        self.map = maps.by_key(config.get("map", maps.DEFAULT.key))
        if self.map.key not in maps.keys():
            raise ValueError("Choose a game from the arcade")
        self.control = config.get("control", "mouse")
        allowed = (
            ("keyboard", "wheel")
            if self.map.mode == "drive"
            else ("mouse", *schemes.keys())
        )
        if self.control not in allowed:
            raise ValueError("Choose a control supported by this map")
        enemy = config.get("enemy", "zombies")
        if enemy not in ("zombies", "robots"):
            raise ValueError("Unknown enemy")
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
        self.wheel_reader = WheelController(mirrored=True)
        self.neutral_rolls = []
        self.wheel_calibrated = False
        self.scope = EyeScope()
        self.calibration = None
        self.state = "playing"
        self.notice = ""
        self.clock = 0.0
        self.last_tick = time.monotonic()
        self.practice_hits = set()
        self.last_shot = -10.0
        self.last_reading = None
        self.frame = Frame()
        self.last_camera_at = float("-inf")
        self.id = secrets.token_urlsafe(18)
        # Models are loaded only after the player explicitly chooses a camera mode.
        if self.control == "wheel":
            self.stream = GestureStream(ensure_model(), max_hands=2)
        elif self.control not in ("mouse", "keyboard"):
            self.scheme = schemes.for_map(self.map.key)
            self.rig = default_rig(self.scheme, 1)
            saved = config.get("calibration")
            if saved:
                try:
                    self.rig = saved_rig(saved)
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
            self.begin_calibration()

    def close(self):
        if self.stream:
            self.stream.close()
            self.stream = None

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
            median=self.scheme.trigger_median,
            native_thumb=True,
        )

    def begin_calibration(self):
        if self.scheme is None:
            raise ValueError("This control does not need aiming calibration")
        self.calibration = ShotCalibration(self.scheme, previous=self.rig)
        self.state = "calibration"
        self.saved_rig = None
        self.notice = self.calibration.message

    def action(self, name, data):
        # A double click, or a click that raced a change of state - setup ending
        # itself on the fifth hit, a round running out - asks for something that
        # already happened or no longer applies. Answer with where the game is:
        # an error would end the session in the page.
        calibrating = self.state == "calibration"
        if (
            (name == "calibrate" and calibrating)
            or (name in ("undo", "reset", "finish", "skip") and not calibrating)
            or (name == "play" and self.state not in ("practice", "over"))
        ):
            return self.info()
        if name == "calibrate":
            self.begin_calibration()
        elif name in ("undo", "reset", "finish"):
            s = self.calibration
            if name == "undo":
                s.undo()
            elif name == "reset":
                self.calibration = ShotCalibration(self.scheme)
                self.saved_rig = None
            elif name == "finish":
                if not s.complete:
                    raise ValueError("Land five accurate hits first")
                self.rig = s.rig
                self.saved_rig = {"cameras": [self.rig[0].to_dict()]}
                self.state = "practice"
                return self.action("play", {})
            self.notice = self.calibration.message
        elif name == "skip":
            self.state = "practice"
            self.notice = "Setup skipped. Using your previous setup or the default aim."
            self._controller()
        elif name == "play":
            self.round = self._new_round()
            self.state = "playing"
            self.notice = ""
            self.clock = 0.0
            self.last_shot = -10.0
            self.neutral_rolls = []
            self.wheel_calibrated = False
            self.wheel_reader = WheelController(mirrored=True)
            self.scope = EyeScope()
            if self.scheme:
                self._controller()
        elif name == "pause":
            if self.state in ("playing", "practice", "calibration"):
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
            "practiceHits": len(self.practice_hits),
            "calibration": self.saved_rig,
            "hasSavedAim": bool(self.rig and self.rig[0].aim_fitted),
        }
        if self.state == "calibration" or (
            self.state == "paused" and self.resume_state == "calibration"
        ):
            s = self.calibration
            data["step"] = {
                "shots": s.shot_count,
                "learningShots": len(s.samples),
                "complete": s.complete,
                "ready": s.ready,
                "preview": s.preview,
                "testing": s.testing,
                "hits": len(s.hits),
                "armed": s.aim.armed,
            }
        if self.map.mode == "drive":
            data.update(
                score=f"P{self.round.position()}",
                remaining=None,
                health=None,
                accuracy=None,
                result=self.round.result_line(),
            )
        else:
            data.update(
                score=self.round.score,
                remaining=self.round.remaining(self.clock),
                health=getattr(self.round, "health", None),
                accuracy=round(self.round.accuracy * 100),
                result=self.round.result_line(),
            )
        return data

    def tick(self, data, wall_time=None):
        wall = time.monotonic() if wall_time is None else wall_time
        dt = max(0, min(wall - self.last_tick, 0.1))
        self.last_tick = wall
        if self.state not in ("paused", "over"):
            self.clock += dt
        now = self.clock
        # A stage with no size yet measures 0 by 0, which JSON sends as null.
        aspect = data.get("viewAspect")
        if self.state in ("calibration", "practice") and aspect is not None:
            width, height = stage_size(aspect)
            if (width, height) != (self.width, self.height):
                self.width, self.height = width, height
                self.canvas = np.zeros((height, width, 3), np.uint8)
                self.options = replace(
                    self.options, area=Rect(0, 0, width, height), scale=height / 720
                )
                if self.calibration:
                    self.calibration.hits.clear()
        encoded = data.get("camera")
        if self.stream and encoded:
            try:
                raw = base64.b64decode(encoded, validate=True)
            except (binascii.Error, TypeError) as error:
                raise ValueError("Invalid camera frame") from error
            # The UI sends 640x480 JPEGs. Reject other encodings and oversized frames.
            if not raw.startswith(b"\xff\xd8"):
                raise ValueError("Expected a JPEG camera frame")
            width, height = jpeg_size(raw)
            if not (0 < width <= 1280 and 0 < height <= 720):
                raise ValueError("Camera frame must be at most 1280 by 720")
            try:
                image = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)
            except cv2.error as error:
                raise ValueError("Invalid camera frame") from error
            if image is None or image.shape[0] > 720 or image.shape[1] > 1280:
                raise ValueError("Camera frame must be at most 1280 by 720")
            self.stream.submit(image)
            current = self.stream.latest()
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
            if s.update([frame], now):
                cues.append("hit" if s.last_hit else "shot")
            self.notice = s.message
            scene.draw_calibration_range(self.canvas, s, now)
            if s.preview and s.aim.position:
                scene.draw_crosshair(
                    self.canvas,
                    s.aim.position[0] * self.width,
                    s.aim.position[1] * self.height,
                    s.aim.armed,
                    None,
                    0.75,
                    pull=s.aim.pull,
                    fire_at=self.scheme.fire_above,
                )
            if s.complete:
                self.action("finish", {})
        elif self.state == "practice":
            scene.draw_backdrop(self.canvas)
            for i, (x, y) in enumerate(((0.22, 0.35), (0.5, 0.6), (0.78, 0.35))):
                px, py = int(x * self.width), int(y * self.height)
                if (
                    fire
                    and position
                    and math.hypot(
                        position[0] * self.width - px, position[1] * self.height - py
                    )
                    < 42
                ):
                    self.practice_hits.add(i)
                    cues.append("hit")
                color = (130, 232, 185) if i in self.practice_hits else (180, 190, 205)
                cv2.circle(self.canvas, (px, py), 42, color, 3, cv2.LINE_AA)
                cv2.circle(self.canvas, (px, py), 8, color, -1, cv2.LINE_AA)
            if position:
                scene.draw_crosshair(
                    self.canvas,
                    position[0] * self.width,
                    position[1] * self.height,
                    aim.armed if aim else True,
                    None,
                    0.75,
                    pull=aim.pull if aim else 0,
                    fire_at=self.scheme.fire_above,
                )
        elif self.state == "playing":
            if self.map.mode == "drive":
                if self.control == "wheel":
                    wheel = self.wheel_reader.update(
                        list(frame.hands), now, reading=frame.timestamp_ms
                    )
                    if wheel.hands == 2 and fresh and not self.wheel_calibrated:
                        self.neutral_rolls.append(wheel.roll)
                        self.neutral_rolls = self.neutral_rolls[-45:]
                    if self.round.countdown(now) is None and not self.wheel_calibrated:
                        self.wheel_calibrated = self.wheel_reader.set_neutral(
                            self.neutral_rolls, clamp=True
                        )
                else:
                    wheel = Wheel(
                        steer=number(data.get("steer", 0), -1, 1),
                        throttle=number(data.get("throttle", 0), 0, 1),
                        brake=data.get("brake") is True,
                        hands=2,
                    )
                self.round.update(now, dt, wheel)
                self.map.draw_world(self.canvas, self.round, now)
                maps.kart.draw_hud(self.canvas, self.round, wheel, now, 0.75)
                if self.round.finished:
                    self.state = "over"
            else:
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
                    cues.append("hit" if impact.is_hit else "shot")
                self.map.draw_world(self.canvas, self.round, now)
                if crosshair and not scoped:
                    scene.draw_crosshair(
                        self.canvas,
                        *crosshair,
                        aim.armed if aim else True,
                        now - self.last_shot,
                        0.75,
                        pull=aim.pull if aim else 0,
                        fire_at=self.scheme.fire_above if self.scheme else 0.65,
                    )
                if self.round.is_over(now):
                    self.state = "over"
            cues.extend(self.round.take_cues())
        result = self.info()
        result.update(
            tracking=tracking,
            hands=[list(hand.landmarks) for hand in getattr(frame, "hands", ())],
            scopeTracked=(
                bool(frame.subjects and getattr(frame.subjects[0], "face", None))
                if self.scheme and self.scheme.scope
                else None
            ),
            cues=cues,
            image=base64.b64encode(jpeg(self.canvas)).decode(),
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
                raise ValueError("Handy is shutting down")
            previous, self.session = self.session, session
            self.seen = time.monotonic()
        # Unreachable now, and no frame can be using it: frames hold the lock.
        if previous:
            previous.close()
        return {**session.info(), "forgetSavedSetup": session.forget_saved}

    def call(self, path, data):
        """Run one request against the open game."""
        if path not in ("/api/frame", "/api/action", "/api/stop"):
            raise ValueError("Unknown operation")
        with self.lock:
            session = self.session
            if session is None or data.get("id") != session.id:
                if self.expired is not None and data.get("id") == self.expired:
                    raise ValueError(
                        "This game closed after a minute with no contact from its tab. "
                        "Return to the arcade."
                    )
                raise ValueError(
                    "This game was closed or opened in another tab. Return to the arcade."
                )
            self.seen = time.monotonic()
            if path == "/api/frame":
                return session.tick(data)
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
            self.respond(403, {"error": "Use the local Handy address"})
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
                            "mode": m.mode,
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
        elif path in ("/", "/app.js", "/style.css"):
            name = "index.html" if path == "/" else path[1:]
            mime = {
                "index.html": "text/html",
                "app.js": "text/javascript",
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
            self.respond(403, {"error": "Reload Handy to reconnect"})
            return
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if not 0 < size <= MAX_BODY:
                raise ValueError("Request is too large or empty")
            data = json.loads(self.rfile.read(size))
            if not isinstance(data, dict):
                raise ValueError("Expected a JSON object")
            if self.path == "/api/start":
                result = self.server.start(data)
            else:
                result = self.server.call(self.path, data)
        except (ValueError, KeyError, TypeError, OverflowError) as error:
            self.respond(400, {"error": str(error)})
            return
        except (ConnectionError, TimeoutError):
            raise  # the connection itself failed; handle() lets it go quietly
        except Exception as error:
            # Keep the interface usable after a model, device, or renderer fails.
            print(f"Browser request failed: {error!r}", file=sys.stderr, flush=True)
            self.respond(
                500,
                {
                    "error": "The game could not complete this action. "
                    "Check the terminal, or return to the arcade and try mouse controls."
                },
            )
            return
        # Outside the try: a tab that left before its answer is not a failure.
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
