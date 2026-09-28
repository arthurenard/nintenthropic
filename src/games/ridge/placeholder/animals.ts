import { Group, Matrix4, Quaternion, Vector3, type AnimationClip } from "three";
import type { LoadedAsset } from "../../../engine/types";
import { nameNode } from "../../../engine/world/names";
import {
  ClipSet,
  Materials,
  Poser,
  SkinGeometry,
  ball,
  blob,
  box,
  buildSkeleton,
  cap,
  cyl,
  degreesOf,
  mirror,
  pose,
  type BoneDef,
  type Key,
  type Pose,
  type SkinPoints,
  type V3,
} from "./skin";

/**
 * The placeholder animals (animals.glb): a cow, a sheep, a goat, an eagle
 * and a dog, each under its own top-level node with its own small armature
 * and skinned mesh, and clips named `<animal>.<clip>` that move only that
 * animal's bones. Bone names repeat from one animal to the next (each has a
 * `body`, a `neck`, a `head`); the game clones each animal's subtree on its
 * own, and a clip binds within the clone. All face +Z with their feet at
 * the origin, clips in place.
 *
 * Quadrupeds share a skeleton shape: `body` (the root, at the middle of the
 * barrel), `neck`, `head`, `jaw`, `tail`, and per leg (FL, FR, BL, BR) an
 * upper `leg.*`, a lower `shin.*` and a `foot.*` at the hoof or paw.
 */

// --- quadrupeds ------------------------------------------------------------------------

type LegName = "FL" | "FR" | "BL" | "BR";
const LEGS: readonly LegName[] = ["FL", "FR", "BL", "BR"];

interface QuadShape {
  body: V3;
  neck: V3;
  head: V3;
  jaw: V3;
  tail: V3;
  /** Leg tops: apart (x), height, front and back (z). */
  legX: number;
  legTop: number;
  frontZ: number;
  backZ: number;
  /** Height of the knee (hock, carpus) and of the foot bone. */
  knee: number;
  foot: number;
  /** The tip of the muzzle, in the head's frame (for grazing). */
  muzzle: V3;
  /** How far the body stands below its bind pose: the legs a little bent, so they have room to step. */
  stand: number;
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

function quadDefs(q: QuadShape): BoneDef[] {
  const defs: BoneDef[] = [
    ["body", null, q.body],
    ["neck", "body", sub(q.neck, q.body)],
    ["head", "neck", sub(q.head, q.neck)],
    ["jaw", "head", sub(q.jaw, q.head)],
    ["tail", "body", sub(q.tail, q.body)],
  ];
  for (const leg of LEGS) {
    const x = leg.endsWith("L") ? q.legX : -q.legX;
    const z = leg.startsWith("F") ? q.frontZ : q.backZ;
    defs.push([`leg.${leg}`, "body", sub([x, q.legTop, z], q.body)]);
    defs.push([`shin.${leg}`, `leg.${leg}`, [0, q.knee - q.legTop, 0]]);
    defs.push([`foot.${leg}`, `shin.${leg}`, [0, q.foot - q.knee, 0]]);
  }
  return defs;
}

const legChain = (leg: LegName) => [`leg.${leg}`, `shin.${leg}`, `foot.${leg}`] as const;
/** Front legs fold at the carpus, which juts forward; hind legs at the hock, which juts back. */
const legPole = (leg: LegName) => new Vector3(0, 0, leg.startsWith("F") ? 1 : -1);
const legFoot = (q: QuadShape, leg: LegName): V3 => [leg.endsWith("L") ? q.legX : -q.legX, q.foot, leg.startsWith("F") ? q.frontZ : q.backZ];

/** Put all four feet on the ground where they stand (or offset by `moved`), flat. */
function plantAll(poser: Poser, q: QuadShape, p: Pose, root: V3, moved: Partial<Record<LegName, V3>> = {}): Pose {
  let out = p;
  for (const leg of LEGS) {
    const [x, y, z] = legFoot(q, leg);
    const d = moved[leg] ?? [0, 0, 0];
    out = poser.reach(out, root, legChain(leg), new Vector3(x + d[0], y + d[1], z + d[2]), legPole(leg), new Quaternion());
  }
  return out;
}

interface QuadWalk {
  period: number;
  speed: number;
  duty: number;
  samples: number;
  stepHeight: number;
  upper: (phase: number) => Pose;
}

/**
 * A walk in place, the legs in the lateral sequence every grazing animal
 * uses (left hind, left fore, right hind, right fore, a quarter-stride
 * apart), each planted foot sliding back at the ground speed. Two-bone legs
 * cannot sweep as far as a real leg with its extra joints, so the planted
 * stretch is capped at what they reach; past that the hooves slide a little.
 */
function quadWalk(poser: Poser, q: QuadShape, o: QuadWalk): Key[] {
  const upperLen = q.legTop - q.knee;
  const lowerLen = q.knee - q.foot;
  const legLen = upperLen + lowerLen;
  const drop = legLen - q.stand;
  const reach = Math.sqrt(Math.max(0, (0.985 * legLen) ** 2 - drop * drop));
  const stride = Math.min(o.speed * o.period * o.duty, 1.9 * reach);
  const offsets: Record<LegName, number> = { BL: 0, FL: 0.25, BR: 0.5, FR: 0.75 };
  const keys: Key[] = [];
  for (let i = 0; i <= o.samples; i++) {
    const phase = (i % o.samples) / o.samples;
    const root: V3 = [0, -q.stand + 0.008 * Math.cos(4 * Math.PI * phase), 0];
    const moved: Partial<Record<LegName, V3>> = {};
    for (const leg of LEGS) {
      const lp = (phase - offsets[leg] + 1) % 1;
      if (lp < o.duty) {
        moved[leg] = [0, 0, stride / 2 - (lp / o.duty) * stride];
      } else {
        const s = (lp - o.duty) / (1 - o.duty);
        moved[leg] = [0, o.stepHeight * Math.sin(Math.PI * s), -stride / 2 + stride * (0.5 - 0.5 * Math.cos(Math.PI * s))];
      }
    }
    keys.push({ t: Math.round((i / o.samples) * o.period * 1000) / 1000, pose: plantAll(poser, q, o.upper(phase), root, moved), root });
  }
  return keys;
}

/**
 * The neck's and head's pitches that put the muzzle in the grass, found by
 * trying: the least bend of the neck that gets it there, with the muzzle
 * out in front of the chest, not tucked back under it.
 */
function grazePitch(poser: Poser, q: QuadShape, body: Pose): { neck: number; head: number; muzzle: number } {
  const root: V3 = [0, -q.stand, 0];
  const tries: { neck: number; head: number; muzzle: number }[] = [];
  for (let a = 0; a <= 120; a += 2) {
    for (let h = -60; h <= 60; h += 3) {
      poser.set(pose(body, { neck: [a, 0, 0], head: [h, 0, 0] }), root);
      const muzzle = poser.point("head", q.muzzle);
      if (muzzle.z > poser.point("neck").z + 0.2) tries.push({ neck: a, head: h, muzzle: muzzle.y });
    }
  }
  const lowest = Math.min(...tries.map((t) => t.muzzle));
  const reach = Math.max(0.1, lowest + 0.02);
  return tries.find((t) => t.muzzle <= reach) ?? { neck: 0, head: 0, muzzle: lowest };
}

interface Grazer {
  name: string;
  shape: QuadShape;
  walk: QuadWalk;
  /** How long a graze loop is, and how fast the jaw works. */
  grazeLoop: number;
  chews: number;
}

/** A grazer's clips: graze (head down, chewing), walk, look_up (head up, holding). */
function grazerClips(g: Grazer): AnimationClip[] {
  const q = g.shape;
  const defs = quadDefs(q);
  const poser = new Poser(defs, "body");
  const set = new ClipSet(poser, { root: "body", rest: q.body, bones: defs.map(([n]) => n) });
  const root: V3 = [0, -q.stand, 0];
  // Forequarters down a little: the front legs take the bend.
  const lean: Pose = { body: [5, 0, 0] };
  const down = grazePitch(poser, q, lean);
  const grazing = (chew: number, sway: number): Pose =>
    pose(lean, { neck: [down.neck + sway, sway * 1.5, 0], head: [down.head, sway, 0], jaw: [chew, 0, 0], tail: [10, sway * 4, 0] });
  const grazeKeys: Key[] = [];
  const n = g.chews * 2;
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * g.grazeLoop;
    const sway = 3 * Math.sin((2 * Math.PI * i) / n);
    grazeKeys.push({ t: Math.round(t * 1000) / 1000, pose: plantAll(poser, q, grazing(i % 2 === 1 ? 14 : 0, sway), root), root });
  }
  set.add(`${g.name}.graze`, grazeKeys);
  set.add(
    `${g.name}.walk`,
    quadWalk(poser, q, {
      ...g.walk,
      upper: (ph) => {
        const nod = Math.cos(4 * Math.PI * ph);
        return pose(g.walk.upper(ph), { neck: [6 + 4 * nod, 3 * Math.sin(2 * Math.PI * ph), 0], head: [4 - 3 * nod, 0, 0], tail: [8, 10 * Math.sin(2 * Math.PI * ph), 0] });
      },
    }),
  );
  // Head up and looking ahead (+Z), alert, and held there.
  const alert = pose({ neck: [-24, 0, 0], head: [-6, 0, 0], jaw: [0, 0, 0], tail: [-10, 0, 0] });
  set.add(
    `${g.name}.look_up`,
    [
      { t: 0, pose: plantAll(poser, q, grazing(0, 0), root), root },
      { t: 0.35, pose: plantAll(poser, q, pose(alert, { neck: [-5, 0, 0], head: [10, 0, 0] }), root), root },
      { t: 0.65, pose: plantAll(poser, q, pose(alert, { neck: [-28, 0, 0] }), root), root },
      { t: 0.8, pose: plantAll(poser, q, alert, root), root },
    ],
    false,
  );
  return set.clips;
}

// --- the cow ----------------------------------------------------------------------------

const COW: QuadShape = {
  body: [0, 1.08, 0],
  neck: [0, 1.12, 0.64],
  head: [0, 1.34, 1.04],
  jaw: [0, 1.12, 1.24],
  tail: [0, 1.38, -0.72],
  legX: 0.19,
  legTop: 1.0,
  frontZ: 0.48,
  backZ: -0.5,
  knee: 0.5,
  foot: 0.06,
  muzzle: [0, -0.36, 0.4],
  stand: 0.08,
};

function cowMesh(s: SkinGeometry): void {
  const white = "#efece6";
  const black = "#1c1a19";
  s.mat("fur");
  // Barrel, hips and shoulders: white, patched black - the Holstein's pattern reads at any range.
  s.part(ball(0.36, 14, 9), "body", white, [0, 1.09, 0], [0, 0, 0], [0.87, 0.98, 2.0]);
  for (const x of [0.16, -0.16]) {
    s.part(ball(0.19, 8, 6), "body", white, [x, 1.32, -0.55]);
    s.part(ball(0.2, 8, 6), "body", white, [x, 1.24, 0.5]);
  }
  const patches: [V3, V3][] = [
    [[0.27, 1.18, 0.28], [0.3, 0.9, 1.4]],
    [[-0.26, 1.08, -0.26], [0.3, 1.0, 1.6]],
    [[0.26, 0.98, -0.42], [0.3, 0.8, 1.1]],
    [[-0.24, 1.28, 0.39], [0.3, 0.8, 1.2]],
    [[0.02, 1.43, -0.1], [1.2, 0.3, 1.5]],
    [[-0.28, 0.95, 0.17], [0.3, 0.7, 1.0]],
    [[0.18, 1.36, -0.58], [0.8, 0.5, 0.8]],
  ];
  for (const [at, scale] of patches) s.part(ball(0.2, 8, 5), "body", black, at, [0, 0, 0], scale);
  s.part(ball(0.12, 8, 6), "body", "#e3a7a0", [0, 0.75, -0.42], [0, 0, 0], [1.1, 0.8, 1.1]);
  // Neck and head: black, a white blaze, a pale muzzle, small horns, ears. The neck is long
  // enough to put the muzzle in the grass.
  s.rod("neck", black, [0, 1.1, 0.56], [0, 1.36, 1.04], 0.19, 10, 0.14);
  s.part(box(0.1, 0.22, 0.3), "neck", black, [0, 0.98, 0.8], [0.3, 0, 0]);
  s.rod("head", black, [0, 1.38, 1.02], [0, 1.02, 1.42], 0.12, 8, 0.1);
  s.part(box(0.08, 0.2, 0.03), "head", white, [0, 1.24, 1.24], [0.72, 0, 0]);
  s.part(ball(0.1, 8, 6), "head", "#c7a79c", [0, 0.99, 1.44], [0, 0, 0], [1.05, 0.85, 0.9]);
  s.part(box(0.15, 0.04, 0.08), "head", black, [0.15, 1.32, 1.02], [0, 0, -0.3]);
  s.part(box(0.15, 0.04, 0.08), "head", black, [-0.15, 1.32, 1.02], [0, 0, 0.3]);
  s.part(box(0.025, 0.025, 0.01), "head", "#050505", [0.09, 1.24, 1.17]);
  s.part(box(0.025, 0.025, 0.01), "head", "#050505", [-0.09, 1.24, 1.17]);
  s.part(box(0.1, 0.035, 0.16), "jaw", black, [0, 1.0, 1.34], [-0.7, 0, 0]);
  s.mat("horn");
  s.rod("head", "#e6dcc3", [0.08, 1.39, 1.04], [0.19, 1.44, 1.06], 0.024, 5, 0.008);
  s.rod("head", "#e6dcc3", [-0.08, 1.39, 1.04], [-0.19, 1.44, 1.06], 0.024, 5, 0.008);
  // The bell on its collar, under the throat; the collar ringing the neck along its slope.
  s.mat("leather").part(cyl(0.165, 0.165, 0.05, 10, true), "neck", "#4a2e1c", [0, 1.2, 0.8], [1.08, 0, 0]);
  s.mat("metal").part(cyl(0.03, 0.055, 0.09, 8), "neck", "#c9a23a", [0, 0.98, 0.9]);
  // Legs: white below, hooves dark.
  s.mat("fur");
  for (const leg of LEGS) {
    const [x, , z] = legFoot(COW, leg);
    s.rod(`leg.${leg}`, leg === "FR" || leg === "BL" ? black : white, [x, 1.05, z], [x, COW.knee, z], 0.085, 7, 0.06);
    s.rod(`shin.${leg}`, white, [x, COW.knee, z], [x, COW.foot + 0.02, z], 0.055, 6, 0.048);
    s.mat("horn").part(box(0.1, 0.07, 0.12), `foot.${leg}`, "#2a2420", [x, 0.035, z + 0.01]).mat("fur");
  }
  s.rod("tail", white, [0, 1.38, -0.72], [0, 0.66, -0.8], 0.028, 5, 0.018);
  s.part(ball(0.055, 6, 5), "tail", black, [0, 0.62, -0.8], [0, 0, 0], [1, 1.6, 1]);
}

// --- the sheep ---------------------------------------------------------------------------

const SHEEP: QuadShape = {
  body: [0, 0.62, 0],
  neck: [0, 0.66, 0.34],
  head: [0, 0.8, 0.54],
  jaw: [0, 0.7, 0.64],
  tail: [0, 0.72, -0.42],
  legX: 0.11,
  legTop: 0.55,
  frontZ: 0.28,
  backZ: -0.3,
  knee: 0.3,
  foot: 0.05,
  muzzle: [0, -0.15, 0.2],
  stand: 0.04,
};

function sheepMesh(s: SkinGeometry): void {
  const wool = "#ebe5d5";
  const woolShade = "#d9d2bf";
  const face = "#1f1a17";
  s.mat("wool");
  // A heap of lumpy wool: the round, pale shape a sheep is from afar.
  const lumps: [V3, number][] = [
    [[0, 0.64, 0.02], 0.26],
    [[0.1, 0.68, 0.24], 0.19],
    [[-0.1, 0.68, 0.24], 0.19],
    [[0.1, 0.68, -0.22], 0.2],
    [[-0.1, 0.68, -0.22], 0.2],
    [[0, 0.78, 0.0], 0.2],
    [[0, 0.58, -0.3], 0.17],
    [[0, 0.62, 0.32], 0.17],
  ];
  lumps.forEach(([at, r], i) => s.part(blob(r, 1), "body", i % 2 ? woolShade : wool, at));
  s.part(blob(0.12, 1), "neck", wool, [0, 0.7, 0.42]);
  s.mat("fur");
  s.rod("head", face, [0, 0.82, 0.54], [0, 0.66, 0.74], 0.075, 7, 0.055);
  s.part(blob(0.08, 1), "head", wool, [0, 0.86, 0.54]);
  s.part(box(0.12, 0.035, 0.05), "head", face, [0.1, 0.8, 0.56], [0, 0, -0.35]);
  s.part(box(0.12, 0.035, 0.05), "head", face, [-0.1, 0.8, 0.56], [0, 0, 0.35]);
  s.part(box(0.06, 0.025, 0.1), "jaw", face, [0, 0.63, 0.7], [-0.6, 0, 0]);
  for (const leg of LEGS) {
    const [x, , z] = legFoot(SHEEP, leg);
    s.rod(`leg.${leg}`, face, [x, 0.52, z], [x, SHEEP.knee, z], 0.034, 5, 0.028);
    s.rod(`shin.${leg}`, face, [x, SHEEP.knee, z], [x, 0.06, z], 0.026, 5, 0.022);
    s.mat("horn").part(box(0.05, 0.05, 0.06), `foot.${leg}`, "#141110", [x, 0.025, z + 0.005]).mat("fur");
  }
  s.mat("wool").part(blob(0.06, 0), "tail", wool, [0, 0.66, -0.46]);
}

// --- the goat ----------------------------------------------------------------------------

const GOAT: QuadShape = {
  body: [0, 0.62, 0],
  neck: [0, 0.72, 0.32],
  head: [0, 0.94, 0.44],
  jaw: [0, 0.84, 0.54],
  tail: [0, 0.74, -0.4],
  legX: 0.1,
  legTop: 0.56,
  frontZ: 0.27,
  backZ: -0.28,
  knee: 0.3,
  foot: 0.05,
  muzzle: [0, -0.15, 0.21],
  stand: 0.04,
};

function goatMesh(s: SkinGeometry): void {
  const coat = "#e8e5dc";
  const grey = "#9c968b";
  const dark = "#2a2622";
  s.mat("fur");
  s.part(ball(0.2, 12, 8), "body", coat, [0, 0.64, 0], [0, 0, 0], [0.85, 0.95, 2.1]);
  // A grey saddle over the back.
  s.part(ball(0.17, 8, 5), "body", grey, [0, 0.74, -0.04], [0, 0, 0], [1.02, 0.6, 1.9]);
  s.rod("neck", coat, [0, 0.66, 0.28], [0, 0.94, 0.44], 0.085, 8, 0.07);
  s.rod("head", coat, [0, 0.97, 0.43], [0, 0.8, 0.64], 0.07, 7, 0.045);
  s.part(box(0.1, 0.03, 0.05), "head", coat, [0.08, 0.93, 0.44], [0, 0, -0.5]);
  s.part(box(0.1, 0.03, 0.05), "head", coat, [-0.08, 0.93, 0.44], [0, 0, 0.5]);
  s.part(box(0.02, 0.02, 0.01), "head", "#0b0b0b", [0.045, 0.92, 0.53]);
  s.part(box(0.02, 0.02, 0.01), "head", "#0b0b0b", [-0.045, 0.92, 0.53]);
  s.part(box(0.05, 0.02, 0.1), "jaw", coat, [0, 0.79, 0.6], [-0.6, 0, 0]);
  // The beard.
  s.part(cyl(0.028, 0.004, 0.11, 5), "jaw", "#d8d3c6", [0, 0.72, 0.58], [0.2, 0, 0]);
  // Horns sweeping up and back.
  s.mat("horn");
  for (const x of [0.04, -0.04]) {
    s.rod("head", "#8b8478", [x, 0.99, 0.46], [x * 1.6, 1.09, 0.38], 0.02, 5, 0.014);
    s.rod("head", "#8b8478", [x * 1.6, 1.09, 0.38], [x * 2.2, 1.07, 0.29], 0.014, 5, 0.005);
  }
  s.mat("fur");
  for (const leg of LEGS) {
    const [x, , z] = legFoot(GOAT, leg);
    s.rod(`leg.${leg}`, leg.startsWith("B") ? grey : coat, [x, 0.56, z], [x, GOAT.knee, z], 0.04, 5, 0.03);
    s.rod(`shin.${leg}`, coat, [x, GOAT.knee, z], [x, 0.06, z], 0.027, 5, 0.022);
    s.mat("horn").part(box(0.045, 0.05, 0.055), `foot.${leg}`, dark, [x, 0.025, z + 0.005]).mat("fur");
  }
  s.rod("tail", grey, [0, 0.74, -0.4], [0, 0.86, -0.46], 0.025, 5, 0.012);
}

// --- the dog -----------------------------------------------------------------------------

const DOG: QuadShape = {
  body: [0, 0.46, 0],
  neck: [0, 0.52, 0.25],
  head: [0, 0.64, 0.34],
  jaw: [0, 0.6, 0.42],
  tail: [0, 0.5, -0.3],
  legX: 0.075,
  legTop: 0.42,
  frontZ: 0.22,
  backZ: -0.22,
  knee: 0.22,
  foot: 0.035,
  muzzle: [0, -0.05, 0.22],
  stand: 0.03,
};

function dogMesh(s: SkinGeometry): void {
  const black = "#161413";
  const white = "#f0ede6";
  s.mat("fur");
  s.part(ball(0.14, 12, 8), "body", black, [0, 0.47, -0.01], [0, 0, 0], [0.85, 0.95, 2.3]);
  // The collie's white ruff and chest.
  s.part(ball(0.12, 8, 6), "neck", white, [0, 0.5, 0.26], [0, 0, 0], [1.05, 1.1, 0.9]);
  s.rod("neck", black, [0, 0.5, 0.2], [0, 0.64, 0.33], 0.075, 7, 0.06);
  s.part(ball(0.075, 8, 6), "head", black, [0, 0.66, 0.36], [0, 0, 0], [0.95, 0.9, 1.05]);
  s.rod("head", white, [0, 0.64, 0.4], [0, 0.61, 0.56], 0.04, 6, 0.028);
  s.part(box(0.025, 0.07, 0.012), "head", white, [0, 0.69, 0.42], [0.4, 0, 0]);
  s.part(box(0.025, 0.02, 0.02), "head", "#050505", [0, 0.615, 0.565]);
  s.part(cyl(0.001, 0.03, 0.07, 4), "head", black, [0.045, 0.73, 0.35], [0, 0, -0.25]);
  s.part(cyl(0.001, 0.03, 0.07, 4), "head", black, [-0.045, 0.73, 0.35], [0, 0, 0.25]);
  s.part(box(0.045, 0.012, 0.1), "jaw", white, [0, 0.585, 0.49], [-0.25, 0, 0]);
  for (const leg of LEGS) {
    const [x, , z] = legFoot(DOG, leg);
    s.rod(`leg.${leg}`, leg.startsWith("F") ? white : black, [x, 0.44, z], [x, DOG.knee, z], 0.033, 5, 0.025);
    s.rod(`shin.${leg}`, white, [x, DOG.knee, z], [x, 0.045, z], 0.022, 5, 0.02);
    s.part(box(0.04, 0.035, 0.06), `foot.${leg}`, white, [x, 0.018, z + 0.012]);
  }
  // The long brush of a tail, white at its tip.
  s.rod("tail", black, [0, 0.5, -0.3], [0, 0.32, -0.46], 0.04, 6, 0.03);
  s.part(ball(0.035, 6, 5), "tail", white, [0, 0.3, -0.48]);
}

// --- the eagle ---------------------------------------------------------------------------

const EAGLE_REST: V3 = [0, 0.45, 0];

/** Bind pose: in flight, wings spread level, legs hanging. */
const EAGLE: BoneDef[] = [
  ["body", null, EAGLE_REST],
  ["neck", "body", [0, 0.03, 0.2]],
  ["head", "neck", [0, 0.03, 0.08]],
  ["tail", "body", [0, 0.01, -0.24]],
  ["wing.L", "body", [0.09, 0.03, 0.06]],
  ["wingtip.L", "wing.L", [0.41, 0, 0]],
  ["wing.R", "body", [-0.09, 0.03, 0.06]],
  ["wingtip.R", "wing.R", [-0.41, 0, 0]],
  ["leg.L", "body", [0.06, -0.05, 0.02]],
  ["foot.L", "leg.L", [0, -0.14, 0.02]],
  ["leg.R", "body", [-0.06, -0.05, 0.02]],
  ["foot.R", "leg.R", [0, -0.14, 0.02]],
];

function eagleMesh(s: SkinGeometry): void {
  const brown = "#3a2a1b";
  const covert = "#6d4e2f";
  const gold = "#c89f4b";
  const yellow = "#e6b92b";
  s.mat("feather");
  s.part(ball(0.13, 12, 8), "body", brown, [0, 0.45, 0.02], [0, 0, 0], [0.9, 0.85, 2.2]);
  s.part(ball(0.075, 8, 6), "neck", "#8a6a3a", [0, 0.49, 0.2]);
  s.part(ball(0.07, 10, 7), "head", gold, [0, 0.52, 0.3], [0, 0, 0], [0.9, 0.95, 1.2]);
  s.part(box(0.2, 0.02, 0.28), "tail", brown, [0, 0.46, -0.37]);
  s.part(box(0.26, 0.018, 0.1), "tail", "#4d3822", [0, 0.46, -0.48]);
  for (const side of [1, -1]) {
    const wing = side > 0 ? "wing.L" : "wing.R";
    const tip = side > 0 ? "wingtip.L" : "wingtip.R";
    s.part(box(0.43, 0.03, 0.34), wing, brown, [side * 0.3, 0.48, 0.02]);
    s.part(box(0.4, 0.034, 0.12), wing, covert, [side * 0.3, 0.482, 0.1]);
    s.part(box(0.36, 0.025, 0.28), tip, brown, [side * 0.68, 0.48, 0.0]);
    // The spread "fingers" of the primaries: the eagle's outline.
    for (let i = 0; i < 5; i++) {
      const z = 0.1 - i * 0.05;
      s.part(box(0.2, 0.012, 0.045), tip, "#2c2016", [side * 0.93, 0.48, z], [0, side * (0.1 - i * 0.07), 0]);
    }
    s.part(cap(0.035, 0.08, 2, 6), side > 0 ? "leg.L" : "leg.R", brown, [side * 0.06, 0.36, 0.03]);
    s.mat("horn");
    const foot = side > 0 ? "foot.L" : "foot.R";
    s.part(box(0.05, 0.02, 0.07), foot, yellow, [side * 0.06, 0.265, 0.05]);
    s.part(box(0.012, 0.012, 0.05), foot, "#1a1512", [side * 0.075, 0.258, 0.09]);
    s.part(box(0.012, 0.012, 0.05), foot, "#1a1512", [side * 0.045, 0.258, 0.09]);
    s.part(box(0.012, 0.012, 0.04), foot, "#1a1512", [side * 0.06, 0.258, 0.0]);
    s.mat("feather");
  }
  s.mat("horn");
  s.part(cyl(0.001, 0.028, 0.08, 6), "head", yellow, [0, 0.51, 0.39], [Math.PI / 2, 0, 0]);
  s.part(box(0.012, 0.03, 0.012), "head", yellow, [0, 0.49, 0.425]);
  s.part(box(0.02, 0.015, 0.01), "head", "#0b0b0b", [0.035, 0.535, 0.345]);
  s.part(box(0.02, 0.015, 0.01), "head", "#0b0b0b", [-0.035, 0.535, 0.345]);
}

/** A wing folded against the flank: its span laid back along the body, its chord hanging down. */
function foldedWing(): Pose {
  const m = new Matrix4().makeBasis(new Vector3(0, 0, -1), new Vector3(1, 0, 0), new Vector3(0, -1, 0));
  // The outer wing folds back along the inner, so the whole lies within the body's length.
  const left: Pose = { "wing.L": degreesOf(new Quaternion().setFromRotationMatrix(m)), "wingtip.L": [0, 165, 0] };
  return pose(left, mirror(left));
}

function eagleClips(points: SkinPoints): AnimationClip[] {
  const poser = new Poser(EAGLE, "body");
  const set = new ClipSet(poser, { root: "body", rest: EAGLE_REST, bones: EAGLE.map(([n]) => n) });
  const both = (p: Pose): Pose => pose(p, mirror(p));
  // Legs tucked back under the tail in flight.
  const tucked: Pose = both({ "leg.L": [75, 0, 0], "foot.L": [40, 0, 0] });
  const spread = (dihedral: number, tip: number): Pose => both({ "wing.L": [0, 0, dihedral], "wingtip.L": [0, 0, tip] });
  const glide = (roll: number, look: number): Key => ({
    t: 0,
    pose: pose(tucked, spread(6, 4), { body: [0, 0, roll], "wing.L": [0, 0, 6 - roll], "wing.R": [0, 0, -6 - roll], tail: [0, -roll, 0], neck: [0, look * 0.5, 0], head: [0, look, -roll] }),
  });
  const at = (t: number, k: Key): Key => ({ ...k, t });
  set.add("eagle.glide", [at(0, glide(0, 0)), at(0.5, glide(5, 10)), at(1, glide(0, 0)), at(1.5, glide(-5, -10)), at(2, glide(0, 0))]);

  const flapKey = (t: number, wing: number, tip: number, lift: number): Key => ({
    t,
    pose: pose(tucked, both({ "wing.L": [0, wing < 0 ? -8 : 4, wing], "wingtip.L": [0, 0, tip] }), { tail: [wing * 0.1, 0, 0] }),
    root: [0, lift, 0],
  });
  set.add("eagle.flap", [flapKey(0, 52, 18, 0), flapKey(0.2, -38, -22, 0.03), flapKey(0.35, 8, 38, 0.02), flapKey(0.5, 52, 18, 0)]);

  // Landing: pitch up, wings thrown forward and up to brake, talons reaching, then down onto them and fold.
  const flare: Pose = pose(both({ "wing.L": [-30, -25, 55], "wingtip.L": [0, -15, 20], "leg.L": [-30, 0, 0], "foot.L": [-20, 0, 0] }), { body: [-45, 0, 0], neck: [35, 0, 0], head: [10, 0, 0], tail: [25, 0, 0] });
  const perched: Pose = pose(foldedWing(), both({ "leg.L": [36, 0, 0], "foot.L": [0, 0, 0] }), { body: [-36, 0, 0], neck: [26, 0, 0], head: [10, 0, 0], tail: [18, 0, 0] });
  const settle = (k: Key, liftOnly = false) => poser.settle(points, k, 0, liftOnly);
  set.add(
    "eagle.land",
    poser.keepAbove(points, [
      at(0, glide(0, 0)),
      settle({ t: 0.3, pose: pose(flare, both({ "wing.L": [-20, -15, 35] })), root: [0, 0.1, 0] }, true),
      settle({ t: 0.6, pose: flare, root: [0, -0.02, 0] }, true),
      settle({ t: 0.8, pose: pose(perched, both({ "wing.L": [-10, 60, 40], "wingtip.L": [0, 20, 0] })), root: [0, -0.1, 0] }),
      settle({ t: 1.0, pose: perched, root: [0, -0.1, 0] }),
    ]),
    false,
  );
  return set.clips;
}

// --- clips for the goat and the dog ------------------------------------------------------

function goatClips(points: SkinPoints): AnimationClip[] {
  const q = GOAT;
  const defs = quadDefs(q);
  const poser = new Poser(defs, "body");
  const set = new ClipSet(poser, { root: "body", rest: q.body, bones: defs.map(([n]) => n) });
  const root: V3 = [0, -q.stand, 0];
  const stand = (t: number, p: Pose, r: V3 = root, moved: Partial<Record<LegName, V3>> = {}): Key => ({ t, pose: plantAll(poser, q, p, r, moved), root: r });
  set.add("goat.stand", [
    stand(0, { neck: [0, 0, 0], tail: [0, 0, 0] }),
    stand(0.8, { neck: [-4, 18, 0], head: [2, 12, 0], jaw: [6, 0, 0] }),
    stand(1.0, { neck: [-4, 18, 0], head: [2, 12, 0], jaw: [0, 0, 0], tail: [0, 25, 0] }),
    stand(1.8, { neck: [6, -12, 0], head: [4, -10, 0], jaw: [6, 0, 0] }),
    stand(2.2, { neck: [6, -12, 0], head: [4, -10, 0], jaw: [0, 0, 0] }),
    stand(3, { neck: [0, 0, 0], tail: [0, 0, 0] }),
  ]);
  // hop: crouch, spring (the hind legs driving), tuck, reach down for the landing, stand. In place:
  // the game carries the root along the arc; the clip lifts it only as far as the driving legs
  // push the body up off the ground.
  const tuckFront: Pose = { "leg.FL": [-55, 0, 0], "shin.FL": [95, 0, 0], "leg.FR": [-55, 0, 0], "shin.FR": [95, 0, 0] };
  const tuckHind: Pose = { "leg.BL": [-30, 0, 0], "shin.BL": [-70, 0, 0], "leg.BR": [-30, 0, 0], "shin.BR": [-70, 0, 0] };
  const driveHind: Pose = { "leg.BL": [35, 0, 0], "shin.BL": [-5, 0, 0], "foot.BL": [40, 0, 0], "leg.BR": [35, 0, 0], "shin.BR": [-5, 0, 0], "foot.BR": [40, 0, 0] };
  const reachFront: Pose = { "leg.FL": [-25, 0, 0], "shin.FL": [5, 0, 0], "leg.FR": [-25, 0, 0], "shin.FR": [5, 0, 0] };
  const aloft = (k: Key) => poser.settle(points, k, 0, true);
  set.add(
    "goat.hop",
    poser.keepAbove(points, [
      stand(0, {}),
      stand(0.2, { body: [4, 0, 0], neck: [10, 0, 0] }, [0, -q.stand - 0.1, 0]),
      poser.settle(points, { t: 0.34, pose: pose({ body: [-18, 0, 0], neck: [-12, 0, 0] }, tuckFront, driveHind), root: [0, -q.stand, 0] }),
      aloft({ t: 0.5, pose: pose({ body: [-4, 0, 0], neck: [-6, 0, 0] }, tuckFront, tuckHind), root: [0, -q.stand, 0] }),
      poser.settle(points, { t: 0.64, pose: pose({ body: [10, 0, 0], neck: [4, 0, 0] }, reachFront, tuckHind), root: [0, -q.stand, 0] }),
      stand(0.8, { neck: [4, 0, 0] }, [0, -q.stand - 0.03, 0]),
    ]),
    false,
  );
  // bleat: head up, the jaw open and trembling, and down again.
  const up: Pose = { neck: [-30, 0, 0], head: [-18, 0, 0] };
  set.add(
    "goat.bleat",
    [
      stand(0, {}),
      stand(0.18, pose(up, { jaw: [4, 0, 0] })),
      stand(0.28, pose(up, { jaw: [24, 0, 0] })),
      stand(0.4, pose(up, { jaw: [16, 0, 0] })),
      stand(0.52, pose(up, { jaw: [24, 0, 0] })),
      stand(0.64, pose(up, { jaw: [6, 0, 0] })),
      stand(0.8, { jaw: [0, 0, 0] }),
    ],
    false,
  );
  return set.clips;
}

function dogClips(points: SkinPoints): AnimationClip[] {
  const q = DOG;
  const defs = quadDefs(q);
  const poser = new Poser(defs, "body");
  const set = new ClipSet(poser, { root: "body", rest: q.body, bones: defs.map(([n]) => n) });
  const root: V3 = [0, -q.stand, 0];
  // idle: standing, panting, the tail wagging, looking about.
  const idle: Key[] = [];
  for (let i = 0; i <= 8; i++) {
    const t = i * 0.25;
    const wag = i % 2 ? 22 : -22;
    const look = 14 * Math.sin((2 * Math.PI * i) / 8);
    idle.push({ t, pose: plantAll(poser, q, { neck: [-6, look, 0], head: [6, look * 0.6, 0], jaw: [i % 2 ? 16 : 6, 0, 0], tail: [-15, wag, 0] }, root), root });
  }
  set.add("dog.idle", idle);
  // run: a bounding gallop - gather, drive, stretch out, land on the forelegs - all in half a second.
  const legs = (fl: V3, fs: V3, bl: V3, bs: V3): Pose => ({
    "leg.FL": fl,
    "shin.FL": fs,
    "leg.FR": [fl[0] + 8, 0, 0],
    "shin.FR": fs,
    "leg.BL": bl,
    "shin.BL": bs,
    "leg.BR": [bl[0] - 8, 0, 0],
    "shin.BR": bs,
  });
  const run: Key[] = [
    { t: 0, pose: pose({ body: [6, 0, 0], neck: [10, 0, 0], tail: [10, 0, 0] }, legs([35, 0, 0], [10, 0, 0], [-45, 0, 0], [-10, 0, 0])), root },
    { t: 0.125, pose: pose({ body: [-4, 0, 0], neck: [4, 0, 0], tail: [0, 0, 0] }, legs([-30, 0, 0], [70, 0, 0], [25, 0, 0], [-5, 0, 0])), root: [0, 0.04, 0] },
    { t: 0.25, pose: pose({ body: [-2, 0, 0], neck: [-4, 0, 0], tail: [-10, 0, 0] }, legs([-55, 0, 0], [10, 0, 0], [50, 0, 0], [-10, 0, 0])), root: [0, 0.07, 0] },
    { t: 0.375, pose: pose({ body: [4, 0, 0], neck: [6, 0, 0], tail: [0, 0, 0] }, legs([-15, 0, 0], [5, 0, 0], [0, 0, 0], [-60, 0, 0])), root },
  ];
  const settled = run.map((k) => poser.settle(points, k, 0, k.t === 0.125 || k.t === 0.25));
  set.add("dog.run", poser.keepAbove(points, [...settled, { ...(settled[0] as Key), t: 0.5 }]));
  return set.clips;
}

// --- the asset ---------------------------------------------------------------------------

export function buildAnimalsAsset(): LoadedAsset {
  const mats = new Materials();
  const scene = nameNode(new Group(), "animals");
  const animations: AnimationClip[] = [];
  const animal = (name: string, defs: BoneDef[], build: (s: SkinGeometry) => void): SkinPoints => {
    const arm = buildSkeleton(defs);
    const node = nameNode(new Group(), name);
    node.add(arm.armature);
    const s = new SkinGeometry(arm);
    build(s);
    // Not named after a bone: a clip binds by name, and must find the bone.
    arm.armature.add(s.mesh(`${name}.mesh`, mats));
    scene.add(node);
    return s.points();
  };
  animal("cow", quadDefs(COW), cowMesh);
  animations.push(...grazerClips({ name: "cow", shape: COW, walk: { period: 1.2, speed: 1, duty: 0.65, samples: 8, stepHeight: 0.1, upper: () => ({}) }, grazeLoop: 3, chews: 4 }));
  animal("sheep", quadDefs(SHEEP), sheepMesh);
  animations.push(...grazerClips({ name: "sheep", shape: SHEEP, walk: { period: 1.0, speed: 0.8, duty: 0.65, samples: 8, stepHeight: 0.06, upper: () => ({}) }, grazeLoop: 2.4, chews: 4 }));
  const goat = animal("goat", quadDefs(GOAT), goatMesh);
  animations.push(...goatClips(goat));
  const eagle = animal("eagle", EAGLE, eagleMesh);
  animations.push(...eagleClips(eagle));
  const dog = animal("dog", quadDefs(DOG), dogMesh);
  animations.push(...dogClips(dog));
  return { scene, animations };
}
