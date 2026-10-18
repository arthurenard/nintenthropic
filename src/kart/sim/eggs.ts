/**
 * The small delights of a race, kept apart from the driving: the horn, the
 * emotes, and the rubber duck.
 *
 *   - A driver's horn count going up is a `horn` event (not more than one in
 *     half a second, however fast they clap). The first count a kart is seen
 *     with is only where it stands: a control that has honked in an earlier
 *     race does not honk as this one begins.
 *   - A driver's emote is copied to the kart's view, for the picture.
 *   - A kart that drives within a couple of metres of the track's duck makes
 *     a `duck` event, once in the race. Most ducks sit beyond the barrier,
 *     where no kart can go: there the kart finds it by driving as near as the
 *     barrier lets it, along the stretch of fence the duck is across from.
 *   - Bots honk, sometimes, a moment after passing someone (the sharper the
 *     bot the likelier), honk back at a person who honks close by (more often
 *     than not), and cheer for a few seconds when they finish in the top three. They do it from a hash of the kart and the tick, never the
 *     race's random numbers, so adding a honk never changes a race.
 *
 * All of it is plain numbers; a snapshot carries them (`save`, `load`), so
 * a restored race goes on exactly as it would have.
 */
import type { DriveInput, Emote } from "../contract";
import type { TrackDef, TrackGeometry } from "../track/geometry";
import { GO_TICK } from "./kart";
import type { EventBody, KartState, World } from "./state";
import { barrierDistance, isOpen, type Terrain } from "./terrain";
import { ticks, TUNING } from "./tuning";

export const EGGS = {
  /** A kart honks at most this often, seconds. */
  hornGap: 0.5,
  /** A horn count that jumps by more than this at once is a control catching up, not honks. */
  hornJump: 4,
  /** Counts that come in the race's first second are a control's old ones, seconds. */
  settle: 1,
  /** The duck squeaks for a kart this close to it (its middle to the duck's), metres... */
  duckRadius: 2,
  /** ...or, for a duck beyond the barrier, this close to the nearest place a kart can drive to. */
  fenceRadius: 3.5,
  /** A bot honks after overtaking with this chance plus this much times its skill... */
  botHonk: { base: 0.12, skill: 0.4 },
  /** ...a little later (seconds), and not again for this long (seconds). */
  botHonkDelay: { least: 0.25, spread: 0.6 },
  botHonkGap: 8,
  /** Bots start to honk this long after the green light, seconds. */
  botHonkAfter: 3,
  /** A bot honks back at a person who honked within this far (metres) of it, with this chance plus this much times its skill... */
  answerRadius: 15,
  answer: { base: 0.5, skill: 0.4 },
  /** ...noticing a honk this long old at most, and answering this long after it (seconds). */
  answerWithin: 1,
  answerDelay: { least: 0.4, spread: 0.5 },
  /** A bot that finished in the top three cheers for this long, seconds. */
  botCheer: 6,
} as const;

const EMOTE_CODE: Record<Emote, number> = { cheer: 1, wave: 2 };
const EMOTES: readonly (Emote | null)[] = [null, "cheer", "wave"];

/** What is kept of one kart. */
interface Egg {
  /** The horn count last seen, or -1 before any. */
  horn: number;
  /** The tick it may honk again from. */
  until: number;
  /** 0 none, 1 cheer, 2 wave. */
  emote: number;
  /** 1 once it has found the duck. */
  duck: number;
  /** A bot's place last tick, or 0. */
  place: number;
  /** The tick a bot means to honk at, or -1. */
  honkAt: number;
  /** The tick a bot stops cheering at, or 0. */
  cheerUntil: number;
}

const FIELDS = 7;
const fresh = (): Egg => ({ horn: -1, until: 0, emote: 0, duck: 0, place: 0, honkAt: -1, cheerUntil: 0 });

/** A number in [0, 1) from two small integers: the same everywhere, and not a draw on the race's generator. */
export function unit(a: number, b: number): number {
  let h = Math.imul(a + 1, 374761393) + Math.imul(b + 1, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Where a kart must be to find the track's duck, and how near: null for a track with none. */
export function duckSpot(def: TrackDef, geo: TrackGeometry, terrain: Terrain): { x: number; z: number; radius: number } | null {
  const duck = def.duck;
  if (!duck) return null;
  const s = duck.at * geo.length;
  const side = duck.offset >= 0 ? 1 : -1;
  // The farthest out a kart's middle gets on the duck's side: the barrier's, unless the edge is open.
  const reach = geo.at(s).width / 2 + barrierDistance(terrain, s, side) - TUNING.barrierInset;
  const beyond = !isOpen(terrain, s, side) && Math.abs(duck.offset) > reach;
  const spot = geo.point(s, beyond ? side * reach : duck.offset);
  return { x: spot.x, z: spot.z, radius: beyond ? EGGS.fenceRadius : EGGS.duckRadius };
}

export class Eggs {
  private readonly eggs = new Map<number, Egg>();
  /** Where the duck is found, or null for a track with none. */
  readonly duck: { x: number; z: number; radius: number } | null;

  constructor(w: World) {
    this.duck = duckSpot(w.setup.track, w.geo, w.plan.terrain);
  }

  private of(id: number): Egg {
    let egg = this.eggs.get(id);
    if (!egg) {
      egg = fresh();
      this.eggs.set(id, egg);
    }
    return egg;
  }

  /** What the kart's driver is doing with their hands, for its view. */
  emote(id: number): Emote | null {
    return EMOTES[this.eggs.get(id)?.emote ?? 0] ?? null;
  }

  /** One tick of one kart, after it has driven: `input` is what it was given. */
  kart(w: World, k: KartState, input: DriveInput, emit: (body: EventBody) => void): void {
    const tick = w.state.tick;
    const egg = this.of(k.id);
    const gap = ticks(EGGS.hornGap);

    if (k.ai) this.bot(w, k, egg, emit);
    else {
      const count = Number.isSafeInteger(input.horn) ? input.horn! : 0;
      if (egg.horn < 0) egg.horn = count;
      else if (count > egg.horn) {
        // In the first second a count is a control catching up from earlier races; so is a leap of several at once.
        const honked = tick >= ticks(EGGS.settle) && count - egg.horn <= EGGS.hornJump && tick >= egg.until;
        egg.horn = count;
        if (honked) {
          egg.until = tick + gap;
          emit({ type: "horn", kart: k.id });
        }
      }
      egg.emote = input.emote ? EMOTE_CODE[input.emote] : 0;
    }

    if (this.duck && !egg.duck) {
      const dx = k.x - this.duck.x;
      const dz = k.z - this.duck.z;
      if (dx * dx + dz * dz <= this.duck.radius * this.duck.radius) {
        egg.duck = 1;
        emit({ type: "duck", kart: k.id });
      }
    }
  }

  private bot(w: World, k: KartState, egg: Egg, emit: (body: EventBody) => void): void {
    const tick = w.state.tick;
    const racing = tick >= GO_TICK + ticks(EGGS.botHonkAfter);
    if (racing && k.finished === null) {
      // Passing someone: a honk, sometimes, a moment later.
      if (egg.place > 0 && k.place < egg.place && egg.honkAt < 0 && tick >= egg.until) {
        const chance = EGGS.botHonk.base + EGGS.botHonk.skill * k.skill;
        if (unit(k.id, tick) < chance) egg.honkAt = tick + ticks(EGGS.botHonkDelay.least + unit(k.id + 11, tick) * EGGS.botHonkDelay.spread);
      }
      egg.place = k.place;
    }
    // A person honking close by: a real bot (never a player's kart driving itself) honks back, sometimes, a moment later.
    if (!k.player && egg.honkAt < 0 && tick >= egg.until) this.answer(w, k, egg);
    if (egg.honkAt >= 0 && tick >= egg.honkAt) {
      egg.honkAt = -1;
      egg.until = tick + ticks(EGGS.botHonkGap);
      emit({ type: "horn", kart: k.id });
    }
    // Home in the top three: a cheer for a few seconds.
    if (egg.cheerUntil === 0 && k.finished !== null && w.state.home.indexOf(k.id) >= 0 && w.state.home.indexOf(k.id) < 3) {
      egg.cheerUntil = tick + ticks(EGGS.botCheer);
    }
    egg.emote = egg.cheerUntil > tick ? EMOTE_CODE.cheer : 0;
  }

  /**
   * Whether a person at the wheel near this bot has just honked, and if so
   * whether it answers. A person's honk is read from what is already kept (a
   * honk sets their `until` half a second on), and the choice from the honk's
   * own tick, so the bot decides once per honk and a restored race decides the same.
   */
  private answer(w: World, k: KartState, egg: Egg): void {
    const tick = w.state.tick;
    for (const other of w.state.karts) {
      if (other.ai) continue;
      const theirs = this.eggs.get(other.id);
      if (!theirs || theirs.until <= 0) continue;
      const at = theirs.until - ticks(EGGS.hornGap);
      if (tick < at || tick - at > ticks(EGGS.answerWithin)) continue;
      if (Math.hypot(other.x - k.x, other.z - k.z) > EGGS.answerRadius) continue;
      if (unit(k.id + 17, at) < EGGS.answer.base + EGGS.answer.skill * k.skill) {
        egg.honkAt = at + ticks(EGGS.answerDelay.least + unit(k.id + 29, at) * EGGS.answerDelay.spread);
      }
      return;
    }
  }

  /** In the order of `karts`: for the snapshot. */
  save(karts: readonly KartState[]): number[][] {
    return karts.map((k) => {
      const e = this.eggs.get(k.id) ?? fresh();
      return [e.horn, e.until, e.emote, e.duck, e.place, e.honkAt, e.cheerUntil];
    });
  }

  /** Puts a saved state back; false (and nothing changed) if it is not one of this race's. */
  load(karts: readonly KartState[], rows: unknown): boolean {
    if (!Array.isArray(rows) || rows.length !== karts.length) return false;
    if (!rows.every((row) => Array.isArray(row) && row.length === FIELDS && row.every((v) => Number.isFinite(v)))) return false;
    karts.forEach((k, i) => {
      const [horn, until, emote, duck, place, honkAt, cheerUntil] = rows[i] as number[];
      this.eggs.set(k.id, { horn: horn!, until: until!, emote: emote!, duck: duck!, place: place!, honkAt: honkAt!, cheerUntil: cheerUntil! });
    });
    return true;
  }
}
