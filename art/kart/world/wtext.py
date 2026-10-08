"""Flat things for painting: planes and pixel lettering (5x7 cells, each lit pixel a flat square floating just above its plane)."""
from mathutils import Vector


class Plane:
    """A flat surface to paint on: `origin`, facing `normal`, with its own up. u runs to the right as seen from the front.
    `flip` for a span landmark (modelled in the road's frame, where +x is the driver's right and so the world's -x): its model
    is mirrored on the way into the world, so lettering is drawn mirrored to read right."""

    def __init__(self, origin, normal=(0, 0, 1), up=(0, 1, 0), flip=False):
        self.o = Vector(origin)
        self.n = Vector(normal).normalized()
        u = Vector(up)
        self.r = u.cross(self.n).normalized() * (-1.0 if flip else 1.0)
        self.u = (u - self.n * u.dot(self.n)).normalized()

    def at(self, u, v):
        return self.o + self.r * u + self.u * v, self.n

    __call__ = at


FONT = {
    "A": ".###.|#...#|#...#|#####|#...#|#...#|#...#", "B": "####.|#...#|#...#|####.|#...#|#...#|####.",
    "C": ".####|#....|#....|#....|#....|#....|.####", "D": "####.|#...#|#...#|#...#|#...#|#...#|####.",
    "E": "#####|#....|#....|####.|#....|#....|#####", "F": "#####|#....|#....|####.|#....|#....|#....",
    "G": ".####|#....|#....|#..##|#...#|#...#|.###.", "H": "#...#|#...#|#...#|#####|#...#|#...#|#...#",
    "I": "#####|..#..|..#..|..#..|..#..|..#..|#####", "J": "..###|...#.|...#.|...#.|...#.|#..#.|.##..",
    "K": "#...#|#..#.|#.#..|##...|#.#..|#..#.|#...#", "L": "#....|#....|#....|#....|#....|#....|#####",
    "M": "#...#|##.##|#.#.#|#.#.#|#...#|#...#|#...#", "N": "#...#|##..#|#.#.#|#..##|#...#|#...#|#...#",
    "O": ".###.|#...#|#...#|#...#|#...#|#...#|.###.", "P": "####.|#...#|#...#|####.|#....|#....|#....",
    "Q": ".###.|#...#|#...#|#...#|#.#.#|#..#.|.##.#", "R": "####.|#...#|#...#|####.|#.#..|#..#.|#...#",
    "S": ".####|#....|#....|.###.|....#|....#|####.", "T": "#####|..#..|..#..|..#..|..#..|..#..|..#..",
    "U": "#...#|#...#|#...#|#...#|#...#|#...#|.###.", "V": "#...#|#...#|#...#|#...#|#...#|.#.#.|..#..",
    "W": "#...#|#...#|#...#|#.#.#|#.#.#|##.##|#...#", "X": "#...#|#...#|.#.#.|..#..|.#.#.|#...#|#...#",
    "Y": "#...#|#...#|.#.#.|..#..|..#..|..#..|..#..", "Z": "#####|....#|...#.|..#..|.#...|#....|#####",
    "0": ".###.|#...#|#..##|#.#.#|##..#|#...#|.###.", "1": "..#..|.##..|..#..|..#..|..#..|..#..|.###.",
    "2": ".###.|#...#|....#|...#.|..#..|.#...|#####", "3": "#####|...#.|..#..|...#.|....#|#...#|.###.",
    "4": "...#.|..##.|.#.#.|#..#.|#####|...#.|...#.", "5": "#####|#....|####.|....#|....#|#...#|.###.",
    "6": "..##.|.#...|#....|####.|#...#|#...#|.###.", "7": "#####|....#|...#.|..#..|.#...|.#...|.#...",
    "8": ".###.|#...#|#...#|.###.|#...#|#...#|.###.", "9": ".###.|#...#|#...#|.####|....#|...#.|.##..",
    "!": "..#..|..#..|..#..|..#..|..#..|.....|..#..", ".": ".....|.....|.....|.....|.....|..##.|..##.",
    "'": ".#...|.#...|#....|.....|.....|.....|.....", "-": ".....|.....|.....|#####|.....|.....|.....",
    "&": ".##..|#..#.|#.#..|.#...|#.#.#|#..#.|.##.#", " ": ".....|.....|.....|.....|.....|.....|.....",
}


def text_width(s: str, h: float, gap: float = 1.0) -> float:
    """Width of `s` set in letters `h` tall (cells h/7; `gap` cells between letters)."""
    cell = h / 7.0
    return (len(s) * 5 + (len(s) - 1) * gap) * cell


def text(target, plane, s: str, h: float, col, at=(0.0, 0.0), align="center", lift=0.05, mat="matte", gap: float = 1.0, pad: float = 0.0):
    """Letters of height `h` painted on `plane`; `at` is (u, v) of the middle (or left / right edge) of the baseline."""
    cell = h / 7.0
    w = text_width(s, h, gap)
    u0 = at[0] - (w / 2 if align == "center" else (w if align == "right" else 0.0))
    v0 = at[1]
    px = cell * (1.0 - pad)
    o = (cell - px) / 2
    for ci, ch in enumerate(s):
        rows = FONT.get(ch.upper(), FONT[" "]).split("|")
        cu = u0 + ci * (5 + gap) * cell
        for ry, row in enumerate(rows):
            for rx, c in enumerate(row):
                if c == "#":
                    u = cu + rx * cell + o
                    v = v0 + (6 - ry) * cell + o
                    target.decal(plane, [(u, v), (u + px, v), (u + px, v + px), (u, v + px)], col, lift, mat)
