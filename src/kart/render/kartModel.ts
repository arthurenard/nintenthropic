/**
 * The procedural toy kart: built in code from a few lofted and boxed shapes,
 * flat shaded, in the racer's colour. An original design: a low rounded tub
 * with a white stripe, big chunky wheels with five-spoked hubs, a round-
 * helmeted driver at a small steering wheel, chrome exhausts out the back.
 *
 * Built facing +z; its left is +x (so its right is -x), the way
 * `rotation.y = heading` expects (contract.ts). A Blender glTF can replace
 * the whole thing behind `KartFactory` (kart.ts) without anything noticing.
 */
import {
  AdditiveBlending,
  BufferGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
} from "three";
import type { RacerSetup } from "../contract";
import { TAU } from "./math";
import { MeshBuilder, mixRgb, rgb, scaleRgb, shapes, xf, type Rgb, type V3 } from "./world/builder";
import type { KartModel } from "./kart";

const WHEEL_FRONT = { x: 0.86, y: 0.36, z: 0.94, r: 0.36, w: 0.3 };
const WHEEL_REAR = { x: 0.95, y: 0.43, z: -0.84, r: 0.43, w: 0.42 };
/** Where the rear wheels and exhausts are, for effects: metres to the right of, and ahead of, the kart's centre. */
export const KART_REAR_WHEEL = { right: WHEEL_REAR.x, forward: WHEEL_REAR.z };
export const KART_EXHAUST = { right: 0.3, forward: -1.5, y: 0.64 };

/** One cross-section of the tub: half width, bottom and top heights, and how much its corners are cut. */
interface Section {
  z: number;
  hw: number;
  yb: number;
  yt: number;
  c: number;
  /** Half width of the stripe on top. */
  stripe: number;
}

/** A cross-section as ten points round the tub (x, y), from the bottom left, clockwise seen from behind. */
function ring(s: Section): [number, number][] {
  const { hw, yb, yt, c, stripe } = s;
  return [
    [-hw + c, yb],
    [hw - c, yb],
    [hw, yb + c],
    [hw, yt - c],
    [hw - c, yt],
    [stripe, yt],
    [-stripe, yt],
    [-hw + c, yt],
    [-hw, yt - c],
    [-hw, yb + c],
  ];
}

/**
 * Skins a series of sections with quads, each edge in its own colour pair so
 * the tub shades softly from a dark underside to a bright top, with the
 * stripe in white. Quads are wound to face outward whatever the order.
 */
function loft(b: MeshBuilder, sections: Section[], edges: [Rgb, Rgb][], capRear: Rgb, capFront: Rgb): void {
  const centre = (s: Section): V3 => [0, (s.yb + s.yt) / 2, s.z];
  const pts = sections.map((s) => ring(s).map(([x, y]): V3 => [x, y, s.z]));
  const outward = (a: V3, bq: V3, c: V3, d: V3, from: V3, ca: Rgb, cb: Rgb, cc: Rgb, cd: Rgb) => {
    const mx = (a[0] + bq[0] + c[0] + d[0]) / 4 - from[0];
    const my = (a[1] + bq[1] + c[1] + d[1]) / 4 - from[1];
    const mz = (a[2] + bq[2] + c[2] + d[2]) / 4 - from[2];
    const ux = bq[0] - a[0];
    const uy = bq[1] - a[1];
    const uz = bq[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    if (nx * mx + ny * my + nz * mz >= 0) b.quad(a, bq, c, d, ca, cb, cc, cd);
    else b.quad(a, d, c, bq, ca, cd, cc, cb);
  };
  for (let k = 0; k < sections.length - 1; k++) {
    const A = pts[k]!;
    const B = pts[k + 1]!;
    const mid: V3 = [0, (centre(sections[k]!)[1] + centre(sections[k + 1]!)[1]) / 2, (sections[k]!.z + sections[k + 1]!.z) / 2];
    for (let i = 0; i < A.length; i++) {
      const j = (i + 1) % A.length;
      const e = edges[i]!;
      outward(A[i]!, A[j]!, B[j]!, B[i]!, mid, e[0], e[1], e[1], e[0]);
    }
  }
  // End caps, as fans.
  const cap = (ringPts: V3[], s: Section, colour: Rgb, dir: 1 | -1) => {
    const c = centre(s);
    for (let i = 0; i < ringPts.length; i++) {
      const j = (i + 1) % ringPts.length;
      const a = ringPts[i]!;
      const bq = ringPts[j]!;
      // Wind toward +z for the front, -z for the rear.
      const ux = a[0] - c[0];
      const uy = a[1] - c[1];
      const vx = bq[0] - c[0];
      const vy = bq[1] - c[1];
      const crossZ = ux * vy - uy * vx;
      if (crossZ * dir >= 0) b.tri(c, a, bq, colour);
      else b.tri(c, bq, a, colour);
    }
  };
  cap(pts[0]!, sections[0]!, capRear, -1);
  cap(pts[pts.length - 1]!, sections[sections.length - 1]!, capFront, 1);
}

/** A thin box from point a to point c, for limbs and rods. */
function limb(b: MeshBuilder, a: V3, c: V3, thickness: number, paint: Rgb): void {
  b.rod(a, c, thickness, paint);
}

function wheelGeometry(spec: { r: number; w: number }, hubColour: Rgb): BufferGeometry {
  const b = new MeshBuilder();
  const rubber = rgb("#22242b");
  const sidewall = rgb("#3b3f4b");
  const silver = rgb("#e2e6ee");
  const steel = rgb("#7e8696");
  const { r, w } = spec;
  // The tyre, axis along x; a slightly lighter rubber on top of the tread so it reads as round.
  b.add(shapes.cylinder(16), xf(0, 0, 0, r, w, r, 0, 0, Math.PI / 2), { bottom: rubber, top: scaleRgb(rubber, 1.5) });
  for (const side of [-1, 1]) {
    b.add(shapes.cylinder(16), xf(side * (w / 2 + 0.004), 0, 0, r * 0.84, 0.014, r * 0.84, 0, 0, Math.PI / 2), sidewall);
    // The hub and its spokes: pentagonal, so a turning wheel reads as turning.
    b.add(shapes.cylinder(5), xf(side * (w / 2 + 0.03), 0, 0, r * 0.58, 0.05, r * 0.58, 0, 0, Math.PI / 2), silver);
    b.add(shapes.cylinder(5), xf(side * (w / 2 + 0.065), 0, 0, r * 0.28, 0.06, r * 0.28, 0.3, 0, Math.PI / 2), hubColour);
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * TAU;
      b.add(shapes.box(), xf(side * (w / 2 + 0.055), Math.cos(a) * r * 0.42, Math.sin(a) * r * 0.42, 0.035, r * 0.06, r * 0.5, 0, a, 0), steel);
    }
  }
  return b.build();
}

export function createProceduralKart(racer: Pick<RacerSetup, "id" | "colour">): KartModel {
  const body = rgb(racer.colour);
  const top = mixRgb(body, [1, 1, 1], 0.1);
  const flank = scaleRgb(body, 0.86);
  const lower = scaleRgb(body, 0.62);
  const deep = scaleRgb(body, 0.4);
  const white = rgb("#f6f7fa");
  const dark = rgb("#3a3e4a");
  const darker = rgb("#262932");
  const silver = rgb("#d5dae4");

  // ── Chassis: everything that does not move relative to the kart ─────────
  const c = new MeshBuilder();
  const sections: Section[] = [
    { z: -1.22, hw: 0.5, yb: 0.3, yt: 0.62, c: 0.14, stripe: 0.09 },
    { z: -0.98, hw: 0.62, yb: 0.27, yt: 0.86, c: 0.2, stripe: 0.1 },
    { z: -0.34, hw: 0.67, yb: 0.26, yt: 0.82, c: 0.22, stripe: 0.1 },
    { z: 0.12, hw: 0.56, yb: 0.26, yt: 0.68, c: 0.18, stripe: 0.1 },
    { z: 0.62, hw: 0.46, yb: 0.27, yt: 0.58, c: 0.16, stripe: 0.09 },
    { z: 1.18, hw: 0.36, yb: 0.28, yt: 0.5, c: 0.14, stripe: 0.08 },
    { z: 1.52, hw: 0.27, yb: 0.3, yt: 0.44, c: 0.12, stripe: 0.07 },
  ];
  const edges: [Rgb, Rgb][] = [
    [deep, deep],
    [deep, lower],
    [lower, flank],
    [flank, top],
    [top, top],
    [white, white],
    [top, top],
    [top, flank],
    [flank, lower],
    [lower, deep],
  ];
  loft(c, sections, edges, flank, flank);

  // A dark floor pan under it, and suspension arms out to the front wheels.
  c.box(0, 0.24, 0.1, 1.0, 0.08, 2.5, darker);
  for (const sx of [-1, 1]) c.box(sx * 0.58, 0.36, WHEEL_FRONT.z, 0.34, 0.07, 0.12, dark);
  // The seat: a dark shell the driver sits in, and its backrest.
  c.box(0, 0.88, -0.22, 0.62, 0.12, 0.62, dark);
  c.box(0, 1.1, -0.56, 0.6, 0.46, 0.14, { bottom: lower, top: flank }, 0, 0.22);
  // Engine cover behind the seat with its fins.
  c.box(0, 0.92, -1.02, 0.7, 0.3, 0.46, { bottom: darker, top: dark });
  for (let k = 0; k < 3; k++) c.box(0, 1.02 + k * 0.05, -1.26, 0.58 - k * 0.06, 0.03, 0.05, silver);
  // Exhausts: two chrome pipes out of the tail, a little raised, with dark mouths.
  for (const sx of [-1, 1]) {
    const x = sx * KART_EXHAUST.right;
    const len = 0.46;
    c.add(shapes.cylinder(9), xf(x, (0.58 + KART_EXHAUST.y) / 2, KART_EXHAUST.forward + len / 2 - 0.02, 0.085, len, 0.085, 0, Math.PI / 2 - 0.1, 0), { bottom: scaleRgb(silver, 0.7), top: silver });
    c.add(shapes.cylinder(9), xf(x, KART_EXHAUST.y + 0.005, KART_EXHAUST.forward - 0.01, 0.07, 0.04, 0.07, 0, Math.PI / 2 - 0.1, 0), [0.02, 0.02, 0.03]);
  }
  // A small ducktail spoiler on the tail, in the kart's colour, with white end fins.
  c.box(0, 0.95, -1.3, 1.16, 0.05, 0.3, top, 0, 0.12);
  for (const sx of [-1, 1]) c.box(sx * 0.57, 0.99, -1.3, 0.05, 0.16, 0.34, white, 0, 0.12);
  // Front bumper and wing.
  c.box(0, 0.38, 1.48, 1.36, 0.14, 0.2, dark);
  for (const sx of [-1, 1]) c.box(sx * 0.7, 0.42, 1.44, 0.14, 0.2, 0.26, flank);
  c.box(0, 0.3, 1.64, 1.46, 0.04, 0.3, white);
  // Lamps, overbright so they glow: headlights at the nose, tail lights at the back.
  for (const sx of [-1, 1]) {
    c.add(shapes.cylinder(10), xf(sx * 0.2, 0.5, 1.5, 0.1, 0.05, 0.1, 0, Math.PI / 2, 0), [5, 4.6, 3.4]);
    c.box(sx * 0.4, 0.76, -1.24, 0.2, 0.06, 0.04, [2.4, 0.1, 0.08]);
  }
  const chassisGeo = c.build();

  // ── The driver: torso and arms (lean), helmet (turns), steering wheel (turns by steer) ──
  const d = new MeshBuilder();
  const suit = mixRgb(white, body, 0.1);
  d.box(0, 0.3, 0.0, 0.5, 0.56, 0.3, { bottom: scaleRgb(suit, 0.72), top: suit }, 0, 0.16);
  d.box(0, 0.08, 0.04, 0.52, 0.1, 0.32, lower);
  d.box(0, 0.5, 0.1, 0.5, 0.12, 0.12, top);
  for (const sx of [-1, 1]) {
    limb(d, [sx * 0.29, 0.46, 0.02], [sx * 0.19, 0.2, 0.46], 0.13, suit);
    d.blob(sx * 0.19, 0.2, 0.5, 0.085, 0.085, 0.085, darker, 0);
    limb(d, [sx * 0.14, -0.02, -0.06], [sx * 0.3, -0.04, 0.36], 0.16, scaleRgb(suit, 0.82));
  }
  const torsoGeo = d.build();

  const h = new MeshBuilder();
  h.blob(0, 0, 0, 0.3, 0.29, 0.31, { bottom: lower, top }, 1);
  // Visor, a glint on it, and a stripe over the crown.
  h.blob(0, 0.0, 0.14, 0.25, 0.115, 0.2, [0.04, 0.06, 0.13], 1);
  h.blob(0.08, 0.04, 0.27, 0.07, 0.025, 0.04, [1.4, 1.6, 2.0], 0);
  h.blob(0, 0.04, -0.02, 0.034, 0.32, 0.33, white, 0);
  const headGeo = h.build();

  const w = new MeshBuilder();
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * TAU;
    w.add(shapes.box(), xf(Math.cos(a) * 0.17, Math.sin(a) * 0.17, 0, 0.1, 0.05, 0.06, 0, 0, a + Math.PI / 2), k === 0 ? top : dark);
  }
  w.box(0, 0, 0, 0.3, 0.04, 0.04, dark);
  w.box(0, 0, 0, 0.04, 0.3, 0.04, dark);
  const wheelRimGeo = w.build();

  const flame = new MeshBuilder();
  flame.add(shapes.cone(8), xf(0, 0, -0.8, 0.3, 1.6, 0.3, 0, -Math.PI / 2, 0), [1.4, 0.5, 0.07]);
  flame.add(shapes.cone(8), xf(0, 0, -0.55, 0.16, 1.1, 0.16, 0, -Math.PI / 2, 0), [0.6, 0.9, 1.9]);
  const flameGeo = flame.build();

  const frontGeo = wheelGeometry(WHEEL_FRONT, top);
  const rearGeo = wheelGeometry(WHEEL_REAR, top);

  const lit = new MeshLambertMaterial({ vertexColors: true });
  const flameMat = new MeshBasicMaterial({ vertexColors: true, blending: AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.9, fog: false });

  const root = new Group();
  const bodyGroup = new Group();
  root.add(bodyGroup);
  bodyGroup.add(new Mesh(chassisGeo, lit));

  // The driver pivots at the hip.
  const driver = new Group();
  driver.position.set(0, 0.92, -0.28);
  driver.add(new Mesh(torsoGeo, lit));
  const head = new Group();
  head.position.set(0, 0.84, 0.06);
  head.add(new Mesh(headGeo, lit));
  driver.add(head);
  bodyGroup.add(driver);

  const wheelPivot = new Group();
  wheelPivot.position.set(0, 1.04, 0.24);
  wheelPivot.rotation.x = -0.95;
  const wheelRim = new Mesh(wheelRimGeo, lit);
  wheelPivot.add(wheelRim);
  bodyGroup.add(wheelPivot);

  const flames: Mesh[] = [];
  for (const sx of [-1, 1]) {
    const f = new Mesh(flameGeo, flameMat);
    f.position.set(sx * KART_EXHAUST.right, KART_EXHAUST.y, KART_EXHAUST.forward - 0.1);
    f.visible = false;
    bodyGroup.add(f);
    flames.push(f);
  }

  const fronts: { pivot: Group; mesh: Mesh }[] = [];
  const rears: Mesh[] = [];
  for (const sx of [-1, 1]) {
    const pivot = new Group();
    pivot.position.set(sx * WHEEL_FRONT.x, WHEEL_FRONT.y, WHEEL_FRONT.z);
    const mesh = new Mesh(frontGeo, lit);
    pivot.add(mesh);
    root.add(pivot);
    fronts.push({ pivot, mesh });
    const rear = new Mesh(rearGeo, lit);
    rear.position.set(sx * WHEEL_REAR.x, WHEEL_REAR.y, WHEEL_REAR.z);
    root.add(rear);
    rears.push(rear);
  }

  return {
    root,
    pose(p) {
      bodyGroup.position.y = p.hop + p.shake;
      bodyGroup.rotation.set(-p.pitch, p.slide, p.roll, "YXZ");
      driver.rotation.z = p.lean;
      head.rotation.y = -p.steer * 0.4;
      head.rotation.z = -p.lean * 0.35;
      wheelRim.rotation.z = -p.steer * 1.5;
      for (const f of fronts) {
        f.pivot.rotation.y = -p.steer * 0.5;
        f.mesh.rotation.x = p.wheelSpin;
      }
      for (const r of rears) r.rotation.x = p.wheelSpin;
      const on = p.flame > 0.02;
      for (const f of flames) {
        f.visible = on;
        if (on) {
          const s = p.flame * (0.8 + 0.5 * p.flicker);
          f.scale.set(1, 1, 0.5 + s * 1.7);
        }
      }
    },
    dispose() {
      for (const g of [chassisGeo, torsoGeo, headGeo, wheelRimGeo, flameGeo, frontGeo, rearGeo]) g.dispose();
      lit.dispose();
      flameMat.dispose();
    },
  };
}
