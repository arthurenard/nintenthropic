/**
 * The race itself: `createRace(setup)` gives a `Race` (contract.ts) that
 * steps the karts, the items and the standings one fixed tick at a time. The
 * parts are in their own files; this is the order they happen in each tick,
 * and the views, events and snapshots the rest of the game reads.
 *
 * Deterministic: every random choice goes through one seeded generator
 * (mulberry32), and nothing iterates over an unordered thing, so the same
 * setup and the same inputs replay the same race.
 */
import {
  IDLE_INPUT,
  TICK_HZ,
  type CreateRace,
  type DriveInput,
  type KartView,
  type Race,
  type RaceEvent,
  type RaceResult,
  type RaceSetup,
  type RaceSnapshot,
  type RaceView,
  type ThingView,
} from "../contract";
import { mulberry32 } from "../../engine/rules/rng";
import { botInput } from "./bots";
import { stepItems, pressItem } from "./items";
import { GO_TICK, NO_EMIT, bumpKarts, hopHeight, forwardSpeed, newKart, placeOnTrack, settle, stepKart } from "./kart";
import { planFor } from "./plan";
import { standings, updatePlaces, updateProgress } from "./progress";
import { applySnapshot, takeSnapshot } from "./snapshot";
import { clamp, type EventBody, type KartState, type SimState, type World } from "./state";
import { ticks } from "./tuning";

/** The most events kept waiting for a caller that is not taking them. */
const EVENT_BACKLOG = 400;

/**
 * A race, with one thing more than the contract asks: `handOver`, which
 * makes a kart (a player who left) drive itself from now on, as a bot.
 */
export interface SimRace extends Race {
  handOver(kart: number): void;
}

/** A generator that counts what it has been asked for, so a snapshot can say how far it has run and a restore get there again. */
function countedRandom(seed: number): World["rng"] {
  let base = mulberry32(seed);
  let drawn = 0;
  return {
    next() {
      drawn++;
      return base();
    },
    draws: () => drawn,
    reset(draws) {
      base = mulberry32(seed);
      for (let i = 0; i < draws; i++) base();
      drawn = draws;
    },
  };
}

class Sim implements SimRace {
  private readonly world: World;
  private readonly state: SimState;
  private readonly byId = new Map<number, KartState>();
  private toTake: RaceEvent[] = [];
  private toView: RaceEvent[] = [];
  private readonly emit: (body: EventBody) => void;

  constructor(readonly setup: RaceSetup) {
    const plan = planFor(setup.track);
    const karts = setup.racers.map((racer, place) => newKart(racer, place, plan.geo));
    this.state = {
      tick: 0,
      karts,
      boxes: plan.boxes.map(() => 0),
      pucks: [],
      seekers: [],
      slicks: [],
      nextThing: plan.boxes.length,
      nextEvent: 1,
      firstHome: -1,
      home: [],
      over: false,
    };
    for (const k of karts) this.byId.set(k.id, k);
    this.emit = (body) => this.record(body);
    this.world = {
      setup,
      geo: plan.geo,
      plan,
      state: this.state,
      kart: (id) => this.byId.get(id),
      rng: countedRandom(setup.seed),
      emit: this.emit,
      bestPlayer: null,
    };
    updatePlaces(this.world);
  }

  get tick(): number {
    return this.state.tick;
  }

  private record(body: EventBody): void {
    const event = { ...body, id: this.state.nextEvent++, tick: this.state.tick } as RaceEvent;
    this.toTake.push(event);
    this.toView.push(event);
    if (this.toTake.length > EVENT_BACKLOG) this.toTake.shift();
    if (this.toView.length > EVENT_BACKLOG) this.toView.shift();
  }

  /** The input a kart drives by this tick: a player's own, or a bot's decision. */
  private inputFor(k: KartState, inputs: ReadonlyMap<number, DriveInput>): DriveInput {
    return k.ai ? botInput(this.world, k) : (inputs.get(k.id) ?? IDLE_INPUT);
  }

  step(inputs: ReadonlyMap<number, DriveInput>): void {
    const state = this.state;
    const w = this.world;
    const racing = state.tick >= GO_TICK;

    // 3, 2, 1, Go: the "ready" half-second first.
    const since = state.tick - ticks(0.5);
    if (since >= 0 && since % TICK_HZ === 0 && state.tick <= GO_TICK) {
      this.emit({ type: "countdown", n: (3 - since / TICK_HZ) as 3 | 2 | 1 | 0 });
    }

    // The best player on the road, for the bots' rubber band.
    let best: number | null = null;
    for (const k of state.karts) {
      if (!k.player || k.finished !== null) continue;
      if (best === null || k.progress > best) best = k.progress;
    }
    w.bestPlayer = racing ? best : null;

    // Every kart drives. (A kart's own clock is the race's, whatever a `predict` did to it.)
    for (const k of state.karts) {
      k.t = state.tick;
      const input = this.inputFor(k, inputs);
      pressItem(w, k, input, true, this.emit);
      stepKart(w, k, input, this.emit);
    }

    if (racing) {
      // Karts touch; whoever was moved is put back on the track.
      const moved = new Set<number>();
      bumpKarts(w, this.emit, moved);
      for (const id of moved) {
        const k = this.byId.get(id)!;
        placeOnTrack(w, k, this.emit, true);
        settle(k);
      }
    }

    updateProgress(w, this.emit);
    if (racing) stepItems(w, this.emit);
    state.tick++;
  }

  predict(karts: readonly number[], inputs: ReadonlyMap<number, DriveInput>): void {
    for (const id of karts) {
      const k = this.byId.get(id);
      if (!k) continue;
      const input = this.inputFor(k, inputs);
      pressItem(this.world, k, input, false, NO_EMIT);
      stepKart(this.world, k, input, NO_EMIT);
    }
  }

  handOver(kart: number): void {
    const k = this.byId.get(kart);
    if (!k || k.ai) return;
    k.ai = true;
    k.bot.presses = k.presses;
  }

  view(): RaceView {
    const state = this.state;
    const geo = this.world.geo;
    const length = geo.length;
    const phase = state.over ? "finished" : state.tick >= GO_TICK ? "racing" : "countdown";
    const karts: KartView[] = state.karts.map((k) => {
      const done = k.finished !== null;
      return {
        id: k.id,
        x: k.x,
        y: k.y,
        z: k.z,
        heading: k.heading,
        speed: forwardSpeed(k),
        steer: clamp(k.steer, -1, 1),
        drift: k.drift,
        driftLevel: k.level,
        boost: k.boost / TICK_HZ,
        spin: k.spin / TICK_HZ,
        hop: hopHeight(k),
        offroad: k.offroad,
        item: k.roll > 0 ? null : k.item,
        itemUses: k.roll > 0 ? 0 : k.uses,
        rolling: k.roll > 0,
        place: k.place,
        lap: k.lap,
        lapProgress: done ? 0 : clamp((k.progress - (k.lap - 1) * length) / length, 0, 1),
        wrongWay: k.wrongWay,
        finished: k.finished,
      };
    });
    const things: ThingView[] = [];
    this.world.plan.boxes.forEach((site, i) => {
      things.push({ id: i, kind: "box", x: site.x, y: site.y, z: site.z, heading: site.heading, active: state.boxes[i] === 0 });
    });
    for (const p of state.pucks) things.push({ id: p.id, kind: "puck", x: p.x, y: geo.at(p.s).y, z: p.z, heading: Math.atan2(p.vx, p.vz), active: true });
    for (const e of state.seekers) things.push({ id: e.id, kind: "seeker", x: e.x, y: geo.at(e.s).y, z: e.z, heading: Math.atan2(e.dx, e.dz), active: true });
    for (const l of state.slicks) {
      things.push({ id: l.id, kind: "slick", x: l.x, y: geo.at(l.s).y, z: l.z, heading: (l.id * 2.399963) % (Math.PI * 2), active: true });
    }
    const events = this.toView;
    this.toView = [];
    return {
      tick: state.tick,
      phase,
      countdown: state.tick >= GO_TICK ? 0 : (GO_TICK - state.tick) / TICK_HZ,
      time: Math.max(0, (state.tick - GO_TICK) / TICK_HZ),
      laps: this.setup.laps,
      track: this.setup.track,
      racers: this.setup.racers,
      karts,
      things,
      events,
    };
  }

  takeEvents(): RaceEvent[] {
    const events = this.toTake;
    this.toTake = [];
    return events;
  }

  snapshot(): RaceSnapshot {
    return takeSnapshot(this.state, this.world.rng.draws());
  }

  restore(snapshot: RaceSnapshot): void {
    if (!applySnapshot(this.world, snapshot)) return;
    // Events belong to the host's clock: what was waiting here is moot now.
    this.toTake = [];
    this.toView = [];
  }

  result(): RaceResult | null {
    return standings(this.world);
  }
}

export const createRace: CreateRace = (setup) => new Sim(setup);
