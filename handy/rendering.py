"""Hand-skeleton drawing, used for the webcam inset."""

from __future__ import annotations

import cv2
import numpy as np

from .recognition import FINGERTIPS, HAND_CONNECTIONS, Frame, Hand

# Colours are BGR, as OpenCV expects. The hands' own colours only mark the
# debug captions apart.
LEFT_HAND = (255, 176, 0)
RIGHT_HAND = (80, 200, 120)

_FONT = cv2.FONT_HERSHEY_SIMPLEX


def outline_weight(scale: float, thickness: int) -> int:
    """How heavy the dark halo behind text should be.

    It has to grow with the text: a fixed halo that reads as a soft shadow at
    title size swallows the strokes of small text completely.
    """
    return thickness + max(2, round(3 * scale))


def text_width(text: str, scale: float, thickness: int = 2,
               outline: bool = True) -> int:
    """Rendered width in pixels, halo included, for laying text out.

    OpenCV's own measurement saturates: it reports the same width for a stroke
    two pixels wide and one six pixels wide, which is how a wrapped line ends up
    painted past the edge of the box it was fitted to. The extra weight is added
    back by hand.
    """
    weight = outline_weight(scale, thickness) if outline else thickness
    measured = cv2.getTextSize(text, _FONT, scale, min(weight, 2))[0][0]
    return measured + max(0, weight - 2)


def draw_text(image: np.ndarray, text: str, origin: tuple[int, int],
              color: tuple[int, int, int], scale: float = 0.7,
              thickness: int = 2, outline: bool = True) -> None:
    """Draw text, by default with a dark halo so it reads over any background.

    Turn the halo off where the background is already a flat panel: at small
    sizes it costs more legibility than it buys.
    """
    if outline:
        cv2.putText(image, text, origin, _FONT, scale, (0, 0, 0),
                    outline_weight(scale, thickness), cv2.LINE_AA)
    cv2.putText(image, text, origin, _FONT, scale, color, thickness, cv2.LINE_AA)


def caption(hand: Hand) -> str:
    """Human-readable summary of what was recognised, e.g. ``Right: Thumb Up 0.98``."""
    if hand.gesture is None:
        return f"{hand.handedness}: hand"
    return f"{hand.handedness}: {hand.gesture.replace('_', ' ')} {hand.score:.2f}"


#: The skeleton on the camera's picture: white bones, soft round white
#: joints, over a faint dark shadow that keeps them clear of a pale shirt or
#: a lit wall. Not colour-coded: which hand it is is only ever a debug
#: question, and the captions answer it.
SKELETON = (255, 255, 255)
SHADOW_STRENGTH = 0.35


def draw_hand(image: np.ndarray, hand: Hand, scale: float = 1.0,
              show_caption: bool = True) -> None:
    """Draw one hand's skeleton. ``scale`` sizes the strokes for small insets."""
    height, width = image.shape[:2]
    points = [(int(x * width), int(y * height)) for x, y in hand.landmarks]
    bone = max(1, round(2.2 * scale))
    joint = max(1.5, 3.4 * scale)
    tip = max(2.0, 4.4 * scale)

    def strokes(canvas, colour, grow: int) -> None:
        for start, end in HAND_CONNECTIONS:
            cv2.line(canvas, points[start], points[end], colour, bone + grow, cv2.LINE_AA)
        for index, point in enumerate(points):
            radius = round(tip if index in FINGERTIPS else joint) + grow // 2
            cv2.circle(canvas, point, max(1, radius), colour, -1, cv2.LINE_AA)

    xs, ys = [p[0] for p in points], [p[1] for p in points]
    pad = round(tip) + 4
    x0, y0 = max(min(xs) - pad, 0), max(min(ys) - pad, 0)
    x1, y1 = min(max(xs) + pad, width), min(max(ys) + pad, height)
    if x1 > x0 and y1 > y0:
        # The shadow only where the hand is, not over the whole picture.
        region = image[y0:y1, x0:x1]
        shadow = region.copy()
        points_here = points
        points = [(x - x0, y - y0) for x, y in points_here]
        strokes(shadow, (0, 0, 0), max(2, round(2 * scale)))
        cv2.addWeighted(shadow, SHADOW_STRENGTH, region, 1.0 - SHADOW_STRENGTH, 0.0,
                        dst=region)
        points = points_here
    strokes(image, SKELETON, 0)

    if show_caption:
        # Caption sits just above the hand, clamped so it never leaves the frame.
        color = LEFT_HAND if hand.is_left else RIGHT_HAND
        x = max(10, min(min(xs), width - 300))
        y = max(28, min(ys) - 12)
        draw_text(image, caption(hand), (x, y), color, scale=0.7 * scale)


#: Face-mesh indices used to sketch the eyes in the inset.
_EYE_RINGS = ((33, 246, 161, 160, 159, 158, 157, 173, 133,
               155, 154, 153, 145, 144, 163, 7),
              (362, 398, 384, 385, 386, 387, 388, 466, 263,
               249, 390, 373, 374, 380, 381, 382))
_IRIS_CENTRES = (468, 473)


def draw_eyes(image: np.ndarray, frame, scale: float = 1.0) -> np.ndarray:
    """Sketch the eyes and irises in white, as the hand is drawn. Mutates and
    returns ``image``.

    Only the eyes: a full face mesh in a corner of the screen is noise, and the
    eyes are the whole of what the scope reads.
    """
    height, width = image.shape[:2]
    for face in frame.subjects:
        points = [(int(x * width), int(y * height)) for x, y in face.landmarks]
        closed = (face.blink_left, face.blink_right)
        for index, ring in enumerate(_EYE_RINGS):
            outline = np.array([points[i] for i in ring], np.int32)
            if closed[index] > 0.5:
                # A shut eye is a lid: one line through the corners, the way it
                # looks, rather than a ring in a warning colour.
                corners = outline[[0, len(ring) // 2]]
                cv2.polylines(image, [corners], False, SKELETON,
                              max(1, round(2.4 * scale)), cv2.LINE_AA)
                continue
            cv2.polylines(image, [outline], True, SKELETON,
                          max(1, round(1.6 * scale)), cv2.LINE_AA)
            iris = points[_IRIS_CENTRES[index]]
            cv2.circle(image, iris, max(2, round(4 * scale)), SKELETON, -1, cv2.LINE_AA)
    return image


def draw_hands(image: np.ndarray, frame: Frame, scale: float = 1.0,
               show_captions: bool = True) -> np.ndarray:
    """Draw every recognised hand. Mutates and returns ``image``."""
    for hand in frame.hands:
        draw_hand(image, hand, scale=scale, show_caption=show_captions)
    return image
