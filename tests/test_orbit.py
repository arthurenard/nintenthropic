import copy
import math

import numpy as np
import pytest

from handy.game import Rect, RoundOptions
from handy.maps.orbit import (ALARM_INTEGRITY, DRONE_DEPTH, FRIENDLY_PENALTY,
                              FULL_INTEGRITY, GRAVITY, MAX_FRAGMENTS,
                              MIN_SPLIT_RADIUS, SPAWN_DEPTH, SPLIT_SPEED, Z_WINDOW,
                              Drone, Fragment,
                              OrbitRound, Projection, draw_emblem, draw_world)

AREA = Rect(31, 294, 1449, 578)
VIEW = Projection.for_area(AREA)
WIDTH, HEIGHT = 1512, 945


def make_round(**options) -> OrbitRound:
    options.setdefault("seed", 4)
    return OrbitRound(RoundOptions(area=AREA, **options))


def fragment(x=0.0, y=0.0, z=10.0, vz=-4.0, radius=0.6, vx=0.0, vy=0.0,
             view=VIEW) -> Fragment:
    return Fragment(view=view, px=x, py=y, pz=z, vx=vx, vy=vy, vz=vz, radius=radius,
                    angle=0.3, spin=1.0, shape=(1.0, 0.8, 0.9, 0.7, 1.0, 0.85, 0.9, 0.75))


def window_bound(round_: OrbitRound) -> Fragment:
    """A fragment dead ahead, falling straight at the middle of the glass."""
    piece = fragment(z=2.0, vz=-5.0, radius=0.8)
    round_.targets = [piece]
    return piece


# --- the projection --------------------------------------------------------

def test_distance_reads_as_distance():
    near, far = fragment(z=4.0), fragment(z=20.0)
    assert far.size < near.size
    assert far.size == pytest.approx(near.size / 5)


def test_dead_ahead_is_the_middle_of_the_pane():
    piece = fragment(z=10.0)
    assert piece.x == pytest.approx(VIEW.centre[0])
    assert piece.y == pytest.approx(VIEW.centre[1])


def test_the_silhouette_and_the_hit_test_are_the_same_polygon():
    piece = fragment(z=6.0)
    polygon = piece.polygon()
    assert piece.contains(piece.x, piece.y)
    assert piece.contains(*polygon[0])  # a vertex is on the edge, and counts
    assert not piece.contains(piece.x + piece.size * 2, piece.y)


# --- ballistics -----------------------------------------------------------

def test_fragments_close_on_the_window_and_fall_towards_earth():
    piece = fragment(z=10.0, vz=-4.0, vy=0.0)
    for _ in range(30):
        piece.advance(0.1)
    assert piece.pz == pytest.approx(10.0 - 4.0 * 3.0)
    assert piece.vy == pytest.approx(GRAVITY * 3.0)
    assert piece.py > 0.0, "the arc bends down"


def test_the_arc_is_a_parabola_not_a_line():
    piece = fragment(z=20.0, vz=-2.0, vy=-1.0)
    heights = []
    for _ in range(40):
        piece.advance(0.1)
        heights.append(piece.py)
    climbs = [b - a for a, b in zip(heights, heights[1:])]
    assert climbs[0] < 0 < climbs[-1], "it rises, then the pull wins"


def test_time_to_window_counts_down_and_is_never_negative():
    piece = fragment(z=10.6, vz=-5.0)
    assert piece.time_to_window() == pytest.approx(2.0)
    piece.advance(1.0)
    assert piece.time_to_window() == pytest.approx(1.0)
    assert fragment(vz=1.0).time_to_window() == math.inf


def test_spawned_fragments_arrive_where_they_were_aimed():
    """A window-bound spawn lands on the glass; a passing one misses it."""
    round_ = make_round(seed=2)
    arrivals = {"hit": 0, "miss": 0}
    half_w, half_h = VIEW.pane_half_extent(Z_WINDOW)
    for _ in range(60):
        piece = round_.spawn(stage=0.5)
        while piece.pz > Z_WINDOW:
            piece.advance(1 / 120)
        on_glass = abs(piece.px) <= half_w and abs(piece.py) <= half_h
        arrivals["hit" if on_glass else "miss"] += 1
    assert arrivals["hit"] > 10 and arrivals["miss"] > 10


def test_spawns_start_far_and_inside_the_field_of_view():
    round_ = make_round()
    for _ in range(30):
        piece = round_.spawn(stage=0.0)
        assert piece.pz >= SPAWN_DEPTH[0] and piece.vz < 0
        assert AREA.contains(piece.x, piece.y)


# --- fragmentation ---------------------------------------------------------

def momentum(fragments) -> tuple[float, float, float]:
    """Total momentum of some fragments, for the books."""
    return (sum(f.mass * f.vx for f in fragments),
            sum(f.mass * f.vy for f in fragments),
            sum(f.mass * f.vz for f in fragments))


def test_a_hit_splits_a_big_fragment_and_momentum_is_conserved():
    round_ = make_round()
    parent = fragment(z=8.0, vz=-4.0, vx=0.5, vy=-0.2, radius=0.8)
    round_.targets = [parent]
    before = momentum([parent])

    impact = round_.shoot(parent.x, parent.y, 0.0)

    assert impact.label == "SPLIT" and impact.ring == 1
    pieces = round_.targets
    assert parent not in pieces and 2 <= len(pieces) <= 3
    assert sum(p.mass for p in pieces) == pytest.approx(parent.mass)
    after = momentum(pieces)
    # The round's own push is tiny next to the rock; the rest must balance.
    for axis in range(3):
        assert after[axis] == pytest.approx(before[axis], abs=0.2)
    assert any(p.vx != pytest.approx(parent.vx) for p in pieces), "they fly apart"
    assert all(p.generation == 1 for p in pieces)
    assert "debris_hit" in round_.cues and "suppressed_shot" in round_.cues


def test_a_small_fragment_is_vaporised_outright():
    round_ = make_round()
    small = fragment(z=8.0, radius=MIN_SPLIT_RADIUS * 0.8)
    round_.targets = [small]

    impact = round_.shoot(small.x, small.y, 0.0)

    assert impact.label == "CLEARED" and impact.ring == 0
    assert round_.targets == [] and round_.cleared == 1 and round_.perfect == 1


def test_the_far_shot_is_worth_more_than_the_near_one():
    scores = []
    for z in (3.0, 25.0):
        round_ = make_round()
        piece = fragment(z=z, radius=0.3)
        round_.targets = [piece]
        scores.append(round_.shoot(piece.x, piece.y, 0.0).score)
    assert scores[1] > scores[0]


def test_a_split_in_a_full_field_loses_no_pieces():
    round_ = make_round()
    round_.targets = [fragment(x=i * 0.5, z=8.0, radius=0.8) for i in range(MAX_FRAGMENTS)]
    target = round_.targets[0]
    round_.shoot(target.x, target.y, 0.0)
    pieces = [piece for piece in round_.targets if piece.generation == 1]
    assert len(pieces) == 2, "as few as a split can make, and none thrown away"
    assert sum(piece.mass for piece in pieces) == pytest.approx(target.mass)
    assert len(round_.targets) == MAX_FRAGMENTS + 1
    round_.update(0.0)
    round_.update(0.1)
    assert len(round_.targets) <= MAX_FRAGMENTS + 1, "the sky holds back meanwhile"


def cracks_from(pieces, seed: int) -> int:
    """How many of these pieces crack the pane, flown in on their own."""
    round_ = make_round(seed=seed, density=0, duration=None)
    round_.targets = list(pieces)
    now = 0.0
    while round_.targets and now < 30.0:
        round_.update(now)
        now += 1 / 30
    return len(round_.cracks)


def test_splitting_a_rock_on_its_way_to_the_glass_leaves_pieces_on_their_way():
    """They keep the momentum the parent had: a careless split turns one
    problem into two, not into none."""
    kept = splits = 0
    for seed in range(60):
        round_ = make_round(seed=seed)
        parent = round_.spawn(0.5)
        while parent.radius < MIN_SPLIT_RADIUS or not cracks_from([copy.deepcopy(parent)], seed):
            parent = round_.spawn(0.5)
        for _ in range(30):  # a second in, as a player would take it
            parent.advance(1 / 30)
        pieces = round_.split(parent, (parent.x, parent.y))
        for piece in pieces:
            parted = math.hypot(piece.vx - parent.vx, piece.vy - parent.vy)
            assert parted <= SPLIT_SPEED + 0.5, "the round breaks it, it does not fling it"
        assert len({(round(p.vx, 6), round(p.vy, 6)) for p in pieces}) == len(pieces)
        kept += cracks_from(pieces, seed) > 0
        splits += 1
    assert kept >= 0.85 * splits


def test_a_shot_into_the_wall_hits_nothing():
    round_ = make_round()
    round_.targets = [fragment(z=8.0)]
    impact = round_.shoot(AREA.x - 40, AREA.y - 40, 0.0)
    assert not impact.is_hit and len(round_.targets) == 1


# --- the glass --------------------------------------------------------------

def test_a_fragment_reaching_the_glass_cracks_it():
    round_ = make_round()
    round_.update(0.0)
    piece = window_bound(round_)
    for tick in range(1, 40):
        round_.update(tick * 0.05)
    assert piece not in round_.targets
    assert round_.integrity < FULL_INTEGRITY
    assert len(round_.cracks) == 1
    crack = round_.cracks[0]
    assert AREA.contains(crack.x, crack.y)
    assert "glass_crack" in round_.cues


def test_heavier_and_faster_costs_more():
    light, heavy, fast = make_round(), make_round(), make_round()
    light.damage(fragment(radius=0.3, vz=-3.0), 0.0)
    heavy.damage(fragment(radius=0.9, vz=-3.0), 0.0)
    fast.damage(fragment(radius=0.9, vz=-6.5), 0.0)
    assert light.integrity > heavy.integrity > fast.integrity


def test_a_passing_fragment_costs_nothing():
    round_ = make_round()
    round_.update(0.0)
    half_w, _ = VIEW.pane_half_extent(Z_WINDOW)
    passing = fragment(x=half_w * 5.0, z=2.0, vz=-5.0)
    round_.targets = [passing]
    for tick in range(1, 40):
        round_.update(tick * 0.05)
    assert passing not in round_.targets
    assert round_.integrity == FULL_INTEGRITY and round_.cracks == []


def test_damage_accumulates_and_the_alarm_sounds_once():
    round_ = make_round()
    while round_.integrity > ALARM_INTEGRITY:
        round_.damage(fragment(radius=0.5), 0.0)
    assert round_.cues.count("alarm") == 1
    round_.damage(fragment(radius=0.3), 0.0)
    assert round_.cues.count("alarm") == 1, "no nagging until it actually fails"


def test_the_round_ends_when_the_pane_fails():
    round_ = make_round()
    round_.update(0.0)
    assert not round_.is_over(1.0)
    while round_.integrity > 0:
        round_.damage(fragment(radius=0.9, vz=-6.0), 1.0)
    assert round_.is_lost and round_.is_over(1.0)
    assert round_.outcome() == "PANE FAILED"
    assert round_.summary().outcome == "PANE FAILED"
    assert not round_.summary().won
    assert round_.cues.count("alarm") >= 1
    assert round_.failed_at == 1.0


def test_a_round_that_holds_says_so():
    """Holding is the good ending, and the results card is told which it is
    rather than reading anything into there being an outcome at all."""
    assert make_round().outcome() == "PANE HELD"
    assert make_round().summary().won


# --- the drone --------------------------------------------------------------

def test_hitting_the_drone_costs_points_and_breaks_the_streak():
    round_ = make_round()
    round_.drone = Drone(x=1.5, y=0.0, z=DRONE_DEPTH, vx=0.0, launched_at=0.0)
    piece = fragment(z=8.0, radius=0.3)
    round_.targets = [piece]
    round_.shoot(piece.x, piece.y, 0.0)  # one on the board first
    score, streak = round_.score, round_.streak
    sx, sy = VIEW.screen(1.5, 0.0, DRONE_DEPTH)

    impact = round_.shoot(sx, sy, 0.5)

    assert impact.label == "FRIENDLY" and not impact.is_hit
    assert round_.score == max(0, score - FRIENDLY_PENALTY)
    assert round_.streak == 0 and streak == 1
    assert round_.drone.hit_at == 0.5
    assert "static" in round_.cues and "alarm" in round_.cues


def test_the_drone_can_never_drive_the_round_below_nothing():
    """The penalty is bigger than any single fragment pays, so unfloored it sent
    an early mistake negative - into the summary, onto the results card, and
    into the high-score table, where the chooser then read it back as a best."""
    round_ = make_round()
    round_.drone = Drone(x=1.5, y=0.0, z=DRONE_DEPTH, vx=0.0, launched_at=0.0)
    sx, sy = VIEW.screen(1.5, 0.0, DRONE_DEPTH)

    round_.shoot(sx, sy, 0.5)

    assert round_.score == 0
    assert round_.summary().score == 0


def test_a_fragment_in_front_of_the_drone_takes_the_shot():
    round_ = make_round()
    round_.drone = Drone(x=0.0, y=0.0, z=DRONE_DEPTH, vx=0.0, launched_at=0.0)
    near = fragment(z=DRONE_DEPTH / 2, radius=0.3)
    round_.targets = [near]
    impact = round_.shoot(near.x, near.y, 0.0)
    assert impact.is_hit and round_.drone.hit_at is None


def test_a_hit_drone_drifts_off_and_a_new_one_comes_later():
    round_ = make_round()
    round_.update(0.0)
    for tick in range(1, 200):
        round_.update(tick * 0.1)
        if round_.drone is not None:
            break
    assert round_.drone is not None, "one turns up in the first twenty seconds"
    round_.drone.hit_at = round_.drone.launched_at
    left_at = None
    for tick in range(200, 600):
        round_.update(tick * 0.1)
        if round_.drone is None:
            left_at = tick * 0.1
            break
    assert left_at is not None
    for tick in range(int(left_at * 10) + 1, 900):
        round_.update(tick * 0.1)
        if round_.drone is not None and round_.drone.hit_at is None:
            return
    pytest.fail("no replacement drone")


# --- the round as a whole -----------------------------------------------------

def test_the_field_fills_and_more_comes_later():
    round_ = make_round(duration=60.0, density=3, spawn_interval=1.0)
    round_.update(0.0)
    counts = []
    for tick in range(1, 300):
        round_.update(tick / 30)
        counts.append(len(round_.targets))
    assert max(counts) >= 3

    # A perfect gunner clears everything as it appears: later, more appears.
    round_ = make_round(duration=60.0, density=3, spawn_interval=1.0)
    round_.update(0.0)
    spawned = [0, 0, 0]
    for tick in range(1, 1800):
        round_.update(tick / 30)
        spawned[min(tick // 600, 2)] += len(round_.targets)
        round_.targets = []
    assert spawned[0] < spawned[1] < spawned[2]
    assert round_.integrity == FULL_INTEGRITY


def debris_log(fps: int = 30, shoot: bool = False) -> tuple[list, list]:
    """The size of every piece of debris sent in over half a minute, in order,
    and what the player's shots did - one at the biggest every three seconds."""
    round_ = make_round(seed=7, duration=60.0)
    sent, labels = [], []
    for frame in range(30 * fps):
        now = 1000.0 + frame / fps
        round_.update(now)
        if shoot and frame % (3 * fps) == fps and round_.targets:
            biggest = max(round_.targets, key=lambda f: f.radius)
            labels.append(round_.shoot(biggest.x, biggest.y, now).label)
        for piece in round_.targets:
            if piece.generation == 0 and all(piece is not s for s in sent):
                sent.append(piece)
    return [piece.radius for piece in sent], labels


def test_what_the_player_breaks_does_not_change_what_comes_next():
    quiet, _ = debris_log()
    busy, labels = debris_log(shoot=True)
    assert "SPLIT" in labels
    common = min(len(quiet), len(busy))
    assert common > 12 and busy[:common] == quiet[:common]


def test_the_frame_rate_does_not_change_what_comes():
    slow, _ = debris_log(fps=30)
    fast, _ = debris_log(fps=60)
    common = min(len(slow), len(fast))
    assert common > 12 and fast[:common] == slow[:common]


def test_the_shot_is_always_heard_inside():
    round_ = make_round()
    round_.shoot(AREA.centre_x, AREA.y + AREA.height // 2, 0.0)
    assert round_.take_cues() == ["suppressed_shot"]
    assert round_.take_cues() == []


# --- drawing ------------------------------------------------------------------

def canvas() -> np.ndarray:
    return np.zeros((HEIGHT, WIDTH, 3), np.uint8)


def test_draw_world_runs_at_every_stage_of_a_round():
    round_ = make_round(duration=60.0)
    frame = canvas()
    draw_world(frame, round_, 0.0)  # before the first update
    assert frame.any()
    now = 0.0
    rng = np.random.default_rng(1)
    while now < 75.0:  # past the end of the clock
        now += 1 / 30
        round_.update(now)
        if round_.targets and int(now * 2) != int((now - 1 / 30) * 2):
            first = round_.targets[0]
            round_.shoot(first.x + rng.normal(0, 5), first.y + rng.normal(0, 5), now)
        if int(now) != int(now - 1 / 30):
            draw_world(frame, round_, now)
    assert round_.is_over(now)
    draw_world(frame, round_, now)


def test_draw_world_shows_the_damage_and_the_end():
    round_ = make_round()
    round_.update(0.0)
    frame = canvas()
    draw_world(frame, round_, 0.0)
    whole = frame.copy()
    while not round_.is_lost:
        round_.damage(fragment(x=0.2, y=-0.1, radius=0.9, vz=-6.0), 0.2)
    draw_world(frame, round_, 0.3)  # the flash, the cracks, the failure notice
    assert (frame != whole).any()
    draw_world(frame, round_, 5.0)  # long after


def test_the_drone_and_a_friendly_hit_draw():
    round_ = make_round()
    round_.update(0.0)
    round_.drone = Drone(x=0.0, y=0.0, z=DRONE_DEPTH, vx=0.3, launched_at=0.0)
    frame = canvas()
    draw_world(frame, round_, 0.1)
    sx, sy = VIEW.screen(*round_.drone.position(0.2))
    round_.shoot(sx, sy, 0.2)
    draw_world(frame, round_, 0.3)
    draw_world(frame, round_, 2.0)


def test_the_sun_sweeps_and_the_frame_keeps_the_cabin_clean():
    """A huge fragment right at the glass must not spill over the wall."""
    round_ = make_round()
    round_.targets = [fragment(z=Z_WINDOW + 0.05, radius=0.9)]
    frame = canvas()
    draw_world(frame, round_, 30.0)  # sun mid-sweep
    clean = canvas()
    round_.targets = []
    draw_world(clean, round_, 30.0)
    wall = (slice(0, AREA.y - 30), slice(0, WIDTH))
    assert (frame[wall] == clean[wall]).all()


def test_drawing_is_cheap_enough_for_thirty_frames_a_second():
    import time
    round_ = make_round(duration=60.0)
    frame = canvas()
    now = 0.0
    while now < 40.0:
        now += 1 / 30
        round_.update(now)
    draw_world(frame, round_, now)  # warm the caches
    started = time.perf_counter()
    for _ in range(20):
        now += 1 / 30
        round_.update(now)
        draw_world(frame, round_, now)
    per_frame = (time.perf_counter() - started) / 20
    assert per_frame < 0.025


def test_the_emblem_draws_on_a_card_sized_panel():
    panel = np.zeros((164, 404, 3), np.uint8)
    draw_emblem(panel)
    assert panel.any()


# --- the light, the sizes, the popups -----------------------------------------

def test_the_sun_stays_in_one_quadrant_all_round():
    """One light direction per round: the disc never crosses to the left."""
    from handy.maps.orbit import sun_position
    for now in (0.0, 15.0, 30.0, 48.0, 60.0, 89.0):
        x, y = sun_position(AREA, now)
        assert x > AREA.centre_x + AREA.width * 0.2
        assert y < AREA.y + AREA.height * 0.35


def test_debris_comes_in_three_sizes():
    from handy.maps.orbit import SIZE_TIERS
    round_ = make_round(seed=9)
    seen = set()
    for _ in range(120):
        radius = round_.spawn(stage=0.3).radius
        for index, (low, high) in enumerate(SIZE_TIERS):
            if low <= radius <= high:
                seen.add(index)
    assert seen == {0, 1, 2}


def test_score_popups_stay_on_the_glass_and_clear_of_the_reticle():
    from handy.maps.orbit import _pane_inner, _popup_origin
    inner = _pane_inner(AREA)
    lines = [("+160", 0.6), ("CLEARED", 0.5)]
    for corner in ((inner.x + 2, inner.y + 2), (inner.right - 2, inner.y + 2),
                   (inner.x + 2, inner.bottom - 2), (inner.right - 2, inner.bottom - 2),
                   (AREA.centre_x, AREA.y + AREA.height // 2)):
        x, y, step = _popup_origin(AREA, corner, 10, lines)
        assert inner.x <= x and y + step <= inner.bottom + step
        assert y - step >= inner.y - step
        # The label box is never on top of the crosshair (30 px radius).
        assert abs(x - corner[0]) > 30 or abs(y - corner[1]) > 30


def test_a_big_fragment_draws_faceted_and_lit_from_the_sun():
    from handy.maps.orbit import ROCK_RIM, draw_fragment
    frame = canvas()
    piece = fragment(z=3.0, radius=1.2)
    draw_fragment(frame, piece, (AREA.right, AREA.y))
    patch = frame[int(piece.y) - 80:int(piece.y) + 80, int(piece.x) - 80:int(piece.x) + 80]
    assert patch.any()
    # The rim only appears on the sunward (upper-right) half.
    rim = (patch == np.array(ROCK_RIM, np.uint8)).all(axis=2)
    ys, xs = np.nonzero(rim)
    assert len(xs) and xs.mean() > 80 and ys.mean() < 80


# --- the look: light, materials, the drone, the glass -------------------------

def test_no_two_spawned_silhouettes_share_an_outline():
    """Each piece carries its own vertex jitter and one of three materials."""
    from handy.maps.orbit import MATERIALS
    round_ = make_round(seed=3)
    pieces = [round_.spawn(stage=0.2) for _ in range(40)]
    assert len({p.offsets for p in pieces}) == len(pieces)
    assert all(len(p.offsets) == len(p.shape) for p in pieces)
    assert {p.material for p in pieces} == set(range(len(MATERIALS)))
    piece = pieces[0]
    assert piece.polygon().shape == (len(piece.shape), 2)


def test_split_pieces_keep_the_parent_material():
    round_ = make_round()
    parent = fragment(z=6.0, radius=0.9)
    parent.material = 2
    round_.targets = [parent]
    round_.shoot(parent.x, parent.y, 0.0)
    assert round_.targets and all(p.material == 2 for p in round_.targets)


def test_materials_are_lit_warm_on_top_and_cool_underneath():
    from handy.maps.orbit import MATERIALS, _material_tones
    for material in range(len(MATERIALS)):
        lit, mid, dark, under = _material_tones(material)
        assert lit[2] > mid[2] > dark[2], "the sunlit facet is the brightest, in red"
        assert under[0] > under[2], "the planet's bounce is blue (BGR)"
        assert lit[2] >= lit[0], "the sun's key is warm"


def test_every_material_draws_at_every_size():
    from handy.maps.orbit import draw_fragment
    frame = canvas()
    for material in range(3):
        for z in (1.0, 3.0, 9.0, 25.0, 60.0):
            piece = fragment(z=z, radius=1.0)
            piece.material = material
            piece.offsets = tuple([0.1] * len(piece.shape))
            draw_fragment(frame, piece, (AREA.right, AREA.y))
    assert frame.any()


def test_the_drone_is_drawn_with_its_line_and_its_tag():
    from handy.maps.orbit import SUIT, draw_drone, draw_tether
    frame = canvas()
    drone = Drone(x=0.0, y=-0.2, z=DRONE_DEPTH, vx=-0.4, launched_at=0.0)
    draw_tether(frame, AREA, drone, VIEW, 0.5)
    draw_drone(frame, drone, VIEW, 0.5, AREA)
    sx, sy = VIEW.screen(*drone.position(0.5))
    size = drone.radius_px(VIEW)
    body = frame[int(sy - size * 1.5):int(sy + size * 1.5), int(sx - size * 1.5):int(sx + size * 1.5)]
    assert (body == np.array(SUIT, np.uint8)).all(axis=2).sum() > size * size * 0.3
    # The line reaches back towards the truss on the left of the pane.
    left = frame[AREA.y:AREA.bottom, AREA.x:AREA.x + AREA.width // 3]
    assert left.any()
    # The tag is clear of the figure: nothing drawn right on the helmet but the suit.
    drone.hit_at = 0.6
    draw_tether(frame, AREA, drone, VIEW, 1.0)  # snapped
    draw_drone(frame, drone, VIEW, 1.0, AREA)   # tumbling, venting, untagged


def test_cracks_are_kept_as_one_layer_and_rebuilt_only_on_damage():
    from handy.maps.orbit import _crack_layer
    round_ = make_round()
    round_.update(0.0)
    assert _crack_layer(round_, (HEIGHT, WIDTH)) is None
    round_.damage(fragment(x=0.1, y=0.0, radius=0.7, vz=-5.0), 0.2)
    first = _crack_layer(round_, (HEIGHT, WIDTH))
    assert first is not None and first.shape == (AREA.height, AREA.width, 3) and first.any()
    assert _crack_layer(round_, (HEIGHT, WIDTH)) is first, "cached between frames"
    round_.damage(fragment(x=-0.2, y=0.1, radius=0.7, vz=-5.0), 0.4)
    second = _crack_layer(round_, (HEIGHT, WIDTH))
    assert second is not first and second.sum() > first.sum()
    # Nothing of the crack leaks onto the frame's bevel.
    assert not second[:2].any() and not second[:, :2].any()


def test_a_fresh_crack_flashes_from_a_handful_of_cached_sprites():
    """The flash fades over half a second; drawn every frame at whatever the
    frame rate is, it must not build a new sprite each time."""
    from handy.maps.orbit import _glow_sprite, draw_cracks
    round_ = make_round()
    round_.update(0.0)
    round_.damage(fragment(x=0.1, y=0.0, radius=0.7, vz=-5.0), 0.0)
    frame = canvas()
    # After the strike's own white-hot core is gone, so this is the crack's
    # flash alone; at an odd frame rate, then again a few milliseconds out.
    ages = np.linspace(0.31, 0.49, 37)
    for age in ages:
        draw_cracks(frame, round_, float(age))
    before = _glow_sprite.cache_info().misses
    for age in ages + 0.003:
        draw_cracks(frame, round_, float(age))
    assert _glow_sprite.cache_info().misses == before


def test_the_friendly_warning_pulses_and_the_score_popup_sits_on_a_pill():
    from handy.game import Impact
    from handy.maps.orbit import draw_impact
    centre = (AREA.centre_x, AREA.y + AREA.height // 2)
    frames = []
    for now in (0.02, 0.17):  # the ink flips between red and white
        frame = canvas()
        draw_impact(frame, AREA, Impact(x=centre[0], y=centre[1], score=0, at=0.0,
                                        ring=None, label="FRIENDLY"), now, 1.1)
        frames.append(frame)
    assert (frames[0] != frames[1]).any()
    frame = canvas()
    draw_impact(frame, AREA, Impact(x=centre[0], y=centre[1], score=80, at=0.0, ring=0,
                                    label="CLEARED"), 0.05, 1.1)
    # The burst: a bright core right at the hit, in the first frames.
    core = frame[centre[1] - 4:centre[1] + 4, centre[0] - 4:centre[0] + 4]
    assert core.mean() > 150
    draw_impact(frame, AREA, Impact(x=centre[0], y=centre[1], score=80, at=0.0, ring=0,
                                    label="CLEARED"), 0.6, 1.1)  # embers, no core


def test_the_planet_is_lit_from_the_right_and_dark_on_the_left():
    """The sun is up and to the right: the day side is the right of the limb,
    the night side with its cities is the left."""
    from handy.maps.orbit import _backdrop
    backdrop = _backdrop((AREA.x, AREA.y, AREA.width, AREA.height), WIDTH, HEIGHT, 4)
    rows = slice(AREA.bottom - 110, AREA.bottom - 60)
    left = backdrop[rows, AREA.x + AREA.width // 4:AREA.x + AREA.width // 4 + 40]
    right = backdrop[rows, AREA.right - AREA.width // 4:AREA.right - AREA.width // 4 + 40]
    assert right.mean() > left.mean() * 1.5


def test_the_sun_streak_is_not_level():
    from handy.maps.orbit import _glow_sprite
    streak = _glow_sprite(100, (255, 255, 255), 1.0, 1.0, squash=0.02, tilt=-11.0)
    ys, xs = np.nonzero(streak.any(axis=2))
    slope = np.polyfit(xs, ys, 1)[0]
    assert abs(slope) > 0.1


def test_the_emblem_is_a_hero_composition_at_card_and_sheet_sizes():
    for width, height in ((404, 164), (492, 200), (64, 36)):
        panel = np.zeros((height, width, 3), np.uint8)
        draw_emblem(panel)
        assert panel.any()


# --- the array: it moves, and it takes damage ---------------------------------

def test_the_array_sways_and_debris_crossing_it_scorches_a_cell():
    from handy.maps.orbit import (ARRAY_ROWS, PANEL_DEPTH, array_angle, array_cell,
                                  array_corners)
    assert array_angle(0.0) == 0.0 and array_angle(10.0) != array_angle(0.0)
    still, swung = array_corners(AREA, 0.0), array_corners(AREA, 3.0)
    assert (still != swung).any(), "the tilt moves the corners"
    # A fragment aimed straight at the middle of the array, just outside it.
    corners = array_corners(AREA, 0.0).astype(np.float32)
    centre = corners.mean(axis=0)
    cell = array_cell(AREA, float(centre[0]), float(centre[1]))
    assert cell is not None and 0 <= cell[0] < ARRAY_ROWS
    assert array_cell(AREA, AREA.right - 5, AREA.y + 5) is None
    round_ = make_round()
    round_.update(0.0)
    # Solve for the metres that project onto the array centre at that depth.
    z = PANEL_DEPTH + 0.05
    px = (centre[0] - VIEW.centre[0]) * z / VIEW.focal
    py = (centre[1] - VIEW.centre[1]) * z / VIEW.focal
    piece = fragment(x=px, y=py, z=z, vz=-3.0, radius=0.9)
    piece.vy = -GRAVITY * 0.1  # so the arc does not drift in one tick
    round_.targets = [piece]
    round_.update(0.1)
    assert piece not in round_.targets, "spent against the panel"
    assert round_.dead_cells and round_.array_strikes
    assert "hull_thud" in round_.take_cues()
    assert round_.bent_ribs, "a big piece kinks a rib"
    assert round_.integrity == FULL_INTEGRITY, "the glass is untouched"


def test_the_array_wears_over_the_round_and_never_goes_completely_dark():
    from handy.maps.orbit import ARRAY_COLS, ARRAY_ROWS
    round_ = make_round(duration=60.0)
    now = 0.0
    while now < 60.0:
        now += 1 / 30
        round_.update(now)
        round_.targets = []  # nothing else touches the array
    assert round_.dead_cells, "micrometeoroids pit the panel by the end"
    for _ in range(40):
        round_.pit_array((0, 0), now)
        round_.pit_array((1, 1), now)
    assert len(round_.dead_cells) <= ARRAY_ROWS * ARRAY_COLS - 2
    assert len(round_.array_strikes) <= 6


def test_the_array_sprite_is_cached_per_tilt_and_damage():
    from handy.maps.orbit import _array_sprite, draw_array
    key = (AREA.x, AREA.y, AREA.width, AREA.height)
    whole = _array_sprite(key, 0, (), ())
    assert _array_sprite(key, 0, (), ()) is whole
    scorched = _array_sprite(key, 0, ((1, 2),), (2,))
    assert scorched is not whole
    assert scorched[2].sum() < whole[2].sum(), "a dead cell is darker"
    frame = canvas()
    draw_array(frame, AREA, 0.0)
    before = frame.copy()
    draw_array(frame, AREA, 0.0, dead=((0, 0), (2, 3)), bent=(1,))
    assert (frame != before).any()
    draw_array(frame, AREA, 31.0)  # swung
    # The sprite's mask never paints outside the panel's own outline.
    x0, y0, pixels, mask = whole
    assert mask.shape == pixels.shape[:2] and mask.max() == 255
    assert not mask[0].any() and not mask[-1].any()


def test_the_array_is_lit_on_its_sunward_side():
    from handy.maps.orbit import _draw_solar_panel
    frame = np.zeros((200, 400, 3), np.uint8)
    corners = np.array([(40, 40), (360, 40), (360, 160), (40, 160)], np.int32)
    _draw_solar_panel(frame, corners, (900, 20), rows=2, cols=4)
    left = frame[60:140, 60:140].mean()
    right = frame[60:140, 260:340].mean()
    assert right > left * 1.2, "the sheen climbs towards the sun"


# --- the light on the rocks, the reticle, the popups ---------------------------

def test_small_and_large_fragments_share_one_material_and_value_range():
    from handy.maps.orbit import ROCK_RIM, draw_fragment
    frame = canvas()
    sun = (AREA.right, AREA.y)
    small = fragment(z=150.0, radius=1.0)  # a few pixels across
    small.material = 1  # bare alloy, the one that used to blow out white
    draw_fragment(frame, small, sun)
    patch = frame[int(small.y) - 4:int(small.y) + 5, int(small.x) - 4:int(small.x) + 5]
    assert patch.any()
    assert not (patch == 255).all(axis=2).any(), "no white sticker highlight"
    brightest = patch.reshape(-1, 3)[patch.sum(axis=2).argmax()].astype(int)
    assert brightest[2] >= brightest[0], "the key light on the edge is warm, not blue-white"
    big = fragment(z=3.0, radius=1.0)
    big.material = 1
    draw_fragment(frame, big, sun)
    region = frame[int(big.y) - 90:int(big.y) + 90, int(big.x) - 90:int(big.x) + 90]
    assert region.max() <= max(ROCK_RIM) + 1


def test_the_round_remembers_where_you_aim_and_draws_a_glow_under_the_reticle():
    round_ = make_round()
    round_.update(0.0)
    assert round_.aim is None
    frame = canvas()
    draw_world(frame, round_, 0.1)
    bare = frame.copy()
    round_.look((0.5, 0.6), False)
    assert round_.aim == (0.5, 0.6)
    draw_world(frame, round_, 0.1)
    cx, cy = int(0.5 * (WIDTH - 1)), int(0.6 * (HEIGHT - 1))
    around = (slice(cy - 45, cy + 45), slice(cx - 45, cx + 45))
    assert frame[around].sum() > bare[around].sum(), "brighter under the crosshair"
    far = (slice(AREA.y + 10, AREA.y + 60), slice(AREA.x + 10, AREA.x + 60))
    assert (frame[far] == bare[far]).all(), "and nowhere else"


def test_score_popups_rise_and_fade_on_one_kind_of_pill():
    from handy.game import Impact
    from handy.maps.orbit import _popup_origin, draw_impact
    centre = (AREA.centre_x, AREA.y + AREA.height // 2)
    frames = {}
    for age in (0.1, 0.5, 1.0):
        frame = canvas()
        draw_impact(frame, AREA, Impact(x=centre[0], y=centre[1], score=73, at=0.0, ring=1,
                                        label="SPLIT"), age, 1.1)
        frames[age] = frame
    # The label has a pill: a dark box with ink in it, somewhere off the hit.
    x, y, step = _popup_origin(AREA, centre, 0, [("+73", 0.6), ("SPLIT", 0.5)])
    box = frames[0.1][y - 20:y + step + 6, x - 9:x + 60]
    assert (box.max(axis=2) < 40).sum() > 200, "dark pill"
    assert (box[..., 2] > 180).any(), "yellow ink"
    # Later it sits higher and fainter.
    x2, y2, _ = _popup_origin(AREA, centre, int(46 * (1 - 1.0 / 1.1)),
                              [("+73", 0.6), ("SPLIT", 0.5)])
    assert y2 < y
    assert frames[1.0].sum() < frames[0.5].sum() < frames[0.1].sum()


def test_cracks_are_webs_not_scribbles():
    from handy.maps.orbit import make_crack
    import random
    crack = make_crack(500, 500, 30, random.Random(1), 0.0, 1.0)
    closed = [b for b in crack.branches if len(b) > 3 and (b[0] == b[-1]).all()]
    assert len(closed) == 2, "two rings of crazing joining the radials"
    reach = max(np.abs(b - np.array([500, 500])).max() for b in crack.branches)
    assert reach <= 16 + 30 * 2.0 + 2


def test_a_strike_jolts_the_glass_without_greying_out_space():
    """A third of the way to white over the frame's whole rectangle, for a
    third of a second at every strike, left space a grey haze much of a round -
    and lifted the cabin wall at the pane's cut corners with it."""
    round_ = make_round()
    round_.update(0.0)
    round_.damage(fragment(x=0.2, y=-0.1, radius=0.6, vz=-6.0), 0.2)
    struck = canvas()
    draw_world(struck, round_, 0.21)
    round_.struck_at = None
    calm = canvas()
    draw_world(calm, round_, 0.21)
    lift = struck.astype(int) - calm.astype(int)
    space = lift[AREA.y + 60:AREA.y + 120, AREA.x + 200:AREA.x + 400]
    assert 0 < space.mean() < 30, "felt, not a wash"
    assert not lift[AREA.y + 2:AREA.y + 10, AREA.x + 2:AREA.x + 10].any(), "the wall"
