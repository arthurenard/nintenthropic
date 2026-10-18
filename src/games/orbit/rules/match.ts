/**
 * Orbital Decay's rules: the passes and the breathers between them, the
 * debris director, every fragment's flight, split and strike, the seven
 * panes, the laser's heat, the drone's errands, the score and the secrets'
 * bookkeeping. It knows nothing about Three.js: the world feeds it time and
 * what each shot hit, and it answers through a MatchListener. With the same
 * random source and the same inputs it plays out exactly the same way.
 */
import type { Difficulty } from "../../../engine/types";
import { chance, pick, pickIndex, range, shuffle, type Random } from "../../../engine/rules/rng";
import { Fragment, shootable, tankShows, type Heading, type Tumble } from "./debris";
import { Drone, type DroneState } from "./drone";
import { breachNote, type Breach } from "./felled";
import { Laser, type LaserResult } from "./laser";
import { neighbourPane, paneById, type Layout, type PaneSpec } from "./layout";
import { arcTo, positionAt, rebase, strikeOf, velocityAt } from "./motion";
import { Glass, type Mark } from "./panes";
import { passSpec, type PassSpec } from "./passes";
import { Scorer, type Award, type PassBonuses } from "./scoring";
import { SECRET_NAMES, SECRETS_TOTAL, SecretTracker, type SecretId, type SecretShot } from "./secrets";
import {
  BREATHER,
  COST_SPEED_RANGE,
  CREW_SEAL,
  CURVE_ACCEL,
  DERELICT_DEPTH,
  DERELICT_SWAY,
  DERELICT_TURN,
  DIFFICULTY,
  DRONE_FROM_PASS,
  INTEGRITY_MAX,
  KINDS,
  PASS_INTRO,
  PASSED_AFTER,
  PIECE_SPREAD,
  SEAL_AT,
  SHARD_TUMBLE,
  SPLIT_KICK,
  SPLIT_SPREAD,
  TITLE_AT,
  TUMBLE_RATE,
  type DifficultyTuning,
  type Kind,
} from "./tuning";
import { add, addScaled, cross, dot, length, normalize, perpendicular, scale, sub, v3, type V3 } from "./vec";

/** What a shot found, as the world's ray casts worked it out. */
export type ShotTarget =
  | { kind: "debris"; id: number; distance: number }
  /** The Derelict's fuel tank, or its armoured body. */
  | { kind: "tank"; id: number; distance: number }
  | { kind: "body"; id: number; distance: number }
  | { kind: "drone" }
  | { kind: "secret"; shot: SecretShot }
  | { kind: "none" };

/** Everything the world shows and plays in answer to the rules. */
export interface MatchListener {
  banner(title: string, subtitle?: string): void;
  passStart(pass: number, spec: PassSpec): void;
  passClear(pass: number, bonuses: PassBonuses): void;
  /** The breather begins: the station crosses into the planet's shadow. */
  breather(next: number): void;
  /** The crew seals chips on these panes. */
  sealed(panes: number[]): void;
  /** A fragment comes (a piece of one included). */
  spawn(f: Fragment): void;
  vaporise(f: Fragment, award: Award): void;
  split(parent: Fragment, pieces: Fragment[], award: Award): void;
  /** A foil-wrapped piece's wrap is stripped. */
  stripped(f: Fragment, award: Award): void;
  tankHit(f: Fragment, hits: number, award: Award): void;
  breakup(f: Fragment, pieces: Fragment[], award: Award): void;
  /** A shot the Derelict's body shrugged off. */
  deflect(f: Fragment): void;
  /** It reached the glass. */
  strike(f: Fragment, mark: Mark, integrity: number): void;
  /** It rang the cupola's metal. */
  frameStrike(f: Fragment, point: V3): void;
  /** A miss has gone by. */
  passed(f: Fragment): void;
  /** Its proximity ring shows for the first time. */
  ring(f: Fragment): void;
  paneFailed(pane: number, breach: Breach): void;
  alarm(on: boolean): void;
  drone(event: "launch" | "arrive" | "done" | "home" | "back"): void;
  /** The drone was shot: what it cost, how many times this game, and whether it was at a pane, mending. */
  droneShot(award: Award, hits: number, mending: boolean): void;
  laser(event: "vent" | "vented" | "cooled" | "overheat"): void;
  streakUp(multiplier: number): void;
  score(value: number): void;
  secretFound(id: SecretId, name: string, found: number, total: number): void;
  /** A lightning flash shot in the storm: how many this breather, and whether the aurora came. */
  flashShot(count: number, aurora: boolean): void;
}

export type Phase = "ready" | "intro" | "pass" | "breather" | "failed";

export interface MatchOptions {
  random: Random;
  layout: Layout;
  listener: MatchListener;
  difficulty?: Difficulty;
  /**
   * How many variants of each kind the art has, and how many pre-fractured
   * pieces each variant splits into. Unsaid: one variant, and the kind's
   * own range of pieces.
   */
  variants?: Partial<Record<Kind, readonly number[]>>;
}

export interface Results {
  outcome: string;
  won: boolean;
  score: number;
  stats: { label: string; value: string }[];
  note?: string;
  secretsFound: number;
  secretsTotal: number;
}

/** Aimed at a pane, where on it: within this share of its radius from the centre. */
const ON_PANE = 0.55;
/** The chance a pane is picked, by id: the centre most, the corners of the view least. */
const PANE_WEIGHT: readonly number[] = [3.0, 1.0, 1.0, 1.3, 1.1, 1.1, 1.3];

/** Does the pane's glass face `from` (can something coming from there reach it from outside)? */
function faces(pane: PaneSpec, from: V3): boolean {
  return dot(normalize(sub(from, pane.center)), pane.normal) > 0.2;
}

export class Match {
  readonly random: Random;
  readonly layout: Layout;
  readonly difficulty: Difficulty;
  readonly tuning: Readonly<DifficultyTuning>;
  readonly glass = new Glass();
  readonly laser: Laser;
  readonly drone = new Drone();
  readonly scorer = new Scorer();
  readonly secrets = new SecretTracker();

  time = 0;
  phase: Phase = "ready";
  phaseT = 0;
  pass = 0;
  spec: PassSpec = passSpec(1);
  /** Every fragment of this pass, flying or ended. */
  fragments: Fragment[] = [];
  /**
   * The director sends the pass's debris and ends the pass when it is
   * gone. Off, nothing comes but what is sent by hand (the tests' and the
   * dev harness's staged moments), and the pass never ends.
   */
  director = true;
  /** What broke the glass, once it has. */
  breach: Breach | null = null;

  private readonly listener: MatchListener;
  private queue: Kind[] = [];
  private spawnTimer = 0;
  private nextId = 1;
  private lastLane = -1;
  private sealedThisBreather = false;
  private titled = false;
  private alarmOn = false;
  private readonly variants: Partial<Record<Kind, readonly number[]>>;
  private readonly eye: V3;
  private readonly forward: V3;

  constructor(options: MatchOptions) {
    this.random = options.random;
    this.layout = options.layout;
    this.listener = options.listener;
    this.difficulty = options.difficulty ?? "standard";
    this.tuning = DIFFICULTY[this.difficulty];
    this.laser = new Laser(this.tuning.heatFactor);
    this.variants = options.variants ?? {};
    this.eye = this.layout.eye;
    this.forward = normalize(this.layout.forward);
  }

  // --- the flow of a game -----------------------------------------------------

  start(pass = 1): void {
    this.beginPass(Math.max(1, Math.floor(pass)), true);
  }

  get over(): boolean {
    return this.phase === "failed";
  }

  /** Fragments of this pass still to deal with: in flight, and waiting to be sent. */
  get remaining(): number {
    let n = this.queue.length;
    for (const f of this.fragments) if (f.flying) n++;
    return n;
  }

  /** The fragments in flight now. */
  flying(): Fragment[] {
    return this.fragments.filter((f) => f.flying);
  }

  update(dt: number, offscreen: boolean): void {
    this.time += dt;
    this.phaseT += dt;
    const heat = this.laser.update(dt, offscreen && this.phase !== "failed");
    if (heat) this.listener.laser(heat);
    this.stepDrone(dt);
    switch (this.phase) {
      case "ready":
        return;
      case "intro":
        this.stepFragments();
        if (this.phase === "intro" && this.phaseT >= PASS_INTRO) this.beginCombat();
        break;
      case "pass":
        this.stepFragments();
        // A pane may have failed this very step: nothing more comes.
        if (this.phase !== "pass") break;
        if (!this.director) break;
        this.spawn(dt);
        this.checkClear();
        break;
      case "breather":
        this.stepFragments();
        if (this.phase !== "breather") break;
        if (!this.sealedThisBreather && this.phaseT >= SEAL_AT) {
          this.sealedThisBreather = true;
          const panes = this.glass.seal(CREW_SEAL);
          if (panes.length) this.listener.sealed(panes);
        }
        if (!this.titled && this.phaseT >= TITLE_AT) {
          this.titled = true;
          const next = passSpec(this.pass + 1);
          this.listener.banner(`Pass ${next.pass}`, next.subtitle);
        }
        if (this.phaseT >= BREATHER) this.beginPass(this.pass + 1, false);
        break;
      case "failed":
        this.stepFragments();
        break;
    }
    this.checkAlarm();
  }

  private beginPass(pass: number, intro: boolean): void {
    this.pass = pass;
    this.spec = passSpec(pass);
    this.queue = this.buildQueue(this.spec);
    this.fragments = this.fragments.filter((f) => f.flying);
    this.drone.hitThisPass = false;
    this.phaseT = 0;
    if (intro) {
      this.phase = "intro";
      this.listener.banner(`Pass ${pass}`, this.spec.subtitle);
    } else {
      this.beginCombat();
    }
  }

  private beginCombat(): void {
    this.phase = "pass";
    this.phaseT = 0;
    this.spawnTimer = 0.4;
    this.listener.passStart(this.pass, this.spec);
    // The Derelict comes first, from far out, and takes its time.
    if (this.spec.derelict) this.sendDerelict();
  }

  private checkClear(): void {
    if (this.queue.length > 0) return;
    for (const f of this.fragments) if (f.flying) return;
    const bonuses = this.scorer.endPass();
    this.listener.passClear(this.pass, bonuses);
    this.listener.score(this.scorer.score);
    this.phase = "breather";
    this.phaseT = 0;
    this.sealedThisBreather = false;
    this.titled = false;
    this.secrets.breather();
    this.listener.breather(this.pass + 1);
  }

  private checkAlarm(): void {
    const on = this.glass.alarm;
    if (on !== this.alarmOn) {
      this.alarmOn = on;
      this.listener.alarm(on);
    }
  }

  /** The drone works from the third pass. */
  get droneWorking(): boolean {
    return this.pass >= DRONE_FROM_PASS && this.phase !== "failed";
  }

  private stepDrone(dt: number): void {
    if (this.phase === "ready") return;
    const e = this.drone.update(dt, this.glass, this.droneWorking, this.tuning.droneRate);
    if (e) this.listener.drone(e);
  }

  // --- the director -------------------------------------------------------------

  /** The pass's fragments in the order they come: shuffled, the heavy ones not first on pass 1. */
  private buildQueue(spec: PassSpec): Kind[] {
    const kinds: Kind[] = [];
    for (const [k, n] of Object.entries(spec.mix) as [Kind, number][]) for (let i = 0; i < n; i++) kinds.push(k);
    shuffle(this.random, kinds);
    // The first thing a pass sends is light enough to read: a chunk or shrapnel.
    const light = kinds.findIndex((k) => k === "shrapnel" || k === "chunk");
    if (light > 0) [kinds[0], kinds[light]] = [kinds[light] as Kind, kinds[0] as Kind];
    return kinds;
  }

  /** Originals in flight (pieces not counted: they are the player's own doing). */
  private activeCount(): number {
    let n = 0;
    for (const f of this.fragments) if (f.flying && !f.parent && f.kind !== "derelict") n++;
    return n;
  }

  private spawn(dt: number): void {
    this.spawnTimer -= dt;
    if (this.spawnTimer > 0 || this.queue.length === 0) return;
    if (this.activeCount() >= this.spec.maxActive) return;
    const kind = this.queue.shift() as Kind;
    const first = this.send(kind);
    // Now and then two come together, down neighbouring lanes.
    if (this.queue.length > 0 && chance(this.random, this.spec.cluster)) {
      const beside = add(first.motion.p0, v3(range(this.random, -9, 9), range(this.random, -5, 5), range(this.random, -6, 6)));
      this.send(this.queue.shift() as Kind, undefined, { lane: beside });
    }
    this.spawnTimer = range(this.random, this.spec.gap[0], this.spec.gap[1]);
  }

  private variantOf(kind: Kind): number {
    const counts = this.variants[kind];
    return counts && counts.length > 0 ? pickIndex(this.random, counts.length) : 0;
  }

  private pickLane(facingPane?: PaneSpec): V3 {
    const lanes = this.layout.lanes;
    // For a pane named in advance, only a lane in front of it: from behind
    // its facet, the way in would be through the cupola.
    const usable = facingPane ? lanes.filter((l) => faces(facingPane, l)) : lanes;
    let lane: V3;
    if (usable.length === 0 && facingPane) {
      lane = addScaled(facingPane.center, facingPane.normal, 90);
    } else {
      // Never the same lane twice running (unless it is the only one).
      const avoid = usable === lanes && lanes.length > 1 ? this.lastLane : -1;
      let i = this.pickClear(usable, avoid);
      if (!this.layout.clear && i === avoid) i = (i + 1 + pickIndex(this.random, lanes.length - 1)) % lanes.length;
      if (usable === lanes) this.lastLane = i;
      lane = usable[i] as V3;
    }
    // A few metres either way, so no two come down exactly the same line.
    return add(lane, v3(range(this.random, -3, 3), range(this.random, -2, 2), range(this.random, -3, 3)));
  }

  /**
   * One of these lanes, the ones the player can see coming most often: a
   * lane mostly hidden behind the station is a fragment that appears from
   * nowhere at the last moment.
   */
  private pickClear(lanes: readonly V3[], avoid: number): number {
    const clear = this.layout.clear;
    if (!clear) return pickIndex(this.random, lanes.length);
    const weight = (i: number) => {
      if (i === avoid) return 0;
      const c = clear[this.layout.lanes.indexOf(lanes[i] as V3)] ?? 1;
      return 0.05 + c * c;
    };
    let total = 0;
    for (let i = 0; i < lanes.length; i++) total += weight(i);
    let r = this.random() * total;
    for (let i = 0; i < lanes.length; i++) {
      r -= weight(i);
      if (r <= 0 && weight(i) > 0) return i;
    }
    return lanes.length - 1 === avoid ? 0 : lanes.length - 1;
  }

  /** A pane that a fragment from `from` can reach, the centre most often, the corners of the view least. */
  private pickPane(from: V3): PaneSpec {
    const panes = this.layout.panes.filter((p) => faces(p, from));
    const pool = panes.length > 0 ? panes : this.layout.panes;
    let total = 0;
    for (const p of pool) total += PANE_WEIGHT[p.id] ?? 1;
    let r = this.random() * total;
    for (const p of pool) {
      r -= PANE_WEIGHT[p.id] ?? 1;
      if (r <= 0) return p;
    }
    return pool[pool.length - 1] as PaneSpec;
  }

  /** A point on a pane's glass, near its middle. */
  private pointOn(pane: PaneSpec): V3 {
    const u = perpendicular(pane.normal);
    const w = cross(pane.normal, u);
    const a = this.random() * Math.PI * 2;
    const r = Math.sqrt(this.random()) * pane.radius * ON_PANE;
    return add(add(pane.center, scale(u, Math.cos(a) * r)), scale(w, Math.sin(a) * r));
  }

  /** Where a miss goes by: beside the station, off toward the side of the view it came down. */
  private missPoint(from: V3): V3 {
    const fwd = this.forward;
    // The side the lane is on, across the view, and a little up or down.
    const side = sub(from, scale(fwd, dot(from, fwd)));
    const out = length(side) > 1 ? normalize(side) : normalize(cross(fwd, v3(0, 1, 0)));
    const off = range(this.random, 6, 12);
    return add(add(scale(out, off), scale(fwd, range(this.random, -1, 3))), v3(0, range(this.random, -2, 2), 0));
  }

  private tumbleFor(kind: Kind): Tumble {
    const axis = normalize(v3(this.random() - 0.5, this.random() - 0.5, this.random() - 0.5));
    const turns = kind === "shard" ? SHARD_TUMBLE : TUMBLE_RATE;
    const rate = range(this.random, turns[0], turns[1]) * Math.PI * 2 * (chance(this.random, 0.5) ? 1 : -1);
    return { axis: length(axis) > 0 ? axis : v3(0, 1, 0), rate, phase: this.random() * Math.PI * 2, face: perpendicular(axis) };
  }

  private bend(dir: V3): V3 {
    const side = perpendicular(dir);
    const turned = normalize(add(scale(side, Math.cos(this.random() * 6.28)), scale(cross(normalize(dir), side), Math.sin(this.random() * 6.28))));
    return scale(turned, range(this.random, CURVE_ACCEL[0], CURVE_ACCEL[1]));
  }

  /** Send one fragment of `kind` down a lane. */
  send(kind: Kind, heading?: Heading, at?: { lane?: V3; pane?: number; speed?: number }): Fragment {
    const spec = KINDS[kind];
    const named = at?.pane !== undefined ? paneById(this.layout, at.pane) : undefined;
    const from = at?.lane ?? this.pickLane(named);
    const speed = at?.speed ?? range(this.random, spec.speed[0], spec.speed[1]) * this.spec.speed * this.tuning.speedFactor;
    const roll = this.random();
    const h: Heading = heading ?? (roll < this.spec.panes ? "pane" : roll < this.spec.panes + this.spec.frame ? "frame" : "miss");
    let to: V3;
    if (h === "pane") to = this.pointOn(named ?? this.pickPane(from));
    else if (h === "frame") to = pick(this.random, this.layout.frame);
    else to = this.missPoint(from);
    const straight = sub(to, from);
    const duration = length(straight) / Math.max(0.5, speed);
    const motion = arcTo(from, to, this.time, duration, this.bend(straight));
    const f = new Fragment(this.nextId++, kind, this.variantOf(kind), this.time, motion, this.tumbleFor(kind), h);
    this.plot(f, duration);
    if (h === "frame" && !f.strike) f.frame = { point: to, time: this.time + duration };
    this.fragments.push(f);
    this.listener.spawn(f);
    return f;
  }

  /** Work out where (and whether) a fragment will reach the glass. */
  private plot(f: Fragment, horizon: number): void {
    f.strike = strikeOf(f.motion, this.time, horizon + 2, this.layout.panes);
    f.ringed = false;
    if (!f.strike) {
      f.passBy = this.time + horizon + PASSED_AFTER + 2;
      if (f.heading === "pane") f.frame = null;
    }
  }

  /** The Derelict: far out, slow, tumbling end over end, aimed at the centre pane. */
  sendDerelict(): Fragment {
    const spec = KINDS.derelict;
    const lanes = this.layout.lanes;
    // The lane the player can see most of the way in (if the layout says:
    // the boss must not hide behind the arm or a window frame), and of those
    // the nearest the middle of the view, pushed out to its depth.
    const clear = this.layout.clearWide ?? this.layout.clear;
    const score = (i: number) => (clear ? (clear[i] ?? 1) : 1) - 0.8 * Math.acos(Math.min(1, dot(normalize(lanes[i] as V3), this.forward)));
    let bestAt = 0;
    for (let i = 1; i < lanes.length; i++) if (score(i) > score(bestAt)) bestAt = i;
    const best = lanes[bestAt] as V3;
    const from = this.layout.derelictFrom ?? scale(normalize(best), DERELICT_DEPTH);
    const pane = paneById(this.layout, 0) ?? this.pickPane(from);
    const to = pane.center;
    const speed = range(this.random, spec.speed[0], spec.speed[1]) * this.tuning.speedFactor;
    const straight = sub(to, from);
    const duration = length(straight) / speed;
    // A long, slow flight: bent as the others are, it would wander tens of
    // metres off its line (behind the station). Held to a gentle arc.
    const bend = this.bend(straight);
    const most = (8 * DERELICT_SWAY) / (duration * duration);
    const motion = arcTo(from, to, this.time, duration, length(bend) > most ? scale(bend, most / length(bend)) : bend);
    const dir = normalize(straight);
    const axis = normalize(cross(dir, v3(0, 1, 0)));
    const tumble: Tumble = { axis, rate: (Math.PI * 2) / DERELICT_TURN, phase: this.random() * Math.PI * 2, face: normalize(cross(axis, dir)) };
    const f = new Fragment(this.nextId++, "derelict", 0, this.time, motion, tumble, "pane");
    this.plot(f, duration);
    this.fragments.push(f);
    this.listener.spawn(f);
    return f;
  }

  // --- flight -------------------------------------------------------------------

  private readonly here = v3();

  private stepFragments(): void {
    const t = this.time;
    const lead = this.tuning.ringLead;
    for (let i = 0; i < this.fragments.length; i++) {
      const f = this.fragments[i] as Fragment;
      if (!f.flying) continue;
      if (f.strike && t >= f.strike.time) {
        if (this.phase === "failed") {
          // The shutters are down: what arrives now rings off them.
          this.end(f, "struck");
          this.listener.frameStrike(f, f.strike.point);
          continue;
        }
        this.strike(f);
        continue;
      }
      if (f.frame && t >= f.frame.time) {
        this.end(f, "struck");
        this.listener.frameStrike(f, f.frame.point);
        continue;
      }
      if (!f.strike && !f.frame) {
        const p = positionAt(f.motion, t, this.here);
        if (dot(sub(p, this.eye), this.forward) < -PASSED_AFTER || t >= f.passBy) {
          this.end(f, "passed");
          this.listener.passed(f);
          continue;
        }
      }
      if (f.strike && !f.ringed && f.strike.time - t <= lead) {
        f.ringed = true;
        this.listener.ring(f);
      }
    }
  }

  private end(f: Fragment, state: Fragment["state"]): void {
    f.state = state;
    f.endedAt = this.time;
  }

  /** What a strike at `speed` costs a pane. */
  strikeCost(f: Fragment, speed: number): number {
    const spec = KINDS[f.kind];
    const mid = (spec.speed[0] + spec.speed[1]) / 2;
    const k = Math.min(COST_SPEED_RANGE[1], Math.max(COST_SPEED_RANGE[0], speed / mid));
    return Math.round(spec.cost * k * this.tuning.strikeFactor);
  }

  private strike(f: Fragment): void {
    const s = f.strike;
    if (!s) return;
    this.end(f, "struck");
    this.scorer.damaged();
    if (f.kind === "derelict") {
      // It takes the pane it strikes and a neighbour: everything on both.
      const second = neighbourPane(this.layout, s.pane, s.point);
      let failed = false;
      for (const pane of [s.pane, second?.id ?? s.pane]) {
        const left = this.glass.integrity[pane] ?? 0;
        const r = this.glass.strike(pane, Math.max(left, 1), pane === s.pane ? s.point : (second?.center ?? s.point), this.time);
        this.listener.strike(f, r.mark, this.glass.integrity[pane] ?? 0);
        failed = failed || r.failed;
      }
      if (failed) this.fail(s.pane, f, INTEGRITY_MAX);
      return;
    }
    const cost = this.strikeCost(f, s.speed);
    const earlier = this.glass.strikes[s.pane] ?? 0;
    const r = this.glass.strike(s.pane, cost, s.point, this.time);
    this.listener.strike(f, r.mark, this.glass.integrity[s.pane] ?? 0);
    if (r.failed) this.fail(s.pane, f, cost, earlier);
  }

  private fail(pane: number, f: Fragment, cost: number, earlier = 0): void {
    this.breach = {
      kind: f.kind,
      pieceOf: f.parent?.kind ?? null,
      pane,
      earlier,
      cost,
      droneShot: this.drone.hits > 0,
      pass: this.pass,
    };
    this.phase = "failed";
    this.phaseT = 0;
    this.listener.paneFailed(pane, this.breach);
  }

  // --- shooting -----------------------------------------------------------------

  /** The finger folds: fire, or not (hot, venting, too soon). */
  trigger(): LaserResult {
    if (this.phase === "failed") return "venting";
    const r = this.laser.trigger();
    if (r === "fired" && this.laser.locked) this.listener.laser("overheat");
    return r;
  }

  /** Vent the laser now (V on the keyboard). */
  vent(): boolean {
    if (this.phase === "failed") return false;
    const started = this.laser.vent();
    if (started) this.listener.laser("vent");
    return started;
  }

  /** Shots count toward accuracy and the streak only while there is debris to shoot. */
  private get counting(): boolean {
    return this.phase === "pass";
  }

  /** What the shot hit. Call once per shot fired, straight after trigger(). */
  resolveShot(target: ShotTarget): void {
    const scorer = this.scorer;
    switch (target.kind) {
      case "debris": {
        const f = this.fragments.find((x) => x.id === target.id);
        if (!f || !shootable(f, this.time, this.eye) || f.kind === "derelict") {
          if (this.counting) scorer.shot(false);
          return;
        }
        if (scorer.shot(true)) this.listener.streakUp(scorer.multiplier);
        this.hitDebris(f, target.distance);
        return;
      }
      case "tank": {
        const f = this.fragments.find((x) => x.id === target.id);
        if (!f || !tankShows(f, this.time, this.eye)) {
          if (f) this.listener.deflect(f);
          return;
        }
        if (scorer.shot(true)) this.listener.streakUp(scorer.multiplier);
        f.hitsLeft--;
        if (f.hitsLeft > 0) {
          const award = scorer.hit("tank", target.distance);
          this.listener.tankHit(f, KINDS.derelict.hits - f.hitsLeft, award);
          this.listener.score(scorer.score);
          return;
        }
        const award = scorer.hit("breakup", target.distance);
        const pieces = this.breakApart(f, "chunk", this.piecesFor(f));
        this.listener.breakup(f, pieces, award);
        this.listener.score(scorer.score);
        return;
      }
      case "body": {
        // The armour shrugs it off: neither a hit nor a miss.
        const f = this.fragments.find((x) => x.id === target.id);
        if (f) this.listener.deflect(f);
        return;
      }
      case "drone": {
        const award = scorer.drone();
        const mending = this.drone.pane !== null;
        this.drone.shot();
        this.listener.droneShot(award, this.drone.hits, mending);
        this.listener.score(scorer.score);
        return;
      }
      case "secret":
        this.secretShot(target.shot);
        return;
      default:
        if (this.counting) scorer.shot(false);
        return;
    }
  }

  private hitDebris(f: Fragment, distance: number): void {
    const scorer = this.scorer;
    if (f.kind === "foil" && f.wrapped) {
      f.wrapped = false;
      f.hitsLeft--;
      const award = scorer.hit("strip", distance);
      this.listener.stripped(f, award);
      this.listener.score(scorer.score);
      return;
    }
    const into = KINDS[f.kind].splitsInto;
    if (into) {
      // A chunk broken off a slab (or the Derelict) still splits, in two:
      // it has no pre-fractured pieces of its own.
      const award = scorer.hit("split", distance);
      const pieces = this.breakApart(f, into, f.parent ? 2 : this.piecesFor(f));
      this.listener.split(f, pieces, award);
      this.listener.score(scorer.score);
      return;
    }
    this.end(f, "vaporised");
    const award = scorer.hit("vaporise", distance);
    this.listener.vaporise(f, award);
    this.listener.score(scorer.score);
  }

  /** How many pieces it comes apart into: the art's pre-fractured count, or the kind's range. */
  private piecesFor(f: Fragment): number {
    const counts = this.variants[f.kind];
    const art = counts?.[f.variant];
    if (art !== undefined && art >= 2) return Math.min(f.kind === "derelict" ? 8 : 4, art);
    const [lo, hi] = KINDS[f.kind].pieces;
    return lo + pickIndex(this.random, hi - lo + 1);
  }

  /**
   * It comes apart where it is: `count` pieces of `into`, each with its
   * parent's velocity and bend plus a small kick outward - the momentum
   * kept - and each plotted afresh against the glass.
   */
  private breakApart(f: Fragment, into: Kind, count: number): Fragment[] {
    this.end(f, "split");
    const t = this.time;
    const pieces: Fragment[] = [];
    const v = velocityAt(f.motion, t);
    const dir = normalize(v);
    const side = perpendicular(dir);
    const up = cross(dir, side);
    // Where it was going, and when it would have got there.
    const mark = f.strike ? { point: f.strike.point, time: f.strike.time } : f.frame;
    for (let i = 0; i < count; i++) {
      // Spread round the direction of travel, evenly with a little jitter.
      const around = (i / count) * Math.PI * 2 + this.random() * 0.8;
      const out = normalize(add(scale(side, Math.cos(around)), scale(up, Math.sin(around))));
      const offset = scale(out, f.radius * SPLIT_SPREAD);
      let motion;
      if (mark && mark.time - t > 0.25) {
        // The momentum kept: the pieces fly on to where it was going,
        // spread round it (one pane, its neighbours, the frame), a little
        // sooner or later than it would have.
        const to = addScaled(mark.point, out, range(this.random, PIECE_SPREAD[0], PIECE_SPREAD[1]));
        const when = (mark.time - t) * range(this.random, 0.9, 1.1);
        motion = arcTo(add(positionAt(f.motion, t), offset), to, t, when, f.motion.a);
      } else {
        const kick = addScaled(scale(out, range(this.random, SPLIT_KICK[0], SPLIT_KICK[1])), dir, range(this.random, -0.6, 0.6));
        motion = rebase(f.motion, t, offset, kick);
      }
      const piece = new Fragment(this.nextId++, into, i, t, motion, this.tumbleFor(into), "pane", { id: f.id, kind: f.kind });
      // However far out it split, a piece has time to get anywhere near.
      this.plot(piece, 40);
      this.fragments.push(piece);
      pieces.push(piece);
      this.listener.spawn(piece);
    }
    return pieces;
  }

  private secretShot(shot: SecretShot): void {
    if (shot.secret === "storm") {
      const r = this.secrets.flash();
      this.listener.flashShot(r.count, r.aurora);
      if (r.aurora) this.found("storm");
      return;
    }
    this.found(shot.secret);
  }

  private found(id: SecretId): void {
    if (this.secrets.find(id)) this.listener.secretFound(id, SECRET_NAMES[id], this.secrets.count, SECRETS_TOTAL);
  }

  // --- the end --------------------------------------------------------------------

  results(): Results {
    const s = this.scorer;
    const survived = Math.max(0, this.pass - 1);
    return {
      outcome: `Breached on Pass ${this.pass}`,
      won: false,
      score: s.score,
      stats: [
        { label: "Passes", value: String(survived) },
        { label: "Cleared", value: String(s.vaporised) },
        { label: "Accuracy", value: `${Math.round(s.accuracy * 100)}%` },
        { label: "Best Streak", value: String(s.bestStreak) },
      ],
      ...(this.breach ? { note: breachNote(this.breach) } : {}),
      secretsFound: this.secrets.count,
      secretsTotal: SECRETS_TOTAL,
    };
  }

  /** The drone's state, for the world. */
  get droneState(): DroneState {
    return this.drone.state;
  }
}
