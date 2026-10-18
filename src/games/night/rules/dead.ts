import type { V3 } from "../../../engine/rules/raymath";
import type { Random } from "../../../engine/rules/rng";
import {
  ATTACKS,
  BLOATER_SPEED,
  BODY_SHOTS,
  CLIMB_TIME,
  CRAWLER_SHORT,
  CRAWLER_SPEED,
  DEATH_TIME,
  GAIT_SPEED,
  GAIT_WEIGHT,
  LUNGE_RANGE,
  LUNGE_TIME,
  MECHANIC_SPEED,
  MECHANIC_STAGGER,
  RUNNER_SPEED,
  STAGGER_BACK,
  STAGGER_TIME,
  VAULT_TIME,
  type DifficultyTuning,
} from "./tuning";
import { GAITS, type DeadKind, type DeadState, type DeathCause, type Gait, type Lane, type Slot } from "./types";

/** What one of the dead needs from the match around it. The Match implements it. */
export interface DeadWorld {
  /** The player's eye: the barricade is between it and the dead. */
  readonly eye: V3;
  /** The difficulty's numbers in force now (worn toward Standard by a long wave). */
  readonly tuning: DifficultyTuning;
  /** Everything that quickens it now besides its own pace: the wave, a long wave's pressure, the Mechanic nearby. */
  paceFor(d: Dead): number;
  /** A free place at the barricade for it, nearest its lane, or null if every one is taken. */
  claimSlot(d: Dead): Slot | null;
  /** A claw, a lunge or a swing lands. */
  strike(d: Dead, damage: number): void;
  /** A bloater at the barricade bursts on the player. */
  burstOnPlayer(d: Dead): void;
  events: DeadEvents;
}

export interface DeadEvents {
  /** Out of the bus, or over the fence: walking now. */
  deadEmerged(d: Dead): void;
  /** At the barricade (or at the back of the crowd there). */
  deadArrived(d: Dead): void;
  /** A runner leaps. */
  deadLunge(d: Dead): void;
  /** A bloater at the barricade begins to swell: shoot it now. */
  deadSwell(d: Dead): void;
  /** Its fall is over: a body on the road. */
  deadDown(d: Dead): void;
}

/** A point on a path, and the horizontal way it faces there. */
export function pointAlong(path: readonly V3[], lengths: readonly number[], along: number, out: V3, heading: { x: number; z: number }): void {
  let left = Math.max(0, along);
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1] as V3;
    const b = path[i] as V3;
    const seg = lengths[i - 1] as number;
    if (left <= seg || i === path.length - 1) {
      const k = seg > 1e-6 ? Math.min(1, left / seg) : 1;
      out.x = a.x + (b.x - a.x) * k;
      out.y = a.y + (b.y - a.y) * k;
      out.z = a.z + (b.z - a.z) * k;
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
  const last = path[path.length - 1];
  if (last) {
    out.x = last.x;
    out.y = last.y;
    out.z = last.z;
  }
}

/**
 * How far apart two points are across the ground. Not High Noon's (bandit.ts),
 * which squares by hand: Math.hypot can differ from that in the last place, and
 * each game's seeded runs are measured on its own.
 */
export function horizontalDistance(a: V3, b: V3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** How far out it claims its place at the barricade (metres of lane left), so a runner knows where to leap. */
const CLAIM_AHEAD = 6;

/**
 * One of the dead, and its state machine:
 *
 *   emerging (the bus, the fence) → approaching ⇄ staggered → attacking … → dying → dead
 *
 * A runner leaps the last few metres (lunging) and keeps lunging; a bloater
 * at the barricade swells, then bursts on you; with every place at the
 * barricade taken, one waits behind, pressing in, until a place comes free.
 */
export class Dead {
  state: DeadState = "reserve";
  t = 0;
  dur = 0;
  readonly pos: V3 = { x: 0, y: 0, z: 0 };
  /** Which way it walks (unit, horizontal). */
  readonly heading = { x: 0, z: 1 };
  /** Its way to the barricade: the lane, offset to its own line, then (once claimed) to its place there. */
  readonly path: V3[];
  private lengths: number[] = [];
  pathLength = 0;
  /** Metres along the path. */
  along = 0;
  /** Its own pace before the wave, the pressure and the Mechanic: metres per second. */
  readonly speed: number;
  /** Body shots still to take. */
  bodyLeft: number;
  /** The Mechanic's welding mask: headshots it still stops. */
  mask = 0;
  slot: Slot | null = null;
  /** Seconds to its next blow at the barricade. */
  private nextStrike = 0;
  /** What brought it down. */
  cause: DeathCause | null = null;
  /** A runner has made its leap, over the last LUNGE_RANGE of its way. */
  private lunged = false;
  private stateBeforeStagger: DeadState = "approaching";
  private waitCheck = 0;

  constructor(
    readonly id: number,
    readonly kind: DeadKind,
    readonly lane: Lane,
    path: V3[],
    speed: number,
    readonly gait: Gait,
  ) {
    this.path = path;
    this.speed = speed;
    this.bodyLeft = BODY_SHOTS[kind];
    this.measure();
    pointAlong(this.path, this.lengths, 0, this.pos, this.heading);
  }

  get alive(): boolean {
    return this.state !== "reserve" && this.state !== "dying" && this.state !== "dead";
  }

  /** In play and not yet going down: it can be shot. */
  get shootable(): boolean {
    return this.alive;
  }

  /** At (or pressing at) the barricade. */
  get atBarricade(): boolean {
    return this.state === "attacking" || this.state === "swelling" || this.state === "waiting" || this.state === "lunging";
  }

  /** Metres of its way left to walk. */
  get remaining(): number {
    return Math.max(0, this.pathLength - this.along);
  }

  private measure(): void {
    this.lengths = [];
    let total = 0;
    for (let i = 1; i < this.path.length; i++) {
      const a = this.path[i - 1] as V3;
      const b = this.path[i] as V3;
      const l = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
      this.lengths.push(l);
      total += l;
    }
    this.pathLength = Math.max(0.01, total);
  }

  private enter(state: DeadState, dur: number): void {
    this.state = state;
    this.t = 0;
    this.dur = dur;
  }

  /** Into play: climbing out of the bus or over the fence, or simply walking out of the fog. */
  spawn(): void {
    this.along = 0;
    pointAlong(this.path, this.lengths, 0, this.pos, this.heading);
    if (this.lane.id === "bus") this.enter("emerging", CLIMB_TIME);
    else if (this.lane.id === "fence") this.enter("emerging", VAULT_TIME);
    else this.enter("approaching", 0);
  }

  /** Puts it `along` metres down its way at once (the dev harness, the tests). */
  placeAt(along: number): void {
    this.along = Math.max(0, Math.min(this.pathLength, along));
    pointAlong(this.path, this.lengths, this.along, this.pos, this.heading);
  }

  /** The length of the lane's first stretch, which a climb or a vault covers. */
  private get firstStretch(): number {
    return this.lengths[0] ?? 0;
  }

  step(dt: number, w: DeadWorld): void {
    if (this.state === "reserve" || this.state === "dead") return;
    this.t += dt;
    switch (this.state) {
      case "emerging": {
        const k = Math.min(1, this.t / Math.max(0.05, this.dur));
        this.along = this.firstStretch * k;
        pointAlong(this.path, this.lengths, this.along, this.pos, this.heading);
        if (k >= 1) {
          this.enter("approaching", 0);
          w.events.deadEmerged(this);
        }
        break;
      }
      case "approaching":
        this.walk(dt, w);
        break;
      case "staggered":
        if (this.t >= this.dur) this.enter(this.stateBeforeStagger === "attacking" ? "approaching" : this.stateBeforeStagger, 0);
        break;
      case "lunging": {
        const k = Math.min(1, this.t / LUNGE_TIME);
        this.along = this.pathLength - LUNGE_RANGE * (1 - k);
        pointAlong(this.path, this.lengths, this.along, this.pos, this.heading);
        if (k >= 1) {
          this.startAttack(w);
          // The leap's landing is its first blow.
          w.strike(this, this.damage(w));
          this.nextStrike = ATTACKS.runner.period;
        }
        break;
      }
      case "waiting":
        this.waitCheck -= dt;
        if (this.waitCheck <= 0) {
          this.waitCheck = 0.4;
          const slot = w.claimSlot(this);
          if (slot) this.goTo(slot, w);
        }
        break;
      case "attacking":
        this.nextStrike -= dt;
        if (this.nextStrike <= 0) {
          this.nextStrike += this.attack.period;
          w.strike(this, this.damage(w));
        }
        break;
      case "swelling":
        if (this.t >= this.dur) w.burstOnPlayer(this);
        break;
      case "dying":
        if (this.t >= this.dur) {
          this.state = "dead";
          w.events.deadDown(this);
        }
        break;
      default:
        break;
    }
  }

  private get attack() {
    return ATTACKS[this.kind === "bloater" ? "walker" : this.kind];
  }

  private damage(w: DeadWorld): number {
    return Math.round(this.attack.damage * w.tuning.damageFactor);
  }

  private walk(dt: number, w: DeadWorld): void {
    const pace = this.speed * w.paceFor(this);
    this.along = Math.min(this.pathLength, this.along + pace * dt);
    pointAlong(this.path, this.lengths, this.along, this.pos, this.heading);
    if (!this.slot && this.remaining <= CLAIM_AHEAD) {
      const slot = w.claimSlot(this);
      if (slot) this.goTo(slot, w);
    }
    if (this.slot) {
      if (this.kind === "runner" && !this.lunged && this.remaining <= LUNGE_RANGE) {
        this.lunged = true;
        this.enter("lunging", LUNGE_TIME);
        w.events.deadLunge(this);
        return;
      }
      if (this.remaining <= 1e-3) this.arrive(w);
    } else if (this.remaining <= 1e-3) {
      // Every place at the barricade is taken: wait at the back, pressing in.
      this.enter("waiting", 0);
      this.waitCheck = 0.4;
      w.events.deadArrived(this);
    }
  }

  /** Its place at the barricade: the path's last stretch now leads there. */
  private goTo(slot: Slot, w: DeadWorld): void {
    this.slot = slot;
    const place = standingPlace(this.kind, slot, w.eye);
    // The path ends where the lane meets the barricade; a last stretch to
    // the place it claimed, from wherever that stretch would start.
    const end = this.path[this.path.length - 1] as V3;
    if (Math.hypot(end.x - place.x, end.z - place.z) > 0.05) {
      if (this.state === "waiting" || this.kind === "crawler") {
        // From where it is, not on along the lane: a crawler stops short of
        // the sandbags, and must not crawl in to the lane's end and back out.
        this.path.length = 0;
        this.path.push({ ...this.pos }, place);
        this.along = 0;
      } else {
        this.path.push(place);
      }
      this.measure();
    }
    if (this.state === "waiting") this.enter("approaching", 0);
  }

  private arrive(w: DeadWorld): void {
    if (this.kind === "bloater") {
      this.enter("swelling", w.tuning.burstWarning);
      w.events.deadArrived(this);
      w.events.deadSwell(this);
      return;
    }
    this.startAttack(w);
    this.nextStrike = this.kind === "runner" ? 0.2 : this.attack.first;
  }

  private startAttack(w: DeadWorld): void {
    this.enter("attacking", 0);
    w.events.deadArrived(this);
  }

  /**
   * A body shot that did not drop it: knocked back half a step (the
   * Mechanic is only slowed), and back to its way when it finds its feet.
   */
  stagger(): void {
    if (this.state === "emerging" || this.state === "swelling" || this.state === "lunging") return;
    const mechanic = this.kind === "mechanic";
    if (!mechanic) this.along = Math.max(0, this.along - STAGGER_BACK);
    // One knocked back from the barricade must walk up to it again.
    this.stateBeforeStagger = this.state === "staggered" ? this.stateBeforeStagger : this.state;
    if (this.stateBeforeStagger === "waiting") this.stateBeforeStagger = "approaching";
    pointAlong(this.path, this.lengths, this.along, this.pos, this.heading);
    this.enter("staggered", mechanic ? MECHANIC_STAGGER : STAGGER_TIME);
  }

  /** Down. It keeps its place on the road until the breather. */
  die(cause: DeathCause): void {
    this.cause = cause;
    this.enter("dying", DEATH_TIME);
  }
}

/**
 * Where one of the dead stands at its place at the barricade: on the place
 * itself, but a crawler, low on the road, out in front of the sandbags
 * (CRAWLER_SHORT farther from the eye), where it can be seen and shot.
 */
export function standingPlace(kind: DeadKind, slot: Slot, eye: V3): V3 {
  const p = slot.pos;
  if (kind !== "crawler") return { ...p };
  const dx = p.x - eye.x;
  const dz = p.z - eye.z;
  const len = Math.hypot(dx, dz) || 1;
  return { x: p.x + (dx / len) * CRAWLER_SHORT, y: p.y, z: p.z + (dz / len) * CRAWLER_SHORT };
}

/** A walker's gait, drawn by the weights the dead share them out by (GAIT_WEIGHT). */
export function drawGait(random: Random): Gait {
  let r = random() * GAITS.reduce((sum, gait) => sum + GAIT_WEIGHT[gait], 0);
  for (const gait of GAITS) {
    r -= GAIT_WEIGHT[gait];
    if (r <= 0) return gait;
  }
  return GAITS[GAITS.length - 1] as Gait;
}

/** Its own pace, by kind (a walker's is its gait's own, made faster by how hurried it is: WALKER_HURRY). */
export function paceOf(kind: DeadKind, gait: Gait, hurry: number): number {
  switch (kind) {
    case "walker":
      return GAIT_SPEED[gait] * hurry;
    case "runner":
      return RUNNER_SPEED;
    case "crawler":
      return CRAWLER_SPEED;
    case "bloater":
      return BLOATER_SPEED;
    case "mechanic":
      return MECHANIC_SPEED;
  }
}

/** The line each of the dead walks: its lane, moved sideways by `offset` metres (less so toward the barricade). */
export function offsetPath(lane: Lane, offset: number): V3[] {
  const pts = lane.points;
  const n = pts.length;
  const out: V3[] = [];
  for (let i = 0; i < n; i++) {
    const p = pts[i] as V3;
    const a = pts[Math.max(0, i - 1)] as V3;
    const b = pts[Math.min(n - 1, i + 1)] as V3;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz) || 1;
    // The side, perpendicular to the lane there.
    const sx = -dz / len;
    const sz = dx / len;
    // Full spread in the fog, a third of it where the lane meets the barricade.
    const taper = n > 1 ? 1 - (0.67 * i) / (n - 1) : 1;
    out.push({ x: p.x + sx * offset * taper, y: p.y, z: p.z + sz * offset * taper });
  }
  return out;
}


/**
 * A lane out of the fog, begun no farther than `reach` metres (on the
 * ground) from the eye: the art may run a lane from far down the road, but
 * past the fog's edge the walk is only waiting. Cut where the lane first
 * comes within reach; the corn's cover shortens by what was cut. A lane
 * that starts within reach is left as it is.
 */
export function withinReach(lane: Lane, eye: V3, reach: number): Lane {
  const pts = lane.points;
  const first = pts[0];
  if (!first || horizontalDistance(first, eye) <= reach) return lane;
  let cut = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1] as V3;
    const b = pts[i] as V3;
    const seg = horizontalDistance(a, b);
    if (horizontalDistance(b, eye) > reach) {
      cut += seg;
      continue;
    }
    // Where the segment a → b crosses the circle of `reach` round the eye.
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const fx = a.x - eye.x;
    const fz = a.z - eye.z;
    const qa = dx * dx + dz * dz;
    const qb = 2 * (fx * dx + fz * dz);
    const qc = fx * fx + fz * fz - reach * reach;
    const disc = Math.max(0, qb * qb - 4 * qa * qc);
    const k = qa > 1e-9 ? Math.min(1, Math.max(0, (-qb - Math.sqrt(disc)) / (2 * qa))) : 0;
    const start: V3 = { x: a.x + dx * k, y: a.y + (b.y - a.y) * k, z: a.z + dz * k };
    cut += seg * k;
    return { ...lane, points: [start, ...pts.slice(i)], cover: Math.max(0, lane.cover - cut) };
  }
  return lane;
}
