/**
 * The procedural kart: built in code from smooth, rounded shapes and drawn in
 * physically based materials. An original design: a sleek lofted tub in candy
 * paint under a clear coat with a racing stripe, chrome tailpipes, a wing on
 * struts, a front splitter, glowing lamps, a numbered plate, mirrors, chunky
 * rubber tyres with tread and dished chrome rims, and a driver (drivers/) at a
 * small steering wheel.
 *
 * Everything that does not move relative to the tub is one merged geometry in
 * one shared material (kartMaterial.ts); the wheels, the steering wheel, the
 * flames and the driver's limbs are their own small meshes. A far version
 * (everything welded into one mesh) takes over beyond a few dozen metres.
 *
 * Built facing +z; its left is +x (so its right is -x), the way
 * `rotation.y = heading` expects (contract.ts). Once the Blender-made kart is
 * loaded, `createProceduralKart` returns that instead (kartArt.ts), behind the
 * same `KartModel`.
 */
import { AdditiveBlending, BufferGeometry, Group, LOD, Matrix4, Mesh, MeshBasicMaterial, TorusGeometry, Vector3 } from "three";
import { CHARACTERS } from "../characters";
import type { RacerSetup } from "../contract";
import { hasArtKart, createArtKart, type ArtKit } from "./kartArt";
import { brakeLights } from "./brakeLights";
import { kartExtras } from "./kartExtras";
import { createDriver, speciesOf, type Species } from "./drivers";
import { MeshBuilder, mergeBaked, mixRgb, rgb, shapes, withDetail, xf, type Rgb } from "./kartBuilder";
import { SURF, kartMaterial, withStudioFallback, type Surf } from "./kartMaterial";
import { DRIVER_AT, FAR_DISTANCE, PLATE, WHEEL_FRONT, WHEEL_REAR, KART_EXHAUST } from "./kartSpec";
import { TAU } from "./math";
import type { KartModel } from "./kart";

export { KART_EXHAUST, KART_HALF_WIDTH, KART_REAR_WHEEL } from "./kartSpec";

const WHITE = rgb("#f7f8fb");
const GOLD_BODY = [1.0, 0.52, 0.06] as const;

// ── The tub ─────────────────────────────────────────────────────────────────

interface Key {
  z: number;
  hw: number;
  yb: number;
  yt: number;
  sq: number;
}

/** The tub's cross-section at a few stations: half width, bottom and top, and how square (2 is an ellipse). */
const KEYS: Key[] = [
  { z: -1.34, hw: 0.4, yb: 0.32, yt: 0.7, sq: 2.6 },
  { z: -1.14, hw: 0.6, yb: 0.28, yt: 0.94, sq: 3.1 },
  { z: -0.78, hw: 0.69, yb: 0.26, yt: 0.9, sq: 3.3 },
  { z: -0.3, hw: 0.68, yb: 0.25, yt: 0.7, sq: 3.1 },
  { z: 0.15, hw: 0.6, yb: 0.25, yt: 0.66, sq: 2.9 },
  { z: 0.7, hw: 0.47, yb: 0.26, yt: 0.58, sq: 2.7 },
  { z: 1.2, hw: 0.37, yb: 0.28, yt: 0.52, sq: 2.5 },
  { z: 1.62, hw: 0.26, yb: 0.31, yt: 0.45, sq: 2.2 },
];
const Z_REAR = KEYS[0]!.z;
const Z_FRONT = KEYS[KEYS.length - 1]!.z;

function catmull(p0: number, p1: number, p2: number, p3: number, t: number): number {
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
}

function keyAt(z: number): Key {
  let i = 0;
  while (i < KEYS.length - 2 && z > KEYS[i + 1]!.z) i++;
  const k = (n: number) => KEYS[Math.max(0, Math.min(KEYS.length - 1, n))]!;
  const t = (z - k(i).z) / (k(i + 1).z - k(i).z || 1);
  const c = (f: (key: Key) => number) => catmull(f(k(i - 1)), f(k(i)), f(k(i + 1)), f(k(i + 2)), Math.max(0, Math.min(1, t)));
  return { z, hw: c((q) => q.hw), yb: c((q) => q.yb), yt: c((q) => q.yt), sq: c((q) => q.sq) };
}

const spow = (v: number, e: number): number => Math.sign(v) * Math.abs(v) ** e;

/** How much the tub's section is kept at z: it closes to a point in a round nose and a rounder tail. */
function capScale(z: number): number {
  const rear = Math.min(1, (z - Z_REAR) / 0.2);
  const front = Math.min(1, (Z_FRONT - z) / 0.42);
  const u = Math.min(rear, front);
  return Math.sqrt(Math.max(0, 1 - (1 - u) * (1 - u)));
}

/** The point on the tub at station z, angle t (0 at the bottom centre, round through the left side (+x) to the top, to the right side). */
function tubPoint(k: Key, t: number, out: Vector3): Vector3 {
  const s = capScale(k.z);
  const hw = k.hw * s;
  const hh = ((k.yt - k.yb) / 2) * s;
  const ym = (k.yt + k.yb) / 2;
  const e = 2 / k.sq;
  return out.set(hw * spow(Math.sin(t), e), ym - hh * spow(Math.cos(t), e), k.z);
}

/** The height of the tub's top at (z, x), for things that sit on it. */
function topY(z: number, x: number): number {
  const k = keyAt(z);
  const s = capScale(z);
  const hw = k.hw * s;
  const hh = ((k.yt - k.yb) / 2) * s;
  const ym = (k.yt + k.yb) / 2;
  const u = Math.min(1, Math.abs(x) / Math.max(hw, 1e-4));
  return ym + hh * (1 - u ** k.sq) ** (1 / k.sq);
}

/** Skins the tub with a smooth grid, shaded darker toward the underside. */
function buildTub(b: MeshBuilder, body: Rgb, lod: number): void {
  const rings = lod === 0 ? 40 : 14;
  const around = lod === 0 ? 30 : 12;
  const grid: Vector3[][] = [];
  for (let i = 0; i <= rings; i++) {
    // Clustered toward the ends, where the shape turns the fastest.
    const u = 0.5 - 0.5 * Math.cos((i / rings) * Math.PI);
    const k = keyAt(Z_REAR + (Z_FRONT - Z_REAR) * u);
    const row: Vector3[] = [];
    for (let j = 0; j <= around; j++) row.push(tubPoint(k, (j / around) * TAU, new Vector3()));
    grid.push(row);
  }
  const base = b.position.length / 3;
  const _a = new Vector3();
  const _b = new Vector3();
  const n = new Vector3();
  const centre = new Vector3();
  const colours: number[] = [];
  const normals: number[] = [];
  for (let i = 0; i <= rings; i++) {
    for (let j = 0; j <= around; j++) {
      const p = grid[i]![j]!;
      const pole = i === 0 || i === rings;
      if (pole) {
        n.set(0, 0, i === 0 ? -1 : 1);
      } else {
        const jn = grid[i]![j === around ? 1 : j + 1]!;
        const jp = grid[i]![j === 0 ? around - 1 : j - 1]!;
        _a.subVectors(jn, jp);
        _b.subVectors(grid[i + 1]![j]!, grid[i - 1]![j]!);
        n.crossVectors(_b, _a);
        if (n.lengthSq() < 1e-14) n.set(0, 0, 1);
        n.normalize();
        // Outward: away from the middle of the section.
        const mid = (grid[i]![0]!.y + grid[i]![Math.floor(around / 2)]!.y) / 2;
        centre.set(0, mid, p.z);
        if (n.x * (p.x - centre.x) + n.y * (p.y - centre.y) < 0) n.negate();
      }
      b.position.push(p.x, p.y, p.z);
      normals.push(n.x, n.y, n.z);
      const shade = 0.58 + 0.42 * smooth(-0.9, 0.5, n.y);
      colours.push(body[0] * shade, body[1] * shade, body[2] * shade);
    }
  }
  b.normal.push(...normals);
  b.color.push(...colours);
  for (let k = 0; k < (rings + 1) * (around + 1); k++) b.surfs.push(b.surf[0], b.surf[1], b.surf[2], b.surf[3]);
  const row = around + 1;
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < around; j++) {
      const a = base + i * row + j;
      const c = base + (i + 1) * row + j;
      b.index.push(a, c, a + 1, a + 1, c, c + 1);
    }
  }
  fixWinding(b, base, rings, around);
}

/** Flips the tub's triangles if they came out facing inward. */
function fixWinding(b: MeshBuilder, base: number, rings: number, around: number): void {
  const row = around + 1;
  const i = Math.floor(rings / 2);
  const j = Math.floor(around / 4);
  const a = base + i * row + j;
  const c = base + (i + 1) * row + j;
  const P = (v: number) => new Vector3(b.position[v * 3], b.position[v * 3 + 1], b.position[v * 3 + 2]);
  const N = new Vector3(b.normal[a * 3], b.normal[a * 3 + 1], b.normal[a * 3 + 2]);
  const face = new Vector3().crossVectors(P(c).sub(P(a)), P(a + 1).sub(P(a)));
  if (face.dot(N) < 0) {
    for (let t = b.index.length - rings * around * 6; t < b.index.length; t += 3) {
      const tmp = b.index[t + 1]!;
      b.index[t + 1] = b.index[t + 2]!;
      b.index[t + 2] = tmp;
    }
  }
}

function smooth(a: number, c: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (c - a)));
  return t * t * (3 - 2 * t);
}

/** A strip of colour laid on the tub's top between x0 and x1 and zA..zB, a hair above it. */
function decal(b: MeshBuilder, x0: number, x1: number, zA: number, zB: number, colour: Rgb, surf: Surf, steps = 28): void {
  const across = 5;
  const base = b.position.length / 3;
  const pts: Vector3[][] = [];
  const lift = 0.004;
  const P = (z: number, x: number): Vector3 => new Vector3(x, topY(z, x), z);
  const nrm = new Vector3();
  for (let i = 0; i <= steps; i++) {
    const z = zA + ((zB - zA) * i) / steps;
    const row: Vector3[] = [];
    for (let j = 0; j < across; j++) {
      const x = x0 + ((x1 - x0) * j) / (across - 1);
      const p = P(z, x);
      const dx = P(z, x + 0.01).sub(P(z, x - 0.01));
      const dz = P(z + 0.01, x).sub(P(z - 0.01, x));
      nrm.crossVectors(dz, dx).normalize();
      if (nrm.y < 0) nrm.negate();
      p.addScaledVector(nrm, lift);
      b.position.push(p.x, p.y, p.z);
      b.normal.push(nrm.x, nrm.y, nrm.z);
      b.color.push(colour[0], colour[1], colour[2]);
      b.surfs.push(surf[0], surf[1], surf[2], surf[3]);
      row.push(p);
    }
    pts.push(row);
  }
  for (let i = 0; i < steps; i++) {
    for (let j = 0; j < across - 1; j++) {
      const a = base + i * across + j;
      const c = base + (i + 1) * across + j;
      b.index.push(a, c, a + 1, a + 1, c, c + 1);
    }
  }
}

// ── Wheels ──────────────────────────────────────────────────────────────────

/**
 * One wheel with its axis along y and its outer face toward +y: a lathed
 * tyre with rounded shoulders and a pinstripe on its wall, tread blocks round
 * it, and a dished chrome rim with five spokes and a painted cap on the outer
 * face.
 */
function wheelGeometry(spec: { r: number; w: number }, cap: Rgb, lod: number, gold: boolean): BufferGeometry {
  const { r, w } = spec;
  const b = new MeshBuilder();
  const half = w / 2;
  const rIn = r * 0.62;
  const s = Math.min(w * 0.32, r * 0.22);
  const rubber: Rgb = [0.025, 0.026, 0.03];
  // The tyre's section: bore, wall, shoulder, tread, shoulder, wall.
  const profile: [number, number][] = [[rIn, -half * 0.9]];
  profile.push([rIn + 0.012, -half]);
  profile.push([r - s, -half]);
  const arc = lod === 0 ? 4 : 2;
  for (let i = 1; i <= arc; i++) {
    const a = (i / arc) * (Math.PI / 2);
    profile.push([r - s + Math.sin(a) * s, -half + s - Math.cos(a) * s]);
  }
  for (let i = 0; i <= arc; i++) {
    const a = (i / arc) * (Math.PI / 2);
    profile.push([r - s + Math.cos(a) * s, half - s + Math.sin(a) * s]);
  }
  profile.push([r - s, half]);
  profile.push([rIn + 0.012, half]);
  profile.push([rIn, half * 0.9]);
  b.as(SURF.rubber, () => b.lathe(profile, xf(0, 0, 0), rubber, lod === 0 ? 30 : 16));
  if (lod === 0) {
    // Tread: two staggered rings of small hard blocks standing proud of the tread, a little lighter.
    const blocks = Math.round(r * 62);
    const pitch = TAU / blocks;
    b.as(SURF.rubber, () => {
      for (let i = 0; i < blocks; i++) {
        for (const side of [-1, 1]) {
          const a = (i + (side > 0 ? 0.5 : 0)) * pitch;
          b.add(shapes.block(), xf(Math.cos(a) * (r + 0.002), side * w * 0.21, Math.sin(a) * (r + 0.002), 0.024, w * 0.34, pitch * r * 0.58, -a, 0, 0), [0.058, 0.06, 0.068]);
        }
      }
    });
    // The pinstripe on the outer wall.
    b.as(SURF.trim, () => b.lathe([[r * 0.8, half + 0.001], [r * 0.8 + 0.022, half + 0.001], [r * 0.8 + 0.022, half + 0.005], [r * 0.8, half + 0.005]], xf(0, 0, 0), cap, 30));
  }
  // The rim: a dish, the outer face recessed, a lip.
  const metal = gold ? SURF.gold : SURF.chrome;
  const chrome: Rgb = gold ? [GOLD_BODY[0], GOLD_BODY[1], GOLD_BODY[2]] : [0.93, 0.95, 1];
  const dish: [number, number][] = [
    [rIn + 0.005, half * 0.8],
    [rIn + 0.012, half * 0.98],
    [rIn * 0.93, half * 0.99],
    [rIn * 0.8, half * 0.9],
    [rIn * 0.52, half * 0.78],
    [rIn * 0.3, half * 0.82],
    [0.01, half * 0.84],
  ];
  b.as(metal, () => b.lathe(dish, xf(0, 0, 0), chrome, lod === 0 ? 24 : 12));
  // A flat dark inner face so the wheel is closed.
  b.as(SURF.steel, () => b.lathe([[0.01, -half * 0.8], [rIn + 0.005, -half * 0.8], [rIn + 0.005, half * 0.8]], xf(0, 0, 0), [0.35, 0.37, 0.42], 20));
  if (lod === 0) {
    // Five spokes from the hub to the lip, and the nut.
    b.as(metal, () => {
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * TAU + 0.3;
        const x0 = Math.cos(a) * rIn * 0.22;
        const z0 = Math.sin(a) * rIn * 0.22;
        const x1 = Math.cos(a) * rIn * 0.9;
        const z1 = Math.sin(a) * rIn * 0.9;
        b.rod([x0, half * 0.9, z0], [x1, half * 0.99, z1], 0.07, chrome);
      }
    });
    b.as(SURF.paint, () => b.blob(0, half * 0.83, 0, rIn * 0.3, rIn * 0.16, rIn * 0.3, cap, 1));
    b.as(SURF.chrome, () => b.blob(0, half * 0.93, 0, rIn * 0.1, rIn * 0.06, rIn * 0.1, [0.95, 0.96, 1], 0));
  }
  return b.build();
}

/** A wheel standing with its axis along x, outer face toward `side` (+1 the left, -1 the right), centred at (x, 0, 0). */
function placeWheel(geometry: BufferGeometry, side: 1 | -1, x: number): { geometry: BufferGeometry; matrix: Matrix4 } {
  const m = new Matrix4().makeTranslation(x, 0, 0);
  m.multiply(new Matrix4().makeRotationZ(-side * (Math.PI / 2)));
  return { geometry, matrix: m };
}

// ── Details ─────────────────────────────────────────────────────────────────

const SEGMENTS: Record<string, readonly string[]> = {
  "0": ["a", "b", "c", "d", "e", "f"],
  "1": ["b", "c"],
  "2": ["a", "b", "g", "e", "d"],
  "3": ["a", "b", "g", "c", "d"],
  "4": ["f", "g", "b", "c"],
  "5": ["a", "f", "g", "c", "d"],
  "6": ["a", "f", "g", "e", "c", "d"],
  "7": ["a", "b", "c"],
  "8": ["a", "b", "c", "d", "e", "f", "g"],
  "9": ["a", "b", "c", "d", "f", "g"],
};

/** A seven-segment digit on the number plate, seen from behind (the kart faces +z, so from behind +x is to the left). */
function digit(b: MeshBuilder, n: string, cx: number, cy: number, cz: number, h: number, ink: Rgb): void {
  const t = h * 0.15;
  const w = h * 0.5;
  const at: Record<string, [number, number, boolean]> = {
    a: [0, h / 2, true],
    b: [w / 2, h / 4, false],
    c: [w / 2, -h / 4, false],
    d: [0, -h / 2, true],
    e: [-w / 2, -h / 4, false],
    f: [-w / 2, h / 4, false],
    g: [0, 0, true],
  };
  for (const seg of SEGMENTS[n] ?? []) {
    const [sx, sy, horizontal] = at[seg]!;
    b.slab(cx - sx, cy + sy, cz, horizontal ? w : t, horizontal ? t : h / 2, t * 0.7, t * 0.3, ink);
  }
}

/** The chassis: everything fixed to the tub. */
function buildChassis(accent: Rgb, golden: boolean, id: number, lod: number): BufferGeometry {
  const b = new MeshBuilder();
  const body: Rgb = golden ? GOLD_BODY : accent;
  const bodySurf = golden ? SURF.gold : SURF.paint;
  const stripe: Rgb = golden ? accent : WHITE;
  const dark: Rgb = [0.045, 0.047, 0.056];
  const darker: Rgb = [0.02, 0.021, 0.026];
  const chrome: Rgb = [0.93, 0.95, 1];
  const trim: Rgb = golden ? [GOLD_BODY[0], GOLD_BODY[1], GOLD_BODY[2]] : WHITE;
  const trimSurf = golden ? SURF.gold : SURF.trim;

  // The tub and the racing stripes.
  b.as(bodySurf, () => buildTub(b, body, lod));
  b.as(SURF.trim, () => {
    decal(b, -0.12, 0.12, -1.2, 1.5, stripe, SURF.trim, lod === 0 ? 40 : 10);
    if (lod === 0) {
      decal(b, 0.17, 0.2, -1.16, 1.4, golden ? WHITE : mixRgb(accent, [0, 0, 0], 0.5), SURF.trim, 40);
      decal(b, -0.2, -0.17, -1.16, 1.4, golden ? WHITE : mixRgb(accent, [0, 0, 0], 0.5), SURF.trim, 40);
    }
  });

  // The undertray and skirts.
  b.as(SURF.plastic, () => {
    b.slab(0, 0.24, 0.1, 1.04, 0.1, 2.7, 0.04, darker);
    for (const sx of [-1, 1]) b.slab(sx * 0.73, 0.36, 0.05, 0.12, 0.17, 1.5, 0.05, dark);
  });
  b.as(trimSurf, () => {
    for (const sx of [-1, 1]) b.slab(sx * 0.775, 0.4, 0.05, 0.05, 0.075, 1.3, 0.024, trim);
  });

  // The seat, its back, and a padded headrest.
  b.as(SURF.plastic, () => {
    b.slab(0, 0.75, -0.2, 0.66, 0.13, 0.6, 0.05, dark);
    b.slab(0, 1.08, -0.56, 0.64, 0.6, 0.16, 0.06, dark, 0, 0.22);
  });
  b.as(SURF.cloth, () => {
    b.slab(0, 1.05, -0.5, 0.5, 0.46, 0.06, 0.03, mixRgb(accent, [0.1, 0.1, 0.12], 0.55), 0, 0.22);
    b.slab(0, 0.81, -0.2, 0.5, 0.05, 0.46, 0.022, mixRgb(accent, [0.1, 0.1, 0.12], 0.55));
  });
  // The engine cover behind it, its ribs, and the intake.
  b.as(SURF.plastic, () => b.slab(0, 1.0, -1.02, 0.7, 0.3, 0.5, 0.12, dark));
  b.as(SURF.chrome, () => {
    for (let k = 0; k < 3; k++) b.slab(0, 1.0 + k * 0.06, -1.275 + k * 0.03, 0.6 - k * 0.09, 0.028, 0.05, 0.012, chrome);
    b.lathe([[0.02, 0], [0.09, 0], [0.085, 0.1], [0.12, 0.2], [0.1, 0.2], [0.02, 0.1]], xf(0, 1.12, -0.96, 1, 1, 1), chrome, 20);
  });

  // The tailpipes: flared chrome horns out the back, dark inside.
  for (const sx of [-1, 1]) {
    const x = sx * KART_EXHAUST.right;
    const pipe = xf(x, KART_EXHAUST.y, KART_EXHAUST.forward + 0.46, 1, 1, 1, 0, -Math.PI / 2 - 0.05, 0);
    b.as(SURF.chrome, () => b.lathe([[0.055, -0.04], [0.06, 0.12], [0.075, 0.28], [0.1, 0.4], [0.12, 0.46], [0.108, 0.46], [0.085, 0.4]], pipe, chrome, 24));
    b.as(SURF.plastic, () => b.lathe([[0.001, 0.2], [0.085, 0.41], [0.001, 0.45]], pipe, darker, 20));
  }

  // The wing on struts, with end plates.
  b.as(trimSurf, () => {
    b.add(shapes.ball(1), xf(0, 1.16, -1.36, 0.67, 0.034, 0.21, 0, 0.1, 0), golden ? trim : body);
    for (const sx of [-1, 1]) b.slab(sx * 0.68, 1.1, -1.35, 0.045, 0.24, 0.5, 0.02, golden ? [accent[0], accent[1], accent[2]] : trim, 0, 0.0);
  });
  b.as(SURF.chrome, () => {
    for (const sx of [-1, 1]) b.rod([sx * 0.34, 0.86, -1.18], [sx * 0.34, 1.14, -1.34], 0.045, chrome);
  });

  // The number plate under the wing, between the pipes, and the lamps.
  b.as(SURF.trim, () => {
    b.slab(0, 0.62, -1.345, 0.44, 0.26, 0.03, 0.02, WHITE, 0, -0.05);
  });
  b.as(SURF.plastic, () => {
    const text = String((id % 9) + 1);
    digit(b, text, 0, 0.62, -1.368, 0.18, mixRgb(accent, [0, 0, 0], 0.55));
  });
  b.as(SURF.lamp, () => {
    for (const sx of [-1, 1]) {
      b.slab(sx * 0.4, 0.86, -1.3, 0.21, 0.06, 0.05, 0.025, [2.8, 0.1, 0.07]);
      b.blob(sx * 0.18, 0.5, 1.4, 0.1, 0.075, 0.07, [1.9, 1.75, 1.35], 1);
    }
  });
  b.as(SURF.chrome, () => {
    for (const sx of [-1, 1]) b.torus(0.105, 0.016, xf(sx * 0.18, 0.5, 1.405, 1, 1, 1, 0, Math.PI / 2, 0), chrome, 18, 5);
  });

  // The front: a splitter wing with end plates, a bumper bar, and the suspension arms.
  b.as(trimSurf, () => {
    b.add(shapes.ball(1), xf(0, 0.3, 1.66, 0.78, 0.03, 0.19, 0, 0.04, 0), trim);
    for (const sx of [-1, 1]) b.slab(sx * 0.78, 0.37, 1.66, 0.05, 0.2, 0.42, 0.022, golden ? [accent[0], accent[1], accent[2]] : body);
  });
  b.as(SURF.chrome, () => {
    b.rod([-0.5, 0.45, 1.5], [0.5, 0.45, 1.5], 0.06, chrome);
    for (const sx of [-1, 1]) {
      b.rod([sx * 0.5, 0.45, 1.5], [sx * 0.3, 0.38, 1.38], 0.05, chrome);
      // Wishbones to the front hubs, the trailing arm to the rear hubs.
      b.rod([sx * 0.4, 0.4, WHEEL_FRONT.z + 0.14], [sx * (WHEEL_FRONT.x - 0.1), WHEEL_FRONT.y, WHEEL_FRONT.z], 0.05, chrome);
      b.rod([sx * 0.4, 0.4, WHEEL_FRONT.z - 0.14], [sx * (WHEEL_FRONT.x - 0.1), WHEEL_FRONT.y, WHEEL_FRONT.z], 0.05, chrome);
      b.rod([sx * 0.58, WHEEL_REAR.y, WHEEL_REAR.z], [sx * (WHEEL_REAR.x - 0.18), WHEEL_REAR.y, WHEEL_REAR.z], 0.1, chrome);
    }
  });
  if (lod === 0) {
    // Side mirrors on stalks, and vents behind the pods.
    for (const sx of [-1, 1]) {
      b.as(SURF.chrome, () => b.rod([sx * 0.5, 0.75, 0.4], [sx * 0.66, 0.93, 0.36], 0.025, chrome));
      b.as(SURF.paint, () => b.slab(sx * 0.7, 0.95, 0.35, 0.1, 0.075, 0.03, 0.02, golden ? [accent[0], accent[1], accent[2]] : body, sx * 0.4));
      b.as(SURF.glass, () => b.slab(sx * 0.7, 0.95, 0.33, 0.085, 0.06, 0.012, 0.005, [0.5, 0.6, 0.75], sx * 0.4));
      b.as(SURF.plastic, () => {
        for (let k = 0; k < 4; k++) b.slab(sx * 0.7, 0.62, -0.35 - k * 0.1, 0.03, 0.12, 0.05, 0.015, darker);
      });
    }
    // Steering column.
    b.as(SURF.steel, () => b.rod([0, 0.7, 0.5], [0, 1.0, 0.26], 0.05, [0.5, 0.52, 0.58]));
  }
  return b.build();
}

/** The steering wheel, in its own space (ring in the xy plane, facing +z). */
function steeringGeometry(accent: Rgb): BufferGeometry {
  const b = new MeshBuilder();
  const R = 0.17;
  b.as(SURF.plastic, () => {
    const ring = new TorusGeometry(R, 0.028, 8, 28);
    b.geometry(ring, xf(0, 0, 0), [0.05, 0.05, 0.06]);
    ring.dispose();
  });
  b.as(SURF.paint, () => {
    const grip = new TorusGeometry(R, 0.031, 8, 8, 0.9);
    b.geometry(grip, xf(0, 0, 0, 1, 1, 1, 0, 0, Math.PI / 2 - 0.45), accent);
    grip.dispose();
  });
  b.as(SURF.chrome, () => {
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * TAU + Math.PI / 2;
      b.rod([0, 0, 0], [Math.cos(a) * R, Math.sin(a) * R, 0], 0.03, [0.9, 0.92, 0.98]);
    }
    b.blob(0, 0, 0.01, 0.06, 0.06, 0.04, [0.95, 0.96, 1], 1);
  });
  b.as(SURF.paint, () => b.blob(0, 0, 0.03, 0.036, 0.036, 0.02, accent, 1));
  return b.build();
}

function flameGeometry(): BufferGeometry {
  const b = new MeshBuilder();
  const cone = (r: number, len: number, hot: Rgb, tip: Rgb) => b.add(shapes.cone(10), xf(0, 0, -len / 2, r, len, r, 0, -Math.PI / 2, 0), { bottom: hot, top: tip });
  // Orange sheath, yellow body, white-blue core. Over-bright so the bloom takes it.
  cone(0.17, 1.9, [2.2, 0.95, 0.12], [0.9, 0.12, 0.0]);
  cone(0.125, 1.35, [2.6, 1.7, 0.35], [1.0, 0.4, 0.03]);
  cone(0.07, 0.85, [2.4, 2.6, 3.0], [0.4, 1.0, 2.6]);
  return b.build();
}

const flameMaterial = new MeshBasicMaterial({ vertexColors: true, blending: AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.92, fog: false });

/** Who sits in a kart whose racer names no driver: the base cast in turn, by the kart's id. */
const STAND_INS = CHARACTERS.filter((c) => !c.unlock);

/** Who drives a racer's kart: their driver, or for a racer who chose none, one of the eight by their id. */
export function shownSpecies(racer: Pick<RacerSetup, "id" | "character">): Species {
  return speciesOf(racer.character, STAND_INS[racer.id % STAND_INS.length]!.species);
}

/** What the Blender kart (kartArt.ts) borrows from this one: the flames, the numbered plate and the driver. */
function artKit(racer: Pick<RacerSetup, "id" | "colour" | "character" | "golden">): ArtKit {
  const species = shownSpecies(racer);
  return {
    flame: flameGeometry,
    flameMaterial,
    plate(id, accent) {
      const b = new MeshBuilder();
      b.as(SURF.plastic, () => digit(b, String((id % 9) + 1), 0, PLATE.y, PLATE.z - 0.008, 0.18, mixRgb(accent, [0, 0, 0], 0.55)));
      return b.build();
    },
    extras: (accent, golden) => kartExtras(species, accent, golden),
    driver: () => createDriver(species, racer.colour, [...DRIVER_AT], kartMaterial()),
  };
}

/**
 * The kart for a racer: the Blender model when its art is loaded (kartArt.ts),
 * else the one built here in code.
 */
export function createProceduralKart(racer: Pick<RacerSetup, "id" | "colour" | "character" | "golden">): KartModel {
  if (hasArtKart()) {
    const art = createArtKart(racer, artKit(racer));
    if (art) return art;
  }
  const golden = racer.golden === true;
  const accent = rgb(racer.colour);
  const material = kartMaterial();
  const species = shownSpecies(racer);

  // ── The near kart ──
  const chassisBase = buildChassis(accent, golden, racer.id, 0);
  const extrasGeo = kartExtras(species, accent, golden);
  const chassisGeo = extrasGeo ? mergeBaked([{ geometry: chassisBase, matrix: new Matrix4() }, { geometry: extrasGeo, matrix: new Matrix4() }]) : chassisBase;
  if (extrasGeo) {
    chassisBase.dispose();
    extrasGeo.dispose();
  }
  const brake = brakeLights(null);
  const steeringGeo = steeringGeometry(accent);
  const frontGeo = wheelGeometry(WHEEL_FRONT, accent, 0, golden);
  const rearWheel = wheelGeometry(WHEEL_REAR, accent, 0, golden);
  const rearGeo = mergeBaked([placeWheel(rearWheel, 1, WHEEL_REAR.x), placeWheel(rearWheel, -1, -WHEEL_REAR.x)]);
  const flameGeo = flameGeometry();

  const root = new Group();
  const near = new Group();
  const bodyGroup = new Group();
  near.add(bodyGroup);
  const chassis = new Mesh(chassisGeo, material);
  chassis.castShadow = true;
  chassis.receiveShadow = true;
  withStudioFallback(chassis);
  bodyGroup.add(chassis);

  // The driver pivots at the hip.
  const driver = createDriver(species, racer.colour, [0, 0.9, -0.28], material);
  bodyGroup.add(driver.root);
  if (brake) bodyGroup.add(brake.mesh);

  const wheelPivot = new Group();
  wheelPivot.position.set(0, 1.04, 0.24);
  wheelPivot.rotation.x = -0.95;
  const wheelRim = new Mesh(steeringGeo, material);
  wheelRim.castShadow = true;
  wheelPivot.add(wheelRim);
  bodyGroup.add(wheelPivot);

  const flames: Mesh[] = [];
  for (const sx of [-1, 1]) {
    const f = new Mesh(flameGeo, flameMaterial);
    f.position.set(sx * KART_EXHAUST.right, KART_EXHAUST.y, KART_EXHAUST.forward + 0.02);
    f.visible = false;
    f.renderOrder = 12;
    bodyGroup.add(f);
    flames.push(f);
  }

  const fronts: { pivot: Group; mesh: Mesh }[] = [];
  for (const sx of [-1, 1] as const) {
    const pivot = new Group();
    pivot.position.set(sx * WHEEL_FRONT.x, WHEEL_FRONT.y, WHEEL_FRONT.z);
    const g = placeWheel(frontGeo, sx, 0);
    const geo = mergeBaked([g]);
    const mesh = new Mesh(geo, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    pivot.add(mesh);
    near.add(pivot);
    fronts.push({ pivot, mesh });
  }
  const rearMesh = new Mesh(rearGeo, material);
  rearMesh.position.set(0, WHEEL_REAR.y, WHEEL_REAR.z);
  rearMesh.castShadow = true;
  rearMesh.receiveShadow = true;
  near.add(rearMesh);

  // ── The far kart: everything welded, driver at rest ──
  const farRoot = new Group();
  let farGeo: BufferGeometry;
  let driverFar: BufferGeometry;
  {
    const parts: { geometry: BufferGeometry; matrix: Matrix4 }[] = [];
    const farChassis = withDetail(0.45, () => buildChassis(accent, golden, racer.id, 1));
    parts.push({ geometry: farChassis, matrix: new Matrix4() });
    const farExtras = kartExtras(species, accent, golden);
    if (farExtras) parts.push({ geometry: farExtras, matrix: new Matrix4() });
    const farFront = withDetail(0.45, () => wheelGeometry(WHEEL_FRONT, accent, 1, golden));
    const farRear = withDetail(0.45, () => wheelGeometry(WHEEL_REAR, accent, 1, golden));
    for (const sx of [-1, 1] as const) {
      const f = placeWheel(farFront, sx, sx * WHEEL_FRONT.x);
      f.matrix.premultiply(new Matrix4().makeTranslation(0, WHEEL_FRONT.y, WHEEL_FRONT.z));
      parts.push(f);
      const r = placeWheel(farRear, sx, sx * WHEEL_REAR.x);
      r.matrix.premultiply(new Matrix4().makeTranslation(0, WHEEL_REAR.y, WHEEL_REAR.z));
      parts.push(r);
    }
    driverFar = withDetail(0.45, () => {
      const d = createDriver(species, racer.colour, [0, 0.9, -0.28], material);
      d.update({ time: 0, steer: 0, lean: 0, twirl: 0 });
      const g = d.bake();
      d.dispose();
      return g;
    });
    parts.push({ geometry: driverFar, matrix: new Matrix4() });
    farGeo = mergeBaked(parts);
    for (const p of parts) p.geometry.dispose();
  }
  const farBody = new Group();
  const farMesh = new Mesh(farGeo, material);
  farMesh.castShadow = true;
  withStudioFallback(farMesh);
  farBody.add(farMesh);
  farRoot.add(farBody);

  const lod = new LOD();
  lod.addLevel(near, 0);
  lod.addLevel(farRoot, FAR_DISTANCE, 0.1);
  root.add(lod);

  return {
    root,
    pose(p) {
      const squash = p.squash ?? 0;
      bodyGroup.position.y = p.hop + p.shake - squash * 0.07;
      bodyGroup.rotation.set(-p.pitch, p.slide, p.roll, "YXZ");
      bodyGroup.scale.set(1 + squash * 0.035, 1 - squash * 0.06, 1 + squash * 0.035);
      farBody.position.y = bodyGroup.position.y;
      farBody.rotation.copy(bodyGroup.rotation);
      driver.update({ time: p.time ?? 0, steer: p.steer, lean: p.lean, twirl: p.twirl ?? 0, emote: p.emote, finished: p.finished, dizzy: p.dizzy, lookBack: p.lookBack, rest: p.rest, shut: p.shut });
      brake?.show(p.brake ?? 0);
      wheelRim.rotation.z = -p.steer * 1.5;
      for (const f of fronts) {
        f.pivot.rotation.y = -p.steer * 0.5;
        f.mesh.rotation.x = p.wheelSpin;
        f.pivot.scale.y = 1 - squash * 0.02;
      }
      rearMesh.rotation.x = p.wheelSpin;
      const on = p.flame > 0.02;
      for (const f of flames) {
        f.visible = on;
        if (on) {
          const s = p.flame * (0.8 + 0.5 * p.flicker);
          f.scale.set(0.8 + 0.3 * p.flicker, 0.8 + 0.3 * p.flicker, 0.5 + s * 1.5);
        }
      }
    },
    dispose() {
      for (const g of [chassisGeo, steeringGeo, frontGeo, rearGeo, flameGeo, farGeo, brake?.mesh.geometry]) g?.dispose();
      for (const f of fronts) f.mesh.geometry.dispose();
      rearWheel.dispose();
      driver.dispose();
    },
  };
}
