/**
 * The item boxes and what comes out of them: the roulette, the odds by place,
 * using an item, and the pucks, seekers and slicks once they are on the
 * track. A hit spins the kart (kart.ts `spinOut`).
 */
import { TICK, type DriveInput, type ItemKind } from "../contract";
import { giveBoost, spinOut, type Emit } from "./kart";
import { ITEM_KINDS, q3, wrapAngle, type KartState, type Puck, type Seeker, type World } from "./state";
import { ticks, TUNING } from "./tuning";

const I = TUNING.items;

/** The odds of each item (in ITEM_KINDS order, as weights) for this place (1 = leading) among this many racers. */
export function itemOdds(place: number, racers: number): number[] {
  const t = racers > 1 ? (place - 1) / (racers - 1) : 0;
  return ITEM_KINDS.map((_, i) => I.oddsFirst[i]! + (I.oddsLast[i]! - I.oddsFirst[i]!) * t);
}

/** Picks an item from the odds for this place. */
function drawItem(w: World, place: number, racers: number): ItemKind {
  const weights = itemOdds(place, racers);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let r = w.rng.next() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i]!;
    if (r < 0) return ITEM_KINDS[i]!;
  }
  return ITEM_KINDS[ITEM_KINDS.length - 1]!;
}

/** A hit by a puck, a seeker or a slick: spins the victim out, unless it is already spinning. */
export function hitKart(victim: KartState, by: number | null, cause: "puck" | "seeker" | "slick", emit: Emit): boolean {
  if (victim.spin > 0) return false;
  spinOut(victim);
  emit({ type: "hit", kart: victim.id, by, cause });
  return true;
}

/**
 * The driver's item presses: each time the count goes up, the held item is
 * used. When only predicting (`full` false) a nitro is used, since it is the
 * kart's own boost, but nothing is put on the track.
 */
export function pressItem(w: World, k: KartState, input: DriveInput, full: boolean, emit: Emit): void {
  if (!(input.itemPresses > k.presses) || !Number.isSafeInteger(input.itemPresses)) return;
  k.presses = input.itemPresses;
  if (k.roll > 0 || k.item === null) return;
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
  if (!full) return;

  const item = k.item;
  k.item = null;
  k.uses = 0;
  emit({ type: "use", kart: k.id, item });
  if (item === "puck") {
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
  } else {
    state.slicks.push({
      id: state.nextThing++,
      owner: k.id,
      x: q3(k.x - forwardX * I.slick.behind),
      z: q3(k.z - forwardZ * I.slick.behind),
      s: k.s,
      offset: 0,
      age: 0,
    });
    const slick = state.slicks[state.slicks.length - 1]!;
    const where = w.geo.project(slick.x, slick.z, k.s);
    slick.s = q3(where.s);
    slick.offset = q3(where.offset);
    if (state.slicks.length > I.slick.max) state.slicks.shift();
  }
}

/** Stops a thing at the barrier: the distance in from the centre line it may reach, at this point of the track. */
function barrierLimit(w: World, s: number): number {
  return w.geo.at(s).width / 2 + TUNING.barrierGap - 0.3;
}

/** Whichever kart a thing at (x, z) with this reach hits first (lowest id), or null. */
function kartHit(w: World, x: number, z: number, reach: number, owner: number, age: number, grace: number): KartState | null {
  const r2 = reach * reach;
  for (const k of w.state.karts) {
    if (k.id === owner && age < grace) continue;
    if (k.spin > 0) continue;
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
  const limit = barrierLimit(w, p.s);
  if (Math.abs(p.offset) > limit) {
    // Bounce: back inside, and the speed into the barrier turned round.
    const side = p.offset > 0 ? 1 : -1;
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
  // Aim at the target once close, else follow the track's centre line a little way ahead.
  let ax: number;
  let az: number;
  const target = seeker.target >= 0 ? w.kart(seeker.target) : undefined;
  if (target && Math.hypot(target.x - seeker.x, target.z - seeker.z) < S.homing) {
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
  const limit = barrierLimit(w, p.s);
  if (Math.abs(p.offset) > limit) {
    const side = p.offset > 0 ? 1 : -1;
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
        k.uses = k.rolled === "nitro3" ? 3 : 1;
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
      if (k.item !== null || k.roll > 0) continue;
      const dx = k.x - site.x;
      const dz = k.z - site.z;
      if (dx * dx + dz * dz >= reach2) continue;
      state.boxes[b] = ticks(I.respawn);
      k.rolled = drawItem(w, k.place, karts.length);
      k.roll = ticks(I.roulette);
      emit({ type: "pickup", kart: k.id, item: k.rolled });
      break;
    }
  }

  // Pucks and seekers fly.
  state.pucks = state.pucks.filter((puck) => stepPuck(w, puck, emit));
  state.seekers = state.seekers.filter((seeker) => stepSeeker(w, seeker, emit));

  // Slicks wait for a kart.
  const S = I.slick;
  const reach = S.radius * S.radius;
  state.slicks = state.slicks.filter((slick) => {
    slick.age++;
    for (const k of karts) {
      if (k.id === slick.owner && slick.age < ticks(S.ownerGrace)) continue;
      if (k.spin > 0 || k.hop > 0) continue;
      const dx = k.x - slick.x;
      const dz = k.z - slick.z;
      if (dx * dx + dz * dz < reach) {
        hitKart(k, slick.owner, "slick", emit);
        return false;
      }
    }
    return true;
  });
}
