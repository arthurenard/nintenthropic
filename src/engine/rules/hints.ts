/**
 * The hint line at the foot of the view (HudSink.hint), as a game drives it:
 * what to show now, of everything that would like to be said.
 *
 * One-time tips are the way a game teaches itself a lesson at a time, at the
 * moment it matters, and never twice. Their ids are the game's own, prefixed
 * with its name ("western.glint", "night.headshot"); the page keeps the ones
 * seen between visits (Settings.tipsSeen).
 */

/** How long a tip stays up, and the breath between two. */
export const TIP_SECONDS = 4;
export const TIP_GAP = 0.6;

interface Tip {
  id: string;
  text: string;
}

/**
 * The line carries three kinds of message, the most urgent shown:
 *
 * - a need: something to do now (the cylinder is empty: reload). It stays
 *   until met, and nothing replaces it.
 * - a word: a short acknowledgement of what just happened ("That was the
 *   barber."). Its time runs whether or not it can be seen.
 * - tips: one-time lessons, one at a time for TIP_SECONDS each, queued in
 *   the order their moments came. A tip's time runs only while it shows; one
 *   cut short by a need or a word finishes afterwards.
 * - a standing line: what a newcomer must be told and cannot be left to miss
 *   in four seconds (how to look through a scope). It shows whenever nothing
 *   above does, and stays until the game takes it away (the player has done
 *   it) - and so never gets in the way of a need, a word or a tip.
 *
 * A lesson is learned when it has been shown - or, for the ids in
 * `learnedByDoing` (High Noon's reload, shown at the start of every game
 * until then), when the player has done it by themselves (`learned`).
 *
 * Quiet (the aim check, the fall, the results) it shows nothing and takes
 * no tips; anything still waiting is let go unshown, to be offered again.
 * Pure: the game reads `text` each frame and passes it to the HUD when it
 * changes.
 */
export class HintLine {
  private need: string | null = null;
  private standing: string | null = null;
  private word: { text: string; left: number } | null = null;
  private tip: (Tip & { left: number }) | null = null;
  private readonly queue: Tip[] = [];
  private gap = 0;
  private quiet = true;
  private readonly byDoing: ReadonlySet<string>;

  constructor(
    private readonly seen: Set<string>,
    learnedByDoing: Iterable<string> = [],
  ) {
    this.byDoing = new Set(learnedByDoing);
  }

  /** What the line shows now, or null for nothing. */
  get text(): string | null {
    if (this.quiet) return null;
    return this.need ?? this.word?.text ?? this.tip?.text ?? this.standing;
  }

  /** The line that stays while nothing more pressing shows, or null to take it away. Quiet clears it. */
  setStanding(text: string | null): void {
    this.standing = this.quiet ? null : text;
  }

  /** Quiet on: nothing shows, and waiting tips are let go. Off: back in play. */
  setQuiet(on: boolean): void {
    this.quiet = on;
    if (!on) return;
    this.need = null;
    this.standing = null;
    this.word = null;
    this.tip = null;
    this.queue.length = 0;
    this.gap = 0;
  }

  /** The moment for a tip has come: it will show when the line is free, unless already learned. */
  offer(id: string, text: string): void {
    if (this.quiet || this.seen.has(id)) return;
    if (this.tip?.id === id || this.queue.some((t) => t.id === id)) return;
    this.queue.push({ id, text });
  }

  /** The player did it by themselves: the lesson is learned, and not shown again. */
  learned(id: string): void {
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
    if (!this.byDoing.has(next.id)) this.seen.add(next.id);
  }
}
