import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Euler,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  SphereGeometry,
  Vector3,
  type Texture,
} from "three";
import { mulberry32 } from "../../../engine/rules/rng";
import { nameNode } from "../../../engine/world/names";
import { col, NightBuilder, type NightLight, type PartOptions } from "./builder";
import { BARRICADE_Z, EYE, LANES, SLOTS, SPAWNS, SURVIVOR_PATHS, type P } from "./layout";
import { asphaltTexture, burlapTexture, canPaint, concreteTexture, dirtTexture, metalTexture, planksTexture } from "./textures";

/**
 * Route 9, built from boxes in code to exactly the node contract the real
 * road.glb follows (docs/DEAD_OF_NIGHT.md, "Asset contract"): the eye, the
 * moon, the practical lights, the lanes and the surprises' ways out, the
 * barricade's places, the nine jars' spots, every secret, the moon's disc,
 * the corn, the ground's shadow catcher, and a surface on every mesh. The
 * night's light is baked into the vertices (./builder.ts), with each
 * vertex's albedo and the streetlight's share beside it. When road.glb
 * arrives the game loads it instead and none of the game code changes.
 *
 * Layout (metres; the player at the origin looking north up the road
 * along −Z, left is −X): the barricade across the forecourt 2.75 m out, the
 * pickup on its side along its right end; the crossroads at 25 m with the
 * streetlight and the phone booth; the corn behind a split-rail fence on the
 * left with the red barn at 60 m; the Starlite Motel and the pines on the
 * right; the burned bus across the road at 45 m; the drive-in on the hill.
 */

/** The streetlight's lamp head, over the crossroads. */
export const STREET_LAMP: P = [3.6, 7.4, -24];
export const NEON: P = [-5.7, 5.3, -19.2];
const MOON_TOWARD = new Vector3(-0.393, 0.259, -0.882).normalize();
/** The moon's light comes from higher than its disc sits: it lights the road, not the horizon. */
const MOON_LIGHT = new Vector3(0.38, -0.68, 0.63).normalize();

const SODIUM = new Color(1.0, 0.56, 0.23);
const NEON_RED = new Color(1.0, 0.16, 0.24);
const CANDLE = new Color(1.0, 0.55, 0.24);

export interface PlaceholderRoad {
  root: Group;
}

export function buildPlaceholderRoad(): Group {
  const light: NightLight = {
    moon: MOON_LIGHT,
    moonColor: new Color(0.17, 0.21, 0.31),
    sky: new Color(0.013, 0.017, 0.03),
    bounce: new Color(0.007, 0.007, 0.009),
    street: { pos: new Vector3(...STREET_LAMP), color: SODIUM, power: 60, reach: 36, shadows: true },
    points: [
      { pos: new Vector3(...NEON), color: NEON_RED, power: 4.5, reach: 13, shadows: false },
      // The candle-lit motel rooms, the lamp behind the station's counter.
      { pos: new Vector3(13.2, 1.4, -40), color: CANDLE, power: 0.9, reach: 5, shadows: false },
      { pos: new Vector3(13.2, 1.4, -50.5), color: CANDLE, power: 0.9, reach: 5, shadows: false },
      { pos: new Vector3(9, 2.3, -16), color: new Color(1, 0.72, 0.42), power: 1.6, reach: 7, shadows: false },
    ],
  };
  const b = new NightBuilder(light);
  const rand = mulberry32(1958);
  // Without a page to paint on (the tests), the road goes without its detail.
  const paint = canPaint();
  const tex: Tex = {
    asphalt: paint ? asphaltTexture(1) : null,
    concrete: paint ? concreteTexture(2) : null,
    dirt: paint ? dirtTexture(3) : null,
    planks: paint ? planksTexture(4) : null,
    burlap: paint ? burlapTexture(5) : null,
    metal: paint ? metalTexture(6) : null,
  };
  const jitter = (c: Color, k = 0.12) => c.clone().multiplyScalar(1 - k / 2 + rand() * k);

  // --- occluders first, so the ground is baked with their shadows -------------------
  buildOccluders(b);

  // --- the ground ------------------------------------------------------------------
  const asphalt = col("#4a4a4c");
  const wet = col("#2b2c30");
  const gravel = col("#6b6459");
  const field = col("#4b4636");
  const grass = col("#3a3f2c");
  // Route 9, north: finely near the crossroads, where the streetlight pools.
  const roadAlbedo = (x: number, z: number) => {
    // Faded yellow centre dashes; wet patches that mirror the lamp.
    if (Math.abs(x) < 0.08 && Math.floor(-z / 3) % 2 === 0 && z < -4) return col("#8a7a3a");
    const puddle = Math.sin(x * 1.3 + z * 0.37) * Math.sin(z * 0.23 - x * 0.5) > 0.55;
    return puddle ? wet : asphalt;
  };
  b.ground(-3.6, 3.6, -8, -60, 0, 0.9, roadAlbedo, { surface: "asphalt", detail: tex.asphalt, uvScale: 3 });
  b.ground(-3.6, 3.6, -60, -220, 0, 4, roadAlbedo, { surface: "asphalt", detail: tex.asphalt, uvScale: 3 });
  // The crossroad.
  b.ground(-120, -3.6, -21.6, -27.6, 0, 1.5, () => asphalt, { surface: "asphalt", detail: tex.asphalt, uvScale: 3 });
  b.ground(3.6, 120, -21.6, -27.6, 0, 1.5, () => asphalt, { surface: "asphalt", detail: tex.asphalt, uvScale: 3 });
  // The forecourt's concrete, under the canopy and out to the road.
  b.ground(-9, 9, 6, -8, 0, 0.8, (x, z) => (Math.sin(x * 2.1) * Math.cos(z * 1.7) > 0.7 ? col("#3c3a37") : col("#5c5a55")), { surface: "asphalt", detail: tex.concrete, uvScale: 4 });
  // Shoulders of gravel, then the fields.
  b.ground(-5.2, -3.6, -8, -21.6, 0.01, 1, () => gravel, { surface: "dirt", detail: tex.dirt });
  b.ground(-5.2, -3.6, -27.6, -120, 0.01, 2, () => gravel, { surface: "dirt", detail: tex.dirt });
  b.ground(3.6, 5.4, -8, -21.6, 0.01, 1, () => gravel, { surface: "dirt", detail: tex.dirt });
  b.ground(3.6, 5.4, -27.6, -120, 0.01, 2, () => gravel, { surface: "dirt", detail: tex.dirt });
  // The fields: the corn's soil on the left, grass on the right.
  b.ground(-80, -5.2, -8, -21.6, 0, 2, () => field, { surface: "dirt", detail: tex.dirt, uvScale: 3 });
  b.ground(-80, -5.2, -27.6, -130, 0, 3, () => field, { surface: "dirt", detail: tex.dirt, uvScale: 3 });
  b.ground(5.4, 90, -8, -21.6, 0, 2, () => grass, { surface: "dirt", detail: tex.dirt, uvScale: 3 });
  b.ground(5.4, 90, -27.6, -130, 0, 3, () => grass, { surface: "dirt", detail: tex.dirt, uvScale: 3 });
  b.ground(-120, 120, -130, -300, 0, 12, () => field, { surface: "dirt", detail: tex.dirt, uvScale: 4 });
  b.ground(-120, -9, 6, -8, 0, 4, () => grass, { surface: "dirt", detail: tex.dirt, uvScale: 3 });
  b.ground(9, 120, 6, -8, 0, 4, () => grass, { surface: "dirt", detail: tex.dirt, uvScale: 3 });
  b.ground(-120, 120, 40, 6, 0, 8, () => grass, { surface: "dirt", detail: tex.dirt, uvScale: 3 });

  buildStation(b, tex, jitter);
  buildBarricade(b, tex, jitter, rand);
  buildLeft(b, tex, jitter, rand);
  buildRight(b, tex, jitter, rand);
  buildFar(b, tex, jitter, rand);
  buildSign(b);
  buildCorn(b, rand);
  const named = b.finish();
  const root = b.root;
  // The station's window: dark glass you can see the counter and the radio through.
  const glass = named.get("station.glass");
  if (glass) {
    const m = glass.material as MeshBasicMaterial;
    m.transparent = true;
    m.opacity = 0.4;
    m.depthWrite = false;
    glass.renderOrder = 2;
  }

  // --- the contract's nodes -----------------------------------------------------------
  const cam = nameNode(new Object3D(), "camera.player");
  cam.position.set(...EYE);
  cam.rotation.set((-5 * Math.PI) / 180, 0, 0, "YXZ");
  cam.userData["fov"] = 50;
  const lens = new PerspectiveCamera(50, 16 / 10, 0.1, 400);
  cam.add(lens);
  root.add(cam);

  const moon = nameNode(new Object3D(), "moon");
  moon.position.set(0, 10, 0);
  moon.quaternion.setFromUnitVectors(new Vector3(0, 0, -1), MOON_LIGHT);
  root.add(moon);

  b.node("light.street", [...STREET_LAMP]);
  b.node("light.neon", [...NEON]);
  b.node("light.motel.1", [13.2, 1.4, -40]);
  b.node("light.motel.2", [13.2, 1.4, -50.5]);

  LANES.road.points.forEach((p, i) => b.node(`lane.road.${i + 1}`, [...p], i === 0 ? { spread: LANES.road.spread } : {}));
  LANES.corn.points.forEach((p, i) => b.node(`lane.corn.${i + 1}`, [...p], i === 0 ? { spread: LANES.corn.spread } : {}));
  LANES.trees.points.forEach((p, i) => b.node(`lane.trees.${i + 1}`, [...p], i === 0 ? { spread: LANES.trees.spread } : {}));
  for (const id of ["bus", "booth", "fence"] as const) {
    const s = SPAWNS[id];
    b.node(`spawn.${id}`, [...s.at], { spread: s.spread });
    s.path.forEach((p, i) => b.node(`spawn.${id}.path.${i + 1}`, [...p]));
  }
  SLOTS.forEach((p, i) => b.node(`barricade.${i + 1}`, [...p]));
  SURVIVOR_PATHS.forEach((path, n) => path.forEach((p, k) => b.node(`path.survivor.${n + 1}.${k + 1}`, [...p])));

  // The nine jars, on the fence, the pump, the drum, the crates, the barricade and the bus.
  JARS.forEach((p, i) => b.node(`calib.${i + 1}`, [...p]));

  // --- the secrets, the corn, the lamp: the parts the game moves or lights -----------------
  const corn = nameNode(new Group(), "corn");
  root.add(corn);
  for (const [name, mesh] of named) {
    if (name === "secret.scarecrow.head") continue;
    (name === "corn.field" ? corn : root).add(mesh);
  }
  const scarecrow = named.get("secret.scarecrow");
  const head = named.get("secret.scarecrow.head");
  if (scarecrow && head) {
    // The head turns on its own pivot at the neck, and goes with the scarecrow when it goes.
    head.position.sub(scarecrow.position);
    scarecrow.add(head);
  }
  CAT_SPOTS.forEach((p, i) => b.node(`secret.cat.spot.${i + 1}`, [...p]));
  root.add(moonDisc());

  // The shadow catcher over the road and the forecourt.
  const catcher = new Mesh(new PlaneGeometry(22, 70).rotateX(-Math.PI / 2), new MeshBasicMaterial({ visible: false }));
  catcher.position.set(0, 0.02, -33);
  const shadowNode = nameNode(new Object3D(), "ground.shadow");
  nameNode(catcher, "ground.shadow.plane");
  shadowNode.add(catcher);
  root.add(shadowNode);
  root.userData["fog_color"] = "#2a323d";
  return root;
}

/** Where the nine jars stand, spread over the check's view as the aim check needs: on the neon sign, the bus, the motel's sign, a fence post, a sawhorse, the crates, and along the barricade. */
const JARS: readonly P[] = [
  [-6.76, 6.08, -19.72],
  [-1.2, 3.02, -44.4],
  [11.3, 6.72, -30.4],
  [-6.2, 1.28, -12.5],
  [-1.8, 1.02, -21],
  [5.85, 1.07, -19.45],
  [-1.25, 1.02, -2.72],
  [0.15, 1.02, -2.72],
  [1.45, 1.02, -2.72],
];

/** Where the scarecrow's post stands in the corn. */
const SCARECROW: P = [-13, 0, -33];

/** The cat: on the crates by the station, on the oil drum, on the sawhorse, on the motel's sign - all well inside the play's view, and none by another secret that would take a shot meant for it. */
const CAT_SPOTS: readonly P[] = [
  [5.75, 1.06, -19.35],
  [-3.05, 0.93, -17.2],
  [-1.8, 1.01, -21],
  [11.3, 6.72, -30.4],
];

type Tex = Record<"asphalt" | "concrete" | "dirt" | "planks" | "burlap" | "metal", Texture | null>;
type Jitter = (c: Color, k?: number) => Color;

/** Boxes that throw baked shadows: the big things. Added first, so the ground is baked with them. */
function buildOccluders(b: NightBuilder): void {
  const occ = (min: [number, number, number], max: [number, number, number]) => b.occluders.push({ min: new Vector3(...min), max: new Vector3(...max) });
  occ([-7.8, 4.3, -3.6], [5.6, 4.9, 4.6]); // canopy
  occ([6.8, 0, -21.2], [13, 4.4, -10.8]); // station
  occ([13.5, 0, -55.2], [19.6, 3.4, -32.8]); // motel
  occ([-8, 0, -46.6], [2.9, 3, -44]); // bus
  occ([-36, 0, -68], [-24, 7.5, -56]); // barn
  occ([4.2, 0, -8.3], [5.9, 1.9, -2.9]); // pickup
}

function buildStation(b: NightBuilder, tex: Tex, jitter: Jitter): void {
  const paint = col("#8d8f86");
  const trim = col("#a33a2e");
  // The canopy over the forecourt: its slab, its fascia, four columns.
  b.box([-1.1, 4.6, 0.5], [13.4, 0.4, 8.2], col("#5d5c57"), { surface: "metal", detail: tex.metal, shade: 0.5 });
  b.box([-1.1, 4.25, -3.55], [13.4, 0.5, 0.12], trim, { surface: "metal", detail: tex.metal });
  for (const [x, z] of [[-7.4, -3.2], [5.2, -3.2], [-7.4, 4.2], [5.2, 4.2]] as const) b.box([x, 2.2, z], [0.35, 4.4, 0.35], col("#b8b3a6"), { surface: "metal", occlude: true });
  // The station, Miller's Gas & Eats, ahead on the right: its west wall and
  // big window face the road, the counter and the radio behind the glass.
  // The front room is hollow, so the flashlight can find the radio through
  // the window and a bullet can reach it; the back of the building is solid.
  const wall: PartOptions = { surface: "wood", detail: tex.planks, occlude: true };
  b.box([10.95, 2.1, -16], [4.1, 4.2, 10.4], paint, wall);
  b.box([6.9, 0.45, -16], [0.2, 0.9, 10.4], paint, wall);
  b.box([6.9, 3.2, -16], [0.2, 2.0, 10.4], paint, wall);
  b.box([6.9, 1.55, -19.75], [0.2, 1.3, 2.9], paint, wall);
  b.box([6.9, 1.55, -12.45], [0.2, 1.3, 3.3], paint, wall);
  for (const z of [-10.9, -21.1]) b.box([7.95, 2.1, z], [1.9, 4.2, 0.2], paint, wall);
  b.box([9.9, 4.35, -16], [6.6, 0.3, 10.8], col("#3d3b38"), { surface: "wood" });
  // Inside, out of the moon: the back wall, the floor and the ceiling, dim and warm.
  const inside: PartOptions = { surface: "wood", shade: 0.12, emit: new Color(0.006, 0.004, 0.002) };
  b.box([8.86, 2.1, -16], [0.04, 4.2, 10.2], col("#6d5f4c"), inside);
  b.box([7.85, 0.02, -16], [2.1, 0.04, 10.2], col("#3a342c"), inside);
  b.box([7.85, 4.18, -16], [2.1, 0.04, 10.2], col("#4a443c"), inside);
  b.box([6.78, 1.55, -16.2], [0.03, 1.3, 4.2], col("#1a2228"), { surface: "glass", name: "station.glass", emit: new Color(0.01, 0.008, 0.005) });
  b.box([6.75, 0.86, -16.2], [0.1, 0.08, 4.4], trim, { surface: "wood" });
  b.box([7.8, 0.95, -16.3], [0.7, 0.1, 2.6], col("#6b5a44"), { surface: "wood", detail: tex.planks, shade: 0.3 });
  b.box([7.8, 0.45, -16.3], [0.6, 0.9, 2.5], col("#4d4133"), { surface: "wood", shade: 0.2 });
  // The radio on the counter: a secret of its own.
  const radio: PartOptions = { surface: "wood", name: "secret.radio", pivot: [7.75, 1.13, -16.5] };
  b.box([7.75, 1.13, -16.5], [0.3, 0.26, 0.42], col("#5a3a22"), { ...radio, emit: new Color(0.02, 0.012, 0.004) });
  b.box([7.6, 1.14, -16.5], [0.02, 0.12, 0.26], col("#c9a45a"), { ...radio, emit: new Color(0.08, 0.05, 0.02) });
  // A sawhorse across the left half of the road at the crossroads.
  b.box([-1.8, 0.95, -21], [2.0, 0.12, 0.08], col("#c9c4b8"), { surface: "wood" });
  b.box([-1.8, 0.8, -21.02], [2.0, 0.1, 0.02], col("#b23a2c"), { surface: "wood" });
  for (const x of [-2.6, -1.0]) {
    b.box([x, 0.46, -20.85], [0.07, 0.95, 0.07], col("#8a8478"), { surface: "wood", rotation: new Euler(0.28, 0, 0) });
    b.box([x, 0.46, -21.15], [0.07, 0.95, 0.07], col("#8a8478"), { surface: "wood", rotation: new Euler(-0.28, 0, 0) });
  }
}

function buildBarricade(b: NightBuilder, tex: Tex, jitter: Jitter, rand: () => number): void {
  const bag = col("#7a6d55");
  // Four courses of sandbags from x −3.4 to 2.8, staggered.
  const face = BARRICADE_Z;
  for (let row = 0; row < 4; row++) {
    const y = 0.13 + row * 0.235;
    const offset = row % 2 ? 0.31 : 0;
    for (let x = -3.4 + offset; x < 2.75; x += 0.62) {
      const w = Math.min(0.6, 2.8 - x);
      if (w < 0.25) continue;
      // A bag: a squashed cylinder lying across, its ends tucked.
      const bagGeo = new CylinderGeometry(0.21, 0.21, w - 0.04, 10, 1).rotateZ(Math.PI / 2).scale(1, 0.58, 1);
      b.add(bagGeo, new Matrix4().compose(new Vector3(x + w / 2, y, face + 0.2), new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), (rand() - 0.5) * 0.08), new Vector3(1, 1, 1)), jitter(bag, 0.25), {
        surface: "sandbag",
        detail: tex.burlap,
        uvScale: 0.6,
      });
      bagGeo.dispose();
      if (row === 0) b.occluders.push({ min: new Vector3(x, 0, face), max: new Vector3(x + w, 0.95, face + 0.42) });
    }
  }
  // The toppled pump at the left end, on its side, its hose trailing.
  b.box([-4.5, 0.3, face + 0.15], [1.6, 0.6, 0.55], col("#9e2c24"), { surface: "metal", detail: tex.metal });
  b.box([-4.5, 0.62, face + 0.15], [1.5, 0.06, 0.5], col("#d8d0c0"), { surface: "metal" });
  // The pickup on its side along the right end, its cab away from you.
  const paint = col("#3f5a6a");
  // The bed: its floor faces you, its sides stand up and lie down.
  b.box([4.55, 0.95, -4.6], [0.12, 1.9, 3.4], paint, { surface: "metal", detail: tex.metal });
  b.box([5.2, 0.06, -4.6], [1.3, 0.12, 3.4], paint, { surface: "metal", detail: tex.metal });
  b.box([5.2, 1.84, -4.6], [1.3, 0.12, 3.4], paint, { surface: "metal", detail: tex.metal });
  b.box([5.2, 0.95, -2.95], [1.3, 1.9, 0.1], col("#2f4450"), { surface: "metal", detail: tex.metal });
  // The cab, its windows dark, its roof toward the road.
  b.box([5.05, 0.95, -7.25], [1.1, 1.85, 1.9], paint, { surface: "metal", detail: tex.metal });
  b.box([5.7, 0.95, -7.25], [0.2, 1.6, 1.6], col("#324858"), { surface: "metal", detail: tex.metal });
  b.box([4.48, 1.2, -7.3], [0.04, 0.9, 1.4], col("#0f1214"), { surface: "glass" });
  b.box([5.0, 0.95, -8.25], [0.9, 1.4, 0.14], col("#1f2a30"), { surface: "metal" });
  // Its wheels, on the side toward the road.
  for (const z of [-3.6, -7.3]) {
    for (const y of [0.4, 1.5]) {
      b.cylinder([4.4, y, z], 0.37, 0.26, col("#161616"), { surface: "metal", rotation: new Euler(0, 0, Math.PI / 2), segments: 16 });
      b.cylinder([4.26, y, z], 0.2, 0.03, col("#6c6c68"), { surface: "metal", rotation: new Euler(0, 0, Math.PI / 2), segments: 12 });
    }
  }
}

function buildLeft(b: NightBuilder, tex: Tex, jitter: Jitter, rand: () => number): void {
  const rail = col("#6d6152");
  // The split-rail fence along the corn, with a gap where the corn lane comes through.
  for (let z = -4.5; z > -62; z -= 3) {
    b.box([-6.2, 0.62, z], [0.14, 1.25, 0.14], jitter(rail), { surface: "wood", detail: tex.planks });
    const next = z - 3;
    const mid = (z + next) / 2;
    if (mid < -9.5 && mid > -12) continue;
    for (const y of [0.55, 1.05]) b.box([-6.2, y, mid], [0.08, 0.1, 3], jitter(rail), { surface: "wood", rotation: new Euler((rand() - 0.5) * 0.06, 0, 0), noCollide: true });
  }
  // A Route 9 shield on its post at the corn's corner, and an oil drum on the shoulder.
  b.box([-6.4, 1.2, -13.5], [0.08, 2.4, 0.08], col("#6f6f6f"), { surface: "metal" });
  b.box([-6.4, 2.05, -13.45], [0.62, 0.62, 0.04], col("#d8d4c6"), { surface: "metal", detail: tex.metal });
  b.cylinder([-3.05, 0.45, -17.2], 0.3, 0.9, col("#5b3b24"), { surface: "metal", detail: tex.metal, segments: 16 });
  // The scarecrow among the corn, up on a tall post so its head and arms
  // stand clear of the tassels (and off the line to the Route 9 shield).
  const [sx, , sz] = SCARECROW;
  const post: PartOptions = { surface: "cloth", name: "secret.scarecrow", pivot: [sx, 0, sz] };
  b.box([sx, 1.65, sz], [0.1, 3.3, 0.1], col("#5b4a38"), post);
  b.box([sx, 2.85, sz], [1.5, 0.08, 0.08], col("#5b4a38"), post);
  b.box([sx, 2.65, sz], [0.5, 0.65, 0.28], col("#6a4a3a"), post);
  b.box([sx, 2.15, sz], [0.4, 0.45, 0.24], col("#4a5a6a"), post);
  const head: PartOptions = { surface: "cloth", name: "secret.scarecrow.head", pivot: [sx, 3.2, sz] };
  b.box([sx, 3.22, sz], [0.3, 0.32, 0.28], col("#b39a6a"), head);
  b.cylinder([sx, 3.46, sz], 0.34, 0.06, col("#6b5a38"), { ...head, segments: 12 });
  b.cylinder([sx, 3.55, sz], 0.16, 0.16, col("#6b5a38"), { ...head, segments: 12, radiusTop: 0.13 });
  // The red barn at 60 m, the silo, the windmill against the sky.
  const barn = col("#6e2a22");
  b.box([-30, 3.2, -62], [12, 6.4, 12], barn, { surface: "wood", detail: tex.planks, uvScale: 3 });
  roof(b, [-30, 6.4, -62], 12.6, 12.6, 3, col("#2e2a28"));
  b.box([-30, 2.2, -55.95], [4, 4.4, 0.1], col("#4a1c16"), { surface: "wood", detail: tex.planks });
  b.cylinder([-39, 6, -68], 2.6, 12, col("#7a7a74"), { surface: "metal", detail: tex.metal, segments: 20 });
  b.cylinder([-39, 12.6, -68], 2.7, 1.2, col("#5a5a55"), { surface: "metal", radiusTop: 0.2, segments: 20 });
  b.cylinder([-22, 7, -96], 0.25, 14, col("#58544c"), { surface: "metal", radiusTop: 0.08, segments: 6 });
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2 + 0.3;
    b.box([-22 + Math.cos(a) * 1.3, 14 + Math.sin(a) * 1.3, -95.7], [0.28, 2.6, 0.03], col("#6a665c"), { surface: "metal", rotation: new Euler(0, 0, a - Math.PI / 2) });
  }
}

function buildRight(b: NightBuilder, tex: Tex, jitter: Jitter, rand: () => number): void {
  // The streetlight at the crossroads: pole, arm, and the lamp head that glows.
  b.cylinder([5.6, 3.9, -24], 0.13, 7.8, col("#56554f"), { surface: "metal", radiusTop: 0.09, segments: 8 });
  b.box([4.6, 7.65, -24], [2.2, 0.1, 0.1], col("#56554f"), { surface: "metal" });
  b.box([...STREET_LAMP] as [number, number, number], [0.7, 0.18, 0.34], col("#2a2826"), { surface: "metal", name: "street.head" });
  b.box([STREET_LAMP[0], STREET_LAMP[1] - 0.11, STREET_LAMP[2]], [0.55, 0.04, 0.26], col("#ffffff"), { surface: "glass", name: "street.lamp", pivot: [STREET_LAMP[0], STREET_LAMP[1] - 0.11, STREET_LAMP[2]], emit: new Color(4.5, 2.4, 0.9) });
  // The phone booth under it: a frame, glass, the light on its roof.
  const booth: [number, number, number] = [6.5, 1.2, -26.5];
  for (const [dx, dz] of [[-0.48, -0.48], [0.48, -0.48], [-0.48, 0.48], [0.48, 0.48]] as const) b.box([booth[0] + dx, 1.15, booth[2] + dz], [0.06, 2.3, 0.06], col("#8a8a84"), { surface: "metal" });
  b.box([booth[0], 2.33, booth[2]], [1.04, 0.1, 1.04], col("#8a8a84"), { surface: "metal" });
  b.box([booth[0], 1.2, booth[2]], [0.94, 1.9, 0.94], col("#233036"), { surface: "glass", noCollide: true });
  b.box([booth[0] + 0.3, 1.25, booth[2] - 0.2], [0.2, 0.35, 0.12], col("#1b1b1b"), { surface: "metal" });
  b.box([booth[0], 2.46, booth[2]], [0.3, 0.16, 0.3], col("#ffffff"), { surface: "glass", name: "secret.booth.light", pivot: [booth[0], 2.46, booth[2]], emit: new Color(1.8, 1.9, 2.1) });
  // Crates on the shoulder by the crossroads.
  b.box([5.9, 0.3, -19.5], [0.9, 0.6, 0.8], col("#6a5638"), { surface: "wood", detail: tex.planks, rotY: 0.2 });
  b.box([5.85, 0.83, -19.45], [0.7, 0.46, 0.66], col("#5e4c32"), { surface: "wood", detail: tex.planks, rotY: -0.1 });
  // The Starlite Motel: six rooms facing the road, two candle-lit, doors ajar.
  const wall = col("#7d8a86");
  b.box([16.5, 1.6, -44], [6, 3.2, 22], wall, { surface: "wood", detail: tex.planks });
  b.box([15.9, 3.35, -44], [7.4, 0.3, 23], col("#3a3532"), { surface: "wood" });
  for (let i = 0; i < 6; i++) {
    const z = -35 - i * 3.5;
    const lit = i === 1 || i === 4;
    b.box([13.46, 1.05, z], [0.06, 2.1, 1.0], col("#2c2622"), { surface: "wood", emit: lit ? new Color(0.02, 0.009, 0.003) : undefined });
    b.box([13.46, 1.55, z - 1.45], [0.06, 1.0, 1.3], col("#0e1012"), { surface: "glass", emit: lit ? new Color(0.9, 0.42, 0.14) : undefined });
  }
  // The motel's sign on its pole, dark tonight.
  b.cylinder([11.3, 3.1, -30.4], 0.1, 6.2, col("#56554f"), { surface: "metal", segments: 8 });
  b.box([11.3, 6.3, -30.4], [0.4, 0.8, 3.2], col("#3b4a54"), { surface: "metal", detail: tex.metal, rotY: 0.35 });
  // The phone in room 3, which rings back.
  b.box([14.2, 1.0, -42.6], [0.2, 0.15, 0.25], col("#1c1c1c"), { surface: "metal", name: "secret.phone.motel", pivot: [14.2, 1.0, -42.6] });
  // Pines past the motel, and along the right-hand fields.
  for (let i = 0; i < 150; i++) {
    const x = 16 + rand() * 70;
    const z = -56 - rand() * 90;
    if (x < 22 && z > -64) continue;
    pine(b, x, z, 7 + rand() * 7, rand);
  }
  for (let i = 0; i < 40; i++) pine(b, 24 + rand() * 50, -18 - rand() * 36, 6 + rand() * 6, rand);
  // Power lines down the right side of the road.
  for (let z = -8; z > -160; z -= 26) {
    b.cylinder([5.9, 4.5, z], 0.12, 9, col("#3e3528"), { surface: "wood", segments: 6 });
    b.box([5.9, 8.4, z], [2.2, 0.12, 0.12], col("#3e3528"), { surface: "wood" });
  }
  for (const dx of [-0.9, 0.9]) {
    for (let z = -8; z > -134; z -= 26) wire(b, [5.9 + dx, 8.45, z], [5.9 + dx, 8.45, z - 26]);
  }
}

function buildFar(b: NightBuilder, tex: Tex, jitter: Jitter, rand: () => number): void {
  // The burned-out school bus across the road at 45 m.
  const charred = col("#2a2622");
  const rust = col("#5a3a26");
  b.box([-2.6, 1.6, -45.3], [10.6, 2.4, 2.5], charred, { surface: "metal", detail: tex.metal });
  b.box([-2.6, 2.86, -45.3], [10.4, 0.14, 2.4], rust, { surface: "metal", detail: tex.metal });
  for (let x = -7.2; x < 2.4; x += 1.1) b.box([x, 2.05, -44.04], [0.8, 0.6, 0.04], col("#0c0c0d"), { surface: "metal" });
  b.box([-2.2, 1.2, -44.04], [0.8, 1.9, 0.05], col("#070707"), { surface: "metal" });
  for (const x of [-6.2, 0.9]) for (const z of [-44.1, -46.5]) b.cylinder([x, 0.45, z], 0.45, 0.3, col("#141414"), { surface: "metal", rotation: new Euler(Math.PI / 2, 0, 0) });
  // The water tower beyond the pines on the right.
  const tower = col("#6e6a62");
  for (const [dx, dz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]] as const) b.box([40 + dx, 8, -118 + dz], [0.3, 16, 0.3], tower, { surface: "metal" });
  b.cylinder([40, 18.5, -118], 4, 5, tower, { surface: "metal", detail: tex.metal, segments: 20 });
  b.cylinder([40, 21.8, -118], 0.4, 1.6, tower, { surface: "metal", radiusTop: 0.1, segments: 20 });
  // The drive-in on the hill: its screen, and the projector booth in front of it.
  b.ground(-80, -10, -140, -200, 0.2, 10, () => col("#3b3a2e"), { surface: "dirt", detail: tex.dirt, uvScale: 4 });
  b.box([-44, 10.5, -176], [0.4, 21, 0.4], col("#3a3a36"), { surface: "wood" });
  b.box([-22, 10.5, -176], [0.4, 21, 0.4], col("#3a3a36"), { surface: "wood" });
  b.box([-33, 13, -176.4], [23, 11, 0.3], col("#6a6862"), { surface: "wood", detail: tex.planks });
  b.box([-33, 13, -176.2], [22, 10, 0.05], col("#cfcdc6"), { surface: "cloth", name: "secret.drivein.screen", pivot: [-33, 13, -176.2] });
  b.box([-31, 1.6, -141], [4, 3.2, 3], col("#4a4640"), { surface: "wood", detail: tex.planks });
  // The booth's lamp over its door, on the side toward the road, where a shot can reach it.
  b.box([-31, 2.6, -139.45], [0.6, 0.45, 0.1], col("#fff6e0"), { surface: "glass", name: "secret.drivein.lamp", pivot: [-31, 2.6, -139.45], emit: new Color(1.4, 1.3, 1.0) });
  // The rubber duck in a puddle by the pump.
  b.box([-3.2, 0.012, -8.1], [1.3, 0.01, 0.9], col("#15171a"), { surface: "water" });
  const duck: PartOptions = { surface: "cloth", name: "secret.duck", pivot: [-3.3, 0.02, -8.05] };
  b.add(new SphereGeometry(0.075, 12, 8).scale(1.25, 0.8, 1), new Matrix4().makeTranslation(-3.3, 0.07, -8.05), col("#e8c21a"), duck);
  b.add(new SphereGeometry(0.048, 10, 8), new Matrix4().makeTranslation(-3.3, 0.15, -8.0), col("#e8c21a"), duck);
  b.add(new ConeGeometry(0.02, 0.05, 8).rotateX(Math.PI / 2), new Matrix4().makeTranslation(-3.3, 0.145, -7.95), col("#e87a1a"), duck);
}

/** A gable roof over a box's top, ridge along x. */
function roof(b: NightBuilder, at: [number, number, number], w: number, d: number, h: number, colour: Color): void {
  const slope = Math.atan2(h, d / 2);
  const len = Math.hypot(h, d / 2);
  for (const s of [-1, 1]) {
    b.box([at[0], at[1] + h / 2, at[2] + (s * d) / 4], [w, 0.15, len], colour, { surface: "wood", rotation: new Euler(-s * slope, 0, 0) });
  }
}

function pine(b: NightBuilder, x: number, z: number, h: number, rand: () => number): void {
  const green = new Color(0.03 + rand() * 0.02, 0.055 + rand() * 0.02, 0.04);
  b.cylinder([x, h * 0.12, z], 0.18, h * 0.25, col("#2a2018"), { surface: "wood", segments: 6 });
  for (let k = 0; k < 3; k++) {
    const r = (h * (0.34 - k * 0.08)) / 1.4;
    const y = h * (0.28 + k * 0.22);
    b.add(new ConeGeometry(r, h * 0.42, 9), new Matrix4().makeTranslation(x, y + h * 0.21, z), green, { surface: "plant" });
  }
}

function wire(b: NightBuilder, from: [number, number, number], to: [number, number, number]): void {
  const n = 6;
  for (let i = 0; i < n; i++) {
    const t0 = i / n;
    const t1 = (i + 1) / n;
    const sag = (t: number) => 0.9 * 4 * t * (1 - t);
    const a = new Vector3(from[0] + (to[0] - from[0]) * t0, from[1] - sag(t0), from[2] + (to[2] - from[2]) * t0);
    const c = new Vector3(from[0] + (to[0] - from[0]) * t1, from[1] - sag(t1), from[2] + (to[2] - from[2]) * t1);
    const mid = a.clone().add(c).multiplyScalar(0.5);
    const len = a.distanceTo(c);
    const q = new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), c.clone().sub(a).normalize());
    b.add(new BoxGeometry(0.03, 0.03, len), new Matrix4().compose(mid, q, new Vector3(1, 1, 1)), col("#161616"), { surface: "metal", noCollide: true });
  }
}

/**
 * The corn: dry late-summer stalks in rows behind the fence, each a stem
 * and a few arching leaves, merged into the one `corn` mesh the game sways.
 */
function buildCorn(b: NightBuilder, rand: () => number): void {
  const stalk = cornStalk();
  const m = new Matrix4();
  const q = new Quaternion();
  const s = new Vector3();
  for (let x = -7.1; x > -44; x -= 0.9) {
    for (let z = -6; z > -66; z -= 0.66) {
      const px = x + (rand() - 0.5) * 0.3;
      const pz = z + (rand() - 0.5) * 0.3;
      // Thinner far out, where the fog has them anyway.
      if (-pz > 40 && rand() < 0.35) continue;
      // The scarecrow's clearing.
      if (Math.hypot(px - SCARECROW[0], pz - SCARECROW[2]) < 1.2) continue;
      q.setFromAxisAngle(new Vector3(0, 1, 0), rand() * Math.PI * 2);
      const h = 0.85 + rand() * 0.3;
      s.set(1, h, 1);
      m.compose(new Vector3(px, 0, pz), q, s);
      // Late-summer corn going dry: dull straw, some still green.
      const tone = 0.75 + rand() * 0.4;
      const green = rand() * 0.5;
      b.add(stalk, m, new Color((0.15 - 0.04 * green) * tone, (0.14 + 0.02 * green) * tone, (0.075 - 0.01 * green) * tone), { surface: "plant", name: "corn.field", noCollide: true });
    }
  }
}

/** One stalk: a stem and four arching leaves, about 2.3 m tall. */
function cornStalk(): BufferGeometry {
  const pos: number[] = [];
  const quad = (a: Vector3, b: Vector3, c: Vector3, d: Vector3) => pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, a.x, a.y, a.z, c.x, c.y, c.z, d.x, d.y, d.z);
  // The stem: two crossed strips.
  const H = 2.3;
  quad(new Vector3(-0.025, 0, 0), new Vector3(0.025, 0, 0), new Vector3(0.012, H, 0), new Vector3(-0.012, H, 0));
  quad(new Vector3(0, 0, -0.025), new Vector3(0, 0, 0.025), new Vector3(0, H, 0.012), new Vector3(0, H, -0.012));
  // Leaves: up and out, arching over and hanging, in three segments; broad
  // at the stem, to a point.
  for (let k = 0; k < 6; k++) {
    const a = k * 2.39 + 0.4;
    const y = 0.45 + k * 0.29;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    const side = new Vector3(-dz, 0, dx);
    const w0 = 0.055;
    const p0 = new Vector3(0, y, 0);
    const p1 = new Vector3(dx * 0.26, y + 0.2, dz * 0.26);
    const p2 = new Vector3(dx * 0.52, y + 0.16, dz * 0.52);
    const p3 = new Vector3(dx * 0.7, y - 0.12, dz * 0.7);
    const s0 = side.clone().multiplyScalar(w0);
    const s1 = side.clone().multiplyScalar(w0 * 0.9);
    const s2 = side.clone().multiplyScalar(w0 * 0.55);
    const s3 = side.clone().multiplyScalar(0.004);
    quad(p0.clone().sub(s0), p0.clone().add(s0), p1.clone().add(s1), p1.clone().sub(s1));
    quad(p1.clone().sub(s1), p1.clone().add(s1), p2.clone().add(s2), p2.clone().sub(s2));
    quad(p2.clone().sub(s2), p2.clone().add(s2), p3.clone().add(s3), p3.clone().sub(s3));
  }
  // The tassel.
  quad(new Vector3(-0.08, H - 0.05, 0), new Vector3(0.08, H - 0.05, 0), new Vector3(0.02, H + 0.25, 0), new Vector3(-0.02, H + 0.25, 0));
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  g.computeVertexNormals();
  return g;
}

/**
 * The neon sign, GAS & EATS, on its poles by the corn: each letter its own
 * `secret.sign.<letter>` mesh, lit by itself (the game dims one shot out).
 */
function buildSign(b: NightBuilder): void {
  const letters: [string, string][] = [
    ["G", "G"],
    ["A1", "A"],
    ["S1", "S"],
    ["amp", "&"],
    ["E", "E"],
    ["A2", "A"],
    ["T", "T"],
    ["S2", "S"],
  ];
  const frame = new Matrix4().compose(new Vector3(-5.8, 5.4, -20), new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.28), new Vector3(1, 1, 1));
  const at = (x: number, y: number, z: number) => frame.clone().multiply(new Matrix4().makeTranslation(x, y, z));
  b.add(new BoxGeometry(5.6, 1.35, 0.2), at(0, 0, 0), col("#3a1512"), { surface: "metal" });
  for (const x of [-2.2, 2.2]) b.add(new BoxGeometry(0.16, 5.2, 0.16), at(x, -2.95, -0.05), col("#4a4a46"), { surface: "metal" });
  const spacing = 0.64;
  letters.forEach(([id, ch], i) => {
    const m = at(-2.24 + i * spacing + (i >= 4 ? 0.16 : 0), 0, 0.12);
    const centre = new Vector3().setFromMatrixPosition(m);
    b.add(letterGeometry(ch), m, col("#ff5a6a"), { surface: "glass", name: `secret.sign.${id}`, pivot: [centre.x, centre.y, centre.z], emit: NEON_RED.clone().multiplyScalar(2.6) });
  });
}

/** A neon letter drawn as tube strokes on a 5 × 7 grid: good enough to read "GAS & EATS" from the barricade. */
function letterGeometry(ch: string): BufferGeometry {
  const strokes: Record<string, [number, number, number, number][]> = {
    G: [[4, 6, 0, 6], [0, 6, 0, 0], [0, 0, 4, 0], [4, 0, 4, 3], [4, 3, 2, 3]],
    A: [[0, 0, 0, 5], [0, 5, 2, 7], [2, 7, 4, 5], [4, 5, 4, 0], [0, 3, 4, 3]],
    S: [[4, 6, 0, 6], [0, 6, 0, 3.5], [0, 3.5, 4, 3.5], [4, 3.5, 4, 0], [4, 0, 0, 0]],
    "&": [[4, 0, 0.5, 5], [0.5, 5, 1.5, 6.5], [1.5, 6.5, 2.8, 5.2], [2.8, 5.2, 0.2, 1.8], [0.2, 1.8, 1.4, 0], [1.4, 0, 4, 2.4]],
    E: [[4, 6.5, 0, 6.5], [0, 6.5, 0, 0], [0, 0, 4, 0], [0, 3.3, 3, 3.3]],
    T: [[0, 6.5, 4, 6.5], [2, 6.5, 2, 0]],
  };
  const s = 0.1;
  const pos: number[] = [];
  const t = 0.05;
  for (const [x0, y0, x1, y1] of strokes[ch] ?? []) {
    const a = new Vector3((x0 - 2) * s, (y0 - 3.5) * s, 0);
    const b = new Vector3((x1 - 2) * s, (y1 - 3.5) * s, 0);
    const dir = b.clone().sub(a);
    const len = dir.length();
    const g = new BoxGeometry(t, len + t, t);
    const q = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir.normalize());
    g.applyMatrix4(new Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, new Vector3(1, 1, 1)));
    const flat = g.toNonIndexed();
    const p = flat.getAttribute("position");
    for (let i = 0; i < p.count; i++) pos.push(p.getX(i), p.getY(i), p.getZ(i));
    g.dispose();
    flat.dispose();
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  g.computeVertexNormals();
  return g;
}

/** The moon, far off in the sky where the light comes from: a disc that can be shot. */
function moonDisc(): Mesh {
  const disc = new Mesh(new CircleGeometry(7, 40), new MeshBasicMaterial({ color: new Color(2.6, 2.7, 2.9), fog: false }));
  disc.position.copy(MOON_TOWARD).multiplyScalar(330);
  disc.lookAt(0, 1.7, 0);
  disc.userData["surface"] = "glass";
  disc.userData["bake"] = "sky";
  nameNode(disc, "moon.disc");
  return disc;
}
