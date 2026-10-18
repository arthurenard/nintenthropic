import {
  Box3,
  Mesh,
  Object3D,
  Quaternion,
  Vector3,
  type Group,
} from "three";
import type { Cover, CoverKind, Emerge } from "../rules/types";
import { readEye, surfaceFromArt } from "../../../engine/world/layout";
import { extraNumber, extraString, findNode, nodesWithPrefix } from "../../../engine/world/names";

export type Surface = "wood" | "dirt" | "glass" | "metal" | "stone" | "cloth" | "water";

const SURFACES: readonly Surface[] = ["wood", "dirt", "glass", "metal", "stone", "cloth", "water"];
const KINDS: readonly CoverKind[] = ["window", "door", "barrel", "crate", "wagon", "corner", "roof", "tower"];
const EMERGES: readonly Emerge[] = ["lean_left", "lean_right", "rise", "step_out"];

export interface SecretNodes {
  bell: Object3D | null;
  vane: Object3D | null;
  waterTower: Object3D | null;
  piano: Object3D | null;
  poster: Object3D | null;
  doorLeft: Object3D | null;
  doorRight: Object3D | null;
}

/**
 * Dust Creek as the game needs it, read from the named nodes of town.glb (or
 * the placeholder built to the same contract).
 */
export interface TownLayout {
  root: Group;
  eye: Vector3;
  eyeQuaternion: Quaternion;
  /** Vertical field of view, degrees. */
  fov: number;
  /** The direction sunlight travels (the `sun` node's −Z). */
  sunDirection: Vector3;
  covers: Cover[];
  calib: Object3D[];
  secrets: SecretNodes;
  glass: Map<string, Mesh>;
  chickenPath: Vector3[];
  tumbleweedPath: Vector3[];
  groundShadow: Mesh[];
  /** Meshes a bullet stops at (everything solid; glass is separate). */
  solids: Mesh[];
  bounds: Box3;
}

export function surfaceOf(o: Object3D): Surface {
  return surfaceFromArt(o, SURFACES, (name) => {
    if (/ground|street|dirt|road|sand/.test(name)) return "dirt";
    if (/glass|window/.test(name)) return "glass";
    if (/metal|iron|bell|vane|lamp/.test(name)) return "metal";
    if (/stone|rock|brick/.test(name)) return "stone";
    if (/water/.test(name)) return "water";
    return "wood";
  });
}

const tmp = new Vector3();

function worldPos(o: Object3D): Vector3 {
  return o.getWorldPosition(new Vector3());
}

function pathFrom(root: Object3D, prefix: string): Vector3[] {
  const nodes = [...nodesWithPrefix(root, prefix).entries()]
    .map(([k, o]) => ({ n: Number(k), o }))
    .filter((e) => Number.isFinite(e.n))
    .sort((a, b) => a.n - b.n);
  return nodes.map((e) => worldPos(e.o));
}

export function readTown(root: Group): TownLayout {
  root.updateMatrixWorld(true);

  const { position: eye, quaternion: eyeQuaternion, fov } = readEye(root, new Vector3(0, 1.7, 0), 50);

  const sunNode = findNode(root, "sun");
  const sunDirection = new Vector3(-0.45, -0.37, -0.81).normalize();
  if (sunNode) sunDirection.set(0, 0, -1).applyQuaternion(sunNode.getWorldQuaternion(new Quaternion())).normalize();

  // Covers: `cover.<id>` and its `cover.<id>.hidden`.
  const coverNodes = nodesWithPrefix(root, "cover.");
  const covers: Cover[] = [];
  for (const [key, node] of coverNodes) {
    if (key.endsWith(".hidden")) continue;
    const hiddenNode = coverNodes.get(`${key}.hidden`) ?? null;
    const exposed = worldPos(node);
    const kindRaw = extraString(node, "kind") ?? "corner";
    const emergeRaw = extraString(node, "emerge") ?? "step_out";
    const levelRaw = extraNumber(node, "level") ?? 0;
    const kind = (KINDS as readonly string[]).includes(kindRaw) ? (kindRaw as CoverKind) : "corner";
    const emerge = (EMERGES as readonly string[]).includes(emergeRaw) ? (emergeRaw as Emerge) : "step_out";
    const level = (levelRaw >= 2 ? 2 : levelRaw >= 1 ? 1 : 0) as 0 | 1 | 2;
    let hidden: Vector3;
    if (hiddenNode) {
      hidden = worldPos(hiddenNode);
    } else {
      // No hidden node: step a metre straight back from the player.
      tmp.set(exposed.x - eye.x, 0, exposed.z - eye.z).normalize();
      hidden = exposed.clone().addScaledVector(tmp, 1);
    }
    const tags: string[] = [];
    const tagExtra = extraString(node, "tags");
    if (tagExtra) tags.push(...tagExtra.split(/[\s,]+/).filter(Boolean));
    for (const flag of ["boss", "townsfolk", "duel"]) if (node.userData[flag] === true) tags.push(flag);
    const side: -1 | 0 | 1 = exposed.x < eye.x - 1.5 ? -1 : exposed.x > eye.x + 1.5 ? 1 : 0;
    covers.push({
      id: key,
      kind,
      emerge,
      level,
      exposed: { x: exposed.x, y: exposed.y, z: exposed.z },
      hidden: { x: hidden.x, y: hidden.y, z: hidden.z },
      distance: Math.hypot(exposed.x - eye.x, exposed.z - eye.z),
      side,
      tags,
    });
  }
  covers.sort((a, b) => a.id.localeCompare(b.id));

  const calib = [...nodesWithPrefix(root, "calib.").entries()]
    .map(([k, o]) => ({ n: Number(k), o }))
    .filter((e) => Number.isFinite(e.n))
    .sort((a, b) => a.n - b.n)
    .map((e) => e.o);

  const secrets: SecretNodes = {
    bell: findNode(root, "secret.bell"),
    vane: findNode(root, "secret.vane"),
    waterTower: findNode(root, "secret.water_tower"),
    piano: findNode(root, "secret.piano"),
    poster: findNode(root, "secret.poster"),
    doorLeft: findNode(root, "secret.church_doors.left"),
    doorRight: findNode(root, "secret.church_doors.right"),
  };

  const glass = new Map<string, Mesh>();
  for (const [id, node] of nodesWithPrefix(root, "glass.")) {
    node.traverse((o) => {
      if ((o as Mesh).isMesh && !glass.has(id)) glass.set(id, o as Mesh);
    });
  }

  const groundShadow: Mesh[] = [];
  const shadowNode = findNode(root, "ground.shadow");
  shadowNode?.traverse((o) => {
    if ((o as Mesh).isMesh) groundShadow.push(o as Mesh);
  });

  const glassSet = new Set<Object3D>(glass.values());
  const shadowSet = new Set<Object3D>(groundShadow);
  const solids: Mesh[] = [];
  root.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh || glassSet.has(m) || shadowSet.has(m)) return;
    if (m.userData["noCollide"] === true) return;
    solids.push(m);
  });

  const bounds = new Box3().setFromObject(root);

  return {
    root,
    eye,
    eyeQuaternion,
    fov,
    sunDirection,
    covers,
    calib,
    secrets,
    glass,
    chickenPath: pathFrom(root, "path.chicken."),
    tumbleweedPath: pathFrom(root, "path.tumbleweed."),
    groundShadow,
    solids,
    bounds,
  };
}
