import { LAST_ONE_AFTER, LAST_ONE_REPEAT, SPOTTER_DELAY, SPOTTER_FIRST, SPOTTER_LOST, SPOTTER_REPEAT } from "./tuning";

/** How long a man must be in the glass (or under the crosshair) for him to count as found, seconds. */
export const FOUND_AFTER = 0.4;

/** What the spotter has to say: where the men are, or which way to turn the scope. */
export type SpotterSays = "tell" | "lost" | null;

/**
 * The spotter's words, for a newcomer who cannot see a man 300 m away in
 * the wide view and cannot know where to look. (The marks over the men are
 * the game's, with Aim Assist; the spotter speaks whatever the setting.)
 *
 * When the fight is some seconds old and nobody has been found yet, he says
 * where ("tell", once). A player looking through the scope at nothing, with
 * nobody found, is told which way to turn ("lost", now and then) - unless
 * the scope's rim already has an arrow for it (`directions` false).
 * Pure: the game feeds him the seconds and what the player sees.
 */
export class Spotter {
  private stage = 1;
  private idle = 0;
  private inView = 0;
  private lostFor = 0;
  private cooldown = 0;
  private found = false;
  private told = false;

  /** A stage begins: no one is found yet. */
  begin(stage: number): void {
    this.stage = Math.max(1, Math.floor(stage));
    this.idle = 0;
    this.inView = 0;
    this.lostFor = 0;
    this.cooldown = 0;
    this.found = false;
    this.told = false;
  }

  /** Has the player had one of the job's men in the glass (or under the crosshair) this stage? */
  get hasFound(): boolean {
    return this.found;
  }

  /**
   * One step. `fighting`: the fight is on (the stage's intro and breathers
   * do not count). `scoped`: looking through the scope. `inGlass`: an
   * objective is inside the scope's glass now - or, in the wide view, under
   * the crosshair. `directions`: say which way to turn (no arrow does).
   * Says "tell" on the one step the fight is SPOTTER_FIRST seconds old
   * (SPOTTER_DELAY after the first stage) with nobody found; "lost" when
   * the scope has looked at nothing for SPOTTER_LOST seconds, at most every
   * SPOTTER_REPEAT.
   */
  update(dt: number, fighting: boolean, scoped: boolean, inGlass: boolean, directions = true): SpotterSays {
    if (!fighting) return null;
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (inGlass) {
      this.inView += dt;
      if (this.inView >= FOUND_AFTER) this.found = true;
    } else {
      this.inView = 0;
    }
    if (this.found) return null;
    if (!this.told) {
      this.idle += dt;
      // He does not talk over himself: a word of direction just given holds the telling back.
      if (this.idle >= (this.stage === 1 ? SPOTTER_FIRST : SPOTTER_DELAY) && this.cooldown <= 0) {
        this.told = true;
        this.cooldown = SPOTTER_REPEAT;
        return "tell";
      }
    }
    this.lostFor = scoped && !inGlass ? this.lostFor + dt : 0;
    if (this.lostFor >= SPOTTER_LOST && this.cooldown <= 0 && directions) {
      this.lostFor = 0;
      this.cooldown = SPOTTER_REPEAT;
      return "lost";
    }
    return null;
  }
}

/**
 * The last man. When one of a job's several men is left and the player has
 * not found him (in the glass, or under the crosshair) for LAST_ONE_AFTER
 * seconds, his mark breathes gently (`pulsing`) and the spotter says where,
 * once ("tell"); if he is still not found LAST_ONE_REPEAT seconds on, he
 * says it again. Finding him starts the wait over. Pure, like the spotter.
 */
export class LastOne {
  private who: number | null = null;
  private waited = 0;
  private seen = 0;
  private cooldown = 0;
  private spoken = false;

  /** A stage begins afresh. */
  begin(): void {
    this.who = null;
    this.waited = 0;
    this.seen = 0;
    this.cooldown = 0;
    this.spoken = false;
  }

  /** Who is being waited on, and has been unfound long enough to be helped. */
  get pulsing(): number | null {
    return this.who !== null && this.waited >= LAST_ONE_AFTER ? this.who : null;
  }

  /**
   * One step. `who`: the id of the one man left (null when no one, or more
   * than one, or the job has only the one). `found`: he is in the glass or
   * under the crosshair now.
   */
  update(dt: number, fighting: boolean, who: number | null, found: boolean): "tell" | null {
    if (!fighting || who === null) {
      this.begin();
      return null;
    }
    if (who !== this.who) {
      this.begin();
      this.who = who;
    }
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (found) {
      // A glance past is not finding: he has to be there for a moment.
      this.seen += dt;
      if (this.seen >= FOUND_AFTER) {
        this.waited = 0;
        this.spoken = false;
      }
      return null;
    }
    this.seen = 0;
    this.waited += dt;
    if (this.waited >= LAST_ONE_AFTER && (!this.spoken || this.cooldown <= 0)) {
      this.spoken = true;
      this.cooldown = LAST_ONE_REPEAT;
      return "tell";
    }
    return null;
  }
}
