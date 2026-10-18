/**
 * The funfair's stalls, and its fireworks: a food stall with a giant ice cream
 * on the roof, a balloon-dart stand, hook-a-duck with ducks drifting round
 * their pool, and a launch deck whose three bursts open, hang and fall in the
 * sky above it. The stalls share the awning, the plush prizes and the balloons
 * built first.
 */
import { lathe, MeshBuilder, mixRgb, ramp, rgb, scaleRgb, shapes, stamp, stripes, torus, xf, type Rgb, type V3 } from "../kit";
import type { Halo, LandmarkSpec, MovingPart } from "../types";
import { BLUE, bulb, bulbLine, candyAt, CREAM, DARK, G_CYAN, G_GOLD, G_PINK, G_RED, G_WARM, G_WHITE, GOLD, GREEN, lightAt, NAVY, ORANGE, PINK, PURPLE, RED, scallops, STEEL, stripedRod, TEAL, WHITE, YELLOW } from "./common";

// ─── Stall pieces ────────────────────────────────────────────────────────────

/** A striped, sloping awning from a high back edge to a low front edge, with a scalloped front. */
function awning(b: MeshBuilder, x0: number, x1: number, yBack: number, zBack: number, yFront: number, zFront: number, n: number, ca: Rgb, cb: Rgb, drop = 1.0): void {
  for (let i = 0; i < n; i++) {
    const xa = x0 + ((x1 - x0) * i) / n;
    const xb = x0 + ((x1 - x0) * (i + 1)) / n;
    const col = i % 2 === 0 ? ca : cb;
    const dark = scaleRgb(col, 0.7);
    b.quad([xa, yBack, zBack], [xb, yBack, zBack], [xb, yFront, zFront], [xa, yFront, zFront], col, col, dark, dark);
    // A thin underside so the canvas has a body when seen from below.
    b.quad([xa, yBack - 0.18, zBack], [xa, yFront - 0.18, zFront], [xb, yFront - 0.18, zFront], [xb, yBack - 0.18, zBack], scaleRgb(col, 0.5));
  }
  scallops(b, [x0, yFront - 0.1, zFront], [x1, yFront - 0.1, zFront], n, drop, ca, cb);
}

/** A plush toy: a bear, a pig, a chick or a bunny as a few lumps, sitting facing +z. */
function plush(b: MeshBuilder, x: number, y: number, z: number, kind: number, s = 1): void {
  const fur = [rgb("#b9773f"), rgb("#ff9ec4"), rgb("#ffe14d"), rgb("#f4f1ff"), rgb("#6fd0ff")][kind % 5]!;
  const belly = mixRgb(fur, WHITE, 0.45);
  b.blob(x, y + 0.55 * s, z, 0.62 * s, 0.7 * s, 0.55 * s, ramp(scaleRgb(fur, 0.6), fur), 0);
  b.blob(x, y + 0.5 * s, z + 0.35 * s, 0.38 * s, 0.4 * s, 0.25 * s, belly, 0);
  b.blob(x, y + 1.38 * s, z + 0.05 * s, 0.52 * s, 0.48 * s, 0.48 * s, fur, 0);
  b.blob(x, y + 1.28 * s, z + 0.42 * s, 0.22 * s, 0.17 * s, 0.18 * s, belly, 0);
  b.box(x - 0.18 * s, y + 1.5 * s, z + 0.46 * s, 0.1 * s, 0.1 * s, 0.06 * s, DARK);
  b.box(x + 0.18 * s, y + 1.5 * s, z + 0.46 * s, 0.1 * s, 0.1 * s, 0.06 * s, DARK);
  for (const sx of [-1, 1]) {
    if (kind % 5 === 3) b.rod([x + sx * 0.2 * s, y + 1.7 * s, z], [x + sx * 0.3 * s, y + 2.5 * s, z - 0.05 * s], 0.18 * s, fur);
    else b.blob(x + sx * 0.38 * s, y + 1.75 * s, z, 0.2 * s, 0.2 * s, 0.14 * s, fur, 0);
    b.blob(x + sx * 0.7 * s, y + 0.65 * s, z + 0.1 * s, 0.2 * s, 0.38 * s, 0.2 * s, fur, 0);
  }
  if (kind % 5 === 2) b.box(x, y + 1.25 * s, z + 0.6 * s, 0.2 * s, 0.1 * s, 0.2 * s, ORANGE);
  if (kind % 5 === 1) b.blob(x, y + 1.25 * s, z + 0.55 * s, 0.14 * s, 0.1 * s, 0.1 * s, rgb("#ff6fa0"), 0);
}

/** A balloon: a glossy lump with a knot, bright at the top. */
function balloon(b: MeshBuilder, x: number, y: number, z: number, c: Rgb, r = 1): void {
  b.blob(x, y, z, 0.82 * r, 1.0 * r, 0.82 * r, ramp(mixRgb(c, WHITE, 0.1), mixRgb(c, WHITE, 0.5)), 0);
  b.spire(x, y - 1.25 * r, z, 0.18 * r, 0.3 * r, scaleRgb(c, 0.6), 4);
}

/** A flat disc facing +z, its axis along z: one ring of the dart board. */
function disc(b: MeshBuilder, x: number, y: number, z: number, r: number, thick: number, paint: Rgb | { bottom: Rgb; top: Rgb }, seg = 16): void {
  b.add(shapes.cylinder(seg), xf(x, y, z, r, thick, r, 0, Math.PI / 2), paint);
}

/** A candy-striped wall: vertical stripes across the front of a stall. */
function stripedWall(b: MeshBuilder, x0: number, x1: number, y0: number, y1: number, z: number, n: number, ca: Rgb, cb: Rgb, shaded = true): void {
  for (let i = 0; i < n; i++) {
    const xa = x0 + ((x1 - x0) * i) / n;
    const xb = x0 + ((x1 - x0) * (i + 1)) / n;
    const col = i % 2 === 0 ? ca : cb;
    b.quad([xa, y0, z], [xb, y0, z], [xb, y1, z], [xa, y1, z], shaded ? scaleRgb(col, 0.62) : col, shaded ? scaleRgb(col, 0.62) : col, col, col);
  }
}

// ─── Food stall ──────────────────────────────────────────────────────────────

export const foodStall: LandmarkSpec = {
  footprint: 11,
  build() {
    const lit = new MeshBuilder();
    const glow = new MeshBuilder();
    const halos: Halo[] = [];
    // Floor, back and side walls, and a striped counter front.
    lit.box(0, -0.35, 0.2, 15, 1.0, 9.6, ramp(DARK, rgb("#6b58b8")));
    lit.box(0, 3.4, -3.8, 14, 6.8, 0.4, ramp(rgb("#d9c9a8"), CREAM));
    for (const s of [-1, 1]) lit.box(s * 6.9, 3.4, -0.6, 0.4, 6.8, 6.4, ramp(rgb("#d9c9a8"), CREAM));
    stripedWall(lit, -7, 7, 0.2, 3.2, 3.5, 14, RED, CREAM);
    lit.box(0, 3.35, 3.4, 14.4, 0.32, 2.2, ramp(rgb("#c4a574"), rgb("#f3e1bd")));
    lit.box(0, 3.1, 4.5, 14.4, 0.3, 0.14, GOLD);
    // Corner posts, candy striped.
    for (const x of [-7, 7]) for (const z of [-3.8, 4.4]) stripedRod(lit, [x, -0.5, z], [x, 7.6, z], 0.5, 8, RED, CREAM);
    // The awning, sloping toward the road, with bulbs along its scalloped front.
    awning(lit, -7.6, 7.6, 8.8, -4.4, 6.5, 5.9, 16, RED, CREAM, 1.0);
    for (const s of [-1, 1]) lit.tri([s * 7.65, 8.8, -4.4], [s * 7.65, 6.5, 5.9], [s * 7.65, 6.5, -4.4], scaleRgb(RED, 0.7), scaleRgb(RED, 0.7), scaleRgb(RED, 0.5));
    for (let q = 0; q < 17; q++) {
      const x = -7.4 + q * 0.925;
      bulb(glow, x, 5.7, 5.95, 0.5, lightAt(q));
    }
    for (let q = 0; q < 12; q++) bulb(glow, -7.5 + q * 1.36, 8.0, 0.3, 0.4, lightAt(q + 1));
    // Warm lamps hanging inside.
    for (const x of [-4, 0, 4]) {
      lit.rod([x, 8.0, 0.5], [x, 6.4, 0.5], 0.15, DARK);
      glow.add(shapes.ball(0), xf(x, 6.1, 0.5, 0.55), G_WARM);
      halos.push({ x, y: 6.1, z: 0.5, size: 6, colour: [3.4, 2.0, 0.9], alpha: 0.6, twinkle: 0.2 });
    }
    halos.push({ x: 0, y: 4.5, z: 0, size: 16, colour: [3.0, 1.7, 0.8], alpha: 0.4, twinkle: 0.15 });
    // The menu board on the back wall: lit panel, price lines, three little pictures.
    lit.box(0, 4.7, -3.45, 8.4, 3.6, 0.3, ramp(DARK, NAVY));
    glow.box(0, 4.7, -3.28, 7.8, 3.0, 0.08, [0.8, 0.45, 1.5]);
    for (let q = 0; q < 4; q++) {
      glow.box(-1.2, 5.7 - q * 0.75, -3.2, 3.8 - (q % 2) * 0.8, 0.28, 0.08, lightAt(q));
      glow.box(2.3, 5.7 - q * 0.75, -3.2, 1.0, 0.28, 0.08, G_WHITE);
    }
    glow.add(shapes.cone(8), xf(-3.1, 4.9, -3.2, 0.5, 1.0, 0.5, 0, Math.PI), G_GOLD);
    glow.add(shapes.ball(0), xf(-3.1, 5.6, -3.2, 0.5, 0.5, 0.1), G_PINK);
    halos.push({ x: 0, y: 4.7, z: -2.8, size: 10, colour: [1.4, 0.8, 2.2], alpha: 0.4, twinkle: 0.2 });
    // A giant ice cream on the roof: waffle cone, three scoops and a cherry.
    const icx = -4.3;
    lit.add(shapes.cone(8), xf(icx, 10.6, 0.4, 1.7, 3.6, 1.7, 0, Math.PI), ramp(rgb("#b57b34"), rgb("#f2c26b")));
    lit.rod([icx, 8.4, 0.4], [icx, 8.9, 0.4], 0.5, rgb("#b57b34"));
    for (const [y, r, col] of [[12.7, 1.95, PINK], [14.6, 1.8, rgb("#bff0d4")], [16.3, 1.6, CREAM]] as const) lit.blob(icx, y, 0.4, r, r * 0.85, r, ramp(scaleRgb(col, 0.75), col), 1);
    for (let q = 0; q < 6; q++) lit.blob(icx + Math.cos(q) * 1.8, 11.9, 0.4 + Math.sin(q) * 1.8, 0.3, 0.55, 0.3, PINK, 0);
    lit.blob(icx, 17.9, 0.4, 0.45, 0.45, 0.45, RED, 0);
    halos.push({ x: icx, y: 14, z: 1.5, size: 9, colour: [3.0, 1.4, 1.8], alpha: 0.3, twinkle: 0.2 });
    // A popcorn tub and a stick of candy floss on the counter, both giant.
    const px = 4.4;
    lathe(lit, [[1.15, 3.5], [1.8, 6.0], [1.9, 6.3]], { at: [px, 0, 3.4], segments: 10, shade: stripes(RED, WHITE), caps: "bottom" });
    for (let q = 0; q < 12; q++) {
      const a = q * 2.4;
      lit.blob(px + Math.cos(a) * 0.9 * ((q % 3) / 3 + 0.4), 6.2 + (q % 4) * 0.28, 3.4 + Math.sin(a) * 0.9 * ((q % 3) / 3 + 0.4), 0.52, 0.46, 0.52, ramp(rgb("#e8cf86"), rgb("#fff6d6")), 0);
    }
    const cfx = 1.3;
    lit.add(shapes.cone(8), xf(cfx, 4.9, 3.4, 0.7, 2.6, 0.7, 0, Math.PI), WHITE);
    for (const [dx, dy, dz, r] of [[0, 6.6, 0, 1.3], [0.8, 6.9, 0.2, 0.9], [-0.8, 6.8, -0.2, 0.9], [0.1, 7.7, 0, 0.9]] as const) lit.blob(cfx + dx, dy, 3.4 + dz, r, r * 0.85, r, ramp(rgb("#ff8cc4"), rgb("#ffd2ea")), 1);
    // Till, napkin box and a sign saying open.
    lit.box(-1.8, 3.9, 3.0, 1.4, 0.9, 1.0, ramp(rgb("#555a88"), STEEL));
    lit.box(-0.1, 3.7, 3.2, 0.7, 0.5, 0.5, rgb("#ffffff"));
    glow.box(-5.6, 5.0, 5.3, 1.8, 0.6, 0.1, G_RED);
    lit.box(-5.6, 5.0, 5.2, 2.0, 0.8, 0.1, DARK);
    // The bin by the stall.
    lit.add(shapes.frustum(0.85, 10), xf(8.8, 0.9, 2.5, 0.7, 1.8, 0.7), ramp(rgb("#1e8a58"), GREEN));
    lit.add(shapes.frustum(0.6, 10), xf(8.8, 1.95, 2.5, 0.82, 0.3, 0.82), ramp(rgb("#145e3c"), rgb("#2a8a5a")));
    return { lit, glow, halos };
  },
};

// ─── Balloon stand ───────────────────────────────────────────────────────────

export const balloonStand: LandmarkSpec = {
  footprint: 9,
  build() {
    const lit = new MeshBuilder();
    const glow = new MeshBuilder();
    const halos: Halo[] = [];
    lit.box(0, -0.35, 0, 11, 1.0, 7.4, ramp(DARK, rgb("#6b58b8")));
    // Back wall with a dart board, flanked by shelves of prizes.
    lit.box(0, 3.4, -3.0, 10.4, 6.8, 0.4, ramp(rgb("#2d6fb8"), rgb("#58a8f0")));
    for (const s of [-1, 1]) lit.box(s * 5.1, 3.4, -0.4, 0.4, 6.8, 5.6, ramp(rgb("#2d6fb8"), rgb("#58a8f0")));
    stripedWall(lit, -5.2, 5.2, 0.2, 2.8, 2.8, 10, YELLOW, WHITE);
    lit.box(0, 2.95, 2.9, 10.8, 0.3, 1.8, ramp(rgb("#c4a574"), rgb("#f3e1bd")));
    // Dart board: concentric rings, bull and a few darts stuck in it.
    const bx = 0;
    const by = 4.5;
    for (const [i, r, col] of [[0, 2.1, DARK], [1, 1.8, WHITE], [2, 1.45, RED], [3, 1.1, WHITE], [4, 0.75, BLUE], [5, 0.38, YELLOW]] as const) disc(lit, bx, by, -2.7 + i * 0.05, r, 0.12, col, 20);
    for (const [dx, dy] of [[0.3, 0.2], [-0.8, 0.6], [1.0, -0.5], [-0.2, -1.1]] as const) {
      lit.rod([bx + dx, by + dy, -2.45], [bx + dx - 0.15, by + dy - 0.1, -1.3], 0.15, STEEL);
      lit.box(bx + dx - 0.15, by + dy - 0.1, -1.2, 0.5, 0.5, 0.06, RED);
    }
    // Prize shelves with plush toys.
    for (const s of [-1, 1]) {
      for (const [i, y] of [3.9, 5.8].entries()) {
        lit.box(s * 3.7, y - 0.15, -2.2, 2.6, 0.2, 1.4, rgb("#d9b878"));
        for (let q = 0; q < 2; q++) plush(lit, s * 3.7 + (q - 0.5) * 1.3, y - 0.05, -2.2, q + i * 2 + (s > 0 ? 1 : 0), 0.72);
      }
    }
    // Posts and a lit, striped, gabled canopy.
    for (const x of [-5.2, 5.2]) for (const z of [-3.0, 3.1]) stripedRod(lit, [x, -0.5, z], [x, 7.4, z], 0.4, 8, RED, CREAM);
    awning(lit, -5.8, 5.8, 9.2, -3.2, 7.0, 4.6, 12, YELLOW, PINK, 0.9);
    for (let q = 0; q < 13; q++) bulb(glow, -5.6 + q * 0.93, 6.4, 4.7, 0.46, lightAt(q));
    for (let q = 0; q < 9; q++) bulb(glow, -4.6 + q * 1.15, 8.3, 0.5, 0.4, lightAt(q + 1));
    for (const x of [-2.8, 2.8]) {
      glow.add(shapes.ball(0), xf(x, 5.9, 0.8, 0.5), G_WARM);
      halos.push({ x, y: 5.9, z: 0.8, size: 6, colour: [3.4, 2.0, 0.9], alpha: 0.6, twinkle: 0.2 });
    }
    halos.push({ x: 0, y: 4.2, z: 0.2, size: 14, colour: [3.0, 1.7, 0.8], alpha: 0.35, twinkle: 0.15 });
    // A lit sign over the canopy: a big balloon on a navy board.
    lit.box(0, 10.8, -1.6, 5.4, 3.4, 0.4, ramp(DARK, NAVY));
    glow.add(shapes.ball(1), xf(0, 11.0, -1.3, 1.1, 1.25, 0.15), G_PINK);
    glow.rod([0, 9.7, -1.25], [-0.3, 9.1, -1.25], 0.14, G_WHITE);
    for (const [dx, dy, c] of [[-1.7, 11.4, G_GOLD], [1.7, 11.4, G_CYAN]] as const) glow.add(shapes.ball(0), xf(dx, dy, -1.3, 0.6, 0.7, 0.12), c);
    halos.push({ x: 0, y: 11, z: -0.6, size: 9, colour: [3.4, 1.0, 1.8], alpha: 0.4, twinkle: 0.4 });

    // The balloon cluster tied to the canopy corner, swaying: its own moving part, pivoted at the knot.
    const ax = 4.4;
    const ay = 9.3;
    const az = 0.6;
    const cluster = new MeshBuilder();
    const colours = [RED, ORANGE, YELLOW, GREEN, TEAL, BLUE, PURPLE, PINK];
    cluster.blob(ax, ay + 0.05, az, 0.28, 0.28, 0.28, GOLD, 0);
    const rnd = (i: number): number => ((Math.sin(i * 12.9898 + 4.1) * 43758.5453) % 1 + 1) % 1;
    for (let q = 0; q < 26; q++) {
      const ang = q * 2.4;
      const ring = 0.6 + (q % 4) * 0.75 + rnd(q) * 0.4;
      const rise = 5.0 + (q % 4) * 1.35 + rnd(q + 9) * 1.0;
      const bx2 = ax + Math.cos(ang) * ring;
      const bz2 = az + Math.sin(ang) * ring * 0.8;
      const by2 = ay + rise;
      cluster.rod([ax, ay + 0.2, az], [bx2, by2 - 1.2, bz2], 0.15, WHITE);
      balloon(cluster, bx2, by2, bz2, colours[(q * 3 + (q >> 3)) % colours.length]!, 0.95 + rnd(q + 3) * 0.2);
    }
    return {
      lit,
      glow,
      halos,
      moving: [
        {
          lit: cluster,
          pivot: [ax, ay, az],
          update(t, part) {
            part.rotation.z = 0.07 * Math.sin(t * 0.9);
            part.rotation.x = 0.05 * Math.sin(t * 0.7 + 1.3);
          },
        },
      ],
    };
  },
};

// ─── Hook-a-duck ─────────────────────────────────────────────────────────────

/** A yellow toy duck about 3 m long with a hook ring on its back, facing +z. */
function toyDuck(): MeshBuilder {
  const b = new MeshBuilder();
  const Y = rgb("#ffe433");
  b.blob(0, 0.55, 0, 0.85, 0.65, 1.1, ramp(rgb("#ffd400"), mixRgb(Y, WHITE, 0.45)), 0);
  b.blob(0, 1.35, 0.7, 0.52, 0.5, 0.5, ramp(rgb("#f0b800"), mixRgb(Y, WHITE, 0.15)), 0);
  b.box(0, 1.25, 1.25, 0.46, 0.14, 0.5, ORANGE);
  b.box(-0.27, 1.5, 1.05, 0.1, 0.1, 0.06, DARK);
  b.box(0.27, 1.5, 1.05, 0.1, 0.1, 0.06, DARK);
  b.spire(0, 0.8, -1.15, 0.3, 0.7, Y, 4);
  for (const s of [-1, 1]) {
    b.blob(s * 0.78, 0.65, -0.05, 0.14, 0.38, 0.62, rgb("#f0b800"), 0);
    b.box(s * 0.84, 0.35, 0.1, 0.1, 0.26, 0.26, DARK);
  }
  // The hook ring on the back.
  torus(b, 0.3, 0.1, { at: [0, 1.35, -0.4], facing: "x", ringSegments: 8, tubeSegments: 4, shade: STEEL });
  return b;
}

export const hookADuck: LandmarkSpec = {
  footprint: 11,
  build() {
    const lit = new MeshBuilder();
    const glow = new MeshBuilder();
    const glass = new MeshBuilder();
    const halos: Halo[] = [];
    const PZ = 1.0; // the pool's centre
    lit.box(0, -0.35, 0, 15, 1.0, 10.4, ramp(DARK, rgb("#6b58b8")));
    // Back wall and a hanging prizes board.
    lit.box(0, 3.5, -4.4, 14.4, 7, 0.4, ramp(rgb("#1f8f9c"), rgb("#52d0d8")));
    for (const s of [-1, 1]) lit.box(s * 7.1, 3.5, -1.6, 0.4, 7, 5.6, ramp(rgb("#1f8f9c"), rgb("#52d0d8")));
    lit.box(0, 4.6, -4.1, 9.0, 3.6, 0.25, ramp(rgb("#d9b878"), rgb("#f6e0b0")));
    for (let q = 0; q < 6; q++) {
      const x = -3.6 + q * 1.44;
      lit.rod([x, 6.4, -3.9], [x, 5.9, -3.9], 0.15, STEEL);
      plush(lit, x, 4.2, -3.7, q, 0.85);
    }
    // Counters left and right of the pool, striped.
    for (const s of [-1, 1]) {
      lit.box(s * 5.9, 1.6, 0.9, 2.6, 3.2, 8.2, ramp(DARK, NAVY));
      stripedWall(lit, s * 4.6, s * 7.2, 0.2, 3.0, 5.1, 3, RED, CREAM);
      lit.box(s * 5.9, 3.3, 0.9, 2.9, 0.3, 8.5, ramp(rgb("#c4a574"), rgb("#f3e1bd")));
    }
    // The round pool: striped wall, rim, pale floor, water (glass), a glow under the water.
    lathe(lit, [[3.9, -1], [4.15, -1], [4.15, 1.3], [3.9, 1.3]], { at: [0, 0, PZ], segments: 20, shade: stripes(RED, CREAM) });
    torus(lit, 4.1, 0.38, { at: [0, 1.4, PZ], facing: "y", ringSegments: 20, tubeSegments: 5, shade: stripes(WHITE, YELLOW, "row", 1) });
    lathe(lit, [[0, 0.2], [3.95, 0.2]], { at: [0, 0, PZ], segments: 20, shade: rgb("#bfe9f5"), caps: "top" });
    glow.add(shapes.cylinder(20), xf(0, 0.35, PZ, 3.9, 0.06, 3.9), [0.25, 1.1, 1.6]);
    lathe(glass, [[0, 1.0], [3.95, 1.0]], { at: [0, 0, PZ], segments: 20, shade: [0.3, 0.9, 1.3], caps: "top" });
    halos.push({ x: 0, y: 1.6, z: PZ, size: 12, colour: [0.5, 1.9, 2.8], alpha: 0.3, twinkle: 0.3 });
    // Posts, a striped canopy sloping to the road, bulbs and lamps.
    for (const x of [-7, 7]) for (const z of [-4.4, 5.6]) stripedRod(lit, [x, -0.5, z], [x, 7.6, z], 0.5, 8, YELLOW, TEAL);
    awning(lit, -7.8, 7.8, 9.0, -4.8, 7.0, 6.2, 16, YELLOW, TEAL, 1.0);
    for (let q = 0; q < 17; q++) bulb(glow, -7.6 + q * 0.95, 6.2, 6.3, 0.5, lightAt(q));
    for (const x of [-3, 3]) {
      glow.add(shapes.ball(0), xf(x, 6.0, -1.0, 0.5), G_WARM);
      halos.push({ x, y: 6.0, z: -1.0, size: 6, colour: [3.4, 2.0, 0.9], alpha: 0.55, twinkle: 0.2 });
    }
    // The sign: a duck in warm glow on a navy board, lit by bulbs.
    lit.box(0, 11.2, -3.0, 8.2, 4.0, 0.5, ramp(DARK, NAVY));
    glow.add(shapes.ball(1), xf(-0.2, 10.7, -2.7, 1.5, 1.1, 0.14), [4, 3.0, 0.6]);
    glow.add(shapes.ball(1), xf(1.0, 11.8, -2.7, 0.8, 0.8, 0.14), [4, 3.0, 0.6]);
    glow.box(1.95, 11.65, -2.7, 0.9, 0.3, 0.14, G_RED);
    glow.add(shapes.ball(0), xf(-1.5, 11.4, -2.7, 0.35, 0.9, 0.14, 0, 0, 0.5), [4, 3.0, 0.6]);
    bulbLine(glow, [-3.8, 13.0, -2.7], [3.8, 13.0, -2.7], 12, 0.4);
    bulbLine(glow, [-3.8, 9.4, -2.7], [3.8, 9.4, -2.7], 12, 0.4, 2);
    halos.push({ x: 0, y: 11.2, z: -2.2, size: 11, colour: [3.8, 2.6, 0.8], alpha: 0.4, twinkle: 0.3 });

    // Ducks in three drifting groups (each its own turning part, bobbing out of step), plus a pulsing ripple ring.
    const groups: [number, number, number][][] = [
      [[2.6, 0.0, 0], [2.2, 2.3, 1], [3.0, 4.2, 2], [1.4, 5.5, 3]],
      [[3.1, 1.2, 4], [1.8, 3.4, 5], [2.5, 5.1, 6]],
      [[1.0, 0.4, 7], [2.9, 3.0, 8], [2.0, 4.6, 9]],
    ];
    const duckSrc = toyDuck();
    const moving: MovingPart[] = groups.map((g, gi) => {
      const b = new MeshBuilder();
      for (const [r, a] of g) stamp(b, duckSrc, xf(Math.cos(a) * r, 0.95, PZ + Math.sin(a) * r, 1, 1, 1, -a + Math.PI / 2));
      const rate = (gi % 2 === 0 ? 1 : -1) * (0.1 + gi * 0.035);
      return {
        lit: b,
        pivot: [0, 0.95, PZ],
        update(t, part) {
          part.rotation.y = rate * t;
          part.position.y = 0.12 * Math.sin(t * (1.1 + gi * 0.3) + gi * 2) + 0.05;
          part.rotation.z = 0.04 * Math.sin(t * 0.9 + gi);
        },
      };
    });
    const ripple = new MeshBuilder();
    torus(ripple, 2.0, 0.12, { at: [0, 1.02, PZ], facing: "y", ringSegments: 20, tubeSegments: 3, shade: [1, 1, 1] });
    moving.push({
      glass: ripple,
      pivot: [0, 1.0, PZ],
      update(t, part) {
        const k = 0.7 + 0.5 * (0.5 + 0.5 * Math.sin(t * 0.8));
        part.scale.set(k, 1, k);
      },
    });
    return { lit, glow, glass, halos, moving };
  },
};

// ─── Fireworks ───────────────────────────────────────────────────────────────

/** Directions spread evenly over a sphere (a Fibonacci spiral). */
function sphereDirs(n: number): V3[] {
  const out: V3[] = [];
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n;
    const r = Math.sqrt(1 - y * y);
    const a = i * 2.399963;
    out.push([Math.cos(a) * r, y, Math.sin(a) * r]);
  }
  return out;
}

export const fireworks: LandmarkSpec = {
  footprint: 10,
  build() {
    const lit = new MeshBuilder();
    const glow = new MeshBuilder();
    const halos: Halo[] = [];
    // A launch deck of planks with a rack of mortar tubes, crates, barrels and a ramp with three rockets.
    lit.box(0, -0.4, 0, 22, 1.0, 14, ramp(DARK, rgb("#6b4a2c")));
    for (let q = 0; q < 6; q++) lit.box(-9.5 + q * 3.8, 0.12, 0, 0.14 + 0.06, 0.1, 13.6, rgb("#4a3320"));
    // Mortar rack: a frame holding 4 x 3 tubes, leaning back a little.
    lit.box(-6, 0.9, -1, 6.6, 1.4, 3.4, ramp(rgb("#4a3320"), rgb("#8a6a3a")));
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 3; j++) {
        const x = -8.1 + i * 1.4;
        const z = -2.1 + j * 1.1;
        const col = candyAt(i * 3 + j);
        lit.add(shapes.cylinder(8), xf(x, 3.0, z, 0.5, 4.0, 0.5, 0, -0.12), ramp(scaleRgb(col, 0.5), col));
        lit.add(shapes.cylinder(8), xf(x, 5.2, z + 0.27, 0.42, 0.3, 0.42, 0, -0.12), DARK);
        lit.add(shapes.cylinder(8), xf(x, 2.1, z, 0.55, 0.3, 0.55), GOLD);
      }
    }
    // Crates with warning stripes, stacked, and powder barrels.
    for (const [x, y, z, yaw] of [[1.5, 0.8, -3.6, 0.1], [3.4, 0.8, -3.2, -0.2], [2.4, 2.3, -3.4, 0.15]] as const) {
      lit.box(x, y, z, 2.0, 1.5, 2.0, ramp(rgb("#8a5a2a"), rgb("#d9a050")), yaw);
      lit.box(x, y, z + 0.02, 2.06, 0.34, 2.06, DARK, yaw);
      lit.box(x, y + 0.2, z + 1.03, 1.2, 0.6, 0.06, RED, yaw);
    }
    for (const [x, z] of [[-1.6, -4.4], [0.1, -4.8]] as const) {
      lit.add(shapes.cylinder(10), xf(x, 0.95, z, 0.9, 1.7, 0.9), ramp(scaleRgb(RED, 0.6), RED));
      lit.add(shapes.cylinder(10), xf(x, 0.9, z, 0.96, 0.2, 0.96), GOLD);
      lit.add(shapes.cylinder(10), xf(x, 1.5, z, 0.96, 0.2, 0.96), GOLD);
    }
    // The ramp: a slanted rail with three big rockets, noses to the sky.
    lit.rod([5.5, 0.4, 3.5], [10.2, 4.4, 2.2], 0.4, rgb("#6b4a2c"));
    lit.rod([5.5, 0.4, -0.5], [10.2, 4.4, -1.8], 0.4, rgb("#6b4a2c"));
    for (let q = 0; q < 3; q++) {
      const z = 2.4 - q * 1.9;
      const col = [RED, BLUE, GREEN][q]!;
      const base: V3 = [6.0 + q * 0.2, 1.3, z];
      const tip: V3 = [9.6 + q * 0.4, 4.5, z - 0.6];
      lit.rod(base, tip, 0.9, ramp(scaleRgb(col, 0.6), col));
      lit.rod([tip[0], tip[1], tip[2]], [tip[0] + 1.0, tip[1] + 0.9, tip[2] - 0.15], 0.5, GOLD);
      bulb(glow, base[0] - 0.4, base[1] - 0.3, base[2], 0.5, G_GOLD);
    }
    // Fuse trail and lanterns.
    for (let q = 0; q < 6; q++) bulb(glow, 3 + q * 1.1, 0.35, 4.6 - q * 0.6, 0.28, q === 5 ? G_WHITE : G_RED);
    halos.push({ x: 8, y: 0.5, z: 1.5, size: 5, colour: G_WHITE, alpha: 0.7, twinkle: 0.9 });
    for (const x of [-10, 10]) {
      lit.post(x, -0.5, 6, 0.18, 4.5, STEEL, 6);
      glow.add(shapes.ball(0), xf(x, 4.4, 6, 0.5), G_WARM);
      halos.push({ x, y: 4.4, z: 6, size: 6, colour: [3.4, 2.0, 0.9], alpha: 0.6, twinkle: 0.3 });
    }
    halos.push({ x: -6, y: 6, z: -1, size: 6, colour: G_GOLD, alpha: 0.5, twinkle: 0.8 });

    // Three bursts in the sky, each looping: expand, hold, fall and fade, wait.
    const dirs = sphereDirs(24);
    const burstDefs: { c: V3; R: number; a: Rgb; b: Rgb; phase: number; period: number }[] = [
      { c: [-14, 58, 6], R: 15, a: [2.8, 1.6, 0.25], b: [3.2, 1.0, 0.2], phase: 0, period: 8 },
      { c: [16, 66, 10], R: 13, a: [2.8, 0.35, 1.5], b: [2.2, 0.5, 2.8], phase: 3.1, period: 8.6 },
      { c: [2, 46, -6], R: 11, a: [0.3, 1.9, 3.0], b: [0.5, 2.8, 1.6], phase: 5.6, period: 7.4 },
    ];
    const moving: MovingPart[] = burstDefs.map((d) => {
      const g = new MeshBuilder();
      g.add(shapes.ball(1), xf(d.c[0], d.c[1], d.c[2], 2.4), G_WHITE);
      dirs.forEach((u, i) => {
        const col = i % 2 === 0 ? d.a : d.b;
        g.rod([d.c[0] + u[0] * d.R * 0.2, d.c[1] + u[1] * d.R * 0.2, d.c[2] + u[2] * d.R * 0.2], [d.c[0] + u[0] * d.R * 0.92, d.c[1] + u[1] * d.R * 0.92, d.c[2] + u[2] * d.R * 0.92], 0.5, col);
        g.box(d.c[0] + u[0] * d.R, d.c[1] + u[1] * d.R, d.c[2] + u[2] * d.R, 1.1, 1.1, 1.1, [3, 2.5, 1.8], 0.7, 0.6, 0.3);
        // A second, inner shell of short sparks.
        g.rod([d.c[0] + u[0] * d.R * 0.5, d.c[1] + u[1] * d.R * 0.5, d.c[2] + u[2] * d.R * 0.5], [d.c[0] + u[0] * d.R * 0.66, d.c[1] + u[1] * d.R * 0.66, d.c[2] + u[2] * d.R * 0.66], 0.35, col);
      });
      return {
        glow: g,
        pivot: d.c,
        update(t, part) {
          const u = (((t + d.phase) % d.period) + d.period) % d.period;
          let s = 0;
          let fall = 0;
          if (u < 2.4) {
            const x = u / 2.4;
            s = 0.05 + 0.95 * (1 - Math.pow(1 - x, 3));
          } else if (u < 3.6) {
            s = 1 + 0.04 * (u - 2.4);
          } else if (u < 5.0) {
            const x = (u - 3.6) / 1.4;
            s = 1.05 * (1 - x * x);
            fall = 7 * x * x;
          }
          part.visible = s > 0.001;
          part.scale.setScalar(s);
          part.position.set(0, -fall, 0);
        },
      };
    });
    return { lit, glow, halos, moving };
  },
};
