/**
 * Lush detail near the road: thousands of grass tufts and a scatter of
 * flowers on the ground beyond the barriers, where the camera looks across
 * them. Each kind is one InstancedMesh (a handful of draw calls); the blades
 * sway in the wind in the vertex shader, and read the same baked sun shadow
 * and occlusion as the rest of the world, so a tuft in a tree's shade is in
 * shade.
 *
 * Only the worlds with something growing get any: the meadow, the canyon's
 * dry grass, the island's beach grass, the glacier's frosted tussocks.
 */
import {
  Color,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  ShaderChunk,
  StaticDrawUsage,
  Vector3,
  Euler,
  BufferGeometry,
  type Frustum,
  type WebGLProgramParametersWithUniforms,
} from "three";
import { seededRandom } from "../../../engine/random";
import { clamp, fbm2, smoothstep } from "../math";
import type { QualitySettings } from "../quality";
import { MeshBuilder, rgb, type Rgb, type V3 } from "./builder";
import { Clearance } from "./clearance";
import { CulledInstances } from "./cull";
import { WALL_DISTANCE } from "./features";
import type { KeepOut } from "./landmarks/place";
import { bakedLit, twinOf, type BakeUniforms } from "./shading";
import type { Terrain } from "./terrain";
import type { ThemeStyle } from "./themes";

export interface Foliage {
  group: Group;
  update(time: number): void;
  /** View `view` is about to be drawn: only the tufts and flowers its frustum reaches are drawn (see cull.ts). */
  cull(view: number, frustum: Frustum, eye?: { x: number; y: number; z: number }, reach?: number): void;
  /** Every instance again, for a draw that is not one of the views. */
  uncull(): void;
  dispose(): void;
}

interface Growth {
  /** Share of the quality's tuft budget this world gets. */
  share: number;
  /** Tuft colours (mixed into the ground's own colour, so they belong to it). */
  tint: [Rgb, Rgb];
  /** Blade height range, metres (before the per-tuft scale). */
  height: [number, number];
  /** The flowers: share of the tufts, and their colours. Empty for none. */
  flowers: number;
  petals: string[];
  /**
   * How near the barrier the growth starts and how far it reaches: metres beyond the road's edge where the barrier stands at
   * the usual 6 m, and measured from the barrier itself, so a wide verge (the sand cut inside a hairpin) pushes the growth out
   * with it, as it does the scenery: nothing grows where a kart can drive.
   */
  from: number;
  to: number;
}

const GROWTH: Partial<Record<ThemeStyle["id"], Growth>> = {
  meadow: {
    share: 1,
    tint: [rgb("#9ee86a"), rgb("#f0f27a")],
    height: [0.3, 0.6],
    flowers: 0.16,
    petals: ["#ff5252", "#ffd23d", "#ffffff", "#c77dff", "#ff8fd0", "#ff9f43", "#5ec8ff"],
    from: 8.2,
    to: 46,
  },
  canyon: {
    share: 0.5,
    tint: [rgb("#d9b86a"), rgb("#f0d890")],
    height: [0.3, 0.6],
    flowers: 0.05,
    petals: ["#ff8a3d", "#ffd23d", "#ffffff"],
    from: 8.2,
    to: 34,
  },
  palm: {
    share: 0.55,
    tint: [rgb("#9bd27a"), rgb("#e6e08a")],
    height: [0.35, 0.7],
    flowers: 0.06,
    petals: ["#ff6fa8", "#ffffff", "#ffd23d"],
    from: 8.2,
    to: 40,
  },
  snow: {
    share: 0.3,
    tint: [rgb("#a9c3b4"), rgb("#dfeaf5")],
    height: [0.25, 0.5],
    flowers: 0,
    petals: [],
    from: 8.2,
    to: 30,
  },
};

const UP: V3 = [0, 1, 0];

/** One tuft: a fan of blades, each a tapered triangle that leans a little, dark at the root and bright at the tip. */
function tuftGeometry(blades: number, height: [number, number], seed: number): BufferGeometry {
  const rnd = seededRandom(seed);
  const b = new MeshBuilder();
  const root: Rgb = [0.34, 0.5, 0.26];
  const tip: Rgb = [1.15, 1.2, 0.9];
  for (let k = 0; k < blades; k++) {
    const a = (k / blades) * Math.PI * 2 + rnd() * 0.9;
    const r = 0.02 + rnd() * 0.14;
    const h = height[0] + rnd() * (height[1] - height[0]);
    const lean = 0.08 + rnd() * 0.22;
    const w = 0.045 + rnd() * 0.035;
    const cx = Math.cos(a) * r;
    const cz = Math.sin(a) * r;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    const px = -dz;
    const pz = dx;
    const l: V3 = [cx - px * w, -0.04, cz - pz * w];
    const rr: V3 = [cx + px * w, -0.04, cz + pz * w];
    const t: V3 = [cx + dx * lean, h, cz + dz * lean];
    // The normal leans out and up: lit like the ground it grows from, with a little of the blade's own side.
    const n: V3 = [dx * 0.35, 0.94, dz * 0.35];
    b.triN(l, rr, t, root, root, tip, n, n, [dx * 0.2, 0.98, dz * 0.2]);
  }
  return b.build();
}

/** A flower: a stem and a ring of petals around an eye, the petals white (an instance colour tints them), the rest fixed. */
function flowerParts(): { stem: BufferGeometry; petals: BufferGeometry } {
  const stem = new MeshBuilder();
  const petals = new MeshBuilder();
  const green = rgb("#3f9a3a");
  const eye = rgb("#ffc21a");
  const h = 0.34;
  stem.rod([0, 0, 0], [0.03, h, 0.02], 0.022, green);
  // Eye: a small dome (a flat fan facing up).
  const cx = 0.03;
  const cz = 0.02;
  const ring = 8;
  for (let i = 0; i < ring; i++) {
    const a0 = (i / ring) * Math.PI * 2;
    const a1 = ((i + 1) / ring) * Math.PI * 2;
    stem.triN([cx, h + 0.035, cz], [cx + Math.cos(a1) * 0.04, h + 0.012, cz + Math.sin(a1) * 0.04], [cx + Math.cos(a0) * 0.04, h + 0.012, cz + Math.sin(a0) * 0.04], [4, 3, 0.4], eye, eye, UP, UP, UP);
  }
  // Petals: six rounded wedges around the eye, tilted up a little at their tips.
  const white: Rgb = [1, 1, 1];
  const shade: Rgb = [0.72, 0.72, 0.72];
  const n = 6;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const w = 0.052;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    const px = -dz * w;
    const pz = dx * w;
    const inner: V3 = [cx + dx * 0.035, h + 0.016, cz + dz * 0.035];
    const mid0: V3 = [cx + dx * 0.1 - px, h + 0.026, cz + dz * 0.1 - pz];
    const mid1: V3 = [cx + dx * 0.1 + px, h + 0.026, cz + dz * 0.1 + pz];
    const tip: V3 = [cx + dx * 0.15, h + 0.045, cz + dz * 0.15];
    const nrm: V3 = [dx * 0.25, 0.95, dz * 0.25];
    petals.triN(inner, mid1, mid0, shade, white, white, nrm, nrm, nrm);
    petals.triN(mid0, mid1, tip, white, white, white, nrm, nrm, nrm);
  }
  return { stem: stem.build(), petals: petals.build() };
}

const _m = new Matrix4();
const _q = new Quaternion();
const _e = new Euler();
const _p = new Vector3();
const _s = new Vector3();

/** Where the tufts and flowers are scattered: the track's own box and 55 m round it (what the world passes as `bounds`). */
export function foliageBounds(samples: readonly { x: number; z: number }[]): { minX: number; maxX: number; minZ: number; maxZ: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const s of samples) {
    minX = Math.min(minX, s.x);
    maxX = Math.max(maxX, s.x);
    minZ = Math.min(minZ, s.z);
    maxZ = Math.max(maxZ, s.z);
  }
  return { minX: minX - 55, maxX: maxX + 55, minZ: minZ - 55, maxZ: maxZ + 55 };
}

export function buildFoliage(style: ThemeStyle, terrain: Terrain, quality: QualitySettings, bake: BakeUniforms, keepOut: readonly KeepOut[], bounds: { minX: number; maxX: number; minZ: number; maxZ: number }): Foliage | null {
  const growth = GROWTH[style.id];
  if (!growth || quality.tufts <= 0) return null;
  const rnd = seededRandom(4242);
  const group = new Group();
  const time = { value: 0 };
  const disposables: { dispose(): void }[] = [];

  const sway = (shader: WebGLProgramParametersWithUniforms) => {
    shader.uniforms.uTime = time;
    shader.vertexShader = shader.vertexShader.replace("#include <common>", "#include <common>\nuniform float uTime;").replace(
      "#include <begin_vertex>",
      `#include <begin_vertex>
      {
        vec4 iw = vec4( transformed, 1.0 );
        #ifdef USE_INSTANCING
          iw = instanceMatrix * iw;
        #endif
        vec3 wp = ( modelMatrix * iw ).xyz;
        float gust = sin( uTime * 1.7 + wp.x * 0.35 + wp.z * 0.27 ) * 0.5 + sin( uTime * 3.3 + wp.x * 1.1 - wp.z * 0.7 ) * 0.18;
        float k = max( position.y, 0.0 );
        transformed.x += gust * 0.16 * k * k;
        transformed.z += gust * 0.1 * k * k;
      }`,
    );
    // A blade is lit from both sides alike: its back is not a dark face.
    shader.fragmentShader = shader.fragmentShader.replace("#include <normal_fragment_begin>", ShaderChunk.normal_fragment_begin.replace("normal *= faceDirection;", ""));
  };
  const material = bakedLit(new MeshStandardMaterial({ vertexColors: true, side: DoubleSide, roughness: 0.85, metalness: 0 }), bake, "tuft", sway);
  disposables.push(material);

  // ── Where things grow: beyond the barrier (measured from the road itself, clearance.ts), in patches ──
  const clearance = new Clearance(terrain);
  const want = Math.round(quality.tufts * growth.share);
  const spots: { x: number; z: number; y: number; scale: number; yaw: number; flower: boolean; tint: number }[] = [];
  let tries = 0;
  const span = growth.to - growth.from;
  while (spots.length < want && tries++ < want * 40) {
    const x = bounds.minX + rnd() * (bounds.maxX - bounds.minX);
    const z = bounds.minZ + rnd() * (bounds.maxZ - bounds.minZ);
    const edge = clearance.beyond(x, z) + WALL_DISTANCE;
    if (edge < growth.from || edge > growth.to) continue;
    // Thickest by the barrier, thinning out with distance; in clumps, not an even carpet.
    const near = 1 - smoothstep(0, 1, (edge - growth.from) / span);
    const patch = smoothstep(0.34, 0.6, fbm2(x / 8 + 11, z / 8 - 5, 3));
    if (rnd() > (0.18 + 0.82 * near * near) * (0.25 + 0.75 * patch)) continue;
    let blocked = false;
    for (const k of keepOut) {
      if ((k.x - x) ** 2 + (k.z - z) ** 2 < (k.r + 1.5) ** 2) {
        blocked = true;
        break;
      }
    }
    if (blocked) continue;
    const slope = Math.hypot(terrain.heightAt(x + 1.5, z) - terrain.heightAt(x - 1.5, z), terrain.heightAt(x, z + 1.5) - terrain.heightAt(x, z - 1.5)) / 3;
    if (slope > 0.7) continue;
    const flowerPatch = smoothstep(0.5, 0.64, fbm2(x / 5 - 3, z / 5 + 17, 2));
    const flower = growth.flowers > 0 && rnd() < growth.flowers * (0.15 + 3 * flowerPatch) && edge < growth.from + span * 0.7;
    spots.push({ x, z, y: terrain.heightAt(x, z), scale: 0.8 + rnd() * 1.1 + (patch > 0.8 ? 0.3 : 0), yaw: rnd() * Math.PI * 2, flower, tint: rnd() });
  }
  if (spots.length === 0) return null;

  // ── Tufts ──
  const tuftGeo = tuftGeometry(quality.tier === "high" ? 7 : 5, growth.height, 91);
  disposables.push(tuftGeo);
  const tufts = new InstancedMesh(tuftGeo, material, spots.length);
  tufts.instanceMatrix.setUsage(StaticDrawUsage);
  const flowerSpots = spots.filter((s) => s.flower);
  const color = new Color();
  const tintA = new Color(growth.tint[0][0], growth.tint[0][1], growth.tint[0][2]);
  const tintB = new Color(growth.tint[1][0], growth.tint[1][1], growth.tint[1][2]);
  spots.forEach((s, i) => {
    _e.set(0, s.yaw, 0);
    _q.setFromEuler(_e);
    const sy = s.scale * (0.75 + rnd() * 0.7);
    _m.compose(_p.set(s.x, s.y - 0.02, s.z), _q, _s.set(s.scale, sy, s.scale));
    tufts.setMatrixAt(i, _m);
    // The ground's own colour, pushed toward the theme's blade tint, and varied tuft to tuft.
    const gi = clamp(Math.round((s.x - terrain.minX) / terrain.cell), 0, terrain.nx - 1);
    const gj = clamp(Math.round((s.z - terrain.minZ) / terrain.cell), 0, terrain.nz - 1);
    const g = terrain.colourAt(gi, gj);
    color.setRGB(g[0], g[1], g[2]).lerp(tintA, 0.45).lerp(tintB, s.tint * 0.35);
    color.multiplyScalar(0.8 + rnd() * 0.5);
    tufts.setColorAt(i, color);
  });
  tufts.instanceMatrix.needsUpdate = true;
  if (tufts.instanceColor) tufts.instanceColor.needsUpdate = true;
  tufts.computeBoundingSphere();
  tufts.computeBoundingBox();
  group.add(tufts);
  const culls: CulledInstances[] = [new CulledInstances(tufts)];

  // ── Flowers ──
  if (flowerSpots.length > 0) {
    const parts = flowerParts();
    disposables.push(parts.stem, parts.petals);
    // The stems have no colour of their own, the tufts and petals have: a twin, so that the material does not change kind in between.
    const stemMaterial = twinOf(material);
    disposables.push(stemMaterial);
    const stems = new InstancedMesh(parts.stem, stemMaterial, flowerSpots.length);
    const petals = new InstancedMesh(parts.petals, material, flowerSpots.length);
    const palette = growth.petals.map((c) => new Color(c));
    flowerSpots.forEach((s, i) => {
      _e.set((rnd() - 0.5) * 0.25, s.yaw, (rnd() - 0.5) * 0.25);
      _q.setFromEuler(_e);
      const k = 1.1 + rnd() * 0.9;
      _m.compose(_p.set(s.x, s.y - 0.02, s.z), _q, _s.set(k, k, k));
      stems.setMatrixAt(i, _m);
      petals.setMatrixAt(i, _m);
      // Flowers come in colonies of one colour.
      const pick = Math.floor(fbm2(s.x / 14 + 2, s.z / 14 - 9, 2) * 3.2 * palette.length + rnd() * 0.6) % palette.length;
      petals.setColorAt(i, palette[pick]!);
    });
    for (const m of [stems, petals]) {
      m.instanceMatrix.needsUpdate = true;
      m.computeBoundingSphere();
      group.add(m);
    }
    if (petals.instanceColor) petals.instanceColor.needsUpdate = true;
    culls.push(new CulledInstances(stems), new CulledInstances(petals));
  }

  return {
    group,
    update(t) {
      time.value = t;
    },
    cull(view, frustum, eye, reach) {
      for (const c of culls) c.select(view, frustum, eye, reach);
    },
    uncull() {
      for (const c of culls) c.all();
    },
    dispose() {
      for (const c of culls) c.dispose();
      for (const d of disposables) d.dispose();
      tufts.dispose();
      group.removeFromParent();
    },
  };
}
