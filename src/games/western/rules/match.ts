import { Bandit, horizontalDistance, type BanditEvents, type BanditWorld } from "./bandit";
import { chooseDeath } from "./deaths";
import { Dynamite, flightTimeFor } from "./dynamite";
import { damageDirection, PlayerHealth } from "./health";
import type { Difficulty } from "../../../engine/types";
import type { V3 } from "./raymath";
import { Revolver, type TriggerResult } from "./revolver";
import { range, shuffle, type Random } from "./rng";
import { Scorer, type Award, type WaveBonuses } from "./scoring";
import { SECRET_NAMES, SECRETS_TOTAL, SecretTracker, type SecretId } from "./secrets";
import { roleForCover, Townsperson, type TownsfolkEvents } from "./townsfolk";
import {
  ADJACENT_RADIUS,
  BOSS_COVER_FIRE,
  BOSS_HEALTH,
  DYNAMITE_BLAST_RADIUS,
  DYNAMITE_DAMAGE,
  DYNAMITE_DROP_FUSE,
  DYNAMITE_PLAYER_RADIUS,
  DYNAMITE_RANGE,
  DIFFICULTY,
  HIT_GRACE,
  HIT_GRACE_FACTOR,
  INTERMISSION,
  MIN_SHOT_GAP,
  QUICK_DRAW_WINDOW,
  RIFLE_DAMAGE_FACTOR,
  THROW_HAND,
  WAVE_INTRO,
  type DifficultyTuning,
} from "./tuning";
import type { Cover, HitPart, Role } from "./types";
import { waveSpec, type WaveSpec } from "./waves";

/** What a player's bullet found, as worked out by the world's ray casts. */
export type ShotTarget =
  | { kind: "bandit"; bandit: Bandit; part: HitPart }
  | { kind: "townsfolk"; person: Townsperson }
  | { kind: "dynamite"; stick: Dynamite }
  | { kind: "secret"; secret: SecretId }
  | { kind: "chicken" }
  | { kind: "tumbleweed" }
  | { kind: "scenery" }
  | { kind: "none" };

/** Everything the world shows and plays in answer to the rules. */
export interface MatchListener extends BanditEvents, TownsfolkEvents {
  banner(title: string, subtitle?: string): void;
  waveStart(wave: number, spec: WaveSpec): void;
  waveClear(wave: number, bonuses: WaveBonuses): void;
  /** The breather: bell, title card, heal, a tumbleweed (a giant one if earned). */
  intermission(nextWave: number, giantTumbleweed: boolean): void;
  banditSpawn(b: Bandit): void;
  banditFire(b: Bandit, hit: boolean, damage: number): void;
  banditThrow(b: Bandit, stick: Dynamite): void;
  /** A hit that did not kill: an iron plate, or Black Jack's thick hide. */
  banditWound(b: Bandit, part: HitPart): void;
  banditDeath(b: Bandit, part: HitPart | "blast", award: Award): void;
  /** A body from the last wave can be taken away. */
  bodyCleared(b: Bandit): void;
  dynamiteDropped(stick: Dynamite, b: Bandit): void;
  dynamiteShot(stick: Dynamite, award: Award): void;
  dynamiteExplode(stick: Dynamite, shotInAir: boolean): void;
  playerHit(damage: number, direction: number, hurt: number, source: "bullet" | "dynamite"): void;
  playerDeath(): void;
  townsfolkShot(p: Townsperson, award: Award): void;
  streakUp(multiplier: number): void;
  score(value: number): void;
  reload(started: boolean): void;
  bellToll(toll: number, doorsOpen: boolean): void;
  pianoNote(count: number, tune: boolean): void;
  chickenStartled(hits: number): void;
  tumbleweedShot(count: number, giantEarned: boolean): void;
  secretFound(id: SecretId, name: string, found: number, total: number): void;
}

export type Phase = "ready" | "duel" | "intro" | "combat" | "intermission" | "dead";

export interface MatchOptions {
  random: Random;
  covers: readonly Cover[];
  listener: MatchListener;
  /** The player's eye; the player looks down −Z from here. */
  eye?: V3;
  yaw?: number;
  /** How hard the gang plays; Standard if not said. */
  difficulty?: Difficulty;
}

export interface StartOptions {
  wave?: number;
  /** High Noon for real: the first wave opens with a duel. */
  duel?: boolean;
}

export interface Results {
  outcome: string;
  won: boolean;
  score: number;
  stats: { label: string; value: string }[];
  secretsFound: number;
  secretsTotal: number;
}

interface QueueEntry {
  role: Role;
  armoured: boolean;
}

const STICKS = 6;

/**
 * The gunfight's rules: the wave director, the gang's state machines, the
 * player's health, revolver and score, and the secrets' bookkeeping. It knows
 * nothing about Three.js; the world feeds it time and what each bullet hit,
 * and it answers through a MatchListener. With the same random source and the
 * same inputs it plays out exactly the same way.
 */
export class Match implements BanditWorld {
  readonly random: Random;
  readonly covers: readonly Cover[];
  readonly events: BanditEvents;
  readonly eye: V3;
  readonly yaw: number;
  readonly difficulty: Difficulty;
  /** The difficulty's own numbers, as the table has them. */
  readonly baseline: Readonly<DifficultyTuning>;
  /**
   * The numbers in force right now: the baseline, worn toward Standard's
   * as a wave drags on (see wear()). On Standard they never change.
   */
  readonly tuning: DifficultyTuning;

  time = 0;
  phase: Phase = "ready";
  phaseT = 0;
  wave = 0;
  spec: WaveSpec = waveSpec(1);

  readonly health: PlayerHealth;
  readonly revolver = new Revolver();
  readonly scorer = new Scorer();
  readonly secrets = new SecretTracker();

  /** This wave's bandits, living and dead. */
  bandits: Bandit[] = [];
  townsfolk: Townsperson[] = [];
  readonly sticks: Dynamite[] = [];

  private readonly listener: MatchListener;
  private readonly townEvents: TownsfolkEvents;
  private queue: QueueEntry[] = [];
  private slotsInUse = 0;
  private lastShotTime = Number.NEGATIVE_INFINITY;
  private spawnTimer = 0;
  private spawned = 0;
  private townsfolkTimes: number[] = [];
  private readonly occupant = new Map<string, Bandit | Townsperson>();
  private readonly bodies = new Set<string>();
  private readonly vacatedAt = new Map<string, number>();
  private readonly bossCovers: Cover[];
  private readonly hasHighCovers: boolean;
  private nextId = 1;
  private duelist: Bandit | null = null;

  constructor(options: MatchOptions) {
    this.random = options.random;
    this.covers = options.covers;
    this.listener = options.listener;
    this.eye = options.eye ?? { x: 0, y: 1.7, z: 0 };
    this.yaw = options.yaw ?? 0;
    this.difficulty = options.difficulty ?? "standard";
    this.baseline = DIFFICULTY[this.difficulty];
    this.tuning = { ...this.baseline };
    // The live numbers: the player's regeneration wears with the rest.
    this.health = new PlayerHealth(this.tuning);
    for (let i = 0; i < STICKS; i++) {
      const d = new Dynamite(i);
      d.state = "exploded";
      this.sticks.push(d);
    }
    this.hasHighCovers = this.covers.some(isHigh);
    this.bossCovers = pickBossCovers(this.covers);
    const l = this.listener;
    this.events = {
      banditTell: (b) => l.banditTell(b),
      banditEmerge: (b) => l.banditEmerge(b),
      banditAim: (b) => l.banditAim(b),
      banditGlint: (b) => l.banditGlint(b),
      banditHide: (b) => l.banditHide(b),
      banditRelocate: (b, from) => l.banditRelocate(b, from),
      banditRun: (b) => l.banditRun(b),
      banditLight: (b) => l.banditLight(b),
      banditPace: (b, n) => l.banditPace(b, n),
      banditStandoff: (b) => l.banditStandoff(b),
      duelBell: (b) => l.duelBell(b),
      banditDead: (b) => l.banditDead(b),
    };
    this.townEvents = {
      townsfolkAppear: (p) => l.townsfolkAppear(p),
      townsfolkHide: (p) => l.townsfolkHide(p),
      townsfolkGone: (p) => {
        if (this.occupant.get(p.cover.id) === p) this.vacate(p.cover);
        l.townsfolkGone(p);
      },
    };
  }

  // --- the flow of a game -----------------------------------------------------

  start(options: StartOptions = {}): void {
    const first = Math.max(1, Math.floor(options.wave ?? 1));
    if (options.duel && first === 1) {
      this.beginDuel();
    } else {
      this.beginWave(first, true);
    }
  }

  get over(): boolean {
    return this.phase === "dead";
  }

  /** Bandits of this wave still to be put down: those in play and those waiting their turn. */
  get remaining(): number {
    let n = this.queue.length;
    for (const b of this.bandits) if (b.alive) n++;
    return n;
  }

  update(dt: number, offscreen: boolean): void {
    this.time += dt;
    this.phaseT += dt;
    const reload = this.revolver.update(dt, offscreen && this.phase !== "dead");
    if (reload) this.listener.reload(reload === "started");
    this.wear();
    this.health.update(dt);

    switch (this.phase) {
      case "ready":
        return;
      case "intro":
        if (this.phaseT >= WAVE_INTRO) this.beginCombat();
        break;
      case "duel":
        this.stepBandits(dt);
        this.stepSticks(dt);
        if (this.duelist && (this.duelist.role !== "duelist" || !this.duelist.alive)) {
          this.duelist = null;
          this.phase = "combat";
          this.spawnTimer = 1.2;
        }
        break;
      case "combat":
        this.stepBandits(dt);
        this.stepTownsfolk(dt);
        this.stepSticks(dt);
        this.spawn(dt);
        this.scheduleTownsfolk();
        this.checkClear();
        break;
      case "intermission":
        this.stepBandits(dt);
        this.stepTownsfolk(dt);
        if (this.phaseT >= INTERMISSION) this.beginWave(this.wave + 1, false);
        break;
      case "dead":
        this.stepBandits(dt);
        this.stepTownsfolk(dt);
        break;
    }
  }

  private beginWave(wave: number, intro: boolean): void {
    this.wave = wave;
    this.spec = waveSpec(wave);
    this.queue = buildQueue(this.spec, this.random);
    this.clearBodies();
    this.spawned = 0;
    this.townsfolkTimes = [];
    for (let i = 0; i < this.spec.townsfolk; i++) this.townsfolkTimes.push(range(this.random, 5, 24));
    this.townsfolkTimes.sort((a, b) => a - b);
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
    this.spawnTimer = 0.2;
    this.listener.waveStart(this.wave, this.spec);
  }

  private beginDuel(): void {
    this.wave = 1;
    this.spec = waveSpec(1);
    this.queue = buildQueue(this.spec, this.random);
    this.queue.pop(); // the duelist is one of wave 1's four
    this.townsfolkTimes = [];
    const cover = pickDuelCover(this.covers);
    const b = new Bandit(this.nextId++, "duelist", cover);
    let from: V3;
    let to: V3;
    if (isDuelMark(cover)) {
      // The town's mark in the street: he walks out to it from his cover
      // (the freight crates), ten paces, and turns to face you there.
      from = cover.ready ?? cover.hidden;
      to = cover.exposed;
    } else {
      // Ten paces out from a door to the middle of the street, about fifteen metres from you.
      from = cover.exposed;
      to = { x: from.x * 0.06, y: 0, z: Math.max(from.z + 2.5, Math.min(-13, from.z + 9.5)) };
    }
    b.startDuel(from, to);
    this.bandits.push(b);
    this.duelist = b;
    this.phase = "duel";
    this.phaseT = 0;
    this.listener.banner("High Noon", "Draw when the bell tolls.");
    this.listener.waveStart(1, this.spec);
    this.listener.banditSpawn(b);
    this.found("high_noon", this.secrets.highNoon());
  }

  private checkClear(): void {
    if (this.queue.length > 0) return;
    for (const b of this.bandits) if (b.state !== "dead") return;
    for (const s of this.sticks) if (s.state !== "exploded") return;
    this.startIntermission();
  }

  private startIntermission(): void {
    const bonuses = this.scorer.endWave();
    this.listener.waveClear(this.wave, bonuses);
    this.listener.score(this.scorer.score);
    this.health.heal();
    for (const p of this.townsfolk) p.dismiss(this.townEvents);
    // The breather takes the fallen away while the title card is up.
    for (const b of this.bandits) this.listener.bodyCleared(b);
    this.phase = "intermission";
    this.phaseT = 0;
    const next = this.wave + 1;
    const giant = this.secrets.giantPending;
    this.listener.intermission(next, giant);
    if (giant) this.found("tumbleweeds", this.secrets.giantRolled());
    this.listener.banner(`Wave ${next}`, waveSpec(next).subtitle);
  }

  private clearBodies(): void {
    this.bandits = [];
    this.bodies.clear();
    this.occupant.clear();
    this.slotsInUse = 0;
    this.townsfolk = this.townsfolk.filter((p) => p.state !== "gone");
    for (const p of this.townsfolk) this.occupant.set(p.cover.id, p);
  }

  // --- the gang ---------------------------------------------------------------

  private stepBandits(dt: number): void {
    for (let i = 0; i < this.bandits.length; i++) (this.bandits[i] as Bandit).step(dt, this);
  }

  private activeCount(): number {
    let n = 0;
    for (const b of this.bandits) if (b.inPlay && b.role !== "boss") n++;
    return n;
  }

  private spawn(dt: number): void {
    this.spawnTimer -= dt;
    if (this.spawnTimer > 0 || this.queue.length === 0) return;
    const entry = this.queue[0] as QueueEntry;
    if (entry.role !== "boss" && this.activeCount() >= this.spec.maxActive) return;
    const cover = this.chooseCover(entry.role);
    if (!cover) {
      this.spawnTimer = 0.5;
      return;
    }
    this.queue.shift();
    if (this.bodies.has(cover.id)) {
      this.bodies.delete(cover.id);
      for (const dead of this.bandits) if (!dead.alive && dead.cover === cover) this.listener.bodyCleared(dead);
    }
    const b = new Bandit(this.nextId++, entry.role, cover);
    b.armour = entry.armoured ? 1 : 0;
    b.health = entry.role === "boss" ? BOSS_HEALTH : 1;
    this.occupy(cover, b);
    b.spawn(entry.role === "boss" ? range(this.random, 1.2, 1.8) : range(this.random, 0.3, 0.9));
    this.bandits.push(b);
    this.spawned++;
    this.listener.banditSpawn(b);
    // The opening bandits trickle in quickly; replacements take a breath.
    this.spawnTimer = this.spawned <= this.spec.maxActive ? range(this.random, 0.5, 0.9) : range(this.random, 0.9, 1.7);
  }

  acquireSlot(b: Bandit): boolean {
    if (b.slot) return true;
    if (this.phase === "dead") return false;
    if (b.role === "boss") {
      b.slot = true;
      return true;
    }
    if (!b.forced && this.slotsInUse >= this.spec.maxAiming) return false;
    b.slot = true;
    this.slotsInUse++;
    return true;
  }

  releaseSlot(b: Bandit): void {
    if (!b.slot) return;
    b.slot = false;
    if (b.role !== "boss") this.slotsInUse = Math.max(0, this.slotsInUse - 1);
  }

  canFire(_b: Bandit): boolean {
    return this.phase !== "dead" && this.time - this.lastShotTime >= MIN_SHOT_GAP;
  }

  /**
   * How bold the gang has grown in this wave's fighting, as a multiplier on
   * its hit chance: 1 until the difficulty's boldAfter seconds, then
   * climbing by boldRate a second to its boldMax.
   */
  boldness(): number {
    if (this.phase !== "combat") return 1;
    const t = this.baseline;
    return Math.min(t.boldMax, 1 + Math.max(0, this.phaseT - t.boldAfter) * t.boldRate);
  }

  /** The late-wave pressure as a fraction: 0 (none yet) to 1 (the gang at its boldest). */
  pressure(): number {
    const max = this.baseline.boldMax;
    return max > 1 ? (this.boldness() - 1) / (max - 1) : 0;
  }

  /**
   * An easier difficulty's allowances wear off under the pressure: by the
   * time the gang is at its boldest it aims, hits and hurts as it does on
   * Standard, and health comes back no sooner. Without that, a Relaxed
   * player who stopped shooting would be kept alive for ever. On Standard
   * the baseline is Standard's own, and nothing moves.
   */
  private wear(): void {
    const k = this.pressure();
    const from = this.baseline;
    const to = DIFFICULTY.standard;
    const t = this.tuning;
    t.aimFactor = from.aimFactor + (to.aimFactor - from.aimFactor) * k;
    t.glintLead = from.glintLead + (to.glintLead - from.glintLead) * k;
    t.hitFactor = from.hitFactor + (to.hitFactor - from.hitFactor) * k;
    t.damageFactor = from.damageFactor + (to.damageFactor - from.damageFactor) * k;
    t.regenDelay = from.regenDelay + (to.regenDelay - from.regenDelay) * k;
    t.regenRate = from.regenRate + (to.regenRate - from.regenRate) * k;
    t.lightTime = from.lightTime + (to.lightTime - from.lightTime) * k;
    t.flightFactor = from.flightFactor + (to.flightFactor - from.flightFactor) * k;
  }

  fire(b: Bandit): void {
    this.lastShotTime = this.time;
    const spec = this.spec;
    const t = this.tuning;
    const d = horizontalDistance(b.pos, this.eye);
    let p = spec.hitChance;
    if (b.role === "duelist") p = 0.85;
    else if (b.role !== "rifleman") p *= Math.min(1, Math.max(0.45, 1.15 - d / 70));
    if (b.role === "boss") p *= 1.1;
    p *= t.hitFactor;
    p *= this.boldness();
    if (this.health.sinceHit < HIT_GRACE) p *= HIT_GRACE_FACTOR;
    p = Math.min(p, 0.95);
    const hit = this.random() < p;
    const damage = Math.round(spec.damage * t.damageFactor * (b.role === "rifleman" ? RIFLE_DAMAGE_FACTOR : 1));
    for (const person of this.townsfolk) person.bulletsFly(this.time);
    this.listener.banditFire(b, hit, damage);
    if (hit) this.damagePlayer(damage, b.pos, "bullet");
  }

  canThrow(b: Bandit): boolean {
    if (this.phase !== "combat") return false;
    if (b.cover.distance > DYNAMITE_RANGE) return false;
    let live = 0;
    for (const s of this.sticks) if (s.state !== "exploded") live++;
    return live < 2;
  }

  throwDynamite(b: Bandit): void {
    const stick = this.freeStick();
    if (!stick) return;
    const start = throwHand(b.pos, this.eye);
    const target: V3 = {
      x: this.eye.x + range(this.random, -1.6, 1.6),
      y: 0.05,
      z: this.eye.z - range(this.random, 3.2, 5),
    };
    stick.throwerId = b.id;
    stick.launch(start, target, flightTimeFor(horizontalDistance(start, target), this.tuning.flightFactor));
    this.listener.banditThrow(b, stick);
  }

  private freeStick(): Dynamite | null {
    for (const s of this.sticks) if (s.state === "exploded") return s;
    return null;
  }

  relocateTarget(b: Bandit): Cover | null {
    if (b.role === "boss") {
      const n = this.bossCovers.length;
      const at = this.bossCovers.indexOf(b.cover);
      for (let k = 1; k <= n; k++) {
        const c = this.bossCovers[(Math.max(0, at) + k) % n] as Cover;
        if (c !== b.cover && this.isFree(c)) return this.move(b, c);
      }
      return null;
    }
    let total = 0;
    const options: Cover[] = [];
    const weights: number[] = [];
    for (const c of this.covers) {
      if (c === b.cover || !this.allowed(b.role, c) || !this.isFree(c) || this.bodies.has(c.id)) continue;
      const d = horizontalDistance(b.cover.hidden, c.hidden);
      if (d > ADJACENT_RADIUS) continue;
      const w = 1 / (1 + d);
      options.push(c);
      weights.push(w);
      total += w;
    }
    const c = weightedPick(options, weights, total, this.random);
    return c ? this.move(b, c) : null;
  }

  runTarget(b: Bandit): Cover | null {
    let total = 0;
    const options: Cover[] = [];
    const weights: number[] = [];
    const inStreet = b.role === "gunman" && b.state !== "hidden";
    for (const c of this.covers) {
      if (c === b.cover || c.level !== 0 || isHigh(c) || isDuelMark(c) || !this.isFree(c) || this.bodies.has(c.id)) continue;
      const d = horizontalDistance(b.pos, c.exposed);
      if (inStreet) {
        if (d > 22) continue;
        const w = 1 / (1 + d);
        options.push(c);
        weights.push(w);
        total += w;
        continue;
      }
      // A runner crosses the street, near enough to be seen and led.
      if (d < 6 || d > 28 || c.side === b.cover.side || c.distance > 40 || b.cover.distance > 40) continue;
      const w = 1 / (1 + Math.abs(d - 12) * 0.1);
      options.push(c);
      weights.push(w);
      total += w;
    }
    const c = weightedPick(options, weights, total, this.random);
    return c ? this.move(b, c) : null;
  }

  runnersRunning(): number {
    let n = 0;
    for (const b of this.bandits) if (b.state === "running") n++;
    return n;
  }

  coveringFire(boss: Bandit): void {
    let n = 0;
    for (const b of this.bandits) {
      if (n >= BOSS_COVER_FIRE) break;
      if (b === boss || b.state !== "hidden" || !b.alive) continue;
      b.forced = true;
      b.dur = Math.min(b.dur, b.t + range(this.random, 0.15, 0.45));
      n++;
    }
  }

  private chooseCover(role: Role): Cover | null {
    let total = 0;
    const options: Cover[] = [];
    const weights: number[] = [];
    const list = role === "boss" ? this.bossCovers : this.covers;
    for (const c of list) {
      if (!this.allowed(role, c) || !this.isFree(c)) continue;
      let w = this.bodies.has(c.id) ? 0.05 : 1;
      const vacated = this.vacatedAt.get(c.id);
      if (vacated !== undefined && this.time - vacated < 3) w *= 0.3;
      for (const [id, who] of this.occupant) {
        if (id === c.id || !(who instanceof Bandit)) continue;
        if (horizontalDistance(who.cover.exposed, c.exposed) < 6) w *= 0.5;
      }
      options.push(c);
      weights.push(w);
      total += w;
    }
    return weightedPick(options, weights, total, this.random);
  }

  private allowed(role: Role, c: Cover): boolean {
    const high = isHigh(c);
    // The duel's mark is out in the open in the middle of the street, its
    // "hidden" spot the freight crates metres away: only the duelist walks
    // out to it. Anyone else sent there would slide across the street.
    if (isDuelMark(c)) return false;
    switch (role) {
      case "rifleman":
        return this.hasHighCovers ? high || (c.kind === "roof" && c.level >= 1) : c.level >= 1;
      case "boss":
        return this.bossCovers.includes(c);
      case "runner":
        return !high && c.level === 0;
      case "dynamiter":
        return !high && c.distance <= Math.min(DYNAMITE_RANGE, this.spec.reach);
      default:
        return !high && c.distance <= this.spec.reach;
    }
  }

  private isFree(c: Cover): boolean {
    return !this.occupant.has(c.id);
  }

  private occupy(c: Cover, who: Bandit | Townsperson): void {
    this.occupant.set(c.id, who);
  }

  private vacate(c: Cover): void {
    this.occupant.delete(c.id);
    this.vacatedAt.set(c.id, this.time);
  }

  /** Reserve `to` for `b` and free the cover he leaves. */
  private move(b: Bandit, to: Cover): Cover {
    if (this.occupant.get(b.cover.id) === b) this.vacate(b.cover);
    this.occupy(to, b);
    return to;
  }

  // --- dynamite ---------------------------------------------------------------

  private stepSticks(dt: number): void {
    for (const s of this.sticks) {
      if (s.state === "exploded") continue;
      if (s.update(dt)) this.explode(s, false);
    }
  }

  private explode(stick: Dynamite, shotInAir: boolean): void {
    stick.state = "exploded";
    this.listener.dynamiteExplode(stick, shotInAir);
    const at = stick.position;
    for (const b of this.bandits) {
      if (!b.inPlay) continue;
      const dx = b.pos.x - at.x;
      const dy = b.pos.y + 1 - at.y;
      const dz = b.pos.z - at.z;
      if (dx * dx + dy * dy + dz * dz <= DYNAMITE_BLAST_RADIUS * DYNAMITE_BLAST_RADIUS) this.kill(b, "blast");
    }
    const px = at.x - this.eye.x;
    const pz = at.z - this.eye.z;
    const py = at.y;
    if (px * px + py * py + pz * pz <= DYNAMITE_PLAYER_RADIUS * DYNAMITE_PLAYER_RADIUS) {
      const damage = Math.max(DYNAMITE_DAMAGE, Math.round(this.spec.damage * 1.5));
      this.damagePlayer(Math.round(damage * this.tuning.damageFactor), at, "dynamite");
    }
  }

  // --- the player ---------------------------------------------------------------

  private damagePlayer(amount: number, from: V3, source: "bullet" | "dynamite"): void {
    if (this.phase === "dead") return;
    this.scorer.damaged();
    const direction = damageDirection(this.eye, this.yaw, from);
    const died = this.health.hit(amount);
    this.listener.playerHit(amount, direction, this.health.hurt, source);
    if (died) {
      this.phase = "dead";
      this.phaseT = 0;
      for (const b of this.bandits) this.releaseSlot(b);
      this.listener.playerDeath();
    }
  }

  /** The finger folds: fire a round, click on empty, or nothing mid-reload. */
  trigger(): TriggerResult {
    if (this.phase === "dead") return "reloading";
    const result = this.revolver.trigger();
    if (result === "fired") for (const p of this.townsfolk) p.bulletsFly(this.time);
    return result;
  }

  requestReload(): boolean {
    if (this.phase === "dead") return false;
    const started = this.revolver.reload();
    if (started) this.listener.reload(true);
    return started;
  }

  /** What the bullet hit. Call once per shot fired, straight after trigger(). */
  resolveShot(target: ShotTarget): void {
    const scorer = this.scorer;
    switch (target.kind) {
      case "bandit": {
        const b = target.bandit;
        this.secrets.shotAt(null);
        if (!b.shootable) {
          scorer.shot(false);
          return;
        }
        if (scorer.shot(true)) this.listener.streakUp(scorer.multiplier);
        if (target.part === "head") {
          this.kill(b, "head");
        } else if (b.armour > 0) {
          b.armour--;
          this.wound(b, target.part);
        } else if (b.role === "boss" && b.health > 1) {
          b.health--;
          this.wound(b, target.part);
        } else {
          this.kill(b, target.part);
        }
        return;
      }
      case "townsfolk": {
        this.secrets.shotAt(null);
        const p = target.person;
        if (!p.shootable || p.shot) {
          scorer.shot(false);
          return;
        }
        scorer.shot(false);
        const award = scorer.innocent();
        p.hit();
        this.listener.townsfolkShot(p, award);
        this.listener.score(scorer.score);
        return;
      }
      case "dynamite": {
        this.secrets.shotAt(null);
        const stick = target.stick;
        if (!stick.airborne) {
          scorer.shot(false);
          return;
        }
        if (scorer.shot(true)) this.listener.streakUp(scorer.multiplier);
        const award = scorer.dynamiteInAir();
        this.listener.dynamiteShot(stick, award);
        this.explode(stick, true);
        this.listener.score(scorer.score);
        return;
      }
      case "secret":
        this.secrets.shotAt(target.secret);
        this.secretShot(target.secret);
        return;
      case "chicken": {
        this.secrets.shotAt(null);
        const r = this.secrets.chicken();
        this.listener.chickenStartled(r.hits);
        this.found("chicken", r.newlyFound);
        return;
      }
      case "tumbleweed": {
        this.secrets.shotAt(null);
        const r = this.secrets.tumbleweed();
        this.listener.tumbleweedShot(r.shot, r.giant);
        return;
      }
      default:
        this.secrets.shotAt(null);
        scorer.shot(false);
        return;
    }
  }

  private secretShot(id: SecretId): void {
    const s = this.secrets;
    switch (id) {
      case "bell": {
        const r = s.bell();
        this.listener.bellToll(r.toll, r.doorsOpen);
        this.found("bell", r.newlyFound);
        return;
      }
      case "piano": {
        const r = s.piano();
        this.listener.pianoNote(r.notes, r.tune);
        this.found("piano", r.newlyFound);
        return;
      }
      case "vane":
        this.found("vane", s.vane());
        return;
      case "water_tower":
        this.found("water_tower", s.waterTower());
        return;
      case "poster":
        this.found("poster", s.poster());
        return;
      default:
        return;
    }
  }

  private found(id: SecretId, newly: boolean): void {
    if (newly) this.listener.secretFound(id, SECRET_NAMES[id], this.secrets.count, SECRETS_TOTAL);
  }

  private wound(b: Bandit, part: HitPart): void {
    b.stagger();
    this.listener.banditWound(b, part);
  }

  private kill(b: Bandit, part: HitPart | "blast"): void {
    if (!b.alive) return;
    const running = b.state === "running";
    const quickDraw = part !== "blast" && this.time - b.emergedAt <= QUICK_DRAW_WINDOW;
    if (b.lit && !b.released) {
      const stick = this.freeStick();
      if (stick) {
        stick.throwerId = b.id;
        stick.drop({ x: b.pos.x, y: b.pos.y + 0.1, z: b.pos.z }, DYNAMITE_DROP_FUSE);
        this.listener.dynamiteDropped(stick, b);
      }
    }
    const choice = chooseDeath(b.cover, part, b.state, this.random);
    this.releaseSlot(b);
    if (running && b.runTo) {
      if (this.occupant.get(b.runTo.id) === b) this.vacate(b.runTo);
      b.runTo = null;
    }
    if (this.occupant.get(b.cover.id) === b) this.vacate(b.cover);
    // A body left lying at a cover makes it a last resort for the next man;
    // if one is sent there anyway, the body is taken away first.
    if (!choice.fall && !running) this.bodies.add(b.cover.id);
    b.diedAt = this.time;
    b.die(choice);
    const award = this.scorer.kill({
      headshot: part === "head",
      quickDraw,
      runner: running,
      boss: b.role === "boss",
      blast: part === "blast",
    });
    this.listener.banditDeath(b, part, award);
    this.listener.score(this.scorer.score);
  }

  // --- townsfolk ----------------------------------------------------------------

  private stepTownsfolk(dt: number): void {
    for (let i = 0; i < this.townsfolk.length; i++) (this.townsfolk[i] as Townsperson).step(dt, this.townEvents);
  }

  private scheduleTownsfolk(): void {
    const next = this.townsfolkTimes[0];
    if (next === undefined || this.phaseT < next) return;
    for (const p of this.townsfolk) {
      if (p.state !== "gone") {
        this.townsfolkTimes[0] = this.phaseT + 2;
        return;
      }
    }
    let total = 0;
    const options: Cover[] = [];
    const weights: number[] = [];
    for (const c of this.covers) {
      if ((c.kind !== "door" && c.kind !== "window") || c.level > 1 || !this.isFree(c) || this.bodies.has(c.id)) continue;
      const id = c.id.toLowerCase();
      const home =
        c.tags.includes("townsfolk") || /barber|hotel|saloon|undertaker/.test(id) ? 4 : 1;
      options.push(c);
      weights.push(home);
      total += home;
    }
    const cover = weightedPick(options, weights, total, this.random);
    this.townsfolkTimes.shift();
    if (!cover) return;
    const p = Townsperson.create(this.nextId++, roleForCover(cover, this.random), cover, this.random);
    this.occupy(cover, p);
    this.townsfolk.push(p);
  }

  /** The preacher answers the bell: he comes to the church door for a look. */
  spawnPreacher(cover: Cover): Townsperson {
    const p = new Townsperson(this.nextId++, "preacher", cover, 2.6);
    p.state = "hidden";
    p.dur = 0.9;
    this.townsfolk.push(p);
    return p;
  }

  // --- the end --------------------------------------------------------------------

  results(): Results {
    const s = this.scorer;
    const survived = Math.max(0, this.wave - 1);
    return {
      outcome: `Fell on Wave ${this.wave}`,
      won: false,
      score: s.score,
      stats: [
        { label: "Waves", value: String(survived) },
        { label: "Kills", value: String(s.kills) },
        { label: "Headshots", value: String(s.headshots) },
        { label: "Accuracy", value: `${Math.round(s.accuracy * 100)}%` },
        { label: "Best Streak", value: String(s.bestStreak) },
      ],
      secretsFound: this.secrets.count,
      secretsTotal: SECRETS_TOTAL,
    };
  }
}

// --- helpers ----------------------------------------------------------------------

/**
 * A rifleman's perch: a roof edge or the bell tower, up high. A first-floor
 * "roof" (a balcony rail, a porch roof) is not: any gunman may use it.
 */
export function isHigh(c: Cover): boolean {
  return c.kind === "tower" || c.level >= 2;
}

/** Where a man standing at `feet` and facing `eye` holds a stick as he lets it go. */
export function throwHand(feet: V3, eye: V3): V3 {
  const fx = eye.x - feet.x;
  const fz = eye.z - feet.z;
  const len = Math.hypot(fx, fz) || 1;
  const ux = fx / len;
  const uz = fz / len;
  // Facing (ux, uz), his left is (uz, −ux).
  return {
    x: feet.x + ux * THROW_HAND.forward + uz * THROW_HAND.left,
    y: feet.y + THROW_HAND.up,
    z: feet.z + uz * THROW_HAND.forward - ux * THROW_HAND.left,
  };
}

/** The High Noon duel's mark in the street (tagged `duel` by the town): the duelist's alone. */
export function isDuelMark(c: Cover): boolean {
  return c.tags.includes("duel");
}

function weightedPick<T>(options: T[], weights: number[], total: number, random: Random): T | null {
  if (options.length === 0 || total <= 0) return null;
  let r = random() * total;
  for (let i = 0; i < options.length; i++) {
    r -= weights[i] as number;
    if (r <= 0) return options[i] as T;
  }
  return options[options.length - 1] as T;
}

/** The wave's gang, in the order they come: Black Jack first, the rest shuffled. */
export function buildQueue(spec: WaveSpec, random: Random): QueueEntry[] {
  const roles: Role[] = [];
  for (let i = 0; i < spec.riflemen; i++) roles.push("rifleman");
  for (let i = 0; i < spec.dynamiters; i++) roles.push("dynamiter");
  for (let i = 0; i < spec.runners; i++) roles.push("runner");
  while (roles.length < spec.bandits) roles.push("gunman");
  shuffle(random, roles);
  let armour = spec.armoured;
  const queue: QueueEntry[] = roles.map((role) => {
    const armoured = armour > 0 && (role === "gunman" || role === "rifleman");
    if (armoured) armour--;
    return { role, armoured };
  });
  if (spec.boss) queue.unshift({ role: "boss", armoured: false });
  return queue;
}

/**
 * Black Jack's three covers: the town's `boss`-tagged ones, or else three
 * street-level covers at middle distance, spread as far apart as possible.
 */
export function pickBossCovers(covers: readonly Cover[]): Cover[] {
  const tagged = covers.filter((c) => c.tags.includes("boss"));
  if (tagged.length >= 2) return tagged;
  // Close enough to be the star of the wave: 14 to 32 m out.
  const pool = covers.filter((c) => !isHigh(c) && !isDuelMark(c) && c.level === 0 && c.distance >= 14 && c.distance <= 32);
  const source = pool.length >= 3 ? pool : covers.filter((c) => !isHigh(c));
  if (source.length <= 3) return source.slice();
  // Greedy spread: start nearest the middle of the street, add the farthest each time.
  const chosen: Cover[] = [];
  let best = source[0] as Cover;
  for (const c of source) if (Math.abs(c.distance - 22) < Math.abs(best.distance - 22)) best = c;
  chosen.push(best);
  while (chosen.length < 3) {
    let far: Cover | null = null;
    let farD = -1;
    for (const c of source) {
      if (chosen.includes(c)) continue;
      let d = Number.POSITIVE_INFINITY;
      for (const k of chosen) d = Math.min(d, horizontalDistance(k.exposed, c.exposed));
      if (d > farD) {
        farD = d;
        far = c;
      }
    }
    if (!far) break;
    chosen.push(far);
  }
  return chosen;
}

/** Where the duelist comes from: a `duel`-tagged cover, the saloon's door, or the nearest street door past 15 m. */
export function pickDuelCover(covers: readonly Cover[]): Cover {
  const tagged = covers.find((c) => c.tags.includes("duel"));
  if (tagged) return tagged;
  const saloon = covers.find((c) => c.kind === "door" && c.id.toLowerCase().includes("saloon"));
  if (saloon) return saloon;
  let best: Cover | null = null;
  for (const c of covers) {
    if (c.kind !== "door" && c.level !== 0) continue;
    if (!best || Math.abs(c.distance - 22) < Math.abs(best.distance - 22)) best = c;
  }
  const chosen = best ?? covers[0];
  if (!chosen) throw new Error("the town has no covers");
  return chosen;
}
