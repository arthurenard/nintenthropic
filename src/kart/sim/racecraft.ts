/**
 * Racecraft: what a bot does about the karts round it. It catches a kart and
 * picks a side to pass (the inside of a bend coming up, else the side with
 * room), tucking into its slipstream first on a straight; it covers the inside
 * of the next bend from a kart close behind; it leans on a kart beside it (by
 * temperament); and it never drives into the back of one it cannot get by.
 * Every kart is a rival, bot or person, so the bots fight each other too.
 *
 * It only moves the point the bot aims at across the road and caps its speed:
 * the bot still drives by the same wheel and pedals as anyone.
 */
import { forwardSpeed } from "./kart";
import { clamp, type KartState, type World } from "./state";
import { noise, type Style } from "./temperament";
import { TUNING } from "./tuning";
import type { BendNear } from "./variety";

const B = TUNING.bots;

export interface Fight {
  /** Where to aim across the road (metres right of the centre line at the aim point). */
  offset: number;
  /** The most speed to carry now (m/s), or Infinity. */
  cap: number;
  /** Times the speed through the coming bend (a dive up the inside brakes later). */
  pace: number;
  /** The kart it is going after, or -1. */
  attacking: number;
  /** How fast it is catching the kart it is going after (m/s), or 0. */
  closing: number;
  /** The kart it is keeping behind (covering the inside), or -1. */
  defending: number;
  /** Tucked in behind a kart on a straight, in its slipstream. */
  drafting: boolean;
}

/**
 * The fight round kart `k`, which was going to aim at `aim` metres across the
 * road, `look` metres ahead, with `left` and `right` metres of room either
 * side of the centre line there. `bend` is the bend it is in or coming to.
 * `calm` is false beside an open edge, where nobody leans on anybody.
 */
export function racecraft(w: World, k: KartState, style: Style, aim: number, left: number, right: number, look: number, bend: BendNear | null, calm: boolean): Fight {
  const fight: Fight = { offset: aim, cap: Infinity, pace: 1, attacking: -1, closing: 0, defending: -1, drafting: false };
  if (k.spin > 0) return fight;
  const geo = w.geo;
  const seed = w.setup.seed;
  const fwd = forwardSpeed(k);
  const racing = k.finished === null;
  const keen = B.attackRange + B.attackReach * style.attack;
  const range = Math.max(keen, Math.max(0, fwd) * B.attackTime);

  // The kart in the way ahead, the nearest kart close behind, and those alongside.
  let target: KartState | null = null;
  let targetAt = Infinity;
  let chaser: KartState | null = null;
  let chaserAt = -Infinity;
  for (const o of w.state.karts) {
    if (o.id === k.id || o.rescue > 0) continue;
    const ds = geo.delta(k.s, o.s);
    if (ds > 0 && ds < range && ds < targetAt) {
      // In the way: near where this kart will be across the road by the time it gets there.
      const path = k.offset + (aim - k.offset) * clamp(ds / look, 0, 1);
      if (Math.abs(o.offset - path) < B.passGap + 1.2) {
        target = o;
        targetAt = ds;
      }
    } else if (ds <= 0 && ds > -B.defendRange && ds > chaserAt && o.finished === null) {
      chaser = o;
      chaserAt = ds;
    }
  }

  if (target) {
    const theirs = forwardSpeed(target);
    const closing = fwd - theirs;
    const rival = racing && target.finished === null;
    const fits = (offset: number): boolean => offset <= right + 0.3 && offset >= -left - 0.3;
    // Already alongside (its nose by our wheels): stay on the side we are on, or going to (half a second on, sideways).
    const alongside = targetAt < 2 * TUNING.kartRadius + 2.5;
    const road = geo.at(k.s);
    const heading = k.offset + (-k.vx * road.tz + k.vz * road.tx) * 0.5;
    const ours: 1 | -1 = heading >= target.offset ? 1 : -1;
    // How far back it starts going for it: by temperament, and further the faster it is catching up (a kart spun out ahead).
    const reach = Math.max(keen, closing * B.attackTime);
    if ((closing > 0.3 && targetAt < reach) || targetAt < B.followGap + 4) {
      // A bend soon enough to dive into: its start within reach, its apex beyond the kart ahead.
      const dive = bend !== null && bend.toFrom < B.diveReach && bend.toApex > targetAt && !bend.c.open;
      const straight = bend === null || bend.toFrom > targetAt + 40;
      const lined = Math.abs(target.offset - k.offset) < B.draftWidth;
      if (rival && straight && lined && closing < B.draftClosing && targetAt > B.draftPull && targetAt < B.draftFrom && style.attack > 0.3) {
        // Much the same pace: tuck in behind it, in its slipstream, before pulling out.
        fight.offset = aim + (target.offset - aim) * style.attack;
        fight.drafting = true;
        fight.attacking = target.id;
      } else {
        let side: 1 | -1;
        const roomRight = right - target.offset;
        const roomLeft = target.offset + left;
        // Committed to a side once it is off the other's line (or close), so it does not weave; a bend far enough off still calls it inside.
        const committed = alongside || (Math.abs(heading - target.offset) > B.commitWidth && !(dive && targetAt > 15));
        if (committed) side = ours;
        else if (dive) side = bend!.c.dir;
        else if (Math.abs(roomRight - roomLeft) > 1.5) side = roomRight > roomLeft ? 1 : -1;
        else side = noise(seed, k.id, target.id, Math.floor(k.progress / 200)) < 0.5 ? 1 : -1;
        let want = target.offset + side * B.passGap;
        if (!fits(want)) {
          // No room that side. Round the other, if there is room there and it is not alongside already (cutting across its tail).
          const other = target.offset - side * B.passGap;
          if (fits(other) && !alongside) {
            side = side > 0 ? -1 : 1;
            want = other;
          } else {
            // Squeezed out: lift, and drop in behind.
            want = Number.NaN;
            fight.cap = Math.max(0, theirs - B.nudge);
          }
        }
        if (!Number.isNaN(want)) {
          // All the way over by the time it is on the other's tail; the keen start further back.
          const weight = clamp((reach - targetAt) / Math.max(1, reach - B.followGap - 4), 0, 1);
          fight.offset = aim + (want - aim) * weight;
          fight.attacking = target.id;
          fight.closing = Math.max(0, closing);
          // Up the inside of the bend: brakes a little later than it would.
          if (dive && side === bend!.c.dir && rival) fight.pace = 1 + B.diveLunge * style.lunge;
        }
      }
    }
    // About to run into the back of it: closing no faster than a nudge (a harder one from the aggressive), not a ram.
    const room = Math.max(0, targetAt - 2 * TUNING.kartRadius - 0.2);
    if (Math.abs(target.offset - k.offset) < 2 * TUNING.kartRadius && !alongside && targetAt < B.followGap + Math.max(0, closing) ** 2 / (2 * B.followBrake)) {
      const nudge = rival && style.lean > 0.5 ? 2 * B.nudge : B.nudge;
      fight.cap = Math.min(fight.cap, theirs + Math.sqrt(2 * B.followBrake * room) + nudge);
    }
  }

  // Covering the inside of the next bend from a kart close behind (when not busy passing), but not shutting the door on one alongside.
  if (chaser && racing && fight.attacking < 0 && style.defend > 0 && bend !== null && !bend.c.open && chaserAt < -(2 * TUNING.kartRadius + 1.5)) {
    const coming = forwardSpeed(chaser) > fwd - 0.5 || chaserAt > -6;
    if (coming && bend.toFrom > 0 && bend.toFrom < 70 && noise(seed, k.id, chaser.id, bend.pass, bend.index) < style.defend) {
      const inside = bend.c.dir;
      const room = inside > 0 ? right : left;
      const want = inside * Math.max(aim * inside, room * 0.75);
      const weight = clamp((B.defendRange + chaserAt) / (B.defendRange - 4), 0, 1);
      fight.offset = aim + (want - aim) * weight;
      fight.defending = chaser.id;
    }
  }

  // Alongside: lean on it (by temperament, in a fight side by side at much the same pace), or give it room.
  for (const o of w.state.karts) {
    if (o.id === k.id || o.rescue > 0 || o.comet > 0) continue;
    const ds = geo.delta(k.s, o.s);
    const across = o.offset - k.offset;
    if (Math.abs(ds) > 2.8 || Math.abs(across) > 4.2) continue;
    const towards = across >= 0 ? 1 : -1;
    const level = Math.abs(forwardSpeed(o) - fwd) < 3 && o.spin === 0 && o.zap === 0;
    const leans = racing && calm && level && o.finished === null && k.ground !== "ice" && style.lean > 0 && noise(seed, k.id, o.id, Math.floor(k.progress / 50)) < style.lean * B.leanChance;
    if (leans) fight.offset += towards * B.leanIn;
    else if (Math.abs(across) < 2 * TUNING.kartRadius + 0.3) fight.offset -= towards * (2 * TUNING.kartRadius + 0.3 - Math.abs(across)) * 0.8;
  }

  fight.offset = clamp(dodgePucks(w, k, fight.offset), -left, right);
  return fight;
}

/**
 * A puck that will pass within reach in the next second: the bot swerves away
 * from where it will pass (if it sees it: a lottery by skill, settled per puck; a sharp one always does).
 */
function dodgePucks(w: World, k: KartState, offset: number): number {
  for (const puck of w.state.pucks) {
    if (puck.owner === k.id && puck.age < 30) continue;
    if (noise(w.setup.seed, k.id, puck.id, 13) >= 0.1 + 0.9 * k.skill) continue;
    const px = puck.x - k.x;
    const pz = puck.z - k.z;
    const vx = puck.vx - k.vx;
    const vz = puck.vz - k.vz;
    const v2 = vx * vx + vz * vz;
    if (v2 < 1) continue;
    const t = -(px * vx + pz * vz) / v2;
    if (t <= 0 || t > B.puckLook) continue;
    const mx = px + vx * t;
    const mz = pz + vz * t;
    if (Math.hypot(mx, mz) > B.puckClear) continue;
    // Passing to its right: away to the left, and the other way round.
    const right = -mx * Math.cos(k.heading) + mz * Math.sin(k.heading);
    return offset - (right >= 0 ? 1 : -1) * B.puckSwerve;
  }
  return offset;
}
