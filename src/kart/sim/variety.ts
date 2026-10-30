/**
 * No two laps alike: how a bot takes each bend this time round (how deep it
 * cuts in, where it brakes, how much speed it carries, whether it drifts),
 * and the mistakes a person makes: running wide, braking too late, missing
 * the apex, a drift that comes to nothing, a wobble on a straight. All of it
 * rolled with `noise` from the race's seed, the kart, the bend and which time
 * round it is, so it is the same however often it is asked, replays exactly,
 * and needs nothing kept between ticks.
 */
import type { Corner } from "./plan";
import { clamp, type KartState, type World } from "./state";
import { noise, type Style } from "./temperament";
import { TUNING } from "./tuning";

const B = TUNING.bots;

/** Salts, so each roll for a bend is its own. */
const ROLL = { cut: 1, brake: 2, pace: 3, skipDrift: 4, mistake: 5, kind: 6, size: 7, wobble: 8, wobbleAt: 9, wobbleLong: 10 } as const;

/** A bend near a kart: the bend, and where it is from the kart (metres along the lap; negative is behind). */
export interface BendNear {
  c: Corner;
  index: number;
  toFrom: number;
  toApex: number;
  toEnd: number;
  /** Which time round the kart is taking it (counted from 0 at the first lap). */
  pass: number;
}

/** The bend that `s` lies in, or the next one after it; null on a track without bends. */
export function bendNear(w: World, k: KartState, s: number): BendNear | null {
  const plan = w.plan;
  if (plan.corners.length === 0) return null;
  const geo = w.geo;
  const index = plan.nextCorner[Math.round(geo.wrap(s) / geo.spacing) % plan.nextCorner.length]!;
  const c = plan.corners[index]!;
  const toFrom = geo.delta(k.s, c.from);
  return {
    c,
    index,
    toFrom,
    toApex: geo.delta(k.s, c.apex),
    toEnd: geo.delta(k.s, c.to),
    pass: Math.round((k.progress + toFrom - c.from) / geo.length),
  };
}

export type Mistake = "wide" | "late" | "apex" | "drift";

/** How a bot takes one bend, one time round. */
export interface Take {
  /** Times the racing line's cut into the bend. */
  cut: number;
  /** Metres later (+) or earlier (-) than the plan that it brakes. */
  brake: number;
  /** Times the speed the plan carries through it. */
  pace: number;
  /** Share of the room toward the outside it runs out to on the way out (0: none). */
  wide: number;
  /** "skip": no drift through it; "short": lets go of the drift too soon. */
  drift: "normal" | "skip" | "short";
  mistake: Mistake | null;
}

/**
 * The bot's mood, -1..1: well ahead of the best player it relaxes (more
 * mistakes), well behind it presses (fewer). 0 when there is no player.
 */
export function mood(w: World, k: KartState): number {
  if (w.bestPlayer === null || k.player) return 0;
  const gap = k.progress - w.bestPlayer;
  const beyond = Math.max(0, Math.abs(gap) - B.rubberStart);
  return Math.sign(gap) * Math.min(1, beyond / B.rubberSpan);
}

export function takeOf(w: World, k: KartState, style: Style, bend: BendNear, feeling: number): Take {
  const roll = (salt: number): number => noise(w.setup.seed, k.id, bend.pass, bend.index, salt);
  const swing = (salt: number): number => roll(salt) * 2 - 1;
  const take: Take = {
    cut: clamp(1 + style.lineJitter * swing(ROLL.cut), 0.35, 1.3),
    brake: style.brakeJitter * swing(ROLL.brake),
    pace: style.corner * (1 + B.paceJitter * swing(ROLL.pace)),
    wide: 0,
    drift: roll(ROLL.skipDrift) < B.driftSkip * (1.2 - k.skill) ? "skip" : "normal",
    mistake: null,
  };
  // No mistakes beside an open edge, on ice, or on a lap of honour.
  if (bend.c.open || bend.c.ice || k.finished !== null) return take;
  const chance = B.mistakeRate * (1 - B.mistakeSkill * k.skill) * style.mistakes * (1 + B.mistakeMood * feeling);
  if (roll(ROLL.mistake) >= chance) return take;
  const kind = roll(ROLL.kind);
  const size = 0.5 + 0.5 * roll(ROLL.size);
  if (kind < 0.35) {
    take.mistake = "wide";
    take.wide = size;
    take.pace *= 1.03;
  } else if (kind < 0.6) {
    take.mistake = "late";
    take.brake += B.lateBrake * size;
    take.pace *= 1 + B.hotPace * size;
    take.wide = 0.5 * size;
  } else if (kind < 0.8) {
    take.mistake = "apex";
    take.cut *= 0.15;
    take.wide = 0.35 * size;
  } else {
    take.mistake = "drift";
    take.drift = take.drift === "skip" ? "skip" : "short";
  }
  return take;
}

/**
 * How far toward the outside a wide exit puts the aim at `sAim`: nothing
 * before the apex, growing to the bend's end, gone 35 m after it.
 */
export function wideness(w: World, bend: BendNear, sAim: number): number {
  const geo = w.geo;
  const pastApex = geo.delta(bend.c.apex, sAim);
  const pastEnd = geo.delta(bend.c.to, sAim);
  if (pastApex < 0 || pastEnd > 35) return 0;
  const inBend = geo.delta(bend.c.apex, bend.c.to);
  if (pastEnd < 0) return inBend > 1 ? clamp(pastApex / inBend, 0, 1) : 1;
  return 1 - pastEnd / 35;
}

/**
 * A wobble on a straight: now and then (by temperament, less with skill) the
 * wheel snakes for a second or two. The extra steer at this point of the race,
 * or 0. `calm` says the road here is fit for one (no open edge, no ramp, no bend, no ice).
 */
export function wobble(w: World, k: KartState, style: Style, calm: boolean): number {
  if (!calm || k.finished !== null) return 0;
  const cell = Math.floor(k.progress / B.wobbleCell);
  const roll = (salt: number): number => noise(w.setup.seed, k.id, cell, 77, salt);
  if (roll(ROLL.wobble) >= B.wobbleRate * (1 - 0.7 * k.skill) * style.mistakes) return 0;
  const start = cell * B.wobbleCell + 15 + 45 * roll(ROLL.wobbleAt);
  const length = 20 + 25 * roll(ROLL.wobbleLong);
  const into = k.progress - start;
  if (into < 0 || into > length) return 0;
  // Two or three swings, fading in and out.
  const envelope = Math.sin((Math.PI * into) / length);
  const size = B.wobbleSteer * (style.temperament === "erratic" ? 1.4 : 1);
  return size * envelope * Math.sin((2 * Math.PI * into) / (length / 2.5));
}
