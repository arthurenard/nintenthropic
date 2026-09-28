/**
 * The scene Overwatch Ridge draws: the dawn sky behind everything and, through
 * PMREM, lighting everything that is not the ground; the valley's terrain,
 * water and forest in their own shaders; the buildings and people in
 * standard materials patched to the same light and air (atmosphere.ts); a
 * low warm sun whose reach the light map decides; and the groups the game
 * fills with people, vehicles and effects.
 */
import { Color, DirectionalLight, Group, Mesh, Scene, Vector2, Vector3, type Material, type ShaderMaterial, type Texture, type WebGLRenderer } from "three";
import type { Quality } from "../../../engine/types";
import { SceneryQueries } from "../../../engine/world/queries";
import { disposeTree } from "../../../engine/world/scene";
import { SkyLight } from "../../../engine/world/sky";
import { atmosphereUniforms, horizonRing, patchStandard, type AtmosphereUniforms } from "./atmosphere";
import { chunkForest } from "./forest";
import { Heightfield } from "./heightfield";
import { buildLightMap, type LightMap } from "./lightmap";
import { terrainMaterial } from "./terrain";
import type { ValleyLayout } from "./valley";
import { waterMaterial } from "./water";

/** The play area, where the ground is sampled finely: x0, z0, x1, z1. */
const FINE_BOX = [-1000, -1500, 1300, 150] as const;
/** How far the sun climbs over a long run, degrees, and over how many seconds. */
const SUN_CLIMB = 3.5;
const SUN_CLIMB_TIME = 600;

export class Stage {
  readonly scene = new Scene();
  readonly sun = new DirectionalLight(0xffffff, Math.PI);
  /** People, animals, vehicles. */
  readonly dynamic = new Group();
  readonly fxRoot = new Group();
  readonly atmosphere: AtmosphereUniforms;
  readonly heightfield: Heightfield;
  readonly lightMap: LightMap;
  readonly queries: SceneryQueries;
  /** Unit, toward the sun. */
  readonly toSun = new Vector3();
  /** The sun's elevation when the run began, radians. */
  readonly sunStart: number;
  private readonly sky: SkyLight;
  private readonly forestMaterials: ShaderMaterial[] = [];
  private readonly shaders: ShaderMaterial[] = [];
  readonly treeCount: number;
  private windDrift = new Vector2();

  constructor(
    renderer: WebGLRenderer,
    readonly valley: ValleyLayout,
    skyTexture: Texture,
  ) {
    const scene = this.scene;
    this.sky = new SkyLight(renderer, scene, skyTexture, 0.5);
    this.atmosphere = atmosphereUniforms();
    const ring = horizonRing(skyTexture);
    if (ring) this.atmosphere.uHazeSky.value = ring;

    // The sun: its direction from the art, its elevation climbing over a run.
    this.toSun.copy(valley.sunDirection).negate().normalize();
    this.sunStart = Math.asin(Math.max(-1, Math.min(1, this.toSun.y)));
    this.atmosphere.uSunDir.value.copy(this.toSun);
    this.atmosphere.uSunElev.value = this.sunStart;
    this.sun.color.copy(this.atmosphere.uSunColor.value);
    this.sun.position.copy(this.toSun).multiplyScalar(500);
    this.sun.target.position.set(0, 0, 0);
    scene.add(this.sun, this.sun.target);

    // The ground, sampled for the rounds and for the light map.
    const terrain = valley.terrain;
    if (!terrain) throw new Error("Overwatch Ridge: the valley has no terrain");
    this.heightfield = Heightfield.fromMesh(terrain, FINE_BOX);
    const flatSun = new Vector2(this.toSun.x, this.toSun.z);
    if (flatSun.lengthSq() < 1e-6) flatSun.set(0, 1);
    this.lightMap = buildLightMap(renderer, this.heightfield.coarse, flatSun.normalize());
    this.atmosphere.uLight.value = this.lightMap.texture;
    this.atmosphere.uLightBounds.value.copy(this.lightMap.bounds);

    scene.add(valley.root);
    if (valley.terrainInputs) {
      const mat = terrainMaterial(valley.terrainInputs, this.atmosphere);
      this.shaders.push(mat);
      const old = terrain.material;
      terrain.material = mat;
      (Array.isArray(old) ? old : [old]).forEach((m) => m.dispose());
    } else {
      patchAll(terrain, this.atmosphere, true);
    }
    for (const [mesh, kind] of [
      [valley.river, "river"],
      [valley.reservoir, "reservoir"],
    ] as const) {
      if (!mesh) continue;
      const mat = waterMaterial(skyTexture, this.atmosphere, kind);
      this.shaders.push(mat);
      mesh.material = mat;
    }
    const forest = chunkForest(valley.forest, valley.root, this.atmosphere);
    this.forestMaterials.push(...forest.materials);
    this.treeCount = forest.count;

    // Everything else in the valley: the same light and air.
    valley.root.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh || m === terrain || m === valley.river || m === valley.reservoir || m.userData["forest"]) return;
      m.castShadow = false;
      m.receiveShadow = false;
      patchAll(m, this.atmosphere, true);
    });

    // A round stops at the buildings and the water; the ground is the heightfield's.
    const moving: Mesh[] = [];
    const bellMesh = valley.secrets.bell ? findMesh(valley.secrets.bell) : null;
    if (bellMesh) moving.push(bellMesh);
    const solids = [...valley.solids.filter((m) => !moving.includes(m)), ...valley.water];
    this.queries = new SceneryQueries(solids, moving);

    scene.add(this.dynamic, this.fxRoot);
  }

  /** The sun's elevation after `seconds` of the run: it climbs slowly, and the shadow line creeps down the far slope. */
  sunElevation(seconds: number): number {
    return this.sunStart + ((SUN_CLIMB * Math.PI) / 180) * Math.min(1, seconds / SUN_CLIMB_TIME);
  }

  /** Once a frame: the clock, the sun, the wind in the mist and the trees, how thick the mist lies. */
  update(dt: number, time: number, runSeconds: number, windX: number, mist: number): void {
    const a = this.atmosphere;
    a.uTime.value = time;
    const el = this.sunElevation(runSeconds);
    a.uSunElev.value = el;
    const flat = Math.hypot(this.toSun.x, this.toSun.z) || 1;
    a.uSunDir.value.set((this.toSun.x / flat) * Math.cos(el), Math.sin(el), (this.toSun.z / flat) * Math.cos(el));
    this.sun.position.copy(a.uSunDir.value).multiplyScalar(500);
    // The mist drifts with the wind, and lies thinner as the morning burns it off.
    this.windDrift.x += windX * dt * 0.0012;
    this.windDrift.y += 0.00025 * dt;
    a.uWindDrift.value.copy(this.windDrift);
    a.uMistDensity.value = 0.0006 + 0.0016 * mist;
    for (const m of this.forestMaterials) (m.uniforms["uSway"]!.value as Vector2).set(windX * 0.035, 0);
  }

  setQuality(_q: Quality): void {}

  dispose(): void {
    this.sky.dispose();
    this.lightMap.dispose();
    for (const m of this.shaders) m.dispose();
    for (const m of this.forestMaterials) m.dispose();
    disposeTree(this.scene);
  }
}

function findMesh(o: import("three").Object3D): Mesh | null {
  let found: Mesh | null = null;
  o.traverse((c) => {
    if (!found && (c as Mesh).isMesh) found = c as Mesh;
  });
  return found;
}

/** Every material on a mesh patched to the valley's light and air. */
function patchAll(mesh: Mesh, atmosphere: AtmosphereUniforms, sunFromMap: boolean): void {
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (const m of mats as Material[]) {
    if ((m as { isShaderMaterial?: boolean }).isShaderMaterial) continue;
    if (m.userData["ridgePatched"]) continue;
    m.userData["ridgePatched"] = true;
    patchStandard(m, atmosphere, sunFromMap);
  }
}

export { patchAll };
export type { Color };
