/**
 * The volcano world's landmarks and hazards (docs/GRIP_PRIX.md, "What each theme can build").
 * Volcano Rush: black basalt, rivers and cracks of glowing lava, a smoking volcano under a red-orange sky.
 * The lava lights everything from below, so the stone is warm at the foot and the glow is used freely.
 */
import { Group, Mesh, type Material, type Object3D } from "three";
import { byHeight, grid, MeshBuilder, mixRgb, pipe, prism, ramp, rgb, rockBlob, scaleRgb, shapes, torus, tube, xf, type Rgb, type Shade, type V3 } from "./kit";
import { beam, disc, flutedPipe, hash, hazardGlass, icicle, noisyArch, puffPart, ribbon, vec } from "./snow";
import type { HazardSpec, LandmarkSpec, MovingPart } from "./types";

// ─── Palette ─────────────────────────────────────────────────────────────────

/** Lava, from white-hot to cooling crust. */
// (Kept near 1 on the strongest channel: the tone mapping washes anything much brighter out to pale peach.)
const LAVA_HOT: Rgb = [1.9, 1.3, 0.35];
const LAVA: Rgb = [1.6, 0.6, 0.1];
const LAVA_DEEP: Rgb = [1.15, 0.3, 0.05];
const LAVA_CRUST: Rgb = [0.7, 0.14, 0.04];
const GLOW_HALO: Rgb = [2.6, 0.95, 0.28];
const BASALT_LOW: Rgb = [0.08, 0.036, 0.028];
const BASALT_MID: Rgb = [0.02, 0.019, 0.025];
const BASALT_HI: Rgb = [0.085, 0.074, 0.095];

type Halo = { x: number; y: number; z: number; size: number; colour: readonly [number, number, number]; alpha: number; twinkle?: number };

/** A facet-by-facet basalt shade: warm from the lava below at the foot, cold and grey up high. */
const basaltShade = (y0: number, y1: number, seed: number): Shade => (p, i, j) => {
  const t = Math.max(0, Math.min(1, (p[1] - y0) / (y1 - y0 || 1)));
  const base = t < 0.35 ? mixRgb(BASALT_LOW, BASALT_MID, t / 0.35) : mixRgb(BASALT_MID, BASALT_HI, (t - 0.35) / 0.65);
  return scaleRgb(base, 0.78 + 0.5 * hash(i, j, seed));
};

// ─── The volcano ─────────────────────────────────────────────────────────────

const volcano: LandmarkSpec = {
  footprint: 110,
  build(ctx) {
    const lit = new MeshBuilder();
    const glow = new MeshBuilder();
    const glass = new MeshBuilder();
    const H = 141;
    const n = 22;
    const rowsY = [-8, 0, 14, 30, 48, 68, 90, 110, 126, 136, H];
    const radiusAt = (y: number) => (y <= 0 ? 134 : 22 + 112 * Math.pow(Math.max(0, 1 - y / H), 2.4));
    // The rim is notched on the front-right so the crater is lopsided and the silhouette less tidy.
    const rimDrop = (th: number) => 13 * Math.pow(Math.max(0, Math.cos(th - 0.9)), 3) + 5 * Math.pow(Math.max(0, Math.cos(th + 2.2)), 4);
    const ring: V3[][] = rowsY.map((y, i) => {
      const row: V3[] = [];
      for (let j = 0; j < n; j++) {
        const th = (j / n) * Math.PI * 2;
        // Alternate ridges and gullies, stronger low down where the flanks are eaten into.
        const ridge = (j % 2 === 0 ? 1 : -1) * (0.04 + 0.09 * (1 - Math.max(0, y) / H)) + (hash(i, j, 2) - 0.5) * 0.06 + 0.04 * Math.sin(th * 3 + i * 0.5);
        const yy = i >= rowsY.length - 2 ? y - rimDrop(th) * (i === rowsY.length - 1 ? 1 : 0.35) : y;
        const r = radiusAt(Math.min(yy + (i >= rowsY.length - 2 ? rimDrop(th) : 0), H)) * (1 + ridge);
        row.push([Math.sin(th) * r, yy, Math.cos(th) * r]);
      }
      return row;
    });
    grid(lit, ring, basaltShade(0, H, 3), true);
    // Jagged teeth along the back of the crater rim: the broken crown.
    for (let k = 0; k < 8; k++) {
      const th = 2.4 + k * 0.5;
      const rr = 21 + hash(k, 5) * 4;
      const base = H - rimDrop(th) - 2;
      const hgt = 8 + hash(k, 6) * 11;
      lit.add(shapes.cone(5), xf(Math.sin(th) * rr, base + hgt / 2, Math.cos(th) * rr, 4 + hash(k, 7) * 3, hgt, 4 + hash(k, 8) * 3, k, 0.12 * (k - 4), 0.08), ramp(BASALT_MID, BASALT_HI));
    }
    // Rubble round the foot.
    for (let k = 0; k < 18; k++) {
      const th = k * 0.35 + hash(k, 1);
      const rr = 128 + hash(k, 2) * 26;
      const s = 5 + hash(k, 3) * 9;
      rockBlob(lit, Math.sin(th) * rr, 0, Math.cos(th) * rr, s, s * 0.7, s * 0.9, basaltShade(0, 12, 4 + k), k + 11, { detail: 1, roughness: 0.25, flatBase: true });
    }
    // The rim: a glowing lip all the way round (it follows the notch), and a boiling lake inside it.
    const rimPts: V3[] = [];
    for (let j = 0; j < n * 2; j++) {
      const th = (j / (n * 2)) * Math.PI * 2;
      const r = 22.4 + 0.5 * Math.sin(th * 5);
      rimPts.push([Math.sin(th) * r, H - rimDrop(th) + 0.8, Math.cos(th) * r]);
    }
    tube(glow, rimPts, { radius: 1.5, sides: 5, closed: true, shade: (_p, i) => (hash(i, 4) > 0.5 ? LAVA_HOT : LAVA) });
    disc(glow, [0, H - 14, 0], 19, "y", 18, LAVA_HOT, LAVA, 1, 0.2);
    // A fire fountain above the crater: a column of glowing cones and blobs.
    glow.add(shapes.cone(7), xf(0, H + 10, 0, 7, 26, 7), ramp(LAVA, LAVA_HOT));
    glow.add(shapes.cone(7), xf(2, H + 6, -1, 11, 14, 11), ramp(LAVA_DEEP, LAVA));
    for (let k = 0; k < 16; k++) {
      const a = k * 2.4;
      const u = hash(k, 9);
      glow.blob(Math.cos(a) * (6 + u * 22), H + 8 + u * 42 + (k % 3) * 6, Math.sin(a) * (6 + u * 22), 1.4 + hash(k, 4) * 2.4, 1.4 + hash(k, 5) * 2.4, 1.4 + hash(k, 6) * 2.4, hash(k, 3) > 0.4 ? LAVA : LAVA_HOT, 0);
    }
    // Rivers of lava down the flanks: bright zigzag strips from the rim, forking and cooling as they go.
    const sample = (iF: number, th: number): V3 => {
      const i0 = Math.max(0, Math.min(rowsY.length - 2, Math.floor(iF)));
      const ti = iF - i0;
      const u = ((th / (Math.PI * 2)) % 1 + 1) % 1;
      const jf = u * n;
      const j0 = Math.floor(jf) % n;
      const j1 = (j0 + 1) % n;
      const tj = jf - Math.floor(jf);
      const a = vec.lerp(ring[i0]![j0]!, ring[i0]![j1]!, tj);
      const c = vec.lerp(ring[i0 + 1]![j0]!, ring[i0 + 1]![j1]!, tj);
      return vec.lerp(a, c, ti);
    };
    const streaks: { th: number; end: number; w: number }[] = [
      { th: -1.45, end: 2.3, w: 3.0 },
      { th: -1.0, end: 1.5, w: 2.4 },
      { th: -0.45, end: 1.1, w: 3.2 },
      { th: 0.05, end: 2.9, w: 4.2 },
      { th: 0.5, end: 1.7, w: 2.6 },
      { th: 1.0, end: 2.4, w: 3.4 },
      { th: 1.55, end: 1.2, w: 2.2 },
      { th: 2.3, end: 1.8, w: 3 },
      { th: -2.2, end: 1.6, w: 3 },
    ];
    streaks.forEach((sk, si) => {
      const pts: V3[] = [];
      const widths: number[] = [];
      const steps = 24;
      const iMax = rowsY.length - 1.02;
      for (let k = 0; k <= steps; k++) {
        const u = k / steps;
        const iF = iMax - u * (iMax - sk.end);
        const th = sk.th + Math.sin(u * 9 + si * 1.7) * 0.05 * (1 + u) + (hash(k, si, 4) - 0.5) * 0.015;
        const p = sample(iF, th);
        const outward = vec.norm([p[0], 0.5, p[2]]);
        pts.push(vec.add(p, vec.mul(outward, 1.4)));
        widths.push(sk.w * 0.72 * (0.55 + 0.9 * Math.sin(Math.PI * Math.min(1, u * 1.1 + 0.1)) + 0.25 * u));
      }
      ribbon(glow, pts, (i) => widths[i]! / 2, (i) => vec.norm([pts[i]![0], 0.6, pts[i]![2]]), (i) => {
        const u = i / steps;
        return u < 0.25 ? mixRgb(LAVA_HOT, LAVA, u / 0.25) : u < 0.7 ? mixRgb(LAVA, LAVA_DEEP, (u - 0.25) / 0.45) : mixRgb(LAVA_DEEP, LAVA_CRUST, (u - 0.7) / 0.3);
      });
      // A glowing tongue where the streak meets the plain, for the longer ones.
      if (sk.end < 1.6) {
        const p = sample(sk.end, sk.th);
        const out = vec.norm([p[0], 0, p[2]]);
        const p0: V3 = [p[0] + out[0] * 2, 0.45, p[2] + out[2] * 2];
        const q: V3 = [p0[0] + out[0] * 40, 0.4, p0[2] + out[2] * 40];
        ribbon(glow, [p0, vec.lerp(p0, q, 0.5), q], (i) => (i === 0 ? sk.w * 0.5 : i === 1 ? sk.w * 0.85 : sk.w * 0.3), [0, 1, 0], (i) => (i === 0 ? LAVA : i === 1 ? LAVA_DEEP : LAVA_CRUST));
      }
    });
    // Bombs thrown up from the crater, arcing out and falling back on a loop.
    const moving: MovingPart[] = [];
    for (let k = 0; k < 5; k++) {
      const g = new MeshBuilder();
      g.blob(0, H + 2, 0, 2.2, 2.2, 2.2, LAVA_HOT, 0);
      g.blob(0, H + 2, 0, 3.2, 3.2, 3.2, LAVA, 0);
      const ang = k * 1.7 + 0.4;
      const vx = Math.cos(ang) * (22 + k * 4);
      const vz = Math.sin(ang) * (22 + k * 4);
      const period = 4.5 + k * 0.7;
      moving.push({
        glow: g,
        pivot: [0, H + 2, 0],
        update(t: number, part: Object3D) {
          const u = (((t / period + k * 0.37) % 1) + 1) % 1;
          part.position.set(vx * u, 62 * 4 * u * (1 - u) * 0.5, vz * u);
          part.scale.setScalar(0.4 + 0.6 * Math.sin(Math.PI * u));
        },
      });
    }
    // The smoke plume: dark, red-lit puffs rolling up from the crater and leaning off downwind.
    const PUFF = [rgb("#4b2f31"), rgb("#5a3a38"), rgb("#3c2a30")];
    for (let k = 0; k < 9; k++) {
      const g = new MeshBuilder();
      const r = 15 + hash(k, 1) * 8;
      g.blob(0, H + 14, 0, r, r * 0.8, r, ramp(scaleRgb(PUFF[k % 3]!, 0.8), scaleRgb(PUFF[k % 3]!, 1.5)), 1);
      g.blob(r * 0.6, H + 14 + r * 0.2, r * 0.2, r * 0.7, r * 0.6, r * 0.7, scaleRgb(PUFF[(k + 1) % 3]!, 1.2), 1);
      moving.push(puffPart(g, [0, H + 14, 0], k / 9, 26, 95, [70, 0, -34], 2.6));
    }
    // Embers drifting about, as soft halos; a big glow over the crater and low red ones on the flanks.
    const halos: Halo[] = [
      { x: 0, y: H + 22, z: 0, size: 120, colour: GLOW_HALO, alpha: 0.5, twinkle: 0.1 },
      { x: 0, y: H + 4, z: 8, size: 60, colour: [3.4, 1.5, 0.4], alpha: 0.55, twinkle: 0.2 },
    ];
    for (let k = 0; k < 10; k++) {
      const a = k * 2.1;
      halos.push({ x: Math.cos(a) * (14 + hash(k, 1) * 40), y: H + 24 + hash(k, 2) * 70, z: Math.sin(a) * (14 + hash(k, 3) * 30), size: 6 + hash(k, 4) * 8, colour: [3.2, 1.4, 0.35], alpha: 0.7, twinkle: 0.7 });
    }
    for (const sk of streaks.slice(1, 7)) {
      const p = sample(2.5, sk.th);
      halos.push({ x: p[0] * 1.05, y: p[1] + 6, z: p[2] * 1.05, size: 46, colour: [2.5, 0.8, 0.2], alpha: 0.28, twinkle: 0.2 });
    }
    void ctx;
    return { lit, glow, glass, moving, halos };
  },
};

// ─── Lava fall ───────────────────────────────────────────────────────────────

/** A six-sided column of basalt: walls graded from foot to top, and a lighter flat top. */
function hexColumn(b: MeshBuilder, cx: number, cz: number, r: number, y0: number, y1: number, yaw: number, wall: Shade, top: Rgb): void {
  const poly: [number, number][] = [];
  for (let k = 0; k < 6; k++) {
    const a = yaw + (k / 6) * Math.PI * 2;
    poly.push([cx + Math.sin(a) * r, cz + Math.cos(a) * r]);
  }
  prism(b, poly, y0, y1, wall, { top: false });
  const c: V3 = [cx, y1, cz];
  for (let k = 0; k < 6; k++) {
    const p = poly[k]!;
    const q = poly[(k + 1) % 6]!;
    b.tri(c, [q[0], y1, q[1]], [p[0], y1, p[1]], top, scaleRgb(top, 0.85), scaleRgb(top, 0.85));
  }
}

const lavaFall: LandmarkSpec = {
  footprint: 30,
  build() {
    const lit = new MeshBuilder();
    const glow = new MeshBuilder();
    const glass = new MeshBuilder();
    const moving: MovingPart[] = [];
    // The cliff: three rows of hexagonal columns standing shoulder to shoulder, lower toward the edges.
    const rad = 3.45;
    const dx = 6.24;
    const dz = 5.4;
    const hTop = (x: number, row: number, k: number) => (row === 0 ? 44 : row === 1 ? 39 : 33) - Math.abs(x) * 0.34 + (hash(k, row, 5) - 0.5) * 6;
    let kc = 0;
    for (let row = 0; row < 3; row++) {
      const z = -14 + row * dz;
      for (let i = -5; i <= 5; i++) {
        const x = i * dx + (row % 2) * (dx / 2);
        if (row === 2 && Math.abs(x) < 7.4) continue; // the front of the chute is its own block
        if (Math.abs(x) > 34) continue;
        const h = hTop(x, row, kc++);
        hexColumn(lit, x, z, rad, -2, h, 0, basaltShade(-2, 46, 10 + row), mixRgb(rgb("#4d4856"), rgb("#6a6574"), hash(kc, 2)));
      }
    }
    // The chute: a sloping block with the fall pouring over its lip.
    const prof: [number, number][] = [[-16, -2], [-16, 36], [0.5, 36], [4.2, -2]];
    for (const [x0, x1] of [[-6.4, 6.4]] as const) {
      grid(lit, [prof.map(([z, y]): V3 => [x0, y, z]), prof.map(([z, y]): V3 => [x1, y, z])], byHeight(-2, 36, scaleRgb(BASALT_LOW, 1.3), BASALT_MID));
    }
    // The sheet of lava: broad strips, brightest in the middle, with streaks of different heat.
    const topY = 36.1;
    const botY = 0.6;
    const zTop = 0.95;
    const zBot = 4.9;
    const sheet = (u: number, x: number): V3 => [x * (0.8 + 0.2 * u), topY + (botY - topY) * u, zTop + (zBot - zTop) * u];
    const cols = [-6, -3.6, -1.4, 0, 1.4, 3.6, 6];
    const rows: V3[][] = [];
    for (let i = 0; i <= 12; i++) rows.push(cols.map((x) => sheet(i / 12, x)));
    grid(glow, rows, (p, i, j) => {
      const centre = 1 - Math.abs(j - 3) / 3.2;
      const heat = Math.max(0, Math.min(1, centre * 0.8 + 0.25 * hash(i, j, 9) + (1 - i / 12) * 0.3));
      return mixRgb(LAVA_DEEP, LAVA, heat);
    });
    // Streaks of brighter lava that slide down the sheet and start again at the lip.
    const slope = (zBot - zTop) / (topY - botY);
    for (let k = 0; k < 9; k++) {
      const g = new MeshBuilder();
      const x = -5 + (k / 8) * 10 + (hash(k, 1) - 0.5) * 0.8;
      const len = 5 + hash(k, 2) * 5;
      const w = 0.5 + hash(k, 3) * 0.55;
      const a = sheet(0, x);
      const c = sheet(len / (topY - botY), x);
      g.quad([a[0] - w, a[1], a[2] + 0.2], [a[0] + w, a[1], a[2] + 0.2], [c[0] + w, c[1], c[2] + 0.2], [c[0] - w, c[1], c[2] + 0.2], LAVA_HOT, LAVA_HOT, [3.6, 2.2, 0.5], [3.6, 2.2, 0.5]);
      const period = 3.2 + hash(k, 4) * 1.8;
      const phase = hash(k, 5);
      moving.push({
        glow: g,
        pivot: [a[0], a[1], a[2]],
        update(t: number, part: Object3D) {
          const u = (((t / period + phase) % 1) + 1) % 1;
          const d = u * (topY - botY + len);
          part.position.set(0, -d, d * slope);
          part.scale.y = Math.min(1, u * 8);
        },
      });
    }
    // Glowing lip, and lava spilling over the black columns beside the chute.
    glow.quad([-6.4, 36.15, -0.2], [6.4, 36.15, -0.2], [6.4, 36.15, 1.2], [-6.4, 36.15, 1.2], LAVA_HOT);
    // The pool at the foot, a crusted skin of black plates on a glowing surface.
    const poolC: V3 = [0, 0.35, 13];
    const pts: V3[] = [];
    for (let k = 0; k < 20; k++) {
      const a = (k / 20) * Math.PI * 2;
      const rr = 1 + 0.1 * Math.sin(a * 3 + 1);
      pts.push([Math.cos(a) * 17 * rr, 0.35, 13 + Math.sin(a) * 12 * rr]);
    }
    for (let k = 0; k < 20; k++) {
      const p = pts[k]!;
      const q = pts[(k + 1) % 20]!;
      const edgeA = mixRgb(LAVA_DEEP, LAVA_CRUST, 0.4 + 0.4 * hash(k, 1));
      const edgeB = mixRgb(LAVA_DEEP, LAVA_CRUST, 0.4 + 0.4 * hash(k + 1, 1));
      glow.tri(poolC, p, q, mixRgb(LAVA_HOT, LAVA, 0.3), edgeA, edgeB);
    }
    for (let k = 0; k < 10; k++) {
      const a = k * 2.2;
      const rr = 3 + hash(k, 3) * 11;
      lit.add(shapes.cylinder(6), xf(Math.cos(a) * rr, 0.5, 13 + Math.sin(a) * rr * 0.7, 1.4 + hash(k, 4) * 1.6, 0.18, 1.2 + hash(k, 5) * 1.2, a), rgb("#1e1b22"));
    }
    // Rocky outcrops round the pool and at the foot of the cliff.
    for (let k = 0; k < 14; k++) {
      const a = k * 0.55 + 0.1;
      const front = Math.sin(a) > -0.1;
      const rr = front ? 18 + hash(k, 1) * 3 : 0;
      const ox = front ? Math.cos(a) * rr * 1.1 : (k - 7) * 8;
      const oz = front ? 13 + Math.sin(a) * rr * 0.78 : -2 + hash(k, 2) * 4;
      const s = 2.4 + hash(k, 3) * 3.4;
      rockBlob(lit, ox, 0, oz, s, s * 0.8, s, basaltShade(0, 7, 20 + k), k + 3, { detail: 1, roughness: 0.25, flatBase: true });
    }
    // Steam rising off the pool.
    for (let k = 0; k < 3; k++) {
      const g = new MeshBuilder();
      for (let i = 0; i < 4; i++) g.blob((k - 1) * 6 + (hash(k, i, 2) - 0.5) * 1.6, 2 + i * 1.4, 12 + (hash(k, i, 3) - 0.5) * 1.6, 1.1 + i * 0.35, 0.9 + i * 0.25, 1.1 + i * 0.35, [1.5, 1.4, 1.3], 0);
      moving.push(puffPart(g, [(k - 1) * 6, 2, 12], k / 3, 6, 18, [3, 0, 3], 1.3));
    }
    const halos: Halo[] = [
      { x: 0, y: 6, z: 11, size: 52, colour: GLOW_HALO, alpha: 0.45, twinkle: 0.12 },
      { x: 0, y: 18, z: 6, size: 34, colour: [3.0, 1.2, 0.3], alpha: 0.32, twinkle: 0.15 },
      { x: 0, y: 37, z: 3, size: 26, colour: [3.2, 1.6, 0.4], alpha: 0.45, twinkle: 0.2 },
    ];
    for (let k = 0; k < 6; k++) halos.push({ x: (hash(k, 1) - 0.5) * 30, y: 8 + hash(k, 2) * 36, z: 8 + hash(k, 3) * 10, size: 4 + hash(k, 4) * 4, colour: [3.2, 1.4, 0.35], alpha: 0.7, twinkle: 0.7 });
    return { lit, glow, glass, moving, halos };
  },
};

// ─── Basalt columns ──────────────────────────────────────────────────────────

const basaltColumns: LandmarkSpec = {
  footprint: 26,
  build(ctx) {
    const lit = new MeshBuilder();
    const glow = new MeshBuilder();
    const rad = 2.98;
    const pitch = 5.5;
    // Lava shows in the gaps between the columns: a glowing floor beneath them all.
    disc(glow, [0, 0.12, 0], 20, "y", 20, LAVA_DEEP, LAVA_CRUST);
    // A hexagonal tiling, tall in the middle and stepping down to the road side, like the Giant's Causeway.
    const R = 24;
    for (let q = -6; q <= 6; q++) {
      for (let r = -6; r <= 6; r++) {
        const x = pitch * (q + r / 2);
        const z = pitch * (r * 0.866);
        const d = Math.hypot(x, z + 3);
        if (d > R || (d > R - 6 && hash(q, r, 1) > 0.55)) continue;
        const frontFade = z > 0 ? 1 + z * 0.045 : 1;
        const h = Math.max(3.5, (24 - d * 0.78) * (0.8 + 0.4 * hash(q, r, 2)) / frontFade + (hash(q, r, 3) - 0.5) * 5);
        const col = hash(q, r, 4);
        hexColumn(lit, x, z, rad, -1.5, h, Math.PI / 6, basaltShade(-1, 26, 30), mixRgb(rgb("#4b4a58"), rgb("#7a7684"), col));
        // The odd glowing crack running down a column, set a hair proud of the wall.
        if (hash(q, r, 5) > 0.72 && h > 7) {
          const a = Math.PI / 6 + (Math.floor(hash(q, r, 6) * 6) / 6) * Math.PI * 2 + Math.PI / 6;
          const fx = x + Math.sin(a) * (rad * 0.866 + 0.1);
          const fz = z + Math.cos(a) * (rad * 0.866 + 0.1);
          const nrm: V3 = [Math.sin(a), 0, Math.cos(a)];
          ribbon(glow, [[fx, 0.6, fz], [fx + nrm[2] * 0.3, h * 0.35, fz - nrm[0] * 0.3], [fx - nrm[2] * 0.2, h * 0.7, fz + nrm[0] * 0.2], [fx, h - 0.4, fz]], 0.16, nrm, (i) => (i < 2 ? LAVA : LAVA_HOT));
        }
      }
    }
    // A broken column lying on its side in front, one end splintered and glowing.
    const a0: V3 = [-8, 2.7, 22];
    const a1: V3 = [5, 2.7, 25];
    pipe(lit, a0, a1, 2.9, byHeight(0, 6, scaleRgb(BASALT_LOW, 1.5), rgb("#585362")), 6);
    lit.add(shapes.cone(6), xf(a1[0] + 1.3, 2.7, a1[2] + 0.2, 2.9, 2.6, 2.9, 0, 0, -Math.PI / 2), rgb("#3a3742"));
    glow.add(shapes.cone(6), xf(a1[0] + 1.35, 2.7, a1[2] + 0.2, 1.5, 2.4, 1.5, 0, 0, -Math.PI / 2), LAVA);
    for (let k = 0; k < 6; k++) rockBlob(lit, -12 + k * 3.4, 0, 21 + hash(k, 1) * 6 - (k % 2) * 4, 1.3 + hash(k, 2), 0.9, 1.2, basaltShade(0, 3, 40 + k), k + 6, { detail: 0, roughness: 0.3, flatBase: true });
    const halos: Halo[] = [
      { x: 0, y: 3, z: 8, size: 50, colour: GLOW_HALO, alpha: 0.28, twinkle: 0.12 },
      { x: 0, y: 10, z: 0, size: 70, colour: [2.4, 0.8, 0.25], alpha: 0.18, twinkle: 0.1 },
    ];
    void ctx;
    return { lit, glow, halos };
  },
};

// ─── Stone bridge ────────────────────────────────────────────────────────────

const STONE_HI: Rgb = [0.5, 0.42, 0.4];
const STONE_LO: Rgb = [0.13, 0.1, 0.11];

const stoneBridge: LandmarkSpec = {
  span: true,
  defaultSpan: 60,
  build(ctx) {
    const lit = new MeshBuilder();
    const glow = new MeshBuilder();
    const hw = ctx.halfWidth;
    const half = ctx.span / 2;
    const xe = hw + 1; // the deck overhangs the road by a metre either side
    const deckTop = -0.07;
    const deckBot = -1.6;
    // Stone is lit orange from the lava below: warm and bright at the bottom, a cold brown-grey up at the deck.
    const stoneAt = (y: number, f = 1): Rgb => scaleRgb(mixRgb([1.1, 0.42, 0.18], STONE_HI, Math.max(0, Math.min(1, (y + 14) / 12))), f);
    // The deck: a thick slab under the road, with a carved band along each outer edge and corbels beneath it.
    lit.box(0, (deckTop + deckBot) / 2, 0, xe * 2, deckTop - deckBot, ctx.span, ramp(scaleRgb(STONE_HI, 0.6), STONE_HI));
    for (const s of [-1, 1]) {
      lit.box(s * (xe + 0.16), -0.85, 0, 0.3, 1.1, ctx.span, ramp(scaleRgb(STONE_HI, 0.8), scaleRgb(STONE_HI, 1.25)));
      lit.box(s * (xe + 0.3), -1.7, 0, 0.6, 0.3, ctx.span, scaleRgb(STONE_HI, 0.7));
      for (let z = -half + 2; z < half - 1; z += 3) lit.box(s * (xe + 0.2), -2.1, z, 0.5, 0.7, 1.0, scaleRgb(STONE_HI, 0.9)); // corbel blocks
    }
    // Three arches with two piers between and an abutment at each end.
    const abut = 4;
    const pier = 4.2;
    const W = (ctx.span - 2 * abut - 2 * pier) / 3;
    const spring = -10.5;
    const rIn = W / 2;
    const rOut = rIn + 1.6;
    const centres = [-1, 0, 1].map((k) => k * (W + pier));
    // Abutments and piers: blocks down into the lava with courses of lighter stone.
    const piers = [(centres[0]! + centres[1]!) / 2, (centres[1]! + centres[2]!) / 2];
    const blocks: [number, number][] = [[-half, -half + abut], [half - abut, half]];
    for (const pz of piers) blocks.push([pz - pier / 2, pz + pier / 2]);
    for (const [z0, z1] of blocks) {
      const zc = (z0 + z1) / 2;
      const zl = z1 - z0;
      lit.box(0, (-14.5 + deckBot) / 2, zc, xe * 2 - 0.2, deckBot + 14.5, zl, ramp([1.2, 0.45, 0.18], scaleRgb(STONE_HI, 0.85)));
      // Courses of lighter stone round the pier.
      for (let y = -12; y < -2; y += 2.4) lit.box(0, y, zc, xe * 2 + 0.25, 0.22, zl + 0.2, stoneAt(y, 0.85));
    }
    // The arch rings: curved bands on both faces (voussoirs in two tones), a keystone at each crown, and a soffit under the deck.
    const arcN = 16;
    for (const cz of centres) {
      const inner: V3[] = [];
      const outer: V3[] = [];
      for (let k = 0; k <= arcN; k++) {
        const a = Math.PI - (k / arcN) * Math.PI;
        inner.push([0, spring + Math.sin(a) * rIn, cz + Math.cos(a) * rIn]);
        outer.push([0, spring + Math.sin(a) * rOut, cz + Math.cos(a) * rOut]);
      }
      for (const s of [-1, 1]) {
        const x = s * (xe + 0.08);
        const col: Shade = (_p, _i, j) => stoneAt(spring + 4, j % 2 === 0 ? 1.0 : 0.72);
        grid(lit, [inner.map(([, y, z]): V3 => [x, y, z]), outer.map(([, y, z]): V3 => [x, y, z])], col);
        // The wall of stone above the ring up to the deck, a stepped face between the piers.
        const top = outer.map(([, , z]): V3 => [x - s * 0.05, deckBot + 0.02, z]);
        grid(lit, [outer.map(([, y, z]): V3 => [x - s * 0.05, y, z]), top], (p) => stoneAt(p[1], 0.9));
        lit.box(x + s * 0.12, spring + rOut, cz, 0.5, 1.0, 1.7, stoneAt(spring + rOut, 1.25));
      }
      // The soffit: the underside of the arch, lit by the lava (warm at the springing, darker at the crown).
      grid(lit, [inner.map(([, y, z]): V3 => [-xe, y, z]), inner.map(([, y, z]): V3 => [xe, y, z])], (p) => stoneAt(p[1] - 1.5, 1.1));
    }
    // The lava river below: a glowing plane with ripples of brighter and darker lava running along the flow.
    const planeY = -9;
    const zr = half + 30;
    const xr = hw + 26;
    const bands = 56;
    for (let k = 0; k < bands; k++) {
      const z0 = -zr + (k / bands) * zr * 2;
      const z1 = -zr + ((k + 1) / bands) * zr * 2;
      const t = hash(k, 1);
      const col: Rgb = t > 0.88 ? LAVA_HOT : t > 0.35 ? LAVA : LAVA_DEEP;
      glow.quad([-xr, planeY, z0], [xr, planeY, z0], [xr, planeY, z1], [-xr, planeY, z1], scaleRgb(col, 0.85), col, scaleRgb(col, 1.05), scaleRgb(col, 0.9));
    }
    // Dark crust plates drifting on it.
    for (let k = 0; k < 16; k++) {
      const x = (hash(k, 2) - 0.5) * 2 * xr * 0.9;
      const z = (hash(k, 3) - 0.5) * 2 * zr * 0.9;
      lit.add(shapes.cylinder(6), xf(x, planeY + 0.12, z, 2 + hash(k, 4) * 3, 0.2, 1.5 + hash(k, 5) * 2.4, k), rgb("#231e24"));
    }
    const halos: Halo[] = centres.map((cz) => ({ x: 0, y: -6, z: cz, size: 34, colour: GLOW_HALO, alpha: 0.36, twinkle: 0.12 }));
    halos.push({ x: -xe - 8, y: -6, z: 0, size: 26, colour: GLOW_HALO, alpha: 0.28, twinkle: 0.12 }, { x: xe + 8, y: -6, z: 0, size: 26, colour: GLOW_HALO, alpha: 0.28, twinkle: 0.12 });
    return { lit, glow, halos };
  },
};

// ─── Obsidian arch ───────────────────────────────────────────────────────────

const obsidianArch: LandmarkSpec = {
  span: true,
  defaultSpan: 26,
  build(ctx) {
    const lit = new MeshBuilder();
    const glow = new MeshBuilder();
    const hw = Math.max(13, ctx.halfWidth + 6);
    const top = 15.5;
    const legs = 3.5;
    const half = ctx.span / 2;
    const thick = (t: number) => 3 + 2.4 * Math.sin(Math.PI * t);
    // Glassy black: mostly very dark with the odd facet catching the light brightly.
    const glass: Shade = (p, i, j) => {
      const v = hash(i, j, 7);
      const spark = Math.pow(v, 14);
      const base = mixRgb([0.0012, 0.0012, 0.0025], [0.008, 0.006, 0.012], Math.max(0, Math.min(1, p[1] / 22)));
      return mixRgb(base, [0.4, 0.17, 0.08], spark);
    };
    noisyArch(lit, { halfIn: hw, topIn: top, legs, thick: (t) => thick(t), z0: -half, z1: half, steps: Math.max(4, Math.round(ctx.span / 5)), arcSteps: 10, rough: 1.1, seed: 12, skirt: 3, inner: glass, outer: glass });
    // Glowing veins: seams that follow the arch round the inside, and a zigzag along each face.
    const z0s = [-half * 0.7, -half * 0.25, half * 0.25, half * 0.7];
    z0s.forEach((z, zi) => {
      const pts: V3[] = [];
      for (let k = 1; k < 16; k++) {
        const a = Math.PI - (k / 16) * Math.PI;
        const wob = (k % 2 === 0 ? 1 : -1) * 0.35;
        pts.push([Math.cos(a) * (hw - 0.45), legs + Math.sin(a) * (top - legs) - 0.45, z + wob + (hash(k, zi) - 0.5) * 0.5]);
      }
      ribbon(glow, pts, 0.24, (i) => {
        const a = Math.PI - ((i + 1) / 16) * Math.PI;
        return [-Math.cos(a), -Math.sin(a), 0];
      }, (i) => (i % 3 === 0 ? LAVA : LAVA_DEEP));
    });
    for (const s of [-1, 1]) {
      const pts: V3[] = [];
      for (let k = 0; k <= 20; k++) {
        const t = k / 20;
        const a = Math.PI - t * Math.PI;
        const th = thick(t);
        const rx = hw + th * 0.5 + (k % 2 === 0 ? 0.5 : -0.5);
        const ry = legs + (top - legs) + th * 0.5 + (k % 2 === 0 ? 0.4 : -0.4);
        pts.push([Math.cos(a) * rx, k < 2 ? 1 + k * 3 : Math.max(2, legs + Math.sin(a) * ry), s * (half + 0.12)]);
      }
      ribbon(glow, pts, 0.28, [0, 0, s], (i) => (i % 2 === 0 ? LAVA_HOT : LAVA));
    }
    // Shards of volcanic glass standing on the crown, tilted, with bright tips.
    for (let k = 0; k < 9; k++) {
      const t = 0.2 + (k / 8) * 0.6;
      const a = Math.PI - t * Math.PI;
      const th = thick(t);
      const x = Math.cos(a) * (hw + th * 0.5);
      const y = legs + Math.sin(a) * (top - legs + th * 0.9) - 0.5;
      const h = 4 + hash(k, 1) * 6;
      lit.add(shapes.cone(4), xf(x, y + h / 2, (hash(k, 2) - 0.5) * half, 0.9 + hash(k, 3) * 0.8, h, 0.9, k, 0.3 * Math.cos(a), -0.35 * Math.cos(a)), ramp([0.04, 0.03, 0.06], [0.9, 0.8, 1.1]));
    }
    // Rubble of black glass at the feet.
    for (const s of [-1, 1]) for (let k = 0; k < 4; k++) rockBlob(lit, s * (hw + 4 + k * 2.2), 0, (hash(k, s + 3) - 0.5) * half * 1.4, 2.4, 1.8, 2.2, glass, k + s * 5, { detail: 0, roughness: 0.3, flatBase: true });
    const halos: Halo[] = [
      { x: 0, y: top + 1, z: 0, size: 30, colour: [3.0, 0.95, 0.3], alpha: 0.5, twinkle: 0.2 },
      { x: -hw + 2, y: 6, z: 0, size: 14, colour: GLOW_HALO, alpha: 0.28, twinkle: 0.15 },
      { x: hw - 2, y: 6, z: 0, size: 14, colour: GLOW_HALO, alpha: 0.28, twinkle: 0.15 },
    ];
    return { lit, glow, halos };
  },
};

// ─── Hot spring ──────────────────────────────────────────────────────────────

/** A wisp of steam: a loose stack of soft puffs, wider as it rises. */
function steamWisp(g: MeshBuilder, seed: number, ox: number, oy: number, oz: number): void {
  for (let i = 0; i < 4; i++) {
    const r = 0.8 + i * 0.28 + hash(seed, i, 1) * 0.3;
    g.blob(ox + (hash(seed, i, 2) - 0.5) * 1.0, oy + i * 1.1, oz + (hash(seed, i, 3) - 0.5) * 1.0, r, r * 0.7, r, [1.7, 1.6, 1.5], 0);
  }
}

const hotSpring: LandmarkSpec = {
  footprint: 17,
  build() {
    const lit = new MeshBuilder();
    const glow = new MeshBuilder();
    const glass = new MeshBuilder();
    const rock: Shade = basaltShade(0, 5, 50);
    const R = 10.6;
    // Water: a glowing teal bed with a lighter centre, and a translucent skin over it.
    const wy = 0.62;
    disc(glow, [0, wy - 0.12, 0], R, "y", 24, [0.9, 2.5, 2.1], [0.12, 0.85, 0.75]);
    disc(glass, [0, wy + 0.04, 0], R, "y", 24, rgb("#4fe0c8"), rgb("#1f9fa0"));
    disc(glow, [0.5, wy + 0.0, 0], 4.2, "y", 14, [1.6, 3.4, 2.8], [0.5, 1.6, 1.4]);
    // A rim of black rock, stepped: low at the front, rising in terraces behind.
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const back = Math.max(0, -Math.cos(a)); // 1 at the back (-z), 0 at the front
      const rr = R + 0.9 + hash(k, 1) * 0.8;
      const sx = 3.2 + hash(k, 2) * 1.4;
      const sy = 1.0 + 2.4 * back + hash(k, 3) * 0.8;
      rockBlob(lit, Math.sin(a) * rr, 0, Math.cos(a) * rr, sx, sy, 3.0, rock, k + 1, { detail: 1, roughness: 0.2, flatBase: true, yaw: a });
    }
    for (let k = 0; k < 9; k++) {
      const a = Math.PI + (k / 8 - 0.5) * 2.6;
      const rr = R + 5.2 + hash(k, 4) * 1.2;
      rockBlob(lit, Math.sin(a) * rr, 0, Math.cos(a) * rr, 3.6, 2.6 + hash(k, 5) * 2.2, 3.2, rock, k + 20, { detail: 1, roughness: 0.22, flatBase: true, yaw: a });
    }
    // Flat stepping stones at the front, with pale mineral crusts where the water has run over the lip.
    for (let k = 0; k < 4; k++) {
      const x = (k - 1.5) * 4.2;
      lit.add(shapes.cylinder(7), xf(x, 0.25 + (k % 2) * 0.1, R + 4.6 + (k % 2) * 1.6, 2.1, 0.5, 2.0, k), ramp(scaleRgb(BASALT_LOW, 1.5), BASALT_HI));
    }
    for (let k = 0; k < 5; k++) {
      const a = 0.4 + k * 0.5;
      lit.add(shapes.cylinder(8), xf(Math.sin(a) * (R + 0.6), 0.9, Math.cos(a) * (R + 0.6), 1.6, 0.22, 1.3, a), rgb("#c9d8c0"));
    }
    // Moss on the rocks.
    const MOSS = rgb("#4f8a3a");
    for (let k = 0; k < 11; k++) {
      const a = k * 0.58 + 0.3;
      const rr = R + 1 + hash(k, 6) * 3;
      const back = Math.max(0, -Math.cos(a));
      lit.blob(Math.sin(a) * rr, 1.2 + 2 * back, Math.cos(a) * rr, 1.4 + hash(k, 7), 0.55, 1.2 + hash(k, 8) * 0.8, ramp(scaleRgb(MOSS, 0.6), MOSS), 0, a);
    }
    // A wooden bench and a striped towel, at the front right.
    const bx = -9;
    const bz = R + 3.4;
    lit.add(shapes.cylinder(7), xf(bx, 0.2, bz, 3.3, 0.4, 2.6), ramp(scaleRgb(BASALT_LOW, 1.5), BASALT_HI));
    const WOOD = rgb("#a66e3c");
    lit.box(bx, 1.35, bz, 3.0, 0.2, 0.9, WOOD);
    lit.box(bx, 2.0, bz - 0.5, 3.0, 0.22, 0.9, WOOD, 0, -0.35);
    for (const s of [-1, 1]) {
      lit.box(bx + s * 1.3, 0.75, bz, 0.22, 1.1, 0.7, rgb("#5b3a22"));
      lit.box(bx + s * 1.4, 1.3, bz - 0.4, 0.2, 1.5, 0.2, rgb("#5b3a22"));
    }
    for (let k = 0; k < 4; k++) lit.box(bx - 0.9 + k * 0.6, 1.62, bz + 0.0, 0.5, 0.06, 0.88, k % 2 === 0 ? rgb("#e8554a") : rgb("#f5f1e6"));
    lit.box(bx, 2.05, bz - 0.85, 2.4, 1.4, 0.12, rgb("#f5f1e6"), 0, -0.35);
    for (let k = 0; k < 3; k++) lit.box(bx, 2.0 - k * 0.35 + 0.3, bz - 0.9 - k * 0.0, 2.42, 0.2, 0.14, rgb("#e8554a"), 0, -0.35);
    lit.add(shapes.cylinder(6), xf(bx + 4.6, 0.12, bz + 0.6, 0.5, 0.25, 0.3), rgb("#f5f1e6")); // a pair of slippers
    lit.add(shapes.cylinder(6), xf(bx + 5.3, 0.12, bz + 0.9, 0.5, 0.25, 0.3), rgb("#f5f1e6"));
    // Steam: translucent wisps rising from the water and thinning out.
    const moving: MovingPart[] = [];
    for (let k = 0; k < 7; k++) {
      const g = new MeshBuilder();
      const a = k * 0.95;
      steamWisp(g, k, Math.sin(a) * 5.5, 1.0, Math.cos(a) * 5);
      moving.push(puffPart(g, [Math.sin(a) * 5.5, 1.0, Math.cos(a) * 5], k / 7, 6 + (k % 3), 12, [1.2 * Math.sin(a), 0, 1.2 * Math.cos(a)], 1.2));
    }
    const halos: Halo[] = [
      { x: 0, y: 1.4, z: 0, size: 38, colour: [0.35, 1.8, 1.5], alpha: 0.38, twinkle: 0.1 },
      { x: 0, y: 5, z: -6, size: 24, colour: [1.8, 0.8, 0.3], alpha: 0.2, twinkle: 0.1 },
    ];
    return { lit, glow, glass, moving, halos };
  },
};

// ─── Hazards ─────────────────────────────────────────────────────────────────

const meshOf = (b: MeshBuilder, mat: Material): Mesh => new Mesh(b.build(), mat);

/** A fireball that leaps out of a lava splash: a white-hot core in a jacket of flame spikes, with a tail below it. */
const fireball: HazardSpec = {
  build(ctx) {
    const root = new Group();
    // Fireball colours stay nearer 1 than the landmarks' lava, so a big ball still reads as orange, not pale peach.
    const CORE: Rgb = [1.7, 1.35, 0.5];
    const FLAME: Rgb = [1.25, 0.46, 0.06];
    const FLAME_HOT: Rgb = [1.5, 0.85, 0.18];
    const EMBER: Rgb = [0.85, 0.2, 0.03];
    // The splash stays put on the ground while the ball rises: a ring of molten crown-shaped droplets.
    const splash = new Group();
    const sb = new MeshBuilder();
    torus(sb, 1.75, 0.34, { at: [0, 0.3, 0], facing: "y", ringSegments: 14, tubeSegments: 5, shade: (_p, i) => (i % 2 === 0 ? FLAME : FLAME_HOT) });
    disc(sb, [0, 0.32, 0], 1.8, "y", 14, FLAME_HOT, FLAME);
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      const lean = 0.5 + 0.2 * hash(k, 1);
      sb.add(shapes.cone(5), xf(Math.cos(a) * 2.15, 0.55, Math.sin(a) * 2.15, 0.28, 0.9 + hash(k, 2) * 0.5, 0.28), FLAME_HOT);
      sb.blob(Math.cos(a) * (2.2 + lean), 0.9 + hash(k, 3) * 0.5, Math.sin(a) * (2.2 + lean), 0.2, 0.2, 0.2, FLAME, 0);
    }
    splash.add(meshOf(sb, ctx.glow));
    const ball = new Group();
    ball.position.y = 1.3;
    const bb = new MeshBuilder();
    rockBlob(bb, 0, 0, 0, 0.95, 0.95, 0.95, CORE, 4, { detail: 1, roughness: 0.06 });
    // A jacket of flame spikes round the core, longer on the upper side.
    for (let k = 0; k < 11; k++) {
      const y = 0.9 - (k / 10) * 1.7;
      const r = Math.sqrt(Math.max(0.05, 1 - y * y));
      const a = k * 2.4;
      const dir = vec.norm([Math.cos(a) * r, y, Math.sin(a) * r]);
      const len = 0.9 + hash(k, 2) * 0.5 + (y > 0 ? 0.3 : 0);
      flutedPipe(bb, vec.mul(dir, 0.7), vec.mul(dir, 0.7 + len), 0.34, 3, (q) => mixRgb(FLAME_HOT, EMBER, Math.min(1, Math.max(0, (vec.len(q) - 0.7) / len))), 0.03, false);
    }
    ball.add(meshOf(bb, ctx.glow));
    // The flame trailing below: three layers of cones, hottest in the middle.
    const tail: Group[] = [];
    const layers: [number, number, Rgb][] = [[1.0, 3.3, EMBER], [0.74, 2.6, FLAME], [0.45, 1.8, FLAME_HOT]];
    layers.forEach(([r, h, col], li) => {
      const g = new Group();
      const tb = new MeshBuilder();
      icicle(tb, 0, -0.4, 0, r, h, col, 6);
      for (let k = 0; k < 4; k++) {
        const a = k * 1.57 + li;
        icicle(tb, Math.cos(a) * r * 0.9, -0.3, Math.sin(a) * r * 0.9, r * 0.4, h * 0.6, col, 5);
      }
      g.add(meshOf(tb, ctx.glow));
      ball.add(g);
      tail.push(g);
    });
    // A few sparks circling it.
    const sparks: Mesh[] = [];
    for (let k = 0; k < 4; k++) {
      const pb = new MeshBuilder();
      pb.blob(0, 0, 0, 0.22, 0.22, 0.22, FLAME_HOT, 0);
      const m = meshOf(pb, ctx.glow);
      ball.add(m);
      sparks.push(m);
    }
    root.add(splash, ball);
    return {
      root,
      radius: 1.6,
      update(s) {
        const h = s.height / (root.scale.y || 1);
        splash.position.y = -h; // the splash stays on the road
        tail.forEach((g, k) => {
          g.scale.set(1 + 0.12 * Math.sin(s.time * 17 + k * 2), 1 + 0.2 * Math.sin(s.time * 23 + k * 1.7), 1 + 0.12 * Math.sin(s.time * 19 + k));
          g.rotation.y = s.time * (2 + k);
        });
        ball.rotation.y = s.time * 2.5;
        ball.scale.setScalar(1 + 0.04 * Math.sin(s.time * 14));
        sparks.forEach((m, k) => {
          const a = s.time * 4 + k * 1.57;
          m.position.set(Math.cos(a) * 2.1, Math.sin(a * 1.3) * 0.9, Math.sin(a) * 2.1);
        });
      },
    };
  },
};

/** A geyser: a rocky vent with a glowing lip, a tall plume of steam that grows with the eruption, and flying drops. */
const geyser: HazardSpec = {
  build(ctx) {
    const root = new Group();
    const vent = new Group();
    const vb = new MeshBuilder();
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      rockBlob(vb, Math.cos(a) * 1.25, 0, Math.sin(a) * 1.25, 0.62 + hash(k, 1) * 0.2, 0.55 + hash(k, 2) * 0.3, 0.62, byHeight(0, 1, scaleRgb(BASALT_LOW, 1.3), BASALT_HI), k + 3, { detail: 0, roughness: 0.2, flatBase: true });
    }
    vb.add(shapes.cylinder(10), xf(0, 0.32, 0, 1.0, 0.1, 1.0), rgb("#140f12"));
    vent.add(meshOf(vb, ctx.lit));
    const rim = new MeshBuilder();
    torus(rim, 0.98, 0.14, { at: [0, 0.62, 0], facing: "y", ringSegments: 12, tubeSegments: 4, shade: (_p, i) => (i % 2 === 0 ? LAVA : LAVA_HOT) });
    vent.add(meshOf(rim, ctx.glow));
    // The plume: stacked puffs of steam tapering up, around a bright core.
    const jet = new Group();
    const jb = new MeshBuilder();
    const puffs = 7;
    for (let k = 0; k < puffs; k++) {
      const u = k / (puffs - 1);
      const r = 0.82 - 0.4 * u + (k % 2) * 0.1;
      jb.blob((hash(k, 1) - 0.5) * 0.3, 0.9 + u * 6.2, (hash(k, 2) - 0.5) * 0.3, r * 1.25, 0.8, r * 1.25, [1.5, 1.5, 1.55], 1);
    }
    jb.blob(0, 7.4, 0, 1.0, 0.7, 1.0, rgb("#fffaf0"), 1);
    jet.add(meshOf(jb, hazardGlass()));
    const cb = new MeshBuilder();
    cb.add(shapes.cone(6), xf(0, 3.6, 0, 0.42, 7.2, 0.42), ramp([2.4, 2.6, 2.8], [1.2, 1.6, 2.0]));
    jet.add(meshOf(cb, ctx.glow));
    // Drops thrown out of it.
    const drops: Mesh[] = [];
    for (let k = 0; k < 8; k++) {
      const db = new MeshBuilder();
      db.blob(0, 0, 0, 0.17, 0.2, 0.17, rgb("#d8f4ff"), 0);
      const m = meshOf(db, ctx.lit);
      root.add(m);
      drops.push(m);
    }
    root.add(vent, jet);
    return {
      root,
      radius: 1.4,
      update(s) {
        const sc = root.scale.y || 1;
        const h = s.height / sc;
        vent.position.y = -h;
        jet.position.y = -h + 0.3;
        // The plume grows with the eruption: nothing at all while the geyser is down.
        const g = Math.max(0.001, Math.min(1.1, (h + 1.2) / 3.0));
        jet.scale.set(Math.sqrt(g), g, Math.sqrt(g));
        jet.visible = h > -1.3;
        const topY = 7.4 * g;
        drops.forEach((m, k) => {
          const u = (((s.time * 0.9 + k / 8) % 1) + 1) % 1;
          const a = k * 2.4;
          const spread = (0.6 + 2.4 * u) * Math.min(1, g);
          m.position.set(Math.cos(a) * spread, -h + 0.5 + (topY * 0.9 * 4 * u * (1 - u) + 0.3), Math.sin(a) * spread);
          m.visible = h > -0.8;
        });
      },
    };
  },
};

export const LANDMARKS: Record<string, LandmarkSpec> = {
  volcano,
  "lava-fall": lavaFall,
  "basalt-columns": basaltColumns,
  "stone-bridge": stoneBridge,
  "obsidian-arch": obsidianArch,
  "hot-spring": hotSpring,
};
export const HAZARDS: Record<string, HazardSpec> = { fireball, geyser };
