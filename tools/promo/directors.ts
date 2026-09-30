/**
 * Who to shoot, per game: each director reads the game's own debug view of
 * what can be shot (viewport fractions) and says where the hand should go.
 * The Shooter (aim.ts) turns that into smooth, human-looking motion. A
 * director's `script` stages moments (a bandit out of a barrel) through the
 * game's own debug switches, in the game's real machinery.
 */
import type { ShooterOptions, Want } from "./aim";

export interface Target {
  kind: string;
  id: number;
  x: number;
  y: number;
  hx?: number;
  hy?: number;
  state?: string;
  role?: string;
  distance: number;
  clear?: boolean;
  closing?: number;
  side?: string;
  activity?: string;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface Env {
  handy: any;
  game: any;
  /** Seconds since the game began (all frames, pre-roll included). */
  t: number;
  /** Seconds since the first recorded frame (negative during the pre-roll). */
  local: number;
  dt: number;
  aim: { x: number; y: number };
  /** A smoothed velocity for a thing on screen, by key. */
  vel(key: string, x: number, y: number): [number, number];
  /** What the game says can be shot now. */
  targets(): Target[];
  /** Shots the hand has fired so far. */
  fired: number;
  /** A place for a director to keep its notes. */
  memo: Record<string, any>;
}

export interface Director {
  rest: { x: number; y: number };
  /** Where the hand idles at a recorded time, when it should not just stay put (a sweep of the beam). */
  restAt?(local: number): { x: number; y: number };
  /** Things that happen at a recorded time (local seconds): staging a bandit, raising the scope. */
  script?: { at: number; run(env: Env): void }[];
  shooter?: ShooterOptions;
  pick(env: Env): Want | null;
  /** Anything else once a frame (a scope, a reload). */
  frame?(env: Env): void;
}

const onScreen = (x: number, y: number, m = 0.04) => x > m && x < 1 - m && y > m && y < 1 - m;
/** Distance in stage heights. */
const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot((ax - bx) * 16, (ay - by) * 9) / 9;

// --- High Noon ---------------------------------------------------------------------------------

export const western: Director = {
  rest: { x: 0.5, y: 0.62 },
  shooter: { omega: 14, zeta: 0.74, settle: 0.1, cock: 0.34 },
  script: [
    { at: -0.2, run: (e) => e.game.debug.match().revolver.reset() },
    { at: 0.5, run: (e) => e.game.debug.stage("street.barrels_right", "gunman", 0.1) },
    { at: 2.4, run: (e) => e.game.debug.stage("saloon.balcony_near", "rifleman", 0.1) },
    { at: 4.0, run: (e) => e.game.debug.stage("street.cart", "gunman", 0.1) },
    { at: 5.4, run: (e) => e.game.debug.stage("saloon.door", "dynamiter", 0.1) },
  ],
  frame(env) {
    const m = env.game.debug.match();
    // Empty: the arcade's reload, a flick of the hand off the screen.
    if (m.revolver.rounds === 0 && !m.revolver.reloading) env.handy.mouse.reloadGesture();
  },
  pick(env) {
    const m = env.game.debug.match();
    if (m.revolver.rounds === 0 || m.revolver.reloading) return null;
    const all = env.targets().filter((k) => onScreen(k.x, k.y));
    const dyn = all.find((k) => k.kind === "dynamite");
    if (dyn) {
      const [vx, vy] = env.vel(`d${dyn.id}`, dyn.x, dyn.y);
      return { x: dyn.x, y: dyn.y, r: 0.045, vx, vy };
    }
    const bandits = all.filter((k) => k.kind === "bandit" && k.clear !== false);
    if (!bandits.length) return null;
    bandits.sort((a, b) => dist(a.x, a.y, env.aim.x, env.aim.y) - dist(b.x, b.y, env.aim.x, env.aim.y));
    const b = bandits[0]!;
    const [vx, vy] = env.vel(`b${b.id}`, b.x, b.y);
    return { x: b.x, y: b.y, r: 0.05, vx, vy };
  },
};

// --- Dead of Night -----------------------------------------------------------------------------

export const night: Director = {
  rest: { x: 0.5, y: 0.56 },
  // The beam goes where the hand goes: a slow sweep across the road before the first shot.
  restAt(local) {
    if (local > 1.9) return { x: 0.5, y: 0.56 };
    const k = Math.min(1, Math.max(0, local / 1.9));
    return { x: 0.5 + 0.24 * (0.5 - 0.5 * Math.cos(Math.PI * k)), y: 0.57 };
  },
  shooter: { omega: 11, zeta: 0.8, settle: 0.12, cock: 0.3 },
  script: [
    { at: -2.6, run: (e) => { const r = e.game.debug.match().rifle; r.rounds = 8; r.chambered = true; } },
    { at: -2.5, run: (e) => e.game.debug.send("walker", "fence", 4) },
    { at: -2.5, run: (e) => e.game.debug.send("walker", "booth", 8) },
    { at: 0.2, run: (e) => e.game.debug.send("runner", "bus", 36) },
    { at: 1.8, run: (e) => e.game.debug.send("bloater", "road", 47) },
    { at: 1.8, run: (e) => e.game.debug.send("walker", "fence", 6) },
    { at: 1.8, run: (e) => e.game.debug.send("walker", "booth", 10) },
    { at: 3.6, run: (e) => e.game.debug.send("walker", "road", 48) },
  ],
  frame(env) {
    const r = env.game.debug.match().rifle;
    if (r.rounds === 0 && !r.reloading) env.handy.mouse.reloadGesture();
  },
  pick(env) {
    if (env.local < 1.9) return null;
    const r = env.game.debug.match().rifle;
    if (r.reloading || r.rounds === 0) return null;
    const ready = r.chambered && r.cycling <= 0;
    const all = env.targets().filter((k) => onScreen(k.x, k.y) && k.state !== "dead" && k.distance < 34);
    if (!all.length) return null;
    // The armoured mechanic (a mask that takes several hits) is left for last: the clip wants clean kills.
    all.sort((a, b) => Number(a.kind === "mechanic") - Number(b.kind === "mechanic") || a.distance - b.distance);
    // A bloater with company is the shot to take: it bursts and takes them with it.
    const bloater = all.find((k) => k.kind === "bloater" && all.filter((o) => o !== k && dist(o.x, o.y, k.x, k.y) < 0.2).length >= 1);
    const t = bloater ?? all[0]!;
    const [vx, vy] = env.vel(`n${t.id}`, t.x, t.y);
    // The head, but a bloater's belly (it bursts) and a crawler's back.
    // (A head is a few pixels across at range: the hand has to settle exactly on it, and the game's lever gives it time.)
    const head = t.kind !== "bloater" && t.kind !== "crawler" && t.hx !== undefined && t.hy !== undefined;
    return { x: head ? t.hx! : t.x, y: head ? t.hy! : t.y, r: head ? 0.009 : 0.04, vx, vy, hold: !ready };
  },
};

// --- Orbital Decay -----------------------------------------------------------------------------

export const orbit: Director = {
  rest: { x: 0.5, y: 0.45 },
  shooter: { omega: 16, zeta: 0.7, settle: 0.06, cock: 0.14 },
  script: [
    { at: -1.2, run: (e) => e.game.debug.send("chunk", 0) },
    { at: 0.3, run: (e) => e.game.debug.send("shrapnel", 1) },
    // This one is let through: the glass takes it, and cracks.
    { at: 0.9, run: (e) => (e.memo["spare"] = e.game.debug.send("slab", 4, 42)) },
    { at: 3.4, run: (e) => e.game.debug.send("chunk", 2) },
    { at: 4.3, run: (e) => e.game.debug.send("foil", 0) },
    { at: 4.9, run: (e) => e.game.debug.send("shard", 3) },
  ],
  frame(env) {
    const l = env.game.debug.match().laser;
    // A hot laser is vented with the flick off the screen, as a player would.
    if (l && l.heat > 0.86 && !l.venting && !l.locked) env.handy.mouse.reloadGesture();
  },
  pick(env) {
    const m = env.game.debug.match();
    const l = m.laser;
    if (l && (l.locked || l.venting)) return null;
    // Not across the capsule's window (bottom left): a shot near it finds a secret, and its toast covers the view.
    const all = env.targets().filter((k) => k.kind !== "drone" && onScreen(k.x, k.y, 0.02) && !(k.x > 0.1 && k.x < 0.5 && k.y > 0.6));
    // Whatever would hit the glass, the soonest first, once it is close enough to matter.
    const spare = env.memo["spare"] as number | undefined;
    const threats = all.filter((k) => Number.isFinite(k.closing) && k.id !== spare && k.distance < 52).sort((a, b) => (a.closing ?? 0) - (b.closing ?? 0));
    const t = threats[0];
    if (!t) return null;
    const [vx, vy] = env.vel(`o${t.id}`, t.x, t.y);
    return { x: t.x, y: t.y, r: 0.05, vx, vy };
  },
};

// --- Overwatch Ridge ---------------------------------------------------------------------------

export const ridge: Director = {
  rest: { x: 0.45, y: 0.6 },
  shooter: { omega: 13, zeta: 0.85, settle: 0.2, cock: 0.2 },
  script: [{ at: -0.3, run: (e) => e.game.debug.still(true) }],
  frame(env) {
    const g = env.game;
    const mouse = env.handy.mouse;
    const memo = env.memo;
    const m = g.debug.mission();
    const scoped: boolean = g.debug.scoped();
    // Reload with the arcade's gesture when the magazine is empty (wide view only).
    if (m.rifle.rounds === 0 && !m.rifle.reloading && !scoped) mouse.reloadGesture();
    const want = memo["scope"] as boolean | undefined;
    if (want !== undefined) mouse.scoping(want);
    // After a shot the scope stays up while the round flies, then lowers.
    if (memo["scope"] && memo["lowerAt"] !== undefined && env.t >= memo["lowerAt"]) {
      memo["scope"] = false;
      memo["lowerAt"] = undefined;
      memo["lastTarget"] = memo["target"];
      memo["target"] = undefined;
    }
  },
  pick(env) {
    const g = env.game;
    const memo = env.memo;
    const m = g.debug.mission();
    if (m.rifle.reloading || m.rifle.rounds === 0) return null;
    const scoped: boolean = g.debug.scoped();
    // A target: hostiles only, the nearest to where the hand is.
    const hostile = env.targets().filter((k: Target) => k.side === "hostile" && onScreen(k.x, k.y, 0.03));
    let t = hostile.find((k: Target) => k.id === memo["target"]);
    if (!t) {
      const ordered = hostile.filter((k: Target) => k.id !== memo["lastTarget"]).sort((a: Target, b: Target) => dist(a.x, a.y, env.aim.x, env.aim.y) - dist(b.x, b.y, env.aim.x, env.aim.y));
      t = ordered[0] ?? hostile[0];
      memo["target"] = t?.id;
    }
    if (!t) return null;
    const goal = g.debug.aimFor(t.id, "head") as { x: number; y: number } | null;
    if (!goal) return null;
    const sc = g.scope;
    const ready = m.rifle.state === "ready";
    if (!scoped) {
      // Bring the hand to the man; once steady on him, raise the scope.
      memo["inFor"] = 0;
      const d = dist(env.aim.x, env.aim.y, goal.x, goal.y);
      if (d < 0.05) memo["steady"] = (memo["steady"] ?? 0) + env.dt;
      else memo["steady"] = 0;
      if (memo["steady"] > 0.3 && !memo["scope"] && env.local > 0.8) memo["scope"] = true;
      return { x: goal.x, y: goal.y, r: 0.02, hold: true };
    }
    // Through the scope the hand pans at a quarter gain: move the hand by four times what the view needs.
    const gain = 4;
    const hx = sc.handAnchor.x + (goal.x - sc.lookAnchor.x) * gain;
    const hy = sc.handAnchor.y + (goal.y - sc.lookAnchor.y) * gain;
    // Let the view arrive and settle (the scope takes a moment to come up) before the shot.
    memo["inFor"] = (memo["inFor"] ?? 0) + env.dt;
    return {
      x: Math.min(0.98, Math.max(0.02, hx)),
      y: Math.min(0.98, Math.max(0.02, hy)),
      r: 0.05,
      hold: !ready || sc.zoom < 0.98 || memo["inFor"] < 0.45,
      onFire: () => {
        // Stay on the glass: the next man is found from here, and the round's trail is seen to the end.
        memo["target"] = undefined;
        memo["lastTarget"] = t!.id;
        memo["inFor"] = 0;
      },
    };
  },
};

export const DIRECTORS: Record<string, Director> = { western, night, orbit, ridge };
