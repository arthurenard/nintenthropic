"""SUNSET SPEEDWAY: the kart race, drawn.

The road is projected pseudo-3D, one horizontal strip per screen row, the
curvature bending the strips as they recede - the technique every 16-bit racer
ran on, driven here by the physics in handy/karting.py. This module owns
everything the player sees; the physics module owns everything that moves.

The light is committed golden hour, played HIGH KEY: the sun sits low on the
right, the sky burns gold over tropical blue, the grass is lush and mown into
stripes, the asphalt is warm, and everything trackside throws a long shadow
off to the screen left. Everything static is built once and cached (the sky,
the track outline, the scenery list); a frame is strips, sprites and HUD
panels only.
"""

from __future__ import annotations

import math
from functools import lru_cache

import cv2
import numpy as np

from ..game import Rect
from ..karting import (
    DRIFT_HOLD,
    KART_WIDTH,
    ROAD_HALF_WIDTH,
    TOP_SPEED,
    RaceRound,
    Track,
    Wheel,
)
from ..scene import draw_figures, draw_text, figures_width, text_width

#: Where the skyline sits, as a fraction of the view height. HIGH - just under
#: a third - because a chase camera sits low behind the bumper and looks
#: slightly DOWN at the road: a horizon halfway up the frame is a helicopter
#: shot, and it leaves the middle third of the picture as open field with
#: nothing in it. Up here the tarmac fills the lower two thirds and the verge
#: furniture has somewhere to be.
HORIZON = 0.318         # fraction of the view height
NEAR_Z = 6.0            # world units ahead at the bottom screen row
DRAW_DISTANCE = 480.0
CURVE_PX = 0.205        # how many pixels one unit of curvature bends a row
#: How far the camera swings the horizon into a corner, as a fraction of the
#: frame width, at the tightest curvature the circuit builder ever lays.
YAW_PX = 0.125
#: The camera ROLLS into a corner too: this many degrees at full lock, thrown
#: as a vertical stretch of the band either side of the horizon so the skyline
#: banks instead of the whole frame being warped.
ROLL_DEG = 4.2
BAND = 10.0             # world units per light/dark stripe
#: The mow checker on the field runs at half the asphalt's beat, so the grass
#: and the tarmac do not pulse in lockstep and turn the whole frame into one
#: strobing plane.
GRASS_BAND = 5.0
#: How far ahead of its physics position the player's kart is drawn. Far
#: enough that the sprite's ground-contact row lands at ~0.87 of the screen
#: height, leaving a comfortable margin of asphalt below the hero kart -
#: still inside the front row of the grid (the first rival slot is 8 units
#: up the road), so the player still launches from behind the field.
PLAYER_SPRITE_Z = NEAR_Z * 1.30
#: A kart is drawn exactly as wide as the physics thinks it is: contact is
#: registered at ``KART_WIDTH * 2`` half-widths of centre separation, and the
#: sprite's full drawn extent (rear wheels included) is 1.28 body widths.
KART_SPRITE_W = KART_WIDTH * 2.0 / 1.28
#: A kart, nose to tail, in world units - the yardstick for 'too close to be
#: drawn one behind the other'.
KART_LENGTH = 3.0

# Palette, BGR. Golden hour played HIGH KEY - saturated, bright, joyful.
SKY_TOP = (206, 104, 52)      # tropical blue at the zenith
SKY_MID = (150, 132, 236)     # coral-magenta band
SKY_GLOW = (126, 208, 255)    # hot gold along the horizon
SUN_CORE = (226, 248, 255)
HAZE = (172, 202, 234)

GRASS_A = (62, 182, 96)    # lush, mown, sunlit
GRASS_B = (50, 160, 78)
#: The field, depth-graded: sunlit lime at the horizon where the low sun
#: grazes it, deepening to rich green toward the camera.
GRASS_HORIZON = (96, 202, 148)
GRASS_NEAR = (46, 150, 66)
#: The two asphalt values the road alternates between. Deliberately CLOSE -
#: five per cent of luminance apart, no more. A hard light/dark strobe made
#: the biggest object in the frame read as mud with stripes on it; the beat
#: of the surface belongs to the slab seams and the dashes, and the asphalt
#: itself only has to be a warm, bright, believable grey.
ROAD_A = (142, 146, 154)   # warm asphalt, sunlit
ROAD_B = (134, 138, 146)
ROAD_SEAM = (104, 110, 120)
#: The mid tone the two asphalt bands sit either side of; the gap between them
#: opens up a LITTLE with speed so the road flickers rather than scrolls.
#: The beat is a CONTINUOUS sine of world distance, never a step function -
#: quantising it per band is what put horizontal stair-steps down the tarmac.
ROAD_MID = (138.0, 142.0, 150.0)
#: How many screen rows one smooth asphalt quad covers. The colour is lerped
#: across the quad's depth, so the whole light/dark cycle arrives as ~25 steps
#: of well under one luminance level instead of two flat slabs with a seam.
ROAD_SUB = 32
#: The rubbered wheel grooves either side of the racing line, as a fraction of
#: the half width: centre offset and half thickness.
GROOVE_OFF, GROOVE_W = 0.150, 0.048
RUMBLE_A = (58, 58, 228)   # kerb red
RUMBLE_B = (246, 249, 252)  # kerb white
#: The run-off apron outside the kerb: pale sealed gravel, warm in the low
#: sun. Every real circuit has one, and it is what stops the frame reading
#: as half racetrack and half lawn.
APRON = (150, 172, 196)
#: The green half of the green-and-white run-off banding painted on the apron
#: outboard of the kerb. Circuit-standard, and the thing that stops the ground
#: between the white line and the grass reading as bare concrete.
RUNOFF = (92, 176, 104)
#: The wall is deliberately NOT the kerb's red and white: two red
#: ribbons side by side read as one confusing band at close range.
BARRIER_A = (222, 122, 44)   # circuit blue
BARRIER_B = (246, 249, 252)  # panel white
BARRIER_TOP = (108, 112, 126)
#: THE DIRECTIONAL KEY LIGHT. The sun is a low disc on the right-hand horizon,
#: so every upright surface in the frame - barrier lip, tyre stack, cone,
#: kart flank, helmet - takes the same warm cream on the edge that faces it,
#: and every shadow leans the other way. One colour, used everywhere, is what
#: makes the picture read as LIT rather than as filled.
RIM_CREAM = (188, 226, 250)
#: The colour a shadow is pulled toward: the violet the sunset sky bounces
#: back down into every shaded surface. Neutral grey shadows under a gold sun
#: are the single most common tell that a scene was coloured, not lit.
SHADOW_VIOLET = (128, 92, 96)
LINE = (240, 248, 252)
SKID = (54, 52, 60)

#: The horizon is a WARM VERTICAL GRADIENT, not one flat band: cool pale haze
#: a little way up into the sky, hot gold exactly on the seam, and a warm
#: green-grey settling back into the field below it.
HAZE_HI = (204, 198, 206)
HAZE_MID = (156, 200, 236)
HAZE_LO = (140, 196, 190)
#: The dark treeline silhouette standing on the grass/mountain seam.
TREELINE = (68, 76, 62)

#: SUB-PIXEL GEOMETRY. OpenCV's polygon fills take fixed-point coordinates
#: through ``shift``; at a sixteenth of a pixel, with LINE_AA on top, a road
#: edge that creeps sideways by a third of a pixel per scanline comes out as a
#: smooth alpha-blended boundary instead of a staircase of whole-pixel steps.
#: Every edge of the ground plane - tarmac, kerb, white line, apron, barrier -
#: is laid through :func:`_fp`, which is the difference between a renderer and
#: a scanline loop.
SHIFT = 4
SUB = float(1 << SHIFT)


def _fp(points) -> np.ndarray:
    """Float screen points to the fixed-point int32 a ``shift=4`` fill wants.

    Two allocations, not four: the scale is applied in place and the truncation
    to fixed point is the cast. This runs seven hundred times a frame, and a
    sixteenth-of-a-pixel rounding bias is not a thing anyone can see.
    """
    out = np.array(points, np.float32)
    out *= SUB
    return out.astype(np.int32)


def _fp_arr(points: np.ndarray) -> np.ndarray:
    """:func:`_fp` for a shape whose columns are already laid out in an array.

    The asphalt is half of every frame's polygon vertices, and walking a dict
    of tuples to build a Python list of coordinate pairs for each quad costs
    four times what writing two columns into a scratch buffer does. Same
    fixed point, same fill, no list parsing.
    """
    return (points * SUB).astype(np.int32)


def _ends(run: list[int]) -> list[int]:
    """Three rows out of a run: first, middle, last.

    A kerb tooth is a unit and a half of road. Nothing bends measurably over
    that distance, so a twenty-vertex outline is nineteen more than the shape
    needs - and building it is pure list parsing, seventy times a frame.
    """
    n = len(run)
    return run if n < 4 else [run[0], run[n // 2], run[-1]]


def _fill(canvas: np.ndarray, polys: list, colour,
          line: int = cv2.LINE_AA) -> None:
    """One sub-pixel batch fill; a no-op on an empty batch.

    Antialiasing is paid for per pixel of the FILL, not per pixel of the edge,
    so the two shapes that cover most of the frame - the asphalt slabs and the
    mow squares - take ``LINE_8``: both are laid edge to edge with a neighbour
    of nearly their own colour, and every boundary of theirs that actually
    shows a contrast (the white line, the kerb, the apron) is a separate
    antialiased shape drawn over the top.
    """
    if polys:
        cv2.fillPoly(canvas, polys, colour, line, SHIFT)

INK = (236, 236, 236)
MUTED = (152, 148, 144)
ACCENT = (96, 168, 236)
GOOD = (120, 230, 130)
WARN = (60, 190, 250)
DANGER = (70, 70, 230)
PLAYER = (38, 48, 232)

#: Arcade sparkle: the coin gold, and the pale rim struck into its face.
#: (The drift charge has its own three-stage palette, _DRIFT_STAGES.)
COIN_GOLD = (58, 196, 250)
COIN_RIM = (150, 236, 255)

#: Bunting strung between the barrier posts, cycling round the lap.
BUNTING = ((60, 60, 214), (60, 190, 250), (246, 249, 252), (222, 122, 44))

#: The bunting CORD is mid-grey and two pixels thick. A 1px pure-white line
#: strung over a green field does not read as string, it reads as a scratch
#: on the lens - which is exactly what it looked like.
BUNTING_CORD = (138, 138, 138)

MEDALS = ((70, 190, 245), (200, 200, 205), (95, 125, 190))  # gold silver bronze

#: The instruments are a SYSTEM, not a tint: an opaque navy face with a gold
#: ring, the same gold the P1 badge uses, so a dial never takes its colour
#: from the grass or the asphalt that happens to be behind it.
HUD_FACE = (40, 20, 20)        # #141428
HUD_GOLD = MEDALS[0]
#: ONE PANEL SYSTEM. Every instrument that is a plate rather than a dial uses
#: this face, this edge, this opacity and this corner radius. Six boxes with
#: six different roundings and three different alphas is not a HUD, it is a
#: pile of widgets, and it was the first thing that read as unfinished.
HUD_PANEL = (24, 20, 20)
HUD_EDGE = (78, 72, 68)
HUD_ALPHA = 0.86


def HUD_RADIUS(s: float) -> int:
    return max(4, round(10 * s))


def project(round_: RaceRound, view: Rect, shake: int = 0,
            fov: float = 1.0) -> dict[int, tuple[float, float, float]]:
    """Per screen row below the horizon: (z, road centre px, half width px).

    The classic pseudo-3D road: each row is a slice of ground at distance
    ``z = NEAR_Z / p`` where p runs 1 at the bottom of the screen to 0 at the
    horizon. Curvature is integrated twice from near to far, which is what
    bends a constant-curvature corner into the parabola the eye expects. The
    road centre already carries the player's lateral position, so anything ON
    the road is placed at ``centre + kart.x * half_width`` - the player's own
    kart lands dead centre by construction.
    """
    horizon = view.y + int(view.height * HORIZON) + shake
    n = max(view.bottom - horizon, 1)
    max_half = view.width * 0.46 * fov
    rows: dict[int, tuple[float, float, float]] = {}
    offset, delta = 0.0, 0.0
    player = round_.player
    # The camera LOOKS INTO the corner. A chase camera that stares dead ahead
    # puts the vanishing point of a 60 m radius bend eighty pixels off centre,
    # which is not a corner, it is a kink; swinging the far end of the road
    # toward the turn - full at the horizon, nothing at all at the front
    # bumper, so the kart never leaves the middle of the frame - is what makes
    # a bend read as a bend from the thumbnail.
    yaw = max(-1.0, min(1.0, round_.track.curvature_ahead(player.s, 90.0)
                        / 0.009)) * view.width * YAW_PX
    for y in range(view.bottom - 1, horizon, -1):
        p = (y - horizon) / n
        z = NEAR_Z / p
        if z > DRAW_DISTANCE:
            break
        delta += round_.track.curvature_at(player.s + z) * CURVE_PX * view.width / n
        offset += delta
        half = max_half * p
        centre = view.x + view.width / 2 - player.x * half + offset \
            + yaw * (1.0 - p) ** 1.4
        rows[y] = (z, centre, half)
    return rows


# --- per-race presentation state ---------------------------------------------

class _Effects:
    """What the renderer remembers between frames: skid marks, brake state."""

    def __init__(self, round_: RaceRound) -> None:
        self.round = round_
        self.skids: list[tuple[float, float]] = []
        self.brake = False
        self.last_skid = -10.0
        #: The instant the exhaust last paid out, so the release can throw a
        #: white burst that the steady boost flame cannot.
        self.boost_flash = -10.0
        self.prev_boost = 0.0
        #: Braking read off the PHYSICS, not off the HUD: the wheel state
        #: arrives with draw_hud, one call after the world is drawn, so a
        #: sprite that trusted it would light its brake lights a frame late.
        self.hard_decel = False
        self.prev_v = 0.0
        self.prev_t = -1.0
        #: Every kart sprite's screen footprint this frame, so the HUD can
        #: get out of the way of anything the player has to see.
        self.sprites: list[tuple[int, int, int, int]] = []


_effects: _Effects | None = None


def _effects_for(round_: RaceRound) -> _Effects:
    global _effects
    if _effects is None or _effects.round is not round_:
        _effects = _Effects(round_)
    return _effects


def _note_slides(round_: RaceRound, fx: _Effects, now: float) -> None:
    """Lay rubber where the player is actually sliding, read from the physics."""
    p = round_.player
    boost = float(getattr(p, "boost", 0.0))
    if boost > fx.prev_boost + 1e-6:
        fx.boost_flash = now     # the slide just paid out
    fx.prev_boost = boost
    step = now - fx.prev_t
    if 0.0 < step < 0.25:
        fx.hard_decel = ((fx.prev_v - p.v) / step > 18.0
                         and p.v > TOP_SPEED * 0.2
                         and abs(p.x) <= ROAD_HALF_WIDTH)
    fx.prev_v, fx.prev_t = p.v, now
    if not round_.racing or abs(p.x) > ROAD_HALF_WIDTH:
        return
    sliding = (abs(p.steer) > 0.55 and p.v > TOP_SPEED * 0.45) or \
        (fx.brake and p.v > TOP_SPEED * 0.3) or \
        bool(getattr(p, "drifting", False))
    if not sliding:
        return
    if (p.s - fx.last_skid) % round_.track.length <= 0.8:
        return
    fx.last_skid = p.s
    drift = max(-1.0, min(1.0, p.steer))
    # The player's kart is drawn PLAYER_SPRITE_Z ahead of p.s, so the rubber
    # goes down at the sprite's position and slides away under it.
    at = (p.s + PLAYER_SPRITE_Z) % round_.track.length
    fx.skids.append((at, p.x - 0.11 - drift * 0.04))
    fx.skids.append((at, p.x + 0.11 - drift * 0.04))
    # About a quarter-lap of fresh rubber - marks go down in pairs every 0.8
    # units of travel, so 2600 of them span roughly 1040 units. Older marks
    # are dropped; the apex rubber underneath them is permanent.
    if len(fx.skids) > 2600:
        del fx.skids[:400]


# --- the sky, built once -----------------------------------------------------

#: The far skyline, standing on the horizon seam. Distant structures are read
#: as SILHOUETTE plus one lit face; anything more detailed at this scale turns
#: to mush under the haze pass.
FAR_BODY = (128, 124, 138)
FAR_LIT = (176, 178, 190)
FAR_DEEP = (98, 94, 112)


def _horizon_structures(base: np.ndarray, width: int, height: int) -> None:
    """The circuit's far skyline, baked into the cached sky.

    A racetrack is a PLACE - a ring of grandstands with a funfair behind it and
    floodlights over the whole thing. Drawn once into the sky bitmap, standing
    on its bottom edge, so a dense horizon costs nothing per frame. The near
    treeline is laid over the top of it afterward, which is what stops the row
    of terraces reading as a wall pasted onto the hills.
    """
    unit = max(4.0, height * 0.023)
    floor = height

    # --- the ring of terraces: a near-continuous run of far grandstands ------
    x = -int(unit * 3)
    i = 0
    while x < width + unit * 3:
        bw = int(unit * (6.0 + 2.6 * ((i * 7) % 4)))
        bh = int(unit * (2.5 + 0.8 * ((i * 5) % 3)))
        gap = int(unit * (1.2 + 0.8 * ((i * 3) % 3)))
        top = floor - bh
        deck = top + bh // 3
        cv2.rectangle(base, (x, deck), (x + bw, floor), FAR_BODY, -1)
        # THREE RAKED TIERS OF PEOPLE. These stands used to be undifferentiated
        # grey and white boxes with two rows of washed-out speckle in them -
        # a wall of empty terracing behind a race. Each tier now gets its own
        # bench shadow and its own scatter of saturated seat pixels, so the
        # ring of buildings on the skyline reads as OCCUPIED at sunset.
        stepx = max(2, int(unit * 0.42))
        for row in range(3):
            ry = deck + int(bh * (0.16 + 0.22 * row))
            cv2.rectangle(base, (x + row, ry + max(1, int(unit * 0.20))),
                          (x + bw - row, ry + max(2, int(unit * 0.34))),
                          FAR_DEEP, -1)
            for k, cx in enumerate(range(x + stepx, x + bw - stepx // 2, stepx)):
                hsh = ((k * 40503) ^ (i * 9176) ^ (row * 2654435761)) & 0xFFFF
                tone = _CROWD[(k * 3 + row * 5 + i) % len(_CROWD)]
                tone = tuple(int(c * 0.74 + 46) for c in tone)
                cv2.circle(base, (cx, ry + hsh % 2), max(1, stepx // 2), tone,
                           -1)
        # A LIT LED RIBBON along the front of the deck: the one thing that
        # says these buildings have power on and a race running in front of
        # them, and the brightest horizontal in the whole skyline.
        led = max(1, int(unit * 0.30))
        cv2.rectangle(base, (x + led, deck), (x + bw - led, deck + led),
                      (150, 236, 255), -1)
        # A striped canopy over the top, and legs down to the ground.
        cells = max(3, bw // max(3, int(unit * 1.6)))
        cw = bw / cells
        for c in range(cells):
            colour = FAR_DEEP if (c + i) % 2 else FAR_LIT
            cv2.rectangle(base, (int(x + c * cw), top),
                          (int(x + (c + 1) * cw), top + bh // 3), colour, -1)
        # THE DARK ROOF BAND. A solid charcoal fascia across the whole eave,
        # so the roofline is a hard edge against the sky instead of a row of
        # pale boxes fading into the hills behind them.
        cv2.rectangle(base, (x, top - max(1, int(unit * 0.40))),
                      (x + bw, top + max(1, int(unit * 0.22))), (54, 50, 62),
                      -1)
        x += bw + gap
        i += 1

    # --- a ferris wheel and a windmill, the fairground behind the paddock ----
    fx_, fy_ = int(width * 0.135), floor - int(unit * 8.2)
    fr = int(unit * 5.4)
    for a in range(0, 180, 15):
        rad = math.radians(a)
        dx, dy = int(math.cos(rad) * fr), int(math.sin(rad) * fr)
        cv2.line(base, (fx_ - dx, fy_ - dy), (fx_ + dx, fy_ + dy), FAR_BODY,
                 max(1, int(unit * 0.14)), cv2.LINE_AA)
    cv2.circle(base, (fx_, fy_), fr, FAR_DEEP, max(1, int(unit * 0.26)),
               cv2.LINE_AA)
    for a in range(0, 360, 30):
        rad = math.radians(a)
        cab = (fx_ + int(math.cos(rad) * fr), fy_ + int(math.sin(rad) * fr))
        tone = ((92, 172, 236), (196, 168, 120), (150, 140, 196))[(a // 30) % 3]
        cv2.circle(base, cab, max(2, int(unit * 0.5)), tone, -1, cv2.LINE_AA)
    cv2.circle(base, (fx_, fy_), max(2, int(unit * 0.7)), FAR_LIT, -1,
               cv2.LINE_AA)
    for sgn in (-1, 1):
        cv2.line(base, (fx_, fy_), (fx_ + sgn * int(fr * 0.62), floor),
                 FAR_BODY, max(1, int(unit * 0.3)), cv2.LINE_AA)

    wx = int(width * 0.875)
    wy = floor - int(unit * 7.0)
    cv2.fillPoly(base, [np.array(
        [(wx - int(unit * 0.55), wy), (wx + int(unit * 0.55), wy),
         (wx + int(unit * 1.35), floor), (wx - int(unit * 1.35), floor)],
        np.int32)], FAR_BODY, cv2.LINE_AA)
    cv2.circle(base, (wx, wy), max(2, int(unit * 0.8)), FAR_DEEP, -1,
               cv2.LINE_AA)
    for a in (18, 108, 198, 288):
        rad = math.radians(a)
        tip = (wx + int(math.cos(rad) * unit * 4.2),
               wy + int(math.sin(rad) * unit * 4.2))
        cv2.line(base, (wx, wy), tip, FAR_LIT, max(1, int(unit * 0.36)),
                 cv2.LINE_AA)

    # --- TWO TALL VERTICALS, crossing well up into the sky -------------------
    # A skyline made only of terraces and balloons has no scale to it. A
    # floodlight mast and a flagpole standing twice the height of everything
    # else break the flat band of buildings and give the sky something to be
    # measured against.
    mast_x = int(width * 0.335)
    mast_h = int(unit * 15.5)
    cv2.line(base, (mast_x, floor), (mast_x, floor - mast_h), FAR_DEEP,
             max(2, int(unit * 0.30)), cv2.LINE_AA)
    for k in range(1, 4):        # the lattice bracing up the tower
        ly = floor - mast_h * k // 4
        cv2.line(base, (mast_x - int(unit * 0.7), ly),
                 (mast_x + int(unit * 0.7), ly - int(unit * 0.8)), FAR_BODY,
                 max(1, int(unit * 0.14)), cv2.LINE_AA)
    rig_w = int(unit * 2.4)
    cv2.rectangle(base, (mast_x - rig_w, floor - mast_h - int(unit * 1.5)),
                  (mast_x + rig_w, floor - mast_h), (58, 54, 66), -1)
    for j in range(4):
        cv2.circle(base, (mast_x - rig_w + int(rig_w * 0.66) * j + int(unit * 0.4),
                          floor - mast_h - int(unit * 0.75)),
                   max(1, int(unit * 0.44)), (196, 232, 255), -1, cv2.LINE_AA)
    pole_x = int(width * 0.735)
    pole_h = int(unit * 13.0)
    cv2.line(base, (pole_x, floor), (pole_x, floor - pole_h), FAR_LIT,
             max(2, int(unit * 0.22)), cv2.LINE_AA)
    cv2.circle(base, (pole_x, floor - pole_h), max(2, int(unit * 0.34)),
               (196, 232, 255), -1, cv2.LINE_AA)
    ban_w, ban_h = int(unit * 3.4), int(unit * 4.6)
    cv2.fillPoly(base, [np.array([
        (pole_x, floor - pole_h + int(unit * 0.6)),
        (pole_x + ban_w, floor - pole_h + int(unit * 1.3)),
        (pole_x + ban_w, floor - pole_h + int(unit * 1.3) + ban_h),
        (pole_x, floor - pole_h + int(unit * 0.6) + ban_h)], np.int32)],
        (72, 76, 214), cv2.LINE_AA)
    cv2.fillPoly(base, [np.array([
        (pole_x, floor - pole_h + int(unit * 0.6) + ban_h // 3),
        (pole_x + ban_w, floor - pole_h + int(unit * 1.3) + ban_h // 3),
        (pole_x + ban_w, floor - pole_h + int(unit * 1.3) + ban_h * 2 // 3),
        (pole_x, floor - pole_h + int(unit * 0.6) + ban_h * 2 // 3)],
        np.int32)], (236, 242, 248), cv2.LINE_AA)

    # --- floodlight pylons and pennant masts, the vertical rhythm ------------
    for k in range(9):
        px = int(width * (0.06 + 0.11 * k))
        if abs(px - fx_) < fr or abs(px - wx) < unit * 4:
            continue
        ph = int(unit * (5.6 + 1.4 * (k % 3)))
        cv2.line(base, (px, floor), (px, floor - ph), FAR_BODY,
                 max(1, int(unit * 0.24)), cv2.LINE_AA)
        if k % 2:
            head_w = int(unit * 1.5)
            cv2.rectangle(base, (px - head_w, floor - ph - int(unit * 0.9)),
                          (px + head_w, floor - ph), FAR_DEEP, -1)
            for j in range(3):
                cv2.circle(base, (px - head_w + int(head_w * j),
                                  floor - ph - int(unit * 0.45)),
                           max(1, int(unit * 0.34)), (168, 206, 244), -1,
                           cv2.LINE_AA)
        else:
            for j in range(3):
                ty = floor - ph + int(unit * 1.5 * j)
                cv2.fillPoly(base, [np.array(
                    [(px, ty), (px, ty + int(unit * 1.1)),
                     (px + int(unit * 1.5), ty + int(unit * 0.55))], np.int32)],
                    ((92, 172, 236), (206, 210, 220), (120, 116, 200))[j],
                    cv2.LINE_AA)


#: How much WIDER than the frame the sky bitmap is built. The frame reads a
#: window slid across it, and the window is driven by the compass heading of
#: the track under the kart - so the grandstands, the wheel, the windmill and
#: the balloons all pan as the circuit turns, instead of the same strip of
#: skyline being pasted behind every corner of every lap like wallpaper. It
#: costs nothing: the sky was always one memcpy, and it still is.
SKY_PAN = 0.36


@lru_cache(maxsize=4)
def _headings(track: Track) -> tuple[np.ndarray, float]:
    """The compass heading round the lap, sampled coarsely, plus the step."""
    n = 256
    ds = track.length / n
    out = np.empty(n, np.float32)
    a = 0.0
    for i in range(n):
        out[i] = a
        a += track.curvature_at(i * ds) * ds
    return out, ds


def _sky_pan(round_: RaceRound, span: int, width: int) -> int:
    """How far into the wide sky this frame's window starts."""
    table, ds = _headings(round_.track)
    a = float(table[int(round_.player.s / ds) % len(table)])
    return int(max(0, span - width) * (0.5 + 0.5 * math.sin(a)))


@lru_cache(maxsize=4)
def _sky(width: int, height: int) -> np.ndarray:
    """Golden-hour sky: gradient, sun bloom, streak clouds, two hill ridges."""
    height = max(height, 2)
    split = max(1, int(height * 0.52))
    grad = np.vstack([np.linspace(SKY_TOP, SKY_MID, split),
                      np.linspace(SKY_MID, SKY_GLOW, height - split + 1)])[:height]
    sky = np.repeat(grad[:, None, :], width, axis=1).astype(np.float32)

    sun = (int(width * 0.700), int(height * 0.80))
    glow = np.zeros_like(sky)
    for radius, colour in ((int(height * 0.95), (14, 24, 38)),
                           (int(height * 0.50), (20, 36, 56)),
                           (int(height * 0.24), (28, 50, 70))):
        cv2.circle(glow, sun, max(radius, 2), colour, -1, cv2.LINE_AA)
    sigma = max(1.0, height * 0.06)
    sky += cv2.GaussianBlur(glow, (0, 0), sigma)
    base = np.clip(sky, 0, 255).astype(np.uint8)

    r_sun = max(3, int(height * 0.075))
    rng = np.random.default_rng(11)
    clouds = base.copy()
    for _ in range(15):
        cy = int(rng.uniform(0.14, 0.72) * height)
        cx = int(rng.uniform(-0.1, 1.1) * width)
        cw = max(4, int(rng.uniform(0.10, 0.30) * width))
        ch = max(2, int(rng.uniform(0.010, 0.030) * height))
        if abs(cy - sun[1]) < r_sun * 2.2 and abs(cx - sun[0]) < cw + r_sun * 2.6:
            cy = sun[1] - int(r_sun * 2.2 + (sun[1] - cy) % max(r_sun, 1))
        warm = 1.0 - min(1.0, abs(cy - sun[1]) / max(height * 0.9, 1))
        colour = tuple(int(a + (b - a) * warm) for a, b in
                       zip((208, 176, 200), (166, 220, 255)))
        cv2.ellipse(clouds, (cx, cy), (cw, ch), 0, 0, 360, colour, -1, cv2.LINE_AA)
        cv2.ellipse(clouds, (cx - cw // 4, cy - ch // 2), (cw // 2, max(1, ch // 2)),
                    0, 0, 360, tuple(min(255, c + 18) for c in colour), -1,
                    cv2.LINE_AA)
    clouds = cv2.GaussianBlur(clouds, (0, 0), max(1.0, height * 0.008))
    base = cv2.addWeighted(base, 0.42, clouds, 0.58, 0)

    # A soft vertical glare column dropping from the sun toward the horizon.
    xs_g = np.arange(width, dtype=np.float32)
    col = np.exp(-(((xs_g - sun[0]) / max(width * 0.055, 1.0)) ** 2))
    ys_g = np.arange(height, dtype=np.float32)
    reach = np.clip(1.0 - np.abs(ys_g - sun[1]) / max(height * 0.7, 1.0),
                    0.0, 1.0) ** 1.4
    glare = (col[None, :] * reach[:, None])[:, :, None] * \
        np.array((26, 44, 62), np.float32)
    base = np.clip(base.astype(np.float32) + glare, 0, 255).astype(np.uint8)

    # The sun itself: a clean disc in a soft halo, clouds kept off its face.
    halo = base.copy()
    cv2.circle(halo, sun, int(r_sun * 1.7), (168, 214, 252), -1, cv2.LINE_AA)
    cv2.circle(halo, sun, int(r_sun * 1.25), (192, 228, 254), -1, cv2.LINE_AA)
    base = cv2.addWeighted(base, 0.72, halo, 0.28, 0)
    cv2.circle(base, sun, r_sun, SUN_CORE, -1, cv2.LINE_AA)

    # Distant hills in three layers, each nearer one greener and darker: the
    # far ridge is almost sky, the nearest carries a hint of the field.
    xs = np.arange(width, dtype=np.float32)
    for base_f, amp_f, phase, colour in ((0.800, 0.044, 0.8, (222, 186, 196)),
                                         (0.865, 0.050, 1.7, (196, 152, 158)),
                                         (0.930, 0.070, 4.2, (162, 122, 128)),
                                         (0.985, 0.055, 2.6, (112, 132, 96))):
        wave = (np.sin(xs * 9.0 / width + phase)
                + 0.55 * np.sin(xs * 23.0 / width + phase * 2.1)
                + 0.3 * np.sin(xs * 47.0 / width + phase * 3.3))
        ridge = (base_f * height - (wave + 1.85) * amp_f * height * 0.5)
        pts = np.empty((width + 2, 2), np.int32)
        pts[:width, 0] = xs
        pts[:width, 1] = ridge
        pts[width] = (width - 1, height)
        pts[width + 1] = (0, height)
        cv2.fillPoly(base, [pts], colour, cv2.LINE_AA)

    _horizon_structures(base, width, height)

    # A dark treeline standing on the grass/mountain seam: a run of overlapping
    # canopies 12-18 px tall, the thing that stops the horizon reading as a
    # ruled line where one flat colour meets another.
    tree_h = max(8.0, height * 0.044)
    cv2.rectangle(base, (0, int(height - tree_h * 0.42)), (width, height),
                  TREELINE, -1)
    lit = tuple(min(255, int(c * 1.34) + 16) for c in TREELINE)
    step = max(5, int(width / 130.0))
    for i, cx in enumerate(range(-step, width + step, step)):
        hsh = (i * 2654435761) & 0xFFFF
        r = int(tree_h * (0.30 + 0.42 * ((hsh >> 3) % 100) / 100.0))
        cy = int(height - tree_h * (0.30 + 0.34 * ((hsh >> 9) % 100) / 100.0))
        cv2.circle(base, (cx + (hsh % 5) - 2, cy), max(2, r), TREELINE, -1,
                   cv2.LINE_AA)
        if r > 3 and hsh & 1:   # the low sun grazing the odd crown
            cv2.circle(base, (cx + max(1, r // 3), cy - max(1, r // 3)),
                       max(1, r // 3), lit, -1, cv2.LINE_AA)

    # Party balloons drifting over the circuit: pure arcade set dressing,
    # baked into the static sky so they cost nothing per frame.
    for i, (fx_, fy_, colour) in enumerate((
            (0.32, 0.30, (72, 96, 244)), (0.41, 0.16, (250, 196, 72)),
            (0.53, 0.38, (96, 216, 120)), (0.68, 0.22, (236, 128, 210)),
            (0.76, 0.40, (72, 190, 250)))):
        bx, by = int(width * fx_), int(height * fy_)
        br = max(3, int(height * (0.035 + 0.008 * (i % 3))))
        cv2.ellipse(base, (bx, by), (br, int(br * 1.18)), 0, 0, 360, colour,
                    -1, cv2.LINE_AA)
        cv2.ellipse(base, (bx + br // 3, by - br // 3),
                    (max(1, br // 3), max(1, br // 2)), -20, 0, 360,
                    tuple(min(255, int(c * 1.35) + 30) for c in colour), -1,
                    cv2.LINE_AA)
        cv2.ellipse(base, (bx - br // 2, by + br // 6),
                    (max(1, br // 4), max(1, int(br * 0.7))), 12, 0, 360,
                    tuple(int(c * 0.72) for c in colour), -1, cv2.LINE_AA)
        basket = int(br * 0.34)
        cv2.line(base, (bx, by + int(br * 1.1)), (bx, by + int(br * 1.5)),
                 (72, 78, 92), max(1, br // 12), cv2.LINE_AA)
        cv2.rectangle(base, (bx - basket // 2, by + int(br * 1.5)),
                      (bx + basket // 2, by + int(br * 1.5) + basket),
                      (46, 84, 130), -1)
    return base


# --- the scenery list, built once per track ----------------------------------

@lru_cache(maxsize=4)
def _scenery(track: Track) -> tuple[tuple[float, float, str, int], ...]:
    """(s, x offset in half-widths, kind, variant) for everything trackside."""
    rng = np.random.default_rng(int(track.length * 977.0) & 0xFFFFFF)
    length = track.length
    # The timing gantry stands just past the start line, where a real one
    # does - close enough to read on the grid, and the last thing the leader
    # drives under on the way to the flag.
    props: list[tuple[float, float, str, int]] = [(24.0, 0.0, "gantry", 0)]

    # Corner entries get distance boards on the outside of the bend.
    s = 0.0
    straights: list[tuple[float, float]] = []
    for seg in track.segments:
        if abs(seg.curvature) >= 0.005:
            side = -math.copysign(1.0, seg.curvature)
            arrow = 1 if seg.curvature > 0 else -1
            for dist, variant in ((100.0, 3), (55.0, 2), (25.0, arrow)):
                props.append(((s - dist) % length, side * 1.5, "board", variant))
        elif seg.curvature == 0.0 and seg.length > 150.0 and s > 100.0:
            straights.append((s, seg.length))
        s += seg.length

    # Grandstands: a row on the start straight, a shorter one on the longest
    # straight in the back half - and a sponsor arch over that straight.
    for i in range(4):
        props.append((36.0 + 56.0 * i, -2.45, "stand", i % 3))
    if straights:
        back_s, back_len = max(straights, key=lambda item: item[1])
        for i in range(min(3, int(back_len // 60))):
            props.append((back_s + 24.0 + 58.0 * i, 2.45, "stand", (i + 2) % 3))
        props.append(((back_s + back_len * 0.55) % length, 0.0, "arch", 0))
    # A sponsor bridge every ~118 units of track, alternating striped arch and
    # banner-on-cables, so the vanishing point ALWAYS has structure crossing
    # it and one of them is near enough to read on any straight.
    for k in range(max(1, int(length // 118.0))):
        s_a = (62.0 + k * 118.0) % length
        if (s_a - 24.0) % length < 60.0 or (24.0 - s_a) % length < 60.0:
            continue     # never on top of the start/finish gantry
        props.append((s_a, 0.0, "arch", k % 3))

    for i in range(int(length // 130)):
        s_b = (140.0 + i * 130.0 + rng.uniform(-30, 30)) % length
        props.append((s_b, (1.0 if i % 2 else -1.0) * 2.0, "bill", i % 3))

    # Extra grandstands around the lap: the crowd came for the whole circuit,
    # not just the start straight, and both sides of every frame get one. A
    # second, deeper rank sits further out on the right, so the outfield has
    # a stand at mid-distance instead of 600 px of lawn.
    for i in range(int(length / 108.0)):
        s_g = (95.0 + i * 108.0 + float(rng.uniform(-15, 15))) % length
        side = -1.0 if i % 2 else 1.0
        if side < 0 and 10.0 < s_g < 280.0:
            continue  # the start straight already carries the main stands
        props.append((s_g, side * 2.5, "stand", i % 3))
    for i in range(int(length / 165.0)):
        s_g = (150.0 + i * 165.0 + float(rng.uniform(-20, 20))) % length
        props.append((s_g, 4.3 if i % 2 else -4.3, "stand", (i + 1) % 3))

    # The advertising wall: a near-continuous run of sponsor panels standing
    # behind the guard rail, both sides, all the way round.
    for i in range(int(length / 34.0)):
        s_h = (6.0 + i * 34.0) % length
        props.append((s_h, 1.30, "hoard", i % len(_SPONSORS)))
        props.append((s_h + 17.0, -1.30, "hoard", (i + 2) % len(_SPONSORS)))
    # ...and a second and third rank of them standing OUT ON THE GRASS at two
    # and three road-widths, staggered along the lap so a frame catches three
    # or four boards at three different depths. The deep field either side of
    # the circuit used to be a fifth of the picture with nothing in it but
    # mown stripes; a sponsor board is what a real circuit puts there.
    for i in range(int(length / 46.0)):
        s_h = (23.0 + i * 46.0) % length
        props.append((s_h, 2.05 if i % 2 else -2.05, "hoard",
                      (i + 1) % len(_SPONSORS)))
        props.append(((s_h + 23.0) % length, -2.95 if i % 2 else 2.95,
                      "hoard", (i + 4) % len(_SPONSORS)))

    # The SECOND scenery layer: a sponsor banner wall standing out beyond the
    # grandstands, and tall pennant masts at a steady beat between them. These
    # two live at the depth where the frame used to be nothing but mown lawn.
    for i in range(int(length / 54.0)):
        s_v = (18.0 + i * 54.0) % length
        props.append((s_v, 3.35 if i % 2 else -3.35, "bannerwall",
                      i % len(_SPONSORS)))
        props.append(((s_v + 27.0) % length, -3.35 if i % 2 else 3.35,
                      "bannerwall", (i + 3) % len(_SPONSORS)))
    for i in range(int(length / 24.0)):
        s_v = (7.0 + i * 24.0) % length
        props.append((s_v, 2.15 if i % 2 else -2.15, "pole", i % 3))

    # The THIRD layer: a continuous treeline out on the far grass, laid end to
    # end so the outfield recedes into woodland instead of stopping at a few
    # isolated blobs on flat green.
    for i in range(int(length / 26.0)):
        s_v = (i * 26.0 + float(rng.uniform(0, 7))) % length
        props.append((s_v, 4.4 + float(rng.uniform(0, 1.5)), "treewall", i % 3))
        props.append(((s_v + 13.0) % length,
                      -(4.4 + float(rng.uniform(0, 1.5))), "treewall",
                      (i + 1) % 3))

    # A TYRE WALL running along the outer kerb, both sides, all the way round:
    # a run of stacked black rings with a coloured cap on top every ~40 units.
    # This is the prop that makes the shoulder of the road read as a circuit
    # rather than as the edge of a lawn.
    for i in range(int(length / 34.0)):
        s_w = (i * 34.0) % length
        # Planted on the apron INSIDE the guard rail, so the stacks occlude the
        # wall they are protecting instead of floating behind it.
        props.append((s_w, 1.16, "tyrewall", i % 4))
        props.append(((s_w + 17.0) % length, -1.16, "tyrewall", (i + 2) % 4))

    step = 13.0
    for i in range(int(length / step)):
        s_t = (i * step + float(rng.uniform(0, 9))) % length
        side = 1.0 if (i * 7 + int(rng.uniform(0, 3))) % 2 else -1.0
        if side < 0 and 20.0 < s_t < 260.0:
            continue  # keep the grandstand straight clear
        kind = "flag" if i % 7 == 2 else "tree"
        props.append((s_t, side * (1.78 + float(rng.uniform(0, 1.5))), kind,
                      int(rng.uniform(0, 3))))

    # The deep field: tree copses and spectator berms staggered well off the
    # road on BOTH sides, so the midground parallax always has something to
    # slide against - never a flat half-screen of empty green. Three depth
    # ranks, so the outfield recedes instead of sitting on one plane.
    for i in range(int(length / 33.0)):
        s_c = (i * 33.0 + float(rng.uniform(0, 14))) % length
        side = 1.0 if i % 2 else -1.0
        rank = i % 3
        u = (2.5, 4.1, 6.4)[rank] + float(rng.uniform(0, 1.5))
        props.append((s_c, side * u, "copse", (i + rank) % 3))
    for i in range(int(length / 46.0)):
        s_m = (33.0 + i * 46.0 + float(rng.uniform(-10, 10))) % length
        side = -1.0 if i % 2 else 1.0
        props.append((s_m, side * (2.9 + float(rng.uniform(0, 0.9))), "berm",
                      i % 3))
    # Hospitality tents out on the infield and the outfield: red-and-white
    # striped marquees, the loudest 'race weekend' silhouette there is.
    for i in range(int(length / 78.0)):
        s_p = (58.0 + i * 78.0 + float(rng.uniform(-14, 14))) % length
        side = 1.0 if i % 2 else -1.0
        props.append((s_p, side * (3.0 + float(rng.uniform(0, 1.2))), "tent",
                      i % 3))

    # A steady prop cadence between the set pieces, so velocity reads on
    # every stretch of the lap: kerbside marker posts every 40 units, tyre
    # stacks and low sponsor hoardings on longer beats.
    for i in range(int(length / 26.0)):
        s_p = (11.0 + i * 26.0) % length
        props.append((s_p, 1.46 if i % 2 else -1.46, "post", i % 3))

    # Collectibles. Coins arc through every corner apex, tracking the line a
    # quick driver would take; power cubes stand in rows of three across the
    # tarmac - at a third and two thirds of the width, plus dead centre - on
    # the run into each bend and at a steady beat down every straight.
    s = 0.0
    for seg in track.segments:
        if abs(seg.curvature) >= 0.005:
            inside = math.copysign(1.0, seg.curvature)
            n_c = int(min(seg.length - 10.0, 140.0) // 10.0)
            for k in range(max(n_c, 0)):
                t = k / max(n_c - 1, 1)
                arc = inside * (0.08 + 0.54 * math.sin(t * math.pi))
                props.append((((s + 6.0 + k * 10.0) % length), arc, "coin", k % 6))
            for k, lane in enumerate((-0.33, 0.0, 0.33)):
                props.append((((s - 24.0) % length), lane, "cube", k))
        else:
            # Rows of three every fifty units, with a single box on the line
            # halfway between them: a pickup every twenty-five units of road,
            # without a wall of them across the tarmac every two seconds.
            for j in range(int(seg.length // 50.0)):
                s_r = (s + 26.0 + j * 50.0) % length
                for k, lane in enumerate((-0.36, 0.0, 0.36)):
                    props.append((s_r, lane, "cube", (k + j) % 4))
                props.append(((s_r + 25.0) % length,
                              0.30 if j % 2 else -0.30, "cube", (j + 2) % 4))
            if seg.length > 110.0:
                n_c = int(min(seg.length - 40.0, 150.0) // 10.5)
                lane = 0.36 if int(s) % 2 else -0.36
                for k in range(max(n_c, 0)):
                    sway = math.sin(k * 0.55) * 0.30
                    props.append((((s + 26.0 + k * 10.5) % length), lane + sway,
                                  "coin", k % 6))
        s += seg.length

    # THE OUTSIDE OF EVERY BEND, dressed like the start straight. This is the
    # half of the frame the camera swings onto through a corner, and it used
    # to be a lone tree on flat green: a run of tyre stacks hugging the
    # tarmac, a grandstand and a marquee at mid-distance, bunting masts at a
    # steady beat, tree clusters at three depths, and a name board on the way
    # in. Everything here is anchored to the OUTSIDE of the turn, so it
    # follows the camera round the lap instead of sitting near the start line.
    s = 0.0
    for seg in track.segments:
        if abs(seg.curvature) >= 0.005:
            out = -math.copysign(1.0, seg.curvature)
            n_o = int(seg.length // 14.0)
            for k in range(n_o):
                s_o = (s - 12.0 + k * 14.0) % length
                props.append((s_o, out * 1.30, "tires", k % 3))
                if k % 2 == 0:
                    props.append((s_o, out * 2.05, "pole", k % 3))
                if k % 3 == 1:
                    props.append((s_o, out * (3.6 + (k % 3) * 0.7), "copse",
                                  k % 3))
                if k % 4 == 2:
                    props.append((s_o, out * (7.4 + (k % 4) * 1.9), "copse",
                                  (k + 1) % 3))
                if k % 5 == 3:
                    props.append((s_o, out * 2.62, "stand", (k + 1) % 3))
                if k % 7 == 4:
                    props.append((s_o, out * 3.15, "tent", k % 3))
            props.append(((s - 34.0) % length, out * 1.74, "adboard",
                          int(s) % 3))
            props.append(((s + seg.length * 0.5) % length, out * 2.30,
                          "bill", int(s) % 3))
            # The OUTSIDE of the bend is the half of the frame the camera
            # swings onto, and it used to be lawn: it gets the same barrier,
            # the same marshal and the same poplar avenue as the apex.
            n_x = int(seg.length // 9.0)
            for k in range(n_x):
                s_x = (s - 6.0 + k * 9.0) % length
                if k % 2 == 0:
                    props.append((s_x, out * 1.44, "bundle", (k + 2) % 5))
                if k % 2 == 1:
                    props.append((s_x, out * 2.55, "poplar", k % 3))
                if k % 3 == 2:
                    props.append((s_x, out * 3.45, "poplar", (k + 2) % 3))
            props.append(((s + seg.length * 0.42) % length, out * 1.92,
                          "marshal", (int(s) + 1) % 3))
        s += seg.length

    # THE INSIDE OF EVERY BEND. The outside of a corner is where the camera
    # swings; the INSIDE is what the player stares at all the way through it,
    # and it used to be forty-five percent of the frame given over to banded
    # lawn. Every apex now carries a tyre-bundle barrier hugging the run-off
    # bed, two sponsor hoardings, a marshal post with a flag being waved, and
    # two ranks of poplars marching away to the horizon behind them.
    s = 0.0
    for seg in track.segments:
        if abs(seg.curvature) >= 0.005:
            ins = math.copysign(1.0, seg.curvature)
            n_i = int(seg.length // 9.0)
            for k in range(n_i):
                s_i = (s - 8.0 + k * 9.0) % length
                props.append((s_i, ins * 1.34, "bundle", k % 5))
                if k % 2 == 0:
                    props.append((s_i, ins * 3.15, "poplar", k % 3))
                if k % 3 == 1:
                    props.append((s_i, ins * 4.85, "poplar", (k + 1) % 3))
                if k % 4 == 2:
                    props.append((s_i, ins * 2.30, "tires", k % 3))
            props.append(((s + seg.length * 0.30) % length, ins * 1.80,
                          "marshal", int(s) % 3))
            props.append(((s + seg.length * 0.62) % length, ins * 1.86,
                          "hoard", int(s) % len(_SPONSORS)))
            props.append(((s + seg.length * 0.44) % length, ins * 2.34,
                          "adboard", (int(s) + 1) % 3))
        s += seg.length

    # And a poplar avenue the whole way round, both sides, so no stretch of
    # outfield ever runs more than a couple of car lengths without a mast in
    # it. Staggered between the two sides so they never line up in pairs.
    # A clipped hedge behind the rail, both sides, unbroken round the lap.
    for i in range(int(length / 9.0)):
        s_h2 = (i * 9.0) % length
        props.append((s_h2, 1.72, "hedge", i % 3))
        props.append(((s_h2 + 4.5) % length, -1.72, "hedge", (i + 1) % 3))

    for i in range(int(length / 15.0)):
        s_p = (i * 15.0) % length
        props.append((s_p, 1.95 + 0.42 * (i % 4), "poplar", i % 3))
        props.append(((s_p + 7.5) % length, -(1.95 + 0.42 * ((i + 1) % 4)),
                      "poplar", (i + 1) % 3))

    # The FAR OUTFIELD, both sides, all the way round. Out at eight to fifteen
    # half-widths these are off the frame down a straight and fill the whole
    # outside of the picture through a bend - which is exactly where the map
    # used to run out of scenery.
    for i in range(int(length / 25.0)):
        s_f = (i * 25.0 + float(rng.uniform(0, 9))) % length
        side = 1.0 if i % 2 else -1.0
        u = (8.2, 11.0, 14.4)[i % 3] + float(rng.uniform(0, 2.2))
        props.append((s_f, side * u, "treewall" if i % 3 else "copse", i % 3))
    # And one rank further out again, which is what the camera swings onto
    # at the exit of a fast bend: hedgerow, woodland and the odd marquee at
    # sixteen to twenty-eight half-widths, both sides, all the way round.
    for i in range(int(length / 35.0)):
        s_f = (7.0 + i * 35.0 + float(rng.uniform(0, 13))) % length
        side = 1.0 if i % 2 else -1.0
        u = (16.5, 21.0, 26.5)[i % 3] + float(rng.uniform(0, 3.0))
        kind = "tent" if i % 9 == 4 else ("copse" if i % 2 else "treewall")
        props.append((s_f, side * u, kind, i % 3))

    # Cones marking the corner entries, on the outside shoulder.
    s = 0.0
    for seg in track.segments:
        if abs(seg.curvature) >= 0.005:
            side = -math.copysign(1.17, seg.curvature)
            for k in range(5):
                props.append((((s + 4.0 + k * 6.0) % length), side, "pylon", 0))
        s += seg.length
    for i in range(int(length / 88.0)):
        s_t = (47.0 + i * 88.0 + float(rng.uniform(-8, 8))) % length
        side = -1.0 if i % 2 else 1.0
        if side < 0 and 20.0 < s_t < 260.0:
            continue
        props.append((s_t, side * 1.22, "tires", int(rng.uniform(0, 3))))
    for i in range(int(length / 104.0)):
        s_a = (76.0 + i * 104.0 + float(rng.uniform(-10, 10))) % length
        side = 1.0 if i % 3 else -1.0
        if side < 0 and 20.0 < s_a < 260.0:
            continue
        props.append((s_a, side * 1.72, "adboard", i % 3))
    return tuple(props)


#: How long a scenery bin is, in world units.
_BIN = 24.0


@lru_cache(maxsize=4)
def _scenery_bins(track: Track) -> tuple[tuple[tuple[float, float, str, int], ...], ...]:
    """The scenery list, bucketed by distance round the lap."""
    count = max(1, int(math.ceil(track.length / _BIN)))
    buckets: list[list[tuple[float, float, str, int]]] = [[] for _ in range(count)]
    for prop in _scenery(track):
        buckets[min(count - 1, int(prop[0] // _BIN))].append(prop)
    return tuple(tuple(b) for b in buckets)


@lru_cache(maxsize=4)
def _apex_rubber(track: Track) -> tuple[tuple[float, float], ...]:
    """Rubber every race before this one already laid through the corners.

    A circuit is never clean: the apexes carry years of old marks, darkest
    where the racing line clips the inside kerb. Laid once per track; the
    player's own fresh rubber accumulates on top of it.
    """
    rng = np.random.default_rng(int(track.length * 31.0) & 0xFFFFFF)
    marks: list[tuple[float, float]] = []
    s = 0.0
    for seg in track.segments:
        if abs(seg.curvature) >= 0.005:
            inside = math.copysign(1.0, seg.curvature)
            step = 2.4
            count = int(min(seg.length - 16.0, 160.0) / step)
            drift = float(rng.uniform(-0.03, 0.03))
            for i in range(max(count, 0)):
                si = (s + 8.0 + i * step) % track.length
                t = i / max(count - 1, 1)
                sweep = math.sin(t * math.pi)  # deepest at the apex
                x = inside * (0.16 + 0.44 * sweep) + drift \
                    + 0.02 * math.sin(i * 0.35)
                marks.append((si, x - 0.15))
                marks.append((si, x + 0.15))
        s += seg.length
    return tuple(marks)


@lru_cache(maxsize=4)
def _track_shape(track: Track) -> np.ndarray:
    """The circuit's top-down outline, normalised into the unit square."""
    samples = 320
    ds = track.length / samples
    heading, x, y = 0.0, 0.0, 0.0
    pts = np.zeros((samples, 2), np.float32)
    for i in range(samples):
        pts[i] = (x, y)
        heading += track.curvature_at(i * ds) * ds
        x += math.sin(heading) * ds
        y -= math.cos(heading) * ds
    end = np.array([x, y], np.float32)
    pts -= np.linspace(0, 1, samples, dtype=np.float32)[:, None] * (end - pts[0])
    mn, mx = pts.min(axis=0), pts.max(axis=0)
    span = float(max(mx - mn)) or 1.0
    pts = (pts - mn) / span
    return pts + (1.0 - (mx - mn) / span) / 2.0


# --- the world ---------------------------------------------------------------

#: How far down the road each kind is worth drawing at all. Beyond these
#: depths a coin is a hazed pixel and a marker post is half of one, but they
#: still cost a projection, a cull and a draw call apiece - and there are
#: hundreds of them round a lap. Only the big silhouettes reach the horizon.
#: These all came in by a third when the verge gained its own continuous run
#: of planting and the far field gained a belt of woodland: a poplar at two
#: hundred units is four hazed pixels standing in front of a hedge that is
#: already there, and there are thirty-seven of them in every frame.
_PROP_REACH = {
    "coin": 120.0, "cube": 140.0, "post": 120.0, "pylon": 130.0,
    "hoard": 135.0, "adboard": 190.0, "flag": 175.0, "tires": 140.0,
    "board": 205.0, "tyrewall": 120.0, "tree": 145.0, "copse": 145.0,
    "berm": 155.0, "tent": 165.0, "stand": 195.0,
    "pole": 135.0, "bannerwall": 155.0, "treewall": 145.0,
    "arch": 205.0, "poplar": 122.0, "bundle": 135.0, "marshal": 135.0,
    "hedge": 58.0,
}
#: Nothing trackside is walked past this depth. Beyond it a prop is one or two
#: hazed pixels that still costs a projection, a cull and a draw call, and
#: there are hundreds of them round a lap; the belt of far woodland and the
#: baked skyline carry the distance from here to the horizon far better.
PROP_HORIZON = 210.0


#: The live camera roll: (centre x, horizon row, pixels of throw at the frame
#: edge). Everything drawn after the ground consults it through _tilt_dy so a
#: banked frame stays ONE picture - a grandstand that ignored the roll would
#: hang forty pixels off the grass it is supposed to be standing on.
_TILT: tuple[float, int, float] = (0.0, 0, 0.0)


def _set_tilt(view: Rect, horizon: int, curve: float) -> None:
    global _TILT
    lean = max(-1.0, min(1.0, curve / 0.009))
    throw = math.tan(math.radians(ROLL_DEG * lean)) * view.width * 0.5
    _TILT = (view.x + view.width * 0.5, horizon, throw)


def _tilt_dy(px: float) -> int:
    """How far the camera roll lifts a point at ``px``, in screen rows."""
    cx, _, throw = _TILT
    if throw == 0.0:
        return 0
    return int(round(throw * (px - cx) / max(cx, 1.0)))


@lru_cache(maxsize=2)
def _tilt_scratch(width: int, height: int) -> np.ndarray:
    return np.empty((height, width, 3), np.uint8)


@lru_cache(maxsize=2)
def _delta_scratch(width: int, height: int) -> np.ndarray:
    return np.empty((height, width, 3), np.int16)


def _tilt_horizon(canvas: np.ndarray, view: Rect) -> None:
    """Roll the camera into the bend, as a TRUE sub-pixel vertical shear.

    This used to be a per-column-block integer row shift, and that was the
    single loudest artefact in the whole frame: across a fifty-five pixel
    throw the shift stepped two and three rows at a time, laying a staircase
    of 27-px-wide, 2-px-tall treads along every kerb, white line, apron edge
    and slab seam in the near field. One bilinear ``warpAffine`` gives the
    same roll with a continuous, alpha-blended shear - and, because OpenCV
    runs it wide and threaded, it is FASTER than the strided column writes it
    replaces. The scratch buffer is cached, so the pass is one warp and one
    flat memcpy back.
    """
    _, _, throw = _TILT
    if abs(throw) < 1.0:
        return
    height = view.bottom - view.y
    if height < 32 or view.width < 32:
        return
    cx = _TILT[0]
    slope = throw / max(cx, 1.0)
    # Rows move DOWN on the side the throw sends them down: sampling is the
    # inverse map, hence the negated shear.
    m = np.array([[1.0, 0.0, 0.0],
                  [slope, 1.0, -slope * (view.x + cx)]], np.float32)
    scratch = _tilt_scratch(view.width, height)
    roi = canvas[view.y:view.bottom, view.x:view.right]
    cv2.warpAffine(roi, m, (view.width, height), dst=scratch,
                   flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    np.copyto(roi, scratch)


def _off_road(round_: RaceRound) -> bool:
    return abs(round_.player.x) > ROAD_HALF_WIDTH and round_.player.v > 6.0


def draw_world(canvas: np.ndarray, round_: RaceRound, now: float) -> None:
    view = Rect(0, 0, canvas.shape[1], canvas.shape[0])
    level = view.y + int(view.height * HORIZON)
    fx = _effects_for(round_)
    fx.sprites.clear()
    _note_slides(round_, fx, now)

    # Off the tarmac the whole camera jitters: leaving the road is felt in
    # the frame, not only read off the GRAVEL flag on the speedo.
    shake = 0
    if _off_road(round_):
        shake = int(round(math.sin(now * 47.0) * 2.0
                          + math.sin(now * 31.0) * 1.6))
    # The boost is FELT: two to four pixels of camera shake and a FOURTEEN
    # per cent field-of-view punch for as long as the exhaust burns, so the
    # frame itself lurches forward and the road mouth opens out instead of
    # the number on the speedo simply going up.
    rush = min(1.0, float(getattr(round_.player, "boost", 0.0)) / 1.1)
    if rush > 0.0:
        shake += int(round(math.sin(now * 61.0) * 2.4 * rush
                           + math.sin(now * 43.0) * 1.4 * rush))
    speed = round_.player.v / TOP_SPEED
    # CAMERA BOB. A kart at speed is a hard-sprung go-kart on a real surface,
    # and the camera bolted behind it never sits still: two to three rows of
    # vertical float, beating at the wheel rate, ramping in from a walking
    # pace. It is small on purpose - at three pixels it reads as the machine
    # being alive, at eight it reads as a rendering fault.
    if speed > 0.14:
        bob = min(1.0, (speed - 0.14) / 0.46)
        shake += int(round(math.sin(now * 13.7) * 1.9 * bob
                           + math.sin(now * 8.3 + 1.1) * 1.1 * bob))
    horizon = level + shake

    sky_h = max(level - view.y, 2)
    span = view.width + int(view.width * SKY_PAN)
    pan = _sky_pan(round_, span, view.width)
    canvas[view.y:level] = _sky(span, sky_h)[:, pan:pan + view.width]
    if shake > 0:
        canvas[level:horizon] = _far_band(view.width, horizon - level)

    rows = project(round_, view, shake, 1.0 + 0.14 * rush)
    _draw_ground(canvas, round_, rows, view, horizon, speed)
    _draw_skid_marks(canvas, round_, fx, rows, view, horizon)
    _apply_road_glare(canvas, view, level)
    # Haze belongs to the GROUND, and only the ground: applied by screen row
    # it is a distance cue for the road and the field, but it would dissolve
    # the top of any near prop that happens to reach the horizon band. So it
    # goes down before a single prop is drawn; props fade by their own depth.
    _apply_haze(canvas, view, horizon, level)
    # The camera BANKS into the bend. Everything from here down is placed
    # through _tilt_dy, so the props, the karts and the skyline all lean with
    # the horizon instead of standing upright on a tilted world.
    _set_tilt(view, horizon, round_.track.curvature_ahead(round_.player.s, 70.0))
    _tilt_horizon(canvas, view)

    length = round_.track.length
    # A sponsor board is a thing you READ, and one parked behind the driver's
    # helmet with its text sliced in half is worse than no board at all. The
    # hero kart's own footprint, grown by 80 px, joins the HUD's no-go zones.
    zones = _hud_zones(view) + (_player_zone(round_, rows, view, horizon),)
    layers: list[tuple[float, tuple]] = []
    far = PROP_HORIZON
    # The scenery is BINNED along the lap, so a frame walks the two hundred
    # metres of circuit in front of the camera instead of the whole two and a
    # half thousand. Three quarters of the list is behind the player on any
    # given frame, and testing it was costing more than drawing what was left.
    bins = _scenery_bins(round_.track)
    first = int(round_.player.s // _BIN) % len(bins)
    for b in range(int(far // _BIN) + 2):
        for s_obj, x_off, kind, variant in bins[(first + b) % len(bins)]:
            gap = (s_obj - round_.player.s) % length
            # Nothing is drawn nearer than the bottom screen row: a prop held
            # on the last row while the camera drives through it is sliced in
            # half by the frame edge, which reads as a bug and not as scenery.
            # And nothing small is drawn out past the depth where it is a
            # hazed pixel - the horizon is grandstands and trees, not coins.
            if NEAR_Z * 1.02 < gap < min(_PROP_REACH.get(kind, far), far):
                layers.append((gap, ("prop", kind, variant, x_off)))
    for kart, gap in _field_depths(round_):
        layers.append((gap, ("kart", kart)))
    layers.sort(key=lambda item: -item[0])
    # Speedlines are the ROAD SURFACE rushing past, so they belong to the road:
    # laid on the finished tarmac BEFORE the traffic, and therefore occluded by
    # anything standing on it. Painted over a kart instead - which is what they
    # used to be - they read as scratches on the picture rather than as speed,
    # and no amount of tapering or alpha rescues that.
    ys_all = sorted(rows)
    vanish = rows[ys_all[0]][1] if ys_all else None
    _speed_streaks(canvas, speed, view, rows, now)
    # Six frames of rays down the tarmac on the beat the slide cashes in -
    # laid into the GROUND with the rest of the speedlines, so the traffic and
    # the trackside furniture occlude them.
    if vanish is not None:
        _boost_lines(canvas, view, vanish, horizon, rows,
                     max(0.0, 1.0 - (now - fx.boost_flash) / 0.10))
    for gap, item in layers:
        if item[0] == "kart":
            _draw_kart(canvas, round_, item[1], gap, rows, view, now, fx, shake)
        else:
            _draw_prop(canvas, item[1], item[2], item[3], gap, rows, view,
                       horizon, now, speed, zones)

    # The radial smear is an artefact of the LENS, so it goes over everything
    # the lens saw - it is a blur, not a line, and blurs nothing into scratches.
    _speed_edges(canvas, view, horizon, speed, vanish)
    _draw_kart(canvas, round_, round_.player, PLAYER_SPRITE_Z, rows, view, now,
               fx, shake)
    # The nearest layer of all, drawn last so it passes IN FRONT of everything
    # including the hero kart: the roadside furniture at the edges of the
    # frame, rushing by at two and a half times the mid-ground's rate.
    _foreground(canvas, round_, rows, view, horizon, now)
    if round_.player.lap >= round_.laps - 1:
        # Warm the podium art off the render path: built on the frame the
        # flag falls it would cost a 100 ms stall at the best moment of the
        # race, and the drive loop would hand the field one huge step.
        _results_backdrop(view.width, view.height)


@lru_cache(maxsize=4)
def _grass_gradient(width: int, ground: int) -> tuple[np.ndarray, np.ndarray]:
    """The grass depth gradient: (full-width sheet, per-row mow-stripe tones)."""
    # LINEAR IN DEPTH, deliberately. A gamma on this ramp piles most of the
    # colour change into the first twenty rows below the horizon, and since
    # the mow squares laid over it take ONE tone per depth run, that is where
    # the field came out as a stack of flat green steps. Linear spreads the
    # same eighty levels over five hundred rows - a fifth of a level per row,
    # which no run length can turn into a visible edge.
    t = np.linspace(0.0, 1.0, max(ground, 2), dtype=np.float32)[:, None]
    top = np.array(GRASS_HORIZON, np.float32)
    bottom = np.array(GRASS_NEAR, np.float32)
    base = top + (bottom - top) * t
    sheet = np.repeat(base.astype(np.uint8)[:, None, :], max(width, 1), axis=1)
    # The mow stripes gain contrast as they come at the camera: barely a
    # shade apart at the horizon, a hard dark/light beat by the time they
    # pass the front wheels. That acceleration of detail is what makes the
    # ground plane rush rather than scroll.
    contrast = 0.960 - 0.155 * t
    return sheet, (base * contrast).astype(np.uint8)


def _draw_grass(canvas: np.ndarray, rows: dict, ys: list[int], view: Rect,
                horizon: int, player_s: float, length: float) -> None:
    """The field: a smooth warm-to-cool depth gradient, mow stripes that
    converge on the vanishing point and bend with the corners, and
    world-anchored mottle so the grass streams past instead of sitting still
    like a gradient fill."""
    y0, y1 = ys[0], ys[-1] + 1
    ground = max(y1 - y0, 1)
    sheet, stripe = _grass_gradient(view.width, ground)
    canvas[y0:y1, view.x:view.right] = sheet[:y1 - y0]
    # Mow stripes: fixed lanes either side of the road, projected through the
    # same rows as everything else, so they taper to the horizon like the
    # road. The depth segments are the SAME phase-scrolled bands the asphalt
    # runs on, and every other band is mown the other way - so the field is a
    # checker of light and dark squares that streams past the camera at speed
    # instead of a set of static rails converging on the horizon.
    runs: list[list[int]] = []
    mown: list[bool] = []
    prev = None
    for y in ys:
        band = int((player_s + rows[y][0]) / GRASS_BAND)
        # The floor on a run's height is what stops a far band dissolving
        # into a per-scanline checker - but it is also what quantises the
        # depth gradient, so out at the horizon, where the gradient moves
        # fastest and the checker is sub-pixel anyway, it is halved.
        floor = 6 if rows[y][2] < 30.0 else 12
        if prev is not None and (band == prev or len(runs[-1]) < floor):
            runs[-1].append(y)
        else:
            runs.append([y])
            mown.append(band & 1)
            prev = band
    for chunk, cut in zip(runs, mown):
        if len(chunk) < 2:
            continue
        a, b = chunk[0], chunk[-1]
        # A COMPRESSED FAR BAND IS NOT DRAWN. Deep into a bend, two hundred
        # units of road fold into four screen rows and the centreline swings
        # most of the frame width across them - so a mow square built from
        # those rows comes out as a huge pale TRIANGLE lying on the field,
        # nowhere near the track. Anything whose centre moves further than
        # the frame is wide across its own run is dropped whole.
        # And nothing is mown out past the depth where the belt of woodland
        # and the verge planting have the field covered: a checker square at
        # a hundred and fifty units, seen nearly edge on, is a long pale
        # TRIANGLE lying on the grass and nothing anyone would call a lawn.
        if abs(rows[a][1] - rows[b][1]) > view.width or rows[a][2] < 42.0:
            continue
        sample = (a, (a + b) // 2, b)
        # ONE array per parity, not one per lane. Every mow square is six
        # points, so the twenty of them a run lays are built as two flat
        # buffers and sliced into views: twenty numpy constructions a run,
        # times thirty runs a frame, was half a millisecond of pure list
        # parsing for a picture that is two fills.
        squares: tuple[list, list] = ([], [])
        for side in (-1.0, 1.0):
            for lane in range(2):
                # Wide lanes with a narrow gap, so the near grass reads as
                # mown TURF and not as a set of painted rails: the mow
                # pattern is the speed cue out here.
                u0 = 1.40 + lane * 2.05
                u1 = u0 + 1.34
                pts = [(rows[y][1] + side * u0 * rows[y][2], y)
                       for y in sample]
                pts += [(rows[y][1] + side * u1 * rows[y][2], y)
                        for y in reversed(sample)]
                # A CHECKER, not a set of bands: the cut alternates along the
                # lane as well as with depth, so the phase boundary is never a
                # single hard line ruled straight across the whole field.
                squares[(lane + cut) & 1].extend(pts)
        tone = stripe[(a + b) // 2 - y0]
        for parity, group in enumerate(squares):
            if not group:
                continue
            _fill(canvas, list(_fp(group).reshape(-1, 6, 2)),
                  tuple(int(c * (1.0 if parity else 0.925)) for c in tone),
                  cv2.LINE_8)
    # Low-frequency mottle, anchored to the track so the patches slide by
    # with everything else - a speed cue as much as a texture.
    n = max(view.bottom - horizon, 1)
    for i in range(26):
        s_m = (i * 60.1) % length
        gap = (s_m - player_s) % length
        if not NEAR_Z * 1.15 < gap < 330.0:
            continue
        y = min(horizon + int(n * NEAR_Z / gap), view.bottom - 1)
        got = rows.get(y)
        if got is None:
            continue
        _, centre, half = got
        hsh = (i * 2654435761) & 0xFFFFFFFF
        side = -1.0 if hsh & 1 else 1.0
        u = 1.7 + ((hsh >> 4) % 1000) / 1000.0 * 5.4
        px = int(centre + side * u * half)
        if not view.x - half * 0.3 < px < view.right + half * 0.3:
            continue
        sx = min(max(px, view.x), view.right - 1)
        base = canvas[y, sx].astype(np.int32)
        tone = 0.90 if (hsh >> 14) & 1 else 1.08
        colour = tuple(int(min(255, c * tone)) for c in base)
        ax = max(2, int(half * (0.10 + ((hsh >> 16) % 8) * 0.02)))
        cv2.ellipse(canvas, (px, y), (ax, max(1, int(ax * 0.22))), 0, 0, 360,
                    colour, -1)


def _tar(d: float, amp: float) -> tuple[int, int, int]:
    """The asphalt tone at world distance ``d`` - a CONTINUOUS function.

    The light/dark cycle is a sine of the distance down the road, not a step
    per ten-unit band, and the patchiness on top of it is two more sines at
    incommensurate beats. Nothing here can produce a horizontal edge, which is
    the whole point: the road used to be a stack of flat slabs and every seam
    between them read as a quantisation stair.
    """
    beat = math.sin(d * (math.pi / BAND)) * amp
    patch = 2.1 * math.sin(d * 0.081) + 1.5 * math.sin(d * 0.213 + 1.7)
    return (
        int(min(255.0, max(0.0, ROAD_MID[0] + (ROAD_A[0] - ROAD_MID[0]) * beat + patch))),
        int(min(255.0, max(0.0, ROAD_MID[1] + (ROAD_A[1] - ROAD_MID[1]) * beat + patch))),
        int(min(255.0, max(0.0, ROAD_MID[2] + (ROAD_A[2] - ROAD_MID[2]) * beat + patch))),
    )


#: The far woodland standing between the field and the skyline: a cool,
#: hazed green that has to sit BETWEEN the lit horizon grass above it and the
#: rich near grass below, or it reads as a stripe rather than as distance.
WOODS_DEEP = (86, 132, 96)
WOODS_LIT = (118, 176, 130)


def _far_woods(canvas: np.ndarray, view: Rect, horizon: int, track: Track,
               player_s: float) -> None:
    """A BELT OF TREES right across the far field, under the skyline.

    Between the grandstands on the horizon and the hedges beside the track
    there used to be a hundred and fifty rows of open mown grass spanning the
    whole frame - the flat green lawn that made the picture read as a painted
    backdrop with a kart stuck on it. A circuit sits in a landscape: there is
    always a wood, a windbreak or a plantation between the far field and the
    skyline. This is that belt, in screen space because it is far enough away
    that perspective has nothing left to say about it, with a crown built from
    two beats keyed to the distance travelled and a pan keyed to the compass
    heading - so it drifts and reshapes as the lap turns instead of being the
    same silhouette in every frame.
    """
    table, ds = _headings(track)
    a = float(table[int(player_s / ds) % len(table)])
    band = max(6, int(view.height * 0.058))
    base = horizon + int(band * 0.74)
    # SAMPLED FINE ENOUGH FOR THE CANOPY BEAT. At a step of forty pixels the
    # highest of the three sines is undersampled and the crown comes out as
    # long straight diagonals - a huge pale wedge lying across the field
    # rather than a treeline.
    step = max(10, view.width // 84)
    pan = math.sin(a) * view.width * 0.35 + player_s * 0.42
    crown: list[tuple[int, int]] = []
    for x in range(view.x - step, view.right + step * 2, step):
        u = (x + pan) * 0.011
        h = band * (0.40 + 0.30 * math.sin(u) + 0.20 * math.sin(u * 2.37 + 1.1)
                    + 0.22 * math.sin(u * 6.10 + 0.4))
        crown.append((x, base - int(h)))
    poly = np.array(crown + [(view.right + step * 2, base + band),
                             (view.x - step, base + band)], np.int32)
    cv2.fillPoly(canvas, [poly], WOODS_DEEP, cv2.LINE_AA)
    # One lit stroke along the top, where the low sun grazes the canopy.
    cv2.polylines(canvas, [np.array(crown, np.int32)], False, WOODS_LIT,
                  max(2, band // 7), cv2.LINE_AA)


def _draw_ground(canvas: np.ndarray, round_: RaceRound, rows: dict, view: Rect,
                 horizon: int, speed: float = 0.0) -> None:
    """Grass, asphalt bands, racing line, rumble strips, lane dashes, grid.

    Rows are grouped into their light/dark bands and each band becomes a few
    filled polygons, so a frame costs ~50 fillPoly batches instead of a call
    per scanline.
    """
    if not rows:
        canvas[horizon:view.bottom] = GRASS_B
        return
    ys = sorted(rows)
    if ys[0] > horizon:  # the sliver beyond the draw distance
        canvas[horizon:ys[0]] = _far_band(view.width, ys[0] - horizon)

    track = round_.track
    player_s = round_.player.s
    # The projected road as three columns in row order - depth, centre, half
    # width - so the shapes that span whole runs of rows are built by slicing
    # an array instead of by walking the dict a tuple at a time.
    grid = np.array([rows[y] for y in ys], np.float64)
    zs, cs, hs = grid[:, 0], grid[:, 1], grid[:, 2]
    yf = np.array(ys, np.float64)
    _draw_grass(canvas, rows, ys, view, horizon, player_s, track.length)
    _far_woods(canvas, view, horizon, track, player_s)
    runs: list[list[int]] = []
    for idx, y in enumerate(ys):
        band = int((player_s + rows[y][0]) / BAND)
        if runs and runs[-1][0] == band:
            runs[-1][2] = idx + 1
        else:
            runs.append([band, idx, idx + 1])

    aprons: list[np.ndarray] = []
    runoff: list[np.ndarray] = []
    rumble_a: list[np.ndarray] = []
    rumble_b: list[np.ndarray] = []
    dashes: list[np.ndarray] = []
    grooves_n: list[np.ndarray] = []
    grooves_f: list[np.ndarray] = []
    rails: list[tuple[list[int], bool]] = []
    last_col: tuple[int, int, int] | None = None
    n_ys = len(ys)
    # The light/dark beat gains a LITTLE contrast with speed - enough that the
    # surface breathes, nowhere near enough to strobe.
    amp = 1.0 + 0.8 * max(0.0, speed - 0.28)
    for band, i_a, i_b in runs:
        band_ys = ys[i_a:i_b]
        # No edge marking without a road under it. A band this far out is
        # sub-pixel wide, and its lane dash or kerb tooth would land in the
        # field on its own as a white splinter with no asphalt beside it.
        if rows[band_ys[-1]][2] < 1.0:
            continue
        even = band % 2 == 0
        count = len(band_ys)
        # Sampled every THREE rows at most, however tall the band is, and
        # every edge below is then laid at a sixteenth of a pixel. The old
        # seven-row stride left the kerb teeth, the white line and the apron
        # as long straight chords with a whole-pixel step at each joint -
        # the staircase that was the loudest tell in the whole frame.
        stride = max(1, min(count // 8, 6))
        sample = band_ys[::stride]
        if sample[-1] != band_ys[-1]:
            sample.append(band_ys[-1])
        # Red-and-white teeth the whole way round, laid in world-anchored
        # blocks so the kerb STROBES past the camera at speed - and swelling
        # through the bends, where the outer kerb is also BANKED: wider than
        # the inner one and rising away from the tarmac, which is what makes
        # a corner announce itself half a straight away.
        mid_z = rows[sample[len(sample) // 2]][0]
        # Averaged a little way ahead, so the kerb GROWS into the bend over
        # the last twenty units instead of snapping wide at the segment seam.
        turn = track.curvature_ahead(player_s + mid_z, 20.0)
        bend = min(1.0, abs(turn) / 0.006)
        signed = max(-1.0, min(1.0, turn / 0.006))
        # Positive curvature bends right, so on a right-hander the LEFT kerb
        # is the outer one: wider, and lifted at its outboard edge.
        bank = (1.0 + 0.62 * max(0.0, signed), 1.0 + 0.62 * max(0.0, -signed))
        rw_f = 0.058 + 0.112 * bend

        # The run-off apron: sealed pale gravel from the road edge out past
        # the guard rail, both sides, all the way round. A racetrack has a
        # SHOULDER; a road through a field has grass up to the white line,
        # and that difference is half of why this read as a country lane.
        # Through a bend the INSIDE shoulder opens out into a full run-off
        # bed, twice as deep as the straight-line apron and SCALLOPED along
        # its outer edge - the lobed gravel trap every circuit lays on the
        # apex, and the thing that stops the inside of a corner reading as
        # nothing but mown lawn.
        wide_l = 1.36 + 1.34 * max(0.0, -signed)
        wide_r = 1.36 + 1.34 * max(0.0, signed)
        # The scallop only exists where the bed is wide, so a straight pays
        # nothing at all for it - and a straight is most of a lap.
        coarse = sample[::2]
        if coarse[-1] != sample[-1]:
            coarse.append(sample[-1])
        ones = [1.0] * len(coarse)
        scal_l = ones if signed > -0.05 else [
            1.0 - 0.13 * signed * math.sin((player_s + rows[y][0]) * 0.62)
            for y in coarse]
        scal_r = ones if signed < 0.05 else [
            1.0 + 0.13 * signed * math.sin((player_s + rows[y][0]) * 0.62 + 1.9)
            for y in coarse]
        aprons.append(_fp(
            [(rows[y][1] - rows[y][2] * wide_l * k, y)
             for y, k in zip(coarse, scal_l)]
            + [(rows[y][1] - rows[y][2], y) for y in reversed(coarse)]))
        aprons.append(_fp(
            [(rows[y][1] + rows[y][2], y) for y in coarse]
            + [(rows[y][1] + rows[y][2] * wide_r * k, y)
               for y, k in zip(reversed(coarse), reversed(scal_r))]))
        # THE RUN-OFF STRIP, inside the kerb: green and white bands laid on
        # the sealed shoulder, world-anchored so they rush past with the
        # teeth. It is what fills the dead ground between the white line and
        # the grass, and it is on every circuit ever built.
        kblocks = _kerb_blocks(band_ys, rows, player_s) \
            if len(band_ys) >= 8 else ()
        # The kerb teeth reach out to 1 + rw_f * bank half-widths, so the strip
        # starts OUTBOARD of the widest tooth and runs to just inside the
        # guard rail; on a straight that is a hand's width of banding, through
        # a bend the whole opened-out shoulder carries it.
        if kblocks and rows[band_ys[-1]][2] > 18.0:
            u_in = min(1.0 + rw_f * max(bank), 1.15)
            u_out = (min(wide_l, 1.33), min(wide_r, 1.33))
            for chunk, red in kblocks:
                if red:      # the green bands sit BETWEEN the kerb's teeth
                    continue
                ck = _ends(chunk)
                for k, sgn in enumerate((-1.0, 1.0)):
                    runoff.append(_fp(
                        [(rows[y][1] + sgn * rows[y][2] * u_in, y)
                         for y in ck]
                        + [(rows[y][1] + sgn * rows[y][2] * u_out[k], y)
                           for y in reversed(ck)]))

        # THE ASPHALT, LERPED PER SCANLINE. The band is cut into quads nine
        # rows deep, each one taking the continuous tone at its own depth and
        # overlapping the next by a row so no antialiased seam can show. What
        # used to be two flat slabs a hundred rows tall is now twenty-five
        # steps of well under one luminance level: no stair, no quantisation.
        # SUN AND SHADE ACROSS THE ROAD: the low sun sits off to the right, so
        # the right-hand half of the tarmac takes a warm cast and the left a
        # cool one, split at the racing line where the seam hides under rubber.
        wide = rows[band_ys[-1]][2] > 55.0
        colour = _tar(player_s + rows[band_ys[count // 2]][0], amp)
        for i0 in range(i_a, i_b, ROAD_SUB):
            i1 = min(i0 + ROAD_SUB + 1, n_ys)
            span = i1 - i0
            tone = _tar(player_s + zs[i0 + (span // 2 if span >= 2 else 0)], amp)
            if span < 2:      # a one-row band still needs two rows of quad
                cen, hlf, yy = (np.repeat(cs[i0:i0 + 1], 2),
                                np.repeat(hs[i0:i0 + 1], 2),
                                np.repeat(yf[i0:i0 + 1], 2))
            else:
                cen, hlf, yy = cs[i0:i1], hs[i0:i1], yf[i0:i1]
            m = cen.shape[0]
            quad = np.empty((2 * m, 2), np.float64)
            quad[:m, 1] = yy
            quad[m:, 1] = yy[::-1]
            if wide:
                seam = cen + hlf * 0.02
                quad[:m, 0] = cen - hlf
                quad[m:, 0] = seam[::-1]
                cv2.fillPoly(canvas, [_fp_arr(quad)],
                             (int(tone[0] * 1.045), tone[1], int(tone[2] * 0.960)),
                             cv2.LINE_8, SHIFT)
                quad[:m, 0] = seam
                quad[m:, 0] = (cen + hlf)[::-1]
                cv2.fillPoly(canvas, [_fp_arr(quad)],
                             (int(tone[0] * 0.955), tone[1], min(255, int(tone[2] * 1.045))),
                             cv2.LINE_8, SHIFT)
                # ORDERED DITHER on the seam row, near field only: every other
                # pixel of the first row keeps the tone above it, so even the
                # sub-level step between two quads is broken up rather than
                # laid down as a clean horizontal edge.
                if last_col is not None and hs[i0] > 150.0:
                    lo_d = max(view.x, int(cen[0] - hlf[0]))
                    hi_d = min(view.right, int(cs[i0] + hs[i0]))
                    if hi_d - lo_d > 6:
                        canvas[ys[i0], lo_d:hi_d:2] = last_col
            else:
                quad[:m, 0] = cen - hlf
                quad[m:, 0] = (cen + hlf)[::-1]
                cv2.fillPoly(canvas, [_fp_arr(quad)], tone, cv2.LINE_8, SHIFT)
            last_col = tone

        # The rubbered racing line, drifting to the inside of the next bend.
        # The bias is sampled per ROW, not per band: one constant offset per
        # band made the line jump sideways at every seam.
        rubber = tuple(int(c * 0.86) for c in colour)
        # Two curvature probes per band, lerped across it. The bias moves
        # smoothly with depth by construction, so sampling it per row was
        # eight hundred track queries a frame for a result that differs in the
        # third decimal - and the line still never jumps at a seam.
        n_s = len(sample)
        b_0 = max(-0.30, min(0.30, track.curvature_ahead(
            player_s + rows[sample[0]][0], 36.0) * 46.0))
        b_1 = b_0 if n_s < 2 else max(-0.30, min(0.30, track.curvature_ahead(
            player_s + rows[sample[-1]][0], 36.0) * 46.0))
        biases = [b_0 + (b_1 - b_0) * (k / max(n_s - 1, 1)) for k in range(n_s)]
        line_poly = _fp(
            [(rows[y][1] + (b - 0.26) * rows[y][2], y)
             for y, b in zip(sample, biases)]
            + [(rows[y][1] + (b + 0.26) * rows[y][2], y)
               for y, b in zip(reversed(sample), reversed(biases))])
        cv2.fillPoly(canvas, [line_poly], rubber, cv2.LINE_8, SHIFT)
        # THE WHEEL GROOVES. Two darker tracks either side of the racing line,
        # where every kart of the weekend has put its tyres: the thing that
        # says the tarmac has been DRIVEN on, and the cue that tells a driver
        # where the line actually is without a painted arrow. Batched, so a
        # hundred of them cost two fills.
        if rows[band_ys[-1]][2] > 34.0:
            target = grooves_n if rows[band_ys[-1]][2] > 46.0 else grooves_f
            gs, gb = sample[::2], biases[::2]
            if gs[-1] != sample[-1]:
                gs, gb = gs + [sample[-1]], gb + [biases[-1]]
            for sgn in (-1.0, 1.0):
                target.append(_fp(
                    [(rows[y][1] + (b + sgn * GROOVE_OFF - GROOVE_W)
                      * rows[y][2], y) for y, b in zip(gs, gb)]
                    + [(rows[y][1] + (b + sgn * GROOVE_OFF + GROOVE_W)
                        * rows[y][2], y)
                       for y, b in zip(reversed(gs), reversed(gb))]))

        # The white edge line, flush against the tarmac on both sides: the
        # kerb teeth are laid OUTBOARD of it, exactly as they are on a real
        # circuit, so the road never loses its painted boundary.
        for sgn in (-1.0, 1.0):
            rumble_b.append(_fp(
                [(rows[y][1] + sgn * rows[y][2],
                  y) for y in sample]
                + [(rows[y][1] + sgn * (rows[y][2]
                                        + max(1.6, rows[y][2] * rw_f * 0.34)), y)
                   for y in reversed(sample)]))
        if kblocks:
            # Red-and-white blocks 1.5 world units long, world-anchored, so
            # the teeth rush past instead of sitting still. Through a bend
            # the outer kerb widens and its outboard lip lifts off the road.
            for chunk, red in kblocks:
                target = rumble_a if red else rumble_b
                ck = _ends(chunk)
                for k, sgn in enumerate((-1.0, 1.0)):
                    bk = bank[k]
                    ce = [(rows[y][1] + sgn * rows[y][2],
                           max(2.0, rows[y][2] * rw_f) * bk,
                           max(2.0, rows[y][2] * rw_f) * (bk - 1.0) * 0.75, y)
                          for y in ck]
                    inner = max(1.6, rows[chunk[0]][2] * rw_f * 0.34)
                    target.append(_fp(
                        [(e + sgn * inner, y) for e, _, _, y in ce]
                        + [(e + sgn * rw, y - lift)
                           for e, rw, lift, y in reversed(ce)]))
        elif rows[band_ys[-1]][2] >= 2.0:
            for sgn in (-1.0, 1.0):
                (rumble_a if even else rumble_b).append(_fp(
                    [(rows[y][1] + sgn * rows[y][2], y) for y in sample]
                    + [(rows[y][1] + sgn * (rows[y][2]
                                            + max(2.0, rows[y][2] * rw_f)), y)
                       for y in reversed(sample)]))
        # The guard rail is a straight ribbon standing on the road edge; it
        # needs a third of the vertices the apron's scalloped bed does. And,
        # exactly as with the mow squares, a band whose centreline swings the
        # width of the frame across four compressed far rows is dropped: the
        # rail built from it came out as a pale horizontal wire ruled clean
        # across the field, which is a stray line and nothing else.
        if abs(rows[coarse[0]][1] - rows[coarse[-1]][1]) <= view.width * 0.80:
            rails.append((coarse[::2] + [coarse[-1]] if len(coarse) > 3
                          else coarse, even))
        # A tar seam at the far edge of every band: cheap asphalt texture.
        # One row of the band, so it is measured rather than tabulated - the
        # whole-band edge table this used to build was thirty lists a frame of
        # which only the first entry was ever read.
        y0 = sample[0]
        _, c0, h0 = rows[y0]
        lo0, hi0 = c0 - h0, c0 + h0
        if hi0 > lo0:
            cv2.line(canvas, (max(int(lo0), view.x), y0),
                     (min(int(hi0), view.right - 1), y0), ROAD_SEAM, 1)
        # Asphalt speckle, deterministic per band so it scrolls with the road.
        if count >= 7:
            seed = (band * 2654435761) & 0xFFFF
            for k in range(6):
                hsh = ((seed ^ (k * 40503)) * 2246822519) & 0xFFFFFFFF
                yy = band_ys[hsh % count]
                xn = ((hsh >> 8) % 1000) / 500.0 - 1.0
                gx = int(rows[yy][1] + xn * rows[yy][2] * 0.94)
                if view.x + 1 <= gx < view.right - 1:
                    tone = -16 if hsh & 1 else 13
                    canvas[yy, gx - 1:gx + 2] = tuple(
                        int(min(255, max(0, c + tone))) for c in colour)
    # The NEAR BEAT. Perspective squeezes the whole ten-unit light/dark cycle
    # into half a band across the bottom third of the frame, so on a straight
    # the foreground tarmac sat still however fast the speedo read. These are
    # the transverse joints between slabs, laid every third of a band through
    # the near field only, each one a quad that thickens as it comes at the
    # camera - and world-anchored, so they RUSH.
    if grooves_f:
        cv2.fillPoly(canvas, grooves_f, tuple(int(c * 0.925) for c in ROAD_MID),
                     cv2.LINE_AA)
    if grooves_n:
        cv2.fillPoly(canvas, grooves_n, tuple(int(c * 0.885) for c in ROAD_MID),
                     cv2.LINE_AA)
    _near_seams(canvas, rows, ys, view, player_s, speed)
    _fill(canvas, aprons, APRON)
    _fill(canvas, runoff, RUNOFF)
    _fill(canvas, rumble_a, RUMBLE_A)
    _fill(canvas, rumble_b, RUMBLE_B)
    _centre_dashes(canvas, rows, ys, player_s, dashes)

    _paint_start_line(canvas, rows, view, player_s, round_.track.length)
    _paint_grid(canvas, round_, rows, view, horizon)
    _verge_mass(canvas, rows, ys, view, player_s)
    _draw_barriers(canvas, rows, rails, view)
    _spectator_fence(canvas, rows, rails, view, player_s)
    _draw_bunting(canvas, rows, view, horizon, player_s)


#: The dashed centre line's cycle, in world units, and the fraction of it the
#: paint covers at the horizon and at the front wheels. A dash of a fixed
#: world length is a dash of a fixed SCREEN length once perspective has had
#: it, which is exactly the flat, speed-free centre line the old road had;
#: stretching the duty cycle toward the camera makes the near dashes run
#: nearly twice as long as the far ones and the line itself rush.
DASH_CYCLE = 2.0 * BAND
DASH_FAR, DASH_NEAR = 0.40, 0.80


def _centre_dashes(canvas: np.ndarray, rows: dict, ys: list[int],
                   player_s: float, out: list) -> None:
    """The centre line, laid as world-anchored dashes that STRETCH with depth."""
    run: list[int] = []
    for y in ys:
        z, _, half = rows[y]
        if half < 1.4:
            run = []
            continue
        near = min(1.0, max(0.0, (half - 14.0) / 150.0))
        duty = DASH_FAR + (DASH_NEAR - DASH_FAR) * near
        u = (player_s + z) / DASH_CYCLE
        if u - math.floor(u) < duty:
            run.append(y)
            continue
        if len(run) >= 2:
            out.append(_dash_poly(rows, run))
        run = []
    if len(run) >= 2:
        out.append(_dash_poly(rows, run))
    _fill(canvas, out, LINE)


def _dash_poly(rows: dict, run: list[int]) -> np.ndarray:
    sample = run[::3]
    if sample[-1] != run[-1]:
        sample.append(run[-1])
    return _fp([(rows[y][1] - max(0.8, rows[y][2] * 0.021), y) for y in sample]
               + [(rows[y][1] + max(0.8, rows[y][2] * 0.021), y)
                  for y in reversed(sample)])


def _near_seams(canvas: np.ndarray, rows: dict, ys: list[int], view: Rect,
                player_s: float, speed: float) -> None:
    """Transverse slab joints across the near tarmac, anchored to the world.

    Laid every four fifths of a unit, and then thinned by SCREEN spacing: the
    perspective piles the whole bottom third of the frame into two world units,
    so a joint every ten units - which is what the light/dark band cycle comes
    to - left the foreground tarmac dead still at 170 km/h. Culling by pixel
    gap instead keeps them a steady twenty-six pixels apart down the whole
    near field while every one of them stays nailed to the road.
    """
    if speed < 0.10:
        return
    step = 0.8
    gap = max(24.0, view.height * 0.045)
    seams: list[np.ndarray] = []
    last_block, last_y = -1, view.bottom + 999
    for y in reversed(ys):                    # near row first
        z, centre, half = rows[y]
        if z > 34.0 or half < 8.0:
            break
        block = int((player_s + z) / step)
        if block == last_block or last_y - y < gap:
            continue
        last_block, last_y = block, y
        thick = max(1.5, half * 0.020)
        seams.append(_fp(
            [(centre - half, y), (centre + half, y),
             (centre + half, y + thick), (centre - half, y + thick)]))
    _fill(canvas, seams, (100, 110, 126))


#: One checkered kerb block, in world units. A real apex kerb is laid in
#: blocks about this long; anything much finer strobes at speed.
KERB_BLOCK = 1.5


def _kerb_blocks(band_ys: list[int], rows: dict,
                 player_s: float) -> list[tuple[list[int], bool]]:
    """Split a band's rows into 1.5-unit kerb blocks, alternating red/white.

    Rows are merged up to a floor of three so a distant band never dissolves
    into a per-scanline checker, which strobes; below that the caller keeps
    the plain band alternation instead.
    """
    out: list[tuple[list[int], bool]] = []
    prev = None
    for y in band_ys:
        block = int((player_s + rows[y][0]) / KERB_BLOCK)
        if prev is not None and (block == prev or len(out[-1][0]) < 3):
            out[-1][0].append(y)
        else:
            out.append(([y], block % 2 == 0))
            prev = block
    # Every quad needs a far edge and a near edge; a one-row block is a line.
    return [(chunk, red) for chunk, red in out if len(chunk) >= 2]


#: The verge planting: a deep bottle green in shade, a lime crown where the
#: low sun grazes the top of the hedge, and a smoky far tone for the second
#: rank behind it.
VERGE_DARK = (34, 78, 48)
VERGE_LIT = (74, 158, 96)
VERGE_FAR = (64, 114, 78)


def _verge_mass(canvas: np.ndarray, rows: dict, ys: list[int], view: Rect,
                player_s: float) -> None:
    """UNBROKEN PLANTING BEHIND THE GUARD RAIL, both sides, all the way round.

    Everything trackside used to be a discrete prop standing at one and a half
    road widths out, which meant that on a straight the band of the picture
    between the barrier and the skyline was open mown field - a flat green
    lawn spanning the full width of the frame, the same in every frame,
    reading as the backdrop of a postcard rather than as somewhere the camera
    is travelling through. A real circuit is HEDGED: a continuous run of
    planting stands behind the wall the whole way round, and because it is
    world-anchored its crown bumps past the camera at exactly the rate the
    kerb does. Two ribbons - a smoky far rank and a near one in front of it -
    and the middle third of the frame has depth in it instead of paint.
    """
    if len(ys) < 6:
        return
    step = max(2, len(ys) // 12)
    sample = ys[::step]
    if sample[-1] != ys[-1]:
        sample.append(ys[-1])
    if len(sample) < 4:
        return
    for out, height, tone, beat in ((2.24, 0.56, VERGE_FAR, 0.29),
                                    (1.66, 0.44, VERGE_DARK, 0.41)):
        near = out < 2.0
        for side in (-1, 1):
            top: list[tuple[float, float]] = []
            foot: list[tuple[float, float]] = []
            lobes: list[tuple[int, int, float]] = []
            for k, y in enumerate(sample):
                z, centre, half = rows[y]
                if half < 2.5:
                    continue
                x = centre + side * half * out
                if not (view.x - half * 3.0 < x < view.right + half * 3.0):
                    continue
                # TWO BEATS, and the second one is the important one. A crown
                # scalloped on world distance alone comes out dead flat in the
                # near field, where fifty screen rows cover two units of road -
                # a green slab with a ruler-straight top. The per-sample term
                # puts a clipped lobe on every vertex whatever the depth.
                bump = (1.0 + 0.26 * math.sin((player_s + z) * beat + side * 1.7)
                        + 0.20 * math.sin(k * 2.31 + player_s * 0.5 + side))
                ty = y - half * height * bump
                top.append((x, ty))
                foot.append((x, y + half * 0.06))
                lobes.append((int(x), int(ty), half))
            if len(top) < 3:
                continue
            _fill(canvas, [_fp(top + foot[::-1])], tone, cv2.LINE_8)
            # A stroke along the crown, catching the low sun. Without it the
            # far rank is a flat pale plane receding to the vanishing point -
            # a wedge of paint lying on the field, not a run of planting.
            cv2.polylines(canvas, [np.array(top, np.int32)], False,
                          _mix(tone, VERGE_LIT, 0.72 if near else 0.42),
                          max(2, int(rows[sample[len(sample) // 2]][2] * 0.030)),
                          cv2.LINE_8)
            if not near:
                continue
            # Clipped lobes along the crown, each catching the low sun on its
            # sun-facing shoulder: what turns a green wedge into a hedge that
            # somebody has actually cut.
            for hx, hy, half in lobes:
                if not view.x - 80 < hx < view.right + 80:
                    continue
                lr = max(2, min(64, int(half * 0.115)))
                cv2.circle(canvas, (hx, hy + lr // 2), lr, tone, -1,
                           cv2.LINE_8)
                if lr > 3:
                    # Kept INSIDE the lobe it lights. Struck at the lobe's own
                    # radius and offset outward, the arc hung clear of the
                    # hedge on its sun side and drew a bright green ring lying
                    # on open grass.
                    cv2.ellipse(canvas, (hx + lr // 5, hy + lr // 2),
                                (int(lr * 0.76), int(lr * 0.60)), 0, 200, 340,
                                VERGE_LIT, max(1, lr // 4), cv2.LINE_8)


def _draw_barriers(canvas: np.ndarray, rows: dict,
                   rails: list[tuple[list[int], bool]], view: Rect) -> None:
    """Striped guard rails standing along both edges of the circuit.

    One quad per light/dark band per side, so the wall is a continuous ribbon
    of red and white running to the vanishing point - the single strongest cue
    that the road is a RACETRACK and not a country lane. Drawn far-to-near
    (``rails`` arrives in that order) so the nearer bands overlap correctly.
    """
    shadows: list[np.ndarray] = []
    faces_a: list[np.ndarray] = []
    faces_b: list[np.ndarray] = []
    caps: list[np.ndarray] = []
    rims: list[np.ndarray] = []
    skirts: list[np.ndarray] = []
    for sample, even in rails:
        for side in (-1, 1):
            top: list[tuple[int, int]] = []
            foot: list[tuple[int, int]] = []
            cap: list[tuple[int, int]] = []
            base: list[tuple[int, int]] = []
            shade: list[tuple[int, int]] = []
            rim: list[tuple[float, float]] = []
            for y in sample:
                _, centre, half = rows[y]
                x = centre + side * half * 1.26
                bh = max(2.0, half * 0.165)
                cap_h = max(1.0, half * 0.026)
                top.append((x, y - bh))
                foot.append((x, y - cap_h))
                cap.append((x, y - bh - cap_h))
                rim.append((x, y - bh - cap_h * 1.75))
                base.append((x, y))
                # The low sun is on the right: every wall lays a shadow to
                # the screen left, which is what plants it on the grass.
                shade.append((x - half * 0.09, y))
            if len(top) < 2:
                continue
            # The five ribbons of one rail section are the same five points
            # walked five ways, so they are parsed ONCE and sliced into views.
            arr = _fp(base + shade[::-1] + top + foot[::-1] + cap + top[::-1]
                      + rim + cap[::-1] + foot + base[::-1]
                      ).reshape(5, 2 * len(top), 2)
            shadows.append(arr[0])
            (faces_a if even else faces_b).append(arr[1])
            caps.append(arr[2])
            rims.append(arr[3])
            skirts.append(arr[4])
    # The rail stands on the gravel apron now, so its shadow is a neutral
    # grey rather than the deep green it used to lay on the turf.
    _fill(canvas, shadows, (98, 116, 138), cv2.LINE_8)
    _fill(canvas, faces_a, BARRIER_A)
    _fill(canvas, faces_b, BARRIER_B)
    _fill(canvas, skirts, (74, 78, 92), cv2.LINE_8)
    _fill(canvas, caps, BARRIER_TOP)
    # THE SUN ON THE WALL. The low sun sits on the horizon, so the top lip of
    # every barrier panel takes a warm cream rim - two pixels of directional
    # light down the whole length of the circuit, for one batched fill.
    _fill(canvas, rims, RIM_CREAM)


#: How far out on the grass the public stand, in road half-widths, and how
#: tall their fence is as a fraction of the road's own half-width at that
#: depth. Far enough back that the racing surface is never crowded, near
#: enough that the deep field has PEOPLE in it.
#: Both ranks used to stand a long way out - the far one at more than ten
#: half-widths - and deep into a bend that put a pale top rail sweeping the
#: whole width of the frame across open field, hundreds of pixels from
#: anything, reading as a wire ruled across the picture. The crowd is now
#: pulled in behind the verge planting where it belongs.
#: ONE rank, not two. The second stood behind the first, behind the verge
#: planting, and behind the belt of woodland - three hundred pixels of pale
#: rail per frame that the picture never showed and the budget always paid.
FENCE_RANKS = ((3.6, 0.175),)
FENCE_MESH = (86, 112, 92)
FENCE_RAIL = (206, 212, 218)
#: The public: pastel two-pixel dots along the fence line. Anchored to the
#: world by a hash of the band, so the crowd streams past with the scenery
#: instead of shimmering in place.
_FENCE_CROWD = ((92, 108, 244), (238, 206, 108), (128, 226, 250),
                (222, 140, 158), (110, 224, 168), (232, 236, 244),
                (168, 116, 240), (250, 244, 226))


def _spectator_fence(canvas: np.ndarray, rows: dict,
                     rails: list[tuple[list[int], bool]], view: Rect,
                     player_s: float) -> None:
    """A crowd fence standing out on the deep grass, both sides of the circuit.

    The band between the treeline and the guard rail used to be a fifth of
    the frame with nothing in it: one flat lime field and three shrubs. A
    circuit at sunset has PEOPLE in that band, leaning on a mesh fence -
    so here is the fence, depth-scaled through the same projection as
    everything else, with a pale top rail catching the low sun and forty-odd
    two-pixel heads scattered along it.
    """
    mesh: list[np.ndarray] = []
    rail: list[np.ndarray] = []
    posts: list[np.ndarray] = []
    heads: list[tuple[tuple[int, int], int, tuple[int, int, int]]] = []
    for sample, _even in rails:
        half0 = rows[sample[0]][2]
        # Only the mid-distance: nearer than this the fence is off the frame
        # edge, further than this it is a hazed pixel.
        if not 6.0 < half0 < 340.0 or len(sample) < 2:
            continue
        mid = sample[len(sample) // 2]
        band = int((player_s + rows[sample[0]][0]) * 0.4)
        # A fence is a straight run of mesh: two vertices in three are wasted
        # on it, and this pass runs over every band of the road.
        span = sample[::2]
        if span[-1] != sample[-1]:
            span.append(sample[-1])
        for rank, (out, hf) in enumerate(FENCE_RANKS):
            fh = max(2.0, half0 * hf)
            # A run that swings most of the frame across its own handful of
            # compressed rows is not a fence receding, it is a horizontal
            # stray line. Dropped whole.
            if abs(rows[span[0]][1] - rows[span[-1]][1]) \
                    + abs(rows[span[0]][2] - rows[span[-1]][2]) * out \
                    > view.width * 0.60:
                continue
            for side in (-1.0, 1.0):
                top: list[tuple[float, float]] = []
                foot: list[tuple[float, float]] = []
                cap: list[tuple[float, float]] = []
                for y in span:
                    _, centre, half = rows[y]
                    x = centre + side * half * out
                    top.append((x, y - fh))
                    cap.append((x, y - fh * 1.16))
                    foot.append((x, y))
                if not (view.x - 140 < top[0][0] < view.right + 140):
                    continue
                mesh.append(_fp(top + foot[::-1]))
                rail.append(_fp(cap + top[::-1]))
                # A HEAD NEEDS A BODY UNDER IT. Below about a dozen pixels of
                # fence the mesh is a hairline and the spectators come out as
                # two-pixel coloured diamonds hovering in mid-air over the far
                # barrier, attached to nothing. The crowd now starts where the
                # fence is tall enough to hold it and the horizon carries the
                # far terraces instead.
                if fh > 12.0 and len(heads) < 54:
                    _, centre, half = rows[mid]
                    # ON the fence, not hovering a head's height above it:
                    # at 1.26 the shoulders cleared the top rail entirely and
                    # the crowd read as a row of lollipops on sticks.
                    yy = int(mid - fh * 0.96)
                    step = max(3.0, half * 0.075)
                    for k in range(7):
                        hsh = ((k * 40503) ^ ((band + rank * 77)
                                              * 2246822519)) & 0xFFFFFF
                        hx = int(centre + side * half * out
                                 + (k - 3) * step * 1.7 + (hsh % 7) - 3)
                        if not view.x < hx < view.right:
                            continue
                        heads.append(((hx, yy - (hsh >> 4) % 3),
                                      max(2, min(8, int(fh * 0.26))),
                                      _FENCE_CROWD[(hsh >> 8)
                                                   % len(_FENCE_CROWD)]))
                if fh > 4.0:
                    pitch = max(4, len(sample) // 2)
                    for i in range(0, len(sample), pitch):
                        y = sample[i]
                        _, centre, half = rows[y]
                        x = centre + side * half * out
                        t = max(1.0, half * 0.010)
                        posts.append(_fp([(x - t, y - fh * 1.16),
                                          (x + t, y - fh * 1.16),
                                          (x + t, y), (x - t, y)]))
    _fill(canvas, mesh, FENCE_MESH, cv2.LINE_8)
    _fill(canvas, posts, (52, 62, 58), cv2.LINE_8)
    for (hx, hy), r, tone in heads:
        # A shoulder under every head: two pixels of body is the difference
        # between a crowd leaning on a fence and a string of bunting.
        cv2.line(canvas, (hx, hy), (hx, hy + r * 2), tuple(int(c * 0.66)
                                                          for c in tone),
                 max(2, r), cv2.LINE_AA)
        cv2.circle(canvas, (hx, hy), r, tone, -1, cv2.LINE_AA)
    _fill(canvas, rail, FENCE_RAIL)


#: World units between bunting posts. Every run of string is strung between two
#: of these and nowhere else.
#: World units between bunting posts - about twelve metres at this circuit's
#: scale, which is how far apart bunting poles actually stand. Anything longer
#: and the whole foreground barrier is bare: the near half of the screen only
#: covers twenty units of road.
BUNTING_SPAN = 14.0

#: How many posts ahead are considered. Past this the masts are sub-pixel.
BUNTING_POSTS = 8


def _draw_bunting(canvas: np.ndarray, rows: dict, view: Rect, horizon: int,
                  player_s: float) -> None:
    """Bunting strung POST TO POST along both guard rails.

    A post stands every ``BUNTING_SPAN`` world units. String is drawn only
    between two posts that are both on screen and both big enough to read;
    everything else is dropped whole. The old version chained a 1px polyline
    through every projected row of the rail, which ran on across open grass
    long after the last post had left the frame and read as a scratch on the
    lens. The cord now has a dark outline under a 2px core, and it SAGS - a
    straight line between two poles is a wire, a catenary is bunting.
    """
    n = max(view.bottom - horizon, 1)
    first = math.ceil((player_s + NEAR_Z * 1.1) / BUNTING_SPAN)
    marks: list[tuple[int, float, float]] = []
    for k in range(first, first + BUNTING_POSTS):
        gap = k * BUNTING_SPAN - player_s
        if gap > 170.0:
            break
        y = min(horizon + int(n * NEAR_Z / gap), view.bottom - 1)
        got = rows.get(y)
        if got is None:
            continue
        marks.append((y, got[1], got[2]))
    if len(marks) < 2:
        return
    pennants: list[list[np.ndarray]] = [[] for _ in BUNTING]
    for side in (-1, 1):
        posts: list[tuple[int, int, float] | None] = []
        for y, centre, half in marks:
            x = int(centre + side * half * 1.30)
            # A run of bunting whose cord is a sub-pixel hairline is not
            # bunting: it is a scatter of coloured diamonds floating over the
            # far barrier. Nothing is strung until the posts are big enough
            # for the string between them to actually read.
            on = (view.x - half * 0.2 < x < view.right + half * 0.2
                  and half >= 30.0)
            posts.append((x, y, half) if on else None)
        # The mast itself, so the string always has something holding it up.
        for post in posts:
            if post is None or post[2] < 26.0:
                continue
            x, y, half = post
            top = y - int(half * 0.30)
            cv2.line(canvas, (x, y - int(half * 0.03)), (x, top), (30, 32, 40),
                     max(3, int(half * 0.026)), cv2.LINE_AA)
            cv2.line(canvas, (x, y - int(half * 0.03)), (x, top),
                     (214, 218, 226), max(1, int(half * 0.014)), cv2.LINE_AA)
        for a, b in zip(posts, posts[1:]):
            if a is None or b is None:
                continue
            (xa, ya, ha), (xb, yb, hb) = a, b
            top_a, top_b = ya - int(ha * 0.30), yb - int(hb * 0.30)
            sag = max(2, int(ha * 0.10))
            steps = 7
            cord = []
            for i in range(steps + 1):
                t = i / steps
                cord.append((int(xa + (xb - xa) * t),
                             int(top_a + (top_b - top_a) * t
                                 + math.sin(t * math.pi) * sag)))
            line = np.array(cord, np.int32)
            core = max(1, int(ha * 0.012))
            cv2.polylines(canvas, [line], False, (36, 38, 46), core + 2,
                          cv2.LINE_AA)
            cv2.polylines(canvas, [line], False, BUNTING_CORD, core,
                          cv2.LINE_AA)
            for i in range(1, steps):
                x, y = cord[i]
                half = ha + (hb - ha) * (i / steps)
                if not view.x - 20 < x < view.right + 20:
                    continue
                pw = max(2, int(half * 0.022))
                ph = max(4, int(half * 0.060))
                pennants[i % len(BUNTING)].append(
                    np.array([(x - pw, y), (x + pw, y), (x, y + ph)], np.int32))
    for polys, colour in zip(pennants, BUNTING):
        if polys:
            cv2.fillPoly(canvas, polys, colour, cv2.LINE_AA)


def _paint_start_line(canvas: np.ndarray, rows: dict, view: Rect, player_s: float,
                      length: float) -> None:
    """The chequered strip across the road at s = 0."""
    for y, (z, centre, half) in rows.items():
        m = (player_s + z) % length
        if m >= 4.4:
            continue
        cells = 9
        step = 2.0 * half / cells
        flip = int(m / 2.2)
        for k in range(cells):
            x0 = max(int(centre - half + k * step), view.x)
            x1 = min(int(centre - half + (k + 1) * step), view.right)
            if x1 > x0:
                canvas[y, x0:x1] = (235, 240, 243) if (k + flip) % 2 == 0 \
                    else (22, 22, 25)


def _paint_grid(canvas: np.ndarray, round_: RaceRound, rows: dict, view: Rect,
                horizon: int) -> None:
    """Painted grid slots where the field actually lines up (see RaceRound)."""
    n = max(view.bottom - horizon, 1)
    length = round_.track.length
    player_s = round_.player.s
    slots = [(0.0, 0.35)] + [
        (8.0 + 7.5 * i, (-0.55 if i % 2 else 0.55) * (0.4 + 0.1 * i))
        for i in range(len(round_.field_))]
    for s0, x0 in slots:
        near_gap = (s0 - 0.8 - player_s) % length
        far_gap = near_gap + 3.2
        if not NEAR_Z < near_gap < 220.0:
            continue
        y_near = min(horizon + int(n * NEAR_Z / near_gap), view.bottom - 1)
        y_far = horizon + int(n * NEAR_Z / far_gap)
        near, far = rows.get(y_near), rows.get(y_far)
        if near is None or far is None:
            continue
        (_, cn, hn), (_, cf, hf) = near, far
        if hn < 46.0:
            # Any smaller and the box is three white splinters lying on the
            # asphalt. A painted grid slot is a BOX or it is nothing.
            continue
        w = 0.17
        pts = np.array([(int(cn + (x0 - w) * hn), y_near),
                        (int(cf + (x0 - w) * hf), y_far),
                        (int(cf + (x0 + w) * hf), y_far),
                        (int(cn + (x0 + w) * hn), y_near)], np.int32)
        cv2.polylines(canvas, [pts], True, (218, 224, 228),
                      max(2, int(hn * 0.014)), cv2.LINE_AA)


def _skid_polys(marks, player_s: float, length: float, rows: dict,
                view: Rect, horizon: int, n: int, w: float,
                span: float) -> list[np.ndarray]:
    polys: list[np.ndarray] = []
    for s0, x0 in marks:
        gap = (s0 - player_s) % length
        if not NEAR_Z * 0.9 < gap < 260.0:
            continue
        y0 = min(horizon + int(n * NEAR_Z / gap), view.bottom - 1)
        y1 = horizon + int(n * NEAR_Z / (gap + span))
        a, b = rows.get(y0), rows.get(y1)
        if a is None or b is None:
            continue
        (_, ca, ha), (_, cb, hb) = a, b
        polys.append(np.array([(int(ca + (x0 - w) * ha), y0),
                               (int(ca + (x0 + w) * ha), y0),
                               (int(cb + (x0 + w) * hb), y1),
                               (int(cb + (x0 - w) * hb), y1)], np.int32))
    return polys


def _draw_skid_marks(canvas: np.ndarray, round_: RaceRound, fx: _Effects,
                     rows: dict, view: Rect, horizon: int) -> None:
    n = max(view.bottom - horizon, 1)
    length = round_.track.length
    player_s = round_.player.s
    old = _skid_polys(_apex_rubber(round_.track), player_s, length, rows, view,
                      horizon, n, 0.024, 2.6)
    if old:
        cv2.fillPoly(canvas, old, (60, 58, 66))
    fresh = _skid_polys(fx.skids, player_s, length, rows, view, horizon, n,
                        0.028, 1.1)
    if fresh:
        cv2.fillPoly(canvas, fresh, SKID)


@lru_cache(maxsize=4)
def _road_glare(width: int, ground: int) -> tuple[np.ndarray, int, int]:
    """The sun's glare pooling on the ground, as an ADDITIVE patch.

    Built once and added with one SIMD pass; a per-pixel alpha blend of the
    same pool cost four uint16 passes over a quarter of the frame, every
    frame, and looked no different.
    """
    gw = max(8, int(width * 0.78))
    gh = max(4, int(ground * 0.62))
    x0 = max(0, int(width * 0.60 - gw / 2))
    gw = min(gw, width - x0)
    xs = np.linspace(-1.0, 1.0, gw, dtype=np.float32)
    ys = np.linspace(1.0, 0.0, gh, dtype=np.float32)
    # A TIGHT hot pool right under the sun, sitting inside a BROAD warm wash
    # that runs most of the way across the ground plane. The wash is what
    # puts the key light on the tarmac and on the tops of the karts; the
    # pool is the specular smear of the sun itself on the asphalt.
    fall = (ys ** 1.5)[:, None]
    alpha = (np.exp(-(xs ** 2) * 9.0)[None, :] * fall * 0.155
             + np.exp(-(xs ** 2) * 1.1)[None, :] * fall * 0.085)
    patch = alpha[:, :, None] * np.array((118, 196, 252), np.float32)
    return patch.astype(np.uint8), x0, gh


def _apply_road_glare(canvas: np.ndarray, view: Rect, horizon: int) -> None:
    patch, gx0, gh = _road_glare(view.width, max(view.bottom - horizon, 1))
    x0 = view.x + gx0
    x1 = min(x0 + patch.shape[1], view.right)
    y1 = min(horizon + gh, view.bottom)
    if x1 - x0 < 2 or y1 - horizon < 2:
        return
    roi = canvas[horizon:y1, x0:x1]
    cv2.add(roi, patch[:y1 - horizon, :x1 - x0], dst=roi)


@lru_cache(maxsize=4)
def _haze_alpha(above: int, below: int) -> tuple[np.ndarray, np.ndarray]:
    """(255 - alpha, tint * alpha) per row, pre-multiplied and cached.

    The tint is a WARM VERTICAL GRADIENT, not one flat colour: pale and cool a
    little way up into the sky, hot gold exactly on the horizon seam, warm
    grey-green settling back into the field below. A single beige band across
    the whole distance is what flattened the horizon.
    """
    up = np.linspace(0.0, 1.0, max(above, 1), endpoint=False) ** 2.2
    down = np.linspace(1.0, 0.0, max(below, 1)) ** 2.0
    alpha = (np.concatenate([up, down]) * 96.0).astype(np.uint16)[:, None, None]
    ramp = np.concatenate([
        np.linspace(0.0, 1.0, max(above, 1), endpoint=False),
        np.linspace(1.0, 2.0, max(below, 1))]).astype(np.float32)
    stops = np.array([HAZE_HI, HAZE_MID, HAZE_LO], np.float32)
    lo = np.clip(ramp.astype(np.int32), 0, 1)
    f = (ramp - lo)[:, None]
    colours = stops[lo] + (stops[lo + 1] - stops[lo]) * f
    tint = (colours.astype(np.uint16)[:, None, :] * alpha).astype(np.uint16)
    return (256 - alpha), tint


@lru_cache(maxsize=4)
def _far_band(width: int, rows: int) -> np.ndarray:
    """The sliver beyond the draw distance: warm gold fading into the field."""
    top = [a * 0.42 + b * 0.58 for a, b in zip(HAZE_MID, GRASS_HORIZON)]
    grad = np.linspace(top, GRASS_HORIZON, max(rows, 1))
    return np.repeat(grad[:, None, :], max(width, 1), axis=1).astype(np.uint8)


#: The largest step in haze opacity one slab is allowed to hide, out of 256.
#: EQUAL-ALPHA slabs, not equal-height ones: the ramp is a square law, so it
#: is nearly flat out in the sky and falls off a cliff at the horizon seam.
#: Sixteen slabs of equal HEIGHT put six of them where nothing was happening
#: and cut the steep part into nine-row steps four levels apart - which is
#: precisely the horizontal banding that ran across the far grass. Cutting on
#: the alpha instead spends the slabs where the gradient is, and no boundary
#: costs more than about a third of a luminance level.
_HAZE_STEP = 1.4


@lru_cache(maxsize=4)
def _haze_slabs(above: int, below: int, width: int) -> tuple:
    """The haze band pre-split into (rows, alpha, tint sheet) slabs."""
    inv, tint = _haze_alpha(above, below)
    rows = inv.shape[0]
    alpha = 1.0 - inv[:, 0, 0].astype(np.float32) / 256.0
    colour = np.zeros((rows, 3), np.float32)
    nz = alpha > 1e-6
    colour[nz] = tint[nz, 0, :].astype(np.float32) / (alpha[nz, None] * 256.0)
    out = []
    r0 = 0
    step = _HAZE_STEP / 256.0
    for r in range(1, rows + 1):
        if r < rows and abs(float(alpha[r]) - float(alpha[r0])) < step:
            continue
        a = float(alpha[r0:r].mean())
        if a >= 0.004:
            tone = colour[r0:r].mean(axis=0)
            sheet = np.empty((r - r0, width, 3), np.uint8)
            sheet[:] = np.clip(tone, 0, 255).astype(np.uint8)
            out.append((r0, r, a, sheet))
        r0 = r
    return tuple(out)


def _apply_haze(canvas: np.ndarray, view: Rect, horizon: int,
                level: int | None = None) -> None:
    """Depth haze across the horizon: sky, hills, far road and sprites alike.

    The band's SIZE is measured from the un-shaken horizon so the alpha ramp
    stays a cache hit while the camera jitters; only where it lands moves.
    """
    below = int((view.bottom - (level if level is not None else horizon)) * 0.20)
    above = int(view.height * 0.042)
    y0, y1 = max(view.y, horizon - above), min(view.bottom, horizon + below)
    if y1 - y0 < 4:
        return
    for r0, r1, alpha, sheet in _haze_slabs(horizon - y0, y1 - horizon,
                                            canvas.shape[1]):
        sub = canvas[y0 + r0:y0 + r1]
        cv2.addWeighted(sub, 1.0 - alpha, sheet, alpha, 0.0, dst=sub)


@lru_cache(maxsize=64)
def _bloom(radius: int) -> np.ndarray:
    """The soft radial falloff of a glow, as a MASK cached by radius alone.

    Blurring a filled circle per frame is the single most expensive thing this
    module can be asked to do - a 200 px Gaussian costs more than the whole
    road - so the falloff is analytic and built once per size.

    The colour used to be baked into the cached sprite, and that quietly cost
    more than the road as well: a power cube pulses its bloom's radius AND its
    hue together, so every cube on screen missed the cache on every frame and
    rebuilt a 370 px sprite sixty times a second. The tint is a 256-entry
    lookup applied at blit time instead - the same picture to within one
    level, for a tenth of the work.
    """
    n = max(3, radius * 2 + 1)
    xs = np.linspace(-1.0, 1.0, n, dtype=np.float32)
    fall = np.clip(1.0 - np.hypot(xs[None, :], xs[:, None]), 0.0, 1.0) ** 2.0
    plane = (fall * 255.0).astype(np.uint8)
    return cv2.merge((plane, plane, plane))


@lru_cache(maxsize=64)
def _bloom_lut(tone: tuple[int, int, int]) -> np.ndarray:
    """The colour of a bloom, as the table that tints its falloff mask."""
    ramp = np.arange(256, dtype=np.float32) / 255.0
    return cv2.merge(tuple((ramp * c).astype(np.uint8)
                           for c in tone)).reshape(256, 1, 3)


def _add_glow(canvas: np.ndarray, cx: int, cy: int, radius: int,
              tone: tuple[int, int, int], view: Rect) -> None:
    """Drop a cached bloom sprite onto the canvas, additively and clipped."""
    # Snapped to about a sixteenth of itself, so a glow that grows as it comes
    # at the camera sits in one cached size for several frames instead of
    # asking for a new sprite every single one. Six per cent of the radius of
    # a soft pool of light is not a step anybody can see.
    step = max(4, radius // 16)
    radius = max(3, (radius // step) * step)
    mask = _bloom(radius)
    x0, y0 = max(view.x, cx - radius), max(view.y, cy - radius)
    x1 = min(view.right, cx - radius + mask.shape[1])
    y1 = min(view.bottom, cy - radius + mask.shape[0])
    if x1 - x0 < 2 or y1 - y0 < 2:
        return
    # Tinted AFTER the crop, so a glow hanging half off the frame pays only
    # for the half that lands.
    patch = mask[y0 - (cy - radius):y1 - (cy - radius),
                 x0 - (cx - radius):x1 - (cx - radius)]
    roi = canvas[y0:y1, x0:x1]
    cv2.add(roi, cv2.LUT(patch, _bloom_lut(tuple(tone))), dst=roi)


@lru_cache(maxsize=12)
def _edge_fade(band: int, height: int, strength: int, step: int) -> tuple[
        np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """The two gain maps the radial-blur band is mixed with, AT FULL SIZE.

    ``(on_blur, on_sharp)`` for the left band and then for the right: how
    much of the streaked sample and how much of
    the untouched frame each pixel of the band takes, with the vignette
    already folded in. Both ramp to nothing at the INBOARD edge and along the
    top, because the one thing worse than no motion blur is a hard vertical
    seam down the middle of the grass where the effect stops.

    The pass used to blow the mixed BAND back up to full size, which meant
    that at the inboard edge - where the blur weight is zero and the frame is
    supposed to be untouched - the picture was still a quarter-res smear
    meeting the sharp frame at a hard vertical edge. Only the difference the
    effect makes is upsampled now, so where these maps say 'nothing' the
    frame gets nothing, exactly, and there is no seam to see.
    """
    band, height = max(band, 2), max(height, 2)
    cols = np.linspace(0.0, 1.0, band, dtype=np.float32)
    # ONE ramp for both the streak weight and the vignette, on a cubic ease
    # so it leaves the inboard edge with zero value AND zero slope. They used
    # to have different profiles, which meant the vignette was still shading
    # the picture where the blur had already faded out and the pass had to
    # touch the whole band to stay continuous. Sharing the ramp makes the
    # whole effect the identity beyond it, so only the outer part is composited
    # at full resolution and the rest of the frame is never read at all.
    f = np.clip(1.0 - cols, 0.0, 1.0)
    ramp = f * f * (3.0 - 2.0 * f)
    rows = np.linspace(0.0, 1.0, height, dtype=np.float32)
    lift = np.clip(rows / 0.14, 0.0, 1.0)
    w = ramp[None, :] * lift[:, None] * (step / 16.0)
    gain = 1.0 - (1.0 - strength / 256.0) * ramp[None, :]
    a = np.ascontiguousarray(np.repeat((w * gain)[:, :, None], 3, axis=2))
    b = np.ascontiguousarray(np.repeat(((1.0 - w) * gain)[:, :, None], 3,
                                       axis=2))
    # Both handednesses, cached: mirroring the maps on every frame costs more
    # than the mix they feed.
    return (a, b, np.ascontiguousarray(a[:, ::-1]),
            np.ascontiguousarray(b[:, ::-1]))


def _speed_edges(canvas: np.ndarray, view: Rect, horizon: int,
                 ratio: float, vanish: float | None = None) -> None:
    """The velocity vignette: RADIAL motion blur in the outer fifth of the
    frame, falling away into shadow as the speedo climbs.

    A horizontal smear is not what a windscreen at 180 km/h looks like; the
    world streaks straight OUT OF THE VANISHING POINT, so the band is sampled
    seven per cent zoomed about that point and the samples are averaged back
    over it. The sampling and the mix run at a quarter resolution - the output
    is a blur, so the resolution it was mixed at is invisible - and what comes
    back up to full size is the signed DIFFERENCE the effect makes, never the
    picture itself. That is what keeps a full-height radial pass inside the
    frame budget and, more importantly, what keeps the frame bit-exact
    wherever the effect has faded out. Only the ground gets it: the sky is a
    long way off and does not rush.
    """
    if ratio < 0.52:
        return
    t = min(1.0, (ratio - 0.52) / 0.36)
    # The outer FIFTH of the frame, each side, is where the world goes past
    # fast enough to smear - a tenth of it is a rim of dirt on the bezel.
    band = max(8, int(view.width * 0.200))
    # The top tenth of the ground is where the world is far enough away that
    # it is barely moving across the frame; the ramp already carried almost
    # no weight up there, and skipping it is a tenth of the pass for nothing
    # anybody can see.
    y0 = max(view.y, horizon + (view.bottom - horizon) // 10)
    height = view.bottom - y0
    if height < 16 or band < 32:
        return
    vp = view.x + view.width * 0.5 if vanish is None else vanish
    hh, hw = height // 4, band // 4
    fade = _edge_fade(hw, hh, 256 - int(46 * t), max(1, int(t * 16.0)))
    mix = 0.40 + 0.30 * t
    delta = _delta_scratch(band, height)
    for sgn in (-1, 1):
        x0 = view.x if sgn < 0 else view.right - band
        roi = canvas[y0:view.bottom, x0:x0 + band]
        small = cv2.resize(roi, (hw, hh), interpolation=cv2.INTER_LINEAR)
        # The zoom centre, in the quarter-res band's own coordinates.
        zx = (vp - x0) / 4.0
        zy = (horizon - y0) / 4.0
        # ONE warp, not two. A second sample cost a third of a millisecond
        # and, against a band that is already being downsampled, blurred and
        # upsampled again, it was not visible in a single frame of the game.
        zoom = 1.0 + 0.072 * t
        m = np.array([[zoom, 0.0, zx * (1.0 - zoom)],
                      [0.0, zoom, zy * (1.0 - zoom)]], np.float32)
        acc = cv2.addWeighted(
            small, 1.0 - mix,
            cv2.warpAffine(small, m, (hw, hh), flags=cv2.INTER_LINEAR,
                           borderMode=cv2.BORDER_REPLICATE), mix, 0.0)
        k = 0 if sgn < 0 else 2
        mixed = cv2.add(cv2.multiply(acc, fade[k], dtype=cv2.CV_8U),
                        cv2.multiply(small, fade[k + 1], dtype=cv2.CV_8U))
        # WHAT IS UPSAMPLED IS THE CHANGE, NOT THE PICTURE. The old pass
        # mixed at a quarter size and blew the RESULT back up, which meant
        # that even where the blur weight was zero the frame came back
        # quarter-res - and it met the sharp picture at a hard vertical seam
        # down the middle of the grass. Sending only the signed difference
        # through the resize leaves the frame exactly as it was wherever the
        # effect is off, so there is nothing left for a seam to be made of.
        cv2.resize(cv2.subtract(mixed, small, dtype=cv2.CV_16S),
                   (band, height), dst=delta, interpolation=cv2.INTER_LINEAR)
        cv2.add(roi, delta, dst=roi, dtype=cv2.CV_8U)


def _speed_streaks(canvas: np.ndarray, ratio: float, view: Rect,
                   rows: dict, now: float) -> None:
    """Speedlines: soft tapered streaks rushing back down the TARMAC.

    A speedline is the road blurring past, so every one of them is clipped to
    the drivable surface: a streak is walked outward from the vanishing point
    and cut the instant it leaves the asphalt. Painted across the grass or the
    kerb they read as scratches on the lens, which is exactly what they were.
    Each one is cut into short segments, and each segment is PREMIXED against
    the pixel it lands on, which buys a soft, motion-blurred streak that
    follows whatever it is passing over without a single blend pass across the
    frame. Nothing shows below about 120 km/h; the set ramps up from there.
    """
    if ratio < 0.62 or not rows:
        return
    t = min(1.0, (ratio - 0.62) / 0.34)
    ys = sorted(rows)
    horizon = ys[0]
    # The vanishing point can be a long way off frame through a bend; the
    # streaks still radiate from it, but they are clamped to the picture so
    # none of them ends up climbing into the sky on the far side of it.
    vp = min(max(rows[horizon][1], view.x - view.width * 0.4),
             view.right + view.width * 0.4)
    rng = np.random.default_rng(int(now * 14.0) % 99991)

    def on_road(x: float, y: float) -> bool:
        got = rows.get(int(y))
        if got is None:
            return False
        _, centre, half = got
        return abs(x - centre) < half * 0.97

    for _ in range(12 + int(9 * t)):
        # Born on a row of tarmac somewhere down the road, out ON THE OUTER
        # QUARTER of the surface: the racing line is what the driver is
        # reading, and a streak drawn across it is a scratch on the lens.
        y0 = ys[int(len(ys) * (0.10 + 0.80 * rng.random() ** 1.5))]
        _, rc, rhalf = rows[y0]
        if rhalf < 26.0:
            continue
        lane = (0.74 + 0.24 * rng.random()) * (1.0 if rng.random() < 0.5 else -1.0)
        x0 = rc + lane * rhalf
        # The genuine radial direction: out along the ray from the vanishing
        # point through this point, so the whole set fans with the road.
        dx, dy = x0 - vp, float(y0 - horizon)
        norm = math.hypot(dx, dy) or 1.0
        dx, dy = dx / norm, dy / norm
        # LENGTH IS SPEED. A streak at 120 km/h is a short dash and one at
        # 196 is a bar half the width of the frame; that ramp is most of what
        # the effect is for.
        run = view.width * (0.055 + 0.090 * rng.random()) * (0.45 + 1.15 * t)
        wide = (1.5 + 3.4 * rng.random()) * (0.55 + 0.95 * t)
        steps = 4
        for k in range(steps):
            xa = x0 + dx * run * k / steps
            xb = x0 + dx * run * (k + 1) / steps
            ya = y0 + dy * run * k / steps
            yb = y0 + dy * run * (k + 1) / steps
            if not (view.x + 2 < xb < view.right - 2
                    and horizon + 2 < yb < view.bottom - 2
                    and horizon + 2 < ya < view.bottom - 2):
                break
            if not (on_road(xa, ya) and on_road(xb, yb)):
                break
            base = canvas[int(yb), int(xb)].astype(np.float32)
            # Fattest and faintest at the outer end, sharpening to a point
            # back toward the vanishing point: a streak, not a scratch.
            f0, f1 = k / steps, (k + 1) / steps
            alpha = 0.70 * t * (0.26 + 0.74 * f1)
            tone = tuple(int(c + (252.0 - c) * alpha) for c in base)
            nx, ny = -dy, dx
            h0, h1 = wide * (0.12 + f0), wide * (0.12 + f1)
            cv2.fillPoly(canvas, [np.array(
                [(xa - nx * h0, ya - ny * h0), (xa + nx * h0, ya + ny * h0),
                 (xb + nx * h1, yb + ny * h1), (xb - nx * h1, yb - ny * h1)],
                np.int32)], tone, cv2.LINE_AA)


def _boost_lines(canvas: np.ndarray, view: Rect, vp: float, horizon: int,
                 rows: dict, strength: float) -> None:
    """The pay-out burst: white speedlines fired out of the vanishing point
    down the TARMAC, for the six frames the exhaust lights.

    Every ray is CLIPPED TO THE ROAD SURFACE, exactly as the steady speedlines
    are. The burst used to be allowed off the asphalt on the theory that it is
    the camera being punched forward rather than the road rushing - and what
    that bought was two white ribbons per frame climbing off the track, over
    the grass, the hedges and the grandstand, all the way to the skyline. A
    painted marking that leaves the surface it is painted on is a projection
    fault whatever the excuse, so the rays now stop dead at the white line.
    """
    if strength <= 0.02 or not rows:
        return
    cx, cy = vp, float(horizon)
    span = math.hypot(view.width, view.height)
    rng = np.random.default_rng(int(strength * 97.0) + 11)

    def on_road(x: float, y: float) -> bool:
        got = rows.get(int(y))
        if got is None:
            return False
        return abs(x - got[1]) < got[2] * 0.99

    for k in range(34):
        a = (k / 34.0 + rng.random() * 0.02) * math.tau
        ca, sa = math.cos(a), math.sin(a)
        # Folded below the skyline and never allowed to graze it: with y
        # growing downward, a positive sine is a ray heading into the ground.
        sa = max(abs(sa), 0.22)
        hyp = math.hypot(ca, sa)
        ca, sa = ca / hyp, sa / hyp
        # Born out beyond the middle of the picture and running to the bezel,
        # so the road ahead is never scribbled over.
        r0 = span * (0.20 + 0.16 * rng.random()) * (1.35 - strength)
        r1 = r0 + span * (0.13 + 0.22 * rng.random()) * strength
        x0, y0 = cx + ca * r0, cy + sa * r0
        x1, y1 = cx + ca * r1, cy + sa * r1
        if not (view.x - 40 < x1 < view.right + 40
                and view.y - 40 < y1 < view.bottom + 40):
            continue
        # WALKED OUT AND CUT AT THE ROAD EDGE. The ray is stepped in eighths
        # and the first step that leaves the asphalt ends it; a ray that never
        # touched the asphalt at all is dropped whole.
        steps = 8
        last = 0.0
        for i in range(1, steps + 1):
            f = i / steps
            if not on_road(x0 + (x1 - x0) * f, y0 + (y1 - y0) * f):
                break
            last = f
        if last <= 0.14:
            continue
        x1, y1 = x0 + (x1 - x0) * last, y0 + (y1 - y0) * last
        wide = max(1.0, span * 0.0022 * strength * (0.5 + rng.random()))
        nx, ny = -sa * wide, ca * wide
        # Premixed against the pixel it lands on, exactly as the tarmac
        # speedlines are: a solid white bar across the road reads as a glitch.
        sx = min(max(int((x0 + x1) * 0.5), view.x), view.right - 1)
        sy = min(max(int((y0 + y1) * 0.5), view.y), view.bottom - 1)
        base = canvas[sy, sx].astype(np.float32)
        alpha = 0.72 * strength
        tone = tuple(int(c + (252.0 - c) * alpha) for c in base)
        cv2.fillPoly(canvas, [np.array(
            [(x0 - nx * 0.2, y0 - ny * 0.2), (x0 + nx * 0.2, y0 + ny * 0.2),
             (x1 + nx, y1 + ny), (x1 - nx, y1 - ny)], np.int32)], tone,
            cv2.LINE_AA)


#: Screen the HUD owns outright: the two bottom-corner dials and the block
#: under the minimap. A trackside SIGN whose panel would land inside one of
#: these is culled whole - a billboard with a speedometer drawn through it
#: reads as a broken renderer, and so does one sliced by the frame edge.
#: The foreground barrier's paired colours - a real circuit stacks its tyres
#: in bands so a driver can judge how far round the bend the wall runs.
_FG_TYRES = ((222, 122, 44), (56, 56, 214))


def _foreground(canvas: np.ndarray, round_: RaceRound, rows: dict, view: Rect,
                horizon: int, now: float) -> None:
    """THE NEAR VERGE, rushing past down BOTH edges of the frame.

    Everything trackside sits at one and a half road widths out, and at arm's
    length that is a long way off the side of the screen - so the near verge
    is placed in SCREEN space instead: a hedge row, a banded tyre wall, two
    sponsor arch legs and a marshal waving a yellow flag, anchored to the road
    shoulder, scrolling with the distance travelled and doing it two and a
    half times faster than the mid-ground. That difference in rate IS the
    parallax, and it is what turns a frame from a flat painting into something
    the camera is moving through.

    It used to run down ONE side, and only when a bend had swept the tarmac
    far enough over to leave a fifth of the picture empty - which meant that
    on every straight, and on half the corners, the near band of the frame had
    nothing passing through it at all. It now runs down both shoulders on
    every frame: the roomier side gets the full treatment, the other the hedge
    and the wall, and the camera always has something going by.
    """
    ys = sorted(rows)
    if not ys:
        return
    height = view.height
    # Measured a third of the way up the frame, NOT on the bottom row: down
    # there the apron and the kerb reach almost to the corner even on a bend,
    # and the empty half of the picture is the band above them.
    yf = min(ys[-1], view.bottom - int(height * 0.30))
    row_f = rows.get(yf) or rows[ys[-1]]
    _, centre, half = row_f
    lo_f, hi_f = centre - half * 1.46, centre + half * 1.46
    free_l, free_r = lo_f - view.x, view.right - hi_f
    roomy = 1 if free_l > free_r else -1
    # The roomier shoulder is drawn LAST, so its furniture passes in front.
    for inw in (-roomy, roomy):
        _near_verge(canvas, round_, rows, ys, view, horizon, now, inw,
                    inw == roomy)


def _near_verge(canvas: np.ndarray, round_: RaceRound, rows: dict,
                ys: list[int], view: Rect, horizon: int, now: float,
                inw: int, full: bool) -> None:
    """One shoulder of the near verge. ``inw`` points INTO the frame."""
    height = view.height
    yf = min(ys[-1], view.bottom - int(height * 0.30))
    n = max(view.bottom - horizon, 1)
    p0 = (yf - horizon) / n
    p1 = 1.95                        # a little way past the bottom screen row
    # The road edge, extrapolated past the bottom of the frame off the slope of
    # its last forty rows: the layer HUGS the shoulder all the way down, so it
    # never wanders onto the tarmac however hard the bend is.
    y_end = ys[-1]
    _, c_end, h_end = rows[y_end]
    back = rows.get(y_end - 40) or rows[ys[0]]
    edge_end = c_end + inw * -h_end * 1.46
    edge_back = back[1] + inw * -back[2] * 1.46
    slope = (edge_end - edge_back) / max(1.0, float(y_end - (y_end - 40)))
    base = height * 0.078
    drive = round_.player.s

    def at(t: float) -> tuple[int, int, float]:
        p = p0 + (p1 - p0) * t ** 2.0
        yy = horizon + n * p
        if yy <= y_end:
            got = rows.get(int(yy)) or rows[y_end]
            edge = got[1] + inw * -got[2] * 1.46
        else:
            edge = edge_end + slope * (yy - y_end)
        gx = int(edge - inw * view.width * (0.020 + 0.048 * p))
        # The camera BANKS into the bend, and this layer stands on the same
        # banked ground everything else does - see _tilt_dy.
        return (gx, int(yy) + _tilt_dy(gx), p)

    # A HEDGE ROW: one CONTINUOUS clipped ribbon running away up the shoulder,
    # its top edge scalloped and world-anchored so the bumps march past. Five
    # separate blobs read as five bushes on a lawn; a ribbon reads as a hedge
    # the camera is driving alongside, which is the whole point of the layer.
    # The layer is a CHEAT - trackside furniture placed in screen space so it
    # can reach the corner of the frame at all. The cheat only holds while the
    # run genuinely exits at the frame edge; with the kart off the road and the
    # camera swung wide it would march diagonally across the middle of the
    # picture instead, straight over the hero kart. So it is checked first, and
    # abandoned whole rather than drawn in the wrong place.
    x_near = at(1.0)[0]
    if (x_near - view.x if inw > 0 else view.right - x_near) > view.width * 0.10:
        return
    rail = [at(k / 10.0) for k in range(11)]
    # A HEDGE ROW: one CONTINUOUS clipped ribbon running away up the shoulder,
    # its top edge scalloped and world-anchored so the bumps march past. Five
    # separate blobs read as five bushes on a lawn; a ribbon reads as a hedge
    # the camera is driving alongside, which is the whole point of the layer.
    hedge_top: list[tuple[int, int]] = []
    hedge_bot: list[tuple[int, int]] = []
    for k, (x, yy, sc) in enumerate(rail):
        bump = 1.0 + 0.30 * math.sin(drive * 0.36 + k * 1.7)
        hx = x - int(inw * base * sc * 1.05)
        hedge_top.append((hx, yy - int(base * sc * 1.95 * bump)))
        hedge_bot.append((hx, yy + int(sc * 12)))
    cv2.fillPoly(canvas, [np.array(hedge_top + hedge_bot[::-1], np.int32)],
                 (18, 52, 38), cv2.LINE_AA)
    # Clipped lobes along the crown, each one catching the low sun on its
    # upper edge: without them the hedge is a flat green wedge, with them it
    # is a hedge that has been cut by somebody.
    for k, (hx, hy) in enumerate(hedge_top):
        lr = max(2, int(base * rail[k][2] * 0.92))
        cv2.circle(canvas, (hx, hy + lr // 2), lr, (20, 56, 40), -1,
                   cv2.LINE_AA)
        if k & 1:
            cv2.ellipse(canvas, (hx, hy + lr // 3), (lr, int(lr * 0.80)), 0,
                        192, 348, (62, 142, 94), max(2, lr // 4), cv2.LINE_AA)
    if not full:
        return
    # THE TYRE WALL: a continuous run of stacked rings standing in front of the
    # hedge, capped in BLUE AND RED PAIRS along its top - the banding a real
    # circuit uses so a driver can read how far round the bend the wall goes.
    wall_top = [(x, yy - int(base * sc * 1.32)) for x, yy, sc in rail]
    wall_bot = [(x, yy + int(sc * 6)) for x, yy, sc in rail]
    cv2.fillPoly(canvas, [np.array(wall_top + wall_bot[::-1], np.int32)],
                 (24, 24, 30), cv2.LINE_AA)
    for ring in (0.44,):
        cv2.polylines(canvas, [np.array(
            [(x, yy - int(base * sc * 1.32 * ring)) for x, yy, sc in rail],
            np.int32)], False, (52, 54, 66), max(1, int(base * 0.07)),
            cv2.LINE_AA)
    beat = int(drive * 0.188)
    for k in range(len(rail) - 1):
        cap = _FG_TYRES[((k + beat) // 2) % 2]
        sc = rail[k][2]
        thick = max(2, int(base * sc * 0.34))
        cv2.line(canvas, wall_top[k], wall_top[k + 1], cap, thick, cv2.LINE_AA)
        # The joint between one stack and the next, so the run reads as a wall
        # BUILT out of tyres rather than as a painted stripe on a ramp.
        cv2.line(canvas, wall_top[k], wall_bot[k], (10, 10, 14),
                 max(1, int(base * sc * 0.06)), cv2.LINE_AA)
    # TWO SPONSOR ARCH LEGS, tall enough to run clean off the top of the frame.
    for k in range(2):
        x, yy, sc = at((drive * 0.0235 + 0.36 + k * 0.5) % 1.0)
        wpost = max(3, int(base * sc * 0.26))
        top = yy - int(base * sc * 5.4)
        name, panel, ink_c = _SPONSORS[k % len(_SPONSORS)]
        cv2.rectangle(canvas, (x - wpost, top), (x + wpost, yy), panel, -1)
        # A lit edge down the sun side and a shaded one down the other, so the
        # leg is a round column and not a flat coloured stripe.
        cv2.rectangle(canvas, (x - wpost, top),
                      (x - wpost + max(2, wpost // 3), yy),
                      tuple(int(c * 0.62) for c in panel), -1)
        cv2.rectangle(canvas, (x + wpost - max(2, wpost // 3), top),
                      (x + wpost, yy), _mix(panel, RIM_SUN, 0.42), -1)
        for i in range(3):
            by = yy - int(base * sc * (1.5 + 1.9 * i))
            cv2.rectangle(canvas, (x - wpost, by),
                          (x + wpost, by + max(2, int(wpost * 0.85))), ink_c,
                          -1)
        cv2.rectangle(canvas, (x - int(wpost * 1.9), yy - max(3, wpost)),
                      (x + int(wpost * 1.9), yy), (48, 46, 56), -1)
        # The stub of the beam the leg is holding up, running away over the
        # track: what makes this a LEG of an arch and not a striped pole. Two
        # chords and a diagonal web, which is how a real gantry is built.
        beam = int(inw * wpost * 11.0)
        deep = max(3, int(wpost * 2.2))
        cv2.rectangle(canvas, (x, top), (x + beam, top + max(2, wpost // 2)),
                      _mix(panel, (30, 28, 36), 0.22), -1)
        cv2.rectangle(canvas, (x, top + deep), (x + beam, top + deep
                                                + max(2, wpost // 2)),
                      _mix(panel, (30, 28, 36), 0.42), -1)
        for i in range(3):
            ax = x + beam * i // 3
            cv2.line(canvas, (ax, top), (ax + beam // 3, top + deep),
                     (74, 72, 86), max(1, wpost // 3), cv2.LINE_AA)
    # THE MARSHAL, waving a yellow flag over the barrier.
    x, yy, sc = at((drive * 0.0235 + 0.66) % 1.0)
    if sc > 0.22:
        r = max(2, int(base * sc * 0.34))
        cv2.rectangle(canvas, (x - r * 3, yy - r), (x + r * 3, yy),
                      (58, 56, 68), -1)
        cv2.rectangle(canvas, (x - r, yy - r * 5), (x + r, yy - r),
                      (30, 122, 234), -1)          # high-vis tabard
        cv2.circle(canvas, (x, yy - int(r * 6.1)), int(r * 1.25),
                   (150, 178, 206), -1, cv2.LINE_AA)
        wave = math.sin(now * 6.4) * r * 1.6
        tipy = yy - int(r * 8.2 + wave)
        cv2.line(canvas, (x + r, yy - r * 4), (x - int(r * 2.4), tipy),
                 (188, 190, 200), max(1, r // 2), cv2.LINE_AA)
        cv2.fillPoly(canvas, [np.array([
            (x - int(r * 2.4), tipy), (x - int(r * 6.6), tipy + int(r * 0.6)),
            (x - int(r * 5.4), tipy + int(r * 3.6)),
            (x - int(r * 1.9), tipy + int(r * 2.6))], np.int32)],
            (60, 214, 250), cv2.LINE_AA)


def _hud_zones(view: Rect) -> tuple[tuple[int, int, int, int], ...]:
    iw, ih = int(view.width * 0.160), int(view.height * 0.360)
    col = int(view.width * 0.200)
    return ((view.x, view.bottom - ih, view.x + iw, view.bottom),
            (view.right - iw, view.bottom - ih, view.right, view.bottom),
            (view.right - col, view.y, view.right, view.y + int(view.height * 0.34)),
            # the left-hand column: lap plate, item slot, drift meter, order
            (view.x, view.y, view.x + int(view.width * 0.270),
             view.y + int(view.height * 0.520)))


#: The kinds that carry a readable panel, and so must never be cut or covered.
_SIGNS = frozenset(("bill", "adboard", "board", "hoard"))

#: How much clear air a sign must leave around the hero kart, in pixels.
SIGN_CLEARANCE = 80

#: Roadside furniture that gets a horizontal motion smear when it passes
#: through the bottom quarter of the frame at speed. Signs are left crisp -
#: a smeared word reads as a bug, not as velocity.
_BLUR_PROPS = frozenset(("tyrewall", "tires", "post", "pylon", "hedge",
                         "bundle", "poplar"))


def _player_zone(round_: RaceRound, rows: dict, view: Rect,
                 horizon: int) -> tuple[int, int, int, int]:
    """The hero kart's screen footprint, grown by SIGN_CLEARANCE."""
    n = max(view.bottom - horizon, 1)
    y = min(horizon + int(NEAR_Z / PLAYER_SPRITE_Z * n), view.bottom - 1)
    got = rows.get(y)
    if got is None:
        return (0, 0, 0, 0)
    _, centre, half = got
    px = int(centre + round_.player.x * half)
    w = max(6, int(half * KART_SPRITE_W))
    h = int(w * 0.60)
    c = SIGN_CLEARANCE
    return (px - w - c, y - int(h * 2.0) - c, px + w + c, y + c)



# --- trackside sprites -------------------------------------------------------

def _field_depths(round_: RaceRound):
    track = round_.track
    for kart in round_.field_:
        gap = (kart.s - round_.player.s + track.length / 2) % track.length \
            - track.length / 2
        if 2.0 < gap < DRAW_DISTANCE * 0.9:
            yield kart, gap


#: What each kind of prop actually covers, in road half-widths: how far it
#: reaches either side of its anchor, and how tall it stands above its base.
#: The cull uses the first number (a prop discarded while a third of it is
#: still on screen pops in the corner of the eye) and the depth fade uses
#: both, to bound the pixels it has to tint.
_PROP_EXTENT = {
    "tree": (0.40, 1.15), "post": (0.12, 0.22), "tires": (0.18, 0.40),
    "copse": (0.52, 0.75), "berm": (0.66, 0.32), "adboard": (0.28, 0.30),
    "flag": (0.40, 0.80), "bill": (0.34, 0.90), "stand": (0.84, 1.70),
    "board": (0.14, 0.50), "gantry": (1.50, 1.05), "arch": (1.42, 0.95),
    # a stand is 1.16 half-widths tall now, plus its canopy
    "coin": (0.14, 0.38), "cube": (0.28, 0.68), "pylon": (0.14, 0.30),
    "hoard": (0.34, 0.52), "tyrewall": (0.30, 0.30), "tent": (0.62, 0.72),
    "pole": (0.22, 0.62), "bannerwall": (0.95, 0.34), "treewall": (1.10, 0.80),
    "bundle": (0.42, 0.30), "poplar": (0.14, 0.74), "marshal": (0.30, 0.46),
    "hedge": (0.58, 0.40),
}

#: Props that must never be sliced by the frame edge. A grandstand cut in half
#: by x=0 reads as a rendering fault; a run of tyres or a treeline is CONTINUOUS
#: by design and is meant to run off the edge, so neither is in this set.
_WHOLE_PROPS = frozenset((
    "stand", "tent", "berm", "bill", "adboard", "board", "bannerwall"))

#: A pixel the prop did not paint: identical before and after, on all three
#: channels. Used as both bounds of the `inRange` that finds them.
_UNPAINTED = (0, 0, 0)


@lru_cache(maxsize=2)
def _haze_sheet(width: int, height: int) -> np.ndarray:
    """One frame-sized rectangle of flat HAZE, built once per window size.

    `addWeighted` wants a second image rather than a colour, and a prop's box
    is a different shape almost every time. Any sub-rectangle of a flat sheet
    is the same flat colour, so each prop takes a free numpy VIEW of the top
    corner of this one - allocating and filling a box-sized array per prop per
    frame would give back everything the blend saves.
    """
    sheet = np.empty((max(1, height), max(1, width), 3), np.uint8)
    sheet[:] = HAZE
    return sheet


def _draw_prop(canvas: np.ndarray, kind: str, variant: int, x_off: float,
               z: float, rows: dict, view: Rect, horizon: int,
               now: float, speed: float = 0.0,
               zones: tuple[tuple[int, int, int, int], ...] = ()) -> None:
    n = max(view.bottom - horizon, 1)
    y = min(horizon + int(n * NEAR_Z / z), view.bottom - 1)
    got = rows.get(y)
    if got is None:
        return
    _, centre, half = got
    px = int(centre + x_off * half)
    y += _tilt_dy(px)                  # stand on the BANKED ground, not the flat one
    if kind in ("coin", "cube") and z < 7.4:
        return  # a collectible this close is under the kart, not in front
    if kind == "bundle" and z < 15.0:
        return  # a corner barrier at arm's length is a wall of black rings
    reach, tall = _PROP_EXTENT.get(kind, (0.3, 0.6))
    # Anything whose drawn extent is entirely off screen is culled whole: a
    # half-clipped billboard reads as a rendering bug, not scenery - and a
    # prop dropped while it is still visible pops instead of sliding away.
    anchor = int(centre) if kind in ("gantry", "arch") else px
    slack = half * reach
    if anchor < view.x - slack or anchor > view.right + slack:
        return
    if kind in _WHOLE_PROPS:
        # More than 30% of the bounding box off the frame and the prop is gone.
        # A grandstand sliced vertically by the screen edge is the loudest
        # 'this is a mockup' tell there is.
        span = max(2.0 * slack, 1.0)
        seen = min(anchor + slack, view.right) - max(anchor - slack, view.x)
        if seen < span * 0.70:
            return
    if kind in _SIGNS:
        # A sign is a thing you READ. One sliced by the frame edge, or one
        # with a HUD dial drawn through it, is worse than no sign at all -
        # so the whole panel must fit on screen, clear of the instruments.
        sx0, sx1 = anchor - int(slack) - 2, anchor + int(slack) + 3
        sy0, sy1 = y - int(half * tall) - 2, y + 2
        if sx0 < view.x or sx1 > view.right:
            return
        for zx0, zy0, zx1, zy1 in zones:
            if sx0 < zx1 and sx1 > zx0 and sy0 < zy1 and sy1 > zy0:
                return
    # Distance fade: every prop dissolves into the haze on its OWN depth,
    # never on the screen row it happens to occupy.
    fade = max(0.0, min(0.74, (z - 168.0) / 300.0))
    keep = box = None
    # Below a tenth the fade is worth under two levels on a hazed prop, and
    # it costs a copy and a blend of the prop's whole bounding box - two full
    # passes over the picture, three hundred times a frame. It starts where
    # it starts being visible.
    if fade > 0.10:
        bx0 = max(view.x, anchor - int(slack) - 2)
        bx1 = min(view.right, anchor + int(slack) + 3)
        by0 = max(view.y, y - int(half * tall) - 2)
        by1 = min(view.bottom, y + max(3, int(half * 0.12)))
        if bx1 - bx0 > 0 and by1 - by0 > 0:
            box = (bx0, by0, bx1, by1)
            keep = canvas[by0:by1, bx0:bx1].copy()

    _paint_prop(canvas, kind, variant, px, y, centre, half, view, now, speed)

    # Nothing this close should be crisp at 160 km/h: the roadside furniture in
    # the bottom quarter of the frame is smeared horizontally, hard, and the
    # amount of smear is read straight off the speedo.
    if (speed > 0.52 and kind in _BLUR_PROPS
            and y > view.bottom - view.height * 0.26):
        k = 3 + 2 * int(2.0 * min(1.0, (speed - 0.52) / 0.42))
        bx0 = max(view.x, anchor - int(slack) - k)
        bx1 = min(view.right, anchor + int(slack) + k + 1)
        by0 = max(view.y, y - int(half * tall) - 2)
        by1 = min(view.bottom, y + max(3, int(half * 0.14)))
        if bx1 - bx0 > k and by1 - by0 > 1 and (bx1 - bx0) * (by1 - by0) < 46000:
            roi = canvas[by0:by1, bx0:bx1]
            # Blended, not replaced: a fully blurred prop loses its silhouette
            # and turns into a smudge with ghosts either side of it.
            cv2.addWeighted(roi, 0.42, cv2.blur(roi, (k, 1)), 0.58, 0.0,
                            dst=roi)

    if keep is not None and box is not None:
        bx0, by0, bx1, by1 = box
        roi = canvas[by0:by1, bx0:bx1]
        # Haze only the pixels the prop actually painted, leaving the scenery
        # behind it alone - and do it in three OpenCV passes instead of seven
        # numpy ones. Building a boolean mask with `!=` / `.any(axis=2)` and
        # then gathering and scattering the pixels through it was the single
        # most expensive thing in the frame, because three hundred props each
        # pay for it every frame. Blending the whole box and copying the
        # untouched pixels straight back over the result is the same picture
        # (to within a rounding step nobody can see) for half the time.
        same = cv2.inRange(cv2.absdiff(roi, keep), _UNPAINTED, _UNPAINTED)
        haze = _haze_sheet(view.width, view.height)[:by1 - by0, :bx1 - bx0]
        cv2.addWeighted(roi, 1.0 - fade, haze, fade, 0.0, dst=roi)
        cv2.copyTo(keep, same, dst=roi)


def _paint_prop(canvas: np.ndarray, kind: str, variant: int, px: int, y: int,
                centre: float, half: float, view: Rect, now: float,
                speed: float) -> None:
    road_hi = centre + half * 1.26  # long shadows stop at the barrier
    if kind == "tree":
        _tree(canvas, px, y, half, variant, road_hi)
    elif kind == "post":
        _post(canvas, px, y, half, variant)
    elif kind == "tires":
        _tire_stack(canvas, px, y, half, variant, road_hi)
    elif kind == "tyrewall":
        _tyre_wall(canvas, px, y, half, variant, road_hi)
    elif kind == "bundle":
        _tyre_bundle(canvas, px, y, half, variant, road_hi)
    elif kind == "poplar":
        _poplar(canvas, px, y, half, variant, road_hi)
    elif kind == "hedge":
        _hedge(canvas, px, y, half, variant, road_hi)
    elif kind == "marshal":
        _marshal(canvas, px, y, half, variant, now, road_hi)
    elif kind == "tent":
        _tent(canvas, px, y, half, variant, road_hi)
    elif kind == "copse":
        _copse(canvas, px, y, half, variant, road_hi)
    elif kind == "treewall":
        _treewall(canvas, px, y, half, variant, road_hi)
    elif kind == "bannerwall":
        _banner_wall(canvas, px, y, half, variant, road_hi)
    elif kind == "pole":
        _pennant_pole(canvas, px, y, half, variant, now, road_hi)
    elif kind == "berm":
        _berm(canvas, px, y, half, variant, now, road_hi)
    elif kind == "adboard":
        _adboard(canvas, px, y, half, variant, road_hi)
    elif kind == "flag":
        _flagpole(canvas, px, y, half, variant, now, road_hi)
    elif kind == "bill":
        _billboard(canvas, px, y, half, variant, road_hi)
    elif kind == "stand":
        _grandstand(canvas, px, y, half, variant, now, road_hi)
    elif kind == "board":
        _distance_board(canvas, px, y, half, variant)
    elif kind == "coin":
        _coin(canvas, px, y, half, variant, now)
    elif kind == "cube":
        _power_cube(canvas, px, y, half, variant, now)
    elif kind == "pylon":
        _pylon(canvas, px, y, half, road_hi)
    elif kind == "hoard":
        _hoarding(canvas, px, y, half, variant, road_hi)
    elif kind == "gantry":
        _gantry(canvas, int(centre), y, half, view, now)
    elif kind == "arch":
        _arch(canvas, int(centre), y, half, view, variant)


def _shade_under(canvas: np.ndarray, px: int, y: int,
                 factor: float) -> tuple[int, int, int]:
    """A shadow tone taken from the surface it falls on, so a collectible's
    shadow is a darker patch of THAT road rather than a black sticker."""
    h, w = canvas.shape[:2]
    base = canvas[min(max(y, 0), h - 1), min(max(px, 0), w - 1)]
    return tuple(int(c * factor) for c in base.tolist())


#: Where the sun is. Everything trackside throws its shadow the same way and
#: by the same rule: an ellipse UNDER the prop, leaning screen-left because the
#: sun sits low on the right, at roughly a third of the shadow's own reach.
SUN_LEAN = 0.34
#: The angle the long axis of every shadow is raked to, in degrees. Negative
#: swings the LEFT end of the ellipse downward - away from a sun sitting on
#: the right-hand horizon - which is the direction a real shadow would run.
SHADOW_RAKE = -15.0


def _ground_shadow(canvas: np.ndarray, px: int, y: int, length: int, girth: int,
                   road_hi: float) -> None:
    """A soft contact shadow directly under a prop, leaning away from the sun.

    Two nested ellipses tinted DOWN FROM THE GROUND THEY LAND ON - a 10% outer
    penumbra and a 22% core - so the shadow multiplies the grass or the gravel
    it falls across instead of stamping one flat green lozenge on top of it.
    The ellipse is centred under the prop; the old version put its whole body a
    full shadow-length to the left, which read as a second, detached object.
    """
    rx = int(length * 0.80)
    # A shadow this small is two antialiased ellipses that cover nine pixels
    # and cost the same as a shadow under a grandstand. Below the threshold the
    # prop simply does not throw one - nobody has ever noticed, and there are a
    # hundred of them behind every frame.
    if rx < 8 or girth < 3:
        return
    off = int(rx * SUN_LEAN)
    if px > road_hi:  # right-side props must not shade the road itself
        off = max(0, min(off, int(px - road_hi)))
        rx = min(rx, max(4, int(px - road_hi) + rx // 2))
    ground = canvas[min(max(y + girth, 0), canvas.shape[0] - 1),
                    min(max(px, 0), canvas.shape[1] - 1)].tolist()
    cx = px - off
    # RAKED, AND VIOLET. The sun is a low disc on the right-hand horizon, so
    # a shadow is not a neutral grey puddle dropped straight below a prop: it
    # runs away to the LEFT AND DOWN, and it takes the violet the sunset sky
    # bounces into it. One angle and one colour mix, applied to every shadow
    # on the circuit, is most of what makes the frame read as lit.
    outer = _mix(tuple(int(c * 0.90) for c in ground), SHADOW_VIOLET, 0.16)
    core = _mix(tuple(int(c * 0.76) for c in ground), SHADOW_VIOLET, 0.26)
    cv2.ellipse(canvas, (cx, y + 1), (int(rx * 1.24), int(girth * 1.30)),
                SHADOW_RAKE, 0, 360, outer, -1, cv2.LINE_AA)
    cv2.ellipse(canvas, (cx, y + 1), (rx, girth), SHADOW_RAKE, 0, 360,
                core, -1, cv2.LINE_AA)


def _treewall(canvas: np.ndarray, px: int, y: int, half: float, variant: int,
              road_hi: float) -> None:
    """A run of woodland on the deep grass: six overlapping canopies laid end
    to end so consecutive props knit into ONE treeline instead of standing
    apart as isolated blobs on a flat green field."""
    h = int(half * (0.50 + 0.09 * variant))
    if h < 5:
        cv2.line(canvas, (px - max(2, h), y - 1), (px + max(2, h), y - 1),
                 (34, 88, 70), max(1, h // 2), cv2.LINE_AA)
        return
    _ground_shadow(canvas, px, y, int(h * 0.95), max(2, int(h * 0.11)), road_hi)
    tones = ((26, 78, 60), (32, 90, 72), (38, 100, 82))
    step = h * 0.46
    if h < 22:      # far woodland: three lobes read the same and cost half
        for k in (-2, 0, 2):
            cv2.circle(canvas, (px + int((k + 0.5) * step),
                                y - int(h * 0.30)), max(2, int(h * 0.42)),
                       tones[(k + variant) % 3], -1, cv2.LINE_AA)
        return
    for k in range(-3, 3):
        hsh = ((k + variant * 5) * 2654435761) & 0xFFFF
        cx = px + int((k + 0.5) * step)
        r = int(h * (0.30 + 0.16 * ((hsh >> 3) % 100) / 100.0))
        cy = y - int(h * (0.22 + 0.20 * ((hsh >> 9) % 100) / 100.0))
        cv2.circle(canvas, (cx, cy), max(2, r), tones[(k + variant) % 3], -1,
                   cv2.LINE_AA)
        if r > 5 and hsh & 1:
            cv2.circle(canvas, (cx + r // 3, cy - r // 3), max(1, r // 3),
                       (72, 150, 160), -1, cv2.LINE_AA)


def _banner_wall(canvas: np.ndarray, px: int, y: int, half: float, variant: int,
                 road_hi: float) -> None:
    """A long sponsor banner wall out beyond the grandstands: the second
    scenery layer, a run of colour across the middle distance where the frame
    used to be nothing but mown lawn."""
    w = int(half * 1.70)
    if w < 16:
        if w > 5:
            cv2.rectangle(canvas, (px - w // 2, y - max(2, w // 6)),
                          (px + w // 2, y), (176, 180, 192), -1)
        return
    h = max(5, int(w * 0.20))
    stilt = max(2, int(h * 0.34))
    base = y - stilt
    top = base - h
    _ground_shadow(canvas, px, y, int(w * 0.30), max(2, h // 3), road_hi)
    x0, x1 = px - w // 2, px + w // 2
    # Legs, so the run is a STRUCTURE standing on the field rather than a strip
    # of colour swatches floating over it.
    leg = max(1, w // 90)
    for k in range(5):
        lx = x0 + int((x1 - x0) * (0.06 + 0.22 * k))
        cv2.rectangle(canvas, (lx - leg, base), (lx + leg, y), (56, 58, 68), -1)
    cv2.rectangle(canvas, (x0, top), (x1, base), (36, 38, 46), -1)
    cells = max(3, w // max(10, int(half * 0.42)))
    cw = w / cells
    seam = max(1, w // 200)
    for i in range(cells):
        text, bg, fg = _SPONSORS[(i + variant) % len(_SPONSORS)]
        cx0, cx1 = int(x0 + i * cw) + seam, int(x0 + (i + 1) * cw) - seam
        if cx1 - cx0 < 2:
            continue
        cv2.rectangle(canvas, (cx0, top + seam), (cx1, base - seam), bg, -1)
        cv2.rectangle(canvas, (cx0, top + seam),
                      (cx1, top + seam + max(2, h // 5)),
                      tuple(min(255, int(c * 1.28) + 20) for c in bg), -1)
        if cw > 54 and h > 13:
            scale = cw / 200.0
            tw = text_width(text, scale, 2)
            draw_text(canvas, text,
                      (int((cx0 + cx1 - tw) // 2), base - h // 2 + int(scale * 11)),
                      fg, scale=scale, thickness=2, outline=False)
    # A capping rail along the top, catching the low sun.
    cv2.rectangle(canvas, (x0 - leg, top - max(2, h // 6)), (x1 + leg, top),
                  (196, 200, 210), -1)
    cv2.rectangle(canvas, (x0 - leg, top - max(2, h // 6)),
                  (x1 + leg, top - max(1, h // 12)), (232, 236, 244), -1)


def _pennant_pole(canvas: np.ndarray, px: int, y: int, half: float,
                  variant: int, now: float, road_hi: float) -> None:
    """A tall pennant mast: three long flags stacked down a white pole. Cheap,
    vertical, and everywhere - the thing that gives the middle distance a beat
    the eye can count speed against."""
    h = int(half * 0.48)
    if h < 10:
        if h > 3:
            cv2.line(canvas, (px, y), (px, y - h), (216, 220, 228), 1,
                     cv2.LINE_AA)
        return
    _ground_shadow(canvas, px, y, int(h * 0.20), max(2, h // 26), road_hi)
    cv2.line(canvas, (px, y), (px, y - h), (28, 30, 38),
             max(2, h // 34) + 2, cv2.LINE_AA)
    cv2.line(canvas, (px, y), (px, y - h), (222, 226, 234), max(1, h // 34),
             cv2.LINE_AA)
    cv2.circle(canvas, (px, y - h), max(2, h // 26), (60, 190, 250), -1,
               cv2.LINE_AA)
    side = 1 if variant % 2 else -1
    fl = int(h * 0.24)
    fh = max(3, int(h * 0.13))
    for j in range(4):
        top = y - h + int(h * 0.06) + j * int(fh * 1.18)
        wave = math.sin(now * 2.6 + px * 0.05 + j)
        cv2.fillPoly(canvas, [np.array(
            [(px, top), (px, top + fh),
             (px + side * fl, top + fh // 2 + int(wave * fh * 0.28))],
            np.int32)], BUNTING[(j + variant) % len(BUNTING)], cv2.LINE_AA)


def _tree(canvas: np.ndarray, px: int, y: int, half: float, variant: int,
          road_hi: float) -> None:
    h = int(half * (0.50 + 0.12 * variant))
    if h < 4:
        cv2.circle(canvas, (px, y - 1), max(1, h // 2), (34, 90, 74), -1)
        return
    if h > 10:
        _ground_shadow(canvas, px, y, int(h * 0.42), max(2, int(h * 0.085)),
                       road_hi)
    trunk_w = max(1, h // 14)
    trunk_h = int(h * 0.38)
    cv2.rectangle(canvas, (px - trunk_w, y - trunk_h), (px + trunk_w, y),
                  (36, 54, 84), -1)
    r = max(2, int(h * 0.30))
    for dx, dy, rr in ((0, trunk_h + r // 2, r),
                       (-r // 2, trunk_h - r // 4, int(r * 0.8)),
                       (r // 2, trunk_h - r // 6, int(r * 0.72))):
        cv2.circle(canvas, (px + dx, y - dy), max(2, rr), (34, 90, 74), -1,
                   cv2.LINE_AA)
    cv2.circle(canvas, (px + r // 2, y - trunk_h - r // 2), max(1, r // 3),
               (74, 158, 168), -1, cv2.LINE_AA)  # sun-side rim light


def _post(canvas: np.ndarray, px: int, y: int, half: float,
          variant: int) -> None:
    """A kerbside marker post: short, striped, and everywhere - the metronome
    that makes speed legible on an empty straight."""
    h = int(half * 0.13)
    if h < 3:
        return
    w = max(1, h // 6)
    cv2.rectangle(canvas, (px - w, y - h), (px + w, y), (224, 228, 232), -1)
    cap = (52, 52, 208) if variant != 1 else (60, 190, 250)
    cv2.rectangle(canvas, (px - w, y - h), (px + w, y - h + max(1, h // 3)),
                  cap, -1)


def _copse(canvas: np.ndarray, px: int, y: int, half: float, variant: int,
           road_hi: float) -> None:
    """A cluster of trees out in the deep field: three or four canopy blobs
    leaning together, with the sun catching the top of the near one."""
    h = int(half * (0.46 + 0.10 * variant))
    if h < 4:
        cv2.circle(canvas, (px, y - 1), max(1, h // 2), (32, 88, 72), -1)
        return
    if h > 10:
        _ground_shadow(canvas, px, y, int(h * 0.62), max(2, int(h * 0.11)),
                       road_hi)
    tones = ((28, 82, 64), (33, 91, 74), (38, 100, 85))
    for k, (dx_f, dy_f, r_f) in enumerate(((-0.62, 0.28, 0.34), (0.55, 0.24, 0.30),
                                           (-0.12, 0.48, 0.42), (0.26, 0.36, 0.28))):
        cv2.circle(canvas, (px + int(h * dx_f), y - int(h * dy_f)),
                   max(2, int(h * r_f)), tones[(k + variant) % 3], -1,
                   cv2.LINE_AA)
    cv2.circle(canvas, (px + int(h * 0.24), y - int(h * 0.62)),
               max(1, int(h * 0.15)), (70, 152, 164), -1, cv2.LINE_AA)


def _berm(canvas: np.ndarray, px: int, y: int, half: float, variant: int,
          now: float, road_hi: float) -> None:
    """A spectator berm: a low grassy mound with a line of fans on top,
    shimmering like the grandstand crowd."""
    w = int(half * 0.60)
    if w < 10:
        return
    h = max(3, int(w * 0.20))
    _ground_shadow(canvas, px, y, int(w * 0.58), max(2, h // 2), road_hi)
    cv2.ellipse(canvas, (px, y), (w, h), 0, 180, 360, (30, 72, 72), -1,
                cv2.LINE_AA)
    cv2.ellipse(canvas, (px - w // 5, y), (int(w * 0.72), int(h * 0.70)), 0,
                180, 360, (44, 94, 90), -1, cv2.LINE_AA)
    if w > 26:
        tick = int(now * 9.0)
        step = max(4, w // 13)
        for i, cx in enumerate(range(px - w + step, px + w - step // 2, step)):
            hsh = ((i * 40503) ^ (variant * 9176) ^ (tick * 2246822519)) & 0xFFFF
            colour = _CROWD[(i * 7 + variant) % len(_CROWD)]
            lift = hsh % 3
            if (i + tick) % 5 == 0:
                colour = tuple(min(255, int(c * 1.25)) for c in colour)
                lift += 2
            dy = int(h * max(0.0, 1.0 - ((cx - px) / w) ** 2))
            cv2.circle(canvas, (cx + hsh % 3 - 1, y - dy - lift - h // 6),
                       max(2, int(step * 0.45)), colour, -1)


def _tire_stack(canvas: np.ndarray, px: int, y: int, half: float, variant: int,
                road_hi: float) -> None:
    r = int(half * 0.075)
    if r < 3:
        return
    _ground_shadow(canvas, px, y, int(r * 1.8), max(1, r // 2), road_hi)
    rows = 2 + variant % 2
    top_cy = y
    for i in range(rows):
        cy = y - i * int(r * 0.85) - int(r * 0.45)
        top_cy = cy
        cv2.ellipse(canvas, (px, cy), (r, max(2, int(r * 0.58))), 0, 0, 360,
                    (28, 28, 33), -1, cv2.LINE_AA)
        cv2.ellipse(canvas, (px + r // 4, cy - r // 6),
                    (max(1, int(r * 0.62)), max(1, int(r * 0.34))), 0, 200, 340,
                    (58, 62, 74), max(1, r // 4), cv2.LINE_AA)
        # The sun edge, on the right shoulder of every carcass in the stack.
        if r > 5:
            cv2.ellipse(canvas, (px, cy), (r, max(2, int(r * 0.58))), 0,
                        -62, 56, RIM_CREAM, max(1, r // 5), cv2.LINE_AA)
    cv2.ellipse(canvas, (px, top_cy - r // 8),
                (max(2, int(r * 0.5)), max(1, int(r * 0.26))), 0, 0, 360,
                (196, 204, 214), max(1, r // 5), cv2.LINE_AA)


#: The bundle caps: a corner tyre barrier is banded in circuit colours so the
#: driver can read how far round the bend it wraps at a glance.
_BUNDLE_CAPS = ((60, 60, 214), (60, 190, 250), (246, 249, 252), (222, 122, 44),
                (96, 200, 96))


def _tyre_bundle(canvas: np.ndarray, px: int, y: int, half: float,
                 variant: int, road_hi: float) -> None:
    """A corner bundle: six to eight banded tyre stacks lashed side by side.

    This is the prop that dresses the inside of a bend. Where the tyre WALL is
    a thin run of rings hugging the kerb, a bundle is a chest-high block of
    them, three deep, strapped with a bright band and topped with a white
    conveyor rail - the silhouette every real circuit puts on the apex.
    """
    r = int(half * 0.062)
    if r < 3:
        cv2.line(canvas, (px - max(2, r * 5), y - 1), (px + max(2, r * 5), y - 1),
                 (30, 30, 36), max(1, r * 2), cv2.LINE_AA)
        return
    stacks = 5 + variant % 2
    span = max(2, int(r * 1.55))
    left = px - (stacks * span) // 2
    _ground_shadow(canvas, px, y, int(stacks * span * 0.72), max(2, r // 2),
                   road_hi)
    cap = _BUNDLE_CAPS[variant % len(_BUNDLE_CAPS)]
    rows = 3 if r > 11 else 2
    # The dark mass of the whole block goes down in ONE polygon; only the
    # rings that show along the top and the front are drawn as ellipses.
    cv2.rectangle(canvas, (left, y - int(r * 0.86 * (rows - 1))),
                  (left + stacks * span, y), (26, 26, 32), -1)
    for k in range(stacks):
        cx = left + k * span + span // 2
        lift = (k % 2) * (r // 5)
        for i in range(rows):
            cy = y - i * int(r * 0.86) - int(r * 0.48) - lift
            cv2.ellipse(canvas, (cx, cy), (r, max(2, int(r * 0.60))), 0, 0, 360,
                        (26, 26, 32), -1, cv2.LINE_AA)
            if r > 9:
                cv2.ellipse(canvas, (cx + r // 4, cy - r // 6),
                            (max(1, int(r * 0.60)), max(1, int(r * 0.33))),
                            0, 200, 345, (60, 64, 76), max(1, r // 4),
                            cv2.LINE_AA)
    # The colour is in the TYRES, not on a plank laid over them: every third
    # stack is capped in a circuit colour, and one thin lashing strap runs the
    # length of the bundle.
    for k in range(stacks):
        if k % 3 != 1:
            continue
        cx = left + k * span + span // 2
        cy = y - int(r * 0.86 * (rows - 1)) - int(r * 0.48) - (k % 2) * (r // 5)
        cv2.ellipse(canvas, (cx, cy), (r, max(2, int(r * 0.60))), 0, 0, 360,
                    cap, -1, cv2.LINE_AA)
        cv2.ellipse(canvas, (cx, cy), (max(1, int(r * 0.42)),
                                       max(1, int(r * 0.24))), 0, 0, 360,
                    (26, 26, 32), -1, cv2.LINE_AA)
    strap = y - int(r * 1.30)
    cv2.line(canvas, (left, strap), (left + stacks * span, strap),
             (206, 212, 222), max(1, r // 5), cv2.LINE_AA)


def _hedge(canvas: np.ndarray, px: int, y: int, half: float, variant: int,
           road_hi: float) -> None:
    """A low clipped hedge running immediately behind the guard rail.

    Laid end to end all the way round, this is what stops the mown field
    running straight up to the barrier in the near corners of the frame - the
    one strip of ground the taller scenery can never reach, because anything
    planted that close is off the side of the picture by the time it is big
    enough to see.
    """
    h = max(2, int(half * (0.145 + 0.035 * (variant % 3))))
    span = max(3, int(half * (0.50 + 0.06 * (variant % 2))))
    # Planted BEHIND the guard rail, so its foot is lifted clear of the wall:
    # this projection gives every prop on a given slice of road the same
    # ground row whatever its lateral distance, and without the lift the hedge
    # would paint straight over the barrier it is meant to stand behind.
    y -= max(2, int(half * 0.105))
    if h < 3:
        cv2.line(canvas, (px - span, y - 1), (px + span, y - 1), (34, 92, 68),
                 max(1, h), cv2.LINE_AA)
        return
    body = np.array([(px - span, y), (px - span, y - h + h // 3),
                     (px - span + h // 3, y - h), (px + span - h // 3, y - h),
                     (px + span, y - h + h // 3), (px + span, y)], np.int32)
    cv2.fillPoly(canvas, [body], (30, 92, 66), cv2.LINE_AA)
    # A sunlit top edge and one darker scallop, so it is a clipped hedge and
    # not a green kerb.
    cv2.fillPoly(canvas, [np.array(
        [(px - span + h // 3, y - h), (px + span - h // 3, y - h),
         (px + span - h // 3, y - h + max(1, h // 4)),
         (px - span + h // 3, y - h + max(1, h // 4))], np.int32)],
        (52, 140, 96), cv2.LINE_AA)
    if h > 11:
        step = max(6, span)
        for sx in range(px - span + step // 2, px + span, step):
            cv2.circle(canvas, (sx, y - h + h // 5), max(2, h // 5),
                       (40, 116, 82), -1, cv2.LINE_AA)


def _poplar(canvas: np.ndarray, px: int, y: int, half: float, variant: int,
            road_hi: float) -> None:
    """A single tall poplar: a narrow flame of foliage on a bare trunk.

    Planted in lines marching away to the horizon, these are what give the
    outfield a measurable cadence - a round tree at distance is a green dot,
    a poplar is a mast, and a row of masts reads as depth.
    """
    h = int(half * (0.58 + 0.11 * (variant % 3)))
    if h < 6:
        cv2.line(canvas, (px, y), (px, y - max(2, h)), (36, 96, 70),
                 max(1, h // 4), cv2.LINE_AA)
        return
    w = max(2, int(h * 0.13))
    if h < 20:      # a mast this far out is a trunk and one flame, not six lobes
        cv2.line(canvas, (px, y), (px, y - int(h * 0.30)), (48, 68, 92),
                 max(1, w // 2), cv2.LINE_AA)
        cv2.ellipse(canvas, (px, y - int(h * 0.58)),
                    (max(2, w), max(3, int(h * 0.44))), 0, 0, 360,
                    (40, 118, 82), -1, cv2.LINE_AA)
        return
    _ground_shadow(canvas, px, y, int(h * 0.44), max(2, int(h * 0.06)), road_hi)
    cv2.line(canvas, (px, y), (px, y - int(h * 0.26)), (48, 68, 92),
             max(1, w // 2), cv2.LINE_AA)
    # A narrow flame: a soft shoulder low down tapering to a point, drawn as a
    # stack of shrinking lobes so the silhouette is not a flat kite.
    for k, (fy, fw, tone) in enumerate((
            (0.20, 1.00, (34, 104, 74)), (0.44, 0.92, (38, 116, 80)),
            (0.66, 0.70, (44, 128, 88)), (0.84, 0.44, (50, 140, 96)))):
        cy = y - int(h * fy)
        cv2.ellipse(canvas, (px, cy), (max(2, int(w * fw)),
                                       max(3, int(h * (0.22 - 0.03 * k)))),
                    0, 0, 360, tone, -1, cv2.LINE_AA)
    cv2.fillPoly(canvas, [np.array(
        [(px, y - h), (px + max(2, int(w * 0.42)), y - int(h * 0.80)),
         (px - max(2, int(w * 0.42)), y - int(h * 0.80))], np.int32)],
        (52, 144, 98), cv2.LINE_AA)
    # The sun on the right flank.
    cv2.ellipse(canvas, (px + max(1, w // 3), y - int(h * 0.52)),
                (max(1, int(w * 0.42)), max(2, int(h * 0.22))), 0, 0, 360,
                (62, 158, 106), -1, cv2.LINE_AA)


#: The marshal's tabard, and the flags a post waves.
_MARSHAL_FLAGS = ((58, 190, 250), (60, 60, 216), (246, 249, 252))


def _marshal(canvas: np.ndarray, px: int, y: int, half: float, variant: int,
             now: float, road_hi: float) -> None:
    """A marshal post: a striped booth, an orange-clad figure, a waved flag.

    A racetrack has PEOPLE working it. One figure in high-vis at the inside of
    every bend does more to sell a live race meeting than another hundred
    metres of hedge.
    """
    h = int(half * 0.34)
    if h < 7:
        cv2.line(canvas, (px, y), (px, y - max(2, h)), (40, 120, 240),
                 max(1, h // 2), cv2.LINE_AA)
        return
    _ground_shadow(canvas, px, y, int(h * 0.90), max(2, int(h * 0.13)), road_hi)
    # The booth: a red-and-white striped panel the figure stands in front of.
    bw = int(h * 0.78)
    cv2.rectangle(canvas, (px - bw, y - h), (px + bw, y), (208, 214, 222), -1)
    stripe = max(2, bw // 3)
    for i, sx in enumerate(range(px - bw, px + bw, stripe)):
        if i % 2 == 0:
            cv2.rectangle(canvas, (sx, y - h), (min(sx + stripe, px + bw), y),
                          (52, 52, 210), -1)
    cv2.rectangle(canvas, (px - bw, y - h - max(2, h // 8)),
                  (px + bw, y - h), (74, 78, 92), -1)
    # The figure: high-vis torso, dark legs, a head, and an arm on the flag.
    fx = px - int(bw * 0.34)
    fh = int(h * 0.76)
    tw = max(2, int(fh * 0.30))
    cv2.rectangle(canvas, (fx - tw, y - fh), (fx + tw, y - int(fh * 0.34)),
                  (40, 150, 250), -1)
    cv2.rectangle(canvas, (fx - tw, y - int(fh * 0.62)),
                  (fx + tw, y - int(fh * 0.52)), (232, 238, 246), -1)
    cv2.rectangle(canvas, (fx - tw, y - int(fh * 0.34)), (fx + tw, y),
                  (52, 46, 58), -1)
    cv2.circle(canvas, (fx, y - fh - max(1, int(fh * 0.13))),
               max(2, int(fh * 0.15)), (150, 178, 206), -1, cv2.LINE_AA)
    # The flag, waved: a mast out of the shoulder and a triangle snapping on it.
    wave = math.sin(now * 5.2 + px * 0.03)
    tip = (fx + int(fh * 0.62), y - fh - int(fh * 0.30) + int(wave * fh * 0.18))
    cv2.line(canvas, (fx + tw, y - int(fh * 0.86)), tip, (196, 200, 210),
             max(1, int(fh * 0.07)), cv2.LINE_AA)
    fl = max(3, int(fh * 0.44))
    flag = _MARSHAL_FLAGS[variant % len(_MARSHAL_FLAGS)]
    cv2.fillPoly(canvas, [np.array(
        [tip, (tip[0] - fl, tip[1] - int(fl * 0.20) + int(wave * fl * 0.30)),
         (tip[0] - int(fl * 0.86), tip[1] + int(fl * 0.52))], np.int32)],
        flag, cv2.LINE_AA)


#: The coloured caps on the tyre wall, cycling round the circuit.
_WALL_CAPS = ((60, 60, 214), (60, 190, 250), (246, 249, 252), (222, 122, 44))


def _tyre_wall(canvas: np.ndarray, px: int, y: int, half: float, variant: int,
               road_hi: float) -> None:
    """A run of the tyre wall: four stacks of black rings shoulder to
    shoulder along the outer kerb, each capped in a circuit colour.

    Laid end to end round the whole lap this is the single prop that turns
    the shoulder of the road into a racing barrier - and it fills the outfield
    with a moving rhythm the eye can measure speed against.
    """
    r = int(half * 0.052)
    if r < 2:
        cv2.line(canvas, (px - max(2, r * 3), y - 1), (px + max(2, r * 3), y - 1),
                 (34, 34, 40), max(1, r), cv2.LINE_AA)
        return
    span = max(1, int(r * 1.6))
    _ground_shadow(canvas, px, y, int(r * 3.4), max(2, r // 2), road_hi)
    cap = _WALL_CAPS[variant % len(_WALL_CAPS)]
    for k in (-2, -1, 0, 1):
        cx = px + k * span + span // 2
        for i in range(2):
            cy = y - i * int(r * 0.92) - int(r * 0.48)
            cv2.ellipse(canvas, (cx, cy), (r, max(2, int(r * 0.60))), 0, 0, 360,
                        (26, 26, 32), -1, cv2.LINE_AA)
            if r > 4:
                cv2.ellipse(canvas, (cx + r // 4, cy - r // 6),
                            (max(1, int(r * 0.60)), max(1, int(r * 0.34))),
                            0, 195, 345, (62, 66, 78), max(1, r // 4),
                            cv2.LINE_AA)
        cv2.ellipse(canvas, (cx, y - int(r * 1.52)),
                    (max(2, int(r * 0.88)), max(1, int(r * 0.40))), 0, 180, 360,
                    cap, -1, cv2.LINE_AA)


def _tent(canvas: np.ndarray, px: int, y: int, half: float, variant: int,
          road_hi: float) -> None:
    """A red-and-white striped hospitality marquee out on the field."""
    w = int(half * 0.58)
    if w < 9:
        cv2.rectangle(canvas, (px - max(2, w // 2), y - max(2, w // 3)),
                      (px + max(2, w // 2), y), (232, 236, 240), -1)
        return
    h = int(w * 0.44)
    roof = int(h * 0.60)
    _ground_shadow(canvas, px, y, int(w * 0.46), max(2, h // 7), road_hi)
    x0, x1 = px - w // 2, px + w // 2
    # Walls, then a scalloped striped canopy pitched over them.
    cv2.rectangle(canvas, (x0, y - h + roof), (x1, y), (228, 232, 238), -1)
    cv2.rectangle(canvas, (x0, y - h + roof), (x1, y), (170, 176, 186),
                  max(1, w // 90), cv2.LINE_AA)
    cells = max(4, w // max(4, int(half * 0.055)))
    cw = (x1 - x0) / cells
    apex = (px, y - h - roof // 2)
    for i in range(cells):
        colour = (58, 58, 216) if (i + variant) % 2 else (246, 249, 252)
        pts = np.array([(int(x0 + i * cw), y - h + roof),
                        (int(x0 + (i + 1) * cw), y - h + roof),
                        apex], np.int32)
        cv2.fillPoly(canvas, [pts], colour, cv2.LINE_AA)
    # A scalloped hem along the eaves, and a pennant off the apex.
    for i in range(cells):
        cv2.ellipse(canvas, (int(x0 + (i + 0.5) * cw), y - h + roof),
                    (max(1, int(cw * 0.5)), max(1, roof // 6)), 0, 0, 180,
                    (58, 58, 216) if (i + variant) % 2 else (246, 249, 252),
                    -1, cv2.LINE_AA)
    if h > 12:
        cv2.line(canvas, apex, (apex[0], apex[1] - int(h * 0.34)),
                 (168, 172, 184), max(1, w // 80), cv2.LINE_AA)
        tip = apex[1] - int(h * 0.34)
        cv2.fillPoly(canvas, [np.array(
            [(apex[0], tip), (apex[0] + int(w * 0.14), tip + max(2, h // 12)),
             (apex[0], tip + max(3, h // 6))], np.int32)],
            (60, 190, 250), cv2.LINE_AA)
    if w > 34:   # a doorway, so the marquee has a human scale
        dw, dh = max(2, w // 9), max(3, int(h * 0.32))
        cv2.rectangle(canvas, (px - dw, y - dh), (px + dw, y), (92, 96, 112), -1)


def _adboard(canvas: np.ndarray, px: int, y: int, half: float, variant: int,
             road_hi: float) -> None:
    """A low sponsor hoarding: wide, close to the ground, quick to pass."""
    w = int(half * 0.36)
    if w < 8:
        return
    h = max(3, int(w * 0.24))
    post = max(2, int(w * 0.09))
    _ground_shadow(canvas, px, y, int(w * 0.4), max(2, w // 26), road_hi)
    top = y - post - h
    for dx in (-w // 3, w // 3):
        cv2.rectangle(canvas, (px + dx - max(1, w // 44), top + h),
                      (px + dx + max(1, w // 44), y), (54, 56, 64), -1)
    x0, x1 = px - w // 2, px + w // 2
    if variant == 0:
        cv2.rectangle(canvas, (x0, top), (x1, top + h), (40, 122, 236), -1)
        text, tc = "TURBO", (244, 246, 250)
    elif variant == 1:
        cv2.rectangle(canvas, (x0, top), (x1, top + h), (128, 96, 34), -1)
        for i in range(4):
            sx = x0 + i * w // 4
            pts = np.array([(sx, top + h), (sx + w // 8, top),
                            (sx + w // 4, top), (sx + w // 8, top + h)],
                           np.int32)
            cv2.fillPoly(canvas, [pts], (168, 138, 66))
        text, tc = "APEX", (236, 240, 244)
    else:
        cv2.rectangle(canvas, (x0, top), (x1, top + h), (226, 231, 236), -1)
        cv2.circle(canvas, (x0 + w // 6, top + h // 2), max(2, h // 3),
                   (56, 60, 224), -1, cv2.LINE_AA)
        text, tc = "PIT-STOP", (40, 42, 48)
    cv2.rectangle(canvas, (x0, top), (x1, top + h), (40, 40, 46),
                  max(1, w // 70), cv2.LINE_AA)
    if w > 64:
        scale = w / 240.0
        tw = text_width(text, scale, 2)
        draw_text(canvas, text, (px - tw // 2 + w // 12,
                                 top + (h + int(scale * 22)) // 2),
                  tc, scale=scale, thickness=2, outline=False)


_FLAGS = ((52, 52, 208), (60, 190, 250), (96, 168, 236))


def _flagpole(canvas: np.ndarray, px: int, y: int, half: float, variant: int,
              now: float, road_hi: float) -> None:
    h = int(half * 0.46)
    if h < 8:
        return
    _ground_shadow(canvas, px, y, int(h * 0.5), max(2, h // 24), road_hi)
    cv2.line(canvas, (px, y - h), (px, y), (150, 156, 168), max(1, h // 32),
             cv2.LINE_AA)
    fw, fh = int(h * 0.42), max(3, int(h * 0.16))
    wave = math.sin(now * 3.4 + px * 0.13)
    tip_y = y - h + fh // 2 + int(wave * fh * 0.4)
    pts = np.array([(px, y - h), (px, y - h + fh),
                    (px + fw, tip_y)], np.int32)
    cv2.fillPoly(canvas, [pts], _FLAGS[variant % len(_FLAGS)], cv2.LINE_AA)


def _billboard(canvas: np.ndarray, px: int, y: int, half: float,
               variant: int, road_hi: float) -> None:
    w = int(half * 0.52)
    if w < 6:
        return
    h = int(w * 0.48)
    _ground_shadow(canvas, px, y, int(w * 0.55), max(2, w // 24), road_hi)
    post_w = max(1, w // 22)
    top = y - int(w * 0.5) - h
    cv2.rectangle(canvas, (px - post_w, top + h), (px + post_w, y), (56, 58, 66), -1)
    x0, x1 = px - w // 2, px + w // 2
    if variant == 0:
        cv2.rectangle(canvas, (x0, top), (x1, top + h), (48, 94, 232), -1)
        text, tc = "SUNSET", (240, 244, 248)
    elif variant == 1:
        cv2.rectangle(canvas, (x0, top), (x1, top + h), (62, 46, 40), -1)
        cv2.circle(canvas, (x0 + w // 5, top + h // 2), max(2, h // 4),
                   (90, 190, 250), -1, cv2.LINE_AA)
        text, tc = "OCTANE", (150, 205, 250)
    else:
        cv2.rectangle(canvas, (x0, top), (x1, top + h), (224, 230, 236), -1)
        for i in range(3):
            sx = x0 + i * w // 3
            pts = np.array([(sx, top + h), (sx + w // 6, top),
                            (sx + w // 3, top), (sx + w // 6, top + h)], np.int32)
            cv2.fillPoly(canvas, [pts], (60, 60, 205))
        text, tc = "GP-7", (30, 30, 34)
    cv2.rectangle(canvas, (x0, top), (x1, top + h), (40, 40, 46),
                  max(1, w // 60), cv2.LINE_AA)
    if w > 52:
        scale = w / 190.0
        tw = text_width(text, scale, 2)
        draw_text(canvas, text, (px - tw // 2, top + (h + int(scale * 22)) // 2),
                  tc, scale=scale, thickness=2)


_CROWD = ((88, 106, 214), (196, 168, 84), (198, 176, 96), (108, 196, 218),
          (186, 116, 128), (96, 186, 138), (150, 158, 186), (128, 96, 200))


#: Solid roof colours and their fascia trims. A circuit's buildings are a
#: SET - the same handful of sponsor colours, never one asset five times.
_STAND_ROOFS = ((60, 60, 214), (222, 122, 44), (86, 156, 72), (196, 84, 168),
                (54, 58, 70))
_STAND_TRIM = ((238, 242, 248), (60, 190, 250), (238, 242, 248), (96, 220, 250))


def _grandstand(canvas: np.ndarray, px: int, y: int, half: float, variant: int,
                now: float, road_hi: float) -> None:
    """A spectator stand - one of THREE buildings, not one asset repeated.

    ``variant`` 0 is a covered stand under a solid coloured roof, 1 an open
    scaffold bleacher with no canopy at all and its trusses on show, 2 a low
    VIP box glazed along its front. The crowd density, the roof colour and the
    seat tone all key off the variant AND off where the building stands, so
    two of the same kind never come out as the same picture. Five identical
    checkered roofs round one lap is the loudest 'this is a mockup' tell there
    is, and this circuit used to have exactly that.
    """
    kind = variant % 3
    # Where it stands picks its colours: two stands of the same kind a hundred
    # metres apart must not be the same building drawn twice.
    tag = (px * 2654435761) & 0xFFFF
    w = int(half * (1.52, 1.44, 1.30)[kind])
    h = int(half * (1.16, 1.00, 0.62)[kind])
    if w < 14:
        cv2.rectangle(canvas, (px - w // 2, y - max(2, h)), (px + w // 2, y),
                      (118, 116, 130), -1)
        if h > 4:
            cv2.rectangle(canvas, (px - w // 2, y - h - max(1, h // 4)),
                          (px + w // 2, y - h), (60, 60, 206), -1)
        return
    _ground_shadow(canvas, px, y, int(w * 0.46), max(2, h // 11), road_hi)
    x0, x1 = px - w // 2, px + w // 2
    lo = max(0, x0)
    hi = min(canvas.shape[1], x1)
    # Plinth and back frame.
    cv2.rectangle(canvas, (x0, y - int(h * 0.12)), (x1, y), (74, 76, 90), -1)
    cv2.rectangle(canvas, (x0, y - h), (x1, y - int(h * 0.10)), (150, 152, 166),
                  -1)
    tiers = (6, 7, 3)[kind]
    tick = int(now * 9.0)
    # Density: the covered stand is packed, the bleacher is heaving, the VIP
    # box has half a dozen people in it with room to move.
    step = max(3, int(w / (19.0, 21.0, 11.0)[kind]))
    head = max(1, int(step * 0.58))
    seats = ((92, 94, 110), (78, 96, 84), (96, 88, 84))[kind]
    pitch = (0.135, 0.118, 0.180)[kind]
    for row in range(tiers):
        ty = y - int(h * (0.16 + pitch * row))
        inset = int(w * 0.010 * row)
        seat = seats if row % 2 else tuple(int(c * 0.86) for c in seats)
        cv2.rectangle(canvas, (x0 + inset, ty - max(2, int(h * 0.11))),
                      (x1 - inset, ty), seat, -1)
        if step < 3:
            continue
        # The crowd is PACKED: heads overlap, staggered into two sub-rows, so
        # a full stand reads as a mass of people rather than a bead necklace.
        for i, cx in enumerate(range(max(x0 + step, lo - step),
                                     min(x1 - step // 2, hi + step), step)):
            hsh = ((i * 40503) ^ (row * 9176) ^ (tick * 2246822519)) & 0xFFFF
            colour = _CROWD[(i * 5 + row * 3 + variant) % len(_CROWD)]
            stagger = 0 if i % 2 else max(1, int(step * 0.55))
            lift = hsh % 2 + stagger
            if (i + row + tick) % 4 == 0:
                colour = tuple(min(255, int(c * 1.4)) for c in colour)
                lift += max(1, step // 2) + (hsh >> 3) % 2
            cv2.circle(canvas, (cx + hsh % 3 - 1, ty - lift - head),
                       head, colour, -1, cv2.LINE_AA)
        cv2.line(canvas, (x0 + inset, ty), (x1 - inset, ty), (54, 56, 68),
                 max(1, h // 44), cv2.LINE_AA)
    roof_h = max(2, int(h * (0.20, 0.10, 0.16)[kind]))
    roof_y = y - h - roof_h
    if kind == 0:
        # THE COVERED STAND: one solid roof in a circuit colour, with a bright
        # fascia stripe along its leading edge. Solid, not checkered - the
        # checker belongs on the flag and on the kerb, not on every building.
        roof = _STAND_ROOFS[tag % len(_STAND_ROOFS)]
        cv2.rectangle(canvas, (x0, roof_y), (x1, y - h), roof, -1)
        cv2.rectangle(canvas, (x0, y - h - max(1, roof_h // 4)), (x1, y - h),
                      _STAND_TRIM[(tag >> 4) % len(_STAND_TRIM)], -1)
        for cx in (x0 + max(2, w // 24), x1 - max(2, w // 24)):
            cv2.rectangle(canvas, (cx - max(1, w // 110), roof_y),
                          (cx + max(1, w // 110), y), (92, 94, 108), -1)
    elif kind == 1:
        # THE OPEN BLEACHER: no canopy at all. Scaffold uprights and two
        # diagonal braces stand proud of the back rank, which is a completely
        # different silhouette against the sky from a roofed stand.
        pole = max(1, w // 90)
        for i in range(5):
            cx = x0 + w * i // 4
            cv2.rectangle(canvas, (cx - pole, roof_y), (cx + pole, y),
                          (108, 110, 124), -1)
        for i in range(4):
            cv2.line(canvas, (x0 + w * i // 4, y - int(h * 0.20)),
                     (x0 + w * (i + 1) // 4, roof_y + roof_h),
                     (92, 94, 108), max(1, pole), cv2.LINE_AA)
        cv2.rectangle(canvas, (x0, roof_y + roof_h),
                      (x1, roof_y + roof_h + max(1, pole * 2)),
                      (128, 130, 144), -1)
    else:
        # THE VIP BOX: a low glazed room with a flat roof and a dark green
        # band of glass across its whole front, the crowd dim behind it.
        glass = (86, 104, 96)
        gy0 = y - int(h * 0.86)
        cv2.rectangle(canvas, (x0 + int(w * 0.03), gy0),
                      (x1 - int(w * 0.03), y - int(h * 0.30)), glass, -1)
        for i in range(1, 5):
            mx = x0 + w * i // 5
            cv2.line(canvas, (mx, gy0), (mx, y - int(h * 0.30)),
                     (150, 156, 164), max(1, w // 140), cv2.LINE_AA)
        # One raked sun-flare across the glazing, so it reads as GLASS.
        cv2.line(canvas, (x0 + int(w * 0.10), y - int(h * 0.34)),
                 (x0 + int(w * 0.44), gy0 + max(1, int(h * 0.04))),
                 (188, 214, 226), max(1, int(h * 0.05)), cv2.LINE_AA)
        cv2.rectangle(canvas, (x0 - max(1, w // 60), roof_y),
                      (x1 + max(1, w // 60), y - h),
                      _STAND_ROOFS[(tag >> 8) % len(_STAND_ROOFS)], -1)
    # A flag waving off the roof corner nearest the track.
    if h > 14 and kind != 2:
        fx = x1 if px < road_hi else x0
        ph = int(h * 0.30)
        cv2.line(canvas, (fx, roof_y - ph), (fx, roof_y), (176, 180, 192),
                 max(1, h // 40), cv2.LINE_AA)
        fl = int(h * 0.20)
        wave = math.sin(now * 3.1 + px * 0.09)
        pts = np.array([(fx, roof_y - ph),
                        (fx, roof_y - ph + max(3, h // 9)),
                        (fx + fl, roof_y - ph + max(2, h // 16)
                         + int(wave * h * 0.04))], np.int32)
        cv2.fillPoly(canvas, [pts], (60, 190, 250), cv2.LINE_AA)


def _distance_board(canvas: np.ndarray, px: int, y: int, half: float,
                    variant: int) -> None:
    w = int(half * 0.17)
    if w < 4:
        return
    h = int(w * 0.85)
    post = int(w * 0.55)
    top = y - post - h
    cv2.rectangle(canvas, (px - max(1, w // 12), top + h), (px + max(1, w // 12), y),
                  (56, 58, 66), -1)
    x0, x1 = px - w // 2, px + w // 2
    if variant in (1, -1):  # chevrons pointing into the corner
        cv2.rectangle(canvas, (x0, top), (x1, top + h), (40, 190, 240), -1)
        d = variant * w // 4
        for i in (-1, 1):
            mid = px + i * w // 5 - d // 2
            pts = np.array([(mid, top + h // 5), (mid + d, top + h // 2),
                            (mid, top + h - h // 5)], np.int32)
            cv2.polylines(canvas, [pts], False, (28, 28, 32),
                          max(1, w // 10), cv2.LINE_AA)
    else:
        cv2.rectangle(canvas, (x0, top), (x1, top + h), (228, 232, 236), -1)
        cv2.rectangle(canvas, (x0, top), (x1, top + max(2, h // 4)), (52, 52, 200), -1)
        if w > 26:
            text = "100" if variant == 3 else "50"
            scale = w / 64.0
            tw = text_width(text, scale, 2)
            draw_text(canvas, text, (px - tw // 2, top + h - h // 6), (30, 30, 34),
                      scale=scale, thickness=2, outline=False)
    cv2.rectangle(canvas, (x0, top), (x1, top + h), (40, 40, 46), 1, cv2.LINE_AA)


_SPONSORS = (("APEX", (44, 128, 240), (250, 250, 252)),
             ("VOLTA", (196, 88, 62), (236, 244, 250)),
             ("NOVA-9", (240, 240, 246), (36, 40, 52)),
             ("SUNSET", (60, 60, 214), (250, 250, 252)),
             ("GRIP-CO", (74, 176, 96), (28, 34, 30)))


def _hoarding(canvas: np.ndarray, px: int, y: int, half: float, variant: int,
              road_hi: float) -> None:
    """A sponsor panel standing shoulder to shoulder with the guard rail.

    Real circuits are lined with these end to end; a run of them behind the
    barrier is what turns a road through a field into a racetrack.
    """
    w = int(half * 0.50)
    if w < 7:
        return
    h = max(2, int(w * 0.30))
    base = y - int(half * 0.19)
    top = base - h
    text, bg, fg = _SPONSORS[variant % len(_SPONSORS)]
    x0, x1 = px - w // 2, px + w // 2
    # Two visible legs planted on the barrier line: a panel with nothing
    # holding it up floats, and a floating panel reads as a decal.
    leg = max(1, w // 40)
    for dx in (-w // 3, w // 3):
        cv2.rectangle(canvas, (px + dx - leg, base), (px + dx + leg, y),
                      (52, 54, 64), -1)
    # THREE-QUARTER, not flat-on: the edge nearer the road stands taller than
    # the one behind it, and a dark return face shows along the far end. A
    # trackside hoarding drawn as a rectangle is a sticker; this one is a
    # board someone stood in a field.
    lean = max(1, h // 6)
    facing = 1 if px > road_hi - half * 1.26 else -1
    near_x, far_x = (x1, x0) if facing > 0 else (x0, x1)
    panel = np.array([(near_x, top - lean), (far_x, top + lean),
                      (far_x, base), (near_x, base + lean // 2)], np.int32)
    cv2.fillPoly(canvas, [panel], bg, cv2.LINE_AA)
    cv2.fillPoly(canvas, [np.array(
        [(near_x, top - lean), (far_x, top + lean),
         (far_x, top + lean + max(1, h // 6)),
         (near_x, top - lean + max(1, h // 6))], np.int32)],
        tuple(min(255, int(c * 1.25) + 22) for c in bg), cv2.LINE_AA)
    cv2.fillPoly(canvas, [np.array(
        [(far_x, top + lean), (far_x + facing * -max(2, w // 14),
                               top + lean + lean // 2),
         (far_x + facing * -max(2, w // 14), base + lean // 3),
         (far_x, base)], np.int32)],
        tuple(int(c * 0.55) for c in bg), cv2.LINE_AA)
    cv2.polylines(canvas, [panel], True, (34, 36, 44), max(1, w // 90),
                  cv2.LINE_AA)
    if w > 56:
        scale = w / 260.0
        tw = text_width(text, scale, 2)
        draw_text(canvas, text, (px - tw // 2, base - h // 2 + int(scale * 11)),
                  fg, scale=scale, thickness=2, outline=False)


def _pylon(canvas: np.ndarray, px: int, y: int, half: float,
           road_hi: float) -> None:
    """A marker cone: the cheapest, loudest way to say 'racing surface'."""
    h = int(half * 0.16)
    if h < 4:
        cv2.circle(canvas, (px, y - 1), max(1, h // 2), (40, 120, 250), -1)
        return
    w = max(2, int(h * 0.52))
    _ground_shadow(canvas, px, y, int(h * 0.7), max(2, h // 5), road_hi)
    cv2.ellipse(canvas, (px, y), (w, max(1, w // 3)), 0, 0, 360, (32, 74, 190),
                -1, cv2.LINE_AA)
    body = np.array([(px - w, y), (px + w, y), (px + max(1, w // 4), y - h),
                     (px - max(1, w // 4), y - h)], np.int32)
    cv2.fillPoly(canvas, [body], (44, 132, 252), cv2.LINE_AA)
    # The cone's sun side: a cream edge down its right flank, same low disc.
    if h > 7:
        cv2.line(canvas, (px + w, y), (px + max(1, w // 4), y - h), RIM_CREAM,
                 max(1, int(h * 0.10)), cv2.LINE_AA)
    if h > 9:
        band = np.array([(px - int(w * 0.66), y - int(h * 0.42)),
                         (px + int(w * 0.66), y - int(h * 0.42)),
                         (px + int(w * 0.52), y - int(h * 0.62)),
                         (px - int(w * 0.52), y - int(h * 0.62))], np.int32)
        cv2.fillPoly(canvas, [band], (238, 244, 250), cv2.LINE_AA)


#: The spin cycle, as a fraction of the coin's radius: six discrete frames
#: from full face to edge-on sliver and back, the way a hand-animated coin
#: turns. A continuous cosine makes a row of coins pulse like one blob; six
#: hard frames make each one an individual object that is CLEARLY spinning.
_COIN_SPIN = (1.00, 0.72, 0.34, 0.12, 0.34, 0.72)


def _coin(canvas: np.ndarray, px: int, y: int, half: float, variant: int,
          now: float) -> None:
    """A collectible spinning over the tarmac: a gold disc with a dark rim, a
    hard specular notch, six spin frames, and its own shadow on the road."""
    r = int(half * 0.092)
    if r < 3:
        cv2.circle(canvas, (px, y - max(1, int(half * 0.16))), max(2, r),
                   COIN_GOLD, -1, cv2.LINE_AA)
        return
    frame = int(now * 9.0 + variant * 2.0 + px * 0.02) % 6
    squeeze = _COIN_SPIN[frame]
    bob = math.sin(now * 2.6 + variant) * r * 0.4
    cy = y - int(half * 0.20 + bob)
    rx = max(1, int(squeeze * r))
    # A small hard shadow on the tarmac, tight when the coin is low: what
    # actually plants a hovering object on the ground.
    sr = max(2, int(r * (0.62 + 0.16 * squeeze)))
    cv2.ellipse(canvas, (px, y), (sr, max(1, sr // 3)), 0, 0, 360,
                _shade_under(canvas, px, y, 0.66), -1, cv2.LINE_AA)
    cv2.ellipse(canvas, (px, cy), (rx, r), 0, 0, 360, COIN_GOLD, -1, cv2.LINE_AA)
    # A thin DARK rim, so two coins side by side never melt into one blob.
    cv2.ellipse(canvas, (px, cy), (rx, r), 0, 0, 360, (26, 92, 148),
                max(1, r // 5), cv2.LINE_AA)
    if r > 4:
        # A hard white specular notch on the leading edge - one clean shape,
        # never a cross of hairlines lying on top of the coin.
        nx = max(1, int(rx * 0.34))
        ny = max(1, int(r * 0.42))
        cv2.ellipse(canvas, (px - int(rx * 0.34), cy - int(r * 0.30)),
                    (nx, ny), -24, 0, 360, (246, 252, 255), -1, cv2.LINE_AA)
    if r > 6 and squeeze > 0.5:   # the speedway's chevron struck into the face
        ch = np.array([(px - int(rx * 0.42), cy + int(r * 0.26)),
                       (px, cy - int(r * 0.20)),
                       (px + int(rx * 0.42), cy + int(r * 0.26))], np.int32)
        cv2.polylines(canvas, [ch], False, COIN_RIM, max(1, r // 5),
                      cv2.LINE_AA)


_CUBE_HUES = ((250, 120, 90), (90, 220, 250), (120, 250, 160), (230, 120, 240))

#: The prism wheel: three face hues per step, rolling round the spectrum as
#: the box spins, so a power cube is unmistakably a PICKUP and not scenery.
_CUBE_FACES = (
    ((70, 70, 240), (60, 170, 250), (70, 240, 250)),
    ((60, 170, 250), (70, 240, 250), (90, 230, 110)),
    ((70, 240, 250), (90, 230, 110), (240, 180, 70)),
    ((90, 230, 110), (240, 180, 70), (240, 90, 200)),
    ((240, 180, 70), (240, 90, 200), (70, 70, 240)),
    ((240, 90, 200), (70, 70, 240), (60, 170, 250)),
)


def _power_cube(canvas: np.ndarray, px: int, y: int, half: float, variant: int,
                now: float) -> None:
    """A prismatic power cube hovering on the racing line.

    Original iconography: a floating gem-cut cube with three lit faces and a
    forward CHEVRON stamped on the front - the speedway's own mark, nothing
    borrowed from anybody else's item box.
    """
    r = int(half * 0.205)
    if r < 3:
        cv2.circle(canvas, (px, y - max(1, int(half * 0.26))), max(1, r),
                   (200, 200, 240), -1)
        return
    beat = 0.5 + 0.5 * math.sin(now * 4.4 + variant * 1.1)
    bob = math.sin(now * 2.2 + variant * 1.3) * r * 0.30
    spin = math.sin(now * 1.5 + variant)
    cy = y - int(half * 0.30 + bob)
    tone = _CUBE_HUES[variant % len(_CUBE_HUES)]
    # A PULSING additive bloom around the cube, and a shadow pool beneath it
    # that shrinks as the box rises: the pair is what makes it float and what
    # makes it findable at 180 km/h from a hundred metres out.
    _add_glow(canvas, px, cy, int(r * (1.9 + 0.7 * beat)),
              tuple(int(c * (0.34 + 0.26 * beat)) for c in tone),
              Rect(0, 0, canvas.shape[1], canvas.shape[0]))
    lift = 0.5 + 0.5 * math.sin(now * 2.2 + variant * 1.3)
    sr = max(2, int(r * (0.78 - 0.20 * lift)))
    cv2.ellipse(canvas, (px, y), (sr, max(1, sr // 3)), 0, 0,
                360, _shade_under(canvas, px, y, 0.68), -1, cv2.LINE_AA)
    skew = int(r * 0.42 * spin)
    top = np.array([(px, cy - r), (px + r, cy - int(r * 0.52)),
                    (px, cy - int(r * 0.10)), (px - r, cy - int(r * 0.52))],
                   np.int32)
    face_l = np.array([(px - r, cy - int(r * 0.52)), (px, cy - int(r * 0.10)),
                       (px, cy + r), (px - r, cy + int(r * 0.52))], np.int32)
    face_r = np.array([(px + r, cy - int(r * 0.52)), (px, cy - int(r * 0.10)),
                       (px, cy + r), (px + r, cy + int(r * 0.52))], np.int32)
    # The shell is GLASS: the faces are blended back over the road under them,
    # so the tarmac shows through and the cube floats instead of stamping.
    fx0, fy0 = max(0, px - r - 2), max(0, cy - r - 2)
    fx1 = min(canvas.shape[1], px + r + 3)
    fy1 = min(canvas.shape[0], cy + r + 3)
    if fx1 - fx0 > 4 and fy1 - fy0 > 4:
        roi = canvas[fy0:fy1, fx0:fx1]
        keep = roi.copy()
        off = np.array([fx0, fy0], np.int32)
        # RAINBOW FACES: three different hues off the same prism wheel, rolled
        # by the spin, so the box flashes through the spectrum as it turns.
        wheel = _CUBE_FACES[(variant + int(now * 1.4)) % len(_CUBE_FACES)]
        fl, fr, ft = wheel
        cv2.fillPoly(roi, [face_l - off],
                     tuple(int(c * 0.72) for c in (fl if skew >= 0 else fr)),
                     cv2.LINE_AA)
        cv2.fillPoly(roi, [face_r - off], fr if skew >= 0 else fl, cv2.LINE_AA)
        cv2.fillPoly(roi, [top - off],
                     tuple(min(255, int(c * 0.40) + 120) for c in ft),
                     cv2.LINE_AA)
        cv2.addWeighted(keep, 0.16, roi, 0.84, 0, dst=roi)
    # Rainbow edges: each rib of the cube a different hue, which is what
    # makes it read as a prism and not as a painted box.
    key = max(1, r // 7)
    for edge, hue in zip((top, face_l, face_r),
                         ((120, 250, 250), (250, 160, 120), (170, 250, 150))):
        cv2.polylines(canvas, [edge], True, hue, key, cv2.LINE_AA)
    cv2.polylines(canvas, [top], True, (250, 252, 255), max(1, key // 2),
                  cv2.LINE_AA)
    if r > 7:  # the chevron sigil, pointing up the road
        ch = np.array([(px - int(r * 0.42), cy + int(r * 0.34)),
                       (px, cy - int(r * 0.16)),
                       (px + int(r * 0.42), cy + int(r * 0.34))], np.int32)
        cv2.polylines(canvas, [ch], False, (252, 252, 255),
                      max(1, r // 5), cv2.LINE_AA)


def _gantry(canvas: np.ndarray, centre: int, y: int, half: float,
            view: Rect, now: float = 0.0) -> None:
    """The start/finish bridge: a lit banner over a chequered valance, with a
    marshal's flag waving off the top of each tower."""
    lx, rx = int(centre - half * 1.42), int(centre + half * 1.42)
    post_w = max(2, int(half * 0.035))
    bar_h = max(3, int(half * 0.17))
    bar_y = y - int(half * 0.72)
    cell = max(2, bar_h // 4)
    for x in (lx, rx):
        cv2.rectangle(canvas, (x - post_w, bar_y), (x + post_w, y), (52, 50, 58), -1)
        # Chequered tower cladding, so the posts belong to the finish line.
        for i in range(max(1, (y - bar_y) // max(cell, 1))):
            if i % 2:
                continue
            cv2.rectangle(canvas, (x - post_w, bar_y + i * cell),
                          (x + post_w, bar_y + (i + 1) * cell),
                          (226, 230, 236), -1)
        # A waving flag off the top of each tower.
        mast = max(3, int(half * 0.22))
        cv2.line(canvas, (x, bar_y - bar_h - mast), (x, bar_y - bar_h),
                 (178, 182, 194), max(1, post_w // 2), cv2.LINE_AA)
        fl = max(4, int(half * 0.20))
        fh = max(3, int(half * 0.09))
        wave = math.sin(now * 3.6 + x * 0.05)
        side = 1 if x == lx else -1
        pts = np.array([(x, bar_y - bar_h - mast),
                        (x, bar_y - bar_h - mast + fh),
                        (x + side * fl,
                         bar_y - bar_h - mast + fh // 2 + int(wave * fh * 0.5))],
                       np.int32)
        cv2.fillPoly(canvas, [pts], (246, 249, 252) if x == lx else (60, 60, 210),
                     cv2.LINE_AA)
    cv2.rectangle(canvas, (lx, bar_y - bar_h), (rx, bar_y), (46, 42, 48), -1)
    cv2.rectangle(canvas, (lx, bar_y - bar_h), (rx, bar_y), (86, 80, 84), 1,
                  cv2.LINE_AA)
    # A chequered valance hanging under the banner - the flag itself, strung
    # across the road - with the banner face left clear for the circuit name.
    for i, x in enumerate(range(lx, rx - cell, cell)):
        cv2.rectangle(canvas, (x, bar_y - cell), (x + cell, bar_y + cell),
                      (230, 234, 238) if i % 2 == 0 else (24, 24, 28), -1)
    if rx - lx > 240:
        text = "SUNSET SPEEDWAY"
        scale = (rx - lx) / 620.0
        tw = text_width(text, scale, 2)
        draw_text(canvas, text, (centre - tw // 2,
                                 bar_y - bar_h // 2 - cell // 2 + int(scale * 9)),
                  (150, 205, 250), scale=scale, thickness=2)


_ARCHES = (("OCTANE", (196, 92, 44), (250, 250, 252)),
           ("VOLTA", (68, 60, 210), (250, 244, 236)),
           ("GRIP-CO", (58, 150, 78), (240, 252, 244)))


def _arch(canvas: np.ndarray, centre: int, y: int, half: float,
          view: Rect, variant: int = 0) -> None:
    """A sponsor bridge over the tarmac, and the shadow band it throws down.

    Two builds off the same anchor: a striped steel arch on braced legs, and a
    fabric banner slung on cables between two masts. Something spanning the
    road overhead every few seconds is what separates a circuit from a country
    road, so these are laid thick enough that one is always in frame down a
    straight - scaled by depth, and each one darkening the strip of asphalt it
    stands over.
    """
    lx, rx = int(centre - half * 1.44), int(centre + half * 1.44)
    # A span with a third of itself off the bezel is a dark bar, not a bridge;
    # there is another one 118 units up the road, so this one waits its turn.
    # A span with a chunk of itself off the bezel is a dark bar, not a
    # bridge; there is another one 118 units up the road, so this one waits.
    if min(rx, view.right) - max(lx, view.x) < (rx - lx) * 0.94:
        return
    post_w = max(2, int(half * 0.042))
    bar_h = max(4, int(half * 0.23))
    bar_y = y - int(half * 0.86)
    text, bg, fg = _ARCHES[variant % len(_ARCHES)]
    banner = variant % 2 == 1

    # The shadow the structure lays across the road, one soft band, multiplied
    # into whatever is under it so the kerb and the racing line show through.
    sy0 = max(view.y, y - max(2, int(half * 0.10)))
    sy1 = min(view.bottom, y + max(3, int(half * 0.13)))
    sx0, sx1 = max(view.x, lx), min(view.right, rx)
    if sx1 - sx0 > 4 and sy1 - sy0 > 1:
        roi = canvas[sy0:sy1, sx0:sx1]
        np.copyto(roi, ((roi.astype(np.uint16) * 216) >> 8).astype(np.uint8),
                  casting="unsafe")

    for x in (lx, rx):
        cv2.rectangle(canvas, (x - post_w, bar_y), (x + post_w, y),
                      (58, 52, 50), -1)
        cv2.rectangle(canvas, (x - post_w, bar_y), (x - post_w + max(1, post_w // 2), y),
                      (104, 96, 92), -1)
        # A diagonal brace off each leg: the eye reads a structure, not a bar
        # hovering unsupported over the road.
        cv2.line(canvas, (x, bar_y + int(half * 0.16)),
                 (x + (1 if x == lx else -1) * int(half * 0.20), bar_y),
                 (78, 70, 68), max(1, post_w), cv2.LINE_AA)
        # A footing block, so the legs stand ON the apron.
        cv2.rectangle(canvas, (x - post_w * 2, y - max(1, int(half * 0.03))),
                      (x + post_w * 2, y + max(2, int(half * 0.02))),
                      (86, 92, 104), -1)

    if banner:
        # Two cables strung mast to mast, with the cloth hanging off them and
        # a shallow catenary along the bottom hem.
        for k, ty in ((0, bar_y - bar_h - max(2, int(half * 0.07))),
                      (1, bar_y - bar_h)):
            cv2.line(canvas, (lx, ty), (rx, ty), (152, 150, 158),
                     max(1, post_w // 2 + k), cv2.LINE_AA)
        sag = max(2, int(bar_h * 0.30))
        hem = np.array([(lx, bar_y - bar_h), (rx, bar_y - bar_h),
                        (rx, bar_y), ((lx + rx) // 2, bar_y + sag),
                        (lx, bar_y)], np.int32)
        cv2.fillPoly(canvas, [hem], bg, cv2.LINE_AA)
        cv2.fillPoly(canvas, [np.array(
            [(lx, bar_y - bar_h), (rx, bar_y - bar_h),
             (rx, bar_y - bar_h + max(1, bar_h // 4)),
             (lx, bar_y - bar_h + max(1, bar_h // 4))], np.int32)],
            tuple(min(255, int(c * 1.35) + 24) for c in bg), cv2.LINE_AA)
        cv2.polylines(canvas, [hem], True, (108, 96, 90), 1, cv2.LINE_AA)
    else:
        cv2.rectangle(canvas, (lx, bar_y - bar_h), (rx, bar_y), bg, -1)
        # A racing stripe of alternating blocks along the top of the span.
        cell = max(3, (rx - lx) // 14)
        cap = max(2, bar_h // 4)
        for i, x in enumerate(range(lx, rx, cell)):
            cv2.rectangle(canvas, (x, bar_y - bar_h - cap),
                          (min(x + cell, rx), bar_y - bar_h),
                          (240, 244, 248) if i % 2 else (48, 48, 216), -1)
        cv2.rectangle(canvas, (lx, bar_y - bar_h),
                      (rx, bar_y - bar_h + max(1, bar_h // 5)),
                      tuple(min(255, int(c * 1.4) + 26) for c in bg), -1)
        cv2.rectangle(canvas, (lx, bar_y - bar_h), (rx, bar_y), (96, 84, 78), 1,
                      cv2.LINE_AA)
    # The name only goes on when the whole span is on frame: half a word
    # running off the bezel reads as a bug, not as a sponsor.
    if rx - lx > 150 and view.x <= lx and rx < view.right:
        scale = (rx - lx) / 470.0
        tw = text_width(text, scale, 2)
        draw_text(canvas, text, (centre - tw // 2,
                                 bar_y - bar_h // 2 + int(scale * 9)),
                  fg, scale=scale, thickness=2)


# --- the karts ---------------------------------------------------------------

#: The rival grid, BGR. Six liveries, none of them red: the fifth rival used
#: to wrap right back onto the player's own colour, which put an identical
#: red dot next to the player's marker on the minimap.
_LIVERIES = ((56, 212, 250),    # sunflower
             (76, 214, 96),     # lime
             (226, 198, 64),    # cyan
             (240, 128, 56),    # deep blue
             (226, 92, 168),    # violet
             (150, 86, 240))    # magenta


#: THE SUN, ON THE BODYWORK. It sits dead on the horizon behind the field, so
#: every kart takes a warm highlight along its top-rear edge and a cool violet
#: bounce off the tarmac on its lower flanks. Without these two the karts are
#: flat stickers laid on the painting; with them they are lit objects in it.
RIM_SUN = (138, 208, 255)      # #FFD08A
RIM_BOUNCE = (178, 108, 116)   # the violet the road throws back up
#: THE FIELD'S MACHINERY, one row per driver number:
#: (form, body width, body height, driver scale, helmet graphic, driver quirk).
#: form 0 is the wide low kart, 1 the tall boxy one, 2 the stubby small-driver
#: chassis. quirk 0 is a plain lid, 1 wears goggles pushed up on the crown,
#: 2 trails a scarf. Six rivals, six machines - never one sprite in six hues.
_CHASSIS = (
    (0, 1.00, 1.00, 1.00, 0, 0),   # the player: wide, low, long wheelbase
    (1, 0.84, 1.34, 1.04, 1, 1),   # the tall boxy tower
    (2, 1.08, 0.80, 0.74, 2, 2),   # the stubby one, tiny driver
    (0, 1.06, 0.98, 1.06, 3, 1),
    (1, 0.82, 1.28, 0.98, 4, 2),
    (2, 1.10, 0.82, 0.72, 1, 0),
    (0, 1.02, 1.04, 0.99, 2, 1),
)
#: The tub outline per form, as (dx, dy) in body widths and body heights. The
#: last entry of each row is the tub's TOP, and every other landmark on the
#: kart - seat, engine, wing, steering column, driver - is placed off it.
_FORMS = (
    ((-0.48, -0.02), (-0.52, -0.24), (-0.46, -0.44), (-0.31, -0.60),
     (0.31, -0.60), (0.46, -0.44), (0.52, -0.24), (0.48, -0.02)),
    ((-0.42, -0.02), (-0.46, -0.30), (-0.45, -0.74), (-0.41, -0.86),
     (0.41, -0.86), (0.45, -0.74), (0.46, -0.30), (0.42, -0.02)),
    ((-0.44, -0.02), (-0.52, -0.16), (-0.49, -0.35), (-0.24, -0.50),
     (0.24, -0.50), (0.49, -0.35), (0.52, -0.16), (0.44, -0.02)),
)


def _mix(a: tuple[int, int, int], b: tuple[int, int, int],
         t: float) -> tuple[int, int, int]:
    """``a`` blended ``t`` of the way toward ``b``, as an opaque BGR triple."""
    return (min(255, max(0, int(a[0] + (b[0] - a[0]) * t))),
            min(255, max(0, int(a[1] + (b[1] - a[1]) * t))),
            min(255, max(0, int(a[2] + (b[2] - a[2]) * t))))


def _kart_colour(kart, is_player: bool) -> tuple[int, int, int]:
    """The livery, BGR, warmed into the low sun."""
    base = PLAYER if is_player else _LIVERIES[(kart.hue // 36) % len(_LIVERIES)]
    # Golden-hour ambient: pull the blues down and warm the reds so every
    # livery sits in the same low sun as the sky and the grass.
    b, g, r = base
    return (int(b * 0.82 + 8), int(g * 0.96 + 10), min(255, int(r * 1.0 + 20)))


def _draw_kart(canvas: np.ndarray, round_: RaceRound, kart, z: float,
               rows: dict, view: Rect, now: float, fx: _Effects,
               shake: int = 0) -> None:
    horizon = view.y + int(view.height * HORIZON) + shake
    n = max(view.bottom - horizon, 1)
    # No kart is ever drawn lower on the screen than the hero kart. Anything
    # nearer than PLAYER_SPRITE_Z would otherwise be sliced clean off by the
    # bottom edge; pinned to the hero's row it draws whole, alongside.
    floor = horizon + int(NEAR_Z / PLAYER_SPRITE_Z * n)
    y = min(horizon + int(NEAR_Z / z * n), floor, view.bottom - 1)
    if y not in rows:
        return
    _, centre, half = rows[y]
    px = int(centre + kart.x * half)
    y = max(view.y + 2, min(view.bottom - 1, y + _tilt_dy(px)))
    # Exactly as wide as the physics believes it is - see KART_SPRITE_W.
    width = max(6, int(half * KART_SPRITE_W))
    is_player = kart is round_.player
    # No rival is ever allowed to hide behind the hero kart. Two karts within
    # a length and a half of each other, stacked on the same screen column,
    # read as one body with two helmets - so a rival that close is shouldered
    # sideways until a clear seam of road shows between them.
    if not is_player and abs(z - PLAYER_SPRITE_Z) < KART_LENGTH * 1.5:
        near = rows.get(floor)
        if near is not None:
            hero = int(near[1] + round_.player.x * near[2])
            clear = int(width * 1.34)
            if abs(px - hero) < clear:
                px = hero + (clear if px >= hero else -clear)
    if px + width < view.x or px - width > view.right:
        return
    # Log the footprint. Nothing the player has to see may end up behind an
    # instrument, and the HUD cannot work that out on its own - it is drawn a
    # call later, with no idea where anything on the road ended up.
    fx.sprites.append((px - int(width * 0.68), y - int(width * 1.05),
                       px + int(width * 0.68), y + int(width * 0.14)))
    colour = _kart_colour(kart, is_player)
    speed = kart.v / TOP_SPEED
    # The occlusion halo: a ring of the ground the kart stands on, pulled
    # most of the way to a neutral and laid behind the black keyline. Sampled
    # BEFORE anything of this kart goes down, so dust and smoke cannot tint
    # it. Two karts side by side then read as one IN FRONT OF the other
    # rather than growing out of each other's bodywork.
    sx = min(max(px, view.x), view.right - 1)
    sy = min(max(y + 3, view.y), view.bottom - 1)
    halo = tuple(min(255, int(c * 0.42) + 112) for c in canvas[sy, sx].tolist())

    braking = (fx.brake or fx.hard_decel) if is_player else (
        kart.v > TOP_SPEED * 0.5
        and abs(round_.track.curvature_ahead(kart.s, 45.0)) > 0.0045)
    boosting = getattr(kart, "boost", 0.0) > 0.0 and not braking
    drift = 0.0
    if getattr(kart, "drifting", False):
        drift = min(1.0, getattr(kart, "drift_time", 0.0) / DRIFT_HOLD)

    # What the physics is doing to the CHASSIS, drawn on the chassis: the
    # bend pushes the kart bodily to the outside of the corner and rolls it
    # onto its outside wheels, and a slide cocks the whole thing sideways.
    # Read a little way AHEAD, not underfoot, so the kart is already leaning
    # on the way into the bend rather than snapping over at the segment seam.
    at = kart.s + (z if is_player else 0.0)
    bend = (round_.track.curvature_at(at) * 0.45
            + round_.track.curvature_ahead(at, 34.0) * 0.55)
    lateral = max(-1.0, min(1.0, bend * 240.0 * max(speed, 0.35)))
    px -= int(lateral * half * 0.078)      # 20-40px of slide at the hero scale
    # FIVE POSES, and the driver's hands pick which one. The chassis attitude
    # used to be a sum of steering and cornering load in which the load term
    # dominated and then clipped, so hard-left, straight-on and full-lock all
    # came out at the same eleven degrees and the sprite was byte-identical
    # from frame to frame. The STEER leads now, the load only trims it, and
    # the range runs to fourteen degrees: hard-left, left, straight, right,
    # hard-right are five visibly different machines.
    turn = max(-1.0, min(1.0, kart.steer * 0.74 + lateral * 0.26))
    roll = -turn * 13.0
    if drift > 0.0:
        roll += math.copysign(2.2, kart.steer or 1.0)
    roll = max(-14.0, min(14.0, roll))
    # AND IN A SLIDE THE WHOLE KART IS POINTING SOMEWHERE ELSE. Eight degrees
    # off the direction of travel the moment the rear lets go, better than
    # twenty at full charge: the front axle swings one way about the kart's
    # centre and the rear axle the other, so the rear wheels LEAD and a
    # drifting kart stops being a gripping kart with sparks bolted on.
    yaw_deg = 0.0
    if drift > 0.0:
        yaw_deg = -math.copysign(8.0 + 14.0 * drift, kart.steer or 1.0)

    off = abs(kart.x) > ROAD_HALF_WIDTH and kart.v > 6.0
    squash_y = 1.0
    # KERB STRIKE. Two wheels up on the red and white and the whole chassis
    # rattles: a three per cent vertical squash beating at fifteen hertz, so
    # riding the kerb is something you SEE as well as hear.
    if not off and abs(kart.x) > ROAD_HALF_WIDTH * 0.90 and kart.v > 8.0:
        squash_y = 0.985 + 0.015 * math.sin(now * 92.0 + kart.s * 4.0)
    if off:
        _dust(canvas, px, y, width, now, kart.s, abs(kart.x) > 1.28, view)
        squash_y = 0.94 + 0.02 * math.sin(now * 23.0)   # the 6% bottom-out
    burst = 0.0
    if is_player:
        burst = max(0.0, 1.0 - (now - fx.boost_flash) / 0.35)

    if width < 13:
        _tiny_kart(canvas, px, y, width, colour)
        return
    # WHO IS DRIVING. Six rivals, six different machines: the helmet graphic,
    # the height of the tub and the shape of the rear wing all key off this,
    # so the grid reads as a field of karts and not one sprite recoloured.
    who = 0 if is_player else 1 + (kart.hue // 36) % 6
    _kart_sprite(canvas, px, y, width, colour, kart.steer, braking, now,
                 kart.s, view, boosting, speed=speed, drift=drift,
                 roll=roll, squash_y=squash_y, burst=burst, halo=halo,
                 bank=lateral, hero=is_player, who=who,
                 fast=kart.v * 3.1 > 150.0, yaw_deg=yaw_deg)


def _tiny_kart(canvas: np.ndarray, px: int, y: int, w: int,
               colour: tuple[int, int, int]) -> None:
    """The same kart, far enough away to be four shapes wide.

    Deliberately the SAME reading as the hero sprite - round fat tyres, a
    coloured tub, a helmet with a visor stripe - only smaller. A far kart
    must never look like a different, worse game than a near one.
    """
    h = max(3, int(w * 0.60))
    ink = (22, 20, 26)
    cv2.ellipse(canvas, (px - w // 3, y + 1), (int(w * 0.7), max(1, w // 5)),
                0, 0, 360, (34, 30, 36), -1, cv2.LINE_AA)
    rw = max(2, int(w * 0.24))
    for side in (-1, 1):
        cv2.ellipse(canvas, (px + side * (w // 2), y - rw // 2),
                    (max(1, rw // 2), max(2, int(h * 0.42))), 0, 0, 360, ink,
                    -1, cv2.LINE_AA)
    cv2.ellipse(canvas, (px, y - h // 2), (max(2, int(w * 0.42)),
                                           max(2, int(h * 0.40))),
                0, 0, 360, colour, -1, cv2.LINE_AA)
    hr = max(2, int(w * 0.20))
    hc = (px, y - h - hr // 2)
    cv2.circle(canvas, hc, hr, colour, -1, cv2.LINE_AA)
    cv2.line(canvas, (hc[0] - hr, hc[1]), (hc[0] + hr, hc[1]), (26, 28, 36),
             max(1, hr // 2), cv2.LINE_AA)


def _kart_sprite(canvas: np.ndarray, px: int, y: int, w: int,
                 colour: tuple[int, int, int], steer: float, braking: bool,
                 now: float, s: float, view: Rect,
                 boosting: bool = False, speed: float = 0.0,
                 drift: float = 0.0, roll: float = 0.0,
                 squash_y: float = 1.0, burst: float = 0.0,
                 halo: tuple[int, int, int] | None = None,
                 bank: float = 0.0, hero: bool = False, who: int = 0,
                 fast: bool = False, yaw_deg: float = 0.0) -> None:
    """A kart from behind, cartoon-chunky: fat round tyres, a wide low tub, a
    driver with helmet and visor, and a dark keyline holding the whole
    silhouette together. Everything the physics knows shows on the sprite -
    the BODY ROLL and the turned front wheels in a corner, brake lights and
    smoke under braking, drift sparks charging blue to orange to magenta,
    the exhaust plume on the boost, and a chassis bob that squashes on the
    landing. The whole chassis is drawn through one rotation about the
    contact patch, so a cornering kart is genuinely leaning and not a decal.
    """
    bob_t = math.sin(now * 12.0 + s * 2.3)
    # The 1.06x squash: the chassis compresses and spreads on a landing and on
    # the beat the exhaust lights, and springs back over the next few frames.
    pop = min(1.0, max(0.0, -bob_t) + burst)
    # SIX MACHINES, not one. The chassis table picks the tub OUTLINE (a wide
    # low kart, a tall boxy one, a stubby small-driver one), how wide and how
    # tall it stands, how big the driver in it is, his helmet graphic and his
    # personal quirk. Everything below is placed off those numbers, so the
    # three silhouettes are genuinely different objects and not one decal.
    form, wide_f, tall, ds, mark, quirk = _CHASSIS[who % len(_CHASSIS)]
    shape = _FORMS[form]
    tub = shape[3][1]                       # the tub's top, in body heights
    wing = (who + form) % 3
    h = max(3, int(w * 0.60 * tall * squash_y / (1.0 + 0.06 * pop)))
    by = y + int(bob_t * h * 0.035)          # chassis bobs, the shadow does not
    sq = 1.0 + 0.06 * pop                    # wider as it lands
    # The rear steps out in a slide: the contact patches slide to the outside
    # of the bend while the driver's head stays where it was, which is a shear
    # through the chassis and is what makes a drift read as a DRIFT.
    yaw = -math.copysign(w * 0.16 * drift, steer if steer else 1.0)
    # The yaw, as a pseudo-3D swing about the kart's own vertical axis: the
    # body foreshortens by its cosine, and anything given a FORWARD offset
    # (the front axle ahead of centre, the rear axle behind it) slides
    # sideways by that offset times the sine. Two lines, and the machine is
    # genuinely pointing off its line of travel rather than sheared.
    yrad = math.radians(yaw_deg)
    y_cos, y_sin = math.cos(yrad), math.sin(yrad)
    # The roll does most of the leaning now; the driver only shifts a little
    # in the seat on top of it, or the helmet swings clear off the shoulders.
    # The driver's own weight shift, on top of the chassis roll: he braces
    # OUT of the seat toward the outside of the bend, so the helmet ends up
    # over the loaded front wheel and not over the middle of the kart.
    lean = (-steer * 0.028 - max(-1.0, min(1.0, bank)) * 0.052) * w
    dark = tuple(int(c * 0.55) for c in colour)
    ink = (22, 20, 26)
    # The keyline is a LINE, not a border: at the hero scale the old w/26
    # came to eleven pixels and every shape on the kart dissolved into one
    # black blob. Two per cent of the width holds the silhouette and lets
    # the bodywork, the driver and the wheels stay separate objects.
    key = max(2, int(w * 0.020))
    lit = (min(255, int(colour[0] * 1.12) + 12),
           min(255, int(colour[1] * 1.34) + 26),
           min(255, int(colour[2] * 1.42) + 36))
    rad = math.radians(roll)
    ca, sa = math.cos(rad), math.sin(rad)

    def P(dx: float, dy: float, dz: float = 0.0) -> tuple[int, int]:
        """A chassis point: dx right, dy down and dz FORWARD of the contact
        patch, all in pixels at this sprite's scale."""
        lift = min(1.0, max(0.0, -dy / max(float(h), 1.0)))
        step = yaw * (1.0 - 0.62 * lift)
        ax = dx * y_cos + dz * y_sin
        return (int(px + step + ax * ca - dy * sa),
                int(by + ax * sa + dy * ca))

    def quad(x0: float, y0: float, x1: float, y1: float) -> np.ndarray:
        return np.array([P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1)], np.int32)

    # Chassis geometry, hoisted: the occlusion halo needs the same silhouette
    # the fills use, and it has to go down before any of them.
    fw, fh = max(3, int(w * 0.118)), max(3, int(h * 0.30))
    ww, wh = max(4, int(w * 0.24)), max(4, int(h * 0.56))
    hr = max(2, int(w * 0.150 * ds))
    # COUNTER-STEER. Gripping, the front wheels point where the driver is
    # steering. Sliding, the kart is already going where the driver wants and
    # the hands come back the other way to catch it - so the lock UNWINDS and
    # then crosses over as the slide builds. That opposite-lock front axle is
    # the single clearest thing that says "this kart is drifting".
    lock = steer * (1.0 - 2.05 * drift)
    shift = lock * w * 0.085      # enough to see the lock, not enough to
    tilt = lock * 40.0 + roll     # break the wheel off the nose at full lock
    #: Where the front tyres sit: outboard of the tub and forward of the
    #: shoulder line, so both of them are VISIBLE past the nose and the lock
    #: can be read off the sprite at a glance.
    f_out, f_up = 0.375, -0.750
    #: Half the wheelbase, in pixels, as a FORWARD offset for the yaw: the
    #: front axle is this far ahead of the kart's centre of rotation and the
    #: rear axle this far behind it.
    f_dz, r_dz = w * 0.30, -w * 0.20
    bw = wide_f
    body = np.array([P(w * dx * bw * sq, h * dy) for dx, dy in shape], np.int32)
    # THE DRIVER, not a helmet on a stick. A torso wedge that widens from the
    # waist into real SHOULDERS - wider than the seat back behind it, so the
    # shoulders break that line instead of hiding inside it - and then necks
    # in under the helmet. In a corner the whole upper body leans out of the
    # seat toward the outside of the bend, which is what the head shift the
    # camera sees is actually made of.
    lift = lean * 2.4
    waist, chest = h * tub * 0.82, h * tub * 1.07
    sh_w, sh_y = w * 0.292 * ds, h * tub * 1.25
    neck_y, crown_y = h * tub * 1.43, h * tub * 1.54
    torso = np.array([P(-w * 0.215 * ds + lean, waist),
                      P(w * 0.215 * ds + lean, waist),
                      P(w * 0.255 * ds + lift, chest),
                      P(sh_w + lift, sh_y),
                      P(w * 0.175 * ds + lift, neck_y),
                      P(w * 0.105 * ds + lift, crown_y),
                      P(-w * 0.105 * ds + lift, crown_y),
                      P(-w * 0.175 * ds + lift, neck_y),
                      P(-sh_w + lift, sh_y),
                      P(-w * 0.255 * ds + lift, chest)], np.int32)
    hc = P(lift, crown_y * 1.016 - hr * 0.52)
    # THE INSIDE REAR COMES OFF THE ROAD. Rolling the chassis about the
    # centre contact patch sinks the outer wheel into the tarmac and floats
    # the inner one, so both get pulled back: the OUTER all the way down onto
    # the road (that is the loaded wheel, squashed up into the chassis) and
    # the inner only two thirds of the way, which leaves it hanging clear.
    # Hard into a slide it hangs further still. A kart on three wheels is the
    # picture of a kart being driven properly, and this sprite never had it.
    # Solved once, here, so the occlusion halo and the tyre land together -
    # computing it twice left a grey crescent orbiting each rear wheel.
    drop = math.tan(rad) * w * 0.52
    inner = 1.0 if roll < 0.0 else -1.0
    rear_c = {}
    for side, phase in ((-1, 0.0), (1, 2.4)):
        bounce = math.sin(now * 21.0 + s * 2.1 + phase) * h * 0.05
        bounce -= side * drop * (0.36 - 0.16 * drift if side == inner else 1.0)
        rear_c[side] = (P(side * w * 0.545 * wide_f, bounce - wh * 0.5, r_dz),
                        bounce)

    # --- ground plane: everything here stays level with the road ------------
    if speed > 0.72 and w > 18:
        rng = np.random.default_rng((int(now * 30.0) * 40503 + int(s * 7.0))
                                    & 0xFFFFFFFF)
        for side in (-1, 1):
            wx = px + side * int(w * 0.545)
            pr = max(1, int(w * rng.uniform(0.018, 0.038)))
            dx = int(w * rng.uniform(0.06, 0.20)) * side
            dy = int(w * rng.uniform(0.0, 0.06))
            cv2.circle(canvas, (wx + dx, y + dy), pr, (132, 146, 166), -1,
                       cv2.LINE_AA)

    # THE KART IS PLANTED. Two shadows, and the difference between them is the
    # whole trick: a SOFT raked one stretched away from the low sun, which
    # says where the light is, and a HARD-EDGED dark one under the machine
    # itself, opaque, wide enough to touch all four contact patches. The soft
    # blob on its own is what makes a sprite look pasted on - it never quite
    # meets the tyres, so the kart hovers a hand's width above the road.
    sx0, sx1 = max(view.x, px - int(w * 1.45)), min(view.right, px + int(w * 0.72))
    sy0, sy1 = max(view.y, y - h // 4), min(view.bottom, y + max(3, h // 5))
    if sx1 - sx0 > 3 and sy1 - sy0 > 1:
        roi = canvas[sy0:sy1, sx0:sx1]
        keep = roi.copy()
        cv2.ellipse(roi, (px - int(w * 0.34) - sx0, y - 1 - sy0),
                    (int(w * 1.02), max(2, h // 5)), SHADOW_RAKE, 0, 360,
                    (44, 30, 40), -1, cv2.LINE_AA)
        cv2.addWeighted(keep, 0.40, roi, 0.60, 0, dst=roi)
    # The CONTACT PATCH, laid straight onto the road at full strength: one
    # hard ellipse spanning the track of the kart, and a darker core under
    # each tyre so the four points the machine actually stands on are the
    # darkest thing in the frame.
    if w > 12:
        cv2.ellipse(canvas, (px - int(w * 0.06), y - 1),
                    (int(w * 0.70), max(2, int(h * 0.115))), 0, 0, 360,
                    (30, 21, 30), -1, cv2.LINE_AA)
        for side in (-1, 1):
            for out, girth in ((0.545, 0.17), (f_out, 0.12)):
                cv2.ellipse(canvas, (px + int(side * w * out), y - 1),
                            (max(2, int(w * girth)), max(2, int(h * 0.075))),
                            0, 0, 360, (18, 12, 20), -1, cv2.LINE_8)

    # THE DRIFT ARC. There used to be a pale ring pooled on the tarmac under
    # the hero kart on every frame of every race, meaning nothing - it read as
    # a rendering artefact, because that is what an unexplained ellipse is.
    # Now it exists only while the kart is actually sliding, it takes the
    # charge's own colour, and it sweeps the way the back end has stepped out:
    # a scuff arc on the road that grows as the exhaust fills up.
    if hero and drift > 0.0 and w > 16:
        arc = _DRIFT_STAGES[_drift_stage(drift)][2]
        span = 70.0 + 84.0 * drift
        mid = 90.0 + math.copysign(44.0, steer or 1.0)
        cv2.ellipse(canvas, (px, y + max(1, h // 14)),
                    (int(w * (0.72 + 0.12 * drift)), max(3, int(h * 0.22))),
                    0, mid - span * 0.5, mid + span * 0.5, arc,
                    max(3, int(w * 0.026)), cv2.LINE_AA)

    if drift > 0.0 and w > 18:
        # A thin haze of tyre smoke under the sparks - three puffs, not five,
        # and half the opacity. The charge is told by the SPARKS; smoke this
        # thick is what buried them in soft blobs.
        for side in (-1, 1):
            _puffs(canvas, px + side * int(w * 0.545), y, w, side, now,
                   s + side, view, count=3, density=0.30)

    # The drift charge pools its own colour on the tarmac under the kart.
    if drift > 0.0 and w > 16:
        tone = _DRIFT_STAGES[_drift_stage(drift)][2]
        _add_glow(canvas, px, y, int(w * 0.50),
                  tuple(int(c * (0.30 + 0.34 * drift)) for c in tone), view)

    # --- the occlusion halo -------------------------------------------------
    # Every silhouette the sprite owns, stroked once in a brightened wash of
    # the ground it stands on, five pixels proud of the black keyline. Where
    # two karts overlap the halo draws the seam, so the nearer one reads as
    # being IN FRONT rather than growing out of the other's bodywork.
    if halo is not None and w > 14:
        hp = max(3, int(w * 0.021))
        for side in (-1, 1):
            cv2.ellipse(canvas, rear_c[side][0],
                        (max(2, ww // 2), max(3, wh // 2)), roll, 0, 360,
                        halo, hp, cv2.LINE_AA)
        cv2.polylines(canvas, [body], True, halo, hp, cv2.LINE_AA)
        cv2.polylines(canvas, [torso], True, halo, hp, cv2.LINE_AA)
        cv2.circle(canvas, hc, hr, halo, hp, cv2.LINE_AA)

    # --- the chassis, rolled about the contact patch ------------------------
    # Nerf bars: the tubes that actually tie the front wheels to the frame.
    # Without them the front tyres read as two ellipses floating beside the
    # bodywork rather than as part of the same machine.
    if w > 18:
        for side in (-1, 1):
            cv2.line(canvas, P(side * w * 0.34, -h * 0.34),
                     P(side * w * (f_out - 0.005) + shift, f_up * h, f_dz),
                     (62, 61, 72), max(2, int(w * 0.026)), cv2.LINE_AA)
    # FRONT WHEELS, drawn outboard of the tub where they can actually be seen:
    # a turned ellipse apiece with a lit rim and a hub, swinging out and
    # tilting with the lock. Hidden behind the bodywork they told the player
    # nothing; out here they are the steering readout.
    inner_f = 1 if roll < 0.0 else -1
    for side in (-1, 1):
        # THE INSIDE FRONT COMES LIGHT. Three pixels of air under the unloaded
        # wheel: small, and the single clearest sign that the chassis is
        # actually leaning on the outside pair rather than sitting flat.
        c_w = P(side * w * f_out + shift, f_up * h, f_dz)
        if side == inner_f:
            c_w = (c_w[0], c_w[1] - max(1, int(h * 0.020)))
        cv2.ellipse(canvas, c_w, (max(2, fw // 2), max(2, fh // 2)),
                    tilt, 0, 360, ink, -1, cv2.LINE_AA)
        if fw > 6:
            # Exactly the rear tyre's reading, one size down: dark carcass,
            # grey rim, bright hub - so the front wheels belong to the same
            # kart, and the LOCK is legible off the tilt of the ellipse.
            cv2.ellipse(canvas, c_w, (max(1, int(fw * 0.30)),
                                      max(1, int(fh * 0.30))),
                        tilt, 0, 360, (86, 90, 102), -1, cv2.LINE_AA)
            cv2.ellipse(canvas, c_w, (max(1, fw // 7), max(1, fh // 7)),
                        tilt, 0, 360, (168, 172, 186), -1, cv2.LINE_AA)

    # The exhaust plume: a proper tapered flame off the rear axle on a boost,
    # and a white shockwave burst on the beat the slide actually pays out.
    if burst > 0.02 and w > 16:
        # The pay-out: a shock ring blowing out from under the rear axle, wider
        # and thinner every frame, over a hot pool of its own light.
        _add_glow(canvas, px, y - int(h * 0.10),
                  int(w * (0.34 + 0.5 * (1.0 - burst))),
                  tuple(int(c * burst) for c in (150, 190, 220)), view)
        # The pay-out flash: one hot white disc, 1.3 kart-widths across,
        # blown out of the rear axle on the single frame the slide cashes in.
        _add_glow(canvas, px, y - int(h * 0.16), int(w * 1.30 * burst),
                  tuple(int(c * burst * burst) for c in (210, 226, 242)), view)
        for ring, tone in ((1.00, (252, 252, 255)), (0.72, (150, 226, 255))):
            rr = int(w * ring * (0.30 + 1.15 * (1.0 - burst)))
            cv2.ellipse(canvas, (px, y - int(h * 0.12)),
                        (rr, max(2, int(rr * 0.42))), 0, 0, 360, tone,
                        max(1, int(w * 0.055 * burst)), cv2.LINE_AA)
    if (boosting or burst > 0.02) and w > 18:
        flick = 0.72 + 0.28 * math.sin(now * 34.0 + s)
        # Stacked orange / yellow / white teardrops trailing off the rear
        # axle: ~120 px on the release beat at the hero scale, settling to a
        # steady plume for as long as the boost runs.
        reach = w * (0.27 + 0.32 * burst) * flick
        # A pool of thrust light on the road first, so the flame is lighting
        # something and not hanging in the air under the bumper.
        _add_glow(canvas, px, y + int(h * 0.10),
                  int(w * (0.38 + 0.14 * burst)), (30, 84, 148), view)
        top = -h * 0.26                 # rooted up inside the tub, so the
        for side in (-1, 1):            # bodywork hides where it comes from
            root = side * w * 0.21
            for rf, tone in ((1.0, (40, 118, 250)), (0.62, (86, 214, 255)),
                             (0.30, (238, 250, 255))):
                wl = w * 0.095 * rf
                bottom = reach * rf
                cv2.fillPoly(canvas, [np.array(
                    [P(root - wl * 0.55, top),
                     P(root, top - wl * 0.45),
                     P(root + wl * 0.55, top),
                     P(root + wl, bottom * 0.28),
                     P(root + wl * 0.62, bottom * 0.66),
                     P(root, bottom),
                     P(root - wl * 0.62, bottom * 0.66),
                     P(root - wl, bottom * 0.28)],
                    np.int32)], tone, cv2.LINE_AA)

    # Rear wheels: fat, round, bouncing out of phase on their axles - and
    # through a bend the OUTER one is compressed up into the chassis while
    # the inner one hangs, which is what a kart loading up actually does.
    # THE WHEEL IS TURNING, and you can see it turn. The rotation angle is read
    # off the DISTANCE TRAVELLED, so it is tied to the speed for free: a hub
    # with three spokes and one white sidewall mark sweeping round it. A grey
    # blob with two lines on it told the player nothing, and a kart whose rear
    # tyres do not visibly spin is a kart sliding along on skids.
    spin_a = s * 0.90
    for side in (-1, 1):
        c_w, bounce = rear_c[side]
        ry = max(3, wh // 2)
        if fast:
            # Past 150 the contact patch flattens: the carcass squashes a tenth
            # of its height while its footprint stays nailed to the road.
            ry = max(3, int(ry * 0.90))
            c_w = (c_w[0], c_w[1] + max(1, wh // 20))
        cv2.ellipse(canvas, c_w, (max(2, ww // 2), ry), roll,
                    0, 360, ink, -1, cv2.LINE_AA)
        hub = max(2, int(ww * 0.40))
        cv2.circle(canvas, c_w, hub, (104, 108, 124), -1, cv2.LINE_AA)
        if ww > 9:
            ph = spin_a + side * 1.1
            for k in range(3):
                a = ph + k * 2.0944
                cv2.line(canvas, c_w,
                         (int(c_w[0] + math.cos(a) * hub * 0.94),
                          int(c_w[1] + math.sin(a) * ry * 0.56)),
                         (40, 42, 52), max(2, int(ww * 0.13)), cv2.LINE_AA)
            # The sidewall mark: one white paint stripe out on the shoulder of
            # the tyre, orbiting the hub. This is the whole of the wheel-spin
            # read at a glance, and it costs one line.
            cv2.line(canvas,
                     (int(c_w[0] + math.cos(ph) * ww * 0.30),
                      int(c_w[1] + math.sin(ph) * ry * 0.50)),
                     (int(c_w[0] + math.cos(ph) * ww * 0.50),
                      int(c_w[1] + math.sin(ph) * ry * 0.90)),
                     (232, 238, 246), max(2, int(ww * 0.19)), cv2.LINE_AA)
        cv2.circle(canvas, c_w, max(1, ww // 6), (194, 198, 210), -1,
                   cv2.LINE_AA)

    # Rear axle, then the tub: whichever of the three bodies this driver runs.
    top_y = h * tub
    cv2.fillPoly(canvas, [quad(-w * 0.56 * sq, -h * 0.30, w * 0.56 * sq,
                               -h * 0.16)], (40, 40, 46), cv2.LINE_AA)
    cv2.fillPoly(canvas, [body], colour, cv2.LINE_AA)
    # VOLUME. The tub is a rounded box lit from the low sun on the right, so
    # its flank falls away in a gradient rather than sitting flat: five bands
    # stepped from three quarters to full brightness across the width, laid
    # well inside the silhouette so the outline stays clean. This is the
    # difference between a moulded body and a vector cut-out.
    if w > 22:
        for k in range(7):
            f0 = (-0.43 + 0.123 * k) * bw
            f1 = (-0.43 + 0.123 * (k + 1)) * bw
            g = 0.70 + 0.064 * k
            cv2.fillPoly(canvas, [quad(w * f0, top_y * 0.93, w * f1, -h * 0.055)],
                         tuple(min(255, int(c * g)) for c in colour),
                         cv2.LINE_AA)
    cv2.ellipse(canvas, P(0.0, top_y), (int(w * 0.30 * bw), max(2, int(h * 0.11))),
                roll, 180, 360, colour, -1, cv2.LINE_AA)
    # Skirt and bumper: the dark base that plants the kart on the road.
    cv2.fillPoly(canvas, [quad(-w * 0.46 * bw * sq, -h * 0.16,
                               w * 0.46 * bw * sq, 0.0)], dark, cv2.LINE_AA)
    # The REAR BUMPER BAR: a proper tubular bar slung across the back of the
    # frame, darker than the skirt, with a lit top edge - the piece of a kart
    # you actually see first from behind, and the piece this sprite never had.
    bar_t, bar_b = -max(3.0, h * 0.145), -max(1.0, h * 0.030)
    cv2.fillPoly(canvas, [np.array(
        [P(-w * 0.585 * sq, bar_t * 0.62), P(-w * 0.545 * sq, bar_t),
         P(w * 0.545 * sq, bar_t), P(w * 0.585 * sq, bar_t * 0.62),
         P(w * 0.585 * sq, bar_b), P(-w * 0.585 * sq, bar_b)], np.int32)],
        (34, 33, 40), cv2.LINE_AA)
    cv2.line(canvas, P(-w * 0.53 * sq, bar_t * 0.86),
             P(w * 0.53 * sq, bar_t * 0.86), (104, 108, 122),
             max(1, int(h * 0.026)), cv2.LINE_AA)
    for side in (-1, 1):   # the stubs that tie the bar back into the frame
        cv2.fillPoly(canvas, [quad(side * w * 0.30, -h * 0.20,
                                   side * w * 0.30 + w * 0.05, bar_t)],
                     (44, 43, 52), cv2.LINE_AA)
    # A livery flash across the tail.
    cv2.fillPoly(canvas, [quad(-w * 0.30 * sq, -h * 0.15, w * 0.30 * sq,
                               -h * 0.11)], lit, cv2.LINE_AA)
    # THE REAR PANEL - three different shapes across the field, so a rival in
    # the mirror is recognisable by his silhouette before his colour: a plain
    # plank, a vee-notched panel, and a two-tier plate with end fences.
    if w > 22:
        pt, pb = top_y * 0.82, top_y * 0.33
        if wing == 0:
            panel = [(-0.36, pt), (0.36, pt), (0.39, pb), (-0.39, pb)]
        elif wing == 1:
            panel = [(-0.34, pt), (-0.08, pt), (0.0, pt + h * 0.11),
                     (0.08, pt), (0.34, pt), (0.37, pb), (-0.37, pb)]
        else:
            panel = [(-0.42, pt - h * 0.09), (-0.30, pt - h * 0.09),
                     (-0.30, pt), (0.30, pt), (0.30, pt - h * 0.09),
                     (0.42, pt - h * 0.09), (0.42, pb), (-0.42, pb)]
        poly = np.array([P(w * dx * bw * sq, dy) for dx, dy in panel], np.int32)
        cv2.fillPoly(canvas, [poly], dark, cv2.LINE_AA)
        # A PALE NUMBER PLATE on the panel face, barred in the livery. Pale
        # is the point: a red plate on a red tub is invisible, and this is
        # the one rectangle a rival's mirror is meant to read.
        cv2.fillPoly(canvas, [quad(-w * 0.205 * bw * sq, pt + h * 0.055,
                                   w * 0.205 * bw * sq, pb - h * 0.055)],
                     (232, 238, 244), cv2.LINE_AA)
        for k in range(wing + 1):
            bx = (k - wing * 0.5) * w * 0.115
            cv2.fillPoly(canvas, [quad(bx - w * 0.030 * sq, pt + h * 0.065,
                                       bx + w * 0.030 * sq, pb - h * 0.065)],
                         colour, cv2.LINE_AA)
        cv2.polylines(canvas, [poly], True, ink, max(1, key - 1), cv2.LINE_AA)
    # The ENGINE: an airbox and a cylinder head lump hanging off the right
    # rear, with a chrome exhaust elbow dropping out of it. A kart is an
    # engine with a seat bolted to it, and from behind you see the engine.
    if w > 22:
        eng_x, eng_t, eng_b = w * 0.300 * bw, top_y * 1.14, top_y * 0.55
        cv2.fillPoly(canvas, [np.array(
            [P(eng_x - w * 0.10, eng_b), P(eng_x - w * 0.115, eng_t + h * 0.10),
             P(eng_x - w * 0.075, eng_t), P(eng_x + w * 0.105, eng_t),
             P(eng_x + w * 0.145, eng_t + h * 0.10),
             P(eng_x + w * 0.13, eng_b)], np.int32)],
            (78, 79, 92), cv2.LINE_AA)
        # A lit top edge on the crankcase. Without it the engine, the bumper
        # bar and the near tyre ran together into one dark mass filling the
        # whole right third of the sprite.
        cv2.line(canvas, P(eng_x - w * 0.070, eng_t + h * 0.012),
                 P(eng_x + w * 0.100, eng_t + h * 0.012), (132, 136, 152),
                 max(1, int(h * 0.030)), cv2.LINE_AA)
        # Cooling fins, then the intake trumpet catching the low sun.
        for k in range(3):
            fy = eng_t + h * (0.14 + 0.13 * k)
            cv2.line(canvas, P(eng_x - w * 0.095, fy), P(eng_x + w * 0.125, fy),
                     (46, 46, 56), max(1, int(h * 0.022)), cv2.LINE_AA)
        cv2.ellipse(canvas, P(eng_x + w * 0.015, eng_t + h * 0.02),
                    (max(2, int(w * 0.085)), max(2, int(h * 0.055))), roll,
                    0, 360, (30, 30, 38), -1, cv2.LINE_AA)
        cv2.ellipse(canvas, P(eng_x + w * 0.015, eng_t + h * 0.015),
                    (max(1, int(w * 0.050)), max(1, int(h * 0.030))), roll,
                    180, 360, (150, 158, 176), -1, cv2.LINE_AA)
        cv2.polylines(canvas, [np.array(
            [P(eng_x + w * 0.09, eng_t + h * 0.28),
             P(eng_x + w * 0.155, eng_t + h * 0.40),
             P(eng_x + w * 0.145, eng_b + h * 0.02)], np.int32)],
            False, (128, 134, 148), max(2, int(w * 0.019)), cv2.LINE_AA)
    # Specular kiss from the low sun on the sun side of the cowl.
    cv2.ellipse(canvas, P(w * 0.335 * bw, top_y * 0.65),
                (max(2, int(w * 0.075)), max(1, int(h * 0.032))), roll - 8,
                0, 360, lit, -1, cv2.LINE_AA)
    cv2.line(canvas, P(-w * 0.275 * bw, top_y * 0.99),
             P(w * 0.275 * bw, top_y * 0.99), lit,
             max(1, int(h * 0.055)), cv2.LINE_AA)
    # THE SUN, ON THE BODYWORK. It is dead on the horizon behind the field, so
    # the top-rear edge of every tub takes a warm #FFD08A rim at forty per cent
    # over the livery, laid three or four pixels inside the black keyline; and
    # the lower flanks take a cool violet bounce off the tarmac. This is the
    # whole difference between a lit object standing in the painting and a
    # hue-swapped sticker laid on top of it - and it costs three strokes.
    if w > 20:
        rim = _mix(colour, RIM_SUN, 0.52)
        bounce = _mix(dark, RIM_BOUNCE, 0.34)
        inset = 1.0 - max(0.030, key * 1.7 / max(w, 1))
        cv2.polylines(canvas, [np.array(
            [P(w * dx * bw * sq * inset, h * dy * inset)
             for dx, dy in shape[1:7]], np.int32)],
            False, rim, max(2, int(w * 0.032)), cv2.LINE_AA)
        for side in (-1, 1):
            cv2.line(canvas, P(side * w * shape[0][0] * bw * sq * inset, -h * 0.045),
                     P(side * w * shape[1][0] * bw * sq * inset,
                       h * shape[1][1] * inset),
                     bounce, max(2, int(w * 0.026)), cv2.LINE_AA)
        # THE SUN-FACING EDGE. The disc is on the right-hand horizon, so the
        # whole right flank of the tub - not just its top - carries a hard
        # cream rim two pixels inside the keyline. Every kart, every barrier
        # and every helmet in the frame takes the same edge from the same
        # direction, and that consistency is what a lit picture is.
        cv2.polylines(canvas, [np.array(
            [P(w * dx * bw * sq * inset, h * dy * inset)
             for dx, dy in shape[4:]], np.int32)],
            False, RIM_CREAM, max(2, int(w * 0.017)), cv2.LINE_AA)
    cv2.polylines(canvas, [body], True, ink, key, cv2.LINE_AA)

    # Under braking the rear tires kick up smoke and dust at the wheels.
    if braking and speed > 0.25 and w > 18:
        for side in (-1, 1):
            _puffs(canvas, px + side * int(w * 0.545), y, w, side, now,
                   s + 5.0 + side, view, count=4, life=0.45, density=0.46)

    if drift > 0.0 and w > 16:
        _drift_fan(canvas, px, y, w, drift, now, s, view, steer)

    # Brake lights: two lamps in the tail, with a tight halo when they are lit.
    lw, lh = max(2, int(w * 0.115)), max(2, int(h * 0.13))
    lamp = (72, 72, 255) if braking else (36, 36, 108)
    for side in (-1, 1):
        if braking:
            cv2.circle(canvas, P(side * w * 0.24, -h * 0.26),
                       max(2, int(w * 0.055)), (48, 48, 200), -1, cv2.LINE_AA)
        cv2.fillPoly(canvas, [quad(side * w * 0.24 - lw * 0.5, -h * 0.32,
                                   side * w * 0.24 + lw * 0.5,
                                   -h * 0.32 + lh)], lamp, cv2.LINE_AA)
        cv2.polylines(canvas, [quad(side * w * 0.24 - lw * 0.5, -h * 0.32,
                                    side * w * 0.24 + lw * 0.5,
                                    -h * 0.32 + lh)], True, (26, 24, 30),
                      max(1, key // 2), cv2.LINE_AA)

    # Seat back and roll hoop, so the driver has something to sit against -
    # and on the player's own kart the hoop carries a rim light no rival gets.
    cv2.fillPoly(canvas, [quad(-w * 0.225 * ds, top_y * 1.16, w * 0.225 * ds,
                               top_y * 0.82)], (48, 46, 56), cv2.LINE_AA)
    if hero and w > 20:
        cv2.polylines(canvas, [np.array(
            [P(-w * 0.222 * ds, top_y * 1.06), P(-w * 0.196 * ds, top_y * 1.20),
             P(w * 0.196 * ds, top_y * 1.20), P(w * 0.222 * ds, top_y * 1.06)],
            np.int32)], False,
            tuple(min(255, int(c * 0.5) + 128) for c in colour),
            max(2, int(w * 0.016)), cv2.LINE_AA)
    # Driver: broad shoulders in the seat, then the helmet.
    # A charcoal race suit with the livery laid ON it, not a second shade of
    # the bodywork: red overalls in a red kart made the driver disappear.
    suit = tuple(int(30 + c * 0.20) for c in colour)
    cv2.fillPoly(canvas, [torso], suit, cv2.LINE_AA)
    if w > 26:
        # A livery panel down the driver's back and a shoulder yoke in the
        # accent colour: the racing suit is part of the LIVERY, so at a
        # glance the man matches the machine he is sitting in.
        cv2.fillPoly(canvas, [np.array(
            [P(-w * 0.115 * ds + lift, crown_y), P(w * 0.115 * ds + lift, crown_y),
             P(w * 0.150 * ds + lift, chest * 1.06),
             P(w * 0.105 * ds + lift, waist * 1.05),
             P(-w * 0.105 * ds + lift, waist * 1.05),
             P(-w * 0.150 * ds + lift, chest * 1.06)], np.int32)],
            colour, cv2.LINE_AA)
        # THE YOKE IS A GARMENT, NOT A BAR. This used to be one straight
        # stroke laid shoulder to shoulder in a pale tint of the livery, drawn
        # AFTER the torso keyline - so it over-ran the outline on the roll
        # side, crossed the sidepod behind it, and read for all the world as a
        # translucent motion streak dragged across the driver. It is now a
        # trapezoid cut from the torso's own landmarks, so it cannot leave the
        # body, and it goes down BEFORE the keyline that contains it.
        cv2.fillPoly(canvas, [np.array(
            [P(-sh_w * 0.90 + lift, sh_y), P(sh_w * 0.90 + lift, sh_y),
             P(w * 0.232 * ds + lift, chest * 1.02),
             P(-w * 0.232 * ds + lift, chest * 1.02)], np.int32)],
            tuple(min(255, int(c * 0.52) + 40) for c in colour), cv2.LINE_AA)
    cv2.polylines(canvas, [torso], True, ink, key, cv2.LINE_AA)
    # THE STEERING WHEEL, in front of the chest where the camera actually
    # sees it. A kart rim is a small butterfly on a short column, and from a
    # chase camera looking slightly DOWN it sits below the driver's shoulders
    # and over the front of the tub - so it goes down after the torso, and
    # the two fists close on its ends. The old sprite drew a truck-sized rim
    # BEHIND the driver, which put a black band across the gap between helmet
    # and body and was most of why he read as a floating head.
    # WIDER THAN THE DRIVER'S SHOULDERS and set low on the cowl, which is
    # where a kart rim actually is - and which is the only geometry that
    # leaves room for an ARM. With the rim tucked under the shoulders the
    # forearms had nowhere to go and came out as two stubs that vanished.
    wheel_c = P(lift * 0.7 + lock * w * 0.020, top_y * 0.88)
    wr = (max(4, int(w * 0.222 * ds)), max(3, int(h * 0.090)))
    spin = lock * 34.0 + roll
    sp = math.radians(spin)
    csp, ssp = math.cos(sp), math.sin(sp)
    # ARMS FIRST, RIM SECOND. Upper arm out of the shoulder, elbow cocked out
    # and down, forearm reaching in to the grip - and the whole limb goes down
    # BEFORE the wheel, so the rim crosses in front of it exactly as it does in
    # life. Drawn after, the arms lay two sausages over the wheel and the
    # cockpit read as handlebars. The sleeve is pale, not another shade of the
    # tub, or the arm disappears into the bodywork it is reaching across.
    if w > 24:
        sleeve = _mix(suit, (206, 210, 216), 0.46)
        cuff = _mix(suit, (232, 236, 240), 0.62)
        for grip in (-1, 1):
            hand = (int(wheel_c[0] + grip * wr[0] * 0.94 * csp),
                    int(wheel_c[1] + grip * wr[0] * 0.94 * ssp))
            shoulder = P(grip * sh_w * 0.80 + lift, sh_y + h * 0.045)
            elbow = (int(shoulder[0] * 0.40 + hand[0] * 0.60
                         + grip * w * 0.058),
                     int(shoulder[1] * 0.34 + hand[1] * 0.66 + h * 0.052))
            upper = np.array([shoulder, elbow], np.int32)
            fore = np.array([elbow, hand], np.int32)
            cv2.polylines(canvas, [upper], False, ink,
                          max(3, int(w * 0.048)), cv2.LINE_AA)
            cv2.polylines(canvas, [fore], False, ink,
                          max(3, int(w * 0.042)), cv2.LINE_AA)
            cv2.polylines(canvas, [upper], False, sleeve,
                          max(2, int(w * 0.031)), cv2.LINE_AA)
            # The FOREARM is a shade lighter than the upper arm, so the two
            # segments of the limb are legible as two segments.
            cv2.polylines(canvas, [fore], False, cuff,
                          max(2, int(w * 0.025)), cv2.LINE_AA)
    # THE STEERING WHEEL: a small butterfly rim on a short column, sitting low
    # over the front of the tub where a chase camera looking slightly down
    # actually sees it, with the two fists closed on its ends.
    if w > 24:
        cv2.ellipse(canvas, wheel_c, wr, spin, 0, 360,
                    ink, max(3, int(w * 0.026)), cv2.LINE_AA)
        cv2.ellipse(canvas, wheel_c, wr, spin, 0, 360,
                    (126, 130, 146), max(1, int(w * 0.011)), cv2.LINE_AA)
        # THREE SPOKES. Without them the rim plus its hub read as one big
        # eye staring out of the driver's chest; with them it is obviously a
        # wheel, and it is obviously turning.
        for ang in (0.0, math.pi, math.pi * 0.5):
            ex = math.cos(ang) * wr[0]
            ey = math.sin(ang) * wr[1]
            cv2.line(canvas, wheel_c,
                     (int(wheel_c[0] + ex * csp - ey * ssp),
                      int(wheel_c[1] + ex * ssp + ey * csp)),
                     (74, 77, 90), max(2, int(w * 0.013)), cv2.LINE_AA)
        cv2.circle(canvas, wheel_c, max(2, int(w * 0.022)), (48, 48, 58), -1,
                   cv2.LINE_AA)
        # THE FISTS, closed on the two ends of the rim - found on the rim's own
        # rotated axis, so they stay on the wheel at any lock.
        glove = tuple(min(255, int(c * 0.26) + 168) for c in colour)
        for grip in (-1, 1):
            hand = (int(wheel_c[0] + grip * wr[0] * 0.94 * csp),
                    int(wheel_c[1] + grip * wr[0] * 0.94 * ssp))
            fist = max(2, int(w * 0.031))
            cv2.circle(canvas, hand, fist, glove, -1, cv2.LINE_AA)
            cv2.circle(canvas, hand, fist, ink, max(1, key - 1), cv2.LINE_AA)
            if fist > 5:   # knuckles, so the fist reads as a GRIP
                cv2.line(canvas, _off(hand, -fist * 0.5, -fist * 0.2, ca, sa),
                         _off(hand, fist * 0.5, -fist * 0.2, ca, sa),
                         tuple(int(c * 0.62) for c in glove),
                         max(1, fist // 3), cv2.LINE_AA)
    _helmet(canvas, hc, hr, colour, mark, roll, ca, sa, ink, key, quirk)


def _helmet(canvas: np.ndarray, hc: tuple[int, int], hr: int,
            colour: tuple[int, int, int], mark: int, roll: float,
            ca: float, sa: float, ink: tuple[int, int, int],
            key: int, quirk: int = 0) -> None:
    """One driver's lid: shell, personal graphic, visor, catchlight.

    Five DIFFERENT graphics - crown stripe, star, flame, spots, chevrons -
    so six karts on the grid are six drivers rather than one decal in six
    hues. The graphic is laid in the rolled frame, so it leans with the head.
    """
    trim = (242, 246, 252)
    # THE CREST, behind the shell so it reads as part of the lid's silhouette.
    # Three shapes across the field - a swept fin, a low double-bump, a plain
    # round dome - so the drivers differ before you have read a single colour.
    if hr > 5:
        if quirk == 0:
            cv2.fillPoly(canvas, [np.array(
                [_off(hc, -hr * 0.30, -hr * 0.94, ca, sa),
                 _off(hc, -hr * 0.02, -hr * 1.22, ca, sa),
                 _off(hc, hr * 0.66, -hr * 1.06, ca, sa),
                 _off(hc, hr * 0.74, -hr * 0.62, ca, sa)], np.int32)],
                _mix(colour, (40, 38, 48), 0.30), cv2.LINE_AA)
        elif quirk == 1:
            for dx in (-0.40, 0.40):
                cv2.ellipse(canvas, _off(hc, hr * dx, -hr * 0.86, ca, sa),
                            (max(2, int(hr * 0.34)), max(2, int(hr * 0.30))),
                            roll, 180, 360, _mix(colour, (40, 40, 52), 0.35),
                            -1, cv2.LINE_AA)
    cv2.circle(canvas, hc, hr, colour, -1, cv2.LINE_AA)
    if hr > 4:
        if mark == 0:        # crown stripe, front to back
            cv2.ellipse(canvas, hc, (max(1, int(hr * 0.26)), hr), roll,
                        0, 360, trim, -1, cv2.LINE_AA)
        elif mark == 1:      # a five-point star over the temple
            pts = []
            for k in range(10):
                a = math.radians(-90.0 + 36.0 * k)
                rr = hr * (0.66 if k % 2 == 0 else 0.28)
                pts.append(_off(hc, math.cos(a) * rr - hr * 0.10,
                                math.sin(a) * rr - hr * 0.30, ca, sa))
            cv2.fillPoly(canvas, [np.array(pts, np.int32)], trim, cv2.LINE_AA)
        elif mark == 2:      # flame licks running back off the brow
            for k, (dy, ln) in enumerate(((-0.62, 0.95), (-0.24, 0.78),
                                          (0.12, 0.58))):
                cv2.fillPoly(canvas, [np.array(
                    [_off(hc, -hr * ln, hr * dy, ca, sa),
                     _off(hc, hr * 0.30, hr * (dy - 0.16), ca, sa),
                     _off(hc, hr * 0.34, hr * (dy + 0.14), ca, sa)],
                    np.int32)], trim if k % 2 == 0 else (86, 168, 250),
                    cv2.LINE_AA)
        elif mark == 3:      # spots
            for dx, dy, rf in ((-0.46, -0.40, 0.26), (0.16, -0.56, 0.20),
                               (0.42, -0.18, 0.24), (-0.14, -0.14, 0.17)):
                cv2.circle(canvas, _off(hc, hr * dx, hr * dy, ca, sa),
                           max(1, int(hr * rf)), trim, -1, cv2.LINE_AA)
        else:                # twin chevrons pointing forward
            for k in (0, 1):
                off = -hr * (0.62 - 0.42 * k)
                cv2.polylines(canvas, [np.array(
                    [_off(hc, -hr * 0.72, off + hr * 0.34, ca, sa),
                     _off(hc, 0.0, off, ca, sa),
                     _off(hc, hr * 0.72, off + hr * 0.34, ca, sa)], np.int32)],
                    False, trim, max(1, int(hr * 0.20)), cv2.LINE_AA)
        # THE BACK OF THE LID. The camera sits behind every kart on the
        # circuit, so a visor drawn here put a face on the back of every
        # driver's head and left the whole field staring at the player while
        # driving away from them. What belongs here is the occiput: the shell
        # darkening where it turns away from the sky, the seam around the
        # rear, an exhaust vent, and the collar of the neck brace under it.
        cv2.ellipse(canvas, hc, (int(hr * 0.94), int(hr * 0.94)), roll,
                    12, 168, _mix(colour, (24, 24, 32), 0.34),
                    -1, cv2.LINE_AA)
        cv2.ellipse(canvas, hc, (int(hr * 0.92), int(hr * 0.92)), roll,
                    16, 164, _mix(colour, (16, 16, 22), 0.55),
                    max(1, hr // 7), cv2.LINE_AA)
        if hr > 7:
            # The rear extractor vent: a SLOT, not a hole. Drawn dark and
            # wide it read as an open mouth on the back of the head.
            cv2.ellipse(canvas, _off(hc, 0.0, hr * 0.46, ca, sa),
                        (max(1, int(hr * 0.26)), max(1, int(hr * 0.09))),
                        roll, 0, 360, _mix(colour, (18, 18, 26), 0.62),
                        -1, cv2.LINE_AA)
            # The neck brace collar, tucked under the shell.
            cv2.ellipse(canvas, _off(hc, 0.0, hr * 0.98, ca, sa),
                        (max(2, int(hr * 0.86)), max(1, int(hr * 0.30))),
                        roll, 180, 360, (52, 52, 64), -1, cv2.LINE_AA)
        # The sun is overhead and behind, so the crown keeps its highlight
        # whichever way the driver faces.
        cv2.ellipse(canvas, _off(hc, -hr * 0.10, -hr * 0.58, ca, sa),
                    (max(1, int(hr * 0.46)), max(1, int(hr * 0.22))),
                    roll, 0, 360, _mix(colour, (252, 253, 255), 0.55),
                    -1, cv2.LINE_AA)
        # GOGGLES PUSHED UP on the crown, for the one driver who wears them:
        # a smoked lens on a strap sitting above the visor, not over it.
        if quirk == 1:
            cv2.line(canvas, _off(hc, -hr * 0.94, -hr * 0.52, ca, sa),
                     _off(hc, hr * 0.94, -hr * 0.52, ca, sa), (48, 46, 58),
                     max(1, int(hr * 0.20)), cv2.LINE_AA)
            cv2.ellipse(canvas, _off(hc, 0.0, -hr * 0.54, ca, sa),
                        (max(2, int(hr * 0.56)), max(1, int(hr * 0.22))),
                        roll, 0, 360, (108, 158, 208), -1, cv2.LINE_AA)
    # THE SCARF, streaming off the neck to the screen left with the airflow.
    if quirk == 2 and hr > 5:
        wave = math.sin(hc[0] * 0.09 + hr) * hr * 0.42
        tail = np.array(
            [_off(hc, -hr * 0.86, hr * 0.30, ca, sa),
             _off(hc, hr * 0.30, hr * 0.74, ca, sa),
             _off(hc, -hr * 1.10, hr * 1.30 + wave, ca, sa),
             _off(hc, -hr * 2.35, hr * 0.90 + wave * 1.6, ca, sa),
             _off(hc, -hr * 2.90, hr * 0.14 + wave * 1.2, ca, sa),
             _off(hc, -hr * 2.10, hr * 0.18 + wave * 0.7, ca, sa)], np.int32)
        cv2.fillPoly(canvas, [tail], _mix(colour, (250, 250, 252), 0.62),
                     cv2.LINE_AA)
        cv2.polylines(canvas, [tail], True, ink, max(1, key - 1), cv2.LINE_AA)
    cv2.circle(canvas, hc, hr, ink, key, cv2.LINE_AA)
    # The sun catches the crown of every lid: the same warm rim the bodywork
    # gets, so the head is lit by the same sunset the tub is.
    if hr > 6:
        cv2.ellipse(canvas, hc, (int(hr * 0.86), int(hr * 0.86)), roll,
                    196, 320, _mix(colour, RIM_SUN, 0.46),
                    max(1, int(hr * 0.20)), cv2.LINE_AA)
        # ...and the SUN SIDE of the shell - the right-hand quarter, facing
        # the disc on the horizon - takes the hard cream edge every other
        # object in the frame gets from the same direction.
        cv2.ellipse(canvas, hc, (int(hr * 0.88), int(hr * 0.88)), roll,
                    -58, 26, RIM_CREAM, max(2, int(hr * 0.11)), cv2.LINE_AA)
        # ...and the SHADE SIDE takes the violet the sunset sky bounces back
        # into it. A lid lit on one edge and flat everywhere else is still a
        # flat lid; the cool side is what turns it into a sphere.
        cv2.ellipse(canvas, hc, (int(hr * 0.86), int(hr * 0.86)), roll,
                    136, 232, _mix(colour, RIM_BOUNCE, 0.44),
                    max(1, int(hr * 0.14)), cv2.LINE_AA)


def _puffs(canvas: np.ndarray, wx: int, wy: int, w: int, side: int,
           now: float, seed: float, view: Rect, count: int = 4,
           life: float = 0.6, density: float = 0.60,
           fleck: tuple[int, int, int] | None = None) -> None:
    """Tyre smoke, ANCHORED TO THE CONTACT PATCH.

    Three to five overlapping circles per wheel, born at the tyre's contact
    point, growing to 2.2x and fading to nothing over six tenths of a second
    while they drift rearward and outward. Nothing is ever further from the
    wheel than about forty pixels, which is the difference between smoke off a
    tyre and beige bokeh floating over the grass.

    Each puff is blended by PREMIXING against the ground it stands on rather
    than by an alpha pass, so every one of them can carry its own opacity for
    the price of an opaque circle - and it is tinted by that same sample, so
    the smoke is grey over tarmac, tan over gravel and pale green over turf.
    """
    sx = min(max(wx, view.x), view.right - 1)
    sy = min(max(wy - 2, view.y), view.bottom - 1)
    ground = canvas[sy, sx].astype(np.float32)
    tint = np.minimum(255.0, ground * 0.42 + 148.0)
    limit = min(44.0, w * 0.34)
    base = max(2.0, w * 0.075)
    for k in range(count):
        hsh = ((k * 2654435761) ^ int(seed * 977.0)) & 0xFFFF
        age = (now / life + k / count + (hsh & 255) / 4096.0) % 1.0
        alpha = density * (1.0 - age) ** 1.15 * min(1.0, age * 7.0)
        if alpha < 0.03:
            continue
        rad = int(base * (1.0 + 1.2 * age) * (0.82 + (hsh >> 8 & 7) * 0.05))
        # Out to the side and a little way back down the screen: rearward,
        # from a camera that is sitting behind the gearbox.
        ang = 0.30 + (hsh >> 5 & 7) * 0.085
        out = limit * age
        cx = int(wx + side * (base * 0.35 + out * math.cos(ang)))
        cy = int(wy - 2 + out * math.sin(ang) * 0.62)
        tone = fleck if (fleck is not None and k % 3 == 1) else tint
        mix = tuple(int(g + (t - g) * alpha) for g, t in zip(ground, tone))
        cv2.circle(canvas, (cx, cy), max(2, rad), mix, -1, cv2.LINE_AA)


def _off(origin: tuple[int, int], dx: float, dy: float, ca: float,
         sa: float) -> tuple[int, int]:
    """A point offset from ``origin`` in the rolled chassis frame."""
    return (int(origin[0] + dx * ca - dy * sa),
            int(origin[1] + dx * sa + dy * ca))


#: The drift charge, in three hard stages: (teardrops, hot core, body, glow).
#: Three DISCRETE steps, not a fade - the player has to be able to count how
#: close the exhaust is to paying out at a glance, mid-corner, at 170 km/h.
#: The glow tone is ADDITIVE, so it is a dark number that adds up to a halo.
_DRIFT_STAGES = (
    (8, (255, 250, 240), (252, 176, 64), (72, 34, 10)),     # cyan
    (16, (240, 250, 255), (44, 154, 252), (14, 52, 100)),   # orange
    (22, (252, 252, 255), (238, 90, 246), (76, 22, 84)),    # pink-violet
)


def _drift_stage(charge: float) -> int:
    return 0 if charge < 0.34 else (1 if charge < 0.67 else 2)


def _drift_fan(canvas: np.ndarray, px: int, y: int, w: int, charge: float,
               now: float, s: float, view: Rect, steer: float = 0.0) -> None:
    """The drift charge: a fan of hard SPARK RAYS off each rear contact patch.

    Not blobs. Each spark is a tapered triangle struck out of the tyre and
    thrown rearward, a couple of pixels wide at the contact patch and a point
    at its tip, with a white core burning up the middle of the brightest of
    them. The charge is legible three ways at once, so the player can read it
    mid-corner at 170 km/h without looking away from the road:

      stage 1  eight cyan rays, white cored
      stage 2  twice as many, orange
      stage 3  twice again, pink-violet, plus a RING pulsing at the wheel

    The soft part - and there has to be one, or the fan reads as cut glass -
    is a single blurred additive layer underneath, so the sparks light the
    tarmac they are striking off instead of hanging over it.
    """
    stage = _drift_stage(charge)
    rays, core, body, glow = _DRIFT_STAGES[stage]
    seed = (int(now * 30.0) * 40503 + int(s * 29.0)) & 0xFFFFFFFF
    reach = w * (0.30 + 0.13 * stage)
    lean = max(-1.0, min(1.0, steer))
    pulse = 0.5 + 0.5 * math.sin(now * 26.0)
    # One buffer for both wheels: the glow goes in here, gets blurred to a
    # genuine falloff and is ADDED to the frame, so it lights the road.
    bx0 = max(view.x, px - int(w * 1.20))
    bx1 = min(view.right, px + int(w * 1.20))
    by0 = max(view.y, y - int(w * 0.30))
    by1 = min(view.bottom, y + int(w * 0.34))
    layer = None
    if bx1 - bx0 > 8 and by1 - by0 > 8:
        layer = np.zeros((by1 - by0, bx1 - bx0, 3), np.uint8)
    wide = max(2.0, w * 0.0165)
    hot: list[np.ndarray] = []
    cold: list[np.ndarray] = []
    cores: list[np.ndarray] = []
    for side in (-1, 1):
        wx = px + side * int(w * 0.52)
        wy = y - 2
        if layer is not None:
            cv2.ellipse(layer, (wx - bx0, wy - by0),
                        (int(w * (0.17 + 0.05 * stage)),
                         int(w * (0.09 + 0.03 * stage))), 0, 0, 360,
                        tuple(min(255, int(c * (1.4 + 0.5 * stage)))
                              for c in glow), -1, cv2.LINE_AA)
        for k in range(rays):
            hsh = ((k * 2654435761) ^ seed ^ (side + 2) * 40503) & 0xFFFFFF
            f = (k + ((hsh >> 4) & 63) / 64.0) / rays
            # Ten to eighty degrees rearward of the contact patch, fanned
            # further round the harder that tyre is scrubbing.
            a = math.radians(9.0 + 72.0 * f - lean * side * 10.0)
            length = reach * (0.34 + 0.66 * ((hsh >> 10 & 255) / 255.0))
            ca_, sa_ = math.cos(a) * side, math.sin(a) * 0.60
            root = (wx + ca_ * w * 0.045, wy + sa_ * w * 0.045)
            tip = (root[0] + ca_ * length, root[1] + sa_ * length)
            nx, ny = -sa_ * wide, ca_ * wide
            tri = np.array([(root[0] - nx, root[1] - ny),
                            (root[0] + nx, root[1] + ny), tip], np.int32)
            if hsh & 3:
                hot.append(tri)
                cores.append(np.array(
                    [(root[0] - nx * 0.42, root[1] - ny * 0.42),
                     (root[0] + nx * 0.42, root[1] + ny * 0.42),
                     (root[0] + ca_ * length * 0.68,
                      root[1] + sa_ * length * 0.68)], np.int32))
            else:
                cold.append(tri)
            if layer is not None and (hsh & 1):
                cv2.line(layer, (int(root[0]) - bx0, int(root[1]) - by0),
                         (int(tip[0]) - bx0, int(tip[1]) - by0), glow,
                         max(2, int(wide * 2.6)), cv2.LINE_AA)
    if layer is not None:
        k = max(5, (int(w * 0.085) | 1))
        roi = canvas[by0:by1, bx0:bx1]
        cv2.add(roi, cv2.blur(layer, (k, k)), dst=roi)
    if cold:
        cv2.fillPoly(canvas, cold, body, cv2.LINE_AA)
    if hot:
        cv2.fillPoly(canvas, hot, body, cv2.LINE_AA)
        # The white cores: a narrower, shorter needle up the middle of every
        # bright ray, so a spark is white at the heart and coloured at the
        # edge - which is what a struck spark actually looks like.
        cv2.fillPoly(canvas, cores, core, cv2.LINE_AA)
    for side in (-1, 1):     # the struck contact patch itself
        wx = px + side * int(w * 0.52)
        cv2.ellipse(canvas, (wx, y - 2), (max(3, int(w * 0.055)),
                                          max(2, int(w * 0.030))),
                    0, 0, 360, body, -1, cv2.LINE_AA)
        cv2.ellipse(canvas, (wx, y - 2), (max(2, int(w * 0.030)),
                                          max(1, int(w * 0.017))),
                    0, 0, 360, core, -1, cv2.LINE_AA)
        # STAGE THREE ONLY: a shock ring beating at the contact patch, so the
        # last stage is told apart by SHAPE and not only by colour.
        if stage == 2 and w > 40:
            rr = int(w * (0.09 + 0.11 * pulse))
            cv2.ellipse(canvas, (wx, y - 2), (rr, max(2, int(rr * 0.52))),
                        0, 0, 360, core if pulse > 0.5 else body,
                        max(1, int(w * 0.012 * (1.0 - pulse) + 1)),
                        cv2.LINE_AA)


def _dust(canvas: np.ndarray, px: int, y: int, w: int, now: float,
          s: float, deep: bool = False, view: Rect | None = None) -> None:
    """The off-track cloud: the same wheel-anchored puffs, thicker and dirtier.

    Off the tarmac both rear tyres are tearing at the surface, so the puffs
    come faster, live a little longer and carry flecks of what they are tearing
    up - torn turf out in the deep grass, warm gravel dust on the shoulder.
    """
    if view is None:
        view = Rect(0, 0, canvas.shape[1], canvas.shape[0])
    fleck = (58, 138, 84) if deep else (128, 158, 186)
    for side in (-1, 1):
        _puffs(canvas, px + side * int(w * 0.50), y, w, side, now, s + side,
               view, count=7, life=0.65, density=0.92, fleck=fleck)
    if w > 40:
        _plume(canvas, px, y, w, now, s, deep, view)


#: The plume palette: tan through to blown-out white, and the coarse stuff the
#: tyres are actually throwing - torn turf out in the deep grass, warm gravel
#: on the shoulder.
_PLUME_TAN = ((92, 150, 206), (136, 188, 226), (194, 222, 242),
              (240, 248, 253))
_PLUME_GRIT = ((36, 58, 92), (30, 48, 78))
_TURF_GRIT = ((28, 74, 44), (22, 62, 36))


def _plume(canvas: np.ndarray, px: int, y: int, w: int, now: float, s: float,
           deep: bool, view: Rect) -> None:
    """The big one: a rooster tail of gravel dust off both rear contact patches.

    Sixteen overlapping blobs per side of the kart, tan at the root and blown
    out to near white at the tip, fanning UP and BACKWARD to two thirds of a
    kart width above the axle and most of one behind it - plus a handful of
    dark flecks of the stuff the tyres are tearing out of the surface. A
    GRAVEL flag on the dashboard with nothing coming off the wheels is a lie,
    and this is the shape that tells the player, without reading anything, to
    get back on the tarmac.

    Every blob is PREMIXED against the pixel it lands on, exactly as the wheel
    puffs are, so the cloud carries its own opacity for the price of an opaque
    ellipse and takes the colour of the surface it is standing over.
    """
    reach = w * 1.16
    grit = _TURF_GRIT if deep else _PLUME_GRIT
    for side in (-1, 1):
        wx = px + side * int(w * 0.50)
        wy = y - 2
        seed = int(s * 53.0) + (side + 1) * 7717
        # ONE ground sample for the whole side. Sampled per blob, adjacent
        # blobs took slightly different tones off the road under them and the
        # cloud broke into a raft of separate translucent bubbles instead of
        # reading as one body of dust.
        lit = canvas[min(max(wy - 4, view.y), view.bottom - 1),
                     min(max(wx, view.x), view.right - 1)].astype(np.float32)
        # Warmed toward the root tan before anything is mixed into it, so the
        # cloud reads as GRAVEL DUST over the grass as well as over the road
        # instead of turning into a pale green ghost the moment it leaves
        # the tarmac.
        ground = lit * 0.34 + np.array(_PLUME_TAN[0], np.float32) * 0.66
        for k in range(22):
            hsh = ((k * 2654435761) ^ (seed * 40503)) & 0xFFFFFF
            # Each blob runs its own life cycle, staggered round the set, so
            # the cloud boils instead of pulsing as one body.
            age = (now * 1.55 + k / 22.0 + (hsh & 511) / 8192.0) % 1.0
            alpha = 1.0 * (1.0 - age) ** 0.34 * min(1.0, age * 8.0)
            if alpha < 0.05:
                continue
            # Up and BACK: the fan runs from straight over the axle round to
            # a little below it, opening out the further the dust travels.
            spread = ((hsh >> 9) & 255) / 255.0
            ang = -1.42 + 1.58 * spread ** 1.9
            d = reach * (0.10 + 0.95 * age) * (0.70 + 0.45 * spread)
            cx = int(wx + side * (w * 0.06 + d * math.cos(ang) * 0.58))
            cy = int(wy + d * math.sin(ang) * 0.60)
            if not (view.x - 60 < cx < view.right + 60
                    and view.y < cy < view.bottom + 60):
                continue
            rad = int(w * (0.055 + 0.072 * age) * (0.78 + 0.44 * spread))
            tone = _PLUME_TAN[min(3, int(age * 4.0))]
            mix = tuple(int(g + (t - g) * alpha) for g, t in zip(ground, tone))
            cv2.ellipse(canvas, (cx, cy), (max(3, rad), max(2, int(rad * 0.86))),
                        0, 0, 360, mix, -1, cv2.LINE_AA)
        for k in range(2):     # the coarse stuff, thrown flat and fast
            hsh = ((k * 374761393) ^ (seed * 668265263)) & 0xFFFFFF
            age = (now * 2.4 + k * 0.5 + (hsh & 255) / 1024.0) % 1.0
            ang = -1.34 + 1.42 * (((hsh >> 8) & 255) / 255.0) ** 1.6
            d = reach * (0.20 + 0.80 * age)
            cx = int(wx + side * (w * 0.06 + d * math.cos(ang) * 0.62))
            cy = int(wy + d * math.sin(ang) * 0.62)
            cv2.circle(canvas, (cx, cy),
                       max(2, int(w * 0.020 * (1.0 - 0.4 * age))),
                       grit[k % len(grit)], -1, cv2.LINE_AA)


# --- the HUD -----------------------------------------------------------------

def _round_poly(x0: int, y0: int, x1: int, y1: int, radius: int) -> np.ndarray:
    r = max(0, min(radius, (x1 - x0) // 2, (y1 - y0) // 2))
    if r == 0:
        return np.array([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], np.int32)
    corners = ((x1 - r, y0 + r, 270), (x1 - r, y1 - r, 0),
               (x0 + r, y1 - r, 90), (x0 + r, y0 + r, 180))
    return np.concatenate([cv2.ellipse2Poly((cx, cy), (r, r), 0, a, a + 90, 10)
                           for cx, cy, a in corners]).astype(np.int32)


def _panel(canvas: np.ndarray, x0: int, y0: int, x1: int, y1: int, radius: int,
           alpha: float = 0.66, colour: tuple[int, int, int] = (30, 27, 25),
           border: tuple[int, int, int] | None = (88, 82, 78)) -> None:
    x0, y0 = max(0, x0), max(0, y0)
    x1, y1 = min(canvas.shape[1], x1), min(canvas.shape[0], y1)
    if x1 - x0 < 4 or y1 - y0 < 4:
        return
    roi = canvas[y0:y1, x0:x1]
    keep = roi.copy()
    poly = _round_poly(0, 0, x1 - x0 - 1, y1 - y0 - 1, radius)
    cv2.fillPoly(roi, [poly], colour, cv2.LINE_AA)
    cv2.addWeighted(keep, 1.0 - alpha, roi, alpha, 0, dst=roi)
    if border is not None:
        cv2.polylines(roi, [poly], True, border, 1, cv2.LINE_AA)


def _dial_face(canvas: np.ndarray, centre: tuple[int, int], radius: int,
               ring: int = 3) -> None:
    """An instrument face: OPAQUE navy, ringed in the P1 gold.

    A translucent dial is not an instrument, it is a tint - it turns olive
    over grass and brown over asphalt, and a start-gantry flag shows straight
    through it. The gauges are a system, and a system has its own colour.
    """
    cv2.circle(canvas, centre, radius, HUD_FACE, -1, cv2.LINE_AA)
    cv2.circle(canvas, centre, radius, tuple(int(c * 1.6) + 12 for c in HUD_FACE),
               1, cv2.LINE_AA)
    cv2.circle(canvas, centre, max(2, radius - ring // 2 - 1), HUD_GOLD, ring,
               cv2.LINE_AA)


def _instrument_plate(canvas: np.ndarray, x0: int, y0: int, x1: int, y1: int,
                      s: float) -> None:
    """The plate an instrument is bolted to: OPAQUE navy, 3px gold rim.

    A dial floating straight on the picture takes its surround from whatever
    is behind it - grass one frame, kerb the next - which is what made the
    bottom corners read as stickers dropped on the scenery. On a plate they
    read as a dashboard.
    """
    x0, y0 = max(0, x0), max(0, y0)
    x1, y1 = min(canvas.shape[1], x1), min(canvas.shape[0], y1)
    if x1 - x0 < 8 or y1 - y0 < 8:
        return
    radius = round(16 * s)
    poly = _round_poly(x0, y0, x1 - 1, y1 - 1, radius)
    cv2.fillPoly(canvas, [poly], (26, 14, 14), cv2.LINE_AA)
    cv2.polylines(canvas, [poly], True, (58, 34, 30), max(1, round(2 * s)),
                  cv2.LINE_AA)
    inner = _round_poly(x0 + 2, y0 + 2, x1 - 3, y1 - 3, max(2, radius - 2))
    cv2.polylines(canvas, [inner], True, HUD_GOLD, max(3, round(3 * s)),
                  cv2.LINE_AA)


def _disc(canvas: np.ndarray, centre: tuple[int, int], radius: int,
          alpha: float = 0.55) -> None:
    x0, y0 = max(0, centre[0] - radius), max(0, centre[1] - radius)
    x1 = min(canvas.shape[1], centre[0] + radius)
    y1 = min(canvas.shape[0], centre[1] + radius)
    if x1 - x0 < 4 or y1 - y0 < 4:
        return
    roi = canvas[y0:y1, x0:x1]
    keep = roi.copy()
    cv2.circle(roi, (centre[0] - x0, centre[1] - y0), radius, (30, 27, 25), -1,
               cv2.LINE_AA)
    cv2.addWeighted(keep, 1.0 - alpha, roi, alpha, 0, dst=roi)


def _centre_text(canvas: np.ndarray, text: str, cx: int, y: int, scale: float,
                 colour: tuple[int, int, int], thickness: int = 2,
                 outline: bool = True) -> None:
    w = text_width(text, scale, thickness, outline=outline)
    draw_text(canvas, text, (int(cx - w / 2), int(y)), colour, scale=scale,
              thickness=thickness, outline=outline)


def _classification(round_: RaceRound) -> list:
    """The field in true finishing order.

    ``RaceRound.standings()`` sorts on ``progress``, and a kart's progress
    freezes the instant it crosses the line - so finishers come out ranked by
    how far past the line their final frame happened to carry them, not by who
    got there first. A nine-second win can land off the podium that way. Rank
    the finished by their timestamp and let everyone still running fall in
    behind them by progress.
    """
    return sorted(round_.everyone(),
                  key=lambda k: (k.finished_at is None,
                                 k.finished_at if k.finished_at is not None
                                 else 0.0, -k.progress))


def _position(round_: RaceRound) -> int:
    order = _classification(round_)
    return next(i for i, kart in enumerate(order, start=1)
                if kart is round_.player)


def _suffix(n: int) -> str:
    if 10 <= n % 100 <= 20:
        return "th"
    return {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")


def _clock(seconds: float) -> str:
    """m:ss.t, rounded ONCE. Formatting the two halves independently rounds
    the seconds up to 60.0 while the minutes still floor, so the clock reads
    an impossible '0:60.0' for the last twentieth of every minute."""
    tenths = int(max(0.0, seconds) * 10.0 + 0.5)
    return f"{tenths // 600}:{tenths % 600 / 10:04.1f}"


class _Shy:
    """An instrument that GETS OUT OF THE WAY of the karts behind it.

    The bottom corners of the frame are where a rival draws alongside, and an
    opaque pod parked there hides the one wheel the player needs to see to
    know whether the move is on. So each pod keeps the frame it is about to
    cover, and if a kart footprint reaches into its rectangle it blends the
    picture back over itself afterwards - the dial stays readable, the kart
    stays visible, and nothing moves or resizes as the pack shuffles.
    """

    __slots__ = ("canvas", "box", "keep", "mix", "hit")

    def __init__(self, canvas: np.ndarray, fx: "_Effects",
                 box: tuple[int, int, int, int], mix: float = 0.34,
                 floor: float = 0.12) -> None:
        self.canvas = canvas
        self.box = None
        self.keep = None
        self.mix = mix
        self.hit = False
        x0, y0, x1, y1 = box
        x0, y0 = max(0, x0), max(0, y0)
        x1 = min(canvas.shape[1], x1)
        y1 = min(canvas.shape[0], y1)
        if x1 - x0 < 4 or y1 - y0 < 4:
            return
        # A real bite out of the pod, not a corner brushing it: an eighth of
        # the plate's area, or the instrument would flicker every time a kart
        # slid past the edge of the frame.
        area = (x1 - x0) * (y1 - y0) * floor
        for sx0, sy0, sx1, sy1 in fx.sprites:
            over = (max(0, min(x1, sx1) - max(x0, sx0))
                    * max(0, min(y1, sy1) - max(y0, sy0)))
            if over > area:
                self.box = (x0, y0, x1, y1)
                self.keep = canvas[y0:y1, x0:x1].copy()
                self.hit = True
                return

    def release(self) -> None:
        if self.keep is None:
            return
        x0, y0, x1, y1 = self.box
        roi = self.canvas[y0:y1, x0:x1]
        cv2.addWeighted(self.keep, self.mix, roi, 1.0 - self.mix, 0, dst=roi)


def draw_hud(canvas: np.ndarray, round_: RaceRound, wheel: Wheel, now: float,
             scale: float = 1.0) -> None:
    view = Rect(0, 0, canvas.shape[1], canvas.shape[0])
    fx = _effects_for(round_)
    fx.brake = wheel.brake
    _lap_plate(canvas, round_, now, scale)
    _item_slot(canvas, round_, now, scale, view)
    _drift_meter(canvas, round_, scale, view)
    # THE RUNNING ORDER LIVES IN THE BOTTOM-LEFT CORNER, and it is opaque.
    # Parked halfway down the left edge at two thirds alpha it sat exactly
    # where a rival draws alongside, and the frame showed a checkered nose
    # and a white position arrow ghosting through rows three and four of the
    # table. Down in the corner it is out of the racing line; opaque, it is
    # a panel rather than a stain; and if a kart does reach into it the whole
    # board fades back so the road wins.
    order = _Shy(canvas, fx, _order_box(scale, view, len(_classification(round_))),
                 mix=0.90, floor=0.02)
    _order_strip(canvas, round_, wheel, scale, view)
    order.release()
    _minimap(canvas, round_, scale, view)
    speedo = _Shy(canvas, fx, _speedo_box(scale, view))
    _speedometer(canvas, round_, wheel, scale, view)
    speedo.release()
    _surface_badge(canvas, round_, scale, view)
    _pedals(canvas, wheel, scale, view)
    _race_messages(canvas, round_, now, scale, view)


#: The key hints, as (key, label) pairs.
_KEYS = (("B", "MAPS"), ("R", "RESTART"), ("Q", "QUIT"))


def _key_pills(canvas: np.ndarray, s: float, view: Rect) -> None:
    """The key hints as small dark pills, in a row above the bottom of the frame.

    These are MENU chrome, not instruments. They used to sit under the minimap
    through every lap of every race, which put a row of grey developer buttons
    in the middle of the picture at 170 km/h; now they appear only on the grid,
    while the player is waiting to grip the wheel and is choosing rather than
    driving.
    """
    scale = 0.44 * s
    pad = round(11 * s)
    gap = round(8 * s)
    hgt = round(26 * s)
    y0 = view.bottom - round(64 * s)
    widths = [(text_width(f"{k} {label}", scale, 1, outline=False), k, label)
              for k, label in _KEYS]
    total = sum(w for w, _, _ in widths) + len(widths) * 2 * pad \
        + (len(widths) - 1) * gap
    x = view.x + (view.width - total) // 2
    for w, key, label in widths:
        _panel(canvas, x, y0, x + w + 2 * pad, y0 + hgt, round(8 * s),
               alpha=0.72)
        draw_text(canvas, key, (x + pad, y0 + hgt - round(8 * s)), HUD_GOLD,
                  scale=scale, thickness=1, outline=False)
        kw = text_width(f"{key} ", scale, 1, outline=False)
        draw_text(canvas, label, (x + pad + kw, y0 + hgt - round(8 * s)),
                  (188, 184, 180), scale=scale, thickness=1, outline=False)
        x += w + 2 * pad + gap


def _lap_plate(canvas: np.ndarray, round_: RaceRound, now: float,
               s: float) -> None:
    m = round(20 * s)
    w, h = round(252 * s), round(96 * s)
    _panel(canvas, m, m, m + w, m + h, HUD_RADIUS(s), alpha=HUD_ALPHA,
           colour=HUD_PANEL, border=HUD_EDGE)
    position = _position(round_)
    medal = MEDALS[position - 1] if position <= 3 else INK
    draw_text(canvas, f"P{position}", (m + round(18 * s), m + round(62 * s)),
              medal, scale=1.5 * s, thickness=4)
    draw_text(canvas, _suffix(position),
              (m + round(18 * s) + text_width(f"P{position}", 1.5 * s, 4),
               m + round(40 * s)), medal, scale=0.6 * s, thickness=2)
    lap_no = min(round_.player.lap + 1, round_.laps)
    draw_text(canvas, f"LAP {lap_no}/{round_.laps}",
              (m + round(126 * s), m + round(36 * s)), INK, scale=0.72 * s,
              thickness=2)
    elapsed = 0.0 if round_.started_at is None else now - round_.started_at
    # The running clock is the second thing the player reads off this panel,
    # so it is set in near-white, not in the grey the labels use.
    draw_figures(canvas, _clock(elapsed), (m + round(126 * s), m + round(66 * s)),
                 (238, 241, 245), round(19 * s))
    best = round_.best_lap()
    if best is not None:
        draw_text(canvas, f"best {best:5.1f}s",
                  (m + round(126 * s), m + round(88 * s)), ACCENT,
                  scale=0.5 * s, thickness=1)


@lru_cache(maxsize=4)
def _minimap_plate(track: Track, size: int,
                   s100: int) -> tuple[np.ndarray, np.ndarray]:
    """The map's STATIC layer: panel, track ribbon and start tick, built once.

    Two antialiased 320-vertex polylines and a rounded plate, redrawn sixty
    times a second, for a picture that is identical on every frame of the
    race. Cached it is one memcpy, and the per-frame cost of the map is the
    six coloured dots that actually move.
    """
    s = s100 / 100.0
    tile = np.zeros((size, size, 3), np.uint8)
    _panel(tile, 0, 0, size, size, HUD_RADIUS(s), alpha=1.0, colour=HUD_PANEL,
           border=HUD_EDGE)
    pts = _track_shape(track)
    pad = size * 0.15
    pixels = (pad + pts * (size - 2 * pad)).astype(np.int32)
    # The ribbon: one fat dark stroke for the tarmac, one thin pale stroke for
    # its edge. Drawn round the closed loop, so the map is a circuit - and off
    # every fourth sample, which both smooths the lumpy noodle the outline used
    # to be and costs a quarter of the overdraw a 320-segment stroke did.
    loop = np.ascontiguousarray(pixels[::4])
    cv2.polylines(tile, [loop], True, (38, 36, 42), max(5, round(11 * s)),
                  cv2.LINE_AA)
    cv2.polylines(tile, [loop], True, (98, 96, 104), max(1, round(2 * s)),
                  cv2.LINE_AA)
    direction = (pixels[1] - pixels[0]).astype(float)
    normal = np.array([-direction[1], direction[0]])
    norm = float(np.hypot(*normal)) or 1.0
    tick = (normal / norm * max(5.0, 7 * s)).astype(int)
    cv2.line(tile, tuple(pixels[0] - tick), tuple(pixels[0] + tick),
             (246, 248, 252), max(2, round(3 * s)), cv2.LINE_AA)
    return tile, pixels


def _minimap(canvas: np.ndarray, round_: RaceRound, s: float,
             view: Rect) -> None:
    """The circuit as a SOLID RIBBON, with a heading arrow on the player.

    Two hairlines round a lumpy noodle told the player nothing: which way
    round, where the line is, or which dot was theirs. A filled dark ribbon
    with a white start tick reads as a racetrack; the player's marker is a
    triangle pointing where the kart is actually going, drawn bigger and
    brighter than every rival. The whole panel then goes down at seventy per
    cent so it sits UNDER the sky instead of competing with it.
    """
    size = round(172 * s)
    m = round(20 * s)
    x0, y0 = view.right - size - m, view.y + m
    x1, y1 = min(canvas.shape[1], x0 + size), min(canvas.shape[0], y0 + size)
    if x1 - x0 < 16 or y1 - y0 < 16:
        return
    roi = canvas[y0:y1, x0:x1]
    keep = roi.copy()
    # The plate, the ribbon and the start tick never change: they are the
    # CIRCUIT, and the circuit is the one thing on this panel that is the same
    # on the last lap as on the first. Built once per track and blitted.
    plate, pixels = _minimap_plate(round_.track, size, round(s * 100))
    np.copyto(roi, plate[:y1 - y0, :x1 - x0])
    pts = _track_shape(round_.track)
    count = len(pts)
    length = round_.track.length
    for kart in round_.field_:
        i = int(kart.s / length * count) % count
        cv2.circle(roi, tuple(pixels[i]), max(2, round(3 * s)),
                   _kart_colour(kart, False), -1, cv2.LINE_AA)
    i = int(round_.player.s / length * count) % count
    here = pixels[i]
    # WHICH WAY AM I GOING. A triangle on the player's own marker, aimed down
    # the track from where the kart is now - the one thing a map of a closed
    # loop cannot say without it.
    nxt = pixels[(i + 3) % count].astype(float) - here.astype(float)
    mag = float(np.hypot(*nxt)) or 1.0
    ux, uy = nxt[0] / mag, nxt[1] / mag
    reach = max(6.0, 11 * s)
    cv2.circle(roi, tuple(here), max(4, round(8 * s)), (252, 253, 255), -1,
               cv2.LINE_AA)
    cv2.fillPoly(roi, [np.array([
        (here[0] + ux * reach, here[1] + uy * reach),
        (here[0] - uy * reach * 0.62 - ux * reach * 0.30,
         here[1] + ux * reach * 0.62 - uy * reach * 0.30),
        (here[0] + uy * reach * 0.62 - ux * reach * 0.30,
         here[1] - ux * reach * 0.62 - uy * reach * 0.30)], np.int32)],
        PLAYER, cv2.LINE_AA)
    cv2.addWeighted(keep, 0.30, roi, 0.70, 0, dst=roi)


def _slot_box(s: float, view: Rect) -> tuple[int, int, int, int]:
    """The item slot's rectangle: top of the frame, just right of the plate."""
    m = round(20 * s)
    x = m + round(252 * s) + round(12 * s)
    return (x, m, x + round(104 * s), m + round(96 * s))


def _item_slot(canvas: np.ndarray, round_: RaceRound, now: float, s: float,
               view: Rect) -> None:
    """THE ITEM SLOT: what the exhaust is holding for you.

    A kart racer's slot is the promise of a thing you can spend, and on this
    circuit the thing you win is the boost the drift banks. Empty on the grid,
    it fills with a hot chevron the instant a slide pays out and drains as the
    boost burns - so the top of the screen finally says what the reward is.
    """
    boost = float(getattr(round_.player, "boost", 0.0))
    if boost <= 0.0:
        # AN EMPTY SLOT IS NOT A SLOT. A dead grey disc captioned BOOST sat
        # at the top of eight frames out of eleven saying nothing at all -
        # chrome for its own sake. The pod exists only while there is
        # something in it; the drift meter below already says when there
        # will be.
        return
    x0, y0, x1, y1 = _slot_box(s, view)
    _panel(canvas, x0, y0, x1, y1, HUD_RADIUS(s), alpha=HUD_ALPHA,
           colour=HUD_PANEL, border=HUD_GOLD)
    cx, cy = (x0 + x1) // 2, (y0 + y1) // 2 - round(5 * s)
    r = round(24 * s)
    pulse = 0.72 + 0.28 * math.sin(now * 13.0)
    _add_glow(canvas, cx, cy, int(r * 1.9),
              tuple(int(c * pulse) for c in (40, 60, 90)),
              Rect(0, 0, canvas.shape[1], canvas.shape[0]))
    for k, tone in ((0, (30, 110, 250)), (1, (120, 226, 255))):
        off = r * 0.34 * k
        cv2.fillPoly(canvas, [np.array([
            (cx - r * 0.72 + off, cy + r * 0.62),
            (cx + r * 0.10 + off, cy - r * 0.10),
            (cx - r * 0.30 + off, cy - r * 0.10),
            (cx + r * 0.52 + off, cy - r * 0.78),
            (cx - r * 0.16 + off, cy - r * 0.16),
            (cx + r * 0.26 + off, cy - r * 0.16)], np.int32)], tone,
            cv2.LINE_AA)
    _centre_text(canvas, "BOOST", cx, y1 - round(9 * s), 0.40 * s,
                 HUD_GOLD, 1, outline=False)


def _drift_meter(canvas: np.ndarray, round_: RaceRound, s: float,
                 view: Rect) -> None:
    """THE DRIFT CHARGE, as a bar: blue, then orange, then violet.

    Exactly the three stages the sparks off the rear tyres are already
    burning, in exactly the same order and the same colours - so the meter and
    the kart are telling one story, and a driver mid-corner can decide whether
    to hold the slide for one more apex without taking their eyes off the road.
    """
    m = round(20 * s)
    x0 = m
    x1 = _slot_box(s, view)[2]
    y0 = m + round(96 * s) + round(10 * s)
    y1 = y0 + round(26 * s)
    charge = 0.0
    if getattr(round_.player, "drifting", False):
        charge = min(1.0, getattr(round_.player, "drift_time", 0.0) / DRIFT_HOLD)
    _panel(canvas, x0, y0, x1, y1, HUD_RADIUS(s), alpha=HUD_ALPHA,
           colour=HUD_PANEL, border=HUD_EDGE)
    pad = round(5 * s)
    bx0, bx1 = x0 + pad, x1 - pad
    by0, by1 = y0 + pad, y1 - pad
    span = bx1 - bx0
    if charge > 0.01:
        tone = _DRIFT_STAGES[_drift_stage(charge)][2]
        cv2.fillPoly(canvas, [_round_poly(bx0, by0, bx0 + int(span * charge),
                                          by1, round(4 * s))], tone,
                     cv2.LINE_AA)
    # The two stage gates, so the fill has somewhere to be counted TO.
    for gate in (0.34, 0.67):
        gx = bx0 + int(span * gate)
        cv2.line(canvas, (gx, by0), (gx, by1), (16, 14, 16),
                 max(1, round(2 * s)), cv2.LINE_AA)
    draw_text(canvas, "DRIFT", (bx0 + round(6 * s), by1 - round(4 * s)),
              (150, 146, 142) if charge < 0.01 else (14, 12, 14),
              scale=0.36 * s, thickness=1, outline=False)


#: The height of the wheel-status footer at the bottom of the running order.
def _lamp_h(s: float) -> int:
    return round(24 * s)


def _order_box(s: float, view: Rect, count: int) -> tuple[int, int, int, int]:
    """The running order's rectangle, pinned to the BOTTOM-LEFT corner."""
    m = round(14 * s)
    row = round(25 * s)
    h = row * min(count, 6) + round(8 * s) + _lamp_h(s)
    y1 = view.bottom - round(24 * s)
    # A SIX-ROW STRIP that stops well short of the racing line. The board used
    # to run out to x=223 at this scale, which is exactly where a rival draws
    # alongside on the inside - and the frame showed a kart's front wheel
    # sitting behind a translucent table. Narrower, shorter, and out of the
    # way; and when a kart does reach it, the caller drops it to a tenth.
    return (view.x + m, y1 - h, view.x + m + round(112 * s), y1)


def _order_strip(canvas: np.ndarray, round_: RaceRound, wheel: Wheel,
                 s: float, view: Rect) -> None:
    """THE RUNNING ORDER, in the bottom-left corner. A race needs STAKES.

    One row per kart in classification order, each carrying its livery chip;
    the player's row is picked out in the P1 gold and set a little wider, so
    a glance says both where you are and who is next to catch. Fully OPAQUE:
    a translucent table with a rival's checkered nose showing through rows
    three and four is not a leaderboard, it is a smudge - and the caller
    fades the whole board out of the way whenever a kart reaches into it.
    """
    order = _classification(round_)[:6]
    x0, y0, x1, y1 = _order_box(s, view, len(order))
    row = round(25 * s)
    _panel(canvas, x0, y0, x1, y1, HUD_RADIUS(s), alpha=1.0,
           colour=HUD_PANEL, border=HUD_EDGE)
    for i, kart in enumerate(order):
        ry = y0 + round(6 * s) + i * row
        me = kart is round_.player
        if me:
            cv2.fillPoly(canvas, [_round_poly(x0 + round(3 * s), ry,
                                              x1 - round(3 * s),
                                              ry + row - round(3 * s),
                                              round(5 * s))],
                         (44, 40, 34), cv2.LINE_AA)
        chip = _kart_colour(kart, me)
        cv2.circle(canvas, (x0 + round(30 * s), ry + row // 2 - round(2 * s)),
                   max(3, round(6 * s)), chip, -1, cv2.LINE_AA)
        tone = HUD_GOLD if me else (176, 172, 168)
        draw_text(canvas, f"{i + 1}", (x0 + round(11 * s), ry + row - round(9 * s)),
                  tone, scale=0.42 * s, thickness=2 if me else 1, outline=False)
        name = "YOU" if me else kart.name.upper()[:7]
        draw_text(canvas, name, (x0 + round(42 * s), ry + row - round(9 * s)),
                  tone, scale=0.36 * s, thickness=2 if me else 1, outline=False)
    # THE WHEEL LAMP, as this panel's own footer rather than a seventh box.
    # It is the only place the calibration ever speaks: a crooked grip that
    # the controller refused at the lights pulls the kart all race, and the
    # player has to be told which of the two things is wrong - the hands are
    # off the wheel, or the hands are on it but were never believed.
    lamp = _lamp_h(s)
    ly = y1 - lamp
    cv2.line(canvas, (x0 + round(6 * s), ly), (x1 - round(6 * s), ly),
             (58, 54, 50), max(1, round(1 * s)), cv2.LINE_AA)
    # A lamp that reports "everything is normal" for the whole race is noise
    # wearing the costume of information - and reading WHEEL SET under the
    # running order made the game look like it had shipped with its telemetry
    # overlay still switched on. The row speaks only when the player can DO
    # something about what it says, and is silent the rest of the time.
    if not wheel.tracking:
        word, dot = "HANDS OFF", (150, 158, 236)
    elif wheel.level_hint and not wheel.brake:
        # A braking driver is told they are braking and nothing else: the
        # brake is a state they are creating right now, a crooked centre is
        # one they cannot do anything about until the next set of lights.
        word, dot = "WHEEL LEVEL?", WARN
    else:
        return
    cy = ly + lamp // 2 + round(1 * s)
    cv2.circle(canvas, (x0 + round(14 * s), cy), max(2, round(4 * s)), dot, -1,
               cv2.LINE_AA)
    draw_text(canvas, word, (x0 + round(24 * s), cy + round(5 * s)),
              dot if word != "WHEEL SET" else (150, 146, 142),
              scale=0.32 * s, thickness=1, outline=False)


def _pedals(canvas: np.ndarray, wheel: Wheel, s: float, view: Rect) -> None:
    """PEDAL TRAVEL, as one slim bar tucked under the speedometer.

    The throttle is an axis, not a switch - a grip is full power, fingers
    half-uncurled is a lift - and how far that pedal has travelled is the one
    thing the dial above and the wheel across the screen do not already say.
    So it is the only thing drawn here, wordless: green as it fills off the
    hands, flooded red under braking.
    """
    x0, y0, x1, _y1 = _speedo_box(s, view)
    top = _y1 + round(10 * s)
    hgt = round(14 * s)
    if top + hgt > view.bottom - round(8 * s):
        top = view.bottom - round(8 * s) - hgt
    # ONE BAR, no words. Two labelled pills reading GAS and BRK sat under the
    # dial looking like a debug overlay somebody forgot to take out, and they
    # said what the dial and the wheel already say. What the player cannot see
    # anywhere else is how far the pedal itself has travelled - the throttle
    # is an axis now, half-uncurled fingers are a lift - so that is all this
    # draws: a travel bar that fills green off the hands and floods red under
    # braking, wordless, the width of the instrument above it.
    travel = 1.0 if wheel.brake else max(0.0, min(1.0, wheel.throttle))
    tone = (48, 46, 214) if wheel.brake else (96, 216, 118)
    radius = hgt // 2
    cv2.fillPoly(canvas, [_round_poly(x0, top, x1, top + hgt, radius)],
                 (40, 37, 37), cv2.LINE_AA)
    if travel > 0.01:
        span = max(hgt, int((x1 - x0) * travel))
        cv2.fillPoly(canvas, [_round_poly(x0, top, x0 + span, top + hgt,
                                          radius)], tone, cv2.LINE_AA)
    cv2.polylines(canvas, [_round_poly(x0, top, x1, top + hgt, radius)],
                  True, HUD_EDGE, max(1, round(1 * s)), cv2.LINE_AA)


def _steer_horizon(canvas: np.ndarray, wheel: Wheel, s: float,
                   x0: int, y0: int, x1: int, y1: int) -> None:
    """The steering, as a TILTING HORIZON under the speedo.

    A wheel drawn as a wheel is a picture of the controller, not a readout.
    A horizon line that banks with the input is instantly legible at speed and
    takes a fifth of the room - so it lives inside the speedo's own plate,
    where the driver's eye already is.
    """
    cv2.fillPoly(canvas, [_round_poly(x0, y0, x1, y1, round(6 * s))],
                 (16, 12, 14), cv2.LINE_AA)
    cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
    reach = (x1 - x0) // 2 - round(11 * s)
    ang = math.radians(max(-1.0, min(1.0, wheel.steer)) * 15.0)
    dx, dy = math.cos(ang) * reach, math.sin(ang) * reach
    tone = (118, 226, 140) if wheel.tracking else (110, 108, 118)
    cv2.line(canvas, (int(cx - dx), int(cy - dy)), (int(cx + dx), int(cy + dy)),
             tone, max(2, round(3 * s)), cv2.LINE_AA)
    cv2.line(canvas, (cx, cy - round(5 * s)), (cx, cy + round(5 * s)),
             (226, 200, 120), max(1, round(2 * s)), cv2.LINE_AA)


def _speedo_box(s: float, view: Rect) -> tuple[int, int, int, int]:
    """The speedometer's plate, as a rectangle - see ``_Shy``."""
    disc, pad, lip = int(round(42 * s) * 1.30), round(26 * s), round(14 * s)
    cx = view.right - disc - pad - lip
    cy = view.bottom - disc - pad - round(80 * s)
    return (cx - disc - lip, cy - disc - lip, cx + disc + lip,
            cy + round(96 * s))


@lru_cache(maxsize=4)
def _speedo_plate(w: int, h: int, disc: int, r: int, s100: int) -> np.ndarray:
    """The speedometer's unchanging layer: plate, face, empty sweep, ticks."""
    s = s100 / 100.0
    tile = np.zeros((max(h, 1), max(w, 1), 3), np.uint8)
    cx, cy = disc + round(14 * s), disc + round(14 * s)
    _instrument_plate(tile, 0, 0, w, h, s)
    _dial_face(tile, (cx, cy), disc, max(2, round(2 * s)))
    thickness = max(3, round(6 * s))
    cv2.ellipse(tile, (cx, cy), (r, r), 0, 135, 405, (66, 62, 60), thickness,
                cv2.LINE_AA)
    for i in range(11):
        a = math.radians(135 + 27 * i)
        x0 = cx + math.cos(a) * (r - thickness)
        y0 = cy + math.sin(a) * (r - thickness)
        x1 = cx + math.cos(a) * (r - thickness - 4 * s)
        y1 = cy + math.sin(a) * (r - thickness - 4 * s)
        cv2.line(tile, (int(x0), int(y0)), (int(x1), int(y1)), MUTED, 1,
                 cv2.LINE_AA)
    return tile


def _speedometer(canvas: np.ndarray, round_: RaceRound, wheel: Wheel,
                 s: float, view: Rect) -> None:
    """Compact and flush in the corner: the road, not the gauge, gets the
    bottom of the screen - a kart alongside must never hide behind it."""
    r = round(42 * s)
    # Inset by the DISC, not the dial: the dark backing plate plus its padding
    # must clear both frame edges, or the gauge reads as a circle someone cut
    # the corner off. Pulled well inboard of the corner so the kerb sweeping
    # past underneath is never running through the instrument.
    disc = int(r * 1.30)
    pad = round(26 * s)
    lip = round(14 * s)
    cx = view.right - disc - pad - lip
    cy = view.bottom - disc - pad - round(80 * s)
    px0, py0 = cx - disc - lip, cy - disc - lip
    px1, py1 = cx + disc + lip, cy + round(96 * s)
    # The plate, the dial face, its empty sweep and its eleven ticks are the
    # same picture on every frame of the race; only the coloured arc, the
    # needle and the number move. Built once, blitted once.
    plate = _speedo_plate(px1 - px0, py1 - py0, disc, r, round(s * 100))
    bx0, by0 = max(0, px0), max(0, py0)
    bx1, by1 = min(canvas.shape[1], px1), min(canvas.shape[0], py1)
    if bx1 > bx0 and by1 > by0:
        np.copyto(canvas[by0:by1, bx0:bx1],
                  plate[by0 - py0:by1 - py0, bx0 - px0:bx1 - px0])
    fraction = max(0.0, min(1.0, round_.player.v / TOP_SPEED))
    thickness = max(3, round(6 * s))
    if fraction > 0.01:
        t = fraction
        colour = (int(90 + (60 - 90) * t), int(210 + (90 - 210) * t),
                  int(130 + (250 - 130) * t))
        cv2.ellipse(canvas, (cx, cy), (r, r), 0, 135, 135 + 270 * fraction,
                    colour, thickness, cv2.LINE_AA)
    a = math.radians(135 + 270 * fraction)
    reach = (r - thickness - 3) * 0.62   # short enough to clear the readout
    cv2.line(canvas, (cx, cy),
             (cx + int(math.cos(a) * reach), cy + int(math.sin(a) * reach)),
             (222, 226, 230), max(2, round(2.4 * s)), cv2.LINE_AA)
    cv2.circle(canvas, (cx, cy), max(2, round(4 * s)), (222, 226, 230), -1,
               cv2.LINE_AA)
    speed_text = f"{int(round_.player.v * 3.1)}"
    size = round(24 * s)
    draw_figures(canvas, speed_text,
                 (cx - figures_width(speed_text, size) // 2, cy + round(34 * s)),
                 INK, size)
    _centre_text(canvas, "km/h", cx, cy + round(47 * s), 0.36 * s, MUTED, 1)
    # And under the numbers, the steering: a horizon bar that banks with the
    # wheel. Steering and speed are the two things the driver reads, so they
    # share one plate instead of sitting in opposite corners of the frame.
    _steer_horizon(canvas, wheel, s, cx - disc + round(4 * s),
                   cy + round(56 * s), cx + disc - round(4 * s),
                   cy + round(86 * s))


def _surface_badge(canvas: np.ndarray, round_: RaceRound, s: float,
                   view: Rect) -> None:
    """The off-track warning, docked UNDER THE MINIMAP.

    Stacked on the speedo it grew the bottom-right instrument by a third every
    time a wheel touched the shoulder. Under the map it sits with the other
    piece of status chrome, and the dial keeps one shape all race.
    """
    if not (abs(round_.player.x) > ROAD_HALF_WIDTH and round_.racing):
        return
    size, m = round(172 * s), round(20 * s)
    cx = view.right - m - size // 2
    by = view.y + m + size + round(9 * s)
    bw, bh = round(150 * s), round(30 * s)
    _panel(canvas, cx - bw // 2, by, cx + bw // 2, by + bh, round(7 * s),
           alpha=0.94, colour=(18, 62, 96), border=WARN)
    tick = max(3, round(5 * s))
    for k in range(2):
        for sgn in (-1, 1):
            hx = cx + sgn * (bw // 2 - round(9 * s) - k * tick * 2)
            cv2.line(canvas, (hx, by + bh - round(8 * s)),
                     (hx - sgn * tick, by + round(8 * s)), WARN,
                     max(1, round(2 * s)), cv2.LINE_AA)
    _centre_text(canvas, "GRAVEL", cx, by + bh - round(10 * s), 0.5 * s,
                 (240, 248, 252), 2, outline=False)


def _race_messages(canvas: np.ndarray, round_: RaceRound, now: float, s: float,
                   view: Rect) -> None:
    cx = view.x + view.width // 2
    top = view.y + round(view.height * 0.30)
    left = round_.countdown(now)
    if getattr(round_, "waiting_for_hands", False) or left is not None:
        # The grid is the one moment in the race with time to spare: build the
        # podium art now, so the frame the flag falls costs nothing extra.
        _results_backdrop(view.width, view.height)
    if getattr(round_, "waiting_for_hands", False):
        # The grid waits for the driver, and the wait is the calibration:
        # however they hold the wheel through the countdown becomes zero.
        pulse = 0.5 + 0.5 * math.sin(now * 3.5)
        _disc(canvas, (cx, top - round(30 * s)), round(120 * s), 0.5)
        draw_text(canvas, "HANDS ON THE WHEEL",
                  (cx - round(200 * s), top - round(40 * s)),
                  (90, 210, 250) if pulse > 0.5 else (200, 210, 220),
                  scale=1.1 * s, thickness=3)
        draw_text(canvas, "grip with both fists to start - your grip becomes straight-ahead",
                  (cx - round(255 * s), top + round(4 * s)),
                  (185, 190, 195), scale=0.55 * s)
        # The grid is the one moment the player is choosing rather than
        # driving, so the key hints belong here and nowhere else in the race.
        _key_pills(canvas, s, view)
        return
    if left is not None:
        n = int(math.ceil(left))
        frac = float(n) - left  # 0 -> 1 through this number's second
        pop = 5.2 - 2.0 * min(1.0, frac * 3.5)
        colour = WARN if n > 1 else (90, 110, 250)
        _disc(canvas, (cx, top - round(52 * s)), round(96 * s), 0.42)
        cv2.circle(canvas, (cx, top - round(52 * s)),
                   round((70 + 40 * frac) * s), colour, max(2, round(3 * s)),
                   cv2.LINE_AA)
        size = round(pop * 30 * s)
        draw_figures(canvas, str(n),
                     (cx - figures_width(str(n), size) // 2, top), colour,
                     size, bold=0.06)
        return
    if round_.started_at is not None and now - round_.started_at < 1.0:
        gone = now - round_.started_at
        pop = 4.6 - 1.9 * min(1.0, gone * 3.0)
        _centre_text(canvas, "GO!", cx, top, pop * s, GOOD,
                     max(4, round(pop * 2.4 * s)))
        return
    if round_.finished:
        _centre_text(canvas, "FINISH!", cx, top, 2.6 * s, WARN, 7)
        return
    lap_started = getattr(round_, "_lap_started", None)
    if (round_.racing and round_.lap_times and lap_started is not None
            and now - lap_started < 2.2):
        final = round_.player.lap == round_.laps - 1
        title = "FINAL LAP" if final else f"LAP {round_.player.lap + 1}"
        _centre_text(canvas, title, cx, top, 1.6 * s, WARN if final else INK, 4)
        _centre_text(canvas, f"{round_.lap_times[-1]:5.1f}s", cx,
                     top + round(46 * s), 0.85 * s, MUTED, 2)


# --- the results -------------------------------------------------------------

@lru_cache(maxsize=2)
def _results_backdrop(width: int, height: int) -> np.ndarray:
    """Dusk over the speedway: warm sunset, a lit infield, podium spotlights.

    The old version dropped everything below the horizon to near-black, which
    turned the best moment of the race into the darkest frame in the game.
    Now the infield keeps the sunset bouncing off it, the spotlight cones have
    a visible falloff, and the podium stands in a real pool of warm light.
    """
    image = np.zeros((height, width, 3), np.uint8)
    sky_h = max(2, int(height * 0.58))
    sky = _sky(width, sky_h).astype(np.float32)
    image[:sky_h] = np.clip(sky * 0.78, 0, 255).astype(np.uint8)
    # The infield is LIT: warm sunset bounce near the horizon falling away to
    # a deep blue-violet at the bottom of the frame, never to black.
    grad = np.linspace((64, 58, 74), (30, 26, 38), height - sky_h)
    image[sky_h:] = np.repeat(grad[:, None, :], width, axis=1).astype(np.uint8)

    cx = width // 2
    base_y = int(height * 0.74)
    # Spotlight cones with a real falloff: each one is laid as a stack of
    # narrowing, brightening triangles rather than one flat wash.
    overlay = image.copy()
    for dx, spread, gain in ((-int(width * 0.26), 0.17, 0.72),
                             (0, 0.145, 1.0),
                             (int(width * 0.26), 0.17, 0.72)):
        for step in range(4):
            k = 1.0 - step * 0.22
            tone = tuple(int(c * gain * (0.42 + 0.58 * step))
                         for c in (120, 138, 176))
            pts = np.array([(cx + dx, -int(height * 0.10)),
                            (cx + int(dx * 0.35) - int(width * spread * k),
                             base_y),
                            (cx + int(dx * 0.35) + int(width * spread * k),
                             base_y)], np.int32)
            cv2.fillPoly(overlay, [pts], tone, cv2.LINE_AA)
    image[:] = cv2.addWeighted(image, 0.84, overlay, 0.16, 0)
    # The pool of light the cones land in, warm and wide, brightest under the
    # middle step - the winner stands in the hottest part of it.
    for rr, tone in (((0.40, 0.075), (74, 76, 96)),
                     ((0.30, 0.055), (104, 108, 132)),
                     ((0.17, 0.032), (140, 152, 184))):
        cv2.ellipse(image, (cx, base_y),
                    (int(width * rr[0]), int(height * rr[1])), 0, 0, 360,
                    tone, -1, cv2.LINE_AA)
    return image


_CONFETTI = ((70, 190, 245), (90, 110, 250), (120, 230, 130), (236, 190, 90),
             (230, 230, 235), (200, 120, 230))


def _confetti(canvas: np.ndarray, width: int, height: int, now: float) -> None:
    for i in range(110):
        speed = 34.0 + (i % 7) * 11.0
        x = int((i * 173.31 + math.sin(now * 1.3 + i) * 24.0) % width)
        y = int(((i * 97.7) % height + now * speed) % (height + 24)) - 12
        if not 0 <= y < height:
            continue
        a = (i * 0.7 + now * (2.0 + (i % 3)))
        dx, dy = math.cos(a) * 4.0, math.sin(a) * 2.5
        cv2.line(canvas, (int(x - dx), int(y - dy)), (int(x + dx), int(y + dy)),
                 _CONFETTI[i % len(_CONFETTI)], 2, cv2.LINE_AA)


def _results_keys(canvas: np.ndarray, s: float, view: Rect) -> None:
    """The way out, as small pill glyphs in the panel-and-gold language.

    A line of lowercase programmer instructions strung across the bottom of a
    styled results screen is the loudest 'unfinished build' tell there is.
    These are the same dark panels with the same gold key caps the rest of the
    HUD uses, tucked into the bottom-left corner clear of everything else.
    """
    keys = (("OPEN", "HANDS", "RACE AGAIN"), ("B", None, "MAPS"),
            ("Q", None, "QUIT"))
    scale = 0.40 * s
    pad = round(9 * s)
    hgt = round(24 * s)
    x = view.x + round(26 * s)
    y0 = view.bottom - round(34 * s) - hgt
    for cap, cap2, label in keys:
        glyph = cap if cap2 is None else f"{cap} {cap2}"
        wid = text_width(glyph, scale, 1, outline=False) + 2 * pad
        _panel(canvas, x, y0, x + wid, y0 + hgt, round(7 * s), alpha=0.80)
        draw_text(canvas, glyph, (x + pad, y0 + hgt - round(7 * s)), HUD_GOLD,
                  scale=scale, thickness=1, outline=False)
        x += wid + round(7 * s)
        lw = text_width(label, scale, 1, outline=False)
        draw_text(canvas, label, (x, y0 + hgt - round(7 * s)), (176, 174, 172),
                  scale=scale, thickness=1, outline=False)
        x += lw + round(18 * s)


def draw_results(canvas: np.ndarray, round_: RaceRound, scale: float = 1.0,
                 now: float | None = None) -> None:
    import time

    if now is None:
        now = time.monotonic()
    height, width = canvas.shape[:2]
    canvas[:] = _results_backdrop(width, height)
    cx = width // 2
    # Confetti goes down FIRST and never again: a fleck landing on top of the
    # word YOU is the difference between a celebration and a printing fault.
    if _position(round_) <= 3:
        _confetti(canvas, width, height, now)
    standings = _classification(round_)
    position = _position(round_)
    view = Rect(0, 0, width, height)

    _centre_text(canvas, "SUNSET SPEEDWAY", cx, int(height * 0.075), 0.7 * scale,
                 ACCENT, 2)
    _centre_text(canvas, "RACE COMPLETE", cx, int(height * 0.13), 1.1 * scale, INK, 3)
    medal = MEDALS[position - 1] if position <= 3 else INK
    _centre_text(canvas, f"{position}{_suffix(position)}", cx, int(height * 0.27),
                 2.6 * scale, medal, 7)
    if round_.started_at is not None and round_.player.finished_at is not None:
        total = round_.player.finished_at - round_.started_at
        clock = _clock(total)
        size = round(24 * scale)
        draw_figures(canvas, clock,
                     (cx - figures_width(clock, size) // 2, int(height * 0.32)),
                     (226, 230, 236), size)

    # The podium: 2nd, 1st, 3rd - each step in its own metal, lit from the
    # spotlights above and from the sunset still burning behind it.
    base_y = int(height * 0.74)
    block_w = int(width * 0.128)
    gap = int(block_w * 1.34)
    depth = max(5, int(height * 0.020))
    for slot, (dx, hf) in enumerate(((-gap, 0.135), (0, 0.195), (gap, 0.105))):
        rank = (2, 1, 3)[slot]
        if rank > len(standings):
            continue
        kart = standings[rank - 1]
        metal = MEDALS[rank - 1]
        bh = int(height * hf)
        x0, x1 = cx + dx - block_w // 2, cx + dx + block_w // 2
        top = base_y - bh
        # The front face, graded: warm sunset bounce along the top of the
        # block falling into shadow at the floor.
        face_h = max(2, base_y - top)
        ramp = np.linspace(1.0, 0.58, face_h, dtype=np.float32)[:, None, None]
        body = np.array([int(c * 0.56) + 40 for c in metal], np.float32)
        cv2.rectangle(canvas, (x0, top), (x1, base_y), (0, 0, 0), -1)
        canvas[top:base_y, x0:x1] = np.clip(
            body[None, None, :] * ramp, 0, 255).astype(np.uint8)
        # The lit top face.
        cap = np.array([(x0, top), (x1, top), (x1 - depth, top - depth),
                        (x0 + depth, top - depth)], np.int32)
        cv2.fillPoly(canvas, [cap],
                     tuple(int(c * 0.72) + 44 for c in metal), cv2.LINE_AA)
        cell = max(3, block_w // 12)
        for i, x in enumerate(range(x0, x1 - cell, cell)):
            if i % 2 == 0:
                cv2.rectangle(canvas, (x, top), (x + cell, top + cell),
                              (224, 228, 234), -1)
        # A hot rim light down the winner's edges, straight off the spotlight.
        rim = 3 if rank == 1 else 2
        cv2.polylines(canvas, [np.array(
            [(x0, base_y), (x0, top), (x0 + depth, top - depth),
             (x1 - depth, top - depth), (x1, top), (x1, base_y)], np.int32)],
            False, tuple(min(255, int(c * 0.55) + 118) for c in metal),
            rim, cv2.LINE_AA)
        _centre_text(canvas, str(rank), cx + dx,
                     base_y - bh // 2 + int(18 * scale), 1.4 * scale,
                     tuple(min(255, int(c * 0.6) + 96) for c in metal), 4)
        colour = _kart_colour(kart, kart is round_.player)
        # 1.5x the old sprite, and lit: the karts are the subject of this
        # screen, not a row of thumbnails balanced on three grey boxes.
        _kart_sprite(canvas, cx + dx, top - depth // 3, int(block_w * 0.98),
                     colour, 0.0, False, now, float(rank), view)
        name = "you" if kart is round_.player else kart.name
        _centre_text(canvas, name, cx + dx, base_y + int(26 * scale),
                     0.6 * scale,
                     (250, 250, 252) if kart is round_.player else (204, 204, 208),
                     2)

    # Full classification, left column, with each kart's livery chip. Both
    # side columns sit on their own dark plate: white text laid straight over
    # a ferris wheel is unreadable however bright it is.
    x_list = int(width * 0.075)
    y_list = int(height * 0.42)
    rows_h = round((len(standings) - 1) * 32 * scale)
    _panel(canvas, x_list - round(22 * scale), y_list - round(52 * scale),
           x_list + round(190 * scale), y_list + rows_h + round(18 * scale),
           round(10 * scale), alpha=0.70)
    laps_h = round(max(len(round_.lap_times) - 1, 0) * 32 * scale)
    _panel(canvas, int(width * 0.78) - round(22 * scale),
           y_list - round(52 * scale),
           int(width * 0.78) + round(196 * scale),
           y_list + laps_h + round(18 * scale), round(10 * scale), alpha=0.70)
    draw_text(canvas, "CLASSIFICATION", (x_list, y_list - round(30 * scale)),
              ACCENT, scale=0.55 * scale, thickness=2)
    for index, kart in enumerate(standings):
        you = kart is round_.player
        ry = y_list + round(index * 32 * scale)
        chip = _kart_colour(kart, you)
        cv2.rectangle(canvas, (x_list, ry - round(11 * scale)),
                      (x_list + round(12 * scale), ry + round(1 * scale)),
                      chip, -1)
        draw_text(canvas, f"{index + 1}.", (x_list + round(22 * scale), ry),
                  MEDALS[index] if index < 3 else (204, 204, 208),
                  scale=0.62 * scale, thickness=2)
        draw_text(canvas, "YOU" if you else kart.name,
                  (x_list + round(64 * scale), ry),
                  (255, 255, 255) if you else (204, 204, 208),
                  scale=0.62 * scale, thickness=2 + you)

    # Lap times, right column.
    x_laps = int(width * 0.78)
    draw_text(canvas, "YOUR LAPS", (x_laps, y_list - round(30 * scale)), ACCENT,
              scale=0.55 * scale, thickness=2)
    best = round_.best_lap()
    for index, lap in enumerate(round_.lap_times):
        is_best = best is not None and lap == best
        text = f"L{index + 1}  {_clock(lap)}" + ("  BEST" if is_best else "")
        draw_text(canvas, text, (x_laps, y_list + round(index * 32 * scale)),
                  GOOD if is_best else (204, 204, 208), scale=0.62 * scale,
                  thickness=2)

    _results_keys(canvas, scale, view)


# --- the chooser card --------------------------------------------------------

def draw_emblem(panel: np.ndarray) -> None:
    height, width = panel.shape[:2]
    horizon = int(height * 0.46)
    panel[:horizon] = _sky(width, horizon)
    panel[horizon:] = GRASS_B

    ground = max(height - horizon, 1)
    centres, halves = {}, {}
    prev_wall: dict[int, int] = {}
    for y in range(horizon + 1, height):
        p = (y - horizon) / ground
        half = width * (0.05 + 0.58 * p)
        bend = ((1.0 - p) ** 2) * width * 0.16
        centre = width * 0.5 - bend
        centres[y], halves[y] = centre, half
        z = NEAR_Z / p
        band = int(z / BAND)
        even = band % 2 == 0
        panel[y, :] = GRASS_A if even else GRASS_B
        lo, hi = int(centre - half), int(centre + half)
        apron = max(2, int(half * 0.36))
        cv2.line(panel, (max(lo - apron, 0), y), (min(hi + apron, width - 1), y),
                 APRON, 1)
        rumble = max(1, int(half * 0.10))
        cv2.line(panel, (max(lo - rumble, 0), y), (min(hi + rumble, width - 1), y),
                 RUMBLE_A if even else RUMBLE_B, 1)
        if hi > 0 and lo < width:
            cv2.line(panel, (max(lo, 0), y), (min(hi, width - 1), y),
                     ROAD_A if even else ROAD_B, 1)
            if even:
                dash = max(1, int(half * 0.02))
                cv2.line(panel, (int(centre) - dash, y), (int(centre) + dash, y),
                         LINE, 1)
        # Guard rails, one row-slice at a time: the card shows the same
        # striped walls the race does.
        bh = max(1, int(half * 0.165))
        for side in (-1, 1):
            bx_ = int(centre + side * half * 1.26)
            # Span from the previous row's x so the wall is a solid ribbon and
            # not a picket fence where perspective moves it more than a pixel.
            prev = prev_wall.get(side, bx_)
            prev_wall[side] = bx_
            lo_, hi_ = sorted((prev, bx_))
            lo_, hi_ = max(lo_, 0), min(hi_ + 1, width)
            if hi_ > lo_:
                cv2.rectangle(panel, (lo_, y - bh), (hi_, y),
                              BARRIER_A if even else BARRIER_B, -1)
                cv2.rectangle(panel, (lo_, max(y - bh - max(1, bh // 6), 0)),
                              (hi_, y - bh), BARRIER_TOP, -1)
        if 22.0 < z < 26.0:  # the start line, mid-distance
            cells = 7
            step = 2.0 * half / cells
            for k in range(cells):
                x0 = max(int(centre - half + k * step), 0)
                x1 = min(int(centre - half + (k + 1) * step), width)
                if x1 > x0:
                    panel[y, x0:x1] = (235, 240, 243) if (k + int(z / 2)) % 2 == 0 \
                        else (22, 22, 25)

    # Rubber laid through the bend, so even the card shows a corner. The
    # trails are TAPERED QUADS anchored where the rear wheels actually meet
    # the road and running AWAY up the circuit, wide and dark under the kart
    # and sharpening to nothing in the distance. Drawn as two 1px polylines
    # they diverged from under the kart to the bottom edge of the card and
    # read as spider legs, not as skid marks.
    kart_y = int(height * 0.88)
    kart_w = int(width * 0.34)
    stop = kart_y - int(height * 0.02)
    start = horizon + int(ground * 0.42)
    for wheel_x in (-kart_w * 0.52, kart_w * 0.52):
        near_x = int(width * 0.50 + wheel_x)
        far_y = max(start, horizon + 2)
        if stop - far_y < 8:
            continue
        near_w = max(4.0, width * 0.016)
        left: list[tuple[int, int]] = []
        right: list[tuple[int, int]] = []
        for y in range(far_y, stop + 1, 3):
            t = (y - far_y) / max(stop - far_y, 1)
            # Blend from the projected racing line in the distance onto the
            # kart's own contact patch at the near end, so the mark is under
            # the tyre that laid it.
            track_x = centres[y] + (wheel_x / kart_w) * 0.62 * halves[y]
            x = track_x + (near_x - track_x) * (t ** 1.7)
            hw = max(0.6, near_w * (0.10 + 0.90 * t ** 1.4))
            left.append((int(x - hw), y))
            right.append((int(x + hw), y))
        if len(left) > 2:
            cv2.fillPoly(panel, [np.array(left + right[::-1], np.int32)],
                         (38, 36, 46), cv2.LINE_AA)

    # The gantry over the start line, and a grandstand out on the infield.
    y_g = next((y for y in sorted(centres) if NEAR_Z / ((y - horizon) / ground) < 24.0),
               horizon + ground // 3)
    _gantry(panel, int(centres[y_g]), y_g, halves[y_g],
            Rect(0, 0, width, height))
    y_s = horizon + int(ground * 0.34)
    _grandstand(panel, int(width * 0.17), y_s, width * 0.15, 0, 0.8,
                centres[y_s] - halves[y_s])
    _apply_haze(panel, Rect(0, 0, width, height), horizon)

    # The player's kart, leaning into the bend.
    _kart_sprite(panel, int(width * 0.50), int(height * 0.88), int(width * 0.34),
                 PLAYER, 0.3, False, 0.8, 0.0, Rect(0, 0, width, height),
                 speed=0.8, roll=-5.5)
