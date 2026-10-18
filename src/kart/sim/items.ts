/**
 * The item boxes and what comes out of them: the roulette, the odds by place,
 * using an item, and what is on the track once used: pucks, seekers, slicks,
 * decoys and skyrockets, and a Comet's touch. A hit spins the kart (kart.ts
 * `spinOut`); a Comet is never hit.
 */
import { TICK, type DriveInput, type HitCause, type ItemKind } from "../contract";
import { giveBoost, spinOut, type Emit } from "./kart";
import { ITEM_KINDS, ITEM_USES, q3, wrapAngle, type KartState, type Puck, type Seeker, type Skyrocket, type Slick, type World } from "./state";
import { barrierDistance, isOpen } from "./terrain";
import { ticks, TUNING } from "./tuning";

const I = TUNING.items;

/** The odds of each item (in ITEM_KINDS order, as weights) for this place (1 = leading) among this many racers. */
export function itemOdds(place: number, racers: number): number[] {
  const t = racers > 1 ? (place - 1) / (racers - 1) : 0;
  // First place to the middle of the pack, then on to the back.
  const [from, to, u] = t <= 0.5 ? [I.oddsFirst, I.oddsMid, t * 2] : [I.oddsMid, I.oddsLast, t * 2 - 1];
  return ITEM_KINDS.map((_, i) => from[i]! + (to[i]! - from[i]!) * u);
}

/** Whether any kart holds this item, or its roulette is about to land on it. */
function inHand(w: World, kind: ItemKind): boolean {
  return w.state.karts.some((k) => k.item === kind || (k.roll > 0 && k.rolled === kind));
}

/**
 * Picks an item from the odds for this place. A storm is rationed (one in
 * `cooldown` seconds over the whole race) and so is a skyrocket (one in the
 * air or in hand at a time).
 */
function drawItem(w: World, place: number, racers: number): ItemKind {
  const weights = itemOdds(place, racers);
  const state = w.state;
  if ((state.stormAt >= 0 && state.tick - state.stormAt < ticks(I.storm.cooldown)) || inHand(w, "storm")) weights[ITEM_KINDS.indexOf("storm")] = 0;
  if (state.skyrockets.length > 0 || inHand(w, "skyrocket")) weights[ITEM_KINDS.indexOf("skyrocket")] = 0;
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let r = w.rng.next() * total;
  let drawn = ITEM_KINDS[ITEM_KINDS.length - 1]!;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i]!;
    if (r < 0) {
      drawn = ITEM_KINDS[i]!;
      break;
    }
  }
  if (drawn === "storm") state.stormAt = state.tick;
  return drawn;
}

/** A hit by an item (or a Comet): spins the victim out, unless it is already spinning or untouchable. */
export function hitKart(victim: KartState, by: number | null, cause: HitCause, emit: Emit, seconds?: number): boolean {
  if (victim.spin > 0 || victim.immune > 0 || victim.comet > 0 || victim.rescue > 0) return false;
  spinOut(victim, seconds);
  emit({ type: "hit", kart: victim.id, by, cause });
  return true;
}

/**
 * The kart a skyrocket flies to: the leader of those still racing, or the
 * runner-up when the user leads. A kart already home is not in the race any
 * more (the storm spares it too): a rocket sent after it would be wasted on a
 * lap of honour.
 */
export function rocketTarget(w: World, owner: number): KartState | undefined {
  let best: KartState | undefined;
  for (const k of w.state.karts) {
    if (k.id !== owner && k.finished === null && (best === undefined || k.place < best.place)) best = k;
  }
  return best;
}

/**
 * The driver's item presses: each time the count goes up, the held item is
 * used. When only predicting (`full` false) a nitro or a comet is used, since
 * they are the kart's own, but nothing is put on the track.
 */
export function pressItem(w: World, k: KartState, input: DriveInput, full: boolean, emit: Emit): void {
  if (!(input.itemPresses > k.presses) || !Number.isSafeInteger(input.itemPresses)) return;
  k.presses = input.itemPresses;
  // In the drone's hook nothing can be used (the press is lost, the item kept).
  if (k.roll > 0 || k.item === null || k.rescue > 0) return;
  const state = w.state;
  const forwardX = Math.sin(k.heading);
  const forwardZ = Math.cos(k.heading);

  if (k.item === "nitro" || k.item === "nitro3") {
    giveBoost(k, k.item === "nitro" ? TUNING.boost.nitro : TUNING.boost.nitro3);
    emit({ type: "use", kart: k.id, item: k.item });
    emit({ type: "boost", kart: k.id, source: "nitro", level: 1 });
    k.uses--;
    if (k.uses <= 0) {
      k.item = null;
      k.uses = 0;
    }
    return;
  }
  if (k.item === "comet") {
    k.comet = ticks(I.comet.duration);
    k.zap = 0;
    k.item = null;
    k.uses = 0;
    emit({ type: "use", kart: k.id, item: "comet" });
    return;
  }
  if (!full) return;

  const item = k.item;
  if (item === "puck3" && k.uses > 1) {
    k.uses--;
  } else {
    k.item = null;
    k.uses = 0;
  }
  emit({ type: "use", kart: k.id, item });
  if (item === "puck" || item === "puck3") {
    const P = I.puck;
    const x = k.x + forwardX * P.spawnAhead;
    const z = k.z + forwardZ * P.spawnAhead;
    state.pucks.push({
      id: state.nextThing++,
      owner: k.id,
      x: q3(x),
      z: q3(z),
      s: k.s,
      vx: q3(forwardX * P.speed),
      vz: q3(forwardZ * P.speed),
      life: ticks(P.life),
      age: 0,
    });
  } else if (item === "seeker") {
    const target = state.karts.find((other) => other.place === k.place - 1 && other.id !== k.id);
    state.seekers.push({
      id: state.nextThing++,
      owner: k.id,
      target: target ? target.id : -1,
      x: q3(k.x + forwardX * I.seeker.spawnAhead),
      z: q3(k.z + forwardZ * I.seeker.spawnAhead),
      dx: forwardX,
      dz: forwardZ,
      s: k.s,
      life: ticks(I.seeker.life),
      age: 0,
    });
  } else if (item === "slick" || item === "decoy") {
    const list = item === "slick" ? state.slicks : state.decoys;
    const behind = item === "slick" ? I.slick.behind : I.decoy.behind;
    const trap: Slick = {
      id: state.nextThing++,
      owner: k.id,
      x: q3(k.x - forwardX * behind),
      z: q3(k.z - forwardZ * behind),
      s: k.s,
      offset: 0,
      age: 0,
    };
    const where = w.geo.project(trap.x, trap.z, k.s);
    trap.s = q3(where.s);
    trap.offset = q3(where.offset);
    list.push(trap);
    if (list.length > (item === "slick" ? I.slick.max : I.decoy.max)) list.shift();
  } else if (item === "storm") {
    storm(w, k, emit);
  } else if (item === "skyrocket") {
    const target = rocketTarget(w, k.id);
    if (target) {
      const total = Math.abs(w.geo.delta(k.s, target.s));
      state.skyrockets.push({ id: state.nextThing++, owner: k.id, s: k.s, total: q3(total), age: 0 });
    }
  } else if (item === "blast") {
    blast(w, k, emit);
  }
}

/**
 * A storm over the pack: every kart ahead of the user (everyone else when none
 * is) spins briefly and then crawls. A Comet is spared, and so is a kart the
 * drone is carrying or has just set down, which nothing can touch.
 */
function storm(w: World, user: KartState, emit: Emit): void {
  const state = w.state;
  state.stormAt = state.tick;
  const others = state.karts.filter((o) => o.id !== user.id && o.finished === null);
  const ahead = others.filter((o) => o.place < user.place);
  for (const victim of ahead.length > 0 ? ahead : others) {
    if (victim.comet > 0 || victim.rescue > 0 || victim.immune > 0) continue;
    victim.zap = ticks(I.storm.zap);
    hitKart(victim, user.id, "storm", emit, I.storm.spin);
    emit({ type: "strike", kart: victim.id, item: "storm", x: victim.x, z: victim.z });
  }
}

/** A ring of force round the user: karts close by spin, and what is on the track inside it is destroyed. */
function blast(w: World, user: KartState, emit: Emit): void {
  const state = w.state;
  const reach = I.blast.radius;
  const inside = (x: number, z: number): boolean => Math.hypot(x - user.x, z - user.z) < reach;
  for (const other of state.karts) {
    if (other.id !== user.id && inside(other.x, other.z)) hitKart(other, user.id, "blast", emit);
  }
  state.pucks = state.pucks.filter((p) => !inside(p.x, p.z));
  state.seekers = state.seekers.filter((e) => !inside(e.x, e.z));
  state.slicks = state.slicks.filter((l) => !inside(l.x, l.z));
  state.decoys = state.decoys.filter((l) => !inside(l.x, l.z));
  state.skyrockets = state.skyrockets.filter((r) => {
    const at = w.geo.point(r.s, 0);
    return !inside(at.x, at.z);
  });
  emit({ type: "strike", kart: user.id, item: "blast", x: user.x, z: user.z });
}

/**
 * Stops a thing at the barrier: the distance in from the centre line it may
 * reach, on this side (+1 right, -1 left) at this point of the track, or
 * Infinity where the edge is open (it flies on and is lost).
 */
function barrierLimit(w: World, s: number, side: 1 | -1): number {
  const terrain = w.plan.terrain;
  if (isOpen(terrain, s, side)) return Infinity;
  return w.geo.at(s).width / 2 + barrierDistance(terrain, s, side) - 0.3;
}

/**
 * Whichever kart a thing at (x, z) with this reach hits first (lowest id), or
 * null. Pucks and seekers skim the road: a kart flying over one off a ramp is
 * out of its reach, as it is out of a hazard's.
 */
function kartHit(w: World, x: number, z: number, reach: number, owner: number, age: number, grace: number): KartState | null {
  const r2 = reach * reach;
  for (const k of w.state.karts) {
    if (k.id === owner && age < grace) continue;
    if (k.spin > 0 || k.immune > 0 || k.comet > 0 || k.rescue > 0 || k.air > TUNING.hazard.clearHeight) continue;
    const dx = k.x - x;
    const dz = k.z - z;
    if (dx * dx + dz * dz < r2) return k;
  }
  return null;
}

function stepPuck(w: World, puck: Puck, emit: Emit): boolean {
  const P = I.puck;
  puck.age++;
  puck.life--;
  if (puck.life <= 0) return false;
  puck.x = q3(puck.x + puck.vx * TICK);
  puck.z = q3(puck.z + puck.vz * TICK);
  const p = w.geo.project(puck.x, puck.z, puck.s);
  puck.s = q3(p.s);
  const side = p.offset > 0 ? 1 : -1;
  const limit = barrierLimit(w, p.s, side);
  // Off an open edge a puck is gone.
  if (limit === Infinity && Math.abs(p.offset) > p.sample.width / 2 + 8) return false;
  if (Math.abs(p.offset) > limit) {
    // Bounce: back inside, and the speed into the barrier turned round.
    const rx = -p.sample.tz * side;
    const rz = p.sample.tx * side;
    const back = Math.abs(p.offset) - limit;
    puck.x = q3(puck.x - rx * back);
    puck.z = q3(puck.z - rz * back);
    const into = puck.vx * rx + puck.vz * rz;
    if (into > 0) {
      puck.vx = q3(puck.vx - 2 * into * rx);
      puck.vz = q3(puck.vz - 2 * into * rz);
    }
  }
  const victim = kartHit(w, puck.x, puck.z, P.hitRadius, puck.owner, puck.age, ticks(P.ownerGrace));
  if (victim) {
    hitKart(victim, puck.owner, "puck", emit);
    return false;
  }
  return true;
}

function stepSeeker(w: World, seeker: Seeker, emit: Emit): boolean {
  const S = I.seeker;
  seeker.age++;
  seeker.life--;
  if (seeker.life <= 0) return false;
  // Aim at the target once close, else follow the track's centre line a little way ahead. Close means along the road
  // too: where the track doubles back (the fingers of the palm island) the target can be near across the barrier, and a
  // seeker that turned for it would only grind along the barrier between.
  let ax: number;
  let az: number;
  const target = seeker.target >= 0 ? w.kart(seeker.target) : undefined;
  if (target && Math.abs(w.geo.delta(seeker.s, target.s)) < S.homing && Math.hypot(target.x - seeker.x, target.z - seeker.z) < S.homing) {
    ax = target.x;
    az = target.z;
  } else {
    const ahead = w.geo.point(seeker.s + S.lookahead, 0);
    ax = ahead.x;
    az = ahead.z;
  }
  const wantX = ax - seeker.x;
  const wantZ = az - seeker.z;
  const want = Math.hypot(wantX, wantZ);
  if (want > 1e-6) {
    const turn = wrapAngle(Math.atan2(seeker.dx * wantZ - seeker.dz * wantX, seeker.dx * wantX + seeker.dz * wantZ));
    const limit = S.turnRate * TICK;
    const by = Math.max(-limit, Math.min(limit, turn));
    const cos = Math.cos(by);
    const sin = Math.sin(by);
    const dx = seeker.dx * cos - seeker.dz * sin;
    const dz = seeker.dx * sin + seeker.dz * cos;
    const d = Math.hypot(dx, dz) || 1;
    seeker.dx = dx / d;
    seeker.dz = dz / d;
  }
  seeker.x = q3(seeker.x + seeker.dx * S.speed * TICK);
  seeker.z = q3(seeker.z + seeker.dz * S.speed * TICK);
  const p = w.geo.project(seeker.x, seeker.z, seeker.s);
  seeker.s = q3(p.s);
  const side = p.offset > 0 ? 1 : -1;
  const limit = Math.min(barrierLimit(w, p.s, side), p.sample.width / 2 + TUNING.barrierGap - 0.3);
  if (Math.abs(p.offset) > limit) {
    const back = Math.abs(p.offset) - limit;
    seeker.x = q3(seeker.x + p.sample.tz * side * back);
    seeker.z = q3(seeker.z - p.sample.tx * side * back);
  }
  seeker.dx = Math.round(seeker.dx * 10000) / 10000;
  seeker.dz = Math.round(seeker.dz * 10000) / 10000;
  const victim = kartHit(w, seeker.x, seeker.z, S.hitRadius, seeker.owner, seeker.age, ticks(S.ownerGrace));
  if (victim) {
    hitKart(victim, seeker.owner, "seeker", emit);
    return false;
  }
  return true;
}

/** A skyrocket flies along the centre line to its target and bursts there: everyone within reach of the burst spins. */
function stepSkyrocket(w: World, rocket: Skyrocket, emit: Emit): boolean {
  const R = I.skyrocket;
  rocket.age++;
  const target = rocketTarget(w, rocket.owner);
  if (!target) return false;
  const gap = w.geo.delta(rocket.s, target.s);
  const step = R.speed * TICK;
  rocket.s = q3(w.geo.wrap(rocket.s + Math.max(-step, Math.min(step, gap))));
  const arrived = Math.abs(gap) < R.reach && rocket.age >= ticks(R.minFlight);
  if (!arrived && rocket.age < ticks(R.life)) return true;
  emit({ type: "strike", kart: target.id, item: "skyrocket", x: target.x, z: target.z });
  const reach2 = R.burstRadius * R.burstRadius;
  for (const k of w.state.karts) {
    const dx = k.x - target.x;
    const dz = k.z - target.z;
    if (dx * dx + dz * dz < reach2) hitKart(k, rocket.owner, "skyrocket", emit);
  }
  return false;
}

/** A trap (slick, decoy) waits for a kart to drive into it. */
function stepTrap(w: World, list: Slick[], radius: number, grace: number, cause: HitCause, emit: Emit): Slick[] {
  const reach = radius * radius;
  return list.filter((trap) => {
    trap.age++;
    for (const k of w.state.karts) {
      if (k.id === trap.owner && trap.age < grace) continue;
      if (k.spin > 0 || k.hop > 0 || k.flight > 0 || k.immune > 0 || k.comet > 0 || k.rescue > 0) continue;
      const dx = k.x - trap.x;
      const dz = k.z - trap.z;
      if (dx * dx + dz * dz < reach) {
        hitKart(k, trap.owner, cause, emit);
        return false;
      }
    }
    return true;
  });
}

/** A Comet spins what it touches. */
function cometTouch(w: World, emit: Emit): void {
  const reach = TUNING.kartRadius * 2 + 0.2;
  for (const comet of w.state.karts) {
    if (comet.comet <= 0 || comet.rescue > 0) continue;
    for (const other of w.state.karts) {
      if (other.id === comet.id || other.comet > 0 || Math.abs(other.air - comet.air) > TUNING.ramp.passOver) continue;
      if (Math.hypot(other.x - comet.x, other.z - comet.z) < reach) hitKart(other, comet.id, "comet", emit);
    }
  }
}

/** The boxes, the roulette, and everything flying or lying about, one tick. */
export function stepItems(w: World, emit: Emit): void {
  const state = w.state;
  const karts = state.karts;

  // The roulette lands.
  for (const k of karts) {
    if (k.roll > 0) {
      k.roll--;
      if (k.roll === 0 && k.rolled) {
        k.item = k.rolled;
        k.uses = ITEM_USES[k.rolled] ?? 1;
        k.rolled = null;
      }
    }
  }

  // Boxes: coming back, and being driven through.
  const reach2 = I.pickupRadius * I.pickupRadius;
  const sites = w.plan.boxes;
  for (let b = 0; b < sites.length; b++) {
    if (state.boxes[b]! > 0) {
      state.boxes[b] = state.boxes[b]! - 1;
      continue;
    }
    const site = sites[b]!;
    for (const k of karts) {
      if (k.rescue > 0) continue;
      const dx = k.x - site.x;
      const dz = k.z - site.z;
      if (dx * dx + dz * dz >= reach2) continue;
      // Every kart breaks the box it drives through, as in any kart racer,
      // but only a kart with empty hands that is still racing gets an item
      // from it (one already home drives on with nothing to use on the others).
      state.boxes[b] = ticks(I.respawn);
      if (k.item !== null || k.roll > 0 || k.finished !== null) {
        emit({ type: "box", kart: k.id });
        break;
      }
      k.rolled = drawItem(w, k.place, karts.length);
      k.roll = ticks(I.roulette);
      emit({ type: "pickup", kart: k.id, item: k.rolled });
      break;
    }
  }

  // Pucks and seekers fly; skyrockets cross the sky.
  state.pucks = state.pucks.filter((puck) => stepPuck(w, puck, emit));
  state.seekers = state.seekers.filter((seeker) => stepSeeker(w, seeker, emit));
  state.skyrockets = state.skyrockets.filter((rocket) => stepSkyrocket(w, rocket, emit));

  // Slicks and decoys wait for a kart; a Comet runs into whoever it touches.
  state.slicks = stepTrap(w, state.slicks, I.slick.radius, ticks(I.slick.ownerGrace), "slick", emit);
  state.decoys = stepTrap(w, state.decoys, I.decoy.radius, ticks(I.decoy.ownerGrace), "decoy", emit);
  cometTouch(w, emit);
}
