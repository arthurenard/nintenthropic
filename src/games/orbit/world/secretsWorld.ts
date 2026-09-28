/**
 * The secrets on screen: the spacewalker drifting along the truss on its
 * tether (a thumbs-down if you shoot near, and - shot at - only ever a
 * sticker), the lost tool bag tumbling past, the duck, the arm's hand
 * waving, the crew member pulling the capsule's shade, the storm's
 * lightning on the night side, the Moon and its flag, and the city lights
 * that say "HI". The rules decide when each is found; this makes it happen.
 */
import {
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
const q = new Quaternion();

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
  private readonly sticker: Object3D | null;
  private readonly tether: Line;
  private readonly bag: Object3D | null;
  private readonly duck: Object3D | null;
  private readonly tools: Tool[] = [];
  private readonly astroPath: Vector3[];
  private astroT = -1;
  private astroTurned = -1;
  private astroGone = false;
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
    private readonly scenery: { astronautPath: Object3D[]; duckPath: Vector3[]; armHand: Object3D | null; capsuleWindow: Object3D | null; capsuleShade: Object3D | null; eye: Vector3 },
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
    this.sticker = take("sticker");
    this.bag = take("toolbag");
    this.duck = take("duck");
    if (this.duck) this.duck.scale.setScalar(3);
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
    for (let i = 0; i < 8; i++) {
      const obj = (makers[i % makers.length] as () => Object3D)();
      obj.visible = false;
      parent.add(obj);
      this.tools.push({ obj, vel: new Vector3(), axis: new Vector3(0, 1, 0), spin: 0 });
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
    // Across the view, 25 m out, from the left to the right.
    const e = this.scenery.eye;
    this.bagFrom.set(e.x - 22, e.y + 2, e.z - 26);
    this.bagTo.set(e.x + 22, e.y - 4, e.z - 20);
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
    if (this.duck?.visible && this.duckSpin < 0) out.push({ id: "duck", center: this.duck.position, radius: 0.9, near: 0 });
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
    this.bag.visible = false;
    const c = this.bag.position;
    this.effects.split(c.clone(), new Vector3(), c.distanceTo(this.scenery.eye));
    for (const t of this.tools) {
      t.obj.visible = true;
      t.obj.position.copy(c);
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

  update(dt: number, passT: number): void {
    this.time += dt;
    // The spacewalker's drift along the truss, tether and all.
    if (this.astronaut?.visible && this.astroT >= 0) {
      if (this.astroTurned < 0) this.astroT += dt;
      const u = Math.min(1, this.astroT / 55);
      along(this.astroPath, u, this.astronaut.position);
      this.astronaut.position.y += Math.sin(this.time * 0.7) * 0.08;
      const next = along(this.astroPath, Math.min(1, u + 0.01), tmp);
      if (this.astroTurned < 0) {
        this.astronaut.lookAt(next);
        this.astronaut.rotateY(Math.PI / 2);
      } else {
        // Turned to you, slowly, and the arm comes up: thumbs down.
        this.astroTurned += dt;
        const k = Math.min(1, this.astroTurned / 1.4);
        const face = q.setFromUnitVectors(new Vector3(0, 0, 1), this.scenery.eye.clone().sub(this.astronaut.position).setY(0).normalize());
        this.astronaut.quaternion.slerp(face, Math.min(1, dt * 2));
        if (this.arm) this.arm.rotation.set(0, 0, 2.2 * k * k * (3 - 2 * k));
      }
      const pos = this.tether.geometry.getAttribute("position");
      pos.setXYZ(0, this.astronaut.position.x, this.astronaut.position.y + 1.0, this.astronaut.position.z);
      const anchor = this.astroPath[0] ?? this.astronaut.position;
      pos.setXYZ(1, anchor.x, anchor.y + 0.6, anchor.z);
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
      hand.quaternion.copy(this.handBase).multiply(q.setFromAxisAngle(new Vector3(0, 1, 0), swing));
      if (k >= 2.4) this.handWave = -1;
    }
    // The capsule's shade, pulled down.
    const shade = this.scenery.capsuleShade;
    if (shade && this.shadeT >= 0) {
      this.shadeT += dt;
      const k = Math.min(1, this.shadeT / 0.8);
      const e = k * k * (3 - 2 * k);
      shade.scale.y = 0.02 + 0.98 * e;
      shade.position.y = 0.44 - 0.44 * e;
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
      hi.w = (b > 0.2 && b < 0.55) || (b > 0.8 && b < 1.15) ? 6 : 0;
      if (b > 1.3) this.hiBlink = -1;
    } else hi.w = 0;
    // The flag on the Moon.
    const flag = this.sky.uniform<number>("uFlag");
    if (this.flagT >= 0) {
      this.flagT += dt;
      flag.value = Math.max(0, Math.sin(Math.min(1, this.flagT / 1.6) * Math.PI));
      if (this.flagT > 1.6) this.flagT = -1;
    } else flag.value = 0;
    void passT;
  }

  reset(): void {
    this.astroT = -1;
    this.astroTurned = -1;
    this.astroGone = false;
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
    if (this.arm) this.arm.rotation.set(0, 0, 0);
    for (const t of this.tools) t.obj.visible = false;
    const shade = this.scenery.capsuleShade;
    if (shade) {
      shade.scale.y = 0.02;
      shade.position.y = 0.44;
    }
    if (this.scenery.armHand) this.scenery.armHand.quaternion.copy(this.handBase);
  }
}
