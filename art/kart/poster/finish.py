"""
Grades the Cycles renders (art/kart/poster/build/*.png) and encodes what the game ships. Plain python3 with Pillow and numpy:

    python3 art/kart/poster/finish.py [poster] [title] [icon]      (all three by default)

poster  -> public/assets/kart/poster.webp   1600x900,  at most 250 KB
title   -> public/assets/kart/title.webp    2560x1440, at most 450 KB
icon    -> public/assets/kart/icon.png      1024x1024 (opaque, square: the OS masks it) and icon-180.png

The grade: a touch more colour, a soft S-curve, a bloom on the brightest parts (the sun, the flames and sparks, glints),
a breath of vignette and film grain (which also keeps the sky from banding when it is compressed). A shot's sidecar
(<name>.json, written by build.py) says where its sun is, for its glow.
"""
import json
import os
import sys

import numpy as np
from PIL import Image, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
BUILD = os.path.join(HERE, "build")
OUT = os.path.join(ROOT, "public", "assets", "kart")

SPECS = {
    "poster": dict(size=(1600, 900), limit=250_000, sat=1.14, contrast=0.16, bloom=0.30, vignette=0.10, grain=0.9),
    "title": dict(size=(2560, 1440), limit=450_000, sat=1.12, contrast=0.14, bloom=0.26, vignette=0.07, grain=0.8),
    "icon": dict(size=(1024, 1024), limit=None, sat=1.12, contrast=0.12, bloom=0.2, vignette=0.07, grain=0.0),
}


def to_float(img):
    return np.asarray(img.convert("RGB"), dtype=np.float32) / 255.0


def luma(a):
    return a[..., 0] * 0.2126 + a[..., 1] * 0.7152 + a[..., 2] * 0.0722


def saturate(a, k):
    y = luma(a)[..., None]
    return np.clip(y + (a - y) * k, 0, 1)


def scurve(a, amount):
    # smooth contrast about the mid grey, keeping the ends
    s = a * a * (3 - 2 * a)
    return a + (s - a) * amount * 2.0


def blur(a, radius):
    """A Gaussian blur of a float image by `radius` pixels, through a downscaled copy (cheap for big radii)."""
    h, w = a.shape[:2]
    k = max(1, int(radius // 6))
    im = Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8))
    small = im.resize((max(1, w // k), max(1, h // k)), Image.BILINEAR).filter(ImageFilter.GaussianBlur(radius / k))
    return np.asarray(small.resize((w, h), Image.BICUBIC), dtype=np.float32) / 255.0


def bloom(a, amount, size):
    y = luma(a)
    mask = np.clip((y - 0.78) / 0.22, 0, 1)[..., None] * a
    glow = blur(mask, size * 0.012) * 0.7 + blur(mask, size * 0.04) * 0.5
    return 1 - (1 - a) * (1 - np.clip(glow * amount * 1.8, 0, 1))  # screen


def sun_glow(a, xy, strength=0.5):
    h, w = a.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    d = np.sqrt(((xx / w - xy[0]) * w) ** 2 + ((yy / h - xy[1]) * w) ** 2) / w
    g = np.exp(-(d / 0.07) ** 2) * 0.6 + np.exp(-(d / 0.22) ** 2) * 0.35 + np.exp(-(d / 0.5) ** 2) * 0.12
    warm = np.array([1.0, 0.86, 0.62], np.float32)
    return 1 - (1 - a) * (1 - np.clip(g[..., None] * warm * strength, 0, 1))


def vignette(a, k):
    h, w = a.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    r = np.sqrt(((xx / w - 0.5) * 1.15) ** 2 + ((yy / h - 0.5) * 1.0) ** 2)
    v = 1 - k * np.clip((r - 0.28) / 0.5, 0, 1) ** 2
    return a * v[..., None]


def grade(a, spec, post):
    a = saturate(a, spec["sat"])
    a = np.clip(scurve(a, spec["contrast"]), 0, 1)
    if post.get("sun"):
        a = sun_glow(a, post["sun"], post.get("sun_strength", 0.5))
    a = bloom(a, spec["bloom"], a.shape[1])
    if spec["vignette"]:
        a = vignette(a, spec["vignette"])
    return np.clip(a, 0, 1)


def grain(a, amount, seed=3):
    if not amount:
        return a
    rng = np.random.default_rng(seed)
    n = rng.normal(0, 1, a.shape[:2]).astype(np.float32)[..., None]
    return np.clip(a + n * amount / 255.0 * 1.6, 0, 1)


def encode_webp(img, path, limit):
    """The highest WebP quality whose file fits `limit` bytes."""
    best = None
    for q in range(94, 40, -2):
        img.save(path, "WEBP", quality=q, method=6)
        size = os.path.getsize(path)
        if limit is None or size <= limit:
            best = (q, size)
            break
    return best


def run(name):
    spec = SPECS[name]
    src = os.path.join(BUILD, f"{name}.png")
    post = {}
    side = os.path.join(BUILD, f"{name}.json")
    if os.path.exists(side):
        post = json.load(open(side))
    im = Image.open(src).convert("RGB")
    a = grade(to_float(im), spec, post)
    w, h = spec["size"]
    out = Image.fromarray((a * 255 + 0.5).astype(np.uint8))
    if out.size != (w, h):
        out = out.resize((w, h), Image.LANCZOS)
    a = grain(np.asarray(out, np.float32) / 255.0, spec["grain"])
    out = Image.fromarray((a * 255 + 0.5).astype(np.uint8))
    os.makedirs(OUT, exist_ok=True)
    if name == "icon":
        out.save(os.path.join(OUT, "icon.png"), optimize=True)
        out.resize((180, 180), Image.LANCZOS).save(os.path.join(OUT, "icon-180.png"), optimize=True)
        print("icon.png", os.path.getsize(os.path.join(OUT, "icon.png")) // 1024, "KB; icon-180.png", os.path.getsize(os.path.join(OUT, "icon-180.png")) // 1024, "KB")
        return
    path = os.path.join(OUT, f"{name}.webp")
    q, size = encode_webp(out, path, spec["limit"])
    print(f"{name}.webp  {w}x{h}  quality {q}  {size / 1024:.0f} KB")


if __name__ == "__main__":
    for n in (sys.argv[1:] or list(SPECS)):
        run(n)
