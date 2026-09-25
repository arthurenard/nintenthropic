"""The browser mode's real HTTP layer, served on a loopback port for each test.

MediaPipe and the model files are replaced by a fake stream, so camera sessions
start instantly and offline; everything between the socket and the session is
the code the page talks to.
"""

import http.client
import json
import socket
import struct
import threading
import time
from dataclasses import replace

import cv2
import numpy as np
import pytest

from handy import browser, schemes
from handy.recognition import Frame


class FakeStream:
    def __init__(self):
        self.closed = False

    def latest(self):
        return Frame()

    def submit(self, _image):
        return 0

    def wait(self, _stamp, _timeout):
        return Frame()

    def close(self):
        self.closed = True


@pytest.fixture
def streams(monkeypatch):
    """Every camera stream a session opens, in order, without loading a model."""
    opened = []
    for_map = schemes.for_map

    def open_stream(*_models):
        opened.append(FakeStream())
        return opened[-1]

    monkeypatch.setattr(browser, "ensure_model", lambda _name, progress=None: "unused")
    monkeypatch.setattr(
        browser.schemes,
        "for_map",
        lambda key: replace(for_map(key), open_stream=open_stream),
    )
    return opened


@pytest.fixture
def server(streams):
    server = browser.BrowserServer(("127.0.0.1", 0))
    thread = threading.Thread(
        target=server.serve_forever, kwargs={"poll_interval": 0.02}, daemon=True
    )
    thread.start()
    yield server
    server.shutdown()
    server.server_close()
    thread.join(5)


def call(server, method, path, body=None, headers=None, token=True, connection=None):
    """One request; returns (status, decoded JSON or raw bytes, response headers)."""
    own = connection is None
    connection = connection or http.client.HTTPConnection(
        "127.0.0.1", server.server_port, timeout=5
    )
    headers = dict(headers or {})
    if token:
        headers.setdefault("X-Handy-Token", server.token)
    if body is not None and not isinstance(body, bytes):
        body = json.dumps(body).encode()
        headers.setdefault("Content-Type", "application/json")
    try:
        connection.request(method, path, body=body, headers=headers)
        response = connection.getresponse()
        raw = response.read()
        kind = response.getheader("Content-Type", "")
        data = json.loads(raw) if kind.startswith("application/json") else raw
        return response.status, data, response
    finally:
        if own:
            connection.close()


def frame(server, fields, camera=b"", connection=None, headers=None):
    """One frame exchange; returns (status, fields or the error, JPEG bytes)."""
    headers = {"Content-Type": browser.FRAME_TYPE, **(headers or {})}
    body = browser.pack(fields, camera)
    status, raw, response = call(
        server, "POST", "/api/frame", body, headers, connection=connection
    )
    if status != 200:
        return status, raw, None
    assert response.getheader("Content-Type") == browser.FRAME_TYPE
    return (status, *browser.unpack(raw))


def start(server, **config):
    status, data, _ = call(server, "POST", "/api/start", config)
    assert status == 200, data
    return data


def test_pages_and_art_are_served_with_their_types(server):
    status, page, response = call(server, "GET", "/")
    assert status == 200 and b"<html" in page
    assert response.getheader("Content-Type") == "text/html; charset=utf-8"
    status, art, response = call(server, "GET", "/art/zombies")
    assert status == 200 and art.startswith(b"\xff\xd8")
    assert response.getheader("Content-Type") == "image/jpeg"
    status, config, _ = call(server, "GET", "/api/config")
    assert status == 200 and config["token"] == server.token
    # The camera encoder runs as a worker, which only a same-origin script can be.
    status, script, response = call(server, "GET", "/capture.js")
    assert status == 200 and b"convertToBlob" in script
    assert response.getheader("Content-Type") == "text/javascript; charset=utf-8"


@pytest.mark.parametrize(
    "path", ["/../pyproject.toml", "/art/../../pyproject.toml", "/art/kart2", "/nope"]
)
def test_unknown_paths_and_traversal_are_not_found(server, path):
    assert call(server, "GET", path)[0] == 404


@pytest.mark.parametrize("host", ["evil.example", "evil.example:{port}", "127.0.0.1:1"])
def test_other_host_names_are_refused(server, host):
    # A DNS-rebinding page reaches this port under its own host name.
    headers = {"Host": host.format(port=server.server_port)}
    assert call(server, "GET", "/api/config", headers=headers)[0] == 403
    assert call(server, "POST", "/api/start", {}, headers=headers)[0] == 403


@pytest.mark.parametrize("token", [None, "", "wrong", "café"])
def test_posts_without_the_page_token_are_refused(server, token):
    headers = {} if token is None else {"X-Handy-Token": token}
    status, data, _ = call(
        server, "POST", "/api/start", {}, headers=headers, token=False
    )
    assert status == 403 and "Reload" in data["error"]
    assert server.session is None


@pytest.mark.parametrize(
    "body, length",
    [
        (b"{}", str(browser.MAX_BODY + 1)),
        (b"", "0"),
        (b"{}", "not a number"),
        (b"[]", None),
        (b"{nope", None),
    ],
)
def test_oversized_empty_and_malformed_bodies_are_refused(server, body, length):
    headers = {} if length is None else {"Content-Length": length}
    status, data, response = call(server, "POST", "/api/start", body, headers=headers)
    assert status == 400 and data["error"]
    # Part of that body may be unread: the connection cannot carry another request.
    assert response.getheader("Connection") == "close"


def test_frames_share_one_kept_alive_connection(server):
    session = start(server)
    connection = http.client.HTTPConnection("127.0.0.1", server.server_port, timeout=5)
    try:
        frame(server, {"id": session["id"]}, connection=connection)
        local = connection.sock.getsockname()
        for _ in range(3):
            status, data, image = frame(
                server, {"id": session["id"]}, connection=connection
            )
            assert status == 200 and data["state"] == "playing"
            assert image.startswith(b"\xff\xd8") and "image" not in data
            assert connection.sock.getsockname() == local
    finally:
        connection.close()


def test_a_stalled_client_is_disconnected(server, monkeypatch):
    # Hundreds of half-sent requests would otherwise each hold a thread forever.
    assert 0 < browser.Handler.timeout <= 30
    monkeypatch.setattr(browser.Handler, "timeout", 0.2)
    with socket.create_connection(("127.0.0.1", server.server_port)) as stalled:
        stalled.sendall(b"GET / HTTP/1.1\r\nHost: 127.0.0.1\r\n")  # never finished
        stalled.settimeout(5)
        began = time.monotonic()
        assert stalled.recv(100) == b""
        assert time.monotonic() - began < 4


def test_a_tab_leaving_mid_request_is_not_an_error(server, monkeypatch, capsys):
    session = start(server)
    handled = threading.Event()
    errors = []
    tick = browser.BrowserSession.tick

    def slow_tick(self, data, wall_time=None, camera=None):
        time.sleep(0.1)  # long enough for the client below to be gone
        return tick(self, data, wall_time, camera)

    finish = browser.Handler.finish

    def finished(self):
        try:
            finish(self)
        finally:
            handled.set()

    monkeypatch.setattr(browser.BrowserSession, "tick", slow_tick)
    monkeypatch.setattr(browser.Handler, "finish", finished)
    monkeypatch.setattr(server, "handle_error", lambda *args: errors.append(args))
    body = browser.pack({"id": session["id"]})
    with socket.create_connection(("127.0.0.1", server.server_port)) as dropped:
        # Reset rather than close, as a closing tab or a reload does.
        dropped.setsockopt(socket.SOL_SOCKET, socket.SO_LINGER, struct.pack("ii", 1, 0))
        dropped.sendall(
            b"POST /api/frame HTTP/1.1\r\nHost: 127.0.0.1:%d\r\nX-Handy-Token: %s\r\n"
            b"Content-Length: %d\r\n\r\n%s"
            % (server.server_port, server.token.encode(), len(body), body)
        )
        time.sleep(0.02)
    assert handled.wait(5)
    assert not errors
    output = capsys.readouterr()
    assert "Traceback" not in output.err + output.out
    assert "request failed" not in output.err + output.out


def test_unexpected_failures_answer_500_and_are_reported_on_stderr(
    server, monkeypatch, capsys
):
    session = start(server)

    def broken(*_args, **_kwargs):
        raise RuntimeError("renderer fell over")

    monkeypatch.setattr(browser.BrowserSession, "tick", broken)
    status, data, _ = frame(server, {"id": session["id"]})
    assert status == 500 and "terminal" in data["error"]
    assert "renderer fell over" in capsys.readouterr().err


@pytest.fixture
def slow_models(monkeypatch):
    """Model loads that block, as a first-run download does, until released."""
    loading, release = threading.Event(), threading.Event()

    def download(_name, progress=None):
        loading.set()
        assert release.wait(10)
        return "unused"

    monkeypatch.setattr(browser, "ensure_model", download)
    yield loading, release
    release.set()


def start_in_background(server, **config):
    answers = []
    thread = threading.Thread(
        target=lambda: answers.append(call(server, "POST", "/api/start", config)),
        daemon=True,
    )
    thread.start()
    return thread, answers


def test_a_slow_start_does_not_hold_up_the_open_game(server, slow_models, streams):
    loading, release = slow_models
    playing = start(server)
    thread, answers = start_in_background(server, control="pistol")
    assert loading.wait(5)
    began = time.monotonic()
    for _ in range(3):
        status, _, _ = frame(server, {"id": playing["id"]})
        assert status == 200
    assert time.monotonic() - began < 2
    release.set()
    thread.join(5)
    status, loaded, _ = answers[0]
    assert status == 200 and loaded["state"] == "calibration"
    # The newer start replaced the game that kept running meanwhile.
    assert server.session.id == loaded["id"]
    assert frame(server, {"id": playing["id"]})[0] == 400
    assert not streams[0].closed


def test_stopping_the_server_does_not_wait_for_a_slow_start(
    server, slow_models, streams
):
    loading, release = slow_models
    thread, answers = start_in_background(server, control="pistol")
    assert loading.wait(5)
    began = time.monotonic()
    server.shutdown()
    server.server_close()
    assert time.monotonic() - began < 2
    release.set()
    thread.join(5)
    # The session it finished building is closed, not left behind.
    assert answers[0][0] == 400
    assert server.session is None and streams[0].closed


def test_a_game_its_tab_abandoned_is_closed(server, streams):
    session = start(server, control="pistol")
    later = time.monotonic() + browser.IDLE_TIMEOUT
    server.close_idle(later - 1)
    assert server.session is not None and not streams[0].closed
    server.close_idle(later + 1)
    assert server.session is None and streams[0].closed
    status, data, _ = frame(server, {"id": session["id"]})
    assert status == 400 and "a minute" in data["error"]


def test_a_paused_game_that_keeps_polling_stays_open(server):
    server.idle_timeout = 1.0
    session = start(server)
    call(server, "POST", "/api/action", {"id": session["id"], "action": "pause"})
    began = time.monotonic()
    while time.monotonic() - began < 1.5:
        # A paused tab keeps asking for frames, only without a camera image.
        status, data, _ = frame(server, {"id": session["id"]})
        assert status == 200 and data["state"] == "paused"
        time.sleep(0.05)
    # Once it stops polling, the server's own loop closes it.
    deadline = time.monotonic() + 5
    while server.session is not None and time.monotonic() < deadline:
        time.sleep(0.05)
    assert server.session is None


def test_a_decode_bomb_is_refused(server):
    session = start(server, control="pistol")
    raw = bytearray(cv2.imencode(".jpg", np.zeros((48, 64, 3), np.uint8))[1])
    at = raw.find(b"\xff\xc0")
    raw[at + 5 : at + 9] = (30000).to_bytes(2, "big") * 2  # 30000 x 30000
    status, data, _ = frame(server, {"id": session["id"]}, bytes(raw))
    assert status == 400 and "1280 by 720" in data["error"]


def test_a_camera_frame_travels_as_bytes_to_the_recogniser(server, streams):
    session = start(server, control="pistol")
    seen = []
    streams[0].submit = lambda image: seen.append(image.shape) or 0
    camera = browser.jpeg(np.zeros((48, 64, 3), np.uint8))
    status, data, image = frame(server, {"id": session["id"]}, camera)
    assert status == 200 and seen == [(48, 64, 3)]
    drawn = cv2.imdecode(np.frombuffer(image, np.uint8), cv2.IMREAD_COLOR)
    assert drawn.shape[:2] == (server.session.height, server.session.width)
    # The fields are JSON, so the camera can never arrive as one of them.
    status, _, _ = frame(server, {"id": session["id"], "camera": "AAAA"})
    assert status == 200 and len(seen) == 1


@pytest.mark.parametrize(
    "body",
    [
        b"\x00\x00",  # shorter than its own length
        b"\x00\x00\x00\x09{}",  # claims more JSON than there is
        b"\xff\xff\xff\xff{}",
        b"\x00\x00\x00\x02[]",
        b"\x00\x00\x00\x02{}",  # no game named
        b'{"id": "x"}',  # the JSON the frame exchange used to take
    ],
)
def test_malformed_frame_messages_are_refused(server, body):
    start(server)
    status, data, response = call(
        server, "POST", "/api/frame", body, {"Content-Type": browser.FRAME_TYPE}
    )
    assert status == 400 and data["error"]
    assert response.getheader("Connection") == "close"


@pytest.mark.parametrize(
    "headers, token",
    [
        ({}, False),
        ({"Host": "evil.example"}, True),
        ({"Sec-Fetch-Site": "cross-site", "Sec-Fetch-Mode": "no-cors"}, True),
        ({"Origin": "http://evil.example"}, True),
        ({"Content-Length": str(browser.MAX_BODY + 1)}, True),
    ],
)
def test_the_frame_exchange_keeps_every_check(server, headers, token):
    session = start(server)
    body = browser.pack({"id": session["id"], "fire": True})
    status, _, _ = call(
        server,
        "POST",
        "/api/frame",
        body,
        {"Content-Type": browser.FRAME_TYPE, **headers},
        token=token,
    )
    assert status in (400, 403)
    assert server.session.round.shots == 0


def test_an_unusable_saved_setup_is_replaced_and_forgotten(server, capsys):
    from handy.calibration import default_rig

    good = default_rig(schemes.PISTOL, 1)[0].to_dict()
    damaged = {"cameras": [{**good, "mapping": good["mapping"][:8]}]}
    for _ in range(2):  # it used to fail every start, not just the first
        data = start(server, control="pistol", calibration=damaged)
        assert data["state"] == "calibration" and data["forgetSavedSetup"] is True
    kept = start(server, control="pistol", calibration={"cameras": [good]})
    assert kept["forgetSavedSetup"] is False
    assert start(server)["forgetSavedSetup"] is False
    assert "Ignoring a saved browser setup" in capsys.readouterr().err


def test_stale_actions_are_answered_not_refused(server):
    session = start(server, control="pistol")
    # Setup ends itself on the fifth accurate hit; stand in for the five.
    server.session.calibration.hits.update(range(5))
    call(server, "POST", "/api/action", {"id": session["id"], "action": "finish"})
    for action in ("play", "undo", "reset", "finish", "resume"):
        status, data, _ = call(
            server, "POST", "/api/action", {"id": session["id"], "action": action}
        )
        assert status == 200 and data["state"] == "playing", (action, data)


def test_a_short_window_does_not_end_the_game(server):
    # A stage 1200 by 100 pixels: every warm-up frame used to be refused.
    assert start(server, viewSize=[2000, 100])["state"] == "playing"
    session = start(server, control="pistol", viewSize=[1200, 100])
    for view in ([1200, 100], [90, 900], None):
        status, data, _ = frame(server, {"id": session["id"], "viewSize": view})
        assert status == 200 and data["state"] == "calibration"


@pytest.mark.parametrize("failure", [TimeoutError, ConnectionResetError])
def test_a_failed_model_download_is_reported_not_mistaken_for_a_closed_tab(
    server, monkeypatch, capsys, failure
):
    def download(_name, progress=None):
        raise failure("the model server stopped answering")

    monkeypatch.setattr(browser, "ensure_model", download)
    status, data, _ = call(server, "POST", "/api/start", {"control": "pistol"})
    assert status == 500 and "terminal" in data["error"]
    assert "stopped answering" in capsys.readouterr().err
    assert server.session is None


def test_every_response_forbids_cross_origin_embedding(server):
    for path in ("/", "/app.js", "/art/western", "/api/config", "/missing"):
        response = call(server, "GET", path)[2]
        assert response.getheader("Cross-Origin-Resource-Policy") == "same-origin"


@pytest.mark.parametrize(
    "labels",
    [
        # Another website fetching the token, or drawing the art into a canvas.
        {"Sec-Fetch-Site": "cross-site", "Sec-Fetch-Mode": "cors"},
        {
            "Sec-Fetch-Site": "cross-site",
            "Sec-Fetch-Mode": "no-cors",
            "Sec-Fetch-Dest": "image",
        },
        # A server on another port of this machine is the same site, not origin.
        {"Sec-Fetch-Site": "same-site", "Sec-Fetch-Mode": "cors"},
        # Framing the arcade from elsewhere.
        {
            "Sec-Fetch-Site": "cross-site",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Dest": "iframe",
        },
        {"Origin": "http://evil.example"},
        {"Origin": "null"},
    ],
)
def test_other_sites_cannot_read_or_post(server, labels):
    assert call(server, "GET", "/api/config", headers=labels)[0] == 403
    assert call(server, "GET", "/art/zombies", headers=labels)[0] == 403
    assert call(server, "POST", "/api/start", {}, headers=labels)[0] == 403
    assert server.session is None


def test_the_page_itself_and_links_to_it_are_allowed(server):
    port = server.server_port
    own = {
        "Sec-Fetch-Site": "same-origin",
        "Sec-Fetch-Mode": "cors",
        "Origin": f"http://localhost:{port}",
        "Host": f"localhost:{port}",
    }
    assert call(server, "GET", "/api/config", headers=own)[0] == 200
    assert call(server, "POST", "/api/start", {}, headers=own)[0] == 200
    # Opened from the terminal, a bookmark, or a link on another website.
    for site in ("none", "cross-site"):
        link = {
            "Sec-Fetch-Site": site,
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Dest": "document",
        }
        assert call(server, "GET", "/", headers=link)[0] == 200
    # A form on another site may navigate here, but never post.
    form = {**link, "Origin": "http://evil.example"}
    assert call(server, "POST", "/api/start", {}, headers=form)[0] == 403


# --- returning players, first runs, art and sound ----------------------------------


def test_a_returning_player_starts_straight_into_the_game(server):
    from handy.calibration import default_rig

    checked = {
        **default_rig(schemes.PISTOL, 1)[0].to_dict(),
        "aim_fitted": True,
        "fit_error": 0.01,
    }
    data = start(
        server, control="pistol", calibration={"cameras": [checked]}, useSavedAim=True
    )
    assert data["state"] == "playing" and "step" not in data
    assert data["forgetSavedSetup"] is False
    status, data, _ = call(
        server, "POST", "/api/action", {"id": data["id"], "action": "calibrate"}
    )
    assert status == 200 and data["state"] == "calibration"


def test_progress_is_idle_until_a_start_is_loading(server, slow_models):
    loading, release = slow_models
    status, data, response = call(server, "GET", "/api/progress")
    assert status == 200 and data == {"loading": False, "fraction": None}
    assert response.getheader("Cache-Control") == "no-store"
    thread, answers = start_in_background(server, control="pistol")
    assert loading.wait(5)
    assert call(server, "GET", "/api/progress")[1]["loading"] is True
    release.set()
    thread.join(5)
    assert answers[0][0] == 200
    assert call(server, "GET", "/api/progress")[1]["loading"] is False


def test_a_first_run_download_reports_how_far_it_has_got(server, monkeypatch):
    halfway, release = threading.Event(), threading.Event()

    def download(_name, progress=None):
        progress(4_000_000, 8_000_000)
        halfway.set()
        assert release.wait(10)
        progress(8_000_000, 8_000_000)
        return "unused"

    monkeypatch.setattr(browser, "ensure_model", download)
    monkeypatch.setattr(browser, "cached", lambda _name: False)
    thread, answers = start_in_background(server, control="pistol")
    assert halfway.wait(5)
    assert call(server, "GET", "/api/progress")[1] == {"loading": True, "fraction": 0.5}
    release.set()
    thread.join(5)
    assert answers[0][0] == 200


@pytest.fixture
def sounds(server):
    """A small sound set, built before the test rather than in the background."""
    bank = browser.SoundBank(names=("shot", "hit_0"), takes=2)
    bank.build()
    server.sounds = bank
    return bank


def test_the_sound_set_is_listed_and_served_as_wav(server, sounds):
    status, manifest, response = call(server, "GET", "/audio/manifest.json")
    assert status == 200 and manifest == {"ready": True, "cues": {"shot": 2, "hit_0": 2}}
    status, wav, response = call(server, "GET", "/audio/shot/1.wav")
    assert status == 200 and wav[:4] == b"RIFF" and wav[8:12] == b"WAVE"
    assert response.getheader("Content-Type") == "audio/wav"
    assert response.getheader("X-Content-Type-Options") == "nosniff"
    assert response.getheader("Cross-Origin-Resource-Policy") == "same-origin"
    assert wav == sounds.get("shot", 1)


def test_sounds_still_being_built_are_listed_as_they_arrive(server):
    bank = browser.SoundBank(names=("shot", "miss"), takes=2)
    server.sounds = bank
    assert call(server, "GET", "/audio/manifest.json")[1] == {"ready": False, "cues": {}}
    assert call(server, "GET", "/audio/shot/0.wav")[0] == 503
    bank.files["shot", 0] = b"RIFF"
    bank.files["shot", 1] = b"RIFF"
    bank.files["miss", 1] = b"RIFF"  # take 0 is not there yet: not listed
    assert call(server, "GET", "/audio/manifest.json")[1]["cues"] == {"shot": 2}


@pytest.mark.parametrize(
    "path",
    [
        "/audio/kazoo/0.wav",
        "/audio/shot/2.wav",  # past the takes the set keeps
        "/audio/shot/-1.wav",
        "/audio/shot/0",
        "/audio/shot/0.mp3",
        "/audio/shot/%C2%B2.wav",  # a superscript two, which str.isdigit allows
        "/audio/shot/%30.wav",  # a zero, but the path is never decoded
        "/audio/shot",
        "/audio/../pyproject.toml",
        "/audio/shot/../../pyproject.toml",
    ],
)
def test_unknown_sounds_are_not_found(server, sounds, path):
    assert call(server, "GET", path)[0] == 404


def test_without_a_sound_set_there_is_nothing_to_hear(server):
    assert server.sounds is None
    assert call(server, "GET", "/audio/manifest.json")[0] == 404
    assert call(server, "GET", "/audio/shot/0.wav")[0] == 404


@pytest.mark.parametrize(
    "labels",
    [
        {"Sec-Fetch-Site": "cross-site", "Sec-Fetch-Mode": "cors"},
        {"Sec-Fetch-Site": "same-site", "Sec-Fetch-Mode": "no-cors", "Sec-Fetch-Dest": "audio"},
        {"Origin": "http://evil.example"},
        {"Host": "evil.example"},
    ],
)
def test_other_sites_cannot_read_the_new_routes(server, sounds, labels):
    for path in (
        "/api/progress",
        "/audio/manifest.json",
        "/audio/shot/0.wav",
        "/art/western?w=720&h=405",
    ):
        assert call(server, "GET", path, headers=labels)[0] == 403, path


def test_every_element_and_icon_the_script_names_is_in_the_page(server):
    """The script finds its elements by id; a renamed one fails only in play."""
    import re

    script = call(server, "GET", "/app.js")[1].decode()
    page = call(server, "GET", "/")[1].decode()
    present = set(re.findall(r'id="([\w-]+)"', page))
    named = {
        *re.findall(r'\$\("([\w-]+)"\)', script),
        *re.findall(r'getElementById\("([\w-]+)"\)', script),
        *re.findall(r'setText\("([\w-]+)"', script),
    }
    assert named and named <= present, named - present
    icons = {*re.findall(r'icon\("([\w-]+)"\)', script), *re.findall(r'icon: "([\w-]+)"', script)}
    assert icons and {f"i-{name}" for name in icons} <= present


def test_art_is_drawn_at_the_size_asked_for_within_limits(server):
    def size(path):
        status, raw, response = call(server, "GET", path)
        assert status == 200 and response.getheader("Content-Type") == "image/jpeg"
        image = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)
        return image.shape[1], image.shape[0]

    assert size("/art/orbit") == (360, 200)
    assert size("/art/orbit?w=720&h=405") == (720, 405)
    (low_w, low_h), (high_w, high_h) = browser.ART_SIZES
    assert size("/art/orbit?w=99999&h=99999") == (high_w, high_h)
    assert size("/art/orbit?w=1&h=-5") == (low_w, low_h)
    for query in ("w=abc", "h=1e9", "w=7.5"):
        assert call(server, "GET", f"/art/orbit?{query}")[0] == 400
    assert call(server, "GET", "/art/kart?w=720&h=405")[0] == 404
