/**
 * The funfair's spans, built in the road's frame and bent along it
 * (LandmarkContext.span): the big top the road runs through, the rollercoaster
 * that swoops over the road and loops beside it, and the entrance arch with
 * FUN FAIR in lights.
 */
import { Matrix4, Vector3 } from "three";
import { byHeight, extrudeZ, grid, lathe, MeshBuilder, mixRgb, pipe, ramp, rgb, scaleRgb, shapes, stripes, tube, xf, type Rgb, type V3 } from "../kit";
import type { Halo, LandmarkSpec } from "../types";
import { blockText, BRASS, bulb, candyAt, CREAM, DARK, G_CYAN, G_PINK, G_WARM, G_WHITE, GOLD, lightAt, NAVY, ORANGE, PINK, RED, scallops, STEEL, TEAL, WHITE, YELLOW } from "./common";

// ─── Big top ─────────────────────────────────────────────────────────────────

export const bigTop: LandmarkSpec = {
  span: true,
  defaultSpan: 60,
  build(ctx) {
    const L = ctx.span;
    const w = ctx.halfWidth + 8;
    const lit = new MeshBuilder();
    const glow = new MeshBuilder();
    const glass = new MeshBuilder();
    const rows = Math.max(4, Math.round(L / 3));
    // A barrel vault: straight walls to 6.5 m, then half an ellipse up to a 17.2 m ridge (smooth, so the canvas looks swagged).
    const right: [number, number][] = [[w, 6.5]];
    for (let k = 1; k <= 9; k++) {
      const a = (k / 9) * (Math.PI / 2);
      right.push([w * Math.cos(a), 6.5 + 10.7 * Math.sin(a)]);
    }
    right.pop();
    const section: [number, number][] = [[-w, -1], ...right.map(([x, y]): [number, number] => [-x, y]), [0, 17.2], ...[...right].reverse(), [w, -1]];

    // The canvas: red and cream stripes running ridge to eave, darker at the foot.
    const canvas = (p: V3, i: number): Rgb => {
      const base = i % 2 === 0 ? RED : CREAM;
      return scaleRgb(base, 0.62 + 0.38 * Math.max(0, Math.min(1, (p[1] + 1) / 17)));
    };
    extrudeZ(lit, section, -L / 2, L / 2, rows, canvas);
    // Inside, the same stripes glow, so the tent is lit from within yet solid from outside.
    extrudeZ(glow, section, -L / 2, L / 2, rows, (_p, i) => (i % 2 === 0 ? [1.9, 0.4, 0.45] : [1.7, 1.35, 1.0]), { scaleAt: () => 0.985 });
    // A faint warm skin outside: the glow of the canvas.
    extrudeZ(glass, section, -L / 2, L / 2, rows, [1.1, 0.5, 0.5], { scaleAt: () => 1.015 });

    // Steel ribs inside every 12 m, each hung with bulbs.
    const ribs: number[] = [];
    for (let z = -L / 2 + 1; z <= L / 2 - 0.9; z += 12) ribs.push(z);
    ribs.push(L / 2 - 0.3);
    for (const z of ribs) {
      const path: V3[] = section.map(([x, y]): V3 => [x * 0.975, y * 0.975, z]);
      tube(lit, path, { radius: 0.34, sides: 4, shade: STEEL });
      for (let k = 1; k < section.length - 1; k += 2) {
        const [x, y] = section[k]!;
        bulb(glow, x * 0.955, y * 0.955, z, 0.5, lightAt(k + Math.round(z)));
      }
    }
    // The ridge: a beam with a row of bulbs under it, and a halo at intervals.
    for (let z = -L / 2 + 1.5; z <= L / 2 - 1; z += 3) {
      bulb(glow, 0, 16.5, z, 0.6, lightAt(Math.round(z / 3)));
      lit.box(0, 16.95, z, 0.4, 0.3, 3.0, STEEL);
    }
    // Two spotlight beams crossing the middle, from small lamps under the ridge.
    const beam = (lx: number, lz: number, rz: number, colour: Rgb): void => {
      lit.box(lx, 15.9, lz, 0.8, 0.7, 0.8, DARK);
      bulb(glow, lx, 15.5, lz, 0.5, G_WHITE);
      const len = 15.5;
      glass.add(shapes.cone(10), xf(lx + (Math.sin(rz) * len) / 2, 15.5 - (Math.cos(rz) * len) / 2, lz, 3.2, len, 3.2, 0, 0, rz), colour);
    };
    beam(-4, -L * 0.2, -0.62, [0.5, 0.9, 1.5]);
    beam(4, L * 0.12, 0.62, [1.5, 0.5, 1.1]);

    // Entrance valances, flaps tied back, bunting and flags at both ends.
    for (const e of [-1, 1]) {
      const z = e * (L / 2 + 0.1);
      const pts = section.slice(1, -1);
      for (let k = 0; k < pts.length - 1; k++) {
        const a = pts[k]!;
        const c = pts[k + 1]!;
        scallops(lit, [a[0], a[1], z], [c[0], c[1], z], 2, 1.7, RED, CREAM);
      }
      // Flaps: gathered at a gold tie, flaring to the ground.
      for (const s of [-1, 1]) {
        const x0 = s * w;
        const fl: V3[][] = [
          [[x0, 6.4, z], [x0 - s * 1.3, 8.5, z], [x0 - s * 2.8, 10.6, z], [x0 - s * 4.2, 11.8, z]],
          [[x0, 4.2, z + e * 0.5], [x0 - s * 0.5, 4.2, z + e * 0.6], [x0 - s * 0.9, 4.2, z + e * 0.6], [x0 - s * 1.2, 4.2, z + e * 0.5]],
          [[x0, -0.5, z], [x0 - s * 1.6, -0.5, z + e * 0.3], [x0 - s * 3.0, -0.5, z + e * 0.2], [x0 - s * 4.1, -0.5, z]],
        ];
        grid(lit, fl, (p, i, j) => scaleRgb(j % 2 === 0 ? RED : rgb("#c01f45"), 0.75 + 0.1 * i));
        tube(lit, [[x0 + s * 0.2, 4.2, z + e * 0.7], [x0 - s * 0.6, 4.2, z + e * 0.8], [x0 - s * 1.4, 4.2, z + e * 0.7]], { radius: 0.2, sides: 4, shade: GOLD });
        lit.blob(x0 - s * 1.7, 3.6, z + e * 0.7, 0.35, 0.55, 0.35, GOLD, 0);
        bulb(glow, x0 - s * 1.5, 7.8, z + e * 0.2, 0.5, lightAt(s + 2));
      }
      // A flag on a mast over the ridge end.
      lit.rod([0, 16.8, z - e * 1.2], [0, 21.5, z - e * 1.2], 0.2, STEEL);
      lit.tri([0, 21.4, z - e * 1.2], [0, 19.8, z - e * 1.2], [0, 20.6, z - e * 1.2 - e * 2.8], YELLOW, ORANGE, RED);
    }
    // Bunting along both eaves, and guy ropes to pegs.
    for (const s of [-1, 1]) {
      const x = s * (w + 0.2);
      for (let z = -L / 2; z < L / 2 - 0.1; z += 3) {
        const segs = 3;
        for (let k = 0; k < segs; k++) {
          const z0 = z + (k * 3) / segs;
          const z1 = z + ((k + 1) * 3) / segs;
          const sag = (u: number): number => 6.2 - Math.sin(u * Math.PI) * 0.45;
          const p0: V3 = [x, sag(k / segs), z0];
          const p1: V3 = [x, sag((k + 1) / segs), z1];
          lit.rod(p0, p1, 0.15, DARK);
          const mz = (z0 + z1) / 2;
          const c = candyAt(Math.round(z) + k + (s > 0 ? 3 : 0));
          lit.tri([x, (p0[1] + p1[1]) / 2, z0 + 0.1], [x, (p0[1] + p1[1]) / 2, z1 - 0.1], [x + s * 0.05, (p0[1] + p1[1]) / 2 - 1.0, mz], c, c, scaleRgb(c, 0.8));
        }
      }
      for (let z = -L / 2 + 6; z < L / 2 - 3; z += 12) {
        lit.rod([s * (w - 0.2), 6.0, z], [s * (w + 4.5), -0.8, z], 0.2, GOLD);
        lit.box(s * (w + 4.6), -0.4, z, 0.5, 1.2, 0.5, DARK, 0, 0, 0.3);
      }
    }
    const halos: Halo[] = [];
    for (let z = -L / 2 + 6; z <= L / 2 - 5; z += 12) halos.push({ x: 0, y: 16.2, z, size: 9, colour: [3.4, 2.2, 1.0], alpha: 0.3, twinkle: 0.3 });
    for (const e of [-1, 1]) {
      for (const s of [-1, 1]) halos.push({ x: s * (w - 3), y: 8, z: e * (L / 2 - 1), size: 9, colour: lightAt(s + e + 4), alpha: 0.45, twinkle: 0.4 });
    }
    return { lit, glow, glass, halos };
  },
};

// ─── Rollercoaster ───────────────────────────────────────────────────────────

/** A smooth curve through points (centripetal Catmull-Rom), resampled every `ds` metres of length. */
function smoothPath(pts: readonly V3[], ds: number): V3[] {
  const dist = (a: V3, b: V3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const n = pts.length;
  const dense: V3[] = [];
  for (let i = 0; i < n - 1; i++) {
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const p0 = i === 0 ? ([2 * p1[0] - p2[0], 2 * p1[1] - p2[1], 2 * p1[2] - p2[2]] as V3) : pts[i - 1]!;
    const p3 = i + 2 >= n ? ([2 * p2[0] - p1[0], 2 * p2[1] - p1[1], 2 * p2[2] - p1[2]] as V3) : pts[i + 2]!;
    const t0 = 0;
    const t1 = t0 + Math.sqrt(dist(p0, p1) || 1e-3);
    const t2 = t1 + Math.sqrt(dist(p1, p2) || 1e-3);
    const t3 = t2 + Math.sqrt(dist(p2, p3) || 1e-3);
    const steps = 24;
    for (let k = 0; k < steps; k++) {
      const t = t1 + ((t2 - t1) * k) / steps;
      const mix = (a: V3, b: V3, ta: number, tb: number): V3 => {
        const u = (t - ta) / (tb - ta);
        return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
      };
      const A1 = mix(p0, p1, t0, t1);
      const A2 = mix(p1, p2, t1, t2);
      const A3 = mix(p2, p3, t2, t3);
      const B1 = mix(A1, A2, t0, t2);
      const B2 = mix(A2, A3, t1, t3);
      dense.push(mix(B1, B2, t1, t2));
    }
  }
  dense.push(pts[n - 1]!);
  const out: V3[] = [dense[0]!];
  let carried = 0;
  for (let i = 1; i < dense.length; i++) {
    const a = dense[i - 1]!;
    const b = dense[i]!;
    const seg = dist(a, b);
    let at = ds - carried;
    while (at <= seg) {
      const u = at / seg;
      out.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u]);
      at += ds;
    }
    carried = seg - (at - ds);
  }
  return out;
}

export const rollercoaster: LandmarkSpec = {
  span: true,
  defaultSpan: 120,
  build(ctx) {
    const hw = ctx.halfWidth;
    const k = ctx.span / 120;
    const X = hw + 9; // where the supports stand beside the road
    const lit = new MeshBuilder();
    const glow = new MeshBuilder();
    // Waypoints: the lift hill on the left, a swoop over the road, a hump, a vertical loop on the right, and back over the road.
    const wp: V3[] = [
      [-X - 1.5, 3, -58 * k],
      [-X - 1.5, 7, -50 * k],
      [-X - 1, 15, -43 * k],
      [-X, 24, -37 * k],
      [-X, 31, -31 * k],
      [-X + 0.8, 32, -26 * k],
      [-X + 4.5, 28, -20 * k],
      [-6, 21.5, -13 * k],
      [0, 18.2, -8 * k],
      [6.5, 21, -3 * k],
      [X - 3, 26, 3 * k],
      [X + 3, 26.5, 8 * k],
      [X + 6, 21, 13 * k],
      [X + 7, 11, 18 * k],
      [X + 7, 4.2, 24 * k],
    ];
    // The vertical loop beside the road: a circle in the y-z plane that drifts sideways so the entry and exit clear each other.
    const cx = X + 7;
    const loopR = 10;
    const loopZ = 33 * k;
    wp.push([cx, 4.2, loopZ]);
    for (let q = 1; q <= 11; q++) {
      const th = (q / 12) * Math.PI * 2;
      wp.push([cx + (5 * th) / (Math.PI * 2), 14.2 - loopR * Math.cos(th), loopZ + loopR * Math.sin(th)]);
    }
    wp.push([cx + 5, 4.2, loopZ], [cx + 4.5, 4.8, loopZ + 11 * k], [X + 3, 9, 47 * k], [X - 3, 13.8, 50.5 * k], [6, 16, 53 * k], [-1, 15.2, 55 * k], [-9, 14.8, 56 * k], [-X - 2, 10, 57.5 * k], [-X - 2.5, 4, 59 * k]);
    const path = smoothPath(wp, 3.2);
    const n = path.length;

    // Frames: tangent T, side S (parallel transported so the track never twists), up U.
    const T: V3[] = [];
    const S: V3[] = [];
    const U: V3[] = [];
    let side: V3 = [1, 0, 0];
    for (let i = 0; i < n; i++) {
      const a = path[Math.max(0, i - 1)]!;
      const c = path[Math.min(n - 1, i + 1)]!;
      let t: V3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const tl = Math.hypot(t[0], t[1], t[2]) || 1;
      t = [t[0] / tl, t[1] / tl, t[2] / tl];
      const d = side[0] * t[0] + side[1] * t[1] + side[2] * t[2];
      let sv: V3 = [side[0] - t[0] * d, side[1] - t[1] * d, side[2] - t[2] * d];
      const sl = Math.hypot(sv[0], sv[1], sv[2]) || 1;
      sv = [sv[0] / sl, sv[1] / sl, sv[2] / sl];
      side = sv;
      T.push(t);
      S.push(sv);
      U.push([t[1] * sv[2] - t[2] * sv[1], t[2] * sv[0] - t[0] * sv[2], t[0] * sv[1] - t[1] * sv[0]]);
    }
    const at = (i: number, s: number, u: number): V3 => {
      const p = path[i]!;
      const sv = S[i]!;
      const uv = U[i]!;
      return [p[0] + sv[0] * s + uv[0] * u, p[1] + sv[1] * s + uv[1] * u, p[2] + sv[2] * s + uv[2] * u];
    };
    const m4 = new Matrix4();
    const frameBox = (b: MeshBuilder, i: number, s: number, u: number, along: number, sx: number, sy: number, sz: number, paint: Rgb | { bottom: Rgb; top: Rgb }): void => {
      const c = at(i, s, u);
      const t = T[i]!;
      m4.makeBasis(new Vector3(...S[i]!), new Vector3(...U[i]!), new Vector3(...t));
      m4.setPosition(c[0] + t[0] * along, c[1] + t[1] * along, c[2] + t[2] * along);
      m4.scale(new Vector3(sx, sy, sz));
      b.add(shapes.box(), m4.clone(), paint);
    };

    const railL = path.map((_p, i) => at(i, -0.95, 0));
    const railR = path.map((_p, i) => at(i, 0.95, 0));
    const chord = path.map((_p, i) => at(i, 0, -2.3));
    tube(lit, railL, { radius: 0.32, sides: 4, shade: RED });
    tube(lit, railR, { radius: 0.32, sides: 4, shade: RED });
    tube(lit, chord, { radius: 0.42, sides: 4, shade: WHITE });
    // The neon keel: pink and cyan dashes under the sleepers.
    tube(
      glow,
      path.map((_p, i) => at(i, 0, -0.75)),
      { radius: 0.34, sides: 4, shade: (_p, i) => (Math.floor(i / 2) % 2 === 0 ? G_CYAN : G_PINK) },
    );
    for (let i = 0; i < n; i++) {
      if (i % 2 === 0) frameBox(lit, i, 0, -0.2, 0, 3.1, 0.26, 0.6, WHITE);
      if (i < n - 1) lit.rod(i % 2 === 0 ? railL[i]! : railR[i]!, chord[i + 1]!, 0.26, i % 4 < 2 ? WHITE : STEEL);
    }

    // Lattice supports wherever the track is high and clear of the road.
    const bays = 6;
    for (let i = 3; i < n - 2; i += 5) {
      const p = chord[i]!;
      if (Math.abs(p[0]) < hw + 5.5 || p[1] < 6) continue;
      // The loop is held from outside, not through its middle.
      if (p[0] > X + 2 && p[2] > 20 * k && p[2] < 46 * k) continue;
      const top = p[1] - 0.1;
      for (const dz of [-1.3, 1.3]) pipe(lit, [p[0], -1.5, p[2] + dz], [p[0], top, p[2] + dz], 0.45, WHITE, 4);
      for (let q = 0; q < bays; q++) {
        const y0 = -1.5 + ((top + 1.5) * q) / bays;
        const y1 = -1.5 + ((top + 1.5) * (q + 1)) / bays;
        lit.rod([p[0], y0, p[2] + (q % 2 ? 1.3 : -1.3)], [p[0], y1, p[2] + (q % 2 ? -1.3 : 1.3)], 0.3, RED);
        if (q % 2 === 0) lit.rod([p[0], y1, p[2] - 1.3], [p[0], y1, p[2] + 1.3], 0.3, RED);
      }
      lit.box(p[0], -1.2, p[2], 1.2, 1.2, 4, ramp(DARK, rgb("#6b58b8")));
    }
    // The loop's outrigger: a leaning mast from its crown out to a footing.
    const crown = path.reduce((best, p) => (p[1] > best[1] ? p : best), path[0]!);
    pipe(lit, [crown[0] + 1, crown[1] - 3, crown[2] - 1.3], [crown[0] + 7, -1.5, crown[2] - 1.3], 0.3, WHITE, 4);
    pipe(lit, [crown[0] + 1, crown[1] - 3, crown[2] + 1.3], [crown[0] + 7, -1.5, crown[2] + 1.3], 0.3, WHITE, 4);
    lit.box(crown[0] + 7, -1.2, crown[2], 1.4, 1.2, 4, ramp(DARK, rgb("#6b58b8")));

    // The train, parked on the crest of the lift hill: three cars in candy colours.
    const top = path.reduce((bi, p, i) => (p[2] < -20 * k && p[1] > path[bi]![1] ? i : bi), 0);
    const carColours = [RED, YELLOW, TEAL];
    for (let c = 0; c < 3; c++) {
      const i = top + c - 1;
      if (i < 0 || i >= n) continue;
      const col = carColours[c]!;
      frameBox(lit, i, 0, 0.62, 0, 2.2, 0.9, 3.0, ramp(scaleRgb(col, 0.6), col));
      frameBox(lit, i, 0, 1.2, -0.6, 2.0, 0.5, 1.4, mixRgb(col, WHITE, 0.3));
      frameBox(lit, i, 0, 0.2, 1.65, 1.6, 0.5, 0.3, GOLD);
      frameBox(glow, i, 0, 1.0, 1.52, 1.4, 0.25, 0.1, G_WARM);
      // Two riders' heads as lumps.
      for (const s of [-0.5, 0.5]) {
        const h = at(i, s, 1.55);
        lit.blob(h[0], h[1], h[2], 0.32, 0.36, 0.32, ramp(rgb("#d9915c"), rgb("#f5c9a0")), 0);
      }
    }
    // A halo trail along the track and bulbs on the keel.
    const halos: Halo[] = [];
    for (let i = 4; i < n; i += 8) halos.push({ x: path[i]![0], y: path[i]![1] - 0.8, z: path[i]![2], size: 6, colour: lightAt(i >> 3), alpha: 0.5, twinkle: 0.4 });
    for (let i = 0; i < n; i += 2) bulb(glow, chord[i]![0], chord[i]![1] - 0.5, chord[i]![2], 0.6, lightAt(i / 2));
    return { lit, glow, halos };
  },
};

// ─── Entrance arch ───────────────────────────────────────────────────────────

export const entranceArch: LandmarkSpec = {
  span: true,
  defaultSpan: 14,
  build(ctx) {
    const hw = ctx.halfWidth;
    const inner = hw + 5; // the gateway's clear half width
    const TX = inner + 3.5; // tower centre
    const lit = new MeshBuilder();
    const glow = new MeshBuilder();
    const halos: Halo[] = [];

    // Two decorated towers: striped shafts, galleries, onion domes, flags.
    for (const s of [-1, 1]) {
      const x = s * TX;
      lathe(lit, [[4.4, -1.5], [4.4, 0], [3.7, 1.0], [3.5, 3], [3.5, 11], [4.2, 11.4], [4.5, 12.4], [3.5, 12.8], [3.4, 13.8]], {
        at: [x, 0, 0],
        segments: 12,
        shade: (p, _i, j) => scaleRgb(j % 2 === 0 ? RED : CREAM, 0.6 + 0.4 * Math.min(1, (p[1] + 1) / 14)),
      });
      // Gallery and a pink-and-gold dome on a drum.
      lathe(lit, [[3.5, 13.6], [3.7, 14.2], [3.7, 15.4], [3.4, 16.0]], { at: [x, 0, 0], segments: 12, shade: stripes(PINK, YELLOW) });
      lathe(lit, [[3.4, 16], [4.6, 17.6], [4.2, 19.6], [2.6, 21.6], [1.1, 23.4], [0.2, 25]], {
        at: [x, 0, 0],
        segments: 12,
        shade: byHeight(16, 25, scaleRgb(PINK, 0.8), mixRgb(PINK, WHITE, 0.5)),
        caps: "top",
      });
      lit.post(x, 24.6, 0, 0.2, 4, BRASS, 6);
      lit.blob(x, 28.8, 0, 0.5, 0.5, 0.5, GOLD, 0);
      lit.tri([x, 28.4, 0], [x, 26.8, 0], [x - s * 0.1, 27.6, -2.6], RED, ORANGE, YELLOW);
      // Glowing windows on two storeys, and runs of bulbs up the corners.
      for (const y of [3.4, 7.2]) {
        for (let q = 0; q < 4; q++) {
          const th = (q / 4) * Math.PI * 2 + Math.PI / 4;
          glow.box(x + Math.sin(th) * 3.55, y + 0.9, Math.cos(th) * 3.55, 1.1, 2.0, 0.16, G_WARM, th);
          lit.box(x + Math.sin(th) * 3.5, y + 2.0, Math.cos(th) * 3.5, 1.5, 0.3, 0.3, GOLD, th);
        }
      }
      for (let q = 0; q < 6; q++) {
        const th = (q / 6) * Math.PI * 2 + 0.26;
        for (let y = 1; y <= 13; y += 1.5) bulb(glow, x + Math.sin(th) * 3.75, y, Math.cos(th) * 3.75, 0.36, lightAt(q + Math.round(y)));
      }
      for (let y = 4; y <= 22; y += 6) halos.push({ x, y, z: -4, size: 8, colour: lightAt(y), alpha: 0.5, twinkle: 0.4 });
    }

    // The arched sign: a curved lintel between the towers, letters in warm glow.
    const lo = (x: number): number => 14.2 + 1.2 * (1 - (x / inner) ** 2);
    const hi = (x: number): number => 21.2 + 1.8 * (1 - (x / inner) ** 2);
    const xs: number[] = [];
    for (let q = 0; q <= 40; q++) xs.push(-inner - 1 + ((2 * inner + 2) * q) / 40);
    const board = (z: number): V3[][] => [xs.map((x): V3 => [x, lo(x), z]), xs.map((x): V3 => [x, hi(x), z])];
    const boardShade = byHeight(14, 23, scaleRgb(NAVY, 0.9), rgb("#5a3b9c"));
    grid(lit, board(-0.9), boardShade);
    grid(lit, board(0.9), boardShade);
    grid(lit, [xs.map((x): V3 => [x, hi(x), -0.9]), xs.map((x): V3 => [x, hi(x), 0.9])], GOLD);
    grid(lit, [xs.map((x): V3 => [x, lo(x), -0.9]), xs.map((x): V3 => [x, lo(x), 0.9])], GOLD);
    // Gold trim and bulbs round the board.
    for (let q = 0; q < xs.length - 1; q++) {
      const a = xs[q]!;
      const b = xs[q + 1]!;
      lit.rod([a, lo(a) - 0.1, -1.1], [b, lo(b) - 0.1, -1.1], 0.5, GOLD);
      lit.rod([a, hi(a) + 0.1, -1.1], [b, hi(b) + 0.1, -1.1], 0.5, GOLD);
    }
    for (let q = 0; q < xs.length; q++) {
      const x = xs[q]!;
      bulb(glow, x, lo(x) + 0.6, -1.25, 0.46, lightAt(q));
      bulb(glow, x, hi(x) - 0.6, -1.25, 0.46, lightAt(q + 2));
    }
    // FUN FAIR, block letters about 3.8 m tall, alternating gold and pink, reading correctly for a driver coming from -z.
    const cell = 0.54;
    const width = 42 * cell;
    const letterColour = (i: number): Rgb => (i % 2 === 0 ? [4, 2.6, 0.7] : [4, 0.7, 2.0]);
    blockText(glow, "FUN FAIR", -width / 2, 17.2, -1.6, cell, 0.8, letterColour, false);
    lit.box(0, 19.2, -1.05, width + 1.2, 5.0, 0.3, NAVY);
    // A big star on top.
    const sy = hi(0) + 3.2;
    for (let q = 0; q < 4; q++) {
      const a = (q / 4) * Math.PI;
      glow.rod([Math.cos(a) * -3, sy + Math.sin(a) * -3, -1.2], [Math.cos(a) * 3, sy + Math.sin(a) * 3, -1.2], 0.7, q % 2 === 0 ? [4, 3, 0.8] : [4, 1, 1.6]);
    }
    glow.add(shapes.ball(0), xf(0, sy, -1.3, 1.3, 1.3, 0.5), G_WHITE);
    lit.box(0, hi(0) + 0.6, 0, 1.4, 1.4, 1.4, GOLD);
    for (let q = 0; q < 10; q++) halos.push({ x: -inner + 1.3 + q * ((2 * inner - 2.6) / 9), y: lo(0) + 1.4, z: -1.6, size: 5, colour: lightAt(q), alpha: 0.4, twinkle: 0.5 });
    halos.push({ x: 0, y: sy, z: -2, size: 13, colour: [4, 2.8, 1], alpha: 0.6, twinkle: 0.3 });
    halos.push({ x: 0, y: 19, z: -3, size: 20, colour: [3.4, 1.4, 1.6], alpha: 0.3, twinkle: 0.2 });
    return { lit, glow, halos };
  },
};
