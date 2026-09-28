/**
 * Overwatch Ridge's rules: the stage director, the valley's alert, the minds
 * of everyone in it, the enemy's fire at the ridge, the player's health,
 * rifle and score, and the secrets' bookkeeping. It knows nothing about
 * three.js: the world feeds it time and, for each round, where it landed
 * (a round takes time to get there; the world flies it), and it answers
 * through a MissionListener. With the same random source and the same
 * inputs it plays out exactly the same way.
 */
import { damageDirection, PlayerHealth } from "../../../engine/rules/health";
import { chance, pick, range, shuffle, type Random } from "../../../engine/rules/rng";
import type { Difficulty } from "../../../engine/types";
import { Actor, VEHICLE_SPECS, Vehicle, type DeathClip } from "./actors";
import { jobFor, JOB_WORDS, stageSpec, stageTitle, type StageSpec } from "./jobs";
import { dist, flat, headingFrom, PathWalker, Polyline } from "./path";
import { Rifle, type TriggerResult } from "./rifle";
import { Scorer, type Award, type StageBonuses } from "./scoring";
import { NEAR_EAGLE, NEAR_GOAT, SECRET_NAMES, SECRETS_TOTAL, SecretTracker } from "./secrets";
import {
  ALERT_DECAY,
  BODY_NOTICE,
  BODY_SEEN_RADIUS,
  BREATHER,
  CONVOY_HALT,
  CONVOY_ROAD,
  CYCLE_SPEED,
  DIFFICULTY,
  DISMOUNT_GAP,
  DISMOUNT_TIME,
  ENGINE_HITS,
  FAIL_HOLD,
  FARMER_SPEED,
  HEALTH_MAX,
  JEEP_SPEED,
  MG_DAMAGE,
  MG_FIRST,
  MG_HIT_CHANCE,
  MG_INTERVAL,
  MISS_NEAR_ALERT,
  MISS_RADIUS,
  MORTAR_FLIGHT,
  MORTAR_HIT_CHANCE,
  MORTAR_HIT_DAMAGE,
  MORTAR_INTERVAL,
  MORTAR_NEAR_CHANCE,
  MORTAR_NEAR_DAMAGE,
  OFFICER_HURRY,
  PATROL_SPEED,
  REGEN_DELAY,
  REGEN_RATE,
  REPORT_ALERT,
  RUN_SPEED,
  SNIPER_DAMAGE,
  SNIPER_FIRST_SHOT,
  SNIPER_FOLLOW_UP,
  SNIPER_HIDDEN,
  SNIPER_HIT_CHANCE,
  SNIPER_HIT_GROWTH,
  SNIPER_HIT_MAX,
  SNIPER_RELOCATE,
  SNIPER_SCAN,
  SPEED_OF_SOUND,
  STAGE_INTRO,
  STARTLE_RADIUS,
  WALK_SPEED,
  WOUND_KNEEL,
  type DifficultyTuning,
} from "./tuning";
import type { Activity, Ending, HitPart, HostileRole, Landing, Plan, Post, SecretId, V3, VehicleKind } from "./types";
import { stageWind, Wind } from "./wind";
import { endingNote, endingOutcome } from "./notes";

/** Why the valley woke. */
export type AlertCause = "report" | "miss" | "wound" | "body" | "civilian" | "stopped";

/** A round that passed close by someone on its way (a crack overhead). */
export interface NearPass {
  id: number;
  /** Closest approach, metres. */
  distance: number;
}

export interface MissionListener {
  /** A stage's title card is up ("Stage 3 — Convoy"). */
  stageIntro(stage: number, spec: StageSpec, title: string, line: string): void;
  /** Its people start to move. */
  stageStart(stage: number, spec: StageSpec): void;
  stageClear(stage: number, bonuses: StageBonuses): void;
  /** The breather before the next: health back, the wind changing. */
  breather(next: number): void;
  spawn(a: Actor): void;
  gone(a: Actor): void;
  vehicleSpawn(v: Vehicle): void;
  vehicleGone(v: Vehicle): void;
  /** The valley is alerted. */
  alerted(cause: AlertCause, by: Actor | null): void;
  /** A lens catches the low sun toward the ridge: a scope (steady, before a shot) or binoculars (a flicker). */
  glint(a: Actor, seconds: number, kind: "scope" | "binoculars"): void;
  /** An enemy fires at the ridge. The world shows the flash, and the crack and the report come to you. */
  enemyFire(a: Actor, weapon: "sniper" | "mg", hit: boolean, damage: number): void;
  mortarLaunch(a: Actor, flight: number): void;
  mortarLand(outcome: "hit" | "near" | "far", damage: number, from: Actor): void;
  playerHit(damage: number, direction: number, hurt: number, by: HostileRole): void;
  playerDeath(ending: Ending): void;
  /** A job failed: the convoy crossed, the officer escaped. The run is over. */
  failed(ending: Ending): void;
  kill(a: Actor, part: HitPart, award: Award): void;
  wound(a: Actor, part: HitPart): void;
  /** Someone the valley lives with was hit: a civilian or an animal. */
  innocentHit(a: Actor, award: Award): void;
  vehicleHit(v: Vehicle, engine: boolean): void;
  vehicleStopping(v: Vehicle, why: "driver" | "engine"): void;
  engineStop(v: Vehicle, award: Award): void;
  dismount(a: Actor, v: Vehicle): void;
  /** Someone jumped at a round landing near them: a civilian ducks, a cow looks up. */
  startled(a: Actor): void;
  streakUp(multiplier: number): void;
  score(value: number): void;
  /** The rifle's mechanics, for their sounds and the magazine on the page. */
  rifle(event: "fired" | "spent" | "dry" | "busy" | "cycling" | "cycled" | "opened" | "reload" | "reloaded"): void;
  secretFound(id: SecretId, name: string, found: number, total: number): void;
  goatHop(a: Actor, ledge: number): void;
  eagleLands(a: Actor): void;
}

export type Phase = "ready" | "intro" | "combat" | "clear" | "breather" | "failed" | "dead";

export interface MissionOptions {
  random: Random;
  plan: Plan;
  listener: MissionListener;
  difficulty?: Difficulty;
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

interface Timer {
  at: number;
  run: () => void;
}

/** After the objective falls, a moment before the stage is called clear. */
const CLEAR_HOLD = 1.6;

export class Mission {
  readonly random: Random;
  readonly plan: Plan;
  readonly difficulty: Difficulty;
  readonly tuning: Readonly<DifficultyTuning>;
  readonly health = new PlayerHealth({ regenDelay: REGEN_DELAY, regenRate: REGEN_RATE }, HEALTH_MAX);
  readonly rifle = new Rifle();
  readonly scorer = new Scorer();
  readonly secrets = new SecretTracker();
  readonly wind: Wind;

  time = 0;
  phase: Phase = "ready";
  phaseT = 0;
  stage = 0;
  spec: StageSpec = stageSpec(1);
  /** The valley's suspicion this stage, 0..1; alerted at 1. */
  alert = 0;
  alerted = false;
  /** Alerted at any moment this stage (no Ghost bonus). */
  stageAlerted = false;
  stagesCleared = 0;
  ending: Ending | null = null;

  /** Everyone in the valley now: this stage's people, and the animals, who stay. */
  actors: Actor[] = [];
  vehicles: Vehicle[] = [];

  private readonly listener: MissionListener;
  private readonly timers: Timer[] = [];
  private nextId = 1;
  private readonly road: Polyline | null;
  private readonly bridgeS: number;
  private readonly damLine: Polyline | null;
  private clearAt = -1;
  /** The lead truck of a convoy stage. */
  private lead: Vehicle | null = null;
  private jeep: Vehicle | null = null;
  private officer: Actor | null = null;
  private cyclistNext = 0;
  private animalsMade = false;
  /** The mist's thickness for the world, 0..1: it burns off as the morning goes on. */
  mist = 1;

  constructor(options: MissionOptions) {
    this.random = options.random;
    this.plan = options.plan;
    this.listener = options.listener;
    this.difficulty = options.difficulty ?? "standard";
    this.tuning = DIFFICULTY[this.difficulty];
    this.wind = new Wind(this.random, this.tuning.maxWind);
    this.road = this.plan.road.length > 1 ? new Polyline(this.plan.road) : null;
    this.bridgeS = this.road ? this.road.nearest(this.plan.bridge) : 0;
    this.damLine = this.plan.dam.length > 1 ? new Polyline(this.plan.dam) : null;
  }

  // --- the run ------------------------------------------------------------------------

  start(stage = 1): void {
    this.time = 0;
    this.makeAnimals();
    this.beginStage(Math.max(1, Math.floor(stage)));
  }

  get over(): boolean {
    return this.phase === "dead" || this.phase === "failed";
  }

  /** The job's objectives still standing. */
  get remaining(): number {
    return this.actors.filter((a) => a.objective && a.alive).length;
  }

  get objectives(): number {
    return this.actors.filter((a) => a.objective).length;
  }

  /** A timed job's clock: seconds until the convoy's lead truck reaches the bridge, or the officer the tunnel. Null otherwise. */
  clock(): number | null {
    if (this.phase !== "combat" && this.phase !== "intro") return null;
    if (this.spec.job === "convoy") {
      const v = this.lead;
      if (!v || v.stopping || v.stopped) return null;
      const left = this.bridgeS - v.front;
      if (this.phase === "intro") return this.spec.time;
      return Math.max(0, left / Math.max(0.5, v.cruise));
    }
    if (this.spec.job === "officer") {
      const o = this.officer;
      if (!o || !o.alive) return null;
      return this.officerEta();
    }
    return null;
  }

  update(dt: number): void {
    if (this.phase === "ready") return;
    this.dt = dt;
    this.time += dt;
    this.phaseT += dt;
    this.runTimers();
    this.wind.update(dt);
    this.health.update(dt);
    const r = this.rifle.update(dt);
    if (r) this.listener.rifle(r);
    // The morning burns the mist off, slowly, over the run.
    this.mist = Math.max(0.15, this.spec.mist - this.phaseT * 0.004);

    switch (this.phase) {
      case "intro":
        this.stepPeople(dt, false);
        if (this.phaseT >= STAGE_INTRO) {
          this.phase = "combat";
          this.phaseT = 0;
          // The convoy sets off as the stage begins (the officer's jeep waits for him).
          for (const v of this.vehicles) if (v.kind === "truck") v.parked = false;
          this.listener.stageStart(this.stage, this.spec);
        }
        break;
      case "combat":
        this.stepPeople(dt, true);
        this.stepAlert(dt);
        this.checkStage();
        break;
      case "clear":
        this.stepPeople(dt, true);
        if (this.phaseT >= CLEAR_HOLD) this.endStage();
        break;
      case "breather":
        this.stepPeople(dt, false);
        if (this.phaseT >= BREATHER) this.beginStage(this.stage + 1);
        break;
      case "failed":
      case "dead":
        this.stepPeople(dt, false);
        break;
    }
  }

  // --- stages ------------------------------------------------------------------------

  private beginStage(stage: number): void {
    // Last stage's people leave (the animals stay).
    for (const a of this.actors) if (a.side !== "animal") this.listener.gone(a);
    for (const v of this.vehicles) this.listener.vehicleGone(v);
    this.actors = this.actors.filter((a) => a.side === "animal");
    this.vehicles = [];
    this.lead = null;
    this.jeep = null;
    this.officer = null;
    this.stage = stage;
    this.spec = stageSpec(stage, this.difficulty);
    this.alert = 0;
    this.alerted = false;
    this.stageAlerted = false;
    this.clearAt = -1;
    this.scorer.beginStage();
    this.health.heal();
    this.wind.set(stageWind(stage, this.random), this.stage === 1 ? 0 : 2.5);
    this.phase = "intro";
    this.phaseT = 0;
    this.cyclistNext = this.time + range(this.random, 4, 12);
    this.setUpJob();
    this.setUpLocals();
    const words = JOB_WORDS[this.spec.job];
    this.listener.stageIntro(stage, this.spec, stageTitle(stage), words.line);
  }

  private setUpJob(): void {
    const s = this.spec;
    switch (s.job) {
      case "sentries":
        this.setUpSentries(s.men);
        break;
      case "patrol":
        this.setUpPatrol(s.men);
        break;
      case "convoy":
        this.setUpConvoy(s.men);
        break;
      case "sniper":
        this.setUpSniper(true);
        break;
      case "officer":
        this.setUpOfficer(s.men);
        break;
    }
    if (s.sniper) this.setUpSniper(false);
    if (s.mortars) this.setUpMortars();
  }

  private newActor(side: Actor["side"], role: Actor["role"]): Actor {
    const a = new Actor(this.nextId++, side, role);
    a.deathClip = pick(this.random, ["death_back", "death_forward", "death_crumple"] as DeathClip[]);
    this.actors.push(a);
    return a;
  }

  private postActor(post: Post, objective: boolean): Actor {
    const role: HostileRole = post.kind === "tower" ? "tower" : post.kind === "gunner" ? "gunner" : post.kind === "guard" ? "guard" : post.kind === "mortar" ? "mortar" : "sentry";
    const a = this.newActor("hostile", role);
    a.placeAt(post.at);
    a.home.x = post.at.x;
    a.home.y = post.at.y;
    a.home.z = post.at.z;
    a.heading = post.heading;
    a.place = post.place;
    a.objective = objective;
    a.setState("quiet", range(this.random, 1, 5));
    a.act(role === "gunner" ? "crouch" : role === "tower" ? "binoculars" : chance(this.random, 0.5) ? "smoke" : "idle");
    this.listener.spawn(a);
    return a;
  }

  /** Stage 1 and its returns: sentries at the checkpoint and the tower (and further posts, later). */
  private setUpSentries(men: number): void {
    const posts = this.plan.posts.filter((p) => p.kind !== "mortar");
    if (!posts.length) return;
    const tower = posts.find((p) => p.kind === "tower") ?? posts[0]!;
    const byNear = [...posts].sort((a, b) => flat(a.at, tower.at) - flat(b.at, tower.at));
    // The tower, the gunner at the barrier and the nearest sentries first.
    const order: Post[] = [tower];
    const gunner = byNear.find((p) => p.kind === "gunner");
    if (gunner && men > 1) order.push(gunner);
    for (const p of byNear) if (!order.includes(p)) order.push(p);
    for (const p of order.slice(0, men)) this.postActor(p, true);
  }

  private setUpPatrol(men: number): void {
    if (this.plan.patrol.length < 2) return;
    const line = new Polyline(this.plan.patrol);
    const groups = Math.max(1, Math.ceil(men / 2));
    let made = 0;
    for (let g = 0; g < groups && made < men; g++) {
      // Two pairs walking toward each other from the ends of their beat.
      const forward = g % 2 === 0;
      const start = forward ? line.length * range(this.random, 0.05, 0.2) : line.length * range(this.random, 0.8, 0.95);
      for (let k = 0; k < 2 && made < men; k++, made++) {
        const a = this.newActor("hostile", "patrol");
        a.walker = new PathWalker(line, "pingpong", start - (forward ? 1 : -1) * k * 2.4, PATROL_SPEED * this.spec.pace);
        a.walker.direction = forward ? 1 : -1;
        a.spacing = k * 2.4;
        a.walker.pointAt(a.pos);
        a.heading = a.walker.heading();
        a.place = "on the river road";
        a.objective = true;
        a.setState("walk", range(this.random, 8, 16));
        a.act("patrol_walk");
        this.listener.spawn(a);
      }
    }
  }

  private setUpConvoy(men: number): void {
    const road = this.road;
    if (!road) return;
    const trucks = 2 + (this.spec.round >= 2 ? 1 : 0);
    const half = VEHICLE_SPECS.truck.length / 2;
    const startS = Math.max(half, this.bridgeS - CONVOY_ROAD);
    // The checkpoint's barrier, if the road passes one: the convoy halts there a moment.
    const guard = this.plan.posts.find((p) => p.kind === "guard");
    const barrier = guard ? road.nearest(guard.at) : -1;
    const halts = barrier > startS + half + 20 && barrier < this.bridgeS - 10;
    // Its speed brings the lead truck's front to the bridge `time` seconds after it sets off,
    // allowing for the halt and for pulling away and braking.
    const driving = Math.max(10, this.spec.time - (halts ? CONVOY_HALT + 4 : 2));
    const speed = (this.bridgeS - (startS + half)) / driving;
    let leader: Vehicle | null = null;
    for (let i = 0; i < trucks; i++) {
      const v = new Vehicle(this.nextId++, "truck", road, Math.max(0, startS - i * 15), speed);
      if (halts) v.haltAt(barrier - 3 - i * 15, CONVOY_HALT);
      v.leader = leader;
      v.parked = true;
      leader = v;
      this.vehicles.push(v);
      this.listener.vehicleSpawn(v);
      if (i === 0) this.lead = v;
      const driver = this.newActor("hostile", "driver");
      driver.vehicle = v;
      driver.seat = "driver";
      driver.objective = true;
      driver.place = "on the road";
      driver.act("drive");
      this.seat(driver);
      this.listener.spawn(driver);
      for (let k = 0; k < men; k++) {
        const t = this.newActor("hostile", "trooper");
        t.vehicle = v;
        t.seat = "back";
        t.seatIndex = k;
        t.hidden = true;
        t.objective = true;
        t.place = "on the road";
        t.act("hidden");
        this.seat(t);
        this.listener.spawn(t);
      }
    }
  }

  /** Where a rider is: in his seat, moving with his vehicle. */
  private seat(a: Actor): void {
    const v = a.vehicle;
    if (!v) return;
    const spec = VEHICLE_SPECS[v.kind];
    const local = a.seat === "driver" ? spec.driver : { x: 0, y: 1.3, z: spec.tail + 1 + a.seatIndex * 0.6 };
    v.toWorld(local, a.pos);
    a.heading = v.heading;
    a.vel.x = v.vel.x;
    a.vel.y = 0;
    a.vel.z = v.vel.z;
  }

  private setUpSniper(objective: boolean): void {
    const nests = this.plan.nests;
    if (!nests.length) return;
    const a = this.newActor("hostile", "sniper");
    a.nest = pick(this.random, nests);
    a.placeAt(a.nest.hidden);
    a.heading = a.nest.heading;
    a.place = a.nest.place;
    a.hidden = true;
    a.objective = objective;
    a.act("hidden");
    a.setState("hidden", range(this.random, SNIPER_HIDDEN[0], SNIPER_HIDDEN[1]) + (objective ? 1.5 : 6));
    a.nextFire = SNIPER_FIRST_SHOT + (objective ? 0 : 6);
    this.listener.spawn(a);
  }

  private setUpOfficer(men: number): void {
    const line = this.damLine;
    if (!line) return;
    const jeep = new Vehicle(this.nextId++, "jeep", line, VEHICLE_SPECS.jeep.length / 2, JEEP_SPEED * this.spec.pace);
    jeep.parked = true;
    this.jeep = jeep;
    this.vehicles.push(jeep);
    this.listener.vehicleSpawn(jeep);
    const o = this.newActor("hostile", "officer");
    this.officer = o;
    const beat = new Polyline([line.pointAt(6, { x: 0, y: 0, z: 0 }), line.pointAt(Math.min(line.length * 0.4, 28), { x: 0, y: 0, z: 0 })]);
    o.walker = new PathWalker(beat, "pingpong", beat.length * 0.5, WALK_SPEED * 0.55);
    o.walker.pointAt(o.pos);
    o.heading = o.walker.heading();
    o.place = "on the dam";
    o.objective = true;
    // His inspection runs from the moment the stage begins, after its title card.
    o.setState("inspect", this.spec.time + STAGE_INTRO);
    o.act("walk");
    this.listener.spawn(o);
    // His guards stand on the dam road near the jeep.
    for (let k = 0; k < men; k++) {
      const g = this.newActor("hostile", "guard");
      line.pointAt(Math.min(line.length * 0.5, 4 + k * 9), g.pos);
      g.pos.x += (k % 2 === 0 ? 1 : -1) * 2.2;
      g.home.x = g.pos.x;
      g.home.y = g.pos.y;
      g.home.z = g.pos.z;
      g.heading = headingFrom(g.pos, this.plan.eye);
      g.place = "on the dam";
      g.setState("quiet", range(this.random, 2, 6));
      g.act(chance(this.random, 0.5) ? "smoke" : "idle");
      this.listener.spawn(g);
    }
  }

  private setUpMortars(): void {
    const posts = this.plan.posts.filter((p) => p.kind === "mortar");
    if (!posts.length) return;
    const post = posts[(this.stage - 1) % posts.length]!;
    for (let k = 0; k < 2; k++) {
      const a = this.postActor({ ...post, at: { x: post.at.x + (k === 0 ? -1.2 : 1.2), y: post.at.y, z: post.at.z } }, false);
      a.act("crouch");
      a.nextFire = range(this.random, MORTAR_INTERVAL[0], MORTAR_INTERVAL[1]) * 0.5;
    }
  }

  /** The people the valley lives with, this stage. */
  private setUpLocals(): void {
    const s = this.spec;
    if (s.farmer && this.plan.farmer.length > 1) {
      const f = this.newActor("civilian", "farmer");
      const line = new Polyline(this.plan.farmer);
      f.walker = new PathWalker(line, "pingpong", line.length * this.random(), FARMER_SPEED);
      f.walker.pointAt(f.pos);
      f.place = "in the pasture";
      f.setState("walk", range(this.random, 6, 12));
      f.act("walk");
      this.listener.spawn(f);
    }
    if (s.shepherd && this.plan.shepherd.length > 1) {
      const p = this.newActor("civilian", "shepherd");
      const line = new Polyline(this.plan.shepherd);
      p.walker = new PathWalker(line, "pingpong", line.length * this.random(), 0.5);
      p.walker.pointAt(p.pos);
      p.place = "on the far slope";
      p.setState("walk", range(this.random, 8, 14));
      p.act("walk");
      this.listener.spawn(p);
    }
    if (s.children) {
      const n = 2 + (this.random() < 0.5 ? 1 : 0);
      for (let k = 0; k < n; k++) {
        const c = this.newActor("civilian", "child");
        c.scale = 0.65;
        const ang = (k / n) * Math.PI * 2 + this.random();
        c.home.x = this.plan.chapel.x + Math.cos(ang) * 4;
        c.home.y = this.plan.chapel.y;
        c.home.z = this.plan.chapel.z + Math.sin(ang) * 4;
        c.placeAt(c.home);
        c.place = "by the chapel";
        c.setState("play", range(this.random, 2, 5));
        c.act("idle");
        this.listener.spawn(c);
      }
    }
  }

  /** The animals are there before the first stage and stay for the run. */
  private makeAnimals(): void {
    if (this.animalsMade) return;
    this.animalsMade = true;
    for (const p of this.plan.cows) {
      const c = this.newActor("animal", "cow");
      c.placeAt(p);
      c.home.x = p.x;
      c.home.y = p.y;
      c.home.z = p.z;
      c.heading = this.random() * Math.PI * 2;
      c.place = "in the pasture";
      c.setState("graze", range(this.random, 3, 10));
      c.act("graze");
      this.listener.spawn(c);
    }
    for (const p of this.plan.sheep) {
      const c = this.newActor("animal", "sheep");
      c.placeAt(p);
      c.home.x = p.x;
      c.home.y = p.y;
      c.home.z = p.z;
      c.heading = this.random() * Math.PI * 2;
      c.place = "on the far slope";
      c.setState("graze", range(this.random, 3, 10));
      c.act("graze");
      this.listener.spawn(c);
    }
    const ledge = this.plan.goatLedges[0];
    if (ledge) {
      const g = this.newActor("animal", "goat");
      g.placeAt(ledge);
      g.heading = headingFrom(ledge, this.plan.eye);
      g.place = "on a ledge";
      g.act("stand");
      this.listener.spawn(g);
    }
    if (this.plan.eagle.length > 1) {
      const e = this.newActor("animal", "eagle");
      e.walker = new PathWalker(new Polyline(this.plan.eagle), "loop", 0, 11);
      e.walker.pointAt(e.pos);
      e.place = "in the sky";
      e.act("glide");
      this.listener.spawn(e);
    }
    if (this.plan.duck.length > 1) {
      const d = this.newActor("animal", "duck");
      d.walker = new PathWalker(new Polyline(this.plan.duck), "loop", 0, 0.9);
      d.walker.pointAt(d.pos);
      d.place = "on the river";
      d.act("float");
      this.listener.spawn(d);
    }
    const dog = this.newActor("animal", "dog");
    dog.home.x = this.plan.farm.x;
    dog.home.y = this.plan.farm.y;
    dog.home.z = this.plan.farm.z;
    dog.placeAt(dog.home);
    dog.place = "at the farm";
    dog.setState("idle", range(this.random, 3, 8));
    dog.act("idle");
    this.listener.spawn(dog);
  }

  private checkStage(): void {
    if (this.phase !== "combat") return;
    const s = this.spec;
    if (s.job === "convoy") {
      const v = this.lead;
      if (v && !v.stopping && !v.stopped && v.front >= this.bridgeS) {
        this.fail({ kind: "convoy" });
        return;
      }
    }
    if (s.job === "officer") {
      const o = this.officer;
      if (o && o.alive && o.state === "gone") {
        this.fail({ kind: "officer" });
        return;
      }
    }
    // The convoy is only stopped when its lead truck is.
    const leadHeld = s.job !== "convoy" || !this.lead || this.lead.stopping !== null || this.lead.stopped;
    if (leadHeld && this.objectives > 0 && this.remaining === 0) {
      if (this.clearAt < 0) this.clearAt = this.time;
      if (this.time - this.clearAt >= 0.2) {
        this.phase = "clear";
        this.phaseT = 0;
      }
    }
  }

  private endStage(): void {
    const left = this.spec.job === "convoy" || this.spec.job === "officer" ? this.timeLeftForBonus() : null;
    const bonuses = this.scorer.endStage(!this.stageAlerted, left);
    this.stagesCleared++;
    this.listener.stageClear(this.stage, bonuses);
    this.listener.score(this.scorer.score);
    this.phase = "breather";
    this.phaseT = 0;
    this.health.heal();
    this.listener.breather(this.stage + 1);
  }

  /** What was left on a timed job's clock when it was done. */
  private timeLeftForBonus(): number {
    if (this.spec.job === "convoy") {
      const v = this.lead;
      if (!v) return 0;
      return Math.max(0, (this.bridgeS - v.front) / Math.max(0.5, v.cruise));
    }
    return this.lastOfficerEta;
  }

  private lastOfficerEta = 0;
  /** This frame's step, for the minds' movements. */
  private dt = 1 / 60;

  private fail(ending: Ending): void {
    if (this.over) return;
    this.ending = ending;
    this.phase = "failed";
    this.phaseT = 0;
    this.listener.failed(ending);
  }

  /** How long the failed job's last moment lasts before the results. */
  get failHold(): number {
    return FAIL_HOLD;
  }

  // --- the player's rifle ----------------------------------------------------------------

  /** The finger on the trigger. "fired" means a round is on its way: the world flies it and calls land(). */
  trigger(): TriggerResult {
    if (this.over) return "busy";
    const r = this.rifle.trigger();
    if (r !== "fired") {
      this.listener.rifle(r);
      return r;
    }
    this.listener.rifle("fired");
    if (this.phase === "combat" || this.phase === "intro" || this.phase === "clear") {
      this.scorer.shot();
      this.reportHeard();
    }
    return r;
  }

  /** The thumb raised after a shot: work the bolt. */
  cycle(): boolean {
    if (!this.rifle.cycle()) return false;
    this.listener.rifle("cycling");
    return true;
  }

  requestReload(): boolean {
    if (this.over) return false;
    if (!this.rifle.reload()) return false;
    this.listener.rifle("reload");
    return true;
  }

  /** The valley hears the rifle about a second later: a little more suspicion. */
  private reportHeard(): void {
    let nearest = Number.POSITIVE_INFINITY;
    for (const a of this.actors) if (a.hostile && a.alive) nearest = Math.min(nearest, dist(a.pos, this.plan.eye));
    if (!Number.isFinite(nearest)) return;
    const stage = this.stage;
    this.later(nearest / SPEED_OF_SOUND, () => {
      if (this.stage !== stage || this.phase !== "combat") return;
      this.raise(REPORT_ALERT * this.tuning.alertFactor, "report", null);
    });
  }

  // --- where the round landed ---------------------------------------------------------------

  /**
   * A round arrived. `near` lists everyone it passed close by on the way (the
   * world measures the closest approach of its path): a crack overhead
   * startles a man, and the eagle and the goat have their own ideas.
   */
  land(landing: Landing, near: readonly NearPass[] = []): void {
    const t = landing.target;
    const inPlay = this.phase === "combat" || this.phase === "intro" || this.phase === "clear";
    let missed = true;
    switch (t.kind) {
      case "actor": {
        const a = this.actors.find((x) => x.id === t.id);
        if (a && a.role === "duck") {
          // A rubber duck is no animal: it bobs, and that is a secret.
          missed = false;
          this.found("duck");
        } else if (a && a.alive) {
          missed = false;
          if (a.side === "hostile") this.hostileHit(a, t.part, landing.range);
          else this.innocentHit(a);
        }
        break;
      }
      case "engine":
      case "vehicle": {
        const v = this.vehicles.find((x) => x.id === t.vehicle);
        if (v) {
          if (t.kind === "engine") {
            missed = false;
            this.engineHit(v, landing.range);
          } else {
            this.listener.vehicleHit(v, false);
          }
        }
        break;
      }
      case "secret":
        missed = false;
        this.secretShot(t.secret, landing);
        break;
      case "plate":
        missed = false;
        break;
      default:
        break;
    }
    if (missed && inPlay) this.scorer.breakStreak();
    this.nearMisses(landing, near, missed);
  }

  private nearMisses(landing: Landing, near: readonly NearPass[], missed: boolean): void {
    const p = landing.point;
    const hitId = landing.target.kind === "actor" ? landing.target.id : -1;
    for (const a of this.actors) {
      if (!a.alive || a.id === hitId) continue;
      const passed = near.find((n) => n.id === a.id)?.distance ?? Number.POSITIVE_INFINITY;
      const d = Math.min(dist(a.pos, p), passed);
      if (a.side === "hostile") {
        if (!missed || this.phase !== "combat") continue;
        if (d < MISS_RADIUS) {
          this.raise(MISS_NEAR_ALERT * (1 - d / MISS_RADIUS) * this.tuning.alertFactor, "miss", a);
          if (d < STARTLE_RADIUS) this.startle(a);
        }
      } else if (a.role === "eagle") {
        if (passed < NEAR_EAGLE && a.activity !== "perched" && a.activity !== "land" && this.secrets.eagleNearMiss()) this.eagleDown(a);
      } else if (a.role === "goat") {
        if (d < NEAR_GOAT) this.goatHop(a);
      } else if (d < (a.side === "animal" ? 30 : 25)) {
        this.startle(a);
      }
    }
  }

  private startle(a: Actor): void {
    if (!a.alive) return;
    if (a.side === "hostile") {
      // A round cracking past: he ducks and looks up at the ridge for a moment.
      // Only the valley's alert (raise) sends him to search it for good.
      if (a.seat === null && a.role !== "sniper" && !a.alerted) a.flinch = range(this.random, 2.5, 4);
      this.listener.startled(a);
      return;
    }
    if (a.role === "cow" || a.role === "sheep") {
      a.setState("look", range(this.random, 2.5, 4));
      a.act("look_up");
    } else if (a.role === "farmer" || a.role === "child" || a.role === "shepherd") {
      a.setState("duck", range(this.random, 3.5, 5.5));
      a.act("duck");
    } else if (a.role === "cyclist") {
      a.setState("hurry", 6);
    }
    this.listener.startled(a);
  }

  private hostileHit(a: Actor, part: HitPart, rangeM: number): void {
    const inPlay = this.phase === "combat" || this.phase === "intro" || this.phase === "clear";
    if (inPlay) this.scorer.hit();
    // A prone man in a ghillie suit is hit along his length: one round is enough.
    // A driver in his cab has nowhere to go: one round through the glass is enough.
    const lethal = part === "head" || a.wounds >= 1 || a.role === "sniper" || a.activity === "prone" || a.activity === "prone_aim" || a.seat === "driver";
    if (!lethal) {
      a.wounds++;
      if (inPlay) this.scorer.breakStreak();
      a.setState("wounded", WOUND_KNEEL);
      a.act("wound");
      a.still();
      this.listener.wound(a, part);
      this.raise(1, "wound", a);
      return;
    }
    const oneShot = a.wounds === 0;
    const kind = a.role === "officer" ? "officer" : a.role === "sniper" ? "sniper" : a.role === "driver" && a.seat === "driver" ? "driver" : part === "head" ? "headshot" : "body";
    const before = this.scorer.multiplier;
    const award = inPlay ? this.scorer.kill(kind, rangeM, oneShot) : { points: 0, labels: [] };
    this.die(a);
    this.listener.kill(a, part, award);
    if (inPlay) {
      this.listener.score(this.scorer.score);
      if (this.scorer.multiplier > before) this.listener.streakUp(this.scorer.multiplier);
    }
    // A driver down: his vehicle rolls to a stop.
    if (a.seat === "driver" && a.vehicle && !a.vehicle.stopped && !a.vehicle.parked) {
      a.vehicle.stop("driver");
      this.listener.vehicleStopping(a.vehicle, "driver");
    }
  }

  private die(a: Actor): void {
    a.alive = false;
    a.hidden = false;
    a.diedAt = this.time;
    a.still();
    a.walker = null;
    a.act("dying");
    a.setState("dying", 1.5);
  }

  private innocentHit(a: Actor): void {
    const inPlay = this.phase === "combat" || this.phase === "intro" || this.phase === "clear" || this.phase === "breather";
    if (!inPlay) return;
    let award: Award;
    if (a.side === "civilian") {
      award = this.scorer.civilian();
      // "...and one more alert."
      this.raise(1, "civilian", a);
    } else {
      award = this.scorer.animal(animalName(a.role));
    }
    this.die(a);
    this.listener.innocentHit(a, award);
    this.listener.score(this.scorer.score);
  }

  private engineHit(v: Vehicle, rangeM: number): void {
    if (v.steaming) return;
    const inPlay = this.phase === "combat" || this.phase === "intro" || this.phase === "clear";
    if (inPlay) this.scorer.hit();
    v.engineHits++;
    this.listener.vehicleHit(v, true);
    if (v.engineHits < ENGINE_HITS) return;
    if (inPlay) {
      const award = this.scorer.engineStop(rangeM);
      this.listener.engineStop(v, award);
      this.listener.score(this.scorer.score);
    }
    if (!v.stopped && !v.parked) {
      v.stop("engine");
      this.listener.vehicleStopping(v, "engine");
    }
    if (v.parked) {
      // A dead engine in a parked jeep: it will not go anywhere now.
      v.parked = false;
      v.stopped = true;
    }
  }

  // --- the alert -------------------------------------------------------------------------

  private raise(amount: number, cause: AlertCause, by: Actor | null): void {
    if (this.phase !== "combat" && this.phase !== "intro") return;
    this.alert = Math.min(1.5, this.alert + amount);
    if (this.alert >= 1 && !this.alerted) this.wake(cause, by);
  }

  private wake(cause: AlertCause, by: Actor | null): void {
    this.alerted = true;
    this.stageAlerted = true;
    this.alert = Math.max(1, this.alert);
    for (const a of this.actors) {
      if (!a.hostile || !a.alive) continue;
      a.alerted = true;
      if (a.role === "gunner") a.nextFire = this.time + range(this.random, MG_FIRST[0], MG_FIRST[1]);
      if (a.role === "mortar") a.nextFire = Math.min(a.nextFire, this.time + range(this.random, 3, 6));
    }
    this.listener.alerted(cause, by);
  }

  private stepAlert(dt: number): void {
    if (!this.alerted) this.alert = Math.max(0, this.alert - ALERT_DECAY * dt);
    // A body in plain sight: whoever is near it notices, after a moment.
    if (this.alerted) return;
    const bodies = this.actors.filter((a) => a.hostile && !a.alive);
    if (!bodies.length) return;
    for (const a of this.actors) {
      if (!a.hostile || !a.alive || a.hidden) continue;
      let seen = false;
      for (const b of bodies) if (flat(a.pos, b.pos) < BODY_SEEN_RADIUS) seen = true;
      if (!seen) {
        a.notice = -1;
        continue;
      }
      if (a.notice < 0) a.notice = range(this.random, BODY_NOTICE[0], BODY_NOTICE[1]) / this.tuning.alertFactor;
      a.notice -= dt;
      if (a.notice <= 0) {
        this.raise(1, "body", a);
        return;
      }
    }
  }

  // --- people ------------------------------------------------------------------------------

  private stepPeople(dt: number, live: boolean): void {
    for (const v of this.vehicles) v.update(dt);
    for (const a of this.actors) {
      a.t += dt;
      a.activityT += dt;
      if (!a.alive) {
        if (a.state === "dying" && a.t >= a.dur) {
          a.setState("dead", 0);
          a.act("dead");
        }
        if (a.vehicle && a.seat) this.seat(a);
        continue;
      }
      switch (a.side) {
        case "hostile":
          this.hostileMind(a, dt, live);
          break;
        case "civilian":
          this.civilianMind(a, dt);
          break;
        case "animal":
          this.animalMind(a, dt);
          break;
      }
    }
    if (live) this.stepCyclist();
  }

  private hostileMind(a: Actor, dt: number, live: boolean): void {
    if (a.state === "wounded") {
      // He stays down on his knee, clutching his side: in sight, to be finished.
      if (a.t >= a.dur) a.setState("down", 1e9);
      return;
    }
    if (a.state === "down") return;
    if (a.flinch > 0) {
      a.flinch -= dt;
      if (a.alerted) a.flinch = 0;
      else {
        a.act("crouch");
        a.still();
        this.face(a, this.plan.eye, 1);
        if (a.flinch <= 0) a.act("idle");
        return;
      }
    }
    switch (a.role) {
      case "sentry":
      case "guard":
      case "tower":
        this.sentryMind(a, live);
        break;
      case "gunner":
        this.gunnerMind(a, live);
        break;
      case "patrol":
        this.patrolMind(a, dt);
        break;
      case "driver":
      case "trooper":
        this.riderMind(a, dt);
        break;
      case "officer":
        this.officerMind(a, dt);
        break;
      case "sniper":
        this.sniperMind(a, live);
        break;
      case "mortar":
        this.mortarMind(a, live);
        break;
    }
  }

  /** Quiet: standing about, smoking, a few steps, a look through the glasses. Alerted: down, and searching the ridge. */
  private sentryMind(a: Actor, live: boolean): void {
    if (a.alerted && live) {
      this.searchCycle(a);
      return;
    }
    if (a.t < a.dur) {
      if (a.state === "stroll" || a.state === "back") this.walkTo(a, a.state === "stroll" ? this.strollSpot(a) : a.home, WALK_SPEED * 0.8);
      return;
    }
    // Something else to do.
    if (a.state === "stroll") {
      a.setState("back", 5);
      a.act("walk");
      return;
    }
    const tower = a.role === "tower";
    const roll = this.random();
    if (!tower && roll < 0.25) {
      a.setState("stroll", range(this.random, 2, 3.5));
      a.act("walk");
    } else if (roll < (tower ? 0.55 : 0.5)) {
      a.setState("quiet", range(this.random, 4, 8));
      a.act("binoculars");
      if (tower) this.listener.glint(a, 0.35, "binoculars");
    } else if (roll < 0.8) {
      a.setState("quiet", range(this.random, 5, 9));
      a.act("smoke");
    } else {
      a.setState("quiet", range(this.random, 3, 6));
      a.act("idle");
    }
    // Back at his post he faces the way it looks.
    const post = this.plan.posts.find((p) => p.at.x === a.home.x && p.at.z === a.home.z);
    if (post) a.heading = post.heading;
    a.still();
  }

  /** A few metres out from his post, along the way he faces. */
  private strollSpot(a: Actor): Actor["home"] {
    const side = (a.id % 2 === 0 ? 1 : -1) * 3;
    return { x: a.home.x + Math.cos(a.heading) * side, y: a.home.y, z: a.home.z - Math.sin(a.heading) * side };
  }

  private walkTo(a: Actor, to: Actor["home"], speed: number): boolean {
    const dx = to.x - a.pos.x;
    const dz = to.z - a.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.15) {
      a.still();
      return true;
    }
    const step = Math.min(d, speed * this.dt);
    a.vel.x = (dx / d) * speed;
    a.vel.z = (dz / d) * speed;
    a.vel.y = 0;
    a.pos.x += (dx / d) * step;
    a.pos.z += (dz / d) * step;
    a.pos.y += ((to.y - a.pos.y) * step) / Math.max(step, d);
    a.heading = Math.atan2(dx, dz);
    return false;
  }

  /** Alerted: down behind whatever is there, then up with the glasses to search the ridge. */
  private searchCycle(a: Actor): void {
    if (a.state !== "hunker" && a.state !== "search") {
      a.setState("hunker", range(this.random, 1.5, 3));
      a.act("crouch");
      a.still();
      this.face(a, this.plan.eye, 1);
      return;
    }
    if (a.t < a.dur) return;
    if (a.state === "hunker") {
      a.setState("search", range(this.random, 2, 3.2));
      a.act("binoculars");
      this.listener.glint(a, 0.5, "binoculars");
    } else {
      a.setState("hunker", range(this.random, 3, 5.5));
      a.act("crouch");
    }
  }

  private face(a: Actor, p: V3, _k: number): void {
    a.heading = headingFrom(a.pos, p);
  }

  /** The machine-gunner: idle behind his sandbags until the valley wakes, then bursts at the ridge. */
  private gunnerMind(a: Actor, live: boolean): void {
    this.face(a, this.plan.eye, 1);
    if (!a.alerted || !live) {
      if (a.t >= a.dur) {
        a.setState("quiet", range(this.random, 5, 10));
        a.act(this.random() < 0.6 ? "crouch" : "smoke");
      }
      return;
    }
    if (a.activity === "fire" && a.activityT > 0.9) a.act("aim");
    if (a.activity !== "fire" && a.activity !== "aim") a.act("aim");
    if (this.time >= a.nextFire) {
      a.act("fire");
      a.nextFire = this.time + range(this.random, MG_INTERVAL[0], MG_INTERVAL[1]);
      const hit = chance(this.random, MG_HIT_CHANCE);
      const damage = hit ? Math.round(MG_DAMAGE * this.tuning.damageFactor) : 0;
      this.listener.enemyFire(a, "mg", hit, damage);
      if (hit) this.bulletArrives(a, damage, "gunner");
    }
  }

  /** The patrol: along its beat in pairs, a halt now and then; alerted, down and searching. */
  private patrolMind(a: Actor, dt: number): void {
    if (a.alerted) {
      a.walker = null;
      this.searchCycle(a);
      return;
    }
    const w = a.walker;
    if (!w) return;
    if (a.state === "stop") {
      a.still();
      if (a.t >= a.dur) {
        a.setState("walk", range(this.random, 10, 18));
        a.act("patrol_walk");
      }
      return;
    }
    w.speed = PATROL_SPEED * this.spec.pace;
    w.step(dt);
    const before = { x: a.pos.x, z: a.pos.z };
    w.pointAt(a.pos);
    a.vel.x = (a.pos.x - before.x) / Math.max(dt, 1e-6);
    a.vel.z = (a.pos.z - before.z) / Math.max(dt, 1e-6);
    a.vel.y = 0;
    a.heading = w.heading();
    a.act("patrol_walk");
    // The pair halts together: the one in front decides.
    if (a.t >= a.dur && a.spacing === 0) {
      a.setState("stop", range(this.random, 2, 4));
      a.act("idle");
      for (const b of this.actors) {
        if (b !== a && b.role === "patrol" && b.alive && !b.alerted && b.walker?.direction === w.direction && Math.abs(b.walker.s - w.s) < 6) {
          b.setState("stop", a.dur);
          b.act("idle");
          b.still();
        }
      }
    }
  }

  /** A driver in his cab or a trooper in the back: they ride; when the truck stops, they jump down and take cover. */
  private riderMind(a: Actor, _dt: number): void {
    const v = a.vehicle;
    if (a.state === "cover" || a.state === "hunker" || a.state === "search") {
      if (a.state === "cover") {
        if (this.walkTo(a, a.home, RUN_SPEED)) {
          a.alerted = true;
          a.setState("hunker", range(this.random, 1, 2.5));
          a.act("crouch");
          this.face(a, this.plan.eye, 1);
        }
        return;
      }
      this.searchCycle(a);
      return;
    }
    if (a.state === "dismount") {
      if (a.t >= a.dur) {
        a.setState("cover", 30);
        a.act("run");
      }
      return;
    }
    if (!v) return;
    // Out once the truck has stopped (its driver dead, or its engine), or once it is blocked.
    const halted = v.stopped || (v.stopping !== null && v.speed < 1.2);
    if (!halted || this.phase === "intro") {
      this.seat(a);
      if (a.seat === "driver") a.act("drive");
      return;
    }
    if (a.state !== "waiting") {
      const order = a.seat === "driver" ? 0.3 : 0.6 + a.seatIndex * DISMOUNT_GAP;
      a.setState("waiting", order);
      return;
    }
    if (a.t < a.dur) {
      this.seat(a);
      return;
    }
    // Down: the driver by his door, the troops over the tailgate.
    const spec = VEHICLE_SPECS[v.kind];
    const local = a.seat === "driver" ? { x: spec.driver.x + 1.4, y: 0, z: spec.driver.z } : { x: (a.seatIndex % 2 === 0 ? 0.6 : -0.6), y: 0, z: spec.tail - 1 };
    v.toWorld(local, a.pos);
    a.pos.y = v.pos.y;
    a.heading = a.seat === "driver" ? v.heading + Math.PI / 2 : v.heading + Math.PI;
    a.hidden = false;
    a.vehicle = null;
    a.seat = null;
    a.alerted = true;
    // Cover: off the road on the side away from the ridge, spread along it.
    const away = this.awayFromRidge(v);
    const along = (a.seatIndex - 1) * 5 + (this.random() - 0.5) * 4;
    a.home.x = a.pos.x + away.x * range(this.random, 7, 12) + Math.sin(v.heading) * along;
    a.home.z = a.pos.z + away.z * range(this.random, 7, 12) + Math.cos(v.heading) * along;
    a.home.y = a.pos.y;
    a.setState("dismount", DISMOUNT_TIME);
    a.act("dismount");
    this.listener.dismount(a, v);
    if (!this.alerted) this.raise(1, "stopped", a);
  }

  /** The horizontal unit direction from a vehicle away from the ridge, square to the road. */
  private awayFromRidge(v: Vehicle): { x: number; z: number } {
    const sx = Math.cos(v.heading);
    const sz = -Math.sin(v.heading);
    const toEye = { x: this.plan.eye.x - v.pos.x, z: this.plan.eye.z - v.pos.z };
    const s = sx * toEye.x + sz * toEye.z > 0 ? -1 : 1;
    return { x: sx * s, z: sz * s };
  }

  /** The officer: inspects the dam with his glasses, walks to his jeep, drives for the tunnel. */
  private officerMind(a: Actor, dt: number): void {
    const jeep = this.jeep;
    const line = this.damLine;
    if (!jeep || !line) return;
    switch (a.state) {
      case "inspect": {
        const w = a.walker;
        // Alerted, he cuts the inspection short.
        if (a.alerted && a.t < a.dur - 2) a.dur = a.t + 1.5;
        if (w) {
          const pause = Math.floor(a.t / 5) % 2 === 1;
          if (pause) {
            a.act("binoculars");
            a.still();
            if (a.activityT < dt) this.listener.glint(a, 0.4, "binoculars");
          } else {
            w.step(dt);
            const before = { x: a.pos.x, z: a.pos.z };
            w.pointAt(a.pos);
            a.vel.x = (a.pos.x - before.x) / Math.max(dt, 1e-6);
            a.vel.z = (a.pos.z - before.z) / Math.max(dt, 1e-6);
            a.heading = w.heading();
            a.act("walk");
          }
        }
        if (a.t >= a.dur) {
          a.walker = null;
          a.setState("to_jeep", 60);
          a.act(a.alerted ? "run" : "walk");
        }
        break;
      }
      case "to_jeep": {
        const door = jeep.toWorld({ x: VEHICLE_SPECS.jeep.driver.x + 1.2, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
        door.y = jeep.pos.y;
        if (this.walkTo(a, door, a.alerted ? OFFICER_HURRY : WALK_SPEED * 1.3)) {
          a.vehicle = jeep;
          a.seat = "driver";
          a.setState("drive", 1e9);
          a.act("drive");
          jeep.parked = false;
          if (jeep.steaming) {
            // The engine is dead: he runs for it on foot.
            this.officerOnFoot(a);
          }
        }
        break;
      }
      case "drive":
        if (jeep.stopped || jeep.stopping) {
          if (jeep.speed < 1) this.officerOnFoot(a);
          else this.seat(a);
          break;
        }
        this.seat(a);
        if (jeep.arrived) {
          a.setState("gone", 0);
          a.hidden = true;
        }
        break;
      case "on_foot": {
        const w = a.walker;
        if (!w) break;
        w.step(dt);
        const before = { x: a.pos.x, z: a.pos.z };
        w.pointAt(a.pos);
        a.vel.x = (a.pos.x - before.x) / Math.max(dt, 1e-6);
        a.vel.z = (a.pos.z - before.z) / Math.max(dt, 1e-6);
        a.heading = w.heading();
        a.act("run");
        if (w.done) {
          a.setState("gone", 0);
          a.hidden = true;
        }
        break;
      }
      default:
        break;
    }
    this.lastOfficerEta = this.officerEta();
  }

  private officerOnFoot(a: Actor): void {
    const jeep = this.jeep;
    const line = this.damLine;
    if (!jeep || !line) return;
    a.vehicle = null;
    a.seat = null;
    const s = line.nearest(a.pos);
    a.walker = new PathWalker(line, "once", s, RUN_SPEED * this.spec.pace);
    a.setState("on_foot", 1e9);
    a.act("run");
  }

  /** Seconds until the officer is through the tunnel, as things stand. */
  private officerEta(): number {
    const a = this.officer;
    const jeep = this.jeep;
    const line = this.damLine;
    if (!a || !jeep || !line) return 0;
    const drive = (s: number) => Math.max(0, line.length - s) / Math.max(1, jeep.cruise);
    switch (a.state) {
      case "inspect":
        return Math.max(0, a.dur - a.t) + 5 + drive(jeep.walker.s);
      case "to_jeep":
        return flat(a.pos, jeep.pos) / WALK_SPEED + drive(jeep.walker.s);
      case "drive":
        return jeep.stopping || jeep.stopped ? Math.max(0, line.length - jeep.walker.s) / (RUN_SPEED * this.spec.pace) : drive(jeep.walker.s);
      case "on_foot":
        return a.walker ? Math.max(0, line.length - a.walker.s) / (RUN_SPEED * this.spec.pace) : 0;
      default:
        return 0;
    }
  }

  /**
   * The counter-sniper: hidden, then up in his nest scanning the ridge (his
   * scope flickers), then settled on you (it holds, glinting, before he
   * fires). After a shot he drops out of sight, and sometimes moves nests.
   */
  private sniperMind(a: Actor, live: boolean): void {
    const nest = a.nest;
    if (!nest) return;
    this.face(a, this.plan.eye, 1);
    switch (a.state) {
      case "hidden":
        a.hidden = true;
        a.act("hidden");
        if (a.t >= a.dur && live) {
          if (a.shots > 0 && chance(this.random, SNIPER_RELOCATE) && this.plan.nests.length > 1) {
            a.nest = pick(this.random, this.plan.nests.filter((n) => n !== nest));
            a.place = a.nest.place;
            a.placeAt(a.nest.hidden);
          }
          a.placeAt(a.nest!.exposed);
          a.hidden = false;
          a.setState("scan", range(this.random, SNIPER_SCAN[0], SNIPER_SCAN[1]));
          a.act("prone_aim");
          a.nextFire = Math.max(a.nextFire, this.phaseT);
          this.listener.glint(a, 0.3, "binoculars");
        }
        break;
      case "scan":
        a.act("prone_aim");
        // A flicker every second or so as the scope sweeps past you.
        if (Math.floor(a.t) !== Math.floor(a.t - this.dt) && a.t > 0.5) this.listener.glint(a, 0.25, "binoculars");
        if (a.t >= a.dur && live) {
          if (this.phaseT < a.nextFire) {
            a.setState("scan", 1.2);
            break;
          }
          a.setState("aim", this.tuning.sniperGlint);
          this.listener.glint(a, this.tuning.sniperGlint, "scope");
        }
        break;
      case "aim":
        a.act("prone_aim");
        if (a.t >= a.dur && live) {
          a.act("fire");
          const p = Math.min(SNIPER_HIT_MAX, SNIPER_HIT_CHANCE + a.shots * SNIPER_HIT_GROWTH);
          a.shots++;
          const hit = chance(this.random, p);
          const damage = hit ? Math.round(SNIPER_DAMAGE * this.tuning.damageFactor) : 0;
          this.listener.enemyFire(a, "sniper", hit, damage);
          if (hit) this.bulletArrives(a, damage, "sniper");
          if (!this.alerted) this.raise(1, "report", a);
          // Having found you, he stays on you and works his bolt for the next;
          // a miss sends him down out of sight.
          a.setState(hit ? "follow" : "recoil", hit ? SNIPER_FOLLOW_UP : 0.5);
        }
        break;
      case "follow":
        a.act("prone_aim");
        if (a.t >= a.dur && live) {
          a.setState("aim", this.tuning.sniperGlint);
          this.listener.glint(a, this.tuning.sniperGlint, "scope");
        }
        break;
      case "recoil":
        if (a.t >= a.dur) {
          a.setState("hidden", range(this.random, SNIPER_HIDDEN[0], SNIPER_HIDDEN[1]));
          a.placeAt(nest.hidden);
          a.hidden = true;
          a.act("hidden");
          a.nextFire = this.phaseT + 1;
        }
        break;
      default:
        a.setState("hidden", 2);
    }
  }

  /** The mortar team: crouched by the tube; once the valley is alerted, a round every few seconds. */
  private mortarMind(a: Actor, live: boolean): void {
    this.face(a, this.plan.eye, 1);
    if (a.activity === "fire" && a.activityT > 0.8) a.act("crouch");
    if (!a.alerted || !live) return;
    // The crew fires together: the lower id of the two is the one who drops the round.
    const crew = this.actors.filter((b) => b.role === "mortar" && b.alive);
    if (crew[0] !== a) return;
    if (this.time < a.nextFire) return;
    const slower = crew.length < 2 ? 1.6 : 1;
    a.nextFire = this.time + range(this.random, MORTAR_INTERVAL[0], MORTAR_INTERVAL[1]) * slower;
    a.act("fire");
    this.listener.mortarLaunch(a, MORTAR_FLIGHT);
    const stage = this.stage;
    this.later(MORTAR_FLIGHT, () => {
      if (this.stage !== stage || this.over) return;
      const roll = this.random();
      const outcome = roll < MORTAR_HIT_CHANCE ? "hit" : roll < MORTAR_HIT_CHANCE + MORTAR_NEAR_CHANCE ? "near" : "far";
      const raw = outcome === "hit" ? MORTAR_HIT_DAMAGE : outcome === "near" ? MORTAR_NEAR_DAMAGE : 0;
      const damage = Math.round(raw * this.tuning.damageFactor);
      this.listener.mortarLand(outcome, damage, a);
      if (damage > 0) this.hurt(damage, a.pos, "mortar", a.place);
    });
  }

  /** A bullet that will find you: it crosses the valley in a moment, faster than its sound. */
  private bulletArrives(from: Actor, damage: number, by: HostileRole): void {
    const stage = this.stage;
    const place = from.place;
    const at = { x: from.pos.x, y: from.pos.y, z: from.pos.z };
    this.later(dist(at, this.plan.eye) / 780, () => {
      if (this.stage !== stage || this.over) return;
      this.hurt(damage, at, by, place);
    });
  }

  private hurt(damage: number, from: V3, by: HostileRole, place: string): void {
    if (this.over || damage <= 0) return;
    const killed = this.health.hit(damage);
    const dir = damageDirection(this.plan.eye, 0, from);
    this.listener.playerHit(damage, dir, this.health.hurt, by);
    if (killed) {
      this.ending = { kind: "fell", by, place };
      this.phase = "dead";
      this.phaseT = 0;
      this.listener.playerDeath(this.ending);
    }
  }

  // --- the valley's own people and animals -----------------------------------------------

  private civilianMind(a: Actor, dt: number): void {
    if (a.state === "duck") {
      a.still();
      if (a.t >= a.dur) {
        a.setState(a.role === "child" ? "play" : "walk", range(this.random, 5, 10));
        a.act(a.role === "child" ? "idle" : "walk");
      }
      return;
    }
    switch (a.role) {
      case "farmer":
      case "shepherd": {
        const w = a.walker;
        if (!w) return;
        if (a.state === "pause") {
          a.still();
          if (a.t >= a.dur) {
            a.setState("walk", range(this.random, 6, 14));
            a.act("walk");
          }
          return;
        }
        this.follow(a, w, dt);
        a.act("walk");
        if (a.t >= a.dur) {
          a.setState("pause", range(this.random, 3, 7));
          a.act(a.role === "farmer" && this.random() < 0.3 ? "wave" : "idle");
          a.still();
        }
        return;
      }
      case "cyclist": {
        const w = a.walker;
        if (!w) return;
        w.speed = CYCLE_SPEED * (a.state === "hurry" && a.t < a.dur ? 1.5 : 1);
        this.follow(a, w, dt);
        a.act("cycle");
        if (w.done) a.setState("gone", 0);
        return;
      }
      case "child": {
        if (this.alerted) {
          if (a.activity !== "panic") a.act("panic");
          this.walkTo(a, this.plan.chapel, RUN_SPEED * 0.6);
          return;
        }
        if (a.state === "run") {
          if (this.walkTo(a, a.home, 2.2)) {
            a.setState("play", range(this.random, 2, 5));
            a.act(this.random() < 0.4 ? "wave" : "idle");
          }
          return;
        }
        if (a.t >= a.dur) {
          const ang = this.random() * Math.PI * 2;
          a.home.x = this.plan.chapel.x + Math.cos(ang) * range(this.random, 2, 7);
          a.home.z = this.plan.chapel.z + Math.sin(ang) * range(this.random, 2, 7);
          a.home.y = this.plan.chapel.y;
          a.setState("run", 8);
          a.act("run");
        }
        return;
      }
      default:
        return;
    }
  }

  private follow(a: Actor, w: PathWalker, dt: number): void {
    const bx = a.pos.x;
    const bz = a.pos.z;
    w.step(dt);
    w.pointAt(a.pos);
    a.vel.x = (a.pos.x - bx) / Math.max(dt, 1e-6);
    a.vel.z = (a.pos.z - bz) / Math.max(dt, 1e-6);
    a.vel.y = 0;
    a.heading = w.heading();
  }

  /** Now and then a cyclist rides along the valley road. */
  private stepCyclist(): void {
    if (!this.spec.cyclist || this.plan.cyclist.length < 2) return;
    const riding = this.actors.find((a) => a.role === "cyclist");
    if (riding && riding.state === "gone") {
      this.actors = this.actors.filter((a) => a !== riding);
      this.listener.gone(riding);
      this.cyclistNext = this.time + range(this.random, 15, 30);
      return;
    }
    if (riding || this.time < this.cyclistNext) return;
    const line = new Polyline(this.plan.cyclist);
    const c = this.newActor("civilian", "cyclist");
    const back = this.random() < 0.5;
    c.walker = new PathWalker(line, "once", back ? line.length : 0, CYCLE_SPEED);
    c.walker.direction = back ? -1 : 1;
    c.walker.pointAt(c.pos);
    c.heading = c.walker.heading();
    c.place = "on the road";
    c.setState("ride", 1e9);
    c.act("cycle");
    this.listener.spawn(c);
  }

  private animalMind(a: Actor, dt: number): void {
    switch (a.role) {
      case "cow":
      case "sheep":
        if (a.state === "look") {
          if (a.t >= a.dur) {
            a.setState("graze", range(this.random, 4, 10));
            a.act("graze");
          }
          return;
        }
        if (a.state === "wander") {
          if (this.walkTo(a, a.home, a.role === "cow" ? 0.9 : 0.7) || a.t >= a.dur) {
            a.setState("graze", range(this.random, 6, 14));
            a.act("graze");
          }
          return;
        }
        if (a.t >= a.dur) {
          // A few steps to fresh grass, round the spot they keep to.
          const base = a.home;
          a.home.x = base.x + (this.random() - 0.5) * 4;
          a.home.z = base.z + (this.random() - 0.5) * 4;
          a.setState("wander", 6);
          a.act("walk");
        }
        return;
      case "eagle": {
        const w = a.walker;
        if (a.state === "down") {
          // It glides in to the rock by your scope, lands, and stares at you.
          const rock = this.plan.eagleRock;
          const d = dist(a.pos, rock);
          if (a.activity === "glide" || a.activity === "flap") {
            this.walkTo(a, rock, Math.max(4, Math.min(24, d * 0.6)));
            if (d < 3) a.act("land");
          } else if (a.activity === "land") {
            this.walkTo(a, rock, 2.5);
            if (a.activityT > 1.1) {
              a.placeAt(rock);
              a.act("perched");
            }
          } else {
            a.heading = headingFrom(a.pos, this.plan.eye);
            a.still();
          }
          return;
        }
        if (!w) return;
        this.follow(a, w, dt);
        // A few wingbeats now and then between long glides.
        a.act(Math.sin(this.time * 0.37 + a.id) > 0.85 ? "flap" : "glide");
        return;
      }
      case "duck": {
        const w = a.walker;
        if (!w) return;
        this.follow(a, w, dt);
        a.act("float");
        return;
      }
      case "dog": {
        if (a.state === "run") {
          if (this.walkTo(a, a.home, 3.5) || a.t >= a.dur) {
            a.setState("idle", range(this.random, 4, 9));
            a.act("idle");
          }
          return;
        }
        if (a.t >= a.dur) {
          a.home.x = this.plan.farm.x + (this.random() - 0.5) * 16;
          a.home.z = this.plan.farm.z + (this.random() - 0.5) * 16;
          a.home.y = this.plan.farm.y;
          a.setState("run", 8);
          a.act("run");
        }
        return;
      }
      default:
        return;
    }
  }

  private goatHop(a: Actor): void {
    if (a.activity === "hop") return;
    const ledges = this.plan.goatLedges;
    if (ledges.length < 2) return;
    this.secrets.goatLedge = (this.secrets.goatLedge + 1) % ledges.length;
    const next = ledges[this.secrets.goatLedge]!;
    a.act("hop");
    a.home.x = next.x;
    a.home.y = next.y;
    a.home.z = next.z;
    this.listener.goatHop(a, this.secrets.goatLedge);
    this.found("goat");
    this.later(1.2, () => {
      a.placeAt(next);
      a.heading = headingFrom(next, this.plan.eye);
      a.act("stand");
    });
  }

  private eagleDown(a: Actor): void {
    a.walker = null;
    a.setState("down", 1e9);
    a.act("glide");
    this.listener.eagleLands(a);
    this.found("eagle");
  }

  /** The siren's wail: every cow in the pasture turns to look up at the ridge. */
  cowsLook(seconds: number): void {
    for (const a of this.actors) {
      if (a.role !== "cow" || !a.alive) continue;
      a.setState("look", seconds);
      a.act("look_up");
      a.heading = headingFrom(a.pos, this.plan.eye);
      a.still();
    }
  }

  // --- secrets --------------------------------------------------------------------------------

  private secretShot(id: SecretId, _landing: Landing): void {
    // The eagle and the goat are found by near misses (nearMisses); the rest by a round.
    if (id === "eagle" || id === "goat") return;
    this.found(id);
  }

  private found(id: SecretId): void {
    if (!this.secrets.find(id)) return;
    this.listener.secretFound(id, SECRET_NAMES[id], this.secrets.count, SECRETS_TOTAL);
  }

  // --- timers ----------------------------------------------------------------------------------

  private later(seconds: number, run: () => void): void {
    this.timers.push({ at: this.time + seconds, run });
  }

  private runTimers(): void {
    for (let i = this.timers.length - 1; i >= 0; i--) {
      const t = this.timers[i]!;
      if (this.time >= t.at) {
        this.timers.splice(i, 1);
        t.run();
      }
    }
  }

  // --- the end ---------------------------------------------------------------------------------

  results(): Results {
    const s = this.scorer;
    const ending = this.ending;
    return {
      outcome: endingOutcome(ending, this.stage),
      won: false,
      score: s.score,
      stats: [
        { label: "Stages", value: String(this.stagesCleared) },
        { label: "Kills", value: String(s.kills) },
        { label: "Accuracy", value: `${Math.round(s.accuracy * 100)}%` },
        { label: "Longest", value: s.longest > 0 ? `${Math.round(s.longest)} m` : "–" },
      ],
      ...(ending ? { note: endingNote(ending) } : {}),
      secretsFound: this.secrets.count,
      secretsTotal: SECRETS_TOTAL,
    };
  }

  /** The job's words for the current stage. */
  get words(): { name: string; line: string } {
    return JOB_WORDS[jobFor(this.stage)];
  }
}

export function animalName(role: string): string {
  switch (role) {
    case "cow":
      return "Cow";
    case "sheep":
      return "Sheep";
    case "goat":
      return "Goat";
    case "eagle":
      return "Eagle";
    case "dog":
      return "Dog";
    case "duck":
      return "Duck";
    default:
      return "Animal";
  }
}

/** For the tests: what a vehicle kind is called. */
export type { VehicleKind, Activity };
export { shuffle };
