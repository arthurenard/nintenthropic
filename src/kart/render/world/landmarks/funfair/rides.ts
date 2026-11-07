/**
 * The funfair's big rides beside the road: the ferris wheel, whose cars stay
 * upright as it turns; the carousel, with painted horses, ostriches and cats
 * rising and falling as it goes round; and the candy-striped helter skelter.
 */
import { byHeight, lathe, MeshBuilder, mixRgb, pipe, ramp, rgb, scaleRgb, shapes, stamp, stripes, torus, tube, xf, type Rgb, type V3 } from "../kit";
import type { Halo, LandmarkSpec, MovingPart } from "../types";
import { BLUE, BRASS, bulb, bulbLine, CANDY, candyAt, CREAM, DARK, G_GOLD, G_PINK, G_WARM, G_WHITE, GOLD, lightAt, NAVY, ORANGE, PINK, PURPLE, RED, STEEL, stripedRod, TAU, TEAL, WHITE, YELLOW } from "./common";

// ─── Ferris wheel ────────────────────────────────────────────────────────────

export const ferrisWheel: LandmarkSpec = {
  footprint: 22,
  build() {
    const R = 22;
    const HUB = 27;
    const N = 14;
    const ZS = 2.4;
    const W = 0.14;
    const frame = new MeshBuilder();
    const fGlow = new MeshBuilder();
    const wheelLit = new MeshBuilder();
    const wheelGlow = new MeshBuilder();

    // A boarding platform of planks, the base of the A-frame.
    frame.box(0, -0.5, 0, 42, 1.6, 26, ramp(rgb("#1d1440"), rgb("#4b3a8c")));
    frame.box(0, 0.05, 14.5, 12, 0.5, 4, ramp(rgb("#3b2c72"), rgb("#6a56b8")));

    // A-frame legs: striped candy poles from the hub down to splayed feet.
    const legAt = (sx: number, s: number, y: number): V3 => {
      const t = (HUB - y) / (HUB + 1.5);
      return [sx * 16 * t, y, s * (5 + 3.6 * t)];
    };
    for (const s of [-1, 1]) {
      for (const sx of [-1, 1]) {
        stripedRod(frame, legAt(sx, s, HUB), legAt(sx, s, -1.5), 1.25, 9, RED, CREAM);
        frame.box(sx * 16, -0.1, s * 8.6, 3, 1.2, 3, ramp(DARK, rgb("#5b4aa0")));
      }
      for (const y of [7, 15]) frame.rod(legAt(-1, s, y), legAt(1, s, y), 0.75, STEEL);
    }
    for (const sx of [-1, 1]) {
      for (const y of [7, 15]) frame.rod(legAt(sx, -1, y), legAt(sx, 1, y), 0.75, STEEL);
      frame.rod(legAt(sx, -1, 7), legAt(sx, 1, 15), 0.5, STEEL);
      frame.rod(legAt(sx, 1, 7), legAt(sx, -1, 15), 0.5, STEEL);
    }

    // The sign at the foot: a lit marquee with a golden star and a border of bulbs.
    frame.box(-6.5, 2.2, 9.6, 0.9, 5.2, 0.9, STEEL);
    frame.box(6.5, 2.2, 9.6, 0.9, 5.2, 0.9, STEEL);
    frame.box(0, 6.2, 9.8, 16, 5, 0.8, ramp(DARK, NAVY));
    fGlow.box(0, 6.2, 10.25, 14.4, 3.6, 0.1, [3, 0.5, 1.7]);
    for (const a of [0, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4]) {
      fGlow.rod([Math.cos(a) * -1.9, 6.2 + Math.sin(a) * -1.9, 10.4], [Math.cos(a) * 1.9, 6.2 + Math.sin(a) * 1.9, 10.4], 0.5, [4, 3, 0.8]);
    }
    bulbLine(fGlow, [-7.6, 8.5, 10.35], [7.6, 8.5, 10.35], 15, 0.5);
    bulbLine(fGlow, [-7.6, 3.9, 10.35], [7.6, 3.9, 10.35], 15, 0.5, 2);
    bulbLine(fGlow, [-7.6, 4.4, 10.35], [-7.6, 8.0, 10.35], 4, 0.5, 1);
    bulbLine(fGlow, [7.6, 4.4, 10.35], [7.6, 8.0, 10.35], 4, 0.5, 3);

    // The wheel: two rims either side of the cars, spokes, bracing and bulbs.
    const wheelShade = stripes(WHITE, PINK, "row", 2);
    for (const s of [-1, 1]) {
      const z = s * ZS;
      torus(wheelLit, R, 0.55, { at: [0, HUB, z], facing: "z", ringSegments: 28, tubeSegments: 5, shade: wheelShade });
      torus(wheelLit, 11, 0.4, { at: [0, HUB, z], facing: "z", ringSegments: 21, tubeSegments: 5, shade: stripes(WHITE, TEAL, "row", 1) });
      for (let k = 0; k < N; k++) {
        const a = (k / N) * TAU;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        const half = ((k + 0.5) / N) * TAU;
        wheelLit.rod([0, HUB, z], [ca * R, HUB + sa * R, z], 0.4, STEEL);
        // Zig-zag bracing between the inner ring and the rim.
        wheelLit.rod([ca * 11, HUB + sa * 11, z], [Math.cos(half) * R, HUB + Math.sin(half) * R, z], 0.3, WHITE);
        wheelLit.rod([Math.cos(half) * R, HUB + Math.sin(half) * R, z], [Math.cos(a + TAU / N) * 11, HUB + Math.sin(a + TAU / N) * 11, z], 0.3, WHITE);
      }
      for (let k = 0; k < 28; k++) {
        const a = (k / 28) * TAU + 0.05;
        bulb(wheelGlow, Math.cos(a) * (R + 0.85), HUB + Math.sin(a) * (R + 0.85), z, 0.62, lightAt(k));
      }
      for (let k = 0; k < 21; k++) {
        const a = (k / 21) * TAU;
        bulb(wheelGlow, Math.cos(a) * 11.7, HUB + Math.sin(a) * 11.7, z, 0.5, lightAt(k + 1));
      }
      // The hub star on each face.
      for (let k = 0; k < 4; k++) {
        const a = (k / 8) * TAU;
        wheelGlow.rod([Math.cos(a) * -4, HUB + Math.sin(a) * -4, s * 6.7], [Math.cos(a) * 4, HUB + Math.sin(a) * 4, s * 6.7], 0.55, k % 2 ? G_PINK : G_GOLD);
      }
      wheelGlow.add(shapes.cylinder(12), xf(0, HUB, s * 6.9, 1.5, 0.5, 1.5, 0, Math.PI / 2), G_WHITE);
    }
    // Rim ties between the two sides, and the hub and axle.
    for (let k = 0; k < N; k++) {
      const a = (k / N) * TAU;
      wheelLit.rod([Math.cos(a) * R, HUB + Math.sin(a) * R, -ZS], [Math.cos(a) * R, HUB + Math.sin(a) * R, ZS], 0.5, STEEL);
    }
    wheelLit.add(shapes.cylinder(12), xf(0, HUB, 0, 2.4, 12.4, 2.4, 0, Math.PI / 2), ramp(rgb("#7c7fa8"), rgb("#e4e6f6")));
    wheelLit.add(shapes.cylinder(12), xf(0, HUB, 0, 3.4, 5, 3.4, 0, Math.PI / 2), RED);

    const parts: MovingPart[] = [
      {
        lit: wheelLit,
        glow: wheelGlow,
        pivot: [0, HUB, 0],
        update(t, part) {
          part.rotation.z = W * t;
        },
      },
    ];

    // Each car hangs from its own pin and stays upright: it travels the circle without turning.
    for (let k = 0; k < N; k++) {
      const a = (k / N) * TAU + 0.2;
      const px = R * Math.cos(a);
      const py = HUB + R * Math.sin(a);
      const colour = CANDY[k % CANDY.length]!;
      const l = new MeshBuilder();
      const g = new MeshBuilder();
      l.box(px, py, 0, 0.45, 0.45, 2 * ZS + 0.3, STEEL);
      for (const s of [-1, 1]) l.rod([px, py, s * ZS], [px, py - 1.7, s * 1.2], 0.3, STEEL);
      l.spire(px, py - 1.7, 0, 2.3, 1.4, ramp(scaleRgb(colour, 0.8), mixRgb(colour, WHITE, 0.25)), 8);
      l.post(px, py - 4.3, 0, 1.75, 2.6, ramp(scaleRgb(colour, 0.5), colour), 8);
      l.post(px, py - 4.55, 0, 1.95, 0.35, CREAM, 8);
      for (let w = 0; w < 4; w++) {
        const th = Math.PI / 8 + (w * Math.PI) / 2;
        g.box(px + Math.sin(th) * 1.66, py - 2.9, Math.cos(th) * 1.66, 0.95, 1.0, 0.14, G_WARM, th);
      }
      bulb(g, px, py - 0.2, 0, 0.45, lightAt(k));
      parts.push({
        lit: l,
        glow: g,
        pivot: [px, py, 0],
        update(t, part) {
          const phi = a + W * t;
          part.position.set(R * (Math.cos(phi) - Math.cos(a)), R * (Math.sin(phi) - Math.sin(a)), 0);
        },
      });
    }

    const halos: Halo[] = [{ x: 0, y: HUB, z: 7, size: 16, colour: [4, 2.6, 1.2], alpha: 0.55, twinkle: 0.3 }, { x: 0, y: 6.2, z: 11, size: 12, colour: [4, 0.8, 2], alpha: 0.5, twinkle: 0.2 }];
    for (let k = 0; k < 20; k++) {
      const a = (k / 20) * TAU;
      halos.push({ x: Math.cos(a) * (R + 0.8), y: HUB + Math.sin(a) * (R + 0.8), z: (k % 2 ? 1 : -1) * ZS, size: 5.5, colour: lightAt(k), alpha: 0.4, twinkle: 0.4 });
    }
    for (let k = 0; k < 9; k++) halos.push({ x: -7.2 + k * 1.8, y: 8.5, z: 10.4, size: 3.6, colour: lightAt(k), alpha: 0.5, twinkle: 0.4 });
    return { lit: frame, glow: fGlow, moving: parts, halos };
  },
};

// ─── Carousel ────────────────────────────────────────────────────────────────

/** A painted carousel horse, about 4.6 m nose to tail, facing +z, its body centred on y = 0 and its hooves 1.25 m below, pole through the middle. */
export function horse(coat: Rgb, mane: Rgb, saddle: Rgb): MeshBuilder {
  const b = new MeshBuilder();
  const dark = scaleRgb(coat, 0.55);
  b.blob(0, 0, -0.1, 0.78, 0.82, 1.45, ramp(dark, coat), 0);
  b.blob(0, 0.2, 0.95, 0.72, 0.85, 0.75, ramp(dark, coat), 0);
  b.rod([0, 0.55, 1.1], [0, 1.75, 1.65], 0.85, ramp(dark, coat));
  b.box(0, 2.0, 2.05, 0.62, 0.68, 1.05, coat, 0, 0.45, 0);
  b.box(0, 1.78, 2.55, 0.5, 0.45, 0.4, mixRgb(coat, WHITE, 0.35), 0, 0.45, 0);
  for (const s of [-1, 1]) {
    b.spire(s * 0.22, 2.3, 1.7, 0.14, 0.4, dark, 4);
  }
  // Mane down the neck and a plume of a tail.
  for (let k = 0; k < 3; k++) b.box(0, 1.0 + k * 0.42, 0.75 + k * 0.28, 0.24, 0.5, 0.5, mane, 0, 0.5);
  b.rod([0, 0.45, -1.35], [0, -0.7, -1.9], 0.38, mane);
  // Saddle with gold trim and a blanket.
  b.box(0, 0.86, -0.15, 1.2, 0.18, 1.3, saddle);
  b.box(0, 0.93, -0.15, 1.28, 0.06, 0.2, GOLD);
  b.box(0, 1.0, -0.55, 0.9, 0.3, 0.2, saddle);
  // Four legs in a gallop: fore pair reaching, hind pair kicking back.
  for (const [sx, sz, reach] of [[-1, 1, 0.8], [1, 1, 0.8], [-1, -1, -0.7], [1, -1, -0.7]] as const) {
    const top: V3 = [sx * 0.42, -0.35, sz * 0.9];
    const knee: V3 = [sx * 0.42, -1.1, sz * 0.9 + reach * 0.45];
    const foot: V3 = [sx * 0.42, -1.25, sz * 0.9 + reach * 0.9 - 0.2];
    b.rod(top, knee, 0.34, coat);
    b.rod(knee, [foot[0], foot[1] + 0.3, foot[2] - 0.2], 0.28, mixRgb(coat, GOLD, 0.4));
  }
  return b;
}

/** A carousel ostrich: long legs, a long neck, small head, folded wings. */
function ostrich(body: Rgb, feather: Rgb): MeshBuilder {
  const b = new MeshBuilder();
  b.blob(0, 0, 0, 1.0, 0.95, 1.4, ramp(scaleRgb(body, 0.55), body), 1);
  b.blob(0, 0.2, -1.35, 0.6, 0.7, 0.8, feather, 0);
  b.blob(0, 0.15, -1.9, 0.5, 0.55, 0.6, feather, 0);
  for (const s of [-1, 1]) b.blob(s * 0.95, 0.1, -0.1, 0.18, 0.55, 0.9, scaleRgb(feather, 0.85), 0);
  b.rod([0, 0.4, 0.9], [0, 2.0, 1.25], 0.45, mixRgb(body, WHITE, 0.3));
  b.rod([0, 2.0, 1.25], [0, 2.55, 1.5], 0.36, mixRgb(body, WHITE, 0.3));
  b.blob(0, 2.7, 1.65, 0.3, 0.28, 0.4, mixRgb(body, WHITE, 0.4), 0);
  b.box(0, 2.62, 2.1, 0.18, 0.12, 0.45, ORANGE);
  b.box(-0.17, 2.78, 1.9, 0.05, 0.1, 0.1, DARK);
  b.box(0.17, 2.78, 1.9, 0.05, 0.1, 0.1, DARK);
  for (const s of [-1, 1]) {
    b.rod([s * 0.4, -0.3, 0.1], [s * 0.45, -1.5, 0.5], 0.28, ORANGE);
    b.rod([s * 0.45, -1.5, 0.5], [s * 0.45, -2.3, 0.15], 0.22, ORANGE);
    b.box(s * 0.45, -2.35, 0.4, 0.4, 0.14, 0.7, ORANGE);
  }
  b.box(0, 0.95, 0, 1.0, 0.16, 1.1, RED);
  return b;
}

/** A carousel cat, sitting up with an arched back and a curling tail. */
function cat(body: Rgb, stripe: Rgb): MeshBuilder {
  const b = new MeshBuilder();
  b.blob(0, 0, -0.1, 0.9, 0.85, 1.3, ramp(scaleRgb(body, 0.55), body), 1);
  b.blob(0, 0.5, 0.95, 0.75, 0.75, 0.7, body, 1);
  for (const s of [-1, 1]) {
    b.spire(s * 0.42, 1.4, 0.95, 0.24, 0.55, body, 4);
    b.box(s * 0.28, 0.75, 1.55, 0.14, 0.18, 0.08, DARK);
    b.rod([s * 0.3, 0.45, 1.6], [s * 0.9, 0.5, 1.75], 0.07 + 0.08, WHITE);
    b.rod([s * 0.5, -0.2, 0.9], [s * 0.5, -1.3, 1.05], 0.4, body);
    b.rod([s * 0.5, -0.1, -0.9], [s * 0.5, -1.2, -1.1], 0.45, body);
  }
  b.blob(0, 0.3, 1.58, 0.14, 0.1, 0.1, PINK, 0);
  for (let k = 0; k < 3; k++) b.box(0, 0.55 - k * 0.2, -0.1 + k * 0.5 - 0.5, 1.6, 0.14, 0.18, stripe);
  const tail: V3[] = [];
  for (let k = 0; k <= 7; k++) {
    const t = k / 7;
    tail.push([0, 0.2 + Math.sin(t * 3.4) * 1.5, -1.3 - Math.sin(t * 2.2) * 0.9 + t * 0.4]);
  }
  tube(b, tail, { radius: 0.2, sides: 5, shade: stripe, caps: true });
  b.box(0, 0.9, 0, 0.9, 0.14, 0.9, TEAL);
  return b;
}

export const carousel: LandmarkSpec = {
  footprint: 14,
  build() {
    const RP = 12.5;
    const DECK = 1.4;
    const TOP = 11.8;
    const stage = new MeshBuilder();
    const stageGlow = new MeshBuilder();
    // Static stage the carousel turns on, with a bulb-studded kerb.
    lathe(stage, [[0, -1.5], [14, -1.5], [14.4, 0], [13.2, 1.0], [0, 1.0]], { segments: 24, shade: byHeight(-1.5, 1, DARK, rgb("#6b58b8")), caps: "top" });
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * TAU;
      bulb(stageGlow, Math.cos(a) * 14.1, 0.4, Math.sin(a) * 14.1, 0.5, lightAt(k));
    }
    // A little ticket step at the front.
    stage.box(0, -0.1, 15.5, 6, 1.2, 3, ramp(DARK, rgb("#6b58b8")));

    const spin = new MeshBuilder();
    const spinGlow = new MeshBuilder();
    // Deck, fascia, centre column, canopy: the turning part.
    lathe(spin, [[0, DECK - 0.4], [RP, DECK - 0.4], [RP, DECK], [0, DECK]], { segments: 20, shade: stripes(rgb("#f4e7c8"), rgb("#6b8fe0")), caps: "top" });
    lathe(spin, [[RP, DECK - 0.6], [RP + 0.35, DECK - 0.6], [RP + 0.35, DECK + 0.9], [RP, DECK + 0.9]], { segments: 20, shade: stripes(RED, CREAM), caps: "top" });
    for (let k = 0; k < 20; k++) {
      const a = ((k + 0.5) / 20) * TAU;
      spin.box(Math.cos(a) * (RP + 0.5), DECK + 0.15, Math.sin(a) * (RP + 0.5), 0.5, 0.35, 0.5, GOLD, -a);
      bulb(spinGlow, Math.cos(a) * (RP + 0.62), DECK - 0.25, Math.sin(a) * (RP + 0.62), 0.45, lightAt(k));
    }
    // The mirrored centre column: eight bright mirror panels between gold ribs.
    lathe(spin, [[2.8, DECK], [2.8, DECK + 0.8], [2.4, DECK + 1.2], [2.3, TOP - 0.4], [3.0, TOP]], { segments: 8, shade: byHeight(DECK, TOP, scaleRgb(GOLD, 0.7), GOLD), caps: "top" });
    for (let k = 0; k < 8; k++) {
      const a = ((k + 0.5) / 8) * TAU;
      const d = 2.2;
      spinGlow.box(Math.sin(a) * d, (DECK + TOP) / 2 + 0.2, Math.cos(a) * d, 1.35, TOP - DECK - 2.3, 0.14, [1.6 + (k % 2) * 0.3, 1.9, 2.4], a);
    }
    for (const y of [3.6, 6.0, 8.4]) {
      lathe(spin, [[2.55, y - 0.18], [2.75, y - 0.18], [2.75, y + 0.18], [2.55, y + 0.18]], { segments: 8, shade: BRASS });
    }
    // The canopy: a striped, slightly bell-shaped roof with a scalloped valance and a flag.
    lathe(
      spin,
      [[13.8, TOP], [12, TOP + 0.9], [8.5, TOP + 2.0], [5, TOP + 3.2], [2.4, TOP + 4.2], [1.0, TOP + 4.8], [0.0, TOP + 6.0]],
      { segments: 20, shade: (p, _i, j) => (j % 2 === 0 ? mixRgb(RED, WHITE, Math.min(0.4, (p[1] - TOP) * 0.06)) : CREAM) },
    );
    for (let i = 0; i < 20; i++) {
      const a0 = (i / 20) * TAU;
      const a1 = ((i + 1) / 20) * TAU;
      const r = 13.8;
      const p0: V3 = [Math.cos(a0) * r, TOP, Math.sin(a0) * r];
      const p1: V3 = [Math.cos(a1) * r, TOP, Math.sin(a1) * r];
      const mid = (a0 + a1) / 2;
      const col = i % 2 === 0 ? RED : CREAM;
      const pts: V3[] = [p0];
      for (let k = 1; k < 4; k++) {
        const u = k / 4;
        const a = a0 + (a1 - a0) * u;
        pts.push([Math.cos(a) * r, TOP - Math.sin(u * Math.PI) * 1.4, Math.sin(a) * r]);
      }
      pts.push(p1);
      const c: V3 = [Math.cos(mid) * r, TOP + 0.05, Math.sin(mid) * r];
      for (let k = 0; k < pts.length - 1; k++) spin.tri(c, pts[k]!, pts[k + 1]!, col, scaleRgb(col, 0.8), scaleRgb(col, 0.8));
      spin.blob(Math.cos(mid) * r, TOP - 1.45, Math.sin(mid) * r, 0.22, 0.22, 0.22, GOLD, 0);
    }
    for (let k = 0; k < 20; k++) {
      const a = (k / 20) * TAU;
      bulb(spinGlow, Math.cos(a) * 13.4, TOP - 0.2, Math.sin(a) * 13.4, 0.55, lightAt(k));
    }
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * TAU;
      bulb(spinGlow, Math.cos(a) * 7, TOP + 0.1, Math.sin(a) * 7, 0.45, lightAt(k + 2));
    }
    spin.post(0, TOP + 5.8, 0, 0.18, 2.6, BRASS, 6);
    spin.blob(0, TOP + 8.5, 0, 0.45, 0.45, 0.45, GOLD, 0);
    spin.tri([0.1, TOP + 8.2, 0], [2.6, TOP + 7.7, 0.0], [0.1, TOP + 6.9, 0], RED, ORANGE, RED);
    spin.tri([0.1, TOP + 8.2, 0], [0.1, TOP + 6.9, 0], [2.6, TOP + 7.7, 0.0], PINK, PINK, PINK);

    // Brass poles for every mount (they turn with the deck).
    const mountsA = new MeshBuilder();
    const mountsB = new MeshBuilder();
    const coats: [Rgb, Rgb, Rgb][] = [
      [WHITE, RED, BLUE],
      [rgb("#c88a4f"), CREAM, RED],
      [rgb("#ffd1e0"), PURPLE, TEAL],
      [rgb("#7fd4c0"), YELLOW, PINK],
    ];
    const addMount = (k: number, r: number, a: number, kind: number): void => {
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      pipe(spin, [x, DECK, z], [x, TOP - 0.3, z], 0.2, BRASS, 6);
      spin.blob(x, TOP - 0.45, z, 0.4, 0.3, 0.4, GOLD, 0);
      const target = k % 2 === 0 ? mountsA : mountsB;
      const c = coats[k % coats.length]!;
      const m = kind === 0 ? horse(c[0], c[1], c[2]) : kind === 1 ? ostrich(c[0], c[1]) : cat(c[0], c[2]);
      const lift = kind === 0 ? 4.6 : kind === 1 ? 4.9 : 4.4;
      stamp(target, m, xf(x, DECK + lift + 0.4, z, 1.3, 1.3, 1.3, -a));
    };
    for (let k = 0; k < 8; k++) addMount(k, 10, (k / 8) * TAU, 0);
    for (let k = 0; k < 4; k++) addMount(k + 8, 6.4, ((k + 0.5) / 4) * TAU + 0.4, k % 2 === 0 ? 1 : 2);

    const halos: Halo[] = [{ x: 0, y: 7.5, z: 0, size: 18, colour: [3.2, 2, 1], alpha: 0.5, twinkle: 0.2 }];
    for (let k = 0; k < 14; k++) {
      const a = (k / 14) * TAU;
      halos.push({ x: Math.cos(a) * 13.4, y: TOP - 0.2, z: Math.sin(a) * 13.4, size: 5, colour: lightAt(k), alpha: 0.45, twinkle: 0.4 });
    }
    halos.push({ x: 0, y: TOP + 8.5, z: 0, size: 6, colour: G_GOLD, alpha: 0.6, twinkle: 0.5 });
    const rot = (t: number): number => -0.2 * t;
    const moving: MovingPart[] = [
      { lit: spin, glow: spinGlow, pivot: [0, 0, 0], update: (t, part) => void (part.rotation.y = rot(t)) },
      {
        lit: mountsA,
        pivot: [0, 0, 0],
        update(t, part) {
          part.rotation.y = rot(t);
          part.position.y = 0.8 * Math.sin(1.7 * t);
        },
      },
      {
        lit: mountsB,
        pivot: [0, 0, 0],
        update(t, part) {
          part.rotation.y = rot(t);
          part.position.y = 0.8 * Math.sin(1.7 * t + Math.PI);
        },
      },
    ];
    return { lit: stage, glow: stageGlow, moving, halos };
  },
};

// ─── Helter skelter ──────────────────────────────────────────────────────────

export const helterSkelter: LandmarkSpec = {
  footprint: 10,
  build() {
    const lit = new MeshBuilder();
    const glow = new MeshBuilder();
    const halos: Halo[] = [];
    const HT = 24.5; // top of the tower
    const radius = (y: number): number => 6.2 - 3.5 * Math.pow(Math.max(0, y) / HT, 0.9);
    const SEG = 16;
    const phase = Math.PI / SEG;

    // The tower: candy-striped cone on a gold-trimmed skirt, then the lantern.
    const prof: [number, number][] = [[7.2, -1.8], [7.2, 0.4], [6.5, 0.9]];
    for (let y = 1.5; y <= HT + 0.01; y += 2.25) prof.push([radius(y), y]);
    lathe(lit, prof, { segments: SEG, phase, shade: (p, _i, j) => scaleRgb(j % 2 === 0 ? RED : CREAM, 0.58 + 0.42 * Math.min(1, Math.max(0, p[1]) / 14)) });
    lathe(lit, [[7.25, -0.2], [7.25, 0.5], [6.6, 0.95]], { segments: SEG, phase, shade: GOLD });
    // The top deck, a ring of columns, a glowing lantern and a striped roof with a flag.
    lathe(lit, [[2.7, HT - 0.2], [4.3, HT], [4.4, HT + 0.5], [2.4, HT + 0.5]], { segments: SEG, phase, shade: stripes(GOLD, YELLOW), caps: "top" });
    lathe(glow, [[2.2, HT + 0.5], [2.2, HT + 3.6]], { segments: 12, shade: [3.4, 2.1, 0.9], caps: "top" });
    for (let q = 0; q < 8; q++) {
      const a = (q / 8) * TAU;
      lit.post(Math.cos(a) * 2.45, HT + 0.5, Math.sin(a) * 2.45, 0.22, 3.2, WHITE, 6);
    }
    lathe(lit, [[3.9, HT + 3.6], [3.9, HT + 4.2], [0.3, HT + 7.2], [0, HT + 7.4]], { segments: 12, shade: stripes(RED, CREAM), caps: "bottom" });
    lit.post(0, HT + 7.2, 0, 0.12 + 0.05, 2.8, BRASS, 6);
    lit.blob(0, HT + 10.2, 0, 0.4, 0.4, 0.4, GOLD, 0);
    lit.tri([0.1, HT + 10.0, 0], [0.1, HT + 8.6, 0], [2.8, HT + 9.3, 0.3], RED, RED, ORANGE);
    lit.tri([0.1, HT + 10.0, 0], [2.8, HT + 9.3, 0.3], [0.1, HT + 8.6, 0], PINK, PINK, PINK);
    halos.push({ x: 0, y: HT + 2.2, z: 0, size: 14, colour: [4, 2.6, 1.1], alpha: 0.65, twinkle: 0.25 });
    halos.push({ x: 0, y: HT + 2.2, z: 0, size: 26, colour: [3.0, 1.5, 0.9], alpha: 0.25, twinkle: 0.2 });

    // The slide: three turns of ribbon, red and white, with a balustrade, rail and bulbs.
    const TURNS = 3;
    const PER = 24;
    const N = TURNS * PER;
    const Y0 = 2.6;
    const Y1 = HT - 0.5;
    const A0 = Math.PI / 2 + 1.1;
    const pt = (i: number, rr: number, dy = 0): V3 => {
      const t = i / N;
      const y = Y0 + (Y1 - Y0) * t;
      const a = A0 + TURNS * TAU * t;
      return [Math.cos(a) * (radius(y) + rr), y + dy, Math.sin(a) * (radius(y) + rr)];
    };
    for (let i = 0; i < N; i++) {
      const colA = Math.floor(i / 3) % 2 === 0 ? RED : WHITE;
      const dark = scaleRgb(colA, 0.6);
      lit.quad(pt(i, -0.3), pt(i, 2.1), pt(i + 1, 2.1), pt(i + 1, -0.3), colA);
      // The underside and the outer edge give the ribbon thickness.
      lit.quad(pt(i, -0.3, -0.4), pt(i + 1, -0.3, -0.4), pt(i + 1, 2.1, -0.4), pt(i, 2.1, -0.4), dark);
      lit.quad(pt(i, 2.1), pt(i + 1, 2.1), pt(i + 1, 2.1, -0.4), pt(i, 2.1, -0.4), scaleRgb(colA, 0.75));
      // Balustrade: a painted panel with a gold cap.
      const pan = Math.floor(i / 3) % 2 === 0 ? CREAM : PINK;
      lit.quad(pt(i, 2.0), pt(i + 1, 2.0), pt(i + 1, 2.0, 1.0), pt(i, 2.0, 1.0), scaleRgb(pan, 0.8), scaleRgb(pan, 0.8), pan, pan);
      lit.quad(pt(i, 2.0, 1.0), pt(i + 1, 2.0, 1.0), pt(i + 1, 1.5, 1.0), pt(i, 1.5, 1.0), GOLD);
      if (i % 3 === 0) {
        const [x, y, z] = pt(i, 2.0);
        lit.box(x, y + 0.6, z, 0.34, 1.3, 0.34, BRASS);
        bulb(glow, ...pt(i, 2.05, 1.35), 0.42, lightAt(i / 3));
      }
    }
    // A short ladder from the top of the slide to the deck.
    const top = pt(N, 0.8, 0);
    lit.rod([top[0], top[1] - 0.1, top[2]], [top[0], HT + 0.4, top[2]], 0.3, STEEL);
    // Lit windows spiral up between the turns, with a door and mat at the foot.
    for (let k = 0; k < 14; k++) {
      const y = 4.4 + k * 1.4;
      const a = Math.PI * 1.2 + k * 1.1;
      const r = radius(y) * 0.985;
      glow.box(Math.cos(a) * r, y + 0.5, Math.sin(a) * r, 0.95, 1.5, 0.22, k % 3 === 0 ? G_PINK : G_WARM, Math.PI / 2 - a);
      lit.box(Math.cos(a) * (r - 0.05), y + 0.5, Math.sin(a) * (r - 0.05), 1.35, 1.9, 0.16, GOLD, Math.PI / 2 - a);
      if (k % 2 === 0) halos.push({ x: Math.cos(a) * (r + 0.4), y: y + 0.5, z: Math.sin(a) * (r + 0.4), size: 5, colour: [3.4, 2.0, 0.9], alpha: 0.4, twinkle: 0.3 });
    }
    const dz = radius(2) * Math.cos(phase) - 0.05;
    lit.box(0, 2.3, dz + 0.4, 3.5, 4.6, 0.9, ramp(rgb("#8a6a3a"), GOLD));
    lit.add(shapes.cylinder(12), xf(0, 4.5, dz + 0.4, 1.75, 0.9, 1.75, 0, Math.PI / 2), GOLD);
    glow.box(0, 2.1, dz + 0.9, 2.5, 3.8, 0.08, G_WARM);
    glow.add(shapes.cylinder(12), xf(0, 4.5, dz + 0.9, 1.25, 0.08, 1.25, 0, Math.PI / 2), G_WARM);
    lit.box(0, 0.12, dz + 2.7, 3.2, 0.24, 3.2, ramp(scaleRgb(RED, 0.7), RED));
    lit.box(0, 0.26, dz + 2.7, 2.2, 0.06, 2.2, CREAM);
    halos.push({ x: 0, y: 2.6, z: dz + 1.8, size: 9, colour: [3.4, 2.0, 0.9], alpha: 0.5, twinkle: 0.2 });
    // Flag poles round the foot.
    for (let q = 0; q < 6; q++) {
      const a = (q / 6) * TAU + 0.3;
      const x = Math.cos(a) * 8.2;
      const z = Math.sin(a) * 8.2;
      lit.post(x, -0.5, z, 0.16, 5, STEEL, 6);
      lit.tri([x, 4.4, z], [x, 3.2, z], [x + Math.cos(a + 1.57) * 1.7, 3.8, z + Math.sin(a + 1.57) * 1.7], candyAt(q), candyAt(q + 1), scaleRgb(candyAt(q), 0.8));
    }
    return { lit, glow, halos };
  },
};
