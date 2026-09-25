"""Browser adapter regressions: existing rules, lifecycle, and input boundaries."""

import base64

import cv2
import numpy as np
import pytest

from handy import browser, maps
from handy.browser import BrowserSession
from handy.game import Rect, RoundOptions
from handy.maps.zombies import ZombieRound, draw_robot
from handy.recognition import Frame
from handy.schemes import PISTOL
from hands import frame_of, make_hand


@pytest.mark.parametrize("key", maps.keys())
def test_every_map_runs_in_browser_without_a_camera(key, monkeypatch):
    def no_models(*_args, **_kwargs):
        pytest.fail("Mouse controls must not load models")

    monkeypatch.setattr(browser, "ensure_model", no_models)
    session = BrowserSession({"map": key, "control": "mouse"})
    data = session.tick({"x": 0.5, "y": 0.5, "fire": True}, session.last_tick + 0.033)
    image = cv2.imdecode(
        np.frombuffer(base64.b64decode(data["image"]), np.uint8), cv2.IMREAD_COLOR
    )
    assert image.shape == (540, 960, 3)
    assert np.ptp(image) > 50
    assert data["state"] == "playing"
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


def test_a_repeated_play_does_not_restart_the_round():
    # A double click on "Play again" sends play twice; the second must not
    # throw away the round the first one started.
    session = BrowserSession({})
    session.tick({"fire": True}, session.last_tick + 0.5)
    round_, clock, tick = session.round, session.clock, session.last_tick
    info = session.action("play", {})
    assert info["state"] == "playing" and info["id"] == session.id
    assert session.round is round_ and session.round.shots == 1
    assert (session.clock, session.last_tick) == (clock, tick)


@pytest.mark.parametrize("name", ["undo", "reset", "finish", "calibrate"])
def test_setup_actions_that_arrive_late_change_nothing(name, monkeypatch):
    session, stream = camera_session(monkeypatch)
    shoot_setup_target(session, stream)
    if name == "calibrate":
        # Already setting up: a second "Adjust aim" keeps the shots taken.
        assert session.action(name, {})["state"] == "calibration"
        assert len(session.calibration.samples) == 1
        return
    # Setup already finished itself, as it does on the fifth accurate hit.
    warm_up(session)
    round_ = session.round
    assert session.action(name, {})["state"] == "playing"
    assert session.round is round_


@pytest.mark.parametrize("name", ["teleport", "skip"])
def test_unknown_actions_are_still_refused(name):
    # "skip" went with the practice state it led to; the page never sent it.
    with pytest.raises(ValueError, match="Unknown"):
        BrowserSession({}).action(name, {})


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
        {"map": "zombies", "control": "gaze"},
        {"map": "zombies", "control": "keyboard"},
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



class FakeStream:
    def __init__(self):
        self.current = Frame()
        self.closed = False

    def latest(self):
        return self.current

    def submit(self, _image):
        return self.current.timestamp_ms

    def wait(self, _stamp, _timeout):
        return self.current

    def close(self):
        self.closed = True


def camera_session(monkeypatch, **config):
    stream = FakeStream()
    monkeypatch.setattr(browser, "ensure_model", lambda _name: "unused")
    monkeypatch.setattr(
        browser.schemes,
        "for_map",
        lambda _key: __import__("dataclasses").replace(
            PISTOL, open_stream=lambda *_args: stream
        ),
    )
    return BrowserSession({"control": "pistol", **config}), stream


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


def stored_setup(**changes):
    """What the page keeps in localStorage after a setup, with ``changes`` made."""
    from handy.calibration import default_rig

    entry = {**default_rig(PISTOL, 1)[0].to_dict(), **changes}
    return {"cameras": [{k: v for k, v in entry.items() if v is not ...}]}


@pytest.mark.parametrize(
    "saved",
    [
        stored_setup(mapping=[1.0] * 8),
        stored_setup(mapping=[float("inf")] + [1.0] * 8),
        stored_setup(gain=10**400),
        stored_setup(mapping=..., aim_min=...),
        {"cameras": [stored_setup()["cameras"][0]] * 2},
        {"cameras": []},
        {"cameras": "abc"},
        "a string",
        [1, 2],
    ],
)
def test_an_unusable_saved_setup_starts_a_fresh_one(saved, monkeypatch, capsys):
    from handy.calibration import default_rig

    # Refusing it would refuse every start: the page sends it with each one.
    session, _stream = camera_session(monkeypatch, calibration=saved)
    assert session.state == "calibration"
    assert session.rig == default_rig(PISTOL, 1)
    assert session.calibration.initial == session.rig
    assert session.forget_saved
    assert "Ignoring a saved browser setup" in capsys.readouterr().err


def test_a_usable_saved_setup_is_kept(monkeypatch):
    from handy.calibration import Rig

    saved = stored_setup(fit_error=0.01, gain=1.2)
    session = camera_session(monkeypatch, calibration=saved)[0]
    assert session.rig == Rig.from_dict(saved) and not session.forget_saved
    # A setup from before a field existed may load or not, but never blocks a start.
    older = stored_setup(signal=...)
    assert camera_session(monkeypatch, calibration=older)[0].state == "calibration"


def test_shoot_to_calibrate_waits_for_fresh_thumb_pulls(monkeypatch):
    session, stream = camera_session(monkeypatch)
    stream.current = frame_of(make_hand())
    for _ in range(20):
        session.tick(camera_payload(), session.last_tick + 0.1)
    assert session.state == "calibration"
    assert session.calibration.samples == []
    with pytest.raises(ValueError, match="five"):
        session.action("finish", {})
    # Play is answered with where the game is - still warming up.
    assert session.action("play", {})["state"] == "calibration"
    session.close()
    assert stream.closed


def warm_up(session):
    """Stand in for five accurate hits, so the round itself can be played."""
    session.calibration.hits.update(range(5))
    session.action("finish", {})
    assert session.state == "playing"


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


def test_browser_returns_hand_skeleton_and_clears_it_on_tracking_loss(monkeypatch):
    session, stream = camera_session(monkeypatch)
    hand = make_hand()
    stream.current = frame_of(hand)
    result = session.tick(camera_payload(), session.last_tick + 0.05)
    assert result["hands"] == [list(hand.landmarks)]
    result = session.tick({}, session.last_tick + 1)
    assert result["hands"] == []


def test_each_frame_is_aimed_from_its_own_reading(monkeypatch):
    # MediaPipe answers a few milliseconds after a frame goes in. Reading the
    # newest answer straight away aimed every frame from the one before it.
    session, stream = camera_session(monkeypatch)
    hands = [make_hand(index_tip=(0.2 + 0.1 * i, 0.5)) for i in range(4)]
    asked = []

    def submit(_image):
        asked.append(len(asked) + 1)
        return asked[-1]

    def wait(stamp, timeout):
        assert 0 < timeout <= 0.03  # bounded: a dropped frame is never answered
        stream.current = Frame(hands=(hands[stamp - 1],), timestamp_ms=stamp)
        return stream.current

    monkeypatch.setattr(stream, "submit", submit)
    monkeypatch.setattr(stream, "wait", wait)
    for hand in hands:
        result = session.tick(camera_payload(), session.last_tick + 0.033)
        assert result["hands"] == [list(hand.landmarks)]


def test_the_warmup_range_is_not_a_selectable_game():
    assert "range" not in maps.keys()
    with pytest.raises(ValueError, match="arcade"):
        BrowserSession({"map": "range"})


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
    warm_up(session)
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
    warm_up(session)
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
