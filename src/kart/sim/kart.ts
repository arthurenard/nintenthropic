/**
 * One kart's physics: speed, steering and grip on whatever it drives over (the
 * road, grass, ice, mud...), hills, the barriers and the open edges, braking
 * and reversing, the hop and the power-slide it starts with their mini-turbos,
 * jumps off ramps and crests and their tricks, falling and the drone that
 * fetches the kart, a track's hazards, boost, the start. Apart from
 * `bumpKarts` and `slipstream`, which the race calls once every kart has
 * moved, nothing here looks at another kart or at the items; the race does
 * (race.ts, items.ts), which is also why `predict` can run `stepKart` alone.
 */
import { TICK, TICK_HZ, type DriveInput, type RacerSetup } from "../contract";
import { WEIGHTS, weightOf, type WeightMods } from "../characters";
import { NO_RULE, type RuleEffects } from "../rules";
import { mulberry32 } from "../../engine/rules/rng";
import { hazardAt, hazardReach } from "../track/hazards";
import type { TrackGeometry } from "../track/geometry";
import { onRoute } from "./routes";
import { clamp, q3, q4, wrapAngle, type BotMemory, type EventBody, type KartState, type World } from "./state";
import { AIR, arcAt, arcHeight, arcLive, arcSlope, type ArcSite } from "./air";
import { barrierDistance, gapAt, groundAt, isOpen, rescueSpot, tableAt, type RampSite } from "./terrain";
import { ticks, TUNING } from "./tuning";

const D = TUNING.drive;
const S = TUNING.steer;
const H = TUNING.hop;
const DR = TUNING.drift;
const W = TUNING.wall;
const R = TUNING.ramp;
const F = TUNING.fall;
const SL = TUNING.slope;
const DRAFT = TUNING.draft;
const GROUND = TUNING.ground;
const I = TUNING.items;

/** The tick the countdown ends at and the race starts: 3 s and half a second of "ready". */
export const GO_TICK = ticks(TUNING.start.countdown + TUNING.start.ready);

export type Emit = (event: EventBody) => void;
export const NO_EMIT: Emit = () => {};

const HOP_TICKS = ticks(H.time);
const BRAKE_FULL = ticks(D.brakeRamp * 6);
const LEVEL_1 = ticks(DR.level1);
const LEVEL_2 = ticks(DR.level2);
const LEVEL_3 = ticks(DR.level3);
const ASK_TICKS = ticks(DR.wheel.ask);
const LAPSE_TICKS = ticks(DR.wheel.lapse);
const FLOOD_AFTER = ticks(TUNING.start.floodAfter);
const BOOST_WINDOW = ticks(TUNING.start.boostWindow);
const RESCUE_TICKS = ticks(F.rescue);
const KICK_BEFORE = ticks(R.kickBefore);
const KICK_AFTER = ticks(R.kickAfter);
/** Ticks in a wake that charge a slipstream's boost. */
export const DRAFT_FULL = ticks(DRAFT.charge);
const DRAFT_REST = ticks(DRAFT.rest);
const DRAFT_COS = Math.cos(DRAFT.angle);

const finite = (v: number): number => (Number.isFinite(v) ? v : 0);

export function newBotMemory(): BotMemory {
  return { presses: 0, wait: 0, stuck: 0, back: 0, next: 0, freeze: 0, steer: 0, drifting: false, cut: 0, out: 0 };
}

/** How the kart drives: its driver's weight class (or the card's), with the card's say in speed, pick-up and grip. */
export function modsFor(racer: Pick<RacerSetup, "character">, rule: Readonly<RuleEffects>): WeightMods {
  const base = WEIGHTS[rule.weight ?? weightOf(racer.character)];
  if (rule.topSpeed === 1 && rule.acceleration === 1 && rule.grip === 1) return base;
  return { ...base, topSpeed: base.topSpeed * rule.topSpeed, acceleration: base.acceleration * rule.acceleration, grip: base.grip * rule.grip };
}

/** A kart on the grid: left and right in turn, each a little further back than the one before, the first on pole. */
export function newKart(racer: RacerSetup, place: number, geo: TrackGeometry, rule: Readonly<RuleEffects> = NO_RULE): KartState {
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
    lapse: 0,
    ask: 0,
    slid: false,
    draft: 0,
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
    route: 0,
    s,
    offset,
    offroad: false,
    rub: false,
    progress: -behind,
    pad: 0,
    ground: "road",
    air: 0,
    vy: 0,
    flight: 0,
    trick: 0,
    aloft: 0,
    shakes: 0,
    prime: 0,
    rescue: 0,
    immune: 0,
    comet: 0,
    zap: 0,
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
    mods: modsFor(racer, rule),
    size: rule.size,
    turn: rule.turn,
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
  k.air = q3(k.air);
  k.vy = q3(k.vy);
}

/**
 * How fast the kart is going, negative when it goes backward (reversing):
 * the whole of its speed, not only the share along its nose, so a kart in a
 * power-slide, its nose 30° off the way it goes, is still going as fast as it is.
 */
export function forwardSpeed(k: KartState): number {
  const speed = Math.sqrt(k.vx * k.vx + k.vz * k.vz);
  return k.vx * Math.sin(k.heading) + k.vz * Math.cos(k.heading) < 0 ? -speed : speed;
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
  const speed = Math.sqrt(k.vx * k.vx + k.vz * k.vz);
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
    giveBoost(k, k.level === 3 ? DR.boost3 : k.level === 2 ? DR.boost2 : DR.boost1);
    emit({ type: "boost", kart: k.id, source: "drift", level: k.level });
  }
  clearDrift(k);
}

/** No drift, and nothing of one left over: its charge, and the open hands' debounce and grace (a new one starts afresh). */
function clearDrift(k: KartState): void {
  k.drift = 0;
  k.charge = 0;
  k.level = 0;
  k.lapse = 0;
  k.ask = 0;
  k.slid = false;
}

/** A hit: spun round, most of the speed gone, no drift, no boost. */
export function spinOut(k: KartState, seconds: number = TUNING.items.spin): void {
  k.spin = ticks(seconds);
  k.vx *= TUNING.items.spinSpeedKept;
  k.vz *= TUNING.items.spinSpeedKept;
  k.boost = 0;
  k.hop = 0;
  clearDrift(k);
}

/**
 * The kart's height above the road for the picture: the jump's, a crest's, or
 * the hop's. It is 0 on the road and up a ramp's wedge (the picture draws the
 * wedge and has the kart climb it, as the sim counts the wedge as road); a jump
 * leaves the lip from the wedge's top, so at the lip it is the wedge's height;
 * and 0 through a rescue (the picture draws the fall and the drone from
 * `rescue` alone).
 */
export function viewHop(k: KartState): number {
  if (k.rescue > 0) return 0;
  if (k.flight > 0) return k.air;
  return k.air + hopHeight(k);
}

/** The way the kart is going, as a heading: its velocity's direction (the heading when it is nearly still). */
export function courseOf(k: KartState): number {
  return Math.sqrt(k.vx * k.vx + k.vz * k.vz) > 0.5 ? Math.atan2(k.vx, k.vz) : k.heading;
}

/** Over the edge, or into a gap: the kart is lost to the drone for a while, and keeps its item. */
function startFall(k: KartState, emit: Emit): void {
  k.rescue = RESCUE_TICKS;
  // It stays where it went over until the drone sets it down.
  k.vx = 0;
  k.vz = 0;
  k.boost = 0;
  k.spin = 0;
  k.hop = 0;
  clearDrift(k);
  k.air = 0;
  k.vy = 0;
  k.flight = 0;
  k.trick = 0;
  k.aloft = 0;
  k.prime = 0;
  k.draft = 0;
  k.pad = 0;
  k.steer = 0;
  emit({ type: "fall", kart: k.id });
}

/**
 * One tick of being rescued. The kart stays where it went over (x, y, z the
 * fall spot, nothing moving: the picture draws it falling, hooked and carried
 * from `rescue` alone) and when the 2.5 s are up it is set down on the centre
 * line a little behind, facing forward, standing still, with a moment when
 * nothing can touch it.
 */
function stepRescue(w: World, k: KartState, emit: Emit): void {
  const geo = w.geo;
  k.rescue--;
  if (k.rescue > 0) return;
  const target = rescueSpot(w.plan.terrain, k.s);
  const landing = geo.at(target);
  k.progress += geo.delta(k.s, target);
  k.s = target;
  k.offset = 0;
  k.x = landing.x;
  k.z = landing.z;
  k.y = landing.y;
  k.heading = geo.heading(target);
  k.vx = 0;
  k.vz = 0;
  k.steer = 0;
  k.hop = 0;
  k.air = 0;
  k.vy = 0;
  k.aloft = 0;
  k.ground = groundAt(w.plan.terrain, target, 0, landing.width / 2);
  k.offroad = GROUND[k.ground].rough;
  k.immune = ticks(F.immune);
  k.wrong = 0;
  k.wrongWay = false;
  k.bot.stuck = 0;
  k.bot.back = 0;
  k.bot.freeze = 0;
  k.bot.cut = 0;
  k.bot.drifting = false;
  k.bot.out = 0;
  emit({ type: "rescued", kart: k.id });
}

/** A kart touching a hazard spins as if hit, and for a moment nothing else can touch it. */
function checkHazards(w: World, k: KartState, emit: Emit): void {
  const hazards = w.plan.terrain.hazards;
  if (hazards.length === 0 || k.immune > 0 || k.spin > 0 || k.air > TUNING.hazard.clearHeight) return;
  const geo = w.geo;
  const time = Math.max(0, (k.t - GO_TICK) / TICK_HZ);
  for (const hazard of hazards) {
    // Far down the road, and not one that roams that far: not worth the working out.
    const reach = hazardReach(hazard, geo.length) + hazard.radius + TUNING.kartRadius + 12;
    if (Math.abs(geo.delta(k.s, hazard.at * geo.length)) > reach) continue;
    const pose = hazardAt(geo, hazard, time);
    if (!pose.active) continue;
    const dx = pose.x - k.x;
    const dz = pose.z - k.z;
    const near = hazard.radius + TUNING.kartRadius;
    if (dx * dx + dz * dz >= near * near) continue;
    spinOut(k);
    k.immune = ticks(TUNING.items.spin + TUNING.hazard.immuneAfter);
    emit({ type: "hazard", kart: k.id, kind: hazard.kind });
    return;
  }
}

/** Is the kart standing at the barrier (where `placeOnTrack` last stood it back), facing into it? */
function noseOnBarrier(w: World, k: KartState): boolean {
  const side = k.offset > 0 ? 1 : -1;
  const terrain = w.plan.terrain;
  if (isOpen(terrain, k.s, side)) return false;
  const c = w.geo.at(k.s);
  if (Math.abs(k.offset) < c.width / 2 + barrierDistance(terrain, k.s, side) - TUNING.barrierInset - 0.05) return false;
  // Facing outward on this side: the kart's nose has some of the track's right (left, for the left barrier) in it.
  return Math.sin(k.heading) * -c.tz * side + Math.cos(k.heading) * c.tx * side > 0;
}

/**
 * Where the kart is on the track, with the barriers: finds s and offset,
 * stands the kart back inside the barrier if it went through (killing the
 * speed into it), and keeps the lap's progress, the road's height and
 * what it is driving on. An open edge has no barrier: over it, or in a gap
 * in the road, a kart on the ground falls.
 */
export function placeOnTrack(world: World, k: KartState, emit: Emit, report: boolean): void {
  const race = world.main ?? world;
  let p = race.geo.project(k.x, k.z, k.s, k.route);
  let half = p.sample.width / 2;
  // Well off the road by the answer near where it was: it may have crossed to another part (over a verge, skipping some road). The whole lap says.
  if (Math.abs(p.offset) > half + 1.5) {
    const elsewhere = race.geo.project(k.x, k.z, undefined, k.route);
    if (Math.abs(elsewhere.offset) < Math.abs(p.offset) - 1.5) {
      p = elsewhere;
      half = p.sample.width / 2;
    }
  }
  k.rub = false;
  // Which road it is on (the main road or a branch): everything after reads that road's own terrain.
  k.route = p.route;
  const w = onRoute(race, k.route);
  const geo = w.geo;
  const terrain = w.plan.terrain;
  let offset = p.offset;
  const side = offset > 0 ? 1 : -1;
  const open = isOpen(terrain, p.s, side);
  const limit = half + barrierDistance(terrain, p.s, side) - TUNING.barrierInset;
  if (!open && Math.abs(offset) > limit) {
    // The right of the track here, and the way out of the barrier is along it, signed by side.
    const rx = -p.sample.tz * side;
    const rz = p.sample.tx * side;
    const back = Math.abs(offset) - limit;
    k.x -= rx * back;
    k.z -= rz * back;
    offset = side * limit;
    const into = k.vx * rx + k.vz * rz;
    if (into > 0) {
      k.rub = true;
      k.vx -= into * rx;
      k.vz -= into * rz;
      if (into >= W.minHit) {
        k.vx *= W.keep;
        k.vz *= W.keep;
        // Glance off: the nose turns toward the way the kart is now going, rather than into the barrier again.
        if (Math.sqrt(k.vx * k.vx + k.vz * k.vz) > 1) {
          const going = Math.atan2(k.vx, k.vz);
          k.heading = wrapAngle(k.heading + wrapAngle(going - k.heading) * W.nudge);
        }
        if (report) emit({ type: "wall", kart: k.id, strength: Math.min(1, into / W.fullStrength) });
      } else {
        // A scrape wears W.scrape m/s off the speed each second, a flat amount and not a share of the speed: a kart
        // brushing the barrier round the outside of a bend touches it on every tick, and keeps its pace.
        const speed = Math.sqrt(k.vx * k.vx + k.vz * k.vz);
        if (speed > 0) {
          const keep = Math.max(0, speed - W.scrape * TICK) / speed;
          k.vx *= keep;
          k.vz *= keep;
        }
      }
    }
  }
  k.progress += geo.delta(k.s, p.s);
  k.s = p.s;
  k.offset = offset;
  // Off the ground the kart keeps its height in the world: what the road under it rose, its height above the road lost.
  if (k.aloft > 0 || k.flight > 0) k.air += k.y - p.sample.y;
  k.y = p.sample.y;
  k.ground = groundAt(terrain, p.s, offset, half);
  k.offroad = GROUND[k.ground].rough;
  // The pull of the track's direction, for the wrong-way check.
  const along = Math.sin(k.heading) * p.sample.tx + Math.cos(k.heading) * p.sample.tz;
  const speed = forwardSpeed(k);
  if (along < Math.cos(TUNING.race.wrongAngle) && speed > TUNING.race.wrongSpeed) k.wrong++;
  else k.wrong = 0;
  k.wrongWay = k.wrong >= ticks(TUNING.race.wrongTime);
  // Boost pads, and the strips that are as pads but long (-1).
  let onPad = 0;
  const pads = w.plan.pads;
  for (let i = 0; i < pads.length; i++) {
    const pad = pads[i]!;
    if (Math.abs(geo.delta(pad.s, k.s)) < TUNING.boost.padHalfLength && Math.abs(k.offset - pad.offset) < TUNING.boost.padHalfWidth) {
      onPad = i + 1;
      break;
    }
  }
  if (onPad === 0 && k.ground === "boost" && k.flight === 0) {
    onPad = -1;
    k.boost = Math.max(k.boost, ticks(TUNING.boost.strip));
  }
  if (onPad !== 0 && onPad !== k.pad) {
    giveBoost(k, TUNING.boost.pad);
    emit({ type: "boost", kart: k.id, source: "pad", level: 1 });
  }
  k.pad = onPad;
  checkFall(w, k, emit);
}

/**
 * Over an open edge or into a gap, on the ground: down it goes. A kart that
 * reached the gap just past a ramp's lip fast without having left the lip (a
 * shove from another kart pushed it over between its own steps) jumps as if it
 * had driven off.
 */
function checkFall(w: World, k: KartState, emit: Emit): void {
  if (k.flight !== 0 || k.rescue !== 0) return;
  const terrain = w.plan.terrain;
  const open = isOpen(terrain, k.s, k.offset > 0 ? 1 : -1);
  const gap = gapAt(terrain, k.s) !== null;
  if (!open && !gap) return;
  const half = w.geo.at(k.s).width / 2;
  const over = open && Math.abs(k.offset) > half + F.edge;
  if (!over && !gap) return;
  if (!over) {
    const along = alongTrack(w, k);
    for (const ramp of terrain.ramps) {
      const past = w.geo.delta(ramp.s, k.s);
      if (past > 0 && past <= 4 && along >= R.minSpeed && Math.abs(k.offset) <= half) {
        launch(w, k, ramp, along, emit);
        return;
      }
    }
  }
  startFall(k, emit);
}

/** The kart's speed along the road (the track's direction where it is): negative going back down it. */
function alongTrack(w: World, k: KartState): number {
  const c = w.geo.at(k.s);
  return k.vx * c.tx + k.vz * c.tz;
}

/**
 * Advances one kart by one tick with this input. `emit` hears what happens (a
 * no-op when predicting).
 */
export function stepKart(world: World, k: KartState, input: DriveInput, emit: Emit): void {
  // Everything below reads the road the kart is on: the main road, or a branch.
  let w = onRoute(world, k.route);
  const racing = k.t >= GO_TICK;
  // Inputs can come off the network: anything that is not a number is nothing.
  const steerIn = clamp(finite(input.steer), -1, 1);
  const throttleIn = clamp(finite(input.throttle), 0, 1);
  const brakeIn = clamp(finite(input.brake), 0, 1);
  const driftIn = input.drift === true;
  // Shakes are a count, as the item presses are: one that went up since the last tick is a shake, whatever packets were lost or repeated.
  const shakes = input.shakes;
  let shook = false;
  if (typeof shakes === "number" && Number.isSafeInteger(shakes) && shakes > k.shakes) {
    k.shakes = shakes;
    shook = racing;
  }

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
      emit({ type: "flood", kart: k.id });
    } else if (k.held > 0 && k.held <= BOOST_WINDOW) {
      giveBoost(k, TUNING.boost.start);
      emit({ type: "boost", kart: k.id, source: "start", level: 1 });
    }
    k.held = 0;
  }

  if (k.rescue > 0) {
    // In the drone's hook: no say in anything.
    k.prevDrift = driftIn;
    stepRescue(w, k, emit);
    k.t++;
    settle(k);
    return;
  }

  const prevS = k.s;
  if (k.comet > 0) {
    // A Comet: nothing touches it, and no storm crawls it.
    k.comet--;
    k.zap = 0;
    k.immune = Math.max(k.immune, 1);
  } else if (k.immune > 0) {
    k.immune--;
  }
  if (k.zap > 0) k.zap--;
  if (k.prime > 0) k.prime--;

  const fwd = forwardSpeed(k);
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
  } else if (k.flight > 0) {
    flyControl(w, k, steerIn, driftIn, shook, emit);
  } else {
    // The wheel's open hands brake, but with a clear turn on at speed they are a drift instead (the throttle stays down),
    // and closing the hands lets it go with its boost. The drift button is the keys' and the pad's own.
    const open = input.slide === true && brakeIn > 0;
    let slide = false;
    if (k.drift !== 0 && (k.slid || open)) {
      // Holding the bend: the hands stay open for the whole of it, whatever the wheel does. A frame or two of the camera
      // reading them as fists is waited out; only a reading gone for the whole of the grace lets the drift go.
      if (open) {
        k.lapse = 0;
        k.slid = true;
      } else if (k.lapse < LAPSE_TICKS) {
        k.lapse++;
      }
      slide = open || k.lapse < LAPSE_TICKS;
    } else if (k.drift === 0 && open && fwd > H.minSpeed && Math.abs(steerIn) > DR.wheel.steer) {
      // Open hands, a clear turn: a drift from the moment it has held for a few ticks. A brake on a straight, or at a crawl,
      // stays a brake; open hands on a straight turned into a bend later become a drift there.
      k.ask++;
      slide = k.ask >= ASK_TICKS;
    } else {
      k.ask = 0;
    }
    drive(w, k, steerIn, slide ? 1 : throttleIn, slide ? 0 : brakeIn, slide || driftIn, slide, shook, fwd, emit);
  }

  // A kart off the ground (in a jump, or skimming a crest) rises and falls; one on it may be thrown off a crest or a lip.
  const grounded = k.aloft === 0 && k.flight === 0;
  k.x += k.vx * TICK;
  k.z += k.vz * TICK;
  placeOnTrack(w, k, emit, true);
  w = onRoute(w, k.route);
  if (k.rescue === 0 && !grounded) fly(w, k, emit);
  else if (k.rescue === 0) overCrest(w, k);
  if (k.rescue === 0 && k.flight === 0) {
    launchOffRamps(w, k, prevS, emit);
    if (k.flight === 0) launchOffArcs(w, k, prevS, emit);
  }
  if (k.rescue === 0) checkHazards(w, k, emit);
  k.t++;
  settle(k);
}

/** The kart is on ice, or on a road made as slippery by Ice Day: the bots then keep out of slides and cuts. */
export function onIce(w: World, k: KartState): boolean {
  return k.ground === "ice" || (w.rule.slippery && k.ground === "road");
}

/**
 * What the kart drives on. Ice Day (rules.ts) makes the road as slippery as ice, for the top speed and the grip both; the
 * verge, the boost strips and the track's own patches keep their ground.
 */
function groundOf(w: World, k: KartState): (typeof GROUND)[keyof typeof GROUND] {
  return w.rule.slippery && k.ground === "road" ? GROUND.ice : GROUND[k.ground];
}

/** On the ground (or skimming a crest): the throttle, the brake, the wheel, the hop and the power-slide, the hills. */
function drive(w: World, k: KartState, steerIn: number, throttleIn: number, brakeIn: number, driftIn: boolean, slide: boolean, shook: boolean, fwd: number, emit: Emit): void {
  // A Comet drives the rough as if it were road.
  const ground = k.comet > 0 && GROUND[k.ground].rough ? GROUND.road : groundOf(w, k);
  // The throttle, unless the engine is flooded.
  let throttle = throttleIn;
  if (k.flood > 0) {
    k.flood--;
    throttle = 0;
  }
  const braking = brakeIn > 0.1 && brakeIn >= throttleIn;
  // A shake on the road does nothing, unless a ramp's lip comes within the moment after it: then it kicks the jump.
  if (shook) k.prime = KICK_BEFORE;

  // Hop, and the drift it starts.
  const rising = driftIn && !k.prevDrift;
  k.prevDrift = driftIn;
  if (k.hop > 0) k.hop--;
  if (rising && k.hop === 0 && k.drift === 0 && fwd > H.minSpeed) k.hop = HOP_TICKS;
  // The direction is the wheel's, as it is on landing: with the button held, the first turn of the wheel (in the hop,
  // after it, or from a straight into a bend with the button still down) starts the drift that way.
  if (k.drift === 0 && driftIn && Math.abs(steerIn) > H.minSteer && fwd > (k.hop > 0 ? H.minSpeed * 0.8 : H.minSpeed)) {
    k.drift = steerIn > 0 ? 1 : -1;
    k.charge = 0;
    k.level = 0;
    k.lapse = 0;
    k.slid = slide;
  } else if (k.drift !== 0 && !k.slid && !k.ai && k.hop > 0 && steerIn * k.drift <= -DR.flip) {
    // Still in the hop, the wheel thrown the other way: that is the way it goes (the open hands' drift keeps the turn that began it).
    // A player's change of mind; a bot picks its side before it hops, and its wheel in a drift is the drift's own (bots.ts).
    k.drift = -k.drift as -1 | 1;
    k.charge = 0;
    k.level = 0;
  }
  // Letting go ends it and gives the boost the charge earned; running out of speed gives nothing. Neither the wheel (held
  // against the slide it only widens the turn) nor the brake ends it: a brake held in a drift just slows the kart.
  if (k.drift !== 0 && (!driftIn || fwd < DR.minSpeed)) endDrift(k, fwd >= DR.minSpeed, emit);

  // Hills: gravity pulls along the road's grade, and a descent just behind raises the top speed while its pace lasts.
  const terrain = w.plan.terrain;
  const c = w.geo.at(k.s);
  const pull = -SL.pull * tableAt(terrain, terrain.grade, k.s) * TICK;
  k.vx += pull * c.tx;
  k.vz += pull * c.tz;
  const onward = k.vx * c.tx + k.vz * c.tz >= 0;
  const downhill = 1 + SL.downTop * tableAt(terrain, onward ? terrain.fallBehind : terrain.fallAhead, k.s);

  const boosted = k.boost > 0;
  let top = ground.top * k.band * k.mods.topSpeed * (k.comet > 0 ? I.comet.speed : k.zap > 0 ? I.storm.speed : 1);
  if (boosted) top = ground.rough ? ground.boostTop * k.band * k.mods.topSpeed : top * D.boostSpeed;
  top *= downhill * (k.draft > 0 && k.draft < DRAFT_FULL ? DRAFT.top : 1);

  // The speed is worked on along a direction: the way the kart is going in a drift, its nose otherwise.
  let sin: number;
  let cos: number;
  let along: number;
  let across: number;
  if (k.drift !== 0) {
    // The power-slide: the kart goes round the way it is going, faster into the drift and slower against it, while
    // its tail swings out until the nose is `slip` inside that. Slippery ground lets it slide on instead of coming round.
    const speed = Math.sqrt(k.vx * k.vx + k.vz * k.vz);
    const own = clamp(steerIn * k.drift, -1, 1);
    const turn = DR.steerBase + DR.steerRange * own;
    const bite = Math.min(1, ground.gripDrift / GROUND.road.gripDrift) * k.mods.grip;
    const was = courseOf(k);
    const course = wrapAngle(was - k.drift * turn * S.yawMax * turnShare(speed) * bite * k.turn * TICK);
    // The nose comes round with the way it goes, and its angle to it eases toward the slip the wheel asks for.
    k.heading = wrapAngle(k.heading + wrapAngle(course - was));
    const nose = course - k.drift * (DR.slip + DR.slipRange * own);
    k.heading = wrapAngle(k.heading + wrapAngle(nose - k.heading) * (1 - Math.exp(-DR.swing * TICK)));
    // The front wheels show the wheel as held, which may be against the slide.
    k.steer += (steerIn - k.steer) * (1 - Math.exp(-S.response * TICK));
    sin = Math.sin(course);
    cos = Math.cos(course);
    along = speed;
    across = 0;
    top *= DR.keep;
    if (!k.offroad) {
      const tightness = clamp((turn - (DR.steerBase - DR.steerRange)) / (2 * DR.steerRange), 0, 1);
      k.charge += DR.rateLoose + (DR.rateTight - DR.rateLoose) * tightness;
      const level = k.charge >= LEVEL_3 ? 3 : k.charge >= LEVEL_2 ? 2 : k.charge >= LEVEL_1 ? 1 : 0;
      if (level > k.level) {
        k.level = level;
        emit({ type: "drift-level", kart: k.id, level: level as 1 | 2 | 3 });
      }
    }
  } else {
    k.steer += (steerIn - k.steer) * (1 - Math.exp(-S.response * TICK));
    // Turning: the heading comes round, the velocity follows by the grip. Nose against the barrier, it comes round as at a
    // walking pace however slow the kart is.
    const turning = throttle > 0 && !braking && fwd < W.pivot && noseOnBarrier(w, k) ? W.pivot : fwd;
    k.heading = wrapAngle(k.heading - yawRate(k.steer, turning) * k.turn * TICK * (turning >= 0 ? 1 : -1));
    // A nose swung far from the way the kart goes (a slide let go, a shove) comes back toward it as the grip takes hold.
    const speed = Math.sqrt(k.vx * k.vx + k.vz * k.vz);
    if (speed > 2 && fwd > 0) {
      const slip = wrapAngle(k.heading - Math.atan2(k.vx, k.vz));
      const excess = Math.abs(slip) - S.slipFree;
      if (excess > 0 && Math.abs(slip) < Math.PI / 2) {
        k.heading = wrapAngle(k.heading - Math.sign(slip) * excess * (1 - Math.exp(-S.align * (ground.grip / GROUND.road.grip) * TICK)));
      }
    }
    sin = Math.sin(k.heading);
    cos = Math.cos(k.heading);
    along = k.vx * sin + k.vz * cos;
    across = -k.vx * cos + k.vz * sin;
    // The grip turns the velocity toward the heading: the speed stays (less a little scrubbed off for the slide), the sideways part becomes forward.
    const grip = ground.grip * k.mods.grip;
    const lost = across * (1 - Math.exp(-grip * TICK));
    const speedBefore = Math.sqrt(along * along + across * across);
    across -= lost;
    const speedAfter = Math.max(0, speedBefore - (1 - S.slideKept) * Math.abs(lost));
    along = Math.sqrt(Math.max(0, speedAfter * speedAfter - across * across)) * (along >= 0 ? 1 : -1);
  }

  // Speeding up, braking, coasting. The brake pulls the speed toward a target below zero (the throttle's share of the top
  // speed, less the reverse), harder the longer it is held: no stop at zero, the kart just carries on backwards.
  if (braking) {
    // Slow or backing up, the pedal is already down: backing up from rest should not wait on the build-up.
    if (along < D.brakeRampBelow) k.stand = BRAKE_FULL;
    else if (k.stand < BRAKE_FULL) k.stand++;
    const press = D.brakeFloor + (1 - D.brakeFloor) * (1 - Math.exp((-k.stand * TICK) / D.brakeRamp));
    const target = (boosted ? 1 : throttle) * top - D.reverseTop * brakeIn;
    if (along > target) {
      along += (target - along) * (1 - Math.exp(-D.brakeRate * ground.brake * brakeIn * press * TICK));
    } else if (throttle > 0 && along < target) {
      along = Math.min(target, along + ((target - along) / (D.accelTau / (ground.accel * k.mods.acceleration))) * throttle * TICK);
    }
  } else {
    k.stand = Math.max(0, k.stand - D.brakeFade);
    const drive = boosted ? 1 : throttle;
    if (drive > 0) {
      const tau = boosted ? D.boostTau : D.accelTau / (ground.accel * k.mods.acceleration);
      if (along < top) along = Math.min(top, along + ((top - along) / tau) * drive * TICK);
    } else {
      const slow = (D.coastDrag + D.coastDragPerSpeed * Math.abs(along)) * ground.coast * TICK;
      along = along > 0 ? Math.max(0, along - slow) : Math.min(0, along + slow);
    }
    if (along > top) along = Math.max(top, along - ground.decel * TICK);
  }
  if (boosted) k.boost--;

  k.vx = along * sin - across * cos;
  k.vz = along * cos + across * sin;
  capSpeed(k, D.maxSpeed * Math.max(1, w.rule.topSpeed));
}

/**
 * In the air: neither pedal does anything; the wheel turns the way the kart
 * flies a little, and its nose swings round to point where it flies (a drift
 * carried over a crest keeps its slide). The hop gesture (drift pressed) or a
 * shake is a trick, once a jump; a shake right after the lip kicks it too.
 */
function flyControl(w: World, k: KartState, steerIn: number, driftIn: boolean, shook: boolean, emit: Emit): void {
  const rising = driftIn && !k.prevDrift;
  k.prevDrift = driftIn;
  if ((k.flight === 2 || k.flight === 3) && k.trick === 0 && (rising || shook)) {
    if (shook && k.flight === 2 && k.aloft <= KICK_AFTER) {
      kick(w, k, emit);
    } else {
      k.trick = 1;
      emit({ type: "trick", kart: k.id });
    }
  }
  if (k.flood > 0) k.flood--;
  k.steer += (steerIn - k.steer) * (1 - Math.exp(-S.response * TICK));
  const planned = k.flight >= 3;
  const turn = k.steer * (k.flight === 4 ? AIR.turnGlide : planned ? AIR.turnCannon : R.airTurn) * TICK;
  k.heading = wrapAngle(k.heading - turn);
  const speed = Math.sqrt(k.vx * k.vx + k.vz * k.vz);
  if (speed > 0.5) {
    let course = wrapAngle(Math.atan2(k.vx, k.vz) - turn);
    // A planned flight follows the road by itself unless the wheel says otherwise.
    if (planned) course = wrapAngle(course + clamp(wrapAngle(w.geo.heading(k.s + AIR.assistLook) - course) * AIR.assist, -1.2, 1.2) * TICK);
    k.vx = speed * Math.sin(course);
    k.vz = speed * Math.cos(course);
    if (k.drift === 0) k.heading = wrapAngle(course + wrapAngle(k.heading - course) * Math.exp(-R.airAlign * TICK));
  }
  if (k.boost > 0) k.boost--;
}

/** A shake at the lip: a trick, and the kart springs off higher and further. */
function kick(w: World, k: KartState, emit: Emit): void {
  k.trick = 1;
  k.prime = -1;
  k.vy += R.kickLift;
  k.vx *= R.kickSpeed;
  k.vz *= R.kickSpeed;
  capSpeed(k, D.maxSpeed * Math.max(1, w.rule.topSpeed));
  emit({ type: "trick", kart: k.id, kick: true });
}

/**
 * Off the ground, up and down: gravity, and a crest's skim that rises high
 * enough becomes a jump. Down on the road again: a trick in the air is worth a
 * boost, unless the kart came down in a gap or over an edge.
 */
function fly(w: World, k: KartState, emit: Emit): void {
  if (k.flight >= 3 && flyArc(w, k, emit)) return;
  k.air += k.vy * TICK;
  k.vy -= R.gravity * TICK;
  if (k.aloft < 255) k.aloft++;
  if (k.trick > 0) k.trick = Math.min(k.trick + 1, 255);
  if (k.flight === 0 && k.air >= R.quiet) {
    k.flight = 2;
    emit({ type: "jump", kart: k.id, crest: true });
  }
  if (k.air > 0 || k.aloft < 2) return;
  // How fast it meets the road: its own fall against the road's rise under it.
  const terrain = w.plan.terrain;
  touchDown(w, k, emit, tableAt(terrain, terrain.grade, k.s) * alongTrack(w, k) - k.vy, false);
}

/**
 * Down on the road: the trick's boost, the landing's event, and the fall if it came down over an edge or in a gap.
 * `onTarget`: a glide that came down close to the road's middle, for its boost.
 */
function touchDown(w: World, k: KartState, emit: Emit, meets: number, onTarget: boolean): void {
  const was = k.flight;
  const tricked = k.trick > 0;
  const kicked = k.prime < 0;
  k.air = 0;
  k.vy = 0;
  k.flight = 0;
  k.trick = 0;
  k.aloft = 0;
  k.prime = 0;
  checkFall(w, k, emit);
  if (was === 0 || k.rescue > 0) return;
  if (tricked) giveBoost(k, kicked ? R.kickBoost : R.trickBoost);
  else if (onTarget) giveBoost(k, AIR.glideBoost);
  emit({ type: "land", kart: k.id, boost: tricked || onTarget, strength: q3(clamp(meets / 10, 0, 1)) });
}

/**
 * A planned flight (a cannon, a glide, a lip): the height is a function of how far along the road the kart has got
 * since the pad (sim/air.ts). Returns false if the kart is somehow outside every flight (then it is an ordinary jump).
 */
function flyArc(w: World, k: KartState, emit: Emit): boolean {
  const terrain = w.plan.terrain;
  const site = arcAt(terrain.arcs, w.geo, k.s);
  if (site === null) {
    k.flight = 2;
    return false;
  }
  // Steered out past an open edge: nothing under it, it falls (as a kart on the ground would).
  if (Math.abs(k.offset) > w.geo.at(k.s).width / 2 + F.edge && isOpen(terrain, k.s, k.offset > 0 ? 1 : -1)) {
    startFall(k, emit);
    return true;
  }
  if (k.aloft < 255) k.aloft++;
  if (k.trick > 0) k.trick = Math.min(k.trick + 1, 255);
  const d = w.geo.delta(site.s, k.s);
  if (d < site.length) {
    // A hit or a spin that robs the kart of its speed in flight must not leave it hanging: the flight carries on at a floor speed.
    const floor = site.kind === "lip" ? AIR.lipFloor : AIR.flightFloor;
    const sp = Math.sqrt(k.vx * k.vx + k.vz * k.vz);
    if (sp < floor) {
      const c = w.geo.at(k.s);
      const nx = sp > 0.5 ? k.vx / sp : c.tx;
      const nz = sp > 0.5 ? k.vz / sp : c.tz;
      k.vx = nx * floor;
      k.vz = nz * floor;
    }
    const air = arcHeight(site, d);
    k.vy = (air - k.air) / TICK;
    k.air = air;
    return true;
  }
  const along = alongTrack(w, k);
  const meets = Math.max(0, -arcSlope(site, site.length - 0.5) * along);
  const glide = k.flight === 4;
  k.air = 0;
  k.vy = 0;
  k.prime = 0;
  touchDown(w, k, emit, meets, glide && Math.abs(k.offset) <= AIR.glideTarget);
  return true;
}

/** A kart that crossed a pad this tick is thrown into its flight. */
function launchOffArcs(w: World, k: KartState, prevS: number, emit: Emit): void {
  const arcs = w.plan.terrain.arcs;
  if (arcs.length === 0 || k.spin > 0) return;
  const half = w.geo.at(k.s).width / 2;
  if (Math.abs(k.offset) > half) return;
  for (let i = 0; i < arcs.length; i++) {
    const site = arcs[i]!;
    const before = w.geo.delta(prevS, site.s);
    const after = w.geo.delta(k.s, site.s);
    if (before <= 0 || after > 0 || before > 8 || k.offset < site.lo || k.offset > site.hi) continue;
    if (site.timed && !arcLive(site, Math.max(0, (k.t - GO_TICK) / TICK_HZ))) continue;
    launchArc(w, k, site, emit);
    return;
  }
}

function launchArc(w: World, k: KartState, site: ArcSite, emit: Emit): void {
  const c = w.geo.at(k.s);
  const along = alongTrack(w, k);
  if (along < (site.kind === "lip" ? AIR.lipMinSpeed : site.kind === "cannon" ? AIR.cannonMinSpeed : AIR.minSpeed)) return;
  if (site.kind === "cannon" && along < AIR.cannonSpeed) {
    // The barrel throws it along the road, fast enough to carry.
    k.vx = c.tx * AIR.cannonSpeed;
    k.vz = c.tz * AIR.cannonSpeed;
  }
  k.flight = site.kind === "glide" ? 4 : 3;
  k.air = 0;
  k.vy = 0;
  k.aloft = 0;
  k.hop = 0;
  k.trick = 0;
  k.prime = 0;
  if (k.drift !== 0) endDrift(k, true, emit);
  emit({ type: "jump", kart: k.id, arc: site.kind });
}

/** Over a crest taken fast the road falls away quicker than gravity can bring the kart down after it: it leaves the road. */
function overCrest(w: World, k: KartState): void {
  const terrain = w.plan.terrain;
  const bow = tableAt(terrain, terrain.crest, k.s);
  if (bow <= 0 || (k.vx * k.vx + k.vz * k.vz) * bow <= R.gravity * R.crest) return;
  const along = alongTrack(w, k);
  if (along * along * bow <= R.gravity * R.crest) return;
  k.aloft = 1;
  k.air = 0;
  k.vy = tableAt(terrain, terrain.grade, k.s) * along;
}

/** A kart that crossed a ramp's lip this tick goes off it. */
function launchOffRamps(w: World, k: KartState, prevS: number, emit: Emit): void {
  const ramps = w.plan.terrain.ramps;
  if (ramps.length === 0) return;
  const half = w.geo.at(k.s).width / 2;
  if (Math.abs(k.offset) > half) return;
  for (const ramp of ramps) {
    const before = w.geo.delta(prevS, ramp.s);
    const after = w.geo.delta(k.s, ramp.s);
    if (before <= 0 || after > 0 || before > 8) continue;
    launch(w, k, ramp, alongTrack(w, k), emit);
    return;
  }
}

/**
 * Off the lip, from the top of the wedge: fast enough, the kart is thrown up
 * into a jump (higher the faster), and a shake just before kicks it further;
 * too slow, it only drops off the end.
 */
function launch(w: World, k: KartState, ramp: RampSite, along: number, emit: Emit): void {
  const terrain = w.plan.terrain;
  const fast = along >= R.minSpeed;
  k.flight = fast && ramp.trick ? 2 : 1;
  k.air = ramp.height;
  k.vy = tableAt(terrain, terrain.grade, k.s) * along + (fast ? ramp.lift * R.launch * clamp(along / D.topSpeed, R.minShare, R.maxShare) : 0);
  k.aloft = 0;
  k.hop = 0;
  k.trick = 0;
  if (k.drift !== 0) endDrift(k, true, emit);
  const primed = k.prime > 0;
  k.prime = 0;
  if (!fast) return;
  emit({ type: "jump", kart: k.id });
  if (primed && ramp.trick && k.spin === 0) kick(w, k, emit);
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
    emit({ type: "flood", kart: k.id });
  } else if (timed < B.startBoostLow + (B.startBoostHigh - B.startBoostLow) * k.skill * k.skill) {
    giveBoost(k, TUNING.boost.start);
    emit({ type: "boost", kart: k.id, source: "start", level: 1 });
  }
}

/** Karts that touch push apart, the faster shoving harder; says which were moved. */
export function bumpKarts(w: World, emit: Emit, moved: Set<number>): void {
  const karts = w.state.karts;
  const B = TUNING.bump;
  for (let i = 0; i < karts.length; i++) {
    const a = karts[i]!;
    if (a.rescue > 0) continue;
    for (let j = i + 1; j < karts.length; j++) {
      const b = karts[j]!;
      // Karts in the drone's hook touch nothing, and one flying over another passes above it.
      if (b.rescue > 0 || Math.abs(a.air - b.air) > TUNING.ramp.passOver) continue;
      // A Comet and a kart that is not one pass through (the Comet spins it: items.ts).
      if ((a.comet > 0) !== (b.comet > 0)) continue;
      const dx = a.x - b.x;
      const dz = a.z - b.z;
      const d2 = dx * dx + dz * dz;
      // Two karts touch when their circles do (a Tiny Kart's is smaller).
      const reach = TUNING.kartRadius * (a.size + b.size);
      if (d2 >= reach * reach) continue;
      const d = Math.sqrt(d2);
      // The way from b to a; if exactly on top of each other, any way will do.
      const nx = d > 1e-6 ? dx / d : 1;
      const nz = d > 1e-6 ? dz / d : 0;
      // A heavy driver is hard to shove (its mass counts for more); a light one is knocked about.
      const wa = (1 + Math.sqrt(a.vx * a.vx + a.vz * a.vz) / B.weightPerSpeed) / a.mods.shoved;
      const wb = (1 + Math.sqrt(b.vx * b.vx + b.vz * b.vz) / B.weightPerSpeed) / b.mods.shoved;
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
        const faster = Math.max(Math.sqrt(a.vx * a.vx + a.vz * a.vz), Math.sqrt(b.vx * b.vx + b.vz * b.vz));
        const impulse = ((1 + B.restitution) * closing) / (1 / wa + 1 / wb);
        shove(a, nx, nz, impulse / wa);
        shove(b, -nx, -nz, impulse / wb);
        // A shove sends the other kart on, but never faster than the faster of the two had been.
        capSpeed(a, faster);
        capSpeed(b, faster);
        if (closing > B.minReport) emit({ type: "bump", a: a.id, b: b.id, strength: Math.min(1, closing / B.fullStrength) });
      }
    }
  }
}

/**
 * A kart shoved `dv` m/s along (nx, nz) by another touching it from the other
 * side: it is sent that way, and a shove off its middle turns it (one clipped
 * at the tail swings its nose the other way).
 */
function shove(k: KartState, nx: number, nz: number, dv: number): void {
  k.vx += nx * dv;
  k.vz += nz * dv;
  const sin = Math.sin(k.heading);
  const cos = Math.cos(k.heading);
  // Where it was touched, metres ahead of its middle (the other kart is the other way from n), and how much of the shove was sideways (+ to its right).
  const ahead = -(nx * sin + nz * cos) * TUNING.kartRadius;
  const sideways = (-nx * cos + nz * sin) * dv;
  const B = TUNING.bump;
  k.heading = wrapAngle(k.heading - clamp(B.yaw * ahead * sideways, -B.maxYaw, B.maxYaw));
}

/**
 * The slipstream: a kart close behind another on its line, both going the
 * same way at speed, charges; once charged it is flung out with a boost. Called
 * by the race once every kart has moved (a guest's prediction leaves it to the
 * host, as it does the bumps).
 */
export function slipstream(w: World, emit: Emit): void {
  const karts = w.state.karts;
  for (const a of karts) {
    const va = Math.sqrt(a.vx * a.vx + a.vz * a.vz);
    let wake = false;
    if (a.rescue === 0 && a.spin === 0 && a.flight === 0 && va > DRAFT.minSpeed) {
      for (const b of karts) {
        if (b === a || b.rescue > 0 || b.flight > 0) continue;
        const vb = Math.sqrt(b.vx * b.vx + b.vz * b.vz);
        if (vb < DRAFT.minSpeed) continue;
        const dx = b.vx / vb;
        const dz = b.vz / vb;
        const ox = b.x - a.x;
        const oz = b.z - a.z;
        const behind = ox * dx + oz * dz;
        if (behind < DRAFT.near || behind > DRAFT.reach) continue;
        if (Math.abs(ox * dz - oz * dx) > DRAFT.side) continue;
        if ((a.vx * dx + a.vz * dz) / va < DRAFT_COS) continue;
        wake = true;
        break;
      }
    }
    // Just flung out: a rest (counted below zero) before the next wake charges anything.
    if (a.draft < 0) {
      a.draft++;
      continue;
    }
    if (!wake) {
      a.draft = Math.max(0, a.draft - 2);
      continue;
    }
    a.draft++;
    if (a.draft >= DRAFT_FULL) {
      a.draft = -DRAFT_REST;
      giveBoost(a, DRAFT.boost);
      emit({ type: "boost", kart: a.id, source: "draft", level: 1 });
    }
  }
}
