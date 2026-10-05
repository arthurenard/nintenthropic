/**
 * A stand-in for the real sim, so the renderer can be built and judged on
 * its own: eight karts round the track, the first drivable (or on autopilot
 * when no key is pressed), with a script of fake drifts, boosts, items,
 * spin-outs, bumps and finishes so every effect shows.
 *
 * It is clearly NOT the sim: nothing here is deterministic across devices,
 * karts do not really collide, and the physics is a few lines. It produces
 * `RaceView`s of exactly the shape the real sim does, so the dev page can
 * swap this for `createRace(...).view()` and the picture will not know.
 */
import {
  BOT_COLOURS,
  PLAYER_COLOURS,
  type ItemKind,
  type KartView,
  type RaceEvent,
  type RaceView,
  type RacerSetup,
  type ThingView,
  type TrackDef,
} from "../contract";
import { TrackGeometry } from "../track/geometry";
import { angleDiff, clamp, damp } from "./math";

/** What the person at the keyboard asks (all optional: nothing pressed means the autopilot drives). */
export interface DemoInput {
  steer: number;
  throttle: number;
  brake: number;
  drift: boolean;
  /** Counts up with each press, like DriveInput.itemPresses. */
  itemPresses: number;
}

/** Anything that can feed the renderer: the demo now, the real sim's session later. */
export interface RaceViewSource {
  readonly racers: readonly RacerSetup[];
  readonly track: TrackDef;
  /** Advances by `dt` seconds with the local driver's input (null: let it drive itself). */
  step(dt: number, input: DemoInput | null): void;
  /** The race as it stands, with the events since the last call. */
  view(): RaceView;
  restart(): void;
}

/** An event as the sim would make it, before it is numbered. */
type EventBody = RaceEvent extends infer E ? (E extends unknown ? Omit<E, "id" | "tick"> : never) : never;

const NAMES = ["You", "Ana", "Ben", "Cleo", "Dot", "Eli", "Fay", "Gus"];
const ITEMS: ItemKind[] = ["nitro", "nitro3", "puck", "slick", "seeker", "nitro", "puck"];
const COUNTDOWN = 3.5;

interface Kart extends KartView {
  /** Metres run since the start line (negative on the grid). */
  progress: number;
  // Physics (the driver) or rails (the rest).
  vx: number;
  vz: number;
  lane: number;
  laneTarget: number;
  baseSpeed: number;
  driftTime: number;
  driftCharge: number;
  hopClock: number;
  boostSource: "nitro" | "pad" | "drift" | "start";
  rollClock: number;
  useIn: number;
  spinCool: number;
  offroadIn: number;
  wrongClock: number;
  lastPress: number;
  near: number;
  bumpCool: number;
  hasDriver: boolean;
}

interface Thing extends ThingView {
  owner: number;
  vx: number;
  vz: number;
  ttl: number;
  back: number;
}

export class DemoRace implements RaceViewSource {
  readonly racers: RacerSetup[];
  readonly geometry: TrackGeometry;
  private karts: Kart[] = [];
  private things: Thing[] = [];
  private boxes: { thing: ThingView; back: number }[] = [];
  private events: RaceEvent[] = [];
  private nextEvent = 1;
  private nextThing = 1;
  private tick = 0;
  private clock = 0;
  private finishedAt = -1;
  private rnd = 7;
  private lastPresses = 0;
  /** Whether boxes are sent as things (the real sim will) or left to the track's rows. */
  boxesAsThings = true;

  constructor(
    readonly track: TrackDef,
    private readonly options: { karts?: number; laps?: number; autoRestart?: boolean } = {},
  ) {
    this.geometry = TrackGeometry.build(track);
    const n = Math.max(1, Math.min(8, options.karts ?? 8));
    this.racers = Array.from({ length: n }, (_, i) => ({
      id: i,
      name: NAMES[i] ?? `Kart ${i + 1}`,
      colour: i < 4 ? PLAYER_COLOURS[i]! : BOT_COLOURS[i - 4]!,
      player: i < 4 ? i : null,
    }));
    this.restart();
  }

  private random(): number {
    this.rnd = (this.rnd * 16807) % 2147483647;
    return (this.rnd - 1) / 2147483646;
  }

  private emit(e: EventBody): void {
    this.events.push({ ...e, id: this.nextEvent++, tick: Math.round(this.tick) } as RaceEvent);
  }

  restart(): void {
    const g = this.geometry;
    this.tick = 0;
    this.clock = 0;
    this.finishedAt = -1;
    this.things = [];
    this.events = [];
    this.nextEvent = 1;
    this.lastPresses = 0;
    this.karts = this.racers.map((r, i) => {
      // The grid: two by two behind the line, the driver in the third row.
      const slot = i === 0 ? 4 : i <= 4 ? i - 1 : i;
      const row = Math.floor(slot / 2);
      const side = slot % 2 === 0 ? -1 : 1;
      const progress = -6 - row * 7.5;
      const lane = side * 2.6;
      const p = g.point(progress, lane);
      const heading = g.heading(progress);
      return {
        surface: "road" as const,
        trick: 0,
        rescue: 0,
        id: r.id,
        x: p.x,
        y: p.y,
        z: p.z,
        heading,
        speed: 0,
        steer: 0,
        drift: 0,
        driftLevel: 0,
        boost: 0,
        spin: 0,
        hop: 0,
        offroad: false,
        item: null,
        itemUses: 0,
        rolling: false,
        place: i + 1,
        lap: 1,
        lapProgress: 0,
        wrongWay: false,
        finished: null,
        progress,
        vx: 0,
        vz: 0,
        lane,
        laneTarget: lane,
        baseSpeed: 20.5 + (i % 4) * 0.9 + (i > 4 ? 0.6 : 0),
        driftTime: 0,
        driftCharge: 0,
        hopClock: 0,
        boostSource: "nitro" as const,
        rollClock: 0,
        useIn: 4 + this.random() * 6,
        spinCool: 9 + this.random() * 12,
        offroadIn: 8 + this.random() * 10,
        wrongClock: 0,
        lastPress: 0,
        near: Math.max(0, progress),
        bumpCool: 0,
        hasDriver: i === 0,
      };
    });
    this.boxes = [];
    let id = 1000;
    for (const at of this.track.itemRows) {
      const c = g.at(at * g.length);
      const spread = Math.min(2.6, (c.width - 3) / 4);
      for (let k = -2; k <= 2; k++) {
        const p = g.point(c.s, k * spread);
        this.boxes.push({ thing: { id: id++, kind: "box", x: p.x, y: p.y, z: p.z, heading: 0, active: true }, back: 0 });
      }
    }
  }

  private place(): void {
    const order = [...this.karts].sort((a, b) => {
      if (a.finished !== null && b.finished !== null) return a.finished - b.finished;
      if (a.finished !== null) return -1;
      if (b.finished !== null) return 1;
      return b.progress - a.progress;
    });
    order.forEach((k, i) => (k.place = i + 1));
  }

  step(dtRaw: number, input: DemoInput | null): void {
    const dt = clamp(dtRaw, 0, 0.1);
    // Fixed small steps, so the physics does not depend on the frame rate.
    const sub = Math.max(1, Math.ceil(dt / (1 / 60)));
    for (let i = 0; i < sub; i++) this.stepOnce(dt / sub, input);
  }

  private stepOnce(dt: number, input: DemoInput | null): void {
    this.tick += dt * 60;
    this.clock += dt;
    const racing = this.clock >= COUNTDOWN;
    if (this.clock - dt < COUNTDOWN && racing) this.emit({ type: "countdown", n: 0 });
    else if (!racing) {
      const n = Math.ceil(COUNTDOWN - this.clock);
      const before = Math.ceil(COUNTDOWN - (this.clock - dt));
      if (n !== before && n <= 3) this.emit({ type: "countdown", n: n as 1 | 2 | 3 });
    }
    const raceTime = Math.max(0, this.clock - COUNTDOWN);

    for (const k of this.karts) {
      if (k.hasDriver) this.driveDriver(k, dt, racing, input, raceTime);
      else this.driveRails(k, dt, racing, raceTime);
      this.common(k, dt, raceTime);
    }
    this.moveThings(dt);
    this.pickups(dt);
    this.place();

    // Restart a few seconds after the driver has finished.
    const me = this.karts[0]!;
    if (me.finished !== null) {
      if (this.finishedAt < 0) this.finishedAt = this.clock;
      if (this.options.autoRestart !== false && this.clock - this.finishedAt > 9) this.restart();
    }
  }

  /** The things every kart shares: timers, laps, the pads, the finish. */
  private common(k: Kart, dt: number, raceTime: number): void {
    const g = this.geometry;
    k.boost = Math.max(0, k.boost - dt);
    k.spin = Math.max(0, k.spin - dt);
    k.bumpCool = Math.max(0, k.bumpCool - dt);
    if (k.hopClock > 0) {
      k.hopClock = Math.max(0, k.hopClock - dt);
      k.hop = 0.35 * Math.sin(Math.PI * (1 - k.hopClock / 0.25));
    } else {
      k.hop = 0;
    }
    if (k.rolling) {
      k.rollClock -= dt;
      if (k.rollClock <= 0) {
        k.rolling = false;
        k.item = ITEMS[Math.floor(this.random() * ITEMS.length)]!;
        k.itemUses = k.item === "nitro3" ? 3 : 1;
        k.useIn = 3 + this.random() * 5;
      }
    }
    const proj = g.project(k.x, k.z, k.near);
    k.near = proj.s;
    k.offroad = Math.abs(proj.offset) > proj.sample.width / 2;
    // Pads.
    for (const pad of this.track.boostPads ?? []) {
      const ds = g.delta(proj.s, pad.at * g.length);
      if (Math.abs(ds) < 2 && Math.abs(proj.offset - pad.offset) < 2.6 && k.boost < 0.9 && raceTime > 0) {
        k.boost = 1.0;
        this.emit({ type: "boost", kart: k.id, source: "pad", level: 1 });
      }
    }
    // Laps and finish.
    if (raceTime > 0) {
      const L = g.length;
      const lap = Math.min(this.options.laps ?? this.track.laps, Math.floor(Math.max(0, k.progress) / L) + 1);
      if (lap > k.lap) {
        k.lap = lap;
        this.emit({ type: "lap", kart: k.id, lap: lap - 1 });
        if (lap === (this.options.laps ?? this.track.laps)) this.emit({ type: "final-lap", kart: k.id });
      }
      k.lapProgress = (Math.max(0, k.progress) % L) / L;
      if (k.finished === null && k.progress >= (this.options.laps ?? this.track.laps) * L) {
        k.finished = raceTime;
        k.lap = (this.options.laps ?? this.track.laps) + 1;
        this.place();
        this.emit({ type: "finish", kart: k.id, place: k.place, time: raceTime });
      }
    }
  }

  // ── The driver ────────────────────────────────────────────────────────────

  private driveDriver(k: Kart, dt: number, racing: boolean, input: DemoInput | null, raceTime: number): void {
    const g = this.geometry;
    const auto = input === null;
    const proj = g.project(k.x, k.z, k.near);
    let steer = 0;
    let throttle = 0;
    let brake = 0;
    let wantDrift = false;
    if (auto) {
      const look = proj.s + 11 + Math.max(0, k.speed) * 0.45;
      const aim = g.point(look, Math.sin(raceTime * 0.4) * 2.6);
      const want = Math.atan2(aim.x - k.x, aim.z - k.z);
      steer = clamp(-angleDiff(k.heading, want) * 2.2, -1, 1);
      throttle = racing ? 1 : 0;
      const bend = g.at(proj.s + 14).curvature;
      wantDrift = racing && Math.abs(bend) > 0.019 && k.speed > 16;
      if (wantDrift && k.drift === 0) steer = Math.sign(bend) * Math.max(0.6, Math.abs(steer));
      if (racing && k.item && !k.rolling) {
        k.useIn -= dt;
        if (k.useIn <= 0) this.useItem(k);
      }
    } else {
      steer = clamp(input.steer, -1, 1);
      throttle = racing ? input.throttle : 0;
      brake = input.brake;
      wantDrift = input.drift;
      if (input.itemPresses > this.lastPresses) {
        this.lastPresses = input.itemPresses;
        if (k.item && !k.rolling) this.useItem(k);
      }
    }

    // Drift: a hop into it, charge while it lasts, a boost when it is let go.
    if (wantDrift && k.drift === 0 && Math.abs(steer) > 0.3 && k.speed > 10 && k.spin <= 0) {
      k.drift = steer > 0 ? 1 : -1;
      k.hopClock = 0.25;
      k.driftTime = 0;
      k.driftLevel = 0;
    }
    if (k.drift !== 0) {
      if (!wantDrift || k.spin > 0) {
        if (k.driftLevel > 0) {
          k.boost = k.driftLevel === 1 ? 0.7 : 1.4;
          this.emit({ type: "boost", kart: k.id, source: "drift", level: k.driftLevel });
        }
        k.drift = 0;
        k.driftLevel = 0;
        k.driftTime = 0;
      } else if (!k.offroad) {
        k.driftTime += dt * (0.8 + Math.abs(steer) * 0.5);
        const level = k.driftTime > 2.2 ? 2 : k.driftTime > 1.0 ? 1 : 0;
        if (level > k.driftLevel) {
          k.driftLevel = level as 0 | 1 | 2;
          this.emit({ type: "drift-level", kart: k.id, level: level as 1 | 2 });
        }
      }
    }

    // Speed.
    const topSpeed = (k.offroad ? 11.5 : 24) * (k.boost > 0 ? 1.35 : 1);
    if (k.spin > 0) {
      k.speed = damp(k.speed, 3, 2, dt);
    } else if (brake > 0.5) {
      if (k.speed > 0.4) k.speed = Math.max(0, k.speed - 30 * dt);
      else k.speed = Math.max(-7, k.speed - 8 * dt);
    } else if (throttle > 0.1) {
      if (k.speed < topSpeed) k.speed = damp(k.speed, topSpeed, k.boost > 0 ? 3 : 0.8, dt);
      else k.speed = damp(k.speed, topSpeed, 3, dt);
    } else {
      k.speed = damp(k.speed, 0, 0.5, dt);
    }

    // Steering: slower to bite at a crawl; remapped to turn into a drift.
    const steerEff = k.drift !== 0 ? k.drift * clamp(0.65 + steer * k.drift * 0.5, 0.35, 1.2) : steer;
    k.steer = damp(k.steer, steer, 14, dt);
    const yawRate = 2.2 * clamp(Math.abs(k.speed) / 6, 0, 1) * (1 - 0.15 * clamp(Math.abs(k.speed) / 24, 0, 1));
    if (k.spin <= 0) k.heading += -steerEff * yawRate * dt * (k.speed < 0 ? -1 : 1);
    k.x += Math.sin(k.heading) * k.speed * dt;
    k.z += Math.cos(k.heading) * k.speed * dt;

    // Barriers.
    const after = g.project(k.x, k.z, proj.s);
    const wall = after.sample.width / 2 + 6;
    if (Math.abs(after.offset) > wall) {
      const over = Math.abs(after.offset) - wall;
      const side = Math.sign(after.offset);
      // Pushed back along the road's right vector.
      k.x += after.sample.tz * side * over;
      k.z -= after.sample.tx * side * over;
      if (k.speed > 4) this.emit({ type: "wall", kart: k.id, strength: k.speed / 24 });
      k.speed *= 0.6;
    }
    k.y = after.sample.y;

    // Progress, and driving the wrong way.
    k.progress += g.delta(k.progress, after.s);
    k.lane = after.offset;
    const along = Math.cos(k.heading) * after.sample.tz + Math.sin(k.heading) * after.sample.tx;
    k.wrongClock = along < -0.35 && k.speed > 2 ? k.wrongClock + dt : 0;
    k.wrongWay = k.wrongClock > 1.5;
  }

  // ── The rest, on rails ────────────────────────────────────────────────────

  private driveRails(k: Kart, dt: number, racing: boolean, raceTime: number): void {
    const g = this.geometry;
    const s = k.progress;
    const here = g.at(s);
    const bend = Math.abs(g.at(s + 18).curvature);
    const topSpeed = k.baseSpeed * (1 - Math.min(0.32, bend * 9)) * (k.boost > 0 ? 1.35 : 1);
    if (k.spin > 0) k.speed = damp(k.speed, 3, 2, dt);
    else if (racing) k.speed = damp(k.speed, topSpeed, k.boost > 0 ? 2.4 : 0.9, dt);
    else k.speed = 0;
    // Lane changes now and then, and an excursion off the road.
    if (racing) {
      k.offroadIn -= dt;
      if (k.offroadIn <= 0 && k.id === 5 && k.spin <= 0) {
        k.laneTarget = here.width / 2 + 2.5 * (k.lane > 0 ? 1 : -1);
        k.offroadIn = 3.2 + 16 * this.random();
        if (this.random() < 0.5) k.laneTarget = (k.lane > 0 ? 1 : -1) * 2.6;
      } else if (k.offroadIn <= 0) {
        k.laneTarget = (this.random() * 2 - 1) * (here.width / 2 - 2.2);
        k.offroadIn = 4 + 8 * this.random();
      }
      // Keep out of the way of whoever is just ahead (these karts do not really collide).
      for (const o of this.karts) {
        const gap = o.progress - k.progress;
        if (o === k || gap <= 0 || gap > 16 || Math.abs(o.lane - k.lane) > 2.5) continue;
        const room = here.width / 2 - 1.8;
        const side = k.lane >= o.lane ? 1 : -1;
        k.laneTarget = clamp(o.lane + side * 3.2, -room, room);
        if (Math.abs(k.laneTarget - o.lane) < 2.5) k.laneTarget = clamp(o.lane - side * 3.2, -room, room);
      }
      k.spinCool -= dt;
      if (k.spinCool <= 0 && k.spin <= 0 && k.id % 3 === 2) {
        k.spin = 1.2;
        k.spinCool = 16 + 10 * this.random();
        this.emit({ type: "hit", kart: k.id, by: null, cause: "slick" });
      } else if (k.spinCool <= 0) {
        k.spinCool = 12;
      }
      if (k.item && !k.rolling) {
        k.useIn -= dt;
        if (k.useIn <= 0) this.useItem(k);
      }
    }
    k.progress += k.speed * dt;
    const prevLane = k.lane;
    k.lane = damp(k.lane, k.laneTarget, 1.4, dt);
    const dLane = (k.lane - prevLane) / Math.max(dt, 1e-4);
    const p = g.point(k.progress, k.lane);
    k.x = p.x;
    k.y = p.y;
    k.z = p.z;
    const c = g.at(k.progress);
    const lean = Math.atan2(dLane, Math.max(5, k.speed));
    k.heading = Math.atan2(c.tx, c.tz) - lean;
    k.steer = damp(k.steer, clamp(c.curvature * 14 + lean * 3, -1, 1), 8, dt);

    // Drift through the tight bends, boost out of them.
    const tight = Math.abs(c.curvature) > 0.02 && k.speed > 14 && k.spin <= 0;
    if (tight && k.drift === 0) {
      k.drift = c.curvature > 0 ? 1 : -1;
      k.hopClock = 0.25;
      k.driftTime = 0;
      k.driftLevel = 0;
    } else if ((!tight || k.spin > 0) && k.drift !== 0) {
      if (k.driftLevel > 0) {
        k.boost = k.driftLevel === 1 ? 0.7 : 1.4;
        this.emit({ type: "boost", kart: k.id, source: "drift", level: k.driftLevel });
      }
      k.drift = 0;
      k.driftLevel = 0;
    }
    if (k.drift !== 0) {
      k.driftTime += dt;
      const level = k.driftTime > 2.2 ? 2 : k.driftTime > 1.0 ? 1 : 0;
      if (level > k.driftLevel) {
        k.driftLevel = level as 0 | 1 | 2;
        this.emit({ type: "drift-level", kart: k.id, level: level as 1 | 2 });
      }
    }
    if (raceTime > 0 && raceTime < 0.1 && k.id % 2 === 1 && k.boost <= 0) {
      k.boost = 1.0;
      this.emit({ type: "boost", kart: k.id, source: "start", level: 1 });
    }
    k.wrongWay = false;

    // A bump when this kart overlaps another.
    for (const o of this.karts) {
      if (o.id <= k.id || k.bumpCool > 0 || o.bumpCool > 0) continue;
      if (Math.hypot(o.x - k.x, o.z - k.z) < 2.0) {
        k.bumpCool = 0.8;
        o.bumpCool = 0.8;
        this.emit({ type: "bump", a: k.id, b: o.id, strength: 0.5 });
      }
    }
  }

  // ── Items and things ──────────────────────────────────────────────────────

  private useItem(k: Kart): void {
    if (!k.item) return;
    const item = k.item;
    this.emit({ type: "use", kart: k.id, item });
    const fx = Math.sin(k.heading);
    const fz = Math.cos(k.heading);
    if (item === "nitro" || item === "nitro3") {
      k.boost = 1.5;
      this.emit({ type: "boost", kart: k.id, source: "nitro", level: 1 });
    } else if (item === "puck") {
      this.things.push({ id: this.nextThing++, kind: "puck", x: k.x + fx * 2, y: k.y, z: k.z + fz * 2, heading: k.heading, active: true, owner: k.id, vx: fx * 40, vz: fz * 40, ttl: 5, back: 0.5 });
    } else if (item === "seeker") {
      this.things.push({ id: this.nextThing++, kind: "seeker", x: k.x + fx * 2, y: k.y, z: k.z + fz * 2, heading: k.heading, active: true, owner: k.id, vx: fx * 30, vz: fz * 30, ttl: 7, back: 0 });
    } else {
      this.things.push({ id: this.nextThing++, kind: "slick", x: k.x - fx * 2.6, y: k.y, z: k.z - fz * 2.6, heading: k.heading, active: true, owner: k.id, vx: 0, vz: 0, ttl: 30, back: 0.5 });
    }
    k.itemUses -= 1;
    if (k.itemUses <= 0) {
      k.item = null;
      k.itemUses = 0;
    } else {
      k.useIn = 1.5;
    }
  }

  private moveThings(dt: number): void {
    const g = this.geometry;
    for (const t of this.things) {
      t.ttl -= dt;
      t.back -= dt;
      if (t.kind === "puck") {
        t.x += t.vx * dt;
        t.z += t.vz * dt;
      } else if (t.kind === "seeker") {
        // Home on the nearest kart ahead of its owner.
        const owner = this.karts[t.owner]!;
        let target: Kart | null = null;
        let best = Infinity;
        for (const k of this.karts) {
          if (k.id === t.owner) continue;
          const ahead = k.progress - owner.progress;
          if (ahead > 0 && ahead < best) {
            best = ahead;
            target = k;
          }
        }
        if (target) {
          const want = Math.atan2(target.x - t.x, target.z - t.z);
          t.heading += clamp(angleDiff(t.heading, want), -4 * dt, 4 * dt);
        }
        t.vx = Math.sin(t.heading) * 36;
        t.vz = Math.cos(t.heading) * 36;
        t.x += t.vx * dt;
        t.z += t.vz * dt;
      }
      if (t.kind !== "slick") {
        const pr = g.project(t.x, t.z);
        t.y = pr.sample.y;
        if (t.kind === "puck") t.heading = Math.atan2(t.vx, t.vz);
      }
      if (t.back > 0) continue;
      for (const k of this.karts) {
        if (k.spin > 0 || k.finished !== null) continue;
        if (Math.hypot(k.x - t.x, k.z - t.z) < 1.5 && (t.kind !== "puck" || k.id !== t.owner || t.ttl < 4.5)) {
          k.spin = 1.2;
          k.speed *= 0.2;
          k.drift = 0;
          k.driftLevel = 0;
          this.emit({ type: "hit", kart: k.id, by: t.owner, cause: t.kind as "puck" | "seeker" | "slick" });
          if (t.kind !== "slick") t.ttl = 0;
          else t.ttl = Math.min(t.ttl, 30);
          if (t.kind === "slick") t.ttl = 0;
        }
      }
    }
    this.things = this.things.filter((t) => t.ttl > 0);
  }

  private pickups(dt: number): void {
    for (const b of this.boxes) {
      if (b.back > 0) {
        b.back -= dt;
        if (b.back <= 0) b.thing.active = true;
        continue;
      }
      for (const k of this.karts) {
        if (k.item || k.rolling || k.finished !== null) continue;
        if (Math.hypot(k.x - b.thing.x, k.z - b.thing.z) < 1.8) {
          b.thing.active = false;
          b.back = 3;
          k.rolling = true;
          k.rollClock = 1.0;
          this.emit({ type: "pickup", kart: k.id, item: "nitro" });
          break;
        }
      }
    }
  }

  view(): RaceView {
    const racing = this.clock >= COUNTDOWN;
    const me = this.karts[0]!;
    const views: KartView[] = this.karts.map((k) => ({
      id: k.id,
      surface: k.offroad ? "grass" : "road",
      trick: 0,
      rescue: 0,
      x: k.x,
      y: k.y,
      z: k.z,
      heading: k.heading,
      speed: k.speed,
      steer: k.steer,
      drift: k.drift,
      driftLevel: k.driftLevel,
      boost: k.boost,
      spin: k.spin,
      hop: k.hop,
      offroad: k.offroad,
      item: k.item,
      itemUses: k.itemUses,
      rolling: k.rolling,
      place: k.place,
      lap: k.lap,
      lapProgress: k.lapProgress,
      wrongWay: k.wrongWay,
      finished: k.finished,
    }));
    const things: ThingView[] = this.things.map((t) => ({ id: t.id, kind: t.kind, x: t.x, y: t.y, z: t.z, heading: t.heading, active: true }));
    if (this.boxesAsThings) for (const b of this.boxes) things.push({ ...b.thing });
    const events = this.events;
    this.events = [];
    return {
      tick: Math.round(this.tick),
      phase: me.finished !== null && this.clock - this.finishedAt > 3 ? "finished" : racing ? "racing" : "countdown",
      countdown: racing ? 0 : COUNTDOWN - this.clock,
      time: racing ? this.clock - COUNTDOWN : 0,
      laps: this.options.laps ?? this.track.laps,
      track: this.track,
      racers: this.racers,
      karts: views,
      things,
      events,
    };
  }
}

export function createDemoRace(track: TrackDef, options: { karts?: number; laps?: number; autoRestart?: boolean } = {}): DemoRace {
  return new DemoRace(track, options);
}
