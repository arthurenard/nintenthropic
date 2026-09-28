/**
 * The eight secrets of Station Meridian and what finds each one. The world
 * (world/secretsWorld.ts) makes them happen on screen; this only decides
 * when a secret is found, so the rules can be tested without a station.
 */
export type SecretId = "astronaut" | "toolbag" | "duck" | "arm" | "capsule" | "storm" | "moon" | "message";

export const SECRET_NAMES: Record<SecretId, string> = {
  astronaut: "The Spacewalker",
  toolbag: "Lost and Found",
  duck: "The Duck",
  arm: "A Wave from the Arm",
  capsule: "Privacy, Please",
  storm: "The Aurora",
  moon: "Flag on the Moon",
  message: "Hello, World",
};

export const SECRETS_TOTAL = 8;
/** Lightning flashes shot in one breather to call up the aurora. */
export const STORM_FLASHES = 3;
/** The spacewalker drifts along the truss on this pass. */
export const ASTRONAUT_PASS = 2;
/** The Moon rises over the limb on this pass. */
export const MOON_PASS = 4;
/** The tool bag tumbles past once, on this pass. */
export const TOOLBAG_PASS = 3;
/** The duck drifts through the debris field on this pass (and every sixth after). */
export const DUCK_PASS = 2;

/** What a shot near a secret found (the world decides "near" and "at"). */
export type SecretShot =
  | { secret: "astronaut"; at: boolean }
  | { secret: "toolbag" }
  | { secret: "duck" }
  | { secret: "arm" }
  | { secret: "capsule" }
  | { secret: "storm" }
  | { secret: "moon" }
  | { secret: "message" };

export class SecretTracker {
  readonly found = new Set<SecretId>();
  /** Lightning flashes shot in this breather. */
  flashes = 0;
  /** The aurora ripples over the limb for the rest of the game. */
  aurora = false;

  get count(): number {
    return this.found.size;
  }

  /** Marks a secret found; returns true only the first time. */
  find(id: SecretId): boolean {
    if (this.found.has(id)) return false;
    this.found.add(id);
    return true;
  }

  /** A new breather: the storm's count starts again. */
  breather(): void {
    this.flashes = 0;
  }

  /** A lightning flash shot: the third in one breather calls up the aurora (once a game). */
  flash(): { count: number; aurora: boolean } {
    this.flashes++;
    const aurora = this.flashes >= STORM_FLASHES && !this.aurora;
    if (aurora) this.aurora = true;
    return { count: this.flashes, aurora };
  }
}
