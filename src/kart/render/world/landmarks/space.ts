/**
 * The space world's landmarks and hazards (docs/GRIP_PRIX.md, "What each theme can build").
 *
 * Deep space: the road is a glowing ribbon over a ringed planet, so everything
 * here floats. Cosmic blues, magentas and teals, neon edges, and plenty of
 * `glow`, `glass` and halos. Nothing stands on a ground, so models are built
 * around a centre some way above y = 0 and the track lifts them as it likes.
 */
import { DoubleSide, Group, Matrix4, Mesh, MeshBasicMaterial, Quaternion, Vector3 } from "three";
import { byHeight, grid, lathe, MeshBuilder, mixRgb, pipe, ramp, rgb, rockBlob, scaleRgb, shapes, stripes, torus, tube, xf, type Rgb, type V3 } from "./kit";
import type { Halo, HazardSpec, LandmarkSpec, MovingPart } from "./types";

export const LANDMARKS: Record<string, LandmarkSpec> = {};
export const HAZARDS: Record<string, HazardSpec> = {};

const TAU = Math.PI * 2;

// ─── Palette ─────────────────────────────────────────────────────────────────

const WHITE = rgb("#f2f6ff");
const HULL = rgb("#dfe8f5");
const TEAL = rgb("#14c8be");
const DEEP_TEAL = rgb("#0a6e78");
const ORANGE = rgb("#ff8a3a");
const NAVY = rgb("#16205c");
const BLUE = rgb("#2a5ad8");
const PANEL = rgb("#1b3aa8");
const MAGENTA = rgb("#ff3fd0");
const VIOLET = rgb("#7a4dff");
const GOLD = rgb("#e8b13c");
const FOIL = rgb("#f2c04a");
const STEEL = rgb("#a9b4d0");
const DARK = rgb("#1a1a3a");

const G_CYAN: Rgb = [0.5, 3, 3.6];
const G_PINK: Rgb = [3.6, 0.5, 2.8];
const G_GOLD: Rgb = [4, 2.6, 0.8];
const G_WHITE: Rgb = [3.2, 3.2, 3.6];
const G_GREEN: Rgb = [0.6, 3.6, 1.2];
const G_RED: Rgb = [4, 0.4, 0.5];
const G_VIOLET: Rgb = [1.8, 0.9, 3.8];
const NEON: Rgb[] = [G_CYAN, G_PINK, G_GOLD, G_WHITE];

const neonAt = (i: number): Rgb => NEON[((i % NEON.length) + NEON.length) % NEON.length]!;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Copies every triangle of `src` into `dst` through a matrix (one hand-built piece, placed many times or tilted). */
function stamp(dst: MeshBuilder, src: MeshBuilder, m: Matrix4): void {
  const p = src.position;
  const c = src.color;
  const e = m.elements;
  const at = (i: number): V3 => [
    e[0]! * p[i]! + e[4]! * p[i + 1]! + e[8]! * p[i + 2]! + e[12]!,
    e[1]! * p[i]! + e[5]! * p[i + 1]! + e[9]! * p[i + 2]! + e[13]!,
    e[2]! * p[i]! + e[6]! * p[i + 1]! + e[10]! * p[i + 2]! + e[14]!,
  ];
  for (let i = 0; i < p.length; i += 9) {
    dst.tri(at(i), at(i + 3), at(i + 6), [c[i]!, c[i + 1]!, c[i + 2]!], [c[i + 3]!, c[i + 4]!, c[i + 5]!], [c[i + 6]!, c[i + 7]!, c[i + 8]!]);
  }
}

const _up = new Vector3(0, 1, 0);
const _q = new Quaternion();

/** A unit shape stood on `pos` with its +y along `dir` (a crystal growing out of rock, a nozzle on a ring). */
function orient(b: MeshBuilder, shape: ReturnType<typeof shapes.cone>, pos: V3, dir: V3, sx: number, sy: number, sz: number, paint: Rgb | { bottom: Rgb; top: Rgb }): void {
  const d = new Vector3(dir[0], dir[1], dir[2]).normalize();
  _q.setFromUnitVectors(_up, d);
  // The shape is centred, so its middle sits half a length out along `dir`.
  const m = new Matrix4().compose(new Vector3(pos[0] + d.x * sy * 0.5, pos[1] + d.y * sy * 0.5, pos[2] + d.z * sy * 0.5), _q, new Vector3(sx, sy, sz));
  b.add(shape, m, paint);
}

const norm = (v: V3): V3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

/** A pseudo random number from an integer, for scatter that must not move between builds. */
const hash = (i: number): number => {
  const h = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return h - Math.floor(h);
};

/** Glowing crystals growing from a point on a rock, leaning out along its normal. */
function crystals(g: MeshBuilder, at: V3, normal: V3, n: number, size: number, seed: number, colours: Rgb[]): void {
  const nn = norm(normal);
  for (let k = 0; k < n; k++) {
    const lean: V3 = norm([nn[0] + (hash(seed + k) - 0.5) * 0.9, nn[1] + (hash(seed + k + 9) - 0.5) * 0.9, nn[2] + (hash(seed + k + 17) - 0.5) * 0.9]);
    const len = size * (0.7 + hash(seed + k + 31) * 0.9);
    const off: V3 = [at[0] + (hash(seed + k + 3) - 0.5) * size * 0.8, at[1] + (hash(seed + k + 5) - 0.5) * size * 0.8, at[2] + (hash(seed + k + 7) - 0.5) * size * 0.8];
    orient(g, shapes.cone(5), [off[0] - lean[0] * 0.3, off[1] - lean[1] * 0.3, off[2] - lean[2] * 0.3], lean, size * 0.34, len, size * 0.34, colours[k % colours.length]!);
  }
}

// ─── Ringed planet ───────────────────────────────────────────────────────────

const BAND_STOPS: [number, Rgb][] = [
  [-90, rgb("#5a3a66")],
  [-72, rgb("#7a4a6a")],
  [-55, rgb("#e6c795")],
  [-40, rgb("#9c4a38")],
  [-25, rgb("#f3dcb0")],
  [-10, rgb("#d9803a")],
  [5, rgb("#f6e3b8")],
  [18, rgb("#c9622e")],
  [32, rgb("#e8b074")],
  [46, rgb("#a8503a")],
  [60, rgb("#ecd3a2")],
  [76, rgb("#7a4a6a")],
  [90, rgb("#5a3a66")],
];

function bandColour(lat: number, j: number): Rgb {
  let a = BAND_STOPS[0]!;
  let b = BAND_STOPS[BAND_STOPS.length - 1]!;
  for (let k = 0; k < BAND_STOPS.length - 1; k++) {
    if (lat >= BAND_STOPS[k]![0] && lat <= BAND_STOPS[k + 1]![0]) {
      a = BAND_STOPS[k]!;
      b = BAND_STOPS[k + 1]!;
      break;
    }
  }
  const t = (lat - a[0]) / (b[0] - a[0] || 1);
  // A little streaking along each band, so the surface is not flat paint.
  return scaleRgb(mixRgb(a[1], b[1], t * t * (3 - 2 * t)), 1.45 + 0.07 * Math.sin(j * 1.7 + lat * 0.35));
}

LANDMARKS["ringed-planet"] = {
  build() {
    const R = 220;
    const CY = 220;
    const lit = new MeshBuilder();
    const glow = new MeshBuilder();
    const glass = new MeshBuilder();
    const halos: Halo[] = [];

    // The globe: lathe rows every 10 degrees of latitude, banded by latitude.
    const prof: [number, number][] = [];
    for (let lat = -90; lat <= 90; lat += 10) prof.push([R * Math.cos((lat * Math.PI) / 180), R * Math.sin((lat * Math.PI) / 180)]);
    lathe(lit, prof, { at: [0, CY, 0], segments: 40, shade: (p, _i, j) => bandColour((Math.asin((p[1] - CY) / R) * 180) / Math.PI, j) });

    // A great storm on the face turned to the road: two spiral arms and a dark eye.
    const c0 = norm([0.04, Math.sin(-0.38), Math.cos(-0.38)]);
    const e1 = norm([c0[2], 0, -c0[0]]);
    const e2: V3 = [c0[1] * e1[2] - c0[2] * e1[1], c0[2] * e1[0] - c0[0] * e1[2], c0[0] * e1[1] - c0[1] * e1[0]];
    const surf = (u: number, v: number, h: number): V3 => {
      const d = norm([c0[0] + (e1[0] * u + e2[0] * v) / R, c0[1] + (e1[1] * u + e2[1] * v) / R, c0[2] + (e1[2] * u + e2[2] * v) / R]);
      return [d[0] * (R + h), CY + d[1] * (R + h), d[2] * (R + h)];
    };
    for (let arm = 0; arm < 2; arm++) {
      const rowA: V3[] = [];
      const rowB: V3[] = [];
      for (let k = 0; k <= 14; k++) {
        const t = k / 14;
        const a = arm * Math.PI + 4.6 * t;
        const rad = 16 + 62 * t;
        const w = 17 * (1 - 0.65 * t);
        const dx = Math.cos(a) * 1.5;
        const dy = Math.sin(a);
        rowA.push(surf(dx * (rad - w / 2), dy * (rad - w / 2), 3.2));
        rowB.push(surf(dx * (rad + w / 2), dy * (rad + w / 2), 3.2));
      }
      grid(lit, [rowA, rowB], arm === 0 ? (_p, _i, j) => mixRgb(rgb("#fff0d2"), rgb("#e8b074"), j / 14) : (_p, _i, j) => mixRgb(rgb("#8f3a22"), rgb("#c9622e"), j / 14));
    }
    {
      const eye = surf(0, 0, 3.6);
      orient(lit, shapes.ball(1), [eye[0], eye[1], eye[2]], c0, 18, 6, 12, rgb("#7a2e1e"));
    }

    // The atmosphere: a faint blue shell, and soft halos behind for the rim light.
    const shell: [number, number][] = [];
    for (let lat = -90; lat <= 90; lat += 15) shell.push([R * 1.035 * Math.cos((lat * Math.PI) / 180), R * 1.035 * Math.sin((lat * Math.PI) / 180)]);
    void shell;
    halos.push({ x: 0, y: CY, z: -60, size: 560, colour: [0.35, 0.75, 1.8], alpha: 0.5, twinkle: 0 });
    halos.push({ x: 0, y: CY, z: -20, size: 480, colour: [0.5, 0.9, 1.6], alpha: 0.22, twinkle: 0 });
    halos.push({ x: 0, y: CY, z: -40, size: 500, colour: [0.9, 0.5, 1.4], alpha: 0.2, twinkle: 0 });
    halos.push({ x: 60, y: CY + 80, z: -30, size: 300, colour: [1.6, 1.0, 0.7], alpha: 0.18, twinkle: 0 });

    // The rings: a tilted set of flat annuli, lit bands and glass bands, with a gap between.
    const tilt = (x: number, z: number): V3 => {
      // Rotate the flat ring (x, 0, z) about z by 0.42 rad and about x by 0.22 rad, about the planet's centre.
      const rz = 0.42;
      const rx = 0.22;
      const px = x * Math.cos(rz);
      let py = x * Math.sin(rz);
      let pz = z;
      const y2 = py * Math.cos(rx) - pz * Math.sin(rx);
      const z2 = py * Math.sin(rx) + pz * Math.cos(rx);
      py = y2;
      pz = z2;
      return [px, CY + py, pz];
    };
    const annulus = (b: MeshBuilder, r0: number, r1: number, shade: (j: number) => Rgb, seg = 56): void => {
      const A: V3[] = [];
      const B: V3[] = [];
      for (let k = 0; k < seg; k++) {
        const a = (k / seg) * TAU;
        A.push(tilt(Math.cos(a) * r0 * R, Math.sin(a) * r0 * R));
        B.push(tilt(Math.cos(a) * r1 * R, Math.sin(a) * r1 * R));
      }
      grid(b, [A, B], (_p, _i, j) => shade(j), true);
    };
    annulus(lit, 1.3, 1.44, (j) => scaleRgb(rgb("#d9ccb8"), 0.85 + 0.15 * Math.sin(j * 2.1)));
    annulus(glass, 1.46, 1.64, (j) => mixRgb([0.5, 0.8, 1.3], [0.9, 0.7, 1.3], 0.5 + 0.5 * Math.sin(j * 0.9)));
    annulus(lit, 1.67, 1.78, (j) => scaleRgb(rgb("#e0a566"), 0.85 + 0.15 * Math.sin(j * 1.3 + 2)));
    annulus(glow, 1.8, 1.86, (j) => scaleRgb([1.0, 0.7, 2.0], 0.8 + 0.2 * Math.sin(j * 1.9)));
    annulus(glass, 1.9, 2.2, (j) => mixRgb([0.7, 0.5, 1.4], [0.4, 0.9, 1.3], 0.5 + 0.5 * Math.sin(j * 0.6)));
    annulus(lit, 2.22, 2.28, () => rgb("#b9b0d6"));

    // Two small moons, one in front of the rings.
    rockBlob(lit, -300, CY + 95, 260, 14, 13, 14, byHeight(CY + 80, CY + 110, rgb("#6a6580"), rgb("#c3bedb")), 3, { detail: 1, roughness: 0.12 });
    rockBlob(lit, 335, CY - 70, 170, 8, 7.5, 8, byHeight(CY - 80, CY - 60, rgb("#7a5a5a"), rgb("#dcc2b0")), 7, { detail: 1, roughness: 0.14 });
    return { lit, glow, glass, halos };
  },
};

// ─── Ring gate ───────────────────────────────────────────────────────────────

LANDMARKS["ring-gate"] = {
  span: true,
  defaultSpan: 12,
  build(ctx) {
    const lit = new MeshBuilder();
    const glow = new MeshBuilder();
    const glass = new MeshBuilder();
    const halos: Halo[] = [];
    // The ring stands round the road: its middle is 5 m up, so the opening is over 24 m wide at road level and 18 m high.
    // Its lowest arc would drop below the road, so it ends in two feet at about road level.
    const C = 5;
    const RC = 14.8;
    const TR = 1.5;
    const reach = (105 * Math.PI) / 180;
    const arc: [number, number] = [Math.PI / 2 - reach, Math.PI / 2 + reach];
    torus(lit, RC, TR, { at: [0, C, 0], facing: "z", ringSegments: 44, tubeSegments: 8, shade: stripes(rgb("#e9eefc"), rgb("#8f9bd0"), "row", 2), arc });
    // A thinner outer ring behind, in magenta, and a fine inner glass band.
    torus(lit, RC + 1.1, 0.55, { at: [0, C, -3.4], facing: "z", ringSegments: 44, tubeSegments: 5, shade: rgb("#c2339a"), arc });
    torus(glow, RC + 1.1, 0.3, { at: [0, C, -3.4], facing: "z", ringSegments: 44, tubeSegments: 4, shade: G_PINK, arc: [arc[0] + 0.05, arc[1] - 0.05] });
    const inner: V3[] = [];
    const inner2: V3[] = [];
    for (let k = 0; k <= 44; k++) {
      const a = arc[0] + ((arc[1] - arc[0]) * k) / 44;
      inner.push([Math.cos(a) * (RC - TR - 0.1), C + Math.sin(a) * (RC - TR - 0.1), 0]);
      inner2.push([Math.cos(a) * (RC - TR - 1.5), C + Math.sin(a) * (RC - TR - 1.5), 0]);
    }
    grid(glass, [inner, inner2], [0.5, 0.9, 1.5]);
    // Chasing lights: dashes of colour running round both faces of the band.
    const dashes = 38;
    for (let k = 0; k < dashes; k++) {
      const a = arc[0] + 0.06 + ((arc[1] - arc[0] - 0.12) * k) / (dashes - 1);
      const x = Math.cos(a) * RC;
      const y = C + Math.sin(a) * RC;
      for (const z of [-1.62, 1.62]) glow.box(x, y, z, 1.25, 0.7, 0.2, neonAt(k), 0, 0, a - Math.PI / 2);
    }
    // Thruster nubs along the outside, with glowing nozzles, and a crest module at the top.
    for (const deg of [-86, -58, -30, 30, 58, 86]) {
      const a = Math.PI / 2 + (deg * Math.PI) / 180;
      const dir: V3 = [Math.cos(a), Math.sin(a), 0];
      const base: V3 = [dir[0] * (RC + TR - 0.1), C + dir[1] * (RC + TR - 0.1), 0];
      orient(lit, shapes.frustum(0.7, 8), base, dir, 0.95, 1.5, 0.95, ramp(rgb("#6d7699"), HULL));
      orient(glow, shapes.frustum(0.8, 8), [base[0] + dir[0] * 1.45, base[1] + dir[1] * 1.45, 0], dir, 0.6, 0.45, 0.6, G_CYAN);
    }
    lit.box(0, C + RC + TR + 0.4, 0, 3.4, 1.6, 2.6, ramp(rgb("#6d7699"), HULL));
    glow.box(0, C + RC + TR + 0.4, 1.35, 2.2, 0.45, 0.1, G_PINK);
    glow.add(shapes.ball(0), xf(0, C + RC + TR + 1.6, 0, 0.45), G_WHITE);
    // The feet: heavy blocks where the ring meets the road line, trimmed with light.
    for (const s of [-1, 1]) {
      const fx = s * Math.sin(reach) * RC;
      lit.box(fx, -0.1, 0, 4.2, 3.6, 3.6, ramp(rgb("#4d5688"), HULL));
      lit.box(fx, -2.1, 0, 5.0, 0.6, 4.2, DARK);
      glow.box(fx - s * 0.6, 1.0, 1.85, 2.6, 0.3, 0.1, G_CYAN);
      glow.box(fx - s * 0.6, 1.0, -1.85, 2.6, 0.3, 0.1, G_CYAN);
    }
    for (let k = 0; k < 14; k++) {
      const a = arc[0] + 0.1 + ((arc[1] - arc[0] - 0.2) * k) / 13;
      halos.push({ x: Math.cos(a) * RC, y: C + Math.sin(a) * RC, z: 0, size: 7, colour: neonAt(k), alpha: 0.4, twinkle: 0.35 });
    }
    void ctx;
    return { lit, glow, glass, halos };
  },
};

// ─── Asteroid cluster ────────────────────────────────────────────────────────

LANDMARKS.asteroid = {
  footprint: 0,
  build() {
    const lit = new MeshBuilder();
    const glow = new MeshBuilder();
    const halos: Halo[] = [];
    const rock = (y0: number, y1: number): ReturnType<typeof byHeight> => byHeight(y0, y1, rgb("#3d3855"), rgb("#9d95bd"));
    // The main rock, 25 m across: craggy, grey-violet, lighter on top.
    rockBlob(lit, 0, 16, 0, 13, 11.5, 12.5, rock(4, 28), 5, { detail: 2, roughness: 0.3 });
    // Craters: dark flattened pits on the face turned to the road.
    for (const [x, y, z, r] of [[-3, 20, 11, 3.2], [5, 12, 10.5, 2.2], [2, 25, 7, 2.0]] as const) {
      orient(lit, shapes.ball(1), [x, y, z], [x * 0.07, (y - 16) * 0.07, z * 0.09], r, r * 0.35, r, rgb("#26233c"));
    }
    // Crystal clusters bursting from the rock.
    crystals(glow, [-9, 21, 8], [-0.7, 0.4, 0.6], 5, 4.6, 11, [G_CYAN, G_PINK]);
    crystals(glow, [8, 9, 10], [0.7, -0.2, 0.7], 4, 4.0, 40, [G_PINK, G_CYAN]);
    crystals(glow, [1, 27.5, -4], [0, 1, -0.2], 4, 3.6, 70, [G_CYAN, G_VIOLET]);
    halos.push({ x: -9, y: 22, z: 9, size: 13, colour: [0.6, 2.0, 2.6], alpha: 0.5, twinkle: 0.4 });
    halos.push({ x: 8, y: 10, z: 11, size: 11, colour: [2.6, 0.5, 1.8], alpha: 0.5, twinkle: 0.4 });
    halos.push({ x: 1, y: 29, z: -4, size: 10, colour: [0.8, 1.8, 2.8], alpha: 0.45, twinkle: 0.4 });

    // Four smaller rocks that bob and turn, each their own part.
    const smalls: { c: V3; r: number; seed: number; rate: number; phase: number }[] = [
      { c: [-23, 21, 6], r: 4.6, seed: 2, rate: 0.22, phase: 0 },
      { c: [22, 10, 11], r: 3.4, seed: 8, rate: -0.3, phase: 1.7 },
      { c: [-13, 33, -12], r: 2.6, seed: 4, rate: 0.4, phase: 3.1 },
      { c: [17, 28, -9], r: 2.0, seed: 9, rate: -0.5, phase: 4.6 },
    ];
    const moving: MovingPart[] = smalls.map((s, idx) => {
      const l = new MeshBuilder();
      const g = new MeshBuilder();
      rockBlob(l, s.c[0], s.c[1], s.c[2], s.r, s.r * 0.85, s.r * 0.95, rock(s.c[1] - s.r, s.c[1] + s.r), s.seed, { detail: 1, roughness: 0.3 });
      crystals(g, [s.c[0] + s.r * 0.55, s.c[1] + s.r * 0.5, s.c[2] + s.r * 0.5], [0.6, 0.5, 0.6], 3, s.r * 0.95, s.seed * 13, idx % 2 ? [G_PINK, G_CYAN] : [G_CYAN, G_PINK]);
      return {
        lit: l,
        glow: g,
        pivot: s.c,
        update(t, part) {
          part.rotation.y = s.rate * t + s.phase;
          part.rotation.x = 0.4 * Math.sin(t * 0.3 + s.phase);
          part.position.y = 0.9 * Math.sin(t * 0.55 + s.phase);
        },
      };
    });
    return { lit, glow, halos, moving };
  },
};

// ─── Satellite ───────────────────────────────────────────────────────────────

LANDMARKS.satellite = {
  footprint: 0,
  build() {
    const CY = 14;
    const bob = (t: number): number => 0.55 * Math.sin(t * 0.8);
    const halos: Halo[] = [];
    // The body: a gold-foil box with creases, silver rails, a lens on the road side, a dish on an arm, a thruster at the back.
    const body = new MeshBuilder();
    const bglow = new MeshBuilder();
    const foil = ramp(rgb("#b8862a"), FOIL);
    body.box(0, CY, 0, 6.4, 5.6, 8.4, foil);
    for (let k = 0; k < 9; k++) {
      const x = -2.6 + (k % 3) * 2.6;
      const y = CY - 1.9 + Math.floor(k / 3) * 1.9;
      body.box(x, y, 4.28, 2.1, 1.5, 0.12, mixRgb(FOIL, WHITE, (k % 4) * 0.08), 0, 0, (hash(k) - 0.5) * 0.12);
      body.box(x, y, -4.28, 2.1, 1.5, 0.12, mixRgb(FOIL, WHITE, (k % 4) * 0.08), 0, 0, (hash(k + 5) - 0.5) * 0.12);
    }
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) body.rod([sx * 3.3, CY + sy * 2.9, -4.4], [sx * 3.3, CY + sy * 2.9, 4.4], 0.34, STEEL);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) body.rod([sx * 3.3, CY - 2.9, sz * 4.4], [sx * 3.3, CY + 2.9, sz * 4.4], 0.34, STEEL);
    body.box(0, CY, 4.6, 2.6, 2.6, 0.3, DARK);
    bglow.add(shapes.ball(1), xf(0, CY, 4.8, 1.0, 1.0, 0.4), G_CYAN);
    body.box(0, CY + 3.05, -0.5, 4.4, 0.5, 6.0, ramp(DEEP_TEAL, TEAL));
    // The dish: a paraboloid bowl on a bent arm, with a feed horn on three struts.
    pipe(body, [0, CY + 3.1, -1.5], [0, CY + 5.8, -0.5], 0.28, STEEL, 6);
    pipe(body, [0, CY + 5.8, -0.5], [0, CY + 7.0, 1.4], 0.28, STEEL, 6);
    const dish: [number, number][] = [[0.0, 0], [0.9, 0.08], [1.8, 0.32], [2.7, 0.72], [3.6, 1.28], [3.7, 1.4]];
    const dishM = new Matrix4().compose(new Vector3(0, CY + 7.3, 1.9), new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 1.0), new Vector3(1, 1, 1));
    const dishB = new MeshBuilder();
    lathe(dishB, dish, { segments: 14, shade: byHeight(0, 1.4, rgb("#9aa4c4"), WHITE) });
    stamp(body, dishB, dishM);
    const horn = new Vector3(0, 1.7, 0).applyMatrix4(dishM);
    pipe(body, [horn.x, horn.y, horn.z], [horn.x, horn.y + 0.2, horn.z], 0.12 + 0.05, STEEL, 5);
    bglow.add(shapes.ball(0), xf(horn.x, horn.y + 0.35, horn.z, 0.3), G_WHITE);
    // The thruster: a bell with a glowing throat, and fuel tanks either side.
    const thrM = new Matrix4().compose(new Vector3(0, CY, -4.4), new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2), new Vector3(1, 1, 1));
    const thr = new MeshBuilder();
    lathe(thr, [[0.5, 0], [0.7, 0.8], [1.3, 2.0], [1.7, 2.8]], { segments: 10, shade: byHeight(0, 2.8, rgb("#555a78"), rgb("#c0c8e0")) });
    stamp(body, thr, thrM);
    bglow.add(shapes.cone(8), xf(0, CY, -5.7, 1.1, 1.8, 1.1, 0, -Math.PI / 2), G_CYAN);
    for (const s of [-1, 1]) {
      body.add(shapes.cylinder(10), xf(s * 2.0, CY - 3.7, -1, 1.0, 3.8, 1.0, 0, Math.PI / 2), ramp(rgb("#9aa4c4"), WHITE));
      body.blob(s * 2.0, CY - 3.7, 0.9, 1.0, 1.0, 1.0, WHITE, 0);
    }
    // Blinking lights: red to port, green to starboard.
    bglow.add(shapes.ball(0), xf(-3.5, CY + 2.9, 4.4, 0.35), G_RED);
    bglow.add(shapes.ball(0), xf(3.5, CY + 2.9, 4.4, 0.35), G_GREEN);
    halos.push({ x: -3.5, y: CY + 2.9, z: 4.4, size: 7, colour: [4, 0.4, 0.5], alpha: 0.8, twinkle: 0.95 });
    halos.push({ x: 3.5, y: CY + 2.9, z: 4.4, size: 7, colour: [0.6, 3.6, 1.2], alpha: 0.8, twinkle: 0.95 });
    halos.push({ x: 0, y: CY, z: 5.6, size: 8, colour: [0.5, 2.4, 3.0], alpha: 0.45, twinkle: 0.3 });

    const moving: MovingPart[] = [
      {
        lit: body,
        glow: bglow,
        pivot: [0, CY, 0],
        update(t, part) {
          part.position.y = bob(t);
        },
      },
    ];
    // Two big wings of solar cells, turning slowly to face the sun.
    for (const s of [-1, 1]) {
      const w = new MeshBuilder();
      w.rod([s * 3.2, CY, 0], [s * 5.4, CY, 0], 0.5, STEEL);
      w.box(s * 5.5, CY, 0, 0.6, 0.9, 5.4, STEEL);
      const x0 = s * 5.8;
      w.box(s * (5.8 + 3.6), CY - 0.12, 0, 7.4, 0.2, 5.4, rgb("#c4cbe4"));
      for (let i = 0; i < 5; i++) {
        for (let j = 0; j < 3; j++) {
          const cx = x0 + s * (0.8 + i * 1.42);
          const cz = (j - 1) * 1.7;
          w.box(cx, CY + 0.06, cz, 1.3, 0.2, 1.56, ramp(PANEL, mixRgb(BLUE, WHITE, 0.2 + 0.08 * ((i + j) % 2))));
        }
      }
      for (const z of [-2.75, 2.75]) w.box(s * (5.8 + 3.6), CY + 0.08, z, 7.4, 0.28, 0.2, STEEL);
      w.box(s * (5.8 + 7.5), CY, 0, 0.3, 0.3, 5.5, STEEL);
      moving.push({
        lit: w,
        pivot: [s * 3.2, CY, 0],
        update(t, part) {
          part.rotation.x = 0.45 * Math.sin(t * 0.22 + (s > 0 ? 0 : 0.3));
          part.position.y = bob(t);
        },
      });
    }
    return { lit: new MeshBuilder(), halos, moving };
  },
};

// ─── Space station ───────────────────────────────────────────────────────────

LANDMARKS["space-station"] = {
  footprint: 0,
  build() {
    const CY = 24;
    // Everything is built with the spine along x, then the whole station is turned and tilted so
    // that, from the road, the wheel is seen at an angle rather than edge on.
    const turn = new Matrix4().makeRotationY(0.62).multiply(new Matrix4().makeRotationZ(0.1));
    turn.setPosition(0, CY, 0);
    const axis = new Vector3(1, 0, 0).transformDirection(turn);

    const loc = new MeshBuilder();
    const locGlow = new MeshBuilder();
    const halos: Halo[] = [];
    const along = (cx: number, r: number, len: number, paint: Rgb | { bottom: Rgb; top: Rgb }, seg = 12): void => {
      loc.add(shapes.cylinder(seg), xf(cx, 0, 0, r, len, r, 0, 0, Math.PI / 2), paint);
    };
    // The spine: banded modules end to end, white with teal and orange bands.
    along(0, 4.6, 8, ramp(rgb("#9aa8c8"), HULL));
    for (const s of [-1, 1]) {
      along(s * 11, 2.3, 14, ramp(rgb("#8a98b8"), HULL));
      along(s * 21, 3.5, 9, ramp(rgb("#8a98b8"), HULL));
      along(s * 21, 3.6, 1.2, ORANGE);
      along(s * 18.4, 3.6, 0.9, TEAL);
      along(s * 23.6, 3.6, 0.9, TEAL);
      along(s * 29, 2.0, 6, ramp(rgb("#8a98b8"), HULL));
      along(s * 32.4, 2.7, 1.2, DEEP_TEAL);
      along(s * 33.6, 1.6, 1.4, rgb("#6d7699"));
      locGlow.add(shapes.cylinder(10), xf(s * 34.5, 0, 0, 1.2, 0.3, 1.2, 0, 0, Math.PI / 2), s > 0 ? G_CYAN : G_PINK);
      // Ribbed lab module windows (glow): a row along the top.
      for (let k = 0; k < 4; k++) locGlow.box(s * (18.5 + k * 1.7), 3.62, 0, 0.9, 0.12, 1.2, [2.6, 3.2, 3.8]);
    }
    along(0, 4.8, 1.0, ORANGE);
    // Cupola: a lit dome on the end module.
    loc.blob(-21, 3.6, 0, 2.0, 1.2, 2.0, rgb("#6d7699"), 0);
    locGlow.add(shapes.ball(1), xf(-21, 4.1, 0, 1.5, 0.95, 1.5), [2.6, 3.4, 4]);
    // Solar arrays on masts standing off the spine, up and down.
    for (const x of [-14, 14]) {
      loc.rod([x, -13, 0], [x, 13, 0], 0.9, STEEL);
      for (const s of [-1, 1]) {
        const cy = s * 7.6;
        loc.box(x, cy, 0.0, 7.2, 11.4, 0.28, ramp(rgb("#14297a"), BLUE));
        for (const gx of [-1.8, 0, 1.8]) loc.box(x + gx, cy, 0.22, 0.2, 11.4, 0.1, rgb("#a8b8ff"));
        for (const gy of [-3.2, 0, 3.2]) loc.box(x, cy + gy, 0.22, 7.2, 0.2, 0.1, rgb("#a8b8ff"));
        loc.box(x, cy + s * 5.9, 0, 7.8, 0.5, 0.6, STEEL);
      }
    }
    // The comms mast with dishes and a blinking beacon.
    loc.rod([-6, 4.0, 0], [-6, 15, 0], 0.5, STEEL);
    for (const [dy, r] of [[8.5, 1.5], [11.5, 1.1]] as const) {
      const d = new MeshBuilder();
      lathe(d, [[0, 0], [0.5 * r, 0.05 * r], [1.0 * r, 0.25 * r], [1.5 * r, 0.6 * r]], { segments: 10, shade: byHeight(0, r, rgb("#9aa4c4"), WHITE) });
      stamp(loc, d, new Matrix4().compose(new Vector3(-6, dy, 0), new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -Math.PI / 2 + 0.4), new Vector3(1, 1, 1)));
    }
    locGlow.add(shapes.ball(0), xf(-6, 15.4, 0, 0.45), G_RED);
    // Radiator fins in orange.
    for (const s of [-1, 1]) loc.box(s * 8, -4.3, 0, 5.2, 0.2, 5.4, ramp(rgb("#c25a22"), ORANGE));

    const fin = (src: MeshBuilder, dst: MeshBuilder): void => stamp(dst, src, turn);
    const lit = new MeshBuilder();
    const glow = new MeshBuilder();
    fin(loc, lit);
    fin(locGlow, glow);
    for (const x of [-34.5, 34.5]) {
      const p = new Vector3(x, 0, 0).applyMatrix4(turn);
      halos.push({ x: p.x, y: p.y, z: p.z, size: 7, colour: x < 0 ? [3.6, 0.5, 2.8] : [0.5, 3, 3.6], alpha: 0.45, twinkle: 0.4 });
    }
    {
      const p = new Vector3(-6, 15.4, 0).applyMatrix4(turn);
      halos.push({ x: p.x, y: p.y, z: p.z, size: 7, colour: [4, 0.4, 0.5], alpha: 0.8, twinkle: 0.95 });
      const c = new Vector3(-21, 4.1, 0).applyMatrix4(turn);
      halos.push({ x: c.x, y: c.y, z: c.z, size: 9, colour: [2.0, 2.6, 3.4], alpha: 0.45, twinkle: 0.2 });
    }

    // The habitat wheel turns about the spine: a thick ring, spokes and a row of lit windows.
    const wl = new MeshBuilder();
    const wg = new MeshBuilder();
    const RW = 17;
    const TW = 2.9;
    // Pale hull in bands, with an orange belt round the outer edge (two of the eight columns of the tube).
    torus(wl, RW, TW, {
      at: [0, 0, 0],
      facing: "x",
      ringSegments: 36,
      tubeSegments: 8,
      shade: (_p, i, j) => (j === 2 || j === 3 ? ORANGE : Math.floor(i / 2) % 2 === 0 ? HULL : rgb("#a9b6d6")),
    });
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * TAU;
      tube(wl, [[0, 0, 0], [0, Math.cos(a) * (RW - TW + 0.3), Math.sin(a) * (RW - TW + 0.3)]], { radius: 0.8, sides: 6, shade: HULL, caps: true });
    }
    wl.add(shapes.cylinder(12), xf(0, 0, 0, 5.2, 3.2, 5.2, 0, 0, Math.PI / 2), ramp(rgb("#8a98b8"), HULL));
    for (let k = 0; k < 36; k++) {
      const a = (k / 36) * TAU;
      const r = RW + TW + 0.02;
      wg.box(0, Math.cos(a) * r, Math.sin(a) * r, 3.4, 1.0, 0.18, k % 6 === 0 ? G_PINK : [3.0, 3.1, 3.6], 0, a - Math.PI / 2);
    }
    for (let k = 0; k < 18; k++) {
      const a = ((k + 0.5) / 18) * TAU;
      const r = RW - TW - 0.02;
      wg.box(0, Math.cos(a) * r, Math.sin(a) * r, 2.0, 0.7, 0.14, G_CYAN, 0, a - Math.PI / 2);
    }
    const wlit = new MeshBuilder();
    const wglow = new MeshBuilder();
    stamp(wlit, wl, turn);
    stamp(wglow, wg, turn);
    return {
      lit,
      glow,
      halos,
      moving: [
        {
          lit: wlit,
          glow: wglow,
          pivot: [0, CY, 0],
          update(t, part) {
            part.quaternion.setFromAxisAngle(axis, 0.07 * t);
          },
        },
      ],
    };
  },
};

// ─── Nebula ──────────────────────────────────────────────────────────────────

LANDMARKS.nebula = {
  footprint: 0,
  build() {
    const CY = 50;
    const glass = new MeshBuilder();
    const glow = new MeshBuilder();
    const halos: Halo[] = [];
    const palette: Rgb[] = [[0.62, 0.12, 0.5], [0.32, 0.18, 0.72], [0.06, 0.5, 0.5], [0.6, 0.22, 0.54], [0.22, 0.3, 0.7]];
    // Sixteen overlapping translucent blobs scattered through a cloud about 120 m across.
    for (let k = 0; k < 16; k++) {
      const a = hash(k + 1) * TAU;
      const rr = Math.pow(hash(k + 20), 0.7) * 40;
      const x = Math.cos(a) * rr;
      const z = Math.sin(a) * rr * 0.7;
      const y = CY + (hash(k + 40) - 0.5) * 36;
      const s = 14 + hash(k + 60) * 18;
      const col = palette[k % palette.length]!;
      glass.blob(x, y, z, s * 1.2, s * 0.75, s, ramp(scaleRgb(col, 0.35), col), 1, hash(k + 80) * 3);
      if (k % 2 === 0) glass.blob(x + 4, y - 3, z + 3, s * 0.65, s * 0.45, s * 0.6, scaleRgb(palette[(k + 2) % palette.length]!, 0.8), 0, hash(k + 90) * 3);
    }
    // Dense bright cores here and there.
    for (let k = 0; k < 6; k++) {
      const a = hash(k + 200) * TAU;
      const rr = hash(k + 210) * 26;
      const c: Rgb = k % 3 === 0 ? [2.2, 0.4, 1.8] : k % 3 === 1 ? [0.8, 0.6, 2.6] : [0.3, 2.0, 2.0];
      glow.blob(Math.cos(a) * rr, CY + (hash(k + 220) - 0.5) * 20, Math.sin(a) * rr * 0.7, 3.2 + hash(k + 230) * 2.4, 2.6 + hash(k + 240) * 1.6, 3.0, c, 1);
    }
    // Soft clouds of colour: big dim halos that give the cloud its airy edge.
    for (let k = 0; k < 9; k++) {
      const a = hash(k + 400) * TAU;
      const rr = hash(k + 410) * 46;
      const col: Rgb = k % 3 === 0 ? [2.6, 0.5, 2.0] : k % 3 === 1 ? [1.2, 0.8, 3.0] : [0.3, 2.0, 2.2];
      halos.push({ x: Math.cos(a) * rr, y: CY + (hash(k + 420) - 0.5) * 30, z: Math.sin(a) * rr * 0.7 + 6, size: 50 + hash(k + 430) * 40, colour: col, alpha: 0.07, twinkle: 0.15 });
    }
    // Stars inside: halos that twinkle, with a pinprick of glow at the middle of each.
    for (let k = 0; k < 26; k++) {
      const a = hash(k + 300) * TAU;
      const rr = Math.pow(hash(k + 310), 0.6) * 56;
      const x = Math.cos(a) * rr;
      const y = CY + (hash(k + 320) - 0.5) * 50;
      const z = Math.sin(a) * rr * 0.7 + 4;
      halos.push({ x, y, z, size: 2.5 + hash(k + 330) * 4, colour: k % 3 === 0 ? [1.6, 2.0, 3.4] : k % 3 === 1 ? [3.4, 2.4, 1.6] : [3.0, 1.2, 3.0], alpha: 0.5, twinkle: 0.7 });
      glow.box(x, y, z, 0.7, 0.7, 0.7, G_WHITE, 0.7, 0.6, 0.3);
    }
    return {
      lit: new MeshBuilder(),
      halos,
      moving: [
        {
          glass,
          glow,
          pivot: [0, CY, 0],
          update(t, part) {
            part.scale.setScalar(1 + 0.03 * Math.sin(t * 0.45));
          },
        },
      ],
    };
  },
};

// ─── Hazards ─────────────────────────────────────────────────────────────────

const _axis = new Vector3(0.35, 0.8, 0.45).normalize();

HAZARDS.asteroid = {
  build(ctx) {
    const rock = new MeshBuilder();
    const crystal = new MeshBuilder();
    rockBlob(rock, 0, 0, 0, 2.0, 1.7, 1.85, byHeight(-1.7, 1.8, rgb("#3a3028"), rgb("#a09080")), 4, { detail: 1, roughness: 0.28 });
    // A glowing vein of crystals on two sides.
    crystals(crystal, [1.2, 0.9, 1.1], [0.7, 0.5, 0.7], 3, 0.9, 5, [G_CYAN, G_PINK]);
    crystals(crystal, [-1.3, -0.6, -0.9], [-0.8, -0.4, -0.5], 2, 0.8, 21, [G_PINK, G_CYAN]);
    const inner = new Group();
    inner.add(new Mesh(rock.build(), ctx.lit), new Mesh(crystal.build(), ctx.glow));
    inner.position.y = 1.75;
    const root = new Group();
    root.add(inner);
    return {
      root,
      radius: 2,
      update(s) {
        inner.quaternion.setFromAxisAngle(_axis, s.time * 1.6);
      },
    };
  },
};

let cometGlass: MeshBasicMaterial | undefined;
function glassMaterial(): MeshBasicMaterial {
  cometGlass ??= new MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.5, depthWrite: false, side: DoubleSide });
  return cometGlass;
}

HAZARDS.comet = {
  build(ctx) {
    const core = new MeshBuilder();
    const shell = new MeshBuilder();
    const tail = new MeshBuilder();
    const dots = new MeshBuilder();
    const H = 1.6;
    core.add(shapes.ball(1), xf(0, H, 0, 1.0), [2.2, 3.0, 4.0]);
    shell.add(shapes.ball(1), xf(0, H, 0, 1.6), [0.6, 0.9, 1.6]);
    // A tapering tail of glass, and a hotter, thinner one inside it, both pointing back (-z).
    tail.add(shapes.cone(10), xf(0, H, -7.4, 1.35, 14, 1.35, 0, -Math.PI / 2), [0.35, 0.7, 1.4]);
    tail.add(shapes.cone(8), xf(0, H, -4.8, 0.75, 9, 0.75, 0, -Math.PI / 2), [1.4, 2.2, 3.2]);
    for (let k = 0; k < 22; k++) {
      const t = 1.4 + hash(k + 3) * 12.4;
      const spread = 0.2 + t * 0.07;
      const a = hash(k + 33) * TAU;
      dots.box(Math.cos(a) * spread * hash(k + 5), H + Math.sin(a) * spread * hash(k + 7), -t, 0.28 + hash(k) * 0.2, 0.28, 0.28, k % 3 === 0 ? [3.2, 2.6, 3.8] : [1.2, 2.4, 3.6], 0.6, 0.5, 0.3);
    }
    const root = new Group();
    const tailGroup = new Group();
    tailGroup.position.y = H;
    // The tail is built about the head's height; pull it back to the group's origin so it can be scaled from the head.
    const tailMesh = new Mesh(tail.build(), glassMaterial());
    tailMesh.position.y = -H;
    const dotMesh = new Mesh(dots.build(), ctx.glow);
    dotMesh.position.y = -H;
    tailGroup.add(tailMesh, dotMesh);
    const head = new Mesh(core.build(), ctx.glow);
    const hull = new Mesh(shell.build(), glassMaterial());
    root.add(head, hull, tailGroup);
    return {
      root,
      radius: 1.6,
      update(s) {
        // The tail streams and flickers; the head shimmers a little.
        tailGroup.scale.set(1 + 0.05 * Math.sin(s.time * 17), 1 + 0.05 * Math.sin(s.time * 13 + 1), 1 + 0.12 * Math.sin(s.time * 9));
        head.scale.setScalar(1 + 0.06 * Math.sin(s.time * 23));
        hull.rotation.y = s.time * 2;
      },
    };
  },
};
