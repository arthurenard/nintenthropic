import { Color, EquirectangularReflectionMapping, SRGBColorSpace, type Group, type Texture } from "three";
import { DownloadError } from "../../../engine/fetch";
import type { GameContext, LoadedAsset } from "../../../engine/types";
import { NOON_SUN } from "./stage";
import { readTown, type TownLayout } from "./town";

/**
 * Where High Noon's art lives. Every file is required: in production one
 * that does not load fails the game's load (a DownloadError, which the page
 * shows as "Couldn’t Load the Game" with Try Again). In development and
 * tests a missing file is stood in for by a placeholder built in code to the
 * same node names, extras, bones and clips (see placeholders()).
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

/** A file that would not load, as the page expects to hear of it. */
function failed(href: string, err: unknown): DownloadError {
  if (err instanceof DownloadError) return err;
  console.warn(`High Noon: ${href} would not load.`, err);
  return new DownloadError(href, null);
}

/** Where "assets/western/…" lives: the app's base, or (dev harness only) another folder. */
let assetBase: string | null = null;

function url(path: string): string {
  if (assetBase) return `${assetBase}${path.replace(/^assets\/western\//, "")}`;
  const base = (import.meta.env?.BASE_URL as string | undefined) ?? "/";
  return `${base}${path}`;
}

/**
 * Is the file really there? A dev server answers a missing path with its
 * index page, so a 200 is not enough: the answer must not be HTML.
 */
async function exists(href: string): Promise<boolean> {
  try {
    const res = await fetch(href, { method: "HEAD", cache: "no-cache" });
    if (!res.ok) return false;
    const type = res.headers.get("content-type") ?? "";
    return !type.includes("text/html");
  } catch {
    return false;
  }
}

/** The horizon straight down the street, sampled from an equirectangular sky image. */
function horizonColour(texture: Texture): Color | null {
  const img = texture.image as CanvasImageSource & { width?: number; height?: number };
  const w = img?.width ?? 0;
  const h = img?.height ?? 0;
  if (!w || !h) return null;
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 32;
  const g = c.getContext("2d");
  if (!g) return null;
  g.drawImage(img, 0, 0, 64, 32);
  // Three's equirect mapping puts −Z at u = 0.25; the horizon at v = 0.5.
  const d = g.getImageData(15, 15, 3, 2).data;
  let r = 0;
  let gg = 0;
  let b = 0;
  for (let i = 0; i < d.length; i += 4) {
    r += d[i] as number;
    gg += d[i + 1] as number;
    b += d[i + 2] as number;
  }
  const n = d.length / 4;
  return new Color().setRGB(r / n / 255, gg / n / 255, b / n / 255, SRGBColorSpace);
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
  assetBase = base;
  // Settled at build time in production, so every stand-in path below goes with it.
  const kit = import.meta.env.MODE === "production" ? null : standIns === undefined ? await placeholders() : standIns;
  const names = Object.keys(ASSET_PATHS) as AssetName[];
  const real: Record<AssetName, boolean> = { town: true, sky: true, skyNoon: true, bandit: true, boss: true, townsfolk: true, chicken: true };
  if (kit) {
    // With stand-ins to hand, only the files that are really there are fetched.
    const present = await Promise.all(names.map((n) => exists(url(ASSET_PATHS[n]))));
    names.forEach((n, i) => (real[n] = present[i] as boolean));
  }

  const weights: Record<AssetName, number> = { town: 0.55, sky: 0.1, skyNoon: 0, bandit: 0.1, boss: 0.08, townsfolk: 0.1, chicken: 0.07 };
  const done: Record<AssetName, number> = { town: 0, sky: 0, skyNoon: 0, bandit: 0, boss: 0, townsfolk: 0, chicken: 0 };
  const report = () => onProgress(Math.min(0.99, names.reduce((s, n) => s + weights[n] * done[n], 0)));
  const loadGltf = async (name: "town" | "bandit" | "boss" | "townsfolk" | "chicken"): Promise<LoadedAsset> => {
    const href = url(ASSET_PATHS[name]);
    if (real[name]) {
      try {
        const asset = await ctx.assets.gltf(href, (f) => {
          done[name] = f;
          report();
        });
        done[name] = 1;
        report();
        return asset;
      } catch (err) {
        if (!kit) throw failed(href, err);
        console.warn(`High Noon: ${ASSET_PATHS[name]} would not load; using the placeholder.`, err);
        real[name] = false;
      }
    }
    if (!kit) throw new DownloadError(href, null);
    const asset = kit.standIn(name, noon);
    done[name] = 1;
    report();
    return asset;
  };

  const [townAsset, bandit, boss, townsfolk, chicken] = await Promise.all([
    loadGltf("town"),
    loadGltf("bandit"),
    loadGltf("boss"),
    loadGltf("townsfolk"),
    loadGltf("chicken"),
  ]);
  const town = readTown(townAsset.scene as Group);

  let sky: Texture | null = null;
  let fog: Color | null = null;
  // The golden-hour sky.webp is wrong at noon: sky_noon.webp is the one then.
  const skyName: AssetName = noon ? "skyNoon" : "sky";
  const skyHref = url(ASSET_PATHS[skyName]);
  if (real[skyName]) {
    try {
      sky = await ctx.assets.texture(skyHref);
      sky.mapping = EquirectangularReflectionMapping;
      sky.colorSpace = SRGBColorSpace;
      fog = horizonColour(sky);
    } catch (err) {
      if (!kit) throw failed(skyHref, err);
      console.warn(`High Noon: ${ASSET_PATHS[skyName]} would not load; using the placeholder.`, err);
      real[skyName] = false;
      sky = null;
    }
  }
  if (!sky) {
    if (!kit) throw new DownloadError(skyHref, null);
    const built = kit.buildSky(noon ? NOON_SUN : town.sunDirection, noon);
    sky = built.texture;
    fog = built.fog;
  }
  // The town may carry its own fog in the scene's extras, to match the bake.
  const fogExtra = townAsset.scene.userData["fog_color"];
  if (typeof fogExtra === "string") fog = new Color(fogExtra);
  done.sky = 1;
  report();

  return { town, sky, fog: fog ?? new Color("#e9c9a0"), bandit, boss, townsfolk, chicken, real };
}
