/**
 * The trailer's directors, one per clip: each reads the game's own debug view
 * of what can be shot (viewport fractions) and says where the hand should go;
 * its `script` stages moments (a bandit out of a barrel, a bloater among the
 * dead, a slab of debris let through to crack the glass) through the games'
 * own debug switches, in the games' real machinery. Adapted from
 * tools/promo/directors.ts.
 */
import type { Director as PromoDirector, Env, Target } from "../../promo/directors";
import type { ShooterOptions } from "./aim";

export type { Env, Target };

/** The promo's director, with this folder's Shooter options (aim.ts). */
export interface Director extends Omit<PromoDirector, "shooter"> {
  shooter?: ShooterOptions;
}

const onScreen = (x: number, y: number, m = 0.04) => x > m && x < 1 - m && y > m && y < 1 - m;
/** Distance in stage heights. */
const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot((ax - bx) * 16, (ay - by) * 9) / 9;

// --- High Noon ---------------------------------------------------------------------------------

interface WesternShot {
  /** The men sent out, at recorded times (local seconds), one at a cover, in the game's real machinery (debug.stage). */
  stage: { at: number; cover: string; role: "gunman" | "rifleman" | "dynamiter" }[];
  rest?: { x: number; y: number };
  shooter?: Director["shooter"];
  /** A lit stick in the air is shot once it is this near (metres), the nearest to the player first; farther, the hand follows it. */
  stickWithin: number;
  /** Shoot the stick only when it is within this (m) and hold fire otherwise. */
  followWithin?: number;
}

function western(o: WesternShot): Director {
  return {
    rest: o.rest ?? { x: 0.52, y: 0.6 },
    shooter: o.shooter ?? { omega: 17, zeta: 0.75, settle: 0.07, cock: 0.28 },
    script: [
      { at: -4.9, run: (e) => e.game.debug.match().revolver.reset() },
      ...o.stage.map((st) => ({ at: st.at, run: (e: Env) => { e.game.debug.stage(st.cover, st.role, 0.1); } })),
    ],
    frame(env) {
      const m = env.game.debug.match();
      // Nobody comes out but the men staged here: the wave director's own spawns are held off.
      m.spawnTimer = 1e9;
      // Empty: the arcade's reload, a flick of the hand off the screen.
      if (m.revolver.rounds === 0 && !m.revolver.reloading) env.handy.mouse.reloadGesture();
    },
    pick(env) {
      const m = env.game.debug.match();
      if (m.revolver.rounds === 0 || m.revolver.reloading) return null;
      const all = env.targets().filter((k) => onScreen(k.x, k.y));
      // A lit stick in the air first (the nearest), and a fireball when it is near enough.
      const stick = all.filter((k) => k.kind === "dynamite").sort((a, b) => a.distance - b.distance)[0];
      if (stick && stick.distance < (o.followWithin ?? 12)) {
        const [vx, vy] = env.vel(`d${stick.id}`, stick.x, stick.y);
        return { x: stick.x, y: stick.y, r: 0.045, vx, vy, hold: stick.distance > o.stickWithin };
      }
      const bandits = all.filter((k) => k.kind === "bandit" && k.role !== "dynamiter" && k.clear !== false);
      if (!bandits.length) return null;
      bandits.sort((a, b) => dist(a.x, a.y, env.aim.x, env.aim.y) - dist(b.x, b.y, env.aim.x, env.aim.y));
      const b = bandits[0]!;
      const [vx, vy] = env.vel(`b${b.id}`, b.x, b.y);
      return { x: b.x, y: b.y, r: 0.05, vx, vy };
    },
  };
}

/**
 * High Noon, the opening take: a gunman in the street, a dynamite stick shot out of the air, a gunman at the sheriff's,
 * a gunman on the saloon's balcony: four hits in two and a half seconds.
 */
const hnHero = western({
  stage: [
    { at: -1.5, cover: "street.freight", role: "dynamiter" },
    { at: -0.65, cover: "street.duel", role: "gunman" },
    { at: 0.2, cover: "sheriff.door", role: "gunman" },
    { at: 0.9, cover: "saloon.balcony_near", role: "gunman" },
  ],
  stickWithin: 9.5,
});

/** High Noon, the second take: two dynamiters, one each side of the street, and both sticks shot out of the air. */
const hn2 = western({
  stage: [
    { at: -1.8, cover: "street.freight", role: "dynamiter" },
    { at: -1.1, cover: "street.pump", role: "dynamiter" },
  ],
  stickWithin: 9,
});

// --- Dead of Night -----------------------------------------------------------------------------

type Send = [kind: string, lane: string, along: number];

interface NightShot {
  /** The dead sent in at a recorded time (`along`: metres short of the barricade, negative). */
  send: { at: number; dead: Send[] }[];
  /** The beam's sweep before the first shot: from x to x over `dur` seconds (starting at 0), then it rests at `rest`. */
  sweep?: { from: number; to: number; y?: number; dur: number };
  /** No shot before this. */
  firstShot: number;
  rest?: { x: number; y: number };
  shooter?: Director["shooter"];
  /** Prefer these kinds first, a bloater with company before all. */
  order?: (a: Target, b: Target) => number;
  /** Take the bloater first, whoever is near it. */
  bloaterFirst?: boolean;
}

function night(o: NightShot): Director {
  const rest = o.rest ?? { x: 0.5, y: 0.56 };
  return {
    rest,
    restAt(local) {
      const sw = o.sweep;
      if (!sw || local > sw.dur) return rest;
      const k = Math.min(1, Math.max(0, local / sw.dur));
      return { x: sw.from + (sw.to - sw.from) * (0.5 - 0.5 * Math.cos(Math.PI * k)), y: sw.y ?? 0.57 };
    },
    shooter: o.shooter ?? { omega: 12, zeta: 0.8, settle: 0.1, cock: 0.3 },
    script: [
      { at: -4.9, run: (e) => { const r = e.game.debug.match().rifle; r.rounds = 8; r.chambered = true; } },
      ...o.send.map((s) => ({ at: s.at, run: (e: Parameters<NonNullable<Director["frame"]>>[0]) => { for (const [k, l, a] of s.dead) e.game.debug.send(k, l, a); } })),
    ],
    frame(env) {
      const r = env.game.debug.match().rifle;
      if (r.rounds === 0 && !r.reloading) env.handy.mouse.reloadGesture();
      // Only the dead staged here: the wave's own are held off in the queue.
      const m = env.game.debug.match();
      if (typeof m.spawnTimer === "number") m.spawnTimer = 1e9;
    },
    pick(env) {
      if (env.local < o.firstShot) return null;
      const r = env.game.debug.match().rifle;
      if (r.reloading || r.rounds === 0) return null;
      const ready = r.chambered && r.cycling <= 0;
      const all = env.targets().filter((k) => onScreen(k.x, k.y) && k.state !== "dead" && k.distance < 34);
      if (!all.length) return null;
      all.sort((a, b) => (o.order?.(a, b) ?? 0) || Number(a.kind === "mechanic") - Number(b.kind === "mechanic") || a.distance - b.distance);
      // A bloater with company is the shot to take: it bursts and takes them with it.
      const bloater = all.find((k) => k.kind === "bloater" && (o.bloaterFirst || all.filter((x) => x !== k && dist(x.x, x.y, k.x, k.y) < 0.2).length >= 1));
      const t = bloater ?? all[0]!;
      const [vx, vy] = env.vel(`n${t.id}`, t.x, t.y);
      // The head, but a bloater's belly (it bursts) and a crawler's back.
      const head = t.kind !== "bloater" && t.kind !== "crawler" && t.hx !== undefined && t.hy !== undefined;
      return { x: head ? t.hx! : t.x, y: head ? t.hy! : t.y, r: head ? 0.009 : 0.04, vx, vy, hold: !ready };
    },
  };
}

/** Dead of Night, the first take: the beam sweeps across the road and finds the dead coming in. */
const dn1 = night({
  send: [{ at: -0.2, dead: [["walker", "road", -9], ["walker", "road", -7], ["walker", "bus", -8], ["walker", "corn", -7.5], ["walker", "trees", -8], ["walker", "booth", -9], ["walker", "road", -11]] }],
  sweep: { from: 0.63, to: 0.46, dur: 1.0 },
  rest: { x: 0.46, y: 0.55 },
  firstShot: 1.0,
});

/** Dead of Night, the second take: a bloater among the dead. */
const dn2 = night({
  send: [
    {
      at: -0.2,
      dead: [
        ["bloater", "road", -8],
        ["walker", "road", -9.5],
        ["walker", "road", -6],
        ["walker", "bus", -8],
        ["walker", "corn", -8],
        ["walker", "trees", -8],
        ["walker", "fence", -5],
        ["walker", "corn", -11],
        ["walker", "trees", -11],
        ["walker", "road", -12],
      ],
    },
  ],
  sweep: { from: 0.62, to: 0.5, dur: 0.5 },
  rest: { x: 0.5, y: 0.55 },
  firstShot: 0.35,
  bloaterFirst: true,
});

// --- Orbital Decay -----------------------------------------------------------------------------

interface OrbitShot {
  /**
   * What is sent: a fragment of a kind, from one of the layout's 16 lanes (a start point 80-120 m out), to a pane
   * (0 the round window, 3 the right, 6 the left, 1/2 up, 4/5 down), flying at `speed` m/s so as to reach the glass at
   * local time `hit` if nobody shoots it. (Sent as the game itself does, Match.send, with the lane and speed named:
   * the flight is the lane's distance over the speed, so the take lands where it is meant to.) `spare`: let through.
   */
  send: { hit: number; kind: "shrapnel" | "chunk" | "slab" | "shard" | "foil"; to: number; lane: number; speed: number; spare?: boolean }[];
  rest?: { x: number; y: number };
  shooter?: Director["shooter"];
  /** No shot before this (local seconds). */
  firstShot?: number;
  /** Shoot a fragment once it is this many seconds from the glass (the hand follows it from `track` s out). */
  closeBelow?: number;
  track?: number;
}

function orbit(o: OrbitShot): Director {
  return {
    rest: o.rest ?? { x: 0.5, y: 0.45 },
    shooter: o.shooter ?? { omega: 16, zeta: 0.7, settle: 0.06, cock: 0.14, maxSpeed: 2 },
    script: [{ at: -12.9, run: (e) => e.game.debug.hold(true) }],
    frame(env) {
      const m = env.game.debug.match();
      const l = m.laser;
      // A hot laser is vented with the flick off the screen, as a player would.
      if (l && l.heat > 0.86 && !l.venting && !l.locked) env.handy.mouse.reloadGesture();
      // The sends, each on its own clock: the lane's distance over the speed before it should reach the glass.
      const queue: { s: OrbitShot["send"][number]; i: number; done: boolean }[] = (env.memo["queue"] ??= o.send.map((s, i) => ({ s, i, done: false })));
      for (const q of queue) {
        if (q.done) continue;
        const lane = m.layout.lanes[q.s.lane] as { x: number; y: number; z: number };
        const pane = m.layout.panes.find((p: { id: number }) => p.id === q.s.to) as { center: { x: number; y: number; z: number } };
        const flight = Math.hypot(lane.x - pane.center.x, lane.y - pane.center.y, lane.z - pane.center.z) / q.s.speed;
        if (env.local < q.s.hit - flight) continue;
        q.done = true;
        const f = m.send(q.s.kind, "pane", { pane: q.s.to, lane, speed: q.s.speed });
        if (q.s.spare) (env.memo["spare"] ??= new Set<number>()).add(f.id);
        // For tuning: when it was sent and when it will reach the glass (local seconds), as window.promo.memo.log.
        (env.memo["log"] ??= []).push({ i: q.i, kind: q.s.kind, sent: +env.local.toFixed(2), strike: f.strike ? +(env.local + f.strike.time - m.time).toFixed(2) : null, wanted: q.s.hit });
      }
    },
    pick(env) {
      if (env.local < (o.firstShot ?? -99)) return null;
      const l = env.game.debug.match().laser;
      if (l && (l.locked || l.venting)) return null;
      // Not across the capsule's window (bottom left): a shot near it finds a secret, and its toast covers the view.
      const all = env.targets().filter((k) => k.kind !== "drone" && onScreen(k.x, k.y, 0.02) && !(k.x > 0.1 && k.x < 0.5 && k.y > 0.6) && Number.isFinite(k.closing) && (k.closing ?? 99) < (o.track ?? 3) && !(env.memo["spare"] as Set<number> | undefined)?.has(k.id));
      // The soonest to the glass first.
      all.sort((a, b) => (a.closing ?? 0) - (b.closing ?? 0));
      const t = all[0];
      if (!t) return null;
      const [vx, vy] = env.vel(`o${t.id}`, t.x, t.y);
      return { x: t.x, y: t.y, r: 0.05, vx, vy, hold: (t.closing ?? 0) > (o.closeBelow ?? 1.4) };
    },
  };
}

/** Orbital Decay, the first take: a flurry of wreckage across the planet vista, broken up by the laser. */
const od1 = orbit({
  send: [
    { hit: 1.0, kind: "chunk", to: 0, lane: 0, speed: 12 },
    { hit: 1.5, kind: "shrapnel", to: 0, lane: 3, speed: 20 },
    { hit: 2.0, kind: "shrapnel", to: 0, lane: 9, speed: 20 },
    { hit: 2.5, kind: "foil", to: 0, lane: 11, speed: 12 },
    { hit: 3.0, kind: "chunk", to: 0, lane: 5, speed: 12 },
    { hit: 3.5, kind: "shrapnel", to: 0, lane: 14, speed: 20 },
  ],
  closeBelow: 1.0,
  track: 2.2,
});

/** Orbital Decay, the second take: a big break-up close to the glass. */
const od2 = orbit({
  send: [
    { hit: 1.5, kind: "slab", to: 0, lane: 6, speed: 10 },
    { hit: 2.4, kind: "chunk", to: 3, lane: 2, speed: 12, spare: true },
  ],
  closeBelow: 1.0,
});

// --- Overwatch Ridge ---------------------------------------------------------------------------

interface RidgeShot {
  /** Who to shoot, in order of preference: hostiles' ids (stage 1: 26 the tower's lookout, 27 the gunner, 28 the guard). */
  targets: number[];
  /** Where the hand rests before the scope goes up (the wide view's point the scope will open on). */
  start: { x: number; y: number };
  /** The scope goes up at this local time; the hand then pans the view onto the target from `panAt`, taking `panDur`. */
  raiseAt: number;
  panAt: number;
  panDur: number;
  /** No shot before this. */
  fireAt: number;
  shooter?: Director["shooter"];
}

const smooth01 = (x: number) => {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
};

/**
 * One long shot: the hand raises the scope, pans across the valley at the scope's quarter gain onto a man 290 m away
 * and, with the view steady on him, fires. The hand works as a rifleman's does, by eye: it moves by what the view still
 * lacks (four times, for the gain), so the round lands where the game's own ballistics (debug.aimFor) say.
 */
function ridge(o: RidgeShot): Director {
  return {
    rest: o.start,
    shooter: o.shooter ?? { omega: 12, zeta: 0.92, settle: 0.12, cock: 0.2, maxSpeed: 0.25, tremor: 0.00015 },
    script: [{ at: -2.9, run: (e) => e.game.debug.still(true) }],
    frame(env) {
      const g = env.game;
      const mouse = env.handy.mouse;
      // The scope goes up, and stays up.
      mouse.scoping(env.local >= o.raiseAt);
      const m = g.debug.mission();
      if (m.rifle.rounds === 0 && !m.rifle.reloading && !g.debug.scoped()) mouse.reloadGesture();
    },
    pick(env) {
      const g = env.game;
      const sc = g.scope;
      if (env.local < o.raiseAt || !g.debug.scoped()) return null;
      const m = g.debug.mission();
      // A man who will still be standing when the round arrives (half a second at this range): each one's mind changes
      // what he is doing on a timer, and one who ducks is missed. The first in the list who is, and then the same one.
      const standing = (id: number) => {
        const a = m.actors.find((x: { id: number }) => x.id === id);
        return !!a && a.alive && ["binoculars", "smoke", "idle"].includes(a.activity) && a.dur - a.t > 0.7;
      };
      const chosen: number | undefined = (env.memo["who"] as number | undefined) ?? o.targets.find(standing);
      const last = sc.lastHand as { x: number; y: number };
      // Nobody to shoot just now: hold the view where it is.
      if (chosen === undefined) return { x: last.x, y: last.y, r: 1, hold: true };
      const goal = g.debug.aimFor(chosen, "head") as { x: number; y: number } | null;
      if (!goal) return null;
      // Where the view is, where it should be now (a smooth pan from where it opened), and what is still lacking.
      const k = smooth01((env.local - o.panAt) / o.panDur);
      const want = { x: sc.lookAnchor.x + (goal.x - sc.lookAnchor.x) * k, y: sc.lookAnchor.y + (goal.y - sc.lookAnchor.y) * k };
      // The hand that puts the view there: the anchors and the quarter gain say where, and what the view still lacks is made up.
      const hx = sc.handAnchor.x + (want.x - sc.lookAnchor.x) * 4 + (k >= 1 ? (want.x - sc.look.x) * 2 : 0);
      const hy = sc.handAnchor.y + (want.y - sc.lookAnchor.y) * 4 + (k >= 1 ? (want.y - sc.look.y) * 2 : 0);
      // (A head is a hand's breadth across at this range: within a third of a milliradian, or it misses.)
      const onIt = Math.hypot(goal.x - sc.look.x, goal.y - sc.look.y) < 0.0003;
      const locked = env.memo["committed"] !== undefined && env.fired <= (env.memo["committed"] as number);
      const ready = m.rifle.state === "ready" && sc.zoom > 0.98 && env.local >= o.fireAt && k >= 1 && onIt;
      const done = env.memo["shot"] === true;
      return {
        x: Math.min(0.98, Math.max(0.02, hx)),
        y: Math.min(0.98, Math.max(0.02, hy)),
        r: 0.03,
        // After the shot the hand holds still (the view stays on the glass for the round's flight).
        hold: !ready || locked || done,
        onFire: () => {
          // The thumb is folding: keep the view where it is until the shot registers.
          env.memo["committed"] = env.fired;
          env.memo["shot"] = true;
          env.memo["who"] = chosen;
        },
      };
    },
  };
}

/** Overwatch Ridge, the first take: the scope rises, a pan across the valley onto the tower's lookout, the shot. */
const or1 = ridge({ targets: [26], start: { x: 0.55, y: 0.58 }, raiseAt: 0.15, panAt: 0.6, panDur: 0.8, fireAt: 1.2 });

/** Overwatch Ridge, the slow-motion take: already on him; the long shot and its hit. */
const orSlow = ridge({ targets: [26], start: { x: 0.45, y: 0.6 }, raiseAt: -1.5, panAt: -1.0, panDur: 0.3, fireAt: 0.65 });

export const DIRECTORS: Record<string, Director> = {
  "hn-hero": hnHero,
  "hn-2": hn2,
  "dn-1": dn1,
  "dn-2": dn2,
  "od-1": od1,
  "od-2": od2,
  "or-1": or1,
  "or-slow": orSlow,
};
