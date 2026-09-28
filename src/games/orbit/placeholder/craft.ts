/**
 * The placeholder drone, Derelict and extras, to the art's contract: the
 * repair drone (`thruster.<n>`, `light.nav`, a welder arm with `weld.tip`,
 * facing +Z); the dead satellite (`derelict.body` in gold foil, its white
 * fuel `tank` on its +Z side, `panel.1` and `panel.2`, and
 * `derelict.pieces` for the break-up); and the extras (`astronaut` with a
 * pivoting right arm, `toolbag`, `duck`, `sticker`).
 */
import {
  BoxGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
} from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { ConvexGeometry } from "three/addons/geometries/ConvexGeometry.js";
import { mulberry32 } from "../../../engine/rules/rng";
import { nameNode } from "../../../engine/world/names";
import { materials } from "./materials";

const named = <T extends Object3D>(o: T, name: string): T => nameNode(o, name);

export function buildPlaceholderDrone(): Group {
  const root = named(new Group(), "drone");
  const m = materials();
  const body = new Mesh(new RoundedBoxGeometry(0.7, 0.46, 0.6, 3, 0.08), m.white);
  root.add(named(body, "drone.body"));
  const foil = new Mesh(new BoxGeometry(0.5, 0.02, 0.4), m.gold);
  foil.position.y = 0.24;
  body.add(foil);
  // Cold-gas nozzles at the corners, pointing every way.
  let n = 1;
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const dir of [new Vector3(sx, 0, 0), new Vector3(0, sy, 0)]) {
        const nozzle = new Mesh(new ConeGeometry(0.035, 0.08, 10), m.alu);
        nozzle.position.set(sx * 0.36, sy * 0.24, n % 2 ? 0.26 : -0.26);
        nozzle.quaternion.setFromUnitVectors(new Vector3(0, -1, 0), dir.clone().negate());
        root.add(named(nozzle, `thruster.${n}`));
        n++;
      }
    }
  }
  // Its running lights, the station's own: red to port, green to starboard, a white strobe.
  const nav = named(new Group(), "light.nav");
  for (const [x, colour] of [
    [-0.37, new Color(4, 0.3, 0.2)],
    [0.37, new Color(0.3, 4, 0.6)],
  ] as const) {
    const lamp = new Mesh(new SphereGeometry(0.025, 10, 8), new MeshBasicMaterial({ color: colour }));
    lamp.position.set(x, 0.1, 0.2);
    nav.add(lamp);
  }
  const strobe = new Mesh(new SphereGeometry(0.02, 10, 8), new MeshBasicMaterial({ color: new Color(3, 3, 3) }));
  strobe.position.set(0, 0.26, -0.1);
  nav.add(strobe);
  root.add(nav);
  // The camera eye and the welder arm, out in front (+Z).
  const eye = new Mesh(new CylinderGeometry(0.07, 0.07, 0.06, 16), m.dark);
  eye.rotation.x = Math.PI / 2;
  eye.position.set(-0.15, 0.05, 0.31);
  root.add(eye);
  const arm1 = new Mesh(new CylinderGeometry(0.025, 0.025, 0.3, 8), m.alu);
  arm1.rotation.x = Math.PI / 2;
  arm1.position.set(0.14, -0.08, 0.44);
  root.add(arm1);
  const arm2 = new Mesh(new CylinderGeometry(0.02, 0.012, 0.22, 8), m.dark);
  arm2.rotation.x = Math.PI / 2 + 0.4;
  arm2.position.set(0.14, -0.12, 0.66);
  root.add(arm2);
  const tip = named(new Object3D(), "weld.tip");
  tip.position.set(0.14, -0.17, 0.77);
  root.add(tip);
  return root;
}

export function buildPlaceholderDerelict(): Group {
  const root = named(new Group(), "derelict");
  root.userData["size_m"] = 4.2;
  const m = materials();
  const r = mulberry32(31);
  // The bus: a box in gold foil, silver on one face, instruments bolted on.
  const body = named(new Group(), "derelict.body");
  const bus = new Mesh(new BoxGeometry(1.8, 1.5, 1.7), m.gold);
  body.add(bus);
  const side = new Mesh(new BoxGeometry(1.82, 1.2, 0.02), m.silver);
  side.position.z = -0.86;
  body.add(side);
  for (let i = 0; i < 4; i++) {
    const inst = new Mesh(new BoxGeometry(0.3 + r() * 0.3, 0.3 + r() * 0.2, 0.3), i % 2 ? m.white : m.dark);
    inst.position.set(-0.6 + i * 0.4, 0.85, -0.3 + r() * 0.6);
    body.add(inst);
  }
  const dish = new Mesh(new SphereGeometry(0.55, 24, 12, 0, Math.PI * 2, 0, 0.9), m.white);
  dish.position.set(0, -0.95, 0);
  dish.rotation.x = Math.PI;
  body.add(dish);
  root.add(body);
  // The fuel tank: a white sphere on its +Z side, showing as it tumbles.
  const tank = new Mesh(new SphereGeometry(0.5, 28, 18), m.white);
  tank.position.set(0, 0.1, 1.2);
  root.add(named(tank, "tank"));
  const strut = new Mesh(new CylinderGeometry(0.06, 0.06, 0.5, 8), m.alu);
  strut.rotation.x = Math.PI / 2;
  strut.position.set(0, 0.1, 0.9);
  root.add(strut);
  // Its solar wings, one bent.
  for (const s of [-1, 1]) {
    const panel = new Mesh(new BoxGeometry(3.0, 0.03, 1.1), m.cells);
    panel.position.set(s * 2.45, 0, 0);
    panel.rotation.z = s > 0 ? 0.25 : 0;
    root.add(named(panel, s < 0 ? "panel.1" : "panel.2"));
  }
  // The break-up: the bus in seven pieces, sharing the root's transform.
  const pieces = named(new Group(), "derelict.pieces");
  for (let i = 0; i < 7; i++) {
    const pts: Vector3[] = [];
    const cx = -0.6 + (i % 3) * 0.6;
    const cy = i < 3 ? 0.4 : i < 6 ? -0.4 : 0;
    for (let k = 0; k < 14; k++) pts.push(new Vector3(cx + (r() - 0.5) * 0.7, cy + (r() - 0.5) * 0.7, (r() - 0.5) * 1.6));
    const g = new ConvexGeometry(pts);
    g.computeBoundingBox();
    const c = new Vector3();
    g.boundingBox!.getCenter(c);
    g.translate(-c.x, -c.y, -c.z);
    const piece = new Mesh(g, i % 3 === 0 ? m.silver : m.gold);
    piece.position.copy(c);
    pieces.add(named(piece, `derelict.piece.${i + 1}`));
  }
  root.add(pieces);
  return root;
}

function stickerArt(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d");
  if (g) {
    g.clearRect(0, 0, 256, 256);
    g.fillStyle = "#ffffff";
    g.beginPath();
    g.roundRect(8, 8, 240, 240, 36);
    g.fill();
    g.fillStyle = "#e9e6de";
    g.beginPath();
    g.arc(128, 78, 42, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#c79535";
    g.beginPath();
    g.ellipse(128, 80, 28, 22, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#dcd8cf";
    g.fillRect(84, 120, 88, 80);
    g.fillRect(60, 124, 26, 60);
    g.fillRect(170, 124, 26, 60);
    g.fillRect(92, 196, 30, 44);
    g.fillRect(134, 196, 30, 44);
    g.strokeStyle = "#1c1c1e";
    g.lineWidth = 3;
    g.strokeRect(84, 120, 88, 80);
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

export function buildPlaceholderExtras(): Group {
  const root = named(new Group(), "extras");
  const m = materials();
  // The spacewalker, facing +Z, a right arm that turns at the shoulder.
  const astro = named(new Group(), "astronaut");
  const suit = m.white;
  const torso = new Mesh(new RoundedBoxGeometry(0.55, 0.7, 0.36, 3, 0.1), suit);
  torso.position.y = 1.15;
  astro.add(torso);
  const pack = new Mesh(new RoundedBoxGeometry(0.5, 0.65, 0.25, 3, 0.05), m.beta);
  pack.position.set(0, 1.2, -0.3);
  astro.add(pack);
  const helmet = new Mesh(new SphereGeometry(0.21, 24, 18), suit);
  helmet.position.y = 1.7;
  astro.add(helmet);
  const visor = new Mesh(new SphereGeometry(0.19, 24, 18, -Math.PI / 2 - 0.9, 1.8, 0.9, 1.1), m.gold);
  visor.position.set(0, 1.7, 0.03);
  astro.add(visor);
  for (const s of [-1, 1]) {
    const leg = new Mesh(new CylinderGeometry(0.1, 0.09, 0.8, 12), suit);
    leg.position.set(s * 0.14, 0.42, 0);
    astro.add(leg);
    const boot = new Mesh(new BoxGeometry(0.14, 0.12, 0.26), m.dark);
    boot.position.set(s * 0.14, 0.02, 0.05);
    astro.add(boot);
  }
  const armL = new Mesh(new CylinderGeometry(0.08, 0.07, 0.7, 12), suit);
  armL.position.set(-0.36, 1.1, 0);
  armL.rotation.z = -0.2;
  astro.add(armL);
  const shoulder = named(new Group(), "astronaut.arm.R");
  shoulder.position.set(0.34, 1.42, 0);
  const armR = new Mesh(new CylinderGeometry(0.08, 0.07, 0.7, 12), suit);
  armR.position.y = -0.35;
  shoulder.add(armR);
  const glove = new Mesh(new SphereGeometry(0.075, 12, 10), m.dark);
  glove.position.y = -0.72;
  shoulder.add(glove);
  const thumb = named(new Mesh(new CylinderGeometry(0.02, 0.02, 0.09, 8), m.dark), "astronaut.thumb");
  thumb.position.set(0, -0.8, 0.03);
  shoulder.add(thumb);
  astro.add(shoulder);
  root.add(astro);
  // The lost tool bag.
  const bag = named(new Group(), "toolbag");
  const sack = new Mesh(new RoundedBoxGeometry(0.42, 0.3, 0.26, 3, 0.07), m.beta);
  bag.add(sack);
  const strap = new Mesh(new BoxGeometry(0.46, 0.04, 0.02), m.dark);
  strap.position.set(0, 0.1, 0.13);
  bag.add(strap);
  root.add(bag);
  // The duck.
  const duck = named(new Group(), "duck");
  const yellow = new MeshStandardMaterial({ color: "#ffcf1f", roughness: 0.45 });
  const duckBody = new Mesh(new SphereGeometry(0.16, 20, 14), yellow);
  duckBody.scale.set(1.25, 0.85, 1);
  duck.add(duckBody);
  const head = new Mesh(new SphereGeometry(0.09, 18, 12), yellow);
  head.position.set(0.1, 0.16, 0);
  duck.add(head);
  const beak = new Mesh(new ConeGeometry(0.035, 0.07, 10), new MeshStandardMaterial({ color: "#f07a12", roughness: 0.5 }));
  beak.rotation.z = -Math.PI / 2;
  beak.position.set(0.2, 0.15, 0);
  duck.add(beak);
  for (const s of [-1, 1]) {
    const eye = new Mesh(new SphereGeometry(0.012, 8, 6), new MeshBasicMaterial({ color: "#111111" }));
    eye.position.set(0.15, 0.19, s * 0.05);
    duck.add(eye);
  }
  root.add(duck);
  // The sticker: a 20 cm vinyl spacewalker, facing +Z.
  const sticker = new Mesh(new PlaneGeometry(0.2, 0.2), new MeshStandardMaterial({ map: stickerArt(), transparent: true, roughness: 0.6 }));
  root.add(named(sticker, "sticker"));
  void CircleGeometry;
  return root;
}
