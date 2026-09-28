/**
 * The re-arm, heard. With a finger pistol, raising the thumb again after a
 * shot is cocking the hammer (High Noon's revolver; a rifle's bolt or lever
 * is the same moment), and otherwise only the crosshair turning green says
 * so. This decides the frames on which a soft click should sound: the thumb
 * coming up after a fold, in play, with a round ready to fire.
 *
 * Not while reloading (the cylinder is out), not on an empty gun (the next
 * fold is the dry click, which says it all), not for a hand found again
 * after being lost (nothing was folded), and never closer together than
 * HAMMER_MIN_GAP, whatever the tracking does. A game plays its own sound.
 */
export const HAMMER_MIN_GAP = 0.25;

export interface HammerFrame {
  /** The page's aim for this frame. */
  armed: boolean;
  fired: boolean;
  /** In play, with the hand as the gun (not the aim check, not a mouse). */
  live: boolean;
  reloading: boolean;
  rounds: number;
}

export class Hammer {
  private wasArmed = false;
  private folded = false;
  private since = Number.POSITIVE_INFINITY;

  /** One frame; true when the hammer's click should sound now. */
  update(dt: number, f: HammerFrame): boolean {
    this.since += dt;
    const rising = f.armed && !this.wasArmed;
    this.wasArmed = f.armed;
    if (!f.live) {
      this.folded = false;
      return false;
    }
    if (f.fired) this.folded = true;
    if (!rising || !this.folded) return false;
    this.folded = false;
    if (f.reloading || f.rounds <= 0 || this.since < HAMMER_MIN_GAP) return false;
    this.since = 0;
    return true;
  }
}
