"""The maps you can play, and what the game needs to know about each."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

import numpy as np

from ..game import Impact, Round, RoundOptions
from . import archery, kart, orbit, sniper, western, zombies


def _ring_hit(sounds, impact: Impact) -> None:
    sounds.hit(impact.ring or 0)


def _flesh_hit(sounds, impact: Impact) -> None:
    sounds.flesh(impact.ring == 0)


@dataclass(frozen=True)
class Map:
    """One playable map: its rules, its look, and how it introduces itself."""

    key: str
    title: str
    blurb: str
    create: Callable[[RoundOptions], Round]
    draw_world: Callable[[np.ndarray, Round, float], None]
    footer: str
    draw_emblem: Callable[[np.ndarray], None]
    play_hit: Callable[..., None] = _ring_hit
    #: "shoot" runs the aiming loop; "drive" runs the kart loop with the wheel.
    mode: str = "shoot"
    draw_hud: Callable[[np.ndarray, Round, tuple[int, int], float], None] | None = None

    def score_duration(self, duration: float | None) -> float | None:
        """The round length this map's scores are filed under.

        A race is not run against the round clock - it ends when the laps do -
        so every race shares one bucket. Reading and writing must agree on
        this, or the chooser looks in a bucket nothing was ever written to and
        the card says "not yet played" however many races have been won.
        """
        return None if self.mode == "drive" else duration


RANGE = Map(
    key="range",
    title="TARGET RANGE",
    blurb="Archery faces, ten in the gold. Calm, and entirely about aim.",
    create=archery.ArcheryRound,
    draw_world=archery.draw_world,
    footer="",
    draw_emblem=archery.draw_emblem,
)

ZOMBIES = Map(
    key="zombies",
    title="DEAD OF NIGHT",
    blurb="They come up the road out of the fog. Head shots drop them; "
          "body shots only slow them down.",
    create=zombies.ZombieRound,
    draw_world=zombies.draw_world,
    draw_hud=zombies.draw_hud,
    footer="head shots kill outright   |   N change enemy (new round)",
    draw_emblem=zombies.draw_emblem,
    play_hit=_flesh_hit,
)

WESTERN = Map(
    key="western",
    title="HIGH NOON",
    blurb="A dusty main street at noon. Bottles on the rail, bandits in the doorways.",
    play_hit=lambda sounds, impact: None,  # this map voices its own hits by cue
    create=western.WesternRound,
    draw_world=western.draw_world,
    draw_emblem=western.draw_emblem,
    footer="",
)

ORBIT = Map(
    key="orbit",
    title="ORBITAL DECAY",
    blurb="Debris tumbling past the station window. Out there, nothing makes a sound.",
    play_hit=lambda sounds, impact: None,  # this map voices its own hits by cue
    create=orbit.OrbitRound,
    draw_world=orbit.draw_world,
    draw_emblem=orbit.draw_emblem,
    footer="",
)

SNIPER = Map(
    key="sniper",
    title="OVERWATCH RIDGE",
    blurb="A long valley and a rifle. Aim and fire with your hand. Eyes are also "
          "tracked: close one to scope. No eye setup needed.",
    play_hit=lambda sounds, impact: None,  # this map voices its own hits by cue
    create=sniper.SniperRound,
    draw_world=sniper.draw_world,
    draw_emblem=sniper.draw_emblem,
    draw_hud=sniper.draw_hud,
    footer="close an eye to scope in",
)

KART = Map(
    key="kart",
    title="SUNSET SPEEDWAY",
    blurb="Grip an invisible wheel with both hands and race. Open your hands "
          "to brake.",
    mode="drive",
    play_hit=lambda sounds, impact: None,
    create=lambda options: __import__("handy.karting", fromlist=["RaceRound"])
        .RaceRound(options),
    draw_world=kart.draw_world,
    draw_emblem=kart.draw_emblem,
    footer="two hands on the wheel   |   open both hands to brake",
)

MAPS: tuple[Map, ...] = (ZOMBIES, WESTERN, ORBIT, SNIPER)
DEFAULT = ZOMBIES


def keys() -> tuple[str, ...]:
    return tuple(chosen.key for chosen in MAPS)


def by_key(key: str) -> Map:
    # Range and kart remain internal engine fixtures, not game choices.
    for chosen in (*MAPS, RANGE, KART):
        if chosen.key == key:
            return chosen
    raise KeyError(f"unknown map {key!r}; try one of {', '.join(keys())}")
