/**
 * The debris and the Derelict as the art ships them, read once into what a
 * fragment's view clones: each kind's variants (`shrapnel.<n>`, `chunk.<n>`,
 * `slab.<n>`, `shard.<n>`, `foil.<n>` with its `.wrap` and `.core`), each
 * one's pre-fractured pieces (the sibling `<name>.pieces` group, whose
 * pieces reassemble the whole), its size, and the satellite's parts.
 */
import { Box3, Object3D, Quaternion, Vector3 } from "three";
import { contractName, extraNumber, findNode } from "../../../engine/world/names";
import type { Kind } from "../rules/tuning";

export interface Variant {
  name: string;
  /** The whole, as shipped (its own origin at its centre). */
  whole: Object3D;
  /** Its pieces, each placed where it sits in the whole (relative to the whole's origin). */
  pieces: Object3D[];
  /** Its longest side, metres. */
  size: number;
}

export interface DerelictParts {
  root: Object3D;
  body: Object3D | null;
  tank: Object3D | null;
  panels: Object3D[];
  pieces: Object3D[];
  /** The tank's direction from the satellite's centre, in its own frame. */
  tankDir: Vector3;
  size: number;
}

export type Library = Record<Exclude<Kind, "derelict">, Variant[]>;

/** Detach a node from its file's hierarchy, keeping its rotation and scale but not its place. */
function lift(o: Object3D): Object3D {
  o.removeFromParent();
  o.position.set(0, 0, 0);
  o.updateMatrix();
  return o;
}

function sizeOf(o: Object3D): number {
  const extra = extraNumber(o, "size_m");
  if (extra !== undefined && extra > 0) return extra;
  const box = new Box3().setFromObject(o);
  const s = new Vector3();
  box.getSize(s);
  return Math.max(0.05, s.x, s.y, s.z);
}

/** Every variant of each kind in debris.glb, and its pieces. */
export function readLibrary(root: Object3D): Library {
  root.updateMatrixWorld(true);
  const lib: Library = { shrapnel: [], chunk: [], slab: [], shard: [], foil: [] };
  const wholes: [Exclude<Kind, "derelict">, number, Object3D][] = [];
  root.traverse((o) => {
    const m = /^(shrapnel|chunk|slab|shard|foil)\.(\d+)$/.exec(contractName(o));
    if (m) wholes.push([m[1] as Exclude<Kind, "derelict">, Number(m[2]), o]);
  });
  wholes.sort((a, b) => a[1] - b[1]);
  for (const [kind, , node] of wholes) {
    const name = contractName(node);
    // The pieces: `<name>.pieces`, placed relative to the whole's origin.
    const group = findNode(root, `${name}.pieces`);
    const pieces: Object3D[] = [];
    if (group) {
      const inv = node.matrixWorld.clone().invert();
      const children = [...group.children].sort((a, b) => contractName(a).localeCompare(contractName(b), undefined, { numeric: true }));
      for (const c of children) {
        c.updateMatrixWorld(true);
        const local = inv.clone().multiply(c.matrixWorld);
        const piece = c;
        piece.removeFromParent();
        local.decompose(piece.position, piece.quaternion, piece.scale);
        piece.updateMatrix();
        pieces.push(piece);
      }
    }
    const size = sizeOf(node);
    lib[kind].push({ name, whole: lift(node), pieces, size });
  }
  const missing = (Object.keys(lib) as (keyof Library)[]).filter((k) => lib[k].length === 0);
  if (missing.length) console.info(`Orbital Decay: debris.glb has no ${missing.join(", ")}.`);
  return lib;
}

/** The Derelict's parts in derelict.glb. */
export function readDerelict(root: Object3D): DerelictParts {
  root.updateMatrixWorld(true);
  const sat = findNode(root, "derelict") ?? root;
  const body = findNode(root, "derelict.body");
  const tank = findNode(root, "tank");
  const panels: Object3D[] = [];
  for (let i = 1; i <= 4; i++) {
    const p = findNode(root, `panel.${i}`);
    if (p) panels.push(p);
  }
  const group = findNode(root, "derelict.pieces");
  const pieces: Object3D[] = [];
  const inv = sat.matrixWorld.clone().invert();
  if (group) {
    const children = [...group.children].sort((a, b) => contractName(a).localeCompare(contractName(b), undefined, { numeric: true }));
    for (const c of children) {
      c.updateMatrixWorld(true);
      const local = inv.clone().multiply(c.matrixWorld);
      c.removeFromParent();
      local.decompose(c.position, c.quaternion, c.scale);
      c.updateMatrix();
      pieces.push(c);
    }
  }
  const tankDir = new Vector3(0, 0, 1);
  if (tank) {
    const p = tank.getWorldPosition(new Vector3()).applyMatrix4(inv);
    if (p.lengthSq() > 1e-6) tankDir.copy(p).normalize();
  }
  // The satellite at its own origin, facing as shipped.
  sat.removeFromParent();
  sat.position.set(0, 0, 0);
  sat.quaternion.copy(new Quaternion());
  return { root: sat, body, tank, panels, pieces, tankDir, size: sizeOf(sat) };
}
