/**
 * A tiny stand-in for the sim (`createRace`): kinematics and a finish line,
 * nothing else. The net's tests drive it, and the net's dev page falls back
 * on it when the real sim is not there, so the room can be built and checked
 * without waiting for the physics.
 *
 * What it keeps true to the contract is what the net depends on: `step` and
 * `predict` move a player's kart by exactly the same rule (so a guest that
 * predicts with the right inputs lands where the host does), `snapshot` and
 * `restore` round-trip, `itemPresses` is a count, events have ids, and the
 * race ends when the players finish.
 */
import {
  IDLE_INPUT,
  TICK,
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
import { TrackGeometry } from "../track/geometry";

/** Metres in one lap of the fake race (not the track's length). */
export const FAKE_LAP = 400;
/** Ticks of "countdown" before the fake race lets the karts go. */
export const FAKE_COUNTDOWN = 60;
const BOT_SPEED = 18;

/** Each event shape without the id and tick the race stamps on. */
type Unnumbered<T> = T extends unknown ? Omit<T, "id" | "tick"> : never;

interface FakeKart {
  x: number;
  z: number;
  heading: number;
  speed: number;
  steer: number;
  /** Metres driven. */
  progress: number;
  /** The last itemPresses seen, and how many items that has used. */
  presses: number;
  uses: number;
  /** Race seconds it finished at, or null. */
  finished: number | null;
}

const geometries = new Map<string, TrackGeometry>();
function geometryOf(setup: RaceSetup): TrackGeometry {
  let geometry = geometries.get(setup.track.id);
  if (!geometry) geometries.set(setup.track.id, (geometry = TrackGeometry.build(setup.track)));
  return geometry;
}

/** One tick of a kart's movement. Exported so a test can drive the same rule by hand. */
export function stepFakeKart(k: FakeKart, input: DriveInput): void {
  const target = input.throttle * 24;
  if (input.brake > 0.05) k.speed = Math.max(0, k.speed - 30 * TICK * input.brake);
  else if (k.speed < target) k.speed = Math.min(target, k.speed + 8 * TICK);
  else k.speed = Math.max(target, k.speed - 4 * TICK);
  k.steer = input.steer;
  // Steering right turns the heading down (contract.ts).
  k.heading -= input.steer * 2.2 * Math.min(1, k.speed / 6) * TICK;
  k.x += Math.sin(k.heading) * k.speed * TICK;
  k.z += Math.cos(k.heading) * k.speed * TICK;
  k.progress += k.speed * TICK;
  if (input.itemPresses > k.presses) {
    k.uses += input.itemPresses - k.presses;
    k.presses = input.itemPresses;
  }
}

/** A fake kart on the grid at `slot` places behind the start line. */
export function gridKart(geometry: TrackGeometry, slot: number): FakeKart {
  const s = geometry.wrap(-8 * (slot + 1));
  const p = geometry.point(s, slot % 2 === 0 ? -2.5 : 2.5);
  return { x: p.x, z: p.z, heading: geometry.heading(s), speed: 0, steer: 0, progress: 0, presses: 0, uses: 0, finished: null };
}

interface FakeState {
  tick: number;
  karts: FakeKart[];
  nextEvent: number;
  /** Race seconds of the first player finish, or null. */
  firstFinish: number | null;
  places: number;
}

export function createFakeRace(setup: RaceSetup): Race {
  return new FakeRace(setup);
}

class FakeRace implements Race {
  tick = 0;
  private geometry: TrackGeometry;
  private state: FakeState;
  private events: RaceEvent[] = [];

  constructor(readonly setup: RaceSetup) {
    this.geometry = geometryOf(setup);
    this.state = {
      tick: 0,
      karts: setup.racers.map((_, i) => gridKart(this.geometry, i)),
      nextEvent: 1,
      firstFinish: null,
      places: 0,
    };
  }

  private emit(event: Unnumbered<RaceEvent>): void {
    this.events.push({ ...event, id: this.state.nextEvent++, tick: this.tick } as RaceEvent);
  }

  private get racing(): boolean {
    return this.tick > FAKE_COUNTDOWN;
  }

  step(inputs: ReadonlyMap<number, DriveInput>): void {
    this.tick++;
    this.state.tick = this.tick;
    if (!this.racing) return;
    const total = this.setup.laps * FAKE_LAP;
    this.setup.racers.forEach((racer, id) => {
      const k = this.state.karts[id]!;
      if (k.finished !== null) {
        // A finished kart drives itself on.
        stepFakeKart(k, { steer: 0, throttle: 1, brake: 0, drift: false, itemPresses: k.presses });
        return;
      }
      const lapBefore = Math.floor(k.progress / FAKE_LAP);
      if (racer.player === null) {
        // A bot: round the centre line at a steady pace.
        k.progress += BOT_SPEED * TICK;
        const s = this.geometry.wrap(k.progress);
        const p = this.geometry.point(s);
        [k.x, k.z, k.heading, k.speed] = [p.x, p.z, this.geometry.heading(s), BOT_SPEED];
      } else {
        const usesBefore = k.uses;
        stepFakeKart(k, inputs.get(id) ?? IDLE_INPUT);
        for (let u = usesBefore; u < k.uses; u++) this.emit({ type: "use", kart: id, item: "nitro" });
      }
      const lapAfter = Math.floor(k.progress / FAKE_LAP);
      if (lapAfter > lapBefore && k.progress < total) this.emit({ type: "lap", kart: id, lap: lapAfter + 1 });
      if (k.progress >= total) {
        k.finished = (this.tick - FAKE_COUNTDOWN) * TICK;
        this.state.places++;
        if (racer.player !== null && this.state.firstFinish === null) this.state.firstFinish = k.finished;
        this.emit({ type: "finish", kart: id, place: this.state.places, time: k.finished });
      }
    });
  }

  predict(karts: readonly number[], inputs: ReadonlyMap<number, DriveInput>): void {
    // Others, the clock and the events stay put: only these karts move.
    if (!this.racing) return;
    for (const id of karts) {
      const k = this.state.karts[id];
      if (k && k.finished === null) stepFakeKart(k, inputs.get(id) ?? IDLE_INPUT);
    }
  }

  view(): RaceView {
    const order = this.state.karts
      .map((k, id) => ({ id, k }))
      .sort((a, b) => (b.k.finished === null ? b.k.progress : 1e9 - b.k.finished) - (a.k.finished === null ? a.k.progress : 1e9 - a.k.finished));
    const place = new Map(order.map((o, i) => [o.id, i + 1]));
    const karts: KartView[] = this.state.karts.map((k, id) => ({
      id,
      x: k.x,
      y: 0,
      z: k.z,
      heading: k.heading,
      speed: k.speed,
      steer: k.steer,
      drift: 0,
      driftLevel: 0,
      boost: 0,
      spin: 0,
      hop: 0,
      offroad: false,
      item: null,
      itemUses: k.uses,
      rolling: false,
      place: place.get(id)!,
      lap: Math.min(this.setup.laps + 1, Math.floor(k.progress / FAKE_LAP) + 1),
      lapProgress: (k.progress % FAKE_LAP) / FAKE_LAP,
      wrongWay: false,
      finished: k.finished,
    }));
    const things: ThingView[] = [];
    return {
      tick: this.tick,
      phase: this.result() ? "finished" : this.racing ? "racing" : "countdown",
      countdown: this.racing ? 0 : (FAKE_COUNTDOWN + 1 - this.tick) * TICK,
      time: this.racing ? (this.tick - FAKE_COUNTDOWN) * TICK : 0,
      laps: this.setup.laps,
      track: this.setup.track,
      racers: this.setup.racers,
      karts,
      things,
      events: [],
    };
  }

  takeEvents(): RaceEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  snapshot(): RaceSnapshot {
    return JSON.parse(JSON.stringify(this.state)) as RaceSnapshot;
  }

  restore(snapshot: RaceSnapshot): void {
    this.state = JSON.parse(JSON.stringify(snapshot)) as FakeState;
    this.tick = this.state.tick;
  }

  result(): RaceResult | null {
    const players = this.setup.racers.filter((r) => r.player !== null);
    const done = players.every((r) => this.state.karts[r.id]!.finished !== null);
    const late =
      this.state.firstFinish !== null && (this.tick - FAKE_COUNTDOWN) * TICK - this.state.firstFinish >= 25;
    if (!done && !late) return null;
    const order = this.state.karts
      .map((k, kart) => ({ kart, k }))
      .sort((a, b) => (b.k.finished === null ? b.k.progress : 1e9 - b.k.finished) - (a.k.finished === null ? a.k.progress : 1e9 - a.k.finished));
    return {
      standings: order.map((o, i) => ({ kart: o.kart, place: i + 1, time: o.k.finished, bestLap: null })),
    };
  }
}
