/**
 * Nothing the world scatters stands where a kart can be, measured on what the GPU is given.
 *
 * Every instance of the scenery and the tufts, through its final matrix (scale, stretch, turn, and the culling's reordering;
 * then again as each view's own buffer holds it), and every other mesh the scenery stands, on every track and its mirror, at
 * every quality tier, with the Blender art in place (nodeArt.ts decodes the real files and files them as art.ts would) and
 * without it. Where a kart can be is the sim's own rule (kartSpace.ts: the nearest stretch of road and its barrier), not the
 * terrain grid the scatter used to read, which was out by a verge's width at the end of Glacier Pass's cut; and the tufts,
 * which nothing measured, grew a metre tall in the canyon's sand cut and Glacier Pass's snow cut.
 *
 * On the road and the verge nothing rises 15 cm above the ground; within a camera's width beyond the barrier nothing solid
 * stands in the band a kart or its camera meets (0.45 to 5 m above the road), as corridor.test.ts has it (grass may: a
 * camera passes through it). And whatever stands on the ground stands on it all round: no side of it hangs over a slope
 * (boulders hung as much as 13 m in the air on the downhill side). corridor.test.ts
 * and corridor.art.test.ts measure the landmarks and the track's decoration with the same rule, triangle by triangle.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { Frustum, Matrix4, MeshLambertMaterial, PerspectiveCamera, Vector3, type BufferGeometry, type InstancedMesh, type Mesh, type Object3D } from "three";
import { TrackGeometry, type TrackDef } from "../../track/geometry";
import { mirrorTrack } from "../../track/mirror";
import { TRACKS } from "../../track/tracks";
import { QUALITY, TIERS, type Tier } from "../quality";
import { Bank } from "./bank";
import { placedLandmarks } from "./corridorProbe";
import { SOLID_MARGIN } from "./features";
import { buildFoliage, foliageBounds } from "./foliage";
import { KartSpace } from "./kartSpace";
import { buildLandmarks, landmarkMaterials, type KeepOut } from "./landmarks/place";
import { loadWorldArt } from "./nodeArt";
import { buildScenery } from "./scenery";
import { makeBakeUniforms } from "./shading";
import { SEA_LEVEL, Terrain, WATER_LEVEL } from "./terrain";
import { styleFor } from "./themes";

// What art.ts would hold: the theme's world file, or nothing (the code-built stand-ins).
const nodes = vi.hoisted(() => new Map<string, Object3D>());
vi.mock("../art", () => ({
  artNode: (name: string) => nodes.get(name)?.clone(true) ?? null,
  hasArt: (name: string) => nodes.has(name),
  artNames: (prefix: string) => [...nodes.keys()].filter((n) => n.startsWith(prefix)).sort(),
}));

const worlds = new Map<string, Map<string, Object3D>>();
beforeAll(async () => {
  for (const theme of new Set(TRACKS.map((t) => t.theme))) worlds.set(theme, await loadWorldArt(theme));
}, 120_000);

/** What a kart or its camera meets, metres above the road (or the ground, where it rises past the road). */
const BAND: [number, number] = [0.45, 5];
/** On the road or the verge, nothing may rise more than this above the ground. */
const FLAT = 0.15;
/** A thing must reach this far into the camera's margin to count (as corridorProbe.ts has it). */
const MIN_DEPTH = 0.25;
/** The step, metres, at which a triangle is walked over. */
const STEP = 0.5;

interface Offence {
  what: string;
  x: number;
  z: number;
  s: number;
  past: number;
  height: number;
}

/** Holds a world's scattered things to the sim's rule: `check` walks one mesh (every instance of an instanced one) and notes offences. */
class Inspector {
  readonly offences = new Map<string, Offence>();
  private readonly a = new Vector3();
  private readonly b = new Vector3();
  private readonly c = new Vector3();
  private readonly m = new Matrix4();

  constructor(
    private readonly space: KartSpace,
    private readonly bank: Bank,
    private readonly terrain: Terrain,
  ) {}

  /** Is the point (x, y, z) where nothing may be? Grass (`solid` false) may grow in the camera's margin: a camera passes through it. */
  private point(what: string, x: number, y: number, z: number, solid: boolean): void {
    const here = this.space.place(x, z, this.space.reach + SOLID_MARGIN);
    if (!here) return;
    const ref = Math.max(here.roadY + this.bank.lift(here.s, here.offset), this.terrain.heightAt(x, z));
    const height = y - ref;
    const inside = here.past < 0 && height > FLAT && height < BAND[1];
    const margin = solid && here.walled && here.past >= 0 && here.past < SOLID_MARGIN - MIN_DEPTH && height >= BAND[0] && height <= BAND[1];
    if (!inside && !margin) return;
    const old = this.offences.get(what);
    if (!old || here.past < old.past) this.offences.set(what, { what, x, z, s: here.s, past: here.past, height });
  }

  /** Every corner of every triangle of `geometry` under `world`, and their insides every STEP metres. */
  private walk(what: string, geometry: BufferGeometry, world: Matrix4, solid: boolean): void {
    const pos = geometry.getAttribute("position");
    const index = geometry.index;
    const count = index ? index.count : pos.count;
    const { a, b, c } = this;
    for (let t = 0; t + 2 < count; t += 3) {
      a.fromBufferAttribute(pos, index ? index.getX(t) : t).applyMatrix4(world);
      b.fromBufferAttribute(pos, index ? index.getX(t + 1) : t + 1).applyMatrix4(world);
      c.fromBufferAttribute(pos, index ? index.getX(t + 2) : t + 2).applyMatrix4(world);
      // A triangle that cannot come near where a kart can be (a far building's wall) is not walked over.
      const mx = (a.x + b.x + c.x) / 3;
      const mz = (a.z + b.z + c.z) / 3;
      const spread = Math.sqrt(Math.max((a.x - mx) ** 2 + (a.z - mz) ** 2, (b.x - mx) ** 2 + (b.z - mz) ** 2, (c.x - mx) ** 2 + (c.z - mz) ** 2));
      const middle = this.space.place(mx, mz, spread + this.space.reach + SOLID_MARGIN);
      if (!middle || middle.past - spread > SOLID_MARGIN) continue;
      const nb = Math.max(1, Math.ceil(a.distanceTo(b) / STEP));
      const nc = Math.max(1, Math.ceil(a.distanceTo(c) / STEP));
      for (let i = 0; i <= nb; i++) {
        for (let j = 0; j <= nc; j++) {
          const u = i / nb;
          const v = j / nc;
          if (u + v > 1) break;
          this.point(what, a.x + (b.x - a.x) * u + (c.x - a.x) * v, a.y + (b.y - a.y) * u + (c.y - a.y) * v, a.z + (b.z - a.z) * u + (c.z - a.z) * v, solid);
        }
      }
    }
  }

  /** Walks `geometry` under `world` if any of it can come near where a kart can be. */
  private near(what: string, geometry: BufferGeometry, world: Matrix4, solid: boolean): void {
    geometry.computeBoundingSphere();
    const sphere = geometry.boundingSphere!;
    const centre = this.a.copy(sphere.center).applyMatrix4(world);
    const e = world.elements;
    const radius = sphere.radius * Math.max(Math.hypot(e[0]!, e[1]!, e[2]!), Math.hypot(e[4]!, e[5]!, e[6]!), Math.hypot(e[8]!, e[9]!, e[10]!));
    const here = this.space.place(centre.x, centre.z, radius + this.space.reach + SOLID_MARGIN);
    if (!here || here.past - radius > SOLID_MARGIN) return;
    this.walk(what, geometry, world, solid);
  }

  /** Every mesh under `root`, every instance of an instanced one as its buffer holds it now. */
  check(root: Object3D, label: string, solid = true): number {
    let instances = 0;
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      const what = `${label} ${mesh.geometry.uuid.slice(0, 6)} (${mesh.geometry.getAttribute("position").count} vertices)`;
      if ((mesh as unknown as InstancedMesh).isInstancedMesh) {
        const im = mesh as unknown as InstancedMesh;
        for (let i = 0; i < im.count; i++) {
          im.getMatrixAt(i, this.m);
          this.near(what, im.geometry, this.m.premultiply(im.matrixWorld), solid);
          instances++;
        }
      } else this.near(what, mesh.geometry, mesh.matrixWorld, solid);
    });
    return instances;
  }
}

/** The matrices an instanced mesh holds, as strings, for comparing what a view draws with what the world placed. */
function held(mesh: InstancedMesh): string[] {
  const out: string[] = [];
  const m = new Matrix4();
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, m);
    out.push(m.elements.map((v) => v.toFixed(3)).join(","));
  }
  return out;
}

/** Views along the lap, as a chase camera sees it: behind and above the centre line, looking ahead. */
function viewsAlong(geo: TrackGeometry, count: number): Frustum[] {
  const out: Frustum[] = [];
  for (let k = 0; k < count; k++) {
    const s = (k / count) * geo.length;
    const eye = geo.at(s - 7);
    const at = geo.at(s + 12);
    const camera = new PerspectiveCamera(72, 16 / 9, 0.3, 900);
    camera.position.set(eye.x, eye.y + 3, eye.z);
    camera.lookAt(at.x, at.y + 1, at.z);
    camera.updateMatrixWorld();
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
    out.push(new Frustum().setFromProjectionMatrix(new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)));
  }
  return out;
}

/** How far over the ground a thing's footing may hang, metres. */
const HOVER = 0.3;

/**
 * The instances under `root` whose footing (their lowest 10 cm, as drawn) hangs more than HOVER over the ground on any side:
 * not a boat on the water, nor a container on another, nor a rock adrift in space (which has no ground).
 */
function hovering(root: Object3D, terrain: Terrain, water: number, label: string): string[] {
  const out: string[] = [];
  const m = new Matrix4();
  const v = new Vector3();
  root.traverse((o) => {
    const mesh = o as InstancedMesh;
    if (!mesh.isInstancedMesh) return;
    const pos = mesh.geometry.getAttribute("position");
    let low = Infinity;
    for (let i = 0; i < pos.count; i++) low = Math.min(low, pos.getY(i));
    // Where each one stands, to tell a container resting on another from one hanging in the air.
    const stacks = new Map<string, number[]>();
    for (let k = 0; k < mesh.count; k++) {
      mesh.getMatrixAt(k, m);
      const key = `${m.elements[12]!.toFixed(2)},${m.elements[14]!.toFixed(2)}`;
      stacks.set(key, [...(stacks.get(key) ?? []), m.elements[13]!]);
    }
    let worst = 0;
    let where = "";
    for (let k = 0; k < mesh.count; k++) {
      mesh.getMatrixAt(k, m);
      const e = m.elements;
      const sy = Math.hypot(e[4]!, e[5]!, e[6]!);
      let gap = -Infinity;
      let ground = Infinity;
      for (let i = 0; i < pos.count; i++) {
        if ((pos.getY(i) - low) * sy > 0.1) continue;
        v.fromBufferAttribute(pos, i).applyMatrix4(m);
        const h = terrain.heightAt(v.x, v.z);
        ground = Math.min(ground, h);
        gap = Math.max(gap, v.y - h);
      }
      if (gap <= HOVER || ground < water) continue;
      // Resting on another of its kind (a container on a stack).
      if (stacks.get(`${e[12]!.toFixed(2)},${e[14]!.toFixed(2)}`)!.some((y) => y < e[13]! - 0.5)) continue;
      if (gap > worst) {
        worst = gap;
        where = `(${e[12]!.toFixed(0)}, ${e[14]!.toFixed(0)})`;
      }
    }
    if (worst > 0) out.push(`${label} ${mesh.geometry.uuid.slice(0, 6)} (${pos.count} vertices) hangs ${worst.toFixed(2)} m over the ground at ${where}`);
  });
  return out;
}

const line = (o: Offence) => `${o.what}: ${o.height.toFixed(2)} m high, ${o.past < 0 ? `${(-o.past).toFixed(1)} m inside the barrier` : `${o.past.toFixed(1)} m beyond the barrier`} at s=${o.s.toFixed(0)} (${o.x.toFixed(0)}, ${o.z.toFixed(0)})`;

describe("the scenery and the tufts, as drawn", () => {
  for (const base of TRACKS) {
    for (const def of [base, mirrorTrack(base)] as TrackDef[]) {
      for (const art of [true, false]) {
        it(`${def.id}${art ? "" : " (stand-ins)"}: nothing on the road or the verge, nothing solid within a camera's width of the barrier, at every tier and in every view`, () => {
          nodes.clear();
          if (art) for (const [name, node] of worlds.get(def.theme)!) nodes.set(name, node);
          const geo = TrackGeometry.build(def);
          const bank = new Bank(geo);
          const style = styleFor(def.theme);
          const space = new KartSpace(def, geo);
          const material = new MeshLambertMaterial({ vertexColors: true });
          let keepOut: KeepOut[] | null = null;
          const found: string[] = [];
          for (const tier of TIERS as readonly Tier[]) {
            const quality = QUALITY[tier];
            const terrain = Terrain.build(geo, style, quality.cell);
            // The landmarks keep the scatter out of their footprints, as in the game (where they stand does not change with the tier).
            if (!keepOut) {
              const mats = landmarkMaterials();
              const layer = buildLandmarks({ track: geo, style, bank, groundAt: (x, z) => terrain.heightAt(x, z) }, placedLandmarks(def), mats);
              keepOut = layer.keepOut;
              layer.dispose();
              mats.dispose();
            }
            const inspector = new Inspector(space, bank, terrain);
            const scenery = buildScenery(style, terrain, quality, material, 1234, keepOut);
            const foliage = buildFoliage(style, terrain, quality, makeBakeUniforms(), keepOut, foliageBounds(geo.samples));
            const counted = inspector.check(scenery.group, `${tier} scenery`) + (foliage ? inspector.check(foliage.group, `${tier} tufts`, false) : 0);
            if (style.id !== "space" && style.id !== "harbour") expect(counted, `${def.id} ${tier}: instances`).toBeGreaterThan(100);
            // Each view's own buffer holds only what the world placed: draw two views round the lap and compare.
            const placed = new Map<BufferGeometry, Set<string>>();
            const instancedUnder = (visit: (mesh: InstancedMesh) => void) => {
              for (const root of [scenery.group, foliage?.group]) {
                root?.traverse((o) => {
                  if ((o as InstancedMesh).isInstancedMesh && o.visible) visit(o as InstancedMesh);
                });
              }
            };
            instancedUnder((mesh) => placed.set(mesh.geometry, new Set(held(mesh))));
            viewsAlong(geo, 12).forEach((frustum, k) => {
              scenery.cull(k % 2, frustum);
              foliage?.cull(k % 2, frustum);
              instancedUnder((mesh) => {
                const own = placed.get(mesh.geometry);
                if (held(mesh).some((m) => !own?.has(m))) found.push(`${tier}: view ${k % 2} draws an instance the world did not place`);
              });
            });
            scenery.uncull();
            foliage?.uncull();
            for (const o of inspector.offences.values()) found.push(line(o));
            // Standing on the ground all round, not hanging over a slope (space has no ground; boats float on the water).
            if (style.id !== "space") found.push(...hovering(scenery.group, terrain, style.id === "harbour" ? WATER_LEVEL - 0.5 : style.id === "palm" ? SEA_LEVEL - 0.5 : -Infinity, tier));
            scenery.dispose();
            foliage?.dispose();
          }
          material.dispose();
          expect(found).toEqual([]);
        }, 900_000);
      }
    }
  }
});
