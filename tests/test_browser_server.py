"""The browser mode's real HTTP layer, served on a loopback port for each test.

MediaPipe and the model files are replaced by a fake stream, so camera sessions
start instantly and offline; everything between the socket and the session is
the code the page talks to.
"""

import base64
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
        pass

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

    monkeypatch.setattr(browser, "ensure_model", lambda _name: "unused")
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
        call(server, "POST", "/api/frame", {"id": session["id"]}, connection=connection)
        local = connection.sock.getsockname()
        for _ in range(3):
            status, data, _ = call(
                server,
                "POST",
                "/api/frame",
                {"id": session["id"]},
                connection=connection,
            )
            assert status == 200 and data["image"]
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

    def slow_tick(self, data, wall_time=None):
        time.sleep(0.1)  # long enough for the client below to be gone
        return tick(self, data, wall_time)

    finish = browser.Handler.finish

    def finished(self):
        try:
            finish(self)
        finally:
            handled.set()

    monkeypatch.setattr(browser.BrowserSession, "tick", slow_tick)
    monkeypatch.setattr(browser.Handler, "finish", finished)
    monkeypatch.setattr(server, "handle_error", lambda *args: errors.append(args))
    body = json.dumps({"id": session["id"]}).encode()
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

    def broken(*_args):
        raise RuntimeError("renderer fell over")

    monkeypatch.setattr(browser.BrowserSession, "tick", broken)
    status, data, _ = call(server, "POST", "/api/frame", {"id": session["id"]})
    assert status == 500 and "terminal" in data["error"]
    assert "renderer fell over" in capsys.readouterr().err


@pytest.fixture
def slow_models(monkeypatch):
    """Model loads that block, as a first-run download does, until released."""
    loading, release = threading.Event(), threading.Event()

    def download(_name):
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
        status, _, _ = call(server, "POST", "/api/frame", {"id": playing["id"]})
        assert status == 200
    assert time.monotonic() - began < 2
    release.set()
    thread.join(5)
    status, loaded, _ = answers[0]
    assert status == 200 and loaded["state"] == "calibration"
    # The newer start replaced the game that kept running meanwhile.
    assert server.session.id == loaded["id"]
    assert call(server, "POST", "/api/frame", {"id": playing["id"]})[0] == 400
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
    status, data, _ = call(server, "POST", "/api/frame", {"id": session["id"]})
    assert status == 400 and "a minute" in data["error"]


def test_a_paused_game_that_keeps_polling_stays_open(server):
    server.idle_timeout = 1.0
    session = start(server)
    call(server, "POST", "/api/action", {"id": session["id"], "action": "pause"})
    began = time.monotonic()
    while time.monotonic() - began < 1.5:
        # A paused tab keeps asking for frames, only without a camera image.
        status, data, _ = call(server, "POST", "/api/frame", {"id": session["id"]})
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
    bomb = base64.b64encode(bytes(raw)).decode()
    status, data, _ = call(
        server, "POST", "/api/frame", {"id": session["id"], "camera": bomb}
    )
    assert status == 400 and "1280 by 720" in data["error"]


def test_an_unusable_saved_setup_is_replaced_and_forgotten(server, capsys):
    from handy.calibration import default_rig

    good = default_rig(schemes.PISTOL, 1)[0].to_dict()
    damaged = {"cameras": [{**good, "slide": ["a", "b"]}]}
    for _ in range(2):  # it used to fail every start, not just the first
        data = start(server, control="pistol", calibration=damaged)
        assert data["state"] == "calibration" and data["forgetSavedSetup"] is True
    kept = start(server, control="pistol", calibration={"cameras": [good]})
    assert kept["forgetSavedSetup"] is False
    assert start(server)["forgetSavedSetup"] is False
    assert "Ignoring a saved browser setup" in capsys.readouterr().err


def test_stale_actions_are_answered_not_refused(server):
    session = start(server, control="pistol")
    for action in ("skip", "play"):
        call(server, "POST", "/api/action", {"id": session["id"], "action": action})
    for action in ("play", "undo", "reset", "skip", "finish", "resume"):
        status, data, _ = call(
            server, "POST", "/api/action", {"id": session["id"], "action": action}
        )
        assert status == 200 and data["state"] == "playing", (action, data)


def test_a_short_window_does_not_end_the_game(server):
    # A stage 1200 by 100 pixels: every warm-up frame used to be refused.
    assert start(server, viewAspect=20)["state"] == "playing"
    session = start(server, control="pistol", viewAspect=12)
    for aspect in (12, 0.1, None):
        status, data, _ = call(
            server, "POST", "/api/frame", {"id": session["id"], "viewAspect": aspect}
        )
        assert status == 200 and data["state"] == "calibration"


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
