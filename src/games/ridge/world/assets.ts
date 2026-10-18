/**
 * Where Overwatch Ridge's art lives, and loading it. Every file is required:
 * in production one that does not load fails the game's load (the page's
 * "Couldn’t Load the Game" with Try Again). In development and tests a
 * missing file is stood in for by a placeholder built in code to the same
 * contract (src/games/ridge/placeholder/), which a production build drops
 * entirely. The loading itself is the engine's (engine/world/art.ts).
 */
import { NoColorSpace, Texture, type Group, type Mesh, type MeshStandardMaterial } from "three";
import { fetchBytes, siteUrl } from "../../../engine/fetch";
import type { GameContext, LoadedAsset } from "../../../engine/types";
import { Art, type ArtFile } from "../../../engine/world/art";
import { asSky } from "../../../engine/world/sky";
import { tileArray, type TerrainArtInputs } from "./terrainArt";
import { readValley, type TerrainArtSpec, type ValleyLayout } from "./valley";

export const ASSET_PATHS = {
  valley: "assets/ridge/valley.glb",
  sky: "assets/ridge/sky.webp",
  soldier: "assets/ridge/soldier.glb",
  civilian: "assets/ridge/civilian.glb",
  vehicles: "assets/ridge/vehicles.glb",
  animals: "assets/ridge/animals.glb",
} as const;

export type AssetName = keyof typeof ASSET_PATHS;

/** Each file's share of the loading bar, roughly its size. */
const FILES: Record<AssetName, ArtFile> = {
  valley: { path: ASSET_PATHS.valley, kind: "gltf", weight: 0.62 },
  sky: { path: ASSET_PATHS.sky, kind: "texture", weight: 0.06 },
  soldier: { path: ASSET_PATHS.soldier, kind: "gltf", weight: 0.1 },
  civilian: { path: ASSET_PATHS.civilian, kind: "gltf", weight: 0.08 },
  vehicles: { path: ASSET_PATHS.vehicles, kind: "gltf", weight: 0.08 },
  animals: { path: ASSET_PATHS.animals, kind: "gltf", weight: 0.06 },
};

export interface RidgeAssets {
  valley: ValleyLayout;
  /** The real valley's terrain maps and tiles (null on the placeholder, which paints its own). */
  terrainArt: TerrainArtInputs | null;
  sky: Texture;
  soldier: LoadedAsset;
  civilian: LoadedAsset;
  vehicles: LoadedAsset;
  animals: LoadedAsset;
  /** Which came from files (the rest are placeholders; never in production). */
  real: Record<AssetName, boolean>;
}

export type Placeholders = typeof import("../placeholder/index");

/** The stand-ins, outside production only: in a production build this is null and the import is gone. */
export function placeholders(): Promise<Placeholders> | null {
  return import.meta.env.MODE !== "production" ? import("../placeholder/index") : null;
}

export async function loadAssets(ctx: GameContext, onProgress: (fraction: number) => void, base: string | null = null): Promise<RidgeAssets> {
  const kit = import.meta.env.MODE === "production" ? null : await placeholders();
  const art = new Art(ctx, FILES, { label: "Overwatch Ridge", base, root: "assets/ridge/", standIns: kit !== null }, onProgress);
  await art.probe();
  const model = (name: "valley" | "soldier" | "civilian" | "vehicles" | "animals") => art.gltf(name, kit ? () => kit.standIn(name) : null);
  const [valleyAsset, soldier, civilian, vehicles, animals] = await Promise.all([model("valley"), model("soldier"), model("civilian"), model("vehicles"), model("animals")]);
  const sky = asSky(await art.texture("sky", kit ? () => kit.standInSky() : null));
  const valley = readValley(valleyAsset.scene as Group);
  const terrainArt = art.real.valley && valley.terrainArt ? await loadTerrainArt(art.url("valley"), valley.terrainArt, valley.terrainMeshes[0] ?? null) : null;
  return { valley, terrainArt, sky, soldier, civilian, vehicles, animals, real: art.real };
}

/**
 * The real terrain's maps (beside valley.glb, as `terrain.splat` names
 * them) and its eight tiles, stacked into three texture arrays. The macro
 * colour map is the one the glTF's own terrain material already loaded.
 */
async function loadTerrainArt(valleyUrl: string, spec: TerrainArtSpec, chunk: Mesh | null): Promise<TerrainArtInputs> {
  const dir = valleyUrl.slice(0, valleyUrl.lastIndexOf("/") + 1);
  // Data, not pictures: decoded exactly as stored - no premultiplying by alpha (a splat's
  // alpha is a weight, zero across most of the valley), no colour conversion - and, like
  // every glTF texture, not flipped (the UVs count rows from the top).
  const bitmap = async (key: string): Promise<ImageBitmap> => {
    const file = spec.files[key];
    if (!file) throw new Error(`Overwatch Ridge: terrain.splat names no "${key}"`);
    const bytes = await fetchBytes(siteUrl(`${dir}${file}`));
    return createImageBitmap(new Blob([bytes], { type: "image/webp" }), { premultiplyAlpha: "none", colorSpaceConversion: "none" });
  };
  const tex = async (key: string): Promise<Texture> => {
    const t = new Texture(await bitmap(key));
    t.flipY = false;
    t.colorSpace = NoColorSpace;
    t.needsUpdate = true;
    return t;
  };
  const own = (chunk?.material as MeshStandardMaterial | undefined)?.map ?? null;
  const images = (kind: string) => Promise.all(spec.tiles.map((t) => bitmap(`tile_${t.name}_${kind}`)));
  const [color, normal, splat0, splat1, light, albedo, normals, hra] = await Promise.all([
    own ? Promise.resolve(own) : tex("color"),
    tex("normal"),
    tex("splat0"),
    tex("splat1"),
    tex("light"),
    images("albedo"),
    images("normal"),
    images("hra"),
  ]);
  return { spec, color, normal, splat0, splat1, light, albedo: tileArray(albedo), normals: tileArray(normals), hra: tileArray(hra) };
}
