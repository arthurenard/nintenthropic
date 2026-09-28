import { Color, type Group, type Texture } from "three";
import type { GameContext, LoadedAsset } from "../../../engine/types";
import { Art, type ArtFile } from "../../../engine/world/art";
import { asSky, horizonColour } from "../../../engine/world/sky";
import { NOON_SUN } from "./stage";
import { readTown, type TownLayout } from "./town";

/**
 * Where High Noon's art lives. Every file is required: in production one
 * that does not load fails the game's load (a DownloadError, which the page
 * shows as "Couldn’t Load the Game" with Try Again). In development and
 * tests a missing file is stood in for by a placeholder built in code to the
 * same node names, extras, bones and clips (see placeholders()). The loading
 * itself is the engine's (engine/world/art.ts).
 */
export const ASSET_PATHS = {
  town: "assets/western/town.glb",
  sky: "assets/western/sky.webp",
  /** The sky at noon, for High Noon for real. */
  skyNoon: "assets/western/sky_noon.webp",
  bandit: "assets/western/bandit.glb",
  boss: "assets/western/boss.glb",
  townsfolk: "assets/western/townsfolk.glb",
  chicken: "assets/western/chicken.glb",
} as const;

export type AssetName = keyof typeof ASSET_PATHS;

/** Each file's share of the loading bar (the noon sky, when it is used, stands in the golden one's place). */
const FILES: Record<AssetName, ArtFile> = {
  town: { path: ASSET_PATHS.town, kind: "gltf", weight: 0.55 },
  sky: { path: ASSET_PATHS.sky, kind: "texture", weight: 0.1 },
  skyNoon: { path: ASSET_PATHS.skyNoon, kind: "texture", weight: 0 },
  bandit: { path: ASSET_PATHS.bandit, kind: "gltf", weight: 0.1 },
  boss: { path: ASSET_PATHS.boss, kind: "gltf", weight: 0.08 },
  townsfolk: { path: ASSET_PATHS.townsfolk, kind: "gltf", weight: 0.1 },
  chicken: { path: ASSET_PATHS.chicken, kind: "gltf", weight: 0.07 },
};

export interface HighNoonAssets {
  town: TownLayout;
  sky: Texture;
  fog: Color;
  bandit: LoadedAsset;
  boss: LoadedAsset;
  townsfolk: LoadedAsset;
  chicken: LoadedAsset;
  /** Which assets came from files (the rest are placeholders; never in production). */
  real: Record<AssetName, boolean>;
}

/** The procedural stand-ins for the art (src/games/western/placeholder/). */
export type Placeholders = typeof import("../placeholder/index");

/**
 * The stand-ins, outside production only. A toy town is not a graceful way
 * to fail in front of a player, and the few thousand lines that build it
 * have no place in the download: in a production build this is `null` and
 * the import is removed along with the branch that makes it.
 */
export function placeholders(): Promise<Placeholders> | null {
  return import.meta.env.MODE !== "production" ? import("../placeholder/index") : null;
}

export async function loadAssets(
  ctx: GameContext,
  onProgress: (fraction: number) => void,
  noon: boolean,
  /** A folder holding town.glb, sky.webp and the characters, instead of public/assets/western/. */
  base: string | null = null,
  /** The stand-ins for missing files (by default placeholders()); never any in production. */
  standIns?: Placeholders | null,
): Promise<HighNoonAssets> {
  // Settled at build time in production, so every stand-in path below goes with it.
  const kit = import.meta.env.MODE === "production" ? null : standIns === undefined ? await placeholders() : standIns;
  const art = new Art(ctx, FILES, { label: "High Noon", base, root: "assets/western/", standIns: kit !== null }, onProgress);
  await art.probe();
  const model = (name: "town" | "bandit" | "boss" | "townsfolk" | "chicken") => art.gltf(name, kit ? () => kit.standIn(name, noon) : null);
  const [townAsset, bandit, boss, townsfolk, chicken] = await Promise.all([model("town"), model("bandit"), model("boss"), model("townsfolk"), model("chicken")]);
  const town = readTown(townAsset.scene as Group);

  // The golden-hour sky.webp is wrong at noon: sky_noon.webp is the one then.
  const skyName: AssetName = noon ? "skyNoon" : "sky";
  // A placeholder sky comes with the haze to match it; a real one is sampled for it.
  const placeholder: { fog?: Color } = {};
  const sky = await art.texture(
    skyName,
    kit
      ? () => {
          const built = kit.buildSky(noon ? NOON_SUN : town.sunDirection, noon);
          placeholder.fog = built.fog;
          return built.texture;
        }
      : null,
  );
  let fog: Color | null = placeholder.fog ?? horizonColour(asSky(sky));
  // The town may carry its own fog in the scene's extras, to match the bake.
  const fogExtra = townAsset.scene.userData["fog_color"];
  if (typeof fogExtra === "string") fog = new Color(fogExtra);
  art.finish("sky");

  return { town, sky, fog: fog ?? new Color("#e9c9a0"), bandit, boss, townsfolk, chicken, real: art.real };
}
