"""The bridge to High Noon's character library, imported read-only.

charlib (art/western/characters/charlib) is the pipeline every Handy person
is made with: signed-distance sculpts in numpy, ring-built garments, the
analytic atlas baker, bone-heat skinning on a proxy, the shared humanoid
armature and its animation core. Dead of Night's people reuse all of it and
add what the dead need (deadlib): gaunt heads with separate eyeballs for the
eyeshine, grave-pale skin, torn and stained clothes, a claw of a hand, and
the shambling clips.
"""

import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
CHARS = os.path.dirname(HERE)
NIGHT = os.path.dirname(CHARS)
ART = os.path.dirname(NIGHT)
REPO = os.path.dirname(ART)
WESTERN_CHARS = os.path.join(ART, "western", "characters")
if WESTERN_CHARS not in sys.path:
    sys.path.append(WESTERN_CHARS)

import numpy as np  # noqa: E402

from charlib import sdf as S, polygonize as PG, bl, abake as AB, materials as MT, skeleton as SK  # noqa: E402,F401
from charlib import skin as SKN, anim as A, character as C, head as HD, body as BD, hands as HN  # noqa: E402,F401
from charlib import garments as G, rings as R, gear as GR, outfits as OF, paint as PT, texture as T  # noqa: E402,F401
from charlib import pipeline as PL, bake as B  # noqa: E402,F401
from charlib.texture import srgb, smoothstep, value_noise, fbm  # noqa: E402,F401
from charlib.skeleton import BONE_NAMES, JOINTS  # noqa: E402,F401


def log(*a):
    print("[night]", *a, flush=True)


def rngs(tag):
    import random
    return random.Random(f"deadofnight:{tag}")
