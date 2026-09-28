/**
 * Shared fixtures for the rules' tests: the placeholder valley's plan (the
 * same places the dev harness shows), a listener that writes down all the
 * mission says, and simulated riflemen of different skill who play the
 * stages through the real rules.
 */
import { mulberry32 } from "../../../engine/rules/rng";
import type { Difficulty } from "../../../engine/types";
import { layoutPlan } from "../placeholder/plan";
import type { Actor, Vehicle } from "./actors";
import { drop, holdMils, timeOfFlight, windMils } from "./ballistics";
import { Mission, type AlertCause, type MissionListener } from "./mission";
import type { StageSpec } from "./jobs";
import type { Award, StageBonuses } from "./scoring";
import type { Ending, HitPart, HostileRole, Plan, SecretId, V3 } from "./types";

let cachedPlan: Plan | null = null;

/** The placeholder valley's plan (made once: the terrain is a pure function, but not a fast one). */
export function testPlan(): Plan {
  cachedPlan ??= layoutPlan();
  return cachedPlan;
}

export interface Recorded {
  name: string;
  args: unknown[];
}

/** A MissionListener that writes down every call, in order. */
export class Recorder implements MissionListener {
  readonly log: Recorded[] = [];
  private note(name: string, ...args: unknown[]): void {
    this.log.push({ name, args });
  }
  count(name: string): number {
    return this.log.filter((e) => e.name === name).length;
  }
  last(name: string): Recorded | undefined {
    for (let i = this.log.length - 1; i >= 0; i--) if (this.log[i]?.name === name) return this.log[i];
    return undefined;
  }
  stageIntro(stage: number, _spec: StageSpec, title: string, line: string) { this.note("stageIntro", stage, title, line); }
  stageStart(stage: number) { this.note("stageStart", stage); }
  stageClear(stage: number, b: StageBonuses) { this.note("stageClear", stage, b); }
  breather(next: number) { this.note("breather", next); }
  spawn(a: Actor) { this.note("spawn", a.id, a.role); }
  gone(a: Actor) { this.note("gone", a.id); }
  vehicleSpawn(v: Vehicle) { this.note("vehicleSpawn", v.id, v.kind); }
  vehicleGone(v: Vehicle) { this.note("vehicleGone", v.id); }
  alerted(cause: AlertCause, by: Actor | null) { this.note("alerted", cause, by?.id ?? null); }
  glint(a: Actor, seconds: number, kind: string) { this.note("glint", a.id, seconds, kind); }
  enemyFire(a: Actor, weapon: string, hit: boolean, damage: number) { this.note("enemyFire", a.id, weapon, hit, damage); }
  mortarLaunch(a: Actor, flight: number) { this.note("mortarLaunch", a.id, flight); }
  mortarLand(outcome: string, damage: number) { this.note("mortarLand", outcome, damage); }
  playerHit(damage: number, direction: number, hurt: number, by: HostileRole) { this.note("playerHit", damage, direction, hurt, by); }
  playerDeath(ending: Ending) { this.note("playerDeath", ending); }
  failed(ending: Ending) { this.note("failed", ending); }
  kill(a: Actor, part: HitPart, award: Award) { this.note("kill", a.id, part, award); }
  wound(a: Actor, part: HitPart) { this.note("wound", a.id, part); }
  innocentHit(a: Actor, award: Award) { this.note("innocentHit", a.id, a.role, award); }
  vehicleHit(v: Vehicle, engine: boolean) { this.note("vehicleHit", v.id, engine); }
  vehicleStopping(v: Vehicle, why: string) { this.note("vehicleStopping", v.id, why); }
  engineStop(v: Vehicle, award: Award) { this.note("engineStop", v.id, award); }
  dismount(a: Actor, v: Vehicle) { this.note("dismount", a.id, v.id); }
  startled(a: Actor) { this.note("startled", a.id, a.role); }
  streakUp(m: number) { this.note("streakUp", m); }
  score(v: number) { this.note("score", v); }
  rifle(event: string) { this.note("rifle", event); }
  secretFound(id: SecretId, name: string, found: number, total: number) { this.note("secretFound", id, name, found, total); }
  goatHop(a: Actor, ledge: number) { this.note("goatHop", a.id, ledge); }
  eagleLands(a: Actor) { this.note("eagleLands", a.id); }
}

export function newMission(seed: number, difficulty: Difficulty = "standard"): { mission: Mission; rec: Recorder } {
  const rec = new Recorder();
  const mission = new Mission({ random: mulberry32(seed), plan: testPlan(), listener: rec, difficulty });
  return { mission, rec };
}

/** Run the mission for `seconds` in 30 Hz steps. */
export function run(m: Mission, seconds: number, dt = 1 / 30): void {
  for (let t = 0; t < seconds; t += dt) m.update(dt);
}

// --- simulated riflemen -------------------------------------------------------------------

export interface Skill {
  /** Seconds to find a target through the scope and settle on it, plus this much per 100 m. */
  acquire: number;
  acquirePer100: number;
  /** The aim's own wobble once settled, milliradians (one standard deviation each way). */
  precision: number;
  /** How far off the hold for the drop is, as a fraction of the drop. */
  dropError: number;
  /** How far off the hold for the wind is, as a fraction of the drift. */
  windError: number;
  /** How far off the lead on a moving man is, as a fraction of the lead. */
  leadError: number;
  /** Goes for the head on a man standing still closer than this, metres. */
  headshotRange: number;
}

export const SKILLS: Readonly<Record<"steady" | "average" | "shaky", Skill>> = {
  steady: { acquire: 1.4, acquirePer100: 0.15, precision: 0.22, dropError: 0.12, windError: 0.3, leadError: 0.22, headshotRange: 320 },
  average: { acquire: 2.2, acquirePer100: 0.25, precision: 0.34, dropError: 0.25, windError: 0.55, leadError: 0.4, headshotRange: 0 },
  shaky: { acquire: 3.2, acquirePer100: 0.35, precision: 0.5, dropError: 0.4, windError: 0.8, leadError: 0.6, headshotRange: 0 },
};

/** erf, for the chance a Gaussian aim lands inside a target's half-width. */
function erf(x: number): number {
  const s = Math.sign(x);
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a);
  return s * y;
}

/** The chance a shot with this aim error (mils) lands inside a box `w` by `h` metres at `range`. */
export function hitChance(range: number, w: number, h: number, sx: number, sy: number): number {
  const ax = (500 * w) / range;
  const ay = (500 * h) / range;
  return erf(ax / (Math.max(1e-4, sx) * Math.SQRT2)) * erf(ay / (Math.max(1e-4, sy) * Math.SQRT2));
}

interface Pending {
  at: number;
  run: () => void;
}

export interface PlayResult {
  stage: number;
  cleared: number;
  time: number;
  ending: Ending | null;
  score: number;
  mission: Mission;
  rec: Recorder;
}

const dist = (a: V3, b: V3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/**
 * A simulated rifleman: picks the most urgent target (a counter-sniper
 * glinting, a gunner firing, the convoy's lead driver, then whoever is
 * left), takes his time to find it and settle through the scope, holds for
 * the drop, the wind and the lead with his skill's errors, fires, works the
 * bolt, reloads when empty, and the round lands after its time of flight
 * with the chance his aim gives it. The Relaxed holdover dot takes most of
 * the drop and wind error away. Plays until he is spotted, a job fails, he
 * passes `maxStage`, or `maxTime` goes by.
 */
export function playRun(seed: number, skill: Skill, options: { difficulty?: Difficulty; maxStage?: number; maxTime?: number; startStage?: number } = {}): PlayResult {
  const difficulty = options.difficulty ?? "standard";
  const maxStage = options.maxStage ?? 12;
  const maxTime = options.maxTime ?? 1500;
  const { mission: m, rec } = newMission(seed, difficulty);
  const dice = mulberry32(seed * 7919 + 13);
  const gauss = () => {
    const u = Math.max(1e-9, dice());
    const v = dice();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const dot = m.tuning.holdoverDot;
  const dropErr = dot ? skill.dropError * 0.2 : skill.dropError;
  const windErr = dot ? skill.windError * 0.2 : skill.windError;
  m.start(options.startStage ?? 1);
  const pending: Pending[] = [];
  let busyUntil = 0;
  let aimingAt: number | null = null;
  let aimReady = 0;
  // Spotting: each miss on the same man shows where the round went, and the next hold is closer.
  let spottedKey = -1;
  let spotted = 0;
  const dt = 1 / 30;
  let t = 0;
  for (; t < maxTime; t += dt) {
    m.update(dt);
    for (let i = pending.length - 1; i >= 0; i--) {
      if (t >= pending[i]!.at) {
        const p = pending.splice(i, 1)[0]!;
        p.run();
      }
    }
    if (m.over || m.stage > maxStage) break;
    if (m.phase !== "combat") {
      aimingAt = null;
      continue;
    }
    // The rifle first: work the bolt, reload when empty.
    if (m.rifle.state === "spent" && t >= busyUntil) m.cycle();
    if ((m.rifle.state === "open" || m.rifle.rounds === 0) && !m.rifle.reloading) {
      m.requestReload();
      busyUntil = t + 0.4;
      continue;
    }
    if (t < busyUntil || m.rifle.state !== "ready") continue;
    const target = chooseTarget(m);
    if (!target) {
      aimingAt = null;
      continue;
    }
    const range = dist(target.at, m.plan.eye);
    if (aimingAt !== target.key) {
      aimingAt = target.key;
      aimReady = t + skill.acquire + (skill.acquirePer100 * range) / 100 + dice() * 0.4;
      continue;
    }
    if (t < aimReady) continue;
    // Fire.
    if (m.trigger() !== "fired") continue;
    busyUntil = t + 0.35;
    aimingAt = null;
    const tof = timeOfFlight(range);
    const wind = m.wind.speed;
    if (spottedKey !== target.key) {
      spottedKey = target.key;
      spotted = 0;
    }
    const corrected = Math.max(0.3, Math.pow(0.55, spotted));
    spotted++;
    const sx = Math.hypot(skill.precision, windMils(range, wind) * windErr * corrected, target.speed > 0.3 ? ((1000 * target.speed * tof) / range) * skill.leadError : 0, target.extra);
    const sy = Math.hypot(skill.precision, holdMils(range) * dropErr * corrected, target.extra);
    const head = target.kind === "man" && target.speed < 0.3 && range < skill.headshotRange && target.canHead;
    const [w, h] = target.kind === "engine" ? [0.9, 0.55] : head ? [0.2, 0.22] : target.kind === "driver" ? [0.42, 0.5] : target.low ? [0.45, 0.35] : [0.42, 0.62];
    const p = hitChance(range, w, h, sx, sy);
    const hit = dice() < p;
    const key = target.key;
    const at = { ...target.at };
    pending.push({
      at: t + tof,
      run: () => {
        if (hit) {
          if (target.kind === "engine") m.land({ target: { kind: "engine", vehicle: key }, point: at, range });
          else m.land({ target: { kind: "actor", id: key, part: head ? "head" : "body" }, point: at, range });
        } else {
          // A miss lands near him: a metre or two off, or it passes close overhead.
          const off = 1 + dice() * 3;
          m.land({ target: { kind: "scenery" }, point: { x: at.x + off * gauss(), y: at.y, z: at.z + off * gauss() } , range }, [{ id: key, distance: off * 0.6 }]);
        }
      },
    });
    void drop;
  }
  return { stage: m.stage, cleared: m.stagesCleared, time: t, ending: m.ending, score: m.scorer.score, mission: m, rec };
}

interface SimTarget {
  key: number;
  kind: "man" | "driver" | "engine";
  at: V3;
  speed: number;
  /** Crouched or prone: a smaller target. */
  low: boolean;
  canHead: boolean;
  /** Extra aim error, mils (the windshield's deflection). */
  extra: number;
}

/** The most urgent target: whoever is about to hurt you, then the job. */
function chooseTarget(m: Mission): SimTarget | null {
  const shootable = m.actors.filter((a) => a.hostile && a.shootable);
  const threat = shootable.find((a) => a.role === "sniper") ?? shootable.find((a) => a.role === "gunner" && a.alerted) ?? shootable.find((a) => a.role === "mortar" && a.alerted);
  if (threat) return asTarget(threat);
  // The convoy: its lead truck while it rolls - the driver, or the engine if he cannot be seen.
  if (m.spec.job === "convoy") {
    const lead = m.vehicles.find((v) => v.kind === "truck" && v.leader === null);
    if (lead && !lead.stopping && !lead.stopped) {
      const driver = shootable.find((a) => a.vehicle === lead && a.seat === "driver");
      if (driver) return { key: driver.id, kind: "driver", at: driver.pos, speed: Math.hypot(lead.vel.x, lead.vel.z), low: false, canHead: false, extra: 0.35 };
      return { key: lead.id, kind: "engine", at: lead.pos, speed: Math.hypot(lead.vel.x, lead.vel.z), low: false, canHead: false, extra: 0 };
    }
  }
  if (m.spec.job === "officer") {
    const o = shootable.find((a) => a.role === "officer");
    if (o) return asTarget(o);
  }
  const objective = shootable.filter((a) => a.objective);
  const pool = objective.length ? objective : [];
  if (!pool.length) return null;
  // The wounded first, then the nearest.
  pool.sort((a, b) => (b.wounds - a.wounds) || dist(a.pos, m.plan.eye) - dist(b.pos, m.plan.eye));
  return asTarget(pool[0]!);
}

function asTarget(a: Actor): SimTarget {
  const low = a.activity === "crouch" || a.activity === "prone" || a.activity === "prone_aim" || a.activity === "wound";
  const driving = a.seat === "driver";
  return {
    key: a.id,
    kind: driving ? "driver" : "man",
    at: a.pos,
    speed: Math.hypot(a.vel.x, a.vel.z),
    low,
    canHead: !low,
    extra: driving ? 0.35 : 0,
  };
}

/** A player who never fires, left for `seconds`. */
export function standIdle(seed: number, difficulty: Difficulty, seconds: number, startStage = 1): PlayResult {
  const { mission: m, rec } = newMission(seed, difficulty);
  m.start(startStage);
  let t = 0;
  for (; t < seconds && !m.over; t += 1 / 30) m.update(1 / 30);
  return { stage: m.stage, cleared: m.stagesCleared, time: t, ending: m.ending, score: m.scorer.score, mission: m, rec };
}
