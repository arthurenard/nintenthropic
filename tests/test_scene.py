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

def test_the_timer_renders_in_both_modes(canvas):
    for remaining in (75.0, 8.0, None):
        canvas[:] = 0
        scene.draw_timer(canvas, remaining)
        assert canvas.any()


def test_the_timer_turns_red_when_time_is_short(canvas):
    scene.draw_timer(canvas, 30.0)
    calm = canvas.copy()
    canvas[:] = 0
    scene.draw_timer(canvas, 5.0)
    assert not np.array_equal(calm, canvas)


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
        card_top = (HEIGHT - scene._px(400, 1.0)) // 2
        tab = canvas[card_top, (WIDTH - scene._px(760, 1.0)) // 2 + scene._px(28, 1.0)]
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


def test_every_maps_blurb_fits_inside_its_card(canvas):
    """Wrapping has to measure what is actually drawn, halo and all."""
    from handy import maps
    from handy.game import Rect
    from handy.rendering import text_width

    cards = scene.map_cards(Rect(0, 0, WIDTH, HEIGHT), len(maps.MAPS))
    for card, chosen in zip(cards, maps.MAPS):
        limit = card.width - 36
        lines = scene._wrapped(chosen.blurb, 0.5, limit)
        assert lines, f"{chosen.key} has no blurb"
        for line in lines:
            assert text_width(line, 0.5, 1, outline=False) <= limit, line


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
    scene.draw_map_select(canvas, cards, entries, aimed=0)

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


def test_the_hud_reads_differently_with_one_camera_and_with_two(canvas):
    from handy.aiming import Aim
    from handy.game import Rect, Round, RoundOptions

    round_ = Round(RoundOptions(area=Rect(0, 0, 800, 400)))
    aim = Aim(position=(0.5, 0.5), armed=True, cameras=2, spread=0.012, depth=0.4)

    scene.draw_hud(canvas, round_, aim, (400, 16), 30.0, False, [scene.FUSED])
    one = canvas.copy()
    canvas[:] = 0
    scene.draw_hud(canvas, round_, aim, (400, 16), 30.0, False,
                   [scene.FUSED, scene.FUSED])

    assert not np.array_equal(one, canvas)


def test_debug_shows_what_the_second_camera_measured(canvas):
    from handy.aiming import Aim
    from handy.game import Rect, Round, RoundOptions

    round_ = Round(RoundOptions(area=Rect(0, 0, 800, 400)))
    states = [scene.FUSED, scene.FUSED]
    single = Aim(position=(0.5, 0.5), cameras=1)
    paired = Aim(position=(0.5, 0.5), cameras=2, spread=0.02, depth=0.55)

    scene.draw_hud(canvas, round_, single, (400, 16), 30.0, True, states)
    alone = canvas.copy()
    canvas[:] = 0
    scene.draw_hud(canvas, round_, paired, (400, 16), 30.0, True, states)

    assert not np.array_equal(alone, canvas), "spread and depth only appear with two"


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
        scene.draw_hud(canvas, round_, Aim(), (400, 16), 30.0, True,
                       [scene.FUSED], scale)
        scene.draw_timer(canvas, 42.0, scale)
        scene.draw_footer(canvas, "some keys", scale)
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
    from handy.rendering import text_width

    long = "point your finger like a pistol, fold your thumb to fire, wink to zoom"
    fitted = scene._fitted(long, 0.55, 220)
    assert fitted.endswith("...") and text_width(fitted, 0.55, 1, outline=False) <= 220
    assert scene._fitted("short", 0.55, 220) == "short"


def test_five_cards_keep_their_text_inside_the_card(canvas):
    """Two rows of short cards: the foot line must not collide with the blurb."""
    from handy.game import Rect

    cards = scene.map_cards(Rect(0, 0, WIDTH, HEIGHT), 5)
    blurb = "A long valley and a rifle. Close one eye to look down the scope; the view"
    entries = tuple((f"MAP {i}", blurb, "not yet played", scene.draw_backdrop)
                    for i in range(5))
    scene.draw_map_select(canvas, cards, entries, aimed=None)
    for card in cards:
        below = canvas[card.bottom + 4:card.bottom + 30, card.x:card.right]
        assert below.max() < 100, "text ran out of the bottom of a card"


# --- the grid closes, figures are set cleanly, the map sits behind the card --

def test_five_cards_leave_one_slot_that_closes_the_grid():
    from handy.game import Rect

    cards = scene.map_cards(Rect(0, 0, WIDTH, HEIGHT), 5)
    slots = scene.empty_slots(cards)
    assert len(slots) == 1
    slot = slots[0]
    assert slot.y == cards[3].y and slot.x > cards[4].right
    assert slot.right <= WIDTH and slot.width == cards[0].width
    assert scene.empty_slots(scene.map_cards(Rect(0, 0, WIDTH, HEIGHT), 3)) == ()


def test_the_chooser_draws_the_placeholder_tile(canvas):
    from handy import maps
    from handy.game import Rect

    cards = scene.map_cards(Rect(0, 0, WIDTH, HEIGHT), len(maps.MAPS))
    entries = tuple((m.title, m.blurb, "best 1", m.draw_emblem) for m in maps.MAPS)
    scene.draw_map_select(canvas, cards, entries, aimed=None)
    slots = scene.empty_slots(cards)
    if not slots:
        pytest.skip("the grid is full: every slot holds a map")
    slot = slots[0]
    inside = canvas[slot.y + 5:slot.bottom - 5, slot.x + 5:slot.right - 5]
    assert inside.any() and inside.max() < 140, "a quiet tile, not a card"


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
        panel[:] = 120

    scene._thumbnail.cache_clear()
    a = scene._thumbnail(emblem, "A", 300, 100)
    b = scene._thumbnail(emblem, "A", 300, 100)
    assert a is b and len(calls) == 1
    assert a.shape == (100, 300, 3)
    # The treatment: lit along the top edge, shadowed at the foot.
    assert a[2, 150].mean() > a[50, 150].mean() > a[-1, 150].mean()


def test_a_highlighted_button_stays_a_neutral_button(canvas):
    from handy.game import Rect

    button = scene.Button(Rect(100, 100, 200, 60), "MAPS")
    scene.draw_button(canvas, button, highlighted=True)
    b, g, r = canvas[130, 120].astype(int)
    assert r < 140 and abs(r - b) < 30, "lit a little, never red"


def test_results_headline_names_the_score(canvas, monkeypatch):
    from handy.game import Summary

    seen = []
    monkeypatch.setattr(scene, "_centred_text",
                        lambda canvas, text, *args, **kwargs: seen.append(text))
    summary = Summary(score=180, shots=22, hits=15, accuracy=15 / 22,
                      best_streak=6, perfect=4, duration=60)
    scene.draw_results(canvas, summary, best=120, is_best=False)
    assert "SCORE" in seen and "TIME" not in seen


def test_the_logo_lockup_sits_bottom_right_on_every_menu(canvas):
    from handy.game import Rect

    scene.draw_logo(canvas, 1.0)
    width, height = logo_w, logo_h = scene.logo_size(1.0)
    corner = canvas[canvas.shape[0] - 60:, canvas.shape[1] - logo_w - 40:]
    assert np.any(np.all(corner == scene.ACCENT, axis=-1)), "no accent bar"
    assert np.any(np.all(corner == scene.INK, axis=-1)), "no wordmark"
    assert logo_w > 0 and logo_h > 0 and width == logo_w and height == logo_h
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
        assert np.any(np.all(corner == scene.ACCENT, axis=-1))


def test_the_camera_inset_is_framed_in_its_state_colour(canvas, camera):
    from handy.game import Rect

    rect = Rect(20, 20, 200, 120)
    for state, color in ((scene.FUSED, scene.ARMED), (scene.IGNORED, scene.DANGER)):
        canvas[:] = 0
        scene.draw_camera_inset(canvas, camera, Frame(), rect, "", state)
        frame = canvas[rect.y - 2:rect.bottom + 2, rect.x - 2:rect.right + 2]
        assert np.any(np.all(frame == color, axis=-1))


# --- the footer always fits --------------------------------------------------

def test_the_footer_never_runs_off_the_screen():
    from handy.app import CONTROL_KEYS

    long_hint = "point to aim, drop your thumb to fire, close an eye to scope in"
    for width, scale in ((1280, 1.0), (1512, 1.31), (960, 0.9)):
        line = scene.fit_hints([[long_hint], ["head shots kill outright"],
                                list(CONTROL_KEYS)], width, scale)
        assert scene.text_width(line, scene.FOOTER_SCALE * scale) <= width - 48 * scale
        assert "q quit" in line, "the most important key survives"


def test_the_footer_does_not_repeat_the_scheme_in_the_map():
    line = scene.fit_hints([["point to aim, close an eye to scope in"],
                            ["close an eye to scope in"], ["q quit"]], 2000, 1.0)
    assert line.count("close an eye") == 1


def test_the_hud_backing_draws_and_darkens(canvas):
    from handy.game import Rect

    canvas[:] = 200
    scene.draw_hud_backing(canvas, Rect(10, 10, 600, 250), 1.0)
    assert canvas[100, 100].mean() < 150 and canvas[600, 1000].mean() == 200


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
