import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Euler,
  Group,
  LatheGeometry,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PlaneGeometry,
  Vector2,
  Vector3,
  type Material,
  type Texture,
} from "three";
import { mulberry32 } from "../rules/rng";
import { nameNode } from "../world/names";
import { TownBuilder, unlit, type BakeLight, type PartOptions } from "./builder";
import {
  boardsTexture,
  dirtTexture,
  planksTexture,
  plainTexture,
  shinglesTexture,
  signTexture,
  stoneTexture,
  wantedPosterTexture,
} from "./textures";

/**
 * Dust Creek, built from boxes in code to exactly the node contract the real
 * town.glb follows (docs/WEB_ARCHITECTURE.md): `camera.player`, `sun`,
 * `cover.<id>` / `cover.<id>.hidden` with {kind, emerge, level}, `calib.1-9`,
 * the `secret.*` pivots, `glass.*` panes, `path.*` waypoints, `ground.shadow`,
 * and `surface` extras on every mesh. Light is baked into vertex colours and
 * the materials are unlit, like the Cycles bake. When town.glb arrives the
 * game loads it instead and none of the game code changes.
 *
 * Layout (metres; the player at the origin looking down −Z, left is −X):
 * facades at x = ±8.5 with boardwalks in front of them, the church across the
 * far end at z ≈ −60, the water tower behind the right-hand roofs.
 */

const FACADE_X = 8.5;
const WALK_TOP = 0.3;
const WALK_EDGE = 6.0;

type Side = -1 | 1;

interface Opening {
  z: number;
  y: number;
  w: number;
  h: number;
  kind: "door" | "window";
  glass?: string;
  shutters?: boolean;
}

interface BuildingSpec {
  id: string;
  side: Side;
  /** Near and far ends (z, near > far). */
  zNear: number;
  zFar: number;
  height: number;
  /** Top of the false front. */
  front: number;
  depth: number;
  color: string;
  material: "planks" | "boards" | "stone";
  openings: Opening[];
  sign?: { text: string; board: string; ink: string; y: number; w: number; h: number };
  awning?: boolean;
  balcony?: boolean;
  gable?: boolean;
}

export interface PlaceholderOptions {
  /** High Noon for real: bake the light from straight overhead. */
  noon?: boolean;
}

export function buildPlaceholderTown(options: PlaceholderOptions = {}): Group {
  const sunDir = options.noon ? new Vector3(-0.08, -1, -0.12).normalize() : new Vector3(-0.45, -0.37, -0.81).normalize();
  const light: BakeLight = options.noon
    ? { sun: sunDir, sunColor: new Color(1.55, 1.45, 1.28), sky: new Color(0.42, 0.46, 0.52), bounce: new Color(0.42, 0.36, 0.28) }
    : { sun: sunDir, sunColor: new Color(1.75, 1.22, 0.76), sky: new Color(0.3, 0.36, 0.47), bounce: new Color(0.36, 0.26, 0.17) };
  const b = new TownBuilder(light);
  const rand = mulberry32(1851);

  const tex = {
    planks: planksTexture(1),
    boards: boardsTexture(2),
    dirt: dirtTexture(3),
    stone: stoneTexture(4),
    shingles: shinglesTexture(5),
    plain: plainTexture(),
  };
  const mat = {
    planks: unlit(tex.planks, "planks"),
    boards: unlit(tex.boards, "boards"),
    dirt: unlit(tex.dirt, "dirt"),
    stone: unlit(tex.stone, "stone"),
    shingles: unlit(tex.shingles, "shingles"),
    plain: unlit(tex.plain, "plain"),
  };
  const col = (hex: string) => new Color(hex);
  const C = {
    dirt: col("#b38b62"),
    desert: col("#c29f76"),
    walk: col("#8c6b4b"),
    walkEdge: col("#5e4630"),
    trim: col("#e3d8c0"),
    roof: col("#5b4b43"),
    interior: col("#2a1d14"),
    darkWood: col("#4a3526"),
    post: col("#6b5038"),
    metal: col("#5d5b58"),
    straw: col("#d8b56a"),
    barrel: col("#7a5634"),
    hoop: col("#3d3a37"),
    crate: col("#a1845c"),
    water: col("#4d6a73"),
    church: col("#ddd5c4"),
    churchRoof: col("#4d3c33"),
    bronze: col("#8a6a32"),
  };

  // --- boardwalks --------------------------------------------------------------------
  for (const side of [-1, 1] as Side[]) {
    const zNear = -6.5;
    const zFar = side < 0 ? -53.2 : -49.3;
    const len = zNear - zFar;
    const cx = side * (WALK_EDGE + FACADE_X) / 2;
    b.box("walk", mat.planks, [cx, WALK_TOP / 2, (zNear + zFar) / 2], [FACADE_X - WALK_EDGE, WALK_TOP, len], C.walk, {
      uvScale: 1.5,
      rotation: new Euler(0, 0, 0),
      occlude: true,
    });
    // The front beam, darker, with a gap under it for shade.
    b.box("walk", mat.plain, [side * (WALK_EDGE + 0.05), WALK_TOP / 2, (zNear + zFar) / 2], [0.12, WALK_TOP + 0.02, len], C.walkEdge);
    // Hitching rails and lamp posts along the edge.
    for (const z of side < 0 ? [-14.2, -30.5, -44.5] : [-19, -35.5, -44]) {
      for (const dz of [-1.1, 1.1]) b.box("props", mat.plain, [side * 5.55, 0.55, z + dz], [0.12, 1.1, 0.12], C.post, { occlude: true });
      b.box("props", mat.planks, [side * 5.55, 1.02, z], [0.09, 0.1, 2.5], C.post);
    }
    for (const z of side < 0 ? [-8.5, -22.2, -39.8] : [-16.8, -27, -40.2]) {
      b.box("props", mat.plain, [side * 6.15, WALK_TOP + 1.6, z], [0.1, 3.2, 0.1], C.darkWood, { occlude: true });
      b.box("props", mat.plain, [side * 6.15, WALK_TOP + 3.05, z], [0.26, 0.34, 0.26], col("#e8c27a"), { dim: 1.25 });
      b.box("props", mat.plain, [side * 6.15, WALK_TOP + 3.27, z], [0.34, 0.06, 0.34], C.metal);
    }
  }

  // --- the buildings -----------------------------------------------------------------
  const buildings: BuildingSpec[] = [
    {
      id: "store",
      side: -1,
      zNear: -7,
      zFar: -17,
      height: 4.4,
      front: 5.6,
      depth: 10,
      color: "#b98a58",
      material: "planks",
      awning: true,
      openings: [
        { z: -15.1, y: WALK_TOP, w: 1.4, h: 2.5, kind: "door" },
        { z: -9.2, y: 1.0, w: 1.9, h: 1.6, kind: "window", glass: "store_1" },
        { z: -12.3, y: 1.0, w: 1.9, h: 1.6, kind: "window", glass: "store_2" },
      ],
      sign: { text: "GENERAL STORE", board: "#2f3a2c", ink: "#e9dcb4", y: 4.9, w: 7.4, h: 0.9 },
    },
    {
      id: "saloon",
      side: -1,
      zNear: -18.5,
      zFar: -31,
      height: 8,
      front: 8.7,
      depth: 12,
      color: "#8f4d3b",
      material: "planks",
      balcony: true,
      openings: [
        { z: -24.8, y: WALK_TOP, w: 1.7, h: 2.6, kind: "door" },
        { z: -21, y: 0.95, w: 2.2, h: 1.6, kind: "window", glass: "saloon_piano" },
        { z: -28.6, y: 0.95, w: 1.8, h: 1.6, kind: "window", glass: "saloon_2" },
        { z: -21, y: 3.6, w: 1.1, h: 2.3, kind: "door", shutters: true },
        { z: -24.8, y: 3.6, w: 1.1, h: 2.3, kind: "door", shutters: true },
        { z: -28.6, y: 3.6, w: 1.1, h: 2.3, kind: "door", shutters: true },
      ],
      sign: { text: "SALOON", board: "#231a14", ink: "#e8c779", y: 7.3, w: 6.4, h: 1.0 },
    },
    {
      id: "barber",
      side: -1,
      zNear: -32.5,
      zFar: -39.5,
      height: 4.2,
      front: 5.4,
      depth: 9,
      color: "#bdb6a4",
      material: "planks",
      awning: true,
      openings: [
        { z: -36, y: WALK_TOP, w: 1.3, h: 2.5, kind: "door" },
        { z: -33.9, y: 1.0, w: 1.4, h: 1.5, kind: "window", glass: "barber" },
      ],
      sign: { text: "BARBER", board: "#5b2b25", ink: "#f1e6cf", y: 4.75, w: 4.6, h: 0.8 },
    },
    {
      id: "livery",
      side: -1,
      zNear: -41,
      zFar: -53,
      height: 6.2,
      front: 6.2,
      depth: 12,
      color: "#7b5237",
      material: "boards",
      gable: true,
      openings: [
        { z: -47, y: WALK_TOP, w: 3.2, h: 3.6, kind: "door" },
        { z: -47, y: 4.3, w: 1.6, h: 1.4, kind: "window" },
      ],
      sign: { text: "LIVERY", board: "#e1d3b0", ink: "#3b2718", y: 5.2, w: 4.2, h: 0.75 },
    },
    {
      id: "bank",
      side: 1,
      zNear: -7,
      zFar: -16,
      height: 5.5,
      front: 6.4,
      depth: 10,
      color: "#cbb896",
      material: "stone",
      openings: [
        { z: -13.9, y: WALK_TOP, w: 1.5, h: 2.7, kind: "door" },
        { z: -8.6, y: 1.0, w: 1.3, h: 1.8, kind: "window", glass: "bank_1" },
        { z: -11.2, y: 1.0, w: 1.3, h: 1.8, kind: "window", glass: "bank_2" },
      ],
      sign: { text: "BANK", board: "#1f2a33", ink: "#e5d29a", y: 5.75, w: 4, h: 0.75 },
    },
    {
      id: "sheriff",
      side: 1,
      zNear: -17.5,
      zFar: -26,
      height: 4.4,
      front: 5.6,
      depth: 9,
      color: "#a98c66",
      material: "planks",
      awning: true,
      openings: [
        { z: -23, y: WALK_TOP, w: 1.3, h: 2.5, kind: "door" },
        { z: -19, y: 1.1, w: 1.2, h: 1.3, kind: "window" },
      ],
      sign: { text: "SHERIFF", board: "#36291d", ink: "#e9d8a6", y: 4.95, w: 5, h: 0.8 },
    },
    {
      id: "hotel",
      side: 1,
      zNear: -27,
      zFar: -39,
      height: 8.2,
      front: 8.8,
      depth: 11,
      color: "#6f8683",
      material: "planks",
      balcony: true,
      openings: [
        { z: -33, y: WALK_TOP, w: 1.5, h: 2.6, kind: "door" },
        { z: -29.5, y: 0.95, w: 1.6, h: 1.6, kind: "window", glass: "hotel_1" },
        { z: -36.5, y: 0.95, w: 1.6, h: 1.6, kind: "window", glass: "hotel_2" },
        { z: -29.5, y: 3.6, w: 1.1, h: 2.3, kind: "door", shutters: true },
        { z: -33, y: 3.6, w: 1.1, h: 2.3, kind: "door", shutters: true },
        { z: -36.5, y: 3.6, w: 1.1, h: 2.3, kind: "door", shutters: true },
      ],
      sign: { text: "HOTEL", board: "#e2d7bd", ink: "#2d3b3a", y: 7.35, w: 5, h: 0.85 },
    },
    {
      id: "undertaker",
      side: 1,
      zNear: -40.5,
      zFar: -49,
      height: 4.6,
      front: 5.8,
      depth: 9,
      color: "#55504d",
      material: "planks",
      awning: true,
      openings: [
        { z: -45.5, y: WALK_TOP, w: 1.3, h: 2.5, kind: "door" },
        { z: -42.9, y: 1.0, w: 1.3, h: 1.5, kind: "window", glass: "undertaker" },
      ],
      sign: { text: "UNDERTAKER", board: "#161413", ink: "#cfc6b4", y: 5.15, w: 6.2, h: 0.75 },
    },
  ];

  const glassMaterial = new MeshBasicMaterial({
    color: new Color("#42525c"),
    transparent: true,
    opacity: 0.62,
    side: DoubleSide,
    depthWrite: false,
    name: "glass",
  });

  for (const spec of buildings) buildBuilding(b, spec, mat, C, glassMaterial);

  // --- the arch over the street: "DUST CREEK" ------------------------------------------
  // Posts out on the boardwalks and the beam up high, so the arch hides no
  // cover: from the eye, a post at the kerb stood right in front of the
  // sheriff's door, and a lower beam across the saloon's roof edge.
  for (const x of [-7.25, 7.25]) b.box("arch", mat.boards, [x, 4.2, -18], [0.35, 8.4, 0.35], C.darkWood, { occlude: true });
  b.box("arch", mat.planks, [0, 8.1, -18], [14.9, 0.62, 0.3], C.darkWood, { occlude: true });
  b.box("arch", mat.plain, [0, 8.45, -18], [15.1, 0.08, 0.4], C.post);
  addSign(b.root, "sign.arch", signTexture("DUST CREEK", "#3a2a1c", "#e8cf94", 1024, 128), [0, 8.1, -17.83], 6.2, 0.55, 0, 1.0);
  // A rope under the beam for the aim check's top-centre bottle to hang from.
  b.box("arch", mat.plain, [0.35, 7.62, -17.9], [0.018, 0.38, 0.018], C.hoop as Color, { surface: "cloth" });

  // --- street furniture and covers' props ----------------------------------------------
  // General store barrels on the boardwalk.
  barrel(b, mat, C, -6.6, WALK_TOP, -12.3);
  barrel(b, mat, C, -7.35, WALK_TOP, -12.05);
  // Water trough (right, near).
  b.box("props", mat.boards, [5.0, 0.4, -13.5], [0.9, 0.8, 2.3], col("#6d5236"), { occlude: true, uvScale: 1 });
  waterSurface(b, [5.0, 0.72, -13.5], [0.7, 2.1]);
  // The broken wagon (mid-left).
  wagon(b, mat, C, -3.6, -27);
  // Sheriff's crates.
  crate(b, mat, C, 6.6, WALK_TOP, -24.8, 1.0);
  crate(b, mat, C, 7.4, WALK_TOP, -24.6, 0.8);
  crate(b, mat, C, 6.8, WALK_TOP + 1.0, -24.9, 0.6);
  // Hay bales at the livery.
  for (const [x, y, z] of [
    [-5.8, 0.25, -43.1],
    [-5.9, 0.25, -44.0],
    [-5.85, 0.75, -43.55],
  ] as [number, number, number][]) {
    b.box("props", mat.boards, [x, y, z], [1.0, 0.5, 0.85], C.straw, { uvScale: 0.6, occlude: true, surface: "cloth" });
  }
  // Coffins leaning outside the undertaker's, and a stack to hide behind.
  for (const z of [-41.6, -42.3]) {
    b.box("props", mat.boards, [8.2, WALK_TOP + 0.95, z], [0.28, 1.9, 0.62], col("#3b2b22"), { rotation: new Euler(0, 0, -0.18) });
  }
  b.box("props", mat.boards, [6.85, WALK_TOP + 0.55, -42.6], [0.7, 1.1, 1.9], col("#43322a"), { occlude: true });
  // Mid-street crates and the far barrels.
  crate(b, mat, C, 3.0, 0, -37.5, 1.1);
  crate(b, mat, C, 3.9, 0, -37.2, 0.8);
  barrel(b, mat, C, 2.4, 0, -51);
  barrel(b, mat, C, 3.2, 0, -50.8);
  barrel(b, mat, C, 2.8, 0.95, -50.9, true);
  // The barber's striped pole.
  for (let i = 0; i < 8; i++) {
    const c = i % 3 === 0 ? col("#b3322b") : i % 3 === 1 ? col("#f2ede2") : col("#2d4a86");
    b.cylinder("props", mat.plain, [-6.35, WALK_TOP + 1.0 + i * 0.16, -34.3], 0.09, 0.16, c, { segments: 10 });
  }
  b.cylinder("props", mat.plain, [-6.35, WALK_TOP + 0.5, -34.3], 0.05, 1.0, C.metal, { segments: 8 });
  // The sheriff's wanted board.
  b.box("props", mat.boards, [8.36, 1.9, -20.9], [0.08, 1.6, 2.2], col("#6e5236"));
  // Foreground props for the aim check's bottles (and the eye's sense of scale).
  crate(b, mat, C, -2.3, 0, -4.4, 0.35);
  crate(b, mat, C, -2.9, 0, -4.9, 0.6);
  barrel(b, mat, C, 2.35, 0, -4.55, false, 0.42);
  // An old stump for the bottom-centre bottle, its cut face pale.
  b.cylinder("props", mat.boards, [-0.15, 0.15, -5.4], 0.3, 0.3, col("#7a5a3c"), { radiusTop: 0.27, segments: 12, uvScale: 0.5 });
  b.cylinder("props", mat.plain, [-0.15, 0.302, -5.4], 0.265, 0.004, col("#c9a77e"), { segments: 12 });
  for (let i = 0; i < 3; i++) {
    const a = i * 2.1 + 0.4;
    b.box("props", mat.boards, [-0.15 + Math.cos(a) * 0.3, 0.05, -5.4 + Math.sin(a) * 0.3], [0.28, 0.08, 0.1], col("#6a4c32"), { rotY: -a });
  }

  // --- the far end: the church, its bell and vane ------------------------------------------
  const secrets = buildChurch(b, mat, C, light);
  const tower = buildWaterTower(b, mat, C, light);
  buildWindmill(b, mat, C);

  // --- secrets that live on buildings: the piano and the poster -----------------------------
  const piano = buildPiano(light);
  const poster = new Mesh(
    new PlaneGeometry(0.62, 0.86),
    new MeshBasicMaterial({ map: wantedPosterTexture(), name: "poster", side: DoubleSide }),
  );
  poster.position.set(8.31, 2.0, -20.55);
  poster.rotation.y = -Math.PI / 2;
  // In the shade of the right-hand side, like everything there.
  (poster.material as MeshBasicMaterial).color.setScalar(0.62);
  nameNode(poster, "secret.poster");
  poster.userData["surface"] = "cloth";
  b.root.add(poster);
  // Two more posters beside it, for company (not secrets).
  for (const [z, t] of [
    [-21.35, "#e7d6ad"],
    [-20.05, "#dccb9f"],
  ] as [number, string][]) {
    b.box("props", mat.plain, [8.31, 1.85, z], [0.02, 0.7, 0.5], col(t), { dim: 0.95, surface: "cloth" });
  }

  b.root.add(secrets, tower, piano);

  // --- the contract's nodes ------------------------------------------------------------------
  b.node("camera.player", [0, 1.7, 0], { fov: 45 });
  const sun = b.node("sun", [0, 30, 20]);
  sun.lookAt(sun.position.clone().sub(sunDir));
  addCovers(b);
  addCalibration(b);
  for (const [i, p] of (
    [
      [-6.6, WALK_TOP, -7.6],
      [-7.3, WALK_TOP, -11.2],
      [-6.5, WALK_TOP, -14.0],
      [-7.6, WALK_TOP, -16.2],
      [-6.8, WALK_TOP, -12.4],
      [-6.3, WALK_TOP, -8.8],
    ] as [number, number, number][]
  ).entries()) {
    b.node(`path.chicken.${i + 1}`, p);
  }
  for (const [i, p] of (
    [
      // Out of the alley between the bank and the sheriff's, across the
      // street, and away down the alley beside the saloon.
      [15, 0, -16.75],
      [8.2, 0, -16.75],
      [2, 0, -21.5],
      [-5, 0, -28],
      [-8.4, 0, -31.75],
      [-17, 0, -31.75],
    ] as [number, number, number][]
  ).entries()) {
    b.node(`path.tumbleweed.${i + 1}`, p);
  }

  // Where the game draws dynamic shadows: the street and the boardwalk tops.
  const shadowGeo = shadowCatcherGeometry();
  const shadow = nameNode(new Mesh(shadowGeo, new MeshBasicMaterial({ visible: false })), "ground.shadow");
  shadow.userData["surface"] = "dirt";
  b.root.add(shadow);

  // The ground last, so every occluder above can cast its baked shadow on it.
  bakeGround(b, mat.dirt, C.dirt, C.desert, rand);
  b.finish();
  return b.root;
}

// --- pieces ---------------------------------------------------------------------------------

type Mats = Record<"planks" | "boards" | "dirt" | "stone" | "shingles" | "plain", MeshBasicMaterial>;
type Colors = Record<string, Color>;

function smoothstep(a: number, c: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (c - a)));
  return t * t * (3 - 2 * t);
}

function bakeGround(b: TownBuilder, material: Material, dirt: Color, desert: Color, rand: () => number): void {
  const hoof: [number, number][] = [];
  for (let i = 0; i < 260; i++) hoof.push([(rand() - 0.5) * 7, -rand() * 60]);
  const g = { nx: 110, nz: 170, x0: -55, z0: 20, step: 1, hoof, dirt, desert, material };
  const toSun = b.light.sun.clone().negate();
  const up = new Vector3(0, 1, 0);
  const jitter = [new Vector3(0.03, 0.02, 0), new Vector3(-0.03, -0.015, 0.02), new Vector3(0, 0.03, -0.03)];
  const albedo = new Color();
  const p = new Vector3();
  const s = new Vector3();
  const verts: number[] = [];
  const cols: number[] = [];
  const uvs: number[] = [];
  const norms: number[] = [];
  const colorAt = (x: number, z: number, out: Color) => {
    // Street dirt in the middle, lighter desert beyond the town.
    const town = smoothstep(12, 22, Math.abs(x)) + smoothstep(-58, -75, z);
    albedo.copy(g.dirt).lerp(g.desert, Math.min(1, town));
    // Wheel ruts and a trodden middle.
    const rut = Math.max(0, 1 - Math.abs(Math.abs(x + 0.2) - 1.15) / 0.28) * smoothstep(8, -4, z) * (1 - smoothstep(-58, -64, z));
    albedo.multiplyScalar(1 - 0.16 * rut);
    const noise = 0.94 + 0.06 * Math.sin(x * 0.7 + Math.sin(z * 0.23) * 2) * Math.sin(z * 0.41 + x * 0.1);
    albedo.multiplyScalar(noise);
    for (const [hx, hz] of g.hoof) {
      const dd = (x - hx) * (x - hx) + (z - hz) * (z - hz);
      if (dd < 0.2) albedo.multiplyScalar(0.93);
    }
    p.set(x, 0, z);
    b.bake(albedo, up, p, out);
    // Soft baked shadows: three jittered rays toward the sun.
    let lit = 0;
    for (const j of jitter) {
      s.copy(toSun).add(j).normalize();
      if (!b.shadowed(p, s)) lit++;
    }
    const direct = Math.max(0, -b.light.sun.y);
    const shadowAmount = 1 - lit / 3;
    out.r -= albedo.r * b.light.sunColor.r * direct * shadowAmount;
    out.g -= albedo.g * b.light.sunColor.g * direct * shadowAmount;
    out.b -= albedo.b * b.light.sunColor.b * direct * shadowAmount;
    // A cool tint in the shade: the sky fills what the sun does not.
    out.b += 0.012 * shadowAmount;
    // Darken at the foot of the facades.
    const foot = 1 - 0.25 * Math.max(0, 1 - Math.abs(Math.abs(x) - 6.0) / 0.5) * (z < -6 && z > -53 ? 1 : 0);
    out.multiplyScalar(foot);
    return out;
  };
  const c00 = new Color();
  const quad = (x: number, z: number, st: number) => {
    const corners: [number, number][] = [
      [x, z],
      [x + st, z],
      [x + st, z - st],
      [x, z],
      [x + st, z - st],
      [x, z - st],
    ];
    for (const [cx, cz] of corners) {
      verts.push(cx, 0, cz);
      norms.push(0, 1, 0);
      uvs.push(cx / 4, cz / 4);
      colorAt(cx, cz, c00);
      cols.push(c00.r, c00.g, c00.b);
    }
  };
  // Fine near the street, coarse far away.
  for (let zi = 0; zi < g.nz; zi++) {
    const z = g.z0 - zi * g.step;
    for (let xi = 0; xi < g.nx; xi++) {
      const x = g.x0 + xi * g.step;
      const near = Math.abs(x + 0.5) < 22 && z > -72;
      if (near) quad(x, z, g.step);
      else if (xi % 4 === 0 && zi % 4 === 0) quad(x, z, g.step * 4);
    }
  }
  const bg = new BufferGeometry();
  bg.setAttribute("position", new BufferAttribute(new Float32Array(verts), 3));
  bg.setAttribute("normal", new BufferAttribute(new Float32Array(norms), 3));
  bg.setAttribute("uv", new BufferAttribute(new Float32Array(uvs), 2));
  bg.setAttribute("color", new BufferAttribute(new Float32Array(cols), 3));
  bg.computeBoundingSphere();
  bg.computeBoundingBox();
  const mesh = nameNode(new Mesh(bg, g.material), "ground");
  mesh.userData["surface"] = "dirt";
  mesh.matrixAutoUpdate = false;
  b.root.add(mesh);
}

function buildBuilding(b: TownBuilder, s: BuildingSpec, mat: Mats, C: Colors, glass: MeshBasicMaterial): void {
  const chunk = `b.${s.id}`;
  const side = s.side;
  const albedo = new Color(s.color);
  const wallMat = mat[s.material];
  const surface = s.material === "stone" ? "stone" : "wood";
  const t = 0.24; // facade thickness
  const xf = side * FACADE_X; // the street face
  const xc = xf + side * (t / 2); // facade slab centre
  const zN = s.zNear;
  const zF = s.zFar;
  const coverTop = s.awning ? 3.2 : s.balcony ? 3.35 : 0;

  // Facade with its openings, cut into a grid of boxes around them.
  const zs = new Set<number>([zN, zF]);
  const ys = new Set<number>([0, s.front]);
  for (const o of s.openings) {
    zs.add(o.z + o.w / 2);
    zs.add(o.z - o.w / 2);
    ys.add(o.y);
    ys.add(o.y + o.h);
  }
  if (coverTop > 0) ys.add(coverTop);
  const zl = [...zs].sort((a, b2) => b2 - a);
  const yl = [...ys].sort((a, b2) => a - b2);
  for (let i = 0; i < zl.length - 1; i++) {
    for (let j = 0; j < yl.length - 1; j++) {
      const za = zl[i] as number;
      const zb = zl[i + 1] as number;
      const ya = yl[j] as number;
      const yb = yl[j + 1] as number;
      const zc = (za + zb) / 2;
      const yc = (ya + yb) / 2;
      const inside = s.openings.some((o) => Math.abs(zc - o.z) < o.w / 2 && yc > o.y && yc < o.y + o.h);
      if (inside) continue;
      b.box(chunk, wallMat, [xc, yc, zc], [t, yb - ya, za - zb], albedo, {
        surface,
        sunShade: yb <= coverTop + 1e-6 ? 0.28 : 1,
      });
    }
  }
  // Cornice at the top of the false front.
  b.box(chunk, mat.plain, [xf + side * -0.05, s.front + 0.08, (zN + zF) / 2], [0.4, 0.16, zN - zF + 0.2], C.trim as Color, { surface });
  // The shell behind: sides, back and roof.
  const xb = xf + side * s.depth;
  const xm = (xf + xb) / 2;
  b.box(chunk, wallMat, [xm, s.height / 2, zN - 0.1], [s.depth, s.height, 0.2], albedo, { surface });
  b.box(chunk, wallMat, [xm, s.height / 2, zF + 0.1], [s.depth, s.height, 0.2], albedo, { surface });
  b.box(chunk, wallMat, [xb - side * 0.1, s.height / 2, (zN + zF) / 2], [0.2, s.height, zN - zF], albedo, { surface });
  if (s.gable) {
    // A pitched barn roof, ridge running away from the street.
    const half = (zN - zF) / 2;
    const rise = 2.2;
    const slope = Math.atan2(rise, half);
    const len = Math.hypot(half, rise) + 0.3;
    for (const dir of [1, -1]) {
      b.box(chunk, mat.shingles, [xm, s.height + rise / 2, (zN + zF) / 2 + (dir * half) / 2], [s.depth + 0.4, 0.14, len], C.roof as Color, {
        rotation: new Euler(dir * slope, 0, 0),
        uvScale: 1.5,
      });
    }
  } else {
    b.box(chunk, mat.shingles, [xm, s.height + 0.05, (zN + zF) / 2], [s.depth, 0.1, zN - zF], C.roof as Color, { uvScale: 1.5 });
  }
  b.occluders.push({
    min: new Vector3(Math.min(xf, xb), 0, zF),
    max: new Vector3(Math.max(xf, xb), s.front + (s.gable ? 2.2 : 0), zN),
  });

  // Rooms behind every opening, dark, so a doorway or a window has depth.
  for (const o of s.openings) {
    const floor = o.kind === "door" ? o.y : o.y > 3 ? 3.6 : WALK_TOP;
    const ceil = Math.min(s.height - 0.1, floor + 3.0);
    const depth = 2.5;
    let zA = Math.min(zN - 0.25, o.z + o.w / 2 + 1.3);
    let zB = Math.max(zF + 0.25, o.z - o.w / 2 - 1.3);
    // Rooms on the same floor share the wall halfway between their openings.
    for (const other of s.openings) {
      if (other === o) continue;
      const otherFloor = other.kind === "door" ? other.y : other.y > 3 ? 3.6 : WALK_TOP;
      if (Math.abs(otherFloor - floor) > 0.5) continue;
      if (other.z > o.z) zA = Math.min(zA, (o.z + o.w / 2 + other.z - other.w / 2) / 2);
      else zB = Math.max(zB, (o.z - o.w / 2 + other.z + other.w / 2) / 2);
    }
    const xr0 = xf + side * t;
    const xr1 = xr0 + side * depth;
    const rx = (xr0 + xr1) / 2;
    // The saloon is lamp-lit inside (and the piano must read through its window); other rooms are dark.
    const lit = s.id === "saloon" && floor < 1;
    const dark = lit ? new Color("#6b4128") : (C.interior as Color);
    const o2: PartOptions = { sunShade: 0.05, dim: lit ? 1.2 : 0.55, surface: "wood" };
    b.box(chunk, mat.planks, [xr1 + side * 0.05, (floor + ceil) / 2, (zA + zB) / 2], [0.1, ceil - floor, zA - zB], dark, o2);
    b.box(chunk, mat.planks, [rx, floor - 0.05, (zA + zB) / 2], [depth, 0.1, zA - zB], dark, o2);
    b.box(chunk, mat.plain, [rx, ceil + 0.05, (zA + zB) / 2], [depth, 0.1, zA - zB], dark, { ...o2, dim: 0.4 });
    b.box(chunk, mat.planks, [rx, (floor + ceil) / 2, zA + 0.05], [depth, ceil - floor, 0.1], dark, o2);
    b.box(chunk, mat.planks, [rx, (floor + ceil) / 2, zB - 0.05], [depth, ceil - floor, 0.1], dark, o2);
    // Frames, sills and shutters.
    const frame = C.trim as Color;
    if (o.kind === "window") {
      b.box(chunk, mat.plain, [xf - side * 0.06, o.y - 0.06, o.z], [0.2, 0.1, o.w + 0.3], frame, { surface: "wood" });
      b.box(chunk, mat.plain, [xf - side * 0.03, o.y + o.h + 0.07, o.z], [0.12, 0.12, o.w + 0.24], frame, { surface: "wood" });
      if (o.shutters) {
        for (const d of [-1, 1]) {
          b.box(chunk, mat.boards, [xf - side * 0.05, o.y + o.h / 2, o.z + d * (o.w / 2 + 0.33)], [0.06, o.h, 0.52], new Color(s.color).multiplyScalar(0.7), {
            surface: "wood",
            uvScale: 0.8,
          });
        }
      }
    } else {
      b.box(chunk, mat.plain, [xf - side * 0.03, o.y + o.h + 0.07, o.z], [0.14, 0.14, o.w + 0.3], frame, { surface: "wood" });
      for (const d of [-1, 1]) {
        b.box(chunk, mat.plain, [xf - side * 0.03, o.y + o.h / 2, o.z + d * (o.w / 2 + 0.06)], [0.14, o.h, 0.12], frame, {
          surface: "wood",
          sunShade: coverTop > 0 ? 0.3 : 1,
        });
      }
    }
    if (o.glass) {
      const pane = new Mesh(new PlaneGeometry(o.w, o.h), glass);
      pane.position.set(xf + side * (t / 2), o.y + o.h / 2, o.z);
      pane.rotation.y = side < 0 ? Math.PI / 2 : -Math.PI / 2;
      nameNode(pane, `glass.${o.glass}`);
      pane.userData["surface"] = "glass";
      // Mullions, in front of the glass so they survive it.
      b.box(chunk, mat.plain, [xf - side * 0.02, o.y + o.h / 2, o.z], [0.05, o.h, 0.06], frame, { surface: "wood" });
      b.box(chunk, mat.plain, [xf - side * 0.02, o.y + o.h / 2, o.z], [0.05, 0.06, o.w], frame, { surface: "wood" });
      b.root.add(pane);
    }
  }

  // Porch awning on posts, or a balcony with a railing.
  if (s.awning) {
    const xa = side * WALK_EDGE;
    b.box(chunk, mat.shingles, [(xf + xa) / 2 + side * 0.05, 3.15, (zN + zF) / 2], [FACADE_X - WALK_EDGE + 0.3, 0.1, zN - zF], C.roof as Color, {
      rotation: new Euler(0, 0, side * -0.08),
      occlude: true,
      uvScale: 1.5,
    });
    for (let z = zN - 0.3; z >= zF + 0.2; z -= (zN - zF - 0.5) / Math.max(1, Math.round((zN - zF) / 3.2))) {
      b.box(chunk, mat.plain, [side * (WALK_EDGE + 0.12), (WALK_TOP + 3.1) / 2, z], [0.14, 3.1 - WALK_TOP, 0.14], C.post as Color, { occlude: true });
    }
  }
  if (s.balcony) {
    const xa = side * (WALK_EDGE + 0.4);
    const bw = FACADE_X - WALK_EDGE - 0.4;
    b.box(chunk, mat.planks, [(xf + xa) / 2, 3.42, (zN + zF) / 2], [bw, 0.16, zN - zF], C.walk as Color, { occlude: true, uvScale: 1.5 });
    const rail = `${chunk}.rail`;
    b.noCollide.add(rail);
    b.box(rail, mat.plain, [xa, 4.45, (zN + zF) / 2], [0.1, 0.1, zN - zF], C.trim as Color);
    b.box(rail, mat.plain, [xa, 3.62, (zN + zF) / 2], [0.08, 0.08, zN - zF], C.trim as Color);
    for (let z = zN - 0.2; z > zF; z -= 0.42) b.box(rail, mat.plain, [xa, 4.05, z], [0.05, 0.8, 0.05], C.trim as Color);
    for (let z = zN - 0.3; z >= zF + 0.2; z -= (zN - zF - 0.5) / Math.max(1, Math.round((zN - zF) / 3.5))) {
      b.box(chunk, mat.plain, [xa, (WALK_TOP + 3.35) / 2, z], [0.16, 3.35 - WALK_TOP, 0.16], C.post as Color, { occlude: true });
    }
  }
  if (s.sign) {
    const st = s.sign;
    const shade = side < 0 ? 1.0 : 0.6;
    addSign(b.root, `sign.${s.id}`, signTexture(st.text, st.board, st.ink), [xf - side * 0.04, st.y, (zN + zF) / 2], st.w, st.h, side < 0 ? Math.PI / 2 : -Math.PI / 2, shade);
  }
  // The livery's horse, curious, at the hay door.
  if (s.id === "livery") {
    const horse = new Color("#5a3a26");
    b.box(chunk, mat.plain, [xf - side * 0.15, 4.65, -47.1], [0.55, 0.42, 0.34], horse, { rotation: new Euler(0, 0, side * 0.25), surface: "cloth" });
    b.box(chunk, mat.plain, [xf - side * 0.55, 4.5, -47.1], [0.36, 0.26, 0.26], horse, { surface: "cloth" });
  }
}

function addSign(root: Object3D, name: string, map: Texture, pos: [number, number, number], w: number, h: number, rotY: number, shade: number): void {
  const m = new MeshBasicMaterial({ map, name });
  m.color.setScalar(shade);
  const sign = nameNode(new Mesh(new PlaneGeometry(w, h), m), name);
  sign.position.set(...pos);
  sign.rotation.y = rotY;
  sign.userData["surface"] = "wood";
  root.add(sign);
}

function barrel(b: TownBuilder, mat: Mats, C: Colors, x: number, y: number, z: number, onSide = false, h = 0.95): void {
  const r = 0.33;
  if (onSide) {
    b.cylinder("props", mat.boards, [x, y + r, z], r, h, C.barrel as Color, { rotation: new Euler(0, 0, Math.PI / 2), uvScale: 0.6 });
    return;
  }
  b.cylinder("props", mat.boards, [x, y + h / 2, z], r, h, C.barrel as Color, { radiusTop: r * 0.92, uvScale: 0.6, occlude: true, segments: 14 });
  for (const f of [0.18, 0.82]) b.cylinder("props", mat.plain, [x, y + h * f, z], r * 1.02, 0.05, C.hoop as Color, { segments: 14, surface: "metal" });
  b.cylinder("props", mat.plain, [x, y + h + 0.005, z], r * 0.9, 0.01, (C.barrel as Color).clone().multiplyScalar(0.8), { segments: 14 });
}

function crate(b: TownBuilder, mat: Mats, C: Colors, x: number, y: number, z: number, s: number): void {
  b.box("props", mat.boards, [x, y + s / 2, z], [s, s, s], C.crate as Color, { uvScale: 0.9, occlude: true });
  const edge = (C.crate as Color).clone().multiplyScalar(0.7);
  b.box("props", mat.plain, [x, y + s / 2, z + s / 2 + 0.01], [s, 0.08, 0.02], edge);
  b.box("props", mat.plain, [x + s / 2 + 0.01, y + s / 2, z], [0.02, 0.08, s], edge);
}

function waterSurface(b: TownBuilder, c: [number, number, number], size: [number, number]): void {
  const m = unlit(null, "water");
  b.box("water", m, c, [size[0], 0.02, size[1]], new Color("#3f5f6a"), { surface: "water", dim: 1.1 });
}

function wagon(b: TownBuilder, mat: Mats, C: Colors, x: number, z: number): void {
  const wood = new Color("#6b4b30");
  // A broken wagon: missing its near-left wheel, the bed tipped onto that corner.
  const tilt = new Euler(0.06, 0, -0.1);
  b.box("wagon", mat.planks, [x, 0.85, z], [1.6, 0.14, 3.4], wood, { rotation: tilt, occlude: true, uvScale: 1.2 });
  for (const dx of [-0.78, 0.78]) b.box("wagon", mat.planks, [x + dx, 1.02, z], [0.08, 0.26, 3.4], wood, { rotation: tilt, uvScale: 1.2 });
  b.box("wagon", mat.planks, [x, 1.02, z - 1.66], [1.6, 0.26, 0.08], wood, { rotation: tilt });
  const wheel = new Color("#4c3522");
  for (const [dx, dz] of [
    [0.85, -1.2],
    [0.85, 1.2],
    [-0.85, -1.2],
  ] as [number, number][]) {
    b.cylinder("wagon", mat.plain, [x + dx, 0.5, z + dz], 0.5, 0.08, wheel, { rotation: new Euler(0, 0, Math.PI / 2), segments: 16, occlude: true });
    b.cylinder("wagon", mat.plain, [x + dx, 0.5, z + dz], 0.1, 0.16, C.hoop as Color, { rotation: new Euler(0, 0, Math.PI / 2), segments: 8, surface: "metal" });
  }
  // The fallen wheel in the dust.
  b.cylinder("wagon", mat.plain, [x - 1.6, 0.05, z + 1.5], 0.5, 0.08, wheel, { segments: 16 });
  // The shaft, dropped.
  b.box("wagon", mat.plain, [x + 0.2, 0.25, z + 2.6], [0.1, 0.1, 2.2], wood, { rotation: new Euler(0.2, 0.15, 0) });
}

function buildChurch(b: TownBuilder, mat: Mats, C: Colors, light: BakeLight): Group {
  const white = C.church as Color;
  const roof = C.churchRoof as Color;
  const zF = -60;
  b.box("church", mat.boards, [-3.55, 3.5, zF - 6], [5.1, 7, 12], white, { occlude: true, uvScale: 1.6 });
  b.box("church", mat.boards, [3.55, 3.5, zF - 6], [5.1, 7, 12], white, { occlude: true, uvScale: 1.6 });
  // Above the doors.
  b.box("church", mat.boards, [0, 5.1, zF - 0.12], [2.0, 3.8, 0.24], white, { uvScale: 1.6 });
  b.box("church", mat.boards, [0, 3.5, zF - 6.4], [2.2, 7, 11.2], white, { uvScale: 1.6, dim: 0.7 });
  // Dark behind the doors.
  b.box("church", mat.plain, [0, 1.6, zF - 1.2], [2.0, 3.2, 0.1], C.interior as Color, { dim: 0.5, sunShade: 0.1 });
  // Pitched roof, ridge along Z.
  const half = 6.4;
  const rise = 3.4;
  const slope = Math.atan2(rise, half);
  for (const d of [-1, 1]) {
    b.box("church", mat.shingles, [(d * half) / 2, 7 + rise / 2, zF - 6], [Math.hypot(half, rise) + 0.3, 0.16, 12.4], roof, {
      rotation: new Euler(0, 0, -d * slope),
      occlude: true,
      uvScale: 1.5,
    });
  }
  // Gable end facing the street, stepped in six courses.
  for (let i = 0; i < 6; i++) {
    const w = half * 2 * (1 - i / 6);
    b.box("church", mat.boards, [0, 7 + (rise * i) / 6 + rise / 12, zF - 0.1], [w, rise / 6, 0.2], white, { uvScale: 1.6 });
  }
  // A round window.
  b.cylinder("church", mat.plain, [0, 8.2, zF + 0.02], 0.55, 0.06, C.interior as Color, { rotation: new Euler(Math.PI / 2, 0, 0), segments: 20, dim: 0.8 });
  // Steps.
  b.box("church", mat.stone, [0, 0.1, zF + 0.9], [3.4, 0.2, 1.0], new Color("#b5a88f"), { surface: "stone" });
  b.box("church", mat.stone, [0, 0.25, zF + 0.4], [3.0, 0.2, 0.6], new Color("#b5a88f"), { surface: "stone" });

  // The bell tower, centred over the doors, with an open belfry.
  const tz0 = zF - 1.5;
  const tz1 = zF - 5.0;
  const tzc = (tz0 + tz1) / 2;
  b.box("tower", mat.boards, [0, 8.6, tzc], [3.6, 3.2, 3.5], white, { occlude: true, uvScale: 1.6 });
  // Belfry floor, corner posts and a parapet a rifleman can crouch behind.
  b.box("tower", mat.planks, [0, 10.25, tzc], [3.8, 0.1, 3.7], roof);
  for (const [dx, dz] of [
    [-1.7, tz0 + 0.1],
    [1.7, tz0 + 0.1],
    [-1.7, tz1 - 0.1],
    [1.7, tz1 - 0.1],
  ] as [number, number][]) {
    b.box("tower", mat.plain, [dx, 11.75, dz], [0.3, 3.0, 0.3], white, { occlude: true });
  }
  b.box("tower", mat.boards, [0, 10.7, tz0 + 0.1], [3.2, 0.9, 0.14], white, { uvScale: 1.6 });
  b.box("tower", mat.boards, [-1.72, 10.7, tzc], [0.14, 0.9, 3.2], white);
  b.box("tower", mat.boards, [1.72, 10.7, tzc], [0.14, 0.9, 3.2], white);
  b.box("tower", mat.plain, [0, 13.3, tzc], [4.0, 0.16, 3.9], roof);
  // Spire: a four-sided pyramid.
  b.cylinder("tower", mat.shingles, [0, 14.95, tzc], 2.35, 3.2, roof, { radiusTop: 0.05, segments: 4, rotation: new Euler(0, Math.PI / 4, 0), occlude: true });

  const group = nameNode(new Group(), "church.secrets");

  // The bell: pivot at the yoke.
  const bellSub = new TownBuilder(light);
  const bellMat = unlit(null, "bronze");
  const profile = [
    new Vector2(0.02, 0),
    new Vector2(0.2, -0.02),
    new Vector2(0.27, -0.2),
    new Vector2(0.32, -0.55),
    new Vector2(0.44, -0.8),
    new Vector2(0.47, -0.86),
    new Vector2(0.02, -0.86),
  ];
  const bellGeo = new LatheGeometry(profile, 20);
  const pivot = new Vector3(0, 12.55, tzc);
  bellSub.add("bell", bellMat, bellGeo, new Matrix4().makeTranslation(pivot.x, pivot.y - 0.08, pivot.z), C.bronze as Color, { surface: "metal" });
  bellSub.box("bell", bellMat, [pivot.x, pivot.y, pivot.z], [1.3, 0.16, 0.18], new Color("#3d2c20"), { surface: "wood" });
  bellSub.finish();
  const bell = pivotGroup("secret.bell", pivot, bellSub.root);
  // The yoke's beam, fixed, across the belfry.
  b.box("tower", mat.plain, [0, pivot.y + 0.12, tzc], [3.4, 0.12, 0.12], new Color("#3d2c20"));

  // The weather vane on its spindle; the arrow points along its local +X.
  const vaneSub = new TownBuilder(light);
  const iron = unlit(null, "iron");
  const vp = new Vector3(0, 16.75, tzc);
  vaneSub.box("vane", iron, [vp.x + 0.1, vp.y + 0.35, vp.z], [1.3, 0.05, 0.05], new Color("#2f2c2a"), { surface: "metal" });
  vaneSub.box("vane", iron, [vp.x + 0.72, vp.y + 0.35, vp.z], [0.22, 0.2, 0.04], new Color("#2f2c2a"), { surface: "metal", rotation: new Euler(0, 0, Math.PI / 4) });
  vaneSub.box("vane", iron, [vp.x - 0.45, vp.y + 0.35, vp.z], [0.3, 0.34, 0.03], new Color("#2f2c2a"), { surface: "metal" });
  // A rooster on top, of course.
  vaneSub.box("vane", iron, [vp.x - 0.05, vp.y + 0.62, vp.z], [0.42, 0.26, 0.04], new Color("#2f2c2a"), { surface: "metal" });
  vaneSub.box("vane", iron, [vp.x + 0.14, vp.y + 0.8, vp.z], [0.12, 0.2, 0.04], new Color("#2f2c2a"), { surface: "metal" });
  vaneSub.finish();
  const vane = pivotGroup("secret.vane", vp, vaneSub.root);
  vane.rotation.y = 0.9;
  b.box("tower", mat.plain, [vp.x, vp.y - 0.25, vp.z], [0.05, 1.1, 0.05], new Color("#2f2c2a"), { surface: "metal" });
  // N-S-E-W arms under it.
  b.box("tower", mat.plain, [vp.x, vp.y + 0.05, vp.z], [0.7, 0.03, 0.03], new Color("#2f2c2a"), { surface: "metal" });
  b.box("tower", mat.plain, [vp.x, vp.y + 0.05, vp.z], [0.03, 0.03, 0.7], new Color("#2f2c2a"), { surface: "metal" });

  // The church doors, hinged at their outer edges.
  const doorsWood = new Color("#6a4630");
  const doors: Group[] = [];
  for (const [name, hx, dir] of [
    ["secret.church_doors.left", -1.0, 1],
    ["secret.church_doors.right", 1.0, -1],
  ] as [string, number, number][]) {
    const sub = new TownBuilder(light);
    const dm = unlit(boardsTexture(9), "door");
    sub.box("door", dm, [hx + (dir * 0.98) / 2, 1.6, zF + 0.02], [0.98, 3.2, 0.1], doorsWood, { uvScale: 0.9, surface: "wood" });
    sub.box("door", dm, [hx + dir * 0.82, 1.5, zF + 0.1], [0.06, 0.2, 0.06], new Color("#2a2522"), { surface: "metal" });
    sub.finish();
    doors.push(pivotGroup(name, new Vector3(hx, 0, zF + 0.02), sub.root));
  }
  // The door frame.
  b.box("church", mat.plain, [0, 3.3, zF + 0.05], [2.4, 0.2, 0.2], C.trim as Color);
  for (const x of [-1.1, 1.1]) b.box("church", mat.plain, [x, 1.6, zF + 0.05], [0.16, 3.2, 0.2], C.trim as Color);

  group.add(bell, vane, ...doors);
  return group;
}

/** Re-home a sub-builder's world-space meshes under a node at `pivot`. */
function pivotGroup(name: string, pivot: Vector3, built: Group): Group {
  const g = nameNode(new Group(), name);
  g.position.copy(pivot);
  for (const child of [...built.children]) {
    const m = child as Mesh;
    if (m.isMesh) {
      m.geometry.translate(-pivot.x, -pivot.y, -pivot.z);
      m.geometry.computeBoundingSphere();
      m.geometry.computeBoundingBox();
      m.matrixAutoUpdate = true;
      m.position.set(0, 0, 0);
      m.updateMatrix();
    }
    g.add(child);
  }
  return g;
}

function buildWaterTower(b: TownBuilder, mat: Mats, C: Colors, light: BakeLight): Group {
  const cx = 15;
  const cz = -33;
  const legs = new Color("#5a4432");
  for (const [dx, dz] of [
    [-1.7, -1.7],
    [1.7, -1.7],
    [-1.7, 1.7],
    [1.7, 1.7],
  ] as [number, number][]) {
    b.box("watertower", mat.plain, [cx + dx * 0.9, 4.6, cz + dz * 0.9], [0.24, 9.2, 0.24], legs, {
      rotation: new Euler(dz * 0.02, 0, -dx * 0.02),
      occlude: true,
    });
  }
  for (const y of [3, 6.2]) {
    b.box("watertower", mat.plain, [cx, y, cz + 1.55], [3.2, 0.12, 0.1], legs);
    b.box("watertower", mat.plain, [cx, y, cz - 1.55], [3.2, 0.12, 0.1], legs);
  }
  b.box("watertower", mat.planks, [cx, 9.1, cz], [4.6, 0.2, 4.6], legs);
  b.cylinder("watertower", mat.shingles, [cx, 13.3, cz], 2.45, 1.3, C.churchRoof as Color, { radiusTop: 0.2, segments: 16 });
  const sub = new TownBuilder(light);
  const wm = unlit(boardsTexture(12), "tank");
  sub.cylinder("tank", wm, [cx, 10.85, cz], 2.2, 3.3, new Color("#8a6644"), { segments: 24, uvScale: 1.2, surface: "wood" });
  for (const y of [9.5, 10.85, 12.2]) sub.cylinder("tank", wm, [cx, y, cz], 2.23, 0.08, C.hoop as Color, { segments: 24, surface: "metal" });
  sub.finish();
  const tank = pivotGroup("secret.water_tower", new Vector3(cx, 10.85, cz), sub.root);
  b.occluders.push({ min: new Vector3(cx - 2.2, 9.2, cz - 2.2), max: new Vector3(cx + 2.2, 12.5, cz + 2.2) });
  return tank;
}

function buildWindmill(b: TownBuilder, mat: Mats, C: Colors): void {
  const x = -34;
  const z = -96;
  const y0 = 3.5; // on the ridge
  b.box("far", mat.plain, [x, y0 / 2, z], [26, y0, 14], new Color("#b58f68"), { dim: 0.95 });
  for (const [dx, dz] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ] as [number, number][]) {
    b.box("far", mat.plain, [x + dx * 0.9, y0 + 5, z + dz * 0.9], [0.18, 10, 0.18], C.post as Color, { rotation: new Euler(dz * 0.08, 0, -dx * 0.08) });
  }
  b.box("far", mat.plain, [x, y0 + 10.2, z + 0.3], [0.8, 0.8, 1.2], C.darkWood as Color);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    b.box("far", mat.plain, [x + Math.cos(a) * 1.1, y0 + 10.2 + Math.sin(a) * 1.1, z + 0.95], [1.9, 0.26, 0.03], C.trim as Color, {
      rotation: new Euler(0, 0, a),
    });
  }
  b.box("far", mat.plain, [x, y0 + 10.2, z - 1.4], [0.06, 0.9, 1.6], C.trim as Color);
}

function buildPiano(light: BakeLight): Group {
  // Upright piano against the back wall of the room behind the saloon's window,
  // its keys facing the street; readable through the glass under a lamp.
  const sub = new TownBuilder(light);
  const wood = unlit(null, "piano");
  // From the street the window is seen at a slant, so the piano stands just
  // inside it and toward the far side, where that slanted view reaches.
  const x = -9.2;
  const z = -21.95;
  const y = WALK_TOP;
  const lamp: PartOptions = { dim: 1.9, sunShade: 0.3, surface: "wood" };
  sub.box("piano", wood, [x, y + 0.65, z], [0.55, 1.3, 1.5], new Color("#3b2016"), lamp);
  sub.box("piano", wood, [x + 0.34, y + 0.78, z], [0.2, 0.05, 1.3], new Color("#efe8d8"), lamp);
  for (let i = 0; i < 9; i++) sub.box("piano", wood, [x + 0.3, y + 0.815, z - 0.58 + i * 0.145], [0.1, 0.03, 0.05], new Color("#161210"), lamp);
  sub.box("piano", wood, [x + 0.2, y + 1.08, z], [0.1, 0.34, 1.3], new Color("#2e1911"), lamp);
  sub.box("piano", wood, [x + 0.15, y + 1.34, z + 0.45], [0.12, 0.14, 0.12], new Color("#d9a54a"), { ...lamp, dim: 1.4 });
  sub.finish();
  return pivotGroup("secret.piano", new Vector3(x, y, z), sub.root);
}

function addCovers(b: TownBuilder): void {
  type C = [string, string, string, number, [number, number, number], [number, number, number], Record<string, unknown>?];
  const W = WALK_TOP;
  const covers: C[] = [
    // Left side, near to far.
    ["store_barrels", "barrel", "rise", 0, [-6.95, W, -13.1], [-6.95, W, -13.1]],
    ["store_door", "door", "step_out", 0, [-8.05, W, -15.1], [-9.4, W, -15.95], { townsfolk: true }],
    ["store_corner", "corner", "lean_left", 0, [-8.3, W, -17.75], [-9.9, W, -17.75]],
    ["saloon_door", "door", "step_out", 0, [-8.0, W, -24.8], [-9.5, W, -25.75], { duel: true }],
    ["saloon_window_1", "window", "step_out", 1, [-6.72, 3.5, -21], [-9.6, 3.6, -21.95]],
    ["saloon_window_2", "window", "step_out", 1, [-6.72, 3.5, -24.8], [-9.6, 3.6, -25.75]],
    ["saloon_window_3", "window", "step_out", 1, [-6.72, 3.5, -28.6], [-9.6, 3.6, -29.55]],
    ["saloon_corner", "corner", "lean_left", 0, [-8.3, W, -31.75], [-9.9, W, -31.75]],
    ["barber_door", "door", "step_out", 0, [-8.0, W, -36], [-9.5, W, -36.9]],
    ["livery_hay", "crate", "rise", 0, [-5.95, 0, -44.75], [-5.95, 0, -44.75]],
    ["livery_door", "door", "step_out", 0, [-8.0, W, -47], [-9.6, W, -48.3]],
    ["livery_corner", "corner", "lean_left", 0, [-8.25, 0, -53.9], [-9.7, 0, -53.9]],
    ["wagon_bed", "wagon", "rise", 0, [-3.7, 0, -28.95], [-3.7, 0, -28.95]],
    ["wagon_wheel", "wagon", "lean_left", 0, [-2.35, 0, -28.6], [-3.2, 0, -28.6]],
    ["store_roof", "roof", "rise", 2, [-8.92, 4.45, -15.4], [-9.8, 4.45, -15.7]],
    ["saloon_roof", "roof", "rise", 2, [-8.95, 8.05, -26.5], [-9.8, 8.05, -26.8]],
    // Right side, near to far.
    ["bank_door", "door", "step_out", 0, [8.05, W, -13.9], [9.5, W, -14.75]],
    ["bank_roof", "roof", "rise", 2, [9.1, 5.55, -14.6], [9.8, 5.55, -14.9]],
    ["trough", "crate", "rise", 0, [5.0, 0, -15.05], [5.0, 0, -15.05]],
    ["bank_corner", "corner", "lean_right", 0, [8.3, W, -16.75], [9.9, W, -16.75]],
    ["sheriff_door", "door", "step_out", 0, [8.05, W, -23], [9.5, W, -23.9]],
    ["sheriff_crates", "crate", "rise", 0, [6.9, W, -25.85], [6.9, W, -25.85]],
    ["hotel_window_1", "window", "step_out", 1, [6.72, 3.5, -29.5], [9.6, 3.6, -30.45], { townsfolk: true }],
    ["hotel_window_2", "window", "step_out", 1, [6.72, 3.5, -33], [9.6, 3.6, -33.95], { townsfolk: true }],
    ["hotel_window_3", "window", "step_out", 1, [6.72, 3.5, -36.5], [9.6, 3.6, -37.45]],
    ["hotel_roof", "roof", "rise", 2, [8.95, 8.25, -31.5], [9.8, 8.25, -31.8]],
    ["undertaker_coffins", "crate", "lean_right", 0, [6.25, W, -43.55], [7.05, W, -43.55]],
    ["undertaker_door", "door", "step_out", 0, [8.05, W, -45.5], [9.5, W, -46.4], { townsfolk: true }],
    ["undertaker_corner", "corner", "lean_right", 0, [8.25, 0, -49.8], [9.7, 0, -49.8]],
    // The middle and the far end.
    ["crates_mid", "crate", "rise", 0, [3.15, 0, -38.7], [3.15, 0, -38.7]],
    ["far_barrels", "barrel", "rise", 0, [2.75, 0, -52.05], [2.75, 0, -52.05]],
    ["church_tower", "tower", "rise", 2, [0, 10.3, -61.9], [0.7, 10.3, -63.0]],
  ];
  for (const [id, kind, emerge, level, exposed, hidden, extra] of covers) {
    const node = b.node(`cover.${id}`, exposed, { kind, emerge, level, ...(extra ?? {}) });
    // Face the player (a character faces +Z; turn its +Z toward the eye).
    node.rotation.y = Math.atan2(-exposed[0], -exposed[2]);
    const h = b.node(`cover.${id}.hidden`, hidden);
    h.rotation.y = node.rotation.y;
  }
}

function addCalibration(b: TownBuilder): void {
  // Nine bottles spread over the view at 16:10 and still inside it at 4:3:
  // corners, edges and centre, each standing on something.
  const spots: [number, number, number][] = [
    [-8.25, 5.2 + 0.4, -15.2], // top-left: on the store's cornice
    [0.35, 6.95, -17.9], // top-centre: hanging from the arch
    [8.3, 6.56, -15.5], // top-right: on the bank's cornice
    [-6.6, WALK_TOP + 0.95, -12.3], // left: on a barrel on the store's porch
    [-2.95, 1.05, -26.3], // centre: on the wagon
    [5.55, 1.08, -10.9], // right: on the hitching rail
    [-2.3, 0.35, -4.4], // bottom-left: a low crate
    [-0.15, 0.3, -5.4], // bottom-centre: a flat stone
    [2.35, 0.42, -4.55], // bottom-right: a keg
  ];
  for (const [i, p] of spots.entries()) b.node(`calib.${i + 1}`, p);
}

/** The street and the boardwalk tops, where dynamic shadows are drawn. */
function shadowCatcherGeometry(): BufferGeometry {
  const parts: [number, number, number, number, number][] = [
    // x0, x1, z0, z1, y
    [-6.0, 6.0, 4, -60, 0.012],
    [-8.5, -6.0, -6.5, -53.2, WALK_TOP + 0.012],
    [6.0, 8.5, -6.5, -49.3, WALK_TOP + 0.012],
  ];
  const pos: number[] = [];
  const nor: number[] = [];
  for (const [x0, x1, z0, z1, y] of parts) {
    pos.push(x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z0, x1, y, z1, x0, y, z1);
    for (let i = 0; i < 6; i++) nor.push(0, 1, 0);
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute("normal", new BufferAttribute(new Float32Array(nor), 3));
  g.computeBoundingSphere();
  return g;
}
