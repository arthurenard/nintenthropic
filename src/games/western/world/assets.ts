import { Color, EquirectangularReflectionMapping, SRGBColorSpace, type Group, type Texture } from "three";
import type { GameContext, LoadedAsset } from "../../../engine/types";
import { buildBanditAsset, buildBossAsset, buildChickenAsset, buildTownsfolkAsset } from "../placeholder/characters";
import { buildPlaceholderTown } from "../placeholder/town";
import { buildSky } from "./sky";
import { readTown, type TownLayout } from "./town";

/**
 * Where High Noon's art lives. Swapping a placeholder for the real thing is
 * dropping the file at this path: nothing else changes, because the
 * placeholders are built to the same node names, extras, bones and clips.
 */
export const ASSET_PATHS = {
  town: "assets/western/town.glb",
  sky: "assets/western/sky.webp",
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
  /** Which assets came from files (the rest are placeholders). */
  real: Record<AssetName, boolean>;
}

function url(path: string): string {
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

export async function loadAssets(ctx: GameContext, onProgress: (fraction: number) => void, noon: boolean): Promise<HighNoonAssets> {
  const real: Record<AssetName, boolean> = { town: false, sky: false, bandit: false, boss: false, townsfolk: false, chicken: false };
  const names = Object.keys(ASSET_PATHS) as AssetName[];
  const present = await Promise.all(names.map((n) => exists(url(ASSET_PATHS[n]))));
  names.forEach((n, i) => (real[n] = present[i] as boolean));

  const weights: Record<AssetName, number> = { town: 0.55, sky: 0.1, bandit: 0.1, boss: 0.08, townsfolk: 0.1, chicken: 0.07 };
  const done: Record<AssetName, number> = { town: 0, sky: 0, bandit: 0, boss: 0, townsfolk: 0, chicken: 0 };
  const report = () => onProgress(Math.min(0.99, names.reduce((s, n) => s + weights[n] * done[n], 0)));
  const loadGltf = async (name: AssetName, fallback: () => LoadedAsset): Promise<LoadedAsset> => {
    if (real[name]) {
      try {
        const asset = await ctx.assets.gltf(url(ASSET_PATHS[name]), (f) => {
          done[name] = f;
          report();
        });
        done[name] = 1;
        report();
        return asset;
      } catch (err) {
        console.warn(`High Noon: ${ASSET_PATHS[name]} would not load; using the placeholder.`, err);
        real[name] = false;
      }
    }
    const asset = fallback();
    done[name] = 1;
    report();
    return asset;
  };

  const [townAsset, bandit, boss, townsfolk, chicken] = await Promise.all([
    loadGltf("town", () => ({ scene: buildPlaceholderTown({ noon }), animations: [] })),
    loadGltf("bandit", buildBanditAsset),
    loadGltf("boss", buildBossAsset),
    loadGltf("townsfolk", buildTownsfolkAsset),
    loadGltf("chicken", buildChickenAsset),
  ]);
  const town = readTown(townAsset.scene as Group);

  let sky: Texture | null = null;
  let fog: Color | null = null;
  if (real.sky) {
    try {
      sky = await ctx.assets.texture(url(ASSET_PATHS.sky));
      sky.mapping = EquirectangularReflectionMapping;
      sky.colorSpace = SRGBColorSpace;
      fog = horizonColour(sky);
    } catch (err) {
      console.warn("High Noon: sky.webp would not load; using the placeholder.", err);
      real.sky = false;
      sky = null;
    }
  }
  if (!sky) {
    const built = buildSky(town.sunDirection, noon);
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
