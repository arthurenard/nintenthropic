"""Paint for cloth, leather, metal and wood - dusty, sun-worn, used.

Every function takes points on the sculpt (world metres) and returns linear
albedo, roughness and metalness. The wear follows the story of the object: a
shirt fades on the shoulders where the sun hits and darkens at the collar and
cuffs, trousers bag and lighten at the knees and carry the street's dust up
from the boots, boots scuff at the toes, holster leather darkens where hands go.
"""
import numpy as np
from .texture import srgb, smoothstep, value_noise, fbm

DUST = srgb(0.66, 0.58, 0.47)


def _mix(a, b, t):
    t = np.asarray(t)[:, None]
    return a * (1 - t) + b * t


def dust(P, amount, height=0.6):
    """Dust climbs from the ground: heavy on boots, a veil on the knees."""
    z = P[:, 2]
    g = np.clip(1.0 - z / height, 0, 1) ** 1.6
    n = fbm(P, 30, 3, seed=91)
    return np.clip(amount * (0.25 + 0.75 * g) * (0.6 + 0.8 * n), 0, 1)


def fabric(P, color, kind="cotton", dust_amt=0.35, fade=0.25, seed=0, grime=0.0):
    n = len(P)
    base = np.tile(srgb(*color), (n, 1))
    m1 = fbm(P, 18, 3, seed=seed + 1)
    m2 = value_noise(P * np.array([1, 1, 3.0]), 160, seed=seed + 2)
    # sun fading from above, mottled
    up = np.clip((P[:, 2] - 0.9) / 0.6, 0, 1)
    f = fade * (0.4 + 0.6 * up) * (0.5 + 0.8 * m1)
    faded = base * 0.75 + np.mean(base, 1, keepdims=True) * 0.25 + 0.06
    col = _mix(base, faded, np.clip(f, 0, 1))
    col *= (0.92 + 0.14 * m2)[:, None]
    if grime:
        col *= (1 - grime * 0.3 * smoothstep(0.5, 0.8, fbm(P, 60, 3, seed=seed + 3)))[:, None]
    col = _mix(col, DUST, dust(P, dust_amt))
    rough = {"cotton": 0.88, "wool": 0.93, "canvas": 0.86, "denim": 0.85, "silk": 0.45}[kind] - 0.05 * m2
    return col, rough, np.zeros(n)


def leather(P, color, dust_amt=0.4, wear=0.5, seed=0, shine=0.0):
    n = len(P)
    base = np.tile(srgb(*color), (n, 1))
    m1 = fbm(P, 40, 4, seed=seed + 11)
    grain = value_noise(P, 900, seed=seed + 12)
    creases = smoothstep(0.62, 0.7, value_noise(P * np.array([1, 1, 4.0]), 120, seed=seed + 13))
    col = base * (0.8 + 0.35 * m1[:, None]) * (0.95 + 0.1 * grain[:, None])
    col *= (1 - 0.25 * creases)[:, None]
    # worn edges go lighter and dry
    worn = wear * smoothstep(0.55, 0.85, fbm(P, 70, 3, seed=seed + 14))
    col = _mix(col, col * 1.45 + 0.02, worn)
    col = _mix(col, DUST, dust(P, dust_amt, 0.5))
    rough = 0.62 - 0.18 * shine + 0.2 * worn - 0.05 * grain
    return np.clip(col, 0, 1), np.clip(rough, 0.2, 1), np.zeros(n)


def metal(P, color=(0.22, 0.23, 0.24), rough=0.38, rust=0.0, seed=0, brass=False):
    n = len(P)
    base = np.tile(srgb(*color), (n, 1))
    m = fbm(P, 200, 3, seed=seed + 21)
    col = base * (0.85 + 0.3 * m[:, None])
    r = np.full(n, rough) + 0.15 * (m - 0.5)
    met = np.ones(n)
    if rust:
        rs = rust * smoothstep(0.55, 0.8, fbm(P, 90, 4, seed=seed + 22))
        col = _mix(col, srgb(0.36, 0.20, 0.11), rs)
        r = r * (1 - rs) + 0.85 * rs
        met = met * (1 - rs)
    return col, np.clip(r, 0.1, 1), met


def wood(P, color=(0.30, 0.17, 0.09), axis=(0, 0, 1), seed=0, rough=0.5):
    n = len(P)
    a = np.asarray(axis, float)
    a /= np.linalg.norm(a)
    q = P - (P @ a)[:, None] * a
    rings = np.sin(np.linalg.norm(q, axis=1) * 900 + 6 * value_noise(P, 60, seed=seed + 31)) * 0.5 + 0.5
    col = np.tile(srgb(*color), (n, 1)) * (0.75 + 0.35 * rings[:, None])
    return col, np.full(n, rough) - 0.1 * rings, np.zeros(n)


def skin(P, tone="tanned", seed=0, dirt=0.3, knuckles=None):
    from .texture import SKIN
    n = len(P)
    col = np.tile(SKIN[tone], (n, 1))
    m1 = fbm(P, 80, 3, seed=seed + 41)
    col *= (0.9 + 0.18 * m1)[:, None]
    col = _mix(col, srgb(0.60, 0.33, 0.27), 0.25 * smoothstep(0.5, 0.8, fbm(P, 150, 2, seed=seed + 42)))
    col *= (1 - dirt * 0.3 * smoothstep(0.55, 0.85, fbm(P, 120, 3, seed=seed + 43)))[:, None]
    return col, np.full(n, 0.55) - 0.05 * m1, np.zeros(n)
