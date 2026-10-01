/**
 * Finding the men, in plain numbers (no three.js): who gets a mark, where
 * the mark floats and how visible it is, the arrow on the scope's rim, and
 * the words that say where a man is. The game feeds this the valley and the
 * view, and draws what it answers.
 *
 * A man 300 m away is a few pixels tall in the wide view. With Aim Assist on
 * (the Settings switch) a small caret floats over every hostile - never over
 * a civilian or an animal, never over anything it would be wrong to shoot -
 * and the scope's rim has an arrow toward the nearest when none is in the
 * glass. Whoever fires at the player is marked for a moment whatever the
 * switch says, and the spotter's words are the player's always.
 */
import { damageDirection } from "../../../engine/rules/health";
import type { Actor } from "./actors";
import type { Plan, V3 } from "./types";

// --- who gets a mark -----------------------------------------------------------------

export interface Marked {
  id: number;
  /** "last": the last man, not yet found, breathes gently. "shot": he has just fired at the player. */
  pulse: "last" | "shot" | null;
  /** He is in the open now, so the mark follows him; otherwise it stays where he fired from. */
  standing: boolean;
}

export interface MarkInput {
  /** Aim Assist: a mark over every hostile in the open. */
  assist: boolean;
  /** Who has fired at the player lately: marked whatever the switch says. */
  revealed: ReadonlySet<number>;
  /** The last man, once he has gone unfound long enough to be helped (LastOne.pulsing). */
  lastOne: number | null;
}

/**
 * Who is marked. Hostiles only - a civilian, an animal or a man already down
 * is never marked - and never one hidden from sight (in a truck's back, down
 * in his nest). The counter-sniper is found by his glint, so even in the open
 * he is marked only once he has fired at the player or when he is the last
 * man and still not found.
 */
export function whoIsMarked(actors: readonly Actor[], input: MarkInput): Marked[] {
  const out: Marked[] = [];
  for (const a of actors) {
    if (!a.hostile || !a.alive) continue;
    const shot = input.revealed.has(a.id);
    const last = input.assist && input.lastOne === a.id;
    const open = a.shootable;
    const standing = input.assist && open && (a.role !== "sniper" || shot || last);
    if (!(standing || shot || (last && open))) continue;
    out.push({ id: a.id, pulse: shot ? "shot" : last ? "last" : null, standing: open });
  }
  return out;
}

// --- where a mark floats ---------------------------------------------------------------

/** A mark's size and place, in CSS pixels: the gap between a man's head and the caret's tip, the caret's width and height. */
export const MARK_GAP = 10;
export const MARK_W = 15;
export const MARK_H = 9;
/** How far a man reaches down from his head on the screen (3 to 7 px at the valley's ranges). */
const MAN_H = 8;
/** The most a mark floats higher than usual, to clear the men and marks round it. */
const MAX_LIFT = 64;

export interface Head {
  id: number;
  /** The top of his head, in pixels from the view's corner. */
  x: number;
  y: number;
}

/** Where a mark floats relative to its usual place over its man, in pixels. */
export interface Place {
  /** Higher than usual, to clear a man or a mark above. */
  lift: number;
  /** To the side of the man, so that the carets of men standing close spread into a row. */
  shift: number;
}

/** How far apart the carets of men standing side by side are kept: a caret is 15 px across, and a row of them must read as separate marks, not as one zigzag. */
const SPACING = 22;

/**
 * Where each man's mark floats. Men standing close together (a patrol, four
 * walking in a column 3 px apart at 330 m) have their carets spread into a
 * row over them, rather than piled on each other; and a mark that would cover
 * another man (a sentry on the tower above the one at the barrier) or sit on
 * another mark is lifted clear, above. So no mark is ever over a man.
 */
export function placeMarks(heads: readonly Head[]): Map<number, Place> {
  const out = new Map<number, Place>();
  // Side by side, about the same height, carets that would touch: spread them evenly about their middle.
  const shifts = new Map<number, number>();
  let group: Head[] = [];
  const flush = () => {
    if (group.length > 1) {
      const mean = group.reduce((sum, h) => sum + h.x, 0) / group.length;
      group.forEach((h, i) => shifts.set(h.id, mean + (i - (group.length - 1) / 2) * SPACING - h.x));
    }
    group = [];
  };
  for (const h of [...heads].sort((a, b) => a.x - b.x || a.y - b.y)) {
    const prev = group[group.length - 1];
    if (prev && (h.x - prev.x >= SPACING || Math.abs(h.y - prev.y) > MARK_H)) flush();
    group.push(h);
  }
  flush();
  const markX = (h: Head) => h.x + (shifts.get(h.id) ?? 0);
  const placed: { x: number; top: number; bottom: number }[] = [];
  // From the top of the view down, so a mark that rises clears the ones already placed above.
  for (const h of [...heads].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const x = markX(h);
    let lift = 0;
    for (let pass = 0; pass < 8; pass++) {
      const bottom = h.y - MARK_GAP - lift;
      const top = bottom - MARK_H;
      let need = lift;
      for (const o of heads) {
        // Over another man: his head to his feet.
        if (o.id !== h.id && Math.abs(o.x - x) < MARK_W / 2 + 4 && bottom > o.y - 2 && top < o.y + MAN_H) {
          need = Math.max(need, h.y - MARK_GAP - (o.y - 5));
        }
      }
      for (const p of placed) {
        // On another mark.
        if (Math.abs(p.x - x) < MARK_W && bottom > p.top - 2 && top < p.bottom + 2) need = Math.max(need, h.y - MARK_GAP - (p.top - 3));
      }
      if (need <= lift) break;
      lift = need;
    }
    lift = Math.min(MAX_LIFT, lift);
    out.set(h.id, { lift, shift: shifts.get(h.id) ?? 0 });
    const bottom = h.y - MARK_GAP - lift;
    placed.push({ x, top: bottom - MARK_H, bottom });
  }
  return out;
}

/** The distance label's width and height: a small glass pill over the nearest man's caret. */
export const LABEL_W = 58;
export const LABEL_H = 20;

/**
 * How many pixels higher than its own caret the distance label of man `id`
 * floats, so that it clears the marks and men round it: over a close cluster
 * of men it rises above all their carets instead of sitting among them.
 */
export function liftLabel(heads: readonly Head[], places: ReadonlyMap<number, Place>, id: number): number {
  const me = heads.find((h) => h.id === id);
  if (!me) return 0;
  const mine = places.get(id) ?? { lift: 0, shift: 0 };
  // What the label must not cover: the other men, and the other men's carets.
  const hard: { x: number; half: number; top: number; bottom: number }[] = [];
  for (const o of heads) {
    if (o.id === id) continue;
    const there = places.get(o.id) ?? { lift: 0, shift: 0 };
    hard.push({ x: o.x, half: 4, top: o.y - 2, bottom: o.y + MAN_H });
    const bottom = o.y - MARK_GAP - there.lift;
    hard.push({ x: o.x + there.shift, half: MARK_W / 2, top: bottom - MARK_H, bottom });
  }
  const base = MARK_GAP + MARK_H + 4 + mine.lift;
  const x = me.x + mine.shift;
  let extra = 0;
  for (let pass = 0; pass < 8; pass++) {
    const bottom = me.y - base - extra;
    const top = bottom - LABEL_H;
    let need = extra;
    for (const o of hard) {
      if (Math.abs(o.x - x) < LABEL_W / 2 + o.half && bottom > o.top - 1 && top < o.bottom + 1) need = Math.max(need, me.y - base - (o.top - 4));
    }
    if (need <= extra) break;
    extra = need;
  }
  return Math.min(MAX_LIFT, extra);
}

/** A mark fades as the crosshair comes onto its man: gone within this many pixels, whole beyond the other. */
export const FADE_NEAR = 34;
export const FADE_FAR = 110;

/** How visible a mark is (0 to 1) with the crosshair `px` pixels from its man. */
export function fadeNear(px: number): number {
  const t = Math.min(1, Math.max(0, (px - FADE_NEAR) / (FADE_FAR - FADE_NEAR)));
  return t * t * (3 - 2 * t);
}

/** The crosshair is on a man (found, for the spotter) within this many pixels of him. */
export const ON_HIM = 56;

/** Whose mark says how far: the nearest man's, once - never a label on everyone. */
export function nearestOf(men: readonly { id: number; range: number }[]): number | null {
  let best: { id: number; range: number } | null = null;
  for (const m of men) if (!best || m.range < best.range) best = m;
  return best ? best.id : null;
}

// --- the scope's rim -------------------------------------------------------------------

/** A man as the camera sees him: x right, y up, z toward the viewer (negative ahead of it), metres. */
export interface CamMan {
  id: number;
  x: number;
  y: number;
  z: number;
}

export interface Rim {
  /** The man the arrow points toward. */
  id: number;
  /** Radians clockwise from the top of the view: which way to pan. */
  angle: number;
}

/**
 * The scope's help. While any man is inside the glass there is no arrow (the
 * glass shows them). Otherwise an arrow on the rim points toward the man
 * nearest the reticle, so the player knows which way to pan. `focalPx`: how
 * many pixels one unit of tangent is through the lens (half the view's height
 * over tan(fov / 2)); `reachPx`: the glass's reach from the middle.
 */
export function rimArrow(men: readonly CamMan[], focalPx: number, reachPx: number): Rim | null {
  let best: Rim | null = null;
  let nearest = Infinity;
  for (const m of men) {
    if (m.z < 0 && Math.hypot((m.x / -m.z) * focalPx, (m.y / -m.z) * focalPx) < reachPx) return null;
    // Nearest the reticle by the angle off the line of sight (a man behind the view is the farthest).
    const off = Math.atan2(Math.hypot(m.x, m.y), -m.z);
    if (off < nearest) {
      nearest = off;
      best = { id: m.id, angle: Math.atan2(m.x, m.y) };
    }
  }
  return best;
}

// --- where, in plain words -------------------------------------------------------------

export interface Landmark {
  name: string;
  at: V3;
}

/** What a player can see in the valley and would point at: the guard post and its watchtower, the bridge, the farm, the chapel, the dam. */
export function landmarksOf(plan: Plan): Landmark[] {
  const out: Landmark[] = [];
  const tower = plan.posts.find((p) => p.kind === "tower");
  if (tower) out.push({ name: "the watchtower", at: tower.at });
  const post = plan.posts.filter((p) => p.kind !== "tower" && p.kind !== "mortar" && /guard post/.test(p.place));
  if (post.length) {
    const sum = post.reduce((s, p) => ({ x: s.x + p.at.x, y: s.y + p.at.y, z: s.z + p.at.z }), { x: 0, y: 0, z: 0 });
    out.push({ name: "the guard post", at: { x: sum.x / post.length, y: sum.y / post.length, z: sum.z / post.length } });
  }
  out.push({ name: "the bridge", at: plan.bridge });
  out.push({ name: "the farm", at: plan.farm });
  out.push({ name: "the chapel", at: plan.chapel });
  // The dam is long: its jeep end, its middle and its tunnel end are all "the dam".
  for (const i of new Set([0, Math.floor((plan.dam.length - 1) / 2), plan.dam.length - 1])) {
    const at = plan.dam[i];
    if (at) out.push({ name: "the dam", at });
  }
  return out;
}

/** "By" a landmark within this many metres of the man. */
const NEAR_LANDMARK = 70;
/** A landmark names the side only if it is this far across (radians, about 3 degrees)... */
const SEPARATE = 0.05;
/** ... and no further than this (about 35 degrees). */
const ASIDE = 0.6;

/**
 * Where a man is, in the words you would use to point him out across the
 * valley: "by the watchtower, right of the guard post", or, with nothing near
 * him, "between the farm and the bridge". Left and right are the player's.
 * `anchor` names the spot itself when the rules know it better than the
 * landmarks do (the counter-sniper's nest: "in the chapel tower").
 */
export function whereWords(target: V3, eye: V3, yaw: number, landmarks: readonly Landmark[], anchor?: string): string {
  const bearing = (p: V3) => damageDirection(eye, yaw, p);
  const t = bearing(target);
  let near: Landmark | null = null;
  let nearest = Infinity;
  for (const l of landmarks) {
    const d = Math.hypot(l.at.x - target.x, l.at.z - target.z);
    if (d < nearest) {
      nearest = d;
      near = l;
    }
  }
  const close = near !== null && nearest <= NEAR_LANDMARK;
  const by = anchor ?? (close ? `by ${near!.name}` : null);
  if (by) {
    let other: { name: string; b: number } | null = null;
    let gap = Infinity;
    for (const l of landmarks) {
      // Not the one he is by (nor another stretch of it: "by the dam, right of the dam").
      if (close && l.name === near!.name) continue;
      const b = bearing(l.at);
      const d = Math.abs(b - t);
      if (d >= SEPARATE && d <= ASIDE && d < gap) {
        gap = d;
        other = { name: l.name, b };
      }
    }
    return other ? `${by}, ${t < other.b ? "left" : "right"} of ${other.name}` : by;
  }
  const sorted = landmarks.map((l) => ({ name: l.name, b: bearing(l.at) })).sort((a, b) => a.b - b.b);
  const lo = [...sorted].reverse().find((e) => e.b <= t);
  const hi = sorted.find((e) => e.b > t);
  if (lo && hi) return `between ${lo.name} and ${hi.name}`;
  if (hi) return `left of ${hi.name}`;
  if (lo) return `right of ${lo.name}`;
  return "in the valley";
}
