/**
 * Small pieces every realistic world's stage needs: a sun whose shadow map
 * covers only the part of the world that matters, a shadow resolution for
 * each quality tier, every shader and texture made ready before play, and
 * letting go of a scene's GPU memory.
 */
import {
  Box3,
  Vector3,
  type BufferGeometry,
  type Camera,
  type DirectionalLight,
  type InstancedMesh,
  type Material,
  type Mesh,
  type Object3D,
  type ShaderMaterial,
  type SkinnedMesh,
  type Texture,
  type WebGLRenderer,
} from "three";
import { breathe } from "../round";
import type { Quality } from "../types";

/**
 * The sun's shadow camera squeezed onto `box` (world space) as the sun sees
 * it, with a metre to spare round the sides and 20 m in depth: the whole
 * shadow map's resolution goes to where the player looks. Call it after the
 * light and its target are placed.
 */
export function fitShadowCamera(light: DirectionalLight, box: Box3): void {
  const cam = light.shadow.camera;
  light.updateMatrixWorld(true);
  light.target.updateMatrixWorld(true);
  cam.position.copy(light.position);
  cam.lookAt(light.target.position);
  cam.updateMatrixWorld(true);
  const inv = cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
  const corner = new Vector3();
  const lo = new Vector3(Infinity, Infinity, Infinity);
  const hi = new Vector3(-Infinity, -Infinity, -Infinity);
  for (let i = 0; i < 8; i++) {
    corner.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z);
    corner.applyMatrix4(inv);
    lo.min(corner);
    hi.max(corner);
  }
  cam.left = lo.x - 1;
  cam.right = hi.x + 1;
  cam.bottom = lo.y - 1;
  cam.top = hi.y + 1;
  cam.near = Math.max(0.5, -hi.z - 20);
  cam.far = -lo.z + 20;
  cam.updateProjectionMatrix();
}

/** The shadow map's size for a tier: 2048 on high, 1024 on medium, none on low. */
export function shadowMapSize(tier: Quality["tier"]): number {
  return tier === "high" ? 2048 : tier === "medium" ? 1024 : 0;
}

/**
 * Every shader compiled and every texture uploaded before play: a shader
 * first compiled in the middle of a fight is a dropped frame at the worst
 * time. Whatever is hidden is shown for it and hidden again after. The
 * textures go up a few at a time between breaths: uploaded all in the first
 * frame they froze the page (and its progress bar) for a quarter of a
 * second. Then `firstFrame` draws one real frame with everything shown, since
 * the shadow pass's depth shaders and the post chain only compile when they
 * are drawn. It is an optimisation: if it fails, the first frames of play do
 * the work instead.
 */
export async function warmUp(renderer: WebGLRenderer, scene: Object3D, camera: Camera, firstFrame: () => void): Promise<void> {
  const hidden: Object3D[] = [];
  scene.traverse((o) => {
    if (!o.visible) {
      hidden.push(o);
      o.visible = true;
    }
  });
  try {
    const textures = new Set<Texture>();
    scene.traverse((o) => {
      const m = (o as Mesh).material;
      for (const mat of Array.isArray(m) ? m : m ? [m] : []) addTextures(mat, (t) => textures.add(t));
    });
    let since = performance.now();
    for (const t of textures) {
      renderer.initTexture(t);
      if (performance.now() - since > 40) {
        await breathe();
        since = performance.now();
      }
    }
    await renderer.compileAsync(scene, camera);
    await breathe();
    firstFrame();
  } catch {
    // Compiling ahead is an optimisation; the first frames will do it otherwise.
  }
  for (const o of hidden) o.visible = false;
}

/** Something that holds GPU memory and lets go of it. */
export interface Disposable {
  dispose(): void;
}

/**
 * Everything under `root` that holds GPU memory: the geometry, materials and
 * textures (a material's own maps, and any a shader keeps in its uniforms) of
 * every mesh, point cloud, line and sprite, the instance buffers and the bone
 * textures. Collected now, so it can be let go of later even after the
 * objects have been taken out of the tree.
 */
export function disposablesUnder(root: Object3D, into = new Set<Disposable>()): Set<Disposable> {
  root.traverse((o) => {
    const part = o as Object3D & { geometry?: BufferGeometry; material?: Material | Material[] };
    if (part.geometry) into.add(part.geometry);
    if ((o as Partial<InstancedMesh>).isInstancedMesh) into.add(o as InstancedMesh);
    const skeleton = (o as Partial<SkinnedMesh>).skeleton;
    if (skeleton) into.add(skeleton);
    if (!part.material) return;
    for (const mat of Array.isArray(part.material) ? part.material : [part.material]) {
      addTextures(mat, (t) => into.add(t));
      into.add(mat);
    }
  });
  return into;
}

/** Every texture a material draws with: its own maps, and any its shader keeps in its uniforms. */
function addTextures(mat: Material, add: (texture: Texture) => void): void {
  for (const v of Object.values(mat)) if ((v as Texture | null)?.isTexture) add(v as Texture);
  const uniforms = (mat as Partial<ShaderMaterial>).uniforms;
  if (!uniforms) return;
  for (const { value } of Object.values(uniforms)) {
    for (const v of Array.isArray(value) ? (value as unknown[]) : [value]) if ((v as Texture | null)?.isTexture) add(v as Texture);
  }
}

/**
 * Everything under `root` that holds GPU memory, let go. (A disposed
 * resource that is drawn again is simply uploaded again, so letting go of a
 * shared one is no danger.)
 */
export function disposeTree(root: Object3D): void {
  for (const d of disposablesUnder(root)) d.dispose();
}
