/**
 * The bots: they drive by producing a DriveInput each tick, exactly what a
 * person's hands would, so a bot is only ever a different source of inputs.
 *
 * A bot follows a racing line that cuts each bend by how tight it is, plus a
 * lane of its own that wanders across the road, steering at a point on it a
 * little way ahead (pure pursuit). It carries the speed the line allows,
 * planned once per track (plan.ts: sqrt(a / curvature), braked for in
 * advance, slower on ice), and drifts the long bends. Skill 0..1 scales its
 * top speed, how crisply it steers, and how often it makes a mistake.
 *
 * Each bot is a character (temperament.ts: aggressive, careful or erratic,
 * a mix on every grid) and no lap is like the last (variety.ts: how deep it
 * cuts into each bend, where it brakes, whether it drifts, and its mistakes:
 * running wide, braking late, missing an apex, botching a drift, a wobble).
 * It races the karts round it (racecraft.ts: passing on a side it picks,
 * a slipstream first, covering the inside, leaning on a kart beside it), and
 * uses its item with intent (below). A gentle rubber band keeps them near
 * the best player, never faster than the road allows.
 *
 * The track's features: a bot keeps clear of an open edge (further the
 * gentler it is) and makes no mistakes beside one; takes a ramp straight and,
 * by skill, tricks off it; looks ahead for hazards and goes round or slows
 * for them; with a boost and the nerve for it, cuts across a verge;
 * and drives off again from where the drone sets it down.
 */
import { IDLE_INPUT, TICK, TICK_HZ, type DriveInput } from "../contract";
import type { TrackGeometry } from "../track/geometry";
import { hazardAt, type HazardPose } from "../track/hazards";
import { rocketTarget } from "./items";
import { GO_TICK, courseOf, forwardSpeed, onIce, yawRate } from "./kart";
import { onRoute, steeringRoute } from "./routes";
import { tableAt, type Corner } from "./plan";
import { racecraft, type Fight } from "./racecraft";
import { clamp, q3, wrapAngle, type KartState, type World } from "./state";
import { noise, styleOf, wander, type Style } from "./temperament";
import { isOpen } from "./terrain";
import { ticks, TUNING } from "./tuning";
import { bendNear, mood, takeOf, wideness, wobble, type BendNear, type Take } from "./variety";

const B = TUNING.bots;
const DR = TUNING.drift;
const OUT_TICKS = ticks(B.driftOutTime);

/** A bot's lane, -1..1, spread over the grid by a golden-ratio step so neighbours differ. */
function laneOf(k: KartState): number {
  return ((k.id * 0.618034 + 0.2) % 1) * 2 - 1;
}

/** How far ahead of and to the right of `k` the point (x, z) is. */
function relative(k: KartState, x: number, z: number): { ahead: number; right: number } {
  const dx = x - k.x;
  const dz = z - k.z;
  const sin = Math.sin(k.heading);
  const cos = Math.cos(k.heading);
  return { ahead: dx * sin + dz * cos, right: -dx * cos + dz * sin };
}

/** The share of a top speed a bot of this skill drives at. */
function topShare(k: KartState): number {
  return B.topSpeedLow + (B.topSpeedHigh - B.topSpeedLow) * k.skill;
}

/**
 * The rubber band: a bot far ahead of the best player eases off a few per
 * cent, one far behind pushes a few per cent, but never past the road's own
 * top speed (a sharp bot behind gets no more than any kart has). It scales
 * the speed it plans for and, in the physics, its top speed (kart.ts). With
 * no person on the road (bots alone, or every person home) the middle of the
 * field (the karts still racing, on average) holds it together instead, half
 * as hard.
 */
export function rubberBand(w: World, k: KartState): number {
  if (k.player || k.finished !== null) return 1;
  let anchor = w.bestPlayer;
  let share = 1;
  if (anchor === null) {
    let sum = 0;
    let n = 0;
    for (const o of w.state.karts) {
      if (o.finished !== null) continue;
      sum += o.progress;
      n++;
    }
    if (n < 2) return 1;
    anchor = sum / n;
    share = B.fieldShare;
  }
  const gap = k.progress - anchor;
  if (gap > B.rubberStart) return 1 - share * B.easeOff * (1 - B.easeSkill * k.skill) * Math.min(1, (gap - B.rubberStart) / B.rubberSpan);
  if (gap < -B.rubberStart) return Math.min(1 / topShare(k), 1 + share * B.push * Math.min(1, (-gap - B.rubberStart) / B.rubberSpan));
  return 1;
}

/** Whether the bot sees a threat coming (by skill; a sharp one always does), settled per thing. */
function reacts(k: KartState, id: number): boolean {
  return ((id * 7 + k.id * 13) % 10) / 10 < k.skill + 0.15;
}

/**
 * A threat coming for the bot, within `near` metres: a skyrocket coming down
 * on it, or a puck or seeker not its own, that it sees.
 */
function threatened(w: World, k: KartState, near: number): boolean {
  for (const rocket of w.state.skyrockets) {
    if (rocketTarget(w, rocket.owner)?.id !== k.id) continue;
    const at = w.geo.point(rocket.s, 0);
    if (Math.hypot(at.x - k.x, at.z - k.z) < near && reacts(k, rocket.id)) return true;
  }
  for (const puck of w.state.pucks) {
    if (puck.owner !== k.id && Math.hypot(puck.x - k.x, puck.z - k.z) < near && reacts(k, puck.id)) return true;
  }
  for (const seeker of w.state.seekers) {
    if (seeker.owner !== k.id && Math.hypot(seeker.x - k.x, seeker.z - k.z) < near && reacts(k, seeker.id)) return true;
  }
  return false;
}

/** A slick or decoy (not its own) in the bot's path within `near` metres, that it sees. */
function trapAhead(k: KartState, traps: readonly { id: number; owner: number; x: number; z: number }[], near: number): boolean {
  for (const trap of traps) {
    if (trap.owner === k.id) continue;
    const r = relative(k, trap.x, trap.z);
    if (r.ahead > 1 && r.ahead < near && Math.abs(r.right) < 2.6 && reacts(k, trap.id)) return true;
  }
  return false;
}

/**
 * A blast clears the air round a bot: a skyrocket coming down on it, a puck
 * or seeker that is not its own close by, or (when `crowd`) a slick or decoy
 * in its path or karts right beside it (two, or one for the aggressive). A bot
 * reacts to a threat by its skill, and a sharp one always does.
 */
function blastWanted(w: World, k: KartState, style: Style, crowd: boolean): boolean {
  const near = TUNING.items.blast.radius - 1;
  if (threatened(w, k, near)) return true;
  if (!crowd) return false;
  if (trapAhead(k, w.state.slicks, near) || trapAhead(k, w.state.decoys, near)) return true;
  let beside = 0;
  for (const other of w.state.karts) {
    if (other.id !== k.id && other.comet === 0 && other.finished === null && Math.hypot(other.x - k.x, other.z - k.z) < near - 0.5) beside++;
  }
  return beside >= (style.temperament === "aggressive" ? 1 : 2);
}

/** Whether the item the bot holds would spin someone (itself, or whoever it flies or storms to) just before a jump over a gap. */
function nearGap(w: World, k: KartState): boolean {
  const harm = k.item === "puck" || k.item === "puck3" || k.item === "seeker" || k.item === "slick" || k.item === "decoy" || k.item === "blast";
  if (harm) return gapAhead(w, k) < B.itemGapQuiet;
  if (k.item === "storm") return w.state.karts.some((other) => other.place < k.place && gapAhead(w, other) < B.itemGapQuiet);
  if (k.item === "skyrocket") {
    const target = rocketTarget(w, k.id);
    return target !== undefined && gapAhead(w, target) < B.itemGapQuiet;
  }
  return false;
}

/** How many karts still racing are ahead of `k`. */
function aheadCount(w: World, k: KartState): number {
  return w.state.karts.filter((other) => other.place < k.place && other.finished === null).length;
}

/** The plan's speed this far ahead is a fast run: a straight. */
function straightAhead(w: World, k: KartState, metres: number): boolean {
  return tableAt(w.plan, w.plan.speed, k.s + metres) > 30;
}

/** Out of a bend: past its apex, with the plan's speed rising and a straight to come. */
function bendExit(w: World, k: KartState, bend: BendNear | null): boolean {
  if (!bend || bend.toApex > 0 || bend.toEnd < -30) return false;
  const here = tableAt(w.plan, w.plan.speed, k.s);
  return tableAt(w.plan, w.plan.speed, k.s + 40) > here + 3 && straightAhead(w, k, 60);
}

/** A kart still racing, lined up ahead within `reach` metres, with the road between straight enough for a puck. */
function linedUp(w: World, k: KartState, reach: number, cone: number): boolean {
  const geo = w.geo;
  for (const other of w.state.karts) {
    if (other.id === k.id || other.finished !== null || other.rescue > 0 || other.comet > 0) continue;
    const r = relative(k, other.x, other.z);
    if (r.ahead < 4 || r.ahead > reach || Math.abs(r.right) > cone + r.ahead * 0.04) continue;
    // A puck flies straight: no bend between.
    if (Math.abs(wrapAngle(geo.heading(other.s) - geo.heading(k.s))) < 0.35) return true;
  }
  return false;
}

/** The bot's wish for what it holds, given the fight it is in. */
function worthUsing(w: World, k: KartState, style: Style, fwd: number, fight: Fight, bend: BendNear | null): boolean {
  // Nobody is spun out just before a jump over a gap: it would be a fall, not a spin.
  if (nearGap(w, k)) return false;
  const aggressive = style.temperament === "aggressive";
  const careful = style.temperament === "careful";
  switch (k.item) {
    case "nitro":
    case "nitro3": {
      if (k.boost > 0 || fwd < 10) return false;
      // Out of a bend onto a straight, or a long straight; a pass to finish (not the careful); anywhere at all for the erratic now and then.
      if (bendExit(w, k, bend)) return true;
      if (straightAhead(w, k, careful ? 60 : 45)) return !careful || straightAhead(w, k, 25);
      if (fight.attacking >= 0 && !careful && straightAhead(w, k, 30)) return true;
      return style.temperament === "erratic" && noise(w.setup.seed, k.id, Math.floor(k.progress / 60), 31) < 0.15;
    }
    case "puck":
    case "puck3":
      // Lined up, the road straight between: closer for the careful, further for the aggressive.
      return linedUp(w, k, aggressive ? 60 : careful ? 40 : 50, aggressive ? 2.6 : careful ? 1.8 : 2.2);
    case "seeker": {
      if (k.place <= 1) return false;
      const target = w.state.karts.find((other) => other.place === k.place - 1);
      if (!target || target.comet > 0 || target.finished !== null) return false;
      // It follows the road to the kart one place ahead: the careful wait until it is not far off.
      return !careful || Math.abs(w.geo.delta(k.s, target.s)) < 150;
    }
    // Behind on a straight, with the road to use it; or to dodge something coming for it.
    case "comet":
      if (threatened(w, k, 14)) return true;
      return k.place > 1 && k.comet === 0 && fwd > 10 && straightAhead(w, k, 45);
    // Well down the field, with a pack to cut through.
    case "storm":
      return aheadCount(w, k) >= (careful ? 3 : 2);
    // It flies to the leader, or to the runner-up when the bot leads: someone still racing. The aggressive wait for a crowd round them.
    case "skyrocket": {
      const target = rocketTarget(w, k.id);
      if (!target) return false;
      if (!aggressive || k.bot.wait > ticks(6)) return true;
      const round = w.state.karts.filter((o) => o.id !== target.id && Math.hypot(o.x - target.x, o.z - target.z) < TUNING.items.skyrocket.burstRadius).length;
      return round >= 1;
    }
    case "blast":
      return blastWanted(w, k, style, true);
    case "slick":
    case "decoy": {
      // Dropped where a kart close behind will drive: on its line, near.
      for (const other of w.state.karts) {
        if (other.id === k.id || other.finished !== null) continue;
        const r = relative(k, other.x, other.z);
        if (r.ahead < -3 && r.ahead > (careful ? -20 : -28) && Math.abs(r.right) < (aggressive ? 4 : 3)) return true;
      }
      return false;
    }
    default:
      return false;
  }
}

/** Items a bot may keep in hand as long as it likes: a defence. */
function defensive(k: KartState): boolean {
  return k.item === "slick" || k.item === "decoy" || k.item === "blast";
}

/** The distance along the lap from `k` to the next ramp's lip, or Infinity. */
function rampAhead(w: World, k: KartState): number {
  let nearest = Infinity;
  for (const ramp of w.plan.terrain.ramps) {
    const d = w.geo.delta(k.s, ramp.s);
    if (d > -6 && d < nearest) nearest = d;
  }
  return nearest;
}

/**
 * Whether the bot shakes the wheel now, a moment before the lip of a ramp it
 * can trick off, to kick the jump higher and further: the sharp and the bold
 * (a lottery by skill and temperament, settled by kart, lap and ramp), never
 * the gentle.
 */
function kicks(w: World, k: KartState, style: Style, fwd: number): boolean {
  if (k.prime !== 0 || k.flight > 0 || k.spin > 0 || fwd < TUNING.ramp.minSpeed || k.skill < B.kickSkill) return false;
  const ramps = w.plan.terrain.ramps;
  for (let i = 0; i < ramps.length; i++) {
    const ramp = ramps[i]!;
    const d = w.geo.delta(k.s, ramp.s);
    // Inside the time a shake keeps the kick ready (`ramp.kickBefore`), with some to spare.
    if (!ramp.trick || d <= 0 || d > fwd * TUNING.ramp.kickBefore * 0.6) continue;
    return noise(w.setup.seed, k.id, k.lap, i, 61) < k.skill * style.kick;
  }
  return false;
}

/** The distance along the lap to the lip of the next ramp with a gap beyond it, or Infinity. */
function gapAhead(w: World, k: KartState): number {
  let nearest = Infinity;
  for (const gap of w.plan.terrain.gaps) {
    // A ramp's lip is just before its gap.
    const d = w.geo.delta(k.s, gap.from - 1.5);
    if (d > -20 && d < nearest) nearest = d;
  }
  return nearest;
}

/** The moments a bot looks ahead to for hazards: `hazardStep` apart, out to `hazardLook` seconds. */
export const LOOK_STEPS: number[] = [];
for (let t = B.hazardStep; t <= B.hazardLook + 1e-9; t += B.hazardStep) LOOK_STEPS.push(t);

/**
 * Where the hazards will be at each of those moments, by the race's clock `now`. Every bot, and every place across
 * the road it tries, looks at the same poses, so each hazard's are worked out once a tick, when a bot first looks at
 * it, and not once a bot and a try.
 */
interface HazardLook {
  now: number;
  poses: (HazardPose[] | undefined)[];
}

const looks = new WeakMap<World, HazardLook>();

function hazardPoses(w: World, now: number, index: number): HazardPose[] {
  let look = looks.get(w);
  if (!look) looks.set(w, (look = { now, poses: [] }));
  if (look.now !== now) {
    look.now = now;
    look.poses.length = 0;
  }
  return (look.poses[index] ??= LOOK_STEPS.map((t) => hazardAt(w.geo, w.plan.terrain.hazards[index]!, now + t)));
}

/**
 * Hazards: how much a kart that goes along `offset` would run into over the
 * next couple of seconds (metres of overlap with their reach, 0 if it is
 * clear). `road` is the road at each look-ahead step, `poses` the hazards in
 * question at the same steps, and `clears` how near each may come.
 */
function hazardTrouble(k: KartState, road: Float64Array, poses: readonly HazardPose[][], clears: readonly number[], offset: number): number {
  let trouble = 0;
  for (let step = 0; step < LOOK_STEPS.length; step++) {
    const t = LOOK_STEPS[step]!;
    // It moves over to the offset as fast as a kart can swing across the road.
    const lateral = k.offset + clamp(offset - k.offset, -B.dodgeRate * t, B.dodgeRate * t);
    // The world point that far right of the road there (what `TrackGeometry.point` gives).
    const x = road[4 * step]! - road[4 * step + 3]! * lateral;
    const z = road[4 * step + 1]! + road[4 * step + 2]! * lateral;
    for (let h = 0; h < poses.length; h++) {
      const pose = poses[h]![step]!;
      if (!pose.active) continue;
      const clear = clears[h]!;
      // Plainly clear: no need for the square root.
      const dx = pose.x - x;
      const dz = pose.z - z;
      if (dx * dx + dz * dz > clear * clear * 1.000001) continue;
      const gap = Math.hypot(dx, dz);
      if (gap < clear) trouble += clear - gap;
    }
  }
  return trouble;
}

/** The road at each look-ahead step (x, z, then the direction tx, tz), filled in afresh by every `dodge`. */
const ROAD = new Float64Array(LOOK_STEPS.length * 4);

/**
 * Reads into `into` the road at each look-ahead step for a kart at `s` going `speed` along it: the same whichever place
 * across the road the bot tries. Each is what `geo.at` gives, worked out without making a sample (bots.test.ts holds
 * them equal), since a hazard dodge reads dozens a tick.
 */
export function roadAhead(geo: TrackGeometry, s: number, speed: number, into: Float64Array, metres?: Float64Array): void {
  const samples = geo.samples;
  for (let step = 0; step < LOOK_STEPS.length; step++) {
    if (geo.open) {
      // A branch road clamps at its ends.
      const c = geo.at(s + (metres ? metres[step]! : speed * LOOK_STEPS[step]!));
      into[4 * step] = c.x;
      into[4 * step + 1] = c.z;
      into[4 * step + 2] = c.tx;
      into[4 * step + 3] = c.tz;
      continue;
    }
    const w = geo.wrap(s + (metres ? metres[step]! : speed * LOOK_STEPS[step]!));
    const i = Math.floor(w / geo.spacing) % samples.length;
    const a = samples[i]!;
    const b = samples[(i + 1) % samples.length]!;
    const f = (w - a.s) / geo.spacing;
    const tx = a.tx + (b.tx - a.tx) * f;
    const tz = a.tz + (b.tz - a.tz) * f;
    const t = Math.hypot(tx, tz) || 1;
    into[4 * step] = a.x + (b.x - a.x) * f;
    into[4 * step + 1] = a.z + (b.z - a.z) * f;
    into[4 * step + 2] = tx / t;
    into[4 * step + 3] = tz / t;
  }
}

/** How far (metres) a bot has gone along the road at each look-ahead step when it slows from `speed` to `target`; see `slowing`. */
const SLOWED = new Float64Array(LOOK_STEPS.length);
const SUBSTEP = B.hazardStep / 2;
const DRIVE = TUNING.drive;

/**
 * Where a bot that eases off for a hazard will be at each look-ahead step. It does not drop to the slower speed at once:
 * it holds the whole brake, whose pull builds up as the pedal is held (from the build-up it has now, `stand` ticks) and
 * eases toward the reverse, so the first moments slow it little. A bot planning with an instant change of speed would
 * reach a crossing thing later than it thinks. The kart stops braking within 1.5 m/s of the target, as the drive does.
 */
function slowing(speed: number, target: number, stand: number, into: Float64Array): Float64Array {
  let v = speed;
  let pedal = stand * TICK;
  let at = 0;
  let metres = 0;
  for (let step = 0; step < LOOK_STEPS.length; step++) {
    for (; at < LOOK_STEPS[step]! - 1e-9; at += SUBSTEP) {
      if (v > target + 1.5) {
        pedal = Math.min(pedal + SUBSTEP, DRIVE.brakeRamp * 6);
        const press = DRIVE.brakeFloor + (1 - DRIVE.brakeFloor) * (1 - Math.exp(-pedal / DRIVE.brakeRamp));
        v += (-DRIVE.reverseTop - v) * (1 - Math.exp(-DRIVE.brakeRate * press * SUBSTEP));
      } else {
        pedal = Math.max(0, pedal - SUBSTEP * DRIVE.brakeFade);
        v = Math.max(v, target);
      }
      metres += v * SUBSTEP;
    }
    into[step] = metres;
  }
  return into;
}

/**
 * Round the hazards that are coming: where to aim (shifted sideways if that
 * helps) and how much of its speed to keep (a little slower lets a crossing
 * thing pass). Left alone when nothing is coming or the way is clear. It tries
 * other places across the road first, at the speed it has, and slows only if no
 * place is clear.
 */
function dodge(w: World, k: KartState, fwd: number, aimOffset: number, limitLeft: number, limitRight: number): { offset: number; speed: number } {
  const hazards = w.plan.terrain.hazards;
  if (hazards.length === 0 || k.skill < B.hazardSkill) return { offset: aimOffset, speed: 1 };
  const { geo } = w;
  const speed = Math.max(fwd, 8);
  const reach = speed * B.hazardLook + 24;
  const relevant: number[] = [];
  hazards.forEach((hazard, index) => {
    const ahead = geo.delta(k.s, hazard.at * geo.length);
    const roams = hazard.motion === "roll" ? (hazard.span ?? 0.05) * geo.length : hazard.motion === "orbit" ? (hazard.span ?? 8) * 2 : 0;
    if (ahead > -roams - 10 && ahead < reach) relevant.push(index);
  });
  if (relevant.length === 0) return { offset: aimOffset, speed: 1 };
  const now = Math.max(0, (k.t - GO_TICK) / TICK_HZ);
  // Of those, only the ones that can hit within the look-ahead (a stomper that is up and stays up, an icicle waiting,
  // a cart not yet out: nothing to dodge, and so nothing to try places across the road for).
  const live: number[] = [];
  const poses: HazardPose[][] = [];
  for (const index of relevant) {
    const ahead = hazardPoses(w, now, index);
    if (ahead.some((pose) => pose.active)) {
      live.push(index);
      poses.push(ahead);
    }
  }
  if (live.length === 0) return { offset: aimOffset, speed: 1 };
  const clears = live.map((index) => hazards[index]!.radius + TUNING.kartRadius + B.hazardClear + (1 - k.skill) * 0.8);
  const base = clamp(aimOffset, -limitLeft, limitRight);
  const road = ROAD;
  roadAhead(geo, k.s, speed, road);
  if (hazardTrouble(k, road, poses, clears, base) === 0) return { offset: aimOffset, speed: 1 };
  let best = { offset: aimOffset, speed: 1 };
  let bestCost = Infinity;
  for (const share of [1, 0.85, 0.7, 0.55, 0.4, 0.25]) {
    if (share !== 1) roadAhead(geo, k.s, speed * share, road, slowing(speed, speed * share, k.stand, SLOWED));
    for (const shift of [0, 2, -2, 4, -4, 6, -6, 8, -8, 11, -11]) {
      const offset = clamp(base + shift, -limitLeft, limitRight);
      const trouble = hazardTrouble(k, road, poses, clears, offset);
      const cost = trouble * 100 + Math.abs(offset - aimOffset) + (1 - share) * 12;
      if (cost < bestCost) {
        bestCost = cost;
        best = { offset, speed: share };
      }
    }
    // A clear place at this speed is good enough.
    if (bestCost < 100) break;
  }
  return best;
}

/** Does this bot try a trick off this ramp? A lottery weighted by skill, settled by the kart's number and lap. */
function wantsTrick(k: KartState): boolean {
  return ((k.id * 7 + k.lap * 3) % 10) / 10 < k.skill * (1 - B.trickBase) + B.trickBase * (k.skill > 0.45 ? 1 : 0);
}

/** How much of a bend's own way of being taken applies at `s`: all of it in the bend, fading over 30 m either side. */
function bendWeight(w: World, c: Corner, s: number): number {
  const before = w.geo.delta(s, c.from);
  const after = w.geo.delta(c.to, s);
  if (before > 0) return clamp(1 - before / 30, 0, 1);
  if (after > 0) return clamp(1 - after / 30, 0, 1);
  return 1;
}

export function botInput(world: World, k: KartState): DriveInput {
  const m = k.bot;
  if (k.t < GO_TICK) return { ...IDLE_INPUT, itemPresses: m.presses };

  // The road it steers by: its own, or the branch it has chosen to take (alternate routes, routes.ts).
  const w = onRoute(world, steeringRoute(world, k));
  const { geo, plan } = w;
  const terrain = plan.terrain;
  const fwd = forwardSpeed(k);
  const style = styleOf(w, k);
  const feeling = mood(w, k);
  let presses = m.presses;

  // In the drone's hook: nothing to do.
  if (k.rescue > 0) return { steer: 0, throttle: 1, brake: 0, drift: false, itemPresses: presses };

  // In the air off a ramp: wheel straight along the track, a trick for the keen.
  if (k.flight > 0) {
    m.drifting = false;
    if (k.flight >= 3) {
      // A planned flight (cannon, glide, lip): a glide is steered toward the middle of the road to land on its mark
      // (each bot a little off it, by its number), a cannon along its own lane; a trick for the keen.
      const lane = k.flight === 4 ? ((k.id * 7) % 5 - 2) * 0.35 : clamp(k.offset, -4, 4);
      const aim = geo.point(k.s + 16, lane);
      const toward = wrapAngle(Math.atan2(aim.x - k.x, aim.z - k.z) - k.heading);
      return { steer: clamp(-toward * 2.5, -1, 1), throttle: 1, brake: 0, drift: k.flight === 3 && k.trick === 0 && !k.prevDrift && wantsTrick(k), itemPresses: presses };
    }
    const err = wrapAngle(geo.heading(k.s + 12) - k.heading);
    return { steer: clamp(-err * 2, -1, 1), throttle: 1, brake: 0, drift: k.flight === 2 && k.trick === 0 && !k.prevDrift && wantsTrick(k), itemPresses: presses };
  }

  // Stuck against a barrier or another kart: back up a little, nose toward the way of the track.
  if (m.back > 0) {
    m.back--;
    const err = wrapAngle(geo.heading(k.s) - k.heading);
    return { steer: clamp(err * 2, -1, 1), throttle: 0, brake: 1, drift: false, itemPresses: presses };
  }
  if (k.spin === 0 && k.flood === 0 && Math.abs(fwd) < B.stuckSpeed) m.stuck++;
  else m.stuck = 0;
  if (m.stuck > ticks(B.stuckTime)) {
    m.stuck = 0;
    m.back = ticks(B.backTime);
  }

  // Where to aim: a point on the racing line a little way ahead, with this bot's own lane.
  const look = clamp(B.lookBase + B.lookPerSpeed * Math.max(fwd, 0), B.lookMin, B.lookMax);
  const sAim = k.s + look;
  const half = geo.at(sAim).width / 2;
  // Room to either side, less the usual margin and, beside an open edge, a wider one (wider the gentler the bot).
  const dropMargin = B.edgeMargin + B.dropMargin + B.dropSlack * (1 - k.skill);
  const openLeft = isOpen(terrain, sAim, -1);
  const openRight = isOpen(terrain, sAim, 1);
  const roomLeft = Math.max(0, half - (openLeft ? dropMargin : B.edgeMargin));
  const roomRight = Math.max(0, half - (openRight ? dropMargin : B.edgeMargin));
  const room = Math.max(0, half - B.edgeMargin);
  const beside = isOpen(terrain, k.s, -1) || isOpen(terrain, k.s, 1) || isOpen(terrain, k.s + 25, -1) || isOpen(terrain, k.s + 25, 1);

  // The bend the kart is in or coming to, the one the aim is in or coming to, and the one the aim may be coming out of:
  // how the bot takes each, this time round (each rolled once: they are often the same bend).
  const bendKart = bendNear(w, k, k.s);
  const bendAim = bendNear(w, k, sAim);
  const bendOut = bendNear(w, k, sAim - 35);
  const takeKart = bendKart ? takeOf(w, k, style, bendKart, feeling) : null;
  const takeAim = bendAim ? (bendAim.index === bendKart?.index ? takeKart : takeOf(w, k, style, bendAim, feeling)) : null;
  const takeOut = bendOut && bendOut.index !== bendAim?.index ? (bendOut.index === bendKart?.index ? takeKart : takeOf(w, k, style, bendOut, feeling)) : null;
  let cutShare = 1;
  if (bendAim && takeAim) cutShare += (takeAim.cut - 1) * bendWeight(w, bendAim.c, sAim);
  if (bendOut && takeOut) cutShare += (takeOut.cut - 1) * bendWeight(w, bendOut.c, sAim);
  const cut = tableAt(plan, plan.line, sAim) * cutShare;
  const wandering = clamp(0.45 * laneOf(k) + wander(k.progress, B.laneWander, w.setup.seed, k.id, 5), -1, 1);
  const lane = wandering * B.laneShare * style.laneWidth * half * (1 - Math.min(1, Math.abs(cut) / Math.max(room, 0.1)));
  let aimOffset = clamp(cut + lane, -roomLeft, roomRight);

  // Running wide out of a bend (a mistake): toward the outside edge (a little over it for the erratic), less out of a hairpin.
  const runWide = (bend: BendNear | null, take: Take | null): void => {
    if (!bend || !take || take.wide === 0) return;
    const share = take.wide * wideness(w, bend, sAim) * (bend.c.peak > B.hairpin ? 0.5 : 1);
    if (share <= 0) return;
    const outside = -bend.c.dir;
    const edge = outside * Math.max(0, half - B.wideEdge + B.wideOver * Math.max(0, 2 * style.verge - 1));
    aimOffset += (edge - aimOffset) * share;
  };
  runWide(bendAim, takeAim);
  runWide(bendOut, takeOut);

  // The karts round it: passing, a slipstream, covering the inside, leaning on a neighbour.
  const lineAim = aimOffset;
  const fight = racecraft(w, k, style, aimOffset, roomLeft, roomRight, look, bendKart, !beside);
  aimOffset = fight.offset;

  // A ramp is taken straight on.
  const toRamp = rampAhead(w, k);
  if (toRamp < B.rampStraight + look) aimOffset = clamp(aimOffset, -1.2, 1.2);

  // Steer round a slick lying in the way: the aim moves to one side of it.
  if (k.skill > 0.3) {
    for (const slick of w.state.slicks) {
      const ahead = geo.delta(k.s, slick.s);
      if (ahead > 1 && ahead < look + B.slickNotice && Math.abs(aimOffset - slick.offset) < B.slickClearance) {
        const wider = aimOffset >= slick.offset ? 1 : -1;
        const side = slick.offset + wider * B.slickClearance <= roomRight && slick.offset + wider * B.slickClearance >= -roomLeft ? wider : -wider;
        aimOffset = clamp(slick.offset + side * B.slickClearance, -roomLeft, roomRight);
        break;
      }
    }
  }

  // Hazards coming: round them, or a little slower.
  const dodgeLeft = Math.max(0, half - (openLeft ? dropMargin : B.hazardEdge));
  const dodgeRight = Math.max(0, half - (openRight ? dropMargin : B.hazardEdge));
  const beforeDodge = aimOffset;
  const dodging = dodge(w, k, fwd, aimOffset, dodgeLeft, dodgeRight);
  aimOffset = dodging.offset;

  // Swinging across the road for a hazard, or round a kart it is catching fast: look nearer, so the wheel goes over harder.
  const swing = Math.max(Math.abs(dodging.offset - beforeDodge), fight.closing > 5 ? Math.abs(beforeDodge - lineAim) : 0);
  const sSteer = swing > 1.5 ? k.s + clamp(look * (1 - 0.55 * Math.min(1, swing / 6)), 7, look) : sAim;
  const aim = geo.point(sSteer, aimOffset);
  let aimX = aim.x;
  let aimZ = aim.z;

  // A verge cut: with a boost and the nerve, straight across the inside of the bend.
  let cutting = false;
  if (m.cut > 0) {
    const site = plan.cuts[m.cut - 1];
    if (site) {
      const u = (k.x - site.ex) * site.dx + (k.z - site.ez) * site.dz;
      if (u > site.len - 2 || u < -12) {
        m.cut = 0;
      } else {
        const along = clamp(u + 9, 0, site.len);
        aimX = site.ex + site.dx * along;
        aimZ = site.ez + site.dz * along;
        cutting = true;
      }
    } else {
      m.cut = 0;
    }
  } else if (k.skill >= B.cutSkill - 0.35 * style.verge && plan.cuts.length > 0 && k.spin === 0 && !onIce(w, k)) {
    const nitro = (k.item === "nitro" || k.item === "nitro3") && k.roll === 0;
    // A Nitro in hand, or a boost already going (long enough, or any for the bold).
    if (nitro || k.boost > ticks(style.verge > 0.5 ? 0.6 : 1.0)) {
      for (let c = 0; c < plan.cuts.length; c++) {
        const site = plan.cuts[c]!;
        const ahead = geo.delta(k.s, site.from);
        if (ahead < 0 || ahead > B.cutNitroBefore + 8) continue;
        // On the inside already, and not cutting across the road to get there.
        const sideways = (k.x - site.ex) * -site.dz + (k.z - site.ez) * site.dx;
        if (Math.abs(sideways) > 5.5) continue;
        m.cut = c + 1;
        // The Nitro goes on as it commits to the cut, still on the road a few metres before it.
        if (nitro && k.boost === 0) presses++;
        break;
      }
    }
  }

  // Pure pursuit: the turn that would bring the kart onto the aim point, as a wheel angle. In a slide the nose is off the way
  // the kart goes, so it is the way it goes that is brought round.
  const dx = aimX - k.x;
  const dz = aimZ - k.z;
  const dist = Math.max(1, Math.hypot(dx, dz));
  const err = wrapAngle(Math.atan2(dx, dz) - (k.drift !== 0 ? courseOf(k) : k.heading));
  const sine = Math.abs(err) > Math.PI / 2 ? Math.sign(err) : Math.sin(err);
  const speed = Math.max(fwd, 4);
  const wanted = (speed * 2 * sine) / dist;
  const authority = Math.max(0.35, yawRate(1, speed));
  let steer = clamp(-wanted / authority, -1, 1);

  // Mistakes: now and then the bot's attention wanders and the wheel freezes a moment. (Not beside an open edge.)
  if (m.freeze > 0 && (beside || cutting)) m.freeze = 0;
  if (m.freeze > 0) {
    m.freeze--;
    steer = m.steer;
  } else {
    const react = 0.45 + 0.55 * k.skill;
    steer = m.steer + (steer - m.steer) * react;
    if (m.next > 0) {
      m.next--;
    } else {
      const a = w.rng.next();
      const b = w.rng.next();
      m.next = ticks(4 + 6 * b);
      const lapse = (0.65 - 0.65 * k.skill) * Math.min(1, style.mistakes);
      if (a < lapse && !beside && !cutting) m.freeze = ticks(0.35 + 0.5 * b);
    }
  }
  m.steer = q3(steer);
  // A wobble on a straight (not near an edge, a ramp, a bend or ice).
  const calm = !beside && !cutting && toRamp > 60 && !onIce(w, k) && Math.abs(tableAt(plan, plan.curve, k.s + 10)) < B.driftCurvature;
  steer = clamp(steer + wobble(w, k, style, calm), -1, 1);

  if (k.drift !== 0) {
    // In a drift the wheel is remapped to 0.4..1.4 of a full turn into it, and against it the turn only widens. A bend gentler
    // than that, or one that has turned the other way, is a wheel against the drift: held for a moment, it lets the drift go.
    const own = clamp((Math.abs(steer) - DR.steerBase) / DR.steerRange, -1, 1);
    const given = Math.sign(steer) === k.drift ? own * k.drift : -k.drift;
    m.out = given * k.drift <= -B.driftOut ? m.out + 1 : 0;
    // The whole remap in the hop too: held short of the other way there, a bot steered harder into the drift than its line
    // wanted and met more hazards (a bot's drift is never turned round in the hop: kart.ts, `drift.flip`, is for players).
    steer = given;
  } else {
    m.out = 0;
  }

  // Drifting the long bends (not on ice, not into a ramp, not across a verge), unless it lets this one go by.
  const bendLength = tableAt(plan, plan.bend, k.s + 6);
  const bendTurn = tableAt(plan, plan.curve, k.s + 6);
  const bendLeft = tableAt(plan, plan.bend, k.s + 2);
  if (m.drifting) {
    // A botched drift lets go at the apex, before the charge has come to much.
    const botched = takeKart?.drift === "short" && bendKart !== null && bendKart.toApex < 0;
    // The wheel this drift is being given has been hard against it for a moment: the bend has turned, or is gentler than the
    // slide (a wheel against a drift only widens it now), so the way out is to let go, boost and all.
    const wantsOut = m.out >= OUT_TICKS;
    const ending = wantsOut || bendLeft < 7 || (k.drift !== 0 && Math.sign(tableAt(plan, plan.curve, k.s + 2)) !== k.drift) || k.spin > 0 || toRamp < 30 || cutting || onIce(w, k) || botched;
    const failed = k.drift === 0 && k.hop === 0;
    if (ending || failed) m.drifting = false;
  } else if (
    k.skill > 0.35 &&
    k.spin === 0 &&
    !k.offroad &&
    !onIce(w, k) &&
    !cutting &&
    toRamp > 40 &&
    takeKart?.drift !== "skip" &&
    fwd > B.driftMinSpeed &&
    bendLength >= Math.max(B.driftMinLength, fwd * B.driftMinTime) &&
    Math.abs(steer) > 0.34 + 0.1 * noise(w.setup.seed, k.id, bendKart?.pass ?? 0, bendKart?.index ?? 0, 41) &&
    Math.sign(steer) === Math.sign(bendTurn) &&
    Math.abs(bendTurn) < B.driftMaxCurvature
  ) {
    m.drifting = true;
  }
  // Speed: what the line allows ahead, within this bot's top speed; braking a little earlier or later this time round, and
  // carrying more or less through the bend. A bot pressing to catch the player corners as well as it can.
  const band = k.band;
  const top = topShare(k) * TUNING.drive.topSpeed * (k.boost > 0 ? TUNING.drive.boostSpeed : 1);
  let shift = 0;
  let pace = 1;
  if (bendKart && takeKart) {
    if (bendKart.toApex > 0) shift = takeKart.brake * (bendKart.toFrom > 0 ? 1 : clamp(bendKart.toApex / Math.max(1, bendKart.toApex - bendKart.toFrom), 0, 1));
    if (bendKart.toFrom < 70 && bendKart.toEnd > -10) pace = takeKart.pace * fight.pace;
  }
  const sharp = Math.min(1, k.skill + B.press * Math.max(0, -feeling));
  const planned = tableAt(plan, plan.speed, k.s + Math.max(0, fwd) * B.planAhead - shift) * (0.88 + 0.12 * sharp) * pace;
  // On a verge cut it goes flat out; a hazard ahead may ask it to ease.
  // Close to a ramp it keeps its speed: a jump needs it, and a slow-down for a hazard is not worth a fall.
  const nearRamp = toRamp < B.rampSpeedNear;
  const target = Math.min((cutting || nearRamp ? top : Math.min(top, planned)) * band * (nearRamp ? 1 : dodging.speed), nearRamp ? Infinity : fight.cap);
  let throttle = 1;
  let brake = 0;
  if (fwd > target + 1.5 && fwd > 8) {
    throttle = 0;
    brake = clamp((fwd - target) / 8, 0.35, 1);
    // Easing off for a hazard holds the whole pedal, as `slowing` plans (a light touch builds up too slowly to be there in time).
    if (dodging.speed < 1) brake = 1;
  } else if (fwd > target) {
    throttle = 0;
  }

  // Items.
  if (k.item === null) {
    m.wait = 0;
  } else if (k.roll === 0) {
    m.wait++;
    const delay = ticks(style.patience * (B.itemWaitSlow + (B.itemWaitFast - B.itemWaitSlow) * k.skill) * (0.7 + (((k.id * 7 + k.presses * 13) % 10) / 10) * 0.6));
    // A skyrocket about to burst on it, or a puck about to hit it: no waiting for a blast.
    const urgent = (k.item === "blast" && blastWanted(w, k, style, false)) || (k.item === "comet" && threatened(w, k, 14));
    const held = m.wait >= ticks(B.itemHoldMax * style.holdMax) && !defensive(k);
    if (urgent || (m.wait >= delay && worthUsing(w, k, style, fwd, fight, bendKart)) || (held && !nearGap(w, k))) {
      presses++;
      m.wait = 0;
    }
  }
  m.presses = presses;

  // A shake of the wheel just before a ramp's lip kicks the jump (the sharp and the bold).
  const shakes = k.shakes + (kicks(w, k, style, fwd) ? 1 : 0);

  // A bot braking hard in a drift lets it go first (its boost is still earned): the brake is for the corner ahead.
  if (m.drifting && brake > B.driftBrake) m.drifting = false;

  return { steer, throttle, brake, drift: m.drifting, itemPresses: presses, shakes };
}
