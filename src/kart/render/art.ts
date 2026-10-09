/**
 * Grip Prix's modelled art: the glTF files Blender builds (art/kart/), loaded
 * once per race with the loading bar, and asked for by name while the world,
 * the karts and the drivers are put together.
 *
 * Every model has a code-built stand-in (kartModel.ts, drivers/, landmarks/):
 * a file that is not there yet, or fails to load, leaves the stand-ins in
 * place, so the game always runs and the art can arrive piece by piece.
 *
 * Files, under public/assets/kart/ (each a Draco-compressed .glb):
 *   karts.glb                 the kart: "kart.body", "kart.wheel" (one wheel,
 *                             placed four times), "kart.trim" ...
 *   drivers.glb               "driver.<species>.<part>": head, torso, arm.L,
 *                             arm.R, helmet (pivots at the joints)
 *   world-<theme>.glb         "landmark.<kind>" and "scenery.<kind>.<n>"
 *
 * Names are glTF node names; three.js strips the dots from them on import,
 * so they are looked up through engine/world/names.ts's contractName.
 * Materials named "paint" take the kart's or the player's colour.
 */
import type { Object3D } from "three";
import { Assets } from "../../engine/assets";
import { contractName } from "../../engine/world/names";
import type { TrackTheme } from "../track/geometry";

const FILES = {
  karts: "assets/kart/karts.glb",
  drivers: "assets/kart/drivers.glb",
  world: (theme: TrackTheme) => `assets/kart/world-${theme}.glb`,
};

const assets = new Assets();
const nodes = new Map<string, Object3D>();
const loading = new Map<string, Promise<void>>();
const settled = new Set<string>();

/** One file, loaded once (whoever asks first starts it; the rest wait on the same promise); a file that is missing or fails to load leaves the stand-ins. */
function load(file: string): Promise<void> {
  let pending = loading.get(file);
  if (!pending) {
    pending = (async () => {
      try {
        const { scene } = await assets.gltf(file);
        scene.traverse((o) => {
          const name = contractName(o);
          if (name && (name.startsWith("kart.") || name.startsWith("driver.") || name.startsWith("landmark.") || name.startsWith("scenery."))) nodes.set(name, o);
        });
      } catch {
        // Not built yet, or not reachable: the code-built stand-ins carry on.
      } finally {
        settled.add(file);
      }
    })();
    loading.set(file, pending);
  }
  return pending;
}

/** Loads what exists of the karts, the drivers and `theme`'s world; never fails (a missing file leaves the stand-ins). */
export async function loadKartArt(theme: TrackTheme, onProgress?: (fraction: number) => void): Promise<void> {
  const files = [FILES.karts, FILES.drivers, FILES.world(theme)];
  let done = 0;
  await Promise.all(files.map((file) => load(file).then(() => onProgress?.(++done / files.length))));
}

/** The karts and the drivers, no world (the driver stage shows a kart on a plinth before any race has loaded its track). Never fails. */
export async function loadStageArt(): Promise<void> {
  await Promise.all([load(FILES.karts), load(FILES.drivers)]);
}

/** Just the drivers (the character select and the lobby draw them before any race has loaded the rest). */
export function loadDriverArt(): Promise<void> {
  return load(FILES.drivers);
}

/** Has the drivers' file been tried (loaded, or found missing)? Pictures of the drivers made before it was are the stand-ins'. */
export function driverArtSettled(): boolean {
  return settled.has(FILES.drivers);
}

/** A fresh copy of the named model, or null when there is none (use the stand-in). Geometry and materials are shared with the original. */
export function artNode(name: string): Object3D | null {
  const node = nodes.get(name);
  return node ? node.clone(true) : null;
}

/** Is there a model by this name (without copying it)? */
export function hasArt(name: string): boolean {
  return nodes.has(name);
}

/** Every loaded name starting with `prefix` (scenery variants: "scenery.pine."). */
export function artNames(prefix: string): string[] {
  return [...nodes.keys()].filter((n) => n.startsWith(prefix)).sort();
}
