import pytest

from handy.fusion import GAIN_LIMIT, Opinion, fuse, spread_of


def opinion(x, y, **kwargs) -> Opinion:
    defaults = dict(travel=0.0, gain=2.0, span=0.1)
    return Opinion(position=(x, y), **{**defaults, **kwargs})


def test_no_cameras_means_no_answer():
    assert fuse([]) is None


def test_one_camera_is_taken_at_its_word():
    result = fuse([opinion(0.3, 0.7)])
    assert result.position == pytest.approx((0.3, 0.7))
    assert result.cameras == 1


def test_the_steadier_camera_carries_more_weight():
    """Weighting is inverse variance, and the map's gain is what multiplies noise."""
    sharp = opinion(0.60, 0.5, gain=1.0)
    blurry = opinion(0.40, 0.5, gain=4.0)
    result = fuse([sharp, blurry])
    assert 0.55 < result.position[0] < 0.60


def test_disagreement_is_reported_not_hidden():
    result = fuse([opinion(0.40, 0.5), opinion(0.52, 0.5)])
    assert result.spread == pytest.approx(0.12)


def test_spread_takes_the_widest_pair():
    assert spread_of([(0.0, 0.0), (0.1, 0.0), (0.4, 0.0)]) == pytest.approx(0.4)
    assert spread_of([(0.2, 0.2)]) == 0.0


def test_equally_steady_cameras_are_simply_averaged():
    result = fuse([opinion(0.4, 0.5), opinion(0.6, 0.5)])
    assert result.position == pytest.approx((0.5, 0.5))


# --- refusing to listen to a bad camera -------------------------------------

def test_a_camera_whose_map_is_stretched_beyond_sense_is_ignored():
    good = opinion(0.30, 0.40, gain=2.0)
    hopeless = opinion(0.90, 0.90, gain=GAIN_LIMIT * 10, usable=False)

    result = fuse([good, hopeless])
    assert result.position == pytest.approx((0.30, 0.40))
    assert result.cameras == 1, "it does not even get a vote"


def test_a_rig_where_every_camera_is_hopeless_still_answers():
    """Better a rough answer than none: the player can still play."""
    result = fuse([opinion(0.4, 0.5, usable=False), opinion(0.6, 0.5, usable=False)])
    assert result is not None
    assert result.position == pytest.approx((0.5, 0.5))


def test_an_infinite_gain_carries_no_weight():
    assert opinion(0.5, 0.5, gain=float("inf")).position_weight == 0.0


# --- the trigger ------------------------------------------------------------

def test_the_camera_seeing_the_bigger_hand_decides_the_trigger():
    close = opinion(0.5, 0.5, travel=1.0, span=0.20)
    distant = opinion(0.5, 0.5, travel=0.0, span=0.05)
    assert fuse([close, distant]).travel > 0.8


def test_travel_falls_back_to_a_plain_average_without_hand_sizes():
    result = fuse([opinion(0.5, 0.5, travel=0.0, span=0.0),
                   opinion(0.5, 0.5, travel=1.0, span=0.0)])
    assert result.travel == pytest.approx(0.5)
