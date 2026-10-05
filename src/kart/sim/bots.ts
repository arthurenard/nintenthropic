/**
 * The bots: they drive by producing a DriveInput each tick, exactly what a
 * person's hands would, so a bot is only ever a different source of inputs.
 *
 * A bot follows a racing line that cuts each bend by how tight it is, plus a
 * lane of its own, steering at a point on it a little way ahead (pure
 * pursuit). It carries the speed the line allows, planned once per track
 * (plan.ts: sqrt(a / curvature), braked for in advance), and drifts the long
 * bends. Skill 0..1 scales its top speed, how crisply it steers, and how
 * often it makes a mistake. A gentle rubber band keeps them near the best
 * player.
 */
import { IDLE_INPUT, type DriveInput } from "../contract";
import { GO_TICK, forwardSpeed, yawRate } from "./kart";
import { tableAt } from "./plan";
import { clamp, q3, wrapAngle, type KartState, type World } from "./state";
import { ticks, TUNING } from "./tuning";

const B = TUNING.bots;
const DR = TUNING.drift;

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

/** The speed share a bot can ask of the throttle given where it is against the best player. */
function rubberBand(w: World, k: KartState): number {
  if (w.bestPlayer === null) return 1;
  const gap = k.progress - w.bestPlayer;
  if (gap > B.rubberStart) return 1 - B.easeOff * Math.min(1, (gap - B.rubberStart) / B.rubberSpan);
  if (gap < -B.rubberStart) return 1 + B.push * Math.min(1, (-gap - B.rubberStart) / B.rubberSpan);
  return 1;
}

/** Whether the item the bot holds is worth using now. */
function worthUsing(w: World, k: KartState, fwd: number): boolean {
  const plan = w.plan;
  switch (k.item) {
    case "nitro":
    case "nitro3": {
      // On a straight: the line ahead allows a fast run.
      return k.boost === 0 && fwd > 10 && tableAt(plan, plan.speed, k.s + 45) > 30;
    }
    case "puck": {
      for (const other of w.state.karts) {
        if (other.id === k.id) continue;
        const r = relative(k, other.x, other.z);
        if (r.ahead > 4 && r.ahead < 55 && Math.abs(r.right) < 2.2 + r.ahead * 0.05) return true;
      }
      return false;
    }
    case "seeker":
      return k.place > 1;
    case "slick": {
      for (const other of w.state.karts) {
        if (other.id === k.id) continue;
        const r = relative(k, other.x, other.z);
        if (r.ahead < -3 && r.ahead > -28 && Math.abs(r.right) < 5) return true;
      }
      return false;
    }
    default:
      return false;
  }
}

export function botInput(w: World, k: KartState): DriveInput {
  const m = k.bot;
  if (k.t < GO_TICK) return { ...IDLE_INPUT, itemPresses: m.presses };

  const { geo, plan } = w;
  const fwd = forwardSpeed(k);
  let presses = m.presses;

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
  const room = Math.max(0, half - B.edgeMargin);
  const cut = tableAt(plan, plan.line, sAim);
  const lane = laneOf(k) * B.laneShare * half * (1 - Math.min(1, Math.abs(cut) / Math.max(room, 0.1)));
  let aimOffset = clamp(cut + lane, -room, room);

  // Steer round a slick lying in the way: the aim moves to one side of it.
  if (k.skill > 0.3) {
    for (const slick of w.state.slicks) {
      const ahead = geo.delta(k.s, slick.s);
      if (ahead > 1 && ahead < look + 8 && Math.abs(aimOffset - slick.offset) < B.slickClearance) {
        const wider = aimOffset >= slick.offset ? 1 : -1;
        const side = Math.abs(slick.offset + wider * B.slickClearance) <= room ? wider : -wider;
        aimOffset = clamp(slick.offset + side * B.slickClearance, -room, room);
        break;
      }
    }
  }
  const aim = geo.point(sAim, aimOffset);
  const aimX = aim.x;
  const aimZ = aim.z;

  // Pure pursuit: the turn that would bring the kart onto the aim point, as a wheel angle.
  const dx = aimX - k.x;
  const dz = aimZ - k.z;
  const dist = Math.max(1, Math.hypot(dx, dz));
  const err = wrapAngle(Math.atan2(dx, dz) - k.heading);
  const sine = Math.abs(err) > Math.PI / 2 ? Math.sign(err) : Math.sin(err);
  const speed = Math.max(fwd, 4);
  const wanted = (speed * 2 * sine) / dist;
  const authority = Math.max(0.35, yawRate(1, speed));
  let steer = clamp(-wanted / authority, -1, 1);

  // Mistakes: now and then the bot's attention wanders and the wheel freezes a moment.
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
      if (a > 0.35 + 0.65 * k.skill) m.freeze = ticks(0.35 + 0.5 * b);
    }
  }
  m.steer = q3(steer);

  // Drifting the long bends.
  const bendLength = tableAt(plan, plan.bend, k.s + 6);
  const bendTurn = tableAt(plan, plan.curve, k.s + 6);
  const bendLeft = tableAt(plan, plan.bend, k.s + 2);
  if (m.drifting) {
    const ending = bendLeft < 14 || (k.drift !== 0 && Math.sign(tableAt(plan, plan.curve, k.s + 2)) !== k.drift) || k.spin > 0;
    const failed = k.drift === 0 && k.hop === 0;
    if (ending || failed) m.drifting = false;
  } else if (
    k.skill > 0.35 &&
    k.spin === 0 &&
    !k.offroad &&
    fwd > B.driftMinSpeed &&
    bendLength >= B.driftMinLength &&
    Math.abs(steer) > 0.4 &&
    Math.sign(steer) === Math.sign(bendTurn)
  ) {
    m.drifting = true;
  }
  if (k.drift !== 0) {
    // In a drift the wheel is remapped to 0.4..1.4 of a full turn into it.
    const own = clamp((Math.abs(steer) - DR.steerBase) / DR.steerRange, -1, 1);
    steer = Math.sign(steer) === k.drift ? own * k.drift : -k.drift;
  }

  // Speed: what the line allows ahead, within this bot's top speed.
  const band = rubberBand(w, k);
  const top = (B.topSpeedLow + (B.topSpeedHigh - B.topSpeedLow) * k.skill) * TUNING.drive.topSpeed * (k.boost > 0 ? TUNING.drive.boostSpeed : 1);
  const planned = tableAt(plan, plan.speed, k.s + Math.max(0, fwd) * B.planAhead) * (0.88 + 0.12 * k.skill);
  const target = Math.min(top, planned) * band;
  let throttle = 1;
  let brake = 0;
  if (fwd > target + 1.5 && fwd > 8) {
    throttle = 0;
    brake = clamp((fwd - target) / 8, 0.35, 1);
  } else if (fwd > target) {
    throttle = 0;
  }

  // Items.
  if (k.item === null) {
    m.wait = 0;
  } else if (k.roll === 0) {
    m.wait++;
    const delay = ticks((B.itemWaitSlow + (B.itemWaitFast - B.itemWaitSlow) * k.skill) * (0.7 + (((k.id * 7 + k.presses * 13) % 10) / 10) * 0.6));
    if ((m.wait >= delay && worthUsing(w, k, fwd)) || m.wait >= ticks(B.itemHoldMax)) {
      presses++;
      m.wait = 0;
    }
  }
  m.presses = presses;

  return { steer, throttle, brake, drift: m.drifting, itemPresses: presses };
}
