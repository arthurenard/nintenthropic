/**
 * What stands about in the kitchen, snow, volcano, funfair, space and palm
 * worlds, scattered as instances with the same machinery that dresses the
 * meadow, the canyon and the harbour (scenery.ts): crumbs, fruit and grains on
 * the counter; snowy pines, drifts and far lit cabins; basalt, charred trees
 * and embers beside the lava; fairground trees, stalls and lamps; floating
 * rocks in space; palms, bushes and boats on the island's sea.
 */
import type { Material } from "three";
import { fbm2, smoothstep } from "../math";
import { makePoints } from "../points";
import { hasSceneryArt } from "./sceneryArt";
import * as p from "./worldProps";
import type { Item, SceneryTools } from "./scenery";
import { SEA_LEVEL } from "./terrain";

export function addWorldScenery(t: SceneryTools): void {
  switch (t.style.id) {
    case "kitchen":
      kitchen(t);
      break;
    case "snow":
      snow(t);
      break;
    case "volcano":
      volcano(t);
      break;
    case "funfair":
      funfair(t);
      break;
    case "space":
      space(t);
      break;
    case "palm":
      palm(t);
      break;
    default:
      break;
  }
}

const above = (min: number) => (_x: number, _z: number, h: number) => (h > min ? 1 : 0);

function kitchen(t: SceneryTools): void {
  const on = above(-3);
  t.instanced(t.geo(p.crumb()), t.scatter({ count: 320, minEdge: 12, maxEdge: 300, cell: 4, scale: [0.8, 1.8], keep: on }));
  t.instanced(t.geo(p.pea()), t.scatter({ count: 80, minEdge: 13, maxEdge: 300, cell: 4, scale: [0.9, 1.7], keep: on }));
  t.instanced(t.geo(p.rice()), t.scatter({ count: 220, minEdge: 11, maxEdge: 260, cell: 2.5, scale: [0.9, 1.6], keep: on }));
  t.instanced(t.geo(p.bean()), t.scatter({ count: 90, minEdge: 12, maxEdge: 300, cell: 3, scale: [0.9, 1.7], keep: on }));
  t.instanced(t.geo(p.sugarGrain()), t.scatter({ count: 150, minEdge: 11, maxEdge: 200, cell: 2, scale: [0.8, 1.5], keep: on }));
  t.instanced(t.geo(p.tomato()), t.scatter({ count: 14, minEdge: 26, maxEdge: 300, cell: 14, scale: [0.8, 1.3], keep: on }));
  t.instanced(t.geo(p.egg()), t.scatter({ count: 10, minEdge: 26, maxEdge: 300, cell: 14, scale: [0.8, 1.3], keep: on }));
  t.instanced(t.geo(p.cookie()), t.scatter({ count: 14, minEdge: 24, maxEdge: 300, cell: 12, scale: [0.9, 1.5], keep: on }));
}

function snow(t: SceneryTools): void {
  const forest = (x: number, z: number) => smoothstep(0.44, 0.62, fbm2(x / 60 + 3, z / 60 - 7, 3));
  t.variants(
    "pine",
    p.snowPine,
    t.scatter({
      count: 820,
      minEdge: 14,
      cell: 6,
      scale: [0.9, 1.7],
      stretch: [0.95, 1.35],
      maxSlope: 0.8,
      keep: (x, z, h, e) => (h < -8 ? 0 : e === 0 ? 1 : (0.05 + 0.95 * forest(x, z)) * (1 - smoothstep(35, 100, h))),
    }),
  );
  t.variants("rock", p.snowRock, t.scatter({ count: 150, minEdge: 12, cell: 5, scale: [0.8, 2.8], keep: above(-8) }));
  t.instanced(t.geo(p.snowDrift()), t.scatter({ count: 340, minEdge: 10, maxEdge: 140, cell: 4, scale: [1, 2.4], keep: above(-8) }));
  t.variants("ice", p.iceCrystals, t.scatter({ count: 70, minEdge: 18, maxEdge: 200, cell: 8, scale: [0.9, 1.9], keep: above(-8) }));
  // A few lit cabins far off: a warm window in the blue dusk.
  const spots = t.landmarkSpots(7, 70, 280, (_x, _z, h) => h > -2 && h < 8);
  const items: Item[] = spots.map((s) => ({ x: s.x, y: s.h - 0.1, z: s.z, yaw: t.rnd() * Math.PI * 2, sx: 1.6, sy: 1.6, sz: 1.6, ground: s.h }));
  t.instanced(t.geo(p.farCabin()), items);
}

function volcano(t: SceneryTools): void {
  const dry = (x: number, z: number, h: number) => (h > -12 && !t.terrain.isLava(x, z) ? 1 : 0);
  t.variants("rock", p.basaltBoulder, t.scatter({ count: 540, minEdge: 11, cell: 4, scale: [0.8, 2.5], stretch: [0.7, 1.2], keep: dry }));
  t.variants("spire", p.basaltSpike, t.scatter({ count: 150, minEdge: 14, cell: 7, scale: [0.8, 2.6], stretch: [1, 1.7], keep: dry }));
  t.variants("deadtree", p.charredTree, t.scatter({ count: 80, minEdge: 16, cell: 8, scale: [0.9, 1.7], maxSlope: 0.6, keep: dry }));
  t.variants("ember", p.emberRock, t.scatter({ count: 80, minEdge: 12, cell: 5, scale: [0.9, 2.1], keep: dry }));
  t.instanced(t.geo(p.ashMound()), t.scatter({ count: 180, minEdge: 10, maxEdge: 200, cell: 5, scale: [0.8, 2.2], keep: dry }));
  // Heat over the lava: soft orange lights along the rivers and lakes.
  const { terrain } = t;
  const spots: [number, number, number][] = [];
  for (let j = 0; j < terrain.nz; j += 3) {
    for (let i = 0; i < terrain.nx; i += 3) {
      const y = terrain.lavaY[j * terrain.nx + i]!;
      if (Number.isNaN(y)) continue;
      spots.push([terrain.minX + i * terrain.cell, y + 1.2, terrain.minZ + j * terrain.cell]);
    }
  }
  const step = Math.max(1, Math.ceil(spots.length / 420));
  const picked = spots.filter((_s, k) => k % step === 0);
  if (picked.length) {
    const points = makePoints(picked.length, true);
    const pos = points.geometry.getAttribute("position");
    const col = points.geometry.getAttribute("aColour");
    const size = points.geometry.getAttribute("aSize");
    picked.forEach(([x, y, z], k) => {
      pos.setXYZ(k, x, y, z);
      col.setXYZW(k, 1.0, 0.36 + (k % 5) * 0.05, 0.08, 0.32);
      size.setX(k, 14 + (k % 4) * 3);
    });
    pos.needsUpdate = col.needsUpdate = size.needsUpdate = true;
    points.renderOrder = 6;
    t.group.add(points);
    t.disposables.push(() => {
      points.geometry.dispose();
      (points.material as Material).dispose();
    });
  }
}

function funfair(t: SceneryTools): void {
  const on = above(-6);
  t.instanced(t.geo(p.fairTree()), t.scatter({ count: 260, minEdge: 12, cell: 6, scale: [0.9, 1.5], maxSlope: 0.6, keep: on }));
  t.instanced(t.geo(p.fairStall()), t.scatter({ count: 40, minEdge: 16, maxEdge: 130, cell: 14, scale: [0.9, 1.3], maxSlope: 0.3, keep: on }));
  t.instanced(t.geo(p.crateStack()), t.scatter({ count: 70, minEdge: 11, maxEdge: 160, cell: 5, scale: [0.9, 1.5], keep: on }));
  // Lamp posts: each a lit globe with a halo.
  const lamps = t.scatter({ count: 90, minEdge: 9.5, maxEdge: 70, cell: 22, scale: [1, 1], keep: on });
  t.instanced(t.geo(p.fairLamp()), lamps);
  if (lamps.length) {
    const points = makePoints(lamps.length, true);
    const pos = points.geometry.getAttribute("position");
    const col = points.geometry.getAttribute("aColour");
    const size = points.geometry.getAttribute("aSize");
    lamps.forEach((l, k) => {
      pos.setXYZ(k, l.x, l.y + 4.7, l.z);
      const c = [[1.0, 0.8, 0.4], [1.0, 0.45, 0.65], [0.5, 0.85, 1.0]][k % 3]!;
      col.setXYZW(k, c[0]!, c[1]!, c[2]!, 0.85);
      size.setX(k, 6.5);
    });
    pos.needsUpdate = col.needsUpdate = size.needsUpdate = true;
    points.renderOrder = 6;
    t.group.add(points);
    t.disposables.push(() => {
      points.geometry.dispose();
      (points.material as Material).dispose();
    });
  }
}

function space(t: SceneryTools): void {
  // Rocks adrift all round the ribbon, above and below it, never near enough to be in the way.
  const { terrain, rnd } = t;
  const kinds = [0, 1, 2].map((k) => t.geo(p.floatingRock(k)));
  const lists: Item[][] = [[], [], []];
  let tries = 6000;
  const want = Math.round(300 * t.quality.scenery);
  while (lists[0]!.length + lists[1]!.length + lists[2]!.length < want && tries-- > 0) {
    const x = terrain.minX + 20 + rnd() * (terrain.maxX - terrain.minX - 40);
    const z = terrain.minZ + 20 + rnd() * (terrain.maxZ - terrain.minZ - 40);
    const g = terrain.info(x, z);
    if (g.edge < 26 || t.blocked(x, z, 20)) continue;
    const dy = (rnd() * 2 - 1) * 90;
    if (Math.abs(dy) < 16 && g.edge < 70) continue;
    const sc = 2 + Math.pow(rnd(), 2.2) * 20;
    const k = Math.floor(rnd() * 3);
    lists[k]!.push({ x, y: g.roadY + dy, z, yaw: rnd() * Math.PI * 2, sx: sc, sy: sc * (0.7 + rnd() * 0.5), sz: sc });
  }
  kinds.forEach((geometry, k) => t.instanced(geometry, lists[k]!));
}

function palm(t: SceneryTools): void {
  const shore = SEA_LEVEL;
  const land = (_x: number, _z: number, h: number) => (h > shore + 0.45 ? 1 : 0);
  const density = (x: number, z: number) => 0.25 + 0.75 * smoothstep(0.35, 0.6, fbm2(x / 50 + 4, z / 50 - 2, 3));
  for (const seed of [0, 1]) {
    t.variants("palm", () => p.palmTree(seed), t.scatter({ count: 120, minEdge: 11, cell: 9, scale: [1.0, 1.7], maxSlope: 0.55, keep: (x, z, h, e) => (h > shore + 0.45 ? (e === 0 ? 1 : density(x, z)) : 0) }));
  }
  t.variants("bush", p.tropicalBush, t.scatter({ count: 340, minEdge: 10, cell: 3.5, scale: [0.8, 1.7], keep: land }));
  if (hasSceneryArt("rock") || hasSceneryArt("coral")) {
    // Beach rocks on the sand, and coral heads in the shallows along the shore.
    t.variants("rock", p.coralRock, t.scatter({ count: 70, minEdge: 12, cell: 5, scale: [0.8, 2.4], keep: (_x, _z, h) => (h > shore + 0.1 ? 1 : 0) }));
    t.variants("coral", p.coralRock, t.scatter({ count: 90, minEdge: 12, cell: 4, scale: [0.8, 2.2], keep: (_x, _z, h) => (h > shore - 2.2 && h < shore + 0.5 ? 1 : 0) }));
  } else {
    t.variants("rock", p.coralRock, t.scatter({ count: 130, minEdge: 12, cell: 5, scale: [0.8, 2.6], keep: (_x, _z, h) => (h > shore - 2.5 ? 1 : 0) }));
  }
  t.instanced(t.geo(p.parasol()), t.scatter({ count: 30, minEdge: 12, maxEdge: 70, cell: 12, scale: [1, 1.3], keep: (_x, _z, h) => (h > shore + 0.3 && h < shore + 3 ? 1 : 0) }));
  // Boats out on the water.
  const boat = t.geo(p.sailboat());
  const spots = t.landmarkSpots(7, 60, 330, (_x, _z, h) => h < shore - 3);
  const items: Item[] = spots.map((s) => ({ x: s.x, y: SEA_LEVEL - 0.15, z: s.z, yaw: t.rnd() * Math.PI * 2, sx: 2.2, sy: 2.2, sz: 2.2 }));
  t.instanced(boat, items);
}
