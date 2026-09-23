"""Local browser adapter for the four-game arcade and its Target Range warm-up.

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
from .models import ensure_model
from .recognition import Frame, HAND_CONNECTIONS

WEB_ROOT = Path(__file__).with_name("web")
WIDTH, HEIGHT = 960, 540
MAX_BODY = 1_500_000


def number(value, low, high):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError("Expected a number")
    if not math.isfinite(value) or not low <= value <= high:
        raise ValueError(f"Expected a number between {low} and {high}")
    return value


def jpeg(image):
    ok, encoded = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, 82])
    if not ok:
        raise ValueError("Could not encode the game frame")
    return encoded.tobytes()


class BrowserSession:
    def __init__(self, config):
        aspect = number(config.get("viewAspect", WIDTH / HEIGHT), 0.25, 8)
        self.height = min(900, round(WIDTH / aspect))
        self.width = round(self.height * aspect)
        self.map = maps.by_key(config.get("map", maps.DEFAULT.key))
        if self.map.key not in maps.keys():
            raise ValueError("Choose a game from the arcade")
        self.control = config.get("control", "mouse")
        if self.control not in ("mouse", *schemes.keys()):
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
        self.controller = None
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
        if self.control != "mouse":
            self.scheme = schemes.for_map(self.map.key)
            self.rig = default_rig(self.scheme, 1)
            saved = config.get("calibration")
            if saved:
                candidate = Rig.from_dict(saved)
                if len(candidate) != 1:
                    raise ValueError("Browser calibration uses one camera")
                for value in candidate[0].to_dict().values():
                    if isinstance(value, (int, float)) and not math.isfinite(value):
                        raise ValueError("Invalid saved calibration")
                if not all(math.isfinite(v) for v in candidate[0].mapping):
                    raise ValueError("Invalid saved calibration")
                self.rig = candidate
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
        if name == "calibrate":
            self.begin_calibration()
        elif name in ("undo", "reset", "finish"):
            if self.state != "calibration":
                raise ValueError("Start calibration first")
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
            if self.state != "calibration":
                raise ValueError("No calibration to skip")
            self.state = "practice"
            self.notice = "Setup skipped. Using your previous setup or the default aim."
            self._controller()
        elif name == "play":
            if self.state not in ("practice", "over"):
                raise ValueError("Finish or skip setup before playing")
            self.round = self._new_round()
            self.state = "playing"
            self.notice = ""
            self.clock = 0.0
            self.last_shot = -10.0
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
        if self.state in ("calibration", "practice") and "viewAspect" in data:
            aspect = number(data["viewAspect"], 0.25, 8)
            height = min(900, round(WIDTH / aspect))
            width = round(height * aspect)
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
            image = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)
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

    def __init__(self, address):
        self.token = secrets.token_urlsafe(32)
        self.session = None
        self.lock = threading.Lock()
        super().__init__(address, Handler)

    def server_close(self):
        with self.lock:
            if self.session:
                self.session.close()
        super().server_close()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

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
        self.end_headers()
        self.wfile.write(body)

    def respond(self, status, data):
        self.send(status, json.dumps(data, allow_nan=False).encode())

    def valid_host(self):
        port = self.server.server_port
        return self.headers.get("Host") in (f"127.0.0.1:{port}", f"localhost:{port}")

    def do_GET(self):
        if not self.valid_host():
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
        if not self.valid_host() or not secrets.compare_digest(
            self.headers.get("X-Handy-Token", ""), self.server.token
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
            with self.server.lock:
                if self.path == "/api/start":
                    session = BrowserSession(data)
                    if self.server.session:
                        self.server.session.close()
                    self.server.session = session
                    result = session.info()
                else:
                    session = self.server.session
                    if session is None or data.get("id") != session.id:
                        raise ValueError(
                            "This game was closed or opened in another tab. Return to the arcade."
                        )
                    if self.path == "/api/frame":
                        result = session.tick(data)
                    elif self.path == "/api/action":
                        result = session.action(data.get("action"), data)
                    elif self.path == "/api/stop":
                        session.close()
                        self.server.session = None
                        result = {"ok": True}
                    else:
                        raise ValueError("Unknown operation")
            self.respond(200, result)
        except (ValueError, KeyError, TypeError, OverflowError) as error:
            self.respond(400, {"error": str(error)})
        except Exception as error:
            # Keep the interface usable after a model, device, or renderer fails.
            print(f"Browser request failed: {error}")
            self.respond(
                500,
                {
                    "error": "The game could not complete this action. "
                    "Check the terminal, or return to the arcade and try mouse controls."
                },
            )


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
