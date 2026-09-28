/**
 * Small pieces every realistic world's stage needs: a sun whose shadow map
 * covers only the part of the world that matters, a shadow resolution for
 * each quality tier, and letting go of a scene's GPU memory.
 */
import { Box3, Vector3, type DirectionalLight, type Material, type Mesh, type Object3D, type Texture } from "three";
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

/** Every mesh's geometry, materials and textures under `root`, let go. */
export function disposeTree(root: Object3D): void {
  root.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh) return;
    m.geometry?.dispose();
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    for (const mat of mats as Material[]) {
      for (const v of Object.values(mat)) if ((v as Texture)?.isTexture) (v as Texture).dispose();
      mat.dispose();
    }
  });
}
