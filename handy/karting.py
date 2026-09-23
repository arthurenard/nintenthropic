"""Driving with your hands on an invisible wheel.

Both hands grip the air like a steering wheel; the line between them is the
wheel's spoke, and its roll is the steering. Open both hands and the kart
brakes - letting go of a wheel is the most natural stop there is.

This module owns what must not drift: reading the wheel, the kart physics, the
race itself. Everything the player sees lives in handy/maps/kart.py.
"""

from __future__ import annotations

import bisect
import math
from dataclasses import dataclass, field
from functools import cached_property, lru_cache

from .aiming import distance
from .filtering import OneEuroFilter
from .game import RoundOptions
from .recognition import Hand

WRIST = 0
FINGERTIPS = (8, 12, 16, 20)
MIDDLE_MCP = 9

#: Wheel roll that means full lock, in degrees. A comfortable turn of the
#: forearms, not a contortion.
FULL_LOCK_DEGREES = 50.0

#: Fingertip reach (in palm spans) above which a hand counts as open. A fist
#: measures around 1.1, a flat hand around 2.1.
OPEN_REACH = 1.65

#: ... and the reach below which the throttle is pinned. Between the two the
#: hands are a PEDAL: a grip is full throttle, fingers half uncurled is a lift,
#: flat palms are the brake. Without this the only speed control on the whole
#: wheel is an on/off brake, so every corner is taken at either everything or
#: nothing - and a driver who cannot shed a little speed cannot drive a corner
#: at all through a fifth of a second of camera lag.
GRIP_REACH = 1.25
#: Seconds the throttle takes to follow the hands. A pedal has a foot on it;
#: a webcam has a recogniser that changes its mind between frames.
THROTTLE_EASE = 0.10

#: Steering response curve: a webcam wheel wobbles a few degrees at rest, so
#: the response is soft near centre and firm out at the lock. The shape is a
#: blend of x**1.5 and x - pure expo would numb half lock too much.
STEER_EXPO = 1.5
STEER_EXPO_MIX = 0.4


def shape_steer(raw: float) -> float:
    """Soften small wheel angles without stealing the big ones."""
    magnitude = min(1.0, abs(raw))
    shaped = (STEER_EXPO_MIX * magnitude ** STEER_EXPO
              + (1.0 - STEER_EXPO_MIX) * magnitude)
    return math.copysign(shaped, raw)


def hand_openness(hand: Hand) -> float:
    """How open the hand is: mean fingertip reach from the wrist, in palm spans."""
    wrist = hand.landmarks[WRIST]
    span = distance(wrist, hand.landmarks[MIDDLE_MCP])
    if span <= 0.0:
        return 0.0
    return sum(distance(wrist, hand.landmarks[tip]) for tip in FINGERTIPS) / (
        4.0 * span)


def is_open(hand: Hand) -> bool:
    """The recogniser's own verdict when it has one, geometry otherwise."""
    if hand.gesture is not None:
        return hand.gesture == "Open_Palm"
    return hand_openness(hand) > OPEN_REACH


def hand_throttle(hand: Hand) -> float:
    """This hand's share of the throttle: 1 gripped, 0 open, ramped between.

    The recogniser's labels are corners of the same axis rather than a
    different question - a called fist is a closed hand and a called palm is
    an open one - so they pin the ends and the geometry fills in the middle.
    """
    if hand.gesture == "Closed_Fist":
        return 1.0
    if hand.gesture == "Open_Palm":
        return 0.0
    reach = hand_openness(hand)
    lift = (reach - GRIP_REACH) / max(1e-6, OPEN_REACH - GRIP_REACH)
    return 1.0 - max(0.0, min(1.0, lift))


@dataclass(frozen=True)
class Wheel:
    """One frame of wheel input."""

    steer: float = 0.0  # -1 full left .. +1 full right
    brake: bool = False
    throttle: float = 1.0  # 1 gripped, 0 hands open: the trailing-throttle
    # axis. A closed grip is flat out, so a wheel nobody has touched still
    # means "go" and the brake stays a deliberate act.
    hands: int = 0  # how many hands are on the wheel
    held: bool = False  # a momentary dropout bridged by the grace period
    roll: float = 0.0  # this frame's wheel roll in degrees, before any neutral;
    # 0.0 whenever fewer than two hands are on the wheel, because there is no
    # wheel to read - never a stale angle dressed up as a live one.
    level_hint: bool = False  # the calibration was refused: hold it level

    @property
    def tracking(self) -> bool:
        return self.hands > 0 or self.held


class WheelController:
    """Turns two tracked hands into steering and brake.

    Steering is the roll of the line between the wrists - hold an invisible
    wheel and turn it. One hand alone is a pothole in the tracking, not a
    steering input: the last two-hand steer is held for a short grace, then
    eased to neutral - never remapped from where the surviving wrist happens
    to sit. Losing both hands coasts the steering back to neutral rather than
    freezing it at the last reading.

    A wheel only makes sense in a mirror: the hand the player feels on their
    right must be the one on the right of the picture. The mirrored camera the
    game shows by default already does that; with ``--no-mirror`` the picture
    is left-right reversed and so is the roll, so ``mirrored=False`` flips it
    back rather than handing the player an inverted wheel.
    """

    #: Seconds with no hands before the wheel is released entirely.
    GRACE = 0.4
    #: Seconds the last two-hand steer is held when one hand drops out.
    ONE_HAND_GRACE = 0.75
    #: Brake needs this many consecutive open readings; a single frame where
    #: the recogniser mistakes a hand mid-gesture must not slam the brakes.
    #: "Reading" means a fresh recognition, not a render frame - see update().
    BRAKE_FRAMES = 2

    #: The most a resting grip may be treated as "level". A neutral beyond
    #: this is more likely a hand mid-turn than a tilted camera or posture.
    MAX_NEUTRAL = 25.0
    #: How far apart the readings in one calibration may be, in degrees. Hands
    #: still moving are not a resting grip, however level their average looks.
    MAX_SPREAD = 20.0

    def __init__(self, min_cutoff: float = 1.0, beta: float = 1.2,
                 mirrored: bool = True) -> None:
        self._filter = OneEuroFilter(min_cutoff=min_cutoff, beta=beta)
        self._open_streak = 0
        self._last_seen: float | None = None
        self._last_two: float | None = None
        self._last_reading: int | None = None
        self._steer = 0.0
        self._throttle = 1.0
        self._last_stamp: float | None = None
        self.mirrored = mirrored
        self.neutral = 0.0
        #: True once a calibration has been refused and not yet replaced: the
        #: HUD may say so instead of leaving the player fighting a phantom pull.
        self.needs_level = False

    def set_neutral(self, rolls: list[float], clamp: bool = False) -> bool:
        """However the player actually holds the wheel is straight-ahead.

        Fed the rolls seen while they sat gripped and ready - the countdown -
        so a tilted camera or a comfortably off-level grip stops steering the
        kart. The median resists a stray reading; an implausibly large neutral
        is more likely a hand caught mid-turn than a posture, so it is refused
        (returning False, so the caller can ask again) unless ``clamp`` says
        this is the last word, in which case the nearest plausible neutral is
        taken - half a phantom pull beats a whole one.
        """
        if not rolls:
            return False
        import statistics

        neutral = statistics.median(rolls)
        unsteady = max(rolls) - min(rolls) > self.MAX_SPREAD
        if unsteady or abs(neutral) > self.MAX_NEUTRAL:
            self.needs_level = True
            if not clamp:
                return False  # still moving, or nowhere near level: ask again
            neutral = math.copysign(min(self.MAX_NEUTRAL, abs(neutral)), neutral)
        else:
            self.needs_level = False
        self.neutral = neutral
        return True

    def update(self, hands: list[Hand], timestamp: float,
               reading: int | None = None) -> Wheel:
        """One frame of wheel.

        ``reading`` identifies the recognition these hands came from (the
        recogniser's own timestamp). Inference runs behind the render loop, so
        the same result is handed out for several frames in a row; counting it
        once per frame would turn a single mistaken open palm into a brake.
        Repeats still move the clocks - the grace periods are wall time - but
        they do not count toward BRAKE_FRAMES.
        """
        fresh = reading is None or reading != self._last_reading
        self._last_reading = reading
        step = (0.0 if self._last_stamp is None
                else max(0.0, min(0.25, timestamp - self._last_stamp)))
        self._last_stamp = timestamp

        if not hands:
            gone = (float("inf") if self._last_seen is None
                    else timestamp - self._last_seen)
            self._open_streak = 0  # a dropout is not an open-hand reading
            if gone > self.GRACE:
                self._steer *= 0.85  # coast to neutral, do not snap
                return self._wheel(hands=0)
            # Inside the grace: the hands are still on the wheel as far as the
            # kart is concerned - a two-frame webcam blip must not cut throttle.
            return self._wheel(hands=0, held=True)

        self._last_seen = timestamp
        grips = sorted(hands[:2], key=lambda hand: hand.landmarks[WRIST][0])

        if len(grips) < 2:
            # One hand: hold the wheel where it was for a beat, then ease off.
            held = (self._last_two is not None
                    and timestamp - self._last_two <= self.ONE_HAND_GRACE)
            if not held:
                self._steer *= 0.92
            self._open_streak = 0
            return self._wheel(hands=1)

        self._last_two = timestamp
        left, right = grips[0].landmarks[WRIST], grips[1].landmarks[WRIST]
        roll = math.degrees(math.atan2(right[1] - left[1], right[0] - left[0]))
        if not self.mirrored:
            roll = -roll  # a raw camera hands you the wheel back to front
        self._steer = self._filter(
            shape_steer((roll - self.neutral) / FULL_LOCK_DEGREES), timestamp)
        self._steer = max(-1.0, min(1.0, self._steer))

        if fresh:
            if all(is_open(hand) for hand in grips):
                self._open_streak += 1
            else:
                self._open_streak = 0
        brake = self._open_streak >= self.BRAKE_FRAMES

        # The pedal: BOTH hands averaged, and eased, because one hand read
        # half-open for two frames is the recogniser blinking rather than a
        # driver lifting - and a throttle that flinches at every blink is
        # worse than no throttle axis at all.
        wanted = sum(hand_throttle(hand) for hand in grips) / len(grips)
        ease = 1.0 if step <= 0.0 else min(1.0, step / THROTTLE_EASE)
        self._throttle += (wanted - self._throttle) * ease
        if brake:
            self._throttle = 0.0  # open palms are the brake, not a trailing lift

        return self._wheel(hands=2, brake=brake, roll=roll)

    def _wheel(self, hands: int, brake: bool = False, held: bool = False,
               roll: float = 0.0) -> Wheel:
        return Wheel(steer=self._steer, brake=brake, throttle=self._throttle,
                     hands=hands, held=held, roll=roll,
                     level_hint=self.needs_level)


# --- the track ---------------------------------------------------------------

@dataclass(frozen=True)
class Segment:
    """A stretch of road: how long it runs and how hard it bends."""

    length: float
    curvature: float  # 1/units, positive bends right


@dataclass(frozen=True)
class Track:
    """A closed circuit assembled from segments.

    Closed in both senses: the headings sum to a whole turn and the centreline
    comes back to where it started, so the outline the minimap draws is the
    road the driver is actually on rather than a sheared approximation of it.
    """

    segments: tuple[Segment, ...]
    name: str = "circuit"

    def __post_init__(self) -> None:
        if not self.segments:
            raise ValueError("a track needs at least one segment")
        if any(segment.length <= 0.0 for segment in self.segments):
            raise ValueError("every segment must have a positive length")

    @cached_property
    def length(self) -> float:
        return sum(segment.length for segment in self.segments)

    @cached_property
    def _ends(self) -> tuple[float, ...]:
        """Cumulative segment ends, so curvature_at is a bisect, not a walk."""
        ends, acc = [], 0.0
        for segment in self.segments:
            acc += segment.length
            ends.append(acc)
        return tuple(ends)

    def curvature_at(self, s: float) -> float:
        s = s % self.length
        # s is strictly inside [0, length), so the bisect lands on a real
        # segment; the min() only guards the last float ulp of the last end.
        i = min(bisect.bisect_right(self._ends, s), len(self.segments) - 1)
        return self.segments[i].curvature

    def curvature_ahead(self, s: float, look: float) -> float:
        """Mean curvature over the next ``look`` units: what a driver sees."""
        steps = 8
        return sum(self.curvature_at(s + look * i / steps)
                   for i in range(1, steps + 1)) / steps

    def closure(self) -> tuple[float, float, float]:
        """Where the centreline ends up: (x, y, heading) after a whole lap.

        A properly closed circuit returns (0, 0, +-2pi). Anything else is a
        track that only pretends to be a loop.
        """
        return _integrate(self.segments)


def _integrate(segments) -> tuple[float, float, float]:
    """Walk the centreline: end point and total heading change."""
    x = y = theta = 0.0
    for segment in segments:
        if abs(segment.curvature) < 1e-12:
            x += segment.length * math.cos(theta)
            y += segment.length * math.sin(theta)
            continue
        turn = segment.length * segment.curvature
        x += (math.sin(theta + turn) - math.sin(theta)) / segment.curvature
        y += (math.cos(theta) - math.cos(theta + turn)) / segment.curvature
        theta += turn
    return x, y, theta


#: The corner vocabulary, in 1/units: a sweeper you take flat, a bend that
#: wants a lift, a hairpin that demands the brake.
CORNER_STRENGTHS = (0.0035, 0.006, 0.009)
#: How often each of them is asked for. Weighted toward the corners that
#: actually demand a lift, so no circuit is a three-lap flat-out cruise.
CORNER_TASTE = (2, 3, 4)
#: A corner shorter than this is a kink, longer than this is a whole lap.
#: Wide enough that every strength in the vocabulary is reachable by most
#: turns - narrow it and the hairpins quietly vanish from the circuit.
#: The floor is not cosmetic: a corner has teeth only if it lasts LONGER than
#: the seconds a kart takes to slide off the road (see lateral_margin), and
#: since that budget is deliberately generous, the corners have to be real.
#: A 70-unit "hairpin" is over in a second and a quarter - a driver can hold
#: full lock and full throttle straight through it and never see the kerb.
CORNER_SPAN = (110.0, 340.0)
#: Every circuit is DEALT its hairpins rather than left hoping for them: this
#: many corners are drawn with several times the share of the lap's heading
#: that an ordinary corner gets. Two long ones at the tightest curvature in
#: the vocabulary are what make a lap a lap - long enough that arriving flat
#: out puts a kart in the gravel before the exit, and slow enough that the
#: driver who lifted for them drives away from the one who did not.
HAIRPIN_QUOTA = 2
HAIRPIN_WEIGHT = (2.55, 3.55)
ORDINARY_WEIGHT = (0.45, 1.60)
#: How much of the lap's heading one corner may be worth, in radians. The
#: ceiling is what a hairpin is allowed to be: at the tightest curvature in
#: the vocabulary it buys a corner three hundred units long, which is what it
#: takes for a kart that arrived flat out to run out of road INSIDE the bend
#: rather than a few metres past the exit kerb. The floor keeps a corner from
#: being a kink with a certificate.
TURN_SPAN = (0.35, 2.85)
#: How short the road between two corners may be squeezed - a chicane - and
#: how long the pit straight always stays.
MIN_LINK = 55.0
MIN_START_STRAIGHT = 230.0
#: A lap must be worth racing three times: long enough for a real circuit,
#: short enough that three of them are a race and not an errand. The player
#: spends every second of it with BOTH ARMS UP holding an invisible wheel,
#: which is a plank, not a chair - three minutes of that is a forearm workout
#: and not an arcade session. The old floor of 3200 bought laps of 60-78
#: seconds and races of 199; the ceiling of 5600 bought nothing at all, since
#: the generator never drew a lap over 4300 in thirty seeds.
LAP_SPAN = (2000.0, 3000.0)
#: No single straight may be longer than this - a circuit, not an airfield.
MAX_STRAIGHT = 620.0
#: Every circuit must have teeth: this many corners, at least this long, that
#: a kart arriving FLAT OUT cannot get through without running out of road. A
#: lap nobody ever has to lift for is a lap nobody has to drive.
#:
#: The certificate used to be written against `cornering_speed` - the speed
#: above which full lock can no longer hold the bend - which is not a speed
#: any kart on the circuit ever actually reaches. A bend was stamped a tooth
#: at 45.7 while a flat-out kart went through it at 51.5 and never saw the
#: kerb: the invariant the generator enforced was not the invariant the player
#: experienced. `flat_out_reach` now DRIVES the corner to find out.
TEETH_COUNT = 2
TEETH_LENGTH = 140.0
#: How much of the corner must still be running when the flat-out kart falls
#: off the outside of it. A kart that only loses the road on the last metre of
#: the exit was not caught by the corner, it was waved at by it.
TOOTH_BITE = 0.85
#: How many draws a circuit gets before the ring of last resort. Generous,
#: because a draw is cheap and a bad circuit is forever.
ATTEMPTS = 400


def _corner_plan(rng) -> list[tuple[float, float]] | None:
    """A ring of corners whose turns add up to exactly one lap of heading.

    Most of them bend the way the circuit runs; a couple bend back, which is
    what makes an ess an ess. Returns (turn in radians, curvature) pairs, or
    None when the draw came out lopsided enough to be worth redrawing.
    """
    count = rng.randint(7, 10)
    against = rng.randint(1, 2)
    order = [1.0] * (count - against) + [-1.0] * against
    rng.shuffle(order)
    backs = [rng.uniform(0.25, 0.6) for way in order if way < 0]
    weights = [rng.uniform(*ORDINARY_WEIGHT) for way in order if way > 0]
    # Deal the hairpins into the ring rather than waiting for the dice to
    # offer them: a circuit whose longest corner is a second and a quarter
    # long is a circuit nobody ever has to lift for.
    for slot in rng.sample(range(len(weights)), HAIRPIN_QUOTA):
        weights[slot] = rng.uniform(*HAIRPIN_WEIGHT)
    # The forward corners carry the whole lap of heading plus whatever the
    # backward ones give away, shared out by weight.
    share = (math.tau + sum(backs)) / sum(weights)
    forwards = [weight * share for weight in weights]
    if not all(TURN_SPAN[0] <= turn <= TURN_SPAN[1] for turn in forwards):
        return None  # one corner would have swallowed the lap: redraw

    plan, taken_f, taken_b = [], 0, 0
    for way in order:
        if way > 0:
            turn, taken_f = forwards[taken_f], taken_f + 1
        else:
            turn, taken_b = -backs[taken_b], taken_b + 1
        # Lean on the tight end of the vocabulary: a circuit of gentle
        # sweepers is a circuit nobody ever has to brake for.
        asked = rng.choices(CORNER_STRENGTHS, weights=CORNER_TASTE)[0]
        fits = [k for k in CORNER_STRENGTHS
                if CORNER_SPAN[0] <= abs(turn) / k <= CORNER_SPAN[1]]
        strength = (min(fits, key=lambda k: abs(k - asked)) if fits
                    else min(0.0095, max(0.0025, abs(turn) / 200.0)))
        plan.append((turn, math.copysign(strength, turn)))
    return plan


def _fit_straights(headings, wanted, floors, target) -> list[float] | None:
    """Lengths for the straights that walk the loop back to its own start.

    With the corners fixed, the end of the lap is a linear function of the
    straight lengths, so closing the circuit is two equations in as many
    straights as there are. The least-norm step spreads the correction over
    every straight instead of stretching one of them into a runway; a straight
    pushed under its floor is pinned there and the rest take up the slack.
    """
    lengths = list(wanted)
    free = set(range(len(lengths)))
    for _ in range(len(lengths) + 4):
        rx = target[0] - sum(lengths[i] * headings[i][0]
                             for i in range(len(lengths)))
        ry = target[1] - sum(lengths[i] * headings[i][1]
                             for i in range(len(lengths)))
        if math.hypot(rx, ry) < 1e-6:
            return lengths
        if not free:
            return None
        a = sum(headings[i][0] ** 2 for i in free)
        b = sum(headings[i][0] * headings[i][1] for i in free)
        c = sum(headings[i][1] ** 2 for i in free)
        det = a * c - b * b
        if abs(det) < 1e-9:
            return None  # every free straight points the same way
        px, py = (c * rx - b * ry) / det, (a * ry - b * rx) / det
        for i in free:
            lengths[i] += headings[i][0] * px + headings[i][1] * py
        for i in [i for i in free if lengths[i] < floors[i]]:
            lengths[i] = floors[i]
            free.discard(i)
    return None


@lru_cache(maxsize=1)
def pinned_speed() -> float:
    """The speed a kart with the throttle pinned actually reaches on a straight.

    Not TOP_SPEED - drag settles the balance a little under it - and this is
    the number a corner has to be argued against, because it is the speed the
    corner is ARRIVED at. Integrated with the real physics rather than solved,
    so it cannot quietly disagree with the kart the player is driving.
    """
    track = Track((Segment(1e6, 0.0),))
    kart = Kart(v=TOP_SPEED * 0.5)
    for _ in range(1200):
        kart.advance(track, 1 / 60, 1.0, False, 0.0)
    return kart.v


#: How far into a bend the flat-out kart is followed before giving up on it.
#: A corner longer than the longest in the vocabulary is not a corner.
_REACH_LIMIT = CORNER_SPAN[1] * 1.3


@lru_cache(maxsize=512)
def _reach(curvature: float) -> float:
    track = Track((Segment(_REACH_LIMIT * 1.1, curvature),))
    kart = Kart(v=pinned_speed(), x=0.0)
    while kart.s < _REACH_LIMIT:
        # The lock that cancels the bend, trimmed back toward the crown of the
        # road: a driver doing everything right except lifting. Winding on MORE
        # than the corner asks would only steer a gentle sweeper off its inside
        # kerb, which is a driving error, not a corner with teeth.
        lock = max(-1.0, min(1.0, holding_lock(curvature, kart.v / TOP_SPEED)
                             - kart.x * 2.2))
        kart.advance(track, 1 / 60, 1.0, False, lock)
        if abs(kart.x) > ROAD_HALF_WIDTH:
            return kart.s
    return float("inf")


def flat_out_reach(curvature: float) -> float:
    """How far into this bend a kart that never lifted keeps the road.

    It arrives at `pinned_speed`, from the crown of the road, holding full
    lock against the corner - the best a driver can do without touching the
    pedal - and this is the distance at which it puts a wheel on the dirt
    anyway. Infinite when the bend simply never runs it out of road.
    """
    return _reach(round(abs(curvature), 5))


def teeth_of(segments) -> list[Segment]:
    """The corners on this circuit that genuinely demand a lift.

    A corner has teeth when it is long enough to be a corner at all AND long
    enough to still be running when the flat-out kart falls off the outside
    of it. Certified by driving it, not by comparing two numbers.
    """
    return [s for s in segments
            if s.length >= TEETH_LENGTH
            and flat_out_reach(s.curvature) <= s.length * TOOTH_BITE]


def _ring(rng) -> tuple[Segment, ...]:
    """The circuit of last resort - and still a real circuit.

    A CLOVER: the same lobe repeated a few times around a point, each lobe a
    long hairpin one way, a link, a gentler bend back the other, and a
    straight. Any shape whose repeat turns through exactly its own share of a
    lap closes exactly - the lobes are rotations of one another and rotations
    of a vector around a full turn sum to nothing - so no fitting can fail on
    it, which is the whole job of a fallback.

    A regular polygon would be simpler, and used to be what this was, but a
    polygon's corner is only a fifth of a lap of heading: too SHORT to still
    be running when a flat-out kart falls off the outside of it, and therefore
    not a tooth by the only definition that matters. The clover's hairpin is
    the longest corner the vocabulary allows, and every lobe has one.
    """
    tightest = max(CORNER_STRENGTHS)
    turn = min(TURN_SPAN[1], CORNER_SPAN[1] * tightest)
    hairpin = Segment(turn / tightest, tightest)
    if teeth_of([hairpin]):
        for lobes in (4, 3, 5, 6):
            back = turn - math.tau / lobes
            fits = [k for k in CORNER_STRENGTHS
                    if CORNER_SPAN[0] <= back / k <= CORNER_SPAN[1]]
            if back <= 0.0 or not fits:
                continue
            counter = Segment(back / min(fits), -min(fits))
            corners = hairpin.length + counter.length
            for share in (0.5, 0.25, 0.75, 0.0, 1.0):
                target = LAP_SPAN[0] + share * (LAP_SPAN[1] - LAP_SPAN[0])
                rest = target / lobes - corners
                if rest < MIN_START_STRAIGHT + MIN_LINK:
                    continue
                link = max(MIN_LINK, rest - MAX_STRAIGHT)
                straight = rest - link
                if straight > MAX_STRAIGHT:
                    continue
                way = 1.0 if rng.random() < 0.5 else -1.0
                lobe = (Segment(straight, 0.0),
                        Segment(hairpin.length, way * hairpin.curvature),
                        Segment(link, 0.0),
                        Segment(counter.length, way * counter.curvature))
                return tuple(lobe * lobes)
    # Unreachable while a hairpin is a tooth at all; a lap of gentle sweepers
    # is still better than no lap.
    span = sum(LAP_SPAN) / 2
    bend = Segment(span / 8, math.tau / (4 * (span / 8)))
    return tuple([Segment(span / 8, 0.0), bend] * 4)


def build_track(seed: int) -> Track:
    """A closed, varied circuit: straights, sweepers, hairpins, esses.

    Built as a ring of corners that turn through exactly one lap of heading,
    with the straights between them solved so the finish line lands back on
    the start line. Draws that will not close, or that come out too long or
    too short to race three times, are simply redrawn - and redrawn often
    enough that giving up stops being a thing that happens. A draw fails only
    by luck, so the cure for a rare failure is patience, not a worse circuit:
    about one draw in fourteen is usable and the worst seed in two thousand
    needed ninety-three, so ATTEMPTS of them practically never run out. The
    old eighty sent 0.8% of seeds to a fallback that was checked against no
    invariant at all.
    """
    import random

    rng = random.Random(seed)
    for _ in range(ATTEMPTS):
        plan = _corner_plan(rng)
        if plan is None:
            continue
        if rng.random() < 0.5:
            plan = [(-turn, -k) for turn, k in plan]  # run it the other way

        theta, corner_x, corner_y, headings = 0.0, 0.0, 0.0, []
        for turn, k in plan:
            headings.append((math.cos(theta), math.sin(theta)))
            corner_x += (math.sin(theta + turn) - math.sin(theta)) / k
            corner_y += (math.cos(theta) - math.cos(theta + turn)) / k
            theta += turn
        headings.append((math.cos(theta), math.sin(theta)))

        wanted = [rng.uniform(260.0, 300.0)]  # the start-finish straight
        wanted += [rng.uniform(120.0, 380.0) for _ in plan]
        floors = [MIN_START_STRAIGHT] + [MIN_LINK] * len(plan)
        straights = _fit_straights(headings, wanted, floors,
                                   (-corner_x, -corner_y))
        if straights is None or max(straights) > MAX_STRAIGHT:
            continue

        segments: list[Segment] = []
        for i, (turn, k) in enumerate(plan):
            segments.append(Segment(straights[i], 0.0))
            segments.append(Segment(abs(turn / k), k))
        segments.append(Segment(straights[-1], 0.0))
        if not LAP_SPAN[0] <= sum(s.length for s in segments) <= LAP_SPAN[1]:
            continue
        if len(teeth_of(segments)) < TEETH_COUNT:
            continue
        return Track(tuple(segments), name=f"circuit-{seed}")
    return Track(_ring(rng), name=f"circuit-{seed}")


# --- the karts ---------------------------------------------------------------

TOP_SPEED = 62.0          # units per second
ACCELERATION = 26.0
BRAKING = 55.0
DRAG = 3.0
#: Engine braking: units/s^2 shed at top speed with the throttle fully off,
#: scaled by how far off it is. THE PEDAL ONLY WORKS IF LIFTING SLOWS YOU
#: DOWN. Without this the whole trailing-throttle axis bought a driver 3
#: units/s^2 of drag while the front tyres scrubbed nineteen - the physics
#: lifted for you harder and later than you could lift for yourself, so the
#: fastest way round the circuit was to pin the throttle and let the
#: understeer do the driving. Off the throttle the kart now slows like a kart
#: off the throttle: a third of the brake, which is what makes the lift a
#: tool for trimming a corner entry rather than a decoration.
ENGINE_BRAKE = 19.0
# The lateral loop is deliberately UNHURRIED, because the player is holding a
# webcam and not a steering column. Between the camera, the recogniser and the
# smoothing, the wheel a driver turns now reaches the kart a fifth of a second
# from now, and a control loop only survives that much lag if the thing it
# controls takes far longer than that to go wrong. So the push and the
# authority are scaled down together - their RATIO, and therefore every
# cornering speed on the circuit, is untouched - until the worst corner on the
# worst circuit takes over two seconds to carry a kart from the crown of the
# road to the edge of it. That is the phase margin. See lateral_margin().
STEER_RATE = 1.52         # lateral units per second at full lock and full
                          # grip; the grip fade below scales this down to
                          # about 0.76 units/s once the kart is at top speed,
                          # which is what CENTRIFUGAL is balanced against
CENTRIFUGAL = 140.0
ROAD_HALF_WIDTH = 1.0
GRAVEL_EDGE = 0.55        # top-speed fraction with a wheel on the dirt
GRAVEL_GRIP = 0.24        # ... and out in the deep stuff by the wall
GRAVEL_STEER = 0.55       # steering authority left out on the loose stuff:
                          # the sand slows you, it does not steer for you
GRAVEL_SHOULDER = 0.15    # units of dusty kerb between the racing surface and
                          # the gravel proper. The grip does not fall off a
                          # cliff at the white line: it ramps across this, so
                          # a wheel over the edge is a warning and not a trap.
WALL = 1.55
KART_LENGTH = 3.4
KART_WIDTH = 0.34
#: The longest step the physics will integrate in one go. A stalled frame is
#: a stalled frame, not a teleport through the scenery.
MAX_STEP = 0.1

# Grip fades when the kart is hot: past GRIP_PEAK of top speed the front
# tyres give up a slice of their bite per unit of speed ratio, down to the
# floor. This is why the brake exists - carry too much speed into a bend and
# the kart ploughs on toward the gravel and the wall - and why the drift
# exists: sideways, the kart keeps DRIFT_GRIP no matter how hot it is.
GRIP_PEAK = 0.62
GRIP_FALL = 2.8
GRIP_FLOOR = 0.50
DRIFT_GRIP = 0.55

#: Understeer scrub: units/s^2 bled when the front tyres are asked for MORE
#: LOCK THAN THE CORNER NEEDS while they are already hot. Not for merely being
#: fast in a bend: a kart holding exactly the lock that cancels the corner is
#: doing the one thing a driver can do, and taxing that was the physics doing
#: the lifting for the player. Pinned and wound against the stops, a kart used
#: to settle at 51.5 units/s in every curvature in the vocabulary - 83% of top
#: speed, arrived at for free, more cheaply than any human could lift for
#: themselves - which is precisely why never lifting beat driving properly.
#:
#: Excess lock is a different thing entirely: it is sawing at the wheel, or
#: winding on more steering than the front end can convert, and it costs
#: speed and buys nothing. A hairpin taken flat is no longer scrubbed back to
#: a speed it can hold - it simply runs out of road, which is a cost the
#: driver can SEE. Sideways none of it applies: a kart carries speed through a
#: corner by drifting, not by scrubbing.
SCRUB = 58.0
#: ... and the lock, beyond what the corner asks, that costs nothing at all. A
#: webcam wheel wobbles a few degrees at rest and a nervous driver saws at it;
#: neither is understeer, and a scrub with no slack in it would bill the
#: shakiest hands in the room for the privilege.
SCRUB_SLACK = 0.12


def gravel_cap(off_centre: float) -> float:
    """Top-speed fraction the loose stuff allows, by how far off you are.

    A wheel on the dirt is a warning; both wheels in the sand by the barrier
    is a race thrown away. Nothing here steps: the dusty shoulder ramps the
    cap down from racing speed at the white line to GRAVEL_EDGE a hand's
    width out, and the gravel proper takes it the rest of the way to
    GRAVEL_GRIP at the barrier. A cliff edge exactly on the line would make
    the last centimetre of road cost 45% of the cap - and turn every corner
    exit into a coin toss the driver cannot even see.
    """
    over = off_centre - ROAD_HALF_WIDTH
    if over <= 0.0:
        return 1.0
    shoulder = min(1.0, over / max(1e-6, GRAVEL_SHOULDER))
    cap = 1.0 + (GRAVEL_EDGE - 1.0) * shoulder
    deep = max(1e-6, WALL - ROAD_HALF_WIDTH - GRAVEL_SHOULDER)
    depth = max(0.0, min(1.0, (over - GRAVEL_SHOULDER) / deep))
    return cap + (GRAVEL_GRIP - GRAVEL_EDGE) * depth


def gravel_steer(off_centre: float) -> float:
    """Steering authority left, by how far off the road you are.

    The shoulder takes your speed; the gravel takes your steering. Across the
    dusty shoulder the wheel still works in full - that is the whole point of
    it, because the shoulder is where the bend is still pushing hardest, and a
    driver who has put two wheels wide must always be able to out-steer the
    corner that put them there. Only out in the sand proper, where the cap has
    already taken the speed away and the push with it, does the wheel go vague
    and the trap start holding what fell into it.
    """
    over = off_centre - ROAD_HALF_WIDTH - GRAVEL_SHOULDER
    if over <= 0.0:
        return 1.0
    deep = max(1e-6, WALL - ROAD_HALF_WIDTH - GRAVEL_SHOULDER)
    return 1.0 + (GRAVEL_STEER - 1.0) * min(1.0, over / deep)


def corner_grip(speed_ratio: float, drifting: bool = False) -> float:
    """Front-end bite, 0..1: full below GRIP_PEAK, fading above it."""
    grip = max(GRIP_FLOOR, 1.0 - GRIP_FALL * max(0.0, speed_ratio - GRIP_PEAK))
    if drifting:
        grip = max(grip, DRIFT_GRIP)
    return grip

# Drift: lift with the lock already on and the back steps out - more slide,
# more bite, a little speed bled all the while - then straighten cleanly and
# the exhaust pays you back. The brake does the same thing harder, which is
# what makes a hairpin a thing you attack rather than survive. The boost is
# earned, not showered: the hold clock starts when the slide does, staying
# sideways through the whole corner pays better than snatching it, and a
# fresh boost needs the cooldown spent.
#
# Every gate below is set where a WEBCAM wheel can actually reach it. Full
# lock is 50 degrees of forearm roll, and the smoothing eats the last few of
# those, so a gate at 0.9 of lock is a gate pinned against the stops: it asks
# the player to hold a position they cannot feel for four tenths of a second.
# DRIFT_STEER sits at four fifths instead - about 41 degrees - and the exit
# gate is loose enough that unwinding to a comfortable half lock banks the
# boost. Reachable is not the same as automatic, though, which is what the
# lift is for: a corner taken at its limit needs nine tenths of lock anyway,
# so the wheel alone cannot be the whole gate without handing the mechanic to
# anyone whose hands shake.
DRIFT_STEER = 0.78        # |steer| beyond this arms the drift
DRIFT_EXIT = 0.45         # |steer| below this straightens out of it
DRIFT_SPEED = 0.58        # top-speed fraction needed to break loose
DRIFT_LIFT = 0.75         # throttle at or below this is a lift: the weight
                          # goes forward, and with the lock on the back end
                          # follows it round. Full throttle keeps the kart
                          # planted however hard the wheel is turned.
DRIFT_ENGAGE = 0.35       # seconds the lock must be held before it breaks
DRIFT_BRAKE_SNAP = 6.0    # how much faster the lock breaks loose under braking
DRIFT_HOLD = 0.90         # seconds actually sideways that earn the exit boost
DRIFT_LONG = 1.80         # ... and the seconds that earn the long one
DRIFT_SLIDE = 1.02        # lateral rate multiplier while drifting. It buys a
                          # sliver more rotation than gripping does and no
                          # more, because the drift is PAID FOR BY THE BOOST
                          # at the end of it, never by better cornering. At
                          # 1.45 it multiplied a floor of DRIFT_GRIP the
                          # gripping kart never gets, so being sideways was
                          # worth +160% lateral authority AND exemption from
                          # the steering scrub: measured, holding a slide
                          # through every bend beat gripping by 14 s a race
                          # (8.5%). When "never stop sliding" is the fastest
                          # line, the drift stops being a decision, and any
                          # input noisy enough to trip the gate is rewarded
                          # for being noisy - the exact opposite of a skill.
DRIFT_COST = 4.2          # units/s^2 bled while sideways. Sideways is a way
                          # round a corner AND a wager: hold it, straighten
                          # cleanly, and the exhaust pays you back more than
                          # it cost. Botch the exit and you simply went slower,
                          # which is what makes taking the slide a decision.
BOOST_SECONDS = 0.9
BOOST_LONG_SECONDS = 2.0  # what the long slide is worth: the whole point of
                          # staying sideways through a corner instead of
                          # snatching the first boost the exhaust offers
BOOST_KICK = 34.0         # units/s^2 of extra shove while boosting: a surge
                          # that keeps pulling for most of the boost, not a
                          # step change that hits the ceiling and waits there
BOOST_TOP = 1.25          # top-speed fraction a boost may reach. The kick
                          # needs somewhere to GO: at a 10% ceiling it spent
                          # five sixths of the boost pinned against the
                          # limiter, which is a firework, not an overtake.
BOOST_COOLDOWN = 2.0      # seconds before the exhaust will pay out again. At
                          # three, nearly half of every slide a driver banked
                          # paid nothing at all - twelve or thirteen skids a
                          # race and seven boosts - which is a mechanic that
                          # teaches the player it is random. Two seconds is
                          # still long enough that a corner cannot be strung
                          # into a permanent boost, and short enough that a
                          # driver who does the work is paid for the work.


def sane(value: float, low: float, high: float, default: float = 0.0) -> float:
    """Clamp anything the outside world hands the physics into a real number.

    The steering comes from a camera and the timestep from a wall clock;
    neither is above producing a NaN, an infinity or a negative frame. One
    poisoned value must not be able to put a kart somewhere that cannot be
    drawn, ranked or recovered from.
    """
    if value is None:
        return default
    try:
        value = float(value)
    except (TypeError, ValueError):
        return default
    if not math.isfinite(value):
        return default
    return max(low, min(high, value))


@dataclass
class Kart:
    """One kart on the circuit, human or otherwise."""

    s: float = 0.0
    x: float = 0.0
    v: float = 0.0
    lap: int = 0
    steer: float = 0.0
    hue: int = 0
    name: str = "you"
    finished_at: float | None = None
    #: The AI's character; the player's kart ignores these. ``pace`` scales
    #: the kart's own top speed, so the grid's spread stays that spread on the
    #: straights instead of washing out in the throttle curve.
    line_bias: float = 0.0
    pace: float = 1.0
    top_speed: float = TOP_SPEED
    #: Drift state: sideways right now, how long, and boost seconds left.
    drifting: bool = False
    drift_time: float = 0.0
    boost: float = 0.0
    boost_cooldown: float = 0.0
    on_wall: bool = False
    #: Seconds before contact may slow this kart again: one shunt is a shunt,
    #: a train grinding on itself must not multiply the penalty every frame.
    bump_cooldown: float = 0.0

    @property
    def progress(self) -> float:
        return self.lap * 1e6 + self.s

    def _drift(self, dt: float, steer: float, brake: bool = False,
               throttle: float = 1.0) -> None:
        """Arm, hold and exit the drift; a long, clean exit banks a boost.

        Two tiers, so the drift is a decision and not a reflex: hold the slide
        through the corner and the exhaust pays properly, snatch it early and
        it pays the short one - and either way the cooldown is spent.

        The back end does not step out just because the wheel is turned. It
        steps out on a WEIGHT TRANSFER - the brake, or the throttle coming
        off - with the lock already on. That matters more than it sounds:
        taking a hairpin at its limit needs nine tenths of lock anyway, so a
        gate made of steering angle alone would hand a drift, and the boost
        behind it, to every kart that merely went round the corner quickly,
        including one whose hands are simply shaking. Lift-and-turn is an act.
        Once the slide has started the throttle is welcome again: it is what
        holds a slide, and what makes staying sideways a decision worth
        making.
        """
        loose = brake or throttle <= DRIFT_LIFT
        held = (abs(steer) > DRIFT_STEER and self.v > TOP_SPEED * DRIFT_SPEED
                and loose)
        if not self.drifting:
            if held:
                # Braking with the lock already on throws the weight forward
                # and the back straight out: the classic way into a hairpin.
                self.drift_time += dt * (DRIFT_BRAKE_SNAP if brake else 1.0)
                if self.drift_time >= DRIFT_ENGAGE:
                    self.drifting = True
                    self.drift_time = 0.0  # the hold clock starts at the slide
            else:
                self.drift_time = 0.0
        elif abs(steer) < DRIFT_EXIT or self.v < TOP_SPEED * 0.3:
            if (self.drift_time >= DRIFT_HOLD and abs(steer) < DRIFT_EXIT
                    and self.boost_cooldown <= 0.0):
                self.boost = (BOOST_LONG_SECONDS if self.drift_time >= DRIFT_LONG
                              else BOOST_SECONDS)  # straightened out cleanly
                self.boost_cooldown = BOOST_COOLDOWN
            self.drifting = False
            self.drift_time = 0.0
        else:
            self.drift_time += dt
            self.v = max(TOP_SPEED * 0.3, self.v - DRIFT_COST * dt)

    def advance(self, track: Track, dt: float, throttle: float, brake: bool,
                steer: float) -> None:
        # Nothing past this point may see a NaN, a negative frame or a lock
        # beyond the stops: the wheel is a webcam and the clock is a wall.
        dt = sane(dt, 0.0, MAX_STEP)
        throttle = sane(throttle, 0.0, 1.0)
        steer = sane(steer, -1.0, 1.0)
        top = max(1.0, sane(self.top_speed, 1.0, TOP_SPEED * 2.0, TOP_SPEED))
        self.v = sane(self.v, 0.0, top * BOOST_TOP)
        self.x = sane(self.x, -WALL, WALL)
        self.s = sane(self.s, 0.0, track.length) % track.length
        self.boost_cooldown = max(0.0, self.boost_cooldown - dt)
        self.bump_cooldown = max(0.0, self.bump_cooldown - dt)
        if brake:
            self.v = max(0.0, self.v - BRAKING * dt)
        else:
            # Throttle pushes, drag pulls, and the engine itself drags on a
            # closed throttle: three terms, so the pedal reads the same from
            # either end - squeeze and the kart goes, ease and it slows.
            self.v += (ACCELERATION * throttle * (1.0 - self.v / top)
                       - DRAG * self.v / top
                       - ENGINE_BRAKE * (1.0 - throttle) * self.v / top) * dt
            self.v = max(0.0, self.v)
        self._drift(dt, steer, brake, throttle)
        if self.boost > 0.0 and not brake:
            self.boost = max(0.0, self.boost - dt)
            self.v = min(top * BOOST_TOP, self.v + BOOST_KICK * dt)
        # Asking the front end for more lock than the corner needs costs
        # speed: the price of sawing at the wheel, or of winding on steering
        # the tyres cannot convert. The lock the bend itself asks for is
        # free - that is the driver doing their job, and the physics must not
        # do their lifting for them.
        hot = max(0.0, self.v / TOP_SPEED - GRIP_PEAK)
        if hot > 0.0 and not self.drifting:
            needed = abs(holding_lock(track.curvature_at(self.s),
                                      self.v / TOP_SPEED))
            excess = max(0.0, abs(steer) - needed - SCRUB_SLACK)
            if excess > 0.0:
                self.v = max(0.0, self.v - SCRUB * hot * excess * dt)
        off_road = abs(self.x) > ROAD_HALF_WIDTH
        if off_road:
            cap = TOP_SPEED * gravel_cap(abs(self.x))
            if self.v > cap:
                self.v = max(cap, self.v - BRAKING * 0.8 * dt)
        self.v = max(0.0, min(top * BOOST_TOP, self.v))

        speed_ratio = self.v / TOP_SPEED
        self.steer = steer
        slide = DRIFT_SLIDE if self.drifting else 1.0
        grip = corner_grip(speed_ratio, self.drifting)
        if off_road:
            grip *= gravel_steer(abs(self.x))
        self.x += steer * STEER_RATE * slide * grip * (speed_ratio ** 0.7) * dt
        self.x -= track.curvature_at(self.s) * CENTRIFUGAL * speed_ratio ** 2 * dt
        if abs(self.x) > WALL:
            self.x = math.copysign(WALL, self.x)
            if not self.on_wall:
                self.v *= 0.55  # the wall is not your friend
            self.on_wall = True  # after the hit you scrape along, not stall:
            # the gravel under you is already doing the punishing.
        else:
            self.on_wall = False

        # The kart only ever goes forwards - there is no reverse gear on the
        # wheel - so the lap counter only ever ticks up.
        self.s += self.v * dt
        while self.s >= track.length:
            self.s -= track.length
            self.lap += 1


# Slipstream: tuck in close behind another kart on a straight and its wake
# pulls you along - worth a few percent of top speed, never more.
SLIPSTREAM_RANGE = 16.0   # units behind the leader where the tow works
SLIPSTREAM_ACCEL = 11.0   # units/s^2 at full tow
SLIPSTREAM_TOP = 1.05     # top-speed fraction a tow may reach
SLIPSTREAM_BEND = 0.002   # curvature beyond which the air is dirty anyway

# Contact: karts are rubber, not brick. What a shunt costs the kart that
# caused it, what it gives the kart that took it, and how far off line both
# end up - all scaled by how fast the gap was closing, so a brush at matched
# speed is free and only a genuine rear-ender hurts.
CONTACT_CLOSING = 0.35    # closing speed (top-speed fraction) that is "hard"
CONTACT_LOSS = 0.14       # the worst a shunt may cost the kart behind
CONTACT_SHOVE = 5.0       # units/s the punted kart in front is shoved along
CONTACT_KICK = 0.16       # lateral units the pair are knocked apart
#: Seconds between two "bump" noises, whatever it was that the player hit.
BUMP_COOLDOWN = 2.5
#: Seconds between two brake squeals. The brake is a pair of open palms and
#: the recogniser changes its mind about them; on the rising edge alone this
#: fired six times a second under brake chatter at speed, which is a rattle,
#: not a car. Every other cue in the race has a clock of its own - this one
#: was the exception.
SQUEAL_COOLDOWN = 0.9
#: The gravel is the one cue that is a BED rather than a bang: the sample runs
#: about nine tenths of a second and is built to overlap itself, so a period a
#: shade under its length lays one continuous rumble under a long excursion.
#: At 0.35 it was three overlapping copies deep - a stutter, and 256 triggers
#: in a hundred seconds of test.
GRAVEL_BED = 0.8

#: Rubber-band ceilings: the field breathes with the player, never harder
#: than these fractions - and asymmetrically. Mercy (rivals easing off when
#: the player struggles) may pull harder than the chase (rivals hurrying when
#: the player leads), so a good drive actually banks a gap instead of towing
#: the whole field to a permanent photo finish.
RUBBER_BAND = 0.035       # mercy: how much rivals ahead of the player ease off
CATCH_UP = 0.015          # chase: how much rivals behind the player hurry

#: The spread of the grid, as fractions of top speed. Wide enough that the
#: classification is a scale the player can move up and down rather than a
#: verdict decided before the lights: the tail-ender is there to be caught on
#: a first race, the pole-sitter is there to be chased for a while.
#:
#: The ceiling used to be exactly the player's own top speed, which meant a
#: grid could deal itself a kart nobody could out-run on any straight on any
#: circuit - a race decided in `__post_init__`, before the lights, and P1 was
#: out of reach on half of all seeds however well the player drove. It is
#: under one now, AND the player keeps a little in hand (PLAYER_EDGE), so the
#: top of the grid is REACHABLE on every seed. Reachable is not free: the
#: rivals lost none of their pace in the bargain - they drive better instead
#: (RIVAL_LEAN) - so a kart on the ceiling still laps within a few seconds of
#: a driver doing everything right.
RIVAL_PACE = (0.76, 0.97)
#: The player's kart against the reference kart. Three percent is not a
#: handicap the player can feel on any single corner; it is the guarantee
#: that no seed can deal a grid that is out of reach, which is a promise
#: about the WHOLE field rather than about any one straight.
PLAYER_EDGE = 1.03

#: Once the last rival has taken the flag, this is how long the road stays
#: open for a driver still out there. After it, they are classified where they
#: stand - because a race that cannot END is not a race, and a player who
#: parks (or holds the brake, or walks away from the camera) must still get a
#: podium instead of a screen that never changes.
LAST_CAR_GRACE = 25.0
#: ... and the hard stop, measured from the lights. Nothing may run longer.
RACE_LIMIT = 600.0


def slipstream_pull(kart: Kart, others: list[Kart], track: Track) -> float:
    """How much tow this kart gets, 0..1: close behind someone, on a straight.

    Measured against the kart's OWN top speed, so the tow is worth the same
    few percent to everyone. A ceiling in absolute units would quietly hand
    the slowest kart on the grid the biggest gift on the field.
    """
    if abs(track.curvature_at(kart.s)) > SLIPSTREAM_BEND:
        return 0.0
    if kart.v < kart.top_speed * 0.4:
        return 0.0
    pull = 0.0
    for other in others:
        if other is kart:
            continue
        gap = (other.s - kart.s) % track.length
        if KART_LENGTH * 0.8 < gap < SLIPSTREAM_RANGE \
                and abs(other.x - kart.x) < 0.45:
            pull = max(pull, 1.0 - gap / SLIPSTREAM_RANGE)
    return pull


def progress_gap(leader: Kart, chaser: Kart, track: Track) -> float:
    """How far ``leader`` is ahead of ``chaser``, in physical track units.

    Laps are worth exactly one track length each, so a five-unit gap across
    the start line is still five units - not a saturated lap counter.
    """
    return (leader.lap - chaser.lap) * track.length + leader.s - chaser.s


def rubber_band(gap: float) -> float:
    """Pace factor for a rival ``gap`` track units behind the player (ahead
    if negative). Smooth, capped well inside 8% both ways, and gentler on
    the chase than on the mercy so a strong drive still opens a real gap."""
    band = CATCH_UP if gap >= 0.0 else RUBBER_BAND
    return 1.0 + band * math.tanh(gap / 260.0)


#: How hard the AI leans on `cornering_speed` - which is already a hair under
#: the balance point (CORNER_SAFE), and is read off the MEAN curvature of the
#: next sixty units, so a rival that took it literally would brake for the
#: straight half of every corner entry and never use the road on the way out.
#: A few percent over is a racing driver using the whole width; much more and
#: the field would spend the race in the gravel.
RIVAL_LEAN = 1.12
#: How hard a rival pulls back to its chosen line. Enough to hold a line
#: through a bend, not so much that it saws at the wheel: steering the front
#: tyres past what the corner asks scrubs speed off the kart doing it (SCRUB),
#: and a rival that fought its own steering all lap would be a rival the
#: player beats by default rather than by driving.
LINE_GAIN = 1.5

#: How much of the true balance speed a driver is told a corner is worth. A
#: hair under one, because the balance point itself is a knife edge: at it the
#: kart holds the bend only at full lock, with nothing left for the wobble.
CORNER_SAFE = 0.97


def cornering_speed(curvature: float) -> float:
    """The speed above which full lock can no longer hold this bend.

    Honours the grip fade: walks speed ratios down in fine steps until the
    front end out-pulls the centrifugal push, then backs off CORNER_SAFE. It
    is the honest number, and it has to be - the AI brakes to it, and a limit
    set well under the truth would have the whole field crawling round corners
    it could take.

    It is NOT what the circuit generator counts teeth with, and used to be:
    this is the speed above which a bend cannot be held, not the speed a kart
    on this circuit actually carries into it. A corner stamped a tooth at 45.7
    while a flat-out kart went through it at 51.5 was a corner certified
    against a driver nobody was. See `flat_out_reach`.
    """
    push = CENTRIFUGAL * abs(curvature)
    if push < 1e-3:
        return TOP_SPEED * 1.1
    for i in range(110, 34, -1):
        ratio = i / 100.0
        if STEER_RATE * corner_grip(ratio) * ratio ** 0.7 >= push * ratio * ratio:
            return TOP_SPEED * ratio * CORNER_SAFE
    return TOP_SPEED * 0.35


def holding_lock(curvature: float, speed_ratio: float) -> float:
    """The steering that exactly cancels this bend at this speed, -1..1.

    The wheel position a driver settles on mid-corner - and the reference the
    understeer scrub is measured against, since asking the front tyres for
    exactly this much is the driver doing their job and asking for more is
    sawing at the wheel. Signed with the bend:
    positive curvature bends right and pushes the kart to -x, so it wants
    positive lock. Beyond +-1 the corner is simply too fast for the tyres.
    """
    ratio = max(0.05, speed_ratio)
    hold = STEER_RATE * corner_grip(ratio) * ratio ** 0.7
    want = CENTRIFUGAL * curvature * ratio ** 2
    return max(-1.0, min(1.0, want / hold))


def lateral_margin(curvature: float, speed_ratio: float = 1.0) -> float:
    """Seconds a corner takes to push a kart from the crown to the edge.

    The phase margin of the whole game. The player's wheel is a camera: what
    they do now arrives a fifth of a second late, wobbles a few degrees on the
    way, and drops out entirely now and then. A corner that can carry a kart
    off the road inside a second is therefore not a corner a human being can
    drive - the correction always arrives after the mistake it was meant to
    prevent. So the tightest bend in the vocabulary, taken flat out with the
    wheel wound the WRONG way, must still leave the driver seconds to notice.
    Returns infinity when full lock simply out-pulls the bend.
    """
    push = CENTRIFUGAL * abs(curvature) * speed_ratio ** 2
    hold = (STEER_RATE * corner_grip(speed_ratio) * speed_ratio ** 0.7)
    if push <= hold:
        return float("inf")
    return ROAD_HALF_WIDTH / (push - hold)


def engine_period(v: float) -> float:
    """Seconds between engine cues: idle putters, top speed screams."""
    return 0.72 - 0.42 * max(0.0, min(1.0, v / TOP_SPEED))


def rank_key(kart: Kart) -> tuple[int, float, float]:
    """Sort key for the classification: the flag first, the road after.

    A kart that has taken the flag is placed by WHEN it took it - the only
    honest order, since every finisher is frozen a random sliver past the
    line. Karts still running are placed behind every finisher, by distance.
    """
    if kart.finished_at is not None:
        return (0, kart.finished_at, -kart.progress)
    return (1, 0.0, -kart.progress)


def crossed_at(kart: Kart, now: float, dt: float) -> float:
    """When the kart actually crossed the line, inside this frame.

    Two karts that take the flag on the same frame are not a dead heat: the
    one that overshot the line by more got there first. Without this the
    classification would be decided by the frame boundary.
    """
    if kart.v <= 1e-6:
        return now
    return now - min(max(0.0, dt), kart.s / kart.v)


@dataclass
class RaceRound:
    """A race: the player, the field, the laps and the clock.

    Reuses the Round options plumbing so the registry can build it like any
    map, but scoring is a podium, not targets: `summary()` never runs here -
    the drive loop shows its own results.
    """

    options: RoundOptions
    laps: int = 3
    rivals: int = 5

    seed: int = field(init=False, default=0)
    track: Track = field(init=False)
    player: Kart = field(init=False)
    field_: list[Kart] = field(init=False)
    started_at: float | None = field(default=None, init=False)
    countdown_from: float | None = field(default=None, init=False)
    lap_times: list[float] = field(default_factory=list, init=False)
    _lap_started: float | None = field(default=None, init=False)
    cues: list[str] = field(default_factory=list, init=False)
    _countdown_sec: int | None = field(default=None, init=False)
    _engine_next: float = field(default=0.0, init=False)
    _gravel_next: float = field(default=0.0, init=False)
    _skid_next: float = field(default=0.0, init=False)
    _squeal_next: float = field(default=0.0, init=False)
    _bump_next: float = field(default=0.0, init=False)
    _was_braking: bool = field(default=False, init=False)
    _was_drifting: bool = field(default=False, init=False)
    _was_on_wall: bool = field(default=False, init=False)
    _flag_at: float | None = field(default=None, init=False)
    #: True when the player was classified where they stood rather than
    #: crossing the line themselves - the chequered flag, waved at the road.
    flagged_off: bool = field(default=False, init=False)

    COUNTDOWN = 3.0

    @property
    def area(self):
        return self.options.area

    @property
    def duration(self):
        return None  # a race ends on the finish line, not a clock

    def __post_init__(self) -> None:
        import random

        # One seed decides both the circuit and the grid, so --seed really
        # does reproduce a race - and seed 0 is a seed like any other, where
        # `or` would quietly send it to circuit 7. Asking for no seed at all
        # draws a fresh circuit every race rather than the same one forever.
        seed = self.options.seed
        if seed is None:
            seed = random.Random().randrange(1_000_000)
        rng = random.Random(seed)
        self.seed = seed
        self.track = build_track(seed)
        self.player = Kart(s=0.0, x=0.35, hue=0, name="you",
                           top_speed=TOP_SPEED * PLAYER_EDGE)
        # The grid is drawn fresh each race - never a procession by number -
        # and pace scales each rival's own top speed, so the quick ones are
        # genuinely quick down the straights.
        slots = list(range(self.rivals))
        rng.shuffle(slots)
        self.field_ = []
        for i, slot in enumerate(slots):
            # A LADDER, not a peloton. A field packed inside ten percent of
            # itself finishes in a bunch a dozen seconds long, which is
            # narrower than the gap between a good driver and a bad one - so
            # every human being alive lands in the same position and the
            # result stops being about driving. Spread across a quarter and
            # the grid becomes something a player climbs a rung at a time.
            pace = rng.uniform(RIVAL_PACE[0], RIVAL_PACE[1])
            self.field_.append(Kart(
                s=8.0 + 7.5 * slot,
                x=(-0.55 if slot % 2 else 0.55) * (0.4 + 0.1 * slot),
                hue=40 + i * 36, name=f"rival {i + 1}",
                line_bias=rng.uniform(-0.25, 0.25), pace=pace,
                top_speed=TOP_SPEED * pace))

    # --- race state --------------------------------------------------------

    def begin(self, now: float, wheel: Wheel | None = None) -> None:
        """Start the countdown - once both hands are actually on the wheel.

        The countdown is the wheel's whole calibration: the player sits gripped
        and ready through it, and however they hold the wheel in those seconds
        becomes straight-ahead. Starting it before the hands arrive would
        calibrate against an empty chair.
        """
        if self.countdown_from is None and (wheel is None or wheel.hands == 2):
            self.countdown_from = now

    @property
    def waiting_for_hands(self) -> bool:
        return self.countdown_from is None

    def countdown(self, now: float) -> float | None:
        """Seconds until GO, or None once racing."""
        if self.countdown_from is None:
            return self.COUNTDOWN
        left = self.COUNTDOWN - (now - self.countdown_from)
        return left if left > 0 else None

    @property
    def racing(self) -> bool:
        return self.started_at is not None

    def everyone(self) -> list[Kart]:
        return [self.player, *self.field_]

    def position(self) -> int:
        """Where the player is classified, flag-takers first."""
        mine = rank_key(self.player)
        return 1 + sum(1 for kart in self.field_ if rank_key(kart) < mine)

    @property
    def finished(self) -> bool:
        return self.player.finished_at is not None

    def update(self, now: float, dt: float, wheel: Wheel) -> None:
        dt = sane(dt, 0.0, MAX_STEP)
        self.begin(now, wheel)
        if self.countdown_from is None:
            return  # the grid is quiet until both hands take the wheel
        left = self.countdown(now)
        if left is not None:
            sec = math.ceil(left - 1e-9)
            if sec != self._countdown_sec and 0 < sec <= self.COUNTDOWN:
                self._countdown_sec = sec
                self.cues.append("countdown_beep")
            return
        if self.started_at is None:
            self.started_at = now
            self._lap_started = now
            self.cues.append("race_go")

        lap_before = self.player.lap
        if not self.finished:
            # The hands are the pedal; a wheel nobody is holding coasts.
            throttle = (sane(wheel.throttle, 0.0, 1.0, 1.0)
                        if wheel.tracking else 0.4)
            if wheel.brake and not self._was_braking \
                    and self.player.v > TOP_SPEED * 0.5 \
                    and now >= self._squeal_next:
                self.cues.append("brake_squeal")
                self._squeal_next = now + SQUEAL_COOLDOWN
            self._was_braking = wheel.brake
            self.player.advance(self.track, dt, throttle, wheel.brake, wheel.steer)
            self._player_cues(now)
        if self.player.lap > lap_before:
            crossed = crossed_at(self.player, now, dt)
            self.lap_times.append(crossed - self._lap_started)
            self._lap_started = crossed
            if self.player.lap >= self.laps:
                self.player.finished_at = crossed
                self.cues.append("race_finish")
                self.cues.append("crowd")
            else:
                self.cues.append("lap_chime")

        self._advance_rivals(now, dt)
        self._slipstream(dt)
        self._collide(now)
        self._wave_the_flag(now)

    def _wave_the_flag(self, now: float) -> None:
        """End the race even for a driver who has stopped driving.

        A player holding the brake - or one who has wandered out of shot - can
        otherwise sit at a standstill forever while the field laps around
        them: `finished` never turns true, the podium never appears, and the
        only way out of the game is the keyboard. So the flag is waved AT THE
        ROAD. Once the last rival is home, the stragglers get a grace to bring
        it in; after that (or after RACE_LIMIT, whichever finds them first)
        they are classified where they stand, which is last, and shown the
        podium like everyone else.
        """
        if self.player.finished_at is not None or self.started_at is None:
            return
        if self._flag_at is None:
            if all(kart.finished_at is not None for kart in self.field_):
                self._flag_at = now + LAST_CAR_GRACE
            elif now - self.started_at >= RACE_LIMIT:
                self._flag_at = now
        if self._flag_at is not None and now >= self._flag_at:
            self.player.finished_at = now
            self.flagged_off = True
            self.cues.append("race_finish")
            self.cues.append("crowd")

    def _player_cues(self, now: float) -> None:
        """Engine cadence, gravel and skid: the kart heard, not seen."""
        kart = self.player
        if now >= self._engine_next:
            ratio = kart.v / TOP_SPEED
            self.cues.append("engine_low" if ratio < 0.35 else
                             "engine_mid" if ratio < 0.75 else "engine_high")
            self._engine_next = now + engine_period(kart.v)
        if abs(kart.x) > ROAD_HALF_WIDTH and kart.v > 4.0 \
                and now >= self._gravel_next:
            self.cues.append("gravel")
            self._gravel_next = now + GRAVEL_BED
        if kart.drifting and not self._was_drifting and now >= self._skid_next:
            self.cues.append("skid")
            self._skid_next = now + 2.0
        self._was_drifting = kart.drifting
        # A kart scraping along the barrier crosses in and out of contact
        # several times a second, so an edge on `on_wall` alone is a drum
        # roll, not a bump. Contact with the wall and contact with another
        # kart are the same noise and share the same clock.
        if kart.on_wall and not self._was_on_wall and now >= self._bump_next:
            self.cues.append("bump")  # a 45% speed loss deserves a noise
            self._bump_next = now + BUMP_COOLDOWN
        self._was_on_wall = kart.on_wall

    def _advance_rivals(self, now: float, dt: float) -> None:
        karts = self.everyone()
        for kart in self.field_:
            if kart.finished_at is not None:
                continue
            ahead = self.track.curvature_ahead(kart.s, 60.0)
            # Hug the INSIDE of what is coming: a bend pushes a kart to the
            # outside, so the inside kerb is where the whole width of the
            # road is still in front of you. (Positive curvature bends right
            # and pushes the kart toward -x, so the inside is +x.)
            target_x = max(-0.8, min(0.8, ahead * 150.0 + kart.line_bias))
            throttle_scale = 1.0

            leader, gap = self._nearest_ahead(kart, karts)
            if leader is not None and gap < 24.0:
                quicker = kart.top_speed > leader.top_speed + 0.4
                if (abs(ahead) < SLIPSTREAM_BEND or quicker) \
                        and kart.v >= leader.v - 1.5:
                    # A straight - or genuinely more pace: commit to a
                    # passing line a clear kart-width off the leader's,
                    # instead of parking in - or grinding through - the wake.
                    side = -1.0 if leader.x >= 0.0 else 1.0
                    target_x = max(-0.9, min(0.9, leader.x + side * 0.8))
                elif gap < 12.0:
                    # Corner traffic: hold station and offset, don't pile in.
                    throttle_scale = max(0.5, (gap - KART_LENGTH) / 9.0)
                    dodge = 0.45 if kart.x >= leader.x else -0.45
                    target_x = max(-0.9, min(0.9, target_x + dodge))

            # Feed-forward, solved rather than guessed: exactly the lock that
            # cancels this bend at this speed, so a rival holds its line
            # instead of sawing at the wheel - and does not sit pinned against
            # the drift gate all the way round a gentle sweeper.
            steer = max(-1.0, min(1.0, (target_x - kart.x) * LINE_GAIN
                                  + holding_lock(self.track.curvature_at(kart.s),
                                                 kart.v / TOP_SPEED)))
            limit = cornering_speed(ahead) * RIVAL_LEAN
            # Rivals drive the same game the player does: they trail the
            # throttle into a corner rather than stamping on a switch, which
            # is what lets the back end go and earns them the same exhaust
            # boost on the way out. A field that could not drift would be a
            # field the player walks away from by using the one mechanic it
            # was denied.
            if kart.v > limit:
                # Over the limit: ease off in proportion to how much speed
                # there is to lose, which is what the pedal is FOR now that a
                # closed throttle actually slows the kart. A rival that
                # stamped the pedal to the floor and off again would be
                # driving a different game from the player.
                throttle_scale = min(throttle_scale, max(
                    0.0, 1.0 - (kart.v - limit) / (TOP_SPEED * 0.10)))
            elif kart.v > limit * 0.88 and abs(ahead) > 0.004:
                throttle_scale = min(throttle_scale, DRIFT_LIFT - 0.05)

            # A hairpin is ATTACKED, the same way the player is meant to
            # attack one: lift with the lock already on, let the back step
            # out, hold it, then unwind and take the exhaust's money. This is
            # not decoration - a field that never slid would leave the one
            # mechanic with a skill ceiling entirely undemonstrated, and the
            # only place a player can learn what a drift looks like is by
            # watching one go past.
            hairpin = abs(ahead) > 0.007 and kart.v > TOP_SPEED * DRIFT_SPEED
            if hairpin and not kart.drifting:
                steer = math.copysign(max(abs(steer), DRIFT_STEER + 0.06), ahead)
                throttle_scale = min(throttle_scale, DRIFT_LIFT - 0.05)
            elif kart.drifting and abs(ahead) < 0.004:
                steer = math.copysign(min(abs(steer), DRIFT_EXIT - 0.05), steer)

            rubber = rubber_band(progress_gap(self.player, kart, self.track))
            kart.top_speed = TOP_SPEED * kart.pace * rubber
            brake = kart.v > limit * 1.12  # the lift first, the brake only
            #                                when the lift is not enough
            if leader is not None and gap < 9.0 and kart.v > leader.v + 3.0 \
                    and abs(kart.x - leader.x) < 0.5:
                brake = True  # closing fast on a bumper: lift, don't ram
            kart.advance(self.track, dt, min(throttle_scale, 1.0), brake, steer)
            if kart.lap >= self.laps and kart.finished_at is None:
                kart.finished_at = crossed_at(kart, now, dt)

    def _nearest_ahead(self, kart: Kart, karts: list[Kart]) \
            -> tuple[Kart | None, float]:
        best, best_gap = None, float("inf")
        for other in karts:
            if other is kart or other.finished_at is not None:
                continue
            gap = (other.s - kart.s) % self.track.length
            if 0.0 < gap < best_gap:
                best, best_gap = other, gap
        return best, best_gap

    def _slipstream(self, dt: float) -> None:
        # A kart over the line is out of the race and out of the air.
        karts = [k for k in self.everyone() if k.finished_at is None]
        for kart in karts:
            cap = kart.top_speed * SLIPSTREAM_TOP
            pull = slipstream_pull(kart, karts, self.track)
            if pull > 0.0 and kart.v < cap:
                kart.v = min(cap, kart.v + SLIPSTREAM_ACCEL * pull * dt)

    def _collide(self, now: float) -> None:
        """Karts touching: a shove, never a stop.

        Two karts in the same piece of road push each other apart, and the one
        that ran into the back of the other pays for it - in proportion to how
        hard it arrived. A brush at matched speed costs almost nothing; a
        proper rear-ender loses CONTACT_LOSS and kicks both cars off line,
        while the kart in front is punted up the road instead of being turned
        into a wall. Nobody is ever stopped by contact alone.
        """
        # Finished karts are ghosts: the player parked on the line must not
        # become a wall for everyone still racing.
        karts = [k for k in self.everyone() if k.finished_at is None]
        for i, a in enumerate(karts):
            for b in karts[i + 1:]:
                gap_s = (a.s - b.s + self.track.length / 2) % self.track.length \
                    - self.track.length / 2
                if abs(gap_s) >= KART_LENGTH or abs(a.x - b.x) >= KART_WIDTH * 2:
                    continue
                push = KART_WIDTH * 2 - abs(a.x - b.x)
                sign = 1.0 if a.x >= b.x else -1.0
                a.x += sign * push / 2
                b.x -= sign * push / 2
                behind, front = (a, b) if gap_s < 0 else (b, a)
                if behind.bump_cooldown <= 0.0:
                    # One shunt per contact: sustained grinding in a train
                    # must not compound the penalty every single frame.
                    force = min(1.0, max(0.0, behind.v - front.v)
                                / (TOP_SPEED * CONTACT_CLOSING))
                    behind.v *= 1.0 - CONTACT_LOSS * force
                    front.v = min(front.top_speed * BOOST_TOP,
                                  front.v + CONTACT_SHOVE * force)
                    away = 1.0 if behind.x >= front.x else -1.0
                    behind.x = max(-WALL, min(WALL, behind.x
                                              + away * CONTACT_KICK * force))
                    front.x = max(-WALL, min(WALL, front.x
                                             - away * CONTACT_KICK * 0.5 * force))
                    behind.bump_cooldown = 0.9
                if (a is self.player or b is self.player) \
                        and now >= self._bump_next:
                    self.cues.append("bump")
                    self._bump_next = now + BUMP_COOLDOWN

    def result_line(self) -> str:
        """A race reports where it finished, not how many targets it hit."""
        position = next((index for index, kart in enumerate(self.standings(),
                                                            start=1)
                         if kart is self.player), len(self.everyone()))
        best = self.best_lap()
        lap = f", best lap {best:.1f} s" if best is not None else ""
        laps = f"{self.player.lap}/{self.laps} laps"
        return (f"P{position} of {len(self.everyone())}, {laps}{lap}"
                if self.finished else f"retired at {laps}{lap}")

    def take_cues(self) -> list[str]:
        cues, self.cues = self.cues, []
        return cues

    def standings(self) -> list[Kart]:
        """The classification: who has finished, then who is where."""
        return sorted(self.everyone(), key=rank_key)

    def best_lap(self) -> float | None:
        return min(self.lap_times) if self.lap_times else None


# --- the loop ----------------------------------------------------------------

#: Seconds the podium is the player's before any gesture can leave it. A race
#: ends with a classification worth reading, not a screen that flashes past
#: the moment the driver relaxes their arms.
RESULTS_DWELL = 1.5

#: Seconds after GO during which a refused calibration keeps being retried.
#: A player caught mid-turn at the lights gets a second chance instead of
#: fighting a phantom pull for the whole race.
RECALIBRATE = 2.5


def drive(captures, canvas, settings, layout, chosen, sounds,
          scores=None) -> tuple[RaceRound, str]:
    """The race itself: read the wheel, run the physics, draw, repeat.

    Mirrors app.play()'s contract - returns (round, reason) with the reasons
    the session loop already understands. Uses its own two-hand recogniser:
    the aiming schemes track a single hand, and a wheel needs both.
    """
    import time

    import cv2

    from . import scene
    from .app import _QUIT_KEYS, WINDOW_TITLE, Mouse, new_round, window_closed
    from .maps import kart as kart_art
    from .models import ensure_model
    from .recognition import GestureStream

    round_ = new_round(settings, layout, chosen)
    # The wheel is read from the picture, so it has to know which way round
    # the picture is: --no-mirror reverses left and right, and an inverted
    # wheel is not a wheel.
    wheel_reader = WheelController(mirrored=settings.mirror)
    mouse = Mouse()
    cv2.setMouseCallback(WINDOW_TITLE, mouse.on_event)

    with GestureStream(ensure_model("gesture_recognizer"), max_hands=2) as stream:
        last = time.monotonic()
        wheel = Wheel()
        showing_results = False
        results_since = 0.0
        restart_armed = False
        calibrated = False
        give_up_at: float | None = None
        neutral_rolls: list[float] = []
        while True:
            ok, image = captures[0].read()
            if not ok:
                return round_, "quit"
            if settings.mirror:
                image = cv2.flip(image, 1)
            stream.submit(image)
            frame = stream.latest()

            now = time.monotonic()
            dt = min(now - last, MAX_STEP)
            last = now
            # The recogniser runs behind this loop and hands out the same
            # result for several frames; it is one reading, not several.
            wheel = wheel_reader.update(list(frame.hands), now,
                                        reading=frame.timestamp_ms)

            if not showing_results:
                round_.update(now, dt, wheel)
                # The countdown doubles as the wheel's calibration: gather how
                # the player is actually holding it, and make that zero at GO.
                # A grip too far off level to believe is refused - so keep
                # asking for a moment after the lights rather than leaving the
                # player fighting a pull they never asked for.
                if wheel.hands == 2 and not calibrated:
                    neutral_rolls.append(wheel.roll)
                    del neutral_rolls[:-45]   # the last second or so of grip
                if round_.countdown(now) is None and not calibrated:
                    if give_up_at is None:
                        give_up_at = now + RECALIBRATE
                    last_word = now >= give_up_at
                    calibrated = wheel_reader.set_neutral(neutral_rolls,
                                                          clamp=last_word)
                    if calibrated or last_word:
                        calibrated, neutral_rolls = True, []
                for cue in round_.take_cues():
                    sounds.play_named(cue)
                chosen.draw_world(canvas, round_, now)
                kart_art.draw_hud(canvas, round_, wheel, now, layout.scale)
                inset = scene.inset_slots(layout.inset, 1)[0]
                scene.draw_camera_inset(canvas, image, frame, inset,
                                        state=scene.FUSED if wheel.tracking
                                        else scene.NO_HAND, scale=layout.scale)
                if round_.finished:
                    showing_results = True
                    results_since = now
                    restart_armed = False
                    if scores is not None:
                        points = 20 * (len(round_.everyone()) - round_.position() + 1)
                        scores.record(chosen.key, None, points)
            else:
                # The player is parked but the race is not: keep the rivals
                # lapping under the results so the podium below P-you settles
                # honestly instead of freezing mid-corner.
                round_.update(now, dt, wheel)
                round_.take_cues()  # their engines, not the player's: unheard
                kart_art.draw_results(canvas, round_, layout.scale)
                # Open both hands, THEN close them, to race again: the whole
                # two-step, so neither a driver who crossed the line braking
                # nor one who simply relaxed their arms can wipe the podium
                # away - and not before the classification has been readable
                # for a moment either.
                if now - results_since >= RESULTS_DWELL and wheel.hands == 2:
                    if wheel.brake:
                        restart_armed = True
                    elif restart_armed:
                        return round_, "again"

            cv2.imshow(WINDOW_TITLE, canvas)
            key = cv2.waitKey(1) & 0xFF
            if key in _QUIT_KEYS or window_closed():
                return round_, "quit"
            if key == ord("b"):
                return round_, "maps"
            if key == ord("r"):
                return round_, "again"
            if mouse.take_click():
                if layout.quit_button.contains(mouse.x, mouse.y):
                    return round_, "quit"
                if layout.maps_button.contains(mouse.x, mouse.y):
                    return round_, "maps"
