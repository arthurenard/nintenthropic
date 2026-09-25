"""The maps you can play, and what the game needs to know about each."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

import numpy as np

from ..game import Impact, Round, RoundOptions
from . import archery, orbit, sniper, western, zombies


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
    draw_hud: Callable[[np.ndarray, Round, tuple[int, int], float], None] | None = None


RANGE = Map(
    key="range",
    title="Target Range",
    blurb="Archery faces, ten in the gold. Calm, and entirely about aim.",
    create=archery.ArcheryRound,
    draw_world=archery.draw_world,
    footer="",
    draw_emblem=archery.draw_emblem,
)

ZOMBIES = Map(
    key="zombies",
    title="Dead of Night",
    blurb="They come up the road out of the fog. Head shots drop them; "
          "body shots only slow them down.",
    create=zombies.ZombieRound,
    draw_world=zombies.draw_world,
    draw_hud=zombies.draw_hud,
    footer="Head shots drop them",
    draw_emblem=zombies.draw_emblem,
    play_hit=_flesh_hit,
)

WESTERN = Map(
    key="western",
    title="High Noon",
    blurb="A dusty main street at noon. Bottles on the rail, bandits in the doorways. "
          "Spare the townsfolk.",
    play_hit=lambda sounds, impact: None,  # this map voices its own hits by cue
    create=western.WesternRound,
    draw_world=western.draw_world,
    draw_emblem=western.draw_emblem,
    footer="",
)

ORBIT = Map(
    key="orbit",
    title="Orbital Decay",
    blurb="Debris tumbling past the station window. Out there, nothing makes a sound.",
    play_hit=lambda sounds, impact: None,  # this map voices its own hits by cue
    create=orbit.OrbitRound,
    draw_world=orbit.draw_world,
    draw_emblem=orbit.draw_emblem,
    footer="",
)

SNIPER = Map(
    key="sniper",
    title="Overwatch Ridge",
    blurb="A long valley and a rifle. Close one eye to look down the scope.",
    play_hit=lambda sounds, impact: None,  # this map voices its own hits by cue
    create=sniper.SniperRound,
    draw_world=sniper.draw_world,
    draw_emblem=sniper.draw_emblem,
    footer="Close one eye to scope in",
)

MAPS: tuple[Map, ...] = (ZOMBIES, WESTERN, ORBIT, SNIPER)
DEFAULT = ZOMBIES


def keys() -> tuple[str, ...]:
    return tuple(chosen.key for chosen in MAPS)


def by_key(key: str) -> Map:
    # Range is the setup warm-up and an engine fixture, not a game choice.
    for chosen in (*MAPS, RANGE):
        if chosen.key == key:
            return chosen
    raise KeyError(f"unknown map {key!r}; try one of {', '.join(keys())}")
