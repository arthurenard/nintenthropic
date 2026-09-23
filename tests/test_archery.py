import numpy as np

from handy.game import Rect, RoundOptions
from handy.maps.archery import (RING_SCORES, ArcheryRound, Target, draw_emblem,
                                draw_world, target_alpha)

AREA = Rect(0, 0, 1280, 620)


def make_round(**options) -> ArcheryRound:
    options.setdefault("seed", 7)
    return ArcheryRound(RoundOptions(area=AREA, **options))


def test_rings_score_from_the_bullseye_outwards():
    target = Target(x=100, y=100, radius=100, spawned_at=0, lifetime=5)
    assert RING_SCORES[target.ring_at(100, 100)] == 10
    assert RING_SCORES[target.ring_at(130, 100)] == 8
    assert RING_SCORES[target.ring_at(199, 100)] == 2
    assert target.ring_at(201, 100) is None


def test_a_shot_on_the_rim_still_counts():
    target = Target(x=100, y=100, radius=100, spawned_at=0, lifetime=5)
    assert target.ring_at(200, 100) == len(RING_SCORES) - 1


def test_targets_spawn_up_to_the_limit_and_stay_inside_the_area():
    round_ = make_round(density=3, spawn_interval=1.0)
    for tick in range(6):
        round_.update(tick * 1.0)
    assert len(round_.targets) == 3
    for target in round_.targets:
        assert AREA.x <= target.x - target.radius
        assert target.x + target.radius <= AREA.right
        assert AREA.y <= target.y - target.radius
        assert target.y + target.radius <= AREA.bottom


def test_spawned_targets_do_not_overlap():
    round_ = make_round(density=3, spawn_interval=1.0)
    for tick in range(6):
        round_.update(tick * 1.0)
    for index, first in enumerate(round_.targets):
        for second in round_.targets[index + 1:]:
            gap = ((first.x - second.x) ** 2 + (first.y - second.y) ** 2) ** 0.5
            assert gap > first.radius + second.radius


def test_targets_expire():
    round_ = make_round(density=1, lifetime=2.0, spawn_interval=1.0)
    round_.update(0.0)
    assert len(round_.targets) == 1
    round_.update(2.5)
    assert all(t.spawned_at > 0.0 for t in round_.targets)


def test_an_empty_range_refills_without_waiting_for_the_timer():
    round_ = make_round(density=2, spawn_interval=10.0)
    round_.update(0.0)
    target = round_.targets[0]
    round_.shoot(target.x, target.y, 0.1)
    assert round_.targets == []

    round_.update(0.2)  # far inside the spawn interval, but the range is empty
    assert len(round_.targets) == 1


def test_hitting_a_target_scores_and_removes_it():
    round_ = make_round(density=1)
    round_.update(0.0)
    target = round_.targets[0]

    impact = round_.shoot(target.x, target.y, 0.1)

    assert impact.score == 10 and impact.ring == 0
    assert round_.score == 10 and round_.perfect == 1
    assert target not in round_.targets


def test_missing_costs_a_shot_but_no_target():
    round_ = make_round(density=1)
    round_.update(0.0)
    target = round_.targets[0]

    impact = round_.shoot(target.x + target.radius * 3, target.y, 0.1)

    assert not impact.is_hit and round_.score == 0 and round_.shots == 1
    assert target in round_.targets


def test_an_overlapping_shot_resolves_against_the_nearest_target():
    round_ = make_round()
    round_.targets = [
        Target(x=100, y=100, radius=90, spawned_at=0, lifetime=9),
        Target(x=200, y=100, radius=90, spawned_at=0, lifetime=9),
    ]
    impact = round_.shoot(190, 100, 0.1)
    assert impact.score == 10  # bullseye of the closer one
    assert len(round_.targets) == 1 and round_.targets[0].x == 100


def test_a_play_area_smaller_than_a_target_spawns_nothing():
    round_ = ArcheryRound(RoundOptions(area=Rect(0, 0, 10, 10), seed=1))
    round_.update(0.0)
    assert round_.targets == []


def test_targets_fade_in_and_out():
    target = Target(x=1, y=1, radius=10, spawned_at=0.0, lifetime=5.0)
    assert target_alpha(target, 0.0) == 0.0
    assert target_alpha(target, 2.0) == 1.0
    assert 0.0 < target_alpha(target, 4.7) < 1.0
    assert target_alpha(target, 5.0) == 0.0


def test_shadow_length_asks_for_the_fixture_height_not_for_every_lamp():
    """It used to call _lamps(1, ...) as a dummy, wanting only the second return
    value - and _lamps sizes its lane list by that width, so it built one lamp
    per pixel of the play area (1464 of them) and threw the list away, once per
    face per frame."""
    from handy.maps import archery

    area = (24, 265, 1464, 610)
    lamps, fixture_y = archery._lamps(1512, 949, area)
    assert len(lamps) < 10, "four lanes across a laptop screen, not a thousand"
    assert archery._fixture_y(949, area) == fixture_y

    calls = []
    original = archery._lamps
    archery._lamps = lambda *args: calls.append(args) or original(*args)
    try:
        assert archery._shadow_fall(700.0, 949, area) in range(4)
    finally:
        archery._lamps = original
    assert calls == [], "the shadow only ever needed the height"


def test_a_round_only_ever_asks_for_a_handful_of_sprite_sizes():
    """Every distinct integer radius is a cold sprite build - several full-size
    blurs, inline in the frame the face first appears in. Drawn from the
    continuous range a 60 s round wanted about thirty-five of them and dropped
    a frame for each; peak draw_world was 21.7 ms against a 10 ms budget."""
    from handy.maps.archery import RADIUS_STEP

    round_ = make_round(density=3, spawn_interval=0.4, lifetime=1.5, scale=1.3)
    radii = set()
    for tick in range(60 * 30):
        round_.update(tick / 30)
        radii.update(t.radius for t in round_.targets)

    assert len(radii) > 4, "the faces are still different sizes"
    assert len(radii) <= 20, f"too many distinct sprites to cache: {sorted(radii)}"
    for radius in radii:
        assert radius % RADIUS_STEP == 0, "and each sits on the sprite lattice"


def test_a_faces_sprite_is_built_off_the_frame_that_first_shows_it():
    """A cold build is 6 to 25 ms - a dropped frame and then some - and there is
    one per face, because the sprite is keyed by lighting and paper as well as
    by size. It used to happen inline in the frame the face appeared in: peak
    draw_world 21.7 ms against a 10 ms budget, on the map that is meant to be
    the calm one. A face fades in over a quarter second, so the build goes to a
    worker and the face waits, faintly, for it."""
    import concurrent.futures

    from handy.maps import archery

    canvas = np.zeros((620, 1280, 3), np.uint8)
    round_ = make_round(density=1, lifetime=5.0)
    round_.update(0.0)
    target = round_.targets[0]
    key = (int(round(target.radius)), 0, archery._variant(target), 0, 1)
    archery._sprites.pop(key, None)
    archery._baking.discard(key)

    submitted = []
    original = archery._SPRITE_OVEN.submit
    archery._SPRITE_OVEN.submit = lambda fn, *a: submitted.append((fn, a))
    try:
        # Freshly spawned: barely visible, and nothing is drawn for it yet.
        before = canvas.copy()
        archery._draw_face(canvas, target, 0.05)
        assert np.array_equal(before, canvas), "no face, and no build on this frame"
        assert submitted and submitted[0][1] == (key,)

        # Past patience with no sprite in hand, the frame pays for it rather
        # than leave a face missing.
        archery._draw_face(canvas, target, 1.0)
        assert not np.array_equal(before, canvas)
        assert key in archery._sprites
    finally:
        archery._SPRITE_OVEN.submit = original
        archery._baking.discard(key)

    # And the worker really does build it, on the real executor.
    archery._sprites.pop(key, None)
    concurrent.futures.wait([archery._SPRITE_OVEN.submit(archery._bake, key)],
                            timeout=30)
    assert key in archery._sprites and key not in archery._baking


def test_the_wall_does_not_remember_every_face_it_ever_showed():
    from handy.maps import archery

    for index in range(archery.SPRITE_CACHE + 12):
        archery._sprites[("junk", index)] = index
    archery._face_sprite(20, 0, 0, 0, 1)

    assert len(archery._sprites) <= archery.SPRITE_CACHE
    assert ("junk", 0) not in archery._sprites, "the oldest went first"
    archery._sprites.clear()


def test_a_shot_off_the_edge_of_the_canvas_does_not_crash_the_frame():
    """_roi clips, and returns a zero-size view for a point off the canvas. The
    hit branch checked for that; the burst and the miss branch went straight on
    to roi.copy() and cv2.drawMarker, and the error escaped into the render
    loop."""
    from handy.game import Impact
    from handy.maps.archery import draw_impact

    canvas = np.zeros((200, 320, 3), np.uint8)
    for point in ((-40.0, 100.0), (400.0, 100.0), (160.0, -60.0), (160.0, 300.0)):
        for ring in (None, 0):
            draw_impact(canvas, Impact(x=point[0], y=point[1], score=10, at=0.0,
                                       ring=ring), now=0.05, ttl=1.4)


def test_the_world_and_the_card_art_both_draw():
    round_ = make_round(density=2)
    round_.update(0.0)
    round_.shoot(round_.targets[0].x, round_.targets[0].y, 0.1)

    canvas = np.zeros((620, 1280, 3), np.uint8)
    draw_world(canvas, round_, 0.2)
    assert canvas.any()

    panel = np.zeros((200, 320, 3), np.uint8)
    draw_emblem(panel)
    assert panel.any()
