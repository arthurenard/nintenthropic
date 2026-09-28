import type { V3 } from "../../../engine/rules/raymath";
import { pointAlong } from "./dead";
import { SURVIVOR_SPEED } from "./tuning";
import type { SurvivorRole } from "./types";

export type SurvivorState = "running" | "stumbling" | "gone";

export interface SurvivorEvents {
  survivorAppear(s: Survivor): void;
  survivorGone(s: Survivor): void;
}

/** A shot survivor staggers this long, then runs on. */
export const STUMBLE_TIME = 0.7;

/**
 * One of the living: Miller's daughter, then the old motel owner, running
 * across the road with a lantern toward the motel. Unmistakable (a lit
 * lantern, the gait of the living, a call as they go), never with the dead,
 * and gone once across. Shot, they stumble, then run on.
 */
export class Survivor {
  state: SurvivorState = "running";
  t = 0;
  along = 0;
  readonly pos: V3 = { x: 0, y: 0, z: 0 };
  readonly heading = { x: 1, z: 0 };
  shot = false;
  readonly length: number;
  private readonly lengths: number[] = [];

  constructor(
    readonly id: number,
    readonly role: SurvivorRole,
    readonly path: readonly V3[],
    readonly speed = SURVIVOR_SPEED,
  ) {
    let total = 0;
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1] as V3;
      const b = path[i] as V3;
      const l = Math.hypot(b.x - a.x, b.z - a.z);
      this.lengths.push(l);
      total += l;
    }
    this.length = Math.max(0.1, total);
    pointAlong(this.path, this.lengths, 0, this.pos, this.heading);
  }

  get shootable(): boolean {
    return this.state !== "gone";
  }

  step(dt: number, events: SurvivorEvents): void {
    if (this.state === "gone") return;
    this.t += dt;
    if (this.state === "stumbling") {
      if (this.t < STUMBLE_TIME) return;
      this.state = "running";
    }
    this.along = Math.min(this.length, this.along + this.speed * dt);
    pointAlong(this.path, this.lengths, this.along, this.pos, this.heading);
    if (this.along >= this.length) {
      this.state = "gone";
      events.survivorGone(this);
    }
  }

  /** Shot: a stumble, then on toward the motel. */
  hit(): void {
    this.shot = true;
    this.state = "stumbling";
    this.t = 0;
  }
}

/** The survivors in the order they come: Miller's daughter first, then the motel owner. */
export const SURVIVOR_ORDER: readonly SurvivorRole[] = ["daughter", "owner"];
