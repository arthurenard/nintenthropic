import { Group, Object3D, Vector3 } from "three";
import type { LoadedAsset } from "../../../engine/types";
import { nameNode } from "../../../engine/world/names";
import {
  ARM_L,
  ARM_R,
  ClipSet,
  CROUCH,
  CROUCH_ROOT,
  HIPS_REST,
  HUMAN_CLIP,
  HUMANOID,
  LEG_L,
  LEG_R,
  Materials,
  Poser,
  RigidGeometry,
  SOCKET_HAND_L,
  SkinGeometry,
  STANCE,
  between,
  blob,
  box,
  cyl,
  dome,
  gait,
  handFrame,
  holdWith,
  humanBody,
  humanoid,
  pose,
  quatOf,
  random,
  type Armature,
  type Hold,
  type Key,
  type Pose,
  type SkinPoints,
  type V3,
} from "./skin";

/**
 * The placeholder soldier (soldier.glb): the shared humanoid in a dark
 * olive field uniform, with a steel helmet, an officer's cap, a ghillie
 * suit, a pack and a slung rifle to dress him in, a scoped rifle, a light
 * machine gun, binoculars and a cigarette to put in his hands, and the
 * contract's clips. Everything a hostile needs to read as one at 300 m:
 * dark, a helmet's dome, a rifle's line.
 */

const C = {
  skin: "#b3876a",
  jacket: "#3d4630",
  jacketDark: "#323a27",
  trousers: "#353c2a",
  boots: "#1b1713",
  belt: "#29231a",
  pouch: "#2d3322",
  hair: "#2a2018",
  helmet: "#2b3128",
  helmetRim: "#232821",
  cap: "#22251e",
  capBand: "#7c1f1b",
  peak: "#121310",
  badge: "#c8a84a",
  pack: "#4b4a33",
  roll: "#5d5b45",
  strap: "#2b2a1f",
  wood: "#4e3322",
  steel: "#242628",
  glass: "#5a7d8c",
  paper: "#efeae0",
  ember: "#ff7a2a",
};

const GHILLIE = ["#4b5b2d", "#5e6c35", "#6b5a39", "#3e4929", "#7b6e45", "#55512f", "#6f7a3c"];

// --- the figure ----------------------------------------------------------------------

function soldierBody(s: SkinGeometry): SkinGeometry {
  humanBody(s, { skin: C.skin, top: C.jacket, trousers: C.trousers, boots: C.boots, belt: C.belt, hair: C.hair });
  s.mat("cloth");
  // The field jacket hangs below the belt, and has a collar and breast pockets.
  s.part(box(0.35, 0.13, 0.225), "hips", C.jacket, [0, 0.915, 0]);
  s.part(cyl(0.075, 0.085, 0.05, 8), "chest", C.jacket, [0, 1.475, 0]);
  s.part(box(0.1, 0.09, 0.02), "chest", C.jacketDark, [0.09, 1.35, 0.115]);
  s.part(box(0.1, 0.09, 0.02), "chest", C.jacketDark, [-0.09, 1.35, 0.115]);
  // Trousers bloused into the boots: a darker band at the top of each.
  s.part(cyl(0.069, 0.069, 0.035, 8), "shin.L", C.jacketDark, [0.1, 0.26, 0]);
  s.part(cyl(0.069, 0.069, 0.035, 8), "shin.R", C.jacketDark, [-0.1, 0.26, 0]);
  s.mat("leather");
  // Ammunition pouches on the belt, a canteen on the hip.
  for (const [x, z] of [
    [0.075, 0.125],
    [-0.075, 0.125],
    [0.155, 0.075],
    [-0.155, 0.075],
  ] as [number, number][]) {
    s.part(box(0.075, 0.085, 0.045), "hips", C.pouch, [x, 1.0, z]);
  }
  s.part(box(0.07, 0.05, 0.03), "hips", C.belt, [0, 1.03, 0.115]);
  s.part(cyl(0.045, 0.045, 0.13, 8), "hips", C.pouch, [0.14, 0.95, -0.1]);
  return s;
}

function helmet(arm: Armature): SkinGeometry {
  const s = new SkinGeometry(arm).mat("metal:painted");
  // A deep dome with a skirt that flares out over the ears and neck: the shape that says "soldier".
  s.part(dome(0.135, 14, 5), "head", C.helmet, [0, 1.672, 0.004], [0, 0, 0], [1.02, 0.95, 1.1]);
  s.part(cyl(0.139, 0.172, 0.06, 14, true), "head", C.helmetRim, [0, 1.648, 0.004], [0, 0, 0], [1, 1, 1.08]);
  s.part(cyl(0.172, 0.174, 0.012, 14), "head", C.helmetRim, [0, 1.618, 0.004], [0, 0, 0], [1, 1, 1.08]);
  s.mat("leather").part(box(0.19, 0.012, 0.012), "head", C.strap, [0, 1.54, 0.05], [0.5, 0, 0]);
  return s;
}

function officerCap(arm: Armature): SkinGeometry {
  const s = new SkinGeometry(arm).mat("cloth");
  s.part(cyl(0.132, 0.108, 0.08, 14), "head", C.cap, [0, 1.75, 0.0], [-0.12, 0, 0]);
  s.part(cyl(0.11, 0.11, 0.038, 14), "head", C.capBand, [0, 1.712, 0.0]);
  s.part(box(0.03, 0.03, 0.01), "head", C.badge, [0, 1.745, 0.126]);
  s.mat("leather").part(box(0.17, 0.012, 0.085), "head", C.peak, [0, 1.697, 0.118], [0.35, 0, 0]);
  return s;
}

function pack(arm: Armature): SkinGeometry {
  const s = new SkinGeometry(arm).mat("canvas");
  s.part(box(0.3, 0.34, 0.14), "chest", C.pack, [0, 1.3, -0.18]);
  s.part(box(0.2, 0.12, 0.05), "chest", C.roll, [0, 1.25, -0.27]);
  s.part(cyl(0.065, 0.065, 0.38, 8), "chest", C.roll, [0, 1.5, -0.17], [0, 0, Math.PI / 2]);
  s.mat("leather");
  s.part(box(0.045, 0.02, 0.24), "chest", C.strap, [0.1, 1.46, -0.01]);
  s.part(box(0.045, 0.02, 0.24), "chest", C.strap, [-0.1, 1.46, -0.01]);
  s.part(box(0.04, 0.28, 0.02), "chest", C.strap, [0.1, 1.3, 0.115]);
  s.part(box(0.04, 0.28, 0.02), "chest", C.strap, [-0.1, 1.3, 0.115]);
  return s;
}

/** A rifle on the back, muzzle up behind the left shoulder, for a sentry whose hands are busy. */
function slungRifle(arm: Armature): SkinGeometry {
  const s = new SkinGeometry(arm);
  const butt: V3 = [-0.17, 1.0, -0.15];
  const muzzle: V3 = [0.19, 2.02, -0.16];
  const along = (f: number): V3 => [butt[0] + (muzzle[0] - butt[0]) * f, butt[1] + (muzzle[1] - butt[1]) * f, butt[2] + (muzzle[2] - butt[2]) * f];
  const { rot } = between(butt, muzzle);
  s.mat("wood");
  s.part(box(0.045, 0.3, 0.075), "chest", C.wood, along(0.14), rot);
  s.part(box(0.045, 0.36, 0.05), "chest", C.wood, along(0.52), rot);
  s.mat("metal");
  s.rod("chest", C.steel, along(0.3), along(1), 0.011, 6);
  s.part(cyl(0.016, 0.016, 0.24, 8), "chest", C.steel, along(0.36), rot);
  s.mat("leather");
  // The sling across the chest, left shoulder to right hip.
  const { at, rot: strap, len } = between([0.15, 1.47, 0.1], [-0.16, 1.05, 0.13]);
  s.part(box(0.035, len, 0.012), "chest", C.strap, at, strap);
  return s;
}

/**
 * A ghillie suit: burlap tufts in mixed greens and browns all over the
 * head, back, arms and legs, bulky enough to blur the outline of a man
 * into a bush. Seeded, so every build is the same.
 */
function ghillie(arm: Armature): SkinGeometry {
  const s = new SkinGeometry(arm).mat("cloth");
  const rnd = random(1944);
  const pick = () => GHILLIE[Math.floor(rnd() * GHILLIE.length)] ?? "#4b5b2d";
  // A hood over the head and the shoulders, a cape on the back.
  s.part(blob(0.155, 1), "head", pick(), [0, 1.665, -0.015], [0, 0, 0], [1.05, 0.95, 1.05]);
  s.part(box(0.46, 0.36, 0.08), "chest", pick(), [0, 1.3, -0.12]);
  s.part(box(0.4, 0.26, 0.07), "spine", pick(), [0, 1.08, -0.11]);
  // Segments of the body (bind pose): a line and a radius each, and how many tufts.
  const segments: [bone: string, a: V3, b: V3, r: number, n: number, back: boolean][] = [
    ["head", [0, 1.6, -0.02], [0, 1.76, -0.02], 0.13, 7, false],
    ["chest", [0, 1.22, 0], [0, 1.46, 0], 0.16, 9, true],
    ["spine", [0, 1.04, 0], [0, 1.2, 0], 0.15, 5, true],
    ["hips", [0, 0.88, 0], [0, 1.0, 0], 0.17, 4, true],
    ["upper_arm.L", [0.19, 1.42, 0], [0.19, 1.18, 0], 0.07, 3, false],
    ["upper_arm.R", [-0.19, 1.42, 0], [-0.19, 1.18, 0], 0.07, 3, false],
    ["forearm.L", [0.19, 1.14, 0], [0.19, 0.94, 0], 0.06, 2, false],
    ["forearm.R", [-0.19, 1.14, 0], [-0.19, 0.94, 0], 0.06, 2, false],
    ["thigh.L", [0.1, 0.88, 0], [0.1, 0.5, 0], 0.09, 4, false],
    ["thigh.R", [-0.1, 0.88, 0], [-0.1, 0.5, 0], 0.09, 4, false],
    ["shin.L", [0.1, 0.45, 0], [0.1, 0.16, 0], 0.075, 3, false],
    ["shin.R", [-0.1, 0.45, 0], [-0.1, 0.16, 0], 0.075, 3, false],
  ];
  for (const [bone, a, b, r, n, back] of segments) {
    for (let i = 0; i < n; i++) {
      const f = rnd();
      // Around the limb, favouring the back (what a prone sniper shows the sky).
      const ang = back ? Math.PI + (rnd() - 0.5) * Math.PI * 1.4 : rnd() * Math.PI * 2;
      const x = a[0] + (b[0] - a[0]) * f + Math.sin(ang) * r;
      const y = a[1] + (b[1] - a[1]) * f;
      const z = a[2] + (b[2] - a[2]) * f + Math.cos(ang) * r;
      const size = 0.045 + rnd() * 0.04;
      s.part(blob(size, 0), bone, pick(), [x, y, z], [rnd() * 3, rnd() * 3, rnd() * 3], [1.2, 0.8 + rnd() * 0.6, 1]);
      // A ragged strip hanging from it: a thin three-sided spike, point down.
      const len = 0.1 + rnd() * 0.14;
      s.part(cyl(0.022, 0.004, len, 3, true), bone, pick(), [x + Math.sin(ang) * 0.02, y - len * 0.4, z + Math.cos(ang) * 0.02], [(rnd() - 0.5) * 0.8, ang, (rnd() - 0.5) * 0.8]);
    }
  }
  return s;
}

/** The props, on the sockets. They point along the hand's −Y with their top toward its +Z. */
function props(socketGun: Object3D, socketHandL: Object3D, mats: Materials): void {
  const rifle = nameNode(new Group(), "gun.rifle");
  const r = new RigidGeometry();
  r.mat("wood");
  r.part(box(0.042, 0.26, 0.075), C.wood, [0, 0.18, -0.02], [0.08, 0, 0]);
  r.part(box(0.036, 0.1, 0.048), C.wood, [0, 0.01, -0.005]);
  r.part(box(0.04, 0.4, 0.05), C.wood, [0, -0.3, 0.008]);
  r.mat("metal");
  r.part(box(0.03, 0.22, 0.04), C.steel, [0, -0.06, 0.03]);
  r.part(cyl(0.009, 0.011, 0.52, 6), C.steel, [0, -0.52, 0.03]);
  r.part(cyl(0.016, 0.016, 0.24, 8), C.steel, [0, -0.08, 0.078]);
  r.part(cyl(0.023, 0.016, 0.05, 8), C.steel, [0, -0.22, 0.078]);
  r.part(cyl(0.018, 0.016, 0.03, 8), C.steel, [0, 0.055, 0.078]);
  r.part(box(0.012, 0.02, 0.04), C.steel, [0, -0.02, 0.055]);
  r.part(box(0.012, 0.02, 0.04), C.steel, [0, -0.15, 0.055]);
  r.part(box(0.05, 0.012, 0.012), C.steel, [-0.03, 0.0, 0.035]);
  rifle.add(r.mesh(null, mats, "metal"));

  const mg = nameNode(new Group(), "gun.mg");
  const m = new RigidGeometry();
  m.mat("wood");
  m.part(box(0.045, 0.26, 0.08), C.wood, [0, 0.17, -0.01], [0.05, 0, 0]);
  m.part(box(0.035, 0.05, 0.09), C.wood, [0, 0.0, -0.05], [-0.3, 0, 0]);
  m.mat("metal");
  m.part(box(0.055, 0.42, 0.075), C.steel, [0, -0.17, 0.02]);
  m.part(cyl(0.024, 0.024, 0.42, 8), C.steel, [0, -0.58, 0.03]);
  m.part(cyl(0.011, 0.011, 0.18, 6), C.steel, [0, -0.86, 0.03]);
  m.part(cyl(0.02, 0.014, 0.05, 8), C.steel, [0, -0.94, 0.03]);
  // A box magazine on the left side, a carrying handle on top.
  m.part(box(0.1, 0.1, 0.11), C.steel, [0.075, -0.13, 0.0]);
  m.part(box(0.015, 0.1, 0.04), C.steel, [0, -0.3, 0.085]);
  // The bipod, legs splayed down from under the barrel.
  m.rod(C.steel, [0.0, -0.68, 0.0], [0.11, -0.78, -0.3], 0.007, 4);
  m.rod(C.steel, [0.0, -0.68, 0.0], [-0.11, -0.78, -0.3], 0.007, 4);
  mg.add(m.mesh(null, mats, "metal"));

  const bino = nameNode(new Group(), "prop.binoculars");
  const b = new RigidGeometry().mat("metal:painted");
  // Two barrels along the view (−Y), the right one on the grip, the left across the bridge.
  b.part(cyl(0.024, 0.028, 0.15, 8), "#1f201d", [0, -0.01, 0]);
  b.part(cyl(0.024, 0.028, 0.15, 8), "#1f201d", [0.068, -0.01, 0]);
  b.part(box(0.07, 0.05, 0.022), "#1f201d", [0.034, 0.0, 0]);
  b.part(cyl(0.017, 0.017, 0.03, 8), "#111", [0, 0.075, 0]);
  b.part(cyl(0.017, 0.017, 0.03, 8), "#111", [0.068, 0.075, 0]);
  bino.add(b.mesh(null, mats, "metal"));

  const cig = nameNode(new Group(), "prop.cigarette");
  const c = new RigidGeometry().mat("paper");
  // Across the fingers: the filter end toward the palm's side (−Z), the lit end out (+Z).
  c.part(cyl(0.0045, 0.0045, 0.07, 6), C.paper, [0, 0, 0.02], [Math.PI / 2, 0, 0]);
  c.mat("ember").part(cyl(0.0058, 0.0058, 0.01, 6), C.ember, [0, 0, 0.059], [Math.PI / 2, 0, 0]);
  cig.add(c.mesh(null, mats));

  socketGun.add(rifle, mg, bino);
  socketHandL.add(cig);
  // The rifle is what he holds unless told otherwise.
  mg.visible = false;
  bino.visible = false;
  cig.visible = false;
}

export function buildSoldierAsset(): LoadedAsset {
  const mats = new Materials();
  const { root, arm, socketGun, socketHandL } = humanoid("soldier");
  const body = soldierBody(new SkinGeometry(arm));
  const add = (name: string, s: SkinGeometry) => arm.armature.add(s.mesh(name, mats));
  add("body", body);
  add("var.helmet", helmet(arm));
  add("var.cap.officer", officerCap(arm));
  add("var.ghillie", ghillie(arm));
  add("var.pack", pack(arm));
  add("var.sling", slungRifle(arm));
  props(socketGun, socketHandL, mats);
  return { scene: root, animations: soldierClips(body.points()).clips };
}

// --- the clips ------------------------------------------------------------------------

/** Rifle held low across the body, muzzle up by the left shoulder: standing easy, walking. */
const PORT_LOW: Hold = { frame: "chest", grip: [-0.13, -0.2, 0.2], dir: [0.55, 0.55, 0.35], up: [0, 0.2, 1], fore: 0.3, poleR: [-0.5, -1, -0.3] };
/** Rifle high across the chest: running. */
const PORT_HIGH: Hold = { frame: "chest", grip: [-0.14, -0.1, 0.22], dir: [0.6, 0.65, 0.28], up: [0, 0.2, 1], fore: 0.28, poleR: [-0.5, -1, -0.3] };
/** At the ready, muzzle forward and a little down: patrolling. */
const READY: Hold = { frame: "chest", grip: [-0.07, -0.03, 0.21], dir: [0.25, -0.3, 1], up: [0, 1, 0.3], fore: 0.22, poleR: [-0.5, -1, -0.2] };
/** Crouched behind cover, muzzle up and forward. */
const CROUCH_READY: Hold = { frame: "chest", grip: [-0.08, -0.08, 0.2], dir: [0.3, 0.45, 1], up: [0, 1, -0.3], fore: 0.22, poleR: [-0.5, -1, -0.2] };
/** Shouldered, pointing along +Z: the butt in the right shoulder, the eye behind the scope. */
const AIM_HOLD: Hold = { frame: null, grip: [-0.1, 1.46, 0.3], dir: [0, 0, 1], up: [0, 1, 0], fore: 0.3, poleR: [-1, -0.5, -0.4], poleL: [0.6, -1, 0] };
/** The binoculars at the eyes; the left hand on the far barrel. */
const BINOCULARS: Hold = {
  frame: "head",
  grip: [-0.04, 0.105, 0.185],
  dir: [0, 0, 1],
  up: [0, 1, 0],
  fore: null,
  leftAt: [0.08, 0.07, 0.15],
  poleR: [-0.7, -1, 0.2],
  poleL: [0.7, -1, 0.2],
};

/** Standing, weight even, a slight lean into the rifle. */
const STAND_UP: Pose = pose(STANCE, { spine: [3, 0, 0] });

/** Standing to shoot: bladed a little to the right, the head turned back to the scope and down on the stock. */
const AIM_BODY: Pose = pose(STANCE, {
  hips: [0, -10, 0],
  spine: [4, -8, 0],
  chest: [2, -12, 0],
  neck: [4, 10, 0],
  head: [12, 20, 10],
});

/** Lying on the stomach, head to +Z, up on the elbows. */
const PRONE: Pose = {
  hips: [90, 0, 0],
  spine: [-20, 0, 0],
  chest: [-20, 0, 0],
  neck: [-25, 0, 0],
  head: [-20, 0, 0],
  "thigh.L": [-3, 0, 9],
  "shin.L": [6, 0, 0],
  "foot.L": [75, 0, 0],
  "thigh.R": [-3, 0, -9],
  "shin.R": [6, 0, 0],
  "foot.R": [75, 0, 0],
};
const PRONE_ROOT: V3 = [0, -0.84, 0.15];

/** Seated at a wheel: thighs level, shins down, hips 0.45 m below standing. */
const SEATED: Pose = { spine: [-6, 0, 0], chest: [6, 0, 0], neck: [2, 0, 0], head: [0, 0, 0] };
const SEATED_ROOT: V3 = [0, -0.45, 0];

/**
 * The soldier's clips, built on a private armature. `points` is the body's
 * skin, so the poses that lie on the ground can be set down on it.
 */
export function soldierClips(points: SkinPoints): ClipSet {
  const poser = new Poser(HUMANOID, "hips");
  const set = new ClipSet(poser, HUMAN_CLIP);
  const settle = (k: Key, floor = 0, liftOnly = false) => poser.settle(points, k, floor, liftOnly);
  const hold = (p: Pose, root: V3 | undefined, h: Hold) => holdWith(poser, p, root, h);
  type Feet = [[number, number], [number, number]];
  /** Feet planted at (x, z) on a floor `floor` metres up, flat, toes out a little; knees forward. */
  const plant = (p: Pose, root: V3, feet: Feet = [[0.12, 0.02], [-0.12, -0.02]], floor = 0): Pose => {
    const [l, r] = feet;
    let out = poser.reach(p, root, LEG_L, new Vector3(l[0], floor + 0.05, l[1]), new Vector3(0.15, 0, 1), quatOf([0, 8, 0]));
    out = poser.reach(out, root, LEG_R, new Vector3(r[0], floor + 0.05, r[1]), new Vector3(-0.15, 0, 1), quatOf([0, -8, 0]));
    return out;
  };
  /** A standing key: feet planted, hands on whatever is held. */
  const stand = (t: number, body: Pose, h: Hold | null, root: V3 = [0, -0.015, 0], feet?: Feet, floor = 0): Key => {
    let p = plant(body, root, feet, floor);
    if (h) p = hold(p, root, h);
    return { t, pose: p, root };
  };

  // idle: standing easy, rifle low across the body, breathing.
  const breathe: Pose = { chest: [2.5, 0, 0], neck: [-1.5, 0, 0], head: [-1, 4, 0] };
  set.add("idle", [stand(0, STAND_UP, PORT_LOW), stand(1.5, pose(STAND_UP, breathe), PORT_LOW, [0, -0.02, 0]), stand(3, STAND_UP, PORT_LOW)]);

  // idle_smoke: weight on the right leg, the rifle slung; the left hand brings the cigarette up, holds, and down.
  const slouch: Pose = {
    hips: [0, 4, -3],
    spine: [-2, -2, 2],
    chest: [-1, -2, 1],
    head: [-3, -6, 2],
    "upper_arm.R": [3, 0, -6],
    "forearm.R": [-10, 0, 0],
  };
  const smokeRoot: V3 = [-0.025, -0.02, 0];
  const smokeFeet: Feet = [
    [0.15, 0.06],
    [-0.1, -0.02],
  ];
  const handLow = (p: Pose, at: V3) => poser.reach(p, smokeRoot, ARM_L, new Vector3(...at), new Vector3(1, -1, -0.6));
  const handToMouth = (p: Pose): Pose => {
    poser.set(p, smokeRoot);
    // Fingers up, the cigarette's lit end pointing away from the face.
    const rot = handFrame(poser.direction("head", [0.35, 1, 0]), poser.direction("head", [0, 0, 1]));
    const lips = poser.point("head", [0.005, 0.035, 0.135]);
    const wrist = lips.sub(new Vector3(...SOCKET_HAND_L).applyQuaternion(rot));
    return poser.reach(p, smokeRoot, ARM_L, wrist, new Vector3(1, -1, -0.2), rot);
  };
  const smokeAt = (t: number, body: Pose, arm: (p: Pose) => Pose): Key => ({ t, pose: arm(plant(body, smokeRoot, smokeFeet)), root: smokeRoot });
  const low = (p: Pose) => handLow(p, [0.21, 0.99, 0.13]);
  set.add("idle_smoke", [
    smokeAt(0, slouch, low),
    smokeAt(0.7, slouch, (p) => handLow(p, [0.2, 1.05, 0.16])),
    smokeAt(1.3, pose(slouch, { head: [2, -4, 2] }), handToMouth),
    smokeAt(2.1, pose(slouch, { head: [-4, -4, 2], chest: [-2, -2, 1] }), handToMouth),
    smokeAt(2.6, pose(slouch, { head: [-10, -2, 0] }), (p) => handLow(p, [0.22, 1.12, 0.18])),
    smokeAt(3.4, pose(slouch, { head: [-6, 8, 0] }), low),
    smokeAt(5, slouch, low),
  ]);

  // look_binoculars: scanning slowly left to right and back, the arms following the head.
  const scan = (yaw: number): Pose =>
    pose(STAND_UP, { spine: [2, yaw * 0.25, 0], chest: [-2, yaw * 0.35, 0], neck: [-3, yaw * 0.2, 0], head: [-2, yaw * 0.2, 0] });
  set.add("look_binoculars", [
    stand(0, scan(24), BINOCULARS),
    stand(1, scan(0), BINOCULARS),
    stand(2, scan(-24), BINOCULARS),
    stand(3, scan(0), BINOCULARS),
    stand(4, scan(24), BINOCULARS),
  ]);

  // walk: rifle carried across the body, the chest turning against the hips.
  const cos = (phase: number) => Math.cos(2 * Math.PI * phase);
  const sin = (phase: number) => Math.sin(2 * Math.PI * phase);
  set.add(
    "walk",
    gait(poser, {
      period: 1.1,
      speed: 1.4,
      duty: 0.6,
      samples: 10,
      stepHeight: 0.07,
      sink: 0.015,
      track: 0.09,
      sway: 0.018,
      upper: (ph) => ({ hips: [0, -5 * cos(ph), 0], spine: [4, 2 * cos(ph), 0], chest: [0, 4 * cos(ph), 0], head: [0, -1 * cos(ph), 0] }),
      finish: (p, r) => hold(p, r, PORT_LOW),
    }),
  );

  // patrol_walk: slower, the rifle at the ready, the head turning a little.
  set.add(
    "patrol_walk",
    gait(poser, {
      period: 1.3,
      speed: 1.1,
      duty: 0.62,
      samples: 10,
      stepHeight: 0.06,
      sink: 0.03,
      track: 0.1,
      sway: 0.02,
      upper: (ph) => ({ hips: [0, -4 * cos(ph), 0], spine: [6, 2 * cos(ph), 0], chest: [2, 3 * cos(ph), 0], neck: [0, 5 * sin(ph), 0], head: [0, 8 * sin(ph), 0] }),
      finish: (p, r) => hold(p, r, READY),
    }),
  );

  // run: 4 m/s, leaning in, the rifle high across the chest.
  set.add(
    "run",
    gait(poser, {
      period: 0.66,
      speed: 4,
      duty: 0.34,
      samples: 8,
      stepHeight: 0.2,
      sink: 0.07,
      lift: 0.04,
      maxDip: 0.1,
      centre: -0.05,
      track: 0.08,
      upper: (ph) => ({ hips: [4, -8 * cos(ph), 0], spine: [12, 3 * cos(ph), 0], chest: [4, 6 * cos(ph), 0], neck: [-6, 0, 0], head: [-8, -3 * cos(ph), 0] }),
      finish: (p, r) => hold(p, r, PORT_HIGH),
    }),
  );

  // crouch: down on the heels behind cover, rifle up and ready.
  const crouchKey = (t: number, body: Pose): Key => {
    const k = settle({ t, pose: body, root: CROUCH_ROOT });
    return { ...k, pose: hold(k.pose, k.root, CROUCH_READY) };
  };
  set.add("crouch", [
    crouchKey(0, CROUCH),
    crouchKey(1, pose(CROUCH, { chest: [13, 0, 0], neck: [-16, 6, 0], head: [-10, 10, 0] })),
    crouchKey(2, CROUCH),
  ]);

  // prone: on the stomach, up on the elbows, the rifle held out in front.
  // Down on the belly first (the arms held clear, over the head), then the hands to the rifle,
  // lifting the body only if an elbow would go into the ground.
  const armsClear: Pose = { "upper_arm.L": [-170, 0, 0], "upper_arm.R": [-170, 0, 0] };
  const proneKey = (t: number, body: Pose, h: Hold): Key => {
    const k = settle({ t, pose: pose(body, armsClear), root: PRONE_ROOT });
    const held = { ...k, pose: hold(body, k.root, h) };
    return settle(held, 0, true);
  };
  const proneRest: Hold = { frame: null, grip: [-0.09, 0.2, 0.86], dir: [0.12, 0.06, 1], up: [0, 1, 0], fore: 0.14, poleR: [-0.3, -1, 0], poleL: [0.3, -1, 0] };
  set.add("prone", [
    proneKey(0, PRONE, proneRest),
    proneKey(1.5, pose(PRONE, { chest: [-21.5, 0, 0], neck: [-25, 6, 0], head: [-20, 8, 0] }), proneRest),
    proneKey(3, PRONE, proneRest),
  ]);

  // prone_aim: the rifle shouldered, pointing +Z, the cheek down on the stock.
  const proneAimBody = pose(PRONE, { neck: [-16, 4, 0], head: [-6, 6, 10] });
  const proneAim = (dx: number, dy: number): Hold => ({
    frame: null,
    grip: [-0.11, 0.33, 0.86],
    dir: [dx, dy, 1],
    up: [0, 1, 0],
    fore: 0.16,
    poleR: [-0.4, -1, 0],
    poleL: [0.3, -1, 0],
  });
  set.add("prone_aim", [
    proneKey(0, proneAimBody, proneAim(0, 0)),
    proneKey(0.7, proneAimBody, proneAim(0.008, 0.004)),
    proneKey(1.4, proneAimBody, proneAim(-0.004, -0.003)),
    proneKey(2, proneAimBody, proneAim(0, 0)),
  ]);

  // aim: standing, rifle shouldered along +Z; the smallest sway.
  const aimFeet: Feet = [
    [0.14, 0.14],
    [-0.14, -0.14],
  ];
  const aimRoot: V3 = [0, -0.03, 0];
  const aimAt = (t: number, body: Pose, h: Hold = AIM_HOLD, root: V3 = aimRoot) => stand(t, body, h, root, aimFeet);
  const swayed: Hold = { ...AIM_HOLD, grip: [-0.097, 1.463, 0.3], dir: [0.004, 0.003, 1] };
  set.add("aim", [aimAt(0, AIM_BODY), aimAt(0.8, pose(AIM_BODY, { chest: [2.8, -12, 0] }), swayed), aimAt(1.6, AIM_BODY)]);

  // fire: the kick, the muzzle climbing, and back.
  const kicked: Hold = { ...AIM_HOLD, grip: [-0.1, 1.48, 0.25], dir: [0, 0.12, 1] };
  set.add("fire", [
    aimAt(0, AIM_BODY),
    aimAt(0.05, pose(AIM_BODY, { spine: [0, -9, 0], chest: [-4, -13, 0], head: [8, 20, 10] }), kicked, [0, -0.03, -0.02]),
    aimAt(0.18, pose(AIM_BODY, { spine: [2, -8, 0], chest: [0, -12, 0] }), { ...AIM_HOLD, grip: [-0.1, 1.47, 0.28], dir: [0, 0.04, 1] }),
    aimAt(0.4, AIM_BODY),
  ]);

  // hit_body: a flinch from the hit - the chest thrown back and round, the left hand off the rifle - and back.
  const flinch = pose(AIM_BODY, { spine: [-8, 4, 6], chest: [-16, 12, 8], neck: [6, 0, 0], head: [14, 4, 0] });
  const flinchHold: Hold = { ...AIM_HOLD, frame: "chest", grip: [-0.16, 0.05, 0.3], dir: [0.3, -0.3, 1], up: [0, 1, 0], fore: null };
  const flinchKey = stand(0.1, flinch, flinchHold, [0, -0.05, -0.03], aimFeet);
  flinchKey.pose = pose(flinchKey.pose, { "upper_arm.L": [-30, 0, 38], "forearm.L": [-40, 0, 0] });
  set.add("hit_body", [aimAt(0, AIM_BODY), flinchKey, aimAt(0.5, AIM_BODY)]);

  // wound_kneel: down on the right knee, left hand clutching the side, head bowed; holds there.
  const kneel = (t: number, body: Pose, root: V3): Key => {
    let p = poser.reach(body, root, LEG_L, new Vector3(0.12, 0.05, 0.4), new Vector3(0.1, 0, 1), quatOf([0, 6, 0]));
    p = poser.reach(p, root, LEG_R, new Vector3(-0.12, 0.1, -0.42), new Vector3(0, -1, 0.3), quatOf([165, 0, 0]));
    p = poser.reach(p, root, ARM_L, poser.set(p, root).point("spine", [0.12, 0.02, 0.1]), new Vector3(1, -0.3, -0.5));
    // The rifle kept in the right hand, lying forward over the left knee, muzzle clear of the ground.
    p = hold(p, root, { frame: null, grip: [-0.18, 0.56, 0.2], dir: [0.25, -0.12, 1], up: [0, 1, 0], fore: null, poleR: [-1, -0.6, -0.4] });
    return { t, pose: p, root };
  };
  const hunched: Pose = { spine: [22, 0, -4], chest: [14, -6, 0], neck: [16, 0, 0], head: [20, -6, 0] };
  // On the way down: the right knee dropping, its foot turning back out of the ground's way.
  const goingDown = (t: number): Key => {
    const root: V3 = [0, -0.27, 0.02];
    const body = pose(hunched, { spine: [16, 0, -4], chest: [10, -4, 0] });
    let p = poser.reach(body, root, LEG_L, new Vector3(0.12, 0.05, 0.3), new Vector3(0.1, 0, 1), quatOf([0, 6, 0]));
    p = poser.reach(p, root, LEG_R, new Vector3(-0.12, 0.2, -0.3), new Vector3(0, -1, 0.5), quatOf([110, 0, 0]));
    return { t, pose: hold(p, root, PORT_LOW), root };
  };
  set.add(
    "wound_kneel",
    poser.keepAbove(points, [
      stand(0, STAND_UP, PORT_LOW),
      stand(0.2, pose(STAND_UP, { spine: [14, 0, -4], chest: [8, -4, 0], head: [12, 0, 0] }), PORT_LOW, [0, -0.12, 0.01], [
        [0.13, 0.08],
        [-0.12, -0.05],
      ]),
      goingDown(0.36),
      kneel(0.55, pose(hunched, { spine: [18, 0, -4] }), [0, -0.43, 0.02]),
      kneel(0.9, hunched, [0, -0.41, 0.0]),
    ]),
    false,
  );

  // The deaths: each ends lying on the ground, the hips carrying the body down.
  const start = stand(0, STAND_UP, PORT_LOW);
  const limpArms: Pose = { "upper_arm.L": [-150, 0, 70], "upper_arm.R": [-150, 0, -70], "forearm.L": [-20, 0, 0], "forearm.R": [-20, 0, 0] };
  set.add(
    "death_back",
    poser.keepAbove(points, [
      start,
      settle(
        {
          t: 0.25,
          pose: pose(STAND_UP, {
            hips: [-18, 0, 0],
            spine: [-12, 0, 0],
            chest: [-10, 20, 8],
            head: [-20, 0, 0],
            "thigh.L": [-25, 0, 6],
            "shin.L": [50, 0, 0],
            "thigh.R": [-15, 0, -6],
            "shin.R": [40, 0, 0],
            "upper_arm.R": [-40, -24, -40],
            "upper_arm.L": [-20, 0, 45],
          }),
          root: [0, -0.12, -0.12],
        },
        0,
      ),
      settle({ t: 0.7, pose: pose(limpArms, { hips: [-70, 0, 0], spine: [-5, 0, 0], head: [-10, 15, 0], "thigh.L": [-30, 0, 8], "shin.L": [35, 0, 0], "thigh.R": [-20, 0, -8], "shin.R": [30, 0, 0] }), root: [0, -0.58, -0.45] }, 0, true),
      settle({ t: 1.0, pose: pose(limpArms, { hips: [-90, 0, 0], head: [0, 35, 0], "thigh.L": [-6, 0, 10], "shin.L": [10, 0, 0], "thigh.R": [-3, 0, -12], "shin.R": [18, 0, 0] }), root: [0, -0.84, -0.55] }),
      settle({ t: 1.3, pose: pose(limpArms, { hips: [-90, 0, 0], head: [2, 38, 0], "thigh.L": [-5, 0, 10], "shin.L": [8, 0, 0], "thigh.R": [-3, 0, -12], "shin.R": [16, 0, 0] }), root: [0, -0.85, -0.55] }),
    ]),
    false,
  );
  const faceDown: Pose = { "upper_arm.L": [-165, 0, 40], "upper_arm.R": [-165, 0, -40], "forearm.L": [-30, 0, 0], "forearm.R": [-30, 0, 0] };
  set.add(
    "death_forward",
    poser.keepAbove(points, [
      start,
      settle({ t: 0.3, pose: pose(STAND_UP, { spine: [25, 0, 0], chest: [10, 0, 0], head: [20, 0, 0], "thigh.L": [-60, 0, 5], "shin.L": [95, 0, 0], "thigh.R": [-55, 0, -5], "shin.R": [90, 0, 0], "upper_arm.R": [-20, 0, -15], "upper_arm.L": [-10, 0, 20] }), root: [0, -0.33, 0.05] }),
      settle({ t: 0.75, pose: pose(faceDown, { hips: [60, 0, 0], spine: [10, 0, 0], "thigh.L": [-30, 0, 5], "shin.L": [40, 0, 0], "thigh.R": [-25, 0, -5], "shin.R": [35, 0, 0] }), root: [0, -0.6, 0.3] }, 0, true),
      settle({ t: 1.05, pose: pose(faceDown, { hips: [88, 0, 0], head: [0, -35, 0], "thigh.L": [-4, 0, 6], "thigh.R": [-2, 0, -8], "shin.R": [12, 0, 0], "foot.L": [72, 0, 0], "foot.R": [72, 0, 0] }), root: [0, -0.84, 0.48] }),
      settle({ t: 1.3, pose: pose(faceDown, { hips: [89, 0, 0], head: [0, -38, 0], "thigh.L": [-4, 0, 6], "thigh.R": [-2, 0, -8], "shin.R": [10, 0, 0], "foot.L": [76, 0, 0], "foot.R": [76, 0, 0] }), root: [0, -0.85, 0.5] }),
    ]),
    false,
  );
  // death_crumple: the knees go, he sinks onto them, and folds over onto his side where he stood.
  const curled: Pose = {
    hips: [4, 0, -88],
    spine: [16, 0, 0],
    chest: [12, 0, 0],
    // The head dropped to the ground on the side he lies on.
    neck: [10, 0, -18],
    head: [6, 0, -22],
    "thigh.L": [-72, 0, 4],
    "shin.L": [82, 0, 0],
    "foot.L": [12, 0, 0],
    "thigh.R": [-62, 0, -2],
    "shin.R": [90, 0, 0],
    "foot.R": [12, 0, 0],
    // The arm underneath lies along the ground, not propping him up.
    "upper_arm.L": [-75, 0, -30],
    "forearm.L": [-30, 0, 0],
    "upper_arm.R": [-40, 0, -6],
    "forearm.R": [-50, 0, 0],
  };
  set.add(
    "death_crumple",
    poser.keepAbove(points, [
      start,
      settle({ t: 0.3, pose: pose(STAND_UP, { spine: [20, 0, 0], chest: [10, 0, 0], head: [20, 0, 0], "thigh.L": [-45, 0, 6], "shin.L": [80, 0, 0], "foot.L": [-20, 0, 0], "thigh.R": [-40, 0, -6], "shin.R": [75, 0, 0], "foot.R": [-20, 0, 0], "upper_arm.R": [-20, 0, -12], "forearm.R": [-40, 0, 0], "upper_arm.L": [-10, 0, 12], "forearm.L": [-30, 0, 0] }), root: [0, -0.2, 0.02] }),
      settle({ t: 0.7, pose: { spine: [30, 0, 0], chest: [16, 0, 0], neck: [12, 0, 0], head: [22, 0, 0], "thigh.L": [-8, 0, 6], "shin.L": [100, 0, 0], "foot.L": [60, 0, 0], "thigh.R": [-6, 0, -6], "shin.R": [100, 0, 0], "foot.R": [60, 0, 0], "upper_arm.L": [-8, 0, 10], "upper_arm.R": [-8, 0, -10], "forearm.L": [-20, 0, 0], "forearm.R": [-20, 0, 0] }, root: [0, -0.45, 0] }),
      settle({ t: 1.05, pose: pose(curled, { hips: [10, 0, -45], "thigh.L": [-40, 0, 4], "shin.L": [95, 0, 0], "thigh.R": [-35, 0, -2], "shin.R": [95, 0, 0] }), root: [-0.15, -0.6, 0] }, 0, true),
      settle({ t: 1.5, pose: curled, root: [-0.35, -0.78, 0] }),
    ]),
    false,
  );

  // dismount: standing on the truck bed (hips 1.2 m up, 0.8 m back), a dip, a step off the
  // edge, the fall, a crouch on landing at the origin, and up.
  const bed = 1.2;
  const onBed: Feet = [
    [0.12, -0.76],
    [-0.12, -0.82],
  ];
  const dismount: Key[] = [
    stand(0, STAND_UP, PORT_LOW, [0, bed - 0.015, -0.8], onBed, bed),
    stand(0.13, pose(STAND_UP, { spine: [16, 0, 0], chest: [4, 0, 0], head: [-8, 0, 0] }), PORT_LOW, [0, bed - 0.12, -0.77], onBed, bed),
  ];
  // Off the edge with no hop, under gravity, landing on slightly bent legs.
  const takeoff = 0.15;
  const drop = bed - 0.1;
  const fall = Math.sqrt((2 * drop) / 9.81);
  const air: Pose = pose(STAND_UP, { spine: [10, 0, 0], "thigh.L": [-28, 0, 8], "shin.L": [30, 0, 0], "foot.L": [8, 0, 0], "thigh.R": [-18, 0, -8], "shin.R": [34, 0, 0], "foot.R": [8, 0, 0] });
  const touch: Pose = pose(air, { "thigh.L": [-22, 0, 8], "shin.L": [24, 0, 0], "thigh.R": [-14, 0, -8], "shin.R": [26, 0, 0], "foot.L": [0, 0, 0], "foot.R": [0, 0, 0] });
  for (let i = 0; i <= 4; i++) {
    const f = i / 4;
    const tau = f * fall;
    let k: Key = { t: round3(takeoff + tau), pose: i === 4 ? touch : air, root: [0, drop - 4.905 * tau * tau - 0.03, -0.72 * (1 - f)] };
    // Touching down: the boots exactly on the ground; in the air, never below it.
    k = i === 4 ? settle(k) : settle(k, 0, true);
    dismount.push({ ...k, pose: hold(k.pose, k.root, PORT_LOW) });
  }
  // The landing, feet planted where they touched: down into a crouch, then up.
  const landing = dismount[dismount.length - 1] as Key;
  const landFeet: Feet = [
    [0.13, 0.04],
    [-0.13, -0.02],
  ];
  const squat = (spine: number): Pose => pose(STAND_UP, { spine: [spine, 0, 0], chest: [spine / 3, 0, 0], neck: [-spine / 3, 0, 0], head: [-spine / 3, 0, 0] });
  const t0 = landing.t;
  dismount.push(stand(round3(t0 + 0.05), squat(18), PORT_LOW, [0, -0.2, -0.02], landFeet));
  dismount.push(stand(round3(t0 + 0.13), squat(32), PORT_LOW, [0, -0.42, -0.04], landFeet));
  dismount.push(stand(round3(t0 + 0.27), squat(16), PORT_LOW, [0, -0.2, -0.02], landFeet));
  dismount.push(stand(1.05, STAND_UP, PORT_LOW));
  set.add("dismount", poser.keepAbove(points, dismount), false);

  // drive: seated, hands on a wheel 0.45 m ahead at chest height, a small sway with the road.
  const drive = (t: number, sway: number): Key => {
    const body = pose(SEATED, { spine: [-6, 0, sway], chest: [6, sway * 2, 0], head: [0, -sway * 3, -sway] });
    let p = poser.reach(body, SEATED_ROOT, LEG_L, new Vector3(0.13, 0.05, 0.46), new Vector3(0.1, 0.3, 1), quatOf([0, 4, 0]));
    p = poser.reach(p, SEATED_ROOT, LEG_R, new Vector3(-0.13, 0.05, 0.46), new Vector3(-0.1, 0.3, 1), quatOf([0, -4, 0]));
    const wheelY = HIPS_REST[1] + SEATED_ROOT[1] + 0.47;
    p = poser.reach(p, SEATED_ROOT, ARM_L, new Vector3(0.17 + sway * 0.004, wheelY + 0.03, 0.4), new Vector3(1, -1, -0.3));
    p = poser.reach(p, SEATED_ROOT, ARM_R, new Vector3(-0.17 + sway * 0.004, wheelY + 0.03 - sway * 0.004, 0.4), new Vector3(-1, -1, -0.3));
    return { t, pose: p, root: SEATED_ROOT };
  };
  set.add("drive", [drive(0, 0), drive(0.5, 1.5), drive(1, 0), drive(1.5, -1.5), drive(2, 0)]);

  return set;
}

const round3 = (x: number) => Math.round(x * 1000) / 1000;
