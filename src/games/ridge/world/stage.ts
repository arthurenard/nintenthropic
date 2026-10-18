/**
 * The scene Overwatch Ridge draws: the dawn sky behind everything and, through
 * PMREM, lighting everything that is not the ground; the valley's terrain,
 * water and forest in their own shaders; the buildings and people in
 * standard materials patched to the same light and air (atmosphere.ts); a
 * low warm sun whose reach the light map decides; and the groups the game
 * fills with people, vehicles and effects.
 */
import { Color, DirectionalLight, Group, Mesh, Scene, Vector2, Vector3, type Material, type Object3D, type ShaderMaterial, type Texture, type WebGLRenderer } from "three";
import { SceneryQueries } from "../../../engine/world/queries";
import { disposeTree } from "../../../engine/world/scene";
import { SkyLight } from "../../../engine/world/sky";
import { atmosphereUniforms, horizonRing, patchStandard, type AtmosphereUniforms } from "./atmosphere";
import { chunkForest } from "./forest";
import { Heightfield } from "./heightfield";
import { buildLightMap, type LightMap } from "./lightmap";
import { terrainMaterial } from "./terrain";
import { terrainArtMaterial, type TerrainArtInputs } from "./terrainArt";
import type { ValleyLayout } from "./valley";
import { mistMaterial, waterMaterial } from "./water";

/** How much brighter the real valley is lit than the placeholder (its albedos are real ones). */
const ART_LIGHT = 2.9;
/** The art's air colours (at its review renders' exposure) in the game's light. */
const ART_AIR = 0.32;

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
  readonly lightMap: LightMap | null;
  /** The sun's bearing, flat and unit. */
  readonly sunFlat = new Vector2();
  private readonly artHorizon: HorizonCopy | null = null;
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
  /** The mist's density at its thickest, per metre (the art's, or the placeholder's). */
  private mistBase = 0.0022;

  constructor(
    renderer: WebGLRenderer,
    readonly valley: ValleyLayout,
    skyTexture: Texture,
    terrainArt: TerrainArtInputs | null = null,
  ) {
    const scene = this.scene;
    const art = valley.light;
    // The real valley's materials are true albedos (a meadow is a twentieth of white), lit as the
    // art was rendered: brighter than the placeholder's painted ones need, and the sky's
    // share of it set by the art's sun-to-sky ratio. The sky behind it all stays as it is.
    const lift = art ? ART_LIGHT : 1;
    this.sky = new SkyLight(renderer, scene, skyTexture, 0.5 * lift);
    this.atmosphere = atmosphereUniforms();
    if (art) {
      const a = this.atmosphere;
      const sun = new Color(...art.sunColor);
      const skyLum = 0.2126 * a.uSkyUp.value.r + 0.7152 * a.uSkyUp.value.g + 0.0722 * a.uSkyUp.value.b;
      const sunLum = 0.2126 * sun.r + 0.7152 * sun.g + 0.0722 * sun.b;
      a.uSunColor.value.copy(sun).multiplyScalar(((art.sunToSky * skyLum) / Math.max(1e-3, sunLum)) * lift);
      a.uSkyUp.value.multiplyScalar(lift);
      a.uSkyLow.value.multiplyScalar(lift);
      a.uBounce.value.multiplyScalar(lift);
      a.uHazeDensity.value = art.hazeSigma;
      a.uHazeBlue.value.setRGB(...art.hazeColor).multiplyScalar(ART_AIR);
      a.uMistColor.value.setRGB(...art.mistColor).multiplyScalar(ART_AIR);
      a.uMistBase.value = art.mistBase;
      a.uMistFalloff.value = 1 / art.mistScaleHeight;
      this.mistBase = art.mistSigma;
    }
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
    this.sunFlat.copy(flatSun.normalize());
    if (terrainArt) {
      // The art's light map knows the ridge behind the eye (the terrain mesh stops at the eye):
      // every shader reads it, and the people's sun is looked up in a small copy of it.
      const m = terrainArt.spec.mapping;
      this.atmosphere.uArtLight.value = terrainArt.light;
      this.atmosphere.uArtMap.value.set(m.theta0, m.theta1, m.r0, m.r1);
      this.atmosphere.uUseArtLight.value = 1;
      this.artHorizon = horizonCopy(terrainArt.light.image as CanvasImageSource, m);
      this.lightMap = null;
    } else {
      this.lightMap = buildLightMap(renderer, this.heightfield.coarse, this.sunFlat);
      this.atmosphere.uLight.value = this.lightMap.texture;
      this.atmosphere.uLightBounds.value.copy(this.lightMap.bounds);
    }

    scene.add(valley.root);
    // The ground's shader: the real valley's maps and tiles, or the placeholder's splat.
    const groundMaterial = terrainArt ? terrainArtMaterial(terrainArt, this.atmosphere) : valley.terrainInputs ? terrainMaterial(valley.terrainInputs, this.atmosphere) : null;
    if (groundMaterial) this.shaders.push(groundMaterial);
    for (const chunk of valley.terrainMeshes) {
      if (!groundMaterial) {
        patchAll(chunk, this.atmosphere, true);
        continue;
      }
      const old = chunk.material;
      chunk.material = groundMaterial;
      // (The colour map stays alive: the art shader samples it.)
      if (!terrainArt) (Array.isArray(old) ? old : [old]).forEach((m) => m.dispose());
    }
    // The mist lying on the river, drifting.
    for (const ribbon of valley.mist) {
      const mat = mistMaterial(this.atmosphere);
      this.shaders.push(mat);
      ribbon.material = mat;
      ribbon.renderOrder = 3;
    }
    for (const [mesh, kind] of [
      [valley.river, "river"],
      [valley.reservoir, "reservoir"],
    ] as const) {
      if (!mesh) continue;
      const mat = waterMaterial(skyTexture, this.atmosphere, kind, mesh.geometry.getAttribute("color") !== undefined);
      this.shaders.push(mat);
      mesh.material = mat;
    }
    // The placeholder's trees get the forest shader, chunked; the real forest is
    // impostor cards (art/ridge/README.md), lit as standard materials in the valley's air.
    const impostors = valley.forest.length > 0 && valley.forest.every((f) => (f.material as { map?: unknown }).map);
    if (impostors) {
      let count = 0;
      for (const f of valley.forest) {
        f.userData["forest"] = true;
        f.frustumCulled = true;
        f.computeBoundingSphere();
        patchAll(f, this.atmosphere, true);
        count += f.count;
      }
      this.treeCount = count;
    } else {
      const forest = chunkForest(valley.forest, valley.root, this.atmosphere);
      this.forestMaterials.push(...forest.materials);
      this.treeCount = forest.count;
    }

    // A baked AO map that reads black would leave a building unlit in the shade: skip it (and say so).
    const checked = new Map<unknown, boolean>();
    valley.root.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh) return;
      for (const mat of (Array.isArray(m.material) ? m.material : [m.material]) as (Material & { aoMap?: Texture | null })[]) {
        const ao = mat.aoMap;
        if (!ao) continue;
        let black = checked.get(ao);
        if (black === undefined) {
          black = aoIsBlack(ao);
          checked.set(ao, black);
          if (black) console.warn(`Overwatch Ridge: ${mat.name}'s AO map is black in its red channel; lit without it.`);
        }
        if (black) {
          mat.aoMap = null;
          mat.needsUpdate = true;
        }
      }
    });

    // Everything else in the valley: the same light and air.
    valley.root.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh || valley.terrainMeshes.includes(m) || m === valley.river || m === valley.reservoir || valley.mist.includes(m) || m.userData["forest"]) return;
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

  /**
   * How high the ground stands toward the sun from a point (radians above
   * level): the sun reaches the point when it is higher than this.
   */
  horizonAt(x: number, y: number, z: number): number {
    const h = this.artHorizon;
    if (h) {
      const theta = Math.atan2(x, -z);
      const r = Math.min(h.map.r1, Math.max(h.map.r0, Math.hypot(x, z)));
      const u = Math.min(0.9995, Math.max(0.0005, (theta - h.map.theta0) / (h.map.theta1 - h.map.theta0)));
      const v = 1 - Math.log(r / h.map.r0) / Math.log(h.map.r1 / h.map.r0);
      const px = Math.min(h.width - 1, Math.floor(u * h.width));
      const py = Math.min(h.height - 1, Math.max(0, Math.floor(v * h.height)));
      return (((h.data[(py * h.width + px) * 4 + 1] as number) / 255) * 40 - 10) * (Math.PI / 180);
    }
    return this.heightfield.horizon(x, y, z, this.sunFlat.x, this.sunFlat.y);
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
    a.uMistDensity.value = this.mistBase * (0.27 + 0.73 * mist);
    for (const m of this.forestMaterials) (m.uniforms["uSway"]!.value as Vector2).set(windX * 0.035, 0);
  }

  dispose(): void {
    this.sky.dispose();
    this.lightMap?.dispose();
    for (const m of this.shaders) m.dispose();
    for (const m of this.forestMaterials) m.dispose();
    disposeTree(this.scene);
  }
}

/** Whether an AO texture's red channel (the one glTF reads) is all but black, sampled small. */
function aoIsBlack(t: Texture): boolean {
  const image = t.image as CanvasImageSource | undefined;
  if (!image) return false;
  const canvas = document.createElement("canvas");
  canvas.width = 16;
  canvas.height = 16;
  const g = canvas.getContext("2d", { willReadFrequently: true });
  if (!g) return false;
  try {
    g.drawImage(image, 0, 0, 16, 16);
  } catch {
    return false;
  }
  const d = g.getImageData(0, 0, 16, 16).data;
  let sum = 0;
  for (let i = 0; i < d.length; i += 4) sum += d[i] as number;
  return sum / (d.length / 4) < 8;
}

interface HorizonCopy {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  map: { theta0: number; theta1: number; r0: number; r1: number };
}

/** A small copy of the art's light map in memory, for the sun's reach at a person (its green: the horizon). */
function horizonCopy(image: CanvasImageSource, map: HorizonCopy["map"]): HorizonCopy {
  const width = 256;
  const height = 512;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext("2d", { willReadFrequently: true })!;
  g.drawImage(image, 0, 0, width, height);
  return { data: g.getImageData(0, 0, width, height).data, width, height, map };
}

function findMesh(o: Object3D): Mesh | null {
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
