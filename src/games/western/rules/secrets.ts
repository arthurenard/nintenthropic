/**
 * The eight secrets of Dust Creek and what triggers each one. The world
 * (src/games/western/world/secrets.ts) makes them happen on screen; this only
 * decides when a secret is found, so the rules can be tested without a town.
 */
export type SecretId =
  | "bell"
  | "vane"
  | "chicken"
  | "water_tower"
  | "piano"
  | "tumbleweeds"
  | "poster"
  | "high_noon";

export const SECRET_NAMES: Record<SecretId, string> = {
  bell: "Three Tolls",
  vane: "Pointing at You",
  chicken: "Chicken of Steel",
  water_tower: "Spring a Leak",
  piano: "Honky-Tonk",
  tumbleweeds: "Giant Tumbleweed",
  poster: "Wanted: The Hand",
  high_noon: "High Noon",
};

export const SECRETS_TOTAL = 8;
export const BELL_TOLLS_TO_OPEN = 3;
export const CHICKEN_HITS = 3;
export const PIANO_NOTES_FOR_TUNE = 3;
export const TUMBLEWEEDS_FOR_GIANT = 5;

/** 12:00 to 12:05 on the player's own clock. */
export function isHighNoon(date: Date): boolean {
  return date.getHours() === 12 && date.getMinutes() < 5;
}

export class SecretTracker {
  readonly found = new Set<SecretId>();
  /** Bell hits in a row, with no other shot between them. */
  bellRun = 0;
  chickenHits = 0;
  pianoNotes = 0;
  tumbleweedsShot = 0;
  /** The giant tumbleweed is owed to the next breather. */
  giantPending = false;
  private giantDone = false;

  get count(): number {
    return this.found.size;
  }

  /** Marks a secret found; returns true only the first time. */
  private find(id: SecretId): boolean {
    if (this.found.has(id)) return false;
    this.found.add(id);
    return true;
  }

  /** Every shot the player fires, before its own handler: anything but the bell breaks the run. */
  shotAt(target: SecretId | null): void {
    if (target !== "bell") this.bellRun = 0;
  }

  /** The bell tolls; on the third toll in a row the church doors open. */
  bell(): { toll: number; doorsOpen: boolean; newlyFound: boolean } {
    this.bellRun++;
    const doorsOpen = this.bellRun >= BELL_TOLLS_TO_OPEN;
    const toll = this.bellRun;
    let newlyFound = false;
    if (doorsOpen) {
      newlyFound = this.find("bell");
      this.bellRun = 0;
    }
    return { toll, doorsOpen, newlyFound };
  }

  vane(): boolean {
    return this.find("vane");
  }

  /** A shot near the chicken; the third in a game makes it the Chicken of Steel. */
  chicken(): { hits: number; newlyFound: boolean } {
    this.chickenHits++;
    const newlyFound = this.chickenHits >= CHICKEN_HITS ? this.find("chicken") : false;
    return { hits: this.chickenHits, newlyFound };
  }

  waterTower(): boolean {
    return this.find("water_tower");
  }

  /** A note on the piano; the third plays the tune. */
  piano(): { notes: number; tune: boolean; newlyFound: boolean } {
    this.pianoNotes++;
    const tune = this.pianoNotes % PIANO_NOTES_FOR_TUNE === 0;
    const newlyFound = tune ? this.find("piano") : false;
    return { notes: this.pianoNotes, tune, newlyFound };
  }

  /** A tumbleweed shot; the fifth earns a giant one in the next breather. */
  tumbleweed(): { shot: number; giant: boolean } {
    this.tumbleweedsShot++;
    let giant = false;
    if (this.tumbleweedsShot >= TUMBLEWEEDS_FOR_GIANT && !this.giantDone) {
      this.giantDone = true;
      this.giantPending = true;
      giant = true;
    }
    return { shot: this.tumbleweedsShot, giant };
  }

  /** The giant tumbleweed rolled through: now it counts as found. */
  giantRolled(): boolean {
    this.giantPending = false;
    return this.find("tumbleweeds");
  }

  poster(): boolean {
    return this.find("poster");
  }

  highNoon(): boolean {
    return this.find("high_noon");
  }
}
