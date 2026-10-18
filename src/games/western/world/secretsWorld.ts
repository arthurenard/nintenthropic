import {
  Box3,
  CircleGeometry,
  Color,
  Mesh,
  MeshBasicMaterial,
  Vector3,
  Object3D,
} from "three";
import type { ParticleStyle } from "../../../engine/fx/particles";
import type { Cover } from "../rules/types";
import type { Effects } from "./effects";
import type { TownQueries } from "./queries";
import type { Sound } from "../../../engine/world/sound";
import type { TownLayout } from "./town";

interface Leak {
  readonly at: Vector3;
  readonly out: Vector3;
  readonly land: Vector3;
  puddle: Mesh;
  age: number;
}

const tmp = new Vector3();
const tmp2 = new Vector3();

/**
 * The town's secrets made visible: the bell swings, the church doors open
 * for the preacher, the vane spins and creaks round to point at you, the
 * water tower leaks for the rest of the game, the wanted poster flutters
 * down. The rules (rules/secrets.ts) decide when a secret is found; this
 * only makes it happen.
 */
export class SecretsWorld {
  private bellAngle = 0;
  private bellVel = 0;
  private vaneVel = 0;
  private vaneSettling = false;
  private vaneFrom = 0;
  private vaneTo = 0;
  private vaneT = 0;
  private doorsOpen = 0;
  private doorsTarget = 0;
  private doorsTimer = 0;
  private readonly doorSign: number[] = [];
  private readonly leaks: Leak[] = [];
  private leakCarry = 0;
  private posterFalling = false;
  private posterT = 0;
  private posterFloor = 0;
  private readonly posterStart = new Vector3();
  private readonly posterAway = new Vector3();
  private readonly bellC = new Vector3();
  private readonly vaneC = new Vector3();
  private readonly puddleMat = new MeshBasicMaterial({ color: "#2f2a24", transparent: true, opacity: 0.45, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 });
  private readonly puddleGeo = new CircleGeometry(1, 24);
  private readonly posterHome = new Object3D();

  constructor(
    private readonly town: TownLayout,
    private readonly fx: Effects,
    private readonly sound: Sound,
    private readonly queries: TownQueries,
    private readonly parent: Object3D,
  ) {
    const s = town.secrets;
    // Which way each church door swings open: its middle toward the street.
    for (const door of [s.doorLeft, s.doorRight]) {
      if (!door) {
        this.doorSign.push(1);
        continue;
      }
      const box = new Box3().setFromObject(door);
      const mid = box.getCenter(new Vector3());
      const pivot = door.getWorldPosition(new Vector3());
      const off = mid.sub(pivot);
      // Rotating by +a about Y moves (x, z) toward (x cos a + z sin a, −x sin a + z cos a).
      const zAfter = -off.x * Math.sin(1) + off.z * Math.cos(1);
      this.doorSign.push(zAfter > off.z ? 1 : -1);
    }
    if (s.poster) {
      this.posterHome.position.copy(s.poster.position);
      this.posterHome.quaternion.copy(s.poster.quaternion);
    }
  }

  /** The world stops under the results: the water tower's trickle is not heard on over a still picture. */
  hush(): void {
    this.sound.stopLoop("water_leak");
  }

  /** The poster back on its board, the leaks plugged, the doors shut (a new game). */
  reset(): void {
    const poster = this.town.secrets.poster;
    if (poster) {
      poster.position.copy(this.posterHome.position);
      poster.quaternion.copy(this.posterHome.quaternion);
    }
    this.posterFalling = false;
    for (const l of this.leaks) l.puddle.removeFromParent();
    this.leaks.length = 0;
    this.sound.stopLoop("water_leak");
    this.doorsTarget = 0;
    this.doorsTimer = 0;
    this.bellVel = 0;
  }

  bellCenter(): Vector3 | null {
    const bell = this.town.secrets.bell;
    if (!bell) return null;
    return bell.getWorldPosition(this.bellC).add(tmp.set(0, -0.5, 0));
  }

  vaneCenter(): Vector3 | null {
    const vane = this.town.secrets.vane;
    if (!vane) return null;
    return vane.getWorldPosition(this.vaneC).add(tmp.set(0, 0.4, 0));
  }

  /** The bell is struck (by a bullet, or by the duel). */
  bellHit(strength = 1): void {
    this.bellVel += (this.bellVel >= 0 ? 1 : -1) * 2.8 * strength;
    const c = this.bellCenter();
    if (c) this.sound.at("bell_toll", c, 1);
  }

  openDoors(): void {
    this.doorsTarget = 1;
    this.doorsTimer = 5.5;
    const d = this.town.secrets.doorLeft;
    if (d) this.sound.at("church_door_creak", d.getWorldPosition(tmp), 1);
  }

  /** Where the preacher stands to look out, as a cover the rules understand. */
  preacherCover(): Cover | null {
    const l = this.town.secrets.doorLeft;
    const r = this.town.secrets.doorRight;
    if (!l || !r) return null;
    const a = l.getWorldPosition(new Vector3());
    const b = r.getWorldPosition(new Vector3());
    const mid = a.add(b).multiplyScalar(0.5);
    const eye = this.town.eye;
    tmp.set(eye.x - mid.x, 0, eye.z - mid.z).normalize();
    return {
      id: "church_doors",
      kind: "door",
      emerge: "step_out",
      level: 0,
      exposed: { x: mid.x + tmp.x * 0.35, y: mid.y, z: mid.z + tmp.z * 0.35 },
      hidden: { x: mid.x - tmp.x * 1.4, y: mid.y, z: mid.z - tmp.z * 1.4 },
      distance: Math.hypot(mid.x - eye.x, mid.z - eye.z),
      side: 0,
      tags: [],
    };
  }

  /** Seconds until the vane has spun down and come round to point at you (0 when still). */
  vaneShowLeft(): number {
    if (this.vaneSettling) return (1 - this.vaneT) * 1.6;
    if (this.vaneVel <= 1.6) return 0;
    return Math.log(this.vaneVel / 1.6) / 0.55 + 1.6;
  }

  vaneHit(): void {
    this.vaneVel += 22 + Math.random() * 6;
    this.vaneSettling = false;
    const c = this.vaneCenter();
    if (c) this.sound.at("vane_spin", c, 1);
  }

  towerHit(point: Vector3, normal: Vector3): void {
    if (this.leaks.length >= 4) return;
    const at = point.clone();
    const out = normal.clone().setY(0).normalize();
    if (out.lengthSq() < 0.1) out.set(-1, 0, 0);
    // Where the stream meets the ground: a short ballistic arc out of the hole.
    const v0 = 2.6;
    const floor = this.queries.groundAt(at.x + out.x * 1.5, at.z + out.z * 1.5, at.y - 0.5);
    const h = Math.max(0.5, at.y - floor);
    const t = Math.sqrt((2 * h) / 9.81);
    const land = new Vector3(at.x + out.x * v0 * t, floor + 0.02, at.z + out.z * v0 * t);
    const puddle = new Mesh(this.puddleGeo, this.puddleMat);
    puddle.rotation.x = -Math.PI / 2;
    puddle.position.copy(land);
    puddle.scale.setScalar(0.05);
    this.parent.add(puddle);
    this.leaks.push({ at, out, land, puddle, age: 0 });
    this.fx.splash(point, 0.6);
    this.sound.at("hit_water", point, 1);
    if (!this.sound.hasLoop("water_leak")) this.sound.loopAt("water_leak", "water_leak", point, 0.7);
  }

  pianoNote(note: number): void {
    const p = this.town.secrets.piano;
    this.sound.at(`piano_note_${note}`, p ? p.getWorldPosition(tmp) : this.town.eye, 1);
  }

  pianoTune(): void {
    const p = this.town.secrets.piano;
    this.sound.at("piano_tune", p ? p.getWorldPosition(tmp) : this.town.eye, 1, 1, 0.35);
  }

  posterHit(): void {
    const poster = this.town.secrets.poster;
    if (!poster || this.posterFalling) return;
    this.posterFalling = true;
    this.posterT = 0;
    poster.getWorldPosition(this.posterStart);
    // Off the wall, toward the street.
    poster.getWorldDirection(this.posterAway);
    const eye = this.town.eye;
    tmp.set(eye.x - this.posterStart.x, 0, eye.z - this.posterStart.z).normalize();
    if (this.posterAway.dot(tmp) < 0) this.posterAway.negate();
    this.posterAway.setY(0).normalize();
    this.posterFloor = this.queries.groundAt(this.posterStart.x + this.posterAway.x * 0.5, this.posterStart.z + this.posterAway.z * 0.5, this.posterStart.y - 0.5) + 0.01;
    this.sound.at("poster_flutter", this.posterStart, 1);
  }

  update(dt: number): void {
    const s = this.town.secrets;
    // The bell: a damped pendulum on its yoke.
    if (s.bell) {
      const g = 9.81 / 0.55;
      this.bellVel += (-g * Math.sin(this.bellAngle) - 0.35 * this.bellVel) * dt;
      this.bellAngle += this.bellVel * dt;
      s.bell.rotation.x = this.bellAngle;
    }
    // The vane: spins down, then creaks round to point at you.
    if (s.vane) {
      if (!this.vaneSettling && this.vaneVel > 0) {
        s.vane.rotation.y += this.vaneVel * dt;
        this.vaneVel *= Math.exp(-dt * 0.55);
        if (this.vaneVel < 1.6) {
          this.vaneSettling = true;
          this.vaneFrom = s.vane.rotation.y;
          const p = s.vane.getWorldPosition(tmp);
          const eye = this.town.eye;
          // The arrow is the vane's local +X; face it toward the player.
          const want = Math.atan2(-(eye.z - p.z), eye.x - p.x);
          let to = want;
          while (to < this.vaneFrom) to += Math.PI * 2;
          this.vaneTo = to;
          this.vaneT = 0;
          this.vaneVel = 0;
          this.sound.at("vane_spin", p, 0.5, 0.6);
        }
      } else if (this.vaneSettling) {
        this.vaneT = Math.min(1, this.vaneT + dt / 1.6);
        const e = 1 - Math.pow(1 - this.vaneT, 3);
        s.vane.rotation.y = this.vaneFrom + (this.vaneTo - this.vaneFrom) * e;
        if (this.vaneT >= 1) this.vaneSettling = false;
      }
    }
    // The church doors.
    if (this.doorsTimer > 0) {
      this.doorsTimer -= dt;
      if (this.doorsTimer <= 0) {
        this.doorsTarget = 0;
        const d = s.doorLeft;
        if (d) this.sound.at("church_door_creak", d.getWorldPosition(tmp), 0.7, 1.1);
      }
    }
    this.doorsOpen += (this.doorsTarget - this.doorsOpen) * Math.min(1, dt * (this.doorsTarget > this.doorsOpen ? 1.6 : 2.5));
    if (s.doorLeft) s.doorLeft.rotation.y = (this.doorSign[0] as number) * this.doorsOpen * 1.35;
    if (s.doorRight) s.doorRight.rotation.y = (this.doorSign[1] as number) * this.doorsOpen * 1.35;
    // Leaks: a steady stream, droplets arcing out, a puddle that grows.
    if (this.leaks.length) {
      this.leakCarry += dt * 110;
      while (this.leakCarry >= 1) {
        this.leakCarry -= 1;
        const l = this.leaks[Math.floor(Math.random() * this.leaks.length)] as Leak;
        tmp2.copy(l.out).multiplyScalar(2.4 + Math.random() * 0.4);
        tmp2.y = (Math.random() - 0.5) * 0.3;
        this.fx.alpha.emit(l.at.x, l.at.y, l.at.z, tmp2.x, tmp2.y, tmp2.z, LEAK_STYLE, 1, undefined);
      }
      for (const l of this.leaks) {
        l.age += dt;
        l.puddle.scale.setScalar(Math.min(1.6, 0.2 + l.age * 0.05));
        if (Math.random() < dt * 8) this.fx.alpha.emit(l.land.x, l.land.y + 0.05, l.land.z, (Math.random() - 0.5) * 0.6, 0.6, (Math.random() - 0.5) * 0.6, SPLASH_STYLE, 1);
      }
    }
    // The poster flutters down, swaying.
    const poster = s.poster;
    if (poster && this.posterFalling) {
      this.posterT += dt;
      const t = this.posterT;
      const y = Math.max(this.posterFloor, this.posterStart.y - t * 0.9);
      const away = Math.min(0.55, t * 0.5);
      poster.position.set(
        this.posterStart.x + this.posterAway.x * away + Math.sin(t * 5) * 0.12 * this.posterAway.z,
        y,
        this.posterStart.z + this.posterAway.z * away + Math.sin(t * 5) * 0.12 * this.posterAway.x,
      );
      if (poster.parent && poster.parent !== this.town.root) poster.parent.worldToLocal(poster.position);
      const landed = y <= this.posterFloor;
      if (!landed) poster.rotation.z = Math.sin(t * 4.5) * 0.5;
      if (landed) {
        // Lying flat on the boards, face up (x first, then the yaw it landed with).
        const k = Math.min(1, dt * 6);
        poster.rotation.x += (-Math.PI / 2 - poster.rotation.x) * k;
        poster.rotation.y += (0 - poster.rotation.y) * k;
        poster.rotation.z += (0.4 - poster.rotation.z) * k;
      }
    }
  }
}

const LEAK_STYLE: ParticleStyle = { life: [0.6, 0.9], size: [0.14, 0.22], color: new Color("#d2e6ec"), alpha: [0.85, 0.35], gravity: 9.8, drag: 0.1, frame: 0, spin: 0, floor: 0.02 };
const SPLASH_STYLE: ParticleStyle = { life: [0.3, 0.6], size: [0.12, 0.35], color: new Color("#cfdfe2"), alpha: [0.35, 0], gravity: 1, drag: 2, frame: 1, spin: 0.5 };
