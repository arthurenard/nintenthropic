/**
 * Alternate routes in the sim. A branch road (track/geometry.ts `RouteRoad`) is a road of its own with its own plan
 * (terrain, racing line, speeds), in the lap's metres. A kart on one is simply a kart whose `route` is that road's, and
 * every part of the sim that reads "the track" reads it through `onRoute`: a view of the race whose `geo` and `plan`
 * are the road the kart is on. So a kart drives, falls, jumps and feels the hills on a branch exactly as on the main road,
 * and the bots follow the branch's own line.
 *
 * Which road a kart is on follows from where it is (the nearest centre line, a kart keeping its road unless the other is
 * clearly nearer), so it is never kept in a snapshot. Progress is the lap's metres on every road, so places stay right.
 */
import type { RouteRoad } from "../track/geometry";
import { noise, styleOf, type Temperament } from "./temperament";
import type { KartState, World } from "./state";

const views = new WeakMap<World, World[]>();

/** The race as seen from the road `route` (0: the main road, which is the race itself). */
export function onRoute(w: World, route: number): World {
  const race = w.main ?? w;
  if (route === 0) return race;
  let list = views.get(race);
  if (!list) {
    list = [];
    views.set(race, list);
  }
  let view = list[route];
  if (!view) {
    const plan = race.plan.routes[route - 1];
    if (!plan) return race;
    view = Object.create(race) as World;
    Object.defineProperties(view, { geo: { value: plan.geo }, plan: { value: plan }, main: { value: race } });
    list[route] = view;
  }
  return view;
}

/** The branch roads of the race's track. */
export function routesOf(w: World): readonly RouteRoad[] {
  return (w.main ?? w).geo.routes;
}

/** How often each temperament takes a shortcut and a split, by default (a route's `appeal` scales it). */
const TAKES: Record<Temperament, { shortcut: number; split: number }> = {
  aggressive: { shortcut: 0.95, split: 0.55 },
  erratic: { shortcut: 0.6, split: 0.5 },
  steady: { shortcut: 0.35, split: 0.5 },
  careful: { shortcut: 0.12, split: 0.5 },
};

/** Metres before a junction a bot makes up its mind; it holds the choice until the branch has taken it. */
export const ROUTE_LOOKAHEAD = 70;

/**
 * Whether this bot takes the branch `road` this lap: a die rolled by the seed, the kart, the lap and the route (the same
 * every time it is asked, and nothing new in a snapshot), weighed by its temperament and, for a shortcut, its skill (a
 * poor driver does not trust itself to the narrow way).
 */
export function takesRoute(w: World, k: KartState, road: RouteRoad): boolean {
  const race = w.main ?? w;
  const style = styleOf(race, k);
  const base = TAKES[style.temperament];
  const kind = road.routeDef.kind;
  const appeal = road.routeDef.appeal ?? (kind === "shortcut" ? 0.8 : 0.5);
  let chance = kind === "shortcut" ? base.shortcut : base.split;
  // A route's own appeal tips it: a tempting one (1) tempts everybody a little more, a poor one (0) a little less.
  chance = Math.max(0, Math.min(1, chance + (appeal - (kind === "shortcut" ? 0.8 : 0.5)) * 0.6));
  if (kind === "shortcut") chance *= 0.55 + 0.45 * k.skill;
  const lap = Math.max(1, Math.floor(Math.max(0, k.progress) / race.geo.length) + 1);
  return noise(race.setup.seed, k.id, road.route, lap, 77) < chance;
}

/**
 * The road a bot steers by now: the one it is on, or (on the main road, a little before a junction and until the branch
 * has taken it) the branch it has chosen.
 */
export function steeringRoute(w: World, k: KartState): number {
  const race = w.main ?? w;
  if (k.route !== 0) return k.route;
  for (const road of race.geo.routes) {
    const ahead = race.geo.delta(k.s, road.from);
    if (ahead < -road.span || ahead > ROUTE_LOOKAHEAD) continue;
    // Past the junction while still on the main road: only for the first stretch of the flare.
    if (ahead < -2 && race.geo.delta(road.from, k.s) > 30) continue;
    if (takesRoute(race, k, road)) return road.route;
  }
  return 0;
}
