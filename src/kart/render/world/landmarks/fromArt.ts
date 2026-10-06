/**
 * A landmark modelled in Blender (art/kart/, loaded by ../../art.ts), turned
 * into the same vertex-coloured geometry the code-built landmarks make, so
 * it is merged, bent over the road, shadow-baked and lit exactly like them.
 *
 * What the model must be (art/kart/README.md says it to the modeller):
 * - a node "landmark.<kind>" at the origin, metres, y up, front +z, base on
 *   y = 0, the same size as the code-built one it replaces; a span landmark
 *   (a tunnel, an arch) in the road's frame (x right of the centre line, z
 *   along the road), cut into pieces no longer than 3 m along z;
 * - colour in the materials' base colour and/or vertex colours (no
 *   textures: they are not carried over); detail and ambient occlusion baked
 *   into vertex colours;
 * - a material that glows (lamps, windows, neon, lava) has an emissive
 *   colour; glass, ice and tent canvas are transparent or named "glass";
 * - a part that turns (a ferris wheel, a carousel, a windmill's sails) is a
 *   child node named "<anything>.spin.x" (or .y, .z), turning about its own
 *   origin, at the custom property "speed" radians a second (default 0.5).
 */
import { Matrix3, Matrix4, Vector3, type BufferAttribute, type Material, type Mesh, type Object3D } from "three";
import { contractName, extraNumber } from "../../../../engine/world/names";
import { artNode } from "../../art";
import { MeshBuilder, type Rgb, type V3 } from "../builder";
import type { LandmarkModel, MovingPart } from "./types";

type Kind = "lit" | "glow" | "glass";

interface ArtMaterial extends Material {
  color?: { r: number; g: number; b: number };
  emissive?: { r: number; g: number; b: number };
  emissiveIntensity?: number;
  opacity: number;
  transparent: boolean;
}

function kindOf(m: ArtMaterial): Kind {
  const e = m.emissive;
  const glow = e ? (e.r + e.g + e.b) * (m.emissiveIntensity ?? 1) : 0;
  if (glow > 0.15 || /glow|neon|lamp|lava/i.test(m.name)) return "glow";
  if (m.transparent || m.opacity < 0.99 || /glass|ice|canvas/i.test(m.name)) return "glass";
  return "lit";
}

/** The colour a material gives a vertex (times the vertex's own colour): glowing ones above 1, so they read as light. */
function colourOf(m: ArtMaterial, kind: Kind): Rgb {
  if (kind === "glow") {
    const e = m.emissive ?? { r: 1, g: 1, b: 1 };
    const k = Math.max(1.6, m.emissiveIntensity ?? 1);
    return [e.r * k, e.g * k, e.b * k];
  }
  const c = m.color ?? { r: 0.8, g: 0.8, b: 0.8 };
  return [c.r, c.g, c.b];
}

const _m = new Matrix4();
const _n = new Matrix3();
const _p = new Vector3();
const _q = new Vector3();

/** Adds `mesh`'s triangles, in the root's space (`toRoot`), to the builders. */
function addMesh(mesh: Mesh, toRoot: Matrix4, builders: Record<Kind, MeshBuilder>): void {
  const geometry = mesh.geometry;
  const position = geometry.getAttribute("position") as BufferAttribute | undefined;
  if (!position) return;
  const normal = geometry.getAttribute("normal") as BufferAttribute | undefined;
  const vertexColour = geometry.getAttribute("color") as BufferAttribute | undefined;
  const materials = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as ArtMaterial[];
  _n.getNormalMatrix(toRoot);
  const index = geometry.index;
  const count = index ? index.count : position.count;
  const groups = geometry.groups.length ? geometry.groups : [{ start: 0, count, materialIndex: 0 }];
  for (const group of groups) {
    const material = materials[group.materialIndex ?? 0] ?? materials[0]!;
    const kind = kindOf(material);
    const base = colourOf(material, kind);
    const builder = builders[kind];
    const corner = (k: number): { p: V3; n: V3 | undefined; c: Rgb } => {
      const i = index ? index.getX(k) : k;
      _p.fromBufferAttribute(position, i).applyMatrix4(toRoot);
      let n: V3 | undefined;
      if (normal) {
        _q.fromBufferAttribute(normal, i).applyMatrix3(_n).normalize();
        n = [_q.x, _q.y, _q.z];
      }
      const c: Rgb = vertexColour ? [base[0] * vertexColour.getX(i), base[1] * vertexColour.getY(i), base[2] * vertexColour.getZ(i)] : base;
      return { p: [_p.x, _p.y, _p.z], n, c };
    };
    const end = Math.min(count, group.start + group.count);
    for (let k = group.start; k + 2 < end; k += 3) {
      const a = corner(k);
      const b = corner(k + 1);
      const c = corner(k + 2);
      // A modelled surface keeps its own smooth normals (the layer carries them: LandmarkModel.smooth).
      if (a.n && b.n && c.n) builder.triN(a.p, b.p, c.p, a.c, b.c, c.c, a.n, b.n, c.n);
      else builder.tri(a.p, b.p, c.p, a.c, b.c, c.c);
    }
  }
}

function spinAxis(name: string): "x" | "y" | "z" | null {
  const m = /\.spin\.([xyz])$/.exec(name);
  return m ? (m[1] as "x" | "y" | "z") : null;
}

/** The Blender-made model of `kind`, as a LandmarkModel, or null when there is none (the code-built one stands in). */
export function landmarkFromArt(kind: string): LandmarkModel | null {
  const root = artNode(`landmark.${kind}`);
  if (!root) return null;
  // The node's own placement in the file is not the landmark's: the layer places it.
  root.position.set(0, 0, 0);
  root.quaternion.identity();
  root.scale.set(1, 1, 1);
  root.updateMatrixWorld(true);
  const inverse = new Matrix4().copy(root.matrixWorld).invert();

  const still: Record<Kind, MeshBuilder> = { lit: new MeshBuilder(), glow: new MeshBuilder(), glass: new MeshBuilder() };
  const moving: MovingPart[] = [];
  const spinners = new Set<Object3D>();
  root.traverse((o) => {
    if (o !== root && spinAxis(contractName(o))) spinners.add(o);
  });
  const underSpinner = (o: Object3D): Object3D | null => {
    for (let p: Object3D | null = o; p && p !== root; p = p.parent) if (spinners.has(p)) return p;
    return null;
  };

  const parts = new Map<Object3D, Record<Kind, MeshBuilder>>();
  root.traverse((o) => {
    if (!(o as Mesh).isMesh) return;
    const spinner = underSpinner(o);
    let builders = still;
    if (spinner) {
      builders = parts.get(spinner) ?? { lit: new MeshBuilder(), glow: new MeshBuilder(), glass: new MeshBuilder() };
      parts.set(spinner, builders);
    }
    _m.multiplyMatrices(inverse, o.matrixWorld);
    addMesh(o as Mesh, _m, builders);
  });

  for (const [spinner, builders] of parts) {
    const axis = spinAxis(contractName(spinner))!;
    const speed = extraNumber(spinner, "speed") ?? 0.5;
    const pivot = new Vector3().setFromMatrixPosition(new Matrix4().multiplyMatrices(inverse, spinner.matrixWorld));
    moving.push({
      ...(builders.lit.empty ? {} : { lit: builders.lit }),
      ...(builders.glow.empty ? {} : { glow: builders.glow }),
      ...(builders.glass.empty ? {} : { glass: builders.glass }),
      pivot: [pivot.x, pivot.y, pivot.z],
      update(t: number, part: Object3D) {
        part.rotation[axis] = t * speed;
      },
    });
  }

  return {
    smooth: true,
    lit: still.lit,
    ...(still.glow.empty ? {} : { glow: still.glow }),
    ...(still.glass.empty ? {} : { glass: still.glass }),
    ...(moving.length ? { moving } : {}),
  };
}
