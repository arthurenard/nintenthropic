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

/** The great wall the echo comes back from: a hit within its rectangle, facing the eye. */
export interface CliffFace {
  centre: Vector3;
  halfWidth: number;
  halfHeight: number;
}

/**
 * What the real valley's terrain shader reads, from `terrain.splat`'s
 * extras (art/ridge/README.md): the maps and tiles by file, each tile's size
 * and mean albedo, and how the maps are laid out.
 */
export interface TerrainArtSpec {
  files: Record<string, string>;
  tiles: { name: string; size: number; mean: [number, number, number]; triplanar: boolean }[];
  mapping: { theta0: number; theta1: number; r0: number; r1: number };
}

/** The light and the air the art was rendered in (valley.glb's scene extras), for the game to match. */
export interface ValleyLight {
  sunColor: [number, number, number];
  sunToSky: number;
  hazeSigma: number;
  hazeColor: [number, number, number];
  mistSigma: number;
  mistBase: number;
  mistScaleHeight: number;
  mistColor: [number, number, number];
  /** The whole frame's white balance for the shade the valley lies in, before tone mapping. */
  whiteBalance: [number, number, number];
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
  /** The ground: one mesh (the placeholder) or a group of chunks (the real valley). */
  terrain: Object3D | null;
  terrainMeshes: Mesh[];
  /** The placeholder's splat and tiles, or null. */
  terrainInputs: TerrainInputs | null;
  /** The real valley's terrain maps and tiles as its extras name them, or null. */
  terrainArt: TerrainArtSpec | null;
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
  /** Mist lying on the river (`mist.river.<n>`), for a drifting mist shader. */
  mist: Mesh[];
  /** The art's own grass right under the scope, if it made some. */
  foregroundGrass: Mesh | null;
  cliffFace: CliffFace | null;
  /** The art's light and air, or null (the placeholder is lit by the game's own values). */
  light: ValleyLight | null;
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
  const extra = node.userData["place"];
  if (typeof extra === "string") return extra;
  if (kind === "tower") return "on the watchtower";
  if (kind === "gunner") return "at the guard post";
  if (kind === "mortar") return "behind the village";
  if (/tunnel/.test(id)) return "at the tunnel";
  if (/dam/.test(id)) return "on the dam";
  if (/bridge/.test(id)) return "at the bridge";
  if (/village|chapel/.test(id)) return "in the village";
  if (/farm/.test(id)) return "at the farm";
  return "at the guard post";
}

/** How a counter-sniper's nest is named in the note, from its extras. */
function nestPlace(node: Object3D, nearBell: boolean): string {
  const extra = node.userData["place"];
  if (typeof extra === "string") return extra;
  const note = String(node.userData["note"] ?? "").toLowerCase();
  if (nearBell || /chapel|belfry|tower/.test(note)) return "in the chapel tower";
  if (/alp|barn/.test(note)) return "in the rocks above the alp";
  if (/crag|ledge/.test(note)) return "on the far ledge";
  return "on the far slope";
}

/** An extras value that may be a JSON string (Blender exports nested extras as strings). */
function extraJson<T>(o: Object3D | null, key: string): T | null {
  const v = o?.userData[key];
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") return v as T;
  try {
    return JSON.parse(v) as T;
  } catch {
    return null;
  }
}

/** The scene's lighting and fog extras (on the glTF scene, which three.js hands over as the root). */
function valleyLight(root: Object3D): ValleyLight | null {
  const lighting = extraJson<{ sun_color?: [number, number, number]; sun_to_sky_ratio?: number }>(root, "lighting");
  const fog = extraJson<{
    haze_sigma_per_m?: number;
    haze_color_linear?: [number, number, number];
    mist_sigma0_per_m?: number;
    mist_z0_m_gltf_y?: number;
    mist_scale_height_m?: number;
    mist_color_linear?: [number, number, number];
    grade_white_balance?: [number, number, number];
  }>(root, "fog");
  if (!lighting && !fog) return null;
  return {
    sunColor: lighting?.sun_color ?? [1, 0.5, 0.26],
    sunToSky: lighting?.sun_to_sky_ratio ?? 4,
    hazeSigma: fog?.haze_sigma_per_m ?? 1 / 14000,
    hazeColor: fog?.haze_color_linear ?? [0.36, 0.46, 0.62],
    mistSigma: fog?.mist_sigma0_per_m ?? 1 / 650,
    mistBase: fog?.mist_z0_m_gltf_y ?? -60,
    mistScaleHeight: fog?.mist_scale_height_m ?? 22,
    mistColor: fog?.mist_color_linear ?? [0.31, 0.35, 0.4],
    whiteBalance: fog?.grade_white_balance ?? [1, 1, 1],
  };
}

/** The real terrain's shader inputs, from `terrain.splat`'s extras. */
function terrainArtSpec(root: Object3D): TerrainArtSpec | null {
  const node = findNode(root, "terrain.splat");
  if (!node) return null;
  const files = extraJson<Record<string, string>>(node, "files");
  const tiles = extraJson<Record<string, { size_m: number; mean_linear: [number, number, number]; projection: string }>>(node, "tiles");
  const order = extraJson<string[]>(node, "materials") ?? ["grass", "rock", "scree", "snow", "dirt", "forest", "gravel", "alpine"];
  const mapping = extraJson<{ theta0_deg: number; theta1_deg: number; r0_m: number; r1_m: number }>(node, "mapping");
  if (!files || !tiles) return null;
  return {
    files,
    tiles: order.map((name) => {
      const t = tiles[name];
      return { name, size: t?.size_m ?? 3, mean: t?.mean_linear ?? [0.2, 0.2, 0.2], triplanar: t?.projection === "triplanar" };
    }),
    mapping: {
      theta0: ((mapping?.theta0_deg ?? -62) * Math.PI) / 180,
      theta1: ((mapping?.theta1_deg ?? 62) * Math.PI) / 180,
      r0: mapping?.r0_m ?? 30,
      r1: mapping?.r1_m ?? 6000,
    },
  };
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
    const extra = extraNumber(camNode, "fov") ?? extraNumber(camNode, "fov_deg") ?? extraNumber(camNode, "yfov");
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
    const bellNode = findNode(root, "secret.bell");
    const place = nestPlace(node, bellNode !== null && w(node).distanceTo(w(bellNode)) < 12);
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
  const eagleRockNode = findNode(root, "eagle.land") ?? findNode(root, "eagle.rock");
  // Mortar teams, if the art placed none: dug in behind the village and beyond the bridge,
  // on the ground a little further from the ridge than the posts they are named by.
  if (!posts.some((p) => p.kind === "mortar")) {
    const village = posts.find((p) => /village/.test(p.id));
    const bridgeFar = posts.find((p) => /bridge_far|bridge\.far/.test(p.id));
    for (const [from, id, place] of [
      [village, "mortar.village", "behind the village"],
      [bridgeFar, "mortar.bridge", "beyond the bridge"],
    ] as const) {
      if (!from) continue;
      const d = Math.hypot(from.at.x - eye.x, from.at.z - eye.z) || 1;
      const at = { x: from.at.x + ((from.at.x - eye.x) / d) * 45, y: from.at.y, z: from.at.z + ((from.at.z - eye.z) / d) * 45 };
      posts.push({ id, kind: "mortar", at, heading: Math.atan2(eye.x - at.x, eye.z - at.z), place });
    }
  }
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
  const terrain = findNode(root, "terrain");
  const terrainMeshes: Mesh[] = [];
  terrain?.traverse((o) => {
    if ((o as Mesh).isMesh) terrainMeshes.push(o as Mesh);
  });
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

  const terrainArt = ph ? null : terrainArtSpec(root);

  const river = (findNode(root, "water.river") as Mesh | null) ?? null;
  const mist: Mesh[] = [];
  for (const [, node] of nodesWithPrefix(root, "mist.")) if ((node as Mesh).isMesh) mist.push(node as Mesh);
  const foregroundGrass = (findNode(root, "foreground.grass") as Mesh | null) ?? null;
  const cliffNode = findNode(root, "secret.cliff");
  const cliffFace: CliffFace | null =
    cliffNode && extraNumber(cliffNode, "half_width_m") !== undefined
      ? { centre: w(cliffNode), halfWidth: extraNumber(cliffNode, "half_width_m") ?? 150, halfHeight: extraNumber(cliffNode, "half_height_m") ?? 80 }
      : null;
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
    if (terrainMeshes.includes(m) || mist.includes(m) || m === foregroundGrass) return;
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
    terrainMeshes,
    terrainInputs,
    terrainArt,
    river,
    reservoir,
    forest,
    solids,
    water,
    plates,
    secrets,
    flag,
    mist,
    foregroundGrass,
    cliffFace,
    light: valleyLight(root),
  };
}
