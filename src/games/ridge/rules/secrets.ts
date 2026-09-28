/**
 * The valley's eight secrets and their bookkeeping: which are found this
 * game, and the few that take more than one shot (the eagle wants three
 * near misses; the goat hops on from ledge to ledge). Their shows are the
 * world's (world/secretsWorld.ts).
 */
import type { SecretId } from "./types";

export const SECRET_NAMES: Readonly<Record<SecretId, string>> = {
  bell: "The Bell",
  goat: "The Goat",
  cheese: "The Cheese",
  yeti: "The Yeti",
  siren: "The Siren",
  eagle: "The Eagle",
  duck: "The Duck",
  echo: "The Echo",
};

export const SECRETS_TOTAL = Object.keys(SECRET_NAMES).length;

/** Near misses on the eagle before it comes down to look at you. */
export const EAGLE_NEAR_MISSES = 3;
/** How close a round must pass to count as near the eagle or the goat, metres. */
export const NEAR_EAGLE = 7;
export const NEAR_GOAT = 5;

export class SecretTracker {
  private readonly found = new Set<SecretId>();
  /** Near misses on the eagle so far. */
  eagleMisses = 0;
  /** Which ledge the goat is on. */
  goatLedge = 0;

  has(id: SecretId): boolean {
    return this.found.has(id);
  }

  get count(): number {
    return this.found.size;
  }

  /** Mark it found; true if it is new this game. */
  find(id: SecretId): boolean {
    if (this.found.has(id)) return false;
    this.found.add(id);
    return true;
  }

  /** One more near miss on the eagle; true on the one that brings it down. */
  eagleNearMiss(): boolean {
    if (this.found.has("eagle")) return false;
    this.eagleMisses++;
    return this.eagleMisses >= EAGLE_NEAR_MISSES;
  }
}
