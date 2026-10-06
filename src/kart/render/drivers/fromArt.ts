/**
 * A driver assembled from the modelled art (drivers.glb, built by
 * art/kart/drivers/): the same pieces the code-built drivers are made of (a
 * torso, a head with its helmet, an arm for each side, and bits that move on
 * their own), so the rig poses them exactly as it does the stand-ins.
 *
 * The file's materials say what a surface is made of (art/kart/drivers/rig.py
 * lists them); its vertex colours are the linear colour, except for the
 * kart-painted ones ("paint", "paintcloth", "vest"), whose vertex grey says how
 * lit the surface is and which the kart's colour paints. Each part is merged
 * into one geometry in the kart material's own vertex format (colour and
 * surface), so a modelled driver costs what a code-built one does.
 */
import { BufferGeometry, Float32BufferAttribute, Matrix4, Vector3, type Material, type Mesh, type Object3D } from "three";
import { artNode, hasArt } from "../art";
import { mixRgb, scaleRgb, type Rgb, type V3 } from "../kartBuilder";
import { SURF, type Surf } from "../kartMaterial";
import { WHITE, type Look } from "./parts";
import type { Bit, DriverBuild, Species } from "./types";

/** The art's nodes for a bit that moves on its own, in the order the code-built driver lists its bits. */
export const ART_BITS: Record<Species, readonly string[]> = {
  rabbit: ["tail"],
  penguin: ["scarf"],
  frog: ["sac"],
  fox: ["tail"],
  otter: ["scarf", "tail"],
  cat: ["tail"],
  bear: [],
  robot: ["bulb"],
  duck: ["tail"],
};

type Mode = "albedo" | "paint" | "vest" | "lamp" | "glow";
const KINDS: Record<string, { surf: Surf; mode: Mode }> = {
  fur: { surf: SURF.fur, mode: "albedo" },
  cloth: { surf: SURF.cloth, mode: "albedo" },
  trim: { surf: SURF.trim, mode: "albedo" },
  plastic: { surf: SURF.plastic, mode: "albedo" },
  steel: { surf: SURF.steel, mode: "albedo" },
  gloss: { surf: SURF.gloss, mode: "albedo" },
  glass: { surf: SURF.glass, mode: "albedo" },
  lamp: { surf: SURF.lamp, mode: "lamp" },
  glow: { surf: SURF.lamp, mode: "glow" },
  paint: { surf: SURF.paint, mode: "paint" },
  paintcloth: { surf: SURF.cloth, mode: "paint" },
  vest: { surf: SURF.cloth, mode: "vest" },
};

const PARTS = ["head", "torso", "arm.L", "arm.R"] as const;

/** Is there a modelled driver for this species (every part the rig needs)? */
export function hasDriverArt(species: Species): boolean {
  return PARTS.every((p) => hasArt(`driver.${species}.${p}`));
}

interface Built {
  geometry: BufferGeometry;
  at: V3;
}

const _v = new Vector3();

/**
 * Art nodes (each a mesh, or a group of one mesh per material) as one geometry in the kart material's format,
 * placed relative to the first node's origin (the helmet is the head's, at the same joint).
 */
function buildPart(nodes: Object3D[], look: Look): Built {
  const position: number[] = [];
  const normal: number[] = [];
  const color: number[] = [];
  const surfs: number[] = [];
  const index: number[] = [];
  const vest = mixRgb(WHITE, look.kart, 0.12);
  const origin = nodes[0]!.position;
  const meshes: { mesh: Mesh; matrix: Matrix4 }[] = [];
  for (const node of nodes) {
    node.updateMatrix();
    const shift = new Matrix4().makeTranslation(node.position.x - origin.x, node.position.y - origin.y, node.position.z - origin.z);
    if ((node as Mesh).isMesh) meshes.push({ mesh: node as Mesh, matrix: shift });
    else for (const child of node.children) if ((child as Mesh).isMesh) meshes.push({ mesh: child as Mesh, matrix: shift.clone().multiply(child.matrix) });
  }
  for (const { mesh, matrix } of meshes) {
    const kind = KINDS[((mesh.material as Material).name || "fur").toLowerCase()] ?? KINDS.fur!;
    const geo = mesh.geometry;
    const pos = geo.getAttribute("position");
    const nor = geo.getAttribute("normal");
    const col = geo.getAttribute("color");
    const base = position.length / 3;
    for (let i = 0; i < pos.count; i++) {
      _v.fromBufferAttribute(pos, i).applyMatrix4(matrix);
      position.push(_v.x, _v.y, _v.z);
      _v.fromBufferAttribute(nor, i).transformDirection(matrix);
      normal.push(_v.x, _v.y, _v.z);
      const c = col ? ([col.getX(i), col.getY(i), col.getZ(i)] as Rgb) : ([1, 1, 1] as Rgb);
      let out: Rgb;
      switch (kind.mode) {
        case "paint":
          out = mixRgb(look.low, look.top, Math.min(1, Math.max(0, c[0])));
          break;
        case "vest":
          out = scaleRgb(vest, 0.55 + 0.45 * Math.min(1, c[0]));
          break;
        case "lamp":
          out = scaleRgb(c, 2.1);
          break;
        case "glow":
          out = scaleRgb(c, 6);
          break;
        default:
          out = c;
      }
      color.push(out[0], out[1], out[2]);
      surfs.push(kind.surf[0], kind.surf[1], kind.surf[2], kind.surf[3]);
    }
    const idx = geo.index;
    if (idx) for (let i = 0; i < idx.count; i++) index.push(idx.getX(i) + base);
    else for (let i = 0; i < pos.count; i++) index.push(i + base);
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(position, 3));
  g.setAttribute("normal", new Float32BufferAttribute(normal, 3));
  g.setAttribute("color", new Float32BufferAttribute(color, 3));
  g.setAttribute("aSurf", new Float32BufferAttribute(surfs, 4));
  g.setIndex(index);
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return { geometry: g, at: [origin.x, origin.y, origin.z] };
}

/** The named parts of a species merged into one geometry (null if the first is missing). */
function part(species: Species, look: Look, ...names: string[]): Built | null {
  const nodes = names.map((n) => artNode(`driver.${species}.${n}`)).filter((n): n is Object3D => n !== null);
  return nodes.length && nodes[0] ? buildPart(nodes, look) : null;
}

/**
 * The driver from the art, dressed in the kart's colour, or null when there is none. `code` is the code-built
 * driver of the same species: the bits that move keep its motion (and its geometry when the art has no model of
 * them).
 */
export function driverFromArt(species: Species, look: Look, code: DriverBuild): DriverBuild | null {
  if (!hasDriverArt(species)) return null;
  const head = part(species, look, "head", "helmet")!;
  const torso = part(species, look, "torso")!;
  const armL = part(species, look, "arm.L")!;
  const armR = part(species, look, "arm.R")!;
  const names = ART_BITS[species];
  const bits: Bit[] = code.bits.map((bit, i) => {
    const built = names[i] ? part(species, look, names[i]!) : null;
    if (!built) return bit;
    bit.geo.dispose();
    return { ...bit, geo: built.geometry, at: built.at };
  });
  code.torso.dispose();
  code.head.dispose();
  code.arm.dispose();
  return {
    ...code,
    torso: torso.geometry,
    head: head.geometry,
    arm: armL.geometry,
    armR: armR.geometry,
    shoulder: Math.abs(armL.at[0]),
    shoulderAt: armL.at,
    headAt: head.at,
    bits,
  };
}
