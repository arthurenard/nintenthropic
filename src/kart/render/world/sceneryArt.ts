/**
 * The scenery modelled in Blender (art/kart/world/, loaded by ../art.ts): the
 * trees, rocks, cacti and palms of `scenery.<kind>.<n>`, merged into one
 * vertex-coloured BufferGeometry each, so the world instances them exactly as
 * it instances the code-built ones (scenery.ts: one draw call a variant).
 *
 * What a model must be: a node "scenery.<kind>.<n>" (a mesh, or a few under
 * one empty), base on y = 0, the size of the code-built one it replaces (so
 * the scatter's scales still fit); colour in the vertex colours times the
 * material's base colour, with the ambient occlusion baked in; smooth normals
 * as modelled. A material that glows (embers, lava) has an emissive colour:
 * its vertices are written brighter than 1, as the code-built ones do.
 */
import { BufferGeometry, Float32BufferAttribute, Matrix3, Matrix4, Uint32BufferAttribute, Vector3, type BufferAttribute, type Material, type Mesh, type Object3D } from "three";
import { artNames, artNode } from "../art";

interface ArtMaterial extends Material {
  color?: { r: number; g: number; b: number };
  emissive?: { r: number; g: number; b: number };
  emissiveIntensity?: number;
}

function glows(m: ArtMaterial): boolean {
  const e = m.emissive;
  return (e ? (e.r + e.g + e.b) * (m.emissiveIntensity ?? 1) : 0) > 0.15 || /glow|lava|ember/i.test(m.name);
}

/** The merged geometry of a model, in the root's own space (its placement in the file is dropped). */
export function mergedGeometry(root: Object3D): BufferGeometry {
  root.position.set(0, 0, 0);
  root.quaternion.identity();
  root.scale.set(1, 1, 1);
  root.updateMatrixWorld(true);
  const inverse = new Matrix4().copy(root.matrixWorld).invert();
  const toRoot = new Matrix4();
  const normalMatrix = new Matrix3();
  const v = new Vector3();
  const positions: number[] = [];
  const normals: number[] = [];
  const colours: number[] = [];
  const indices: number[] = [];
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    const g = mesh.geometry;
    const position = g.getAttribute("position") as BufferAttribute | undefined;
    if (!position) return;
    const normal = g.getAttribute("normal") as BufferAttribute | undefined;
    const colour = g.getAttribute("color") as BufferAttribute | undefined;
    const materials = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as ArtMaterial[];
    toRoot.multiplyMatrices(inverse, o.matrixWorld);
    normalMatrix.getNormalMatrix(toRoot);
    const base = positions.length / 3;
    // One colour for the whole mesh from its first material, and brighter than 1 where it glows.
    const material = materials[0]!;
    const glow = glows(material);
    const tint = glow ? (material.emissive ? [material.emissive.r, material.emissive.g, material.emissive.b] : [1, 1, 1]) : material.color ? [material.color.r, material.color.g, material.color.b] : [0.8, 0.8, 0.8];
    const k = glow ? Math.max(1.6, material.emissiveIntensity ?? 1) : 1;
    for (let i = 0; i < position.count; i++) {
      v.fromBufferAttribute(position, i).applyMatrix4(toRoot);
      positions.push(v.x, v.y, v.z);
      if (normal) {
        v.fromBufferAttribute(normal, i).applyMatrix3(normalMatrix).normalize();
        normals.push(v.x, v.y, v.z);
      } else normals.push(0, 1, 0);
      colours.push(tint[0]! * k * (colour ? colour.getX(i) : 1), tint[1]! * k * (colour ? colour.getY(i) : 1), tint[2]! * k * (colour ? colour.getZ(i) : 1));
    }
    const index = g.index;
    const count = index ? index.count : position.count;
    for (let i = 0; i < count; i++) indices.push(base + (index ? index.getX(i) : i));
  });
  const out = new BufferGeometry();
  out.setAttribute("position", new Float32BufferAttribute(positions, 3));
  out.setAttribute("normal", new Float32BufferAttribute(normals, 3));
  out.setAttribute("color", new Float32BufferAttribute(colours, 3));
  out.setIndex(new Uint32BufferAttribute(indices, 1));
  out.computeBoundingSphere();
  out.computeBoundingBox();
  return out;
}

/** The Blender-made variants of a kind of scenery (`scenery.<kind>.1`, `.2`, ...), or none (the code-built one stands in). */
export function sceneryVariants(kind: string): BufferGeometry[] {
  const out: BufferGeometry[] = [];
  for (const name of artNames(`scenery.${kind}.`)) {
    const node = artNode(name);
    if (node) out.push(mergedGeometry(node));
  }
  return out;
}

/** Is there any modelled scenery of this kind? */
export function hasSceneryArt(kind: string): boolean {
  return artNames(`scenery.${kind}.`).length > 0;
}
