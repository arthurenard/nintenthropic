import type { Difficulty } from "../../../engine/types";
import { DIFFICULTY, SPOTTER_DELAY, SPOTTER_FIRST, SPOTTER_LOST, SPOTTER_REPEAT, SPOTTER_STAGES } from "./tuning";

/** How long a man must be in the glass for him to count as found, seconds. */
const FOUND_AFTER = 0.4;

/** What the spotter has to say: where the men are, or which way to turn the scope. */
export type SpotterSays = "tell" | "lost" | null;

/**
 * The spotter: what finds the job's men for a newcomer, who cannot see a
 * man 300 m away in the wide view and cannot know where to look.
 *
 * He marks where the men are while the view is wide (`marking`) - always on
 * Relaxed, and for the first stages on Standard - and, when the fight is
 * some seconds old and nobody has been in the player's glass yet, he says
 * where ("tell", once) and marks them whatever the stage. A player looking
 * through the scope at nothing, with nobody found, is told which way to
 * turn ("lost"), now and then, while he is marking.
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
  /** Marks switched on for the stage by the wait (a later stage on Standard). */
  private asked = false;

  constructor(private readonly difficulty: Difficulty = "standard") {}

  /** A stage begins: no one is found yet. */
  begin(stage: number): void {
    this.stage = Math.max(1, Math.floor(stage));
    this.idle = 0;
    this.inView = 0;
    this.lostFor = 0;
    this.cooldown = 0;
    this.found = false;
    this.told = false;
    this.asked = false;
  }

  /** Marks over the men to find, while the view is wide? */
  get marking(): boolean {
    return DIFFICULTY[this.difficulty].spotter || this.stage <= SPOTTER_STAGES || this.asked;
  }

  /** Has the player had one of the job's men in the glass this stage? */
  get hasFound(): boolean {
    return this.found;
  }

  /**
   * One step. `fighting`: the fight is on (the stage's intro and breathers
   * do not count). `scoped`: looking through the scope. `inGlass`: an
   * objective is inside the scope's glass now. Says "tell" on the one step
   * the fight is SPOTTER_FIRST seconds old (SPOTTER_DELAY after the first
   * stage) with nobody found; "lost" when the scope has looked at nothing
   * for SPOTTER_LOST seconds, at most every SPOTTER_REPEAT.
   */
  update(dt: number, fighting: boolean, scoped: boolean, inGlass: boolean): SpotterSays {
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
        this.asked = true;
        this.cooldown = SPOTTER_REPEAT;
        return "tell";
      }
    }
    this.lostFor = scoped && !inGlass ? this.lostFor + dt : 0;
    if (this.lostFor >= SPOTTER_LOST && this.cooldown <= 0 && this.marking) {
      this.lostFor = 0;
      this.cooldown = SPOTTER_REPEAT;
      return "lost";
    }
    return null;
  }
}
