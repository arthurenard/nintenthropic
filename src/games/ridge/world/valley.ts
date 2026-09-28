/**
 * The Valle Serra as the game needs it, read from the named nodes of
 * valley.glb (or the placeholder built to the same contract): the eye and
 * the sun, the rules' plan (posts, nests, paths, the bridge's line, the
 * animals' spots), the terrain and what paints it, the water, the forest,
 * everything a round stops at and what it is made of, the aim check's
 * plates, and the secrets' props.
 */
import {
  InstancedMesh,
  Mesh,
  Object3D,
  PerspectiveCamera,
  Quaternion,
  Vector3,
  type DataArrayTexture,
  type Group,
  type Texture,
} from "three";
import { contractName, extraNumber, extraString, findNode, nodesWithPrefix } from "../../../engine/world/names";
import type { Nest, Plan, Post, V3 } from "../rules/types";
import type { TerrainInputs } from "./terrain";
import { DEFAULT_SCALES } from "./terrain";

export type Surface = "grass" | "rock" | "snow" | "dirt" | "stone" | "wood" | "metal" | "glass" | "water" | "cloth";

const SURFACES: readonly Surface[] = ["grass", "rock", "snow", "dirt", "stone", "wood", "metal", "glass", "water", "cloth"];

export function surfaceOf(o: Object3D | null): Surface {
  const s = extraString(o, "surface");
  if (s && (SURFACES as readonly string[]).includes(s)) return s as Surface;
  const mesh = o as Mesh | null;
  const mat = mesh?.material;
  const m = Array.isArray(mat) ? mat[0] : mat;
  const fromMaterial = m?.userData?.["surface"];
  if (typeof fromMaterial === "string" && (SURFACES as readonly string[]).includes(fromMaterial)) return fromMaterial as Surface;
  const name = `${o ? contractName(o) : ""} ${m?.name ?? ""}`.toLowerCase();
  if (/water|river|reservoir/.test(name)) return "water";
  if (/glass|window/.test(name)) return "glass";
  if (/metal|steel|iron|bell|siren|plate/.test(name)) return "metal";
  if (/wood|plank|barn|fence|pole|tree|forest/.test(name)) return "wood";
  if (/rock|cliff|boulder/.test(name)) return "rock";
  if (/snow/.test(name)) return "snow";
  if (/terrain|ground|grass/.test(name)) return "grass";
  return "stone";
}

export interface ValleySecrets {
  bell: Object3D | null;
  siren: Object3D | null;
  wedge: Object3D | null;
  cheese: Object3D | null;
  yeti: Object3D | null;
  yetiRock: Object3D | null;
  cliff: Object3D | null;
  /** A duck model, if the art made one (else the world makes it). */
  duck: Object3D | null;
}

export interface ValleyLayout {
  root: Group;
  eye: Vector3;
  eyeQuaternion: Quaternion;
  /** The art camera's vertical field of view, degrees. */
  fov: number;
  /** The direction sunlight travels (the `sun` node's −Z). */
  sunDirection: Vector3;
  plan: Plan;
  terrain: Mesh | null;
  terrainInputs: TerrainInputs | null;
  river: Mesh | null;
  reservoir: Mesh | null;
  forest: InstancedMesh[];
  /** Everything a round stops at (not the terrain, the forest or the water). */
  solids: Mesh[];
  water: Mesh[];
  plates: Object3D[];
  secrets: ValleySecrets;
  /** The checkpoint's flag, flown by the wind. */
  flag: Mesh | null;
}

const w = (o: Object3D) => o.getWorldPosition(new Vector3());
const asV3 = (v: Vector3): V3 => ({ x: v.x, y: v.y, z: v.z });

/** A numbered path (`<prefix><n>`), in order. */
function pathFrom(root: Object3D, prefix: string): V3[] {
  return [...nodesWithPrefix(root, prefix).entries()]
    .map(([k, o]) => ({ n: Number(k), o }))
    .filter((e) => Number.isFinite(e.n))
    .sort((a, b) => a.n - b.n)
    .map((e) => asV3(w(e.o)));
}

/** How a post is named in the note, from its extras or its id. */
function placeOf(id: string, kind: string, node: Object3D): string {
  const extra = extraString(node, "place");
  if (extra) return extra;
  if (kind === "tower") return "on the watchtower";
  if (kind === "gunner") return "at the checkpoint";
  if (kind === "mortar") return "behind the village";
  if (/dam/.test(id)) return "on the dam";
  if (/bridge/.test(id)) return "at the bridge";
  if (/village|chapel/.test(id)) return "in the village";
  if (/farm/.test(id)) return "at the farm";
  return "at the checkpoint";
}

/** The heading a node faces (its +Z turned about Y). */
function headingOf(o: Object3D): number {
  const f = new Vector3(0, 0, 1).applyQuaternion(o.getWorldQuaternion(new Quaternion()));
  return Math.atan2(f.x, f.z);
}

export function readValley(root: Group): ValleyLayout {
  root.updateMatrixWorld(true);

  // The eye: a glTF camera or an empty with `fov` extras.
  const camNode = findNode(root, "camera.player");
  const eye = camNode ? w(camNode) : new Vector3(0, 0, 0);
  const eyeQuaternion = camNode ? camNode.getWorldQuaternion(new Quaternion()) : new Quaternion();
  let fov = 46;
  if (camNode) {
    let cam: PerspectiveCamera | null = null;
    camNode.traverse((o) => {
      if (!cam && (o as PerspectiveCamera).isPerspectiveCamera) cam = o as PerspectiveCamera;
    });
    const extra = extraNumber(camNode, "fov") ?? extraNumber(camNode, "yfov");
    if (extra !== undefined) fov = extra;
    else if (cam) fov = (cam as PerspectiveCamera).fov;
  }
  // A glTF camera looks down its −Z already; an empty stands for the same.
  const sunNode = findNode(root, "sun");
  const sunDirection = new Vector3(0.45, -0.1, -0.85).normalize();
  if (sunNode) sunDirection.set(0, 0, -1).applyQuaternion(sunNode.getWorldQuaternion(new Quaternion())).normalize();

  // The posts and the nests.
  const posts: Post[] = [];
  for (const [id, node] of nodesWithPrefix(root, "post.")) {
    const raw = extraString(node, "kind") ?? "sentry";
    const kind = (["sentry", "tower", "gunner", "guard", "mortar"] as const).find((k) => k === raw) ?? "sentry";
    posts.push({ id, kind, at: asV3(w(node)), heading: headingOf(node), place: placeOf(id, kind, node) });
  }
  const nests: Nest[] = [];
  for (const [key, node] of nodesWithPrefix(root, "sniper.")) {
    if (key.includes(".")) continue;
    let exposed: Object3D | null = null;
    let hidden: Object3D | null = null;
    node.traverse((o) => {
      const n = contractName(o);
      if (o !== node && n.endsWith("exposed")) exposed = o;
      if (o !== node && n.endsWith("hidden")) hidden = o;
    });
    const at = asV3(w(exposed ?? node));
    const back = hidden ? asV3(w(hidden)) : { x: at.x, y: at.y - 0.8, z: at.z };
    const place = extraString(node, "place") ?? (w(node).distanceTo(findNode(root, "secret.bell") ? w(findNode(root, "secret.bell")!) : new Vector3(1e9, 0, 0)) < 12 ? "in the chapel tower" : "on the far ledge");
    nests.push({ id: key, exposed: at, hidden: back, heading: Math.atan2(eye.x - at.x, eye.z - at.z), place });
  }

  // The paths.
  const dam = pathFrom(root, "path.dam.");
  const tunnel = findNode(root, "tunnel");
  if (tunnel) dam.push(asV3(w(tunnel)));
  const road = pathFrom(root, "path.road.");
  const bridgeNode = findNode(root, "bridge.cross");
  const bell = findNode(root, "secret.bell");
  const chapelAt = bell ? w(bell) : new Vector3(-100, -60, -480);
  const cows = pathFrom(root, "animals.cows.");
  const farmPost = posts.find((p) => /farm/.test(p.id));
  const farm = farmPost?.at ?? cows[0] ?? { x: -120, y: -60, z: -210 };
  const eagleRockNode = findNode(root, "eagle.rock");
  const plan: Plan = {
    eye: asV3(eye),
    posts,
    road,
    bridge: bridgeNode ? asV3(w(bridgeNode)) : road[Math.floor(road.length / 2)] ?? { x: 0, y: -60, z: -300 },
    patrol: pathFrom(root, "path.patrol."),
    dam,
    farmer: pathFrom(root, "path.farmer."),
    cyclist: pathFrom(root, "path.cyclist."),
    shepherd: pathFrom(root, "path.shepherd."),
    cheese: pathFrom(root, "path.cheese."),
    nests,
    cows,
    sheep: pathFrom(root, "animals.sheep."),
    goatLedges: pathFrom(root, "secret.goat."),
    eagle: pathFrom(root, "eagle.path."),
    eagleRock: eagleRockNode ? asV3(w(eagleRockNode)) : { x: eye.x + 0.9, y: eye.y - 0.3, z: eye.z - 3.6 },
    duck: pathFrom(root, "secret.duck.path."),
    // The children play at the chapel's foot.
    chapel: { x: chapelAt.x + 6, y: chapelAt.y - 17, z: chapelAt.z + 8 },
    farm,
  };

  // The terrain and what paints it.
  const terrain = (findNode(root, "terrain") as Mesh | null) ?? null;
  let terrainInputs: TerrainInputs | null = null;
  const ph = terrain?.userData["placeholder"] as
    | { splat: { maps: [Texture, Texture]; bounds: [number, number, number, number] }; coarse: { maps: [Texture, Texture]; bounds: [number, number, number, number] }; tiles: DataArrayTexture }
    | undefined;
  if (ph) {
    terrainInputs = {
      fine: { a: ph.splat.maps[0], b: ph.splat.maps[1], bounds: ph.splat.bounds },
      coarse: { a: ph.coarse.maps[0], b: ph.coarse.maps[1], bounds: ph.coarse.bounds },
      tiles: ph.tiles,
      scales: DEFAULT_SCALES,
    };
  }

  const river = (findNode(root, "water.river") as Mesh | null) ?? null;
  const reservoir = (findNode(root, "water.reservoir") as Mesh | null) ?? null;
  const forest: InstancedMesh[] = [];
  for (const [, node] of nodesWithPrefix(root, "forest.")) {
    node.traverse((o) => {
      if ((o as InstancedMesh).isInstancedMesh && !forest.includes(o as InstancedMesh)) forest.push(o as InstancedMesh);
    });
  }

  const secrets: ValleySecrets = {
    bell,
    siren: findNode(root, "secret.siren"),
    wedge: findNode(root, "secret.cart.wedge"),
    cheese: findNode(root, "secret.cheese"),
    yeti: findNode(root, "secret.yeti"),
    yetiRock: findNode(root, "secret.yeti.rock"),
    cliff: findNode(root, "secret.cliff"),
    duck: findNode(root, "secret.duck"),
  };

  const plates: Object3D[] = [];
  for (let i = 1; i <= 9; i++) {
    const p = findNode(root, `calib.${i}`);
    if (p) plates.push(p);
  }

  // What a round stops at: every mesh but the ground, the trees and the water (handled apart).
  const solids: Mesh[] = [];
  const water: Mesh[] = [];
  root.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh || (o as InstancedMesh).isInstancedMesh) return;
    if (m === terrain) return;
    if (m === river || m === reservoir) {
      water.push(m);
      return;
    }
    let inPlate = false;
    for (let p: Object3D | null = o; p; p = p.parent) if (plates.includes(p)) inPlate = true;
    if (inPlate) return;
    solids.push(m);
  });
  const flag = (findNode(root, "flag") as Mesh | null) ?? null;

  return {
    root,
    eye,
    eyeQuaternion,
    fov,
    sunDirection,
    plan,
    terrain,
    terrainInputs,
    river,
    reservoir,
    forest,
    solids,
    water,
    plates,
    secrets,
    flag,
  };
}
