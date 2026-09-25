import numpy as np
import pytest

from handy import scene
from handy.recognition import Frame

WIDTH, HEIGHT = 1280, 720


@pytest.fixture
def canvas():
    return np.zeros((HEIGHT, WIDTH, 3), np.uint8)


@pytest.fixture
def camera():
    return np.full((720, 1280, 3), 90, np.uint8)


# --- the round clock and the score card ------------------------------------

def test_the_clock_renders_in_both_modes(canvas):
    for remaining in (75.0, 8.0, None):
        canvas[:] = 0
        scene.draw_clock(canvas, remaining, 1.0, 24)
        assert canvas.any()


def test_the_clock_turns_red_when_time_is_short(canvas):
    pill = scene.draw_clock(canvas, 30.0, 1.0, 24)
    calm = canvas[pill.y:pill.bottom, pill.x:pill.right]
    assert not np.any(np.all(calm == scene.DANGER, axis=-1))
    canvas[:] = 0
    pill = scene.draw_clock(canvas, 5.0, 1.0, 24)
    urgent = canvas[pill.y:pill.bottom, pill.x:pill.right]
    assert np.any(np.all(urgent == scene.DANGER, axis=-1))


def test_the_clock_holds_its_width_as_the_seconds_change():
    widths = {scene.clock_pill(1280, seconds, 1.0).width for seconds in
              (59.0, 48.0, 11.0, 10.0, 1.0)}
    assert len(widths) == 1


def test_the_results_card_shows_the_round(canvas):
    from handy.game import Summary

    canvas[:] = 200  # whatever was on screen before must not show through
    summary = Summary(score=180, shots=22, hits=15, accuracy=15 / 22,
                      best_streak=6, perfect=4, duration=60,
                      perfect_label="bullseyes")
    scene.draw_results(canvas, summary, best=120, is_best=True)

    assert canvas.any()
    assert canvas.mean() < 60, "the card brings its own dark backdrop"


def test_the_results_card_handles_a_round_without_a_single_shot(canvas):
    from handy.game import Summary

    summary = Summary(score=0, shots=0, hits=0, accuracy=0.0, best_streak=0,
                      perfect=0, duration=60)
    scene.draw_results(canvas, summary, best=0, is_best=False)
    assert canvas.any()


def test_a_failed_round_says_so_on_the_card(canvas):
    from handy.game import Summary

    overrun = Summary(score=40, shots=9, hits=3, accuracy=1 / 3, best_streak=2,
                      perfect=1, duration=60, perfect_label="headshots",
                      outcome="OVERRUN")
    scene.draw_results(canvas, overrun, best=0, is_best=False)
    failed = canvas.copy()

    canvas[:] = 0
    scene.draw_results(canvas, overrun.__class__(**{**overrun.__dict__,
                                                   "outcome": "SURVIVED"}),
                       best=0, is_best=False)
    assert not np.array_equal(failed, canvas)


def test_a_round_you_won_is_not_painted_in_the_colour_of_a_round_you_lost(canvas):
    """Three maps name the winning ending too - SURVIVED, PANE HELD, CLEANED UP.
    Colouring any non-empty outcome red handed every one of those the same
    alarm card as a player who was overrun."""
    from handy.game import Summary

    def heading_colour(**fields) -> tuple:
        summary = Summary(score=40, shots=9, hits=3, accuracy=1 / 3, best_streak=2,
                          perfect=1, duration=60, **fields)
        canvas[:] = 0
        scene.draw_results(canvas, summary, best=0, is_best=False)
        card = scene.results_card(WIDTH, HEIGHT, 1.0, banner=False)
        tab = canvas[card.y, card.x + scene._px(28, 1.0)]
        return tuple(int(channel) for channel in tab)

    for heading in ("SURVIVED", "PANE HELD", "CLEANED UP"):
        assert heading_colour(outcome=heading, won=True) == scene.ARMED, heading
    assert heading_colour(outcome="OVERRUN") == scene.DANGER
    assert heading_colour(outcome="") == scene.ACCENT, "a plain timed round"


# --- choosing a map --------------------------------------------------------

def test_the_map_cards_tile_the_window_without_overlapping():
    from handy.game import Rect

    window = Rect(0, 0, WIDTH, HEIGHT)
    cards = scene.map_cards(window, 2)
    assert len(cards) == 2
    assert cards[0].right < cards[1].x
    for card in cards:
        assert window.contains(card.x, card.y)
        assert window.contains(card.right, card.bottom)


def test_the_chooser_draws_every_map_and_marks_the_one_you_are_aiming_at(canvas):
    from handy import maps
    from handy.game import Rect

    cards = scene.map_cards(Rect(0, 0, WIDTH, HEIGHT), len(maps.MAPS))
    entries = tuple((m.title, m.blurb, "best 120", m.draw_emblem) for m in maps.MAPS)

    scene.draw_map_select(canvas, cards, entries, aimed=None)
    idle = canvas.copy()
    scene.draw_map_select(canvas, cards, entries, aimed=1)

    assert idle.any()
    assert not np.array_equal(idle, canvas), "the aimed card is picked out"


@pytest.mark.parametrize("width,height", ((1280, 720), (1512, 945), (2560, 1440)))
def test_every_maps_name_and_blurb_fit_inside_its_card(width, height, monkeypatch):
    """Nothing is cut short on the real cards: every name whole, every blurb
    whole, and every line inside the card's padding."""
    from handy import maps
    from handy.game import Rect

    scale = height / 720
    canvas = np.zeros((height, width, 3), np.uint8)
    cards = scene.map_cards(Rect(0, 0, width, height), len(maps.MAPS), scale)
    said = []
    real = scene.write
    monkeypatch.setattr(scene, "write", lambda canvas, text, origin, style, *a, **k: (
        said.append((text, origin[0], style)), real(canvas, text, origin, style,
                                                    *a, **k))[1])
    for card, chosen in zip(cards, maps.MAPS):
        said.clear()
        scene.draw_map_card(canvas, card, chosen.title, chosen.blurb, "Best 1,240",
                            chosen.draw_emblem, 0.0, scale)
        texts = [text for text, _, _ in said]
        assert texts[0] == scene.title_case(chosen.title)
        assert " ".join(texts[1:-1]) == chosen.blurb, "the whole blurb, not cut"
        for text, x, style in said:
            assert x + scene.measure(text, style, scale) <= card.right - 20 * scale + 1


def test_text_measurement_accounts_for_the_halo():
    from handy.rendering import text_width

    plain = text_width("a wide enough line of text", 0.6, outline=False)
    haloed = text_width("a wide enough line of text", 0.6, outline=True)
    assert haloed > plain, "the dark halo makes text wider than the glyphs alone"


def test_a_long_blurb_is_wrapped_rather_than_running_off_the_card(canvas):
    from handy.game import Rect

    cards = scene.map_cards(Rect(0, 0, WIDTH, HEIGHT), 2)
    entries = (("A MAP", " ".join(["blurb"] * 60), "best 0", scene.draw_backdrop),
               ("ANOTHER", "short", "", scene.draw_backdrop))
    scene.draw_map_select(canvas, cards, entries, aimed=None)

    # The gutter between the cards must stay empty: no text has run off the edge.
    gutter = canvas[cards[0].y:cards[0].bottom, cards[0].right + 3:cards[1].x - 3]
    assert gutter.size > 0 and gutter.max() < 100


# --- saying how many cameras are in play ------------------------------------

def test_one_camera_says_so_plainly():
    text, color = scene.camera_summary([scene.FUSED])
    assert text == "1 camera" and color == scene.MUTED


def test_two_working_cameras_are_announced_in_green():
    text, color = scene.camera_summary([scene.FUSED, scene.FUSED])
    assert text == "2 cameras fused" and color == scene.ARMED


def test_a_camera_that_lost_the_hand_is_named():
    text, _ = scene.camera_summary([scene.FUSED, scene.NO_HAND])
    assert text.startswith("1 of 2 cameras") and "cam 2 no hand" in text


def test_a_camera_ruled_out_at_setup_is_called_out_in_red():
    text, color = scene.camera_summary([scene.IGNORED, scene.FUSED])
    assert "cam 1 ignored" in text and color == scene.DANGER


def test_no_cameras_at_all_is_not_a_crash():
    text, color = scene.camera_summary([])
    assert text and color == scene.DANGER


def test_one_working_camera_goes_unannounced_and_two_are_accounted_for():
    """"1 camera" beside a working preview read as debug output; with two, which
    of them is contributing changes frame to frame and is always said."""
    assert scene.camera_note([scene.FUSED]) is None
    assert scene.camera_note([scene.NO_HAND]) is None, "its own preview says so"
    assert scene.camera_note([]) is None
    text, _ = scene.camera_note([scene.FUSED, scene.FUSED])
    assert text == "Both cameras see your hand"
    text, _ = scene.camera_note([scene.FUSED, scene.NO_HAND])
    assert text == "Camera 2 can\u2019t see your hand"
    text, color = scene.camera_note([scene.IGNORED, scene.FUSED])
    assert text == "Camera 1 isn\u2019t in use" and color == scene.WARNING
    # And never the engineering words the debug line uses.
    for states in ([scene.FUSED] * 3, [scene.NO_HAND, scene.IGNORED]):
        assert "fused" not in scene.camera_note(states)[0]


def said_by(monkeypatch):
    """Everything :func:`scene.write` is asked to set, from here on."""
    said = []
    real = scene.write
    monkeypatch.setattr(scene, "write", lambda canvas, text, *args, **kwargs: (
        said.append(text), real(canvas, text, *args, **kwargs))[1])
    return said


def test_the_score_panel_says_the_score_and_the_tally_and_nothing_else(canvas,
                                                                       monkeypatch):
    """The crosshair turns green when the gun is cocked; a READY in the corner
    only competed with it. No label either: the big number is the score."""
    from handy.game import Rect, Round, RoundOptions

    said = said_by(monkeypatch)
    round_ = Round(RoundOptions(area=Rect(0, 0, 800, 400)))
    round_.score, round_.shots, round_.hits = 1240, 14, 8
    scene.draw_score_panel(canvas, round_, (), (400, 16), 600, 1.0)
    assert said == ["1,240", "8 of 14 hits \u00b7 57%"]


def test_the_score_panel_lays_out_a_maps_readouts_in_one_panel(canvas, monkeypatch):
    from handy.game import Readout, Rect, Round, RoundOptions

    said = said_by(monkeypatch)
    round_ = Round(RoundOptions(area=Rect(0, 0, 800, 400)))
    readouts = (Readout("Health", "4", meter=0.6), Readout("Wave", "2"),
                Readout("Wind", "0.4 m/s", meter=-0.5, signed=True, tone="warning"))
    plain, _ = scene.score_panel(round_, (), (400, 16), 600)
    panel = scene.draw_score_panel(canvas, round_, readouts, (400, 16), 600, 1.0)
    assert said[2:] == ["Health", "4", "Wave", "2", "Wind", "0.4 m/s"]
    assert panel.x == plain.x and panel.y == plain.y and panel.bottom > plain.bottom
    assert np.any(np.all(canvas[panel.y:panel.bottom, panel.x:panel.right]
                         == scene.WARNING, axis=-1)), "the tone is the value's colour"


@pytest.mark.parametrize("room", [220, 300, 900])
def test_readouts_wrap_rather_than_outgrow_the_room_they_are_given(room):
    from handy.game import Readout, Rect, Round, RoundOptions

    round_ = Round(RoundOptions(area=Rect(0, 0, 800, 400)))
    readouts = tuple(Readout(label, "888") for label in
                     ("Hostiles", "Down", "Stage", "Townsfolk", "Bottles"))
    panel, rows = scene.score_panel(round_, readouts, (10, 10), room)
    assert panel.width <= room
    assert sum(len(row) for row in rows) == len(readouts)
    assert len(rows) == 1 or room < 900


def test_a_lost_hand_is_said_on_the_cameras_own_preview(canvas, monkeypatch):
    from handy.game import Rect

    camera = np.full((720, 1280, 3), 230, np.uint8)  # a bright room
    said = said_by(monkeypatch)
    rect = Rect(10, 10, 320, 180)
    scene.draw_camera_inset(canvas, camera, Frame(), rect, "", scene.NO_HAND)
    assert said == ["Show your hand"]
    foot = canvas[rect.bottom - 12:rect.bottom - 4, rect.x + 20:rect.right - 20]
    assert foot.min() < 120, "on a dark wash, so it reads over any picture"
    edge = canvas[rect.y + rect.height // 2, rect.x:rect.x + 3]
    assert np.any(np.all(edge == scene.DANGER, axis=-1)), "and its edge turns red"


def test_the_camera_picture_is_cropped_to_its_frame_never_squashed(canvas):
    """A 4:3 camera in a 16:9 picture fills it from the middle."""
    from handy.game import Rect

    camera = np.zeros((480, 640, 3), np.uint8)
    camera[:, 320:] = 255  # left half black, right half white
    rect = Rect(40, 40, 320, 180)
    scene.draw_camera_inset(canvas, camera, Frame(), rect)
    row = canvas[rect.y + rect.height // 2, rect.x + 4:rect.right - 4, 0]
    edge = int(np.argmax(row > 128)) + rect.x + 4
    assert abs(edge - (rect.x + rect.width // 2)) <= 2


def test_debug_shows_what_the_second_camera_measured(canvas):
    from handy.aiming import Aim
    from handy.game import Rect, Round, RoundOptions

    del Rect, Round, RoundOptions
    states = [scene.FUSED, scene.FUSED]
    single = Aim(position=(0.5, 0.5), cameras=1)
    paired = Aim(position=(0.5, 0.5), cameras=2, spread=0.02)

    scene.draw_debug_line(canvas, single, 30.0, states)
    alone = canvas.copy()
    canvas[:] = 0
    scene.draw_debug_line(canvas, paired, 30.0, states)

    assert not np.array_equal(alone, canvas), "the spread only appears with two"


def test_an_ignored_camera_is_marked_on_its_own_inset(canvas, camera):
    from handy.game import Rect
    from handy.recognition import Frame

    rect = Rect(10, 10, 320, 180)
    scene.draw_camera_inset(canvas, camera, Frame(), rect, "CAM 2", scene.IGNORED)
    ignored = canvas.copy()
    canvas[:] = 0
    scene.draw_camera_inset(canvas, camera, Frame(), rect, "CAM 2", scene.NO_HAND)

    assert not np.array_equal(ignored, canvas)


def test_every_screen_draws_at_any_scale(canvas, camera):
    """The interface is built for 720 tall and scaled; nothing may fall over."""
    from handy import maps
    from handy.aiming import Aim
    from handy.game import Rect, Round, RoundOptions, Summary
    from handy.recognition import Frame

    round_ = Round(RoundOptions(area=Rect(0, 0, 800, 400)))
    summary = Summary(score=10, shots=2, hits=1, accuracy=0.5, best_streak=1,
                      perfect=1, duration=60)
    entries = tuple((m.title, m.blurb, "best 1", m.draw_emblem) for m in maps.MAPS)

    for scale in (0.7, 1.0, 1.6, 2.4):
        canvas[:] = 0
        scene.draw_score_panel(canvas, round_, (), (400, 16), 400, scale)
        scene.draw_debug_line(canvas, Aim(), 30.0, [scene.FUSED], scale)
        scene.draw_clock(canvas, 42.0, scale, 16)
        scene.draw_hints(canvas, [("", "some words"), ("P", "Pause")], scale, 0.5, True)
        scene.draw_pause_sheet(canvas, "High Noon", 1, scale, 0.5)
        scene.draw_crosshair(canvas, 640, 360, True, 0.05, scale)
        scene.draw_camera_insets(canvas, [camera], [Frame()],
                                 Rect(10, 10, 320, 180), (scene.FUSED,), None, scale)
        scene.draw_notice(canvas, ["A", "B"], scale)
        cards = scene.map_cards(Rect(0, 0, WIDTH, HEIGHT), 2, scale)
        scene.draw_map_select(canvas, cards, entries, 0, scale)
        scene.draw_results(canvas, summary, 5, True, "hint", scale)
        assert canvas.any(), f"nothing drawn at scale {scale}"


def test_cards_stay_inside_the_window_at_every_scale():
    from handy.game import Rect

    for width, height, scale in ((1280, 720, 1.0), (1512, 982, 1.36),
                                 (3024, 1964, 2.4)):
        window = Rect(0, 0, width, height)
        cards = scene.map_cards(window, 2, scale)
        assert cards[0].x >= 0 and cards[-1].right <= width
        assert cards[0].right < cards[1].x


def test_a_long_best_line_is_trimmed_to_the_card_rather_than_overrunning():
    long = "Best 1,240 on a sixty-second round, set on a Tuesday afternoon"
    fitted = scene.fit(long, scene.FOOTNOTE, 220)
    assert fitted.endswith("\u2026") and scene.measure(fitted, scene.FOOTNOTE) <= 220
    assert scene.fit("short", scene.FOOTNOTE, 220) == "short"


def test_five_cards_keep_their_text_inside_the_card(canvas):
    """Two rows of short cards: the foot line must not collide with the blurb."""
    from handy.game import Rect

    cards = scene.map_cards(Rect(0, 0, WIDTH, HEIGHT), 5)
    blurb = "A long valley and a rifle. Close one eye to look down the scope; the view"
    entries = tuple((f"MAP {i}", blurb, "not yet played", scene.draw_backdrop)
                    for i in range(5))
    scene.draw_map_select(canvas, cards, entries, aimed=None)
    gap = cards[3].y - cards[0].bottom
    for card in cards:
        below = canvas[card.bottom + 3:card.bottom + gap - 3, card.x:card.right]
        assert below.size and below.max() < 100, "text ran out of the bottom of a card"


# --- the grid is balanced, figures are set cleanly, the map sits behind the card

def test_the_four_maps_stand_in_one_row_of_equal_cards():
    """Four maps in a grid of three left two "more ground soon" placeholders,
    which made the game look unfinished."""
    from handy import maps
    from handy.game import Rect

    cards = scene.map_cards(Rect(0, 0, WIDTH, HEIGHT), len(maps.MAPS))
    assert len({card.y for card in cards}) == 1
    assert len({(card.width, card.height) for card in cards}) == 1
    for left, right in zip(cards, cards[1:]):
        assert left.right < right.x


def test_a_short_last_row_is_centred_not_padded_with_placeholders():
    from handy.game import Rect

    cards = scene.map_cards(Rect(0, 0, WIDTH, HEIGHT), 5)
    first, second = cards[:3], cards[3:]
    assert len({card.y for card in first}) == 1 and len({card.y for card in second}) == 1
    middle = (first[0].x + first[-1].right) / 2
    assert abs((second[0].x + second[-1].right) / 2 - middle) <= 1
    assert not hasattr(scene, "empty_slots")


def test_figures_draw_where_they_are_put(canvas):
    width = scene.figures_width("1840", 60)
    assert width > 60
    scene.draw_figures(canvas, "1840", (100, 200), (255, 255, 255), 60)
    assert canvas[140:205, 100:100 + width].any()
    assert not canvas[:, 100 + width + 10:].any()


def test_the_results_card_sits_on_the_maps_art_when_one_is_set(canvas):
    from handy import maps
    from handy.game import Summary

    summary = Summary(score=180, shots=22, hits=15, accuracy=15 / 22,
                      best_streak=6, perfect=4, duration=60)
    scene.draw_results(canvas, summary, best=120, is_best=False)
    plain = canvas.copy()
    scene.set_ambient_art(maps.MAPS[0].draw_emblem)
    try:
        scene.draw_results(canvas, summary, best=120, is_best=False)
        assert not np.array_equal(plain, canvas)
        assert canvas.mean() < 60, "dimmed to a mood, not a picture"
    finally:
        scene.set_ambient_art(None)


def test_chooser_thumbnails_are_cut_clean_of_the_western_title():
    from handy.maps import western

    # The western card art hangs its title on a plank of one wood colour
    # across the bottom; the chooser's frame is cut from above it, so that
    # band of the frame carries far less of the plank's wood.
    raw = np.zeros((122, 405, 3), np.uint8)
    western.draw_emblem(raw)
    frame = scene._clean_frame(western.draw_emblem, 405, 122)
    assert frame.shape == raw.shape
    band = slice(int(122 * 0.6), 122)
    wood = np.array((78, 112, 150))
    inked = (np.abs(raw[band].astype(int) - wood).max(axis=2) < 12).sum()
    clean = (np.abs(frame[band].astype(int) - wood).max(axis=2) < 12).sum()
    assert inked > 500 and clean < inked * 0.35


def test_thumbnails_are_built_once_per_size():
    calls = []

    def emblem(panel):
        calls.append(panel.shape)
        panel[:] = np.random.default_rng(0).integers(60, 200, panel.shape)

    scene._thumbnail.cache_clear()
    a = scene._thumbnail(emblem, "A", 300, 100)
    b = scene._thumbnail(emblem, "A", 300, 100)
    assert a is b and len(calls) == 1
    assert a.shape == (100, 300, 3)
    # The treatment: the foot settles towards the card's own surface, so the
    # name under it reads as part of the same card.
    surface = float(np.mean(scene.SURFACE))
    middle, foot = a[45:55, 100:200].mean(), a[-1, 100:200].mean()
    assert abs(foot - surface) < abs(middle - surface) / 2


def test_the_button_under_the_crosshair_is_ringed_never_coloured(canvas):
    """No doubt which one a shot would press - and green is kept for the gun."""
    from handy.game import Rect

    for kind in (scene.PRIMARY, scene.OVER_WORLD, scene.SECONDARY, scene.DESTRUCTIVE):
        canvas[:] = 60
        button = scene.Button(Rect(100, 100, 240, 64), "Restart", "restart", kind)
        scene.draw_button(canvas, button, highlighted=False)
        assert canvas[97, 220].max() < 100, "no ring at rest"
        scene.draw_button(canvas, button, highlighted=True)
        assert canvas[97, 220].min() > 200, "a white ring just off it"
        assert not np.any(np.all(canvas == scene.TINT, axis=-1))


def test_a_primary_button_is_a_white_pill_with_a_black_label(canvas):
    from handy.game import Rect

    button = scene.Button(Rect(100, 100, 240, 64), "Play Again", "play", scene.PRIMARY)
    scene.draw_button(canvas, button)
    assert (canvas[104, 220] == 255).all()
    inside = canvas[110:154, 120:320]
    assert inside.min() < 20, "the label is black"
    assert (canvas[100, 100] != 255).any(), "a pill: its corners are round"


def test_results_headline_names_the_score(canvas, monkeypatch):
    from handy.game import Summary

    seen = []
    monkeypatch.setattr(scene, "_centred_text",
                        lambda canvas, text, *args, **kwargs: seen.append(text))
    summary = Summary(score=180, shots=22, hits=15, accuracy=15 / 22,
                      best_streak=6, perfect=4, duration=60)
    scene.draw_results(canvas, summary, best=120, is_best=False)
    assert "SCORE" in seen and "TIME" not in seen


def test_the_wordmark_sits_bottom_right_on_every_menu(canvas, monkeypatch):
    from handy.game import Rect

    said = said_by(monkeypatch)
    scene.draw_logo(canvas, 1.0)
    assert said == ["Handy"]
    logo_w, logo_h = scene.logo_size(1.0)
    corner = canvas[canvas.shape[0] - 60:, canvas.shape[1] - logo_w - 40:]
    assert np.any(np.all(corner == scene.LABEL_SECONDARY, axis=-1)), "the mark itself"
    ink = corner[corner.max(axis=2) > 0]
    assert (np.abs(ink.astype(int) - ink.mean(axis=1, keepdims=True)) < 8).all(), (
        "no colour in the mark: no accent bar, no amber muzzle")
    assert canvas[:canvas.shape[0] - 60].max() == 0 and logo_h > 0
    # And it is part of the chooser, the results card and the notice.
    from handy.game import Summary
    cards = scene.map_cards(Rect(0, 0, canvas.shape[1], canvas.shape[0]), 2)
    from handy import maps

    entries = tuple(("A", "b", "c", m.draw_emblem) for m in maps.MAPS[:2])
    for draw in (lambda: scene.draw_map_select(canvas, cards, entries, None),
                 lambda: scene.draw_results(canvas, Summary(1, 1, 1, 1.0, 1, 0, 9.0),
                                            0, False),
                 lambda: scene.draw_notice(canvas, ["A", "b"])):
        canvas[:] = 0
        draw()
        corner = canvas[canvas.shape[0] - 60:, canvas.shape[1] - logo_w - 40:]
        assert np.any(np.all(corner == scene.LABEL_SECONDARY, axis=-1))


def test_the_camera_inset_is_framed_in_its_state_colour(canvas, camera):
    from handy.game import Rect

    rect = Rect(20, 20, 200, 120)
    for state, color in ((scene.NO_HAND, scene.DANGER), (scene.IGNORED, scene.WARNING)):
        canvas[:] = 0
        scene.draw_camera_inset(canvas, camera, Frame(), rect, "", state)
        frame = canvas[rect.y - 2:rect.bottom + 2, rect.x - 2:rect.right + 2]
        assert np.any(np.all(frame == color, axis=-1))
    # A camera that is doing its job is framed by a hairline and nothing else:
    # no colour of its own, and certainly not the gun's green.
    canvas[:] = 0
    scene.draw_camera_inset(canvas, camera, Frame(), rect, "", scene.FUSED)
    frame = canvas[rect.y - 2:rect.bottom + 2, rect.x - 2:rect.right + 2]
    blue, green, red = (frame[:, :, channel].astype(int) for channel in range(3))
    assert np.abs(green - red).max() <= 12 and np.abs(green - blue).max() <= 12


# --- the hints always fit ------------------------------------------------------

def test_the_hints_never_run_off_the_screen():
    items = [("", "Point, fold your thumb to fire. Close one eye to scope in."),
             ("", "Head shots drop them"), ("P", "Pause"), ("S", "Screenshot")]
    for width, scale in ((1280, 1.0), (1512, 1.31), (640, 0.9)):
        fitted = scene.fit_hints(items, width, scale)
        assert scene.hints_width(fitted, scale) <= width
        assert fitted == items[:len(fitted)], "the last ones go first"


def test_the_hints_do_not_repeat_the_scheme_in_the_map():
    fitted = scene.fit_hints([("", "Point, fold your thumb to fire. Close one eye to "
                                   "scope in."), ("", "close one eye to scope in"),
                              ("P", "Pause")], 2000, 1.0)
    assert [text for _, text in fitted].count("close one eye to scope in") == 0
    assert len(fitted) == 2


def test_fading_hints_touch_only_their_own_patch():
    canvas = busy_frame(1280, 720)
    before = canvas.copy()
    scene.draw_hints(canvas, [("", "Point at a target"), ("P", "Pause")], 1.0, 0.5, True)
    changed = np.argwhere((canvas != before).any(axis=2))
    assert changed[:, 0].min() > 720 - 80 and changed[:, 0].max() < 720 - 16


def test_the_chrome_panel_darkens_inside_and_leaves_the_rest_alone(canvas):
    from handy.game import Rect

    canvas[:] = 200
    scene.draw_chrome_panel(canvas, Rect(10, 10, 300, 120), 1.0)
    assert canvas[70, 160].mean() < 70, "dark enough for grey text on a noon sky"
    assert canvas[70, 160].mean() > 200 * (1 - scene.CHROME_OPACITY) - 5, "translucent"
    assert canvas[400, 1000].mean() == 200 and canvas[135, 160].mean() == 200
    # Rounded: the very corner is left as it was.
    assert canvas[11, 11].mean() > canvas[70, 160].mean() + 60


@pytest.mark.parametrize("rect", [(1100, 600, 300, 200), (-20, -10, 300, 100)])
def test_the_chrome_panel_clips_at_the_edges_of_the_window(canvas, rect):
    from handy.game import Rect

    canvas[:] = 200
    scene.draw_chrome_panel(canvas, Rect(*rect), 1.0)  # must not raise
    assert canvas.min() < 70


def test_the_chrome_panel_builds_its_mask_once_per_size():
    """Rebuilding a float mask every frame was 3 ms a frame at 1512x949."""
    from handy.game import Rect

    canvas = busy_frame(1512, 949)
    scene._chrome_layers.cache_clear()
    for _ in range(5):
        scene.draw_chrome_panel(canvas, Rect(446, 21, 180, 139), 1.318)
    info = scene._chrome_layers.cache_info()
    assert (info.misses, info.hits) == (1, 4)


# --- the HUD's glass is drawn every frame ----------------------------------------

def busy_frame(width, height, seed=0):
    return np.random.default_rng(seed).integers(0, 256, (height, width, 3),
                                                dtype=np.uint8)


def test_the_clock_touches_only_its_own_pill():
    """The clock used to copy and blend all 1512x949 pixels to shade a pill a
    few hundred wide."""
    canvas = busy_frame(1512, 949)
    before = canvas.copy()
    pill = scene.draw_clock(canvas, 42.0, 1.318, 32)
    changed = np.argwhere((canvas != before).any(axis=2))
    # To within the pixel the edge's anti-aliasing reaches.
    assert changed[:, 0].min() >= pill.y - 1 and changed[:, 0].max() <= pill.bottom
    assert changed[:, 1].min() >= pill.x - 1 and changed[:, 1].max() <= pill.right


# --- the camera inset is on the hot path, every frame -----------------------

def test_the_inset_downscale_still_averages_the_pixels_it_drops():
    """INTER_AREA cost 5-6 ms of a 10 ms frame budget just to shrink one
    webcam image. The replacement halves with pyrDown - the same box filter,
    a twentieth of the cost - and only then interpolates.

    What must survive is the anti-aliasing: a checkerboard sampled without a
    filter comes out as a moire pattern or a flat field, never as the even grey
    the average of its pixels actually is.
    """
    import cv2

    board = np.zeros((720, 1280, 3), np.uint8)
    board[::2, ::2] = 255
    board[1::2, 1::2] = 255  # a one-pixel checker: pure aliasing bait

    small = scene.shrink(board, 320, 180)
    reference = cv2.resize(board, (320, 180), interpolation=cv2.INTER_AREA)

    assert small.shape == (180, 320, 3)
    assert abs(float(small.mean()) - 127.5) < 6, "the average went missing"
    assert float(small.std()) < float(reference.std()) + 12, "aliasing crept in"


def test_the_inset_never_hands_back_the_cameras_own_buffer(camera):
    """The skeleton is drawn onto whatever comes back, so a same-size shrink
    that returned the input would draw it onto the live camera frame."""
    same = scene.shrink(camera, camera.shape[1], camera.shape[0])
    same[:] = 7
    assert camera[0, 0, 0] == 90


def test_shrinking_is_far_cheaper_than_a_plain_area_resize():
    """The budget is ~10 ms a frame for the whole of draw_world and the HUD;
    the inset is one thumbnail and used to eat more than half of it."""
    import time

    import cv2

    frame = np.random.default_rng(0).integers(
        0, 255, (720, 1280, 3), dtype=np.uint8)

    def median(call):
        call()
        times = []
        for _ in range(15):
            start = time.perf_counter()
            call()
            times.append(time.perf_counter() - start)
        return sorted(times)[len(times) // 2]

    area = median(lambda: cv2.resize(frame, (378, 235),
                                     interpolation=cv2.INTER_AREA))
    fast = median(lambda: scene.shrink(frame, 378, 235))
    assert fast < area / 5, f"shrink {fast * 1000:.2f} ms vs area {area * 1000:.2f} ms"


def test_the_inset_downscales_whatever_size_it_is_given(camera):
    for width, height in ((378, 235), (320, 180), (1280, 720), (64, 36), (5, 3)):
        out = scene.shrink(camera, width, height)
        assert out.shape == (height, width, 3)
        assert out.dtype == np.uint8


# --- the chooser has to draw at sizes no map was designed for ---------------

def test_every_emblem_draws_on_a_card_smaller_than_it_expects():
    """The map chooser draws each map's emblem into a thumbnail, and two of them
    sized a blur off the panel: `zombies` fed GaussianBlur a sigma of 0 (an
    assertion failure, taking the whole chooser down) and `orbit` divided by a
    reach of 0 and filled the sprite with NaN. Neither is reachable through a
    real window today; both were one window-size flag away.
    """
    import warnings

    from handy import maps

    for height in (8, 16, 24, 40, 90, 200):
        for width in (height, int(height * 1.6), int(height * 3)):
            panel = np.zeros((height, max(width, 1), 3), np.uint8)
            for chosen in maps.MAPS:
                with warnings.catch_warnings():
                    warnings.simplefilter("error", RuntimeWarning)
                    chosen.draw_emblem(panel)  # must not raise
                assert np.isfinite(panel.astype(np.float32)).all()


def test_the_map_chooser_draws_on_a_small_window():
    """Bisected at review time: it raised for every window under 220 px tall."""
    from handy import maps

    for height in (140, 180, 219, 220, 400, 949):
        width = int(height * 16 / 10)
        window = scene.Rect(0, 0, width, height)
        scale = height / 720
        cards = scene.map_cards(window, len(maps.MAPS), scale)
        assert all(card.width > 0 and card.height > 0 for card in cards)
        entries = tuple((chosen.title, chosen.blurb, "not yet played",
                         chosen.draw_emblem) for chosen in maps.MAPS)
        canvas = np.zeros((height, width, 3), np.uint8)
        scene.draw_map_select(canvas, cards, entries, None, scale)  # must not raise
        assert canvas.any()


# --- the score card is worth passing round -----------------------------------

def said_on_the_card(canvas, monkeypatch, summary, **options):
    """Every string the results card sets, whichever face it is set in."""
    said = []
    for name in ("draw_text", "draw_caption", "_centred_text"):
        real = getattr(scene, name)
        monkeypatch.setattr(scene, name, lambda canvas, text, *args, _real=real, **kwargs: (
            said.append(text), _real(canvas, text, *args, **kwargs)))
    scene.draw_results(canvas, summary, **options)
    return said


def test_the_results_card_names_the_map_and_the_round(canvas, monkeypatch):
    """A card screenshotted and shared has to say what was played."""
    from handy import maps
    from handy.game import Summary

    summary = Summary(score=180, shots=22, hits=15, accuracy=15 / 22,
                      best_streak=6, perfect=4, duration=60, outcome="SURVIVED",
                      won=True)
    said = said_on_the_card(canvas, monkeypatch, summary, best=120, is_best=False,
                            title=maps.ZOMBIES.title, emblem=maps.ZOMBIES.draw_emblem)
    assert maps.ZOMBIES.title in said
    assert "60-SECOND ROUND" in said and "SURVIVED" in said
    assert any("screenshot" in text for text in said), "S saves it: the card says so"


def test_the_results_card_carries_the_maps_art(canvas):
    from handy import maps
    from handy.game import Summary

    summary = Summary(score=180, shots=22, hits=15, accuracy=15 / 22,
                      best_streak=6, perfect=4, duration=60)
    scene.draw_results(canvas, summary, 0, False)
    plain = canvas.copy()
    scene.draw_results(canvas, summary, 0, False, title=maps.ORBIT.title,
                       emblem=maps.ORBIT.draw_emblem)
    card = scene.results_card(WIDTH, HEIGHT, 1.0)
    banner = canvas[card.y + 4:card.y + scene._px(scene.RESULTS_BANNER, 1.0) - 4,
                    card.x + 8:card.right - 8]
    assert not np.array_equal(plain, canvas)
    assert banner.std() > 12, "a picture, not a flat plate"


@pytest.mark.parametrize("score", [0, 40])
def test_new_best_is_never_claimed_for_nothing(canvas, monkeypatch, score):
    """An unshot round cannot "beat" an empty table, whatever the caller says."""
    from handy.game import Summary

    summary = Summary(score=score, shots=0, hits=0, accuracy=0.0, best_streak=0,
                      perfect=0, duration=60)
    said = said_on_the_card(canvas, monkeypatch, summary, best=0, is_best=True)
    assert ("NEW BEST" in said) == (score > 0)


def test_the_results_card_fits_the_window_at_every_size():
    for width, height in ((1280, 720), (1512, 945), (2560, 1440), (960, 540)):
        scale = min(max(height / 720, 0.7), 2.4)
        card = scene.results_card(width, height, scale)
        assert card.x > 0 and card.right < width
        # Clear of the buttons along the top and of the footer line below.
        assert card.y > round(62 * scale) and card.bottom < height - round(40 * scale)


# --- setup: the first thing a new player sees --------------------------------

SIZES = ((1280, 720), (1512, 945), (2560, 1440))


def setup_faces(width, height):
    """Every place setup can hang a face, as boxes the size of its straw boss."""
    from handy.game import Rect
    from handy.maps.archery import BOSS_SCALE
    from handy.shot_calibration import CHECK_TARGETS, TARGET_RADIUS, TARGETS

    reach = min(width, height) * TARGET_RADIUS * BOSS_SCALE
    return [Rect(round(x * width - reach), round(y * height - reach),
                 round(2 * reach), round(2 * reach)) for x, y in (*TARGETS, *CHECK_TARGETS)]


def overlaps(a, b) -> bool:
    return a.x < b.right and b.x < a.right and a.y < b.bottom and b.y < a.bottom


@pytest.mark.parametrize("width,height", SIZES)
def test_the_setup_console_never_covers_a_face(width, height):
    scale = height / 720
    panels = scene.setup_console(width, height, 1, 16 / 9, scale)
    for panel in panels:
        assert panel.x >= 0 and panel.right <= width and panel.bottom <= height
        for face in setup_faces(width, height):
            assert not overlaps(panel, face)
    camera, instruction, progress = panels
    assert camera.right < instruction.x and instruction.right < progress.x
    assert camera.y == instruction.y == progress.y


@pytest.mark.parametrize("width,height", SIZES)
def test_the_setup_hall_hangs_its_lamps_inside_the_window(width, height):
    """At the top of the window the fixtures were cut in half."""
    from handy.maps import archery

    area = scene.setup_arena(width, height)
    key = (area.x, area.y, area.width, area.height)
    _, fixture_y = archery._lamps(width, height, key)
    housing = max(2, int(0.006 * height)) + 4
    assert fixture_y - housing >= 2
    for face in setup_faces(width, height):
        assert face.y > fixture_y + housing


def test_the_setup_faces_are_the_calibrations_own(monkeypatch):
    """The inner-two-rings test reads the rings that are drawn: same centre,
    same radius, whatever the course looks like around them."""
    from handy.maps import archery
    from handy.schemes import PISTOL
    from handy.shot_calibration import TARGET_RADIUS, ShotCalibration

    hung = []
    real = archery.hang

    def spy(canvas, round_, target, strength=1.0):
        hung.append((target, strength))
        real(canvas, round_, target, strength)

    monkeypatch.setattr(archery, "hang", spy)
    session = ShotCalibration(PISTOL)
    canvas = np.zeros((HEIGHT, WIDTH, 3), np.uint8)
    scene.draw_shot_calibration(canvas, session, [np.zeros((720, 1280, 3), np.uint8)],
                                [Frame()], lambda *args: None)
    lit = [target for target, strength in hung if strength == 1.0]
    assert len(lit) == 1
    x, y = session.target
    assert (lit[0].x, lit[0].y) == (x * WIDTH, y * HEIGHT)
    assert lit[0].radius == min(WIDTH, HEIGHT) * TARGET_RADIUS
    faint = [target for target, strength in hung if strength < 1.0]
    assert len(faint) == scene.LEARN_SHOTS - 1, "the rest of this step, faintly"


def test_setup_learns_from_as_many_shots_as_its_progress_shows():
    """The progress pips count LEARN_SHOTS learning shots; ShotCalibration
    moves on to checking after exactly that many."""
    from dataclasses import replace

    from hands import frame_of, make_hand
    from handy.schemes import PISTOL
    from handy.shot_calibration import ShotCalibration

    session = ShotCalibration(PISTOL)
    now, stamp = 0.0, 0
    for shot in range(scene.LEARN_SHOTS):
        assert not session.testing
        assert len(scene.setup_course(session)) == scene.LEARN_SHOTS - 1 - shot
        target = session.target
        tip = (0.2 + 0.6 * target[0], 0.25 + 0.5 * target[1])
        for degrees in [20] * 8 + [70] * 4:
            stamp += 1
            now += 0.05
            session.update([replace(frame_of(make_hand(degrees, index_tip=tip)),
                                    timestamp_ms=stamp)], now)
    assert session.testing
    assert len(scene.setup_course(session)) == 4, "the check's other four faces"


@pytest.mark.parametrize("width,height", SIZES)
def test_setup_draws_at_every_size(width, height):
    from handy.schemes import PISTOL
    from handy.shot_calibration import ShotCalibration

    session = ShotCalibration(PISTOL)
    canvas = np.zeros((height, width, 3), np.uint8)
    for cameras in (1, 2):
        scene.draw_shot_calibration(canvas, session,
                                    [np.full((720, 1280, 3), 90, np.uint8)] * cameras,
                                    [Frame()] * cameras, lambda *args: None, height / 720)
        assert canvas.any()


def test_figures_are_never_clipped_by_their_own_box(monkeypatch):
    """The figures face is set at twice its size and brought down; its box was
    measured at the smaller size, which is a few pixels short on a long line,
    so "2 of 3 shots learned" lost the end of its last letter."""
    if scene._FIGURES_FACE is None:
        pytest.skip("no figures face in this OpenCV build")
    text, size = "2 of 3 shots learned", 24
    drawn = np.zeros((80, 600, 3), np.uint8)
    scene.draw_figures(drawn, text, (10, 50), (255, 255, 255), size, 0.0)
    monkeypatch.setattr(scene, "figures_width", lambda text, size: 1000)
    roomy = np.zeros((80, 600, 3), np.uint8)
    scene.draw_figures(roomy, text, (10, 50), (255, 255, 255), size, 0.0)
    assert np.array_equal(drawn, roomy)


# --- type ----------------------------------------------------------------------

def test_the_type_scale_grows_with_the_window():
    assert scene.type_size(scene.TITLE_1, 1.0) == 30
    assert scene.type_size(scene.LARGE_TITLE, 2.0) == 88
    assert scene.type_size(scene.FOOTNOTE, 1.3125) == 16


@pytest.mark.parametrize("style", [scene.LARGE_TITLE, scene.TITLE_1, scene.TITLE_3,
                                   scene.BODY, scene.FOOTNOTE, scene.EYEBROW],
                         ids=lambda style: f"{style.size:g}")
@pytest.mark.parametrize("text", ["Choose a Game", "1,240", "0:48", "Play Again"])
def test_text_is_set_inside_the_box_it_measures(style, text):
    """A box measured at the wrong size cut the last letter off a line."""
    canvas = np.zeros((200, 900, 3), np.uint8)
    width = scene.write(canvas, text, (20, 140), style, (255, 255, 255), 1.5)
    assert width == scene.measure(text, style, 1.5)
    columns = np.flatnonzero(canvas.max(axis=(0, 2)) > 40)
    rows = np.flatnonzero(canvas.max(axis=(1, 2)) > 40)
    assert columns.min() >= 20 - 1 and columns.max() <= 20 + width + 1
    assert columns.max() >= 20 + width - scene.type_size(style, 1.5) * 0.3, "ink to the end"
    size = scene.type_size(style, 1.5)
    assert rows.min() >= 140 - size * 1.05 and rows.max() <= 140 + size * scene.DESCENT + 2


def test_figures_are_tabular_so_a_changing_number_holds_still():
    for style in (scene.TITLE_1, scene.TITLE_3, scene.FOOTNOTE):
        assert scene.measure("0:11", style) == scene.measure("0:48", style)
        assert scene.measure("1,111", style) == scene.measure("8,888", style)
    # And the digits stand in the same cells, so the colon does not move.
    one, eight = (np.zeros((80, 300, 3), np.uint8) for _ in range(2))
    scene.write(one, "0:11", (10, 60), scene.TITLE_1, (255, 255, 255))
    scene.write(eight, "0:18", (10, 60), scene.TITLE_1, (255, 255, 255))
    colon = slice(10 + scene._digit_cell(30, 700), 10 + scene._digit_cell(30, 700) +
                  scene._advance(":", 30, 700))
    assert np.array_equal(one[:, colon], eight[:, colon])


@pytest.mark.parametrize("scale", [1.0, 2.0], ids=["text size", "display size"])
def test_every_weight_is_set_at_every_size(scale):
    """Small text is set at SF Pro Text's optical size, an instance of the
    face per weight; an instance that did not take left every weight regular."""
    ink = []
    for weight in (400, 600, 700):
        canvas = np.zeros((80, 400, 3), np.uint8)
        scene.write(canvas, "Resume", (10, 60), scene.Style(16, weight), (255, 255, 255),
                    scale)
        ink.append(int(canvas.sum()))
    assert ink[0] < ink[1] < ink[2]


def test_text_right_and_centre_aligned_ends_where_it_is_told():
    canvas = np.zeros((80, 400, 3), np.uint8)
    scene.write(canvas, "Pause", (300, 60), scene.HEADLINE, (255, 255, 255),
                align=scene.RIGHT)
    assert np.flatnonzero(canvas.max(axis=(0, 2)))[-1] <= 301
    canvas[:] = 0
    scene.write(canvas, "Pause", (200, 60), scene.HEADLINE, (255, 255, 255),
                align=scene.CENTRE)
    ink = np.flatnonzero(canvas.max(axis=(0, 2)))
    assert abs((ink[0] + ink[-1]) / 2 - 200) <= 2


def test_the_type_falls_back_when_the_system_face_is_not_there(monkeypatch):
    """Linux, Windows and CI have no SF Pro: OpenCV's own sans stands in."""
    caches = (scene._font_source, scene._face, scene._advance, scene._digit_cell,
              scene._measure)
    monkeypatch.setattr(scene, "SYSTEM_FONT", "/nowhere/SFNS.ttf")
    for cache in caches:
        cache.cache_clear()
    try:
        assert scene._font_source() in (scene.FALLBACK_FONT, None)
        canvas = np.zeros((80, 400, 3), np.uint8)
        width = scene.write(canvas, "Resume 0:48", (10, 60), scene.HEADLINE,
                            (255, 255, 255))
        assert width > 0 and canvas.any()
    finally:
        monkeypatch.undo()
        for cache in caches:
            cache.cache_clear()


def test_wrapped_lines_fit_the_width_they_were_wrapped_to():
    text = "Your camera stopped sending pictures. Reconnect it, then start Handy again."
    for width in (160, 240, 400):
        for line in scene.wrap(text, scene.BODY, width):
            assert scene.measure(line, scene.BODY) <= width or " " not in line
    assert scene.fit(text, scene.BODY, 200).endswith("…")
    assert scene.measure(scene.fit(text, scene.BODY, 200), scene.BODY) <= 200


def test_names_kept_in_capitals_read_in_title_case():
    assert scene.title_case("DEAD OF NIGHT") == "Dead of Night"
    assert scene.title_case("PANE FAILED") == "Pane Failed"
    assert scene.title_case("OF A KIND") == "Of a Kind"
    assert scene.title_case("60-SECOND ROUND") == "60-Second Round"


def test_numbers_read_the_way_the_design_language_writes_them():
    assert scene.grouped(1240) == "1,240" and scene.grouped(7) == "7"
    assert scene.clock_text(48.9) == "0:48" and scene.clock_text(65) == "1:05"
    assert scene.clock_text(-1) == "0:00"


# --- glass -----------------------------------------------------------------------

@pytest.mark.parametrize("ground", [0, 128, 255])
def test_glass_stays_dark_enough_to_read_on_and_leaves_the_rest_alone(ground):
    """Over the brightest sky and the darkest road, white text on glass reads."""
    from handy.game import Rect

    canvas = np.full((300, 500, 3), ground, np.uint8)
    scene.draw_glass(canvas, Rect(50, 40, 300, 120), 16)
    inside = canvas[100, 200]
    assert inside.max() <= scene.GLASS_CEILING + 2, "bright glass washes text out"
    assert inside.min() >= 18, "glass is never a hole in the world"
    assert (canvas[250, 450] == ground).all() and (canvas[20, 20] == ground).all()
    # The corners are rounded, not square.
    assert (canvas[41, 51] != inside).any()


def test_glass_blurs_what_is_behind_it():
    from handy.game import Rect

    canvas = np.zeros((200, 400, 3), np.uint8)
    canvas[:, ::6] = 255  # hard stripes: detail that must not show through
    scene.draw_glass(canvas, Rect(40, 40, 300, 120), 16)
    assert float(canvas[60:140, 80:300].std()) < 6


def test_glass_is_cheap_enough_for_every_frame():
    import time

    from handy.game import Rect

    canvas = np.random.default_rng(1).integers(0, 255, (945, 1512, 3), np.uint8)
    rect = Rect(300, 30, 340, 130)
    times = []
    for _ in range(40):
        frame = canvas.copy()
        start = time.perf_counter()
        scene.draw_glass(frame, rect, 21, 1.3125)
        times.append(time.perf_counter() - start)
    assert sorted(times)[len(times) // 2] < 0.001


@pytest.mark.parametrize("name", ["pause", "play", "restart", "grid", "xmark",
                                  "checkmark", "share", "camera", "hand"])
def test_every_icon_draws_inside_its_square(name):
    canvas = np.zeros((100, 100, 3), np.uint8)
    scene.draw_icon(canvas, name, (50, 50), 48, (255, 255, 255))
    ink = np.argwhere(canvas.max(axis=2) > 0)
    assert len(ink) > 40
    assert ink.min() >= 50 - 26 and ink.max() <= 50 + 26


def test_an_icon_nobody_drew_is_an_error_not_a_blank():
    with pytest.raises(ValueError):
        scene.draw_icon(np.zeros((10, 10, 3), np.uint8), "sparkles", (5, 5), 8, (1, 1, 1))


def test_a_bullseye_in_setup_gets_a_small_celebration_and_a_miss_does_not():
    """A green badge with a tick pops where the good shot landed and is gone
    within the moment; a miss is a quiet white cross, never red."""
    from handy.schemes import PISTOL
    from handy.shot_calibration import ShotCalibration

    session = ShotCalibration(PISTOL)
    session.testing, session.last_shot = True, 10.0
    session.last_impact, session.last_hit = ((0.5, 0.5), 10.0), True

    def around(now):
        canvas = np.zeros((HEIGHT, WIDTH, 3), np.uint8)
        scene.celebrate_shot(canvas, session, now)
        return canvas[HEIGHT // 2 - 40:HEIGHT // 2 + 40, WIDTH // 2 - 40:WIDTH // 2 + 40]

    def green(patch):
        b, g, r = (patch[:, :, channel].astype(int) for channel in range(3))
        return int(((g > r + 80) & (g > b + 80)).sum())

    def red(patch):
        b, g, r = (patch[:, :, channel].astype(int) for channel in range(3))
        return int(((r > g + 80) & (r > b + 80)).sum())

    popped = around(10.05)
    assert green(popped) > 200
    assert not around(10.0 + scene.SHOT_MARK + 0.01).any(), "gone within the moment"
    session.last_hit = False
    missed = around(10.05)
    assert missed.any() and green(missed) == 0 and red(missed) == 0


def test_a_shot_that_teaches_the_aim_is_acknowledged_on_its_face():
    from handy.schemes import PISTOL
    from handy.shot_calibration import TARGETS, ShotCalibration

    session = ShotCalibration(PISTOL)
    session.samples = [(((0.3, 0.3),), TARGETS[0])]
    session.last_shot = 20.0
    canvas = np.zeros((HEIGHT, WIDTH, 3), np.uint8)
    scene.celebrate_shot(canvas, session, 20.05)
    x, y = round(TARGETS[0][0] * WIDTH), round(TARGETS[0][1] * HEIGHT)
    b, g, r = (canvas[y - 30:y + 30, x - 30:x + 30, c].astype(int) for c in range(3))
    assert ((g > r + 80) & (g > b + 80)).sum() > 200
