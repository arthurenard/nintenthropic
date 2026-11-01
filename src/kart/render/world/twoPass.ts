/**
 * Glass, steam and glows are transparent and double-sided, which three draws in two passes: the back faces, then the front
 * ones. To do that it changes the material's side and its `needsUpdate` twice for each object it draws, and every change
 * makes it work the material's whole program out again (its parameters, a long cache key), twice per object per view per
 * frame: with the glass of a landmark or a hazard's puffs in view that is 20 to 30 objects a frame in four views, and a good
 * part of a frame's garbage.
 *
 * Here the two passes are two materials, back faces and front faces, in the object's two groups: the same two draws, in the
 * same order (the two groups sort side by side), so the same pixels, and no program is worked out again.
 */
import { BackSide, DoubleSide, FrontSide, type BufferGeometry, type Material, type Mesh, type Object3D } from "three";
import { twinOf } from "./shading";

/** Whether the material is one three draws in two passes. */
const twoPass = (material: Material): boolean => material.transparent && material.side === DoubleSide && !material.forceSinglePass && !(material as { isShaderMaterial?: boolean }).isShaderMaterial;

/** The geometry as the two groups draw it: all of it, once with the back faces' material and once with the front faces'. */
function group(geometry: BufferGeometry): boolean {
  const all = geometry.index ? geometry.index.count : (geometry.getAttribute("position")?.count ?? 0);
  if (geometry.groups.length === 0) {
    if (all === 0 || geometry.drawRange.start !== 0 || geometry.drawRange.count < all) return false;
    geometry.addGroup(0, all, 0);
    geometry.addGroup(0, all, 1);
    return true;
  }
  // Another object with the same geometry has been split already.
  const [a, b] = geometry.groups;
  return geometry.groups.length === 2 && a!.start === 0 && a!.count === all && a!.materialIndex === 0 && b!.start === 0 && b!.count === all && b!.materialIndex === 1;
}

/**
 * Splits every plain mesh under `root` that three would draw in two passes (not the instanced ones, nor those with a shader
 * of their own, whose uniforms are theirs to change, nor those that cast shadows) into the same two draws as two materials.
 * The materials are made once for each original; the returned object lets them go.
 */
export function splitTwoPass(root: Object3D): { dispose(): void; split: number } {
  const pairs = new Map<Material, [Material, Material]>();
  let split = 0;
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh || (mesh as { isInstancedMesh?: boolean }).isInstancedMesh || (mesh as { isSkinnedMesh?: boolean }).isSkinnedMesh) return;
    const material = mesh.material;
    if (Array.isArray(material) || !twoPass(material) || mesh.castShadow) return;
    if (!group(mesh.geometry)) return;
    let pair = pairs.get(material);
    if (!pair) {
      const back = twinOf(material);
      back.side = BackSide;
      const front = twinOf(material);
      front.side = FrontSide;
      pair = [back, front];
      pairs.set(material, pair);
    }
    mesh.material = pair;
    split++;
  });
  return {
    split,
    dispose() {
      for (const [back, front] of pairs.values()) {
        back.dispose();
        front.dispose();
      }
      pairs.clear();
    },
  };
}
