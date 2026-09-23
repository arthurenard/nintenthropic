"""The machinery every map shares: a clock, a score, and shots landing.

A map supplies what stands in front of the player and what a shot does to it;
everything about keeping the round is here.
"""

from __future__ import annotations

import random
from dataclasses import dataclass, field


@dataclass(frozen=True)
class Rect:
    """An axis-aligned box in window pixels."""

    x: int
    y: int
    width: int
    height: int

    @property
    def right(self) -> int:
        return self.x + self.width

    @property
    def bottom(self) -> int:
        return self.y + self.height

    @property
    def centre_x(self) -> int:
        return self.x + self.width // 2

    def contains(self, x: float, y: float) -> bool:
        return self.x <= x <= self.right and self.y <= y <= self.bottom


@dataclass(frozen=True)
class Hit:
    """What a map decided a shot was worth."""

    points: int = 0
    ring: int | None = None  # 0 is the best zone, None a miss
    label: str = ""  # shown at the point of impact, e.g. "HEADSHOT"
    perfect: bool = False

    @property
    def landed(self) -> bool:
        return self.ring is not None


MISS = Hit()


@dataclass(frozen=True)
class Impact:
    """Where a shot landed, kept around briefly so it can be drawn."""

    x: float
    y: float
    score: int
    at: float
    ring: int | None = None
    label: str = ""

    @property
    def is_hit(self) -> bool:
        return self.ring is not None


@dataclass(frozen=True)
class Summary:
    """How a round went, for the results screen and the high score table."""

    score: int
    shots: int
    hits: int
    accuracy: float
    best_streak: int
    perfect: int
    duration: float | None
    perfect_label: str = "perfect"
    outcome: str = ""  # blank when the round simply ran out of time
    #: Whether that outcome is the good one. Maps use ``outcome`` for both
    #: endings - "SURVIVED" and "OVERRUN" are both outcomes - so the card
    #: cannot tell a win from a loss by looking at the string.
    won: bool = False


@dataclass(frozen=True)
class RoundOptions:
    """The knobs a round is built with. Each map reads what it needs."""

    area: Rect
    duration: float | None = 60.0
    seed: int | None = None
    density: int = 3  # how much can stand in front of you at once
    spawn_interval: float = 1.1
    lifetime: float = 5.0
    #: How much bigger this screen is than the one the game was drawn for, so a
    #: map can keep its targets the same size relative to the play area.
    scale: float = 1.0
    enemy: str = "zombies"


@dataclass
class Round:
    """A timed round. Subclasses fill in what the player is shooting at.

    The clock runs from the first :meth:`update`, not from construction, so model
    warm-up does not eat into the round.
    """

    options: RoundOptions

    score: int = field(default=0, init=False)
    shots: int = field(default=0, init=False)
    hits: int = field(default=0, init=False)
    streak: int = field(default=0, init=False)
    best_streak: int = field(default=0, init=False)
    perfect: int = field(default=0, init=False)
    impacts: list[Impact] = field(default_factory=list, init=False)
    started_at: float | None = field(default=None, init=False)
    cues: list[str] = field(default_factory=list, init=False)

    #: Impacts older than this are forgotten.
    IMPACT_TTL = 1.4
    #: What the results card calls this map's best kind of hit.
    PERFECT_LABEL = "perfect"

    def __post_init__(self) -> None:
        #: What the world does: who comes out, and where, and when.
        self.rng = random.Random(self.options.seed)
        #: What the player's own shots set off - bullet holes, flying glass, a
        #: split rock's pieces - and anything drawn a frame at a time. Kept
        #: apart from ``rng`` because every draw from a generator moves every
        #: draw after it: a miss into the sky, or a faster machine, would
        #: otherwise change which bandit comes out next, and the same
        #: ``--seed`` would not be the same round.
        self.effects_rng = self.stream("effects")

    def stream(self, name: str) -> random.Random:
        """A generator of its own for one part of the map, seeded from the round's.

        Two timers drawing from one generator can swap turns at a different
        frame rate - both come due within one frame at thirty, in separate
        frames at sixty - so anything that runs on its own clock gets its own
        stream and cannot shift the rest.
        """
        seed = self.options.seed
        return random.Random(None if seed is None else f"{seed}:{name}")

    # --- the round ---------------------------------------------------------

    @property
    def area(self) -> Rect:
        return self.options.area

    @property
    def duration(self) -> float | None:
        return self.options.duration

    @property
    def accuracy(self) -> float:
        return self.hits / self.shots if self.shots else 0.0

    @property
    def is_lost(self) -> bool:
        """Maps you can fail override this. The range cannot be failed."""
        return False

    def elapsed(self, now: float) -> float:
        return 0.0 if self.started_at is None else now - self.started_at

    def remaining(self, now: float) -> float | None:
        """Seconds left in the round, or None when the round is endless."""
        if self.duration is None:
            return None
        return max(0.0, self.duration - self.elapsed(now))

    def is_over(self, now: float) -> bool:
        out_of_time = self.duration is not None and self.elapsed(now) >= self.duration
        return out_of_time or self.is_lost

    def outcome(self) -> str:
        """How the round ended, in two words, or blank when the clock ran out."""
        return ""

    def won(self) -> bool:
        """Whether :meth:`outcome` is the ending the player wanted.

        Maps name both endings - a night survived and a night lost both have an
        outcome - so the results card has to be told which one it is looking at
        rather than reading anything into the words.
        """
        return False

    def result_line(self) -> str:
        """One line describing how the round went, for the console on exit and
        the browser's results card. A round knows what its own numbers mean;
        the session must not."""
        return (f"{self.score} points, {self.hits}/{self.shots} hits "
                f"({self.accuracy:.0%}), best streak {self.best_streak}")

    def summary(self) -> Summary:
        return Summary(score=self.score, shots=self.shots, hits=self.hits,
                       accuracy=self.accuracy, best_streak=self.best_streak,
                       perfect=self.perfect, duration=self.duration,
                       perfect_label=self.PERFECT_LABEL, outcome=self.outcome(),
                       won=self.won())

    def update(self, now: float) -> None:
        """Advance the clock, retire old impacts, then let the map move."""
        if self.started_at is None:
            self.started_at = now  # the clock starts on the first frame
            self.begin(now)
        self.impacts = [i for i in self.impacts if now - i.at < self.IMPACT_TTL]
        if not self.is_over(now):
            self.advance(now)

    def shoot(self, x: float, y: float, now: float) -> Impact:
        """Resolve a shot and book it. Maps decide what it struck in :meth:`resolve`."""
        if self.is_over(now):
            # The trigger can go on the very frame the clock runs out or the
            # pane fails. The round is already decided, so the shot is neither
            # scored nor counted against the player's accuracy.
            return Impact(x=x, y=y, score=0, at=now)
        self.shots += 1
        hit = self.resolve(x, y, now)

        if hit.landed:
            self.score += hit.points
            self.hits += 1
            self.streak += 1
            self.best_streak = max(self.best_streak, self.streak)
            self.perfect += hit.perfect
        else:
            self.streak = 0

        impact = Impact(x=x, y=y, score=hit.points, at=now, ring=hit.ring,
                        label=hit.label)
        self.impacts.append(impact)
        return impact

    # --- for maps to fill in ----------------------------------------------

    def take_cues(self) -> list[str]:
        """Sound cues raised since the last call, e.g. ``"groan"``."""
        cues, self.cues = self.cues, []
        return cues

    def look(self, position: tuple[float, float] | None, scoped: bool) -> None:
        """Where the player is aiming this frame, 0..1 of the window, and whether
        they are looking down a scope. Maps whose view moves with the aim - a
        sniper's - read this; fixed-view maps ignore it."""

    @property
    def scoped_shot(self) -> tuple[int, int] | None:
        """Where a scoped shot lands on screen, or None if this map has no scope."""
        return None

    def begin(self, now: float) -> None:
        """The first frame: move whatever the map laid out in advance onto the clock.

        A map is built before anyone knows what the clock will read when play
        starts, and the clock the game runs on is ``time.monotonic()`` - which
        on a machine that has been up a few days reads hundreds of thousands
        of seconds, not zero. So anything a map schedules at construction ("the
        first truck at eight seconds", "these two already walking the road") is
        written in seconds from the start of the round, and shifted by ``now``
        here, once.
        """

    def advance(self, now: float) -> None:
        """Move and spawn whatever this map puts in front of the player."""

    def resolve(self, x: float, y: float, now: float) -> Hit:
        """Decide what a shot at ``(x, y)`` struck."""
        return MISS
