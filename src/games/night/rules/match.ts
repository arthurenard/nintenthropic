import { damageDirection, PlayerHealth } from "../../../engine/rules/health";
import type { V3 } from "../../../engine/rules/raymath";
import { range, shuffle, type Random } from "../../../engine/rules/rng";
import type { Difficulty } from "../../../engine/types";
import { Dead, drawGait, horizontalDistance, offsetPath, paceOf, withinReach, type DeadEvents, type DeadWorld } from "./dead";
import { felledNote, type Felled } from "./felled";
import { Rifle, type TriggerResult } from "./rifle";
import { Scorer, type Award, type WaveBonuses } from "./scoring";
import { SECRET_NAMES, SECRETS_TOTAL, SecretTracker, type SecretId, type SecretShot, type SignLetter } from "./secrets";
import { SURVIVOR_ORDER, Survivor, type SurvivorEvents } from "./survivors";
import {
  BLOATER_BURST_DAMAGE,
  BREATHER,
  CHAIN_RADIUS,
  DIFFICULTY,
  HEALTH_MAX,
  LANE_REACH,
  MECHANIC_AURA,
  OPENING_REACH,
  OPENING_STAGGER,
  WALKER_HURRY,
  WAVE_INTRO,
  WORN,
  type DifficultyTuning,
} from "./tuning";
import { SURPRISES, type DeadKind, type DeathCause, type HitPart, type Lane, type LaneId, type RoadPlan, type Slot } from "./types";
import { sightFor, waveSpec, type WaveSpec } from "./waves";

/** What a player's bullet found, as worked out by the world's ray casts. */
export type ShotTarget =
  | { kind: "dead"; dead: Dead; part: HitPart }
  | { kind: "survivor"; survivor: Survivor }
  | { kind: "secret"; shot: SecretShot }
  | { kind: "scenery" }
  | { kind: "none" };

/** Everything the world shows and plays in answer to the rules. */
export interface MatchListener extends DeadEvents, SurvivorEvents {
  banner(title: string, subtitle?: string): void;
  waveStart(wave: number, spec: WaveSpec): void;
  waveClear(wave: number, bonuses: WaveBonuses): void;
  /** The breather: the fog thins, the bell counts, health comes back. */
  breather(nextWave: number): void;
  deadSpawn(d: Dead): void;
  /** A claw, a lunge or a swing landed (the player's hurt follows). */
  deadStrike(d: Dead, damage: number): void;
  /** A hit that did not drop it: a stagger, the Mechanic's mask holding, the Mechanic slowed. */
  deadWound(d: Dead, part: HitPart): void;
  maskOff(d: Dead, award: Award): void;
  /** Down: by a shot (with its award), caught in a bloater's burst ("chain", no award of its own), or a bloater bursting on the barricade. */
  deadDeath(d: Dead, cause: DeathCause, award: Award | null): void;
  /** A bloater burst: shot (with the dead its burst caught, and their award) or on the barricade. */
  bloaterBurst(d: Dead, shot: boolean, caught: readonly Dead[], award: Award | null): void;
  /** A body can be taken away (the breather's fog takes them). */
  bodyCleared(d: Dead): void;
  survivorShot(s: Survivor, award: Award): void;
  playerHit(damage: number, direction: number, hurt: number, by: Dead): void;
  playerDeath(): void;
  streakUp(multiplier: number): void;
  score(value: number): void;
  /** A reload began (true) or finished (false). */
  reload(started: boolean): void;
  /** Rounds thumbed into the gate this frame. */
  roundsIn(count: number): void;
  /** The lever chambered a round. */
  chambered(): void;
  signLetter(letter: SignLetter, eat: boolean): void;
  signRelit(letters: readonly SignLetter[]): void;
  scarecrowTurn(): void;
  scarecrowGone(): void;
  boothRing(): void;
  driveIn(): void;
  moonShot(shots: number, howl: "far" | "near" | null): void;
  catStartled(startles: number): void;
  radio(on: boolean): void;
  duckSqueak(squeaks: number): void;
  secretFound(id: SecretId, name: string, found: number, total: number): void;
}

export type Phase = "ready" | "intro" | "combat" | "breather" | "dead";

export interface MatchOptions {
  random: Random;
  plan: RoadPlan;
  /** Ways a survivor runs across the road to the motel. None: no survivors. */
  survivorPaths?: readonly (readonly V3[])[];
  listener: MatchListener;
  /** The player's heading about the vertical, for the damage arcs. */
  yaw?: number;
  difficulty?: Difficulty;
  /**
   * How many of the dead the world has figures for, the Mechanic aside: no
   * more than this are ever standing or falling at once, so none walks the
   * road unseen (a body that has finished falling gives its figure to the
   * next). Unset, no limit: the wave's own crowd (maxActive) is the only one.
   */
  figures?: number;
}

export interface StartOptions {
  wave?: number;
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

interface QueueEntry {
  kind: DeadKind;
  lane: LaneId;
  /** One of the wave's opening: it starts closer in (OPENING_REACH), and the next of them follows a moment later. */
  near?: boolean;
}

/** The Mechanic quickens the dead within this many metres of him. */
const AURA_RADIUS = 18;

/**
 * The night's rules: the wave director, the dead's state machines, the
 * player's health, rifle and score, the survivors and the secrets'
 * bookkeeping. It knows nothing about Three.js: the world feeds it time and
 * what each bullet hit, and it answers through a MatchListener. With the
 * same random source and the same inputs it plays out exactly the same way.
 */
export class Match implements DeadWorld {
  readonly random: Random;
  readonly plan: RoadPlan;
  readonly eye: V3;
  readonly yaw: number;
  readonly difficulty: Difficulty;
  /** The difficulty's own numbers, as the table has them. */
  readonly baseline: Readonly<DifficultyTuning>;
  /** The numbers in force now: the baseline, worn toward Standard's as a wave drags on. */
  readonly tuning: DifficultyTuning;
  readonly events: DeadEvents;

  time = 0;
  phase: Phase = "ready";
  phaseT = 0;
  wave = 0;
  spec: WaveSpec = waveSpec(1);

  readonly health: PlayerHealth;
  readonly rifle = new Rifle();
  readonly scorer = new Scorer();
  readonly secrets = new SecretTracker();

  /** This wave's dead, walking and fallen. */
  dead: Dead[] = [];
  survivors: Survivor[] = [];
  /** What took the player; null while they stand. */
  felled: Felled | null = null;

  private readonly listener: MatchListener;
  private readonly survivorEvents: SurvivorEvents;
  private readonly lanes = new Map<LaneId, Lane>();
  /** The lanes as the dead of an opening walk them: begun closer in where something hides them. */
  private readonly nearLanes = new Map<LaneId, Lane>();
  private readonly survivorPaths: readonly (readonly V3[])[];
  private readonly figures: number;
  private queue: QueueEntry[] = [];
  private spawnTimer = 0;
  /** When (wave time) the last of the wave came into play. */
  private lastSpawnAt = 0;
  private survivorTimes: number[] = [];
  private survivorsSent = 0;
  private nextId = 1;

  constructor(options: MatchOptions) {
    this.random = options.random;
    this.eye = options.plan.eye ?? { x: 0, y: 1.7, z: 0 };
    // The lanes out of the fog start within reach: the surprises are near already.
    const eye = this.eye;
    this.plan = { ...options.plan, lanes: options.plan.lanes.map((l) => (SURPRISES.includes(l.id) ? l : withinReach(l, eye, LANE_REACH))) };
    this.yaw = options.yaw ?? 0;
    this.difficulty = options.difficulty ?? "standard";
    this.baseline = DIFFICULTY[this.difficulty];
    this.tuning = { ...this.baseline };
    // The live numbers: the player's recovery wears with the rest.
    this.health = new PlayerHealth(this.tuning, HEALTH_MAX);
    this.listener = options.listener;
    this.survivorPaths = options.survivorPaths ?? [];
    this.figures = options.figures ?? Number.POSITIVE_INFINITY;
    for (const lane of this.plan.lanes) if (lane.points.length >= 2) this.lanes.set(lane.id, lane);
    for (const lane of options.plan.lanes) {
      if (SURPRISES.includes(lane.id)) continue;
      const near = withinReach(lane, eye, OPENING_REACH[lane.id] ?? LANE_REACH);
      if (near.points.length >= 2) this.nearLanes.set(lane.id, near);
    }
    const l = this.listener;
    this.events = {
      deadEmerged: (d) => l.deadEmerged(d),
      deadArrived: (d) => l.deadArrived(d),
      deadLunge: (d) => l.deadLunge(d),
      deadSwell: (d) => l.deadSwell(d),
      deadDown: (d) => l.deadDown(d),
    };
    this.survivorEvents = {
      survivorAppear: (s) => l.survivorAppear(s),
      survivorGone: (s) => l.survivorGone(s),
    };
  }

  // --- the flow of a night ----------------------------------------------------------

  start(options: StartOptions = {}): void {
    this.beginWave(Math.max(1, Math.floor(options.wave ?? 1)), true);
  }

  get over(): boolean {
    return this.phase === "dead";
  }

  /** The dead of this wave still to put down: those walking and those still in the fog. */
  get remaining(): number {
    let n = this.queue.length;
    for (const d of this.dead) if (d.alive) n++;
    return n;
  }

  /** How many this wave brings in all, the Mechanic included. */
  get waveTotal(): number {
    return this.spec.dead + (this.spec.mechanic ? 1 : 0);
  }

  update(dt: number, offscreen: boolean): void {
    this.time += dt;
    this.phaseT += dt;
    const r = this.rifle.update(dt, offscreen && this.phase !== "dead");
    if (r.started) this.listener.reload(true);
    if (r.roundsIn) this.listener.roundsIn(r.roundsIn);
    if (r.chambered) this.listener.chambered();
    if (r.done) this.listener.reload(false);
    this.wear();
    this.health.update(dt);

    switch (this.phase) {
      case "ready":
        return;
      case "intro":
        if (this.phaseT >= WAVE_INTRO) this.beginCombat();
        break;
      case "combat":
        this.stepDead(dt);
        this.stepSurvivors(dt);
        this.spawn(dt);
        this.scheduleSurvivors();
        this.checkClear();
        break;
      case "breather":
        this.stepDead(dt);
        this.stepSurvivors(dt);
        if (this.phaseT >= BREATHER) this.beginWave(this.wave + 1, false);
        break;
      case "dead":
        this.stepDead(dt);
        this.stepSurvivors(dt);
        break;
    }
  }

  private beginWave(wave: number, intro: boolean): void {
    this.wave = wave;
    this.spec = waveSpec(wave);
    this.queue = buildQueue(this.spec, this.random, new Set(this.lanes.keys()));
    this.dead = [];
    this.lastSpawnAt = 0;
    this.survivors = this.survivors.filter((s) => s.state !== "gone");
    this.survivorTimes = [];
    for (let i = 0; i < this.spec.survivors && this.survivorPaths.length > 0; i++) this.survivorTimes.push(range(this.random, 9, 32));
    this.survivorTimes.sort((a, b) => a - b);
    this.phaseT = 0;
    if (intro) {
      this.phase = "intro";
      this.listener.banner(`Wave ${wave}`, this.spec.subtitle);
    } else {
      this.beginCombat();
    }
  }

  private beginCombat(): void {
    this.phase = "combat";
    this.phaseT = 0;
    this.spawnTimer = 0.3;
    // The radio has played its song.
    if (this.secrets.radioOff()) this.listener.radio(false);
    this.listener.waveStart(this.wave, this.spec);
  }

  private checkClear(): void {
    if (this.queue.length > 0) return;
    for (const d of this.dead) if (d.state !== "dead") return;
    this.startBreather();
  }

  private startBreather(): void {
    const bonuses = this.scorer.endWave();
    this.listener.waveClear(this.wave, bonuses);
    this.listener.score(this.scorer.score);
    this.health.heal();
    // The fog takes the fallen while the title card is up.
    for (const d of this.dead) this.listener.bodyCleared(d);
    const relit = this.secrets.relight();
    if (relit.length) this.listener.signRelit(relit);
    this.phase = "breather";
    this.phaseT = 0;
    const next = this.wave + 1;
    this.listener.breather(next);
    this.listener.banner(`Wave ${next}`, waveSpec(next).subtitle);
  }

  // --- the dead -----------------------------------------------------------------------

  private stepDead(dt: number): void {
    for (let i = 0; i < this.dead.length; i++) (this.dead[i] as Dead).step(dt, this);
  }

  private activeCount(): number {
    let n = 0;
    for (const d of this.dead) if (d.alive && d.kind !== "mechanic") n++;
    return n;
  }

  /** The dead holding a figure now, the Mechanic aside: walking, or still falling. */
  private upCount(): number {
    let n = 0;
    for (const d of this.dead) if (d.state !== "dead" && d.kind !== "mechanic") n++;
    return n;
  }

  private spawn(dt: number): void {
    this.spawnTimer -= dt;
    if (this.spawnTimer > 0 || this.queue.length === 0) return;
    const entry = this.queue[0] as QueueEntry;
    if (entry.kind !== "mechanic" && (this.activeCount() >= this.spec.maxActive || this.upCount() >= this.figures)) return;
    this.queue.shift();
    if (this.queue.length === 0) this.lastSpawnAt = this.phaseT;
    const lane = (entry.near ? this.nearLanes.get(entry.lane) : undefined) ?? this.lanes.get(entry.lane) ?? this.lanes.get("road") ?? ([...this.lanes.values()][0] as Lane);
    const gait = drawGait(this.random);
    const hurry = range(this.random, WALKER_HURRY[0], WALKER_HURRY[1]);
    const offset = range(this.random, -lane.spread, lane.spread);
    const d = new Dead(this.nextId++, entry.kind, lane, offsetPath(lane, offset), paceOf(entry.kind, gait, hurry), gait);
    if (entry.kind === "mechanic") d.mask = this.tuning.maskHits;
    d.spawn(this);
    this.dead.push(d);
    this.listener.deadSpawn(d);
    // One of an opening is followed a moment later by the next of it; after the last, the wave's own gap.
    const together = entry.near && this.queue[0]?.near;
    const gap = together
      ? range(this.random, OPENING_STAGGER[0], OPENING_STAGGER[1])
      : range(this.random, this.spec.gap[0], this.spec.gap[1]) / this.boldness();
    // The Mechanic walks out alone: the rest give him a moment.
    this.spawnTimer = entry.kind === "mechanic" ? 3 : gap;
  }

  /** The wave's pace, a long wave's pressure, the difficulty, and the Mechanic nearby. */
  paceFor(d: Dead): number {
    let k = this.tuning.speedFactor * this.boldness();
    if (d.kind === "walker") k *= this.spec.pace;
    if (d.kind !== "mechanic") {
      for (const m of this.dead) {
        if (m.kind === "mechanic" && m.alive && !m.atBarricade && horizontalDistance(m.pos, d.pos) <= AURA_RADIUS) {
          k *= MECHANIC_AURA;
          break;
        }
      }
    }
    return k;
  }

  /** The free place at the barricade nearest to it; null when every one is held. */
  claimSlot(d: Dead): Slot | null {
    let best: Slot | null = null;
    let bestD = Number.POSITIVE_INFINITY;
    for (const s of this.plan.slots) {
      let held = false;
      for (const o of this.dead) {
        if (o !== d && o.alive && o.slot === s) {
          held = true;
          break;
        }
      }
      if (held) continue;
      const dist = horizontalDistance(s.pos, d.pos);
      if (dist < bestD) {
        bestD = dist;
        best = s;
      }
    }
    return best;
  }

  strike(d: Dead, damage: number): void {
    if (this.phase === "dead") return;
    this.listener.deadStrike(d, damage);
    this.damagePlayer(damage, d, false);
  }

  burstOnPlayer(d: Dead): void {
    if (!d.alive) return;
    d.die("burst", this.time, horizontalDistance(d.pos, this.eye));
    this.listener.bloaterBurst(d, false, [], null);
    this.listener.deadDeath(d, "burst", null);
    this.damagePlayer(Math.round(BLOATER_BURST_DAMAGE * this.tuning.damageFactor), d, true);
  }

  // --- the late-wave pressure -----------------------------------------------------------

  /**
   * How much a long wave has turned against the player, as a multiplier on
   * the dead's pace: 1 until the difficulty's boldAfter seconds after the
   * last of the wave has come out of the fog (a wave's dead take their time
   * walking in; only one dragged on past that turns), then climbing by
   * boldRate a second to its boldMax.
   */
  boldness(): number {
    if (this.phase !== "combat" || this.queue.length > 0) return 1;
    const t = this.baseline;
    return Math.min(t.boldMax, 1 + Math.max(0, this.phaseT - this.lastSpawnAt - t.boldAfter) * t.boldRate);
  }

  /** The late-wave pressure as a fraction: 0 (none yet) to 1 (the fog at its thickest). */
  pressure(): number {
    const max = this.baseline.boldMax;
    return max > 1 ? (this.boldness() - 1) / (max - 1) : 0;
  }

  /** The fog's density now: the wave's, thinner on Relaxed, thicker as a wave drags on, thin in a breather. */
  fogDensity(): number {
    const base = this.spec.fog * this.tuning.fogFactor;
    if (this.phase === "breather") return base * 0.4;
    return base * (1 + 0.6 * this.pressure());
  }

  /** How far into the fog the road can be read now, metres. */
  sight(): number {
    return sightFor(this.fogDensity());
  }

  /**
   * An easier difficulty's allowances wear off under the pressure: by the
   * time the fog is at its thickest the dead come and hurt as on Standard,
   * and health comes back no sooner. On Standard nothing moves.
   */
  private wear(): void {
    const k = this.pressure();
    const from = this.baseline;
    const to = DIFFICULTY.standard;
    const t = this.tuning;
    for (const key of WORN) t[key] = from[key] + (to[key] - from[key]) * k;
  }

  // --- the player -------------------------------------------------------------------------

  private damagePlayer(amount: number, by: Dead, burst: boolean): void {
    if (this.phase === "dead" || amount <= 0) return;
    this.scorer.hurt();
    const direction = damageDirection(this.eye, this.yaw, by.pos);
    const died = this.health.hit(amount);
    this.listener.playerHit(amount, direction, this.health.hurt, by);
    if (died) {
      this.felled = { kind: by.kind, lane: by.lane.id, burst, pressure: this.pressure(), maskHits: this.baseline.maskHits };
      this.phase = "dead";
      this.phaseT = 0;
      this.listener.playerDeath();
    }
  }

  /** The finger folds: fire a round, click dry on an empty chamber, or nothing while the lever or a reload is busy. */
  trigger(): TriggerResult {
    if (this.phase === "dead") return "busy";
    return this.rifle.trigger();
  }

  /** R: the same as pointing off the screen. */
  requestReload(): boolean {
    if (this.phase === "dead") return false;
    const started = this.rifle.reload();
    if (started) this.listener.reload(true);
    return started;
  }

  /** What the bullet hit. Call once per shot fired, straight after trigger(). */
  resolveShot(target: ShotTarget): void {
    const scorer = this.scorer;
    switch (target.kind) {
      case "dead": {
        const d = target.dead;
        if (!d.shootable) {
          scorer.shot(false);
          return;
        }
        if (scorer.shot(true)) this.listener.streakUp(scorer.multiplier);
        this.hitDead(d, target.part);
        return;
      }
      case "survivor": {
        const s = target.survivor;
        scorer.shot(false);
        if (!s.shootable) return;
        const award = scorer.survivor();
        s.hit();
        this.listener.survivorShot(s, award);
        this.listener.score(scorer.score);
        return;
      }
      case "secret":
        this.secretShot(target.shot);
        return;
      default:
        scorer.shot(false);
        return;
    }
  }

  private hitDead(d: Dead, part: HitPart): void {
    if (d.kind === "crawler") {
      // One shot, anywhere.
      this.kill(d, part);
      return;
    }
    if (part === "head") {
      if (d.kind === "mechanic" && d.mask > 0) {
        d.mask--;
        if (d.mask === 0) {
          const award = this.scorer.mask();
          this.listener.maskOff(d, award);
          this.listener.score(this.scorer.score);
        } else {
          this.listener.deadWound(d, part);
        }
        return;
      }
      this.kill(d, part);
      return;
    }
    if (d.kind === "bloater") {
      if (part === "body") {
        this.burstByShot(d);
        return;
      }
      d.stagger();
      this.listener.deadWound(d, part);
      return;
    }
    d.bodyLeft--;
    if (d.bodyLeft <= 0) {
      this.kill(d, part);
      return;
    }
    d.stagger();
    this.listener.deadWound(d, part);
  }

  private kill(d: Dead, cause: HitPart): void {
    if (!d.alive) return;
    const far = horizontalDistance(d.pos, this.eye);
    d.die(cause, this.time, far);
    const award = this.scorer.kill({ kind: d.kind, headshot: cause === "head", distance: far });
    this.listener.deadDeath(d, cause, award);
    this.listener.score(this.scorer.score);
  }

  /** Shot in the body, a bloater bursts: everything within three metres goes down with it, and a bloater caught bursts too. */
  private burstByShot(d: Dead): void {
    const far = horizontalDistance(d.pos, this.eye);
    d.die("body", this.time, far);
    const award = this.scorer.kill({ kind: "bloater", headshot: false, distance: far });
    this.listener.deadDeath(d, "body", award);
    const caught: Dead[] = [];
    const bursts: Dead[] = [d];
    while (bursts.length) {
      const at = bursts.shift() as Dead;
      for (const o of this.dead) {
        if (!o.alive || o.kind === "mechanic") continue;
        if (horizontalDistance(o.pos, at.pos) > CHAIN_RADIUS) continue;
        o.die("chain", this.time, horizontalDistance(o.pos, this.eye));
        caught.push(o);
        if (o.kind === "bloater") bursts.push(o);
      }
    }
    // The Mechanic is only knocked about by it.
    for (const o of this.dead) {
      if (o.kind === "mechanic" && o.alive && horizontalDistance(o.pos, d.pos) <= CHAIN_RADIUS) o.stagger();
    }
    const chain = caught.length ? this.scorer.chain(caught.length) : null;
    this.listener.bloaterBurst(d, true, caught, chain);
    for (const o of caught) this.listener.deadDeath(o, "chain", null);
    this.listener.score(this.scorer.score);
  }

  // --- survivors ----------------------------------------------------------------------------

  private stepSurvivors(dt: number): void {
    for (let i = 0; i < this.survivors.length; i++) (this.survivors[i] as Survivor).step(dt, this.survivorEvents);
  }

  private scheduleSurvivors(): void {
    const next = this.survivorTimes[0];
    if (next === undefined || this.phaseT < next) return;
    // One at a time on the road.
    if (this.survivors.some((s) => s.state !== "gone")) {
      this.survivorTimes[0] = this.phaseT + 2;
      return;
    }
    this.survivorTimes.shift();
    const path = this.survivorPaths[this.survivorsSent % this.survivorPaths.length];
    if (!path || path.length < 2) return;
    const role = SURVIVOR_ORDER[this.survivorsSent % SURVIVOR_ORDER.length] ?? "daughter";
    this.survivorsSent++;
    const s = new Survivor(this.nextId++, role, path);
    this.survivors.push(s);
    this.listener.survivorAppear(s);
  }

  // --- secrets --------------------------------------------------------------------------------

  /** The beam on the scarecrow this frame, or not: the world asks every frame in play. */
  scarecrowLight(lit: boolean, dt: number): void {
    if (this.phase === "dead" || this.phase === "ready") return;
    const r = this.secrets.scarecrowLight(lit, dt);
    if (r.turned) this.listener.scarecrowTurn();
    this.found("scarecrow", r.newlyFound);
  }

  private secretShot(shot: SecretShot): void {
    const s = this.secrets;
    switch (shot.secret) {
      case "sign": {
        const r = s.sign(shot.letter);
        if (r.dark) this.listener.signLetter(shot.letter, r.eat);
        this.found("eat", r.newlyFound);
        return;
      }
      case "scarecrow":
        if (s.scarecrowShot()) this.listener.scarecrowGone();
        return;
      case "booth": {
        const r = s.booth();
        if (r.rings) this.listener.boothRing();
        this.found("booth", r.newlyFound);
        return;
      }
      case "drivein": {
        const r = s.driveIn(this.phase === "breather");
        if (r.plays) this.listener.driveIn();
        this.found("drivein", r.newlyFound);
        return;
      }
      case "moon": {
        const r = s.moon();
        this.listener.moonShot(r.shots, r.howl);
        this.found("moon", r.newlyFound);
        return;
      }
      case "cat": {
        const r = s.cat();
        this.listener.catStartled(r.startles);
        this.found("cat", r.newlyFound);
        return;
      }
      case "radio": {
        const r = s.radio();
        if (r.on) this.listener.radio(true);
        this.found("radio", r.newlyFound);
        return;
      }
      case "duck": {
        const r = s.duck();
        this.listener.duckSqueak(r.squeaks);
        this.found("duck", r.newlyFound);
        return;
      }
    }
  }

  private found(id: SecretId, newly: boolean): void {
    if (newly) this.listener.secretFound(id, SECRET_NAMES[id], this.secrets.count, SECRETS_TOTAL);
  }

  // --- the end ------------------------------------------------------------------------------------

  results(): Results {
    const s = this.scorer;
    return {
      outcome: `Fell on Wave ${this.wave}`,
      won: false,
      score: s.score,
      stats: [
        { label: "Waves", value: String(Math.max(0, this.wave - 1)) },
        { label: "Kills", value: String(s.kills) },
        { label: "Headshots", value: String(s.headshots) },
        { label: "Accuracy", value: `${Math.round(s.accuracy * 100)}%` },
        { label: "Best Streak", value: String(s.bestStreak) },
      ],
      ...(this.felled ? { note: felledNote(this.felled) } : {}),
      secretsFound: this.secrets.count,
      secretsTotal: SECRETS_TOTAL,
    };
  }
}

// --- the wave's queue ---------------------------------------------------------------------------

/** Which lanes each kind may come by, of those the wave opens. */
function lanesFor(kind: DeadKind, open: readonly LaneId[]): LaneId[] {
  switch (kind) {
    // Low on the road, hard to see in the fog and easy to forget; never hidden in the corn.
    case "crawler":
      return open.filter((l) => l === "road" || l === "trees");
    case "mechanic":
      return ["road"];
    default:
      return [...open];
  }
}

/** The road carries the most; the corn and the trees share the rest. */
const LANE_WEIGHT: Readonly<Record<LaneId, number>> = { road: 0.45, corn: 0.3, trees: 0.25, bus: 1, booth: 1, fence: 1 };

/**
 * The wave's dead in the order they come, each with its lane: the Mechanic
 * first, the rest shuffled; the surprises (the bus, the booth, the fence)
 * spread through the wave, walkers and runners only. Lanes the road does
 * not have are left out; with none left, everything takes the road.
 */
export function buildQueue(spec: WaveSpec, random: Random, available: ReadonlySet<LaneId>): QueueEntry[] {
  const kinds: DeadKind[] = [];
  for (let i = 0; i < spec.runners; i++) kinds.push("runner");
  for (let i = 0; i < spec.crawlers; i++) kinds.push("crawler");
  for (let i = 0; i < spec.bloaters; i++) kinds.push("bloater");
  while (kinds.length < spec.dead) kinds.push("walker");
  shuffle(random, kinds);
  const open = spec.lanes.filter((l) => available.has(l));
  const surprise = SURPRISES.filter((l) => available.has(l));
  shuffle(random, surprise);
  const fallback: LaneId = available.has("road") ? "road" : ([...available][0] ?? "road");
  // Which of them come by surprise: walkers and runners, spread through the wave.
  const candidates = kinds.map((k, i) => ({ k, i })).filter((e) => e.k === "walker" || e.k === "runner");
  shuffle(random, candidates);
  const bySurprise = new Map<number, LaneId>();
  const count = surprise.length ? Math.min(spec.surprises, candidates.length) : 0;
  for (let s = 0; s < count; s++) bySurprise.set((candidates[s] as { i: number }).i, surprise[s % surprise.length] as LaneId);
  const queue: QueueEntry[] = kinds.map((kind, i) => {
    const s = bySurprise.get(i);
    if (s) return { kind, lane: s };
    const lanes = lanesFor(kind, open).filter((l) => available.has(l));
    if (lanes.length === 0) return { kind, lane: fallback };
    let total = 0;
    for (const l of lanes) total += LANE_WEIGHT[l];
    let r = random() * total;
    for (const l of lanes) {
      r -= LANE_WEIGHT[l];
      if (r <= 0) return { kind, lane: l };
    }
    return { kind, lane: lanes[lanes.length - 1] as LaneId };
  });
  // The opening: the first of the wave's walkers, brought forward to come together by the lanes it names.
  const opening = spec.opening.filter((l) => available.has(l));
  const front: QueueEntry[] = [];
  for (const lane of opening) {
    const at = queue.findIndex((e) => e.kind === "walker");
    if (at < 0) break;
    queue.splice(at, 1);
    front.push({ kind: "walker", lane, near: true });
  }
  queue.unshift(...front);
  if (spec.mechanic) queue.unshift({ kind: "mechanic", lane: available.has("road") ? "road" : fallback });
  return queue;
}
