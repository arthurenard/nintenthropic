/**
 * Portraits of the drivers for the character select and the lobby: each is
 * the renderer's own model (drivers/) drawn once to a small picture, by one
 * offscreen renderer that is made on first use and let go of after a moment.
 * A window that cannot draw gets `null` and shows a name instead.
 */
import {
  Box3,
  Color,
  DirectionalLight,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  NeutralToneMapping,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from "three";
import { characterById } from "../characters";
import { createDriver } from "./drivers";

export interface PortraitOptions {
  /** The kart's colour: the helmet, goggles or scarf. */
  colour?: string;
  /** A flat dark shape, for a driver not yet found. */
  silhouette?: boolean;
  /** Pixels on a side (square). */
  size?: number;
  /** "bust" frames the head and shoulders, "wave" the same with a hand raised. */
  framing?: "bust" | "wave";
}

const cache = new Map<string, string>();
let shared: { renderer: WebGLRenderer; scene: Scene; camera: PerspectiveCamera; sun: DirectionalLight; sky: HemisphereLight } | null = null;
let release = 0;

function stage(size: number) {
  if (!shared) {
    const canvas = document.createElement("canvas");
    const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: false });
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = NeutralToneMapping;
    renderer.setClearColor(new Color(0x000000), 0);
    const scene = new Scene();
    const sky = new HemisphereLight(0xdcecff, 0x6b7a8f, 1.55);
    const sun = new DirectionalLight(0xfff1dd, 2.1);
    sun.position.set(-3, 5, 6);
    scene.add(sky, sun);
    shared = { renderer, scene, camera: new PerspectiveCamera(26, 1, 0.1, 50), sun, sky };
  }
  shared.renderer.setPixelRatio(1);
  shared.renderer.setSize(size, size, false);
  // Let the context go a few seconds after the last portrait: a screen draws its set at once.
  window.clearTimeout(release);
  release = window.setTimeout(() => {
    shared?.renderer.dispose();
    shared?.renderer.forceContextLoss();
    shared = null;
  }, 4000);
  return shared;
}

/**
 * The portrait of a driver as a PNG data URL (or null if nothing can be
 * drawn here). Cached by what was asked.
 */
export function portrait(characterId: string | undefined, options: PortraitOptions = {}): string | null {
  const character = characterById(characterId);
  if (!character) return null;
  const size = options.size ?? 320;
  const colour = options.colour ?? "#0A84FF";
  const framing = options.framing ?? "bust";
  const key = `${character.id}|${colour}|${options.silhouette ? 1 : 0}|${size}|${framing}`;
  const hit = cache.get(key);
  if (hit) return hit;
  try {
    const { renderer, scene, camera } = stage(size);
    const driver = createDriver(character.species, colour);
    driver.update({ time: 0.9, steer: 0.0, lean: 0, twirl: 0, emote: framing === "wave" ? "wave" : null });
    // A quarter turn toward the light, so the face and a shoulder show.
    driver.root.rotation.y = -0.32;
    driver.root.updateMatrixWorld(true);
    if (options.silhouette) {
      const flat = new MeshBasicMaterial({ color: 0x3a435a });
      driver.root.traverse((o) => {
        if ("material" in o) (o as { material: unknown }).material = flat;
      });
    }
    scene.add(driver.root);
    // Frame it: the head and shoulders (or all but the legs), fitted to the square.
    const box = new Box3();
    const part = new Box3();
    driver.root.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh || !mesh.visible || !mesh.geometry.boundingBox) return;
      box.union(part.copy(mesh.geometry.boundingBox).applyMatrix4(mesh.matrixWorld));
    });
    box.min.y = Math.max(box.min.y, 0.46);
    const centre = box.getCenter(new Vector3());
    const extent = box.getSize(new Vector3());
    const span = Math.max(extent.y, extent.x * 0.8) * 1.06;
    const distance = span / 2 / Math.tan((camera.fov * Math.PI) / 360);
    camera.position.set(centre.x + distance * 0.12, centre.y + distance * 0.06, centre.z + distance + extent.z / 2);
    camera.lookAt(centre.x, centre.y, centre.z);
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
    const out = document.createElement("canvas");
    out.width = out.height = size;
    out.getContext("2d")!.drawImage(renderer.domElement, 0, 0);
    scene.remove(driver.root);
    driver.dispose();
    const url = out.toDataURL("image/png");
    cache.set(key, url);
    return url;
  } catch {
    return null;
  }
}
