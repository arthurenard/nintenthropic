/**
 * Where Orbital Decay's art lives, and loading it. Every file is required:
 * in production one that does not load fails the game's load (a
 * DownloadError, which the page shows as "Couldn’t Load the Game" with Try
 * Again). In development and tests a missing file is stood in for by a
 * placeholder built in code to the same contract (see placeholders()). The
 * loading itself is the engine's (engine/world/art.ts).
 */
import { ClampToEdgeWrapping, LinearFilter, LinearMipmapLinearFilter, NoColorSpace, RepeatWrapping, SRGBColorSpace, type Group, type Texture } from "three";
import type { GameContext, LoadedAsset } from "../../../engine/types";
import { Art, type ArtFile } from "../../../engine/world/art";

export const ASSET_PATHS = {
  cupola: "assets/orbit/cupola.glb",
  station: "assets/orbit/station.glb",
  albedo: "assets/orbit/planet/albedo.webp",
  clouds: "assets/orbit/planet/clouds.webp",
  night: "assets/orbit/planet/night.webp",
  water: "assets/orbit/planet/water.webp",
  stars: "assets/orbit/stars.webp",
  debris: "assets/orbit/debris.glb",
  drone: "assets/orbit/drone.glb",
  derelict: "assets/orbit/derelict.glb",
  extras: "assets/orbit/extras.glb",
} as const;

export type AssetName = keyof typeof ASSET_PATHS;

/** Each file's share of the loading bar, roughly its size. */
const FILES: Record<AssetName, ArtFile> = {
  cupola: { path: ASSET_PATHS.cupola, kind: "gltf", weight: 0.2 },
  station: { path: ASSET_PATHS.station, kind: "gltf", weight: 0.3 },
  albedo: { path: ASSET_PATHS.albedo, kind: "texture", weight: 0.06 },
  clouds: { path: ASSET_PATHS.clouds, kind: "texture", weight: 0.1 },
  night: { path: ASSET_PATHS.night, kind: "texture", weight: 0.05 },
  water: { path: ASSET_PATHS.water, kind: "texture", weight: 0.04 },
  stars: { path: ASSET_PATHS.stars, kind: "texture", weight: 0.03 },
  debris: { path: ASSET_PATHS.debris, kind: "gltf", weight: 0.08 },
  drone: { path: ASSET_PATHS.drone, kind: "gltf", weight: 0.04 },
  derelict: { path: ASSET_PATHS.derelict, kind: "gltf", weight: 0.05 },
  extras: { path: ASSET_PATHS.extras, kind: "gltf", weight: 0.04 },
};

export interface OrbitAssets {
  cupola: Group;
  station: Group;
  maps: { albedo: Texture; clouds: Texture; night: Texture; water: Texture; stars: Texture };
  debris: Group;
  drone: Group;
  derelict: Group;
  extras: Group;
  /** Which assets came from files (the rest are placeholders; never in production). */
  real: Record<AssetName, boolean>;
}

/** The procedural stand-ins for the art (src/games/orbit/placeholder/). */
export type Placeholders = typeof import("../placeholder/index");

/**
 * The stand-ins, outside production only: in a production build this is
 * `null` and the import is removed along with the branch that makes it.
 */
export function placeholders(): Promise<Placeholders> | null {
  return import.meta.env.MODE !== "production" ? import("../placeholder/index") : null;
}

/** A map read as data (a mask, a coverage), not a colour. */
function asData(t: Texture): Texture {
  if (t.colorSpace === SRGBColorSpace && !(t as { isRenderTargetTexture?: boolean }).isRenderTargetTexture) t.colorSpace = NoColorSpace;
  return t;
}

/** Wrapped round the planet in longitude, mipmapped for its foreshortened limb. */
function asMap(t: Texture, anisotropy: number): Texture {
  t.wrapS = RepeatWrapping;
  t.wrapT = ClampToEdgeWrapping;
  t.minFilter = LinearMipmapLinearFilter;
  t.magFilter = LinearFilter;
  t.anisotropy = anisotropy;
  return t;
}

export async function loadAssets(
  ctx: GameContext,
  onProgress: (fraction: number) => void,
  /** A folder holding the files, instead of public/assets/orbit/. */
  base: string | null = null,
  /** The stand-ins for missing files (by default placeholders()); never any in production. */
  standIns?: Placeholders | null,
): Promise<OrbitAssets> {
  const kit = import.meta.env.MODE === "production" ? null : standIns === undefined ? await placeholders() : standIns;
  const art = new Art(ctx, FILES, { label: "Orbital Decay", base, root: "assets/orbit/", standIns: kit !== null }, onProgress);
  await art.probe();
  const model = (name: "cupola" | "station" | "debris" | "drone" | "derelict" | "extras"): Promise<LoadedAsset> => art.gltf(name, kit ? () => kit.standIn(name) : null);
  const renderer = ctx.renderer;
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const map = async (name: "albedo" | "clouds" | "night" | "water" | "stars", data: boolean): Promise<Texture> => {
    // Made on the GPU: one at a time, between the downloads, not all in one frame.
    const t = await art.texture(name, kit ? () => kit.standInMap(renderer, name) : null);
    return asMap(data ? asData(t) : t, aniso);
  };
  const [cupola, station, debris, drone, derelict, extras] = await Promise.all([model("cupola"), model("station"), model("debris"), model("drone"), model("derelict"), model("extras")]);
  const albedo = await map("albedo", false);
  const clouds = await map("clouds", true);
  const night = await map("night", false);
  const water = await map("water", true);
  const stars = await map("stars", false);
  return {
    cupola: cupola.scene,
    station: station.scene,
    maps: { albedo, clouds, night, water, stars },
    debris: debris.scene,
    drone: drone.scene,
    derelict: derelict.scene,
    extras: extras.scene,
    real: art.real,
  };
}
