/**
 * What a picture draws that outlives its renderer: the karts' one material,
 * the flames and rings every race shares, the models loaded once for every
 * race, and three's own lookup table for glossy materials (one texture for
 * every renderer there ever is, in r186). A renderer that has drawn one of
 * them leaves a dispose listener on it, and the listener keeps the whole
 * renderer (its scene graph, its caches) for as long as the thing lives: every
 * race used to leave its renderer behind. Disposing them as the renderer goes
 * lets go of it; whatever draws them next uploads them again.
 */
import type { Material, Mesh, Object3D, Texture, WebGLRenderer } from "three";

/** Everything `root` draws with (geometries, materials, their textures), and the lookup table `renderer` gave them. */
export function outliving(renderer: Pick<WebGLRenderer, "properties">, root: Object3D): Set<{ dispose(): void }> {
  const found = new Set<{ dispose(): void }>();
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (mesh.geometry) found.add(mesh.geometry);
    const materials: Material[] = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    for (const material of materials) {
      found.add(material);
      for (const value of Object.values(material)) if ((value as Texture | null)?.isTexture) found.add(value as Texture);
      const lut = (renderer.properties.get(material) as { uniforms?: { dfgLUT?: { value?: Texture | null } } } | undefined)?.uniforms?.dfgLUT?.value;
      if (lut) found.add(lut);
    }
  });
  return found;
}
