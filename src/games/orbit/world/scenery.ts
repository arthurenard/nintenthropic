/**
 * Reading the art: the cupola (cupola.glb) and the station outside it
 * (station.glb), by the named nodes of the asset contract in
 * docs/ORBITAL_DECAY.md, into what the game uses - the eye and its lens,
 * the sun, the planet's place and turn, the seven panes as meshes and as
 * the rules' numbers, the laser's emitter, the running lights, the drone's
 * dock, path and work spots, the secrets' nodes and the debris lanes.
 * Anything the art leaves out falls back on the cupola as designed
 * (rules/layout.ts), with a word in the console.
 */
import { Group, Mesh, Object3D, PerspectiveCamera, Quaternion, Raycaster, Vector3, type BufferGeometry } from "three";
import { findNode, nodesWithPrefix, extraNumber } from "../../../engine/world/names";
import { designLanes, designLayout, frameSpots, paneFrom, viewAxes, VIEW_FOV_DEG, type Layout, type PaneSpec } from "../rules/layout";
import type { V3 } from "../rules/vec";

export interface PlanetPlace {
  /** Its centre, metres from the eye. */
  center: Vector3;
  /** Its frame (three's sphere: y north, x longitude 0) to the world. */
  rotation: Quaternion;
  radiusKm: number;
  altitudeKm: number;
  /** The faint "HI" of city lights, and a thunderstorm, as (longitude, latitude) degrees, if the art says. */
  hi: [number, number] | null;
  storm: [number, number] | null;
}

export interface Scenery {
  cupola: Group;
  station: Group;
  eye: Vector3;
  eyeQuaternion: Quaternion;
  /** The art's vertical field of view, degrees. */
  fov: number;
  /** Toward the sun as the art baked it. */
  sun: Vector3;
  planet: PlanetPlace;
  /** pane.center and pane.1…6, by id. */
  panes: Map<number, Mesh>;
  layout: Layout;
  hudAnchor: Object3D | null;
  floats: Object3D[];
  emitter: Object3D | null;
  /** calib.1…9 in order, with the colour of each running light. */
  calib: { node: Object3D; light: "red" | "green" | "white" }[];
  drone: { dock: Object3D | null; path: Vector3[]; work: Map<number, Object3D> };
  astronautPath: Object3D[];
  duckPath: Vector3[];
  secrets: { armHand: Object3D | null; capsuleWindow: Object3D | null; capsuleShade: Object3D | null };
}

const world = (o: Object3D) => o.getWorldPosition(new Vector3());
const toV3 = (v: Vector3): V3 => ({ x: v.x, y: v.y, z: v.z });

/** A pane's rules numbers from its mesh: its plane, outward normal and outline. */
export function paneSpec(id: number, mesh: Mesh, eye: Vector3): PaneSpec {
  mesh.updateMatrixWorld(true);
  const g = mesh.geometry as BufferGeometry;
  const pos = g.getAttribute("position");
  const pts: Vector3[] = [];
  for (let i = 0; i < pos.count; i++) pts.push(new Vector3().fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld));
  const centre = pts.reduce((s, p) => s.add(p), new Vector3()).multiplyScalar(1 / Math.max(1, pts.length));
  // The plane: the normal from the largest cross product round the centre (a flat pane).
  const normal = new Vector3();
  let best = 0;
  const a = new Vector3();
  const b = new Vector3();
  for (let i = 0; i < pts.length; i += Math.max(1, Math.floor(pts.length / 24))) {
    for (let j = i + 1; j < pts.length; j += Math.max(1, Math.floor(pts.length / 24))) {
      a.subVectors(pts[i] as Vector3, centre);
      b.subVectors(pts[j] as Vector3, centre);
      const c = a.clone().cross(b);
      if (c.lengthSq() > best) {
        best = c.lengthSq();
        normal.copy(c);
      }
    }
  }
  normal.normalize();
  if (normal.dot(centre.clone().sub(eye)) < 0) normal.negate();
  // The outline: the convex hull of the points in the plane (a gift wrap in 2D).
  const u = new Vector3().copy(normal).cross(Math.abs(normal.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0)).normalize();
  const w = normal.clone().cross(u);
  const flat = pts.map((p) => {
    const d = p.clone().sub(centre);
    return { x: d.dot(u), y: d.dot(w) };
  });
  const hull = convexHull(flat);
  const corners = hull.map((p) => toV3(centre.clone().addScaledVector(u, p.x).addScaledVector(w, p.y)));
  return paneFrom(id, corners, toV3(normal));
}

function convexHull(points: { x: number; y: number }[]): { x: number; y: number }[] {
  const pts = [...points].sort((p, q) => p.x - q.x || p.y - q.y);
  if (pts.length < 3) return pts;
  const cross = (o: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: { x: number; y: number }[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 1e-12) lower.pop();
    lower.push(p);
  }
  const upper: { x: number; y: number }[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 1e-12) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/**
 * How much of each lane's way in the player can see: points along the line
 * from the lane to the cupola, each checked from the eye against what is in
 * the way - the station, and the cupola's own frame between the windows
 * (not its glass). The last few metres always show. With a `radius`, a
 * point counts only if a thing that big would show whole there (its middle
 * and four edges): for the Derelict.
 */
export function laneClearance(occluders: readonly Object3D[], eye: Vector3, lanes: readonly V3[], target: Vector3, samples = 10, radius = 0): number[] {
  const meshes: Object3D[] = [];
  for (const root of occluders) {
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      if ((o as Mesh).isMesh) meshes.push(o);
    });
  }
  const ray = new Raycaster();
  const dir = new Vector3();
  const p = new Vector3();
  const q = new Vector3();
  const side = new Vector3();
  const up = new Vector3();
  const open = (at: Vector3): boolean => {
    const d = at.distanceTo(eye);
    dir.subVectors(at, eye).normalize();
    ray.set(eye, dir);
    ray.far = d - 0.5;
    return ray.intersectObjects(meshes, false).length === 0;
  };
  return lanes.map((lane) => {
    const from = new Vector3(lane.x, lane.y, lane.z);
    let seen = 0;
    let counted = 0;
    for (let i = 0; i < samples; i++) {
      p.lerpVectors(from, target, (i + 0.5) / samples);
      if (p.distanceTo(eye) < 4) continue;
      counted++;
      let whole = open(p);
      if (whole && radius > 0) {
        dir.subVectors(p, eye).normalize();
        side.crossVectors(dir, Math.abs(dir.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0)).normalize();
        up.crossVectors(side, dir);
        for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          q.copy(p).addScaledVector(side, a * radius).addScaledVector(up, b * radius);
          if (!open(q)) {
            whole = false;
            break;
          }
        }
      }
      if (whole) seen++;
    }
    return counted > 0 ? seen / counted : 1;
  });
}

function lonLatExtra(o: Object3D | null, key: string): [number, number] | null {
  const v = o?.userData[key];
  if (Array.isArray(v) && v.length >= 2 && typeof v[0] === "number" && typeof v[1] === "number") return [v[0], v[1]];
  return null;
}

/** Read both files into the game's view of the scene. */
export function readScenery(cupola: Group, station: Group): Scenery {
  cupola.updateMatrixWorld(true);
  station.updateMatrixWorld(true);
  const missing: string[] = [];
  const need = (root: Object3D, name: string): Object3D | null => {
    const n = findNode(root, name);
    if (!n) missing.push(name);
    return n;
  };

  // The eye.
  const cam = need(cupola, "camera.player");
  const eye = cam ? world(cam) : new Vector3();
  const eyeQuaternion = cam ? cam.getWorldQuaternion(new Quaternion()) : new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), (-20 * Math.PI) / 180);
  let fov = VIEW_FOV_DEG;
  const camFov = cam ? (extraNumber(cam, "fov_deg") ?? (cam as PerspectiveCamera).fov) : undefined;
  if (typeof camFov === "number" && camFov > 10 && camFov < 120) fov = camFov;

  // The sun: its node's −Z runs along the sunlight, so +Z points at the sun.
  const sunNode = findNode(cupola, "sun") ?? need(station, "sun");
  const sun = sunNode ? new Vector3(0, 0, 1).applyQuaternion(sunNode.getWorldQuaternion(new Quaternion())).normalize() : new Vector3(-0.6, 0.6, -0.5).normalize();

  // The planet: its centre and axes.
  const planetNode = findNode(cupola, "planet") ?? need(station, "planet");
  const planet: PlanetPlace = {
    center: planetNode ? world(planetNode) : new Vector3(0, -6791000, -1200000),
    rotation: planetNode ? planetNode.getWorldQuaternion(new Quaternion()) : new Quaternion(),
    radiusKm: (planetNode ? extraNumber(planetNode, "radius_m") : undefined) !== undefined ? extraNumber(planetNode!, "radius_m")! / 1000 : 6371,
    altitudeKm: (planetNode ? extraNumber(planetNode, "altitude_m") : undefined) !== undefined ? extraNumber(planetNode!, "altitude_m")! / 1000 : 420,
    hi: lonLatExtra(planetNode, "hi_lonlat"),
    storm: lonLatExtra(planetNode, "storm_lonlat"),
  };

  // The panes, as meshes and as the rules' numbers.
  const panes = new Map<number, Mesh>();
  const specs: PaneSpec[] = [];
  const paneMesh = (o: Object3D | null): Mesh | null => {
    if (!o) return null;
    if ((o as Mesh).isMesh) return o as Mesh;
    let found: Mesh | null = null;
    o.traverse((c) => {
      if (!found && (c as Mesh).isMesh) found = c as Mesh;
    });
    return found;
  };
  for (let id = 0; id <= 6; id++) {
    const m = paneMesh(need(cupola, id === 0 ? "pane.center" : `pane.${id}`));
    if (!m) continue;
    panes.set(id, m);
    specs.push(paneSpec(id, m, eye));
  }
  const design = designLayout();
  const paneList = specs.length === 7 ? specs.sort((a, b) => a.id - b.id) : design.panes;
  const spawns = [...nodesWithPrefix(station, "spawn.").values()].map((n) => toV3(world(n)));
  if (spawns.length === 0) missing.push("spawn.*");
  const fwd = new Vector3(0, 0, -1).applyQuaternion(eyeQuaternion);
  const layout: Layout = {
    eye: toV3(eye),
    forward: cam ? toV3(fwd) : viewAxes().forward,
    panes: paneList,
    lanes: spawns.length > 0 ? spawns : designLanes(),
    frame: frameSpots(paneList),
  };

  const floats = [...nodesWithPrefix(cupola, "float.").entries()].filter(([k]) => /^\d+$/.test(k)).map(([, n]) => n);
  const calib: Scenery["calib"] = [];
  for (let i = 1; i <= 9; i++) {
    const n = need(station, `calib.${i}`);
    if (!n) continue;
    const kind = n.userData["light"];
    calib.push({ node: n, light: kind === "red" || kind === "green" || kind === "white" ? kind : i % 3 === 1 ? "red" : i % 3 === 2 ? "white" : "green" });
  }
  const path = [...nodesWithPrefix(station, "drone.path.").entries()]
    .filter(([k]) => /^\d+$/.test(k))
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([, n]) => world(n));
  const work = new Map<number, Object3D>();
  for (const [k, n] of nodesWithPrefix(station, "drone.work.")) if (/^\d+$/.test(k)) work.set(Number(k), n);
  const byNumber = (prefix: string) =>
    [...nodesWithPrefix(station, prefix).entries()]
      .filter(([k]) => /^\d+$/.test(k))
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([, n]) => n);

  const scenery: Scenery = {
    cupola,
    station,
    eye,
    eyeQuaternion,
    fov,
    sun,
    planet,
    panes,
    layout,
    hudAnchor: findNode(cupola, "hud.anchor"),
    floats,
    emitter: need(station, "emitter"),
    calib,
    drone: { dock: need(station, "drone.dock"), path, work },
    astronautPath: byNumber("astronaut.path."),
    duckPath: byNumber("secret.duck.path.").map(world),
    secrets: {
      armHand: need(station, "secret.arm.hand"),
      capsuleWindow: need(station, "secret.capsule.window"),
      capsuleShade: findNode(station, "secret.capsule.shade"),
    },
  };
  if (missing.length) console.info(`Orbital Decay: the art has no ${missing.join(", ")}; the design's stands in.`);
  return scenery;
}
