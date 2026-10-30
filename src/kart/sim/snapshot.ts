/**
 * A race's state as plain JSON, small: every kart is one flat array of
 * numbers in a fixed order (an object per kart would cost three times the
 * bytes in names), and what can be worked out again from the rest (the
 * kart's height, whether it is on the grass, its live place, its kart-local
 * clock) is left out. State is rounded as it is kept (state.ts), so what is
 * written is exactly what the race holds.
 */
import type { RaceSnapshot } from "../contract";
import { groundAt } from "./terrain";
import { ticks, TUNING } from "./tuning";
import { settle } from "./kart";
import { updatePlaces } from "./progress";
import { ITEM_KINDS, type KartState, type SimState, type World } from "./state";

/** Where each of a kart's numbers sits in its array (the tests reach in with these too). */
export const KART_AT = {
  x: 0, z: 1, heading: 2, vx: 3, vz: 4, steer: 5,
  hop: 6, drift: 7, charge: 8, level: 9, prevDrift: 10,
  boost: 11, spin: 12, flood: 13, stand: 14, held: 15,
  item: 16, uses: 17, roll: 18, rolled: 19, presses: 20,
  s: 21, offset: 22, progress: 23, pad: 24, wrong: 25,
  lap: 26, lapStart: 27, bestLap: 28, finished: 29, finalPlace: 30, ai: 31,
  botPresses: 32, botWait: 33, botStuck: 34, botBack: 35, botNext: 36, botFreeze: 37, botSteer: 38, botDrifting: 39,
  botCut: 40, air: 41, vy: 42, flight: 43, trick: 44, rescue: 45, immune: 46,
  comet: 47, zap: 48, draft: 49, aloft: 50, shakes: 51, prime: 52, counter: 53,
} as const;

const KART_FIELDS = 54;

const item = (kind: KartState["item"]): number => (kind === null ? -1 : ITEM_KINDS.indexOf(kind));
const kind = (index: number): KartState["item"] => (index < 0 ? null : (ITEM_KINDS[index] ?? null));
const bit = (flag: boolean): number => (flag ? 1 : 0);

function packKart(k: KartState): number[] {
  const m = k.bot;
  const a = new Array<number>(KART_FIELDS);
  a[KART_AT.x] = k.x;
  a[KART_AT.z] = k.z;
  a[KART_AT.heading] = k.heading;
  a[KART_AT.vx] = k.vx;
  a[KART_AT.vz] = k.vz;
  a[KART_AT.steer] = k.steer;
  a[KART_AT.hop] = k.hop;
  a[KART_AT.drift] = k.drift;
  a[KART_AT.charge] = k.charge;
  a[KART_AT.level] = k.level;
  a[KART_AT.prevDrift] = bit(k.prevDrift);
  a[KART_AT.boost] = k.boost;
  a[KART_AT.spin] = k.spin;
  a[KART_AT.flood] = k.flood;
  a[KART_AT.stand] = k.stand;
  a[KART_AT.held] = k.held;
  a[KART_AT.item] = item(k.item);
  a[KART_AT.uses] = k.uses;
  a[KART_AT.roll] = k.roll;
  a[KART_AT.rolled] = item(k.rolled);
  a[KART_AT.presses] = k.presses;
  a[KART_AT.s] = k.s;
  a[KART_AT.offset] = k.offset;
  a[KART_AT.progress] = k.progress;
  a[KART_AT.pad] = k.pad;
  a[KART_AT.wrong] = k.wrong;
  a[KART_AT.lap] = k.lap;
  a[KART_AT.lapStart] = k.lapStart;
  a[KART_AT.bestLap] = k.bestLap ?? -1;
  a[KART_AT.finished] = k.finished ?? -1;
  a[KART_AT.finalPlace] = k.finalPlace;
  a[KART_AT.ai] = bit(k.ai);
  a[KART_AT.botPresses] = m.presses;
  a[KART_AT.botWait] = m.wait;
  a[KART_AT.botStuck] = m.stuck;
  a[KART_AT.botBack] = m.back;
  a[KART_AT.botNext] = m.next;
  a[KART_AT.botFreeze] = m.freeze;
  a[KART_AT.botSteer] = m.steer;
  a[KART_AT.botDrifting] = bit(m.drifting);
  a[KART_AT.botCut] = m.cut;
  a[KART_AT.air] = k.air;
  a[KART_AT.vy] = k.vy;
  a[KART_AT.flight] = k.flight;
  a[KART_AT.trick] = k.trick;
  a[KART_AT.rescue] = k.rescue;
  a[KART_AT.immune] = k.immune;
  a[KART_AT.comet] = k.comet;
  a[KART_AT.zap] = k.zap;
  a[KART_AT.draft] = k.draft;
  a[KART_AT.aloft] = k.aloft;
  a[KART_AT.shakes] = k.shakes;
  a[KART_AT.prime] = k.prime;
  a[KART_AT.counter] = k.counter;
  return a;
}

function unpackKart(k: KartState, a: readonly number[], w: World): void {
  const at = (field: keyof typeof KART_AT): number => a[KART_AT[field]]!;
  k.x = at("x");
  k.z = at("z");
  k.heading = at("heading");
  k.vx = at("vx");
  k.vz = at("vz");
  k.steer = at("steer");
  k.hop = at("hop");
  k.drift = at("drift") as -1 | 0 | 1;
  k.charge = at("charge");
  k.level = at("level") as 0 | 1 | 2 | 3;
  k.prevDrift = at("prevDrift") === 1;
  k.boost = at("boost");
  k.spin = at("spin");
  k.flood = at("flood");
  k.stand = at("stand");
  k.held = at("held");
  k.item = kind(at("item"));
  k.uses = at("uses");
  k.roll = at("roll");
  k.rolled = kind(at("rolled"));
  k.presses = at("presses");
  k.s = at("s");
  k.offset = at("offset");
  k.progress = at("progress");
  k.pad = at("pad");
  k.wrong = at("wrong");
  k.lap = at("lap");
  k.lapStart = at("lapStart");
  k.bestLap = at("bestLap") < 0 ? null : at("bestLap");
  k.finished = at("finished") < 0 ? null : at("finished");
  k.finalPlace = at("finalPlace");
  k.ai = at("ai") === 1;
  const m = k.bot;
  m.presses = at("botPresses");
  m.wait = at("botWait");
  m.stuck = at("botStuck");
  m.back = at("botBack");
  m.next = at("botNext");
  m.freeze = at("botFreeze");
  m.steer = at("botSteer");
  m.drifting = at("botDrifting") === 1;
  m.cut = at("botCut");
  k.air = at("air");
  k.vy = at("vy");
  k.flight = at("flight") as 0 | 1 | 2;
  k.trick = at("trick");
  k.rescue = at("rescue");
  k.immune = at("immune");
  k.comet = at("comet");
  k.zap = at("zap");
  k.draft = at("draft");
  k.aloft = at("aloft");
  k.shakes = at("shakes");
  k.prime = at("prime");
  k.counter = at("counter");
  // What follows from the rest.
  const c = w.geo.at(k.s);
  k.y = c.y;
  k.ground = groundAt(w.plan.terrain, k.s, k.offset, c.width / 2);
  k.offroad = TUNING.ground[k.ground].rough;
  k.wrongWay = k.wrong >= ticks(TUNING.race.wrongTime);
  k.t = w.state.tick;
  settle(k);
}

export function takeSnapshot(state: SimState, draws: number): RaceSnapshot {
  const boxes: number[] = [];
  state.boxes.forEach((left, i) => {
    if (left > 0) boxes.push(i, left);
  });
  return {
    tick: state.tick,
    rng: draws,
    ev: state.nextEvent,
    th: state.nextThing,
    home: state.home.slice(),
    first: state.firstHome,
    over: bit(state.over),
    k: state.karts.map(packKart),
    b: boxes,
    p: state.pucks.map((p) => [p.id, p.owner, p.x, p.z, p.s, p.vx, p.vz, p.life, p.age]),
    e: state.seekers.map((e) => [e.id, e.owner, e.target, e.x, e.z, e.dx, e.dz, e.s, e.life, e.age]),
    l: state.slicks.map((l) => [l.id, l.owner, l.x, l.z, l.s, l.offset, l.age]),
    d: state.decoys.map((l) => [l.id, l.owner, l.x, l.z, l.s, l.offset, l.age]),
    r: state.skyrockets.map((r) => [r.id, r.owner, r.s, r.total, r.age]),
    st: state.stormAt,
  };
}

/** Whether `rows` is a list of rows of exactly `width` finite numbers. */
function table(rows: unknown, width: number, count?: number): rows is number[][] {
  return (
    Array.isArray(rows) &&
    (count === undefined || rows.length === count) &&
    rows.every((row) => Array.isArray(row) && row.length === width && row.every((v) => Number.isFinite(v)))
  );
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Puts a snapshot's state back; says whether it was one of this race's (the same karts) and was taken. Anything else changes nothing. */
export function applySnapshot(w: World, snap: RaceSnapshot): boolean {
  const rows = snap.k;
  if (!table(rows, KART_FIELDS, w.state.karts.length)) return false;
  if (!finite(snap.tick) || !finite(snap.rng) || snap.rng < 0 || snap.rng > 1_000_000 || !finite(snap.ev) || !finite(snap.th) || !finite(snap.first)) return false;
  const boxes = snap.b;
  if (!Array.isArray(boxes) || boxes.length % 2 !== 0 || !boxes.every((v) => Number.isFinite(v))) return false;
  if (!Array.isArray(snap.home) || !snap.home.every((v) => Number.isFinite(v))) return false;
  if (!table(snap.p, 9) || !table(snap.e, 10) || !table(snap.l, 7)) return false;
  if (!table(snap.d ?? [], 7) || !table(snap.r ?? [], 5) || !finite(snap.st ?? -1)) return false;
  const state = w.state;
  state.tick = snap.tick;
  w.rng.reset(snap.rng as number);
  state.nextEvent = snap.ev as number;
  state.nextThing = snap.th as number;
  state.home = (snap.home as number[]).slice();
  state.firstHome = snap.first as number;
  state.over = snap.over === 1;
  state.boxes.fill(0);
  for (let i = 0; i + 1 < boxes.length; i += 2) {
    const at = boxes[i] as number;
    if (at >= 0 && at < state.boxes.length) state.boxes[at] = boxes[i + 1] as number;
  }
  state.pucks = (snap.p as number[][]).map((r) => ({ id: r[0]!, owner: r[1]!, x: r[2]!, z: r[3]!, s: r[4]!, vx: r[5]!, vz: r[6]!, life: r[7]!, age: r[8]! }));
  state.seekers = (snap.e as number[][]).map((r) => ({ id: r[0]!, owner: r[1]!, target: r[2]!, x: r[3]!, z: r[4]!, dx: r[5]!, dz: r[6]!, s: r[7]!, life: r[8]!, age: r[9]! }));
  state.slicks = (snap.l as number[][]).map((r) => ({ id: r[0]!, owner: r[1]!, x: r[2]!, z: r[3]!, s: r[4]!, offset: r[5]!, age: r[6]! }));
  const trap = (r: number[]) => ({ id: r[0]!, owner: r[1]!, x: r[2]!, z: r[3]!, s: r[4]!, offset: r[5]!, age: r[6]! });
  state.decoys = ((snap.d ?? []) as number[][]).map(trap);
  state.skyrockets = ((snap.r ?? []) as number[][]).map((r) => ({ id: r[0]!, owner: r[1]!, s: r[2]!, total: r[3]!, age: r[4]! }));
  state.stormAt = (snap.st ?? -1) as number;
  state.karts.forEach((k, i) => unpackKart(k, rows[i]!, w));
  updatePlaces(w);
  return true;
}
