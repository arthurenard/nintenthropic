/**
 * The chrome in the corners steps aside for the world. When what the player
 * is aiming at - the crosshair, or the target lit in the aim check - is
 * behind the camera preview, the score panel, the cylinder or a card, that
 * piece fades almost away until the aim moves on, the way FaceTime's picture
 * in picture gets out of the way. The world owns the centre, and the corners
 * too when it needs them.
 */
export interface Spot {
  /** In CSS pixels from the stage's top-left corner. */
  x: number;
  y: number;
  /** How far round it must stay clear, in CSS pixels. */
  r: number;
}

/** The margin a spot keeps from a panel's edge before it yields, CSS px. */
const MARGIN = 12;

export class Yielding {
  private readonly elements: HTMLElement[];

  constructor(
    private readonly stage: HTMLElement,
    ids: string[],
  ) {
    this.elements = ids.map((id) => document.getElementById(id)).filter((e): e is HTMLElement => e !== null);
  }

  update(spots: Spot[]): void {
    const origin = this.stage.getBoundingClientRect();
    for (const element of this.elements) {
      let covered = false;
      if (!element.hidden && spots.length) {
        const box = element.getBoundingClientRect();
        const left = box.left - origin.left - MARGIN;
        const top = box.top - origin.top - MARGIN;
        const right = box.right - origin.left + MARGIN;
        const bottom = box.bottom - origin.top + MARGIN;
        covered = box.width > 0 && spots.some((s) => s.x + s.r > left && s.x - s.r < right && s.y + s.r > top && s.y - s.r < bottom);
      }
      if (element.classList.contains("yield") !== covered) element.classList.toggle("yield", covered);
    }
  }

  reset(): void {
    for (const element of this.elements) element.classList.remove("yield");
  }
}
