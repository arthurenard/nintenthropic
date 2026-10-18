/**
 * The placeholder valley's buildings and things: the farm, the checkpoint
 * and its watchtower, the stone bridge, the village and its chapel, the dam
 * and its tunnel, telegraph poles along the road, the aim check's steel
 * plates, and the secrets' props - the bell, the siren, the cheese on its
 * cart, the goat's ledges, the yeti's rock, the great cliff. Stone, plaster,
 * tiles and planks from textures.ts, mapped in metres so they hold up
 * through the scope.
 */
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  DoubleSide,
  Group,
  LatheGeometry,
  Material,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  Vector3,
  type Texture,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { nameNode } from "../../../engine/world/names";
import {
  BARN,
  BRIDGE,
  BRIDGE_DECK,
  BRIDGE_SPAN,
  CART,
  CHAPEL,
  CHAPEL_TOWER_HEIGHT,
  CHECKPOINT,
  CLIFF,
  DAM,
  EAGLE_ROCK,
  FARM,
  GOAT_LEDGES,
  GOAT_LIFT,
  HOUSES,
  noise,
  PASTURE,
  platePositions,
  pointOn,
  RIVER_LEVEL,
  ROAD,
  SANDBAGS,
  terrainHeight,
  TOWER,
  TOWER_HEIGHT,
  TUNNEL,
  YETI_ROCK,
} from "./layout";
import { buildingTextures, type BuildingSurface } from "./textures";

type Ground = (x: number, z: number) => number;

/** A box whose UVs are in metres over `tile` (so a texture repeats once every `tile` metres on every face). */
function metricBox(w: number, h: number, d: number, tile = 2): BufferGeometry {
  const g = new BoxGeometry(w, h, d);
  const uv = g.getAttribute("uv") as BufferAttribute;
  // Faces in order: +x, −x, +y, −y, +z, −z (four vertices each).
  const dims: [number, number][] = [
    [d, h],
    [d, h],
    [w, d],
    [w, d],
    [w, h],
    [w, h],
  ];
  for (let f = 0; f < 6; f++) {
    const [su, sv] = dims[f]!;
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      uv.setXY(i, (uv.getX(i) * su) / tile, (uv.getY(i) * sv) / tile);
    }
  }
  return g;
}

/** A gabled roof over a `w` by `d` footprint, ridge along X, `rise` high, `overhang` past the walls. */
function gableRoof(w: number, d: number, rise: number, overhang = 0.5, tile = 2): BufferGeometry {
  const hw = w / 2 + overhang;
  const hd = d / 2 + overhang;
  const slope = Math.hypot(hd, rise);
  // Two slopes and two gable ends.
  const pos = [
    // front slope (+z)
    -hw, 0, hd, hw, 0, hd, hw, rise, 0, -hw, rise, 0,
    // back slope (−z)
    hw, 0, -hd, -hw, 0, -hd, -hw, rise, 0, hw, rise, 0,
    // gable ends
    -w / 2, 0, d / 2, -w / 2, 0, -d / 2, -w / 2, rise * (1 - overhang / hd), 0,
    w / 2, 0, -d / 2, w / 2, 0, d / 2, w / 2, rise * (1 - overhang / hd), 0,
  ];
  const uv = [
    0, 0, (2 * hw) / tile, 0, (2 * hw) / tile, slope / tile, 0, slope / tile,
    0, 0, (2 * hw) / tile, 0, (2 * hw) / tile, slope / tile, 0, slope / tile,
    0, 0, d / tile, 0, d / 2 / tile, rise / tile,
    0, 0, d / tile, 0, d / 2 / tile, rise / tile,
  ];
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute("uv", new BufferAttribute(new Float32Array(uv), 2));
  g.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 8, 9, 10, 11, 12, 13]);
  g.computeVertexNormals();
  return g;
}

/** A square pyramid roof (a tower's spire). */
function pyramid(w: number, rise: number): BufferGeometry {
  const g = new CylinderGeometry(0, (w / 2) * Math.SQRT2, rise, 4, 1);
  g.rotateY(Math.PI / 4);
  g.translate(0, rise / 2, 0);
  return g;
}

interface Materials {
  mat(surface: BuildingSurface | "metal" | "paint" | "red" | "rock" | "snow" | "cheese" | "glass" | "window" | "hay" | "wood" | "yeti" | "steel"): MeshStandardMaterial;
}

function materials(): Materials {
  const tex = buildingTextures();
  const cache = new Map<string, MeshStandardMaterial>();
  const surfaceOf: Record<string, string> = {
    stone: "stone",
    plaster: "stone",
    tiles: "stone",
    slate: "stone",
    planks: "wood",
    wood: "wood",
    concrete: "stone",
    sandbag: "cloth",
    canvas: "cloth",
    metal: "metal",
    steel: "metal",
    paint: "metal",
    red: "wood",
    rock: "rock",
    snow: "snow",
    cheese: "cloth",
    glass: "glass",
    window: "glass",
    hay: "grass",
    yeti: "cloth",
  };
  const make = (name: string): MeshStandardMaterial => {
    const t = (tex as Record<string, Texture | undefined>)[name];
    let m: MeshStandardMaterial;
    switch (name) {
      case "metal":
        m = new MeshStandardMaterial({ color: "#3b3d3c", roughness: 0.55, metalness: 0.6 });
        break;
      case "steel":
        m = new MeshStandardMaterial({ color: "#5d6264", roughness: 0.45, metalness: 0.8 });
        break;
      case "paint":
        m = new MeshStandardMaterial({ color: "#f1efe8", roughness: 0.7 });
        break;
      case "red":
        m = new MeshStandardMaterial({ color: "#b02a22", roughness: 0.7 });
        break;
      case "rock":
        m = new MeshStandardMaterial({ color: "#8e8c86", roughness: 0.95, map: tex.stone });
        break;
      case "snow":
        m = new MeshStandardMaterial({ color: "#f2f5fa", roughness: 0.8 });
        break;
      case "cheese":
        m = new MeshStandardMaterial({ color: "#e9c25a", roughness: 0.6 });
        break;
      case "glass":
      case "window":
        m = new MeshStandardMaterial({ color: "#1b2226", roughness: 0.15, metalness: 0.2 });
        break;
      case "hay":
        m = new MeshStandardMaterial({ color: "#c4a55c", roughness: 1 });
        break;
      case "wood":
        m = new MeshStandardMaterial({ color: "#8a6a4a", roughness: 0.9, map: tex.planks });
        break;
      case "yeti":
        m = new MeshStandardMaterial({ color: "#eef0f2", roughness: 1 });
        break;
      default:
        m = new MeshStandardMaterial({ color: "#ffffff", roughness: 0.92, ...(t ? { map: t } : {}) });
    }
    m.name = name;
    m.userData["surface"] = surfaceOf[name] ?? "stone";
    return m;
  };
  return {
    mat(surface) {
      let m = cache.get(surface);
      if (!m) {
        m = make(surface);
        cache.set(surface, m);
      }
      return m;
    },
  };
}

/** Meshes gathered per material and merged: a few draw calls for a whole village. */
class Batch {
  private readonly parts = new Map<Material, BufferGeometry[]>();
  add(g: BufferGeometry, m: Material, at: Vector3, rotY = 0): void {
    const geo = g.index ? g.toNonIndexed() : g;
    geo.rotateY(rotY);
    geo.translate(at.x, at.y, at.z);
    if (!geo.getAttribute("uv")) geo.setAttribute("uv", new BufferAttribute(new Float32Array(geo.getAttribute("position").count * 2), 2));
    // mergeGeometries wants the same attributes everywhere.
    for (const name of Object.keys(geo.attributes)) if (name !== "position" && name !== "normal" && name !== "uv") geo.deleteAttribute(name);
    const list = this.parts.get(m) ?? [];
    list.push(geo);
    this.parts.set(m, list);
  }
  build(name: string, into: Object3D): void {
    let k = 0;
    for (const [m, list] of this.parts) {
      const merged = mergeGeometries(list);
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = nameNode(new Mesh(merged, m), `${name}.${k++}`);
      mesh.userData["surface"] = m.userData["surface"];
      into.add(mesh);
    }
  }
}

const v3 = (x: number, y: number, z: number) => new Vector3(x, y, z);

/** A stone house: walls, a gabled roof, dark windows and a door. */
function house(b: Batch, M: Materials, x: number, z: number, w: number, d: number, turn: number, ground: Ground, plastered: boolean, slate: boolean): void {
  const y = ground(x, z) - 0.6;
  const h = 5.2 + (Math.abs(x * 7 + z * 3) % 3);
  const at = v3(x, y + h / 2, z);
  b.add(metricBox(w, h, d, 2.2), M.mat(plastered ? "plaster" : "stone"), at, turn);
  const roof = gableRoof(w, d, 2.6 + d * 0.12, 0.45, 1.6);
  b.add(roof, M.mat(slate ? "slate" : "tiles"), v3(x, y + h, z), turn);
  // Windows and a door on the long faces.
  const c = Math.cos(turn);
  const s = Math.sin(turn);
  for (const side of [1, -1]) {
    for (const wx of [-w * 0.3, w * 0.25]) {
      for (const wy of [h * 0.35, h * 0.72]) {
        const lx = wx;
        const lz = side * (d / 2 + 0.03);
        b.add(new BoxGeometry(0.9, 1.2, 0.06), M.mat("window"), v3(x + lx * c + lz * s, y + wy, z - lx * s + lz * c), turn);
      }
    }
  }
  const lz = d / 2 + 0.03;
  b.add(new BoxGeometry(1.1, 2.1, 0.07), M.mat("planks"), v3(x + w * 0.02 * c + lz * s, y + 1.05 + 0.6, z - w * 0.02 * s + lz * c), turn);
}

function barnAndFarm(b: Batch, M: Materials, ground: Ground): void {
  // The farmhouse.
  house(b, M, FARM[0], FARM[1], 11, 8, 0.25, ground, true, false);
  // The barn: planks on a stone base, a big slate roof.
  const [bx, bz] = BARN;
  const y = ground(bx, bz) - 0.5;
  b.add(metricBox(16, 2, 10, 2.2), M.mat("stone"), v3(bx, y + 1, bz), 0.1);
  b.add(metricBox(16, 5, 10, 2), M.mat("planks"), v3(bx, y + 4.5, bz), 0.1);
  b.add(gableRoof(16, 10, 4.2, 0.7, 1.6), M.mat("slate"), v3(bx, y + 7, bz), 0.1);
  b.add(new BoxGeometry(4, 4.2, 0.1), M.mat("window"), v3(bx + 0.5, y + 2.2, bz + 5.06), 0.1);
  // The pasture's fence: posts and two rails.
  const corners = [...PASTURE, PASTURE[0]!];
  for (let i = 1; i < corners.length; i++) {
    const [ax, az] = corners[i - 1]!;
    const [cx, cz] = corners[i]!;
    const len = Math.hypot(cx - ax, cz - az);
    const n = Math.ceil(len / 3);
    const ang = Math.atan2(cx - ax, cz - az);
    for (let k = 0; k < n; k++) {
      const u = k / n;
      const px = ax + (cx - ax) * u;
      const pz = az + (cz - az) * u;
      const gy = ground(px, pz);
      b.add(new BoxGeometry(0.14, 1.4, 0.14), M.mat("wood"), v3(px, gy + 0.6, pz));
      for (const ry of [0.55, 1.05]) {
        const mx = px + ((cx - ax) / n) * 0.5;
        const mz = pz + ((cz - az) / n) * 0.5;
        b.add(new BoxGeometry(0.06, 0.1, len / n + 0.1), M.mat("wood"), v3(mx, ground(mx, mz) + ry, mz), ang);
      }
    }
  }
  // Hay bales by the barn.
  for (let k = 0; k < 7; k++) {
    const hx = BARN[0] + 10 + (k % 4) * 2.2;
    const hz = BARN[1] - 4 + Math.floor(k / 4) * 2.4;
    const bale = new CylinderGeometry(0.75, 0.75, 1.2, 12);
    bale.rotateZ(Math.PI / 2);
    b.add(bale, M.mat("hay"), v3(hx, ground(hx, hz) + 0.7, hz), k * 0.4);
  }
}

/** The farmer's cart, its cheese and the wedge under its wheel: separate, named, for the secret. */
function cart(root: Object3D, M: Materials, ground: Ground): void {
  const [x, z] = CART;
  const y = ground(x, z);
  const group = nameNode(new Group(), "farm.cart");
  const bed = new Mesh(metricBox(2.2, 0.25, 1.3, 1), M.mat("wood"));
  bed.position.set(0, 0.8, 0);
  group.add(bed);
  for (const side of [1, -1]) {
    const wheel = new Mesh(new TorusGeometry(0.45, 0.07, 6, 16), M.mat("wood"));
    wheel.rotation.y = Math.PI / 2;
    wheel.position.set(0.3, 0.45, side * 0.72);
    group.add(wheel);
  }
  const shaft = new Mesh(new BoxGeometry(2.4, 0.08, 0.08), M.mat("wood"));
  shaft.position.set(1.9, 0.6, 0);
  group.add(shaft);
  group.position.set(x, y, z);
  group.rotation.y = 0.5;
  root.add(group);
  // The cheese: a big wheel on the bed, on its edge, ready to roll.
  const cheese = nameNode(new Mesh(new CylinderGeometry(0.42, 0.42, 0.22, 20), M.mat("cheese")), "secret.cheese");
  cheese.rotation.x = Math.PI / 2;
  cheese.position.set(-0.4, 0.8 + 0.12 + 0.42, 0);
  group.add(cheese);
  // The wedge under the near wheel.
  const wedgeGeo = new BufferGeometry();
  wedgeGeo.setAttribute("position", new BufferAttribute(new Float32Array([0, 0, -0.1, 0.3, 0, -0.1, 0, 0.18, -0.1, 0, 0, 0.1, 0.3, 0, 0.1, 0, 0.18, 0.1]), 3));
  wedgeGeo.setIndex([0, 2, 1, 3, 4, 5, 0, 1, 4, 0, 4, 3, 0, 3, 5, 0, 5, 2, 1, 2, 5, 1, 5, 4]);
  wedgeGeo.computeVertexNormals();
  const wedge = nameNode(new Mesh(wedgeGeo, M.mat("red")), "secret.cart.wedge");
  wedge.position.set(0.75, 0, 0.72);
  wedge.scale.setScalar(1.6);
  group.add(wedge);
  wedge.userData["surface"] = "wood";
  cheese.userData["surface"] = "cloth";
}

function checkpoint(root: Object3D, b: Batch, M: Materials, ground: Ground): void {
  const [cx, cz] = CHECKPOINT;
  const gy = ground(cx, cz);
  // The barrier: a striped pole on a post across the road.
  b.add(new BoxGeometry(0.3, 1.2, 0.3), M.mat("paint"), v3(cx + 4.2, gy + 0.6, cz - 1.5));
  for (let k = 0; k < 8; k++) {
    b.add(new BoxGeometry(0.16, 0.16, 1), M.mat(k % 2 === 0 ? "red" : "paint"), v3(cx + 4.2 - 0.15, gy + 1.1, cz - 1.5 + 0.5 + k), 0);
  }
  // The guard hut.
  const hx = 58;
  const hz = -278;
  const hy = ground(hx, hz);
  b.add(metricBox(3.2, 2.6, 3.2, 1.6), M.mat("planks"), v3(hx, hy + 1.3, hz), 0.3);
  b.add(gableRoof(3.2, 3.2, 1, 0.3), M.mat("slate"), v3(hx, hy + 2.6, hz), 0.3);
  b.add(new BoxGeometry(1.2, 0.8, 0.06), M.mat("window"), v3(hx - 0.2, hy + 1.6, hz + 1.63), 0.3);
  // The sandbagged machine-gun nest: a ring of bags, open at the back.
  const [sx, sz] = SANDBAGS;
  const sy = ground(sx, sz);
  for (let k = 0; k < 9; k++) {
    const a = Math.PI * (0.15 + (k / 8) * 0.7) + Math.PI;
    const px = sx + Math.cos(a) * 2;
    const pz = sz - Math.sin(a) * 2;
    for (let layer = 0; layer < 3; layer++) b.add(metricBox(0.9, 0.32, 0.5, 1), M.mat("sandbag"), v3(px, sy + 0.16 + layer * 0.3, pz), -a + Math.PI / 2);
  }
  // The watchtower: four legs, cross-braces, a railed platform and a little roof.
  const [tx, tz] = TOWER;
  const ty = ground(tx, tz);
  const H = TOWER_HEIGHT;
  for (const [lx, lz] of [
    [-1.4, -1.4],
    [1.4, -1.4],
    [1.4, 1.4],
    [-1.4, 1.4],
  ] as [number, number][]) {
    b.add(new BoxGeometry(0.22, H + 3.2, 0.22), M.mat("wood"), v3(tx + lx, ty + (H + 3.2) / 2, tz + lz));
  }
  for (const yy of [H * 0.35, H * 0.72]) {
    for (const [a, len] of [
      [0, 2.8],
      [Math.PI / 2, 2.8],
    ] as [number, number][]) {
      for (const off of [-1.4, 1.4]) {
        const geo = new BoxGeometry(0.1, 0.1, len);
        const p = a === 0 ? v3(tx + off, ty + yy, tz) : v3(tx, ty + yy, tz + off);
        b.add(geo, M.mat("wood"), p, a);
      }
    }
  }
  b.add(metricBox(3.4, 0.2, 3.4, 1.6), M.mat("planks"), v3(tx, ty + H - 0.1, tz));
  for (const [a, off] of [
    [0, 1.65],
    [0, -1.65],
    [Math.PI / 2, 1.65],
    [Math.PI / 2, -1.65],
  ] as [number, number][]) {
    const p = a === 0 ? v3(tx + off, ty + H + 0.55, tz) : v3(tx, ty + H + 0.55, tz + off);
    b.add(metricBox(0.08, 1.1, 3.4, 1), M.mat("planks"), p, a);
  }
  b.add(pyramid(3.8, 1.4), M.mat("slate"), v3(tx, ty + H + 3.2, tz));
  // A flag on a pole by the hut: the wind made visible. Named, so the world can fly it.
  const pole = new Mesh(new CylinderGeometry(0.05, 0.06, 7, 6), M.mat("metal"));
  pole.position.set(cx - 6, gy + 3.5, cz - 6);
  root.add(pole);
  const flag = nameNode(new Mesh(new PlaneGeometry(1.8, 1.1, 8, 4), new MeshStandardMaterial({ color: "#1d3b2c", roughness: 0.9, side: DoubleSide, name: "flag" })), "flag");
  flag.geometry.translate(0.9, 0, 0);
  flag.position.set(cx - 6, gy + 6.4, cz - 6);
  flag.userData["surface"] = "cloth";
  root.add(flag);
}

function bridge(b: Batch, M: Materials): void {
  // Along the road between the banks: the direction of the road at the bridge.
  const a = ROAD[6]!;
  const c = ROAD[8]!;
  const ang = Math.atan2(c[0] - a[0], c[1] - a[1]);
  const [bx, bz] = BRIDGE;
  const deck = BRIDGE_DECK;
  const len = BRIDGE_SPAN;
  const at = (along: number, y: number, across = 0) => v3(bx + Math.sin(ang) * along + Math.cos(ang) * across, y, bz + Math.cos(ang) * along - Math.sin(ang) * across);
  // The deck and its parapets.
  const deckGeo = metricBox(7, 1, len, 2);
  b.add(deckGeo, M.mat("stone"), at(0, deck - 0.5), ang);
  for (const side of [-1, 1]) b.add(metricBox(0.5, 1, len, 1.5), M.mat("stone"), at(0, deck + 0.5, side * 3.3), ang);
  // Three arches: piers between them, and the spandrel walls over the arches.
  const bottom = RIVER_LEVEL - 2.5;
  for (const along of [-len / 2 + 2, -7, 7, len / 2 - 2]) {
    b.add(metricBox(7, deck - bottom - 1, 3.2, 2), M.mat("stone"), at(along, (deck - 1 + bottom) / 2), ang);
  }
  for (const along of [-13.5, 0, 13.5]) {
    const arch = metricBox(7.2, 1.6, 10, 2);
    b.add(arch, M.mat("stone"), at(along, deck - 1.8), ang);
  }
}

function village(root: Object3D, b: Batch, M: Materials, ground: Ground): void {
  HOUSES.forEach(([x, z, w, d, turn], i) => house(b, M, x, z, w, d, turn, ground, i % 3 === 1, i % 4 === 3));
  // The chapel: a nave and a square bell tower with an open belfry.
  const [cx, cz] = CHAPEL;
  const gy = ground(cx, cz) - 0.4;
  const naveAt = v3(cx - 11, gy + 4.5, cz - 1);
  b.add(metricBox(16, 9, 9, 2.2), M.mat("plaster"), naveAt, 0);
  b.add(gableRoof(16, 9, 4.5, 0.5, 1.6), M.mat("tiles"), v3(cx - 11, gy + 9, cz - 1), 0);
  for (const wx of [-5, 0, 5]) b.add(new BoxGeometry(1, 3, 0.06), M.mat("window"), v3(cx - 11 + wx, gy + 5.5, cz + 3.53));
  const T = CHAPEL_TOWER_HEIGHT;
  const belfryLow = 13.2;
  b.add(metricBox(4.4, belfryLow, 4.4, 2.2), M.mat("stone"), v3(cx, gy + belfryLow / 2, cz), 0);
  // The belfry's four corner pillars, its floor and its cap.
  for (const [px, pz] of [
    [-1.9, -1.9],
    [1.9, -1.9],
    [1.9, 1.9],
    [-1.9, 1.9],
  ] as [number, number][]) {
    b.add(metricBox(0.6, T - belfryLow - 1.2, 0.6, 1), M.mat("stone"), v3(cx + px, gy + belfryLow + (T - belfryLow - 1.2) / 2, cz + pz));
  }
  b.add(metricBox(4.6, 1.2, 4.6, 2), M.mat("stone"), v3(cx, gy + T - 0.6, cz));
  b.add(pyramid(4.8, 6), M.mat("slate"), v3(cx, gy + T, cz));
  // The bell: its pivot at the yoke, so the world can swing it.
  const bell = nameNode(new Group(), "secret.bell");
  bell.position.set(cx, gy + T - 1.4, cz);
  const profile = [
    [0.02, 0],
    [0.34, -0.05],
    [0.42, -0.35],
    [0.46, -0.8],
    [0.62, -1.05],
    [0.64, -1.12],
    [0.0, -1.12],
  ].map(([r, y]) => new Vector2(r!, y!));
  const bellMesh = new Mesh(new LatheGeometry(profile, 18), new MeshStandardMaterial({ color: "#8a6a32", metalness: 0.9, roughness: 0.35, name: "bronze" }));
  bellMesh.userData["surface"] = "metal";
  bellMesh.name = "secret.bell.mesh";
  bell.add(bellMesh);
  root.add(bell);
}

function dam(root: Object3D, b: Batch, M: Materials): void {
  const { x0, x1, z, thick, crest, base } = DAM;
  const len = x1 - x0;
  const cx = (x0 + x1) / 2;
  const height = crest - base;
  // The wall: thick at its foot, a walkway on its crest, facing the valley.
  b.add(metricBox(len, height, thick, 4), M.mat("concrete"), v3(cx, base + height / 2, z));
  b.add(metricBox(len, height * 0.6, thick * 2.2, 4), M.mat("concrete"), v3(cx, base + height * 0.3, z + thick * 0.6));
  // The walkway's railings.
  for (const side of [-1, 1]) {
    for (let x = x0 + 2; x < x1 - 1; x += 3) b.add(new BoxGeometry(0.08, 1.1, 0.08), M.mat("metal"), v3(x, crest + 0.55, z + side * (thick / 2 - 0.2)));
    b.add(new BoxGeometry(len - 3, 0.07, 0.07), M.mat("metal"), v3(cx, crest + 1.08, z + side * (thick / 2 - 0.2)));
  }
  // The spillway: a notch with a sheet of water down the face.
  const spill = new Mesh(new PlaneGeometry(12, height - 4), new MeshStandardMaterial({ color: "#c8d6d8", roughness: 0.3, transparent: true, opacity: 0.8, name: "spill" }));
  spill.position.set(cx + 10, base + (height - 4) / 2, z + thick / 2 + 0.3);
  spill.name = "dam.spill";
  spill.userData["surface"] = "water";
  root.add(spill);
  // The control house on the crest near the left end.
  b.add(metricBox(5, 3.2, 4, 2), M.mat("concrete"), v3(x0 + 14, crest + 1.6, z - 4.5));
  b.add(gableRoof(5, 4, 1.2, 0.3), M.mat("slate"), v3(x0 + 14, crest + 3.2, z - 4.5));
  b.add(new BoxGeometry(1.6, 1, 0.06), M.mat("window"), v3(x0 + 14, crest + 1.9, z - 2.47));
  // The loudspeaker on its pole: the siren.
  const pole = new Mesh(new CylinderGeometry(0.08, 0.1, 6, 6), M.mat("metal"));
  pole.position.set(cx - 20, crest + 3, z + thick / 2 - 0.5);
  root.add(pole);
  const siren = nameNode(new Group(), "secret.siren");
  siren.position.set(cx - 20, crest + 6, z + thick / 2 - 0.5);
  const horn = new Mesh(new CylinderGeometry(0.55, 0.12, 1.1, 12, 1, true), new MeshStandardMaterial({ color: "#9a9d97", metalness: 0.7, roughness: 0.4, side: DoubleSide, name: "siren" }));
  horn.rotation.x = Math.PI / 2;
  horn.position.z = 0.4;
  horn.userData["surface"] = "metal";
  siren.add(horn);
  root.add(siren);
  // The tunnel's portal in the cliff at the dam road's end.
  const [tx, ty, tz] = TUNNEL;
  b.add(metricBox(8, 7, 3, 2), M.mat("concrete"), v3(tx + 2, ty + 3.5, tz - 1));
  const mouth = new Mesh(new PlaneGeometry(5, 5), new MeshStandardMaterial({ color: "#050505", roughness: 1, name: "tunnel" }));
  mouth.position.set(tx + 2, ty + 2.5, tz + 0.55);
  root.add(mouth);
}

/** Telegraph poles along the valley road, every 45 m. */
function poles(b: Batch, M: Materials, ground: Ground): void {
  let total = 0;
  for (let i = 1; i < ROAD.length; i++) total += Math.hypot(ROAD[i]![0] - ROAD[i - 1]![0], ROAD[i]![1] - ROAD[i - 1]![1]);
  for (let s = 20; s < total - 60; s += 45) {
    const [x, z] = pointOn(ROAD, s);
    const px = x + 6;
    const pz = z - 5;
    const gy = ground(px, pz);
    b.add(new CylinderGeometry(0.11, 0.14, 8, 6), M.mat("wood"), v3(px, gy + 4, pz));
    b.add(new BoxGeometry(1.4, 0.1, 0.1), M.mat("wood"), v3(px, gy + 7.4, pz));
  }
}

/** The aim check's steel plates: each hangs on a post from a crossbar; its pivot is `calib.N`. */
function plates(root: Object3D, M: Materials, ground: Ground): void {
  platePositions().forEach(([x, y, z, pole], i) => {
    const gy = ground(x, z);
    const post = new Mesh(new BoxGeometry(0.16, pole + 0.9, 0.16), M.mat("wood"));
    post.position.set(x, gy + (pole + 0.9) / 2 - 0.2, z - 0.35);
    root.add(post);
    const bar = new Mesh(new BoxGeometry(0.1, 0.1, 0.9), M.mat("wood"));
    bar.position.set(x, y + 1.0, z - 0.1);
    root.add(bar);
    const pivot = nameNode(new Group(), `calib.${i + 1}`);
    pivot.position.set(x, y + 0.95, z);
    // The plate faces the ridge.
    pivot.rotation.y = Math.atan2(-x, -z);
    const plate = new Mesh(new CylinderGeometry(0.8, 0.8, 0.05, 28), M.mat("steel"));
    plate.rotation.x = Math.PI / 2;
    plate.position.y = -0.95;
    plate.name = "calib.plate";
    plate.userData["surface"] = "metal";
    pivot.add(plate);
    root.add(pivot);
  });
}

/** Rocks: the one the rifle rests on and the eagle's, boulders on the slopes, the goat's shelves, the great cliff. */
function rocks(root: Object3D, b: Batch, M: Materials, ground: Ground): void {
  const boulder = (r: number, detail = 1) => {
    const g = new DodecahedronGeometry(r, detail);
    const p = g.getAttribute("position") as BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const y = p.getY(i);
      const z = p.getZ(i);
      const k = 0.78 + noise(x * 1.7 + 3, z * 1.7 + y, 7) * 0.4;
      p.setXYZ(i, x * k, y * k * 0.7, z * k);
    }
    g.computeVertexNormals();
    return g;
  };
  // The eagle's rock, on the slope just below the brink right in front of the scope. Its top is
  // exactly the plan's perch (the true ground plus the height), its foot sunk into the mesh's
  // ground, whichever is lower on the steep slope.
  const [ex, ey, ez] = EAGLE_ROCK;
  const top = terrainHeight(ex, ez) + ey;
  const foot = Math.min(ground(ex, ez), terrainHeight(ex, ez)) - 0.3;
  const rockShape = boulder(0.7, 2);
  rockShape.computeBoundingBox();
  const shapeBox = rockShape.boundingBox!;
  const eagleRock = new Mesh(rockShape, M.mat("rock"));
  const sy = (top - foot) / (shapeBox.max.y - shapeBox.min.y);
  eagleRock.scale.set(0.75, sy, 0.8);
  eagleRock.position.set(ex, foot - shapeBox.min.y * sy, ez);
  eagleRock.name = "rock.eagle";
  root.add(eagleRock);
  // The rifle's rest at the brink, low at the bottom of the view.
  const rest = new Mesh(boulder(0.4, 2), M.mat("rock"));
  rest.position.set(0.38, ground(0.38, -1.25) - 0.1, -1.25);
  rest.scale.set(1.3, 0.8, 1);
  rest.name = "rock.rest";
  root.add(rest);
  // Boulders on the valley floor and the slopes.
  for (let k = 0; k < 36; k++) {
    const x = -700 + noise(k * 3.1, 1.5, 11) * 1500;
    const z = -150 - noise(k * 2.3, 7.5, 13) * 700;
    const r = 0.5 + noise(k, 3, 17) * 1.4;
    b.add(boulder(r), M.mat("rock"), v3(x, ground(x, z) + r * 0.2, z), k);
  }
  // The goat's shelves on the cliff, each a slab jutting from the rock.
  GOAT_LEDGES.forEach(([x, , z], i) => {
    const y = ground(x, z) + (GOAT_LIFT[i] ?? 0);
    const slab = new Mesh(metricBox(2.6, 0.6, 1.8, 2), M.mat("rock"));
    slab.position.set(x, y - 0.3, z);
    slab.rotation.y = i * 0.7;
    slab.name = `ledge.${i}`;
    root.add(slab);
    const wall = new Mesh(boulder(3 + i, 1), M.mat("rock"));
    wall.position.set(x - 1, y - 2.4, z - 2.4);
    root.add(wall);
  });
  // The great cliff: a sheer face of grey rock across the valley, the echo's wall -
  // a skin of broken rock laid over the ground's own steep face there.
  const [cx, cz] = CLIFF;
  const nx = 36;
  const nz = 22;
  const w = 190;
  const d = 120;
  const face = new PlaneGeometry(1, 1, nx, nz);
  face.rotateX(-Math.PI / 2);
  const p = face.getAttribute("position") as BufferAttribute;
  const uv = face.getAttribute("uv") as BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = cx + p.getX(i) * w;
    const z = cz + 20 + p.getZ(i) * d;
    // Ragged edges fade into the slope; the middle stands proud of it in blocks and ledges.
    const edge = Math.min(1, Math.min(0.5 - Math.abs(p.getX(i)), 0.5 - Math.abs(p.getZ(i))) * 6);
    const blocks = Math.floor(noise(x * 0.06, z * 0.06, 21) * 4) / 4;
    const lift = edge * (1.5 + blocks * 5 + (noise(x * 0.2, z * 0.2, 23) - 0.5) * 3);
    p.setXYZ(i, x, ground(x, z) + lift - 0.8, z);
    uv.setXY(i, x / 6, (ground(x, z) + lift) / 6);
  }
  face.computeVertexNormals();
  const cliff = nameNode(new Mesh(face, M.mat("rock")), "secret.cliff");
  root.add(cliff);
  // The yeti's rock on the snowfield, and the yeti peeking from behind it.
  const [yx, yz] = YETI_ROCK;
  const yy = ground(yx, yz);
  const yetiRock = nameNode(new Mesh(boulder(4, 1), M.mat("rock")), "secret.yeti.rock");
  yetiRock.position.set(yx, yy + 1.2, yz);
  root.add(yetiRock);
  const yeti = nameNode(new Group(), "secret.yeti");
  const fur = M.mat("yeti");
  const body = new Mesh(new SphereGeometry(0.9, 12, 10), fur);
  body.scale.set(1, 1.5, 0.85);
  body.position.y = 1.5;
  const head = new Mesh(new SphereGeometry(0.5, 12, 10), fur);
  head.position.y = 3.0;
  const face2 = new Mesh(new CircleGeometry(0.28, 12), new MeshStandardMaterial({ color: "#6b6f78", roughness: 1 }));
  face2.position.set(0, 3.0, 0.48);
  yeti.add(body, head, face2);
  yeti.position.set(yx + 4.2, yy, yz + 0.5);
  yeti.rotation.y = Math.atan2(-(yx + 4.2), -yz);
  root.add(yeti);
}

/** Every building and thing in the valley, with the secrets' named props. */
export function buildStructures(ground: Ground): Group {
  const root = nameNode(new Group(), "structures");
  const M = materials();
  const b = new Batch();
  barnAndFarm(b, M, ground);
  cart(root, M, ground);
  checkpoint(root, b, M, ground);
  bridge(b, M);
  village(root, b, M, ground);
  dam(root, b, M);
  poles(b, M, ground);
  plates(root, M, ground);
  rocks(root, b, M, ground);
  b.build("buildings", root);
  return root;
}
