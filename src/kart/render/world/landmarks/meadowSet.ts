/**
 * Meadow Loop's second pass: the farm gate whose lantern blinks before the flock crosses, the great oak over the creek
 * road, the round bale that rolls down the windmill's hill and the flock of sheep that trots across the road (all
 * named in docs/GRIP_PRIX.md; the acorns that drop from the oak are a set piece, world/pieceSet.ts).
 */
import { Group, Mesh } from "three";
import { SHEEP_PERIOD } from "../../../track/tracks";
import { byHeight, lathe, MeshBuilder, mixRgb, ramp, rgb, scaleRgb, shapes, xf, type Rgb, type V3 } from "./kit";
import type { HazardSpec, LandmarkSpec, MovingPart } from "./types";

const TAU = Math.PI * 2;
const WOOD = rgb("#9a6a3c");
const WOOD_D = rgb("#6b4526");
const STONE = rgb("#9aa0a6");
const STRAW = rgb("#e9c456");
const STRAW_D = rgb("#b98d2c");
const LEAF_D = rgb("#2c7a30");
const LEAF = rgb("#4fb33f");
const LEAF_L = rgb("#8fdc4a");
const WOOL: Rgb = [1.0, 0.97, 0.88];

/** Is the flock about to cross? True in the last fifth of its cycle: the same cycle the road's hazard keeps (track/hazards.ts, "slide"). */
export function sheepWarning(race: number): number {
  const u = (((race / SHEEP_PERIOD) % 1) + 1) % 1;
  return u > 0.78 ? (u - 0.78) / 0.22 : 0;
}

// ─── Farm gate ───────────────────────────────────────────────────────────────

/**
 * A field gate in a stone-and-hedge gap, swung open into the field, with a lantern on a tall post and a yellow sign: the
 * lantern blinks once the flock is on its way (the road's own hazard says when; `sheepWarning`). Built facing the road.
 */
const farmGate: LandmarkSpec = {
  footprint: 6,
  build() {
    const lit = new MeshBuilder();
    // Two stone posts with a cap each, and a low dry-stone wall running off either side.
    for (const x of [-3.2, 3.2]) {
      lit.box(x, 1.4, 0, 1.3, 3.0, 1.3, ramp(scaleRgb(STONE, 0.4), scaleRgb(STONE, 0.62)));
      lit.box(x, 3.15, 0, 1.6, 0.35, 1.6, scaleRgb(STONE, 0.8));
    }
    for (const s of [-1, 1]) {
      for (let i = 0; i < 4; i++) {
        lit.box(s * (5.8 + i * 2.0), 0.55 + (i % 2) * 0.06, 0, 2.1, 1.1, 0.9, ramp(scaleRgb(STONE, 0.4), scaleRgb(STONE, 0.66)), s * 0.05 * i);
      }
    }
    // The gate itself, a five-bar leaf hung on the left post and swung open about seventy degrees.
    const hinge: V3 = [-2.5, 0, 0.2];
    const ang = 1.2;
    const along = (u: number, y: number): V3 => [hinge[0] + Math.cos(ang) * u, y, hinge[2] - Math.sin(ang) * u];
    for (const y of [0.45, 0.95, 1.45, 1.95, 2.45]) lit.rod(along(0, y), along(4.6, y), 0.16, WOOD);
    for (const u of [0.1, 2.3, 4.5]) lit.rod(along(u, 0.3), along(u, 2.6), 0.2, WOOD_D);
    lit.rod(along(0.1, 0.4), along(4.5, 2.6), 0.14, WOOD_D);
    // A tall lantern post beside the gate, with a hood and a yellow warning sign below it.
    lit.post(4.4, 0, 1.0, 0.18, 4.6, WOOD_D, 6);
    lit.box(4.4, 4.75, 1.0, 0.9, 0.12, 0.9, rgb("#3a2a1a"));
    lit.box(4.4, 5.35, 1.0, 1.0, 0.18, 1.0, rgb("#7a2a1a"));
    for (const dx of [-0.38, 0.38]) for (const dz of [-0.38, 0.38]) lit.rod([4.4 + dx, 4.8, 1.0 + dz], [4.4 + dx, 5.3, 1.0 + dz], 0.07, rgb("#2a2a30"));
    lit.box(4.4, 3.1, 1.0 + 0.13, 1.7, 1.7, 0.1, rgb("#ffd21a"), 0, 0, Math.PI / 4);
    lit.blob(4.4, 3.0, 1.0 + 0.2, 0.3, 0.18, 0.05, rgb("#222"), 0);
    lit.blob(4.4 + 0.3, 3.05, 1.0 + 0.2, 0.12, 0.1, 0.05, rgb("#222"), 0);
    // The lantern's flame: a glow that is lit only while the flock is coming.
    const flame = new MeshBuilder();
    flame.blob(4.4, 4.98, 1.0, 0.32, 0.36, 0.32, [3.0, 1.3, 0.25], 1);
    const lamp: MovingPart = {
      glow: flame,
      pivot: [4.4, 4.98, 1.0],
      update(t, part, race = 0) {
        const warn = sheepWarning(race);
        const on = warn > 0 && Math.sin(race * 13) > -0.35;
        part.scale.setScalar(on ? 1 + 0.4 * warn : 0.0001);
      },
    };
    // A dim glass and hood always show, so the post reads when it is dark.
    const glass = new MeshBuilder();
    glass.blob(4.4, 4.98, 1.0, 0.36, 0.4, 0.36, [0.35, 0.28, 0.14], 1);
    return { lit, glass, moving: [lamp], halos: [{ x: 4.4, y: 5.0, z: 1.0, size: 3.2, colour: [1.6, 0.8, 0.2], alpha: 0.18 }] };
  },
};

// ─── The oak ─────────────────────────────────────────────────────────────────

/** A broad old oak: a flared trunk, three boughs and a canopy in clumps; the creek road's acorns hang from its gantry. */
const oak: LandmarkSpec = {
  footprint: 9,
  build(ctx) {
    const lit = new MeshBuilder();
    const r = ctx.rnd;
    // Roots, flaring into the trunk, then the trunk itself tapering up.
    lathe(lit, [[0, -1.2], [2.6, -1.2], [2.3, 0.6], [1.45, 2.0], [1.2, 5.0], [1.0, 8.0], [0.85, 10.0]], { segments: 9, shade: byHeight(-1.2, 10, scaleRgb(WOOD_D, 0.75), WOOD) });
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * TAU + r() * 0.4;
      lit.rod([Math.cos(a) * 0.8, 1.6, Math.sin(a) * 0.8], [Math.cos(a) * 2.9, -0.2, Math.sin(a) * 2.9], 0.9, WOOD_D);
    }
    // Boughs: three big limbs out and up from the top of the trunk.
    const tops: V3[] = [];
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * TAU + 0.5 + r() * 0.3;
      const tip: V3 = [Math.cos(a) * 5.0, 12.5 + k * 0.6, Math.sin(a) * 5.0];
      lit.rod([0, 8.6, 0], tip, 0.95, ramp(WOOD_D, WOOD));
      tops.push(tip);
    }
    // The canopy: clumps of leaves on the limbs and over the top, dark underneath and bright on top.
    const clump = (x: number, y: number, z: number, rad: number): void => lit.blob(x, y, z, rad, rad * 0.78, rad, ramp(LEAF_D, mixRgb(LEAF, LEAF_L, r() * 0.7)), 1);
    clump(0, 15.4, 0, 5.4);
    for (const t of tops) clump(t[0], t[1] + 1.6, t[2], 4.3);
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * TAU + 0.9;
      clump(Math.cos(a) * 6.4, 12.8 + r() * 1.5, Math.sin(a) * 6.4, 3.4);
    }
    // A swing hung from the lowest limb: two ropes and a plank.
    lit.rod([2.9, 11.6, 0.3], [2.9, 3.0, 0.3], 0.1, rgb("#caa974"));
    lit.rod([4.1, 11.9, 0.3], [4.1, 3.0, 0.3], 0.1, rgb("#caa974"));
    lit.box(3.5, 2.9, 0.3, 1.7, 0.16, 0.6, WOOD);
    // Acorns scattered round the foot, and a few leaves.
    for (let k = 0; k < 8; k++) {
      const a = r() * TAU;
      const d = 3 + r() * 3;
      lit.blob(Math.cos(a) * d, -0.05, Math.sin(a) * d, 0.18, 0.2, 0.18, rgb("#b0782f"), 0);
    }
    return { lit };
  },
};

// ─── Round bale ──────────────────────────────────────────────────────────────

/** A round hay bale on its side, wrapped in net, rolling down the hill: it turns by the distance it has gone. */
export const hayRoll: HazardSpec = {
  build(ctx) {
    const b = new MeshBuilder();
    const turn = (rx: number) => xf(0, 0, 0, 1, rx, 1, 0, 0, Math.PI / 2);
    // The cylinder lies along x (its axis across the hill), with a darker spiral on each face and two bands of net.
    b.add(shapes.cylinder(14), turn(1.7), ramp(STRAW_D, STRAW));
    for (const x of [-0.55, 0.55]) b.add(shapes.cylinder(14), xf(x, 0, 0, 1.03, 0.12, 1.03, 0, 0, Math.PI / 2), rgb("#6a5a3a"));
    for (const x of [-0.86, 0.86]) {
      b.add(shapes.cylinder(14), xf(x, 0, 0, 0.62, 0.06, 0.62, 0, 0, Math.PI / 2), STRAW_D);
      b.add(shapes.cylinder(14), xf(x * 1.01, 0, 0, 0.3, 0.07, 0.3, 0, 0, Math.PI / 2), rgb("#8a6a20"));
    }
    // Loose straws sticking out of the round.
    for (let k = 0; k < 10; k++) {
      const a = k * 2.1;
      const x = ((k * 37) % 17) / 17 - 0.5;
      b.rod([x * 1.5, Math.cos(a) * 0.98, Math.sin(a) * 0.98], [x * 1.5, Math.cos(a) * 1.18, Math.sin(a) * 1.18], 0.05, STRAW);
    }
    const spin = new Group();
    spin.add(new Mesh(b.build(), ctx.lit));
    spin.position.y = 1;
    const root = new Group();
    root.add(spin);
    return {
      root,
      radius: 1,
      update(s) {
        // Rolling without slipping: the turn is the way gone over the radius (the layer scaled the root to the hazard's radius).
        spin.rotation.x = s.travel / (root.scale.x || 1);
      },
    };
  },
};

// ─── Sheep ───────────────────────────────────────────────────────────────────

/** A little flock trotting across the road together: four sheep, woolly and sturdy, legs going and a bob in the step. */
export const sheepFlock: HazardSpec = {
  build(ctx) {
    const body = new MeshBuilder();
    const wool = ramp(scaleRgb(WOOL, 0.78), WOOL);
    const dark = rgb("#3a3a40");
    // One sheep, facing +z: a fleece of lumps, a dark face with ears, a short tail.
    body.blob(0, 0.95, 0, 0.55, 0.5, 0.8, wool, 1);
    body.blob(0.2, 1.2, 0.2, 0.36, 0.3, 0.36, wool, 1);
    body.blob(-0.22, 1.18, -0.25, 0.36, 0.3, 0.36, wool, 1);
    body.blob(0, 1.4, 0.45, 0.3, 0.26, 0.3, wool, 1);
    body.blob(0, 1.15, 0.92, 0.2, 0.22, 0.3, dark, 1);
    body.blob(0, 1.12, 1.12, 0.12, 0.12, 0.1, scaleRgb(dark, 1.4), 0);
    for (const x of [-0.24, 0.24]) body.blob(x, 1.25, 0.88, 0.1, 0.06, 0.18, scaleRgb(dark, 0.9), 0);
    body.blob(0, 0.9, -0.82, 0.14, 0.14, 0.16, wool, 0);
    const legsAB = (diag: 1 | -1): MeshBuilder => {
      const l = new MeshBuilder();
      // Two legs on a diagonal, hung from the hip (y = 0.6 is their pivot, moved to 0).
      for (const [x, z] of [[0.26 * diag, 0.5], [-0.26 * diag, -0.5]] as const) {
        l.post(x, -0.6, z, 0.07, 0.62, dark, 5);
      }
      return l;
    };
    const bodyGeo = body.build();
    const legAGeo = legsAB(1).build();
    const legBGeo = legsAB(-1).build();
    const root = new Group();
    const sheep: { holder: Group; a: Group; b: Group }[] = [];
    // The flock's places in its 2.2 m circle, each a little different in size and step.
    const places: [number, number, number][] = [[-1.1, -0.6, 0.0], [1.15, -0.2, 1.7], [-0.3, 1.0, 3.1], [0.6, -1.5, 4.4]];
    places.forEach(([x, z, phase], i) => {
      const holder = new Group();
      holder.position.set(x, 0, z);
      holder.rotation.y = (i % 2 ? 0.1 : -0.12);
      holder.scale.setScalar(0.92 + 0.08 * (i % 3));
      const m = new Mesh(bodyGeo, ctx.lit);
      const a = new Group();
      const b = new Group();
      a.position.y = 0.6;
      b.position.y = 0.6;
      a.add(new Mesh(legAGeo, ctx.lit));
      b.add(new Mesh(legBGeo, ctx.lit));
      holder.add(m, a, b);
      holder.userData.phase = phase;
      root.add(holder);
      sheep.push({ holder, a, b });
    });
    return {
      root,
      radius: 2.2,
      update(s) {
        sheep.forEach(({ holder, a, b }, i) => {
          const trot = Math.sin(s.travel * 3.4 + (holder.userData.phase as number));
          a.rotation.x = trot * 0.7;
          b.rotation.x = -trot * 0.7;
          holder.position.y = Math.abs(trot) * 0.07;
          holder.rotation.z = trot * 0.03 * (i % 2 ? 1 : -1);
        });
      },
    };
  },
};

export const LANDMARKS: Record<string, LandmarkSpec> = { "farm-gate": farmGate, oak };
export const HAZARDS: Record<string, HazardSpec> = { "hay-roll": hayRoll, "sheep-flock": sheepFlock };
