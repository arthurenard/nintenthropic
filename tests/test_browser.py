"""Browser adapter regressions: existing rules, lifecycle, and input boundaries."""

import base64

import cv2
import numpy as np
import pytest

from handy import browser, maps
from handy.browser import BrowserSession
from handy.calibration import CalibrationSession
from handy.game import Rect, RoundOptions
from handy.maps.zombies import ZombieRound, draw_robot
from handy.recognition import Frame
from handy.schemes import PISTOL
from hands import frame_of, make_hand


@pytest.mark.parametrize("key", maps.keys())
def test_every_map_runs_in_browser_without_a_camera(key, monkeypatch):
    def no_models(*_args, **_kwargs):
        pytest.fail("Mouse/keyboard must not load models")

    monkeypatch.setattr(browser, "ensure_model", no_models)
    session = BrowserSession(
        {"map": key, "control": "keyboard" if key == "kart" else "mouse"}
    )
    data = session.tick(
        {"x": 0.5, "y": 0.5, "fire": True, "throttle": 1}, session.last_tick + 0.033
    )
    image = cv2.imdecode(
        np.frombuffer(base64.b64decode(data["image"]), np.uint8), cv2.IMREAD_COLOR
    )
    assert image.shape == (540, 960, 3)
    assert np.ptp(image) > 50
    assert data["state"] == "playing"
    if key != "kart":
        assert session.round.shots == 1
    session.close()


def test_mouse_shots_use_original_target_hit_testing():
    session = BrowserSession({"map": "zombies", "enemy": "robots"})
    session.tick({}, session.last_tick + 0.03)
    walker = session.round.walkers[0]
    # Place a target in view, then hit the head defined by the original model.
    walker.lane = 0
    x, y = walker.figure(session.round.view, session.clock).head
    session.tick(
        {"x": x / browser.WIDTH, "y": y / browser.HEIGHT, "fire": True},
        session.last_tick,
    )
    assert session.round.kills == 1
    assert session.round.perfect == 1
    assert not session.round.stains


def test_pause_does_not_advance_clock_or_accept_shots():
    session = BrowserSession({})
    session.tick({}, session.last_tick + 0.03)
    session.action("pause", {})
    before = session.clock
    data = session.tick({"fire": True}, session.last_tick + 60)
    assert data["state"] == "paused"
    assert session.clock == before
    assert session.round.shots == 0
    session.action("resume", {})
    session.tick({}, session.last_tick + 0.03)
    assert session.clock == pytest.approx(before + 0.03)


def test_round_end_rejects_shots_and_restarts_cleanly():
    session = BrowserSession({"duration": 15})
    session.tick({}, session.last_tick)
    session.clock = 16
    session.tick({"fire": True}, session.last_tick)
    assert session.state == "over"
    assert session.round.shots == 0
    session.action("play", {})
    assert session.state == "playing"
    assert session.clock == 0
    assert session.round.started_at is None


@pytest.mark.parametrize(
    "config",
    [
        {"map": "kart", "control": "gaze"},
        {"map": "range", "control": "wheel"},
        {"enemy": "unknown"},
        {"duration": float("nan")},
        {"duration": -1},
    ],
)
def test_invalid_launch_configuration_is_rejected(config):
    with pytest.raises(ValueError):
        BrowserSession(config)


@pytest.mark.parametrize("data", [{"x": float("inf")}, {"x": -1}, {"x": "1"}])
def test_invalid_pointer_never_enters_game_geometry(data):
    with pytest.raises(ValueError):
        BrowserSession({}).tick(data)


def test_quick_calibration_omits_only_unneeded_depth_poses():
    assert len(CalibrationSession(PISTOL, grid=2, quick=True).steps) == 6
    assert len(CalibrationSession(PISTOL, cameras=2, grid=2, quick=True).steps) == 8
    assert len(CalibrationSession(PISTOL, grid=3).steps) == 13


def test_back_and_retry_discard_bad_samples_not_previous_progress():
    s = CalibrationSession(PISTOL, grid=2, dwell=0.1, settle=0, quick=True)
    frame = frame_of(make_hand(index_tip=(0.2, 0.2)))
    s.update([frame], 0)
    s.update([frame], 0.2)
    assert s._index == 1
    s.update([frame], 0.3)
    s.retry(0.4)
    assert s._index == 1 and not any(s._samples)
    assert "aim_0" in s._recorded
    s.back(0.5)
    assert s._index == 0 and not s._recorded


class FakeStream:
    def __init__(self):
        self.current = Frame()
        self.closed = False

    def latest(self):
        return self.current

    def submit(self, _image):
        pass

    def close(self):
        self.closed = True


def camera_session(monkeypatch):
    stream = FakeStream()
    monkeypatch.setattr(browser, "ensure_model", lambda _name: "unused")
    monkeypatch.setattr(
        browser.schemes,
        "for_map",
        lambda _key: __import__("dataclasses").replace(
            PISTOL, open_stream=lambda *_args: stream
        ),
    )
    return BrowserSession({"control": "pistol"}), stream


def camera_payload():
    return {
        "camera": base64.b64encode(
            browser.jpeg(np.zeros((48, 64, 3), np.uint8))
        ).decode()
    }


def claiming(width, height, progressive=False):
    """A tiny real JPEG whose header claims to be ``width`` by ``height``."""
    flags = [cv2.IMWRITE_JPEG_PROGRESSIVE, int(progressive)]
    raw = bytearray(cv2.imencode(".jpg", np.zeros((48, 64, 3), np.uint8), flags)[1])
    at = raw.find(b"\xff\xc2" if progressive else b"\xff\xc0")
    raw[at + 5 : at + 9] = height.to_bytes(2, "big") + width.to_bytes(2, "big")
    return bytes(raw)


@pytest.mark.parametrize("progressive", [False, True])
def test_jpeg_size_is_read_from_the_header(progressive):
    assert browser.jpeg_size(claiming(64, 48, progressive)) == (64, 48)
    assert browser.jpeg_size(claiming(30000, 30000, progressive)) == (30000, 30000)


@pytest.mark.parametrize(
    "raw",
    [b"\xff\xd8", b"\xff\xd8\xff\xd9", b"\xff\xd8\xff\xda\x00\x02", b"\xff\xd8junk"],
)
def test_jpeg_without_a_frame_header_is_invalid(raw):
    with pytest.raises(ValueError):
        browser.jpeg_size(raw)


def test_decode_bomb_is_refused_before_decoding(monkeypatch):
    session, _stream = camera_session(monkeypatch)

    def decode(*_args):
        pytest.fail("A frame claiming 30000x30000 pixels must never be decoded")

    monkeypatch.setattr(browser.cv2, "imdecode", decode)
    bomb = base64.b64encode(claiming(30000, 30000)).decode()
    with pytest.raises(ValueError, match="1280 by 720"):
        session.tick({"camera": bomb})


def test_undecodable_camera_frame_is_a_bad_request(monkeypatch):
    session, _stream = camera_session(monkeypatch)

    def decode(*_args):
        raise cv2.error("corrupt data")

    monkeypatch.setattr(browser.cv2, "imdecode", decode)
    with pytest.raises(ValueError, match="Invalid camera frame"):
        session.tick(camera_payload())


def shoot_setup_target(session, stream, point=None):
    from dataclasses import replace

    target = session.calibration.target
    point = point or (0.2 + 0.6 * target[0], 0.25 + 0.5 * target[1])
    result = None
    for degrees in [20] * 8 + [70] * 4:
        stream.current = replace(
            frame_of(make_hand(index_tip=point, thumb_degrees=degrees)),
            timestamp_ms=stream.current.timestamp_ms + 1,
        )
        result = session.tick(camera_payload(), session.last_tick + 0.05)
    return result


def test_shoot_to_calibrate_waits_for_fresh_thumb_pulls(monkeypatch):
    session, stream = camera_session(monkeypatch)
    stream.current = frame_of(make_hand())
    for _ in range(20):
        session.tick(camera_payload(), session.last_tick + 0.1)
    assert session.state == "calibration"
    assert session.calibration.samples == []
    with pytest.raises(ValueError, match="five"):
        session.action("finish", {})
    session.action("skip", {})
    assert session.state == "practice"
    session.action("play", {})
    assert session.state == "playing"
    session.close()
    assert stream.closed


def test_range_warmup_verifies_five_hits_then_saves_and_starts(monkeypatch):
    session, stream = camera_session(monkeypatch)
    result = shoot_setup_target(session, stream)
    assert result["step"]["learningShots"] == 1 and not result["step"]["preview"]
    result = shoot_setup_target(session, stream)
    assert result["step"]["preview"] and not result["step"]["ready"]
    result = shoot_setup_target(session, stream)
    assert result["step"]["testing"] and result["step"]["hits"] == 0
    mapping = session.calibration.rig[0].mapping
    for count in range(1, 5):
        result = shoot_setup_target(session, stream)
        assert session.state == "calibration"
        assert result["step"]["hits"] == count
        assert session.calibration.rig[0].mapping == mapping
        assert session.saved_rig is None
    shoot_setup_target(session, stream)
    assert session.state == "playing"
    assert session.saved_rig is not None
    assert session.rig[0].mapping == mapping
    assert not session.rig[0].trigger_fitted


def test_browser_returns_hand_skeleton_and_clears_it_on_tracking_loss(monkeypatch):
    session, stream = camera_session(monkeypatch)
    hand = make_hand()
    stream.current = frame_of(hand)
    result = session.tick(camera_payload(), session.last_tick + 0.05)
    assert result["hands"] == [list(hand.landmarks)]
    result = session.tick({}, session.last_tick + 1)
    assert result["hands"] == []


@pytest.mark.parametrize("removed", ["range", "kart"])
def test_warmup_and_removed_speedway_are_not_selectable_games(removed):
    assert removed not in maps.keys()
    with pytest.raises(ValueError, match="arcade"):
        BrowserSession({"map": removed})


def test_bad_shot_can_be_retried_and_reset_discards_unaccepted_fit(monkeypatch):
    session, stream = camera_session(monkeypatch)
    shoot_setup_target(session, stream, (0.5, 0.5))
    result = shoot_setup_target(session, stream, (0.5, 0.5))
    assert result["step"]["learningShots"] == 1
    assert "too similar" in result["notice"]
    session.action("reset", {})
    assert not session.calibration.samples
    assert not session.calibration.preview


def test_robots_render_and_share_damage_rules():
    round_ = ZombieRound(RoundOptions(Rect(0, 0, 960, 540), enemy="robots", seed=2))
    round_.update(0)
    assert all(w.gait != "crawl" for w in round_.walkers)
    canvas = np.zeros((540, 960, 3), np.uint8)
    walker = round_.walkers[0]
    walker.lane = 0
    draw_robot(canvas, walker, round_.view, 0)
    assert canvas.any()
    head = walker.figure(round_.view, 0).head
    assert round_.shoot(*head, 0).is_hit
    assert round_.kills == 1 and not round_.stains
    round_.walkers[0].distance = 1
    round_.update(0.1)
    assert round_.health == 82


@pytest.mark.parametrize("map_key", ["western", "sniper"])
def test_hand_input_selects_the_maps_tracker_and_fires(map_key, monkeypatch):
    from dataclasses import replace
    from eyes import make_face
    from handy.marksman import Marksman, MarksmanFrame
    from handy import schemes

    scheme = schemes.for_map(map_key)
    stream = FakeStream()
    fetched = []
    monkeypatch.setattr(
        browser, "ensure_model", lambda name: fetched.append(name) or "unused"
    )
    monkeypatch.setattr(
        browser.schemes,
        "for_map",
        lambda key: replace(scheme, open_stream=lambda *_args: stream),
    )
    session = BrowserSession({"control": "pistol", "map": map_key})
    assert fetched == list(scheme.models)
    assert session.calibration.samples == []
    session.action("skip", {})
    session.clock = 30
    session.action("play", {})
    for stamp, firing in enumerate([False] * 4 + [True] * 4 + [False] * 4, 1):
        hand = make_hand(thumb_degrees=70 if firing else 20)
        if map_key == "sniper":
            stream.current = MarksmanFrame(
                subjects=(Marksman(hand, make_face()),), timestamp_ms=stamp
            )
        else:
            stream.current = Frame(hands=(hand,), timestamp_ms=stamp)
        result = session.tick(camera_payload(), session.last_tick + 0.05)
        assert result["tracking"]
    assert session.round.shots == 1
    session.close()


def test_sniper_eye_closure_scopes_but_never_shoots(monkeypatch):
    from dataclasses import replace
    from eyes import make_face
    from handy import schemes
    from handy.marksman import Marksman, MarksmanFrame
    from handy.calibration import default_rig

    stream = FakeStream()
    scheme = schemes.MARKSMAN
    monkeypatch.setattr(browser, "ensure_model", lambda name: "unused")
    monkeypatch.setattr(
        browser.schemes,
        "for_map",
        lambda key: replace(scheme, open_stream=lambda *_args: stream),
    )
    hand_rig = default_rig(PISTOL, 1)
    saved = {"cameras": [hand_rig[0].to_dict()]}
    session = BrowserSession(
        {"control": "pistol", "map": "sniper", "calibration": saved}
    )
    assert session.state == "calibration" and session.calibration is not None
    assert session.rig == hand_rig
    session.action("skip", {})
    session.action("play", {})
    # Both closed is a blink. One closed engages scope. Reopening releases it.
    for stamp, (blink, scoped) in enumerate(
        [
            ((0.2, 0.2), False),
            ((0.8, 0.8), False),
            *[((0.8, 0.2), False)] * 3,
            ((0.8, 0.2), True),
            ((0.2, 0.2), False),
        ],
        1,
    ):
        stream.current = MarksmanFrame(
            subjects=(Marksman(make_hand(thumb_degrees=20), make_face(blink=blink)),),
            timestamp_ms=stamp,
        )
        result = session.tick(camera_payload(), session.last_tick + 0.05)
        assert result["scopeTracked"]
        assert session.round.scoped is scoped
        assert session.round.shots == 0
    # Losing the face does not remove hand aiming or require a new setup.
    stream.current = MarksmanFrame(
        subjects=(Marksman(make_hand(), None),), timestamp_ms=10
    )
    result = session.tick(camera_payload(), session.last_tick + 0.05)
    assert result["tracking"] and not result["scopeTracked"]
    session.close()


@pytest.mark.parametrize("control", ["gaze", "marksman"])
def test_eye_shooting_and_standalone_marksman_are_not_public_options(control):
    with pytest.raises(ValueError, match="supported"):
        BrowserSession({"map": "sniper", "control": control})


def test_mouse_scope_uses_the_rifle_reticle():
    session = BrowserSession({"map": "sniper"})
    session.tick(
        {"x": 0.3, "y": 0.4, "scope": True, "fire": True}, session.last_tick + 0.03
    )
    assert session.round.scoped
    impact = session.round.impacts[-1]
    assert (impact.x, impact.y) == session.round.scoped_shot


def test_calibration_resizes_to_stage_and_keeps_it_for_gameplay(monkeypatch):
    session, stream = camera_session(monkeypatch)
    payload = {**camera_payload(), "viewAspect": 2.4}
    result = session.tick(payload, session.last_tick + 0.05)
    image = cv2.imdecode(
        np.frombuffer(base64.b64decode(result["image"]), np.uint8), cv2.IMREAD_COLOR
    )
    assert image.shape[:2] == (400, 960)
    for _ in range(8):
        shoot_setup_target(session, stream)
    assert session.options.area.width == 960 and session.options.area.height == 400
    assert session.round.area.height == 400


@pytest.mark.parametrize(
    "aspect, size",
    [(12, (960, 120)), (8, (960, 120)), (0.1, (225, 900)), (0, (225, 900))],
)
def test_extreme_stage_shapes_are_clamped_not_refused(aspect, size, monkeypatch):
    # A window a few hundred pixels tall must not end the game on its first frame.
    assert BrowserSession({"viewAspect": aspect}).width == size[0]
    session, _stream = camera_session(monkeypatch)
    session.tick({**camera_payload(), "viewAspect": aspect}, session.last_tick)
    assert (session.width, session.height) == size
    assert session.canvas.shape[:2] == size[::-1]


def test_an_unmeasured_stage_keeps_the_current_shape(monkeypatch):
    session, _stream = camera_session(monkeypatch)
    before = (session.width, session.height)
    session.tick({**camera_payload(), "viewAspect": None}, session.last_tick)
    assert (session.width, session.height) == before
    assert BrowserSession({"viewAspect": None}).width == browser.WIDTH


@pytest.mark.parametrize("aspect", ["wide", float("nan"), float("inf"), -1, True])
def test_a_stage_shape_that_is_not_a_number_is_refused(aspect, monkeypatch):
    session, _stream = camera_session(monkeypatch)
    with pytest.raises(ValueError):
        session.tick({"viewAspect": aspect}, session.last_tick)


def test_pausing_setup_does_not_turn_a_folded_thumb_into_a_shot(monkeypatch):
    from dataclasses import replace

    session, stream = camera_session(monkeypatch)
    shoot_setup_target(session, stream)
    session.action("pause", {})
    assert session.info()["step"]["shots"] == 1
    session.action("resume", {})
    for _ in range(5):
        stream.current = replace(
            frame_of(make_hand(70)), timestamp_ms=stream.current.timestamp_ms + 1
        )
        session.tick(camera_payload(), session.last_tick + 0.05)
    assert len(session.calibration.samples) == 1
