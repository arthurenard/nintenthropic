/**
 * Everyone in the valley, as the rules keep them: where they are, which way
 * they face, what they are doing (the world shows it as a clip), whether a
 * round can find them, and the few numbers their minds run on. The minds
 * themselves are in mission.ts; the vehicles' driving is here.
 */
import { PathWalker, Polyline } from "./path";
import type { Activity, HostileRole, Nest, Role, Side, V3, VehicleKind } from "./types";
import { ENGINE_HITS, ROLL_OUT } from "./tuning";

export type DeathClip = "death_back" | "death_forward" | "death_crumple";

export class Actor {
  readonly pos: V3 = { x: 0, y: 0, z: 0 };
  /** Metres per second: how he is moving now (for leading him, and for the world's feet). */
  readonly vel: V3 = { x: 0, y: 0, z: 0 };
  /** Radians about Y, 0 facing +Z (toward the ridge). */
  heading = 0;
  activity: Activity = "idle";
  /** Seconds in the current activity. */
  activityT = 0;
  /** The mind's own state and its clock. */
  state = "idle";
  t = 0;
  dur = 0;
  alive = true;
  /** Rounds that struck him (a second body hit kills). */
  wounds = 0;
  /** Out of sight: in a truck's back, down in his nest. No round finds him. */
  hidden = false;
  /** This man knows the valley is awake (or was startled himself). */
  alerted = false;
  deathClip: DeathClip = "death_back";
  /** Where the note would name him ("the chapel tower", "the checkpoint"). */
  place = "";
  /** Where he stands his post, or where he took cover. */
  readonly home: V3 = { x: 0, y: 0, z: 0 };
  walker: PathWalker | null = null;
  /** The vehicle he rides in, and where. */
  vehicle: Vehicle | null = null;
  seat: "driver" | "back" | null = null;
  /** His place in the truck's back (the order he jumps down in). */
  seatIndex = 0;
  nest: Nest | null = null;
  /** A group walking together: his offset behind the one in front, metres. */
  spacing = 0;
  /** A child is a smaller figure. */
  scale = 1;
  /** When he next fires, or notices, or moves, seconds. */
  nextFire = 0;
  notice = -1;
  /** Seconds left of ducking from a round that cracked past him. */
  flinch = 0;
  shots = 0;
  /** A job's objective: the stage is won when these are down. */
  objective = false;
  /** Killed this stage, and when (the rules' clock), for bodies found. */
  diedAt = -1;

  constructor(
    readonly id: number,
    readonly side: Side,
    readonly role: Role,
  ) {}

  get hostile(): boolean {
    return this.side === "hostile";
  }

  get hostileRole(): HostileRole | null {
    return this.side === "hostile" ? (this.role as HostileRole) : null;
  }

  /** Can a round find him now? */
  get shootable(): boolean {
    return this.alive && !this.hidden;
  }

  /** Switch what he is doing (the clock restarts only on a real change). */
  act(activity: Activity): void {
    if (this.activity === activity) return;
    this.activity = activity;
    this.activityT = 0;
  }

  setState(state: string, dur: number): void {
    this.state = state;
    this.t = 0;
    this.dur = dur;
  }

  placeAt(p: V3): void {
    this.pos.x = p.x;
    this.pos.y = p.y;
    this.pos.z = p.z;
  }

  still(): void {
    this.vel.x = 0;
    this.vel.y = 0;
    this.vel.z = 0;
  }
}

/** The vehicles' sizes, metres, and where the driver and the troops sit (vehicle space: +Z forward, +X left). */
export const VEHICLE_SPECS: Readonly<Record<VehicleKind, { length: number; driver: V3; tail: number; cruise: number }>> = {
  truck: { length: 6.8, driver: { x: 0.5, y: 1.6, z: 1.0 }, tail: -3.5, cruise: 8 },
  jeep: { length: 3.4, driver: { x: 0.3, y: 0.9, z: -0.25 }, tail: -1.8, cruise: 9 },
};

/**
 * A truck or a jeep on a road: it drives along its path at its cruising
 * speed, keeps its distance behind the one in front, and when its driver
 * is shot or its engine is dead it rolls to a stop over ROLL_OUT metres.
 */
export class Vehicle {
  readonly pos: V3 = { x: 0, y: 0, z: 0 };
  readonly vel: V3 = { x: 0, y: 0, z: 0 };
  heading = 0;
  speed = 0;
  cruise: number;
  engineHits = 0;
  /** Why it is stopping, once it is. */
  stopping: "driver" | "engine" | "blocked" | "parked" | null = null;
  /** Its deceleration while it stops, m/s². */
  private brake = 0;
  stopped = false;
  /** Waiting with its engine running (the officer's jeep before he gets in). */
  parked = false;
  readonly walker: PathWalker;
  /** The vehicle it follows in a convoy. */
  leader: Vehicle | null = null;
  readonly length: number;
  arrived = false;
  /** Steam from a dead engine. */
  get steaming(): boolean {
    return this.engineHits >= ENGINE_HITS;
  }

  constructor(
    readonly id: number,
    readonly kind: VehicleKind,
    line: Polyline,
    start: number,
    cruise: number,
  ) {
    this.walker = new PathWalker(line, "once", start, 0);
    this.cruise = cruise;
    this.length = VEHICLE_SPECS[kind].length;
    this.speed = 0;
    this.sync();
  }

  /** Distance along the road of its front bumper. */
  get front(): number {
    return this.walker.s + this.length / 2;
  }

  /** A halt on the way (the checkpoint's barrier): where along the road its centre stops, and for how long. */
  private halt: { at: number; wait: number; waited: number } | null = null;

  haltAt(s: number, wait: number): void {
    this.halt = { at: s, wait, waited: 0 };
  }

  /** Stopped at its halt, waiting for the barrier. */
  get halted(): boolean {
    return this.halt !== null && this.halt.waited > 0 && this.halt.waited < this.halt.wait;
  }

  /** Start rolling to a stop (the driver shot, the engine dead, the road blocked). */
  stop(why: "driver" | "engine" | "blocked"): void {
    if (this.stopped || (this.stopping && this.stopping !== "blocked" && this.stopping !== "parked")) return;
    this.stopping = why;
    this.parked = false;
    // Enough braking to stop within ROLL_OUT (a blocked one brakes harder).
    const room = why === "blocked" ? ROLL_OUT * 0.6 : ROLL_OUT;
    this.brake = Math.max(1.2, (this.speed * this.speed) / (2 * room));
  }

  update(dt: number): void {
    if (this.stopped || this.arrived) {
      this.speed = 0;
      this.sync();
      return;
    }
    if (this.parked) {
      this.speed = 0;
    } else if (this.stopping) {
      this.speed = Math.max(0, this.speed - this.brake * dt);
      if (this.speed <= 0.05) {
        this.speed = 0;
        this.stopped = true;
      }
    } else {
      let target = this.cruise;
      const h = this.halt;
      if (h && h.waited < h.wait) {
        const left = h.at - this.walker.s;
        if (left <= 0.3) {
          // At the barrier: wait, then on.
          target = 0;
          if (this.speed < 0.2) h.waited += dt;
        } else {
          // Brake in time to stop at it (a gentle 1.8 m/s²).
          target = Math.min(target, Math.sqrt(2 * 1.8 * left));
        }
        if (h.waited >= h.wait) this.halt = null;
      }
      const lead = this.leader;
      if (lead) {
        // Keep a truck's length and a half of road between them.
        const gap = lead.walker.s - lead.length / 2 - this.front;
        if (gap < 8) target = Math.min(target, lead.speed * 0.8);
        if (gap < 4) target = 0;
        if (lead.stopped && gap < 12) this.stop("blocked");
      }
      // Pull away gently, brake firmly.
      const accel = target > this.speed ? 2 : 5;
      this.speed += Math.max(-accel * dt, Math.min(accel * dt, target - this.speed));
    }
    this.walker.speed = this.speed;
    this.walker.step(dt);
    if (this.walker.done) {
      this.arrived = true;
      this.speed = 0;
    }
    this.sync();
  }

  private readonly prev: V3 = { x: 0, y: 0, z: 0 };

  private sync(): void {
    this.prev.x = this.pos.x;
    this.prev.y = this.pos.y;
    this.prev.z = this.pos.z;
    this.walker.pointAt(this.pos);
    this.heading = this.walker.heading();
    const sin = Math.sin(this.heading);
    const cos = Math.cos(this.heading);
    this.vel.x = sin * this.speed;
    this.vel.z = cos * this.speed;
    this.vel.y = 0;
  }

  /** A point in the vehicle's own space (+Z forward, +X to its left), in the valley. */
  toWorld(local: V3, out: V3): V3 {
    const sin = Math.sin(this.heading);
    const cos = Math.cos(this.heading);
    out.x = this.pos.x + local.x * cos + local.z * sin;
    out.y = this.pos.y + local.y;
    out.z = this.pos.z - local.x * sin + local.z * cos;
    return out;
  }
}
