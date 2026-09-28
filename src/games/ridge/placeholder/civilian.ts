import { Group, Object3D, TorusGeometry, Vector3 } from "three";
import type { LoadedAsset } from "../../../engine/types";
import { nameNode } from "../../../engine/world/names";
import {
  ARM_L,
  ARM_R,
  ClipSet,
  CROUCH,
  CROUCH_ROOT,
  HUMAN_CLIP,
  HUMANOID,
  LEG_L,
  LEG_R,
  Materials,
  Poser,
  RigidGeometry,
  SkinGeometry,
  STAND,
  box,
  cap,
  cyl,
  dome,
  gait,
  humanBody,
  humanoid,
  pose,
  quatOf,
  type Armature,
  type Key,
  type Pose,
  type SkinPoints,
  type V3,
} from "./skin";

/**
 * The placeholder civilian (civilian.glb): the shared humanoid in a plain
 * shirt and trousers, dressed by the game as a farmer, a cyclist, a
 * shepherd or a child - all in bright colours, no helmet, nothing in the
 * hands that looks like a gun, so that through the scope they can never be
 * mistaken for the olive-drab soldiers - with the cyclist's bicycle and the
 * shepherd's crook, and the contract's clips.
 */

const C = {
  skin: "#d9a986",
  shirt: "#d8d1bf",
  trousers: "#5d5547",
  shoes: "#3a2c20",
  belt: "#4a3826",
  hair: "#3b2a1c",
  overalls: "#2c6fe0",
  straw: "#e8c65a",
  band: "#8a5a3a",
  cycJacket: "#e3302a",
  cycCap: "#f4d018",
  coat: "#70492a",
  coatDark: "#57381f",
  felt: "#3d3027",
  childTop: "#f6c514",
  childBottom: "#dc3a2c",
  crook: "#6b4a2a",
  frame: "#1f7fea",
  tyre: "#1b1b1b",
  steel: "#9a9a96",
  saddle: "#2a2420",
};

// --- the bicycle ---------------------------------------------------------------------

/**
 * Where the bicycle's parts are, in the rider's frame (the root on the
 * ground under the hips, facing +Z): the rider's hips (at their rest height,
 * 0.95 m) sit on the saddle, the hands on the bars 0.45 m ahead at 1 m.
 */
export const BICYCLE = {
  rearHub: [0, 0.33, -0.52] as V3,
  frontHub: [0, 0.33, 0.53] as V3,
  wheelRadius: 0.33,
  /** The bottom bracket: the crank's pivot. */
  crank: [0, 0.3, 0.12] as V3,
  crankLength: 0.17,
  /** Pedals either side of the frame. */
  pedalX: 0.12,
  saddleTop: 0.925,
  grips: [0.22, 1.0, 0.46] as V3,
  /** One turn of the crank per `cycle` clip. */
  cadence: 0.9,
};

/**
 * The crank's angle about X at a time into the `cycle` clip: one turn per
 * clip, the right pedal forward (+Z) at the start. Wheels and crank turn
 * forward with positive angles about their local X.
 */
export function crankAngle(t: number): number {
  return (2 * Math.PI * t) / BICYCLE.cadence;
}

/** A pedal's centre in the rider's frame at a crank angle. */
function pedal(side: 1 | -1, angle: number): Vector3 {
  // The right pedal (side −1) leads; the left is half a turn behind.
  const a = side < 0 ? angle : angle + Math.PI;
  const [, y, z] = BICYCLE.crank;
  return new Vector3(side * BICYCLE.pedalX, y - BICYCLE.crankLength * Math.sin(a), z + BICYCLE.crankLength * Math.cos(a));
}

function wheel(name: string, at: V3, mats: Materials): Group {
  const g = nameNode(new Group(), name);
  g.position.set(...at);
  const w = new RigidGeometry().mat("rubber");
  // The tyre in the YZ plane, so the wheel turns about X.
  w.part(new TorusGeometry(BICYCLE.wheelRadius - 0.018, 0.018, 4, 22), C.tyre, [0, 0, 0], [0, Math.PI / 2, 0]);
  w.mat("metal");
  w.part(new TorusGeometry(BICYCLE.wheelRadius - 0.04, 0.008, 3, 22), C.steel, [0, 0, 0], [0, Math.PI / 2, 0]);
  w.part(cyl(0.03, 0.03, 0.1, 8), C.steel, [0, 0, 0], [0, 0, Math.PI / 2]);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI;
    const r = BICYCLE.wheelRadius - 0.04;
    w.rod(C.steel, [0, Math.sin(a) * r, Math.cos(a) * r], [0, -Math.sin(a) * r, -Math.cos(a) * r], 0.003, 3);
  }
  g.add(w.mesh(null, mats, "metal"));
  return g;
}

/**
 * The bicycle: rigid, at the scene's root (not on the armature), its wheels
 * and crank on pivots the game turns about their local X.
 */
function bicycle(mats: Materials): Group {
  const bike = nameNode(new Group(), "bicycle");
  const f = new RigidGeometry().mat("metal:painted");
  const bb = BICYCLE.crank;
  const rear = BICYCLE.rearHub;
  const front = BICYCLE.frontHub;
  const seat: V3 = [0, 0.86, -0.12];
  const headTop: V3 = [0, 0.88, 0.42];
  const headLow: V3 = [0, 0.72, 0.46];
  f.rod(C.frame, seat, headTop, 0.018);
  f.rod(C.frame, bb, headLow, 0.02);
  f.rod(C.frame, bb, seat, 0.018);
  f.rod(C.frame, headLow, headTop, 0.022);
  for (const x of [0.05, -0.05]) {
    f.rod(C.frame, [x, bb[1], bb[2]], [x, rear[1], rear[2]], 0.011);
    f.rod(C.frame, [x, seat[1], seat[2]], [x, rear[1], rear[2]], 0.011);
    f.rod(C.frame, [x, headLow[1], headLow[2]], [x, front[1], front[2]], 0.012);
  }
  // Mudguards over both wheels, in the frame's colour: they make the wheels read at a distance.
  f.part(new TorusGeometry(BICYCLE.wheelRadius + 0.03, 0.022, 3, 10, Math.PI * 0.6), C.frame, rear, [0, Math.PI / 2, Math.PI * 0.25]);
  f.part(new TorusGeometry(BICYCLE.wheelRadius + 0.03, 0.022, 3, 10, Math.PI * 0.6), C.frame, front, [0, Math.PI / 2, Math.PI * 0.2]);
  f.mat("metal");
  f.rod(C.steel, seat, [0, BICYCLE.saddleTop - 0.04, -0.1], 0.012);
  f.rod(C.steel, headTop, [0, 0.98, 0.44], 0.013);
  f.rod(C.steel, [0.26, 0.99, 0.45], [-0.26, 0.99, 0.45], 0.012);
  f.mat("rubber");
  f.part(box(0.12, 0.05, 0.25), C.saddle, [0, BICYCLE.saddleTop - 0.025, -0.1]);
  f.part(cyl(0.02, 0.02, 0.1, 6), C.tyre, [0.22, 0.99, 0.45], [0, 0, Math.PI / 2]);
  f.part(cyl(0.02, 0.02, 0.1, 6), C.tyre, [-0.22, 0.99, 0.45], [0, 0, Math.PI / 2]);
  bike.add(f.mesh(null, mats, "metal"));
  bike.add(wheel("bicycle.wheel.rear", rear, mats), wheel("bicycle.wheel.front", front, mats));
  const crank = nameNode(new Group(), "bicycle.crank");
  crank.position.set(...bb);
  const k = new RigidGeometry().mat("metal");
  k.part(cyl(0.1, 0.1, 0.012, 14), C.steel, [-0.045, 0, 0], [0, 0, Math.PI / 2]);
  // At rest (angle 0) the right crank points forward, the left back.
  k.rod(C.steel, [-0.07, 0, 0], [-0.07, 0, BICYCLE.crankLength], 0.012, 4);
  k.rod(C.steel, [0.07, 0, 0], [0.07, 0, -BICYCLE.crankLength], 0.012, 4);
  k.mat("rubber");
  k.part(box(0.09, 0.02, 0.06), C.tyre, [-BICYCLE.pedalX, 0, BICYCLE.crankLength]);
  k.part(box(0.09, 0.02, 0.06), C.tyre, [BICYCLE.pedalX, 0, -BICYCLE.crankLength]);
  crank.add(k.mesh(null, mats, "metal"));
  bike.add(crank);
  return bike;
}

// --- the figure ----------------------------------------------------------------------

function overallsAndHat(arm: Armature): SkinGeometry {
  const s = new SkinGeometry(arm).mat("cloth");
  const o = C.overalls;
  s.part(box(0.345, 0.23, 0.22), "hips", o, [0, 0.95, 0]);
  s.part(box(0.315, 0.22, 0.2), "spine", o, [0, 1.13, 0]);
  s.part(box(0.27, 0.24, 0.03), "chest", o, [0, 1.31, 0.112]);
  s.part(box(0.05, 0.02, 0.24), "chest", o, [0.1, 1.462, 0]);
  s.part(box(0.05, 0.02, 0.24), "chest", o, [-0.1, 1.462, 0]);
  s.part(box(0.05, 0.2, 0.02), "chest", o, [0.1, 1.36, -0.11]);
  s.part(box(0.05, 0.2, 0.02), "chest", o, [-0.1, 1.36, -0.11]);
  s.part(cap(0.085, 0.28), "thigh.L", o, [0.1, 0.69, 0]);
  s.part(cap(0.085, 0.28), "thigh.R", o, [-0.1, 0.69, 0]);
  s.part(cap(0.067, 0.24), "shin.L", o, [0.1, 0.3, 0]);
  s.part(cap(0.067, 0.24), "shin.R", o, [-0.1, 0.3, 0]);
  // A wide straw hat: its brim is the farmer's outline.
  s.mat("straw");
  s.part(cyl(0.27, 0.27, 0.016, 18), "head", C.straw, [0, 1.73, 0.01]);
  s.part(cyl(0.1, 0.113, 0.1, 12), "head", C.straw, [0, 1.785, 0.01]);
  s.part(cyl(0.115, 0.115, 0.022, 12), "head", C.band, [0, 1.75, 0.01]);
  return s;
}

function cyclingJacketAndCap(arm: Armature): SkinGeometry {
  const s = new SkinGeometry(arm).mat("cloth");
  const j = C.cycJacket;
  s.part(box(0.395, 0.27, 0.235), "chest", j, [0, 1.33, 0]);
  s.part(box(0.455, 0.105, 0.215), "chest", j, [0, 1.43, 0]);
  s.part(box(0.315, 0.23, 0.205), "spine", j, [0, 1.13, 0]);
  s.part(box(0.345, 0.08, 0.225), "hips", j, [0, 1.0, 0]);
  s.part(cap(0.058, 0.18), "upper_arm.L", j, [0.19, 1.3, 0]);
  s.part(cap(0.058, 0.18), "upper_arm.R", j, [-0.19, 1.3, 0]);
  s.part(cap(0.05, 0.16), "forearm.L", j, [0.19, 1.04, 0]);
  s.part(cap(0.05, 0.16), "forearm.R", j, [-0.19, 1.04, 0]);
  s.part(cyl(0.07, 0.08, 0.05, 8), "chest", j, [0, 1.475, 0]);
  s.part(dome(0.113, 12, 3), "head", C.cycCap, [0, 1.69, 0.0], [0, 0, 0], [1, 0.72, 1.06]);
  s.part(box(0.13, 0.012, 0.07), "head", C.cycCap, [0, 1.7, 0.125], [0.2, 0, 0]);
  return s;
}

function shepherdCoatAndHat(arm: Armature): SkinGeometry {
  const s = new SkinGeometry(arm).mat("cloth");
  const c = C.coat;
  s.part(box(0.42, 0.3, 0.25), "chest", c, [0, 1.32, -0.005]);
  s.part(box(0.48, 0.1, 0.24), "chest", c, [0, 1.44, -0.005]);
  s.part(box(0.34, 0.24, 0.225), "spine", c, [0, 1.12, -0.005]);
  s.part(box(0.06, 0.26, 0.02), "chest", C.coatDark, [0.07, 1.32, 0.12], [0, 0, -0.15]);
  s.part(box(0.06, 0.26, 0.02), "chest", C.coatDark, [-0.07, 1.32, 0.12], [0, 0, 0.15]);
  s.part(cap(0.062, 0.18), "upper_arm.L", c, [0.19, 1.3, 0]);
  s.part(cap(0.062, 0.18), "upper_arm.R", c, [-0.19, 1.3, 0]);
  s.part(cap(0.054, 0.15), "forearm.L", c, [0.19, 1.05, 0]);
  s.part(cap(0.054, 0.15), "forearm.R", c, [-0.19, 1.05, 0]);
  // Skirts to below the knee, one on each thigh so they swing with the legs.
  s.part(box(0.2, 0.62, 0.27), "thigh.L", c, [0.1, 0.66, -0.01], [0, 0, 0.06]);
  s.part(box(0.2, 0.62, 0.27), "thigh.R", c, [-0.1, 0.66, -0.01], [0, 0, -0.06]);
  s.part(box(0.36, 0.18, 0.24), "hips", c, [0, 0.94, -0.005]);
  s.mat("wool");
  s.part(cyl(0.2, 0.2, 0.016, 16), "head", C.felt, [0, 1.735, 0.01]);
  s.part(cyl(0.095, 0.112, 0.12, 12), "head", C.felt, [0, 1.8, 0.01]);
  return s;
}

function childClothes(arm: Armature): SkinGeometry {
  const s = new SkinGeometry(arm).mat("cloth");
  const top = C.childTop;
  const bottom = C.childBottom;
  s.part(box(0.39, 0.265, 0.23), "chest", top, [0, 1.33, 0]);
  s.part(box(0.45, 0.105, 0.21), "chest", top, [0, 1.43, 0]);
  s.part(box(0.31, 0.225, 0.2), "spine", top, [0, 1.13, 0]);
  s.part(cap(0.057, 0.18), "upper_arm.L", top, [0.19, 1.3, 0]);
  s.part(cap(0.057, 0.18), "upper_arm.R", top, [-0.19, 1.3, 0]);
  s.part(cap(0.049, 0.16), "forearm.L", top, [0.19, 1.04, 0]);
  s.part(cap(0.049, 0.16), "forearm.R", top, [-0.19, 1.04, 0]);
  s.part(box(0.34, 0.22, 0.215), "hips", bottom, [0, 0.95, 0]);
  s.part(cap(0.084, 0.28), "thigh.L", bottom, [0.1, 0.69, 0]);
  s.part(cap(0.084, 0.28), "thigh.R", bottom, [-0.1, 0.69, 0]);
  s.part(cap(0.066, 0.22), "shin.L", bottom, [0.1, 0.31, 0]);
  s.part(cap(0.066, 0.22), "shin.R", bottom, [-0.1, 0.31, 0]);
  return s;
}

/**
 * The shepherd's crook in the right hand: gripped below its middle so the
 * hook stands above the head (the shape that says "shepherd" from afar),
 * the foot a little out from the boot.
 */
function crook(socket: Object3D, mats: Materials): void {
  const g = nameNode(new Group(), "prop.crook");
  const r = new RigidGeometry().mat("wood");
  r.rod(C.crook, [0, -0.5, 0], [0, 1.0, 0], 0.014, 5);
  r.part(new TorusGeometry(0.07, 0.013, 4, 10, Math.PI), C.crook, [0, 1.0, 0.07], [0, -Math.PI / 2, 0]);
  r.rod(C.crook, [0, 1.0, 0.14], [0, 0.94, 0.14], 0.013, 5);
  g.add(r.mesh(null, mats, "wood"));
  g.rotation.z = -0.1;
  g.visible = false;
  socket.add(g);
}

export function buildCivilianAsset(): LoadedAsset {
  const mats = new Materials();
  const { root, arm, socketGun } = humanoid("civilian");
  const body = humanBody(new SkinGeometry(arm), { skin: C.skin, top: C.shirt, trousers: C.trousers, boots: C.shoes, belt: C.belt, hair: C.hair });
  const add = (name: string, s: SkinGeometry) => arm.armature.add(s.mesh(name, mats));
  add("body", body);
  add("var.person.farmer", overallsAndHat(arm));
  add("var.person.cyclist", cyclingJacketAndCap(arm));
  add("var.person.shepherd", shepherdCoatAndHat(arm));
  add("var.person.child", childClothes(arm));
  crook(socketGun, mats);
  root.add(bicycle(mats));
  return { scene: root, animations: civilianClips(body.points()).clips };
}

// --- the clips ------------------------------------------------------------------------

export function civilianClips(points: SkinPoints): ClipSet {
  const poser = new Poser(HUMANOID, "hips");
  const set = new ClipSet(poser, HUMAN_CLIP);
  const plant = (p: Pose, root: V3, l: [number, number] = [0.12, 0.02], r: [number, number] = [-0.12, -0.02]): Pose => {
    let out = poser.reach(p, root, LEG_L, new Vector3(l[0], 0.05, l[1]), new Vector3(0.15, 0, 1), quatOf([0, 8, 0]));
    out = poser.reach(out, root, LEG_R, new Vector3(r[0], 0.05, r[1]), new Vector3(-0.15, 0, 1), quatOf([0, -8, 0]));
    return out;
  };
  const stand = (t: number, body: Pose, root: V3 = [0, -0.012, 0]): Key => ({ t, pose: plant(body, root), root });
  const cos = (phase: number) => Math.cos(2 * Math.PI * phase);
  const sin = (phase: number) => Math.sin(2 * Math.PI * phase);

  // idle: standing easy, breathing, looking about.
  set.add("idle", [
    stand(0, STAND),
    stand(1.0, pose(STAND, { chest: [2.5, 0, 0], head: [-2, 14, 0] }), [0.012, -0.016, 0]),
    stand(2.0, pose(STAND, { chest: [1, 0, 0], head: [0, -10, 0] }), [-0.008, -0.014, 0]),
    stand(3.0, STAND),
  ]);

  // walk: 1.3 m/s, the arms swinging against the legs.
  set.add(
    "walk",
    gait(poser, {
      period: 1.1,
      speed: 1.3,
      duty: 0.6,
      samples: 10,
      stepHeight: 0.07,
      sink: 0.015,
      track: 0.09,
      sway: 0.02,
      upper: (ph) => ({
        hips: [0, -5 * cos(ph), 0],
        spine: [3, 2 * cos(ph), 0],
        chest: [0, 5 * cos(ph), 0],
        head: [0, -2 * cos(ph), 0],
        "upper_arm.L": [20 * cos(ph), 0, 6],
        "upper_arm.R": [-20 * cos(ph), 0, -6],
        "forearm.L": [-14 - 10 * Math.max(0, -cos(ph)), 0, 0],
        "forearm.R": [-14 - 10 * Math.max(0, cos(ph)), 0, 0],
      }),
    }),
  );

  // cycle: on the saddle, leaning to the bars, the feet on the pedals the whole turn.
  const riding: Pose = { hips: [15, 0, 0], spine: [12, 0, 0], chest: [8, 0, 0], neck: [-14, 0, 0], head: [-12, 0, 0] };
  const cycleKeys: Key[] = [];
  const samples = 12;
  for (let i = 0; i <= samples; i++) {
    const t = (i / samples) * BICYCLE.cadence;
    const a = crankAngle(t);
    const bob = 0.004 * Math.cos(2 * a);
    const root: V3 = [0, bob, 0];
    let p = pose(riding, { spine: [12, 0, 1.5 * Math.sin(a)], head: [-12, 0, -1.5 * Math.sin(a)] });
    for (const [side, chain] of [
      [1, LEG_L],
      [-1, LEG_R],
    ] as const) {
      // The ball of the foot on the pedal: the ankle a little above and behind it.
      const ankle = pedal(side, a).add(new Vector3(0, 0.068, -0.1));
      p = poser.reach(p, root, chain, ankle, new Vector3(side * 0.12, 0.4, 1), quatOf([10, 0, 0]));
    }
    const [gx, gy, gz] = BICYCLE.grips;
    p = poser.reach(p, root, ARM_L, new Vector3(gx, gy + 0.02, gz - 0.04), new Vector3(1, -0.6, -0.6));
    p = poser.reach(p, root, ARM_R, new Vector3(-gx, gy + 0.02, gz - 0.04), new Vector3(-1, -0.6, -0.6));
    cycleKeys.push({ t: Math.round(t * 1000) / 1000, pose: p, root });
  }
  set.add("cycle", cycleKeys);

  // wave: the right arm up over the head, the hand going to and fro.
  const waving = (side: number): Pose =>
    pose(STAND, { spine: [-2, 0, 3], chest: [0, 4, 3], head: [-6, 6, -4], "upper_arm.R": [-12, 0, -152], "forearm.R": [0, 0, side * 28], "hand.R": [0, 0, side * 12] });
  set.add("wave", [stand(0, waving(1)), stand(0.3, waving(-1)), stand(0.6, waving(1)), stand(0.9, waving(-1)), stand(1.2, waving(1))]);

  // panic: running at 3 m/s with the arms thrown up, the head turning to look back.
  set.add(
    "panic",
    gait(poser, {
      period: 0.7,
      speed: 3,
      duty: 0.38,
      samples: 8,
      stepHeight: 0.16,
      sink: 0.05,
      lift: 0.03,
      maxDip: 0.1,
      track: 0.09,
      upper: (ph) => ({
        hips: [4, -6 * cos(ph), 0],
        spine: [6, 3 * cos(ph), 0],
        chest: [-4, 5 * cos(ph), 0],
        neck: [0, 10 * sin(ph), 0],
        head: [-8, 16 * sin(ph), 0],
        "upper_arm.L": [-140 + 25 * cos(ph), 0, 38],
        "upper_arm.R": [-140 - 25 * cos(ph), 0, -38],
        "forearm.L": [-45, 0, 0],
        "forearm.R": [-45, 0, 0],
      }),
    }),
  );

  // duck: down low, hands over the head, trembling.
  const duckBody = (tremble: number): Pose =>
    pose(CROUCH, { spine: [38, tremble, 0], chest: [18, 0, tremble], neck: [16, 0, 0], head: [20, tremble * 2, 0] });
  const duck = (t: number, tremble: number): Key => {
    const k = poser.settle(points, { t, pose: duckBody(tremble), root: CROUCH_ROOT });
    let p = k.pose;
    poser.set(p, k.root);
    const l = poser.point("head", [0.06, 0.2, -0.01]);
    const r = poser.point("head", [-0.06, 0.2, -0.01]);
    p = poser.reach(p, k.root, ARM_L, l, new Vector3(1, 0, 1));
    p = poser.reach(p, k.root, ARM_R, r, new Vector3(-1, 0, 1));
    return poser.settle(points, { ...k, pose: p }, 0, true);
  };
  set.add("duck", [duck(0, 0), duck(0.5, 1.5), duck(1, -1), duck(1.5, 1.5), duck(2, 0)]);

  return set;
}
