"""Everything the player sees: range, targets, crosshair, HUD and buttons.

Drawn to the design language in ``docs/DESIGN.md``: the system face on a
fixed type scale, a monochrome interface with one tint, glass over the world,
and chrome pushed to the corners.
"""

from __future__ import annotations

import math
import os
import struct
from dataclasses import dataclass
from functools import lru_cache

import cv2
import numpy as np

from collections.abc import Sequence

from .aiming import Aim
from .game import Rect, Round, Summary
from .recognition import Frame
from .rendering import draw_hands, draw_text, text_width

# --- colour ------------------------------------------------------------------
#
# The design language's tokens, in OpenCV's BGR. Colour comes from the game
# worlds; the interface is monochrome plus one tint, and the tint means one
# thing: your gun is ready.

BACKGROUND = (0, 0, 0)
SURFACE = (30, 28, 28)  # #1C1C1E: cards, sheets
SURFACE_RAISED = (46, 44, 44)  # #2C2C2E: controls on a surface
GLASS = (30, 28, 28)  # the glass tint, laid over the blurred world
GLASS_OPACITY = 0.72
HAIRLINE = 0.10  # how much white the one-pixel edge of glass and cards adds
LABEL = (255, 255, 255)
# The translucent labels, flattened over the surface they sit on: OpenCV lays
# text opaque, and every panel they go on is the surface or darker glass.
LABEL_SECONDARY = (163, 156, 156)  # rgba(235, 235, 245, 0.62)
LABEL_TERTIARY = (99, 94, 94)  # rgba(235, 235, 245, 0.32)
TINT = (88, 209, 48)  # #30D158: ready, progress, success
DANGER = (58, 69, 255)  # #FF453A
WARNING = (10, 159, 255)  # #FF9F0A
GOLD = (10, 214, 255)  # #FFD60A: new best, perfect hits

# Colours are BGR.
BACKDROP = (28, 26, 24)
GRID = (40, 38, 36)
PANEL = (46, 43, 40)
PANEL_DEEP = (34, 32, 30)
EDGE = (74, 70, 66)
INK = (236, 236, 236)
MUTED = (150, 146, 142)
ACCENT = (96, 168, 236)  # warm amber: the thin chrome lines of every screen
ARMED = TINT
IDLE = (150, 150, 150)
MISS = (120, 120, 190)

RECOIL = 0.18

#: Corner radius of every panel, card and button, in 720-tall units.
CORNER = 10

#: What every floating piece of in-game chrome is made of - the clock's pill,
#: the score's panel, the setup console: a dark plate, lighter at the top,
#: translucent enough that the map is still there behind it and dark enough
#: that grey text reads on a noon sky.
CHROME_TOP = (40, 38, 36)
CHROME_BOTTOM = (24, 23, 22)
CHROME_OPACITY = 0.85


def _px(value: float, scale: float, floor: int = 1) -> int:
    return max(floor, round(value * scale))


# --- type --------------------------------------------------------------------
#
# The system face, on the design language's type scale. On a Mac that is SF
# Pro, read from the system at runtime - never copied into the repository -
# and set through OpenCV's FreeType renderer, which takes a variable font's
# axes: weight, and the optical size that makes small text SF Pro Text (looser,
# sturdier) and large text SF Pro Display (tighter). Elsewhere OpenCV's own
# sans stands in, and a build without FontFace falls back to the Hershey sans.
#
# OpenCV applies no OpenType features, so figures come out proportional - a
# "1" narrower than a "0" - and a score or clock that changes every frame would
# jitter. Tabular figures are made here instead: every digit is set centred in
# a cell as wide as the widest one.

SYSTEM_FONT = "/System/Library/Fonts/SFNS.ttf"
FALLBACK_FONT = "sans"


@dataclass(frozen=True)
class Style:
    """One step of the type scale: size in 720-tall units, weight 400-700."""

    size: float
    weight: int
    tracking: float = 0.0  # extra space between letters, in ems
    caps: bool = False


LARGE_TITLE = Style(44, 700)
TITLE_1 = Style(30, 700)
TITLE_2 = Style(24, 600)
TITLE_3 = Style(20, 600)
HEADLINE = Style(16, 600)
BODY = Style(16, 400)
SUBHEAD = Style(14, 400)
FOOTNOTE = Style(12, 400)
EYEBROW = Style(11, 600, tracking=0.06, caps=True)

#: How tall capitals stand, as a share of the size text is set at: what
#: centring a line in a box needs, since OpenCV places text by its baseline.
CAP_HEIGHT = 0.705
#: How far descenders and commas reach below the baseline, likewise.
DESCENT = 0.24

#: Below this many pixels text is set at SF Pro Text's optical size; at and
#: above it, Display's - where Apple switches between the two.
_TEXT_OPTICAL_BELOW = 20


def _axis(name: str) -> int:
    return struct.unpack(">i", name.encode())[0]


@lru_cache(maxsize=1)
def _font_source() -> str | None:
    """The face to set type in: SF Pro when the system has it, else OpenCV's
    own sans, or None on an OpenCV built without FreeType faces."""
    if not hasattr(cv2, "FontFace"):
        return None
    if os.path.exists(SYSTEM_FONT):
        try:
            cv2.FontFace(SYSTEM_FONT)
            return SYSTEM_FONT
        except cv2.error:
            pass
    return FALLBACK_FONT


@lru_cache(maxsize=8)
def _face(optical: int, weight: int):
    """One instance of the face, built once.

    Each costs the font file's worth of memory, so they are few: Display at
    every weight comes from one face (``putText``'s own weight argument picks
    the weight and resets the rest of the axes to Display's defaults), and
    only small text, at Text's optical size, needs an instance per weight.
    """
    face = cv2.FontFace(_font_source())
    if optical:
        # Every axis SF Pro has, named in full: an instance that names only
        # some of them is not applied. (getInstance reports its tags byte-
        # swapped, so they cannot simply be read back and edited.)
        face.setInstance([_axis("wdth"), 100 << 16, _axis("opsz"), optical << 16,
                          _axis("GRAD"), 400 << 16, _axis("wght"), weight << 16])
    return face


def _setting(size: int, weight: int) -> tuple[object, int]:
    """The face and the weight argument that set text ``size`` pixels tall."""
    if size < _TEXT_OPTICAL_BELOW and _font_source() == SYSTEM_FONT:
        return _face(17, weight), 0  # the instance carries the weight
    return _face(0, 0), weight


def type_size(style: Style, scale: float = 1.0) -> int:
    """The pixel size ``style`` is set at on a window of this ``scale``."""
    return max(6, round(style.size * scale))


def _hershey(size: int) -> tuple[float, int]:
    return size / 30.0, 1


@lru_cache(maxsize=2048)
def _advance(text: str, size: int, weight: int) -> int:
    """How far the pen moves setting ``text``: its width for layout."""
    if not text:
        return 0
    if _font_source() is None:
        font_scale, thickness = _hershey(size)
        return cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, font_scale,
                               2 if weight >= 600 else thickness)[0][0]
    face, argument = _setting(size, weight)
    return cv2.getTextSize((0, 0), text, (0, 0), face, size, argument)[2]


@lru_cache(maxsize=64)
def _digit_cell(size: int, weight: int) -> int:
    """The tabular figure's width: the widest digit's."""
    return max(_advance(digit, size, weight) for digit in "0123456789")


def _runs(text: str, tabular: bool) -> list[tuple[str, bool]]:
    """``text`` cut into runs set normally and single digits set tabular."""
    if not tabular:
        return [(text, False)]
    runs: list[tuple[str, bool]] = []
    plain = ""
    for char in text:
        if char.isdigit():
            if plain:
                runs.append((plain, False))
                plain = ""
            runs.append((char, True))
        else:
            plain += char
    if plain:
        runs.append((plain, False))
    return runs


def _cased(text: str, style: Style) -> str:
    return text.upper() if style.caps else text


@lru_cache(maxsize=4096)
def _measure(text: str, size: int, weight: int, tracking: float,
             tabular: bool) -> int:
    if tracking:
        spacing = round(tracking * size)
        return sum(_advance(char, size, weight) for char in text) + spacing * max(
            0, len(text) - 1)
    cell = _digit_cell(size, weight) if tabular else 0
    return sum(cell if digit else _advance(run, size, weight)
               for run, digit in _runs(text, tabular))


def measure(text: str, style: Style, scale: float = 1.0, tabular: bool = True) -> int:
    """How wide ``text`` is set in ``style``: exactly what :func:`write` fills.

    Measured at the size it is drawn at, never scaled from another - a face's
    widths do not scale exactly, and a box measured at the wrong size cut
    the last letter off a line.
    """
    return _measure(_cased(text, style), type_size(style, scale), style.weight,
                    style.tracking, tabular)


LEFT, CENTRE, RIGHT = "left", "centre", "right"


def write(canvas: np.ndarray, text: str, origin: tuple[float, float], style: Style,
          color: tuple[int, int, int], scale: float = 1.0, align: str = LEFT,
          tabular: bool = True) -> int:
    """Set ``text`` with its baseline at ``origin``; returns its width.

    ``align`` says which end (or the middle) of the line ``origin`` names.
    Figures are tabular unless told otherwise, so numbers that change hold
    their width.
    """
    text = _cased(text, style)
    if not text:
        return 0
    size = type_size(style, scale)
    width = _measure(text, size, style.weight, style.tracking, tabular)
    x = int(round(origin[0]))
    y = int(round(origin[1]))
    if align == CENTRE:
        x -= width // 2
    elif align == RIGHT:
        x -= width
    color = tuple(int(c) for c in color)
    if style.tracking:
        spacing = round(style.tracking * size)
        for char in text:
            _put(canvas, char, (x, y), color, size, style.weight)
            x += _advance(char, size, style.weight) + spacing
        return width
    cell = _digit_cell(size, style.weight) if tabular else 0
    for run, digit in _runs(text, tabular):
        if digit:
            inset = (cell - _advance(run, size, style.weight)) // 2
            _put(canvas, run, (x + inset, y), color, size, style.weight)
            x += cell
        else:
            _put(canvas, run, (x, y), color, size, style.weight)
            x += _advance(run, size, style.weight)
    return width


def _put(canvas: np.ndarray, text: str, origin: tuple[int, int],
         color: tuple[int, int, int], size: int, weight: int) -> None:
    if _font_source() is None:
        font_scale, thickness = _hershey(size)
        cv2.putText(canvas, text, origin, cv2.FONT_HERSHEY_SIMPLEX, font_scale, color,
                    2 if weight >= 600 else thickness, cv2.LINE_AA)
        return
    face, argument = _setting(size, weight)
    cv2.putText(canvas, text, origin, color, face, size, argument)


def write_faded(canvas: np.ndarray, text: str, origin: tuple[float, float],
                style: Style, color: tuple[int, int, int], scale: float = 1.0,
                alpha: float = 1.0, align: str = LEFT, tabular: bool = True) -> int:
    """:func:`write` at ``alpha``, blended over only the line's own box."""
    if alpha >= 1.0:
        return write(canvas, text, origin, style, color, scale, align, tabular)
    width = measure(text, style, scale, tabular)
    if alpha <= 0.0 or not text:
        return width
    size = type_size(style, scale)
    x = round(origin[0]) - (width // 2 if align == CENTRE else width if align == RIGHT
                            else 0)
    pad = max(2, size // 4)
    height, full = canvas.shape[:2]
    x0, y0 = max(x - pad, 0), max(round(origin[1]) - size - pad, 0)
    x1 = min(x + width + pad, full)
    y1 = min(round(origin[1]) + round(size * DESCENT) + pad, height)
    if x1 <= x0 or y1 <= y0:
        return width
    region = canvas[y0:y1, x0:x1]
    patch = region.copy()
    write(patch, text, (x - x0, round(origin[1]) - y0), style, color, scale, LEFT, tabular)
    cv2.addWeighted(patch, alpha, region, 1.0 - alpha, 0.0, dst=region)
    return width


def baseline_for(style: Style, top: float, height: float, scale: float = 1.0) -> int:
    """The baseline that centres a line of capitals in ``height`` from ``top``."""
    return round(top + (height + type_size(style, scale) * CAP_HEIGHT) / 2)


def wrap(text: str, style: Style, width: int, scale: float = 1.0) -> list[str]:
    """Greedy word wrap, measured in the style it will be set in."""
    lines: list[str] = []
    line = ""
    for word in text.split():
        candidate = f"{line} {word}".strip()
        if line and measure(candidate, style, scale) > width:
            lines.append(line)
            line = word
        else:
            line = candidate
    if line:
        lines.append(line)
    return lines


def fit(text: str, style: Style, width: int, scale: float = 1.0) -> str:
    """``text``, or as many of its words as fit followed by an ellipsis."""
    if measure(text, style, scale) <= width:
        return text
    words = text.split()
    while words:
        words.pop()
        candidate = " ".join(words) + "…"
        if words and measure(candidate, style, scale) <= width:
            return candidate
    return "…"


_SMALL_WORDS = frozenset({"a", "an", "and", "at", "by", "for", "in", "of", "on", "or",
                          "the", "to"})


def title_case(text: str) -> str:
    """Title Case for a name kept in capitals ("DEAD OF NIGHT", "PANE FAILED").

    Maps and rounds keep their names and outcomes as data; this is how they
    read on screen: "Dead of Night", "Pane Failed".
    """
    words = text.split()
    out = []
    for index, word in enumerate(words):
        lower = word.lower()
        if 0 < index < len(words) - 1 and lower in _SMALL_WORDS:
            out.append(lower)
        else:
            out.append("-".join(part[:1].upper() + part[1:] for part in lower.split("-")))
    return " ".join(out)


def grouped(number: int) -> str:
    """A score as the design language writes it: thousands grouped, 1,240."""
    return f"{number:,}"


def clock_text(seconds: float) -> str:
    """Seconds as a clock reads them: 0:48, 1:05."""
    whole = max(0, int(seconds))
    return f"{whole // 60}:{whole % 60:02d}"


# --- materials ---------------------------------------------------------------
#
# Glass is what every panel over the game world is made of: the world behind
# it blurred at a quarter of its resolution, tinted towards the surface, and
# edged with a one-pixel hairline. The blur is the whole trick - text on it
# reads over the brightest sky and the darkest road, because what shows
# through is only colour, never detail - and at a quarter resolution it costs
# a few hundredths of a millisecond for a panel.

#: How soft the world behind glass is, in 720-tall units of blur.
GLASS_BLUR = 18

#: The brightest glass may get, on a 0-255 scale: over a noon sky the tint
#: alone leaves the glass pale enough to wash out secondary text, so bright
#: glass is brought down to this - keeping its hue - the way a vibrant
#: material holds its contrast.
GLASS_CEILING = 84.0


def _outline(x: float, y: float, width: float, height: float, radius: float,
             inset: float = 0.0) -> np.ndarray:
    """A rounded rectangle's outline in sixteenths of a pixel, for OpenCV's
    sub-pixel drawing: corners that are true arcs, not stair-steps.

    The edge runs along pixel boundaries - ``x`` to ``x + width`` - and
    ``inset`` brings it in, so a one-pixel line can sit wholly inside.
    """
    shape = _outline_at_origin(width, height, radius, inset)
    return shape + np.array([round(x * _ONE), round(y * _ONE)], np.int32)


@lru_cache(maxsize=128)
def _outline_at_origin(width: float, height: float, radius: float,
                       inset: float) -> np.ndarray:
    x0, y0 = inset - 0.5, inset - 0.5
    x1, y1 = width - inset - 0.5, height - inset - 0.5
    r = max(0.0, min(radius - inset, (x1 - x0) / 2, (y1 - y0) / 2))
    points = []
    for cx, cy, start in ((x1 - r, y0 + r, -90), (x1 - r, y1 - r, 0),
                          (x0 + r, y1 - r, 90), (x0 + r, y0 + r, 180)):
        steps = max(2, int(r / 2) + 2)
        for k in range(steps + 1):
            angle = math.radians(start + 90 * k / steps)
            points.append((cx + r * math.cos(angle), cy + r * math.sin(angle)))
    shape = np.round(np.array(points) * _ONE).astype(np.int32)
    shape.flags.writeable = False
    return shape


@lru_cache(maxsize=64)
def _shape_weights(width: int, height: int, radius: int
                   ) -> tuple[np.ndarray, np.ndarray]:
    """A rounded rectangle as blend weights - how much of the world shows
    through, how much of the panel covers it - anti-aliased at the edge and
    built once per size."""
    mask = np.zeros((height, width), np.uint8)
    cv2.fillPoly(mask, [_outline(0, 0, width, height, radius)], 255, cv2.LINE_AA, _SHIFT)
    cover = mask.astype(np.float32) / 255.0
    keep = 1.0 - cover
    for array in (keep, cover):
        array.flags.writeable = False  # shared by every frame from here on
    return keep, cover


def _composite(canvas: np.ndarray, rect: Rect, layer: np.ndarray, radius: int) -> None:
    """Lay ``layer`` (the size of ``rect``, clipped as ``rect`` is) into
    ``rect`` on ``canvas`` with rounded, anti-aliased corners."""
    height, width = canvas.shape[:2]
    x0, y0 = max(rect.x, 0), max(rect.y, 0)
    x1, y1 = min(rect.right, width), min(rect.bottom, height)
    if x1 <= x0 or y1 <= y0:
        return
    keep, cover = _shape_weights(rect.width, rect.height, radius)
    # Only the four corners are blended: everywhere else the panel covers
    # the world outright, and a straight copy costs a fraction of a blend.
    reach = min(radius + 1, rect.width // 2, rect.height // 2)
    corners = []
    for cx0, cy0 in ((0, 0), (rect.width - reach, 0), (0, rect.height - reach),
                     (rect.width - reach, rect.height - reach)):
        ax0, ay0 = max(cx0, x0 - rect.x), max(cy0, y0 - rect.y)
        ax1, ay1 = min(cx0 + reach, x1 - rect.x), min(cy0 + reach, y1 - rect.y)
        if ax1 <= ax0 or ay1 <= ay0:
            continue
        world = canvas[rect.y + ay0:rect.y + ay1, rect.x + ax0:rect.x + ax1]
        mine = layer[ay0 - (y0 - rect.y):ay1 - (y0 - rect.y),
                     ax0 - (x0 - rect.x):ax1 - (x0 - rect.x)]
        corners.append((world, cv2.blendLinear(world, mine, keep[ay0:ay1, ax0:ax1],
                                               cover[ay0:ay1, ax0:ax1])))
    canvas[y0:y1, x0:x1] = layer
    for world, blended in corners:
        world[:] = blended


def hairline(canvas: np.ndarray, rect: Rect, radius: int,
             color: tuple[int, int, int], weight: int = 1) -> None:
    """The one-pixel edge of glass or a card, laid just inside its shape."""
    cv2.polylines(canvas, [_outline(rect.x, rect.y, rect.width, rect.height, radius,
                                    weight / 2)], True, color, weight, cv2.LINE_AA, _SHIFT)


def _frosted(region: np.ndarray, scale: float, opacity: float,
             tint: tuple[int, int, int]) -> np.ndarray:
    """The glass for ``region``: blurred at a quarter size, saturated a little
    - as the web's ``saturate(180%)`` does - tinted, and held under
    :data:`GLASS_CEILING`.

    Box-averaged down by four and blurred with two box passes, which together
    come close to a Gaussian: OpenCV's own Gaussian costs several times as
    much on an image this small, all of it overhead. The colour work is done
    on the quarter-size image, where it costs next to nothing.
    """
    height, width = region.shape[:2]
    small = _reduced(region, max(1, width // 4), max(1, height // 4))
    if small is None:
        small = cv2.resize(region, (max(1, width // 4), max(1, height // 4)),
                           interpolation=cv2.INTER_LINEAR)
    box = max(3, int(GLASS_BLUR * scale / 4) | 1)
    for _ in range(2):
        small = cv2.blur(small, (box, box), borderType=cv2.BORDER_REPLICATE)
    colour = small.astype(np.float32)
    grey = colour.mean(axis=2, keepdims=True)
    colour = grey + (colour - grey) * 1.8
    colour = colour * (1.0 - opacity) + np.float32(tint) * opacity
    brightest = np.maximum(colour.max(axis=2, keepdims=True), 1.0)
    colour *= np.minimum(1.0, GLASS_CEILING / brightest)
    return cv2.resize(np.clip(colour, 0, 255).astype(np.uint8), (width, height),
                      interpolation=cv2.INTER_LINEAR)


def hairline_over(color) -> tuple[int, int, int]:
    """The hairline on something this colour: ten per cent of the way to white."""
    return tuple(int(c + (255 - c) * HAIRLINE) for c in color)


def draw_glass(canvas: np.ndarray, rect: Rect, radius: int, scale: float = 1.0,
               opacity: float = GLASS_OPACITY, tint: tuple[int, int, int] = GLASS,
               edge: bool = True) -> None:
    """A glass panel over whatever is on ``canvas`` inside ``rect``."""
    height, width = canvas.shape[:2]
    x0, y0 = max(rect.x, 0), max(rect.y, 0)
    x1, y1 = min(rect.right, width), min(rect.bottom, height)
    if x1 - x0 < 2 or y1 - y0 < 2:
        return
    glass = _frosted(canvas[y0:y1, x0:x1], scale, opacity, tint)
    _composite(canvas, rect, glass, radius)
    if edge:
        sample = glass[glass.shape[0] // 2, min(2, glass.shape[1] - 1)]
        hairline(canvas, rect, radius, hairline_over(sample))


def draw_surface(canvas: np.ndarray, rect: Rect, radius: int,
                 color: tuple[int, int, int] = SURFACE, edge: bool = True) -> None:
    """An opaque rounded plate - a card, a control on a card - with its hairline."""
    height, width = canvas.shape[:2]
    x0, y0 = max(rect.x, 0), max(rect.y, 0)
    x1, y1 = min(rect.right, width), min(rect.bottom, height)
    if x1 <= x0 or y1 <= y0:
        return
    plate = np.empty((y1 - y0, x1 - x0, 3), np.uint8)
    plate[:] = color
    _composite(canvas, rect, plate, radius)
    if edge:
        hairline(canvas, rect, radius, hairline_over(color))


def dim(canvas: np.ndarray, amount: float) -> None:
    """Darken the whole frame, as the world is under a sheet."""
    if amount > 0.0:
        cv2.convertScaleAbs(canvas, dst=canvas, alpha=1.0 - amount, beta=0)


def ease_out(t: float) -> float:
    """The arriving curve for sheets and cards: quick, then settling."""
    t = min(max(t, 0.0), 1.0)
    return 1.0 - (1.0 - t) ** 3


# --- icons -------------------------------------------------------------------
#
# Line icons in the manner of SF Symbols: drawn on a 24-unit grid with 1.75
# unit strokes, round caps and joins; filled only for the active state.
# Coordinates go to OpenCV with four bits of sub-pixel precision, so a small
# icon keeps its geometry instead of snapping to whole pixels.

_SHIFT = 4
_ONE = 1 << _SHIFT


def _icon_point(centre: tuple[float, float], size: float, x: float, y: float
                ) -> tuple[int, int]:
    unit = size / 24.0
    return (int(round((centre[0] + (x - 12) * unit) * _ONE)),
            int(round((centre[1] + (y - 12) * unit) * _ONE)))


def draw_icon(canvas: np.ndarray, name: str, centre: tuple[float, float], size: float,
              color: tuple[int, int, int]) -> None:
    """Draw icon ``name`` ``size`` pixels square, centred on ``centre``."""
    unit = size / 24.0
    weight = max(1, round(1.75 * unit))

    def point(x: float, y: float) -> tuple[int, int]:
        return _icon_point(centre, size, x, y)

    def line(*points: tuple[float, float]) -> None:
        cv2.polylines(canvas, [np.array([point(*p) for p in points], np.int32)], False,
                      color, weight, cv2.LINE_AA, _SHIFT)

    def fill(*points: tuple[float, float]) -> None:
        cv2.fillPoly(canvas, [np.array([point(*p) for p in points], np.int32)], color,
                     cv2.LINE_AA, _SHIFT)

    if name == "pause":
        for x in (8.5, 15.5):
            fill((x - 2, 5.5), (x + 2, 5.5), (x + 2, 18.5), (x - 2, 18.5))
    elif name == "play":
        fill((7.5, 4.5), (19.5, 12), (7.5, 19.5))
    elif name == "xmark":
        line((6, 6), (18, 18))
        line((18, 6), (6, 18))
    elif name == "checkmark":
        line((5, 12.5), (10, 17.5), (19, 6.5))
    elif name == "restart":
        # Most of a circle, running round to an arrowhead at the top left.
        arc = [(12 + 7.5 * math.cos(math.radians(a)), 12.5 + 7.5 * math.sin(math.radians(a)))
               for a in range(-50, 226, 12)]
        line(*arc)
        (x0, y0), (x1, y1) = arc[-2], arc[-1]
        length = math.hypot(x1 - x0, y1 - y0)
        dx, dy = (x1 - x0) / length, (y1 - y0) / length
        barbs = []
        for turn in (0.7, -0.7):
            cos, sin = math.cos(turn), math.sin(turn)
            barbs.append((x1 - 4.5 * (dx * cos - dy * sin), y1 - 4.5 * (dx * sin + dy * cos)))
        line(barbs[0], (x1, y1), barbs[1])
    elif name == "grid":
        for x, y in ((4.5, 4.5), (13.5, 4.5), (4.5, 13.5), (13.5, 13.5)):
            line((x, y), (x + 6, y), (x + 6, y + 6), (x, y + 6), (x, y))
    elif name == "share":
        line((8, 9.5), (5.5, 9.5), (5.5, 20), (18.5, 20), (18.5, 9.5), (16, 9.5))
        line((12, 3.5), (12, 14.5))
        line((8.5, 7), (12, 3.5), (15.5, 7))
    elif name == "camera":
        line((3, 7.5), (15, 7.5), (15, 17.5), (3, 17.5), (3, 7.5))
        line((15, 11), (21, 7.5), (21, 17.5), (15, 14))
    elif name == "hand":
        # A raised open hand: four fingers, a thumb, the palm under them.
        for x, top in ((7.5, 7), (10.5, 4.5), (13.5, 5), (16.5, 7.5)):
            line((x, 13), (x, top))
        line((7.5, 13), (7.5, 16), (9.5, 20), (15.5, 20), (17.5, 16.5), (16.5, 11))
        line((7.5, 14.5), (5, 11.5))
    else:
        raise ValueError(f"no icon called {name!r}")


def _rounded(x0: int, y0: int, x1: int, y1: int, radius: int) -> np.ndarray:
    """Polygon for a rounded rectangle, for fillPoly and polylines alike."""
    r = max(0, min(radius, (x1 - x0) // 2, (y1 - y0) // 2))
    if r == 0:
        return np.array([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], np.int32)
    corners = ((x1 - r, y0 + r, 270), (x1 - r, y1 - r, 0),
               (x0 + r, y1 - r, 90), (x0 + r, y0 + r, 180))
    points = [cv2.ellipse2Poly((cx, cy), (r, r), 0, start, start + 90, 10)
              for cx, cy, start in corners]
    return np.concatenate(points).astype(np.int32)


def stroke_rounded(canvas: np.ndarray, rect: Rect, color: tuple[int, int, int],
                   radius: int, weight: int = 1) -> None:
    cv2.polylines(canvas, [_rounded(rect.x, rect.y, rect.right, rect.bottom, radius)],
                  True, color, weight, cv2.LINE_AA)


@lru_cache(maxsize=32)
def _gradient(width: int, height: int, top: tuple[int, int, int],
              bottom: tuple[int, int, int]) -> np.ndarray:
    ramp = np.linspace(0.0, 1.0, height, dtype=np.float32)[:, None, None]
    patch = (np.array(top, np.float32) * (1 - ramp)
             + np.array(bottom, np.float32) * ramp).astype(np.uint8)
    return np.ascontiguousarray(np.repeat(patch, width, axis=1))


def _shade_poly(canvas: np.ndarray, poly: np.ndarray, top: tuple[int, int, int],
                bottom: tuple[int, int, int]) -> None:
    """Fill a polygon with a vertical gradient.

    The edge is a hard mask rather than an anti-aliased blend: every caller
    strokes a hairline over it anyway, and the blend costs milliseconds per
    card at full-screen size.
    """
    height, width = canvas.shape[:2]
    x0, y0 = max(int(poly[:, 0].min()), 0), max(int(poly[:, 1].min()), 0)
    x1, y1 = min(int(poly[:, 0].max()) + 1, width), min(int(poly[:, 1].max()) + 1, height)
    if x1 <= x0 or y1 <= y0:
        return
    mask = np.zeros((y1 - y0, x1 - x0), np.uint8)
    cv2.fillPoly(mask, [poly - np.array([x0, y0], np.int32)], 255)
    region = canvas[y0:y1, x0:x1]
    cv2.copyTo(_gradient(x1 - x0, y1 - y0, top, bottom), mask, region)


def shade_panel(canvas: np.ndarray, rect: Rect, radius: int,
                top: tuple[int, int, int] = PANEL,
                bottom: tuple[int, int, int] = PANEL_DEEP,
                edge: tuple[int, int, int] | None = EDGE, weight: int = 1) -> None:
    """A softly shaded rounded panel: lighter at the top, a hairline around it."""
    _shade_poly(canvas, _rounded(rect.x, rect.y, rect.right, rect.bottom, radius),
                top, bottom)
    if edge is not None:
        stroke_rounded(canvas, rect, edge, radius, weight)


def accent_rule(canvas: np.ndarray, y: int, x0: int, x1: int,
                color: tuple[int, int, int] = ACCENT, weight: int = 1,
                gap: int = 0) -> None:
    """A thin horizontal rule, optionally with a gap left in the middle for text."""
    if gap and x1 - x0 > gap:
        mid = (x0 + x1) // 2
        cv2.line(canvas, (x0, y), (mid - gap // 2, y), color, weight, cv2.LINE_AA)
        cv2.line(canvas, (mid + gap // 2, y), (x1, y), color, weight, cv2.LINE_AA)
    else:
        cv2.line(canvas, (x0, y), (x1, y), color, weight, cv2.LINE_AA)


def glow_stroke(canvas: np.ndarray, rect: Rect, color: tuple[int, int, int],
                radius: int, weight: int) -> None:
    """A bright outline with a soft halo behind it, for the thing you aim at."""
    pad = weight * 2
    x0, y0 = max(rect.x - pad, 0), max(rect.y - pad, 0)
    x1, y1 = min(rect.right + pad + 1, canvas.shape[1]), min(rect.bottom + pad + 1,
                                                             canvas.shape[0])
    region = canvas[y0:y1, x0:x1]
    halo = region.copy()
    cv2.polylines(halo, [_rounded(rect.x - x0, rect.y - y0, rect.right - x0,
                                  rect.bottom - y0, radius)], True, color, weight * 2,
                  cv2.LINE_AA)
    cv2.addWeighted(halo, 0.16, region, 0.84, 0.0, dst=region)
    # The bright line sits a pixel inside the card, so its anti-aliasing stays
    # on the card and not in the gutter beside it.
    stroke_rounded(canvas, Rect(rect.x + 1, rect.y + 1, rect.width - 2, rect.height - 2),
                   color, radius, weight)


@dataclass(frozen=True)
class Button:
    """A clickable, and shootable, rectangle: a label, an icon, and which of
    the button styles it is drawn in (see :func:`draw_button`)."""

    rect: Rect
    label: str
    icon: str = ""
    kind: str = "glass"

    def contains(self, x: float, y: float) -> bool:
        return self.rect.contains(x, y)


def blend(canvas: np.ndarray, overlay: np.ndarray, alpha: float) -> None:
    """Composite ``overlay`` onto ``canvas`` in place."""
    if alpha >= 1.0:
        canvas[:] = overlay
    elif alpha > 0.0:
        cv2.addWeighted(overlay, alpha, canvas, 1.0 - alpha, 0.0, dst=canvas)


@lru_cache(maxsize=6)
def _vignette(width: int, height: int, floor: float = 0.55) -> np.ndarray:
    """Radial falloff, 1 at the centre and ``floor`` in the corners."""
    ys = (np.arange(height, dtype=np.float32) - height / 2) / (height / 2)
    xs = (np.arange(width, dtype=np.float32) - width / 2) / (width / 2)
    d = np.sqrt(xs[None, :] ** 2 + (ys[:, None] * 0.85) ** 2) / 1.35
    return (1.0 - (1.0 - floor) * np.clip(d, 0, 1) ** 2)[:, :, None]


def draw_backdrop(canvas: np.ndarray) -> None:
    """The window behind every menu: black, the way the design language has it.
    The cards and the sheets bring the light."""
    canvas[:] = BACKGROUND


# --- the ambient backdrop: the map in play, dimmed, behind the card ---------
#
# The results card used to sit on the bare grid, which made it look like any
# tool's dialog. Given the map's own card art it sits in the world the round
# was played in instead: the art is blown up, blurred, dimmed and vignetted
# until it is a mood rather than a picture. The app sets the art when a map is
# picked and clears it on the way out, so the chooser - which belongs to no map
# - keeps the plain black.

_ambient_art = None  # the emblem callable of the map in play, or None


def set_ambient_art(emblem) -> None:
    """Tell the menus which map is in play, so its art can sit behind them.

    ``None`` puts the plain black back. Called by :mod:`handy.app`; a module
    global because the drawing functions are deliberately stateless otherwise
    and take no map argument.
    """
    global _ambient_art
    _ambient_art = emblem


@lru_cache(maxsize=8)  # one per map, and slack for a window that was resized
def _ambient_image(emblem, width: int, height: int) -> np.ndarray:
    small_w = max(64, width // 6)
    small_h = max(36, height // 6)
    panel = _clean_frame(emblem, small_w, small_h)
    panel = cv2.GaussianBlur(panel, (0, 0), max(1.0, small_w * 0.006))
    image = cv2.resize(panel, (width, height), interpolation=cv2.INTER_CUBIC)
    image = cv2.GaussianBlur(image, (0, 0), max(2.0, width * 0.004))
    # Dimmed most of the way to black, keeping a little of the art's colour.
    dimmed = image.astype(np.float32) * 0.34 * _vignette(width, height, 0.3)
    return np.clip(dimmed, 0, 255).astype(np.uint8)


def ambient_backdrop_for(emblem, width: int, height: int) -> np.ndarray:
    """One map's dimmed art at this size, built once and kept.

    Public so the warm-up thread can pay for the build at launch: it takes a
    tenth of a second, and the moment it is wanted is the moment a round ends.
    """
    return _ambient_image(emblem, width, height)


def draw_ambient_backdrop(canvas: np.ndarray) -> None:
    """The map in play as a dim, blurred backdrop; plain black if none is."""
    if _ambient_art is None:
        draw_backdrop(canvas)
        return
    height, width = canvas.shape[:2]
    canvas[:] = ambient_backdrop_for(_ambient_art, width, height)


# --- figures -----------------------------------------------------------------
#
# OpenCV 5 renders its Hershey ids with a bundled face whose zero is slashed,
# which reads as a monospace code font next to the sans everywhere else. The
# big numbers - score, clock - are set in its plain sans instead, emboldened
# by a dilation since that face carries no weight axis of its own.

_FIGURES_FACE = cv2.FontFace("uni") if hasattr(cv2, "FontFace") else None


def figures_width(text: str, size: int) -> int:
    """Width in pixels of ``text`` set as figures at ``size`` pixels tall."""
    if _FIGURES_FACE is None:
        return cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, size / 30, 2)[0][0]
    return cv2.getTextSize((0, 0), text, (0, 0), _FIGURES_FACE, size)[2]


def draw_figures(canvas: np.ndarray, text: str, origin: tuple[int, int],
                 color: tuple[int, int, int], size: int, bold: float = 0.04) -> None:
    """Draw a number at ``origin`` (baseline left), ``size`` pixels tall."""
    if _FIGURES_FACE is None:
        cv2.putText(canvas, text, origin, cv2.FONT_HERSHEY_SIMPLEX, size / 30, color,
                    max(1, round(size * bold)), cv2.LINE_AA)
        return
    x, y = origin
    # The box is measured at the size the text is actually set at - twice this
    # one - and halved: a face's width does not quite scale, and a long line
    # measured at the smaller size came out a few pixels short, which cut the
    # last letter off.
    width = -(-figures_width(text, size * 2) // 2)
    pad = max(2, int(size * bold) + 2)
    x0, y0 = max(0, x - pad), max(0, y - size - pad)
    x1 = min(canvas.shape[1], x + width + pad)
    y1 = min(canvas.shape[0], y + int(size * 0.3) + pad)
    if x1 <= x0 or y1 <= y0:
        return
    # Set at twice the size and brought down again: the emboldening dilation
    # would otherwise leave the edges lumpy.
    mask = np.zeros(((y1 - y0) * 2, (x1 - x0) * 2), np.uint8)
    cv2.putText(mask, text, ((x - x0) * 2, (y - y0) * 2), 255, _FIGURES_FACE, size * 2)
    grow = int(size * bold * 2)
    if grow > 0:
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (grow * 2 + 1, grow * 2 + 1))
        mask = cv2.dilate(mask, kernel)
    mask = cv2.resize(mask, (x1 - x0, y1 - y0), interpolation=cv2.INTER_AREA)
    region = canvas[y0:y1, x0:x1]
    alpha = mask.astype(np.float32)[:, :, None] / 255.0
    tint = np.array(color, np.float32)
    region[:] = (region * (1 - alpha) + tint * alpha).astype(np.uint8)


#: A caption set in the figures face at ``scale`` matches the height of body
#: text set with draw_text at the same scale.
CAPTION_SIZE = 30


def caption_width(text: str, scale: float) -> int:
    """Width of ``text`` set by :func:`draw_caption` at ``scale``."""
    return figures_width(text, max(8, round(CAPTION_SIZE * scale)))


def draw_caption(canvas: np.ndarray, text: str, origin: tuple[int, int],
                 color: tuple[int, int, int], scale: float) -> None:
    """A short line with numbers in it - a tally, a best - in the figures face.

    The body face's digits are a monospace code font with a slashed zero, and
    "0/14 hits" or "best 900" set in it read as a terminal's output beside the
    score set in the figures face above them.
    """
    draw_figures(canvas, text, origin, color, max(8, round(CAPTION_SIZE * scale)), 0.0)


def _centred_text(canvas: np.ndarray, text: str, y: int,
                  color: tuple[int, int, int], scale: float) -> None:
    width = text_width(text, scale)
    draw_text(canvas, text, ((canvas.shape[1] - width) // 2, y), color, scale=scale)


# --- the wordmark ------------------------------------------------------------
#
# One mark on every menu, in the same corner: the finger-pistol glyph and the
# name, set in the system face, in a quiet white. No rule under it, no colour
# in it - the game's worlds bring the colour.

#: The screen's margins in 720-tall units, and the wider ones of a large
#: window (``LARGE_WINDOW`` pixels tall and up).
MARGIN, LARGE_MARGIN, LARGE_WINDOW = 24, 32, 1200


def screen_margin(height: int, scale: float = 1.0) -> int:
    """The margin every screen keeps to, in pixels."""
    return _px(LARGE_MARGIN if height >= LARGE_WINDOW else MARGIN, scale)


def footer_baseline(height: int, scale: float = 1.0) -> int:
    """The baseline the menus' hints and the wordmark share at the foot."""
    return height - screen_margin(height, scale) - _px(12, scale)


WORDMARK = "Handy"


@lru_cache(maxsize=8)
def _logo_glyph(size: int) -> np.ndarray:
    """The finger-pistol glyph, ``size`` pixels tall, as coverage: drawn at
    four times the size and brought down, so the small silhouette keeps
    clean edges."""
    big = size * 4
    w, h = int(big * 1.6), big
    u = big * 0.36
    cx, cy = int(w * 0.66), int(h * 0.56)
    mask = np.zeros((h, w), np.uint8)
    cv2.circle(mask, (cx, cy), int(u * 0.56), 255, -1, cv2.LINE_AA)
    for k in (-0.36, -0.06, 0.24):
        cv2.circle(mask, (cx + int(u * k), cy - int(u * 0.48)), int(u * 0.2), 255, -1,
                   cv2.LINE_AA)
    cv2.line(mask, (cx - int(u * 0.3), cy - int(u * 0.1)), (cx - int(u * 1.6), cy - int(u * 0.1)),
             255, max(2, int(u * 0.38)), cv2.LINE_AA)
    cv2.line(mask, (cx + int(u * 0.1), cy - int(u * 0.3)), (cx + int(u * 0.22), cy - int(u * 1.15)),
             255, max(2, int(u * 0.38)), cv2.LINE_AA)
    cv2.line(mask, (cx + int(u * 0.3), cy + int(u * 0.2)), (w + 4, cy + int(u * 0.4)),
             255, max(2, int(u * 0.6)), cv2.LINE_AA)
    return cv2.resize(mask, (size * 160 // 100, size), interpolation=cv2.INTER_AREA)


def logo_size(scale: float) -> tuple[int, int]:
    """Width and height of the wordmark, for anything laying out around it."""
    glyph = _px(16, scale)
    return (glyph * 160 // 100 + _px(8, scale) + measure(WORDMARK, TITLE_3, scale),
            _px(22, scale))


def draw_logo(canvas: np.ndarray, scale: float = 1.0, alpha: float = 1.0,
              color: tuple[int, int, int] = LABEL_SECONDARY,
              corner: tuple[int, int] | None = None) -> None:
    """The wordmark, by default bottom right on the footer's baseline;
    ``corner`` puts its bottom-right corner somewhere else."""
    if alpha <= 0.0:
        return
    height, width = canvas.shape[:2]
    margin = screen_margin(height, scale)
    logo_w, logo_h = logo_size(scale)
    if corner is None:
        baseline = footer_baseline(height, scale)
        right = width - margin
    else:
        right, baseline = corner
    x = right - logo_w
    glyph = _logo_glyph(_px(16, scale))
    gy = baseline - glyph.shape[0] + _px(1, scale)
    x0, y0 = max(x, 0), max(gy, 0)
    x1, y1 = min(x + glyph.shape[1], width), min(gy + glyph.shape[0], height)
    if x1 > x0 and y1 > y0:
        region = canvas[y0:y1, x0:x1]
        cover = glyph[y0 - gy:y1 - gy, x0 - x:x1 - x].astype(np.float32) * np.float32(
            alpha / 255.0)
        ink = np.empty_like(region)
        ink[:] = color
        cv2.blendLinear(region, ink, 1.0 - cover, cover, dst=region)
    write_faded(canvas, WORDMARK, (x + glyph.shape[1] + _px(8, scale), baseline), TITLE_3,
                color, scale, alpha)


#: The crosshair at rest: white, a little quieter than a label, so the green of
#: a cocked gun is the change the eye catches.
IDLE_CROSSHAIR = (214, 214, 214)


def _crosshair_strokes(canvas: np.ndarray, center: tuple[int, int], color, scale: float,
                       grow: int = 0) -> None:
    """The mark itself: a ring broken at the four compass points, hairline
    ticks reaching out of the gaps, and a dot in the middle - open enough to
    see the target through. ``grow`` fattens every stroke, for its shadow."""
    weight = _px(2, scale) + grow
    thin = _px(1, scale) + grow
    radius = round(20 * scale)
    for start in (10, 100, 190, 280):
        cv2.ellipse(canvas, center, (radius, radius), 0, start, start + 70, color,
                    weight, cv2.LINE_AA)
    cv2.circle(canvas, center, max(1, round(2 * scale)) + grow // 2, color, -1,
               cv2.LINE_AA)
    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        inner = (center[0] + round(dx * 9 * scale), center[1] + round(dy * 9 * scale))
        outer = (center[0] + round(dx * 30 * scale), center[1] + round(dy * 30 * scale))
        cv2.line(canvas, inner, outer, color, thin, cv2.LINE_AA)
        tip = (center[0] + round(dx * 25 * scale), center[1] + round(dy * 25 * scale))
        cv2.line(canvas, tip, outer, color, weight, cv2.LINE_AA)


def draw_crosshair(canvas: np.ndarray, x: float, y: float, armed: bool,
                   since_shot: float | None, scale: float = 1.0,
                   pull: float = 0.0, fire_at: float = 0.65) -> None:
    """The gun's mark: green when it is cocked, white when it is not.

    Laid over a faint dark shadow of itself, so a white mark still reads
    against a noon sky: both come from a sprite built once per colour and
    size, composited within the mark's own patch, never the frame.
    """
    center = (int(x), int(y))
    weight = _px(2, scale)
    radius = round(20 * scale)
    height, width = canvas.shape[:2]
    flashing = since_shot is not None and since_shot < RECOIL
    reach = round((56 if flashing else 32) * scale) + 4
    x0, y0 = max(center[0] - reach, 0), max(center[1] - reach, 0)
    x1, y1 = min(center[0] + reach + 1, width), min(center[1] + reach + 1, height)
    if x1 <= x0 or y1 <= y0:
        return
    region = canvas[y0:y1, x0:x1]
    local = (center[0] - x0, center[1] - y0)

    # How far the trigger has come, drawn as an arc filling the ring. Without it
    # a trigger that never quite reaches its threshold is indistinguishable from
    # one that is not reading anything at all.
    if fire_at > 0 and pull > 0.03:
        fraction = min(pull / fire_at, 1.0)
        cv2.ellipse(region, local, (radius + weight + 2, radius + weight + 2),
                    -90.0, 0.0, 360.0 * fraction,
                    TINT if fraction >= 1.0 else LABEL, weight, cv2.LINE_AA)

    colour, keep, cover = _crosshair_sprite(armed, round(scale, 4))
    half = colour.shape[0] // 2
    sx0, sy0 = center[0] - half, center[1] - half
    cx0, cy0 = max(sx0, 0), max(sy0, 0)
    cx1, cy1 = min(sx0 + colour.shape[1], width), min(sy0 + colour.shape[0], height)
    if cx1 > cx0 and cy1 > cy0:
        patch = canvas[cy0:cy1, cx0:cx1]
        rows, cols = slice(cy0 - sy0, cy1 - sy0), slice(cx0 - sx0, cx1 - sx0)
        cv2.blendLinear(patch, colour[rows, cols], keep[rows, cols], cover[rows, cols],
                        dst=patch)

    if flashing:
        # Muzzle flash: a ring kicking outwards right after the thumb drops.
        kick = since_shot / RECOIL
        overlay = region.copy()
        cv2.circle(overlay, local, round((20 + 34 * kick) * scale), TINT, weight,
                   cv2.LINE_AA)
        blend(region, overlay, 1.0 - kick)


@lru_cache(maxsize=8)
def _crosshair_sprite(armed: bool, scale: float
                      ) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """The mark and its shadow as a colour and two blend weights: how much of
    the world is kept (under the shadow, less) and how much the mark covers."""
    half = round(32 * scale) + 4
    size = 2 * half + 1
    centre = (half, half)
    shadow = np.zeros((size, size), np.uint8)
    _crosshair_strokes(shadow, centre, 255, scale, grow=_px(2, scale))
    mark = np.zeros((size, size), np.uint8)
    _crosshair_strokes(mark, centre, 255, scale)
    covered = mark.astype(np.float32) / 255.0
    shaded = shadow.astype(np.float32) / 255.0 * 0.32
    keep = (1.0 - shaded) * (1.0 - covered)
    colour = np.empty((size, size, 3), np.uint8)
    colour[:] = TINT if armed else IDLE_CROSSHAIR
    for array in (colour, keep, covered):
        array.flags.writeable = False
    return colour, keep, covered


def inset_slots(rect: Rect, count: int, gap: int = 0) -> tuple[Rect, ...]:
    """One picture per camera: the first in ``rect``, any others stacked
    beneath it at the same size, ``gap`` apart - each a whole picture-in-
    picture rather than a sliver of one."""
    return tuple(Rect(rect.x, rect.y + index * (rect.height + gap), rect.width,
                      rect.height) for index in range(max(count, 1)))


def _default_draw(image: np.ndarray, frame: Frame, scale: float) -> None:
    draw_hands(image, frame, scale=scale, show_captions=False)


def shrink(image: np.ndarray, width: int, height: int) -> np.ndarray:
    """Downscale a camera frame to ``width`` x ``height``, cheaply but softly.

    ``INTER_AREA`` averages every source pixel and costs 5-6 ms for a 720p frame
    - more than half the whole frame budget, for a thumbnail. Halving with
    ``pyrDown`` does the same box-filtering in a fraction of the time, so the
    image is halved until it is within a factor of two of the target and then
    finished with ``INTER_LINEAR``: the aliasing ``INTER_AREA`` exists to prevent
    is still gone, at about a twentieth of the cost.
    """
    copied = False
    while width and height:
        reduced = _reduced(image, width, height)
        if reduced is None:
            break
        image, copied = reduced, True
    if image.shape[:2] != (height, width):
        return cv2.resize(image, (width, height), interpolation=cv2.INTER_LINEAR)
    # Callers draw the skeleton onto what comes back, so never hand them the
    # camera's own buffer.
    return image if copied else image.copy()


def _reduced(image: np.ndarray, width: int, height: int) -> np.ndarray | None:
    """``image`` box-averaged down by four, or by two, while it stays at least
    ``width`` x ``height``; None when it is already within a factor of two.

    ``INTER_AREA`` has a fast path for exact factors of two and four - a
    twentieth of a millisecond for a 720p frame, a fifth of what ``pyrDown``
    costs - so the frame loses the odd row or column that would make the
    factor inexact, which nobody can see in a thumbnail.
    """
    source_height, source_width = image.shape[:2]
    for factor in (4, 2):
        if source_width >= width * factor and source_height >= height * factor:
            rows, cols = source_height - source_height % factor, source_width - source_width % factor
            return cv2.resize(image[:rows, :cols], (cols // factor, rows // factor),
                              interpolation=cv2.INTER_AREA)
    return None


#: What one camera is contributing this frame.
FUSED = "fused"
NO_HAND = "no hand"
IGNORED = "ignored"

#: What the picture says when a camera is not helping aim, and in what colour
#: its edge turns: said on the picture itself, where a player looks to see why
#: the crosshair has gone.
STATE_NOTES = {NO_HAND: ("Show your hand", DANGER), IGNORED: ("Not in use", WARNING)}

#: The picture-in-picture's corners, in 720-tall units: a small panel's.
PIP_RADIUS = 14


def _covering(camera: np.ndarray, width: int, height: int
              ) -> tuple[np.ndarray, tuple[int, int]]:
    """The whole camera frame scaled to cover ``width`` x ``height``, and where
    the centred crop of that size starts in it.

    The picture is cropped, never squashed, to the window's shape; and the
    skeleton is drawn on the whole frame first, since the landmarks are
    fractions of the whole frame.
    """
    source_height, source_width = camera.shape[:2]
    factor = max(width / source_width, height / source_height)
    cover = (max(width, round(source_width * factor)),
             max(height, round(source_height * factor)))
    return shrink(camera, *cover), ((cover[0] - width) // 2, (cover[1] - height) // 2)


def draw_camera_inset(canvas: np.ndarray, camera: np.ndarray, hands: Frame,
                      rect: Rect, label: str = "", state: str = FUSED,
                      draw=None, scale: float = 1.0) -> None:
    """One webcam's picture-in-picture, with the hand drawn on it, in ``rect``.

    Rounded like FaceTime's, edged with a hairline and nothing else while all
    is well; a camera that has lost the hand says so across its foot, and
    its edge turns red.
    """
    frame, (ox, oy) = _covering(camera, rect.width, rect.height)
    (draw or _default_draw)(frame, hands, rect.height / 200)
    picture = frame[oy:oy + rect.height, ox:ox + rect.width]
    note, tone = STATE_NOTES.get(state, ("", None))
    if note:
        # A dark wash up from the foot, for the words to sit on.
        rise = max(1, rect.height * 2 // 5)
        foot = picture[-rise:].astype(np.float32)
        wash = _foot_wash(rise)
        picture = picture.copy()
        picture[-rise:] = (foot * wash).astype(np.uint8)
    radius = min(_px(PIP_RADIUS, scale), rect.height // 2)
    height, width = canvas.shape[:2]
    clipped = picture[max(0, -rect.y):max(0, min(rect.height, height - rect.y)),
                      max(0, -rect.x):max(0, min(rect.width, width - rect.x))]
    _composite(canvas, rect, clipped, radius)
    if tone is not None:
        hairline(canvas, rect, radius, tone, _px(2, scale))
        write(canvas, note, (rect.x + rect.width // 2, rect.bottom - _px(10, scale)),
              FOOTNOTE if rect.height < _px(140, scale) else SUBHEAD, LABEL, scale,
              align=CENTRE)
    else:
        hairline(canvas, rect, radius, hairline_over(tuple(int(c) for c in picture[2, 2])))
    if label:
        draw_tag(canvas, label, (rect.x + _px(6, scale), rect.y + _px(24, scale)), LABEL,
                 scale, dot=False)


@lru_cache(maxsize=8)
def _foot_wash(rise: int) -> np.ndarray:
    ramp = np.linspace(1.0, 0.35, rise, dtype=np.float32) ** 1.4
    wash = np.repeat(ramp[:, None, None], 3, axis=2)
    wash.flags.writeable = False
    return wash


def tag_width(text: str, scale: float = 1.0, dot: bool = True) -> int:
    """How wide :func:`draw_tag` makes the capsule for ``text``."""
    return _px(18 if dot else 10, scale) + measure(text, FOOTNOTE, scale) + _px(10, scale)


def draw_tag(canvas: np.ndarray, text: str, corner: tuple[int, int],
             color: tuple[int, int, int], scale: float = 1.0, dot: bool = True) -> Rect:
    """A small glass capsule - a dot in ``color``, then the text - bottom-left
    at ``corner``, for a few words laid over a picture. Returns the capsule."""
    height = _px(22, scale)
    pill = Rect(corner[0], corner[1] - height, tag_width(text, scale, dot), height)
    draw_glass(canvas, pill, height // 2, scale)
    mid = pill.y + height // 2
    if dot:
        cv2.circle(canvas, (pill.x + _px(10, scale), mid), _px(3, scale), color, -1,
                   cv2.LINE_AA)
    write(canvas, text, (pill.x + _px(18 if dot else 10, scale),
                         baseline_for(FOOTNOTE, pill.y, height, scale)),
          FOOTNOTE, LABEL if dot else color, scale)
    return pill


def draw_camera_insets(canvas: np.ndarray, images: Sequence[np.ndarray],
                       hands: Sequence[Frame], rect: Rect,
                       states: Sequence[str] = (), draw=None,
                       scale: float = 1.0) -> None:
    """Every camera in the corner, so you can see what each of them is doing."""
    slots = inset_slots(rect, len(images), _px(8, scale))
    for index, (slot, image) in enumerate(zip(slots, images)):
        label = f"Camera {index + 1}" if len(images) > 1 else ""
        state = states[index] if index < len(states) else (
            FUSED if hands[index].subjects else NO_HAND)
        draw_camera_inset(canvas, image, hands[index], slot, label, state, draw, scale)


def camera_summary(states: Sequence[str]) -> tuple[str, tuple[int, int, int]]:
    """One line saying how many cameras are actually feeding the crosshair.

    Two cameras only help while both can see the hand, so the answer changes
    frame to frame and is worth saying out loud rather than leaving to be
    inferred from the corner of the screen.
    """
    if not states:
        return "no camera", DANGER
    working = states.count(FUSED)
    if len(states) == 1:
        return ("1 camera" if working else "1 camera - no hand",
                MUTED if working else DANGER)
    if working == len(states):
        return f"{working} cameras fused", ARMED
    faults = [f"cam {index + 1} {state}"
              for index, state in enumerate(states) if state != FUSED]
    return (f"{working} of {len(states)} cameras   {', '.join(faults)}",
            DANGER if IGNORED in states else MUTED)



def camera_note(states: Sequence[str]) -> tuple[str, tuple] | None:
    """What a player needs to hear about their cameras, in their words.

    One camera is the ordinary case and needs none - its own picture says
    when it has lost the hand. With several, which of them is helping aim
    changes frame to frame, so it is said under the pictures.
    """
    if len(states) < 2:
        return None
    for index, state in enumerate(states):
        if state == IGNORED:
            return f"Camera {index + 1} isn’t in use", WARNING
    for index, state in enumerate(states):
        if state != FUSED:
            return f"Camera {index + 1} can’t see your hand", LABEL_SECONDARY
    if len(states) == 2:
        return "Both cameras see your hand", LABEL
    return f"All {len(states)} cameras see your hand", LABEL


# --- controls ------------------------------------------------------------------
#
# Anything shot with the finger pistol is at least SHOOTABLE units tall at
# 720p - a hand is less precise than a mouse. Buttons are pills; the one that
# matters most on a screen is white with a black label, the way Apple Arcade's
# Play button is. The control the crosshair is over takes focus: it lifts,
# and a white ring stands just off it, so there is no doubt which one a shot
# would press.

#: The smallest thing the finger pistol is asked to hit, in 720-tall units.
SHOOTABLE = 64

PRIMARY, SECONDARY, DESTRUCTIVE, OVER_WORLD = "primary", "secondary", "destructive", "glass"

#: A control under the crosshair: lifted well clear of the raised surface.
FOCUSED = (86, 84, 84)


def draw_button(canvas: np.ndarray, button: Button, highlighted: bool = False,
                scale: float = 1.0) -> None:
    """A pill (or, square, a circle) with its icon and label centred."""
    rect = button.rect
    radius = min(rect.width, rect.height) // 2
    danger = button.kind == DESTRUCTIVE
    if button.kind == PRIMARY:
        draw_surface(canvas, rect, radius, LABEL, edge=False)
        ink = (0, 0, 0)
    elif highlighted:
        draw_surface(canvas, rect, radius, FOCUSED, edge=False)
        ink = DANGER if danger else LABEL
    elif button.kind == OVER_WORLD:
        draw_glass(canvas, rect, radius, scale)
        ink = LABEL
    else:
        draw_surface(canvas, rect, radius, SURFACE_RAISED)
        ink = DANGER if danger else LABEL
    if highlighted:
        # Focus: a white ring standing just off the control, whatever it is,
        # so the one a shot would press is never in doubt.
        ring = _px(4, scale)
        hairline(canvas, Rect(rect.x - ring, rect.y - ring, rect.width + 2 * ring,
                              rect.height + 2 * ring), radius + ring, LABEL, _px(2, scale))
    # A round button is its icon alone; its label is only its name.
    label = "" if button.icon and rect.width == rect.height else button.label
    icon = _px(22 if label else 26, scale)
    gap = _px(8, scale)
    label_w = measure(label, HEADLINE, scale) if label else 0
    total = (icon if button.icon else 0) + (gap if button.icon and label_w else 0) + label_w
    x = rect.x + (rect.width - total) / 2
    mid = rect.y + rect.height / 2
    if button.icon:
        draw_icon(canvas, button.icon, (x + icon / 2, mid), icon, ink)
        x += icon + (gap if label_w else 0)
    if label_w:
        write(canvas, label, (x, baseline_for(HEADLINE, rect.y, rect.height, scale)),
              HEADLINE, ink, scale)


# --- the round's chrome ----------------------------------------------------------
#
# In a round the world owns the centre. The chrome is three things in the
# corners, all glass: the score top-left (the camera's picture beside it),
# the clock top-centre, one Pause control top-right. A map's own readouts -
# health, wave, wind, integrity - sit in the score's panel, not panels of
# their own.

#: The score panel, in 720-tall units: its side padding, the score's and the
#: tally's baselines, its height with nothing under the tally, and the gap
#: between readout columns.
PANEL_PAD = 16
SCORE_BASELINE = 37
TALLY_BASELINE = 58
PANEL_PLAIN = 72
READOUT_GAP = 22
#: A readout row: its label's and its value's baselines below the row's top,
#: its height, and the extra a meter under the value takes.
READOUT_LABEL, READOUT_VALUE, READOUT_ROW, READOUT_METER = 20, 44, 58, 10
#: The narrowest a meter is drawn, so a short value still has a readable bar.
METER_WIDTH = 72
PANEL_RADIUS = 16

TONES = {"": LABEL, "warning": WARNING, "danger": DANGER}


def hud_tally(round_: Round) -> str:
    """The line under the score: hits out of shots, and the accuracy."""
    if not round_.shots:
        return "No shots yet"
    return f"{round_.hits} of {round_.shots} hits · {round_.accuracy:.0%}"


def _readout_width(readout, scale: float) -> int:
    width = max(measure(readout.label, FOOTNOTE, scale),
                measure(readout.value, TITLE_3, scale))
    if readout.meter is not None:
        width = max(width, _px(METER_WIDTH, scale))
    return width


def readout_rows(readouts: Sequence, room: int, scale: float = 1.0) -> list[list]:
    """The readouts as rows of columns, as many to a row as fit in ``room``."""
    rows: list[list] = []
    row: list = []
    used = 0
    for readout in readouts:
        width = _readout_width(readout, scale)
        needed = width if not row else used + _px(READOUT_GAP, scale) + width
        if row and needed > room:
            rows.append(row)
            row, used = [readout], width
        else:
            row.append(readout)
            used = needed
    if row:
        rows.append(row)
    return rows


def _rows_width(rows: list[list], scale: float) -> int:
    return max((sum(_readout_width(r, scale) for r in row)
                + _px(READOUT_GAP, scale) * (len(row) - 1) for row in rows), default=0)


def _rows_height(rows: list[list], scale: float) -> int:
    return sum(_px(READOUT_ROW + (READOUT_METER if any(r.meter is not None for r in row)
                                  else 0), scale) for row in rows)


def score_panel(round_: Round, readouts: Sequence, origin: tuple[int, int],
                room: int, scale: float = 1.0) -> tuple[Rect, list[list]]:
    """Where the score panel goes and how its readouts are laid out in it.

    As wide as what is on it - never narrower than a four-figure score and a
    three-figure tally, so it holds its width through a round rather than
    twitching wider with every digit - and never wider than ``room``: the
    readouts wrap onto more rows first.
    """
    pad = _px(PANEL_PAD, scale)
    content = max(measure(grouped(round_.score), TITLE_1, scale),
                  measure(hud_tally(round_), FOOTNOTE, scale),
                  measure("8,888", TITLE_1, scale),
                  measure("88 of 888 hits · 88%", FOOTNOTE, scale))
    rows = readout_rows(readouts, max(1, room - 2 * pad), scale)
    content = max(content, _rows_width(rows, scale))
    height = _px(PANEL_PLAIN, scale) + _rows_height(rows, scale)
    if rows:
        height += _px(6, scale)
    return Rect(origin[0], origin[1], min(room, content + 2 * pad), height), rows


def draw_score_panel(canvas: np.ndarray, round_: Round, readouts: Sequence,
                     origin: tuple[int, int], room: int, scale: float = 1.0,
                     now: float = 0.0) -> Rect:
    """The score, the tally, and the map's readouts, on one glass panel."""
    panel, rows = score_panel(round_, readouts, origin, room, scale)
    draw_glass(canvas, panel, _px(PANEL_RADIUS, scale), scale)
    pad = _px(PANEL_PAD, scale)
    x = panel.x + pad
    write(canvas, grouped(round_.score), (x, panel.y + _px(SCORE_BASELINE, scale)),
          TITLE_1, LABEL, scale)
    write(canvas, hud_tally(round_), (x, panel.y + _px(TALLY_BASELINE, scale)), FOOTNOTE,
          LABEL_SECONDARY, scale)
    top = panel.y + _px(PANEL_PLAIN, scale)
    if rows:
        cv2.line(canvas, (x, top - _px(2, scale)), (panel.right - pad, top - _px(2, scale)),
                 hairline_over(GLASS), 1, cv2.LINE_AA)
    for row in rows:
        column = x
        for readout in row:
            width = _readout_width(readout, scale)
            tone = TONES.get(readout.tone, LABEL)
            write(canvas, readout.label, (column, top + _px(READOUT_LABEL, scale)),
                  FOOTNOTE, LABEL_SECONDARY, scale)
            write(canvas, readout.value, (column, top + _px(READOUT_VALUE, scale)),
                  TITLE_3, tone, scale)
            if readout.meter is not None:
                _draw_meter(canvas, Rect(column, top + _px(READOUT_VALUE + 9, scale),
                                         width, _px(4, scale)),
                            readout.meter, readout.signed, tone)
            column += width + _px(READOUT_GAP, scale)
        top += _px(READOUT_ROW + (READOUT_METER if any(r.meter is not None for r in row)
                                  else 0), scale)
    return panel


def _draw_meter(canvas: np.ndarray, rect: Rect, value: float, signed: bool,
                color: tuple[int, int, int]) -> None:
    """A capsule track with its fill: from the left, or - ``signed`` - out
    from the middle either way."""
    radius = max(1, rect.height // 2)
    draw_surface(canvas, rect, radius, (70, 68, 68), edge=False)
    value = min(max(value, -1.0 if signed else 0.0), 1.0)
    if signed:
        mid = rect.x + rect.width // 2
        reach = round(value * rect.width / 2)
        x0, x1 = sorted((mid, mid + reach))
        cv2.line(canvas, (mid, rect.y - radius), (mid, rect.bottom + radius - 1),
                 LABEL_SECONDARY, 1, cv2.LINE_AA)
    else:
        x0, x1 = rect.x, rect.x + round(value * rect.width)
    if x1 - x0 >= 1:
        draw_surface(canvas, Rect(x0, rect.y, max(x1 - x0, rect.height), rect.height),
                     radius, color, edge=False)


def draw_debug_line(canvas: np.ndarray, aim: Aim, fps: float | None,
                    camera_states: Sequence[str], scale: float = 1.0,
                    fire_at: float = 0.65) -> None:
    """Under --debug, the measurements behind the aim, low on the right."""
    # How far the thumb has folded, against the threshold it must cross.
    detail = f"trigger {aim.travel:+.2f} of {fire_at:.2f}"
    if aim.cameras > 1:
        # Spread is what the cameras disagree by.
        detail += f"   spread {aim.spread * 100:.1f}%"
    if fps is not None:
        detail += f"   {fps:.0f} fps"
    summary, _ = camera_summary(camera_states)
    text = f"{detail}   {summary}"
    height, width = canvas.shape[:2]
    draw_tag(canvas, text, (width - _px(24, scale) - tag_width(text, scale, False),
                            height - _px(76, scale)), LABEL, scale, dot=False)


#: The clock's capsule, in 720-tall units.
CLOCK_HEIGHT, CLOCK_PAD = 40, 18


def clock_pill(width: int, remaining: float | None, scale: float = 1.0,
               top: int = 0) -> Rect:
    """Where the clock's capsule sits: centred, at ``top``. Its width holds
    still as the seconds change - the figures are tabular."""
    text = "Practice" if remaining is None else clock_text(remaining)
    text_w = max(measure(text, TITLE_3, scale), measure("0:00", TITLE_3, scale))
    pill_w = text_w + 2 * _px(CLOCK_PAD, scale)
    return Rect((width - pill_w) // 2, top, pill_w, _px(CLOCK_HEIGHT, scale))


def draw_clock(canvas: np.ndarray, remaining: float | None, scale: float = 1.0,
               top: int = 0) -> Rect:
    """The round clock, top-centre on glass. Red for the last ten seconds;
    never animated - it changes every frame, and moves only by its digits."""
    pill = clock_pill(canvas.shape[1], remaining, scale, top)
    draw_glass(canvas, pill, pill.height // 2, scale)
    urgent = remaining is not None and remaining <= 10.0
    text = "Practice" if remaining is None else clock_text(remaining)
    write(canvas, text, (pill.x + pill.width // 2,
                         baseline_for(TITLE_3, pill.y, pill.height, scale)),
          TITLE_3, DANGER if urgent else LABEL, scale, align=CENTRE)
    return pill


# --- hints -----------------------------------------------------------------------
#
# A hint is a few words, and sometimes the key that does them: ("P", "Pause").
# In a round they sit on a glass capsule at the foot of the world, where they
# can be read over anything, and fade when they stop helping; on the menus
# they are a quiet line along the foot of the screen.

HINT_GAP = 22  # between hints, in 720-tall units


def _hint_width(item: tuple[str, str], scale: float) -> int:
    key, text = item
    width = measure(text, FOOTNOTE, scale)
    if key:
        width += _keycap_width(key, scale) + _px(6, scale)
    return width


def _keycap_width(key: str, scale: float) -> int:
    return max(_px(18, scale), measure(key, FOOTNOTE, scale) + _px(10, scale))


def hints_width(items: Sequence[tuple[str, str]], scale: float = 1.0) -> int:
    return (sum(_hint_width(item, scale) for item in items)
            + _px(HINT_GAP, scale) * max(0, len(items) - 1))


def fit_hints(items: Sequence[tuple[str, str]], width: int,
              scale: float = 1.0) -> list[tuple[str, str]]:
    """The hints that fit in ``width``: repeats dropped, then the last ones
    first - the list is written most useful first, and a line that runs off
    the screen is worse than one that says less."""
    kept: list[tuple[str, str]] = []
    for item in items:
        if item[1] and not any(item[1].lower() in other[1].lower() for other in kept):
            kept.append(tuple(item))
    while kept and hints_width(kept, scale) > width:
        kept.pop()
    return kept


def draw_hints(canvas: np.ndarray, items: Sequence[tuple[str, str]], scale: float = 1.0,
               alpha: float = 1.0, capsule: bool = False) -> None:
    """The hints along the foot of the screen, faded to ``alpha``.

    With ``capsule`` - in a round - centred on glass; without, set on the
    left margin of a menu. A fading line is drawn into a copy of its own
    patch and blended back, so it costs its patch, not a frame.
    """
    if not items or alpha <= 0.0:
        return
    height, width = canvas.shape[:2]
    margin = screen_margin(height, scale)
    text_w = hints_width(items, scale)
    if capsule:
        pill_h = _px(40, scale)
        pill = Rect((width - text_w) // 2 - _px(20, scale), height - margin - pill_h,
                    text_w + 2 * _px(20, scale), pill_h)
    else:
        pill_h = _px(32, scale)
        top = footer_baseline(height, scale) - round(
            (pill_h + type_size(FOOTNOTE, scale) * CAP_HEIGHT) / 2)
        pill = Rect(margin - _px(4, scale), top, text_w + _px(8, scale), pill_h)
    x0, y0 = max(pill.x - 2, 0), max(pill.y - 2, 0)
    x1, y1 = min(pill.right + 2, width), min(pill.bottom + 2, height)
    if x1 <= x0 or y1 <= y0:
        return
    region = canvas[y0:y1, x0:x1]
    patch = region.copy() if alpha < 1.0 else region
    local = Rect(pill.x - x0, pill.y - y0, pill.width, pill.height)
    if capsule:
        draw_glass(patch, local, local.height // 2, scale)
    x = local.x + (_px(20, scale) if capsule else _px(4, scale))
    baseline = baseline_for(FOOTNOTE, local.y, local.height, scale)
    ink = LABEL if capsule else LABEL_SECONDARY
    for key, text in items:
        if key:
            cap_w, cap_h = _keycap_width(key, scale), _px(18, scale)
            cap = Rect(x, local.y + (local.height - cap_h) // 2, cap_w, cap_h)
            hairline(patch, cap, _px(5, scale), LABEL_SECONDARY if capsule else
                     LABEL_TERTIARY)
            write(patch, key, (cap.x + cap_w // 2, baseline), FOOTNOTE, ink, scale,
                  align=CENTRE)
            x += cap_w + _px(6, scale)
        x += write(patch, text, (x, baseline), FOOTNOTE, ink, scale)
        x += _px(HINT_GAP, scale)
    if alpha < 1.0:
        cv2.addWeighted(patch, alpha, region, 1.0 - alpha, 0.0, dst=region)


# --- the pause sheet -------------------------------------------------------------
#
# Pausing brings a glass sheet up over the dimmed world, with four large
# choices - each one shootable, each SHOOTABLE units tall.

#: The sheet, in 720-tall units: its width, padding and corner radius, where
#: its title and subtitle sit, and the space between its buttons.
SHEET_WIDTH, SHEET_PAD, SHEET_RADIUS = 400, 24, 28
SHEET_TITLE, SHEET_SUBTITLE, SHEET_BUTTONS, SHEET_GAP = 54, 80, 104, 12
#: How far the sheet rises as it arrives, and how dark the world goes.
SHEET_RISE, SHEET_DIM = 36, 0.5

PAUSE_CHOICES = (("Resume", "play", PRIMARY), ("Restart", "restart", SECONDARY),
                 ("Choose a Game", "grid", SECONDARY), ("Quit", "xmark", DESTRUCTIVE))


def pause_sheet(width: int, height: int, scale: float = 1.0
                ) -> tuple[Rect, tuple[Button, ...]]:
    """The sheet and its buttons, centred. Drawing and shooting both read this."""
    sheet_w = min(width - 2 * _px(24, scale), _px(SHEET_WIDTH, scale))
    button_h = _px(SHOOTABLE, scale)
    count = len(PAUSE_CHOICES)
    sheet_h = (_px(SHEET_BUTTONS, scale) + count * button_h
               + (count - 1) * _px(SHEET_GAP, scale) + _px(SHEET_PAD + 26, scale))
    sheet = Rect((width - sheet_w) // 2, (height - sheet_h) // 2, sheet_w, sheet_h)
    pad = _px(SHEET_PAD, scale)
    buttons = []
    y = sheet.y + _px(SHEET_BUTTONS, scale)
    for label, icon, kind in PAUSE_CHOICES:
        buttons.append(Button(Rect(sheet.x + pad, y, sheet_w - 2 * pad, button_h), label,
                              icon, kind))
        y += button_h + _px(SHEET_GAP, scale)
    return sheet, tuple(buttons)


def draw_pause_sheet(canvas: np.ndarray, subtitle: str, focus: int | None,
                     scale: float = 1.0, arrival: float = 1.0) -> None:
    """The pause sheet over the dimmed frame already on ``canvas``.

    ``arrival`` runs 0 to 1 as the sheet comes in: the world dims and the
    sheet rises into place on the arriving curve.
    """
    height, width = canvas.shape[:2]
    eased = ease_out(arrival)
    dim(canvas, SHEET_DIM * eased)
    sheet, buttons = pause_sheet(width, height, scale)
    rise = round((1.0 - eased) * _px(SHEET_RISE, scale))
    sheet = Rect(sheet.x, sheet.y + rise, sheet.width, sheet.height)
    radius = _px(SHEET_RADIUS, scale)
    _panel_shadow(canvas, sheet, radius, _px(24, scale))
    draw_glass(canvas, sheet, radius, scale, opacity=0.8)
    centre = sheet.x + sheet.width // 2
    write(canvas, "Paused", (centre, sheet.y + _px(SHEET_TITLE, scale)), TITLE_1, LABEL,
          scale, align=CENTRE)
    write(canvas, fit(subtitle, SUBHEAD, sheet.width - 2 * _px(SHEET_PAD, scale), scale),
          (centre, sheet.y + _px(SHEET_SUBTITLE, scale)), SUBHEAD, LABEL_SECONDARY, scale,
          align=CENTRE)
    for index, button in enumerate(buttons):
        moved = Button(Rect(button.rect.x, button.rect.y + rise, button.rect.width,
                            button.rect.height), button.label, button.icon, button.kind)
        draw_button(canvas, moved, focus == index, scale)
    write(canvas, "Press P to resume", (centre, sheet.bottom - _px(18, scale)),
          FOOTNOTE, LABEL_TERTIARY, scale, align=CENTRE)


# --- the results card ------------------------------------------------------------
#
# A card worth sharing: the map's art as its header with the map's name over
# its foot, the outcome in a word or two, the score large - counting up as
# the card arrives - three or four stats, "New Best" in gold only when it is
# true, and the choices: Play Again, Choose a Game, and Save.

#: The card, in 720-tall units: its width, the banner of art at its head,
#: and where each line sits below the banner.
RESULTS_WIDTH, RESULTS_BANNER, RESULTS_RADIUS = 600, 150, 22
RESULTS_OUTCOME, RESULTS_SCORE, RESULTS_BEST = 40, 102, 134
RESULTS_STATS, RESULTS_BUTTONS, RESULTS_BODY = 190, 238, 330
#: The body of a card saved to share: no buttons, the wordmark at its foot.
SHARED_BODY = 270

#: How long the score takes to count up, and the card to arrive.
COUNT_UP, CARD_ARRIVAL = 0.6, 0.45

RESULTS_CHOICES = (("Play Again", "play", PRIMARY), ("Choose a Game", "grid", SECONDARY),
                   ("Save", "share", SECONDARY))


def results_card(width: int, height: int, scale: float = 1.0,
                 banner: bool = True, share: bool = False) -> Rect:
    """Where the score card sits in a window this size."""
    card_w = min(width - 2 * screen_margin(height, scale), _px(RESULTS_WIDTH, scale))
    body = SHARED_BODY if share else RESULTS_BODY
    card_h = _px(body + (RESULTS_BANNER if banner else 0), scale)
    top = (height - card_h) // 2
    if not share:
        # Centred in the room above the hints at the foot.
        top = max(0, (height - _px(FOOTER_BAND, scale) - card_h) // 2)
    return Rect((width - card_w) // 2, top, card_w, card_h)


def results_buttons(width: int, height: int, scale: float = 1.0,
                    banner: bool = True) -> tuple[Button, ...]:
    """The card's choices, in a row across its foot. Drawing and shooting both
    read this: each is SHOOTABLE units tall."""
    card = results_card(width, height, scale, banner)
    body = card.y + (_px(RESULTS_BANNER, scale) if banner else 0)
    tall = _px(SHOOTABLE, scale)
    gap = _px(12, scale)
    widths = []
    for label, _icon, _kind in RESULTS_CHOICES:
        if label == "Save":
            widths.append(tall)
        else:
            widths.append(measure(label, HEADLINE, scale) + _px(22 + 8 + 56, scale))
    x = card.x + (card.width - sum(widths) - gap * (len(widths) - 1)) // 2
    buttons = []
    for (label, icon, kind), wide in zip(RESULTS_CHOICES, widths):
        buttons.append(Button(Rect(x, body + _px(RESULTS_BUTTONS, scale), wide, tall),
                              label, icon, kind))
        x += wide + gap
    return tuple(buttons)


def round_length(duration: float | None) -> str:
    """A round's length as the card names it: bests are kept per length."""
    if duration is None:
        return "Practice"
    return f"{int(round(duration))}-Second Round"


def outcome_line(summary: Summary) -> tuple[str, tuple[int, int, int]]:
    """The outcome in a word or two, and its colour: a win in the tint, a loss
    in red, a round that simply ran its time in secondary.

    Half the outcomes a map can name are the good ending - a night survived,
    a pane held, a street cleaned up - so the map says which it is rather
    than the card guessing from the fact that there is one at all.
    """
    if not summary.outcome:
        return "Final Score", LABEL_SECONDARY
    return title_case(summary.outcome), TINT if summary.won else DANGER


def counted(score: int, elapsed: float | None) -> int:
    """The score as far as it has counted up, ``elapsed`` seconds in."""
    if elapsed is None or elapsed >= COUNT_UP:
        return score
    return round(score * ease_out(max(0.0, elapsed) / COUNT_UP))


def draw_results(canvas: np.ndarray, summary: Summary, best: int,
                 is_best: bool, scale: float = 1.0, title: str = "", emblem=None,
                 elapsed: float | None = None, focus: int | None = None,
                 share: bool = False) -> Rect:
    """The end-of-round card, on the map's own art dimmed to a mood.

    Deliberately not drawn over a frozen frame of the range: that frame carries
    its own score and clock in the HUD, and two sets of numbers on one screen
    read as a bug however far the picture behind is dimmed. The map's card art,
    blurred and darkened, keeps the screen in the game without that problem.

    ``elapsed`` is how long the card has been up: it rises into place and its
    score counts up (None: all settled). ``focus`` is the choice under the
    crosshair. With ``share`` it is the card as saved - no choices, the
    wordmark at its foot. Returns the card.
    """
    draw_ambient_backdrop(canvas)
    height, width = canvas.shape[:2]
    banner = emblem is not None
    card = results_card(width, height, scale, banner, share)
    rise = 0
    if elapsed is not None and not share:
        rise = round((1.0 - ease_out(elapsed / CARD_ARRIVAL)) * _px(40, scale))
    card = Rect(card.x, card.y + rise, card.width, card.height)
    radius = _px(RESULTS_RADIUS, scale)
    _panel_shadow(canvas, card, radius, _px(24, scale))
    draw_surface(canvas, card, radius, SURFACE, edge=False)
    centre = card.x + card.width // 2
    pad = _px(28, scale)

    body = card.y
    if banner:
        body = card.y + _px(RESULTS_BANNER, scale)
        art = _banner_art(emblem, title, card.width, body - card.y)
        _composite_top(canvas, Rect(card.x, card.y, card.width, body - card.y), art, radius)
        write(canvas, round_length(summary.duration), (card.x + pad, body - _px(42, scale)),
              EYEBROW, LABEL, scale)
        write(canvas, fit(title_case(title), TITLE_2, card.width - 2 * pad, scale),
              (card.x + pad, body - _px(14, scale)), TITLE_2, LABEL, scale)

    heading, tone = outcome_line(summary)
    write(canvas, heading, (centre, body + _px(RESULTS_OUTCOME, scale)), HEADLINE, tone,
          scale, align=CENTRE)
    write(canvas, grouped(counted(summary.score, elapsed)),
          (centre, body + _px(RESULTS_SCORE, scale)), LARGE_TITLE, LABEL, scale,
          align=CENTRE)
    # A record has to be a score: an unshot round that "beats" an empty
    # table is nobody's best, whatever the caller was told.
    if is_best and summary.score > 0:
        write(canvas, "New Best", (centre, body + _px(RESULTS_BEST, scale)), HEADLINE, GOLD,
              scale, align=CENTRE)
    elif best:
        write(canvas, f"Best {grouped(best)}", (centre, body + _px(RESULTS_BEST, scale)),
              SUBHEAD, LABEL_SECONDARY, scale, align=CENTRE)

    stats = (
        (f"{summary.hits} of {summary.shots}", "Hits"),
        (f"{summary.accuracy:.0%}", "Accuracy"),
        (str(summary.best_streak), "Best Streak"),
        (str(summary.perfect), title_case(summary.perfect_label)),
    )
    column = (card.width - 2 * pad) // len(stats)
    for index, (value, label) in enumerate(stats):
        x = card.x + pad + column * index + column // 2
        write(canvas, value, (x, body + _px(RESULTS_STATS, scale)), TITLE_3, LABEL, scale,
              align=CENTRE)
        write(canvas, label, (x, body + _px(RESULTS_STATS + 20, scale)), FOOTNOTE,
              LABEL_SECONDARY, scale, align=CENTRE)

    if share:
        draw_logo(canvas, scale, color=LABEL_TERTIARY,
                  corner=(centre + logo_size(scale)[0] // 2, card.bottom - _px(24, scale)))
    else:
        for index, button in enumerate(results_buttons(width, height, scale, banner)):
            moved = Button(Rect(button.rect.x, button.rect.y + rise, button.rect.width,
                                button.rect.height), button.label, button.icon, button.kind)
            draw_button(canvas, moved, focus == index, scale)
    hairline(canvas, card, radius, hairline_over(SURFACE))
    return card


def _composite_top(canvas: np.ndarray, rect: Rect, art: np.ndarray, radius: int) -> None:
    """Lay the banner in the card's head: rounded where the card's top corners
    are, square where it meets the body."""
    height, width = canvas.shape[:2]
    y0, y1 = max(rect.y, 0), min(rect.bottom, height)
    x0, x1 = max(rect.x, 0), min(rect.right, width)
    if y1 <= y0 or x1 <= x0:
        return
    keep, cover = _shape_weights(rect.width, rect.height + radius * 2, radius)
    rows, cols = slice(y0 - rect.y, y1 - rect.y), slice(x0 - rect.x, x1 - rect.x)
    region = canvas[y0:y1, x0:x1]
    cv2.blendLinear(region, art[rows, cols], keep[rows, cols], cover[rows, cols],
                    dst=region)


@lru_cache(maxsize=8)
def _banner_art(emblem, title: str, width: int, height: int) -> np.ndarray:
    """The card's banner, built once: the thumbnail, its foot settled into the
    card's surface so the name reads on it without a box of its own."""
    art = _thumbnail(emblem, title, width, height).astype(np.float32)
    fade = max(1, int(height * 0.8))
    ramp = np.linspace(0.0, 1.0, fade, dtype=np.float32)[:, None, None] ** 0.8 * 0.93
    art[-fade:] = art[-fade:] * (1 - ramp) + np.float32(SURFACE) * ramp
    return art.astype(np.uint8)


def results_card_image(summary: Summary, best: int, is_best: bool, width: int,
                       height: int, scale: float = 1.0, title: str = "",
                       emblem=None) -> np.ndarray:
    """The card as it is saved and shared: settled, without the choices, with
    the wordmark at its foot, and a margin of the map's dimmed art round it."""
    canvas = np.zeros((height, width, 3), np.uint8)
    draw_results(canvas, summary, best, is_best, scale, title, emblem, share=True)
    card = results_card(width, height, scale, emblem is not None, share=True)
    margin = _px(32, scale)
    return canvas[max(0, card.y - margin):min(height, card.bottom + margin),
                  max(0, card.x - margin):min(width, card.right + margin)].copy()


@lru_cache(maxsize=8)
def _shadow_factor(width: int, height: int, x: int, y: int, right: int, bottom: int,
                   radius: int, reach: int) -> np.ndarray:
    """Per-pixel darkening for a panel's shadow, as a 3-channel uint8 factor."""
    mask = np.zeros((height, width), np.uint8)
    cv2.fillPoly(mask, [_rounded(x, y, right, bottom, radius)], 255)
    soft = cv2.GaussianBlur(mask, (0, 0), reach * 0.6).astype(np.float32)
    factor = (255 - 0.55 * soft).astype(np.uint8)
    return cv2.merge([factor, factor, factor])


def _panel_shadow(canvas: np.ndarray, rect: Rect, radius: int, reach: int) -> None:
    """A soft dark halo under a floating panel, so it lifts off the backdrop."""
    height, width = canvas.shape[:2]
    x0, y0 = max(rect.x - reach * 2, 0), max(rect.y - reach, 0)
    x1, y1 = min(rect.right + reach * 2, width), min(rect.bottom + reach * 3, height)
    if x1 <= x0 or y1 <= y0:
        return
    factor = _shadow_factor(x1 - x0, y1 - y0, rect.x - x0, rect.y - y0 + reach // 2,
                            rect.right - x0, rect.bottom - y0 + reach // 2, radius, reach)
    region = canvas[y0:y1, x0:x1]
    cv2.multiply(region, factor, dst=region, scale=1.0 / 255.0)


def _modal_panel(canvas: np.ndarray, rect: Rect, radius: int, scale: float) -> None:
    """The one floating panel both modals share: a faint glow around the edge,
    the soft shaded plate, a lighter hairline along its top."""
    reach = _px(3, scale)
    pad = reach * 5
    height, width = canvas.shape[:2]
    x0, y0 = max(rect.x - pad, 0), max(rect.y - pad, 0)
    x1, y1 = min(rect.right + pad, width), min(rect.bottom + pad, height)
    region = canvas[y0:y1, x0:x1]
    halo = region.copy()
    stroke_rounded(halo, Rect(rect.x - x0 - reach, rect.y - y0 - reach,
                              rect.width + 2 * reach, rect.height + 2 * reach),
                   (110, 102, 94), radius + reach, reach * 2)
    halo = cv2.GaussianBlur(halo, (0, 0), reach * 1.5)
    cv2.addWeighted(halo, 0.55, region, 0.45, 0.0, dst=region)
    shade_panel(canvas, rect, radius, (46, 43, 40), (28, 26, 25), EDGE)
    cv2.line(canvas, (rect.x + radius, rect.y), (rect.right - radius, rect.y),
             (92, 86, 80), 1, cv2.LINE_AA)


def draw_notice(canvas: np.ndarray, lines: Sequence[str],
                scale: float = 1.0) -> None:
    """A message panel in the middle, over whatever is on screen, dimmed."""
    height, width = canvas.shape[:2]
    cv2.convertScaleAbs(canvas, dst=canvas, alpha=0.62, beta=0)

    step = round(34 * scale)
    pad_x = _px(56, scale)
    widest = max((text_width(line, (0.8 if index == 0 else 0.62) * scale, 2, False)
                  for index, line in enumerate(lines)), default=0)
    panel_w = min(width - 2 * _px(40, scale), max(_px(520, scale), widest + 2 * pad_x))
    panel_h = round(64 * scale) + step * len(lines)
    panel = Rect((width - panel_w) // 2, (height - panel_h) // 2, panel_w, panel_h)
    radius = _px(CORNER, scale)
    _panel_shadow(canvas, panel, radius, _px(18, scale))
    _modal_panel(canvas, panel, radius, scale)
    # A red rule above the heading with a short bright tab at the left, and
    # a hairline under the heading: the same line system as the cards.
    inner = _px(28, scale)
    top = panel.y + _px(44, scale)
    cv2.line(canvas, (panel.x + inner, panel.y), (panel.x + inner + _px(46, scale), panel.y),
             DANGER, _px(2, scale), cv2.LINE_AA)
    accent_rule(canvas, top + _px(12, scale), panel.x + inner, panel.right - inner,
                (60, 40, 110), 1)
    for index, line in enumerate(lines):
        _centred_text(canvas, line, top + index * step + (0 if index == 0 else _px(8, scale)),
                      DANGER if index == 0 else INK,
                      (0.8 if index == 0 else 0.62) * scale)
    draw_logo(canvas, scale)


def draw_toast(canvas: np.ndarray, text: str, scale: float = 1.0, alpha: float = 1.0,
               top: int = 0, icon: str = "checkmark") -> None:
    """A word that something worked - "Card saved" - on a glass capsule at
    the top of the screen, faded to ``alpha``."""
    if alpha <= 0.0:
        return
    height, width = canvas.shape[:2]
    pill_h = _px(44, scale)
    icon_w = _px(20, scale)
    pill_w = measure(text, HEADLINE, scale) + icon_w + _px(8 + 2 * 20, scale)
    pill = Rect((width - pill_w) // 2, top, pill_w, pill_h)
    x0, y0 = max(pill.x - 2, 0), max(pill.y - 2, 0)
    x1, y1 = min(pill.right + 2, width), min(pill.bottom + 2, height)
    region = canvas[y0:y1, x0:x1]
    patch = region.copy()
    local = Rect(pill.x - x0, pill.y - y0, pill.width, pill.height)
    draw_glass(patch, local, pill_h // 2, scale)
    draw_icon(patch, icon, (local.x + _px(20, scale) + icon_w / 2, local.y + pill_h / 2),
              icon_w, LABEL)
    write(patch, text, (local.x + _px(20 + 8, scale) + icon_w,
                        baseline_for(HEADLINE, local.y, pill_h, scale)), HEADLINE, LABEL,
          scale)
    cv2.addWeighted(patch, alpha, region, 1.0 - alpha, 0.0, dst=region)


# --- calibration ------------------------------------------------------------
#
# Setup is the first thing a new player sees, so it is composed like a screen
# of the game rather than a test pattern: the Target Range hall with its lamps
# in, the face to shoot lit and the ones still to come hanging faintly beside
# it, and along the bottom a console - the camera, what to do now, how far
# there is to go - clear of every face on the wall. The faces' places and sizes
# are the calibration's own (shot_calibration's targets and TARGET_RADIUS): the
# fit and the inner-two-rings test read the very rings that are drawn.

#: Learning shots before setup moves on to checking - ShotCalibration is
#: ready once its fit has seen three.
LEARN_SHOTS = 3

#: How faint the faces still to come hang on the wall.
COURSE_STRENGTH = 0.24


def setup_arena(width: int, height: int) -> Rect:
    """The hall's frame for setup: its top edge set down far enough that the
    lamps the hall hangs above it are whole, not cut off by the window."""
    top = int(0.03 * height) + max(2, int(0.006 * height)) + 10
    return Rect(0, top, width, height - top)


def setup_course(session) -> tuple[tuple[float, float], ...]:
    """The faces still to come in this step of setup, after the one that is lit."""
    from .shot_calibration import CHECK_TARGETS, REQUIRED_HITS, TARGETS

    if session.testing:
        return tuple(CHECK_TARGETS[len(session.hits) + 1:REQUIRED_HITS])
    done = len(session.samples)
    return tuple(TARGETS[index % len(TARGETS)] for index in range(done + 1, LEARN_SHOTS))


def draw_calibration_range(canvas, session, now, course=False):
    """The actual Target Range hall and archery faces serve as the warm-up.

    With ``course`` the faces still to come in this step hang faintly beside
    the lit one, and a pool of light marks the lit one out.
    """
    from .maps import archery
    from .game import RoundOptions
    from .shot_calibration import TARGET_RADIUS

    height, width = canvas.shape[:2]
    arena = archery.ArcheryRound(RoundOptions(setup_arena(width, height), duration=None,
                                             scale=height / 720, seed=0))
    radius = min(width, height) * TARGET_RADIUS

    def face(point):
        return archery.Target(point[0] * width, point[1] * height, radius, now - 1, 100)

    target = face(session.target)
    if not course:
        arena.targets = [target]
        archery.draw_world(canvas, arena, now)
    else:
        archery.draw_world(canvas, arena, now)  # the hall alone
        _pool_of_light(canvas, (round(target.x), round(target.y)), round(radius))
        for point in setup_course(session):
            archery.hang(canvas, arena, face(point), COURSE_STRENGTH)
        archery.hang(canvas, arena, target)
    celebrate_shot(canvas, session, now)


#: How long a shot's mark stays on the wall in setup, and how long its pop takes.
SHOT_MARK, SHOT_POP = 0.65, 0.12


def celebrate_shot(canvas: np.ndarray, session, now: float) -> None:
    """A moment's answer to the last shot in setup.

    A bullseye in the check gets a small celebration: a green badge with a
    tick that pops (1.25 to 1 in a tenth of a second) where it landed, and a
    ring racing out of it. A shot that taught the aim gets the same badge on
    the face it was taken at. A miss is a quiet white cross - nothing red:
    missing in setup is how the aim gets better.
    """
    height, width = canvas.shape[:2]
    scale = height / 720
    impact = session.last_impact
    if impact is not None and 0 <= now - impact[1] < SHOT_MARK:
        point, at = impact
        _draw_shot_mark(canvas, (point[0] * width, point[1] * height), now - at,
                        session.last_hit, scale)
    elif (session.samples and session.last_shot > 0
          and 0 <= now - session.last_shot < SHOT_MARK
          and (impact is None or impact[1] < session.last_shot)):
        target = session.samples[-1][1]
        _draw_shot_mark(canvas, (target[0] * width, target[1] * height),
                        now - session.last_shot, True, scale)


def _draw_shot_mark(canvas: np.ndarray, centre: tuple[float, float], age: float,
                    good: bool, scale: float) -> None:
    life = 1.0 - age / SHOT_MARK
    pop = 1.25 - 0.25 * min(1.0, age / SHOT_POP)
    reach = round(56 * scale)
    height, width = canvas.shape[:2]
    cx, cy = round(centre[0]), round(centre[1])
    x0, y0 = max(cx - reach, 0), max(cy - reach, 0)
    x1, y1 = min(cx + reach + 1, width), min(cy + reach + 1, height)
    if x1 <= x0 or y1 <= y0:
        return
    region = canvas[y0:y1, x0:x1]
    patch = region.copy()
    local = (cx - x0, cy - y0)
    if good:
        badge = round(18 * scale * pop)
        spread = min(1.0, age / 0.4)
        cv2.circle(patch, local, round(badge + 26 * scale * spread), TINT,
                   max(1, round(3 * scale * (1 - spread))), cv2.LINE_AA)
        cv2.circle(patch, local, badge, TINT, -1, cv2.LINE_AA)
        draw_icon(patch, "checkmark", local, badge * 1.3, LABEL)
    else:
        cv2.circle(patch, local, round(14 * scale * pop), (0, 0, 0), -1, cv2.LINE_AA)
        draw_icon(patch, "xmark", local, 20 * scale * pop, LABEL)
    cv2.addWeighted(patch, life, region, 1.0 - life, 0.0, dst=region)


def _pool_of_light(canvas: np.ndarray, centre: tuple[int, int], radius: int) -> None:
    """A warm pool of lamplight on the wall behind the face to shoot."""
    glow = _light_pool(radius)
    reach = glow.shape[0] // 2
    height, width = canvas.shape[:2]
    x0, y0 = centre[0] - reach, centre[1] - reach
    sx0, sy0 = max(0, -x0), max(0, -y0)
    x0, y0 = max(0, x0), max(0, y0)
    x1 = min(width, centre[0] + reach + 1)
    y1 = min(height, centre[1] + reach + 1)
    if x1 <= x0 or y1 <= y0:
        return
    region = canvas[y0:y1, x0:x1]
    cv2.add(region, glow[sy0:sy0 + y1 - y0, sx0:sx0 + x1 - x0], dst=region)


@lru_cache(maxsize=4)
def _light_pool(radius: int) -> np.ndarray:
    reach = int(radius * 2.8)
    span = np.arange(-reach, reach + 1, dtype=np.float32) / reach
    distance = np.sqrt(span[None, :] ** 2 + span[:, None] ** 2)
    falloff = np.clip(1.0 - distance, 0.0, 1.0) ** 1.8
    glow = (falloff[:, :, None] * np.float32((46, 60, 76))).astype(np.uint8)
    glow.flags.writeable = False
    return glow


def setup_console(width: int, height: int, count: int, aspect: float,
                  scale: float = 1.0) -> tuple[Rect, Rect, Rect]:
    """The camera, the instruction and the progress panels along the bottom.

    As tall as the room under the lowest face allows, capped, so the console
    never covers a target the player has to shoot. The camera's picture is
    at its largest here: in setup, seeing your hand is the point.
    """
    from .maps.archery import BOSS_SCALE
    from .shot_calibration import CHECK_TARGETS, TARGET_RADIUS, TARGETS

    margin, gap = screen_margin(height, scale), _px(12, scale)
    lowest = max(y for _, y in (*TARGETS, *CHECK_TARGETS)) * height
    lowest += min(width, height) * TARGET_RADIUS * BOSS_SCALE * 1.15  # its shadow too
    bottom = height - margin
    tall = max(_px(60, scale), min(_px(170, scale), bottom - int(lowest) - gap))
    top = bottom - tall
    slot = (tall - (count - 1) * _px(8, scale)) / max(count, 1)
    camera_w = max(_px(80, scale), min(int(slot * aspect), width // 4))
    camera = Rect(margin, top, camera_w, tall)
    progress_w = _px(250, scale)
    progress = Rect(width - margin - progress_w, top, progress_w, tall)
    instruction = Rect(camera.right + gap, top,
                       max(1, progress.x - gap - camera.right - gap), tall)
    return camera, instruction, progress


#: Setup's keys, as hints in the instruction panel.
SETUP_KEYS = (("B", "Undo"), ("R", "Start over"), ("Esc", "Skip"))


def setup_status(session) -> tuple[str, tuple[int, int, int]]:
    """The line under the instruction: what the hand is doing right now."""
    if not session.aim.tracking:
        return "Show your hand to the camera", DANGER
    if session.aim.armed:
        return "Ready. Fold your thumb to fire.", TINT
    return "Raise your thumb", LABEL_SECONDARY


def draw_shot_calibration(canvas, session, images, frames, draw, scale=1.0, now=None):
    """Setup: the lit face on the range wall, and the console under it.

    ``now`` is the clock the shots were taken on, for the moment's
    celebration of a hit; without it the wall is drawn as of the last shot.
    """
    from .shot_calibration import REQUIRED_HITS

    if now is None:
        now = session.last_shot if session.last_shot > 0 else 0
    draw_calibration_range(canvas, session, now, course=True)
    height, width = canvas.shape[:2]
    count = max(1, len(images))
    aspect = images[0].shape[1] / images[0].shape[0] if images else 16 / 9
    camera, instruction, progress = setup_console(width, height, count, aspect, scale)
    radius = _px(PANEL_RADIUS, scale)

    # The camera's picture, big: here seeing your hand is the whole point.
    gap = _px(8, scale)
    slot_h = (camera.height - (count - 1) * gap) // count
    slots = inset_slots(Rect(camera.x, camera.y, camera.width, slot_h), count, gap)
    for index, (slot, image) in enumerate(zip(slots, images)):
        state = FUSED if frames[index].subjects else NO_HAND
        draw_camera_inset(canvas, image, frames[index], slot,
                          f"Camera {index + 1}" if count > 1 else "", state, draw, scale)

    # What to do now: the largest words on the screen.
    draw_glass(canvas, instruction, radius, scale)
    pad = _px(20, scale)
    write(canvas, "Aim Setup", (instruction.x + pad, instruction.y + _px(26, scale)),
          EYEBROW, LABEL_SECONDARY, scale)
    status, color = setup_status(session)
    status_y = instruction.bottom - _px(18, scale)
    first = instruction.y + _px(58, scale)
    style, lines = _fit_instruction(session.message, instruction.width - 2 * pad,
                                    status_y - _px(28, scale) - first, scale)
    step = _px(style.size * 1.25, scale)
    for index, line in enumerate(lines):
        write(canvas, line, (instruction.x + pad, first + index * step), style, LABEL, scale)
    dot = _px(4, scale)
    cv2.circle(canvas, (instruction.x + pad + dot,
                        status_y - round(type_size(SUBHEAD, scale) * CAP_HEIGHT / 2)),
               dot, color, -1, cv2.LINE_AA)
    status_w = write(canvas, status, (instruction.x + pad + dot * 2 + _px(8, scale),
                                      status_y), SUBHEAD, color, scale)
    keys = fit_hints(SETUP_KEYS, instruction.width - 2 * pad - status_w - _px(48, scale),
                     scale)
    if len(keys) == len(SETUP_KEYS):
        _draw_inline_hints(canvas, keys, instruction.right - pad - hints_width(keys, scale),
                           status_y, scale)

    # How far there is to go.
    draw_glass(canvas, progress, radius, scale)
    learned = LEARN_SHOTS if session.testing else min(len(session.samples), LEARN_SHOTS)
    hits = len(session.hits)
    write(canvas, "Step 2 of 2" if session.testing else "Step 1 of 2",
          (progress.x + pad, progress.y + _px(26, scale)), EYEBROW, LABEL_SECONDARY, scale)
    headline = (f"{hits} of {REQUIRED_HITS} bullseyes" if session.testing
                else f"{learned} of {LEARN_SHOTS} shots")
    write(canvas, headline, (progress.x + pad, progress.y + _px(58, scale)), TITLE_2, LABEL,
          scale)
    _draw_setup_pips(canvas, progress, learned, hits, session.testing, REQUIRED_HITS,
                     scale)

    if session.preview and session.aim.position:
        draw_crosshair(canvas, session.aim.position[0] * width,
                       session.aim.position[1] * height, session.aim.armed,
                       None, scale, pull=session.aim.travel, fire_at=0.5)


def _draw_inline_hints(canvas: np.ndarray, items, x: int, baseline: int,
                       scale: float) -> None:
    """Hints set on a panel's own line, keycaps and all, from ``x``."""
    for key, text in items:
        cap_w, cap_h = _keycap_width(key, scale), _px(18, scale)
        middle = baseline - round(type_size(FOOTNOTE, scale) * CAP_HEIGHT / 2)
        cap = Rect(x, middle - cap_h // 2, cap_w, cap_h)
        hairline(canvas, cap, _px(5, scale), LABEL_TERTIARY)
        write(canvas, key, (cap.x + cap_w // 2, baseline), FOOTNOTE, LABEL_SECONDARY, scale,
              align=CENTRE)
        x += cap_w + _px(6, scale)
        x += write(canvas, text, (x, baseline), FOOTNOTE, LABEL_SECONDARY, scale)
        x += _px(HINT_GAP, scale)


def _fit_instruction(message: str, width: int, room: int, scale: float
                     ) -> tuple[Style, list[str]]:
    """The instruction wrapped as large as it will go in the room it has."""
    for style in (TITLE_2, TITLE_3, HEADLINE):
        lines = wrap(message, style, width, scale)
        step = _px(style.size * 1.25, scale)
        if len(lines) * step <= room + step:
            return style, lines
    fits = max(1, (room + step) // step)
    if len(lines) > fits:
        lines = lines[:fits]
        lines[-1] = fit(lines[-1] + " …", style, width, scale)
    return style, lines


def _draw_setup_pips(canvas: np.ndarray, panel: Rect, learned: int, hits: int,
                     testing: bool, required: int, scale: float) -> None:
    """Both steps of setup as a row of pips: the shots that teach the aim, then
    the bullseyes that check it - done ones filled in the tint (progress), the
    next one ringed in white, the rest a hairline."""
    radius, pitch, group_gap = _px(7, scale), _px(22, scale), _px(18, scale)
    x = panel.x + _px(20, scale) + radius
    y = panel.bottom - _px(44, scale)
    label_y = panel.bottom - _px(16, scale)
    groups = ((LEARN_SHOTS, learned, not testing, "Learn"),
              (required, hits, testing, "Check"))
    for total, done, current, label in groups:
        start = x
        for index in range(total):
            if index < done:
                cv2.circle(canvas, (x, y), radius, TINT, -1, cv2.LINE_AA)
            elif current and index == done:
                cv2.circle(canvas, (x, y), radius, LABEL, _px(2, scale), cv2.LINE_AA)
            else:
                cv2.circle(canvas, (x, y), radius, LABEL_TERTIARY, 1, cv2.LINE_AA)
            x += pitch
        write(canvas, label, (start - radius, label_y), FOOTNOTE,
              LABEL if current else LABEL_SECONDARY, scale)
        x += group_gap


# --- choosing a map ---------------------------------------------------------

#: Cards in one row on the chooser. The game has four maps, and four across
#: reads as a line-up; more than this and the cards grow too narrow for a title.
CARDS_PER_ROW = 4

#: A card's corners, the gap between cards, and the room kept at the foot of
#: the screen for the hints and the wordmark, in 720-tall units.
CARD_RADIUS, CARD_GAP, FOOTER_BAND = 22, 20, 48

#: The camera's picture on the chooser, in 720-tall units (see app.PIP_HEIGHT).
CHOOSER_PICTURE = 96


def chooser_area(window: Rect, scale: float = 1.0, margin: int | None = None,
                 top: int | None = None) -> Rect:
    """Where the chooser's cards may go: under the row the camera's picture,
    the title and Quit share, above the hints, and across to the margins the
    picture and Quit stand on, so the grid lines up with both."""
    margin = screen_margin(window.height, scale) if margin is None else margin
    if top is None:
        top = window.y + margin + _px(CHOOSER_PICTURE, scale)
    top += _px(36, scale)
    bottom = window.bottom - margin - _px(FOOTER_BAND, scale)
    return Rect(window.x + margin, top, max(1, window.width - 2 * margin),
                max(1, bottom - top))


def map_cards(window: Rect, count: int, scale: float = 1.0,
              area: Rect | None = None) -> tuple[Rect, ...]:
    """Where the cards sit. Drawing and shooting both read this.

    Up to four across in one row, filling ``area`` (by default
    :func:`chooser_area`); beyond that two rows, every card the same size and
    a short last row centred under the first. No slot is ever left empty to
    be filled with a placeholder: a grid with holes in it looks unfinished.
    """
    area = area or chooser_area(window, scale)
    gap = _px(CARD_GAP, scale)
    columns = count if count <= CARDS_PER_ROW else (count + 1) // 2
    columns = max(1, columns)
    rows = (count + columns - 1) // columns
    # A card is never zero-sized: everything downstream slices the canvas with
    # these, and an empty slice is a silent no-op rather than an obvious error.
    width = max(1, (area.width - gap * (columns - 1)) // columns)
    height = max(1, (area.height - gap * (rows - 1)) // rows)
    # On a squarish window the cards would turn into ribbons: keep them no
    # taller than a playing card and centre the grid in the room left.
    height = min(height, max(1, int(width * 1.6)))
    grid_height = rows * height + (rows - 1) * gap
    top = area.y + (area.height - grid_height) // 2
    cards = []
    for row in range(rows):
        in_row = min(columns, count - row * columns)
        if in_row == columns and columns > 1:
            # A full row stands exactly on both margins: the pixels the
            # division leaves over go into the gaps, not beside the row.
            lefts = [area.x + round(column * (area.width - width) / (columns - 1))
                     for column in range(columns)]
        else:
            row_width = in_row * width + (in_row - 1) * gap
            left = area.x + (area.width - row_width) // 2
            lefts = [left + column * (width + gap) for column in range(in_row)]
        for left in lefts:
            cards.append(Rect(left, top + row * (height + gap), width, height))
    return tuple(cards)


# Chooser thumbnails are establishing shots: no burnt-in titles, no gameplay
# popups, no bezels. Where a map's card art carries those, the art is drawn
# on a larger sheet and a clean frame is cut from it. Keyed by the module the
# art comes from, as (sheet width, sheet height, crop x, crop y), all as
# fractions of the frame's own size.
_CLEAN_FRAMES = {
    "western": (1.0, 2.3, 0.0, 0.0),       # the doorways, above the title
    "archery": (1.25, 1.5, 0.15, 0.4),     # below the floating "+10"
    "orbit": (1.6, 1.0, 0.6, 0.0),         # the right reach, clear of the title
}


def _clean_frame(emblem, width: int, height: int) -> np.ndarray:
    """The art drawn by ``emblem``, cut to a frame free of overlays."""
    key = str(getattr(emblem, "__module__", "")).rsplit(".", 1)[-1]
    sheet_w, sheet_h, at_x, at_y = _CLEAN_FRAMES.get(key, (1.0, 1.0, 0.0, 0.0))
    sheet = np.zeros((max(height, int(height * sheet_h)),
                      max(width, int(width * sheet_w)), 3), np.uint8)
    emblem(sheet)
    x0 = min(int(width * at_x), sheet.shape[1] - width)
    y0 = min(int(height * at_y), sheet.shape[0] - height)
    return sheet[y0:y0 + height, x0:x0 + width].copy()


def _normalised(panel: np.ndarray) -> np.ndarray:
    """One contrast curve and one level of detail for every thumbnail.

    The maps draw in very different keys - a foggy road, a sunlit valley -
    and cut straight from their art the cards look like they came from
    different games. The levels are stretched so the darkest and brightest
    percentiles of each land in the same places, and a light unsharp mask
    brings the soft ones up to the crisp ones.
    """
    grey = cv2.cvtColor(panel, cv2.COLOR_BGR2GRAY)
    low, high = np.percentile(grey, (1.5, 99.2))
    # The gain is capped: a deliberately flat, dim picture is lifted, not
    # blown out into noise.
    gain = min(228.0 / max(high - low, 1.0), 1.8)
    image = (panel.astype(np.float32) - low) * gain + 10.0
    # Anything the art bakes in bright green - a reticle, a hit marker - is
    # turned white: green means one thing in this game, a gun that is ready,
    # and a card is not a gun.
    b, g, r = image[:, :, 0], image[:, :, 1], image[:, :, 2]
    green = np.clip((g - np.maximum(r, b) - 30.0) / 60.0, 0, 1)[:, :, None]
    white = (g * 0.92)[:, :, None]
    image = image * (1 - green) + white * green
    blurred = cv2.GaussianBlur(image, (0, 0), max(1.0, panel.shape[1] * 0.003))
    image = image + (image - blurred) * 0.6
    return np.clip(image, 0, 255).astype(np.uint8)


@lru_cache(maxsize=16)
def _thumbnail(emblem, title: str, width: int, height: int) -> np.ndarray:
    """A map's card art, framed clean and given the one thumbnail treatment:
    a vignette, and the foot settled towards the card's surface so the name
    below reads as part of the same card."""
    del title  # the frame is chosen by the art's source, not its caption
    panel = _normalised(_clean_frame(emblem, width, height)).astype(np.float32)

    # Vignette: the corners fall away so the eye settles in the middle.
    ys = (np.arange(height, dtype=np.float32) / height - 0.5) * 2
    xs = (np.arange(width, dtype=np.float32) / width - 0.5) * 2
    d2 = xs[None, :] ** 2 * 0.55 + ys[:, None] ** 2
    vignette = 1.0 - 0.38 * np.clip(d2 - 0.35, 0, 1.5) / 1.5
    panel *= vignette[:, :, None]
    fade = max(1, height // 3)
    ramp = np.linspace(0.0, 0.7, fade, dtype=np.float32)[:, None, None] ** 1.6
    panel[-fade:] = panel[-fade:] * (1 - ramp) + np.float32(SURFACE) * ramp
    panel = np.clip(panel, 0, 255).astype(np.uint8)
    panel.flags.writeable = False
    return panel


@lru_cache(maxsize=16)
def _card_face(emblem, title: str, width: int, height: int, art_height: int
               ) -> np.ndarray:
    """A card without its words: the art over the surface, built once."""
    face = np.empty((height, width, 3), np.uint8)
    face[:] = SURFACE
    face[:art_height] = _thumbnail(emblem, title, width, art_height)
    face.flags.writeable = False
    return face


def card_art_height(rect: Rect, scale: float = 1.0) -> int:
    """How much of a card its art takes: over half, never taller than it is
    wide, and never so much that the words below lose their room."""
    return int(max(rect.height * 0.38, min(rect.height * 0.58, rect.width * 0.95,
                                           rect.height - _px(150, scale))))


def draw_map_card(canvas: np.ndarray, rect: Rect, title: str, blurb: str,
                  best: str, emblem, lift: float = 0.0, scale: float = 1.0) -> None:
    """One game's card: its art, its name, a line or two about it, the best.

    ``lift`` (0 to 1) is how far along the card is to being the one the
    crosshair is on: it rises a little on a soft shadow, and a white ring
    stands just off it.
    """
    radius = _px(CARD_RADIUS, scale)
    rect = Rect(rect.x, rect.y - round(lift * _px(6, scale)), rect.width, rect.height)
    if lift > 0.0:
        _panel_shadow(canvas, rect, radius, _px(10 + 10 * lift, scale))
    art_height = card_art_height(rect, scale)
    height, width = canvas.shape[:2]
    face = _card_face(emblem, title, rect.width, rect.height, art_height)
    _composite(canvas, rect, face[max(0, -rect.y):max(0, min(rect.height, height - rect.y)),
                                  max(0, -rect.x):max(0, min(rect.width, width - rect.x))],
               radius)

    pad = _px(20, scale)
    inner = rect.width - 2 * pad
    x = rect.x + pad
    name = title_case(title)
    style = TITLE_2
    if measure(name, style, scale) > inner:
        style = TITLE_3
    write(canvas, fit(name, style, inner, scale), (x, rect.y + art_height + _px(34, scale)),
          style, LABEL, scale)
    best_at = rect.bottom - _px(20, scale)
    first = rect.y + art_height + _px(60, scale)
    step = _px(20, scale)
    room = max(1, (best_at - _px(24, scale) - first) // step + 1)
    lines = wrap(blurb, SUBHEAD, inner, scale)
    if len(lines) > room:
        # Cut at a word, and say so, rather than stop mid-thought.
        lines = lines[:room]
        lines[-1] = fit(lines[-1] + " …", SUBHEAD, inner, scale)
    for index, line in enumerate(lines):
        write(canvas, line, (x, first + index * step), SUBHEAD, LABEL_SECONDARY, scale)
    write(canvas, fit(best, FOOTNOTE, inner, scale), (x, best_at), FOOTNOTE,
          LABEL_TERTIARY, scale)

    if lift > 0.0:
        ring = _px(5, scale)
        tone = tuple(int(c * lift) for c in LABEL)
        hairline(canvas, Rect(rect.x - ring, rect.y - ring, rect.width + 2 * ring,
                              rect.height + 2 * ring), radius + ring, tone, _px(2, scale))
    hairline(canvas, rect, radius, hairline_over(SURFACE))


def draw_card_select(canvas: np.ndarray, cards: tuple, entries: tuple,
                     aimed: int | None, title: str, subtitle: str,
                     scale: float = 1.0, lifts: Sequence[float] | None = None,
                     top: int | None = None) -> None:
    """A row of cards to choose between, the one aimed at lifted.

    ``lifts`` says how far each card has risen (the app eases them); without
    it the aimed card is simply up. The title and the line under it are
    centred in the row above the cards, from ``top``.
    """
    draw_backdrop(canvas)
    height, width = canvas.shape[:2]
    margin = screen_margin(height, scale)
    top = margin if top is None else top
    band = _px(CHOOSER_PICTURE, scale)
    write(canvas, title, (width // 2, top + band // 2 + _px(2, scale)), TITLE_1, LABEL,
          scale, align=CENTRE)
    write(canvas, subtitle, (width // 2, top + band // 2 + _px(28, scale)), SUBHEAD,
          LABEL_SECONDARY, scale, align=CENTRE)
    for index, (rect, entry) in enumerate(zip(cards, entries)):
        lift = (lifts[index] if lifts is not None and index < len(lifts)
                else float(index == aimed))
        draw_map_card(canvas, rect, *entry, lift=lift, scale=scale)
    draw_logo(canvas, scale)


CHOOSER_TITLE = "Choose a Game"
CHOOSER_SUBTITLE = "Point at a game and fire."


def draw_map_select(canvas: np.ndarray, cards: tuple, entries: tuple,
                    aimed: int | None, scale: float = 1.0,
                    lifts: Sequence[float] | None = None, top: int | None = None) -> None:
    """The map chooser: shoot the one you want to play."""
    draw_card_select(canvas, cards, entries, aimed, CHOOSER_TITLE, CHOOSER_SUBTITLE,
                     scale, lifts, top)
