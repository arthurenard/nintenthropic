/**
 * Rounds in flight. A round leaves along the line of sight with the rifle's
 * zero, falls and drifts as ballistics.ts says, and takes its time to get
 * there - so a walking man must be led, and the dust of a miss rises a
 * moment after the shot. Where it would stop in the still valley (the
 * ground, a wall, the water) is worked out when it is fired; the people and
 * the vehicles, who move, are tested along its path frame by frame as it
 * flies. A windshield turns it a little and lets it through.
 */
import { Vector3, type Object3D } from "three";
import type { SceneryQueries } from "../../../engine/world/queries";
import { rangeAt, roundAt, sightFrame, timeOfFlight, type SightFrame } from "../rules/ballistics";
import { GLASS_DEFLECTION, MAX_RANGE } from "../rules/tuning";
import type { HitPart, SecretId } from "../rules/types";
import type { Heightfield } from "./heightfield";
import { surfaceOf, type Surface } from "./valley";

/** What the moving world answers when a piece of a round's path is tested against it. */
export interface MovingHit {
  /** Along the piece, 0..1. */
  t: number;
  point: Vector3;
  normal: Vector3;
  kind: "actor" | "glass" | "engine" | "vehicle" | "duck";
  id: number;
  part: HitPart;
  surface: Surface;
}

export interface MovingWorld {
  /** The nearest thing the straight piece a→b strikes, among people, animals and vehicles; `near` hears of everyone it passes close by. */
  test(a: Vector3, b: Vector3, near: (id: number, distance: number) => void): MovingHit | null;
}

export interface Landing3D {
  /** What it struck. */
  kind: "actor" | "engine" | "vehicle" | "duck" | "secret" | "scenery" | "none";
  id: number;
  part: HitPart;
  secret: SecretId | null;
  point: Vector3;
  normal: Vector3;
  surface: Surface;
  object: Object3D | null;
  /** Metres from the muzzle. */
  range: number;
  /** Seconds it flew. */
  time: number;
  /** The way it was travelling at the end. */
  dir: Vector3;
}

export interface Flight {
  frame: SightFrame;
  /** Seconds since the shot. */
  t: number;
  /** Distance along the line of sight reached so far. */
  x: number;
  /** Where the still valley stops it (along the line), and what it meets there. */
  stopAt: number;
  still: Landing3D;
  /** Everyone it passed close by. */
  near: Map<number, number>;
  /** It went through glass on its way (a windshield) at this distance. */
  glassAt: number;
  done: boolean;
  /** The points of its path so far, for the vapour trail. */
  path: Vector3[];
  tag: number;
}

/** Thin wood and cloth: a rifle round goes through them. */
function passable(o: Object3D): boolean {
  const s = surfaceOf(o);
  return s === "wood" || s === "cloth";
}

const P0 = new Vector3();
const P1 = new Vector3();
const DIR = new Vector3();
const HIT = { point: new Vector3(), normal: new Vector3(), distance: 0, object: null as Object3D | null };

export class Shooter {
  readonly flights: Flight[] = [];
  private nextTag = 1;

  constructor(
    private readonly heightfield: Heightfield,
    private readonly queries: SceneryQueries,
    private readonly secretOf: (o: Object3D) => SecretId | null,
    private readonly random: () => number,
  ) {}

  /** A round leaves `origin` along `dir` (unit) in a wind of `windX` m/s along +X. */
  fire(origin: Vector3, dir: Vector3, windX: number): Flight {
    const frame = sightFrame(origin, dir, windX);
    const still = this.stillHit(frame);
    const f: Flight = {
      frame,
      t: 0,
      x: 0,
      stopAt: still.range,
      still,
      near: new Map(),
      glassAt: -1,
      done: false,
      path: [new Vector3().copy(origin)],
      tag: this.nextTag++,
    };
    this.flights.push(f);
    return f;
  }

  /** Where the round would stop in the valley with nothing moving in its way. */
  private stillHit(frame: SightFrame): Landing3D {
    const step = 20;
    let x0 = 0.4;
    roundAt(frame, x0, P0);
    for (let x1 = x0 + step; x0 < MAX_RANGE; x1 = Math.min(MAX_RANGE, x1 + step)) {
      roundAt(frame, x1, P1);
      const g = this.heightfield.segmentHit(P0.x, P0.y, P0.z, P1.x, P1.y, P1.z);
      const len = P1.distanceTo(P0);
      DIR.copy(P1).sub(P0).normalize();
      let s = this.queries.cast(P0, DIR, g >= 0 ? g * len + 0.05 : len, HIT);
      // A rifle round goes through planks and canvas (a railing, a hut's wall, a truck's cover).
      let through = 0;
      while (s && s.object && through < 4 && passable(s.object) && !this.secretOf(s.object)) {
        through++;
        const from = new Vector3().copy(s.point).addScaledVector(DIR, 0.08);
        const left = (g >= 0 ? g * len + 0.05 : len) - from.distanceTo(P0);
        s = left > 0 ? this.queries.cast(from, DIR, left, HIT) : null;
        if (s) s.distance += from.distanceTo(P0);
      }
      if (s) {
        const range = x0 + (s.distance / len) * (x1 - x0);
        const obj = s.object;
        const secret = obj ? this.secretOf(obj) : null;
        return {
          kind: secret ? "secret" : "scenery",
          id: -1,
          part: "body",
          secret,
          point: s.point.clone(),
          normal: s.normal.clone(),
          surface: obj ? surfaceOf(obj) : "stone",
          object: obj,
          range,
          time: timeOfFlight(range),
          dir: DIR.clone(),
        };
      }
      if (g >= 0) {
        const range = x0 + g * (x1 - x0);
        const point = new Vector3().copy(P0).lerp(P1, g);
        const normal = this.heightfield.normal(point.x, point.z, new Vector3());
        return {
          kind: "scenery",
          id: -1,
          part: "body",
          secret: null,
          point,
          normal,
          surface: "grass",
          object: null,
          range,
          time: timeOfFlight(range),
          dir: DIR.clone(),
        };
      }
      x0 = x1;
      P0.copy(P1);
      if (x1 >= MAX_RANGE) break;
    }
    return { kind: "none", id: -1, part: "body", secret: null, point: P0.clone(), normal: new Vector3(0, 1, 0), surface: "grass", object: null, range: MAX_RANGE, time: timeOfFlight(MAX_RANGE), dir: DIR.clone() };
  }

  /**
   * Advance every round `dt` seconds, testing what it passes through against
   * the moving world. `land` hears of each as it arrives; `glass` of a
   * windshield it goes through on its way.
   */
  update(dt: number, moving: MovingWorld, land: (f: Flight, where: Landing3D) => void, glass: (f: Flight, at: Vector3, id: number) => void): void {
    for (const f of this.flights) {
      if (f.done) continue;
      f.t += dt;
      const target = Math.min(rangeAt(f.t), f.stopAt);
      // Straight pieces of at most 12 m.
      while (f.x < target && !f.done) {
        const x1 = Math.min(target, f.x + 12);
        roundAt(f.frame, f.x, P0);
        roundAt(f.frame, x1, P1);
        const hit = moving.test(P0, P1, (id, d) => {
          const was = f.near.get(id);
          if (was === undefined || d < was) f.near.set(id, d);
        });
        if (hit && hit.kind === "glass" && f.glassAt < 0) {
          // Through the glass: a crack, and the round turned a little.
          const at = new Vector3().copy(P0).lerp(P1, hit.t);
          const xg = f.x + (x1 - f.x) * hit.t;
          f.glassAt = xg;
          glass(f, at, hit.id);
          this.deflect(f, xg);
          f.x = xg + 0.05;
          continue;
        }
        if (hit && hit.kind !== "glass") {
          const range = f.x + (x1 - f.x) * hit.t;
          DIR.copy(P1).sub(P0).normalize();
          f.done = true;
          land(f, {
            kind: hit.kind === "actor" ? "actor" : hit.kind === "engine" ? "engine" : hit.kind === "duck" ? "duck" : "vehicle",
            id: hit.id,
            part: hit.part,
            secret: hit.kind === "duck" ? "duck" : null,
            point: hit.point.clone(),
            normal: hit.normal.clone(),
            surface: hit.surface,
            object: null,
            range,
            time: timeOfFlight(range),
            dir: DIR.clone(),
          });
          break;
        }
        f.x = x1;
        f.path.push(P1.clone());
      }
      if (!f.done && f.x >= f.stopAt - 1e-6) {
        f.done = true;
        land(f, f.still);
      }
    }
    for (let i = this.flights.length - 1; i >= 0; i--) if (this.flights[i]!.done && this.flights[i]!.t > 3) this.flights.splice(i, 1);
  }

  /** A windshield turns the round by a hair, keeping its path through the glass. */
  private deflect(f: Flight, at: number): void {
    const g = () => {
      const u = Math.max(1e-9, this.random());
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * this.random());
    };
    const d = f.frame.dir;
    const nx = d.x + g() * GLASS_DEFLECTION;
    const ny = d.y + g() * GLASS_DEFLECTION;
    const nz = d.z + g() * GLASS_DEFLECTION;
    const n = Math.hypot(nx, ny, nz);
    const o = f.frame.origin;
    // Keep the point at the glass where it was: origin' = origin + (dir − dir')·at.
    o.x += (d.x - nx / n) * at;
    o.y += (d.y - ny / n) * at;
    o.z += (d.z - nz / n) * at;
    d.x = nx / n;
    d.y = ny / n;
    d.z = nz / n;
    // Up is square to the new line (the drop hangs off it), and so is the crosswind.
    const fresh = sightFrame(o, d, 0);
    f.frame.up.x = fresh.up.x;
    f.frame.up.y = fresh.up.y;
    f.frame.up.z = fresh.up.z;
    // Where the still valley stops it now.
    f.still = this.stillHit(f.frame);
    f.stopAt = f.still.range;
  }

  clear(): void {
    this.flights.length = 0;
  }
}
