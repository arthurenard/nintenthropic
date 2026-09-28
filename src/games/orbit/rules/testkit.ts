/**
 * Shared fixtures for the rules' tests: the cupola as designed, a listener
 * that writes down everything the match says, and simulated players.
 */
import type { Difficulty } from "../../../engine/types";
import { mulberry32 } from "../../../engine/rules/rng";
import { shootable, tankShows, type Fragment } from "./debris";
import type { Breach } from "./felled";
import { designLayout, type Layout } from "./layout";
import { Match, type MatchListener } from "./match";
import type { Mark } from "./panes";
import type { PassSpec } from "./passes";
import type { Award, PassBonuses } from "./scoring";
import type { SecretId } from "./secrets";
import { distance, type V3 } from "./vec";

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
  passStart(pass: number, _spec: PassSpec) { this.note("passStart", pass); }
  passClear(pass: number, bonuses: PassBonuses) { this.note("passClear", pass, bonuses); }
  breather(next: number) { this.note("breather", next); }
  sealed(panes: number[]) { this.note("sealed", panes); }
  spawn(f: Fragment) { this.note("spawn", f.id, f.kind, f.heading); }
  vaporise(f: Fragment, award: Award) { this.note("vaporise", f.id, award); }
  split(parent: Fragment, pieces: Fragment[], award: Award) { this.note("split", parent.id, pieces.map((p) => p.id), award); }
  stripped(f: Fragment, award: Award) { this.note("stripped", f.id, award); }
  tankHit(f: Fragment, hits: number, award: Award) { this.note("tankHit", f.id, hits, award); }
  breakup(f: Fragment, pieces: Fragment[], award: Award) { this.note("breakup", f.id, pieces.map((p) => p.id), award); }
  deflect(f: Fragment) { this.note("deflect", f.id); }
  strike(f: Fragment, mark: Mark, integrity: number) { this.note("strike", f.id, f.kind, mark.pane, mark.cost, integrity); }
  frameStrike(f: Fragment, point: V3) { this.note("frameStrike", f.id, point); }
  passed(f: Fragment) { this.note("passed", f.id); }
  ring(f: Fragment) { this.note("ring", f.id); }
  paneFailed(pane: number, breach: Breach) { this.note("paneFailed", pane, breach); }
  alarm(on: boolean) { this.note("alarm", on); }
  drone(event: string) { this.note("drone", event); }
  droneShot(award: Award) { this.note("droneShot", award); }
  laser(event: string) { this.note("laser", event); }
  streakUp(m: number) { this.note("streakUp", m); }
  score(v: number) { this.note("score", v); }
  secretFound(id: SecretId, name: string, found: number, total: number) { this.note("secretFound", id, name, found, total); }
  flashShot(count: number, aurora: boolean) { this.note("flashShot", count, aurora); }
}

export function testLayout(): Layout {
  return designLayout();
}

export function newMatch(seed: number, difficulty: Difficulty = "standard"): { match: Match; listener: Recorder } {
  const listener = new Recorder();
  const match = new Match({ random: mulberry32(seed), layout: testLayout(), listener, difficulty });
  return { match, listener };
}

/** Step the match `seconds` forward in 1/60 s frames. */
export function run(match: Match, seconds: number, offscreen = false): void {
  const n = Math.round(seconds * 60);
  for (let i = 0; i < n; i++) match.update(1 / 60, offscreen);
}

// --- simulated players ----------------------------------------------------------

export interface Skill {
  /** Seconds to swing onto a new target and fold the thumb. */
  reaction: number;
  /** Chance a shot lands. */
  accuracy: number;
}

/** A fragment far out is a speck until it has flown this long (a flash, a ring gives it away). */
const NOTICE = 0.4;
/** Another shot at the same target, after a miss: the thumb comes up and folds again. */
const REFOLD = 0.35;

/**
 * The simulated player of the balance tests. Each new target takes it
 * `reaction` seconds to swing onto and fire at (a hand is not a mouse: the
 * aim moves, settles, the thumb folds); a miss at the same one another
 * third of a second. It hits `accuracy` of the time, goes for whatever will
 * reach the glass soonest (the Derelict's tank when it shows, a shard only
 * face-on), shoots the misses once nothing threatens, vents when the gauge
 * runs orange or the laser locks, and never shoots the drone. Plays until a
 * pane fails, `maxPass` is passed, or `maxTime` seconds go by.
 */
export function playUntilBreach(
  seed: number,
  skill: Skill,
  options: { difficulty?: Difficulty; maxPass?: number; maxTime?: number } = {},
): { pass: number; time: number; match: Match; listener: Recorder } {
  const maxPass = options.maxPass ?? 25;
  const maxTime = options.maxTime ?? 2400;
  const { match, listener } = newMatch(seed, options.difficulty ?? "standard");
  const hand = mulberry32(seed * 7919 + 1);
  match.start();
  let aim: { id: number; ready: number } | null = null;
  let busy = 0;
  let vent = false;
  const dt = 1 / 30;
  const eye = match.layout.eye;
  const canShoot = (f: Fragment) => (f.kind === "derelict" ? tankShows(f, match.time, eye) : shootable(f, match.time, eye));
  const urgencyOf = (f: Fragment) => {
    const closing = f.closing(match.time);
    // Threats by how soon they arrive; misses too, once nothing threatens.
    // The Derelict's tank, while it shows, comes before all but the closest.
    return f.kind === "derelict" ? Math.min(closing, 2) : closing === Infinity ? 1000 + f.id : closing;
  };
  const byId = (id: number) => match.fragments.find((f) => f.id === id);
  for (let t = 0; t < maxTime; t += dt) {
    match.update(dt, vent);
    vent = false;
    if (match.over || match.pass > maxPass) return { pass: match.pass, time: t, match, listener };
    busy -= dt;
    const laser = match.laser;
    if (busy > 0 || laser.venting) continue;
    // Running hot, or locked: vent (point off the screen), as a player
    // does who sees the gauge turn orange.
    if (laser.locked || laser.heat > 0.85) {
      vent = true;
      busy = 0.45;
      aim = null;
      continue;
    }
    let best: Fragment | null = null;
    let urgency = Infinity;
    for (const f of match.fragments) {
      if (!f.flying || match.time - f.born < NOTICE || !canShoot(f)) continue;
      const u = urgencyOf(f);
      if (u < urgency) {
        urgency = u;
        best = f;
      }
    }
    const current: Fragment | undefined = aim ? byId(aim.id) : undefined;
    // Stay on the current target unless it is gone, cannot be hit now, or
    // something else will arrive a good second sooner.
    if (!current || !current.flying || !canShoot(current) || (best && best !== current && urgencyOf(best) < urgencyOf(current) - 1.2)) {
      aim = best ? { id: best.id, ready: t + skill.reaction * (0.85 + 0.3 * hand()) } : null;
    }
    if (!aim || t < aim.ready) continue;
    const target = byId(aim.id);
    if (!target || !target.flying) {
      aim = null;
      continue;
    }
    const result = match.trigger();
    if (result !== "fired") {
      if (result === "overheated") vent = true;
      continue;
    }
    busy = REFOLD;
    const hit = hand() < skill.accuracy;
    const d = distance(target.position(match.time), eye);
    if (!hit) {
      match.resolveShot({ kind: "none" });
      aim.ready = t + REFOLD;
      continue;
    }
    if (target.kind === "derelict") match.resolveShot({ kind: "tank", id: target.id, distance: d });
    else match.resolveShot({ kind: "debris", id: target.id, distance: d });
    // A hit that leaves it flying (the tank, a foil wrap) is shot again straight away.
    if (target.flying) aim.ready = t + REFOLD;
    else aim = null;
  }
  return { pass: match.pass, time: maxTime, match, listener };
}

/** A player who never fires, left for up to `maxTime` seconds. */
export function standIdle(seed: number, difficulty: Difficulty, maxTime: number): { failed: boolean; pass: number; time: number; match: Match } {
  const { match } = newMatch(seed, difficulty);
  match.start();
  let t = 0;
  const dt = 1 / 30;
  while (!match.over && t < maxTime) {
    match.update(dt, false);
    t += dt;
  }
  return { failed: match.over, pass: match.pass, time: t, match };
}
