import type { ParticleStyle } from "../../../engine/fx/particles";
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  Euler,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
  type Object3D,
} from "three";
import type { Quality } from "../../../engine/types";
import type { Effects } from "./effects";
import type { Rig, RigPool } from "../../../engine/world/character";
import type { Sound } from "../../../engine/world/sound";
import type { TownLayout } from "./town";

interface Weed {
  active: boolean;
  mesh: Mesh;
  s: number;
  speed: number;
  radius: number;
  hop: number;
  giant: boolean;
  readonly center: Vector3;
}

const tmp = new Vector3();
const axis = new Vector3();
const dir = new Vector3();

/** A ball of dry twigs: thin sticks laid tangent to a sphere, merged into one mesh. */
function tumbleweedGeometry(random: () => number): BufferGeometry {
  const parts: number[] = [];
  const normals: number[] = [];
  const box = new BoxGeometry(1, 1, 1).toNonIndexed();
  const p = box.getAttribute("position");
  const n = box.getAttribute("normal");
  const m = new Matrix4();
  const q = new Quaternion();
  const e = new Euler();
  const v = new Vector3();
  const s = new Vector3();
  const nm = new Vector3();
  for (let i = 0; i < 150; i++) {
    const u = random() * 2 - 1;
    const a = random() * Math.PI * 2;
    const r = Math.sqrt(1 - u * u);
    const c = new Vector3(r * Math.cos(a), u, r * Math.sin(a)).multiplyScalar(0.3 + random() * 0.08);
    e.set(random() * 6.28, random() * 6.28, random() * 6.28);
    q.setFromEuler(e);
    s.set(0.012, 0.012, 0.18 + random() * 0.28);
    m.compose(c, q, s);
    for (let k = 0; k < p.count; k++) {
      v.fromBufferAttribute(p, k).applyMatrix4(m);
      parts.push(v.x, v.y, v.z);
      nm.fromBufferAttribute(n, k).applyQuaternion(q);
      normals.push(nm.x, nm.y, nm.z);
    }
  }
  box.dispose();
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(parts), 3));
  g.setAttribute("normal", new BufferAttribute(new Float32Array(normals), 3));
  g.computeBoundingSphere();
  return g;
}

/**
 * The town breathing between shots: tumbleweeds rolling down their path
 * (a giant one when earned), the chicken pecking along the boardwalk, dust
 * motes hanging in the low sun, and the far-off sounds — wind, a dog, a crow,
 * a horse, a shutter.
 */
export class Ambient {
  private readonly weeds: Weed[] = [];
  private readonly path: Vector3[];
  private readonly lengths: number[] = [];
  private total = 0;
  private weedTimer = 6;
  private moteCarry = 0;
  private readonly moteRate: number;
  private readonly chickenPath: Vector3[];
  private chicken: Rig | null = null;
  private chickenState: "peck" | "walk" | "flutter" | "run" = "peck";
  private chickenTimer = 2;
  private chickenAt = 0;
  private chickenTo = 0;
  private readonly chickenPos = new Vector3();
  private readonly chickenCenter = new Vector3();
  private clucks = 4;
  private soundTimers = { dog: 18, crow: 26, horse: 34, shutter: 14 };
  running = false;

  constructor(
    private readonly town: TownLayout,
    parent: Object3D,
    chickenPool: RigPool,
    private readonly fx: Effects,
    private readonly sound: Sound,
    private readonly random: () => number,
    quality: Quality,
  ) {
    this.path = town.tumbleweedPath.length >= 2 ? town.tumbleweedPath : [new Vector3(16, 0, -10), new Vector3(-18, 0, -32)];
    for (let i = 1; i < this.path.length; i++) {
      const l = (this.path[i] as Vector3).distanceTo(this.path[i - 1] as Vector3);
      this.lengths.push(l);
      this.total += l;
    }
    const geo = tumbleweedGeometry(random);
    const mat = new MeshStandardMaterial({ color: "#a2825a", roughness: 1, name: "tumbleweed" });
    for (let i = 0; i < 4; i++) {
      const mesh = new Mesh(geo, mat);
      mesh.castShadow = true;
      mesh.visible = false;
      parent.add(mesh);
      this.weeds.push({ active: false, mesh, s: 0, speed: 4, radius: 0.36, hop: 0, giant: false, center: new Vector3() });
    }
    this.moteRate = (quality.tier === "low" ? 40 : quality.tier === "medium" ? 90 : 160) / 8.5;
    this.chickenPath = town.chickenPath.length >= 2 ? town.chickenPath : [];
    const rig = this.chickenPath.length ? chickenPool.take() : null;
    if (rig) {
      this.chicken = rig;
      const start = this.chickenPath[0] as Vector3;
      this.chickenPos.copy(start);
      rig.root.position.copy(start);
      rig.root.visible = true;
      rig.play("peck", 0);
    }
  }

  // --- tumbleweeds --------------------------------------------------------------------

  tumbleweeds(): readonly Weed[] {
    return this.weeds;
  }

  spawnTumbleweed(giant: boolean): void {
    const w = giant ? this.weeds[3] : this.weeds.slice(0, 3).find((x) => !x.active);
    if (!w || w.active) return;
    w.active = true;
    w.giant = giant;
    // The giant starts at the mouth of the alley, so it is seen as it is announced.
    w.s = giant ? Math.max(0, (this.lengths[0] ?? 0) - 1.2) : 0;
    w.speed = giant ? 2.6 : 3.2 + this.random() * 2.2;
    w.radius = giant ? 1.15 : 0.36 + this.random() * 0.08;
    w.mesh.scale.setScalar(w.radius / 0.36);
    w.mesh.visible = true;
    w.hop = this.random() * 3;
    this.placeWeed(w);
    if (!this.sound.hasLoop("tumbleweed")) this.sound.loopAt("tumbleweed", "tumbleweed_roll", w.center, giant ? 1 : 0.6);
  }

  /** A tumbleweed shot to pieces. */
  shootTumbleweed(i: number): void {
    const w = this.weeds[i];
    if (!w || !w.active) return;
    w.active = false;
    w.mesh.visible = false;
    this.fx.twigs(w.center, w.giant ? 40 : 18, 0.02, w.giant ? 2 : 1);
    this.sound.at("wood_splinter", w.center, 0.8, 1.3);
    this.stopRollIfDone();
  }

  private stopRollIfDone(): void {
    if (!this.weeds.some((w) => w.active)) this.sound.stopLoop("tumbleweed");
  }

  private placeWeed(w: Weed): void {
    let left = w.s;
    let i = 0;
    while (i < this.lengths.length - 1 && left > (this.lengths[i] as number)) {
      left -= this.lengths[i] as number;
      i++;
    }
    const a = this.path[i] as Vector3;
    const b = this.path[i + 1] as Vector3;
    const seg = this.lengths[i] as number;
    const t = seg > 0 ? Math.min(1, left / seg) : 1;
    dir.subVectors(b, a).setY(0).normalize();
    w.center.lerpVectors(a, b, t);
    const bounce = Math.abs(Math.sin(w.hop)) * (w.giant ? 0.5 : 0.28);
    w.center.y += w.radius + bounce;
    w.mesh.position.copy(w.center);
  }

  private updateWeeds(dt: number): void {
    for (const w of this.weeds) {
      if (!w.active) continue;
      w.s += w.speed * dt;
      w.hop += dt * w.speed * (w.giant ? 0.9 : 1.6);
      if (w.s >= this.total) {
        w.active = false;
        w.mesh.visible = false;
        this.stopRollIfDone();
        continue;
      }
      this.placeWeed(w);
      // Roll: about the horizontal axis across the direction of travel.
      axis.set(dir.z, 0, -dir.x);
      w.mesh.rotateOnWorldAxis(axis, -(w.speed * dt) / w.radius);
      if (this.random() < dt * 6) {
        tmp.copy(w.center);
        tmp.y = 0.05;
        this.fx.alpha.emit(tmp.x, tmp.y, tmp.z, (this.random() - 0.5) * 0.4, 0.2, (this.random() - 0.5) * 0.4, DUST_TRAIL, w.giant ? 2.5 : 1);
      }
    }
    if (this.running) {
      this.weedTimer -= dt;
      if (this.weedTimer <= 0) {
        this.weedTimer = 14 + this.random() * 12;
        this.spawnTumbleweed(false);
      }
    }
  }

  // --- the chicken --------------------------------------------------------------------

  chickenCenterOrNull(): Vector3 | null {
    if (!this.chicken) return null;
    return this.chickenCenter.copy(this.chickenPos).setY(this.chickenPos.y + 0.22);
  }

  startleChicken(): void {
    const rig = this.chicken;
    if (!rig) return;
    this.chickenState = "flutter";
    this.chickenTimer = 0.45;
    rig.play("flutter", 0.05, false);
    this.fx.feathers(this.chickenCenter.copy(this.chickenPos).setY(this.chickenPos.y + 0.25), 16);
    this.sound.at("chicken_squawk", this.chickenPos, 1, 0.95 + this.random() * 0.15);
    this.sound.at("feathers", this.chickenPos, 0.7);
    // Run off to a far waypoint.
    const n = this.chickenPath.length;
    this.chickenTo = (this.chickenAt + 2 + Math.floor(this.random() * Math.max(1, n - 2))) % n;
  }

  private updateChicken(dt: number): void {
    const rig = this.chicken;
    if (!rig) return;
    this.chickenTimer -= dt;
    const target = this.chickenPath[this.chickenTo] as Vector3;
    switch (this.chickenState) {
      case "peck":
        if (this.chickenTimer <= 0) {
          const n = this.chickenPath.length;
          this.chickenTo = (this.chickenAt + (this.random() < 0.5 ? 1 : n - 1)) % n;
          this.chickenState = "walk";
          rig.play("walk", 0.2);
        }
        break;
      case "walk":
      case "run": {
        const speed = this.chickenState === "run" ? 2.6 : 0.4;
        tmp.subVectors(target, this.chickenPos).setY(0);
        const d = tmp.length();
        if (d < 0.05) {
          this.chickenAt = this.chickenTo;
          this.chickenState = "peck";
          this.chickenTimer = 1.5 + this.random() * 3;
          rig.play("peck", 0.2);
        } else {
          tmp.multiplyScalar(Math.min(d, speed * dt) / d);
          this.chickenPos.add(tmp);
          rig.root.rotation.y = Math.atan2(tmp.x, tmp.z);
        }
        break;
      }
      case "flutter":
        if (this.chickenTimer <= 0) {
          this.chickenState = "run";
          rig.play("run", 0.1);
        }
        break;
    }
    this.chickenPos.y = target.y;
    rig.root.position.copy(this.chickenPos);
    rig.update(dt);
    this.clucks -= dt;
    if (this.clucks <= 0) {
      this.clucks = 4 + this.random() * 6;
      this.sound.at("chicken_cluck", this.chickenPos, 0.55, 0.9 + this.random() * 0.25);
    }
  }

  // --- motes and far-off sounds ----------------------------------------------------------

  private updateMotes(dt: number): void {
    this.moteCarry += dt * this.moteRate;
    const r = this.random;
    while (this.moteCarry >= 1) {
      this.moteCarry -= 1;
      const depth = r();
      const z = this.town.eye.z - 2.5 - depth * depth * 22;
      tmp.set(this.town.eye.x + (r() - 0.5) * (6 + depth * 10), 0.3 + r() * 4.2, z);
      this.fx.mote(tmp);
    }
  }

  private updateSounds(dt: number): void {
    const t = this.soundTimers;
    const r = this.random;
    t.dog -= dt;
    t.crow -= dt;
    t.horse -= dt;
    t.shutter -= dt;
    if (t.dog <= 0) {
      t.dog = 22 + r() * 30;
      this.sound.play("dog_bark_distant", { volume: 0.5, pan: r() * 2 - 1, distance: 120 });
    }
    if (t.crow <= 0) {
      t.crow = 26 + r() * 30;
      this.sound.play("crow_caw", { volume: 0.4, pan: r() * 2 - 1, distance: 60 });
    }
    if (t.horse <= 0) {
      t.horse = 32 + r() * 40;
      this.sound.at("horse_neigh", tmp.set(-9, 4.5, -47), 0.6);
    }
    if (t.shutter <= 0) {
      t.shutter = 16 + r() * 22;
      this.sound.at("shutter_bang", tmp.set(r() < 0.5 ? -8.6 : 8.6, 4.6, -20 - r() * 20), 0.5);
    }
  }

  update(dt: number, sounds: boolean): void {
    this.updateWeeds(dt);
    this.updateChicken(dt);
    this.updateMotes(dt);
    if (sounds) this.updateSounds(dt);
  }

  /** The world stops under the results: a tumbleweed's roll stops with it (the wind blows on). */
  hush(): void {
    this.sound.stopLoop("tumbleweed");
  }

  reset(): void {
    for (const w of this.weeds) {
      w.active = false;
      w.mesh.visible = false;
    }
    this.sound.stopLoop("tumbleweed");
    this.weedTimer = 6;
  }
}

const DUST_TRAIL: ParticleStyle = { life: [0.8, 1.4], size: [0.15, 0.6], color: new Color("#cdb08a"), alpha: [0.3, 0], fadeIn: 0.1, gravity: -0.1, drag: 2, frame: 1, spin: 0.6 };
