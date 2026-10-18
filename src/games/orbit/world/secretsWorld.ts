/**
 * The secrets on screen: the spacewalker drifting along the truss on its
 * tether (a thumbs-down if you shoot near, and - shot at - only ever a
 * sticker), the lost tool bag tumbling past, the duck, the arm's hand
 * waving, the crew member pulling the capsule's shade, the storm's
 * lightning on the night side, the Moon and its flag, and the city lights
 * that say "HI". The rules decide when each is found; this makes it happen.
 */
import {
  Box3,
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  TorusGeometry,
  Vector3,
  Vector4,
} from "three";
import { findNode } from "../../../engine/world/names";
import type { Effects } from "./effects";
import type { PlanetSky } from "./planet";

const tmp = new Vector3();
const tmp2 = new Vector3();
const q = new Quaternion();
const q2 = new Quaternion();
const X = new Vector3(1, 0, 0);
const Z = new Vector3(0, 0, 1);

/** The spacewalker floats this far below the truss's handrails on the tether (m): the truss runs along the top edge of the view. */
const ASTRO_BELOW = 2.3;
/** The spacewalker's thumbs-down is held until this long (s) after the shot; then the arm comes down and the walk goes on. */
const THUMBS_HOLD = 2.8;
/** The duck is drawn to look this big at any distance (radians across), so it can be found: a 12 cm duck is a speck 60 m out. */
const DUCK_ANGLE = 0.017;
/**
 * How the capsule's shade is drawn down: the art ships it rolled up at the
 * window's top edge, and says (its extras' note) how far it pulls. It is
 * stretched along its short side, away from the edge it hangs from, which
 * stays put.
 */
interface ShadePull {
  node: Object3D;
  axis: 0 | 1 | 2;
  /** The edge it hangs from (local), and the stretch that makes it the pulled length. */
  anchor: number;
  stretch: number;
  restPosition: Vector3;
  restScale: Vector3;
}

function shadePull(node: Object3D | null): ShadePull | null {
  if (!node) return null;
  const box = new Box3();
  node.updateMatrixWorld(true);
  const inverse = node.matrixWorld.clone().invert();
  node.traverse((o) => {
    const g = (o as Mesh).geometry;
    if (!(o as Mesh).isMesh || !g) return;
    g.computeBoundingBox();
    if (g.boundingBox) box.union(g.boundingBox.clone().applyMatrix4(inverse.clone().multiply(o.matrixWorld)));
  });
  if (box.isEmpty()) return null;
  const size = box.getSize(new Vector3());
  const centre = box.getCenter(new Vector3());
  // The short side (not its thickness): the roll's height.
  const sides = [size.x, size.y, size.z];
  let axis: 0 | 1 | 2 = 0;
  let best = Infinity;
  sides.forEach((s, i) => {
    if (s > 0.01 && s < best) {
      best = s;
      axis = i as 0 | 1 | 2;
    }
  });
  const note = String(node.userData["note"] ?? "");
  const pulled = Number(/to ([\d.]+) ?m/.exec(note)?.[1] ?? 0.24);
  // It hangs from the edge away from the window's middle (the node's origin).
  const anchor = centre.getComponent(axis) >= 0 ? box.max.getComponent(axis) : box.min.getComponent(axis);
  return { node, axis, anchor, stretch: Math.max(1, pulled / Math.max(0.01, best)), restPosition: node.position.clone(), restScale: node.scale.clone() };
}

/** Draw the shade down by `k` (0 rolled up .. 1 pulled). */
function pullShade(s: ShadePull, k: number): void {
  const f = 1 + (s.stretch - 1) * k;
  s.node.scale.copy(s.restScale).setComponent(s.axis, s.restScale.getComponent(s.axis) * f);
  // Keep the edge it hangs from where it was.
  const shift = new Vector3().setComponent(s.axis, s.anchor * s.restScale.getComponent(s.axis) * (1 - f)).applyQuaternion(s.node.quaternion);
  s.node.position.copy(s.restPosition).add(shift);
}

/** The tool bag's drift across the view, in front of all the station (its nearest arm is 11 m out): from/to as (x, y) on screen (-1..1) and metres out. */
const BAG_FROM: [number, number, number] = [-0.95, 0.2, 8.5];
const BAG_TO: [number, number, number] = [0.95, -0.02, 7.5];

interface Tool {
  obj: Object3D;
  vel: Vector3;
  axis: Vector3;
  spin: number;
}

export interface SecretCandidate {
  id: "astronaut" | "toolbag" | "duck" | "arm" | "capsule";
  center: Vector3;
  /** A shot this close (metres) hits it. */
  radius: number;
  /** A shot this close, but not on it, is "near" (the spacewalker, the capsule). */
  near: number;
}

/** A point along a polyline, `u` from 0 to 1. */
function along(points: readonly Vector3[], u: number, out: Vector3): Vector3 {
  if (points.length === 0) return out.set(0, 0, -50);
  if (points.length === 1) return out.copy(points[0] as Vector3);
  const x = Math.min(0.9999, Math.max(0, u)) * (points.length - 1);
  const i = Math.floor(x);
  return out.copy(points[i] as Vector3).lerp(points[i + 1] as Vector3, x - i);
}

export class SecretsWorld {
  private readonly astronaut: Object3D | null;
  private readonly arm: Object3D | null;
  private readonly forearm: Object3D | null;
  private readonly hand: Object3D | null;
  private readonly armRest: Quaternion[] = [];
  private readonly bagSack: Object3D | null;
  /** The tools as the art put them in the bag (or none: then made here). */
  private readonly artTools: Object3D[] = [];
  private readonly sticker: Object3D | null;
  private readonly tether: Line;
  private readonly bag: Object3D | null;
  private readonly duck: Object3D | null;
  private readonly tools: Tool[] = [];
  private readonly astroPath: Vector3[];
  private readonly parent: Object3D;
  private readonly shade: ShadePull | null;
  private readonly toolRest: { position: Vector3; quaternion: Quaternion; scale: Vector3 }[] = [];
  /** The arm's wave: about the arm's own line (the art's wave_axis), in the hand's frame. */
  private readonly waveAxis = new Vector3(0, 1, 0);
  private astroT = -1;
  private astroTurned = -1;
  private astroGone = false;
  /** Seconds left of turning back to the walk after a thumbs-down. */
  private astroSettle = 0;
  private bagT = -1;
  private bagDone = false;
  private duckT = -1;
  private duckSpin = -1;
  private readonly duckVel = new Vector3();
  private handWave = -1;
  private readonly handBase = new Quaternion();
  private shadeT = -1;
  private readonly bagFrom = new Vector3();
  private readonly bagTo = new Vector3();
  /** The storm's flashes: when the last was, and the next. */
  private flashLeft = 0;
  private nextFlash = 0;
  private lastFlash = -10;
  private hiBlink = -1;
  private flagT = -1;
  private time = 0;
  /** The storm's place on the planet (its frame), for this breather. */
  readonly storm = new Vector3(0, 1, 0);
  stormOn = false;

  constructor(
    extras: Object3D,
    parent: Object3D,
    private readonly scenery: {
      astronautPath: Object3D[];
      duckPath: Vector3[];
      armHand: Object3D | null;
      capsuleWindow: Object3D | null;
      capsuleShade: Object3D | null;
      eye: Vector3;
      /** The view: where it looks and its vertical field of view (degrees), for the tool bag's drift. */
      view: { quaternion: Quaternion; fov: number };
    },
    private readonly effects: Effects,
    private readonly sky: PlanetSky,
    private readonly random: () => number,
  ) {
    const take = (name: string): Object3D | null => {
      const n = findNode(extras, name);
      if (!n) return null;
      n.removeFromParent();
      n.position.set(0, 0, 0);
      n.visible = false;
      parent.add(n);
      return n;
    };
    this.astronaut = take("astronaut");
    this.arm = this.astronaut ? findNode(this.astronaut, "astronaut.arm.R") : null;
    this.forearm = this.astronaut ? findNode(this.astronaut, "astronaut.forearm.R") : null;
    this.hand = this.astronaut ? findNode(this.astronaut, "astronaut.hand.R") : null;
    for (const j of [this.arm, this.forearm, this.hand]) this.armRest.push(j ? j.quaternion.clone() : new Quaternion());
    this.sticker = take("sticker");
    this.bag = take("toolbag");
    this.bagSack = this.bag ? findNode(this.bag, "toolbag.bag") : null;
    for (let i = 1; this.bag; i++) {
      const t = findNode(this.bag, `toolbag.tool.${i}`);
      if (!t) break;
      this.artTools.push(t);
    }
    this.duck = take("duck");
    this.astroPath = scenery.astronautPath.map((n) => n.getWorldPosition(new Vector3()));
    this.tether = new Line(new BufferGeometry().setFromPoints([new Vector3(), new Vector3()]), new LineBasicMaterial({ color: "#d8d4c8", transparent: true, opacity: 0.7 }));
    this.tether.visible = false;
    this.tether.frustumCulled = false;
    parent.add(this.tether);
    if (scenery.armHand) this.handBase.copy(scenery.armHand.quaternion);
    // The tools that were in the bag.
    const steel = new MeshStandardMaterial({ color: "#a9adb2", metalness: 1, roughness: 0.35 });
    const grip = new MeshStandardMaterial({ color: "#d8412f", roughness: 0.6 });
    const makers: (() => Object3D)[] = [
      () => new Mesh(new BoxGeometry(0.03, 0.22, 0.012), steel),
      () => {
        const g = new Group();
        g.add(new Mesh(new CylinderGeometry(0.012, 0.012, 0.2, 8), steel));
        const h = new Mesh(new CylinderGeometry(0.02, 0.02, 0.1, 8), grip);
        h.position.y = -0.14;
        g.add(h);
        return g;
      },
      () => new Mesh(new TorusGeometry(0.05, 0.02, 8, 16), new MeshStandardMaterial({ color: "#b0b4b8", roughness: 0.7 })),
      () => new Mesh(new BoxGeometry(0.08, 0.12, 0.04), grip),
    ];
    // The art's tools fly out of the bag; without them, a handful made here.
    for (const t of this.artTools) this.tools.push({ obj: t, vel: new Vector3(), axis: new Vector3(0, 1, 0), spin: 0 });
    for (let i = 0; this.artTools.length === 0 && i < 8; i++) {
      const obj = (makers[i % makers.length] as () => Object3D)();
      obj.visible = false;
      parent.add(obj);
      this.tools.push({ obj, vel: new Vector3(), axis: new Vector3(0, 1, 0), spin: 0 });
    }
    this.parent = parent;
    for (const t of this.artTools) this.toolRest.push({ position: t.position.clone(), quaternion: t.quaternion.clone(), scale: t.scale.clone() });
    this.shade = shadePull(scenery.capsuleShade);
    const hand = scenery.armHand;
    const wave = hand?.userData["wave_axis"];
    if (hand && Array.isArray(wave) && wave.length === 3) {
      // Given in the file's frame: into the hand's own.
      const world = new Vector3(Number(wave[0]), Number(wave[1]), Number(wave[2])).normalize();
      this.waveAxis.copy(world.applyQuaternion(hand.getWorldQuaternion(new Quaternion()).invert()));
    }
    parent.parent?.updateMatrixWorld(true);
  }

  /** Materials to warm up and tone (the tools', the extras'). */
  roots(): Object3D[] {
    return [this.astronaut, this.sticker, this.bag, this.duck, ...this.tools.map((t) => t.obj)].filter((o): o is Object3D => !!o);
  }

  // --- the pass's walk-ons ------------------------------------------------------------

  /** The spacewalker drifts along the truss (pass 2). */
  startAstronaut(): void {
    if (!this.astronaut || this.astroGone) return;
    this.astroT = 0;
    this.astronaut.visible = true;
    this.tether.visible = true;
  }

  /** The tool bag tumbles past, once (pass 3). */
  startToolbag(): void {
    if (!this.bag || this.bagDone) return;
    this.bagT = 0;
    this.bag.visible = true;
    if (this.bagSack) this.bagSack.visible = true;
    for (const t of this.artTools) t.visible = true;
    // Across the view in front of the station, a dozen metres out, left to right.
    this.viewPoint(BAG_FROM, this.bagFrom);
    this.viewPoint(BAG_TO, this.bagTo);
  }

  /** A point in the view: (x, y) on screen, -1..1, at `d` metres. */
  private viewPoint([x, y, d]: [number, number, number], out: Vector3): Vector3 {
    const t = Math.tan((this.scenery.view.fov * Math.PI) / 360);
    return out
      .set(x * t * (16 / 9), y * t, -1)
      .normalize()
      .applyQuaternion(this.scenery.view.quaternion)
      .multiplyScalar(d)
      .add(this.scenery.eye);
  }

  /** The duck drifts through the debris field (pass 2). */
  startDuck(): void {
    if (!this.duck || this.duckSpin >= 0) return;
    this.duckT = 0;
    this.duck.visible = true;
  }

  /** What a shot might find among them now. */
  candidates(): SecretCandidate[] {
    const out: SecretCandidate[] = [];
    if (this.astronaut?.visible && this.astroTurned < 0) out.push({ id: "astronaut", center: this.astronaut.position.clone().add(tmp.set(0, 1.1, 0)), radius: 0.9, near: 5 });
    if (this.bag?.visible && !this.bagDone) out.push({ id: "toolbag", center: this.bag.position, radius: 0.6, near: 0 });
    if (this.duck?.visible && this.duckSpin < 0) out.push({ id: "duck", center: this.duck.position, radius: 0.28 * this.duck.scale.x, near: 0 });
    const hand = this.scenery.armHand;
    if (hand) out.push({ id: "arm", center: hand.getWorldPosition(new Vector3()), radius: 0.7, near: 0 });
    const win = this.scenery.capsuleWindow;
    if (win && this.shadeT < 0) out.push({ id: "capsule", center: win.getWorldPosition(new Vector3()), radius: 0.4, near: 3.2 });
    return out;
  }

  /** The spacewalker, shot near: turns and gives you a slow thumbs-down. Shot at: a sticker all along. */
  astronautShot(at: boolean): void {
    if (!this.astronaut) return;
    if (at) {
      this.astroGone = true;
      this.astronaut.visible = false;
      this.tether.visible = false;
      if (this.sticker) {
        this.sticker.visible = true;
        this.sticker.position.copy(this.astronaut.position).add(tmp.set(0, 1.1, 0.4));
        this.sticker.lookAt(this.scenery.eye);
        this.sticker.scale.setScalar(4);
      }
      this.effects.split(this.astronaut.position.clone().add(tmp.set(0, 1, 0)), new Vector3(), this.astronaut.position.distanceTo(this.scenery.eye));
      return;
    }
    this.astroTurned = 0;
  }

  toolbagShot(): void {
    if (!this.bag) return;
    this.bagDone = true;
    const c = this.bag.position.clone();
    this.effects.split(c.clone(), new Vector3(), c.distanceTo(this.scenery.eye));
    // The art's tools leave the bag where they were in it; the bag is gone.
    this.bag.updateMatrixWorld(true);
    for (const t of this.artTools) this.parent.attach(t);
    this.bag.visible = false;
    for (const t of this.tools) {
      t.obj.visible = true;
      if (!this.artTools.includes(t.obj)) t.obj.position.copy(c);
      t.vel.set(this.random() - 0.5, this.random() - 0.5, this.random() - 0.5).normalize().multiplyScalar(0.6 + this.random() * 1.4);
      t.axis.set(this.random() - 0.5, this.random() - 0.5, this.random() - 0.5).normalize();
      t.spin = 1 + this.random() * 4;
    }
  }

  duckShot(): void {
    if (!this.duck) return;
    this.duckSpin = 0;
    this.duckVel.copy(this.duck.position).sub(this.scenery.eye).normalize().multiplyScalar(6);
  }

  armShot(): void {
    this.handWave = 0;
  }

  capsuleShot(): void {
    this.shadeT = 0;
  }

  // --- the night side --------------------------------------------------------------------

  /** The storm starts flickering at this place (the planet's frame), for the breather's night. */
  startStorm(dir: Vector3): void {
    this.storm.copy(dir).normalize();
    this.stormOn = true;
    this.nextFlash = 0.3 + this.random() * 0.5;
    this.sky.uniform<Vector4>("uLightning").value.set(this.storm.x, this.storm.y, this.storm.z, 0);
  }

  stopStorm(): void {
    this.stormOn = false;
    this.sky.uniform<Vector4>("uLightning").value.w = 0;
  }

  /** Is the storm flashing (or has it just)? A shot now counts. */
  get flashing(): boolean {
    return this.stormOn && this.time - this.lastFlash < 0.4;
  }

  /** Did a shot land on a flash already counted? One flash, one count. */
  private countedFlash = -10;
  takeFlash(): boolean {
    if (!this.flashing || this.countedFlash === this.lastFlash) return false;
    this.countedFlash = this.lastFlash;
    return true;
  }

  /** The "HI" blinks back twice. */
  blinkHi(): void {
    this.hiBlink = 0;
  }

  /** A tiny flag glints on the Moon for a moment. */
  flag(): void {
    this.flagT = 0;
  }

  update(dt: number): void {
    this.time += dt;
    // The spacewalker's drift along the truss, tether and all.
    if (this.astronaut?.visible && this.astroT >= 0) {
      if (this.astroTurned < 0) this.astroT += dt;
      const u = Math.min(1, this.astroT / 55);
      along(this.astroPath, u, this.astronaut.position);
      this.astronaut.position.y += Math.sin(this.time * 0.7) * 0.08 - ASTRO_BELOW;
      const next = along(this.astroPath, Math.min(1, u + 0.01), tmp);
      next.y -= ASTRO_BELOW;
      if (this.astroTurned < 0) {
        const was = q2.copy(this.astronaut.quaternion);
        this.astronaut.lookAt(next);
        this.astronaut.rotateY(Math.PI / 2);
        // Back to the walk after a thumbs-down: turning away, not snapping.
        if (this.astroSettle > 0) {
          this.astroSettle -= dt;
          const walk = q.copy(this.astronaut.quaternion);
          this.astronaut.quaternion.copy(was).slerp(walk, Math.min(1, dt * 2.5));
        }
      } else {
        // Turned to you, slowly, and the arm comes up: thumbs down; held a
        // moment, lowered, and back to work.
        this.astroTurned += dt;
        const t = this.astroTurned;
        const k = t < THUMBS_HOLD ? Math.min(1, t / 1.4) : Math.max(0, 1 - (t - THUMBS_HOLD) / 0.8);
        const face = q.setFromUnitVectors(Z, tmp2.copy(this.scenery.eye).sub(this.astronaut.position).setY(0).normalize());
        this.astronaut.quaternion.slerp(face, Math.min(1, dt * 2));
        // The art's thumbs-down: the arm swings forward about its hinge, the
        // forearm bends a little the same way, the hand turns over.
        const e = k * k * (3 - 2 * k);
        if (this.arm) this.arm.quaternion.copy(this.armRest[0] as Quaternion).multiply(q2.setFromAxisAngle(X, 1.4 * e));
        if (this.forearm) this.forearm.quaternion.copy(this.armRest[1] as Quaternion).multiply(q2.setFromAxisAngle(X, 0.35 * e));
        if (this.hand) this.hand.quaternion.copy(this.armRest[2] as Quaternion).multiply(q2.setFromAxisAngle(Z, Math.PI * e));
        if (t >= THUMBS_HOLD + 0.8) {
          this.astroTurned = -1;
          this.astroSettle = 1.5;
        }
      }
      const pos = this.tether.geometry.getAttribute("position");
      pos.setXYZ(0, this.astronaut.position.x, this.astronaut.position.y + 1.0, this.astronaut.position.z);
      // Clipped to the truss's handrail above.
      const anchor = along(this.astroPath, u, tmp);
      pos.setXYZ(1, anchor.x, anchor.y, anchor.z);
      pos.needsUpdate = true;
      if (u >= 1 && this.astroTurned < 0) {
        this.astronaut.visible = false;
        this.tether.visible = false;
      }
    }
    // The tool bag tumbling past.
    if (this.bag?.visible && this.bagT >= 0) {
      this.bagT += dt;
      const u = this.bagT / 16;
      this.bag.position.copy(this.bagFrom).lerp(this.bagTo, u);
      this.bag.rotation.set(this.bagT * 0.7, this.bagT * 0.4, this.bagT * 0.2);
      if (u >= 1) this.bag.visible = false;
    }
    for (const t of this.tools) {
      if (!t.obj.visible) continue;
      t.obj.position.addScaledVector(t.vel, dt);
      t.obj.quaternion.premultiply(q.setFromAxisAngle(t.axis, t.spin * dt));
    }
    // The duck.
    if (this.duck?.visible) {
      if (this.duckSpin >= 0) {
        this.duckSpin += dt;
        this.duck.position.addScaledVector(this.duckVel, dt);
        this.duck.rotation.x += dt * 9;
        this.duck.rotation.z += dt * 6;
        if (this.duckSpin > 6) this.duck.visible = false;
      } else if (this.duckT >= 0) {
        this.duckT += dt;
        along(this.scenery.duckPath, this.duckT / 40, this.duck.position);
        this.duck.scale.setScalar(Math.max(1, (this.duck.position.distanceTo(this.scenery.eye) * DUCK_ANGLE) / 0.12));
        this.duck.rotation.set(Math.sin(this.duckT * 0.4) * 0.3, this.duckT * 0.25, Math.sin(this.duckT * 0.3) * 0.2);
        if (this.duckT > 40) this.duck.visible = false;
      }
    }
    // The arm's hand, waving.
    const hand = this.scenery.armHand;
    if (hand && this.handWave >= 0) {
      this.handWave += dt;
      const k = this.handWave;
      const swing = k < 2.4 ? Math.sin(k * Math.PI * 2.5) * 0.45 * Math.min(1, (2.4 - k) * 2) : 0;
      hand.quaternion.copy(this.handBase).multiply(q.setFromAxisAngle(this.waveAxis, swing));
      if (k >= 2.4) this.handWave = -1;
    }
    // The capsule's shade, pulled down.
    if (this.shade && this.shadeT >= 0) {
      this.shadeT += dt;
      const k = Math.min(1, this.shadeT / 0.8);
      pullShade(this.shade, k * k * (3 - 2 * k));
    }
    // The storm: lightning in bursts of one to three flashes.
    const lightning = this.sky.uniform<Vector4>("uLightning").value;
    if (this.stormOn) {
      this.nextFlash -= dt;
      if (this.nextFlash <= 0) {
        this.flashLeft = 0.07 + this.random() * 0.06;
        this.lastFlash = this.time;
        this.nextFlash = this.random() < 0.4 ? 0.09 + this.random() * 0.1 : 0.5 + this.random() * 0.9;
      }
      this.flashLeft -= dt;
      lightning.w = this.flashLeft > 0 ? 1 + this.random() * 0.6 : Math.max(0, lightning.w - dt * 18);
    }
    // The HI, blinking back twice.
    const hi = this.sky.uniform<Vector4>("uHi").value;
    if (this.hiBlink >= 0) {
      this.hiBlink += dt;
      const b = this.hiBlink;
      hi.w = (b > 0.2 && b < 0.55) || (b > 0.8 && b < 1.15) ? 3.5 : 0;
      if (b > 1.3) this.hiBlink = -1;
    } else hi.w = 0;
    // The flag on the Moon.
    const flag = this.sky.uniform<number>("uFlag");
    if (this.flagT >= 0) {
      this.flagT += dt;
      flag.value = Math.max(0, Math.sin(Math.min(1, this.flagT / 1.6) * Math.PI));
      if (this.flagT > 1.6) this.flagT = -1;
    } else flag.value = 0;
  }

  reset(): void {
    this.astroT = -1;
    this.astroTurned = -1;
    this.astroGone = false;
    this.astroSettle = 0;
    this.bagT = -1;
    this.bagDone = false;
    this.duckT = -1;
    this.duckSpin = -1;
    this.handWave = -1;
    this.shadeT = -1;
    this.hiBlink = -1;
    this.flagT = -1;
    this.stopStorm();
    for (const o of [this.astronaut, this.bag, this.duck, this.sticker]) if (o) o.visible = false;
    this.tether.visible = false;
    [this.arm, this.forearm, this.hand].forEach((j, i) => j?.quaternion.copy(this.armRest[i] as Quaternion));
    for (const t of this.tools) t.obj.visible = false;
    // The art's tools back in the bag.
    this.artTools.forEach((t, i) => {
      const rest = this.toolRest[i];
      if (!rest || !this.bag) return;
      this.bag.add(t);
      t.position.copy(rest.position);
      t.quaternion.copy(rest.quaternion);
      t.scale.copy(rest.scale);
      t.visible = true;
    });
    if (this.shade) pullShade(this.shade, 0);
    if (this.scenery.armHand) this.scenery.armHand.quaternion.copy(this.handBase);
  }
}
