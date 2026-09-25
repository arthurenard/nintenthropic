"""Everything the player sees: range, targets, crosshair, HUD and buttons."""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache

import cv2
import numpy as np

from collections.abc import Sequence

from .aiming import Aim
from .game import Rect, Round, Summary
from .recognition import Frame
from .rendering import draw_hands, draw_text, text_width

# Colours are BGR.
BACKDROP = (28, 26, 24)
GRID = (40, 38, 36)
PANEL = (46, 43, 40)
PANEL_DEEP = (34, 32, 30)
EDGE = (74, 70, 66)
INK = (236, 236, 236)
MUTED = (150, 146, 142)
ACCENT = (96, 168, 236)  # warm amber: the thin chrome lines of every screen
ARMED = (120, 230, 130)
IDLE = (150, 150, 150)
MISS = (120, 120, 190)
DANGER = (70, 70, 220)

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
    """A clickable, and shootable, rectangle."""

    rect: Rect
    label: str

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


@lru_cache(maxsize=6)
def _backdrop_image(width: int, height: int) -> np.ndarray:
    """The grid, vignetted towards the corners. Built once per window size."""
    image = np.empty((height, width, 3), np.uint8)
    image[:] = (BACKDROP[0] + 6, BACKDROP[1] + 6, BACKDROP[2] + 6)
    for x in range(0, width, 64):
        cv2.line(image, (x, 0), (x, height), GRID, 1)
    for y in range(0, height, 64):
        cv2.line(image, (0, y), (width, y), GRID, 1)
    for x in range(0, width, 64 * 4):
        cv2.line(image, (x, 0), (x, height), (46, 44, 42), 1)
    for y in range(0, height, 64 * 4):
        cv2.line(image, (0, y), (width, y), (46, 44, 42), 1)
    return (image.astype(np.float32) * _vignette(width, height)).astype(np.uint8)


def draw_backdrop(canvas: np.ndarray) -> None:
    """The neutral grid used by the range and by every menu screen."""
    height, width = canvas.shape[:2]
    canvas[:] = _backdrop_image(width, height)


# --- the ambient backdrop: the map in play, dimmed, behind the card ---------
#
# The results card used to sit on the bare grid, which made it look like any
# tool's dialog. Given the map's own card art it sits in the world the round
# was played in instead: the art is blown up, blurred, dimmed and vignetted
# until it is a mood rather than a picture. The app sets the art when a map is
# picked and clears it on the way out, so the chooser - which belongs to no map
# - keeps the plain grid.

_ambient_art = None  # the emblem callable of the map in play, or None


def set_ambient_art(emblem) -> None:
    """Tell the menus which map is in play, so its art can sit behind them.

    ``None`` puts the plain grid back. Called by :mod:`handy.app`; a module
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
    # Dim towards the backdrop, keeping a little of the art's colour.
    dimmed = image.astype(np.float32) * 0.38 + np.array(BACKDROP, np.float32) * 0.5
    dimmed = dimmed * _vignette(width, height, 0.35)
    # The grid shows faintly through, so the screen is still recognisably
    # the same family as every other menu.
    grid = _backdrop_image(width, height).astype(np.float32)
    return np.clip(dimmed * 0.8 + grid * 0.3, 0, 255).astype(np.uint8)


def ambient_backdrop_for(emblem, width: int, height: int) -> np.ndarray:
    """One map's dimmed art at this size, built once and kept.

    Public so the warm-up thread can pay for the build at launch: it takes a
    tenth of a second, and the moment it is wanted is the moment a round ends.
    """
    return _ambient_image(emblem, width, height)


def draw_ambient_backdrop(canvas: np.ndarray) -> None:
    """The map in play as a dim, blurred backdrop; the plain grid if none is."""
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
    width = figures_width(text, size)
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


# --- the logo ---------------------------------------------------------------
#
# One lockup on every screen, in the same corner: the finger-pistol glyph, the
# wordmark, and the accent bar beneath. The game's identity, not just a face.

@lru_cache(maxsize=8)
def _logo_glyph(size: int) -> tuple[np.ndarray, np.ndarray]:
    """The finger-pistol glyph, ``size`` pixels tall, as (BGR, alpha) at 2x
    then brought down, so the small silhouette keeps clean edges."""
    big = size * 2
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
    image = np.zeros((h, w, 3), np.uint8)
    image[:] = INK
    # The muzzle dot, in the accent: the one touch of colour in the mark.
    spark = np.zeros((h, w), np.uint8)
    cv2.circle(spark, (cx - int(u * 1.95), cy - int(u * 0.1)), int(u * 0.22), 255, -1,
               cv2.LINE_AA)
    image[spark > 0] = ACCENT
    alpha = cv2.max(mask, spark)
    small = (size * 160 // 100, size)
    return (cv2.resize(image, small, interpolation=cv2.INTER_AREA),
            cv2.resize(alpha, small, interpolation=cv2.INTER_AREA))


def _paste(canvas: np.ndarray, image: np.ndarray, alpha: np.ndarray,
           x: int, y: int) -> None:
    h, w = alpha.shape
    x0, y0 = max(x, 0), max(y, 0)
    x1, y1 = min(x + w, canvas.shape[1]), min(y + h, canvas.shape[0])
    if x1 <= x0 or y1 <= y0:
        return
    region = canvas[y0:y1, x0:x1]
    a = alpha[y0 - y:y1 - y, x0 - x:x1 - x].astype(np.float32)[:, :, None] / 255.0
    src = image[y0 - y:y1 - y, x0 - x:x1 - x]
    region[:] = (region * (1 - a) + src * a).astype(np.uint8)


def logo_size(scale: float) -> tuple[int, int]:
    """Width and height of the lockup, for anything laying out around it."""
    glyph = _px(20, scale)
    return (int(glyph * 1.6) + _px(10, scale) + text_width("HANDY", 0.75 * scale, 2, False)
            + _px(8, scale), glyph + _px(8, scale))


def draw_logo(canvas: np.ndarray, scale: float = 1.0, alpha: float = 1.0) -> None:
    """The lockup, bottom right on every screen: glyph, wordmark, accent bar.

    Laid from a sprite built once per size, so it can sit on every frame of a
    round - and fade, at ``alpha`` - for the price of one small blend.
    """
    if alpha <= 0.0:
        return
    colour, keep, cover = _logo_sprite(round(scale, 4))
    height, width = canvas.shape[:2]
    h, w = cover.shape
    if h > height or w > width:
        _draw_logo_lockup(canvas, scale)
        return
    region = canvas[height - h:, width - w:]
    if alpha < 1.0:
        cover = cover * np.float32(alpha)
        keep = np.float32(1.0) - cover
    cv2.blendLinear(region, colour, keep, cover, dst=region)


@lru_cache(maxsize=4)
def _logo_sprite(scale: float) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """The lockup as colour and coverage, for the bottom-right corner.

    Drawn once over black and once over white: where the two agree the mark
    is solid, and how far they differ is how much of the ground shows
    through - which recovers the anti-aliased edges exactly.
    """
    total_w, total_h = logo_size(scale)
    w = total_w + _px(24, scale) + 4
    h = total_h + _px(20, scale) + _px(12, scale)
    dark = np.zeros((h, w, 3), np.uint8)
    light = np.full((h, w, 3), 255, np.uint8)
    _draw_logo_lockup(dark, scale)
    _draw_logo_lockup(light, scale)
    showing = (light.astype(np.float32) - dark.astype(np.float32)).max(axis=2) / 255.0
    cover = np.clip(1.0 - showing, 0.0, 1.0).astype(np.float32)
    colour = np.clip(dark.astype(np.float32) / np.maximum(cover, 1e-3)[:, :, None], 0, 255)
    colour = colour.astype(np.uint8)
    keep = np.float32(1.0) - cover
    for array in (colour, keep, cover):
        array.flags.writeable = False  # shared by every frame from here on
    return colour, keep, cover


def _draw_logo_lockup(canvas: np.ndarray, scale: float = 1.0) -> None:
    height, width = canvas.shape[:2]
    glyph_h = _px(20, scale)
    image, alpha = _logo_glyph(glyph_h)
    total_w, _ = logo_size(scale)
    x = width - _px(24, scale) - total_w
    # Baseline shared with the footer; the whole mark stays inside the band
    # the choosers leave beneath their cards.
    baseline = height - _px(20, scale)
    _paste(canvas, image, alpha, x, baseline - glyph_h + _px(2, scale))
    text_x = x + alpha.shape[1] + _px(10, scale)
    # The wordmark, tracked a little, then the accent bar under it.
    text_scale = 0.75 * scale
    cursor = text_x
    for letter in "HANDY":
        draw_text(canvas, letter, (cursor, baseline), INK, scale=text_scale,
                  thickness=2, outline=False)
        cursor += text_width(letter, text_scale, 2, False) + _px(2, scale)
    cv2.line(canvas, (text_x, baseline + _px(7, scale)),
             (cursor - _px(2, scale), baseline + _px(7, scale)), ACCENT, _px(2, scale),
             cv2.LINE_AA)


def draw_crosshair(canvas: np.ndarray, x: float, y: float, armed: bool,
                   since_shot: float | None, scale: float = 1.0,
                   pull: float = 0.0, fire_at: float = 0.65) -> None:
    center = (int(x), int(y))
    color = ARMED if armed else IDLE
    weight = _px(2, scale)
    thin = _px(1, scale)
    radius = round(20 * scale)

    # How far the trigger has come, drawn as an arc filling the ring. Without it
    # a trigger that never quite reaches its threshold is indistinguishable from
    # one that is not reading anything at all.
    if fire_at > 0 and pull > 0.03:
        fraction = min(pull / fire_at, 1.0)
        cv2.ellipse(canvas, center, (radius + weight + 2, radius + weight + 2),
                    -90.0, 0.0, 360.0 * fraction,
                    ARMED if fraction >= 1.0 else INK, weight, cv2.LINE_AA)

    # A ring broken at the four compass points, hairline ticks reaching out of
    # the gaps, and a dot in the middle: open enough to see the target through.
    for start in (10, 100, 190, 280):
        cv2.ellipse(canvas, center, (radius, radius), 0, start, start + 70, color,
                    weight, cv2.LINE_AA)
    cv2.circle(canvas, center, max(1, round(2 * scale)), color, -1, cv2.LINE_AA)
    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        inner = (center[0] + round(dx * 9 * scale), center[1] + round(dy * 9 * scale))
        outer = (center[0] + round(dx * 30 * scale), center[1] + round(dy * 30 * scale))
        cv2.line(canvas, inner, outer, color, thin, cv2.LINE_AA)
        tip = (center[0] + round(dx * 25 * scale), center[1] + round(dy * 25 * scale))
        cv2.line(canvas, tip, outer, color, weight, cv2.LINE_AA)

    if since_shot is not None and since_shot < RECOIL:
        # Muzzle flash: a ring kicking outwards right after the thumb drops.
        kick = since_shot / RECOIL
        overlay = canvas.copy()
        cv2.circle(overlay, center, round((20 + 34 * kick) * scale), ARMED, weight,
                   cv2.LINE_AA)
        blend(canvas, overlay, 1.0 - kick)


def inset_slots(rect: Rect, count: int) -> tuple[Rect, ...]:
    """Split the corner between the cameras, stacked, keeping the same footprint."""
    count = max(count, 1)
    height = rect.height // count
    return tuple(Rect(rect.x, rect.y + index * height, rect.width, height - 2)
                 for index in range(count))


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
    source_height, source_width = image.shape[:2]
    copied = False
    while source_width >= width * 2 and source_height >= height * 2 and width and height:
        image = cv2.pyrDown(image)
        source_height, source_width = image.shape[:2]
        copied = True
    if (source_width, source_height) != (width, height):
        return cv2.resize(image, (width, height), interpolation=cv2.INTER_LINEAR)
    # Callers draw the skeleton onto what comes back, so never hand them the
    # camera's own buffer.
    return image if copied else image.copy()


#: What one camera is contributing this frame.
FUSED = "fused"
NO_HAND = "no hand"
IGNORED = "ignored"

STATE_COLORS = {FUSED: ARMED, NO_HAND: MUTED, IGNORED: DANGER}


def draw_camera_inset(canvas: np.ndarray, camera: np.ndarray, hands: Frame,
                      rect: Rect, label: str = "", state: str = FUSED,
                      draw=None, scale: float = 1.0) -> None:
    """Draw one webcam feed, with whatever is being tracked on it, into ``rect``."""
    inset = shrink(camera, rect.width, rect.height)
    (draw or _default_draw)(inset, hands, 0.5 * scale)
    # The same panel treatment as every card: a soft shadow beneath, rounded
    # corners, a hairline edge and a 1px inner stroke in the state colour.
    radius = _px(CORNER * 0.7, scale)
    _panel_shadow(canvas, rect, radius, _px(12, scale))
    cv2.copyTo(inset, _thumbnail_mask(rect.width, rect.height, radius, True),
               canvas[rect.y:rect.bottom, rect.x:rect.right])
    color = STATE_COLORS.get(state, MUTED)
    stroke_rounded(canvas, Rect(rect.x + 1, rect.y + 1, rect.width - 2, rect.height - 2),
                   color, radius, 1)
    stroke_rounded(canvas, rect, EDGE, radius, 1)
    cv2.line(canvas, (rect.x + _px(10, scale), rect.y), (rect.x + _px(46, scale), rect.y),
             color, _px(2, scale), cv2.LINE_AA)
    if label:
        draw_tag(canvas, label, (rect.x + _px(8, scale), rect.y + _px(28, scale)), color,
                 scale)
    if state != FUSED:
        # Said on the picture itself: this is where a player looks to see why
        # the crosshair has gone.
        draw_tag(canvas, state.upper(), (rect.x + _px(8, scale), rect.bottom - _px(8, scale)),
                 color, scale)


TAG_SCALE = 0.42  # a tag's text, at 720 tall


def tag_width(text: str, scale: float = 1.0, dot: bool = True) -> int:
    """How wide :func:`draw_tag` makes the pill for ``text``."""
    size = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, TAG_SCALE * scale, 1)[0]
    return _px(22 if dot else 10, scale) + size[0] + _px(9, scale)


def draw_tag(canvas: np.ndarray, text: str, corner: tuple[int, int],
             color: tuple[int, int, int], scale: float = 1.0, dot: bool = True) -> Rect:
    """A small dark pill - a dot in ``color``, then the text - bottom-left at
    ``corner``. Returns the pill.

    Small text laid over a picture goes on one of these rather than in a dark
    halo: OpenCV sets the halo's heavier stroke with wider advances, so along
    a line of thin text the two drift apart and the words read doubled.
    """
    size = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, TAG_SCALE * scale, 1)[0]
    height = _px(20, scale)
    pill = Rect(corner[0], corner[1] - height, tag_width(text, scale, dot), height)
    shade_panel(canvas, pill, height // 2, (30, 29, 28), (18, 17, 16), None)
    mid = pill.y + height // 2
    if dot:
        cv2.circle(canvas, (pill.x + _px(11, scale), mid), _px(3, scale), color, -1,
                   cv2.LINE_AA)
    draw_text(canvas, text, (pill.x + _px(20 if dot else 10, scale), mid + size[1] // 2),
              color, scale=TAG_SCALE * scale, thickness=1, outline=False)
    return pill


def draw_camera_insets(canvas: np.ndarray, images: Sequence[np.ndarray],
                       hands: Sequence[Frame], rect: Rect,
                       states: Sequence[str] = (), draw=None,
                       scale: float = 1.0) -> None:
    """Every camera in the corner, so you can see what each of them is doing."""
    slots = inset_slots(rect, len(images))
    for index, (slot, image) in enumerate(zip(slots, images)):
        label = f"CAM {index + 1}" if len(images) > 1 else ""
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



def draw_button(canvas: np.ndarray, button: Button, highlighted: bool = False,
                scale: float = 1.0) -> None:
    rect = button.rect
    radius = _px(CORNER * 0.7, scale)
    # One neutral style for every button; the highlighted one is lit a little
    # brighter with a longer accent tab, never a different colour of button.
    if highlighted:
        shade_panel(canvas, rect, radius, (74, 70, 66), (44, 41, 38), (110, 104, 98))
        tab = round(rect.width * 0.6)
    else:
        shade_panel(canvas, rect, radius, (50, 47, 44), (32, 30, 28), EDGE)
        tab = round(rect.width * 0.28)
    # A short accent tab on the top edge: the one touch of colour at rest.
    cv2.line(canvas, (rect.x + (rect.width - tab) // 2, rect.y),
             (rect.x + (rect.width + tab) // 2, rect.y), ACCENT, _px(2, scale),
             cv2.LINE_AA)
    text_scale = 0.62 * scale
    thickness = _px(2, scale)
    size = cv2.getTextSize(button.label, cv2.FONT_HERSHEY_SIMPLEX, text_scale,
                           thickness)[0]
    origin = (rect.x + (rect.width - size[0]) // 2,
              rect.y + (rect.height + size[1]) // 2)
    draw_text(canvas, button.label, origin, INK, scale=text_scale,
              thickness=thickness, outline=False)



def draw_hud(canvas: np.ndarray, round_: Round, aim: Aim, origin: tuple[int, int],
             fps: float | None, debug: bool,
             camera_states: Sequence[str] = (), scale: float = 1.0,
             fire_at: float = 0.65, rule: bool = True) -> None:
    """The score block beside the camera: the score, and the tally under it.

    There is no "ready" line: the crosshair already turns green when the gun
    is cocked, right where the player is looking, and a second indicator in
    the corner only competed with it. Nor is the camera talked about here -
    a lost hand is said on the camera's own preview, where the player looks
    to see why. Under --debug a line of measurements sits low on the right.
    """
    x, y = origin[0] + _px(14, scale), origin[1]

    def line(offset: float) -> int:
        return y + round(offset * scale)

    if rule:
        # A slim accent bar down the left of the block, tying the lines into
        # one readout rather than stray strings of text.
        cv2.line(canvas, (x - _px(10, scale), line(10)), (x - _px(10, scale), line(104)),
                 ACCENT, _px(2, scale), cv2.LINE_AA)
    draw_text(canvas, "SCORE", (x, line(HUD_LINES["label"])), ACCENT,
              scale=0.42 * scale, thickness=1, outline=False)
    draw_figures(canvas, str(round_.score), (x, line(HUD_LINES["score"])), INK,
                 _px(HUD_FIGURES, scale), 0.05)
    draw_caption(canvas, hud_tally(round_), (x, line(HUD_LINES["tally"])), SECONDARY,
                 HUD_TALLY * scale)

    if debug:
        # How far the thumb has folded, against the threshold it must cross.
        detail = f"trigger {aim.travel:+.2f} of {fire_at:.2f}"
        if aim.cameras > 1:
            # Spread is what the cameras disagree by.
            detail += f"   spread {aim.spread * 100:.1f}%"
        if fps is not None:
            detail += f"   {fps:.0f} fps"
        summary, _ = camera_summary(camera_states)
        # In a corner of its own, low on the right, clear of every map's
        # readout under the score.
        text = f"{detail}   {summary}"
        height, width = canvas.shape[:2]
        draw_tag(canvas, text, (width - _px(16, scale) - tag_width(text, scale, False),
                                height - _px(64, scale)), INK, scale, dot=False)


#: Where each line of the score block sits, in 720-tall units below the HUD's
#: origin. The app sizes the panel under the block from these.
HUD_LINES = {"label": 22, "score": 64, "tally": 88}
HUD_FIGURES = 40  # the score's height, in 720-tall units
HUD_TALLY = 0.46  # the tally line's text scale, at 720 tall

#: Secondary text on a chrome panel: a step brighter than MUTED, which was
#: picked for the flat menu panels and sinks on a translucent one.
SECONDARY = (196, 192, 188)


def hud_tally(round_: Round) -> str:
    """The line under the score: hits out of shots, and the accuracy."""
    return f"{round_.hits}/{round_.shots} hits   {round_.accuracy:.0%}"


def hud_block_width(round_: Round, scale: float = 1.0) -> int:
    """How wide the score block is right now, in pixels, margins included.

    Never narrower than a tally of two- and three-digit counts, so the panel
    under it holds its width through a round rather than twitching wider with
    every digit a count gains.
    """
    content = max(figures_width(str(round_.score), _px(HUD_FIGURES, scale)),
                  caption_width(hud_tally(round_), HUD_TALLY * scale),
                  caption_width("88/888 hits   88%", HUD_TALLY * scale))
    return _px(14, scale) + content + _px(16, scale)


def camera_note(states: Sequence[str]) -> tuple[str, tuple] | None:
    """:func:`camera_summary`, when there is something worth saying.

    One camera is the ordinary case and needs no words beside it - "1 camera"
    in the corner of every frame read as debug output - and when it loses the
    hand its own preview says so. Several cameras are always accounted for,
    since which of them is contributing changes frame to frame.
    """
    if len(states) < 2:
        return None
    return camera_summary(states)



def timer_left(width: int, remaining: float | None, scale: float = 1.0) -> int:
    """Where the clock's chrome starts on the left, ticks included, so what
    sits beside it can stop short."""
    if remaining is None:
        text_w = cv2.getTextSize("PRACTICE", cv2.FONT_HERSHEY_SIMPLEX, 0.7 * scale, 2)[0][0]
    else:
        text = f"{int(remaining) // 60}:{int(remaining) % 60:02d}"
        text_w = figures_width(text, _px(40, scale))
    return (width - text_w) // 2 - _px(22, scale) - _px(28, scale)


def draw_timer(canvas: np.ndarray, remaining: float | None,
               scale: float = 1.0) -> None:
    """The round clock, centred at the top. It turns red as it runs out."""
    width = canvas.shape[1]
    urgent = remaining is not None and remaining <= 10.0
    if remaining is None:
        text, color = "PRACTICE", MUTED
        size = 0.7 * scale
        text_w, text_h = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, size, 2)[0]
    else:
        text = f"{int(remaining) // 60}:{int(remaining) % 60:02d}"
        color = DANGER if urgent else INK
        size = _px(40, scale)
        text_w, text_h = figures_width(text, size), int(size * 0.72)
    pad = _px(22, scale)
    pill = Rect((width - text_w) // 2 - pad, _px(14, scale), text_w + 2 * pad,
                text_h + _px(26, scale))
    # Only the pill's own patch is copied and blended, with a few pixels over
    # for the anti-aliased rim. A copy of the whole frame blends back to
    # exactly what it was everywhere else - at the cost of the whole frame.
    # The patch starts on even coordinates: the rounded ends are traced with
    # round-half-to-even, so an odd shift would move some of their points.
    height, rim = canvas.shape[0], 3
    x0, y0 = max(pill.x - rim, 0) & ~1, max(pill.y - rim, 0) & ~1
    x1, y1 = min(pill.right + rim + 1, width), min(pill.bottom + rim + 1, height)
    region = canvas[y0:y1, x0:x1]
    halo = region.copy()
    shade_panel(halo, Rect(pill.x - x0, pill.y - y0, pill.width, pill.height),
                pill.height // 2, CHROME_TOP, CHROME_BOTTOM, EDGE)
    blend(region, halo, CHROME_OPACITY)
    # Accent ticks either side of the clock, red once it is nearly over.
    tick = DANGER if urgent else ACCENT
    mid = pill.y + pill.height // 2
    for side in (-1, 1):
        x0 = pill.x + (pill.width if side > 0 else 0) + side * _px(10, scale)
        cv2.line(canvas, (x0, mid), (x0 + side * _px(18, scale), mid), tick,
                 _px(1, scale), cv2.LINE_AA)
    baseline = pill.y + pill.height - _px(13, scale)
    if remaining is None:
        draw_text(canvas, text, ((width - text_w) // 2, baseline), color, scale=size,
                  thickness=2, outline=False)
    else:
        draw_figures(canvas, text, ((width - text_w) // 2, baseline), color, size, 0.05)



#: The score card's body, and the band of map art above it, in 720-tall units.
RESULTS_WIDTH, RESULTS_BODY, RESULTS_BANNER = 760, 384, 128


def results_card(width: int, height: int, scale: float = 1.0,
                 banner: bool = True) -> Rect:
    """Where the score card sits in a window this size."""
    card_w = min(width - 2 * _px(60, scale), _px(RESULTS_WIDTH, scale))
    card_h = _px(RESULTS_BODY + (RESULTS_BANNER if banner else 0), scale)
    return Rect((width - card_w) // 2, (height - card_h) // 2, card_w, card_h)


def round_length(duration: float | None) -> str:
    """A round's length as the card names it: bests are kept per length."""
    if duration is None:
        return "PRACTICE"
    return f"{int(round(duration))}-SECOND ROUND"


def draw_results(canvas: np.ndarray, summary: Summary, best: int,
                 is_best: bool, hint: str = "", scale: float = 1.0,
                 title: str = "", emblem=None) -> None:
    """The end-of-round card, on the map's own art dimmed to a mood.

    Deliberately not drawn over a frozen frame of the range: that frame carries
    its own score and clock in the HUD, and two sets of numbers on one screen
    read as a bug however far the picture behind is dimmed. The map's card art,
    blurred and darkened, keeps the screen in the game without that problem.

    Given the map's ``title`` and card art (``emblem``), the card leads with
    them: a card that is screenshotted and passed round has to say what was
    played, not only how well.
    """
    draw_ambient_backdrop(canvas)
    height, width = canvas.shape[:2]

    banner = emblem is not None
    card = results_card(width, height, scale, banner)
    radius = _px(CORNER, scale)
    _panel_shadow(canvas, card, radius, _px(18, scale))
    _modal_panel(canvas, card, radius, scale)
    inner = _px(28, scale)

    heading = summary.outcome or "SCORE"
    # Half the outcomes a map can name are the good ending - a night survived,
    # a pane held, a street cleaned up - so the map says which it is rather
    # than the card guessing from the fact that there is one at all.
    heading_color = (ARMED if summary.won
                     else DANGER if summary.outcome else ACCENT)

    body = card.y
    if banner:
        body = card.y + _px(RESULTS_BANNER, scale)
        _draw_results_banner(canvas, Rect(card.x, card.y, card.width, body - card.y),
                             title, emblem, summary.duration, radius, scale)
    elif title:
        _centred_text(canvas, title, card.y + _px(40, scale), INK, 0.7 * scale)
        body = card.y + _px(28, scale)
    # The short bright tab at the top left, the mark every panel carries.
    cv2.line(canvas, (card.x + inner, card.y), (card.x + inner + _px(46, scale), card.y),
             heading_color, _px(2, scale), cv2.LINE_AA)

    top = body + _px(50, scale)
    accent_rule(canvas, top - _px(8, scale), card.x + inner, card.right - inner,
                heading_color, 1, gap=text_width(heading, 0.75 * scale) + _px(40, scale))
    _centred_text(canvas, heading, top, heading_color, 0.75 * scale)

    score = str(summary.score)
    size = _px(84, scale)
    draw_figures(canvas, score, ((width - figures_width(score, size)) // 2,
                                 top + _px(96, scale)), INK, size, 0.045)

    # A record has to be a score: an unshot round that "beats" an empty
    # table is nobody's best, whatever the caller was told.
    if is_best and summary.score > 0:
        label, color = "NEW BEST", ARMED
    elif best:
        label, color = f"best {best}", MUTED
    else:
        label, color = "", MUTED
    if label:
        if label == "NEW BEST":
            _centred_text(canvas, label, top + _px(132, scale), color, 0.68 * scale)
        else:
            label_scale = 0.62 * scale
            draw_caption(canvas, label, ((width - caption_width(label, label_scale)) // 2,
                                         top + _px(132, scale)), color, label_scale)

    rows = (
        (f"{summary.hits}/{summary.shots}", "hits"),
        (f"{summary.accuracy:.0%}", "accuracy"),
        (str(summary.best_streak), "best streak"),
        (str(summary.perfect), summary.perfect_label),
    )
    row_top = top + _px(154, scale)
    accent_rule(canvas, row_top, card.x + inner, card.right - inner, EDGE, 1)
    column = card.width // len(rows)
    value_size, label_scale = _px(30, scale), 0.48 * scale
    for index, (value, label) in enumerate(rows):
        x = card.x + column * index + column // 2
        if index:
            cv2.line(canvas, (card.x + column * index, row_top + _px(14, scale)),
                     (card.x + column * index, row_top + _px(70, scale)), EDGE, 1,
                     cv2.LINE_AA)
        draw_figures(canvas, value, (x - figures_width(value, value_size) // 2,
                                     row_top + _px(46, scale)), INK, value_size, 0.05)
        width_label = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX,
                                      label_scale, 1)[0][0]
        draw_text(canvas, label, (x - width_label // 2, row_top + _px(68, scale)),
                  MUTED, scale=label_scale, thickness=1, outline=False)
    accent_rule(canvas, row_top + _px(84, scale), card.x + inner, card.right - inner,
                EDGE, 1)

    _centred_text(canvas, "shoot anywhere to play again", card.bottom - _px(50, scale),
                  ARMED, 0.68 * scale)
    _draw_keyed_note(canvas, "S", "saves this card as a screenshot",
                     card.bottom - _px(18, scale), scale)
    if hint:
        draw_footer(canvas, hint, scale)
    draw_logo(canvas, scale)


def _draw_results_banner(canvas: np.ndarray, rect: Rect, title: str, emblem,
                         duration: float | None, radius: int, scale: float) -> None:
    """The top of the score card: the map's own art, its name set over the foot
    of it, and the round's length opposite."""
    cv2.copyTo(_banner_art(emblem, title, rect.width, rect.height),
               _thumbnail_mask(rect.width, rect.height, radius),
               canvas[rect.y:rect.bottom, rect.x:rect.right])
    accent_rule(canvas, rect.bottom, rect.x + 1, rect.right - 1, EDGE, 1)
    inner = _px(28, scale)
    baseline = rect.bottom - _px(20, scale)
    # Set in the left of the banner, clear of art that centres its subject.
    title_scale = 1.05 * scale
    while title_scale > 0.5 * scale and text_width(title, title_scale) > rect.width * 0.36:
        title_scale *= 0.94
    draw_text(canvas, title, (rect.x + inner, baseline), INK, scale=title_scale,
              thickness=_px(2, scale))
    length = round_length(duration)
    length_scale = 0.46 * scale
    draw_caption(canvas, length,
                 (rect.right - inner - caption_width(length, length_scale), baseline),
                 SECONDARY, length_scale)


@lru_cache(maxsize=8)
def _banner_art(emblem, title: str, width: int, height: int) -> np.ndarray:
    """The card's banner, built once: the thumbnail, its foot settled into the
    card's plate so the name reads on it without a box of its own."""
    art = _thumbnail(emblem, title, width, height).astype(np.float32)
    fade = max(1, int(height * 0.7))
    ramp = np.linspace(0.0, 1.0, fade, dtype=np.float32)[:, None, None] ** 1.4 * 0.9
    art[-fade:] = art[-fade:] * (1 - ramp) + np.float32((46, 43, 40)) * ramp
    return art.astype(np.uint8)


def _draw_keyed_note(canvas: np.ndarray, key: str, note: str, baseline: int,
                     scale: float) -> None:
    """A key drawn as a small keycap followed by what it does, centred."""
    text_scale = 0.46 * scale
    cap_text = cv2.getTextSize(key, cv2.FONT_HERSHEY_SIMPLEX, text_scale, 1)[0]
    cap = Rect(0, 0, max(cap_text[0] + _px(12, scale), _px(20, scale)), _px(20, scale))
    gap = _px(8, scale)
    total = cap.width + gap + text_width(note, text_scale, 1, False)
    x = (canvas.shape[1] - total) // 2
    cap = Rect(x, baseline - cap.height + _px(5, scale), cap.width, cap.height)
    shade_panel(canvas, cap, _px(4, scale), (58, 55, 52), (40, 38, 36), (96, 92, 88))
    draw_text(canvas, key, (cap.x + (cap.width - cap_text[0]) // 2,
                            cap.y + (cap.height + cap_text[1]) // 2),
              INK, scale=text_scale, thickness=1, outline=False)
    draw_text(canvas, note, (cap.right + gap, baseline), MUTED, scale=text_scale,
              thickness=1, outline=False)


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


FOOTER_SCALE = 0.55
FOOTER_SEPARATOR = "   |   "


def fit_hints(segments: Sequence[Sequence[str]], width: int,
              scale: float = 1.0) -> str:
    """Join hint segments into one footer line that fits in ``width`` pixels.

    Each segment is a list of tokens ("q quit", "r restart", ...). Segments are
    joined with a separator; when the line is too wide, tokens are dropped from
    the END of the LAST segment first (the key reference is least important and
    its tail least of all), then whole segments from the right. A footer that
    runs off the screen edge is worse than one that says less.
    """
    segments = [list(tokens) for tokens in segments if tokens]
    # Dedupe: a map repeating the scheme's advice - or a piece of it - is noise.
    kept: list[str] = []
    for tokens in segments:
        fresh = []
        for token in tokens:
            if any(token.lower() in earlier.lower() for earlier in kept):
                continue
            kept.append(token)
            fresh.append(token)
        tokens[:] = fresh
    segments = [t for t in segments if t]

    def line() -> str:
        return FOOTER_SEPARATOR.join("   ".join(tokens) for tokens in segments)

    limit = width - round(48 * scale)
    while segments and text_width(line(), FOOTER_SCALE * scale) > limit:
        if len(segments[-1]) > 1:
            segments[-1].pop()
        else:
            segments.pop()
    return line()


def draw_footer(canvas: np.ndarray, text: str, scale: float = 1.0,
                alpha: float = 1.0) -> None:
    """The hint line along the bottom, faded to ``alpha`` (nothing drawn at 0).

    A fading line is drawn onto a copy of its own strip and blended back, so a
    hint on its way out costs a patch the size of the text, not a frame.
    """
    if not text or alpha <= 0.0:
        return
    origin = (round(24 * scale), canvas.shape[0] - round(22 * scale))
    text_scale = FOOTER_SCALE * scale
    if alpha >= 1.0:
        draw_text(canvas, text, origin, MUTED, scale=text_scale)
        return
    height, width = canvas.shape[:2]
    pad = _px(12, scale)
    x0, y0 = max(origin[0] - pad, 0), max(origin[1] - _px(22, scale), 0)
    x1 = min(origin[0] + text_width(text, text_scale) + pad, width)
    y1 = min(origin[1] + _px(10, scale), height)
    if x1 <= x0 or y1 <= y0:
        return
    region = canvas[y0:y1, x0:x1]
    patch = region.copy()
    draw_text(patch, text, (origin[0] - x0, origin[1] - y0), MUTED, scale=text_scale)
    cv2.addWeighted(patch, alpha, region, 1.0 - alpha, 0.0, dst=region)


def draw_chrome_panel(canvas: np.ndarray, rect: Rect, scale: float = 1.0,
                      opacity: float = CHROME_OPACITY,
                      tab: tuple[int, int, int] | None = None) -> None:
    """A translucent rounded plate with a hairline edge, sized to what sits on it.

    It replaces a feathered slab that ran from the camera most of the way to
    the buttons: a panel sized to its readout, in the same material and with
    the same corners as the clock beside it, is far less of the map covered
    and reads as one family with the rest of the chrome. Composited on its own
    region with a cached mask, so a frame pays for one small weighted blend.
    """
    height, width = canvas.shape[:2]
    x0, y0 = max(rect.x, 0), max(rect.y, 0)
    x1, y1 = min(rect.right + 1, width), min(rect.bottom + 1, height)
    if x1 <= x0 or y1 <= y0:
        return
    radius = _px(CORNER * 0.7, scale)
    keep, cover, shade = _chrome_layers(rect.width + 1, rect.height + 1, radius,
                                        round(opacity, 3))
    rows, cols = slice(y0 - rect.y, y1 - rect.y), slice(x0 - rect.x, x1 - rect.x)
    region = canvas[y0:y1, x0:x1]
    cv2.blendLinear(region, shade[rows, cols], keep[rows, cols], cover[rows, cols],
                    dst=region)
    stroke_rounded(canvas, rect, EDGE, radius, 1)
    if tab is not None:
        # The short bright tab on the top edge, over the text's margin: the
        # mark every panel carries.
        cv2.line(canvas, (rect.x + _px(14, scale), rect.y),
                 (rect.x + _px(50, scale), rect.y), tab, _px(2, scale), cv2.LINE_AA)


@lru_cache(maxsize=16)
def _chrome_layers(width: int, height: int, radius: int,
                   opacity: float) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """One panel's blend, built once per size rather than every frame.

    Weights for what shows through and for the plate laid over it, the plate's
    rounded corners anti-aliased into the weights, and the plate's own shading.
    Blending in float from a fresh mask was three milliseconds a frame on a
    laptop panel; a cached mask and OpenCV's own weighted blend are a small
    fraction of one.
    """
    mask = np.zeros((height, width), np.uint8)
    cv2.fillPoly(mask, [_rounded(0, 0, width - 1, height - 1, radius)], 255, cv2.LINE_AA)
    cover = mask.astype(np.float32) * np.float32(opacity / 255.0)
    keep = np.float32(1.0) - cover
    shade = _gradient(width, height, CHROME_TOP, CHROME_BOTTOM)
    for array in (keep, cover):
        array.flags.writeable = False  # shared by every frame from here on
    return keep, cover, shade


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
    if session.last_impact:
        point, at = session.last_impact
        if now - at < 0.65:
            cv2.drawMarker(canvas, (round(point[0] * width), round(point[1] * height)),
                           ARMED if session.last_hit else MISS, cv2.MARKER_TILTED_CROSS,
                           _px(15, height / 720), _px(2, height / 720), cv2.LINE_AA)


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
    never covers a target the player has to shoot.
    """
    from .maps.archery import BOSS_SCALE
    from .shot_calibration import CHECK_TARGETS, TARGET_RADIUS, TARGETS

    margin, gap = _px(16, scale), _px(16, scale)
    lowest = max(y for _, y in (*TARGETS, *CHECK_TARGETS)) * height
    lowest += min(width, height) * TARGET_RADIUS * BOSS_SCALE * 1.15  # its shadow too
    bottom = height - margin
    tall = max(_px(60, scale), min(_px(170, scale), bottom - int(lowest) - gap))
    top = bottom - tall
    slot = (tall - (count - 1) * _px(4, scale)) / max(count, 1)
    camera_w = max(_px(80, scale), min(int(slot * aspect), width // 4))
    camera = Rect(margin, top, camera_w, tall)
    progress_w = _px(250, scale)
    progress = Rect(width - margin - progress_w, top, progress_w, tall)
    instruction = Rect(camera.right + gap, top,
                       max(1, progress.x - gap - camera.right - gap), tall)
    return camera, instruction, progress


def draw_shot_calibration(canvas, session, images, frames, draw, scale=1.0):
    """Setup: the lit face on the range wall, and the console under it."""
    from .shot_calibration import REQUIRED_HITS

    now = session.last_shot if session.last_shot > 0 else 0
    draw_calibration_range(canvas, session, now, course=True)
    height, width = canvas.shape[:2]
    count = max(1, len(images))
    aspect = images[0].shape[1] / images[0].shape[0] if images else 16 / 9
    camera, instruction, progress = setup_console(width, height, count, aspect, scale)

    # The camera, framed as it is in every round, in its state colour.
    for index, (slot, image) in enumerate(zip(inset_slots(camera, count), images)):
        state = FUSED if frames[index].subjects else NO_HAND
        draw_camera_inset(canvas, image, frames[index], slot,
                          f"CAM {index + 1}" if count > 1 else "", state, draw, scale)

    # What to do now: the largest words on the screen.
    draw_chrome_panel(canvas, instruction, scale, tab=ACCENT)
    pad = _px(20, scale)
    draw_text(canvas, "TARGET RANGE  -  AIM SETUP",
              (instruction.x + pad, instruction.y + _px(26, scale)), ACCENT,
              scale=0.42 * scale, thickness=1, outline=False)
    status_y = instruction.bottom - _px(16, scale)
    first = instruction.y + _px(40, scale)
    lines, text_scale, step = _fit_instruction(session.message, instruction.width - 2 * pad,
                                               status_y - _px(26, scale) - first, scale)
    y = first + step - _px(6, scale)
    for line in lines:
        draw_text(canvas, line, (instruction.x + pad, y), INK, scale=text_scale,
                  thickness=_px(2, scale), outline=False)
        y += step
    status, color = (("Show your hand to the camera", DANGER) if not session.aim.tracking
                     else ("Thumb up - ready to shoot", ARMED) if session.aim.armed
                     else ("Raise your thumb for the next shot", ACCENT))
    cv2.circle(canvas, (instruction.x + pad + _px(4, scale), status_y - _px(5, scale)),
               _px(4, scale), color, -1, cv2.LINE_AA)
    draw_text(canvas, status, (instruction.x + pad + _px(16, scale), status_y), color,
              scale=0.5 * scale, thickness=1, outline=False)
    keys = "b undo   r start over   esc skip"
    keys_scale = 0.42 * scale
    keys_w = text_width(keys, keys_scale, 1, False)
    if keys_w + text_width(status, 0.5 * scale, 1, False) + _px(56, scale) < instruction.width:
        draw_text(canvas, keys, (instruction.right - pad - keys_w, status_y), MUTED,
                  scale=keys_scale, thickness=1, outline=False)

    # How far there is to go.
    step_color = ARMED if session.testing else ACCENT
    draw_chrome_panel(canvas, progress, scale, tab=step_color)
    learned = LEARN_SHOTS if session.testing else min(len(session.samples), LEARN_SHOTS)
    hits = len(session.hits)
    draw_text(canvas, "STEP 2 OF 2" if session.testing else "STEP 1 OF 2",
              (progress.x + pad, progress.y + _px(26, scale)), step_color,
              scale=0.42 * scale, thickness=1, outline=False)
    headline = (f"{hits} of {REQUIRED_HITS} centre hits" if session.testing
                else f"{learned} of {LEARN_SHOTS} shots learned")
    draw_caption(canvas, headline, (progress.x + pad, progress.y + _px(66, scale)), INK,
                 0.6 * scale)
    _draw_setup_pips(canvas, progress, learned, hits, session.testing, REQUIRED_HITS,
                     scale)

    if session.preview and session.aim.position:
        draw_crosshair(canvas, session.aim.position[0] * width,
                       session.aim.position[1] * height, session.aim.armed,
                       None, scale, pull=session.aim.travel, fire_at=0.5)


def _fit_instruction(message: str, width: int, room: int,
                     scale: float) -> tuple[list[str], float, int]:
    """The instruction wrapped as large as it will go in the room it has."""
    for size in (0.8, 0.72, 0.64, 0.56, 0.5):
        text_scale, step = size * scale, _px(size * 38, scale)
        lines = _wrapped(message, text_scale, width, _px(2, scale))
        if len(lines) * step <= room + _px(8, scale):
            return lines, text_scale, step
    fits = max(1, (room + _px(8, scale)) // step)
    if len(lines) > fits:
        lines = lines[:fits]
        lines[-1] = _fitted(lines[-1] + " ...", text_scale, width)
    return lines, text_scale, step


def _draw_setup_pips(canvas: np.ndarray, panel: Rect, learned: int, hits: int,
                     testing: bool, required: int, scale: float) -> None:
    """Both steps of setup as a row of pips: the shots that teach the aim, then
    the centre hits that check it - done ones filled, the next one ringed."""
    radius, pitch, group_gap = _px(8, scale), _px(24, scale), _px(18, scale)
    x = panel.x + _px(20, scale) + radius
    y = panel.bottom - _px(46, scale)
    label_y = panel.bottom - _px(16, scale)
    groups = ((LEARN_SHOTS, learned, not testing, ACCENT, "LEARN"),
              (required, hits, testing, ARMED, "CHECK"))
    for total, done, current, color, label in groups:
        start = x
        for index in range(total):
            if index < done:
                cv2.circle(canvas, (x, y), radius, color, -1, cv2.LINE_AA)
            else:
                ring = color if current and index == done else EDGE
                cv2.circle(canvas, (x, y), radius, ring, _px(2, scale), cv2.LINE_AA)
            x += pitch
        draw_text(canvas, label, (start - radius, label_y),
                  color if current or done else MUTED, scale=0.38 * scale, thickness=1,
                  outline=False)
        x += group_gap


# --- choosing a map ---------------------------------------------------------

#: Cards in one row on the chooser. The game has four maps, and four across
#: reads as a line-up; more than this and the cards grow too narrow for a title.
CARDS_PER_ROW = 4


def chooser_area(window: Rect, scale: float = 1.0) -> Rect:
    """Where the chooser's cards may go: the band the game plays in.

    The rows ``app.layout_for`` gives the play area - below the camera in the
    top-left corner, above the footer - so the cards never run under the
    camera. Across, it reaches the margin the camera and QUIT stand on, so the
    grid lines up with both.
    """
    def unit(value: float) -> int:
        return max(1, round(value * scale))

    top = window.y + unit(16) + window.height // 4 + unit(28)
    bottom = window.bottom - unit(56)
    return Rect(window.x + unit(16), top, max(1, window.width - 2 * unit(16)),
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
    gap = round(20 * scale)
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
        row_width = in_row * width + (in_row - 1) * gap
        left = area.x + (area.width - row_width) // 2
        for column in range(in_row):
            cards.append(Rect(left + column * (width + gap), top + row * (height + gap),
                              width, height))
    return tuple(cards)


def _wrapped(text: str, scale: float, width: int, thickness: int = 1,
             outline: bool = False) -> list[str]:
    """Greedy word wrap against the width the text will actually be drawn at."""
    lines: list[str] = []
    line = ""
    for word in text.split():
        candidate = f"{line} {word}".strip()
        if text_width(candidate, scale, thickness, outline) > width and line:
            lines.append(line)
            line = word
        else:
            line = candidate
    if line:
        lines.append(line)
    return lines



def _fitted(text: str, scale: float, width: int) -> str:
    """The text, or as many of its words as fit followed by an ellipsis."""
    if text_width(text, scale, 1, outline=False) <= width:
        return text
    words = text.split()
    while words:
        words.pop()
        candidate = " ".join(words) + " ..."
        if text_width(candidate, scale, 1, outline=False) <= width:
            return candidate
    return "..."


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
    # retinted to the muted accent, so on the chooser green means one thing:
    # the card you are aiming at.
    b, g, r = image[:, :, 0], image[:, :, 1], image[:, :, 2]
    green = np.clip((g - np.maximum(r, b) - 30.0) / 60.0, 0, 1)[:, :, None]
    amber = np.array((70, 140, 205), np.float32) * (g / 255.0)[:, :, None]
    image = image * (1 - green) + amber * green
    blurred = cv2.GaussianBlur(image, (0, 0), max(1.0, panel.shape[1] * 0.003))
    image = image + (image - blurred) * 0.6
    return np.clip(image, 0, 255).astype(np.uint8)


@lru_cache(maxsize=16)
def _thumbnail(emblem, title: str, width: int, height: int) -> np.ndarray:
    """A map's card art, framed clean and given the one thumbnail treatment:
    a vignette, a light band at the top edge and a shadow at the foot, so the
    flat map crops sit in their cards the way the rendered scheme art does."""
    del title  # the frame is chosen by the art's source, not its caption
    panel = _normalised(_clean_frame(emblem, width, height)).astype(np.float32)

    # Vignette: the corners fall away so the eye settles in the middle.
    ys = (np.arange(height, dtype=np.float32) / height - 0.5) * 2
    xs = (np.arange(width, dtype=np.float32) / width - 0.5) * 2
    d2 = xs[None, :] ** 2 * 0.55 + ys[:, None] ** 2
    vignette = 1.0 - 0.38 * np.clip(d2 - 0.35, 0, 1.5) / 1.5
    panel *= vignette[:, :, None]
    # A soft light band at the top edge, as if lit from above the card, and
    # the foot darkened so the picture settles into the body below it.
    band = max(2, int(height * 0.22))
    lift = np.linspace(0.16, 0.0, band, dtype=np.float32)[:, None, None]
    panel[:band] += (np.array((255, 250, 240), np.float32) - panel[:band]) * lift
    fade = max(1, height // 4)
    ramp = np.linspace(1.0, 0.55, fade, dtype=np.float32)[:, None, None]
    panel[-fade:] *= ramp
    panel = np.clip(panel, 0, 255).astype(np.uint8)
    # A hairline of light along the very top: the card's edge catching it.
    cv2.line(panel, (0, 0), (width, 0), (120, 112, 104), 1, cv2.LINE_AA)
    return panel


@lru_cache(maxsize=8)
def _thumbnail_mask(width: int, height: int, radius: int,
                    all_corners: bool = False) -> np.ndarray:
    """Rounded top corners for the art; the body squares off its foot."""
    mask = np.zeros((height, width), np.uint8)
    cv2.fillPoly(mask, [_rounded(0, 0, width, height if all_corners else height + radius,
                                 radius)], 255)
    return mask


def draw_map_card(canvas: np.ndarray, rect: Rect, title: str, blurb: str,
                  best: str, emblem, aimed: bool, scale: float = 1.0) -> None:
    radius = _px(CORNER, scale)
    # The art takes about half the card, never taller than it is wide, unless
    # the card is short (two rows of them), when the body keeps the room the
    # text needs and the art gives.
    body_needed = _px(150, scale)
    art_height = int(max(rect.height * 0.38,
                         min(rect.height * 0.5, rect.height - body_needed, rect.width * 0.8)))
    panel = _thumbnail(emblem, title, rect.width, art_height)
    mask = _thumbnail_mask(rect.width, art_height, radius)
    cv2.copyTo(panel, mask, canvas[rect.y:rect.y + art_height, rect.x:rect.right])

    body = Rect(rect.x, rect.y + art_height, rect.width, rect.height - art_height)
    body_poly = _rounded(body.x, body.y - radius, body.right, body.bottom, radius)
    body_poly[:, 1] = np.maximum(body_poly[:, 1], body.y)  # square top, round foot
    _shade_poly(canvas, body_poly, PANEL, PANEL_DEEP)

    # The accent rule between art and body, with a short bright tab at the left
    # that lines up with the text margin below it.
    pad = round(18 * scale)
    accent_rule(canvas, body.y, body.x + 1, body.right - 1, EDGE, 1)
    cv2.line(canvas, (body.x + pad, body.y), (body.x + pad + _px(46, scale), body.y),
             ARMED if aimed else ACCENT, _px(2, scale), cv2.LINE_AA)

    # The card body is a flat panel, so this text needs no halo - and at this
    # size the halo would be thicker than the strokes it is meant to set off.
    blurb_scale = 0.5 * scale
    compact = body.height / scale < 165  # two rows of cards: tighter leading
    title_at, first, step = (36, 62, 20) if compact else (42, 74, 22)
    # The title is set as large as the card allows, and never runs off it.
    title_scale = 0.85 * scale
    while (title_scale > 0.5 * scale
           and text_width(title, title_scale, 2, False) > body.width - 2 * pad):
        title_scale *= 0.95
    draw_text(canvas, title, (body.x + pad, body.y + round(title_at * scale)), INK,
              scale=title_scale, thickness=2, outline=False)
    room = int((body.height / scale - first - 38) // step) + 1  # lines above the foot
    lines = _wrapped(blurb, blurb_scale, body.width - 2 * pad)
    if len(lines) > max(1, min(5, room)):
        # Cut at a word, and say so, rather than stop mid-thought.
        lines = lines[:max(1, min(5, room))]
        lines[-1] = _fitted(lines[-1] + " ...", blurb_scale, body.width - 2 * pad)
    for index, line in enumerate(lines):
        draw_text(canvas, line,
                  (body.x + pad, body.y + round((first + index * step) * scale)), MUTED,
                  scale=blurb_scale, thickness=1, outline=False)
    cv2.circle(canvas, (body.x + pad + _px(3, scale), body.bottom - round(21 * scale)),
               _px(3, scale), ACCENT, -1, cv2.LINE_AA)
    draw_caption(canvas, _fitted(best, 0.55 * scale, body.width - 2 * pad - _px(14, scale)),
                 (body.x + pad + _px(14, scale), body.bottom - round(16 * scale)),
                 MUTED, 0.5 * scale)

    if aimed:
        glow_stroke(canvas, rect, ARMED, radius, _px(3, scale))
    else:
        stroke_rounded(canvas, rect, EDGE, radius, _px(1, scale))



def draw_card_select(canvas: np.ndarray, cards: tuple, entries: tuple,
                     aimed: int | None, title: str, hint: str,
                     scale: float = 1.0) -> None:
    """A row of cards to choose between, one of them possibly picked out."""
    draw_backdrop(canvas)
    height, width = canvas.shape[:2]
    # The title treatment: the title between two short accent rules and the
    # hint beneath, centred in the band above the cards - the band the camera
    # sits at the left of, so the rules stop well short of it.
    cards_top = min((rect.y for rect in cards), default=height // 4)
    band_top, band_bottom = _px(16, scale), cards_top - _px(28, scale)
    title_y = max(_px(40, scale), (band_top + band_bottom) // 2 - _px(4, scale))
    title_scale = 0.9 * scale
    title_w = text_width(title, title_scale)
    span = min(title_w + _px(220, scale), width - 2 * (width // 4 + _px(64, scale)))
    if span > title_w + _px(80, scale):
        accent_rule(canvas, title_y - _px(9, scale), (width - span) // 2,
                    (width + span) // 2, EDGE, 1, gap=title_w + _px(48, scale))
    _centred_text(canvas, title, title_y, INK, title_scale)
    _centred_text(canvas, hint, min(title_y + round(36 * scale), cards_top - _px(14, scale)),
                  ARMED, 0.6 * scale)
    for index, (rect, entry) in enumerate(zip(cards, entries)):
        draw_map_card(canvas, rect, *entry, aimed=index == aimed, scale=scale)
    draw_logo(canvas, scale)


def draw_map_select(canvas: np.ndarray, cards: tuple, entries: tuple,
                    aimed: int | None, scale: float = 1.0) -> None:
    """The map chooser: shoot the one you want to play."""
    draw_card_select(canvas, cards, entries, aimed,
                     "CHOOSE YOUR GROUND", "shoot a card to play it", scale)
