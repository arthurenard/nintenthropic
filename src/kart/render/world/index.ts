/**
 * Builds a track's whole world from its definition: ground, road, verge,
 * barriers, scenery, landmarks, hazards, sky, water and light, and keeps the
 * few parts that move (boost pads, the item boxes, the start lights, sails,
 * lava, water, every hazard).
 *
 * Built once per track, in steps that each hand control back to the browser,
 * so the page can show real progress and stay responsive.
 */
import {
  AdditiveBlending,
  DirectionalLight,
  DoubleSide,
  Fog,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  Points,
  RepeatWrapping,
  SphereGeometry,
  type BufferGeometry,
  type CanvasTexture,
  type Material,
  type Object3D,
  type Scene,
  Color,
} from "three";
import { TrackGeometry, type TrackDef } from "../../track/geometry";
import { makePoints } from "../points";
import type { QualitySettings } from "../quality";
import { Bank } from "./bank";
import { buildBackdrop } from "./backdrop";
import { ItemBoxes } from "./boxes";
import { rampHeight, type Features } from "./features";
import { buildHazards, buildLandmarks, landmarkMaterials, type HazardLayer, type LandmarkLayer, type PlacedLandmark } from "./landmarks/place";
import { additiveMaterial, groundMaterial, lavaMaterial, patchMaterial, roadMaterial, type Animated } from "./materials";
import { buildScenery, type Scenery } from "./scenery";
import { createSky, type Sky } from "./sky";
import { Terrain } from "./terrain";
import { styleFor, type ThemeStyle } from "./themes";
import { bannerTexture, chevronTexture, glowTexture } from "./textures";
import { buildTrackMeshes } from "./track";
import { createWater, type Water } from "./water";

/** Hands control back to the browser for a moment, so a long build does not freeze the page. */
const breathe = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export interface World {
  readonly group: Group;
  readonly geometry: TrackGeometry;
  readonly style: ThemeStyle;
  readonly terrain: Terrain;
  readonly sky: Sky;
  readonly boxes: ItemBoxes;
  readonly bank: Bank;
  readonly features: Features;
  /** How the start lights stand: how many reds are lit (0-3), or green. */
  setStartLights(state: number | "go" | "off"): void;
  /** `time` is the picture's clock; `raceTime` the race's (the hazards move on it, as in the sim). */
  update(time: number, dt: number, raceTime?: number): void;
  /** Puts the scene's fog, lights and background in place. */
  install(scene: Scene): void;
  /**
   * How far above the sim's flat road the surface is at a point: the road's
   * banking plus any ramp before its lip. Karts, boxes and things add it to
   * their y. `near` is the s it was at a moment ago (a hint for the search).
   */
  surfaceLift(x: number, z: number, near?: number): { lift: number; ramp: number; s: number; offset: number };
  dispose(): void;
}

export async function createWorld(
  def: TrackDef,
  quality: QualitySettings,
  onProgress: (fraction: number) => void = () => {},
  theme?: ThemeStyle,
): Promise<World> {
  const style = theme ?? styleFor(def.theme);
  const group = new Group();
  const disposables: { dispose(): void }[] = [];
  const track = <T extends { dispose(): void }>(d: T): T => {
    disposables.push(d);
    return d;
  };

  onProgress(0.02);
  await breathe();
  const geometry = TrackGeometry.build(def);

  onProgress(0.08);
  await breathe();
  const terrain = Terrain.build(geometry, style, quality.cell);
  const space = style.id === "space";

  const ground = groundMaterial(style, quality, disposables);
  const roadMat = roadMaterial(style, quality, disposables);
  const deco = track(new MeshLambertMaterial({ vertexColors: true })) as Material;
  let lavaAnim: Animated | null = null;

  const addStatic = (g: BufferGeometry, material: Material, order = 0): Mesh => {
    track(g);
    const m = new Mesh(g, material);
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    m.renderOrder = order;
    group.add(m);
    return m;
  };

  // Ground tiles (space has none: the road floats in the dark).
  if (!space) {
    for (const g of terrain.buildTiles(20, ground.detail?.metres ?? 64)) addStatic(g, ground.material);
    const lavaTiles = terrain.buildLava(20);
    if (lavaTiles.length) {
      lavaAnim = lavaMaterial(disposables);
      for (const g of lavaTiles) addStatic(g, lavaAnim.material, 1);
    }
  }
  onProgress(0.38);
  await breathe();

  // The track.
  const bank = new Bank(geometry);
  const meshes = buildTrackMeshes(geometry, style, terrain, quality);
  for (const g of meshes.road) addStatic(g, roadMat, space ? 1 : 0);
  for (const g of meshes.deco) addStatic(g, deco);
  if (meshes.pools) {
    const mat = track(new MeshBasicMaterial({ vertexColors: true, blending: AdditiveBlending, transparent: true, depthWrite: false, fog: false })) as Material;
    addStatic(meshes.pools, mat, 3);
  }
  if (meshes.additive) addStatic(meshes.additive, additiveMaterial(disposables), 3);
  for (const p of meshes.patches) addStatic(p.geometry, patchMaterial(p.kind, quality, disposables), 2);
  const chevrons = track(chevronTexture(quality.anisotropy)) as CanvasTexture;
  chevrons.wrapT = RepeatWrapping;
  if (meshes.pads) {
    const padMat = track(new MeshBasicMaterial({ map: chevrons, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })) as Material;
    addStatic(meshes.pads, padMat, 1);
  }

  // The gantry's banner and the start lights.
  const banner = track(bannerTexture(quality.anisotropy)) as CanvasTexture;
  const bannerGeo = track(new PlaneGeometry(meshes.banner.width, meshes.banner.height)) as PlaneGeometry;
  const bannerMat = track(new MeshBasicMaterial({ map: banner, side: DoubleSide, color: style.night ? new Color(0.78, 0.82, 0.95) : new Color(1, 1, 1) })) as Material;
  const bannerMesh = new Mesh(bannerGeo, bannerMat);
  bannerMesh.position.set(meshes.banner.x, meshes.banner.y, meshes.banner.z);
  bannerMesh.rotation.y = meshes.banner.yaw;
  group.add(bannerMesh);

  const bulbGeo = track(new SphereGeometry(0.42, 16, 10)) as SphereGeometry;
  const bulbMats = meshes.startLights.map(() => track(new MeshBasicMaterial({ color: new Color(0.06, 0.03, 0.03) })) as MeshBasicMaterial);
  meshes.startLights.forEach((p, i) => {
    const b = new Mesh(bulbGeo, bulbMats[i]!);
    b.position.set(p[0], p[1], p[2]);
    group.add(b);
  });

  // Landmarks, the rubber duck and the hazards.
  onProgress(0.5);
  await breathe();
  const mats = landmarkMaterials();
  track(mats);
  const groundAt = (x: number, z: number) => terrain.heightAt(x, z);
  const env = { track: geometry, style, bank, groundAt };
  const placed: PlacedLandmark[] = [...(def.landmarks ?? [])];
  if (def.duck) placed.push({ kind: "rubber-duck", at: def.duck.at, offset: def.duck.offset, lift: def.duck.y ?? 0 });
  const landmarks: LandmarkLayer = buildLandmarks(env, placed, mats);
  track(landmarks);
  group.add(landmarks.group);
  const shadowTex = track(glowTexture(0, 1.0));
  const hazards: HazardLayer = buildHazards(env, def.hazards ?? [], mats, shadowTex);
  track(hazards);
  group.add(hazards.group);

  // Glows: lamps (static) and the three start lights (changing).
  const staticGlows = meshes.glows;
  const glowPoints: Points = makePoints(staticGlows.length + meshes.startLights.length, true);
  track({
    dispose() {
      glowPoints.geometry.dispose();
      (glowPoints.material as Material).dispose();
    },
  });
  {
    const pos = glowPoints.geometry.getAttribute("position");
    const col = glowPoints.geometry.getAttribute("aColour");
    const size = glowPoints.geometry.getAttribute("aSize");
    staticGlows.forEach((g, i) => {
      pos.setXYZ(i, g.x, g.y, g.z);
      col.setXYZW(i, g.colour[0], g.colour[1], g.colour[2], g.alpha);
      size.setX(i, g.size);
    });
    meshes.startLights.forEach((p, k) => {
      const i = staticGlows.length + k;
      pos.setXYZ(i, p[0], p[1], p[2]);
      col.setXYZW(i, 0, 0, 0, 0);
      size.setX(i, 3.0);
    });
    pos.needsUpdate = true;
    col.needsUpdate = true;
    size.needsUpdate = true;
  }
  group.add(glowPoints);
  const glowColour = glowPoints.geometry.getAttribute("aColour");
  const setStartLights = (state: number | "go" | "off") => {
    meshes.startLights.forEach((_p, k) => {
      const mat = bulbMats[k]!;
      const i = staticGlows.length + k;
      if (state === "go") {
        mat.color.setRGB(0.25, 2.6, 0.7);
        glowColour.setXYZW(i, 0.2, 1.0, 0.45, 0.95);
      } else if (state !== "off" && k < state) {
        mat.color.setRGB(3.0, 0.22, 0.16);
        glowColour.setXYZW(i, 1.0, 0.14, 0.1, 0.95);
      } else {
        mat.color.setRGB(0.07, 0.04, 0.04);
        glowColour.setXYZW(i, 0, 0, 0, 0);
      }
    });
    glowColour.needsUpdate = true;
  };
  setStartLights("off");

  onProgress(0.62);
  await breathe();

  // Scenery, kept clear of the landmarks.
  const scenery: Scenery = buildScenery(style, terrain, quality, deco, 1234, landmarks.keepOut);
  track(scenery);
  group.add(scenery.group);
  onProgress(0.86);
  await breathe();

  // Sky, water, backdrop, light.
  const sky = createSky(style);
  track(sky);
  group.add(sky.group);

  let water: Water | null = null;
  if (style.id === "harbour") {
    const cx = (terrain.minX + terrain.maxX) / 2;
    const cz = (terrain.minZ + terrain.maxZ) / 2;
    water = createWater(style, { x: cx, z: cz });
    track(water);
    group.add(water.mesh);
  }
  const backdrop = buildBackdrop(style, terrain, disposables);
  if (backdrop) group.add(backdrop.group);

  const boxes = new ItemBoxes();
  track(boxes);
  group.add(boxes.group);

  const hemi = new HemisphereLight(style.light.skyColour, style.light.groundColour, style.light.hemiIntensity);
  const sun = new DirectionalLight(style.light.sunColour, style.light.sunIntensity);
  sun.position.copy(sky.sunDir).multiplyScalar(200);
  group.add(hemi, sun, sun.target);
  const fog = new Fog(style.fog.colour, style.fog.near, style.fog.far);

  onProgress(1);
  let near = 0;

  return {
    group,
    geometry,
    style,
    terrain,
    sky,
    boxes,
    bank,
    features: meshes.features,
    setStartLights,
    update(time, dt, raceTime = 0) {
      chevrons.offset.y = -(time * 1.3) % 1;
      scenery.update(time);
      water?.update(time);
      lavaAnim?.update(time);
      sky.update(time);
      backdrop?.update(time);
      landmarks.update(time);
      hazards.update(raceTime, dt);
    },
    install(scene) {
      scene.fog = fog;
    },
    surfaceLift(x, z, hint) {
      let proj = geometry.project(x, z, hint ?? near);
      if (Math.hypot(proj.sample.x - x, proj.sample.z - z) > 40) proj = geometry.project(x, z);
      near = proj.s;
      const ramp = Math.abs(proj.offset) < proj.sample.width / 2 ? rampHeight(meshes.features.ramps, proj.s, geometry.length) : 0;
      return { lift: bank.lift(proj.s, proj.offset) + ramp, ramp, s: proj.s, offset: proj.offset };
    },
    dispose() {
      for (const d of disposables) d.dispose();
      group.traverse((o: Object3D) => {
        const m = o as Mesh;
        if (m.isMesh && m.geometry) m.geometry.dispose();
      });
      group.removeFromParent();
    },
  };
}
