/**
 * Keeps the aim on the player's own hand.
 *
 * The landmarker follows one hand. When another comes into the picture - a
 * friend pointing at the screen, someone walking past - it may switch to it,
 * and the crosshair would leap across the view, and could fire. So a hand
 * that appears far from where the player's hand just was is not trusted at
 * once: for a moment it moves no aim and fires nothing, and only if it stays
 * does it become the hand the game follows (the player's own hand may really
 * have moved that fast, or the other one may be all there is now).
 *
 * The other way was measured first: the landmarker looking for two hands,
 * and the page picking the player's (nearest the last, the largest to start
 * with). With only one hand in view MediaPipe then runs its palm detector on
 * every frame, looking for the second. e2e/tracker.html (?hands=1|2), worker,
 * GPU delegate, M4 Max busy with a Blender render, six alternating runs of
 * each, median of the runs' inference per camera frame:
 *
 *   numHands 1: p50 64 ms, p95 116 ms
 *   numHands 2: p50 116 ms, p95 193 ms   (+52 ms p50, 1.8x)
 *
 * The bar was under 2 ms more at p50; at 1.8x even an idle machine's 11-15
 * ms would grow by about 10. So the landmarker stays at one hand, and a jump
 * is distrusted instead, which costs nothing.
 */
import { INDEX_MCP, MIDDLE_MCP, WRIST, type Hand } from "./hand";

/** A jump between sightings further than this, in fractions of the picture, is not a hand moving. */
export const JUMP = 0.25;
/** How long a newcomer must stay before it is the hand the game follows, ms. */
export const TRUST_AFTER = 300;
/** The player's hand seen this recently is where a new sighting is compared from, ms; after longer, a hand anywhere is simply found again. */
export const RECENT = 300;

const PINKY_MCP = 17;

/** The middle of the palm, steadier than any fingertip (which moves with the aim and the fold). */
function palm(hand: Hand): [number, number] {
  const points = [hand[WRIST]!, hand[INDEX_MCP]!, hand[MIDDLE_MCP]!, hand[PINKY_MCP]!];
  return [points.reduce((s, p) => s + p.x, 0) / points.length, points.reduce((s, p) => s + p.y, 0) / points.length];
}

export type Trust = "none" | "trusted" | "adopted" | "doubted";

export class HandTrust {
  private trusted: { at: number; x: number; y: number } | null = null;
  private stranger: { since: number; at: number; x: number; y: number } | null = null;

  /**
   * One camera frame's hand at `now` ms. "trusted": the player's hand, as
   * before; "adopted": a newcomer that stayed, followed from now on (its aim
   * and trigger start afresh); "doubted": not trusted yet, treat it as no
   * hand; "none": no hand in the frame.
   */
  judge(hand: Hand | null, now: number): Trust {
    if (!hand) return "none";
    const [x, y] = palm(hand);
    const trusted = this.trusted;
    // A newcomer not seen for a while has gone again.
    const stranger = this.stranger && now - this.stranger.at <= RECENT ? this.stranger : null;
    const near = trusted !== null && Math.hypot(x - trusted.x, y - trusted.y) <= JUMP;
    // The player's hand where it was, or a hand found again after a while
    // with nothing else about: followed as it is.
    if (!trusted || near || (!stranger && now - trusted.at > RECENT)) {
      this.trusted = { at: now, x, y };
      this.stranger = null;
      return "trusted";
    }
    if (!stranger || Math.hypot(x - stranger.x, y - stranger.y) > JUMP) {
      this.stranger = { since: now, at: now, x, y };
      return "doubted";
    }
    stranger.at = now;
    stranger.x = x;
    stranger.y = y;
    if (now - stranger.since < TRUST_AFTER) return "doubted";
    this.trusted = { at: now, x, y };
    this.stranger = null;
    return "adopted";
  }

  reset(): void {
    this.trusted = null;
    this.stranger = null;
  }
}
