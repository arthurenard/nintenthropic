/**
 * Shared fixtures for the rules' tests: Route 9 as the placeholder lays it
 * out (lanes, barricade, survivors' runs), a listener that records
 * everything the match says, and simulated players.
 */
import type { V3 } from "../../../engine/rules/raymath";
import { mulberry32 } from "../../../engine/rules/rng";
import type { Difficulty } from "../../../engine/types";
import { LANES, SLOTS, SPAWNS, SURVIVOR_PATHS, type P } from "../placeholder/layout";
import { horizontalDistance, type Dead } from "./dead";
import { Match, type MatchListener, type StartOptions } from "./match";
import type { Award, WaveBonuses } from "./scoring";
import type { SecretId, SignLetter } from "./secrets";
import type { Survivor } from "./survivors";
import type { DeathCause, HitPart, Lane, RoadPlan } from "./types";
import type { WaveSpec } from "./waves";

const v = (p: P): V3 => ({ x: p[0], y: p[1], z: p[2] });

/** The placeholder road's plan: every lane and surprise, five places at the barricade. */
export function testPlan(): RoadPlan {
  const lanes: Lane[] = [
    { id: "road", points: LANES.road.points.map(v), spread: LANES.road.spread, cover: 0 },
    { id: "corn", points: LANES.corn.points.map(v), spread: LANES.corn.spread, cover: LANES.corn.cover },
    { id: "trees", points: LANES.trees.points.map(v), spread: LANES.trees.spread, cover: 0 },
    { id: "bus", points: [v(SPAWNS.bus.at), ...SPAWNS.bus.path.map(v)], spread: SPAWNS.bus.spread, cover: 0 },
    { id: "booth", points: [v(SPAWNS.booth.at), ...SPAWNS.booth.path.map(v)], spread: SPAWNS.booth.spread, cover: 0 },
    { id: "fence", points: [v(SPAWNS.fence.at), ...SPAWNS.fence.path.map(v)], spread: SPAWNS.fence.spread, cover: 0 },
  ];
  return { lanes, slots: SLOTS.map((p, index) => ({ index, pos: v(p) })), eye: { x: 0, y: 1.7, z: 0 } };
}

export function testSurvivorPaths(): V3[][] {
  return SURVIVOR_PATHS.map((path) => path.map(v));
}

export interface Recorded {
  name: string;
  args: unknown[];
}

/** A MatchListener that writes down every call, in order. */
export class Recorder implements MatchListener {
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
  all(name: string): Recorded[] {
    return this.log.filter((e) => e.name === name);
  }

  banner(title: string, subtitle?: string) { this.note("banner", title, subtitle); }
  waveStart(wave: number, _spec: WaveSpec) { this.note("waveStart", wave); }
  waveClear(wave: number, bonuses: WaveBonuses) { this.note("waveClear", wave, bonuses); }
  breather(next: number) { this.note("breather", next); }
  deadSpawn(d: Dead) { this.note("deadSpawn", d.id, d.kind, d.lane.id); }
  deadEmerged(d: Dead) { this.note("deadEmerged", d.id); }
  deadArrived(d: Dead) { this.note("deadArrived", d.id, d.state); }
  deadLunge(d: Dead) { this.note("deadLunge", d.id); }
  deadSwell(d: Dead) { this.note("deadSwell", d.id); }
  deadDown(d: Dead) { this.note("deadDown", d.id); }
  deadStrike(d: Dead, damage: number) { this.note("deadStrike", d.id, damage); }
  deadWound(d: Dead, part: HitPart) { this.note("deadWound", d.id, part); }
  maskOff(d: Dead, award: Award) { this.note("maskOff", d.id, award); }
  deadDeath(d: Dead, cause: DeathCause, award: Award | null) { this.note("deadDeath", d.id, cause, award); }
  bloaterBurst(d: Dead, shot: boolean, caught: readonly Dead[], award: Award | null) { this.note("bloaterBurst", d.id, shot, caught.map((c) => c.id), award); }
  bodyCleared(d: Dead) { this.note("bodyCleared", d.id); }
  survivorAppear(s: Survivor) { this.note("survivorAppear", s.id, s.role); }
  survivorGone(s: Survivor) { this.note("survivorGone", s.id); }
  survivorShot(s: Survivor, award: Award) { this.note("survivorShot", s.id, award); }
  playerHit(damage: number, direction: number, hurt: number, by: Dead) { this.note("playerHit", damage, direction, hurt, by.kind); }
  playerDeath() { this.note("playerDeath"); }
  streakUp(m: number) { this.note("streakUp", m); }
  score(value: number) { this.note("score", value); }
  reload(started: boolean) { this.note("reload", started); }
  roundsIn(count: number) { this.note("roundsIn", count); }
  chambered() { this.note("chambered"); }
  signLetter(letter: SignLetter, eat: boolean) { this.note("signLetter", letter, eat); }
  signRelit(letters: readonly SignLetter[]) { this.note("signRelit", [...letters]); }
  scarecrowTurn() { this.note("scarecrowTurn"); }
  scarecrowGone() { this.note("scarecrowGone"); }
  boothRing() { this.note("boothRing"); }
  driveIn() { this.note("driveIn"); }
  moonShot(shots: number, howl: "far" | "near" | null) { this.note("moonShot", shots, howl); }
  catStartled(startles: number) { this.note("catStartled", startles); }
  radio(on: boolean) { this.note("radio", on); }
  duckSqueak(squeaks: number) { this.note("duckSqueak", squeaks); }
  secretFound(id: SecretId, name: string, found: number, total: number) { this.note("secretFound", id, name, found, total); }
}

export function makeMatch(seed = 1, options: { difficulty?: Difficulty; start?: StartOptions; survivors?: boolean } = {}): { m: Match; rec: Recorder } {
  const rec = new Recorder();
  const m = new Match({
    random: mulberry32(seed),
    plan: testPlan(),
    survivorPaths: options.survivors === false ? [] : testSurvivorPaths(),
    listener: rec,
    difficulty: options.difficulty ?? "standard",
  });
  m.start(options.start ?? {});
  return { m, rec };
}

// --- simulated players ----------------------------------------------------------

export interface Skill {
  /** Seconds from seeing one of the dead to the first shot at it. */
  reaction: number;
  /** Chance a shot at one of the dead 15 m away lands (farther is harder, nearer no easier). */
  accuracy: number;
  /** Of the shots that land, the share on the head. */
  headshots: number;
}

export const STEADY: Skill = { reaction: 0.65, accuracy: 0.8, headshots: 0.4 };
export const WILD: Skill = { reaction: 1.0, accuracy: 0.55, headshots: 0.25 };
export const SLOWEST: Skill = { reaction: 1.3, accuracy: 0.45, headshots: 0.15 };

/** Is it in view: out of the fog, and out of the corn? (The corn's sway alone is no target.) */
export function inView(m: Match, d: Dead): boolean {
  if (!d.shootable) return false;
  if (d.lane.cover > 0 && d.along < d.lane.cover) return false;
  return horizontalDistance(d.pos, m.eye) <= Math.min(ENGAGE, m.sight());
}

/** Past this a player sees them coming but waits: a shot at 50 m with a finger is mostly a miss. */
const ENGAGE = 45;

/** Seconds until it is at the barricade, at the pace it walks now. */
function timeToReach(m: Match, d: Dead): number {
  if (d.atBarricade) return d.state === "swelling" ? -1 : 0;
  return d.remaining / Math.max(0.1, d.speed * m.paceFor(d));
}

/**
 * The simulated player of balance.test.ts, on either difficulty: sees the
 * dead that are out of the fog and the corn, takes `reaction` seconds to
 * get the first shot off at each, always shoots the one nearest to
 * reaching the barricade (a bloater swelling there first), aims for the
 * head (the Mechanic's mask too) but a bloater's belly, moves its aim to
 * each new target, folds the thumb at most three times a second and aims
 * each shot again, reloads when empty and tops up when the road
 * is clear, and never shoots a survivor. Plays until it falls, passes
 * `maxWave`, or `maxTime` seconds go by.
 */
export function playUntilDeath(
  seed: number,
  skill: Skill,
  options: { difficulty?: Difficulty; maxWave?: number; maxTime?: number } = {},
): { wave: number; time: number; match: Match; listener: Recorder } {
  const maxWave = options.maxWave ?? 25;
  const maxTime = options.maxTime ?? 2400;
  const { m, rec } = makeMatch(seed, { difficulty: options.difficulty ?? "standard" });
  const player = mulberry32(seed * 7919 + 1);
  const seen = new Map<number, number>();
  let cooldown = 0;
  let gesture = false;
  let last: Dead | null = null;
  const dt = 1 / 30;
  for (let t = 0; t < maxTime; t += dt) {
    m.update(dt, gesture);
    gesture = false;
    if (m.phase === "dead" || m.wave > maxWave) return { wave: m.wave, time: t, match: m, listener: rec };
    cooldown -= dt;
    const rifle = m.rifle;
    if (rifle.reloading) continue;
    const visible = m.dead.filter((d) => inView(m, d));
    if (rifle.rounds === 0 || (rifle.rounds <= 3 && !visible.some((d) => horizontalDistance(d.pos, m.eye) < 25))) {
      if (rifle.rounds < rifle.capacity) {
        // The swing off the screen and back.
        gesture = true;
        cooldown = Math.max(cooldown, 0.35);
        continue;
      }
    }
    if (cooldown > 0 || rifle.cycling > 0) continue;
    let target: Dead | null = null;
    let soonest = Number.POSITIVE_INFINITY;
    for (const d of m.dead) {
      if (!visible.includes(d)) {
        seen.delete(d.id);
        continue;
      }
      const first = seen.get(d.id) ?? t + player() * 0.25;
      seen.set(d.id, first);
      if (t - first < skill.reaction) continue;
      const when = timeToReach(m, d);
      if (when < soonest) {
        soonest = when;
        target = d;
      }
    }
    if (!target) continue;
    // A new target is a new aim: the eye and the hand move to it first.
    if (target !== last) {
      last = target;
      cooldown = 0.45 * skill.reaction;
      continue;
    }
    if (m.trigger() !== "fired") continue;
    // The thumb folds at most three times a second, and every shot is aimed
    // again after the kick: a slower hand is slower at that too.
    cooldown = 0.33 + 0.35 * skill.reaction;
    const distance = horizontalDistance(target.pos, m.eye);
    // A figure 40 m out is a few dozen pixels tall: a finger lands on it a
    // quarter as often as at the barricade, and on its head rarely.
    let p = skill.accuracy * Math.min(1, Math.max(0.25, 1.25 - distance / 40));
    if (target.kind === "crawler") p *= 0.75;
    if (target.kind === "runner" && target.state === "approaching") p *= 0.75;
    if (player() >= p) {
      m.resolveShot({ kind: "scenery" });
      continue;
    }
    const head = skill.headshots * Math.min(1, Math.max(0.2, 1.4 - distance / 30));
    const wantsHead = target.kind === "mechanic" || (target.kind !== "bloater" && player() < head);
    m.resolveShot({ kind: "dead", dead: target, part: wantsHead ? "head" : "body" });
  }
  return { wave: m.wave, time: maxTime, match: m, listener: rec };
}

/** A player who never fires, left standing for up to `maxTime` seconds. */
export function standIdle(seed: number, difficulty: Difficulty, maxTime: number): { dead: boolean; wave: number; time: number; match: Match } {
  const { m } = makeMatch(seed, { difficulty });
  let t = 0;
  const dt = 1 / 30;
  while (m.phase !== "dead" && t < maxTime) {
    m.update(dt, false);
    t += dt;
  }
  return { dead: m.phase === "dead", wave: m.wave, time: t, match: m };
}
