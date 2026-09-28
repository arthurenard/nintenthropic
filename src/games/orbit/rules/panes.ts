/**
 * The seven panes: each one's integrity, the marks strikes leave on it (a
 * chip, a crack, a spider web), mending and sealing, and the failure that
 * ends the game. There is no player health: the glass is it.
 */
import { ALARM_BELOW, CRACK_COST, INTEGRITY_MAX, PANES, WEB_COST } from "./tuning";
import type { V3 } from "./vec";

export type MarkSize = "chip" | "crack" | "web";

/** What a strike left on the glass, for the world to draw. */
export interface Mark {
  id: number;
  pane: number;
  point: V3;
  size: MarkSize;
  /** The integrity it cost. */
  cost: number;
  /** How much of it still shows, 1 fresh to 0 mended away. */
  left: number;
  /** When, on the match's clock. */
  at: number;
}

export function markSize(cost: number): MarkSize {
  return cost >= WEB_COST ? "web" : cost >= CRACK_COST ? "crack" : "chip";
}

export class Glass {
  readonly integrity: number[] = [];
  readonly marks: Mark[] = [];
  /** Strikes each pane has taken this game. */
  readonly strikes: number[] = [];
  /** The pane that failed, once one has. */
  failed: number | null = null;
  /** Hits hurt but never break a pane (the dev harness's god mode). */
  immortal = false;
  private nextMark = 1;

  constructor(readonly count = PANES) {
    for (let i = 0; i < count; i++) {
      this.integrity.push(INTEGRITY_MAX);
      this.strikes.push(0);
    }
  }

  /** A strike on `pane` costing `cost`: the mark it leaves, and whether the pane failed. */
  strike(pane: number, cost: number, point: V3, t: number): { mark: Mark; failed: boolean } {
    const before = this.integrity[pane] ?? 0;
    const floor = this.immortal ? 1 : 0;
    const after = Math.max(floor, before - cost);
    this.integrity[pane] = after;
    this.strikes[pane] = (this.strikes[pane] ?? 0) + 1;
    const mark: Mark = { id: this.nextMark++, pane, point: { ...point }, size: markSize(cost), cost: before - after, left: 1, at: t };
    this.marks.push(mark);
    const failed = after <= 0 && this.failed === null;
    if (failed) this.failed = pane;
    return { mark, failed };
  }

  /** Mend `pane` by up to `amount`: returns how much it took. */
  mend(pane: number, amount: number): number {
    const before = this.integrity[pane] ?? INTEGRITY_MAX;
    if (this.failed === pane) return 0;
    const after = Math.min(INTEGRITY_MAX, before + Math.max(0, amount));
    this.integrity[pane] = after;
    if (after > before) this.fade(pane);
    return after - before;
  }

  /** The crew seals chips: `amount` back on every pane under full. Returns the panes it reached. */
  seal(amount: number): number[] {
    const out: number[] = [];
    for (let p = 0; p < this.count; p++) {
      if (this.failed === p || (this.integrity[p] ?? INTEGRITY_MAX) >= INTEGRITY_MAX) continue;
      this.mend(p, amount);
      out.push(p);
    }
    return out;
  }

  /**
   * The marks show as much damage as is left: the newest stay, the oldest
   * fade as the pane is mended, and one mended right away is gone.
   */
  private fade(pane: number): void {
    let budget = INTEGRITY_MAX - (this.integrity[pane] ?? INTEGRITY_MAX);
    for (let i = this.marks.length - 1; i >= 0; i--) {
      const m = this.marks[i] as Mark;
      if (m.pane !== pane) continue;
      const share = m.cost > 0 ? Math.min(1, Math.max(0, budget / m.cost)) : 0;
      m.left = Math.min(m.left, share);
      budget -= m.cost * m.left;
      if (m.left <= 0.001) this.marks.splice(i, 1);
    }
  }

  /** The pane most in need, or null when every pane is whole. */
  worst(): number | null {
    let best: number | null = null;
    let low = INTEGRITY_MAX;
    for (let p = 0; p < this.count; p++) {
      const v = this.integrity[p] ?? INTEGRITY_MAX;
      if (this.failed === p) continue;
      if (v < low) {
        low = v;
        best = p;
      }
    }
    return best;
  }

  /** The weakest pane's integrity, 0..100. */
  get weakest(): number {
    return Math.min(...this.integrity);
  }

  /** Is any pane low enough to sound the master alarm? */
  get alarm(): boolean {
    return this.failed === null && this.integrity.some((v) => v < ALARM_BELOW);
  }

  get whole(): boolean {
    return this.integrity.every((v) => v >= INTEGRITY_MAX);
  }
}
