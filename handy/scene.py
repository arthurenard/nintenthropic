"""Everything the player sees: range, targets, crosshair, HUD and buttons."""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache

import cv2
import numpy as np

from collections.abc import Sequence

from .aiming import Aim
from .calibration import Progress
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
HIT = (120, 230, 130)
MISS = (120, 120, 190)
DANGER = (70, 70, 220)

RECOIL = 0.18

#: Corner radius of every panel, card and button, in 720-tall units.
CORNER = 10


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


def fill_rounded(canvas: np.ndarray, rect: Rect, color: tuple[int, int, int],
                 radius: int) -> None:
    cv2.fillPoly(canvas, [_rounded(rect.x, rect.y, rect.right, rect.bottom, radius)],
                 color, cv2.LINE_AA)


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


def draw_logo(canvas: np.ndarray, scale: float = 1.0) -> None:
    """The lockup, bottom right on every screen: glyph, wordmark, accent bar."""
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
        draw_text(canvas, label, (rect.x + round(8 * scale), rect.y + round(20 * scale)),
                  color, scale=0.45 * scale)
    if state != FUSED:
        draw_text(canvas, state,
                  (rect.x + round(8 * scale), rect.bottom - round(10 * scale)),
                  color, scale=0.45 * scale)


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
             fire_at: float = 0.65) -> None:
    # The block sits clear of the camera preview beside it: the accent bar is
    # a good twenty pixels off the preview's frame rather than hugging it.
    x, y = origin[0] + _px(14, scale), origin[1]

    def line(offset: float) -> int:
        return y + round(offset * scale)

    # A slim accent bar runs down the left of the block, tying the lines into
    # one readout rather than four stray strings of text.
    cv2.line(canvas, (x - _px(10, scale), line(8)), (x - _px(10, scale), line(104)),
             ACCENT, _px(2, scale), cv2.LINE_AA)
    draw_text(canvas, "SCORE", (x, line(18)), ACCENT, scale=0.42 * scale,
              thickness=1)
    draw_figures(canvas, str(round_.score), (x, line(58)), INK, _px(40, scale), 0.05)
    draw_text(canvas,
              f"hits {round_.hits}/{round_.shots}   accuracy {round_.accuracy:.0%}",
              (x, line(78)), MUTED, scale=0.55 * scale)

    state = "READY" if aim.armed else ("AIM" if aim.tracking else "NOT TRACKING")
    dot = (x + _px(5, scale), line(96))
    cv2.circle(canvas, dot, _px(4, scale), ARMED if aim.armed else MUTED, -1,
               cv2.LINE_AA)
    draw_text(canvas, state, (x + _px(16, scale), line(102)),
              ARMED if aim.armed else MUTED, scale=0.55 * scale)

    summary, color = camera_summary(camera_states)
    draw_text(canvas, summary, (x, line(124)), color, scale=0.48 * scale, thickness=1)

    if debug:
        # Trigger pull, measured from rest, against the threshold it must cross.
        detail = f"trigger {aim.pull:+.2f} of {fire_at:.2f}"
        if aim.cameras > 1:
            # Spread is what the cameras disagree by; depth is what that solved to.
            detail += (f"   spread {aim.spread * 100:.1f}%"
                       f"   depth {aim.depth:+.2f}")
        if fps is not None:
            detail += f"   {fps:.0f} fps"
        draw_text(canvas, detail, (x, line(146)), MUTED, scale=0.48 * scale,
                  thickness=1)



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
                pill.height // 2, (40, 38, 36), (24, 23, 22), EDGE)
    blend(region, halo, 0.85)
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



def draw_results(canvas: np.ndarray, summary: Summary, best: int,
                 is_best: bool, hint: str = "", scale: float = 1.0) -> None:
    """The end-of-round card, on the map's own art dimmed to a mood.

    Deliberately not drawn over a frozen frame of the range: that frame carries
    its own score and clock in the HUD, and two sets of numbers on one screen
    read as a bug however far the picture behind is dimmed. The map's card art,
    blurred and darkened, keeps the screen in the game without that problem.
    """
    draw_ambient_backdrop(canvas)
    height, width = canvas.shape[:2]

    card_w = min(width - 2 * _px(60, scale), _px(760, scale))
    card_h = _px(400, scale)
    card = Rect((width - card_w) // 2, (height - card_h) // 2, card_w, card_h)
    _panel_shadow(canvas, card, _px(CORNER, scale), _px(18, scale))
    _modal_panel(canvas, card, _px(CORNER, scale), scale)
    inner = _px(28, scale)

    top = card.y + _px(58, scale)
    heading = summary.outcome or "SCORE"
    # Half the outcomes a map can name are the good ending - a night survived,
    # a pane held, a street cleaned up - so the map says which it is rather
    # than the card guessing from the fact that there is one at all.
    heading_color = (ARMED if summary.won
                     else DANGER if summary.outcome else ACCENT)
    # The short bright tab at the top left, the mark every panel carries.
    cv2.line(canvas, (card.x + inner, card.y), (card.x + inner + _px(46, scale), card.y),
             heading_color, _px(2, scale), cv2.LINE_AA)
    accent_rule(canvas, top - _px(8, scale), card.x + inner, card.right - inner,
                heading_color, 1, gap=text_width(heading, 0.75 * scale) + _px(40, scale))
    _centred_text(canvas, heading, top, heading_color, 0.75 * scale)

    score = str(summary.score)
    size = _px(92, scale)
    draw_figures(canvas, score, ((width - figures_width(score, size)) // 2,
                                 top + _px(106, scale)), INK, size, 0.045)

    if is_best:
        label, color = "NEW BEST", ARMED
    elif best:
        label, color = f"best {best}", MUTED
    else:
        label, color = "", MUTED
    if label:
        _centred_text(canvas, label, top + _px(146, scale), color, 0.7 * scale)

    rows = (
        (f"{summary.hits}/{summary.shots}", "hits"),
        (f"{summary.accuracy:.0%}", "accuracy"),
        (str(summary.best_streak), "best streak"),
        (str(summary.perfect), summary.perfect_label),
    )
    row_top = top + _px(182, scale)
    accent_rule(canvas, row_top, card.x + inner, card.right - inner, EDGE, 1)
    column = card.width // len(rows)
    value_size, label_scale = _px(30, scale), 0.48 * scale
    for index, (value, label) in enumerate(rows):
        x = card.x + column * index + column // 2
        if index:
            cv2.line(canvas, (card.x + column * index, row_top + _px(14, scale)),
                     (card.x + column * index, row_top + _px(74, scale)), EDGE, 1,
                     cv2.LINE_AA)
        draw_figures(canvas, value, (x - figures_width(value, value_size) // 2,
                                     row_top + _px(48, scale)), INK, value_size, 0.05)
        width_label = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX,
                                      label_scale, 1)[0][0]
        draw_text(canvas, label, (x - width_label // 2, row_top + _px(70, scale)),
                  MUTED, scale=label_scale, thickness=1, outline=False)
    accent_rule(canvas, row_top + _px(88, scale), card.x + inner, card.right - inner,
                EDGE, 1)

    cta = "shoot anywhere to play again"
    cta_y = card.bottom - _px(34, scale)
    _centred_text(canvas, cta, cta_y, ARMED, 0.68 * scale)
    if hint:
        draw_footer(canvas, hint, scale)
    draw_logo(canvas, scale)


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


def draw_footer(canvas: np.ndarray, text: str, scale: float = 1.0) -> None:
    draw_text(canvas, text, (round(24 * scale), canvas.shape[0] - round(22 * scale)),
              MUTED, scale=FOOTER_SCALE * scale)


def draw_hud_backing(canvas: np.ndarray, rect: Rect, scale: float = 1.0) -> None:
    """A soft dark panel behind the HUD, so it reads on a bright map too.

    The HUD was designed over dark ground; over a noon sky its grey text all but
    vanishes. The panel is translucent with feathered edges, and is composited
    on its own region only - a full-frame blend per feather step cost more than
    the whole map.
    """
    height, width = canvas.shape[:2]
    feather = round(14 * scale)
    x0, y0 = max(rect.x, 0), max(rect.y, 0)
    x1, y1 = min(rect.right + feather, width), min(rect.bottom + feather, height)
    if x1 <= x0 or y1 <= y0:
        return
    region = canvas[y0:y1, x0:x1]
    keep, cover, shade = _hud_backing_weights(y1 - y0, x1 - x0,
                                              rect.bottom + feather - y0,
                                              rect.right + feather - x0, feather)
    cv2.blendLinear(region, shade, keep, cover, dst=region)


@lru_cache(maxsize=8)
def _hud_backing_weights(height: int, width: int, fade_bottom: int, fade_right: int,
                         feather: int) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """The HUD backing's blend, built once per size rather than every frame.

    Weights for what shows through and for the shade laid over it: 0.62 of
    shade over the panel, fading to none across the feather on the right and
    bottom. Rebuilding them - and blending in float - was three milliseconds
    of every frame on a laptop panel; a cached mask and OpenCV's own weighted
    blend are a tenth of one.
    """
    ys = np.arange(height)[:, None]
    xs = np.arange(width)[None, :]
    fade_y = np.clip((fade_bottom - ys) / feather, 0.0, 1.0)
    fade_x = np.clip((fade_right - xs) / feather, 0.0, 1.0)
    cover = (0.62 * np.minimum(fade_y, fade_x)).astype(np.float32)
    shade = np.empty((height, width, 3), np.uint8)
    shade[:] = (16, 15, 14)
    for array in (cover, shade):
        array.flags.writeable = False  # shared by every frame from here on
    keep = 1.0 - cover
    keep.flags.writeable = False
    return keep, cover, shade


# --- calibration ------------------------------------------------------------

def _to_pixels(canvas: np.ndarray, target: tuple[float, float]) -> tuple[int, int]:
    """Where a normalised screen position lands, matching the game's own mapping."""
    height, width = canvas.shape[:2]
    return (int(target[0] * (width - 1)), int(target[1] * (height - 1)))


def draw_aim_marker(canvas: np.ndarray, target: tuple[float, float],
                    pulse: float, scale: float = 1.0) -> None:
    """The marker the player is being asked to point at, right now."""
    centre = _to_pixels(canvas, target)
    cv2.circle(canvas, centre, round((26 + 10 * pulse) * scale), ARMED,
               max(1, round(3 * scale)), cv2.LINE_AA)
    cv2.circle(canvas, centre, max(2, round(4 * scale)), ARMED, -1, cv2.LINE_AA)
    cv2.drawMarker(canvas, centre, ARMED, cv2.MARKER_CROSS, round(34 * scale),
                   max(1, round(2 * scale)), cv2.LINE_AA)


def draw_grid_overview(canvas: np.ndarray, targets: tuple, done: int,
                       current: int, scale: float = 1.0) -> None:
    """Small dots for the whole grid, so the player can see how much is left."""
    radius = max(2, round(5 * scale))
    for index, target in enumerate(targets):
        if index == current:
            continue
        centre = _to_pixels(canvas, target)
        if index < done:
            cv2.circle(canvas, centre, radius, ARMED, -1, cv2.LINE_AA)
        else:
            cv2.circle(canvas, centre, radius, MUTED, max(1, round(scale)), cv2.LINE_AA)


def draw_progress_bar(canvas: np.ndarray, fraction: float, rect: Rect) -> None:
    cv2.rectangle(canvas, (rect.x, rect.y), (rect.right, rect.bottom), PANEL, -1)
    filled = int(rect.width * min(max(fraction, 0.0), 1.0))
    if filled:
        cv2.rectangle(canvas, (rect.x, rect.y), (rect.x + filled, rect.bottom),
                      ARMED, -1)
    cv2.rectangle(canvas, (rect.x, rect.y), (rect.right, rect.bottom), MUTED, 1)


def draw_shot_target(canvas, target, hit=False):
    """Warm target rings stay distinct from the green aiming crosshair."""
    height, width = canvas.shape[:2]
    x, y = round(target[0] * width), round(target[1] * height)
    radius = max(18, round(min(width, height) * 0.047))
    color = ARMED if hit else (115, 183, 241)
    cv2.circle(canvas, (x, y), radius, color, 2, cv2.LINE_AA)
    cv2.circle(canvas, (x, y), radius // 2, color, 1, cv2.LINE_AA)
    cv2.circle(canvas, (x, y), 3, color, -1, cv2.LINE_AA)


def draw_calibration_range(canvas, session, now):
    """The actual Target Range hall and archery faces serve as the warm-up."""
    from .maps import archery
    from .game import RoundOptions
    from .shot_calibration import TARGET_RADIUS

    height, width = canvas.shape[:2]
    arena = archery.ArcheryRound(RoundOptions(Rect(0, 0, width, height), duration=None,
                                             scale=height / 720, seed=0))
    target = session.target
    arena.targets = [archery.Target(target[0] * width, target[1] * height,
                                    min(width, height) * TARGET_RADIUS, now - 1, 100)]
    archery.draw_world(canvas, arena, now)
    if session.last_impact:
        point, at = session.last_impact
        if now - at < 0.65:
            cv2.drawMarker(canvas, (round(point[0] * width), round(point[1] * height)),
                           ARMED if session.last_hit else MISS, cv2.MARKER_TILTED_CROSS,
                           15, 2, cv2.LINE_AA)


def draw_shot_calibration(canvas, session, images, frames, draw, scale=1.0):
    """A large target field with a persistent live view and no pose timer."""
    draw_calibration_range(canvas, session, session.last_shot if session.last_shot > 0 else 0)
    height, width = canvas.shape[:2]
    _centred_text(canvas, f"TARGET RANGE  |  {len(session.hits)} / 5 accurate hits",
                   round(35 * scale), INK, 0.7 * scale)
    # The bottom centre stays free of calibration targets.
    count = max(1, len(images))
    pw = min(width // (count + 3), round(230 * scale))
    for i, image in enumerate(images):
        ph = max(1, int(pw * image.shape[0] / image.shape[1]))
        preview = shrink(image, pw, ph)
        draw(preview, frames[i], 0.7 * scale)
        x = (width - count * (pw + 8)) // 2 + i * (pw + 8)
        y = height - ph - round(85 * scale)
        canvas[y:y + ph, x:x + pw] = preview
    if session.preview and session.aim.position:
        draw_crosshair(canvas, session.aim.position[0] * width,
                       session.aim.position[1] * height, session.aim.armed,
                       None, scale, pull=session.aim.pull, fire_at=0.5)
    status = ("Show your hand to the camera" if not session.aim.tracking else
              "Thumb up - ready to shoot" if session.aim.armed else
              "Raise your thumb for the next shot")
    _centred_text(canvas, status, height - round(63 * scale), ARMED, 0.5 * scale)
    message = session.message
    # Keep feedback readable without clipping on smaller displays.
    if len(message) > 110:
        message = message[:107] + "..."
    _centred_text(canvas, message, height - round(43 * scale), MUTED, 0.4 * scale)
    draw_footer(canvas, "five centre hits start the game   |   b undo   r start over   esc skip")


def draw_calibration(canvas: np.ndarray, progress: Progress,
                     images: Sequence[np.ndarray], hands: Sequence[Frame],
                     pulse: float = 0.0, draw=None, scale: float = 1.0) -> None:
    """The setup screen: what to do, what each camera sees, how far along."""
    draw_backdrop(canvas)
    height, width = canvas.shape[:2]
    aiming = progress.step.target is not None
    count = max(len(images), 1)

    # While aiming the player is looking at the marker, not at themselves, so the
    # previews shrink to keep out of the way; the thumb steps need them big.
    total_width = width // 3 if aiming else width // 2
    gap = 12
    preview_width = (total_width - gap * (count - 1)) // count
    preview_height = preview_width * images[0].shape[0] // images[0].shape[1]
    top = (height - preview_height) // 2 + 20
    left = (width - total_width) // 2

    for index, image in enumerate(images):
        preview = shrink(image, preview_width, preview_height)
        (draw or _default_draw)(preview, hands[index], 0.8)
        x = left + index * (preview_width + gap)
        canvas[top:top + preview_height, x:x + preview_width] = preview
        tracking = index < len(progress.seen) and progress.seen[index]
        cv2.rectangle(canvas, (x - 1, top - 1),
                      (x + preview_width, top + preview_height),
                      ARMED if tracking else DANGER, 2, cv2.LINE_AA)
        if count > 1:
            draw_text(canvas, f"CAM {index + 1}",
                      (x + round(8 * scale), top + round(22 * scale)),
                      ARMED if tracking else DANGER, scale=0.5 * scale)
    preview_width, left = total_width, left

    _centred_text(canvas, f"SETUP  {progress.index + 1} of {progress.total}",
                  top - 96, MUTED, 0.6)
    _centred_text(canvas, progress.step.instruction, top - 52, INK, 1.0)
    _centred_text(canvas, progress.step.detail, top - 22, MUTED, 0.55)

    if aiming:
        # Markers go on last: they have to stay visible over preview and text.
        draw_grid_overview(canvas, progress.all_targets, progress.index,
                           progress.index, scale)
        draw_aim_marker(canvas, progress.step.target, pulse, scale)

    bar = Rect(width // 4, top + preview_height + 28, width // 2, 14)
    if not progress.tracking:
        _centred_text(canvas, "let the cameras see you", bar.y + 14, MUTED, 0.6)
    elif progress.seen and not all(progress.seen):
        missing = [str(i + 1) for i, ok in enumerate(progress.seen) if not ok]
        _centred_text(canvas, f"camera {', '.join(missing)} cannot see you",
                      bar.y + 14, DANGER, 0.6)
    elif progress.settling:
        _centred_text(canvas, "get ready...", bar.y + 14, MUTED, 0.6)
    else:
        draw_progress_bar(canvas, progress.fraction, bar)

    draw_footer(canvas, "hold until the bar fills   |   r retry   b back   esc skip")


# --- choosing a map ---------------------------------------------------------

#: Cards per row on the chooser. More than this and they become illegible.
CARDS_PER_ROW = 3


def map_cards(window: Rect, count: int, scale: float = 1.0) -> tuple[Rect, ...]:
    """Where the cards sit. Drawing and shooting both read this.

    Up to three across in one row; beyond that a grid, every card the same
    size, rows centred - so five cards are two rows of three and two, not a
    strip of slivers.
    """
    margin, gap = round(90 * scale), round(24 * scale)
    columns = min(count, CARDS_PER_ROW)
    rows = (count + columns - 1) // columns
    # A card is never zero-sized: everything downstream slices the canvas with
    # these, and an empty slice is a silent no-op rather than an obvious error.
    width = max(1, (window.width - 2 * margin - gap * (columns - 1)) // columns)

    top = window.y + int(window.height * (0.26 if rows == 1 else 0.20))
    bottom_room = window.height - top - round(70 * scale)
    height = max(1, min(int(window.height * 0.52),
                        (bottom_room - gap * (rows - 1)) // rows)
                 if rows > 1 else int(window.height * 0.52))

    # Every row keeps the grid's columns, a short last row included: the
    # chooser fills its empty slots with a "more ground" tile so the grid
    # closes, instead of centring an orphaned pair beneath a row of three.
    row_width = columns * width + (columns - 1) * gap
    left = window.x + (window.width - row_width) // 2
    cards = []
    for index in range(count):
        row, column = divmod(index, columns)
        cards.append(Rect(left + column * (width + gap), top + row * (height + gap),
                          width, height))
    return tuple(cards)


def empty_slots(cards: tuple) -> tuple[Rect, ...]:
    """The grid positions ``map_cards`` left unfilled on its last row."""
    if len(cards) <= CARDS_PER_ROW:
        return ()
    columns = CARDS_PER_ROW
    rows = (len(cards) + columns - 1) // columns
    first, second = cards[0], cards[1]
    pitch_x = second.x - first.x
    pitch_y = cards[columns].y - first.y
    return tuple(Rect(first.x + column * pitch_x, first.y + row * pitch_y,
                      first.width, first.height)
                 for index in range(len(cards), rows * columns)
                 for row, column in (divmod(index, columns),))


def draw_empty_slot(canvas: np.ndarray, rect: Rect, scale: float = 1.0) -> None:
    """A quiet placeholder tile: more ground is coming, this is where it goes."""
    radius = _px(CORNER, scale)
    shade_panel(canvas, rect, radius, (34, 32, 30), (27, 25, 24), None)
    # A dashed hairline, drawn as short segments around the rounded outline.
    poly = _rounded(rect.x, rect.y, rect.right, rect.bottom, radius)
    dash = _px(9, scale)
    for index in range(0, len(poly) - 1, 2):
        if (index // 2) % 2 == 0:
            a, b = poly[index], poly[(index + 1) % len(poly)]
            cv2.line(canvas, tuple(int(v) for v in a), tuple(int(v) for v in b),
                     (58, 55, 52), 1, cv2.LINE_AA)
    step = max(1, dash)
    for y in range(rect.y + radius, rect.bottom - radius, step * 2):
        cv2.line(canvas, (rect.x, y), (rect.x, min(y + step, rect.bottom - radius)),
                 (58, 55, 52), 1, cv2.LINE_AA)
        cv2.line(canvas, (rect.right, y), (rect.right, min(y + step, rect.bottom - radius)),
                 (58, 55, 52), 1, cv2.LINE_AA)
    for x in range(rect.x + radius, rect.right - radius, step * 2):
        cv2.line(canvas, (x, rect.y), (min(x + step, rect.right - radius), rect.y),
                 (58, 55, 52), 1, cv2.LINE_AA)
        cv2.line(canvas, (x, rect.bottom), (min(x + step, rect.right - radius), rect.bottom),
                 (58, 55, 52), 1, cv2.LINE_AA)
    # A faint reticle in the middle, the game's own mark, and a line beneath.
    cx, cy = rect.x + rect.width // 2, rect.y + rect.height // 2 - _px(14, scale)
    r = _px(22, scale)
    for start in (10, 100, 190, 280):
        cv2.ellipse(canvas, (cx, cy), (r, r), 0, start, start + 70, (70, 66, 62),
                    _px(2, scale), cv2.LINE_AA)
    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        cv2.line(canvas, (cx + dx * (r - _px(8, scale)), cy + dy * (r - _px(8, scale))),
                 (cx + dx * (r + _px(10, scale)), cy + dy * (r + _px(10, scale))),
                 (70, 66, 62), 1, cv2.LINE_AA)
    cv2.circle(canvas, (cx, cy), _px(2, scale), (70, 66, 62), -1, cv2.LINE_AA)
    label = "MORE GROUND SOON"
    label_scale = 0.5 * scale
    draw_text(canvas, label, (cx - text_width(label, label_scale, 1, False) // 2,
                              cy + r + _px(34, scale)), (96, 92, 88),
              scale=label_scale, thickness=1, outline=False)


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
    # The art takes just over half the card, unless the card is short (two rows
    # of them), when the body keeps the room the text needs and the art gives.
    body_needed = _px(150, scale)
    art_height = int(max(rect.height * 0.38,
                         min(rect.height * 0.52, rect.height - body_needed)))
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
    title_at, first, step = (36, 62, 20) if compact else (40, 70, 22)
    draw_text(canvas, title, (body.x + pad, body.y + round(title_at * scale)), INK,
              scale=0.85 * scale, thickness=2, outline=False)
    room = int((body.height / scale - first - 38) // step) + 1  # lines above the foot
    lines = _wrapped(blurb, blurb_scale, body.width - 2 * pad)[:max(1, min(3, room))]
    for index, line in enumerate(lines):
        draw_text(canvas, line,
                  (body.x + pad, body.y + round((first + index * step) * scale)), MUTED,
                  scale=blurb_scale, thickness=1, outline=False)
    cv2.circle(canvas, (body.x + pad + _px(3, scale), body.bottom - round(21 * scale)),
               _px(3, scale), ACCENT, -1, cv2.LINE_AA)
    draw_text(canvas, _fitted(best, 0.55 * scale, body.width - 2 * pad - _px(14, scale)),
              (body.x + pad + _px(14, scale), body.bottom - round(16 * scale)),
              MUTED, scale=0.55 * scale, thickness=1, outline=False)

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
    # The title treatment: a small wordmark, the title between two accent
    # rules, and the hint beneath. The rules stop short of the card margins.
    cards_top = min((rect.y for rect in cards), default=height // 4)
    # Below the corner buttons, above the cards, and no lower than a sixth down.
    title_y = max(_px(98, scale), min(height // 6, cards_top - _px(78, scale)))
    title_scale = 0.9 * scale
    span = round(width * 0.62)
    accent_rule(canvas, title_y - _px(9, scale), (width - span) // 2, (width + span) // 2,
                EDGE, 1, gap=text_width(title, title_scale) + _px(48, scale))
    _centred_text(canvas, title, title_y, INK, title_scale)
    _centred_text(canvas, hint, min(title_y + round(34 * scale), cards_top - _px(14, scale)),
                  ARMED, 0.6 * scale)
    for index, (rect, entry) in enumerate(zip(cards, entries)):
        draw_map_card(canvas, rect, *entry, aimed=index == aimed, scale=scale)
    for slot in empty_slots(cards):
        draw_empty_slot(canvas, slot, scale)
    draw_logo(canvas, scale)


def draw_map_select(canvas: np.ndarray, cards: tuple, entries: tuple,
                    aimed: int | None, scale: float = 1.0) -> None:
    """The map chooser: shoot the one you want to play."""
    draw_card_select(canvas, cards, entries, aimed,
                     "CHOOSE YOUR GROUND", "shoot a card to play it", scale)


def draw_scheme_select(canvas: np.ndarray, cards: tuple, entries: tuple,
                       aimed: int | None = None, scale: float = 1.0) -> None:
    """The controls chooser, shown before any camera is listened to."""
    draw_card_select(canvas, cards, entries, aimed,
                     "HAND CONTROLS",
                     "sniper also tracks one closed eye for the scope; no eye setup needed", scale)


# --- scheme emblems ---------------------------------------------------------
#
# One rendering language for the three ways of aiming, borrowed from the scope:
# hard-edged solids lit from the upper left, a crisp specular along the lit
# edge, one shadow softness, one saturation ceiling, on the same moody panel.
# The warm accent is kept for the one thing that matters in each: the flash,
# the iris, the glint. Each is built once per panel size and copied in.

_EMBLEM_LIGHT = (-0.55, -0.83)  # where the light comes from: upper left
_EMBLEM_KEY = (0.3, 0.2)  # and where its glow pools on the panel behind
_EMBLEM_NIGHT = (22, 18, 14)
_EMBLEM_GLOW = (56, 46, 30)  # a cold blue-grey, BGR
_EMBLEM_RIM = (255, 244, 226)  # the specular: cool, slightly blue
_EMBLEM_WARM = (60, 150, 255)  # the one warm accent, BGR amber


def _emblem_ground(width: int, height: int, reach: float = 0.75) -> np.ndarray:
    """The moody panel: a dark gradient, one cold key glow at upper left, a
    faint horizon line. The same for all three emblems, so they read as a set."""
    ramp = np.linspace(0.0, 1.0, height, dtype=np.float32)[:, None, None]
    top = np.array((36, 31, 26), np.float32)
    night = np.array(_EMBLEM_NIGHT, np.float32)
    image = top * (1 - ramp) + night * ramp
    ys = (np.arange(height, dtype=np.float32) - _EMBLEM_KEY[1] * height) / height
    xs = (np.arange(width, dtype=np.float32) - _EMBLEM_KEY[0] * width) / height
    d2 = xs[None, :] ** 2 + ys[:, None] ** 2
    glow = np.exp(-d2 / (2 * reach ** 2))[:, :, None]
    image = image + np.array(_EMBLEM_GLOW, np.float32) * glow * 1.6
    # The floor the subject stands on: a little lighter below the horizon.
    horizon = int(height * 0.78)
    image[horizon:] += 6
    image = np.clip(image, 0, 255).astype(np.uint8)
    cv2.line(image, (0, horizon), (width, horizon), (48, 44, 40), 1, cv2.LINE_AA)
    return image


def _solid(image: np.ndarray, mask: np.ndarray, base: tuple[int, int, int],
           size: float, spec: float = 1.0) -> None:
    """Paint a silhouette as hard-edged, top-left-lit chrome.

    The bevel is narrow (a fixed fraction of ``size``) so the edge stays
    crisp; the lit edge carries a bright specular and the shadow edge falls
    to near black, which is what makes the scope read as metal. Every emblem
    paints every solid through here, so they share one finish.
    """
    depth = max(1.2, size * 0.04)
    soft = cv2.GaussianBlur(mask.astype(np.float32) / 255.0, (0, 0), depth)
    gx = cv2.Sobel(soft, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(soft, cv2.CV_32F, 0, 1, ksize=3)
    lx, ly = _EMBLEM_LIGHT
    lit = np.clip((-gx * lx - gy * ly) * 2.2, -1.0, 1.0)
    shade = 0.78 + 0.5 * lit
    # Ambient occlusion: the middle of a big shape sits a touch darker than
    # its lit edge, so the solid reads as curved rather than cut from paper.
    centre = cv2.GaussianBlur(mask.astype(np.float32) / 255.0, (0, 0), depth * 3)
    shade = shade - 0.14 * centre
    color = np.array(base, np.float32)[None, None, :] * shade[:, :, None]
    alpha = (mask.astype(np.float32) / 255.0)[:, :, None]
    out = color * alpha + image * (1 - alpha)
    # The specular: a hard bright line along the lit edge, the mask's own
    # rim where the normal faces the light.
    rim = cv2.subtract(mask, cv2.erode(mask, np.ones((3, 3), np.uint8),
                                       iterations=max(1, int(depth * 0.8))))
    rim_lit = np.clip(lit, 0, 1) ** 1.5 * (rim.astype(np.float32) / 255.0)
    out += np.array(_EMBLEM_RIM, np.float32) * rim_lit[:, :, None] * spec
    image[:] = np.clip(out, 0, 255).astype(np.uint8)


def _shadow(image: np.ndarray, mask: np.ndarray, size: float,
            strength: float = 0.6) -> None:
    """One drop shadow for every solid: the same offset and softness."""
    offset = max(2, int(size * 0.06))
    shifted = np.zeros_like(mask)
    shifted[offset:, offset:] = mask[:-offset, :-offset]
    shadow = cv2.GaussianBlur(shifted.astype(np.float32) / 255.0, (0, 0),
                              max(1.0, size * 0.09))
    image[:] = (image * (1 - strength * shadow[:, :, None])).astype(np.uint8)


def _add_glow(image: np.ndarray, layer: np.ndarray, blur: float,
              strength: float = 1.0) -> None:
    """Additive bloom: blur ``layer`` and add it onto the image."""
    soft = cv2.GaussianBlur(layer, (0, 0), blur).astype(np.float32) * strength
    image[:] = np.clip(image.astype(np.float32) + soft, 0, 255).astype(np.uint8)


def _capsule(mask: np.ndarray, a: tuple[int, int], b: tuple[int, int],
             thickness: int) -> None:
    cv2.line(mask, a, b, 255, thickness, cv2.LINE_AA)


def _radial(width: int, height: int, centre: tuple[int, int],
            radius: float) -> np.ndarray:
    """Distance from ``centre`` in units of ``radius``, per pixel."""
    ys = (np.arange(height, dtype=np.float32) - centre[1]) / radius
    xs = (np.arange(width, dtype=np.float32) - centre[0]) / radius
    return np.sqrt(xs[None, :] ** 2 + ys[:, None] ** 2)


@lru_cache(maxsize=4)
def _pistol_art(width: int, height: int) -> np.ndarray:
    image = _emblem_ground(width, height, 0.7)
    unit = height * 0.30
    cx, cy = int(width * 0.58), int(height * 0.56)
    mask = np.zeros((height, width), np.uint8)

    # Fist: a rounded block with three knuckle bumps along its top edge.
    cv2.circle(mask, (cx, cy + int(unit * 0.05)), int(unit * 0.6), 255, -1, cv2.LINE_AA)
    for k in (-0.42, -0.12, 0.18):
        cv2.circle(mask, (cx + int(unit * k), cy - int(unit * 0.5)),
                   int(unit * 0.2), 255, -1, cv2.LINE_AA)
    # Wrist and forearm running off the right edge, so the hand belongs to someone.
    _capsule(mask, (cx + int(unit * 0.3), cy + int(unit * 0.25)),
             (width + 10, cy + int(unit * 0.7)), int(unit * 0.7))
    # Index finger: the barrel, straight out to the left.
    _capsule(mask, (cx - int(unit * 0.35), cy - int(unit * 0.12)),
             (cx - int(unit * 1.75), cy - int(unit * 0.12)), int(unit * 0.36))
    # Thumb: up and a touch back, the way a cocked hammer sits.
    _capsule(mask, (cx + int(unit * 0.05), cy - int(unit * 0.35)),
             (cx + int(unit * 0.22), cy - int(unit * 1.2)), int(unit * 0.36))

    # The sleeve goes on first, behind the hand, so the cuff reads as a cuff.
    a = np.array((cx + unit * 1.1, cy + unit * 0.47), np.float32)
    b = np.array((width + 10, cy + unit * 0.75), np.float32)
    direction = (b - a) / np.linalg.norm(b - a)
    normal = np.array((-direction[1], direction[0]), np.float32)
    half = unit * 0.47

    def band(start: float, end: float, grow: float = 1.0) -> np.ndarray:
        p0, p1 = a + direction * start, a + direction * end
        return np.array([p0 + normal * half * grow, p1 + normal * half * grow,
                         p1 - normal * half * grow, p0 - normal * half * grow], np.int32)

    sleeve = np.zeros((height, width), np.uint8)
    cv2.fillPoly(sleeve, [band(0, width)], 255, cv2.LINE_AA)
    _shadow(image, sleeve, unit, 0.5)
    _solid(image, sleeve, (62, 48, 40), unit, 0.7)
    cuff = np.zeros((height, width), np.uint8)
    cv2.fillPoly(cuff, [band(0, unit * 0.26, 1.06)], 255, cv2.LINE_AA)
    _solid(image, cuff, (150, 134, 120), unit)
    seam = band(unit * 0.12, unit * 0.14, 1.0)
    cv2.fillPoly(image, [seam], (96, 82, 72), cv2.LINE_AA)

    _shadow(image, mask, unit)
    _solid(image, mask, (186, 174, 162), unit)
    crease = (112, 102, 94)
    line_w = max(1, int(unit * 0.03))
    # Knuckle creases: a short dark arc under each bump, and the folded
    # fingers as two curves across the fist.
    for k in (-0.42, -0.12, 0.18):
        cv2.ellipse(image, (cx + int(unit * k), cy - int(unit * 0.32)),
                    (int(unit * 0.14), int(unit * 0.07)), 0, 15, 165, crease, line_w,
                    cv2.LINE_AA)
    for k in (0.04, 0.32):
        cv2.ellipse(image, (cx, cy + int(unit * (k - 0.2))),
                    (int(unit * 0.46), int(unit * 0.22)), 0, 20, 160, crease, line_w,
                    cv2.LINE_AA)
    # Finger joints: two faint creases across the barrel, and the thumb's base.
    for k in (0.85, 1.3):
        x = cx - int(unit * k)
        cv2.line(image, (x, cy - int(unit * 0.28)), (x + int(unit * 0.03), cy + int(unit * 0.04)),
                 crease, line_w, cv2.LINE_AA)
    cv2.line(image, (cx - int(unit * 0.05), cy - int(unit * 0.62)),
             (cx + int(unit * 0.3), cy - int(unit * 0.5)), crease, line_w, cv2.LINE_AA)

    # Muzzle flash at the fingertip: no starburst. A soft radial bloom, a few
    # additive streaks blurred into it, a hot white core, and the warm light
    # it throws onto the fingertip and the hand, falling off with distance.
    tip = (cx - int(unit * 1.98), cy - int(unit * 0.12))
    d = _radial(width, height, tip, unit)
    warm = np.array(_EMBLEM_WARM, np.float32)
    lit = np.exp(-(d / 1.5) ** 2)[:, :, None]
    subject = cv2.GaussianBlur(cv2.bitwise_or(mask, sleeve), (0, 0), 1.0)
    subject = subject.astype(np.float32)[:, :, None] / 255.0
    throw = image.astype(np.float32) + warm * lit * subject * 0.8 * (
        np.array((0.7, 0.9, 1.0), np.float32))
    image[:] = np.clip(throw, 0, 255).astype(np.uint8)
    bloom = np.exp(-(d / 0.42) ** 2) * 1.0 + np.exp(-(d / 1.2) ** 2) * 0.2
    image[:] = np.clip(image + warm * bloom[:, :, None] * 0.8, 0, 255).astype(np.uint8)
    streaks = np.zeros_like(image)
    rng = np.random.default_rng(7)
    for index in range(9):
        angle = index * 2 * np.pi / 9 + 0.3 + rng.uniform(-0.15, 0.15)
        length = unit * rng.uniform(0.55, 1.05)
        end = (tip[0] + int(np.cos(angle) * length), tip[1] + int(np.sin(angle) * length))
        cv2.line(streaks, tip, end, (120, 205, 255), max(1, int(unit * 0.035)),
                 cv2.LINE_AA)
    _add_glow(image, streaks, unit * 0.08, 0.85)
    core = np.exp(-(d / 0.17) ** 2)[:, :, None]
    image[:] = np.clip(image + np.array((230, 250, 255), np.float32) * core, 0,
                       255).astype(np.uint8)
    return image


@lru_cache(maxsize=4)
def _gaze_art(width: int, height: int) -> np.ndarray:
    image = _emblem_ground(width, height, 0.7)
    cx, cy = width // 2, int(height * 0.52)
    hw = int(min(width * 0.36, height * 0.62))
    up, down = int(hw * 0.52), int(hw * 0.42)

    upper = cv2.ellipse2Poly((cx, cy), (hw, up), 0, 180, 360, 1)
    lower = cv2.ellipse2Poly((cx, cy), (hw, down), 0, 0, 180, 1)
    almond = np.concatenate([upper, lower]).astype(np.int32)

    # Brow: a hard shaded solid above the eye, the same finish as the lids.
    brow = np.zeros((height, width), np.uint8)
    cv2.ellipse(brow, (cx, cy + int(up * 0.3)), (int(hw * 1.08), int(up * 2.05)), 0,
                205, 335, 255, max(4, int(hw * 0.08)), cv2.LINE_AA)
    _shadow(image, brow, hw, 0.45)
    _solid(image, brow, (58, 50, 46), hw, 0.6)

    # Sclera: off-white, lit from the upper left like everything else, and
    # shaded under the upper lid where the lid's shadow falls.
    sclera = np.zeros((height, width), np.uint8)
    cv2.fillPoly(sclera, [almond], 255, cv2.LINE_AA)
    _shadow(image, sclera, hw)
    _solid(image, sclera, (216, 214, 208), hw)
    inside = sclera.astype(np.float32)[:, :, None] / 255.0
    key = np.clip((np.arange(width, dtype=np.float32) - (cx - hw)) / (2 * hw), 0, 1)
    image[:] = (image * (1.0 - 0.22 * key[None, :, None] * inside)).astype(np.uint8)
    shade = np.zeros_like(image)
    cv2.ellipse(shade, (cx, cy - up), (hw, int(up * 0.95)), 0, 0, 180, (70, 70, 70), -1,
                cv2.LINE_AA)
    soft = cv2.GaussianBlur(shade, (0, 0), max(1.0, hw * 0.03)).astype(np.float32)
    image[:] = np.clip(image - soft * inside, 0, 255).astype(np.uint8)

    # Iris as a reticle: amber, the warm accent, with a crisp ring, ticks,
    # radial fibres and a black pupil.
    ir = int(up * 0.82)
    d = _radial(width, height, (cx, cy), ir)
    inner = np.array((30, 120, 190), np.float32)
    outer = np.array((16, 52, 92), np.float32)
    t = np.clip(d, 0, 1)[:, :, None]
    iris = inner * (1 - t ** 1.3) + outer * t ** 1.3
    iris_mask = np.zeros((height, width), np.uint8)
    cv2.circle(iris_mask, (cx, cy), ir, 255, -1, cv2.LINE_AA)
    iris_mask = cv2.bitwise_and(iris_mask, sclera)
    a = iris_mask[:, :, None].astype(np.float32) / 255.0
    image[:] = (iris * a + image * (1 - a)).astype(np.uint8)
    for index in range(36):
        angle = index * np.pi / 18
        r0, r1 = ir * 0.42, ir * 0.96
        p0 = (cx + int(np.cos(angle) * r0), cy + int(np.sin(angle) * r0))
        p1 = (cx + int(np.cos(angle) * r1), cy + int(np.sin(angle) * r1))
        cv2.line(image, p0, p1, (50, 170, 240) if index % 2 else (20, 70, 120), 1,
                 cv2.LINE_AA)
    tick = max(1, int(ir * 0.06))
    cv2.circle(image, (cx, cy), int(ir * 0.7), _EMBLEM_WARM, tick, cv2.LINE_AA)
    cv2.circle(image, (cx, cy), ir - 1, (14, 36, 60), max(1, int(ir * 0.05)), cv2.LINE_AA)
    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        inner_pt = (cx + int(dx * ir * 0.48), cy + int(dy * ir * 0.48))
        outer_pt = (cx + int(dx * ir * 0.9), cy + int(dy * ir * 0.9))
        cv2.line(image, inner_pt, outer_pt, _EMBLEM_WARM, tick, cv2.LINE_AA)
    cv2.circle(image, (cx, cy), int(ir * 0.34), (10, 10, 12), -1, cv2.LINE_AA)
    # Catchlight: a hard white spot at the upper left, the same specular as
    # the scope's glint, with a small bloom so the eye looks wet.
    glint = np.zeros_like(image)
    cv2.circle(glint, (cx - int(ir * 0.3), cy - int(ir * 0.32)), int(ir * 0.15),
               (255, 255, 255), -1, cv2.LINE_AA)
    _add_glow(image, glint, ir * 0.12, 0.7)
    cv2.circle(image, (cx - int(ir * 0.3), cy - int(ir * 0.32)), int(ir * 0.12),
               _EMBLEM_RIM, -1, cv2.LINE_AA)
    cv2.circle(image, (cx + int(ir * 0.28), cy + int(ir * 0.3)), int(ir * 0.06),
               (220, 230, 230), -1, cv2.LINE_AA)

    # Lids: a heavy upper stroke and a thinner lower one, with lashes, as
    # one hard chrome solid so the lit rim along the top is crisp.
    lids = np.zeros((height, width), np.uint8)
    heavy, light = max(4, int(hw * 0.09)), max(3, int(hw * 0.06))
    cv2.polylines(lids, [upper.astype(np.int32)], False, 255, heavy, cv2.LINE_AA)
    cv2.polylines(lids, [lower.astype(np.int32)], False, 255, light, cv2.LINE_AA)
    for k in (0.68, 0.82, 0.93):
        x = cx - int(hw * k)
        y = cy - int(up * np.sqrt(max(0.0, 1 - k * k)))
        cv2.line(lids, (x, y), (x - int(hw * 0.12), y - int(hw * 0.1)), 255,
                 max(2, int(hw * 0.04)), cv2.LINE_AA)
    _shadow(image, lids, hw, 0.5)
    _solid(image, lids, (124, 110, 100), hw)
    return image


@lru_cache(maxsize=4)
def _marksman_art(width: int, height: int) -> np.ndarray:
    image = _emblem_ground(width, height, 0.7)
    cx, cy = width // 2, int(height * 0.52)
    r = int(min(width * 0.3, height * 0.4))
    rim = max(4, int(r * 0.16))

    # The tube: a cylinder behind the lens, running off to the right, lit the
    # way a cylinder is: a bright band just above its axis, dark underneath.
    top_y, bot_y = cy - int(r * 0.72), cy + int(r * 0.72)
    tube = np.zeros((height, width), np.uint8)
    cv2.rectangle(tube, (cx, top_y), (width + 10, bot_y), 255, -1)
    _shadow(image, tube, r)
    t = np.linspace(0.0, 1.0, max(1, bot_y - top_y), dtype=np.float32)
    profile = 0.5 + 0.8 * np.exp(-((t - 0.28) / 0.22) ** 2) - 0.3 * t
    body = np.array((140, 134, 128), np.float32)[None, :] * profile[:, None]
    image[top_y:bot_y, cx:] = np.clip(body, 0, 255).astype(np.uint8)[:, None, :]
    cv2.line(image, (cx, top_y), (width, top_y), (200, 194, 186), 1, cv2.LINE_AA)
    cv2.line(image, (cx, bot_y), (width, bot_y), (24, 22, 20), 1, cv2.LINE_AA)
    # A collar ring where the tube meets the bell of the objective.
    for k in (0.86, 0.98):
        x = cx + int(r * k)
        cv2.line(image, (x, top_y), (x, bot_y), (40, 38, 36), max(1, int(r * 0.03)),
                 cv2.LINE_AA)
        cv2.line(image, (x + max(1, int(r * 0.03)), top_y),
                 (x + max(1, int(r * 0.03)), bot_y), (140, 134, 128), 1, cv2.LINE_AA)
    # Turret knob on top, lit from the same upper left.
    knob = np.zeros((height, width), np.uint8)
    cv2.rectangle(knob, (cx + int(r * 1.25), cy - int(r * 1.08)),
                  (cx + int(r * 1.62), cy - int(r * 0.6)), 255, -1)
    _shadow(image, knob, r, 0.5)
    _solid(image, knob, (120, 114, 108), r)
    for k in (0.33, 0.5, 0.66):
        y = cy - int(r * (1.08 - 0.48 * k))
        cv2.line(image, (cx + int(r * 1.27), y), (cx + int(r * 1.6), y), (50, 48, 46), 1,
                 cv2.LINE_AA)

    # The objective ring: a bevelled annulus, lit from the upper left.
    ring = np.zeros((height, width), np.uint8)
    cv2.circle(ring, (cx, cy), r, 255, -1, cv2.LINE_AA)
    cv2.circle(ring, (cx, cy), r - rim, 0, -1, cv2.LINE_AA)
    _shadow(image, ring, r)
    _solid(image, ring, (150, 146, 140), r)
    cv2.circle(image, (cx, cy), r - rim // 2, (60, 58, 55), 1, cv2.LINE_AA)
    # Knurling: short ticks around the outside of the ring.
    for index in range(48):
        angle = index * np.pi / 24
        p0 = (cx + int(np.cos(angle) * (r - rim * 0.35)),
              cy + int(np.sin(angle) * (r - rim * 0.35)))
        p1 = (cx + int(np.cos(angle) * (r - 1)), cy + int(np.sin(angle) * (r - 1)))
        cv2.line(image, p0, p1, (60, 58, 55), 1, cv2.LINE_AA)

    # The lens: deep blue glass, a lighter pool towards the bottom, the
    # reticle etched over it, and a glint along the upper-left of the glass.
    lr = r - rim
    ys = (np.arange(height, dtype=np.float32) - cy) / lr
    xs = (np.arange(width, dtype=np.float32) - cx) / lr
    d = np.sqrt(xs[None, :] ** 2 + ys[:, None] ** 2)
    deep = np.array((70, 40, 18), np.float32)
    edge = np.array((30, 18, 10), np.float32)
    t = np.clip(d, 0, 1)[:, :, None]
    glass = deep * (1 - t ** 1.5) + edge * t ** 1.5
    pool = np.exp(-((xs[None, :] + 0.25) ** 2 + (ys[:, None] - 0.45) ** 2) / 0.25)
    glass = glass + np.array((150, 90, 40), np.float32) * pool[:, :, None] * 0.5
    lens = np.zeros((height, width), np.uint8)
    cv2.circle(lens, (cx, cy), lr, 255, -1, cv2.LINE_AA)
    a = lens[:, :, None].astype(np.float32) / 255.0
    image[:] = np.clip(glass * a + image * (1 - a), 0, 255).astype(np.uint8)

    ink = (225, 228, 230)
    w = max(1, int(lr * 0.035))
    cv2.line(image, (cx - lr, cy), (cx + lr, cy), ink, w, cv2.LINE_AA)
    cv2.line(image, (cx, cy - lr), (cx, cy + lr), ink, w, cv2.LINE_AA)
    for k in (0.28, 0.5, 0.72):
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            cv2.circle(image, (cx + int(dx * lr * k), cy + int(dy * lr * k)),
                       max(1, int(lr * 0.04)), ink, -1, cv2.LINE_AA)
    cv2.circle(image, (cx, cy), int(lr * 0.14), ink, w, cv2.LINE_AA)
    cv2.circle(image, (cx, cy), max(2, int(lr * 0.04)), _EMBLEM_WARM, -1, cv2.LINE_AA)
    # Rangefinder ladder on the lower half.
    for k in (0.4, 0.55, 0.7):
        half = int(lr * (0.2 - (k - 0.4) * 0.3))
        y = cy + int(lr * k)
        cv2.line(image, (cx - half, y), (cx + half, y), ink, 1, cv2.LINE_AA)

    glint = np.zeros_like(image)
    cv2.ellipse(glint, (cx, cy), (int(lr * 0.86), int(lr * 0.86)), 0, 200, 262,
                (255, 240, 220), max(2, int(lr * 0.07)), cv2.LINE_AA)
    cv2.ellipse(glint, (cx, cy), (int(lr * 0.86), int(lr * 0.86)), 0, 268, 282,
                (255, 240, 220), max(1, int(lr * 0.04)), cv2.LINE_AA)
    _add_glow(image, glint, lr * 0.08, 0.9)
    cv2.ellipse(image, (cx, cy), (int(lr * 0.86), int(lr * 0.86)), 0, 205, 258,
                _EMBLEM_RIM, max(1, int(lr * 0.03)), cv2.LINE_AA)
    return image


def pistol_emblem(panel: np.ndarray) -> None:
    """Card art for the hand scheme: the finger-pistol, mid-shot."""
    height, width = panel.shape[:2]
    panel[:] = _pistol_art(width, height)


def gaze_emblem(panel: np.ndarray) -> None:
    """Card art for the eye scheme: an eye whose iris is a reticle."""
    height, width = panel.shape[:2]
    panel[:] = _gaze_art(width, height)


def marksman_emblem(panel: np.ndarray) -> None:
    """Card art for the marksman: the objective lens of a scope, glinting."""
    height, width = panel.shape[:2]
    panel[:] = _marksman_art(width, height)
