/**
 * Shared fixtures for the rules' tests: a small synthetic Dust Creek (the
 * same kinds of covers as the real town, at plausible distances), a
 * listener that records everything the match says, and simulated players.
 */
import type { Difficulty } from "../../../engine/types";
import type { Bandit } from "./bandit";
import type { Dynamite } from "./dynamite";
import { Match, type MatchListener } from "./match";
import { mulberry32 } from "../../../engine/rules/rng";
import type { Award, WaveBonuses } from "./scoring";
import type { SecretId } from "./secrets";
import type { Townsperson } from "./townsfolk";
import type { Cover, CoverKind, Emerge, HitPart } from "./types";
import type { WaveSpec } from "./waves";

function cover(
  id: string,
  kind: CoverKind,
  emerge: Emerge,
  level: 0 | 1 | 2,
  x: number,
  z: number,
  tags: string[] = [],
): Cover {
  const y = level === 0 ? 0 : level === 1 ? 3.6 : 7;
  const side = x < -1 ? -1 : x > 1 ? 1 : 0;
  const back = kind === "door" || kind === "window" ? 1.2 : 0.4;
  return {
    id,
    kind,
    emerge,
    level,
    exposed: { x, y, z },
    hidden: { x: x - side * back, y, z: z - (side === 0 ? back : 0) },
    distance: Math.hypot(x, z),
    side,
    tags,
  };
}

export function testCovers(): Cover[] {
  return [
    cover("store_barrels", "barrel", "rise", 0, -6.2, -9),
    cover("store_door", "door", "step_out", 0, -8.6, -11),
    cover("store_corner", "corner", "lean_left", 0, -8.4, -17),
    cover("saloon_door", "door", "step_out", 0, -8.6, -24),
    cover("saloon_window_1", "window", "rise", 1, -8.4, -20),
    cover("saloon_window_2", "window", "rise", 1, -8.4, -28),
    cover("wagon", "wagon", "rise", 0, -3.8, -27),
    cover("barber_door", "door", "step_out", 0, -8.6, -35.5),
    cover("livery_door", "door", "step_out", 0, -8.6, -46.5),
    cover("store_roof", "roof", "rise", 2, -8.8, -12),
    cover("bank_door", "door", "step_out", 0, 8.6, -10.5),
    cover("trough", "barrel", "rise", 0, 5.2, -13),
    cover("bank_corner", "corner", "lean_right", 0, 8.4, -16),
    cover("sheriff_door", "door", "step_out", 0, 8.6, -22),
    cover("sheriff_crates", "crate", "rise", 0, 6.3, -24),
    cover("hotel_window_1", "window", "rise", 1, 8.4, -29),
    cover("hotel_window_2", "window", "rise", 1, 8.4, -32.5),
    cover("hotel_window_3", "window", "rise", 1, 8.4, -36),
    cover("undertaker_coffins", "crate", "lean_right", 0, 7, -42),
    cover("hotel_roof", "roof", "rise", 2, 9, -31),
    cover("church_tower", "tower", "rise", 2, 0, -61),
    cover("far_barrels", "barrel", "rise", 0, 3, -52),
  ];
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
  names(): string[] {
    return this.log.map((e) => e.name);
  }

  banner(title: string, subtitle?: string) { this.note("banner", title, subtitle); }
  waveStart(wave: number, _spec: WaveSpec) { this.note("waveStart", wave); }
  waveClear(wave: number, bonuses: WaveBonuses) { this.note("waveClear", wave, bonuses); }
  intermission(next: number, giant: boolean) { this.note("intermission", next, giant); }
  banditSpawn(b: Bandit) { this.note("banditSpawn", b.id, b.role, b.cover.id); }
  banditTell(b: Bandit) { this.note("banditTell", b.id); }
  banditEmerge(b: Bandit) { this.note("banditEmerge", b.id); }
  banditAim(b: Bandit) { this.note("banditAim", b.id); }
  banditGlint(b: Bandit) { this.note("banditGlint", b.id); }
  banditFire(b: Bandit, hit: boolean, damage: number) { this.note("banditFire", b.id, hit, damage); }
  banditHide(b: Bandit) { this.note("banditHide", b.id); }
  banditRelocate(b: Bandit, from: Cover) { this.note("banditRelocate", b.id, from.id, b.cover.id); }
  banditRun(b: Bandit) { this.note("banditRun", b.id); }
  banditLight(b: Bandit) { this.note("banditLight", b.id); }
  banditPace(b: Bandit, pace: number) { this.note("banditPace", b.id, pace); }
  banditStandoff(b: Bandit) { this.note("banditStandoff", b.id); }
  duelBell(b: Bandit) { this.note("duelBell", b.id); }
  banditDead(b: Bandit) { this.note("banditDead", b.id); }
  banditThrow(b: Bandit, stick: Dynamite) { this.note("banditThrow", b.id, stick.id); }
  banditWound(b: Bandit, part: HitPart) { this.note("banditWound", b.id, part); }
  banditDeath(b: Bandit, part: HitPart | "blast", award: Award) { this.note("banditDeath", b.id, part, award); }
  bodyCleared(b: Bandit) { this.note("bodyCleared", b.id); }
  dynamiteDropped(stick: Dynamite, b: Bandit) { this.note("dynamiteDropped", stick.id, b.id); }
  dynamiteShot(stick: Dynamite, award: Award) { this.note("dynamiteShot", stick.id, award); }
  dynamiteExplode(stick: Dynamite, inAir: boolean) { this.note("dynamiteExplode", stick.id, inAir); }
  playerHit(damage: number, direction: number, hurt: number, source: string) { this.note("playerHit", damage, direction, hurt, source); }
  playerDeath() { this.note("playerDeath"); }
  townsfolkAppear(p: Townsperson) { this.note("townsfolkAppear", p.id, p.role); }
  townsfolkHide(p: Townsperson) { this.note("townsfolkHide", p.id); }
  townsfolkGone(p: Townsperson) { this.note("townsfolkGone", p.id); }
  townsfolkShot(p: Townsperson, award: Award) { this.note("townsfolkShot", p.id, award); }
  streakUp(m: number) { this.note("streakUp", m); }
  score(v: number) { this.note("score", v); }
  reload(started: boolean) { this.note("reload", started); }
  bellToll(toll: number, open: boolean) { this.note("bellToll", toll, open); }
  pianoNote(count: number, tune: boolean) { this.note("pianoNote", count, tune); }
  chickenStartled(hits: number) { this.note("chickenStartled", hits); }
  tumbleweedShot(count: number, giant: boolean) { this.note("tumbleweedShot", count, giant); }
  secretFound(id: SecretId, name: string, found: number, total: number) { this.note("secretFound", id, name, found, total); }
}

// --- simulated players ----------------------------------------------------------

export interface Skill {
  /** Seconds from seeing a target to the shot. */
  reaction: number;
  /** Chance a shot lands. */
  accuracy: number;
}

/**
 * The simulated player of balance.test.ts, on either difficulty: sees a
 * bandit, takes `reaction` seconds to get the shot off, hits `accuracy` of
 * the time, folds the thumb at most three times a second, shoots dynamite
 * in the air first, and reloads when empty. Plays until he falls, passes
 * `maxWave`, or `maxTime` seconds go by.
 */
export function playUntilDeath(
  seed: number,
  skill: Skill,
  options: { difficulty?: Difficulty; maxWave?: number; maxTime?: number } = {},
): { wave: number; time: number; match: Match; listener: Recorder } {
  const maxWave = options.maxWave ?? 25;
  const maxTime = options.maxTime ?? 1200;
  const listener = new Recorder();
  const match = new Match({ random: mulberry32(seed), covers: testCovers(), listener, difficulty: options.difficulty ?? "standard" });
  const player = mulberry32(seed * 7919 + 1);
  match.start();
  const seen = new Map<number, number>();
  const stickSeen = new Map<number, number>();
  let cooldown = 0;
  let reloadGesture = false;
  const dt = 1 / 30;
  for (let t = 0; t < maxTime; t += dt) {
    match.update(dt, reloadGesture);
    reloadGesture = false;
    if (match.phase === "dead" || match.wave > maxWave) return { wave: match.wave, time: t, match, listener };
    cooldown -= dt;
    if (match.revolver.rounds === 0 && !match.revolver.reloading) {
      reloadGesture = true;
      cooldown = Math.max(cooldown, 0.35);
      continue;
    }
    if (cooldown > 0 || match.revolver.reloading) continue;
    // Dynamite in the air first, once it has been seen long enough to react.
    let target: { kind: "dynamite"; id: number } | { kind: "bandit"; b: Bandit } | null = null;
    for (const s of match.sticks) {
      if (!s.airborne) {
        stickSeen.delete(s.id);
        continue;
      }
      const first = stickSeen.get(s.id) ?? t;
      stickSeen.set(s.id, first);
      if (t - first >= skill.reaction) target = { kind: "dynamite", id: s.id };
    }
    if (!target) {
      let best: Bandit | null = null;
      for (const b of match.bandits) {
        if (!b.shootable) {
          seen.delete(b.id);
          continue;
        }
        const first = seen.get(b.id) ?? t + player() * 0.25;
        seen.set(b.id, first);
        if (t - first < skill.reaction) continue;
        // The one about to fire first.
        if (!best || (b.state === "aiming" && best.state !== "aiming") || (b.state === best.state && b.t > best.t)) best = b;
      }
      if (best) target = { kind: "bandit", b: best };
    }
    if (!target) continue;
    if (match.trigger() !== "fired") continue;
    cooldown = 0.33;
    const hit = player() < skill.accuracy;
    if (target.kind === "dynamite") {
      const stick = match.sticks[target.id];
      match.resolveShot(hit && stick ? { kind: "dynamite", stick } : { kind: "scenery" });
    } else {
      match.resolveShot(hit ? { kind: "bandit", bandit: target.b, part: player() < 0.25 ? "head" : "body" } : { kind: "scenery" });
    }
  }
  return { wave: match.wave, time: maxTime, match, listener };
}

/** A player who never fires, left standing for up to `maxTime` seconds. */
export function standIdle(seed: number, difficulty: Difficulty, maxTime: number): { dead: boolean; wave: number; time: number; match: Match } {
  const match = new Match({ random: mulberry32(seed), covers: testCovers(), listener: new Recorder(), difficulty });
  match.start();
  let t = 0;
  const dt = 1 / 30;
  while (match.phase !== "dead" && t < maxTime) {
    match.update(dt, false);
    t += dt;
  }
  return { dead: match.phase === "dead", wave: match.wave, time: t, match };
}
