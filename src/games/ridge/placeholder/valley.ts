/**
 * The placeholder Valle Serra: the whole valley.glb built in code to the
 * asset contract (docs/OVERWATCH_RIDGE.md), for development and tests only.
 * A heightfield terrain with its splat maps and ground tiles, the river and
 * the reservoir, the forest as instanced firs and larches, the buildings
 * (structures.ts), and every named node the game reads: the eye, the sun,
 * the paths, the posts, the nests, the plates and the secrets.
 */
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DataTexture,
  DoubleSide,
  Group,
  InstancedMesh,
  LinearFilter,
  LinearMipmapLinearFilter,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  RGBAFormat,
  UnsignedByteType,
  Vector3,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { nameNode } from "../../../engine/world/names";
import { layoutPlan } from "./plan";
import { buildStructures } from "./structures";
import { terrainTiles } from "./textures";
import {
  CHAPEL,
  DAM,
  fbm,
  FARM,
  nearestOn,
  noise,
  RESERVOIR_LEVEL,
  RIVER,
  RIVER_LEVEL,
  riverHalfWidth,
  ROAD,
  ROAD_HALF_WIDTH,
  SUN_AZIMUTH,
  SUN_ELEVATION_START,
  SWITCHBACK,
  terrainHeight,
  TUNNEL,
  VILLAGE_ROAD,
  FARM_LANE,
  platePositions,
  YETI_ROCK,
  type XZ,
} from "./layout";

/** Where the terrain's detail splat covers, metres: [x0, z0, x1, z1]. */
export const SPLAT_BOUNDS = [-900, -1400, 1100, 100] as const;
/** The coarse splat's extent: the whole terrain. */
export const TERRAIN_BOUNDS = [-3600, -4800, 3900, 2700] as const;

/** Grid lines along one axis: fine through the middle, widening outward. */
function axis(lo: number, hi: number, fineLo: number, fineHi: number, fine: number, growth: number, widest: number): number[] {
  const out: number[] = [];
  for (let v = fineLo; v <= fineHi + 1e-6; v += fine) out.push(v);
  let step = fine;
  let v = fineLo;
  while (v > lo) {
    step = Math.min(widest, step * growth);
    v -= step;
    out.unshift(Math.max(lo, v));
  }
  step = fine;
  v = out[out.length - 1]!;
  while (v < hi) {
    step = Math.min(widest, step * growth);
    v += step;
    out.push(Math.min(hi, v));
  }
  return out;
}

export interface TerrainGrid {
  xs: number[];
  zs: number[];
  /** Heights, row by row (z), each row across x. */
  h: Float32Array;
}

function terrainGrid(): TerrainGrid {
  const [x0, z0, x1, z1] = TERRAIN_BOUNDS;
  const xs = axis(x0, x1, -700, 900, 5, 1.07, 90);
  const zs = axis(z0, z1, -1250, 20, 5, 1.07, 90);
  const h = new Float32Array(xs.length * zs.length);
  for (let j = 0; j < zs.length; j++) {
    for (let i = 0; i < xs.length; i++) h[j * xs.length + i] = terrainHeight(xs[i]!, zs[j]!);
  }
  return { xs, zs, h };
}

/** The ground as one mesh, with normals from its own heights. */
function terrainMesh(grid: TerrainGrid): Mesh {
  const { xs, zs, h } = grid;
  const nx = xs.length;
  const nz = zs.length;
  const pos = new Float32Array(nx * nz * 3);
  const nor = new Float32Array(nx * nz * 3);
  const n = new Vector3();
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      pos[k * 3] = xs[i]!;
      pos[k * 3 + 1] = h[k]!;
      pos[k * 3 + 2] = zs[j]!;
      const il = Math.max(0, i - 1);
      const ir = Math.min(nx - 1, i + 1);
      const jl = Math.max(0, j - 1);
      const jr = Math.min(nz - 1, j + 1);
      const dhdx = (h[j * nx + ir]! - h[j * nx + il]!) / Math.max(1e-3, xs[ir]! - xs[il]!);
      const dhdz = (h[jr * nx + i]! - h[jl * nx + i]!) / Math.max(1e-3, zs[jr]! - zs[jl]!);
      n.set(-dhdx, 1, -dhdz).normalize();
      nor[k * 3] = n.x;
      nor[k * 3 + 1] = n.y;
      nor[k * 3 + 2] = n.z;
    }
  }
  const idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
  let t = 0;
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i;
      const b = a + 1;
      const c = a + nx;
      const d = c + 1;
      // Split each quad along the diagonal that follows the ground better.
      if (Math.abs(h[a]! - h[d]!) < Math.abs(h[b]! - h[c]!)) {
        idx.set([a, c, d, a, d, b], t);
      } else {
        idx.set([a, c, b, b, c, d], t);
      }
      t += 6;
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(pos, 3));
  g.setAttribute("normal", new BufferAttribute(nor, 3));
  g.setIndex(new BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  g.computeBoundingBox();
  const mesh = nameNode(new Mesh(g, new MeshStandardMaterial({ color: "#6b7a4a", roughness: 1, name: "terrain" })), "terrain");
  mesh.userData["surface"] = "grass";
  return mesh;
}

/** Bilinear height from the grid (the axes are sorted; a binary search finds the cell). */
function gridHeight(grid: TerrainGrid, x: number, z: number): number {
  const { xs, zs, h } = grid;
  const find = (a: number[], v: number) => {
    let lo = 0;
    let hi = a.length - 1;
    if (v <= a[0]!) return 0;
    if (v >= a[hi]!) return hi - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (a[mid]! <= v) lo = mid;
      else hi = mid;
    }
    return lo;
  };
  const i = find(xs, x);
  const j = find(zs, z);
  const u = Math.min(1, Math.max(0, (x - xs[i]!) / (xs[i + 1]! - xs[i]!)));
  const v = Math.min(1, Math.max(0, (z - zs[j]!) / (zs[j + 1]! - zs[j]!)));
  const nx = xs.length;
  const a = h[j * nx + i]!;
  const b = h[j * nx + i + 1]!;
  const c = h[(j + 1) * nx + i]!;
  const d = h[(j + 1) * nx + i + 1]!;
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

const smooth = (a: number, b: number, x: number) => {
  const u = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return u * u * (3 - 2 * u);
};

/**
 * The ground's materials at a point, as the splat maps weigh them: grass on
 * the gentle ground, rock on the steep, scree below the cliffs, snow on the
 * heights, dirt by the farm and the river, stone on the roads.
 */
function groundWeights(grid: TerrainGrid, x: number, z: number, roads: boolean): [number, number, number, number, number, number] {
  const e = 3;
  const h = gridHeight(grid, x, z);
  const sx = (gridHeight(grid, x + e, z) - gridHeight(grid, x - e, z)) / (2 * e);
  const sz = (gridHeight(grid, x, z + e) - gridHeight(grid, x, z - e)) / (2 * e);
  const slope = Math.hypot(sx, sz);
  const n = fbm(x * 0.02, z * 0.02, 3, 71);
  const n2 = noise(x * 0.09, z * 0.09, 73);
  const alt = h + 60;
  let rock = smooth(0.62 + n * 0.12, 0.95, slope);
  // Snow on the heights, and a field of old snow lying in the hollow where the yeti lives.
  const hollow = smooth(190, 80, Math.hypot(x - YETI_ROCK[0], (z - YETI_ROCK[1]) * 1.4) + n * 60);
  let snow = Math.max(smooth(470 + n * 70, 560 + n * 60, alt), hollow) * (1 - smooth(1.1, 1.6, slope));
  let scree = smooth(0.42, 0.62, slope) * (1 - rock) * smooth(120, 240, alt + n2 * 60) * 0.9;
  let dirt = 0;
  let road = 0;
  if (roads) {
    for (const line of [ROAD, VILLAGE_ROAD, SWITCHBACK, FARM_LANE]) {
      const q = nearestOn(line, x, z);
      const half = line === FARM_LANE ? 1.8 : ROAD_HALF_WIDTH;
      road = Math.max(road, 1 - smooth(half - 0.6, half + 0.9, q.d + (n2 - 0.5) * 0.8));
      dirt = Math.max(dirt, (1 - smooth(half, half + 3.5, q.d)) * 0.7);
    }
    // The riverbanks: gravel and mud where the water has been.
    const r = nearestOn(RIVER, x, z);
    const half = riverHalfWidth(r.t);
    const bank = 1 - smooth(half, half + 6, r.d);
    scree = Math.max(scree, bank * 0.8);
    dirt = Math.max(dirt, (1 - smooth(half + 2, half + 10, r.d)) * 0.4);
    // Trodden earth round the farmyard and in the village lanes.
    dirt = Math.max(dirt, (1 - smooth(18, 34, Math.hypot(x - FARM[0], z - FARM[1]))) * (0.5 + 0.4 * n2));
    dirt = Math.max(dirt, (1 - smooth(40, 70, Math.hypot(x - CHAPEL[0] + 30, z - CHAPEL[1] + 5))) * 0.55 * smooth(0.45, 0.7, n2));
  }
  let grass = Math.max(0, 1 - rock - scree - snow);
  rock *= 1 - road;
  grass *= 1 - road;
  scree *= 1 - road;
  snow *= 1 - road;
  dirt *= 1 - road;
  // Dirt shares the grass's ground.
  const d = Math.min(dirt, grass);
  grass -= d;
  const sum = grass + rock + scree + snow + d + road || 1;
  return [grass / sum, rock / sum, scree / sum, snow / sum, d / sum, road / sum];
}

/** A pair of splat maps (four materials each) over `bounds`, `w` by `h` texels. */
function splatMaps(grid: TerrainGrid, bounds: readonly [number, number, number, number], w: number, h: number, roads: boolean): [DataTexture, DataTexture] {
  const a = new Uint8Array(w * h * 4);
  const b = new Uint8Array(w * h * 4);
  const [x0, z0, x1, z1] = bounds;
  for (let j = 0; j < h; j++) {
    const z = z0 + ((j + 0.5) / h) * (z1 - z0);
    for (let i = 0; i < w; i++) {
      const x = x0 + ((i + 0.5) / w) * (x1 - x0);
      const [grass, rock, scree, snow, dirt, road] = groundWeights(grid, x, z, roads);
      const k = (j * w + i) * 4;
      a[k] = Math.round(grass * 255);
      a[k + 1] = Math.round(rock * 255);
      a[k + 2] = Math.round(scree * 255);
      a[k + 3] = Math.round(snow * 255);
      b[k] = Math.round(dirt * 255);
      b[k + 1] = Math.round(road * 255);
      b[k + 2] = 0;
      b[k + 3] = 255;
    }
  }
  const make = (data: Uint8Array) => {
    const t = new DataTexture(data, w, h, RGBAFormat, UnsignedByteType);
    t.magFilter = LinearFilter;
    t.minFilter = LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.needsUpdate = true;
    return t;
  };
  return [make(a), make(b)];
}

/** The river as a ribbon of water down its bed, and the reservoir behind the dam. */
function waterMeshes(): Mesh[] {
  const pts: [number, number, number][] = [];
  // Resample the river every 6 m, with its half-width there.
  let total = 0;
  for (let i = 1; i < RIVER.length; i++) total += Math.hypot(RIVER[i]![0] - RIVER[i - 1]![0], RIVER[i]![1] - RIVER[i - 1]![1]);
  const stepM = 6;
  const pos: number[] = [];
  const uv: number[] = [];
  for (let s = 0; s <= total; s += stepM) {
    // Point and direction along the river.
    let acc = 0;
    let p: [number, number] = [RIVER[0]![0], RIVER[0]![1]];
    let dir: [number, number] = [1, 0];
    for (let i = 1; i < RIVER.length; i++) {
      const [ax, az] = RIVER[i - 1]!;
      const [bx, bz] = RIVER[i]!;
      const seg = Math.hypot(bx - ax, bz - az);
      if (acc + seg >= s || i === RIVER.length - 1) {
        const u = Math.min(1, (s - acc) / seg);
        p = [ax + (bx - ax) * u, az + (bz - az) * u];
        dir = [(bx - ax) / seg, (bz - az) / seg];
        break;
      }
      acc += seg;
    }
    const half = riverHalfWidth(s / total) + 2.5;
    pts.push([p[0], RIVER_LEVEL, p[1]]);
    pos.push(p[0] - dir[1] * half, RIVER_LEVEL, p[1] + dir[0] * half, p[0] + dir[1] * half, RIVER_LEVEL, p[1] - dir[0] * half);
    uv.push(0, s / 12, 1, s / 12);
  }
  const n = pos.length / 6;
  const idx: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const a = i * 2;
    idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute("uv", new BufferAttribute(new Float32Array(uv), 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const waterMat = () => new MeshStandardMaterial({ color: "#24413f", roughness: 0.1, metalness: 0, name: "water", side: DoubleSide });
  const river = nameNode(new Mesh(g, waterMat()), "water.river");
  river.userData["surface"] = "water";
  // The reservoir: a sheet across the gorge behind the dam; the ground hides its edges.
  const r = new BufferGeometry();
  const xL = (DAM.x0 + DAM.x1) / 2 - 190;
  const xR = (DAM.x0 + DAM.x1) / 2 + 190;
  const zN = DAM.z - DAM.thick / 2;
  const zF = -1460;
  r.setAttribute("position", new BufferAttribute(new Float32Array([xL, RESERVOIR_LEVEL, zN, xR, RESERVOIR_LEVEL, zN, xL, RESERVOIR_LEVEL, zF, xR, RESERVOIR_LEVEL, zF]), 3));
  r.setAttribute("uv", new BufferAttribute(new Float32Array([0, 0, 380 / 12, 0, 0, 700 / 12, 380 / 12, 700 / 12]), 2));
  r.setIndex([0, 2, 1, 1, 2, 3]);
  r.computeVertexNormals();
  const reservoir = nameNode(new Mesh(r, waterMat()), "water.reservoir");
  reservoir.userData["surface"] = "water";
  return [river, reservoir];
}

/** A fir: a straight trunk and four tiers of dark boughs, 1 unit is a metre at scale 1 (about 17 m tall). */
function firGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const trunk = new CylinderGeometry(0.18, 0.32, 5, 5, 1, true);
  trunk.translate(0, 2.5, 0);
  parts.push(trunk);
  const tiers: [number, number, number][] = [
    // [radius, height, base y]
    [3.2, 6.5, 2.6],
    [2.6, 5.6, 5.8],
    [1.9, 4.8, 9.0],
    [1.2, 4.2, 12.4],
  ];
  for (const [r, h, y] of tiers) {
    const c = new ConeGeometry(r, h, 7, 1, true);
    c.translate(0, y + h / 2, 0);
    parts.push(c);
  }
  const g = mergeGeometries(parts.map((p) => p.toNonIndexed()));
  // Height up the tree in a colour channel: the shader darkens the lower boughs and the trunk.
  const pos = g.getAttribute("position");
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const trunkPart = i < trunk.index!.count ? 1 : 0;
    col[i * 3] = y / 17;
    col[i * 3 + 1] = trunkPart;
    col[i * 3 + 2] = 0;
  }
  g.setAttribute("color", new BufferAttribute(col, 3));
  return g;
}

/** A larch: taller and slimmer, paler, its boughs thinner. */
function larchGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const trunk = new CylinderGeometry(0.16, 0.3, 7, 5, 1, true);
  trunk.translate(0, 3.5, 0);
  parts.push(trunk);
  for (const [r, h, y] of [
    [2.4, 8, 3.5],
    [1.8, 7, 8],
    [1.0, 6, 12.5],
  ] as [number, number, number][]) {
    const c = new ConeGeometry(r, h, 6, 1, true);
    c.translate(0, y + h / 2, 0);
    parts.push(c);
  }
  const g = mergeGeometries(parts.map((p) => p.toNonIndexed()));
  const pos = g.getAttribute("position");
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    col[i * 3] = pos.getY(i) / 19;
    col[i * 3 + 1] = i < trunk.index!.count ? 1 : 0;
  }
  g.setAttribute("color", new BufferAttribute(col, 3));
  return g;
}

/** Where the trees stand: the far side's forest band, groves on the ridge's flanks, a few along the river. */
function forest(grid: TerrainGrid): { fir: InstancedMesh; larch: InstancedMesh } {
  const firs: Matrix4[] = [];
  const larches: Matrix4[] = [];
  const m = new Matrix4();
  const q = new Quaternion();
  const up = new Vector3(0, 1, 0);
  const place = (x: number, z: number, jitter: number) => {
    const h = gridHeight(grid, x, z);
    const alt = h + 60;
    const e = 4;
    const slope = Math.hypot(gridHeight(grid, x + e, z) - gridHeight(grid, x - e, z), gridHeight(grid, x, z + e) - gridHeight(grid, x, z - e)) / (2 * e);
    const far = z < -520;
    const flank = z > -140 && z < -10 && Math.abs(x) > 140;
    const density = fbm(x * 0.006, z * 0.006, 3, 91) * 0.5 + 0.5;
    let want = 0;
    // In stands and clearings rather than evenly: thick where the noise is high, open meadow where low.
    if (far) want = smooth(4, 30, alt) * (1 - smooth(340, 430 + density * 60, alt)) * (0.05 + smooth(0.32, 0.72, density) * 0.95);
    if (flank) want = Math.max(want, smooth(140, 260, Math.abs(x)) * density * 0.8);
    if (!far && !flank && z < -150 && z > -520) want = 0.04 * density; // lone trees on the floor
    if (slope > 0.95) want *= 0.15;
    if (h < RIVER_LEVEL + 0.8) return;
    for (const line of [ROAD, VILLAGE_ROAD, SWITCHBACK]) if (nearestOn(line, x, z).d < ROAD_HALF_WIDTH + 6) return;
    const r = nearestOn(RIVER, x, z);
    if (r.d < riverHalfWidth(r.t) + 5) return;
    if (Math.hypot(x - CHAPEL[0] + 40, z - CHAPEL[1]) < 95) return;
    if (Math.hypot(x - FARM[0] + 10, z - FARM[1] + 20) < 70) return;
    if (Math.abs(x - 402) < 160 && z < -690 && z > -1500) return; // the gorge and its reservoir
    if (Math.hypot(x - TUNNEL[0], z - TUNNEL[2]) < 40) return;
    if (Math.hypot(x - YETI_ROCK[0], (z - YETI_ROCK[1]) * 1.4) < 170) return; // the yeti's snowfield, open to the scope
    if (Math.abs(x) < 130 && z > -300 && z < -140) return; // the soldiers' range
    if (noise(x * 0.37 + jitter, z * 0.37, 93) > want) return;
    const s = 0.6 + noise(x * 1.3, z * 1.3, 95) * 0.85;
    q.setFromAxisAngle(up, noise(x * 2.1, z * 2.1, 97) * Math.PI * 2);
    m.compose(new Vector3(x, h - 0.3, z), q, new Vector3(s, s * (0.9 + noise(x, z, 99) * 0.25), s));
    (alt > 260 && noise(x * 0.8, z * 0.8, 101) > 0.55 ? larches : firs).push(m.clone());
  };
  // A jittered lattice: 15 m on the forest band, coarser far away.
  for (let z = -2600; z < 0; z += z < -1500 ? 30 : 15) {
    for (let x = -1900; x < 1900; x += z < -1500 ? 30 : 15) {
      const jx = x + (noise(x * 0.13, z * 0.13, 103) - 0.5) * 9;
      const jz = z + (noise(x * 0.13, z * 0.13, 105) - 0.5) * 9;
      place(jx, jz, 0);
    }
  }
  const make = (geo: BufferGeometry, name: string, list: Matrix4[], color: string) => {
    const mesh = new InstancedMesh(geo, new MeshStandardMaterial({ color, roughness: 0.95, vertexColors: false, name }), list.length);
    list.forEach((mm, i) => mesh.setMatrixAt(i, mm));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    nameNode(mesh, name);
    mesh.userData["surface"] = "wood";
    return mesh;
  };
  return { fir: make(firGeometry(), "forest.fir", firs, "#23402c"), larch: make(larchGeometry(), "forest.larch", larches, "#5a7a3a") };
}

/** An empty with a contract name at a point (and extras). */
function marker(name: string, p: { x: number; y: number; z: number }, extras: Record<string, unknown> = {}): Object3D {
  const o = nameNode(new Object3D(), name);
  o.position.set(p.x, p.y, p.z);
  Object.assign(o.userData, extras);
  return o;
}

export interface PlaceholderValley {
  root: Group;
  grid: TerrainGrid;
}

/** The whole placeholder valley.glb scene. */
export function buildPlaceholderValley(): Group {
  const root = nameNode(new Group(), "valley");
  const grid = terrainGrid();
  const terrain = terrainMesh(grid);
  const [fine0, fine1] = splatMaps(grid, SPLAT_BOUNDS, 1024, 768, true);
  const [coarse0, coarse1] = splatMaps(grid, TERRAIN_BOUNDS, 512, 512, false);
  terrain.userData["placeholder"] = {
    splat: { maps: [fine0, fine1], bounds: [...SPLAT_BOUNDS] },
    coarse: { maps: [coarse0, coarse1], bounds: [...TERRAIN_BOUNDS] },
    tiles: terrainTiles(256),
    layers: ["grass", "rock", "scree", "snow", "dirt", "road"],
  };
  root.add(terrain);
  for (const w of waterMeshes()) root.add(w);
  const trees = forest(grid);
  root.add(trees.fir, trees.larch);
  root.add(buildStructures((x, z) => gridHeight(grid, x, z)));

  // The eye: prone at the brink, looking down the valley.
  const cam = marker("camera.player", { x: 0, y: 0, z: 0 }, { fov: 46 });
  root.add(cam);
  // The sun: its −Z along the light, low behind the player's left shoulder.
  const sun = nameNode(new Object3D(), "sun");
  const el = (SUN_ELEVATION_START * Math.PI) / 180;
  const toSun = new Vector3(Math.sin(SUN_AZIMUTH) * Math.cos(el), Math.sin(el), Math.cos(SUN_AZIMUTH) * Math.cos(el));
  sun.position.copy(toSun).multiplyScalar(1000);
  sun.lookAt(0, 0, 0);
  // lookAt points +Z at the target for non-cameras: turn it so −Z does.
  sun.quaternion.multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI));
  root.add(sun);

  // The plan's named nodes.
  const plan = layoutPlan();
  plan.road.forEach((p, i) => root.add(marker(`path.road.${i}`, p)));
  plan.patrol.forEach((p, i) => root.add(marker(`path.patrol.${i}`, p)));
  plan.dam.slice(0, -1).forEach((p, i) => root.add(marker(`path.dam.${i}`, p)));
  root.add(marker("tunnel", plan.dam[plan.dam.length - 1]!));
  plan.farmer.forEach((p, i) => root.add(marker(`path.farmer.${i}`, p)));
  plan.cyclist.forEach((p, i) => root.add(marker(`path.cyclist.${i}`, p)));
  plan.shepherd.forEach((p, i) => root.add(marker(`path.shepherd.${i}`, p)));
  plan.cheese.forEach((p, i) => root.add(marker(`path.cheese.${i}`, p)));
  plan.eagle.forEach((p, i) => root.add(marker(`eagle.path.${i}`, p)));
  plan.duck.forEach((p, i) => root.add(marker(`secret.duck.path.${i}`, p)));
  plan.cows.forEach((p, i) => root.add(marker(`animals.cows.${i}`, p)));
  plan.sheep.forEach((p, i) => root.add(marker(`animals.sheep.${i}`, p)));
  plan.goatLedges.forEach((p, i) => root.add(marker(`secret.goat.${i}`, p)));
  root.add(marker("bridge.cross", plan.bridge));
  root.add(marker("eagle.rock", plan.eagleRock));
  for (const post of plan.posts) {
    const o = marker(`post.${post.id}`, post.at, { kind: post.kind, place: post.place });
    o.rotation.y = post.heading;
    root.add(o);
  }
  plan.nests.forEach((nest, i) => {
    const o = marker(`sniper.${i}`, nest.exposed, { place: nest.place });
    o.rotation.y = nest.heading;
    const exposed = marker(`sniper.${i}.exposed`, { x: 0, y: 0, z: 0 });
    const hidden = marker(`sniper.${i}.hidden`, { x: 0, y: 0, z: 0 });
    o.add(exposed, hidden);
    root.add(o);
    // The children in world terms: the hidden spot a metre back and down.
    o.updateMatrixWorld(true);
    const inv = new Matrix4().copy(o.matrixWorld).invert();
    hidden.position.copy(new Vector3(nest.hidden.x, nest.hidden.y, nest.hidden.z).applyMatrix4(inv));
  });
  // The aim check's plates hang from their posts (built with the structures); their pivots are named there.
  void platePositions;
  root.userData["placeholder"] = true;
  root.updateMatrixWorld(true);
  void Color;
  return root;
}
