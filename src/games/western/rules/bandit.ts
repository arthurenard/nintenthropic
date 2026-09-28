import type { V3 } from "./raymath";
import { chance, range, type Random } from "./rng";
import {
  DEATH_TIME,
  DUEL_DRAW,
  DUEL_PACES,
  DUEL_PACE_TIME,
  DUEL_STANDOFF,
  EMERGE_TIME,
  FALL_DEATH_TIME,
  FIRE_RECOVER,
  HIDDEN_WAIT,
  HIDE_TIME,
  RELOCATE_CHANCE,
  RELOCATE_SPEED,
  RUN_CHANCE,
  RUN_SPEED,
  STAGGER_TIME,
  TELL_TIME,
  THROW_RELEASE,
  THROW_TIME,
  BOSS_AIM_FACTOR,
  RIFLE_AIM_FACTOR,
  WALK_OUT_SPEED,
  type DifficultyTuning,
} from "./tuning";
import type { BanditState, Cover, DeathChoice, Role } from "./types";
import type { WaveSpec } from "./waves";

/** What a bandit needs from the match around him. The Match implements it. */
export interface BanditWorld {
  readonly time: number;
  readonly spec: WaveSpec;
  readonly random: Random;
  /** How the difficulty bends the gang's timing (aim, glint, fuse). */
  readonly tuning: DifficultyTuning;
  /** Ask to come out and threaten the player; the director keeps this to a few at once. */
  acquireSlot(b: Bandit): boolean;
  releaseSlot(b: Bandit): void;
  /** Whether a shot now would come too soon after the last one (or the player is gone). */
  canFire(b: Bandit): boolean;
  fire(b: Bandit): void;
  canThrow(b: Bandit): boolean;
  throwDynamite(b: Bandit): void;
  /** A cover to move to while hidden, or null to stay. */
  relocateTarget(b: Bandit): Cover | null;
  /** A cover across the street to sprint to, or null. */
  runTarget(b: Bandit): Cover | null;
  runnersRunning(): number;
  /** Black Jack ducked: his men come out to cover him. */
  coveringFire(b: Bandit): void;
  events: BanditEvents;
}

export interface BanditEvents {
  banditTell(b: Bandit): void;
  banditEmerge(b: Bandit): void;
  banditAim(b: Bandit): void;
  banditGlint(b: Bandit): void;
  banditHide(b: Bandit): void;
  banditRelocate(b: Bandit, from: Cover): void;
  banditRun(b: Bandit): void;
  banditLight(b: Bandit): void;
  banditPace(b: Bandit, pace: number): void;
  banditStandoff(b: Bandit): void;
  duelBell(b: Bandit): void;
  banditDead(b: Bandit): void;
}

const PATH_POINTS = 5;

/**
 * One member of the Carver gang and his state machine:
 *
 *   hidden → (tell) → emerging → aiming → firing → hiding → hidden …
 *
 * with the variations — runners sprint between covers, dynamiters light and
 * throw instead of aiming, Black Jack staggers and moves on when hit, and the
 * High Noon duelist walks ten paces and draws on the bell.
 */
export class Bandit {
  state: BanditState = "reserve";
  /** Seconds in the current state, and how long it lasts. */
  t = 0;
  dur = 0;
  /** Feet position, updated as he emerges, hides and runs. */
  readonly pos: V3 = { x: 0, y: 0, z: 0 };
  /** 0 in cover .. 1 fully out. */
  exposure = 0;
  /** On screen (and shootable) — from the first frame out of cover. */
  visible = false;
  /** Match time he last came into view, for Quick Draw. */
  emergedAt = Number.POSITIVE_INFINITY;
  /** Extra body hits an iron plate still absorbs. */
  armour = 0;
  /** Body hits left (Black Jack takes three). */
  health = 1;
  /** Holding an attack slot. */
  slot = false;
  /** Allowed out regardless of slots (covering fire for the boss). */
  forced = false;
  shots = 0;
  maxShots = 1;
  aimDur = 1;
  glinted = false;
  /** Holding a lit stick that has not left his hand yet. */
  lit = false;
  released = false;
  /** A runner's first appearance is always a run. */
  runPending = false;
  runTo: Cover | null = null;
  /** The run's polyline and its length. */
  readonly path: V3[] = Array.from({ length: PATH_POINTS }, () => ({ x: 0, y: 0, z: 0 }));
  pathLength = 0;
  /** Horizontal direction of travel while running or walking (unit). */
  readonly heading = { x: 0, z: 1 };
  pace = 0;
  death: DeathChoice | null = null;
  /** The cover's floor under him when he died, for bodies that fall. */
  diedAt = 0;

  constructor(
    readonly id: number,
    public role: Role,
    public cover: Cover,
  ) {
    copy(this.pos, cover.hidden);
  }

  get alive(): boolean {
    return this.state !== "dying" && this.state !== "dead";
  }

  /** Visible and not already going down. */
  get shootable(): boolean {
    return this.visible && this.alive;
  }

  get inPlay(): boolean {
    return this.state !== "reserve" && this.alive;
  }

  private enter(state: BanditState, dur: number): void {
    this.state = state;
    this.t = 0;
    this.dur = dur;
  }

  /** Put him in play, hidden at his cover, coming out after `wait`. */
  spawn(wait: number): void {
    copy(this.pos, this.cover.hidden);
    this.visible = false;
    this.exposure = 0;
    this.runPending = this.role === "runner";
    this.enter("hidden", wait);
  }

  step(dt: number, w: BanditWorld): void {
    if (this.state === "reserve" || this.state === "dead") return;
    this.t += dt;
    switch (this.state) {
      case "hidden":
        this.stepHidden(w);
        break;
      case "tell":
        if (this.t >= this.dur) this.startEmerge(w);
        break;
      case "emerging": {
        const p = Math.min(1, this.t / this.dur);
        this.exposure = p;
        lerp(this.pos, this.cover.ready ?? this.cover.hidden, this.cover.exposed, smooth(p));
        if (p >= 1) this.outOfCover(w);
        break;
      }
      case "aiming":
        if (!this.glinted && this.t >= this.dur - w.tuning.glintLead) {
          this.glinted = true;
          w.events.banditGlint(this);
        }
        if (this.t >= this.dur && w.canFire(this)) {
          this.shots++;
          w.fire(this);
          this.enter("firing", FIRE_RECOVER);
        }
        break;
      case "firing":
        if (this.t >= this.dur) {
          if (this.role === "duelist") {
            this.afterDuel(w);
          } else if (this.shots < this.maxShots) {
            this.glinted = false;
            this.enter("aiming", this.aimDur * 0.6);
            w.events.banditAim(this);
          } else {
            this.startHide(w);
          }
        }
        break;
      case "lighting":
        if (this.t >= this.dur) {
          this.released = false;
          this.enter("throwing", THROW_TIME);
        }
        break;
      case "throwing":
        if (!this.released && this.t >= THROW_RELEASE) {
          this.released = true;
          this.lit = false;
          w.throwDynamite(this);
        }
        if (this.t >= this.dur) this.startHide(w);
        break;
      case "hiding": {
        const p = Math.min(1, this.t / this.dur);
        this.exposure = 1 - p;
        lerp(this.pos, this.cover.exposed, this.cover.ready ?? this.cover.hidden, smooth(p));
        if (p >= 1) this.becomeHidden(w);
        break;
      }
      case "running":
        this.stepRun(w);
        break;
      case "staggered":
        if (this.t >= this.dur) this.startHide(w);
        break;
      case "walking":
        this.stepWalk(w);
        break;
      case "standoff":
        if (this.t >= this.dur) {
          this.emergedAt = w.time;
          this.aimDur = DUEL_DRAW * w.tuning.aimFactor;
          this.glinted = false;
          this.shots = 0;
          this.maxShots = 1;
          this.enter("aiming", this.aimDur);
          w.events.duelBell(this);
        }
        break;
      case "dying":
        if (this.t >= this.dur) {
          this.state = "dead";
          w.events.banditDead(this);
        }
        break;
      default:
        break;
    }
  }

  private stepHidden(w: BanditWorld): void {
    if (this.t < this.dur) return;
    if (this.role === "runner" && w.runnersRunning() < 1 && (this.runPending || chance(w.random, RUN_CHANCE))) {
      const to = w.runTarget(this);
      if (to) {
        this.runPending = false;
        this.startRun(to, w);
        return;
      }
    }
    if (!w.acquireSlot(this)) {
      // Everyone who may shoot at once already is; try again shortly.
      this.dur += range(w.random, 0.3, 0.7);
      return;
    }
    this.forced = false;
    if (chance(w.random, w.spec.tellChance)) {
      this.enter("tell", range(w.random, TELL_TIME[0], TELL_TIME[1]));
      w.events.banditTell(this);
    } else {
      this.startEmerge(w);
    }
  }

  private startEmerge(w: BanditWorld): void {
    this.enter("emerging", Math.max(EMERGE_TIME[this.cover.emerge], this.walkOut() / WALK_OUT_SPEED));
    // Seen from this frame on: from the edge of his cover, not from where he waited.
    copy(this.pos, this.cover.ready ?? this.cover.hidden);
    this.visible = true;
    this.exposure = 0;
    this.emergedAt = w.time;
    this.shots = 0;
    this.glinted = false;
    w.events.banditEmerge(this);
  }

  private outOfCover(w: BanditWorld): void {
    copy(this.pos, this.cover.exposed);
    this.exposure = 1;
    if (this.role === "dynamiter" && w.canThrow(this)) {
      this.lit = true;
      this.enter("lighting", w.tuning.lightTime);
      w.events.banditLight(this);
      return;
    }
    const spec = w.spec;
    let aim = spec.aimTime * w.tuning.aimFactor;
    if (this.role === "rifleman") aim *= RIFLE_AIM_FACTOR;
    if (this.role === "boss") aim *= BOSS_AIM_FACTOR;
    this.aimDur = aim;
    this.maxShots = this.role === "boss" ? 2 : this.role === "rifleman" ? 1 : chance(w.random, spec.secondShot) ? 2 : 1;
    this.enter("aiming", aim);
    w.events.banditAim(this);
  }

  /** How far he is seen to walk coming out: from the cover's ready spot to its exposed one. */
  private walkOut(): number {
    return horizontalDistance(this.cover.ready ?? this.cover.hidden, this.cover.exposed);
  }

  startHide(w: BanditWorld): void {
    this.enter("hiding", Math.max(HIDE_TIME[this.cover.emerge], this.walkOut() / WALK_OUT_SPEED));
    w.events.banditHide(this);
  }

  private becomeHidden(w: BanditWorld): void {
    this.visible = false;
    this.exposure = 0;
    this.lit = false;
    this.emergedAt = Number.POSITIVE_INFINITY;
    if (this.slot) w.releaseSlot(this);
    let wait = range(w.random, HIDDEN_WAIT[0], HIDDEN_WAIT[1]);
    const relocate = this.role === "boss" || chance(w.random, RELOCATE_CHANCE);
    if (relocate) {
      const to = w.relocateTarget(this);
      if (to && to !== this.cover) {
        const from = this.cover;
        this.cover = to;
        wait += horizontalDistance(from.hidden, to.hidden) / RELOCATE_SPEED;
        w.events.banditRelocate(this, from);
      }
    }
    copy(this.pos, this.cover.hidden);
    this.enter("hidden", wait);
    if (this.role === "boss") w.coveringFire(this);
  }

  /** Sprint from where he is to `to`, through the street, in full view. */
  startRun(to: Cover, w: BanditWorld, fromStreet = false): void {
    const p = this.path;
    const start = fromStreet ? this.pos : this.cover.exposed;
    copy(p[0] as V3, this.pos);
    copy(p[1] as V3, start);
    const mid = p[2] as V3;
    // Cut toward the middle of the street rather than hugging the facades.
    mid.x = (start.x + to.exposed.x) * 0.25;
    mid.y = 0;
    mid.z = (start.z + to.exposed.z) * 0.5;
    copy(p[3] as V3, to.exposed);
    // Into the cover as far as he can be seen going; the rest is out of sight.
    copy(p[4] as V3, to.ready ?? to.hidden);
    let length = 0;
    for (let i = 1; i < PATH_POINTS; i++) length += distance3(p[i - 1] as V3, p[i] as V3);
    this.pathLength = Math.max(0.1, length);
    this.runTo = to;
    this.visible = true;
    this.exposure = 1;
    this.emergedAt = w.time;
    this.enter("running", this.pathLength / RUN_SPEED);
    w.events.banditRun(this);
  }

  private stepRun(w: BanditWorld): void {
    const along = Math.min(this.pathLength, (this.t / this.dur) * this.pathLength);
    pointAlong(this.path, along, this.pos, this.heading);
    if (this.t < this.dur) return;
    const to = this.runTo;
    if (to) this.cover = to;
    this.runTo = null;
    this.visible = false;
    this.exposure = 0;
    this.emergedAt = Number.POSITIVE_INFINITY;
    copy(this.pos, this.cover.hidden);
    this.enter("hidden", range(w.random, 0.5, 1.2));
  }

  // --- the duel ---------------------------------------------------------------

  /** Walk ten paces from `from` to `to`, then stand and wait for the bell. */
  startDuel(from: V3, to: V3): void {
    const p = this.path;
    copy(p[0] as V3, from);
    for (let i = 1; i < PATH_POINTS; i++) lerp(p[i] as V3, from, to, i / (PATH_POINTS - 1));
    this.pathLength = Math.max(0.1, distance3(from, to));
    copy(this.pos, from);
    this.visible = true;
    this.exposure = 1;
    this.pace = 0;
    this.enter("walking", DUEL_PACES * DUEL_PACE_TIME);
  }

  private stepWalk(w: BanditWorld): void {
    const along = Math.min(this.pathLength, (this.t / this.dur) * this.pathLength);
    pointAlong(this.path, along, this.pos, this.heading);
    const pace = Math.min(DUEL_PACES, Math.floor(this.t / DUEL_PACE_TIME) + 1);
    if (pace > this.pace && this.t < this.dur) {
      this.pace = pace;
      w.events.banditPace(this, pace);
    }
    if (this.t >= this.dur) {
      this.enter("standoff", DUEL_STANDOFF);
      w.events.banditStandoff(this);
    }
  }

  /** He fired his duel shot and lived: he takes cover like any gunman. */
  private afterDuel(w: BanditWorld): void {
    this.role = "gunman";
    const to = w.runTarget(this);
    if (to) {
      this.startRun(to, w, true);
    } else {
      this.startHide(w);
    }
  }

  // --- taking hits ------------------------------------------------------------

  stagger(): void {
    this.enter("staggered", STAGGER_TIME);
  }

  die(choice: DeathChoice): void {
    this.death = choice;
    this.lit = false;
    this.enter("dying", choice.fall ? FALL_DEATH_TIME : DEATH_TIME);
  }
}

// --- small vector helpers (no allocation) --------------------------------------

export function copy(out: V3, v: V3): V3 {
  out.x = v.x;
  out.y = v.y;
  out.z = v.z;
  return out;
}

export function lerp(out: V3, a: V3, b: V3, t: number): V3 {
  out.x = a.x + (b.x - a.x) * t;
  out.y = a.y + (b.y - a.y) * t;
  out.z = a.z + (b.z - a.z) * t;
  return out;
}

export function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

export function distance3(a: V3, b: V3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function horizontalDistance(a: V3, b: V3): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

function pointAlong(path: readonly V3[], along: number, out: V3, heading: { x: number; z: number }): void {
  let left = along;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1] as V3;
    const b = path[i] as V3;
    const seg = distance3(a, b);
    if (left <= seg || i === path.length - 1) {
      lerp(out, a, b, seg > 1e-6 ? Math.min(1, left / seg) : 1);
      const hx = b.x - a.x;
      const hz = b.z - a.z;
      const h = Math.hypot(hx, hz);
      if (h > 1e-3) {
        heading.x = hx / h;
        heading.z = hz / h;
      }
      return;
    }
    left -= seg;
  }
}
