import { CircleGeometry, CylinderGeometry, Group, Object3D, TorusGeometry } from "three";
import type { LoadedAsset } from "../../../engine/types";
import { nameNode } from "../../../engine/world/names";
import { Materials, RigidGeometry, box, cyl, type V3 } from "./skin";

/**
 * The placeholder vehicles (vehicles.glb): a 1940s cargo truck with a
 * canvas tilt and an open jeep, rigid, each under its own top-level node,
 * facing +Z with its origin on the ground at its middle. The parts the game
 * works are separate nodes: `wheel.<n>` pivots at the hubs (turned about
 * their local X), the windshield `cab.glass`, the `engine` block the game
 * hit-tests by its bounds, and empties where people sit: `seat.driver` (a
 * driver's root goes there and plays `drive`), `seat.passenger`,
 * `seat.back.<n>`. Meshes carry `userData.surface` for the impact effects.
 */

const OLIVE = "#454b2e";
const OLIVE_DARK = "#363b22";
const CHASSIS = "#23241e";
const TYRE = "#1c1c1a";
const CANVAS = "#6e6c4f";
const CANVAS_DARK = "#5c5b42";
const GLASS = "#3b4a58";
const LAMP = "#e9e1b4";
const ENGINE = "#3b3b37";
const SEAT = "#3b3326";

/** A wheel on its pivot: the tyre, the rim and the hub, turning about X. */
function wheel(name: string, at: V3, radius: number, width: number, mats: Materials): Group {
  const pivot = nameNode(new Group(), name);
  pivot.position.set(...at);
  const w = new RigidGeometry().mat("rubber");
  const axisX: V3 = [0, 0, Math.PI / 2];
  w.part(cyl(radius, radius, width, 16), TYRE, [0, 0, 0], axisX);
  w.mat("metal:painted");
  w.part(cyl(radius * 0.58, radius * 0.58, width + 0.01, 12), OLIVE, [0, 0, 0], axisX);
  w.part(cyl(radius * 0.22, radius * 0.22, width + 0.04, 8), OLIVE_DARK, [0, 0, 0], axisX);
  // Lugs on the tread, so a turning wheel is seen to turn.
  w.mat("rubber");
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    w.part(box(width * 0.9, 0.04, 0.09), "#2a2a27", [0, Math.cos(a) * (radius - 0.02), Math.sin(a) * (radius - 0.02)], [a, 0, 0]);
  }
  pivot.add(w.mesh(null, mats, "metal"));
  return pivot;
}

function empty(name: string, at: V3, yaw = 0): Object3D {
  const o = nameNode(new Object3D(), name);
  o.position.set(...at);
  o.rotation.y = yaw;
  return o;
}

/** Where the driver's root goes in each, and where the wheel he holds is (0.95 m up, 0.45 m ahead). */
export const TRUCK_DRIVER: V3 = [0.5, 1.1, 1.0];
export const JEEP_DRIVER: V3 = [0.3, 0.42, -0.25];

function steeringWheel(g: RigidGeometry, seat: V3, dash: V3): void {
  const centre: V3 = [seat[0], seat[1] + 0.95, seat[2] + 0.45];
  g.part(new TorusGeometry(0.19, 0.018, 4, 14), "#1a1a18", centre, [-0.5, 0, 0]);
  g.rod("#1a1a18", centre, dash, 0.02, 5);
}

// --- the truck -------------------------------------------------------------------------

function truck(mats: Materials): Group {
  const root = nameNode(new Group(), "truck");
  const b = new RigidGeometry().mat("metal:painted");
  // Chassis, bumper, bonnet, grille and lamps.
  b.part(box(0.12, 0.2, 6.5), CHASSIS, [0.45, 0.74, -0.1]);
  b.part(box(0.12, 0.2, 6.5), CHASSIS, [-0.45, 0.74, -0.1]);
  b.part(box(2.2, 0.18, 0.16), CHASSIS, [0, 0.62, 3.3]);
  b.part(box(1.04, 0.5, 1.15), OLIVE, [0, 1.33, 2.45]);
  b.part(box(1.0, 0.8, 0.08), OLIVE_DARK, [0, 1.18, 3.03]);
  for (let i = -3; i <= 3; i++) b.part(box(0.03, 0.66, 0.03), CHASSIS, [i * 0.13, 1.18, 3.08]);
  for (const x of [0.72, -0.72]) {
    b.part(cyl(0.11, 0.11, 0.14, 12), OLIVE_DARK, [x, 1.36, 2.98], [Math.PI / 2, 0, 0]);
    b.part(cyl(0.09, 0.09, 0.02, 12), LAMP, [x, 1.36, 3.06], [Math.PI / 2, 0, 0]);
    // Front mudguards: a top over the wheel, sloping down in front and behind.
    const side = Math.sign(x);
    b.part(box(0.4, 0.05, 1.0), OLIVE, [side * 0.95, 1.22, 2.4]);
    b.part(box(0.4, 0.05, 0.45), OLIVE, [side * 0.95, 1.08, 3.05], [-0.65, 0, 0]);
    b.part(box(0.4, 0.05, 0.4), OLIVE, [side * 0.95, 1.05, 1.78], [0.75, 0, 0]);
    // A running board under the door, a mirror on an arm.
    b.part(box(0.35, 0.05, 1.1), OLIVE_DARK, [side * 0.95, 0.88, 1.25]);
    b.rod(CHASSIS, [side * 1.0, 2.2, 1.85], [side * 1.2, 2.25, 1.9], 0.015, 4);
    b.part(box(0.04, 0.2, 0.14), CHASSIS, [side * 1.22, 2.25, 1.9]);
  }
  // The cab: a lower body to the sills, open side windows, pillars, a roof, the back wall.
  b.part(box(2.0, 0.7, 1.28), OLIVE, [0, 1.45, 1.26]);
  for (const x of [0.96, -0.96]) {
    b.part(box(0.08, 0.66, 0.08), OLIVE, [x, 2.13, 1.86]);
    b.part(box(0.08, 0.66, 0.08), OLIVE, [x, 2.13, 0.66]);
  }
  b.part(box(0.05, 0.6, 0.05), OLIVE, [0, 2.12, 1.87]);
  b.part(box(2.0, 0.08, 0.1), OLIVE, [0, 2.42, 1.86]);
  b.part(box(2.0, 0.06, 0.1), OLIVE, [0, 1.82, 1.86]);
  b.part(box(2.04, 0.12, 1.34), OLIVE, [0, 2.54, 1.26]);
  b.part(box(2.0, 0.66, 0.06), OLIVE, [0, 2.13, 0.64]);
  b.part(box(1.9, 0.2, 0.15), OLIVE_DARK, [0, 1.85, 1.74]);
  steeringWheel(b, TRUCK_DRIVER, [TRUCK_DRIVER[0], 1.8, 1.72]);
  b.mat("leather");
  b.part(box(1.8, 0.12, 0.45), SEAT, [0, 1.5, 1.0]);
  b.part(box(1.8, 0.5, 0.1), SEAT, [0, 1.85, 0.74]);
  b.mat("metal:painted");
  // The bed: floor at 1.2 m, low sides, benches along them, the tailgate down.
  b.part(box(2.2, 0.1, 4.0), OLIVE_DARK, [0, 1.15, -1.4]);
  b.part(box(0.06, 0.45, 4.0), OLIVE, [1.08, 1.425, -1.4]);
  b.part(box(0.06, 0.45, 4.0), OLIVE, [-1.08, 1.425, -1.4]);
  b.part(box(2.2, 0.45, 0.06), OLIVE, [0, 1.425, 0.57]);
  b.part(box(2.1, 0.45, 0.05), OLIVE, [0, 0.95, -3.43]);
  b.mat("wood");
  b.part(box(0.3, 0.06, 3.6), "#5a4a33", [0.93, 1.62, -1.45]);
  b.part(box(0.3, 0.06, 3.6), "#5a4a33", [-0.93, 1.62, -1.45]);
  b.mat("metal:painted");
  // Fuel tank, axles.
  b.part(cyl(0.22, 0.22, 0.7, 10), OLIVE_DARK, [-0.8, 0.85, 0.2], [Math.PI / 2, 0, 0]);
  for (const z of [2.35, -1.3, -2.5]) b.part(cyl(0.07, 0.07, 1.9, 6), CHASSIS, [0, 0.55, z], [0, 0, Math.PI / 2]);
  root.add(b.mesh("truck.body", mats, "metal"));

  // The tilt: canvas over hoops, closed in front, open at the back.
  const c = new RigidGeometry().mat("canvas");
  c.part(box(0.03, 0.8, 4.0), CANVAS, [1.1, 2.05, -1.4]);
  c.part(box(0.03, 0.8, 4.0), CANVAS, [-1.1, 2.05, -1.4]);
  c.part(new CylinderGeometry(1.1, 1.1, 4.0, 12, 1, true, Math.PI / 2, Math.PI), CANVAS, [0, 2.45, -1.4], [Math.PI / 2, 0, 0], [1, 1, 0.4]);
  c.part(box(2.2, 0.8, 0.03), CANVAS_DARK, [0, 2.05, 0.58]);
  c.part(new CircleGeometry(1.1, 12, 0, Math.PI), CANVAS_DARK, [0, 2.45, 0.58], [0, 0, 0], [1, 0.4, 1]);
  c.part(new TorusGeometry(1.1, 0.03, 4, 12, Math.PI), CANVAS_DARK, [0, 2.45, -3.38], [0, 0, 0], [1, 0.4, 1]);
  root.add(c.mesh("truck.canvas", mats, "cloth"));

  const glass = new RigidGeometry().mat("glass");
  glass.part(box(1.84, 0.54, 0.02), GLASS, [0, 2.12, 1.87]);
  root.add(glass.mesh("cab.glass", mats, "glass"));

  const engine = new RigidGeometry().mat("metal");
  engine.part(box(0.7, 0.55, 0.9), ENGINE, [0, 1.25, 2.45]);
  root.add(engine.mesh("engine", mats, "metal"));

  const hubs: V3[] = [
    [0.95, 0.55, 2.35],
    [-0.95, 0.55, 2.35],
    [0.95, 0.55, -1.3],
    [-0.95, 0.55, -1.3],
    [0.95, 0.55, -2.5],
    [-0.95, 0.55, -2.5],
  ];
  hubs.forEach((at, i) => root.add(wheel(`wheel.${i}`, at, 0.55, 0.3, mats)));

  root.add(empty("seat.driver", TRUCK_DRIVER));
  // On the bed floor by the benches, facing across the bed.
  [
    [0.85, -0.9],
    [-0.85, -0.9],
    [0.85, -2.3],
    [-0.85, -2.3],
  ].forEach(([x, z], i) => root.add(empty(`seat.back.${i}`, [x as number, 1.2, z as number], (x as number) > 0 ? -Math.PI / 2 : Math.PI / 2)));
  return root;
}

// --- the jeep --------------------------------------------------------------------------

function jeep(mats: Materials): Group {
  const root = nameNode(new Group(), "jeep");
  const b = new RigidGeometry().mat("metal:painted");
  // The tub, open-topped, the floor at 0.42 m.
  b.part(box(1.12, 0.58, 2.1), OLIVE, [0, 0.71, -0.55]);
  b.part(box(1.0, 0.04, 1.9), OLIVE_DARK, [0, 1.0, -0.6]);
  for (const side of [1, -1]) {
    b.part(box(0.24, 0.06, 0.8), OLIVE, [side * 0.66, 0.74, -1.03]);
    b.part(box(0.24, 0.05, 1.1), OLIVE, [side * 0.66, 0.78, 1.08]);
    b.part(cyl(0.07, 0.07, 0.08, 10), OLIVE_DARK, [side * 0.28, 0.85, 1.68], [Math.PI / 2, 0, 0]);
    b.part(cyl(0.055, 0.055, 0.02, 10), LAMP, [side * 0.28, 0.85, 1.72], [Math.PI / 2, 0, 0]);
    // The windshield's frame posts.
    b.part(box(0.05, 0.48, 0.05), OLIVE, [side * 0.66, 1.25, 0.52]);
  }
  b.part(box(0.9, 0.3, 1.1), OLIVE, [0, 0.88, 1.08]);
  b.part(box(0.9, 0.5, 0.06), OLIVE_DARK, [0, 0.8, 1.66]);
  for (let i = -4; i <= 4; i++) b.part(box(0.03, 0.36, 0.03), CHASSIS, [i * 0.07, 0.82, 1.7]);
  b.part(box(1.5, 0.1, 0.08), CHASSIS, [0, 0.48, 1.7]);
  b.part(box(1.36, 0.05, 0.05), OLIVE, [0, 1.48, 0.52]);
  b.part(box(1.36, 0.05, 0.05), OLIVE, [0, 1.03, 0.52]);
  b.part(box(1.12, 0.1, 0.12), OLIVE_DARK, [0, 1.0, 0.45]);
  steeringWheel(b, JEEP_DRIVER, [JEEP_DRIVER[0], 1.02, 0.44]);
  // Seats: two in front, a bench behind.
  b.mat("leather");
  for (const x of [0.3, -0.3]) {
    b.part(box(0.45, 0.1, 0.45), SEAT, [x, 0.82, -0.3]);
    b.part(box(0.45, 0.45, 0.08), SEAT, [x, 1.1, -0.55]);
  }
  b.part(box(1.0, 0.1, 0.4), SEAT, [0, 0.82, -1.2]);
  b.part(box(1.0, 0.4, 0.08), SEAT, [0, 1.08, -1.42]);
  b.mat("metal:painted");
  // A spare wheel and a jerrycan on the back.
  b.part(new TorusGeometry(0.28, 0.07, 6, 14), TYRE, [0, 0.8, -1.63]);
  b.part(box(0.14, 0.34, 0.12), OLIVE_DARK, [0.45, 0.78, -1.64]);
  for (const z of [1.03, -1.03]) b.part(cyl(0.05, 0.05, 1.3, 6), CHASSIS, [0, 0.34, z], [0, 0, Math.PI / 2]);
  root.add(b.mesh("jeep.body", mats, "metal"));

  const glass = new RigidGeometry().mat("glass");
  glass.part(box(1.26, 0.4, 0.015), GLASS, [0, 1.255, 0.52]);
  root.add(glass.mesh("cab.glass", mats, "glass"));

  const engine = new RigidGeometry().mat("metal");
  engine.part(box(0.55, 0.35, 0.6), ENGINE, [0, 0.86, 1.1]);
  root.add(engine.mesh("engine", mats, "metal"));

  const hubs: V3[] = [
    [0.66, 0.34, 1.03],
    [-0.66, 0.34, 1.03],
    [0.66, 0.34, -1.03],
    [-0.66, 0.34, -1.03],
  ];
  hubs.forEach((at, i) => root.add(wheel(`wheel.${i}`, at, 0.34, 0.2, mats)));
  root.add(empty("seat.driver", JEEP_DRIVER), empty("seat.passenger", [-JEEP_DRIVER[0], JEEP_DRIVER[1], JEEP_DRIVER[2]]));
  return root;
}

export function buildVehiclesAsset(): LoadedAsset {
  const mats = new Materials();
  const scene = nameNode(new Group(), "vehicles");
  scene.add(truck(mats), jeep(mats));
  return { scene, animations: [] };
}
