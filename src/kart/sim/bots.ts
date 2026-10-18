/**
 * The bots: they drive by producing a DriveInput each tick, exactly what a
 * person's hands would, so a bot is only ever a different source of inputs.
 *
 * A bot follows a racing line that cuts each bend by how tight it is, plus a
 * lane of its own, steering at a point on it a little way ahead (pure
 * pursuit). It carries the speed the line allows, planned once per track
 * (plan.ts: sqrt(a / curvature), braked for in advance, slower on ice), and
 * drifts the long bends. Skill 0..1 scales its top speed, how crisply it
 * steers, and how often it makes a mistake. A gentle rubber band keeps them
 * near the best player.
 *
 * The track's features: a bot keeps clear of an open edge (further the
 * gentler it is) and makes no mistakes beside one; takes a ramp straight and,
 * by skill, tricks off it; looks ahead for hazards and goes round or slows
 * for them; with a Nitro in hand and the skill for it, cuts across a verge;
 * and drives off again from where the drone sets it down.
 */
import { IDLE_INPUT, type DriveInput } from "../contract";
import { hazardAt } from "../track/hazards";
import { rocketTarget } from "./items";
import { GO_TICK, forwardSpeed, yawRate } from "./kart";
import { tableAt } from "./plan";
import { clamp, q3, wrapAngle, type KartState, type World } from "./state";
import { isOpen } from "./terrain";
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

/**
 * The rubber band: a bot far ahead of the best player eases off a few per
 * cent, one far behind pushes a few per cent. It scales the speed it plans
 * for and, in the physics, its top speed (kart.ts).
 */
export function rubberBand(w: World, k: KartState): number {
  if (w.bestPlayer === null || k.player) return 1;
  const gap = k.progress - w.bestPlayer;
  if (gap > B.rubberStart) return 1 - B.easeOff * Math.min(1, (gap - B.rubberStart) / B.rubberSpan);
  if (gap < -B.rubberStart) return 1 + B.push * Math.min(1, (-gap - B.rubberStart) / B.rubberSpan);
  return 1;
}

/**
 * A blast clears the air round a bot: a skyrocket coming down on it, a puck
 * or seeker that is not its own close by, or (when `crowd`) a slick or decoy
 * in its path or two karts right beside it. A bot reacts to a threat by
 * its skill, and a sharp one always does.
 */
function blastWanted(w: World, k: KartState, crowd: boolean): boolean {
  const near = TUNING.items.blast.radius - 1;
  const reacts = (id: number): boolean => ((id * 7 + k.id * 13) % 10) / 10 < k.skill + 0.15;
  for (const rocket of w.state.skyrockets) {
    if (rocketTarget(w, rocket.owner)?.id !== k.id) continue;
    const at = w.geo.point(rocket.s, 0);
    if (Math.hypot(at.x - k.x, at.z - k.z) < near && reacts(rocket.id)) return true;
  }
  for (const thing of [...w.state.pucks, ...w.state.seekers]) {
    if (thing.owner !== k.id && Math.hypot(thing.x - k.x, thing.z - k.z) < near && reacts(thing.id)) return true;
  }
  if (!crowd) return false;
  for (const trap of [...w.state.slicks, ...w.state.decoys]) {
    const r = relative(k, trap.x, trap.z);
    if (trap.owner !== k.id && r.ahead > 1 && r.ahead < near && Math.abs(r.right) < 2.6 && reacts(trap.id)) return true;
  }
  let beside = 0;
  for (const other of w.state.karts) {
    if (other.id !== k.id && other.comet === 0 && Math.hypot(other.x - k.x, other.z - k.z) < near - 0.5) beside++;
  }
  return beside >= 2;
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

/** How many karts are ahead of `k` in the race. */
function aheadCount(w: World, k: KartState): number {
  return w.state.karts.filter((other) => other.place < k.place).length;
}

/** Whether the item the bot holds is worth using now. */
function worthUsing(w: World, k: KartState, fwd: number): boolean {
  const plan = w.plan;
  // Nobody is spun out just before a jump over a gap: it would be a fall, not a spin.
  if (nearGap(w, k)) return false;
  switch (k.item) {
    case "nitro":
    case "nitro3": {
      // On a straight: the line ahead allows a fast run.
      return k.boost === 0 && fwd > 10 && tableAt(plan, plan.speed, k.s + 45) > 30;
    }
    case "puck":
    case "puck3": {
      for (const other of w.state.karts) {
        if (other.id === k.id) continue;
        const r = relative(k, other.x, other.z);
        if (r.ahead > 4 && r.ahead < 55 && Math.abs(r.right) < 2.2 + r.ahead * 0.05) return true;
      }
      return false;
    }
    case "seeker":
      return k.place > 1;
    // Behind on a straight, with the road to use it.
    case "comet":
      return k.place > 1 && k.comet === 0 && fwd > 10 && tableAt(plan, plan.speed, k.s + 45) > 30;
    // Well down the field, with a pack to cut through.
    case "storm":
      return aheadCount(w, k) >= 2;
    // It flies to the leader, or to the runner-up when the bot leads: someone still racing.
    case "skyrocket":
      return rocketTarget(w, k.id) !== undefined;
    case "blast":
      return blastWanted(w, k, true);
    case "slick":
    case "decoy": {
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

/** The distance along the lap from `k` to the next ramp's lip, or Infinity. */
function rampAhead(w: World, k: KartState): number {
  let nearest = Infinity;
  for (const ramp of w.plan.terrain.ramps) {
    const d = w.geo.delta(k.s, ramp.s);
    if (d > -6 && d < nearest) nearest = d;
  }
  return nearest;
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

/**
 * Hazards: how much a kart that goes at `speed` along `offset` would run into
 * over the next couple of seconds (metres of overlap with their reach, 0 if
 * it is clear), their positions read from the race's clock.
 */
function hazardTrouble(w: World, k: KartState, now: number, relevant: number[], offset: number, speed: number): number {
  const { geo } = w;
  const hazards = w.plan.terrain.hazards;
  let trouble = 0;
  for (let t = B.hazardStep; t <= B.hazardLook + 1e-9; t += B.hazardStep) {
    // It moves over to the offset as fast as a kart can swing across the road.
    const lateral = k.offset + clamp(offset - k.offset, -B.dodgeRate * t, B.dodgeRate * t);
    const where = geo.point(k.s + speed * t, lateral);
    for (const index of relevant) {
      const hazard = hazards[index]!;
      const pose = hazardAt(geo, hazard, now + t);
      if (!pose.active) continue;
      const clear = hazard.radius + TUNING.kartRadius + B.hazardClear + (1 - k.skill) * 0.8;
      const gap = Math.hypot(pose.x - where.x, pose.z - where.z);
      if (gap < clear) trouble += clear - gap;
    }
  }
  return trouble;
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
  const now = Math.max(0, (k.t - GO_TICK) / 60);
  const base = clamp(aimOffset, -limitLeft, limitRight);
  if (hazardTrouble(w, k, now, relevant, base, speed) === 0) return { offset: aimOffset, speed: 1 };
  let best = { offset: aimOffset, speed: 1 };
  let bestCost = Infinity;
  for (const share of [1, 0.85, 0.7, 0.55]) {
    for (const shift of [0, 2, -2, 4, -4, 6, -6, 8, -8, 11, -11]) {
      const offset = clamp(base + shift, -limitLeft, limitRight);
      const trouble = hazardTrouble(w, k, now, relevant, offset, speed * share);
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

export function botInput(w: World, k: KartState): DriveInput {
  const m = k.bot;
  if (k.t < GO_TICK) return { ...IDLE_INPUT, itemPresses: m.presses };

  const { geo, plan } = w;
  const terrain = plan.terrain;
  const fwd = forwardSpeed(k);
  let presses = m.presses;

  // In the drone's hook: nothing to do.
  if (k.rescue > 0) return { steer: 0, throttle: 1, brake: 0, drift: false, itemPresses: presses };

  // In the air off a ramp: wheel straight along the track, a trick for the keen.
  if (k.flight > 0) {
    m.drifting = false;
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
  const roomLeft = Math.max(0, half - (isOpen(terrain, sAim, -1) ? dropMargin : B.edgeMargin));
  const roomRight = Math.max(0, half - (isOpen(terrain, sAim, 1) ? dropMargin : B.edgeMargin));
  const room = Math.max(0, half - B.edgeMargin);
  const cut = tableAt(plan, plan.line, sAim);
  const lane = laneOf(k) * B.laneShare * half * (1 - Math.min(1, Math.abs(cut) / Math.max(room, 0.1)));
  let aimOffset = clamp(cut + lane, -roomLeft, roomRight);

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
  const dodgeLeft = Math.max(0, half - (isOpen(terrain, sAim, -1) ? dropMargin : B.hazardEdge));
  const dodgeRight = Math.max(0, half - (isOpen(terrain, sAim, 1) ? dropMargin : B.hazardEdge));
  const beforeDodge = aimOffset;
  const dodging = dodge(w, k, fwd, aimOffset, dodgeLeft, dodgeRight);
  aimOffset = dodging.offset;

  // Swinging across the road for a hazard: look nearer, so the wheel goes over harder.
  const swing = Math.abs(dodging.offset - beforeDodge);
  const sSteer = swing > 1.5 ? k.s + clamp(look * (1 - 0.55 * Math.min(1, swing / 6)), 7, look) : sAim;
  let aim = geo.point(sSteer, aimOffset);
  let aimX = aim.x;
  let aimZ = aim.z;

  // A verge cut: with a Nitro in hand and the nerve, straight across the inside of the bend.
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
  } else if (k.skill >= B.cutSkill && plan.cuts.length > 0 && k.spin === 0 && k.ground !== "ice") {
    const nitro = (k.item === "nitro" || k.item === "nitro3") && k.roll === 0;
    if (nitro || k.boost > ticks(1.0)) {
      for (let c = 0; c < plan.cuts.length; c++) {
        const site = plan.cuts[c]!;
        const ahead = geo.delta(k.s, site.from);
        if (ahead < 0 || ahead > B.cutNitroBefore + 8) continue;
        // On the inside already, and not cutting across the road to get there.
        const sideways = (k.x - site.ex) * -site.dz + (k.z - site.ez) * site.dx;
        if (Math.abs(sideways) > 5.5) continue;
        m.cut = c + 1;
        // The Nitro goes on as it leaves the road.
        if (nitro && k.boost === 0) presses++;
        break;
      }
    }
  }

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

  // Mistakes: now and then the bot's attention wanders and the wheel freezes a moment. (Not beside an open edge.)
  const beside = isOpen(terrain, k.s, -1) || isOpen(terrain, k.s, 1) || isOpen(terrain, k.s + 25, -1) || isOpen(terrain, k.s + 25, 1);
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
      if (a > 0.35 + 0.65 * k.skill && !beside && !cutting) m.freeze = ticks(0.35 + 0.5 * b);
    }
  }
  m.steer = q3(steer);

  // Drifting the long bends (not on ice, not into a ramp, not across a verge).
  const bendLength = tableAt(plan, plan.bend, k.s + 6);
  const bendTurn = tableAt(plan, plan.curve, k.s + 6);
  const bendLeft = tableAt(plan, plan.bend, k.s + 2);
  if (m.drifting) {
    const ending = bendLeft < 7 || (k.drift !== 0 && Math.sign(tableAt(plan, plan.curve, k.s + 2)) !== k.drift) || k.spin > 0 || toRamp < 30 || cutting || k.ground === "ice";
    const failed = k.drift === 0 && k.hop === 0;
    if (ending || failed) m.drifting = false;
  } else if (
    k.skill > 0.35 &&
    k.spin === 0 &&
    !k.offroad &&
    k.ground !== "ice" &&
    !cutting &&
    toRamp > 40 &&
    fwd > B.driftMinSpeed &&
    bendLength >= Math.max(B.driftMinLength, fwd * B.driftMinTime) &&
    Math.abs(steer) > 0.34 &&
    Math.sign(steer) === Math.sign(bendTurn) &&
    Math.abs(bendTurn) < B.driftMaxCurvature
  ) {
    m.drifting = true;
  }
  if (k.drift !== 0) {
    // In a drift the wheel is remapped to 0.4..1.4 of a full turn into it.
    const own = clamp((Math.abs(steer) - DR.steerBase) / DR.steerRange, -1, 1);
    steer = Math.sign(steer) === k.drift ? own * k.drift : -k.drift;
  }

  // Speed: what the line allows ahead, within this bot's top speed.
  const band = k.band;
  const top = (B.topSpeedLow + (B.topSpeedHigh - B.topSpeedLow) * k.skill) * TUNING.drive.topSpeed * (k.boost > 0 ? TUNING.drive.boostSpeed : 1);
  const planned = tableAt(plan, plan.speed, k.s + Math.max(0, fwd) * B.planAhead) * (0.88 + 0.12 * k.skill);
  // On a verge cut it goes flat out; a hazard ahead may ask it to ease.
  // Close to a ramp it keeps its speed: a jump needs it, and a slow-down for a hazard is not worth a fall.
  const nearRamp = toRamp < B.rampSpeedNear;
  const target = (cutting || nearRamp ? top : Math.min(top, planned)) * band * (nearRamp ? 1 : dodging.speed);
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
    // A skyrocket about to burst on it, or a puck about to hit it: no waiting for a blast.
    const urgent = k.item === "blast" && blastWanted(w, k, false);
    if (urgent || (m.wait >= delay && worthUsing(w, k, fwd)) || (m.wait >= ticks(B.itemHoldMax) && !nearGap(w, k))) {
      presses++;
      m.wait = 0;
    }
  }
  m.presses = presses;

  return { steer, throttle, brake, drift: m.drifting, itemPresses: presses };
}
