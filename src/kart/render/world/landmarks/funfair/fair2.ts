/**
 * The fair's second-pass set pieces: the Ferris wheel you drive under (its cars swing as it turns), the coaster's trestle (the
 * span the high split runs along), and the human cannonball's tent and safety net either side of the start straight's cannon.
 *
 * `ferris-gate` stands astride the road with its feet beyond the barrier: the wheel's lowest car passes over 5 m up. The
 * trestle (`coaster-trestle`) is built in the road's frame like any span: its legs run 16 m below the road so they come up
 * out of the ground wherever the coaster is low, and what is above the road (the arches of lights) is over 5 m.
 */
import { lathe, MeshBuilder, mixRgb, ramp, rgb, scaleRgb, shapes, stripes, torus, xf, type V3 } from "../kit";
import type { Halo, LandmarkSpec, MovingPart } from "../types";
import { bulb, bulbLine, CANDY, CREAM, DARK, G_GOLD, G_PINK, G_RED, G_WARM, G_WHITE, GOLD, lightAt, NAVY, PINK, RED, STEEL, stripedRod, TAU, TEAL, WHITE, YELLOW } from "./common";

// ─── The Ferris wheel gate ───────────────────────────────────────────────────

/**
 * A big wheel astride the road. Two A-frames splay from the hub down to feet well outside the barrier (so what is over the
 * road is a hand of steel and candy stripes more than ten metres up), a wheel of two rims with spokes and bulbs turns slowly,
 * and each of its six cars hangs upright from its own pin, so it swings as it comes over your head.
 */
export const ferrisGate: LandmarkSpec = {
  footprint: 0,
  build() {
    const R = 19;
    const HUB = 31;
    const N = 6;
    const ZS = 2.2;
    const W = 0.16;
    const FOOT = 20;
    const frame = new MeshBuilder();
    const fGlow = new MeshBuilder();
    const wheelLit = new MeshBuilder();
    const wheelGlow = new MeshBuilder();

    // Legs from the hub down to feet at x = +-25 (clear of the barrier and the camera's margin), front and back of the wheel.
    const legAt = (sx: number, s: number, y: number): V3 => {
      const t = (HUB - y) / (HUB + 1.5);
      return [sx * FOOT * t, y, s * (5 + 3.6 * t)];
    };
    for (const s of [-1, 1]) {
      for (const sx of [-1, 1]) {
        stripedRod(frame, legAt(sx, s, HUB), legAt(sx, s, -1.5), 1.3, 12, RED, CREAM);
        frame.box(sx * FOOT, -0.1, s * 8.6, 3.4, 1.4, 3.4, ramp(DARK, rgb("#5b4aa0")));
        // a collar of lights on each foot
        for (let k = 0; k < 6; k++) bulb(fGlow, sx * FOOT + Math.cos((k / 6) * TAU) * 1.9, 0.9, s * 8.6 + Math.sin((k / 6) * TAU) * 1.9, 0.4, lightAt(k));
      }
      // Cross braces from one side to the other, over the road (a long way up), and diagonals.
      for (const y of [9, 18]) {
        frame.rod(legAt(-1, s, y), legAt(1, s, y), 0.8, STEEL);
        for (let k = 0; k < 15; k++) {
          const f = (k + 0.5) / 15;
          const a = legAt(-1, s, y);
          const b = legAt(1, s, y);
          bulb(fGlow, a[0] + (b[0] - a[0]) * f, y - 0.6, a[2], 0.42, lightAt(k + (y > 12 ? 1 : 0)));
        }
      }
    }
    for (const sx of [-1, 1]) {
      for (const y of [9, 18]) frame.rod(legAt(sx, -1, y), legAt(sx, 1, y), 0.7, STEEL);
      frame.rod(legAt(sx, -1, 9), legAt(sx, 1, 18), 0.5, STEEL);
      frame.rod(legAt(sx, 1, 9), legAt(sx, -1, 18), 0.5, STEEL);
    }
    // The hub: a big drum on the axle, with a glowing star on each face.
    frame.add(shapes.cylinder(12), xf(0, HUB, 0, 2.6, 11, 2.6, 0, Math.PI / 2), ramp(rgb("#7c7fa8"), rgb("#e4e6f6")));
    frame.add(shapes.cylinder(12), xf(0, HUB, 0, 3.6, 4.6, 3.6, 0, Math.PI / 2), RED);

    // The wheel: two rims either side of the cars, spokes, zig-zag bracing and bulbs.
    const wheelShade = stripes(WHITE, PINK, "row", 2);
    for (const s of [-1, 1]) {
      const z = s * ZS;
      torus(wheelLit, R, 0.5, { at: [0, HUB, z], facing: "z", ringSegments: 28, tubeSegments: 5, shade: wheelShade });
      torus(wheelLit, 9.5, 0.36, { at: [0, HUB, z], facing: "z", ringSegments: 20, tubeSegments: 5, shade: stripes(WHITE, TEAL, "row", 1) });
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * TAU;
        const half = ((k + 0.5) / 12) * TAU;
        wheelLit.rod([0, HUB, z], [Math.cos(a) * R, HUB + Math.sin(a) * R, z], 0.36, STEEL);
        wheelLit.rod([Math.cos(a) * 9.5, HUB + Math.sin(a) * 9.5, z], [Math.cos(half) * R, HUB + Math.sin(half) * R, z], 0.26, WHITE);
        wheelLit.rod([Math.cos(half) * R, HUB + Math.sin(half) * R, z], [Math.cos(a + TAU / 12) * 9.5, HUB + Math.sin(a + TAU / 12) * 9.5, z], 0.26, WHITE);
      }
      for (let k = 0; k < 28; k++) {
        const a = (k / 28) * TAU + 0.05;
        bulb(wheelGlow, Math.cos(a) * (R + 0.8), HUB + Math.sin(a) * (R + 0.8), z, 0.58, lightAt(k));
      }
      for (let k = 0; k < 18; k++) {
        const a = (k / 18) * TAU;
        bulb(wheelGlow, Math.cos(a) * 10.1, HUB + Math.sin(a) * 10.1, z, 0.46, lightAt(k + 1));
      }
      for (let k = 0; k < 4; k++) {
        const a = (k / 8) * TAU;
        wheelGlow.rod([Math.cos(a) * -4, HUB + Math.sin(a) * -4, s * 5.4], [Math.cos(a) * 4, HUB + Math.sin(a) * 4, s * 5.4], 0.5, k % 2 ? G_PINK : G_GOLD);
      }
      wheelGlow.add(shapes.cylinder(12), xf(0, HUB, s * 5.6, 1.4, 0.4, 1.4, 0, Math.PI / 2), G_WHITE);
    }
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * TAU;
      wheelLit.rod([Math.cos(a) * R, HUB + Math.sin(a) * R, -ZS], [Math.cos(a) * R, HUB + Math.sin(a) * R, ZS], 0.46, STEEL);
    }

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
    // Each car hangs from its own pin and stays upright, swinging a little as it travels the circle.
    for (let k = 0; k < N; k++) {
      const a = (k / N) * TAU + 0.2;
      const px = R * Math.cos(a);
      const py = HUB + R * Math.sin(a);
      const colour = CANDY[(k * 3) % CANDY.length]!;
      const l = new MeshBuilder();
      const g = new MeshBuilder();
      l.box(px, py, 0, 0.45, 0.45, 2 * ZS + 0.3, STEEL);
      for (const s of [-1, 1]) l.rod([px, py, s * ZS], [px, py - 1.6, s * 1.1], 0.28, STEEL);
      l.spire(px, py - 1.6, 0, 2.1, 1.3, ramp(scaleRgb(colour, 0.8), mixRgb(colour, WHITE, 0.25)), 8);
      l.post(px, py - 4.0, 0, 1.6, 2.4, ramp(scaleRgb(colour, 0.5), colour), 8);
      l.post(px, py - 4.25, 0, 1.8, 0.3, CREAM, 8);
      for (let w = 0; w < 4; w++) {
        const th = Math.PI / 8 + (w * Math.PI) / 2;
        g.box(px + Math.sin(th) * 1.52, py - 2.7, Math.cos(th) * 1.52, 0.85, 0.9, 0.14, G_WARM, th);
      }
      bulb(g, px, py - 0.2, 0, 0.42, lightAt(k));
      parts.push({
        lit: l,
        glow: g,
        pivot: [px, py, 0],
        update(t, part) {
          const phi = a + W * t;
          // The pin travels the circle; the car swings a little under it as it goes.
          part.position.set(R * (Math.cos(phi) - Math.cos(a)), R * (Math.sin(phi) - Math.sin(a)), 0);
          part.rotation.z = Math.sin(t * 0.9 + k * 1.7) * 0.11;
        },
      });
    }
    const halos: Halo[] = [{ x: 0, y: HUB, z: 6, size: 16, colour: [4, 2.6, 1.2], alpha: 0.5, twinkle: 0.3 }];
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * TAU;
      halos.push({ x: Math.cos(a) * (R + 0.8), y: HUB + Math.sin(a) * (R + 0.8), z: (k % 2 ? 1 : -1) * ZS, size: 5.5, colour: lightAt(k), alpha: 0.4, twinkle: 0.4 });
    }
    for (let k = 0; k < 12; k++) halos.push({ x: ((k + 0.5) / 12) * 2 * 15 - 15, y: 8.4, z: -8.8, size: 3.6, colour: lightAt(k), alpha: 0.5, twinkle: 0.4 });
    return { lit: frame, glow: fGlow, moving: parts, halos };
  },
};

// ─── The coaster's trestle ───────────────────────────────────────────────────

/**
 * The trestle the coaster's road runs along (a span, along the whole branch): a pair of steel rails and red-and-white
 * sleepers laid on the road, bulbs along each open edge, a bent of candy-striped legs every seven metres (they stand outside
 * the road's edge and go 16 m below it, so they come up out of the ground wherever the track is high) with a girder
 * under the road, and an arch of lights over the road every twenty-one, well over a kart's head.
 */
export const coasterTrestle: LandmarkSpec = {
  span: true,
  defaultSpan: 160,
  build(ctx) {
    const lit = new MeshBuilder();
    const glow = new MeshBuilder();
    const halos: Halo[] = [];
    const L = ctx.span;
    const half = L / 2;
    const hw = ctx.halfWidth;
    const lx = hw + 2.2;
    // Sleepers and rails on the road itself (under 0.45 m, so they may lie on it).
    const rail = rgb("#9aa0b8");
    for (let z = -half; z < half; z += 1.2) lit.box(0, 0.0, z + 0.6, 3.6, 0.1, 0.5, Math.round(z / 1.2) % 2 ? RED : CREAM);
    for (const x of [-1.8, 1.8]) lit.box(x, 0.1, 0, 0.22, 0.2, L, rail);
    // Lights along both edges.
    for (const s of [-1, 1]) for (let z = -half + 1; z < half; z += 3) bulb(glow, s * 3.0, 0.1, z, 0.28, lightAt(Math.round(z / 3)));
    // Bents: two legs, a girder under the road, X braces.
    let n = 0;
    for (let z = -half + 3; z < half; z += 7) {
      const colour = n % 2 ? CREAM : RED;
      for (const s of [-1, 1]) {
        stripedRod(lit, [s * lx, -1.4, z], [s * lx, -16, z], 1.1, 8, RED, CREAM);
        lit.rod([s * lx, -3.5, z], [-s * lx, -9.5, z], 0.34, STEEL);
      }
      lit.box(0, -1.7, z, 2 * lx, 0.8, 0.9, ramp(scaleRgb(colour, 0.6), colour));
      n++;
    }
    // Arches of lights over the road: two posts at the legs, a beam across at 7 m with a row of bulbs, and a gold star.
    for (let z = -half + 10; z < half - 4; z += 21) {
      for (const s of [-1, 1]) lit.box(s * lx, 3.1, z, 0.8, 8.4, 0.8, ramp(DARK, rgb("#5b4aa0")));
      lit.box(0, 7.4, z, 2 * lx + 0.8, 0.9, 0.9, ramp(NAVY, rgb("#4b3a8c")));
      for (let k = 0; k < 11; k++) bulb(glow, -lx + (k / 10) * 2 * lx, 6.8, z, 0.46, lightAt(k));
      glow.rod([-1.2, 8.5, z], [1.2, 8.5, z], 0.5, G_GOLD);
      glow.rod([0, 7.8, z], [0, 9.2, z], 0.5, G_GOLD);
      halos.push({ x: 0, y: 7, z, size: 14, colour: [3, 1.8, 0.9], alpha: 0.4, twinkle: 0.3 });
    }
    return { lit, glow, halos };
  },
};

// ─── The human cannonball's tent and net ─────────────────────────────────────

/**
 * The human cannonball's tent: a round tent of red and cream stripes with a pennant, a bright mouth facing the road, and
 * out in front of it the cannon itself, gold and red on two wheels, tilted up at the sky, a sign over the door.
 */
export const cannonTent: LandmarkSpec = {
  footprint: 12,
  build() {
    const lit = new MeshBuilder();
    const glow = new MeshBuilder();
    const halos: Halo[] = [];
    const stripe = stripes(RED, CREAM, "col", 1);
    lathe(lit, [[0, 0], [9, 0], [9, 4.2], [9.6, 4.6]], { segments: 16, shade: stripe, caps: "bottom" });
    lathe(lit, [[9.6, 4.6], [8.5, 7], [0.5, 12.6]], { segments: 16, shade: stripes(CREAM, RED, "col", 1) });
    // The pennant.
    lit.rod([0, 12.4, 0], [0, 15.4, 0], 0.2, STEEL);
    lit.box(1.1, 14.9, 0, 2.2, 1.1, 0.1, YELLOW, 0, 0, 0.1);
    // Scalloped valance round the eaves.
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * TAU + TAU / 32;
      lit.blob(Math.cos(a) * 9.5, 4.6, Math.sin(a) * 9.5, 1.5, 0.7, 1.5, k % 2 ? RED : CREAM, 0);
    }
    // The mouth: a tall dark door facing +z, framed in lights.
    glow.box(0, 2.3, 9.05, 4.2, 4.6, 0.12, [0.05, 0.03, 0.08]);
    for (const s of [-1, 1]) lit.box(s * 2.3, 2.5, 9.15, 0.5, 5, 0.5, GOLD);
    lit.box(0, 5.1, 9.15, 5.1, 0.5, 0.5, GOLD);
    bulbLine(glow, [-2.4, 0.4, 9.5], [-2.4, 5.0, 9.5], 7, 0.36);
    bulbLine(glow, [2.4, 0.4, 9.5], [2.4, 5.0, 9.5], 7, 0.36, 2);
    bulbLine(glow, [-2.4, 5.35, 9.5], [2.4, 5.35, 9.5], 7, 0.36, 1);
    // The sign over the door: pale bars on navy, framed in bulbs.
    lit.box(0, 7.3, 9.1, 9, 1.9, 0.4, ramp(NAVY, rgb("#4b3a8c")));
    for (let k = 0; k < 9; k++) glow.box(-3.6 + k * 0.9, 7.3, 9.35, 0.5, 0.9 + 0.3 * ((k * 7) % 3 === 0 ? 1 : 0), 0.08, G_WHITE);
    bulbLine(glow, [-4.4, 8.4, 9.4], [4.4, 8.4, 9.4], 11, 0.38);
    bulbLine(glow, [-4.4, 6.2, 9.4], [4.4, 6.2, 9.4], 11, 0.38, 1);
    // The cannon on the grass in front: two big wheels, a barrel tilted up and a gold band.
    const bx = 0;
    const bz = 14.5;
    for (const s of [-1, 1]) {
      torus(lit, 1.45, 0.34, { at: [s * 1.7, 1.7, bz], facing: "x", ringSegments: 14, tubeSegments: 5, shade: stripes(RED, CREAM, "row", 1) });
      lit.add(shapes.cylinder(8), xf(s * 1.7, 1.7, bz, 0.4, 0.5, 0.4, 0, 0, Math.PI / 2), GOLD);
    }
    lit.rod([bx, 2.0, bz - 1.6], [bx, 5.4, bz + 3.8], 2.3, ramp(rgb("#b03a2c"), rgb("#ff6a4a")));
    lit.rod([bx, 4.7, bz + 2.9], [bx, 5.6, bz + 4.1], 2.9, GOLD);
    lit.rod([bx, 3.0, bz + 0.1], [bx, 3.5, bz + 0.7], 2.7, GOLD);
    glow.rod([bx, 5.3, bz + 3.95], [bx, 5.5, bz + 4.2], 1.8, [0.04, 0.03, 0.05]);
    glow.add(shapes.cylinder(10), xf(bx, 5.75, bz + 4.35, 1.0, 0.1, 1.0, 0, 0.5), G_RED);
    // A hay bale and a drum or two.
    for (const [x, z] of [[-4.5, 12.5], [4.8, 13.2]] as const) lit.box(x, 0.6, z, 1.6, 1.2, 1.1, rgb("#d8b25a"), x * 0.1);
    halos.push({ x: 0, y: 3, z: 10.5, size: 14, colour: [3.4, 1.9, 0.8], alpha: 0.5, twinkle: 0.2 }, { x: 0, y: 8.6, z: 9.8, size: 12, colour: [3.2, 1.6, 2.2], alpha: 0.4, twinkle: 0.3 });
    return { lit, glow, halos };
  },
};

/**
 * The safety net: a tall frame of striped poles with a taut net strung between them, a padded red-and-white rail along its foot,
 * standing to one side of where the cannonball lands (the road runs in front of it).
 */
export const safetyNet: LandmarkSpec = {
  footprint: 0,
  build() {
    const lit = new MeshBuilder();
    const glow = new MeshBuilder();
    const glass = new MeshBuilder();
    const W = 7.5;
    const H = 9;
    // One landmark holds the pair (one either side of the road, so it is three draws and not six).
    for (const c of [-24, 24]) {
      for (const s of [-1, 1]) {
        stripedRod(lit, [c + s * W, -0.5, 0], [c + s * W, H, 0], 0.6, 6, RED, CREAM);
        lit.blob(c + s * W, H + 0.3, 0, 0.55, 0.55, 0.55, GOLD, 0);
        lit.rod([c + s * W, H - 0.5, 0], [c + s * (W + 1.6), 0, -3.2], 0.18, STEEL);
        bulb(glow, c + s * W, H + 0.95, 0, 0.5, lightAt(s + 3));
      }
      stripedRod(lit, [c - W, H - 0.3, 0], [c + W, H - 0.3, 0], 0.28, 10, RED, CREAM);
      // The net: a lattice of ropes, sagging towards its middle.
      const sag = (x: number): number => 0.9 * (1 - (x / W) * (x / W));
      for (let i = 0; i <= 10; i++) {
        const x = -W + (i / 10) * 2 * W;
        lit.rod([c + x, 0.6 - sag(x) * 0.3, 0], [c + x, H - 0.5 - sag(x), 0], 0.08, rgb("#d9cfa8"));
      }
      for (let j = 1; j <= 7; j++) {
        const y = 0.6 + (j / 8) * (H - 1.2);
        for (let i = 0; i < 10; i++) {
          const x0 = -W + (i / 10) * 2 * W;
          const x1 = -W + ((i + 1) / 10) * 2 * W;
          lit.rod([c + x0, y - sag(x0), 0], [c + x1, y - sag(x1), 0], 0.08, rgb("#d9cfa8"));
        }
      }
      // A faint glassy sheet so it reads from far away, and the padded foot.
      glass.quad([c - W, 0.4, 0], [c + W, 0.4, 0], [c + W, H - 0.6, 0], [c - W, H - 0.6, 0], rgb("#cfe6ff"));
      lit.box(c, 0.5, 0, 2 * W + 1, 1.0, 1.6, ramp(RED, mixRgb(RED, WHITE, 0.4)));
      for (let k = 0; k < 7; k++) lit.box(c - W + 1 + (k / 6) * (2 * W - 2), 0.5, 0.85, 1.0, 0.9, 0.12, CREAM);
    }
    return { lit, glow, glass };
  },
};

export const FAIR2_LANDMARKS: Record<string, LandmarkSpec> = {
  "ferris-gate": ferrisGate,
  "coaster-trestle": coasterTrestle,
  "cannon-tent": cannonTent,
  "safety-net": safetyNet,
};
