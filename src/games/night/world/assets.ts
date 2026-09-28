import { Color, Mesh, NoColorSpace, SRGBColorSpace, Vector3, type Group, type Material, type MeshBasicMaterial, type Texture } from "three";
import type { GameContext, LoadedAsset } from "../../../engine/types";
import { Art, type ArtFile } from "../../../engine/world/art";
import { findNode } from "../../../engine/world/names";
import { asSky, horizonColour } from "../../../engine/world/sky";
import { readRoad, type RoadLayout } from "./road";

/**
 * Where Dead of Night's art lives. Every file is required: in production
 * one that does not load fails the game's load (a DownloadError, which the
 * page shows as "Couldn’t Load the Game" with Try Again). In development and
 * tests a missing file is stood in for by a placeholder built in code to
 * the same contract (see placeholders()). The loading itself is the
 * engine's (engine/world/art.ts).
 */
export const ASSET_PATHS = {
  road: "assets/night/road.glb",
  sky: "assets/night/sky.webp",
  walker: "assets/night/walker.glb",
  mechanic: "assets/night/mechanic.glb",
  survivor: "assets/night/survivor.glb",
  cat: "assets/night/cat.glb",
} as const;

export type AssetName = keyof typeof ASSET_PATHS;

/** Each file's share of the loading bar, roughly its size. */
const FILES: Record<AssetName, ArtFile> = {
  road: { path: ASSET_PATHS.road, kind: "gltf", weight: 0.6 },
  sky: { path: ASSET_PATHS.sky, kind: "texture", weight: 0.08 },
  walker: { path: ASSET_PATHS.walker, kind: "gltf", weight: 0.14 },
  mechanic: { path: ASSET_PATHS.mechanic, kind: "gltf", weight: 0.08 },
  survivor: { path: ASSET_PATHS.survivor, kind: "gltf", weight: 0.07 },
  cat: { path: ASSET_PATHS.cat, kind: "gltf", weight: 0.03 },
};

export interface NightAssets {
  road: RoadLayout;
  sky: Texture;
  fog: Color;
  walker: LoadedAsset;
  mechanic: LoadedAsset;
  survivor: LoadedAsset;
  cat: LoadedAsset;
  /**
   * Textures the road's materials name in their extras (`albedo`, `flicker`:
   * files beside road.glb), by file name, loaded with it.
   */
  maps: Map<string, Texture>;
  /** Which assets came from files (the rest are placeholders; never in production). */
  real: Record<AssetName, boolean>;
}

/** The procedural stand-ins for the art (src/games/night/placeholder/). */
export type Placeholders = typeof import("../placeholder/index");

/**
 * The stand-ins, outside production only: in a production build this is
 * `null` and the import is removed along with the branch that makes it.
 */
export function placeholders(): Promise<Placeholders> | null {
  return import.meta.env.MODE !== "production" ? import("../placeholder/index") : null;
}

/** Texture files a baked material names in its extras (a WebP beside the GLB). */
export function namedMaps(root: Group): string[] {
  const names = new Set<string>();
  const add = (v: unknown) => {
    if (typeof v === "string" && /\.(webp|png|jpe?g)$/i.test(v)) names.add(v);
  };
  root.traverse((o) => {
    const m = (o as Mesh).material;
    if (!m) return;
    for (const mat of (Array.isArray(m) ? m : [m]) as Material[]) {
      add(mat.userData["albedo"]);
      add(mat.userData["flicker"]);
    }
    add(o.userData["albedo"]);
    add(o.userData["flicker"]);
  });
  add(root.userData["flicker"]);
  return [...names];
}

export async function loadAssets(
  ctx: GameContext,
  onProgress: (fraction: number) => void,
  /** A folder holding road.glb, sky.webp and the characters, instead of public/assets/night/. */
  base: string | null = null,
  /** The stand-ins for missing files (by default placeholders()); never any in production. */
  standIns?: Placeholders | null,
): Promise<NightAssets> {
  // Settled at build time in production, so every stand-in path below goes with it.
  const kit = import.meta.env.MODE === "production" ? null : standIns === undefined ? await placeholders() : standIns;
  const art = new Art(ctx, FILES, { label: "Dead of Night", base, root: "assets/night/", standIns: kit !== null }, onProgress);
  await art.probe();
  const model = (name: "road" | "walker" | "mechanic" | "survivor" | "cat") => art.gltf(name, kit ? () => kit.standIn(name) : null);
  const [roadAsset, walker, mechanic, survivor, cat] = await Promise.all([model("road"), model("walker"), model("mechanic"), model("survivor"), model("cat")]);
  const road = readRoad(roadAsset.scene as Group);

  // The baked road's second layer (its albedo, for the flashlight) and the
  // streetlight's mask, where the export keeps them beside the GLB.
  const maps = new Map<string, Texture>();
  const folder = art.url("road").replace(/[^/]*$/, "");
  await Promise.all(
    namedMaps(road.root).map(async (name) => {
      const t = await ctx.assets.texture(`${folder}${name}`);
      t.colorSpace = /flicker/i.test(name) ? NoColorSpace : SRGBColorSpace;
      t.flipY = false;
      maps.set(name, t);
    }),
  );

  // A low-tier GPU gets the road's atlases at half size: they unpack to
  // half a gigabyte, and the night hides the difference past the barricade.
  if (ctx.quality?.tier === "low") halveRoadTextures(road.root, maps);

  // The sky, and the haze to match it: a placeholder's comes with it, a real one is sampled.
  const placeholder: { fog?: Color } = {};
  const disc = findNode(road.root, "moon.disc");
  const toMoon = disc ? disc.getWorldPosition(new Vector3()).sub(road.eye).normalize() : road.moonDirection.clone().negate();
  const sky = await art.texture(
    "sky",
    kit
      ? () => {
          const built = kit.buildSky(toMoon);
          placeholder.fog = built.fog;
          return built.texture;
        }
      : null,
  );
  let fog: Color | null = placeholder.fog ?? horizonColour(asSky(sky));
  // The road may carry its own fog colour in the scene's extras, to match the bake.
  const fogExtra = roadAsset.scene.userData["fog_color"];
  if (typeof fogExtra === "string") fog = new Color(fogExtra);
  art.finish("sky");

  return { road, sky, fog: fog ?? new Color("#343e4b"), walker, mechanic, survivor, cat, maps, real: art.real };
}

/** The road's big textures (its lit maps and the layers beside them), redrawn at half their size. */
function halveRoadTextures(root: Group, maps: ReadonlyMap<string, Texture>): void {
  const textures = new Set<Texture>(maps.values());
  root.traverse((o) => {
    const m = (o as Mesh).material;
    for (const mat of (Array.isArray(m) ? m : m ? [m] : []) as MeshBasicMaterial[]) if (mat.map) textures.add(mat.map);
  });
  // Textures may share one picture: halve each picture once.
  const halved = new Map<unknown, HTMLCanvasElement>();
  for (const t of textures) {
    const image = t.image as { width?: number; height?: number; close?: () => void } | null;
    const w = image?.width ?? 0;
    const h = image?.height ?? 0;
    if (!image || (w < 2048 && h < 2048)) continue;
    let canvas = halved.get(image);
    if (!canvas) {
      canvas = document.createElement("canvas");
      canvas.width = Math.max(1, w >> 1);
      canvas.height = Math.max(1, h >> 1);
      const g = canvas.getContext("2d");
      if (!g) continue;
      g.drawImage(image as CanvasImageSource, 0, 0, canvas.width, canvas.height);
      halved.set(image, canvas);
    }
    t.image = canvas;
    t.needsUpdate = true;
  }
  // The full-size pictures are no longer needed.
  for (const image of halved.keys()) (image as { close?: () => void }).close?.();
}
