/**
 * The placeholder valley's plan: where its people stand and go, worked out
 * from the layout's numbers. The placeholder builds its named nodes from
 * this (so the world reads it back from the scene as it would from the
 * real valley.glb), and the rules' tests play on it directly.
 */
import type { Nest, Plan, Post, V3 } from "../rules/types";
import {
  BRIDGE_CROSS,
  CHAPEL,
  COWS,
  DAM,
  EAGLE_CENTRE,
  EAGLE_RADIUS,
  EAGLE_ROCK,
  FARM,
  FARM_LANE,
  FARMER,
  GOAT_LEDGES,
  GOAT_LIFT,
  NESTS,
  POSTS,
  RIVER,
  RIVER_LEVEL,
  ROAD,
  SHEEP_AT,
  SHEPHERD,
  standHeight,
  terrainHeight,
  TUNNEL,
  VILLAGE_ROAD,
  CART,
  type XZ,
} from "./layout";

const on = ([x, z]: XZ, lift = 0): V3 => ({ x, y: standHeight(x, z) + lift, z });

/** The heading from a point toward the ridge (the eye). */
const toRidge = (p: V3) => Math.atan2(-p.x, -p.z);

/** The way each post looks: the tower and the gunner at the ridge, the rest along the road or into the valley. */
function postHeading(kind: Post["kind"], at: V3): number {
  if (kind === "tower" || kind === "gunner") return toRidge(at);
  // Half turned from the ridge: a sentry watching the road, not staring at you.
  return toRidge(at) + (at.x > 0 ? 0.9 : -0.9);
}

export function layoutPlan(): Plan {
  const posts: Post[] = POSTS.map(([id, kind, x, z, lift, place]) => {
    const at = on([x, z], lift);
    return { id, kind, at, heading: postHeading(kind, at), place };
  });
  const nests: Nest[] = NESTS.map(([id, x, z, lift, place]) => {
    const exposed = on([x, z], lift);
    const heading = toRidge(exposed);
    // Hidden: a metre back from the opening and down out of sight.
    const hidden = { x: exposed.x - Math.sin(heading) * 1.2, y: exposed.y - 0.8, z: exposed.z - Math.cos(heading) * 1.2 };
    return { id, exposed, hidden, heading, place };
  });
  const patrolLine: XZ[] = [ROAD[4]!, ROAD[5]!, ROAD[6]!, ROAD[7]!, ROAD[8]!, VILLAGE_ROAD[1]!, VILLAGE_ROAD[2]!];
  const dam: V3[] = [
    { x: DAM.x0 + 6, y: DAM.crest, z: DAM.z },
    { x: DAM.x1 - 4, y: DAM.crest, z: DAM.z },
    { x: TUNNEL[0], y: TUNNEL[1], z: TUNNEL[2] },
  ];
  const eagle: V3[] = [];
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    eagle.push({ x: EAGLE_CENTRE[0] + Math.cos(a) * EAGLE_RADIUS, y: EAGLE_CENTRE[1] + Math.sin(a * 2) * 8, z: EAGLE_CENTRE[2] + Math.sin(a) * EAGLE_RADIUS * 0.7 });
  }
  // The duck floats down from the river's bend to the far left of the view.
  const duck: V3[] = RIVER.slice(4, 12).map(([x, z]) => ({ x, y: RIVER_LEVEL + 0.05, z }));
  const sheep: V3[] = [];
  for (let i = 0; i < 8; i++) {
    const a = i * 2.39996;
    const r = 3 + Math.sqrt(i) * 3.2;
    sheep.push(on([SHEEP_AT[0] + Math.cos(a) * r, SHEEP_AT[1] + Math.sin(a) * r]));
  }
  return {
    eye: { x: 0, y: 0, z: 0 },
    posts,
    road: ROAD.map((p) => on(p)),
    bridge: on(BRIDGE_CROSS),
    patrol: patrolLine.map((p) => on(p)),
    dam,
    farmer: FARMER.map((p) => on(p)),
    cyclist: ROAD.slice(0, 5).map((p) => on(p)),
    shepherd: SHEPHERD.map((p) => on(p)),
    cheese: [CART, ...FARM_LANE, [-112, -300] as XZ, [-100, -318] as XZ].map((p) => on(p)),
    nests,
    cows: COWS.map((p) => on(p)),
    sheep,
    goatLedges: GOAT_LEDGES.map(([x, , z], i) => ({ x, y: terrainHeight(x, z) + (GOAT_LIFT[i] ?? 0), z })),
    eagle,
    // The eagle perches on the rock's top: its height above the ground there.
    eagleRock: { x: EAGLE_ROCK[0], y: terrainHeight(EAGLE_ROCK[0], EAGLE_ROCK[2]) + EAGLE_ROCK[1], z: EAGLE_ROCK[2] },
    duck,
    chapel: on(CHAPEL),
    farm: on(FARM),
  };
}
