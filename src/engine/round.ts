/**
 * The bookkeeping every shooter's Game does the same way: a breath for the
 * page between the long steps of loading, the aim check's stand-in until the
 * game's own targets exist, and things to do a moment from now on the game's
 * own clock.
 */
import type { CalibrationStage, CalibrationTarget, TargetNoun } from "./types";

/**
 * A moment for the page between the long steps of getting ready, so the
 * loading bar keeps moving instead of freezing for a second at the end.
 */
export function breathe(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** A game's own aim-check targets (its bottles, jars, lights or plates): all a CalibrationStage does but begin. */
export type CalibrationTargets = Pick<CalibrationStage, "targets" | "light" | "hit" | "miss" | "done">;

/**
 * The aim check's stage from the moment the game is made. Before load() it
 * has nothing to show; afterwards it forwards every call to the game's
 * targets. The game hears the host begin a check (`onBegin`, again if the
 * targets run out mid-check) and ask for or light a target (`onUse`): that is
 * how it puts its world back when the check comes round again after a game
 * (Play Again, Adjust Aim) on the same instance.
 */
export class CalibrationProxy implements CalibrationStage {
  target: CalibrationTargets | null = null;
  onBegin: () => void = () => {};
  onUse: () => void = () => {};

  constructor(readonly noun: TargetNoun) {}

  /** The host calls this before every aim check, and again if the targets run out. */
  begin(): void {
    this.onBegin();
  }

  targets(): CalibrationTarget[] {
    this.onUse();
    return this.target ? this.target.targets() : [];
  }

  light(id: string | null): void {
    this.onUse();
    this.target?.light(id);
  }

  hit(id: string): void {
    this.target?.hit(id);
  }

  miss(id: string, x: number, y: number): void {
    this.target?.miss(id, x, y);
  }

  done(): void {
    this.target?.done();
  }
}

/**
 * Things to do a moment from now on the game's own clock (`now`): a wave's
 * bonuses one after another, a secret's toast once its show has played. A
 * clock that slows (High Noon's fall) slows them with it, and a paused game,
 * whose clock stands still, holds them.
 */
export class Schedule {
  private readonly pending: { at: number; run: () => void }[] = [];

  constructor(private readonly now: () => number) {}

  /** Run `run` once the clock is `seconds` on from now. */
  later(seconds: number, run: () => void): void {
    this.pending.push({ at: this.now() + seconds, run });
  }

  /** Run whatever is due, once a frame. Anything a run asks for in turn waits for the next frame. */
  run(): void {
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const s = this.pending[i]!;
      if (this.now() >= s.at) {
        this.pending.splice(i, 1);
        s.run();
      }
    }
  }

  /** Forget everything still to come (the game is put back for another round). */
  clear(): void {
    this.pending.length = 0;
  }
}
