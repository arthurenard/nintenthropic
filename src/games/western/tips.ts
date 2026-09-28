import type { InputKind } from "../../engine/types";
import { reloadHint } from "./hints";

/**
 * The one-time tips: High Noon teaches itself a lesson at a time, at the
 * moment it matters, and never twice. Ids are kept by the page between
 * visits (Settings.tipsSeen).
 */
export type TipId = "western.reload" | "western.townsfolk" | "western.glint" | "western.dynamite";

export const ALL_TIPS: readonly TipId[] = ["western.reload", "western.townsfolk", "western.glint", "western.dynamite"];

/** How long a tip stays up, and the breath between two. */
export const TIP_SECONDS = 4;
export const TIP_GAP = 0.6;

/** Each tip's words, in the player's own terms. */
export function tipText(id: TipId, input: InputKind | undefined): string {
  switch (id) {
    case "western.reload":
      return reloadHint(input);
    case "western.townsfolk":
      return "Hold your fire. Townsfolk aren’t with the gang.";
    case "western.glint":
      return "A glint means he’s about to fire.";
    case "western.dynamite":
      return "Shoot the dynamite before it lands.";
  }
}

/**
 * A lesson is learned when it has been shown, or - for the reload, which
 * is shown at the start of every game until then - when the player has
 * done it by themselves.
 */
const LEARNED_BY_DOING: ReadonlySet<TipId> = new Set(["western.reload"]);

interface Tip {
  id: TipId;
  text: string;
}

/**
 * The hint line at the foot of the view. It carries three kinds of message,
 * the most urgent shown:
 *
 * - a need: something to do now (the cylinder is empty: reload). It stays
 *   until met, and nothing replaces it.
 * - a word: a short acknowledgement of what just happened ("That was the
 *   barber."). Its time runs whether or not it can be seen.
 * - tips: one-time lessons, one at a time for TIP_SECONDS each, queued in
 *   the order their moments came. A tip's time runs only while it shows; one
 *   cut short by a need or a word finishes afterwards.
 *
 * Quiet (the aim check, the fall, the results) it shows nothing and takes
 * no tips; anything still waiting is let go unshown, to be offered again.
 * Pure: the game reads `text` each frame and passes it to the HUD.
 */
export class HintLine {
  private need: string | null = null;
  private word: { text: string; left: number } | null = null;
  private tip: (Tip & { left: number }) | null = null;
  private readonly queue: Tip[] = [];
  private gap = 0;
  private quiet = true;

  constructor(private readonly seen: Set<string>) {}

  /** What the line shows now, or null for nothing. */
  get text(): string | null {
    if (this.quiet) return null;
    return this.need ?? this.word?.text ?? this.tip?.text ?? null;
  }

  /** Quiet on: nothing shows, and waiting tips are let go. Off: back in play. */
  setQuiet(on: boolean): void {
    this.quiet = on;
    if (!on) return;
    this.need = null;
    this.word = null;
    this.tip = null;
    this.queue.length = 0;
    this.gap = 0;
  }

  /** The moment for a tip has come: it will show when the line is free, unless already learned. */
  offer(id: TipId, text: string): void {
    if (this.quiet || this.seen.has(id)) return;
    if (this.tip?.id === id || this.queue.some((t) => t.id === id)) return;
    this.queue.push({ id, text });
  }

  /** The player did it by themselves: the lesson is learned, and not shown again. */
  learned(id: TipId): void {
    this.seen.add(id);
    if (this.tip?.id === id) {
      this.tip = null;
      this.gap = TIP_GAP;
    }
    const i = this.queue.findIndex((t) => t.id === id);
    if (i >= 0) this.queue.splice(i, 1);
  }

  /** Something the player must do now, or null when it is done. */
  setNeed(text: string | null): void {
    this.need = text;
  }

  get needed(): string | null {
    return this.need;
  }

  /** A brief acknowledgement, shown over any tip for `seconds`. */
  say(text: string, seconds: number): void {
    this.word = { text, left: seconds };
  }

  /** Let the words go (a wave is won); tips carry on. */
  clearWord(): void {
    this.word = null;
  }

  update(dt: number): void {
    if (this.quiet) return;
    if (this.word) {
      this.word.left -= dt;
      if (this.word.left <= 0) this.word = null;
    }
    if (this.need || this.word) return;
    if (this.tip) {
      this.tip.left -= dt;
      if (this.tip.left > 0) return;
      this.tip = null;
      this.gap = TIP_GAP;
    }
    if (this.gap > 0) {
      this.gap -= dt;
      return;
    }
    const next = this.queue.shift();
    if (!next) return;
    this.tip = { ...next, left: TIP_SECONDS };
    if (!LEARNED_BY_DOING.has(next.id)) this.seen.add(next.id);
  }
}
