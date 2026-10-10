/**
 * The things standing around the track, placed well clear of the road:
 * trees, bushes, flowers and a windmill in the meadow; mesas, boulders and
 * cacti in the canyon; container yards, warehouses, cranes and ships at the
 * harbour. Each kind is one InstancedMesh (one draw call, and the camera
 * skips it when none is in view).
 *
 * Positions come from a seeded random source, so a track looks the same every
 * time it loads; distance from the road comes from the terrain (which knows
 * how far any point is beyond the road's edge).
 */
import {
  BufferGeometry,
  Color,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  StaticDrawUsage,
  Vector3,
  Euler,
  type Frustum,
  type Material,
  type Object3D,
} from "three";
import { seededRandom } from "../../../engine/random";
import { fbm2, smoothstep } from "../math";
import { makePoints } from "../points";
import type { QualitySettings } from "../quality";
import { MeshBuilder, rgb, type Rgb } from "./builder";
import { CulledInstances } from "./cull";
import { SOLID_MARGIN, WALL_DISTANCE } from "./features";
import { hasSceneryArt, sceneryVariants } from "./sceneryArt";
import type { BakeUniforms } from "./shading";
import { landmarkFromArt } from "./landmarks/fromArt";
import { bake, type KeepOut } from "./landmarks/place";
import * as props from "./props";
import { addWorldScenery } from "./sceneryWorlds";
import { WATER_LEVEL, type Terrain } from "./terrain";
import type { ThemeStyle } from "./themes";

export interface Scenery {
  group: Group;
  /** Called every frame with the clock in seconds. */
  update(time: number): void;
  /** View `view` is about to be drawn: its instanced scenery shows only what `frustum` reaches (see cull.ts). */
  cull(view: number, frustum: Frustum): void;
  /** Every instance again, for a draw that is not one of the views. */
  uncull(): void;
  dispose(): void;
}

export interface Item {
  x: number;
  y: number;
  z: number;
  yaw: number;
  sx: number;
  sy: number;
  sz: number;
  colour?: Rgb;
}

const _m = new Matrix4();
const _q = new Quaternion();
const _e = new Euler();
const _p = new Vector3();
const _s = new Vector3();
const _c = new Color();

function instancedMesh(geometry: BufferGeometry, material: Material, items: Item[]): InstancedMesh | null {
  if (items.length === 0) return null;
  const mesh = new InstancedMesh(geometry, material, items.length);
  mesh.instanceMatrix.setUsage(StaticDrawUsage);
  items.forEach((it, i) => {
    _e.set(0, it.yaw, 0);
    _q.setFromEuler(_e);
    _m.compose(_p.set(it.x, it.y, it.z), _q, _s.set(it.sx, it.sy, it.sz));
    mesh.setMatrixAt(i, _m);
    if (it.colour) {
      _c.setRGB(it.colour[0], it.colour[1], it.colour[2]);
      mesh.setColorAt(i, _c);
    }
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.computeBoundingBox();
  return mesh;
}

/** A multiplier near 1 that nudges a colour, so a field of the same tree is not a row of clones. */
function tint(rnd: () => number, amount = 0.16): Rgb {
  const k = 1 + (rnd() - 0.5) * amount * 2;
  return [k * (1 + (rnd() - 0.5) * amount), k, k * (1 + (rnd() - 0.5) * amount)];
}

/** What the scenery of one world needs from the scattering machinery of all of them. */
export interface SceneryTools {
  style: ThemeStyle;
  terrain: Terrain;
  quality: QualitySettings;
  material: Material;
  rnd: () => number;
  group: Group;
  scatter(spec: Spec): Item[];
  instanced(geometry: BufferGeometry, items: Item[]): void;
  /**
   * Instances `items` as the Blender-made variants of a kind of scenery (`scenery.<kind>.<n>`, dealt round
   * them) when the world's file has some, else as the code-built shape `fallback` makes.
   */
  variants(kind: string, fallback: () => BufferGeometry, items: Item[]): void;
  geo<G extends BufferGeometry>(g: G): G;
  landmarkSpots(count: number, minEdge: number, maxEdge: number, accept?: (x: number, z: number, h: number) => boolean): { x: number; z: number; h: number; edge: number }[];
  animated: ((t: number) => void)[];
  disposables: (() => void)[];
  /** True where a landmark stands (or the ground is not worth planting). */
  blocked(x: number, z: number, margin?: number): boolean;
}

/** How far, horizontally, a geometry reaches from its origin at heights a kart can meet, and how tall it is: worked out once. */
const reaches = new WeakMap<BufferGeometry, { radius: number; height: number }>();
function reachOf(geometry: BufferGeometry): { radius: number; height: number } {
  let r = reaches.get(geometry);
  if (!r) {
    const pos = geometry.getAttribute("position");
    let radius = 0;
    let height = 0;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      height = Math.max(height, y);
      if (y > 0.2) radius = Math.max(radius, Math.hypot(pos.getX(i), pos.getZ(i)));
    }
    r = { radius, height };
    reaches.set(geometry, r);
  }
  return r;
}

export interface Spec {
  count: number;
  minEdge: number;
  maxEdge?: number;
  /** 0..1 chance of keeping a candidate given its place. */
  keep?: (x: number, z: number, h: number, edge: number) => number;
  cell?: number;
  scale: [number, number];
  stretch?: [number, number];
  lift?: number;
  maxSlope?: number;
}

export function buildScenery(
  style: ThemeStyle,
  terrain: Terrain,
  quality: QualitySettings,
  material: Material,
  seed = 1234,
  keepOut: readonly KeepOut[] = [],
  _bake?: BakeUniforms,
): Scenery {
  const rnd = seededRandom(seed);
  const group = new Group();
  const disposables: (() => void)[] = [];
  const animated: ((t: number) => void)[] = [];
  /** Every instanced kind, culled for each view. */
  const culls: CulledInstances[] = [];
  /**
   * Instances, but never one whose body reaches within a camera's width of the sim's barrier (the scatter keeps their
   * centres clear; a big boulder or drift is wider than that): the picture shows nothing solid where a kart can be.
   */
  const instanced = (geometry: BufferGeometry, mat: Material, items: Item[]): InstancedMesh | null => {
    const { radius, height } = reachOf(geometry);
    const clear = items.filter((it) => {
      if (height * it.sy < 0.45) return true;
      // The body's rim, all round: the nearest road to the middle is not always the one the rim reaches.
      const r = radius * Math.max(it.sx, it.sz);
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        if (terrain.clearAt(it.x + Math.sin(a) * r, it.z + Math.cos(a) * r) < SOLID_MARGIN + 0.3) return false;
      }
      return terrain.clearAt(it.x, it.z) >= SOLID_MARGIN + 0.3;
    });
    const mesh = instancedMesh(geometry, mat, clear);
    if (mesh) culls.push(new CulledInstances(mesh));
    return mesh;
  };
  const add = (o: Object3D | null) => {
    if (o) group.add(o);
  };
  const geo = <G extends BufferGeometry>(g: G): G => {
    disposables.push(() => g.dispose());
    return g;
  };

  /** A Blender-made landmark standing on the ground here as plain meshes, its turning parts turning: false when there is none. */
  const standArt = (kind: string, x: number, y: number, z: number, yaw: number, scale: number): boolean => {
    const art = landmarkFromArt(kind);
    if (!art) return false;
    const stand = new Group();
    stand.position.set(x, y, z);
    stand.rotation.y = yaw;
    stand.scale.setScalar(scale);
    stand.add(new Mesh(geo(art.lit.build()), material));
    for (const part of art.moving ?? []) {
      const about = new MeshBuilder();
      if (part.lit) bake(about, part.lit, ([px, py, pz]) => [px - part.pivot[0], py - part.pivot[1], pz - part.pivot[2]], true);
      const mesh = new Mesh(geo(about.build()), material);
      mesh.position.set(part.pivot[0], part.pivot[1], part.pivot[2]);
      stand.add(mesh);
      animated.push((t) => part.update(t, mesh));
    }
    add(stand);
    return true;
  };

  const variants = (kind: string, fallback: () => BufferGeometry, items: Item[]): void => {
    const art = sceneryVariants(kind);
    if (!art.length) {
      add(instanced(geo(fallback()), material, items));
      return;
    }
    art.forEach((g, k) => add(instanced(geo(g), material, items.filter((_, i) => i % art.length === k))));
  };

  // The ground facts of a random point, or null where it is out of bounds.
  const pick = () => {
    const x = terrain.minX + 30 + rnd() * (terrain.maxX - terrain.minX - 60);
    const z = terrain.minZ + 30 + rnd() * (terrain.maxZ - terrain.minZ - 60);
    return { x, z };
  };

  const occupied = new Set<number>();
  const key = (x: number, z: number, cell: number) => Math.floor(x / cell) * 73856093 + Math.floor(z / cell) * 19349663;

  const blocked = (x: number, z: number, margin = 3): boolean => {
    for (const k of keepOut) if ((k.x - x) ** 2 + (k.z - z) ** 2 < (k.r + margin) ** 2) return true;
    return false;
  };
  const scatter = (spec: Spec): Item[] => {
    const items: Item[] = [];
    const want = Math.round(spec.count * quality.scenery);
    let tries = want * 24;
    while (items.length < want && tries-- > 0) {
      const { x, z } = pick();
      if (blocked(x, z)) continue;
      const h = terrain.heightAt(x, z);
      if (spec.keep && rnd() > spec.keep(x, z, h, 0)) continue;
      const cellKey = spec.cell ? key(x, z, spec.cell) : null;
      if (cellKey !== null && occupied.has(cellKey)) continue;
      // Measured from where the sim's barrier stands (6 m out by default): a verge pushes the scenery out with it.
      const edge = terrain.clearAt(x, z) + WALL_DISTANCE;
      if (edge < spec.minEdge || (spec.maxEdge !== undefined && edge > spec.maxEdge)) continue;
      if (spec.keep && rnd() > spec.keep(x, z, h, edge)) continue;
      if (spec.maxSlope !== undefined) {
        const slope = Math.hypot(terrain.heightAt(x + 2, z) - terrain.heightAt(x - 2, z), terrain.heightAt(x, z + 2) - terrain.heightAt(x, z - 2)) / 4;
        if (slope > spec.maxSlope) continue;
      }
      if (cellKey !== null) occupied.add(cellKey);
      const sc = spec.scale[0] + rnd() * (spec.scale[1] - spec.scale[0]);
      const st = spec.stretch ? spec.stretch[0] + rnd() * (spec.stretch[1] - spec.stretch[0]) : 1;
      items.push({ x, y: h + (spec.lift ?? -0.05), z, yaw: rnd() * Math.PI * 2, sx: sc, sy: sc * st, sz: sc, colour: tint(rnd) });
    }
    return items;
  };

  /** Places `count` landmark spots: open ground, near enough to be seen, far enough to be clear. */
  const landmarkSpots = (count: number, minEdge: number, maxEdge: number, accept: (x: number, z: number, h: number) => boolean = () => true): { x: number; z: number; h: number; edge: number }[] => {
    const spots: { x: number; z: number; h: number; edge: number }[] = [];
    let tries = 4000;
    while (spots.length < count && tries-- > 0) {
      const { x, z } = pick();
      const edge = terrain.clearAt(x, z) + WALL_DISTANCE;
      const h = terrain.heightAt(x, z);
      if (edge < minEdge || edge > maxEdge || !accept(x, z, h) || blocked(x, z, 12)) continue;
      if (spots.some((s) => Math.hypot(s.x - x, s.z - z) < 70)) continue;
      spots.push({ x, z, h, edge });
    }
    return spots;
  };

  const forest = (x: number, z: number) => smoothstep(0.46, 0.64, fbm2(x / 55 + 3, z / 55 - 7, 3));

  if (style.id === "meadow") {
    const hay = geo(props.hayBale());
    variants("tree", props.roundTree, scatter({ count: 760, minEdge: 13, cell: 6, scale: [0.85, 1.5], stretch: [0.9, 1.25], maxSlope: 0.5, keep: (x, z, _h, e) => (e === 0 ? 1 : (0.08 + 0.92 * forest(x, z)) * (1 - 0.5 * smoothstep(40, 200, e))) }));
    variants("pine", props.pineTree, scatter({ count: 520, minEdge: 15, cell: 6, scale: [0.9, 1.7], stretch: [0.95, 1.4], maxSlope: 0.7, keep: (x, z, h, e) => (e === 0 ? 1 : (0.04 + 0.96 * forest(x + 120, z - 80)) * smoothstep(-2, 10, h + e * 0.04)) }));
    variants("bush", props.bush, scatter({ count: 420, minEdge: 11, cell: 3, scale: [0.7, 1.4], maxSlope: 0.6, keep: (x, z, _h, e) => (e === 0 ? 1 : 0.25 + 0.75 * forest(x, z) * (1 - smoothstep(40, 90, e))) }));
    variants("rock", props.rock, scatter({ count: 110, minEdge: 11, cell: 4, scale: [0.7, 2.2], stretch: [0.7, 1.1] }));
    // Flowers: bright dots of colour just beyond the barriers, where the eye passes.
    const petals: Rgb[] = [rgb("#ff5d8f"), rgb("#ffd60a"), rgb("#ffffff"), rgb("#bf5af2"), rgb("#ff9f0a")];
    const flowerItems = scatter({ count: 800, minEdge: 9.6, maxEdge: 38, cell: 1.4, scale: [0.8, 1.3], keep: (x, z) => 0.2 + 0.8 * smoothstep(0.4, 0.62, fbm2(x / 20, z / 20, 2)) });
    // (Modelled clumps come in the colours themselves: one variant each, dealt round.)
    if (!hasSceneryArt("flower")) {
      flowerItems.forEach((f) => {
        f.colour = petals[Math.floor(rnd() * petals.length)]!;
      });
    }
    variants("flower", props.flowers, flowerItems);
    add(instanced(hay, material, scatter({ count: 16, minEdge: 16, maxEdge: 80, cell: 6, scale: [0.9, 1.2], maxSlope: 0.2 })));

    // The windmill and barn: landmarks in open ground.
    const spots = landmarkSpots(2, 38, 120, (x, z, h) => h < 6 && fbm2(x / 55 + 3, z / 55 - 7, 3) < 0.55);
    // The Blender-made windmill and barn (art/kart/world/) stand here too when there are some, so the farm is of a piece.
    if (spots[0] && !standArt("windmill", spots[0].x, spots[0].h - 0.1, spots[0].z, rnd() * 6, 1)) {
      const windmill = props.windmill();
      const tower = geo(windmill.tower);
      const blades = geo(windmill.blades);
      const s = spots[0];
      const tm = new Mesh(tower, material);
      tm.position.set(s.x, s.h - 0.1, s.z);
      tm.scale.setScalar(1.15);
      add(tm);
      const bm = new Mesh(blades, material);
      bm.position.set(s.x, s.h + 8.2 * 1.15, s.z + 3.1 * 1.15);
      bm.scale.setScalar(1.15);
      add(bm);
      animated.push((t) => {
        bm.rotation.z = t * 0.35;
      });
    }
    if (spots[1] && !standArt("barn", spots[1].x, spots[1].h - 0.1, spots[1].z, rnd() * 6, 1)) {
      const bm = new Mesh(geo(props.barn()), material);
      bm.position.set(spots[1].x, spots[1].h - 0.1, spots[1].z);
      bm.rotation.y = rnd() * 6;
      add(bm);
    }
  } else if (style.id === "canyon") {
    const mesas = [0, 1, 2, 3].map((k) => geo(props.mesa(k)));
    const sand = (x: number, z: number) => 0.3 + 0.7 * smoothstep(0.35, 0.6, fbm2(x / 44, z / 44, 2));
    mesas.forEach((g) => {
      const items = scatter({ count: 9, minEdge: 150, maxEdge: 520, cell: 60, scale: [26, 52], stretch: [0.9, 1.7], lift: -2, keep: (_x, _z, h) => (h < 40 ? 1 : 0) });
      // Mesas are wide and tall: stretch them taller than they are wide.
      items.forEach((it) => {
        it.sy *= 1.4;
        it.colour = tint(rnd, 0.08);
      });
      add(instanced(g, material, items));
    });
    variants("rock", props.boulder, scatter({ count: 460, minEdge: 11, cell: 3.5, scale: [0.7, 2.4], stretch: [0.7, 1.2], keep: (x, z) => sand(x, z) }));
    variants("cactus", props.cactus, scatter({ count: 300, minEdge: 13, maxEdge: 160, cell: 5, scale: [0.9, 1.7], maxSlope: 0.35, keep: (x, z) => sand(x + 50, z) }));
    variants("shrub", props.dryBush, scatter({ count: 520, minEdge: 10, cell: 2.5, scale: [0.7, 1.5], maxSlope: 0.45 }));
    const arch = landmarkSpots(1, 60, 150, (_x, _z, h) => h < 8);
    // (A free-standing arch: the modelled one, whose span is the road's own frame, stands as it is.)
    if (arch[0] && !standArt("rock-arch", arch[0].x, arch[0].h - 1, arch[0].z, rnd() * 6.28, 1.3)) {
      const m = new Mesh(geo(props.rockArch()), material);
      m.position.set(arch[0].x, arch[0].h - 1, arch[0].z);
      m.rotation.y = rnd() * 6.28;
      m.scale.setScalar(1.5);
      add(m);
    }
  } else if (style.id === "harbour") {
    // Harbour: yards of containers, warehouses, cranes, ships and a skyline of lights.
    const boxGeo = geo(props.container());
    const palette: Rgb[] = ["#d9473b", "#2f6bff", "#27b5a2", "#f2a33a", "#8e5bd6", "#e8e8ec", "#d95b9a", "#4aa3ff"].map(rgb).map((c) => [c[0] * 1.05, c[1] * 1.05, c[2] * 1.05] as Rgb);
    const stacks: Item[] = [];
    const yards = landmarkSpots(9, 26, 150, (_x, _z, h) => h > -0.3 && h < 4);
    for (const yard of yards) {
      const yaw = rnd() * Math.PI;
      const rows = 3 + Math.floor(rnd() * 3);
      const cols = 4 + Math.floor(rnd() * 5);
      const cosY = Math.cos(yaw);
      const sinY = Math.sin(yaw);
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const lx = (c - cols / 2) * 6.5;
          const lz = (r - rows / 2) * 2.9;
          const x = yard.x + lx * cosY - lz * sinY;
          const z = yard.z + lx * sinY + lz * cosY;
          const h = terrain.heightAt(x, z);
          if (terrain.edgeAt(x, z) < 22 || h < -0.5) continue;
          const levels = 1 + Math.floor(rnd() * rnd() * 4);
          const colour = palette[Math.floor(rnd() * palette.length)]!;
          for (let k = 0; k < levels; k++) {
            stacks.push({ x, y: h + k * 2.6, z, yaw: yaw + (rnd() > 0.5 ? 0 : 0.02), sx: 1, sy: 1, sz: 1, colour });
          }
        }
      }
    }
    add(instanced(boxGeo, material, stacks));

    const wares = landmarkSpots(5, 30, 170, (_x, _z, h) => h > -0.3 && h < 4);
    const wh = geo(props.warehouse());
    add(instanced(wh, material, wares.map((s) => ({ x: s.x, y: s.h - 0.1, z: s.z, yaw: Math.floor(rnd() * 4) * (Math.PI / 2), sx: 1, sy: 1, sz: 1 }))));

    // Cranes at the quay edge, booms out over the water.
    const crane = props.crane();
    const craneGeo = geo(crane.structure);
    const edgeSpots = landmarkSpots(3, 36, 200, (x, z, h) => {
      if (h < -0.3 || h > 3) return false;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        if (terrain.heightAt(x + dx * 36, z + dz * 36) < -2.5) return true;
      }
      return false;
    });
    for (const s of edgeSpots) {
      let best = 0;
      let bestH = Infinity;
      for (let a = 0; a < 16; a++) {
        const ang = (a / 16) * Math.PI * 2;
        const h = terrain.heightAt(s.x + Math.sin(ang) * 36, s.z + Math.cos(ang) * 36);
        if (h < bestH) {
          bestH = h;
          best = ang;
        }
      }
      const m = new Mesh(craneGeo, material);
      m.position.set(s.x, s.h - 0.1, s.z);
      m.rotation.y = best;
      add(m);
      // The red beacon on top.
      const lx = s.x;
      const lz = s.z;
      const p = makePoints(1, true);
      const posAttr = p.geometry.getAttribute("position");
      posAttr.setXYZ(0, lx, s.h + crane.light[1], lz);
      posAttr.needsUpdate = true;
      const colAttr = p.geometry.getAttribute("aColour");
      colAttr.setXYZW(0, 1.0, 0.1, 0.05, 1);
      const sizeAttr = p.geometry.getAttribute("aSize");
      sizeAttr.setX(0, 3.2);
      add(p);
      animated.push((t) => {
        colAttr.setW(0, 0.35 + 0.65 * Math.max(0, Math.sin(t * 2.4 + lx)));
        colAttr.needsUpdate = true;
      });
      disposables.push(() => {
        p.geometry.dispose();
        (p.material as Material).dispose();
      });
    }

    // Ships far out on the water.
    const shipGeo = geo(props.ship());
    const seaSpots = landmarkSpots(4, 90, 320, (x, z, h) => h < -3.2 && terrain.heightAt(x + 60, z) < -3 && terrain.heightAt(x, z + 60) < -3);
    for (const s of seaSpots) {
      const m = new Mesh(shipGeo, material);
      m.position.set(s.x, WATER_LEVEL - 1.2, s.z);
      m.rotation.y = rnd() * Math.PI;
      m.scale.setScalar(1.0);
      add(m);
    }

    // A skyline of lit windows beyond the water: thousands of dim lights, one draw call.
    const cx = (terrain.minX + terrain.maxX) / 2;
    const cz = (terrain.minZ + terrain.maxZ) / 2;
    const ring = Math.max(terrain.maxX - terrain.minX, terrain.maxZ - terrain.minZ) / 2 + 120;
    const dark = new MeshBuilder();
    const windows: number[] = [];
    const blocks = 150;
    for (let k = 0; k < blocks; k++) {
      const ang = (k / blocks) * Math.PI * 2 + rnd() * 0.04;
      const r = ring + rnd() * 90;
      const w = 18 + rnd() * 34;
      const d = 18 + rnd() * 30;
      const hgt = 14 + Math.pow(rnd(), 2.4) * 100;
      const bx = cx + Math.cos(ang) * r;
      const bz = cz + Math.sin(ang) * r;
      dark.box(bx, hgt / 2 - 2, bz, w, hgt, d, { bottom: rgb("#0c1330"), top: rgb("#1a2550") }, -ang);
      const lit = Math.floor((w * hgt) / 70);
      for (let i = 0; i < lit; i++) {
        if (rnd() > 0.55) continue;
        const u = (rnd() - 0.5) * (w - 2);
        const v = 2 + rnd() * (hgt - 6);
        // Windows on the face toward the middle of the world.
        const nx = -Math.cos(ang);
        const nz = -Math.sin(ang);
        const tx = -nz;
        const tz = nx;
        windows.push(bx + nx * (d / 2 + 0.2) + tx * u, v - 2, bz + nz * (d / 2 + 0.2) + tz * u);
      }
    }
    const sky = geo(dark.build());
    add(new Mesh(sky, material));
    const lights = makePoints(windows.length / 3, true);
    const pa = lights.geometry.getAttribute("position");
    const ca = lights.geometry.getAttribute("aColour");
    const sa = lights.geometry.getAttribute("aSize");
    for (let i = 0; i < windows.length / 3; i++) {
      pa.setXYZ(i, windows[i * 3]!, windows[i * 3 + 1]!, windows[i * 3 + 2]!);
      const warm = rnd();
      ca.setXYZW(i, 1.0, 0.7 + warm * 0.2, 0.3 + warm * 0.4, 0.4 + rnd() * 0.5);
      sa.setX(i, 1.8 + rnd() * 1.8);
    }
    pa.needsUpdate = true;
    ca.needsUpdate = true;
    sa.needsUpdate = true;
    lights.renderOrder = 5;
    add(lights);
    disposables.push(() => {
      lights.geometry.dispose();
      (lights.material as Material).dispose();
    });
  } else {
    addWorldScenery({
      style,
      terrain,
      quality,
      material,
      rnd,
      group,
      scatter,
      variants,
      instanced: (geometry, items) => add(instanced(geometry, material, items)),
      geo,
      landmarkSpots,
      animated,
      disposables,
      blocked,
    });
  }

  // (The clouds are painted in the sky now: see sky.ts.)

  return {
    group,
    update(time: number) {
      for (const f of animated) f(time);
    },
    cull(view: number, frustum: Frustum) {
      for (const c of culls) c.select(view, frustum);
    },
    uncull() {
      for (const c of culls) c.all();
    },
    dispose() {
      for (const c of culls) c.dispose();
      for (const d of disposables) d();
    },
  };
}
