/**
 * The whole picture's white flash for an explosion close by (the grade's
 * `flash`), in two manners.
 *
 * Standard: it jumps to its height on the bang and fades in a blink.
 *
 * Reduced flashing (Settings.reducedFlashing), for players sensitive to
 * flashes: a tenth as strong, and it swells and ebbs over a few tenths of a
 * second instead - a warm glow, not a strobe. (A tenth, not a fifth: the
 * display's gamma lifts a small addition to a dark picture, and measured on
 * screen a tenth brightens it by under a fifth of what Standard's does.)
 * Nothing in play then changes the picture's brightness by more than a
 * sliver from one frame to the next.
 */
export const REDUCED_FLASH = 0.1;
/** Standard's fade. */
const FALL = 0.12;
/** Reduced: how quickly the glow swells toward its height, and how slowly that height ebbs. */
const SOFT_RISE = 0.12;
const SOFT_FALL = 0.45;

export class ScreenFlash {
  /** What the grade adds now. */
  value = 0;
  /** Reduced: where the glow is heading. */
  private height = 0;

  /** A flash of `amount` (0..1 of white) now. */
  kick(amount: number, reduced: boolean): void {
    if (reduced) this.height = Math.max(this.height, amount * REDUCED_FLASH);
    else this.value = Math.max(this.value, amount);
  }

  update(dt: number): number {
    if (this.height > 0) {
      // Reduced: follow the height up gently, then let both ebb together.
      this.value += (this.height - this.value) * (1 - Math.exp(-dt / SOFT_RISE));
      this.height *= Math.exp(-dt / SOFT_FALL);
      if (this.height < 1e-4) this.height = 0;
    } else {
      this.value *= Math.exp(-dt / FALL);
    }
    return this.value;
  }

  reset(): void {
    this.value = 0;
    this.height = 0;
  }
}
