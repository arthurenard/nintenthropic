/**
 * One kart's physics: speed, steering and grip, the grass and the barriers,
 * braking and reversing, the hop and drift with their mini-turbos, boost, the
 * start. Nothing here looks at another kart or at the items; the race does
 * (race.ts, items.ts), which is also why `predict` can run just this.
 */
import { TICK, type DriveInput, type RacerSetup } from "../contract";
import { mulberry32 } from "../../engine/rules/rng";
import type { TrackGeometry } from "../track/geometry";
import { clamp, q3, q4, wrapAngle, type BotMemory, type EventBody, type KartState, type World } from "./state";
import { ticks, TUNING } from "./tuning";

const D = TUNING.drive;
const S = TUNING.steer;
const H = TUNING.hop;
const DR = TUNING.drift;
const W = TUNING.wall;

/** The tick the countdown ends at and the race starts: 3 s and half a second of "ready". */
export const GO_TICK = ticks(TUNING.start.countdown + TUNING.start.ready);

export type Emit = (event: EventBody) => void;
export const NO_EMIT: Emit = () => {};

const HOP_TICKS = ticks(H.time);
const REVERSE_TICKS = ticks(D.reverseDelay);
const LEVEL_1 = ticks(DR.level1);
const LEVEL_2 = ticks(DR.level2);
const FLOOD_AFTER = ticks(TUNING.start.floodAfter);
const BOOST_WINDOW = ticks(TUNING.start.boostWindow);

const finite = (v: number): number => (Number.isFinite(v) ? v : 0);

export function newBotMemory(): BotMemory {
  return { presses: 0, wait: 0, stuck: 0, back: 0, next: 0, freeze: 0, steer: 0, drifting: false };
}

/** A kart on the grid: pairs side by side, each pair a little further back, the first on pole. */
export function newKart(racer: RacerSetup, place: number, geo: TrackGeometry): KartState {
  const race = TUNING.race;
  const behind = race.gridFirst + place * race.gridStep;
  const s = geo.wrap(-behind);
  const side = place % 2 === 0 ? -1 : 1;
  const offset = side * race.gridSide * geo.at(s).width;
  const p = geo.point(s, offset);
  const kart: KartState = {
    id: racer.id,
    player: racer.player !== null,
    t: 0,
    x: p.x,
    y: p.y,
    z: p.z,
    heading: geo.heading(s),
    vx: 0,
    vz: 0,
    steer: 0,
    hop: 0,
    drift: 0,
    charge: 0,
    level: 0,
    prevDrift: false,
    boost: 0,
    spin: 0,
    flood: 0,
    stand: 0,
    held: 0,
    item: null,
    uses: 0,
    roll: 0,
    rolled: null,
    presses: 0,
    s,
    offset,
    offroad: false,
    progress: -behind,
    pad: 0,
    wrong: 0,
    wrongWay: false,
    place: place + 1,
    lap: 1,
    lapStart: -1,
    bestLap: null,
    finished: null,
    finalPlace: 0,
    ai: racer.player === null,
    skill: clamp(racer.skill ?? 0.8, 0, 1),
    bot: newBotMemory(),
    band: 1,
  };
  settle(kart);
  return kart;
}

/** Rounds everything the kart keeps to what a snapshot writes, so that state and snapshot never differ. */
export function settle(k: KartState): void {
  k.x = q3(k.x);
  k.y = q3(k.y);
  k.z = q3(k.z);
  k.heading = q4(k.heading);
  k.vx = q3(k.vx);
  k.vz = q3(k.vz);
  k.steer = q3(k.steer);
  k.charge = q3(k.charge);
  k.s = q3(k.s);
  k.offset = q3(k.offset);
  k.progress = q3(k.progress);
}

/** The speed along the heading: negative reversing. */
export function forwardSpeed(k: KartState): number {
  return k.vx * Math.sin(k.heading) + k.vz * Math.cos(k.heading);
}

/** How high the kart is in its hop, metres above the road. */
export function hopHeight(k: KartState): number {
  if (k.hop <= 0) return 0;
  const u = (HOP_TICKS - k.hop) / HOP_TICKS;
  return H.height * 4 * u * (1 - u);
}

/** The steady turn rate share at a speed: nothing at a standstill, full by yawFullAt, a little less at the top. */
function turnShare(speed: number): number {
  const ramp = clamp(speed / S.yawFullAt, 0, 1);
  const topFade = clamp((speed - S.yawFullAt) / (D.topSpeed - S.yawFullAt), 0, 1);
  return ramp * (1 - (1 - S.yawAtTop) * topFade);
}

/** Exposed for the bots, which turn the wheel by how fast they want to come round. */
export function yawRate(steer: number, speed: number): number {
  return steer * S.yawMax * turnShare(Math.abs(speed));
}

/** Brings a velocity down to `limit` m/s if it is over. */
export function capSpeed(k: KartState, limit: number): void {
  const speed = Math.hypot(k.vx, k.vz);
  if (speed > limit) {
    k.vx *= limit / speed;
    k.vz *= limit / speed;
  }
}

export function giveBoost(k: KartState, seconds: number): void {
  k.boost = Math.max(k.boost, ticks(seconds));
}

/** Ends a drift, with the boost its charge earned if `boost`. */
function endDrift(k: KartState, boost: boolean, emit: Emit): void {
  if (boost && k.level > 0) {
    giveBoost(k, k.level === 2 ? DR.boost2 : DR.boost1);
    emit({ type: "boost", kart: k.id, source: "drift", level: k.level });
  }
  k.drift = 0;
  k.charge = 0;
  k.level = 0;
}

/** A hit: spun round, most of the speed gone, no drift, no boost. */
export function spinOut(k: KartState): void {
  k.spin = ticks(TUNING.items.spin);
  k.vx *= TUNING.items.spinSpeedKept;
  k.vz *= TUNING.items.spinSpeedKept;
  k.boost = 0;
  k.hop = 0;
  k.drift = 0;
  k.charge = 0;
  k.level = 0;
}

/**
 * Where the kart is on the track, with the barriers: finds s and offset,
 * stands the kart back inside the barrier if it went through (killing the
 * speed into it), and keeps the lap's progress, the road's height and
 * whether it is on the grass.
 */
export function placeOnTrack(w: World, k: KartState, emit: Emit, report: boolean): void {
  const geo = w.geo;
  const p = geo.project(k.x, k.z, k.s);
  const half = p.sample.width / 2;
  const limit = half + TUNING.barrierGap - TUNING.barrierInset;
  let offset = p.offset;
  if (Math.abs(offset) > limit) {
    const side = offset > 0 ? 1 : -1;
    // The right of the track here, and the way out of the barrier is along it, signed by side.
    const rx = -p.sample.tz * side;
    const rz = p.sample.tx * side;
    const back = Math.abs(offset) - limit;
    k.x -= rx * back;
    k.z -= rz * back;
    offset = side * limit;
    const into = k.vx * rx + k.vz * rz;
    if (into > 0) {
      k.vx -= into * rx;
      k.vz -= into * rz;
      if (into >= W.minHit) {
        k.vx *= W.keep;
        k.vz *= W.keep;
        // Glance off: the nose turns toward the way the kart is now going, rather than into the barrier again.
        if (Math.hypot(k.vx, k.vz) > 1) {
          const going = Math.atan2(k.vx, k.vz);
          k.heading = wrapAngle(k.heading + wrapAngle(going - k.heading) * W.nudge);
        }
        if (report) emit({ type: "wall", kart: k.id, strength: Math.min(1, into / W.fullStrength) });
      } else {
        const scrape = Math.max(0, 1 - W.scrape * TICK);
        k.vx *= scrape;
        k.vz *= scrape;
      }
    }
  }
  k.progress += geo.delta(k.s, p.s);
  k.s = p.s;
  k.offset = offset;
  k.y = p.sample.y;
  k.offroad = Math.abs(offset) > half;
  // The pull of the track's direction, for the wrong-way check.
  const along = Math.sin(k.heading) * p.sample.tx + Math.cos(k.heading) * p.sample.tz;
  const speed = forwardSpeed(k);
  if (along < Math.cos(TUNING.race.wrongAngle) && speed > TUNING.race.wrongSpeed) k.wrong++;
  else k.wrong = 0;
  k.wrongWay = k.wrong >= ticks(TUNING.race.wrongTime);
  // Boost pads.
  let onPad = 0;
  const pads = w.plan.pads;
  for (let i = 0; i < pads.length; i++) {
    const pad = pads[i]!;
    if (Math.abs(geo.delta(pad.s, k.s)) < TUNING.boost.padHalfLength && Math.abs(k.offset - pad.offset) < TUNING.boost.padHalfWidth) {
      onPad = i + 1;
      break;
    }
  }
  if (onPad !== 0 && onPad !== k.pad) {
    giveBoost(k, TUNING.boost.pad);
    emit({ type: "boost", kart: k.id, source: "pad", level: 1 });
  }
  k.pad = onPad;
}

/**
 * Advances one kart by one tick with this input. `emit` hears what happens (a
 * no-op when predicting).
 */
export function stepKart(w: World, k: KartState, input: DriveInput, emit: Emit): void {
  const racing = k.t >= GO_TICK;
  // Inputs can come off the network: anything that is not a number is nothing.
  const steerIn = clamp(finite(input.steer), -1, 1);
  const throttleIn = clamp(finite(input.throttle), 0, 1);
  const brakeIn = clamp(finite(input.brake), 0, 1);
  const driftIn = input.drift === true;

  if (!racing) {
    // Counting down: the kart stands. Remember how long the throttle has been down, for the start.
    k.held = throttleIn > 0.5 && brakeIn < 0.5 ? k.held + 1 : 0;
    k.steer += (steerIn - k.steer) * (1 - Math.exp(-S.response * TICK));
    k.prevDrift = driftIn;
    k.t++;
    settle(k);
    return;
  }
  if (k.t === GO_TICK && k.ai) {
    botStart(w, k, emit);
  } else if (k.t === GO_TICK) {
    if (k.held > FLOOD_AFTER) {
      k.flood = ticks(TUNING.start.flood);
    } else if (k.held > 0 && k.held <= BOOST_WINDOW) {
      giveBoost(k, TUNING.boost.start);
      emit({ type: "boost", kart: k.id, source: "start", level: 1 });
    }
    k.held = 0;
  }

  const sinH = Math.sin(k.heading);
  const cosH = Math.cos(k.heading);
  const fwd = k.vx * sinH + k.vz * cosH;

  if (k.spin > 0) {
    // Spun round: no say in anything until it passes; the kart slides to a halt.
    k.spin--;
    const keep = Math.exp(-D.spinDrag * TICK);
    k.vx *= keep;
    k.vz *= keep;
    k.steer *= 0.8;
    k.prevDrift = driftIn;
    if (k.hop > 0) k.hop--;
    if (k.boost > 0) k.boost--;
  } else {
    // The throttle, unless the engine is flooded.
    let throttle = throttleIn;
    if (k.flood > 0) {
      k.flood--;
      throttle = 0;
    }
    const braking = brakeIn > 0.1 && brakeIn >= throttleIn;

    // Hop, and the drift it starts.
    const rising = driftIn && !k.prevDrift;
    k.prevDrift = driftIn;
    if (k.hop > 0) k.hop--;
    if (rising && k.hop === 0 && k.drift === 0 && fwd > H.minSpeed) k.hop = HOP_TICKS;
    if (k.drift === 0 && k.hop > 0 && driftIn && Math.abs(steerIn) > H.minSteer && fwd > H.minSpeed * 0.8) {
      k.drift = steerIn > 0 ? 1 : -1;
      k.charge = 0;
      k.level = 0;
    }

    let steerTarget = steerIn;
    if (k.drift !== 0) {
      if (!driftIn || brakeIn > DR.endBrake || fwd < DR.minSpeed) {
        // Letting go, or a brake, ends it and gives the boost the charge earned; running out of speed gives nothing.
        endDrift(k, fwd >= DR.minSpeed, emit);
      } else {
        // Always turning into the drift: 0.4 of a full turn with the wheel straightened out, 1.4 with it hard over.
        const own = steerIn * k.drift;
        const turn = DR.steerBase + DR.steerRange * own;
        steerTarget = k.drift * turn;
        if (!k.offroad) {
          const tightness = clamp((turn - 0.4) / 1.0, 0, 1);
          k.charge += DR.rateLoose + (DR.rateTight - DR.rateLoose) * tightness;
          const level = k.charge >= LEVEL_2 ? 2 : k.charge >= LEVEL_1 ? 1 : 0;
          if (level > k.level) {
            k.level = level;
            emit({ type: "drift-level", kart: k.id, level: level as 1 | 2 });
          }
        }
      }
    }
    k.steer += (steerTarget - k.steer) * (1 - Math.exp(-S.response * TICK));

    // Turning: the heading comes round, the velocity follows by the grip.
    k.heading = wrapAngle(k.heading - yawRate(k.steer, fwd) * TICK * (fwd >= 0 ? 1 : -1));
    const sin = Math.sin(k.heading);
    const cos = Math.cos(k.heading);
    let along = k.vx * sin + k.vz * cos;
    let across = -k.vx * cos + k.vz * sin;
    // The grip turns the velocity toward the heading: the speed stays (less a little scrubbed off for the slide), the sideways part becomes forward.
    const grip = k.drift !== 0 ? S.gripDrift : k.offroad ? S.gripOffroad : S.grip;
    const lost = across * (1 - Math.exp(-grip * TICK));
    const speedBefore = Math.hypot(along, across);
    across -= lost;
    const speedAfter = Math.max(0, speedBefore - (1 - S.slideKept) * Math.abs(lost));
    along = Math.sqrt(Math.max(0, speedAfter * speedAfter - across * across)) * (along >= 0 ? 1 : -1);

    // Speeding up, braking, coasting.
    const boosted = k.boost > 0;
    let top = (k.offroad ? D.offroadTop : D.topSpeed) * k.band;
    if (boosted) top *= k.offroad ? D.boostSpeedOffroad : D.boostSpeed;
    if (braking) {
      if (along > 0) along = Math.max(0, along - D.brakeDecel * brakeIn * TICK);
      if (along <= 0) {
        if (along > -D.standstill) k.stand++;
        else k.stand = REVERSE_TICKS;
        if (k.stand >= REVERSE_TICKS) along += ((-D.reverseTop - along) / D.reverseTau) * TICK;
      } else {
        k.stand = 0;
      }
    } else {
      k.stand = 0;
      const drive = boosted ? 1 : throttle;
      if (drive > 0) {
        const tau = boosted ? D.boostTau : D.accelTau;
        if (along < top) along = Math.min(top, along + ((top - along) / tau) * drive * TICK);
      } else {
        const slow = (D.coastDrag + D.coastDragPerSpeed * Math.abs(along)) * TICK;
        along = along > 0 ? Math.max(0, along - slow) : Math.min(0, along + slow);
      }
      if (along > top) along = Math.max(top, along - (k.offroad ? D.offroadDecel : D.overspeedDecel) * TICK);
    }
    if (boosted) k.boost--;

    k.vx = along * sin - across * cos;
    k.vz = along * cos + across * sin;
    capSpeed(k, D.maxSpeed);
  }

  k.x += k.vx * TICK;
  k.z += k.vz * TICK;
  placeOnTrack(w, k, emit, true);
  k.t++;
  settle(k);
}

/**
 * A bot's start: whether it timed the lights, by its skill, from the race's
 * seed and its own number (not the shared generator, so a `predict` of it
 * cannot disturb the draws).
 */
function botStart(w: World, k: KartState, emit: Emit): void {
  const random = mulberry32(w.setup.seed * 31 + k.id * 7919 + 17);
  const timed = random();
  const slipped = random();
  const B = TUNING.bots;
  if (slipped < B.floodChance * (1 - k.skill)) {
    k.flood = ticks(TUNING.start.flood);
  } else if (timed < B.startBoostLow + (B.startBoostHigh - B.startBoostLow) * k.skill * k.skill) {
    giveBoost(k, TUNING.boost.start);
    emit({ type: "boost", kart: k.id, source: "start", level: 1 });
  }
}

/** Karts that touch push apart, the faster shoving harder; says which were moved. */
export function bumpKarts(w: World, emit: Emit, moved: Set<number>): void {
  const karts = w.state.karts;
  const reach = TUNING.kartRadius * 2;
  const B = TUNING.bump;
  for (let i = 0; i < karts.length; i++) {
    const a = karts[i]!;
    for (let j = i + 1; j < karts.length; j++) {
      const b = karts[j]!;
      const dx = a.x - b.x;
      const dz = a.z - b.z;
      const d2 = dx * dx + dz * dz;
      if (d2 >= reach * reach) continue;
      const d = Math.sqrt(d2);
      // The way from b to a; if exactly on top of each other, any way will do.
      const nx = d > 1e-6 ? dx / d : 1;
      const nz = d > 1e-6 ? dz / d : 0;
      const wa = 1 + Math.hypot(a.vx, a.vz) / B.weightPerSpeed;
      const wb = 1 + Math.hypot(b.vx, b.vz) / B.weightPerSpeed;
      const overlap = reach - d;
      const shareA = wb / (wa + wb);
      a.x += nx * overlap * shareA;
      a.z += nz * overlap * shareA;
      b.x -= nx * overlap * (1 - shareA);
      b.z -= nz * overlap * (1 - shareA);
      moved.add(a.id);
      moved.add(b.id);
      const closing = -((a.vx - b.vx) * nx + (a.vz - b.vz) * nz);
      if (closing > 0) {
        const faster = Math.max(Math.hypot(a.vx, a.vz), Math.hypot(b.vx, b.vz));
        const impulse = ((1 + B.restitution) * closing) / (1 / wa + 1 / wb);
        a.vx += (nx * impulse) / wa;
        a.vz += (nz * impulse) / wa;
        b.vx -= (nx * impulse) / wb;
        b.vz -= (nz * impulse) / wb;
        // A shove sends the other kart on, but never faster than the faster of the two had been.
        capSpeed(a, faster);
        capSpeed(b, faster);
        if (closing > B.minReport) emit({ type: "bump", a: a.id, b: b.id, strength: Math.min(1, closing / B.fullStrength) });
      }
    }
  }
}
