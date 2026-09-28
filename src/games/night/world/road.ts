import { Box3, InstancedMesh, Matrix4, Mesh, Object3D, PerspectiveCamera, Quaternion, Vector3, type BufferAttribute, type Group } from "three";
import type { V3 } from "../../../engine/rules/raymath";
import { contractName, extraNumber, extraString, findNode, nodesWithPrefix } from "../../../engine/world/names";
import type { SignLetter } from "../rules/secrets";
import { SIGN_LETTERS } from "../rules/secrets";
import type { Lane, LaneId, Slot } from "../rules/types";

export type Surface = "asphalt" | "dirt" | "wood" | "metal" | "glass" | "cloth" | "plant" | "sandbag" | "water";

const SURFACES: readonly Surface[] = ["asphalt", "dirt", "wood", "metal", "glass", "cloth", "plant", "sandbag", "water"];

export interface SecretNodes {
  sign: Map<SignLetter, Object3D>;
  scarecrow: Object3D | null;
  /** The scarecrow's head's pivot, which turns to follow you. */
  scarecrowHead: Object3D | null;
  boothLight: Object3D | null;
  motelPhone: Object3D | null;
  driveInLamp: Object3D | null;
  driveInScreen: Object3D | null;
  radio: Object3D | null;
  catSpots: Vector3[];
  duck: Object3D | null;
  moonDisc: Object3D | null;
}

/**
 * Route 9 as the game needs it, read from the named nodes of road.glb (or
 * the placeholder built to the same contract: docs/DEAD_OF_NIGHT.md, "Asset
 * contract").
 */
export interface RoadLayout {
  root: Group;
  eye: Vector3;
  eyeQuaternion: Quaternion;
  /** Vertical field of view, degrees. */
  fov: number;
  /** The direction moonlight travels (the `moon` node's −Z). */
  moonDirection: Vector3;
  streetLight: Object3D | null;
  neonLight: Object3D | null;
  motelLights: Object3D[];
  lanes: Lane[];
  slots: Slot[];
  /** Survivors' runs across the road (`path.survivor.<n>.<k>`), or a way worked out from the road. */
  survivorPaths: V3[][];
  calib: Object3D[];
  secrets: SecretNodes;
  groundShadow: Mesh[];
  /** The corn, which the game sways: its meshes. */
  corn: Mesh[];
  /** Meshes a bullet stops at (everything solid; the corn and glass are not). */
  solids: Mesh[];
  bounds: Box3;
}

export function surfaceOf(o: Object3D): Surface {
  const s = extraString(o, "surface");
  if (s && (SURFACES as readonly string[]).includes(s)) return s as Surface;
  const mesh = o as Mesh;
  const mat = mesh.material;
  const m = Array.isArray(mat) ? mat[0] : mat;
  const fromMaterial = m?.userData?.["surface"];
  if (typeof fromMaterial === "string" && (SURFACES as readonly string[]).includes(fromMaterial)) return fromMaterial as Surface;
  // Without extras, guess from names so an early export still plays sensibly.
  const name = `${contractName(o)} ${m?.name ?? ""}`.toLowerCase();
  if (/road|asphalt|tarmac|forecourt|concrete/.test(name)) return "asphalt";
  if (/corn|grass|plant|tree|pine|bush/.test(name)) return "plant";
  if (/sandbag/.test(name)) return "sandbag";
  if (/glass|window/.test(name)) return "glass";
  if (/metal|steel|iron|pump|truck|bus|tin|pole|sign/.test(name)) return "metal";
  if (/puddle|water/.test(name)) return "water";
  if (/cloth|tarp|flag/.test(name)) return "cloth";
  if (/dirt|field|ground|gravel|mud/.test(name)) return "dirt";
  return "wood";
}

const tmp = new Vector3();

function worldPos(o: Object3D): Vector3 {
  return o.getWorldPosition(new Vector3());
}

const v3 = (p: Vector3): V3 => ({ x: p.x, y: p.y, z: p.z });

/** `prefix<n>` nodes in order of n. */
function ordered(root: Object3D, prefix: string): Object3D[] {
  return [...nodesWithPrefix(root, prefix).entries()]
    .map(([k, o]) => ({ n: Number(k), o }))
    .filter((e) => Number.isFinite(e.n))
    .sort((a, b) => a.n - b.n)
    .map((e) => e.o);
}

/** A lane's spread when its first waypoint does not say (`spread` extras). */
const SPREAD: Readonly<Record<LaneId, number>> = { road: 1.7, corn: 1.3, trees: 1.6, bus: 0.4, booth: 0.5, fence: 0.4 };

export function readRoad(root: Group): RoadLayout {
  root.updateMatrixWorld(true);

  // The eye: a glTF camera (the loader makes it a PerspectiveCamera) or an empty with `fov` extras.
  const camNode = findNode(root, "camera.player");
  const eye = camNode ? worldPos(camNode) : new Vector3(0, 1.7, 0);
  const eyeQuaternion = camNode ? camNode.getWorldQuaternion(new Quaternion()) : new Quaternion();
  let fov = 50;
  if (camNode) {
    let cam: PerspectiveCamera | null = null;
    camNode.traverse((o) => {
      if (!cam && (o as PerspectiveCamera).isPerspectiveCamera) cam = o as PerspectiveCamera;
    });
    const extra = extraNumber(camNode, "fov") ?? extraNumber(camNode, "fov_deg") ?? extraNumber(camNode, "yfov");
    if (extra !== undefined) fov = extra;
    else if (cam) fov = (cam as PerspectiveCamera).fov;
  }

  const moonNode = findNode(root, "moon");
  const moonDirection = new Vector3(0.45, -0.62, 0.64).normalize();
  if (moonNode) moonDirection.set(0, 0, -1).applyQuaternion(moonNode.getWorldQuaternion(new Quaternion())).normalize();

  // The lanes out of the fog, and the surprises with their ways out.
  const lanes: Lane[] = [];
  for (const id of ["road", "corn", "trees"] as const) {
    const nodes = ordered(root, `lane.${id}.`);
    if (nodes.length < 2) continue;
    lanes.push({ id, points: nodes.map((n) => v3(worldPos(n))), spread: extraNumber(nodes[0] as Object3D, "spread") ?? SPREAD[id], cover: 0 });
  }
  for (const id of ["bus", "booth", "fence"] as const) {
    const at = findNode(root, `spawn.${id}`);
    const path = ordered(root, `spawn.${id}.path.`);
    if (!at || path.length < 1) continue;
    lanes.push({ id, points: [v3(worldPos(at)), ...path.map((n) => v3(worldPos(n)))], spread: extraNumber(at, "spread") ?? SPREAD[id], cover: 0 });
  }

  const slots: Slot[] = ordered(root, "barricade.").map((n, index) => ({ index, pos: v3(worldPos(n)) }));

  const calib = ordered(root, "calib.");

  const sign = new Map<SignLetter, Object3D>();
  for (const letter of SIGN_LETTERS) {
    const n = findNode(root, `secret.sign.${letter}`);
    if (n) sign.set(letter, n);
  }
  const catSpots = ordered(root, "secret.cat.spot.").map(worldPos);
  const secrets: SecretNodes = {
    sign,
    scarecrow: findNode(root, "secret.scarecrow"),
    scarecrowHead: findNode(root, "secret.scarecrow.head"),
    boothLight: findNode(root, "secret.booth.light"),
    motelPhone: findNode(root, "secret.phone.motel"),
    driveInLamp: findNode(root, "secret.drivein.lamp"),
    driveInScreen: findNode(root, "secret.drivein.screen"),
    radio: findNode(root, "secret.radio"),
    catSpots,
    duck: findNode(root, "secret.duck"),
    moonDisc: findNode(root, "moon.disc"),
  };

  const groundShadow: Mesh[] = [];
  findNode(root, "ground.shadow")?.traverse((o) => {
    if ((o as Mesh).isMesh) groundShadow.push(o as Mesh);
  });
  const corn: Mesh[] = [];
  findNode(root, "corn")?.traverse((o) => {
    if ((o as Mesh).isMesh) corn.push(o as Mesh);
  });

  const skip = new Set<Object3D>([...groundShadow, ...corn]);
  const solids: Mesh[] = [];
  root.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh || skip.has(m)) return;
    if (m.userData["noCollide"] === true || surfaceOf(m) === "glass") return;
    solids.push(m);
  });

  // How far along the corn lane the corn hides them: until it steps out of it.
  const inCorn = cornCover(corn);
  for (const lane of lanes) if (lane.id === "corn") lane.cover = coverAlong(lane.points, inCorn);

  const survivorPaths: V3[][] = [];
  for (const [k] of nodesWithPrefix(root, "path.survivor.")) {
    const n = k.split(".")[0];
    if (n === undefined || survivorPaths[Number(n) - 1]) continue;
    const pts = ordered(root, `path.survivor.${n}.`).map((o) => v3(worldPos(o)));
    if (pts.length >= 2) survivorPaths[Number(n) - 1] = pts;
  }
  const paths = survivorPaths.filter(Boolean);

  return {
    root,
    eye,
    eyeQuaternion,
    fov,
    moonDirection,
    streetLight: findNode(root, "light.street"),
    neonLight: findNode(root, "light.neon"),
    motelLights: ordered(root, "light.motel."),
    lanes,
    slots,
    survivorPaths: paths.length ? paths : fallbackSurvivorPaths(ordered(root, "light.motel.").map(worldPos), eye),
    calib,
    secrets,
    groundShadow,
    corn,
    solids,
    bounds: new Box3().setFromObject(root),
  };
}

/**
 * Without the road's own `path.survivor.*`, a run across the road from the
 * corn's edge toward the motel's lit rooms, 20-30 m out, where a survivor
 * is clear of the barricade and plainly in view.
 */
function fallbackSurvivorPaths(motel: Vector3[], eye: Vector3): V3[][] {
  const door = motel[0] ?? new Vector3(eye.x + 14, 0, eye.z - 36);
  return [
    [
      { x: eye.x - 8.5, y: 0, z: eye.z - 20 },
      { x: eye.x + 4, y: 0, z: eye.z - 25 },
      { x: door.x - 1, y: 0, z: door.z },
    ],
    [
      { x: eye.x - 8, y: 0, z: eye.z - 25 },
      { x: eye.x + 6, y: 0, z: eye.z - 29 },
      { x: door.x - 1, y: 0, z: door.z - 4 },
    ],
  ];
}

/** Which 1 m cells (seen from above) the corn stands in. */
function cornCover(corn: readonly Mesh[]): (x: number, z: number) => boolean {
  const cells = new Set<string>();
  for (const m of corn) {
    m.updateMatrixWorld(true);
    const pos = m.geometry.getAttribute("position") as BufferAttribute | undefined;
    if (!pos) continue;
    if ((m as InstancedMesh).isInstancedMesh) {
      // An instanced field: each stalk's own place.
      const im = m as InstancedMesh;
      const mat = new Matrix4();
      for (let i = 0; i < im.count; i++) {
        im.getMatrixAt(i, mat);
        tmp.setFromMatrixPosition(mat).applyMatrix4(m.matrixWorld);
        cells.add(`${Math.floor(tmp.x)},${Math.floor(tmp.z)}`);
      }
      continue;
    }
    for (let i = 0; i < pos.count; i += 3) {
      tmp.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
      cells.add(`${Math.floor(tmp.x)},${Math.floor(tmp.z)}`);
    }
  }
  return (x, z) => {
    const cx = Math.floor(x);
    const cz = Math.floor(z);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) if (cells.has(`${cx + dx},${cz + dz}`)) return true;
    return false;
  };
}

/** How far along a path, from its start, it stays in the corn. */
function coverAlong(points: readonly V3[], inCorn: (x: number, z: number) => boolean): number {
  let along = 0;
  let last = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1] as V3;
    const b = points[i] as V3;
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    for (let s = 0; s < len; s += 0.5) {
      const k = s / len;
      if (inCorn(a.x + (b.x - a.x) * k, a.z + (b.z - a.z) * k)) last = along + s;
      else if (last > 0 && along + s - last > 1.5) return last;
    }
    along += len;
  }
  return last;
}
