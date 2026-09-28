/**
 * The placeholder station outside the cupola, laid out as the art's build
 * lays it out (art/orbit/orbitlib/station.py): the truss across the top 30
 * m out with its blanket boxes and handrails, a dish antenna, solar wings
 * left and right, a radiator edge-on to the sun, the robotic arm reaching
 * in with its hand near the centre window, a module and a docked capsule
 * lower left (a face at its window, a shade to pull), the stowage platform
 * and the drone's cradle lower right, the laser turret below - physically
 * based, lit at run time. Its nodes are the contract's: emitter, calib.1-9,
 * drone.dock, drone.path.*, drone.work.*, astronaut.path.*,
 * secret.duck.path.*, spawn.*, secret.arm.hand, secret.capsule.window and
 * .shade, and the shared sun and planet.
 */
import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  Group,
  LatheGeometry,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Quaternion,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  Vector2,
  Vector3,
  type Material,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { nameNode } from "../../../engine/world/names";
import { mulberry32 } from "../../../engine/rules/rng";
import { designLanes, designPanes, viewPoint } from "../rules/layout";
import { planetCentre, planetRotation, sunDirection, R_KM, ALT_KM } from "./geometry";
import { materials, type PlaceholderMaterials } from "./materials";
import { PLACEHOLDER_HI, PLACEHOLDER_STORM } from "./planetMaps";

const v = (x: number, y: number, z: number) => new Vector3(x, y, z);
const vp = (sx: number, sy: number, d: number) => {
  const p = viewPoint(sx, sy, d);
  return v(p.x, p.y, p.z);
};
/** The art's axes (Blender: x right, y ahead, z up) in three's. */
const X = v(1, 0, 0);
const Y = v(0, 0, -1);
const Z = v(0, 1, 0);

/** Geometry gathered by material, merged into one mesh each. */
class Geo {
  private readonly byMaterial = new Map<Material, BufferGeometry[]>();
  add(material: Material, g: BufferGeometry): void {
    const list = this.byMaterial.get(material) ?? [];
    for (const name of Object.keys(g.attributes)) if (name !== "position" && name !== "normal" && name !== "uv") g.deleteAttribute(name);
    if (!g.getAttribute("uv")) return;
    list.push(g.index ? g.toNonIndexed() : g);
    this.byMaterial.set(material, list);
  }
  build(name: string, parent: Object3D): Group {
    const group = new Group();
    nameNode(group, name);
    for (const [material, geos] of this.byMaterial) {
      const merged = mergeGeometries(geos, false);
      if (!merged) continue;
      const mesh = new Mesh(merged, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData["surface"] = "metal";
      group.add(mesh);
    }
    parent.add(group);
    return group;
  }
}

/** A cylinder from a to b. */
function rod(a: Vector3, b: Vector3, r: number, seg = 8): BufferGeometry {
  const d = b.clone().sub(a);
  const g = new CylinderGeometry(r, r, d.length(), seg, 1, false);
  const q = new Quaternion().setFromUnitVectors(v(0, 1, 0), d.clone().normalize());
  g.applyQuaternion(q);
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return g;
}

/** A box of `size` (along the frame's x, y, z) placed by a frame. */
function box(at: Vector3, xAxis: Vector3, yAxis: Vector3, size: [number, number, number]): BufferGeometry {
  const g = new BoxGeometry(size[0], size[1], size[2]);
  const x = xAxis.clone().normalize();
  const y = yAxis.clone().addScaledVector(x, -yAxis.dot(x)).normalize();
  const z = x.clone().cross(y);
  g.applyMatrix4(new Matrix4().makeBasis(x, y, z).setPosition(at));
  return g;
}

/** A lattice truss from a to b: four longerons and diagonal bracing, `width` square. */
function truss(geo: Geo, m: PlaceholderMaterials, a: Vector3, b: Vector3, width: number, up: Vector3, bay = 2.4, rLong = 0.06, rX = 0.035): void {
  const along = b.clone().sub(a).normalize();
  const u = up.clone().addScaledVector(along, -up.dot(along)).normalize();
  const w = along.clone().cross(u).normalize();
  const h = width / 2;
  const corners = [
    u.clone().multiplyScalar(h).addScaledVector(w, h),
    u.clone().multiplyScalar(h).addScaledVector(w, -h),
    u.clone().multiplyScalar(-h).addScaledVector(w, -h),
    u.clone().multiplyScalar(-h).addScaledVector(w, h),
  ];
  for (const c of corners) geo.add(m.white, rod(a.clone().add(c), b.clone().add(c), rLong));
  const len = a.distanceTo(b);
  const bays = Math.max(1, Math.round(len / bay));
  for (let i = 0; i < bays; i++) {
    const p0 = a.clone().addScaledVector(along, (i * len) / bays);
    const p1 = a.clone().addScaledVector(along, ((i + 1) * len) / bays);
    for (let k = 0; k < 4; k++) {
      const c0 = corners[k]!;
      const c1 = corners[(k + 1) % 4]!;
      geo.add(m.alu, rod(p0.clone().add(c0), p0.clone().add(c1), rX, 6));
      geo.add(m.alu, rod(p0.clone().add(k % 2 ? c0 : c1), p1.clone().add(k % 2 ? c1 : c0), rX, 6));
    }
  }
}

/** A solar wing: a mast and a long blanket of cells, facing `normal`. */
function solarWing(geo: Geo, m: PlaceholderMaterials, root: Vector3, along: Vector3, normal: Vector3, length = 30, width = 4.4): void {
  const a = along.clone().normalize();
  const n = normal.clone().addScaledVector(a, -normal.dot(a)).normalize();
  const side = a.clone().cross(n).normalize();
  geo.add(m.alu, rod(root, root.clone().addScaledVector(a, length), 0.12));
  for (const s of [-1, 1]) {
    const centre = root.clone().addScaledVector(a, length / 2 + 0.6).addScaledVector(side, s * (width / 2 + 0.35));
    const panel = new PlaneGeometry(width, length, 1, 1);
    const uv = panel.getAttribute("uv");
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2, uv.getY(i) * (length / width) * 2);
    // Plane faces +z: turn it to face the sun, its long side along the mast.
    panel.applyMatrix4(new Matrix4().makeBasis(side, a, n).setPosition(centre));
    geo.add(m.cells, panel);
    const back = panel.clone();
    back.applyMatrix4(new Matrix4().makeTranslation(-n.x * 0.02, -n.y * 0.02, -n.z * 0.02));
    back.scale(1, 1, 1);
    const backFlip = back.clone();
    const idx = backFlip.getIndex();
    if (idx) {
      const arr = idx.array as Uint16Array;
      for (let i = 0; i < arr.length; i += 3) [arr[i + 1], arr[i + 2]] = [arr[i + 2] as number, arr[i + 1] as number];
    }
    backFlip.computeVertexNormals();
    geo.add(m.cellBack, backFlip);
    // The tensioning frame's edge rods.
    const e0 = centre.clone().addScaledVector(side, -width / 2).addScaledVector(a, -length / 2);
    geo.add(m.alu, rod(e0, e0.clone().addScaledVector(a, length), 0.03, 6));
    const e1 = centre.clone().addScaledVector(side, width / 2).addScaledVector(a, -length / 2);
    geo.add(m.alu, rod(e1, e1.clone().addScaledVector(a, length), 0.03, 6));
  }
}

/** The crew member at the capsule's window: a face under a cap, behind glass. */
function crewFace(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  if (g) {
    g.fillStyle = "#101419";
    g.fillRect(0, 0, 128, 128);
    const grad = g.createRadialGradient(64, 60, 4, 64, 60, 44);
    grad.addColorStop(0, "#d9a987");
    grad.addColorStop(1, "#7a5540");
    g.fillStyle = grad;
    g.beginPath();
    g.ellipse(64, 66, 26, 32, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#1f3a6b";
    g.beginPath();
    g.ellipse(64, 40, 30, 16, 0, Math.PI, 0);
    g.fill();
    g.fillStyle = "#2a1d17";
    g.fillRect(50, 62, 8, 4);
    g.fillRect(70, 62, 8, 4);
    g.fillStyle = "#3a6ab8";
    g.fillRect(34, 100, 60, 28);
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

export function buildPlaceholderStation(): Group {
  const root = new Group();
  nameNode(root, "station");
  const m = materials();
  const r = mulberry32(2024);
  const sun = sunDirection();

  // --- the truss across the top -----------------------------------------------------
  const tMid = vp(0, 0.93, 30);
  const trussUp = Z.clone().multiplyScalar(1).addScaledVector(Y, 0.25).normalize();
  const tg = new Geo();
  const a = tMid.clone().addScaledVector(X, -62);
  const b = tMid.clone().addScaledVector(X, 58);
  truss(tg, m, a, b, 2.5, trussUp);
  const front = Y.clone().negate();
  for (let i = 0; i < 22; i++) {
    const x = -40 + i * 3.8 + (r() - 0.5) * 1.6;
    if (Math.abs(x) < 2.5) continue;
    const p = tMid.clone().addScaledVector(X, x).addScaledVector(front, 1.45).addScaledVector(Z, (r() - 0.5) * 1.2);
    const size: [number, number, number] = [0.8 + r(), 0.5 + r() * 0.4, 0.5 + r() * 0.5];
    const mat = [m.beta, m.beta, m.gold, m.silver][Math.floor(r() * 4)] as MeshStandardMaterial;
    tg.add(mat, box(p, X, Z, size));
  }
  for (let i = -14; i < 14; i++) {
    const p = tMid.clone().addScaledVector(X, i * 3 + 0.8).addScaledVector(front, 1.28).addScaledVector(trussUp, -0.9);
    tg.add(m.yellow, rod(p, p.clone().addScaledVector(X, 0.6), 0.025, 6));
  }
  tg.build("station.truss", root);

  // --- a dish antenna above the truss, left ---------------------------------------------
  const ag = new Geo();
  const aBase = tMid.clone().addScaledVector(X, -14).addScaledVector(trussUp, 1.3);
  const aTip = aBase.clone().addScaledVector(trussUp, 3.5).addScaledVector(Y, 1.5);
  ag.add(m.white, rod(aBase, aTip, 0.12, 12));
  const dishAxis = Y.clone().multiplyScalar(-0.8).addScaledVector(Z, 0.4).addScaledVector(X, 0.3).normalize();
  const dish = new LatheGeometry([new Vector2(0, 0), new Vector2(0.6, 0.08), new Vector2(1.1, 0.3), new Vector2(1.15, 0.33)], 40);
  dish.applyQuaternion(new Quaternion().setFromUnitVectors(v(0, 1, 0), dishAxis));
  dish.translate(aTip.x, aTip.y, aTip.z);
  ag.add(m.white, dish);
  ag.build("station.antenna", root);

  // --- solar wings -------------------------------------------------------------------
  for (const [sideX, name] of [
    [-27, "left"],
    [25, "right"],
  ] as const) {
    const wg = new Geo();
    const wroot = tMid.clone().addScaledVector(X, sideX);
    const along = Y.clone().addScaledVector(Z, -0.12).addScaledVector(X, sideX < 0 ? 0.3 : -0.3).normalize();
    const normal = sun.clone().addScaledVector(along, -sun.dot(along)).normalize();
    for (const off of [-6, 6]) solarWing(wg, m, wroot.clone().addScaledVector(X, off).addScaledVector(along, 1), along, normal, 34);
    wg.add(m.beta, box(wroot, X, Z, [4, 3, 3]));
    wg.build(`station.array.${name}`, root);
  }

  // --- the radiator on the right, edge-on to the sun -------------------------------------
  const rg = new Geo();
  const rRoot = tMid.clone().addScaledVector(X, 20).addScaledVector(trussUp, -1.4);
  const rAlong = Z.clone().multiplyScalar(-0.8).addScaledVector(Y, 0.55).addScaledVector(X, 0.1).normalize();
  const rNormal = rAlong.clone().cross(sun).normalize();
  const rSide = rAlong.clone().cross(rNormal).normalize();
  for (let i = 0; i < 7; i++) {
    const c = rRoot.clone().addScaledVector(rAlong, 1.4 + i * 2.2 + 1);
    rg.add(m.radiator, box(c, rSide, rAlong, [3.2, 2.0, 0.08]));
  }
  rg.add(m.alu, rod(rRoot, rRoot.clone().addScaledVector(rAlong, 16.5), 0.1));
  rg.build("station.radiator", root);

  // --- the robotic arm, its hand poking into the centre window's view ----------------------
  const armG = new Geo();
  const aRoot = tMid.clone().addScaledVector(X, 7).addScaledVector(trussUp, -1.3).addScaledVector(Y, -0.6);
  const elbow = vp(0.95, 0.42, 15);
  const wrist = vp(0.24, 0.04, 11.5);
  armG.add(m.white, rod(aRoot, elbow, 0.22, 16));
  armG.add(m.white, rod(elbow, wrist, 0.2, 16));
  for (const j of [aRoot, elbow]) {
    const joint = new SphereGeometry(0.42, 16, 12);
    joint.translate(j.x, j.y, j.z);
    armG.add(m.white, joint);
    const band = new TorusGeometry(0.3, 0.07, 8, 20);
    band.translate(j.x, j.y, j.z);
    armG.add(m.gold, band);
  }
  armG.build("station.arm", root);
  const hand = new Group();
  nameNode(hand, "secret.arm.hand");
  hand.position.copy(wrist);
  const toward = wrist.clone().sub(elbow).normalize();
  hand.quaternion.setFromUnitVectors(v(0, 0, -1), toward);
  const hg = new Geo();
  const wristJoint = new CylinderGeometry(0.28, 0.28, 0.5, 16);
  wristJoint.rotateX(Math.PI / 2);
  hg.add(m.white, wristJoint);
  hg.add(m.alu, box(v(0, 0, -0.55), X, Z, [0.55, 0.55, 0.6]));
  for (const s of [-1, 1]) hg.add(m.dark, box(v(s * 0.16, 0, -0.95), X, Z, [0.08, 0.3, 0.3]));
  hg.add(m.gold, box(v(0, 0.3, -0.5), X, Z, [0.4, 0.06, 0.4]));
  const handMeshes = hg.build("secret.arm.hand.parts", hand);
  handMeshes.name = "armhandparts";
  root.add(hand);

  // --- the module and the docked capsule, lower left ----------------------------------------
  const mg = new Geo();
  const modAxis = X.clone().addScaledVector(Y, -0.25).normalize();
  const mEnd = vp(-0.46, -0.5, 19);
  const mStart = mEnd.clone().addScaledVector(modAxis, -12);
  mg.add(m.white, rod(mStart, mEnd, 2.1, 32));
  for (let i = 1; i < 6; i++) {
    const ring = new TorusGeometry(2.12, 0.06, 6, 40);
    ring.applyQuaternion(new Quaternion().setFromUnitVectors(v(0, 0, 1), modAxis));
    const c = mStart.clone().addScaledVector(modAxis, i * 2);
    ring.translate(c.x, c.y, c.z);
    mg.add(m.alu, ring);
  }
  for (let i = 0; i < 5; i++) {
    const patch = mStart.clone().addScaledVector(modAxis, 2 + r() * 8);
    const around = r() * Math.PI * 2;
    const q = new Quaternion().setFromAxisAngle(modAxis, around);
    const out = v(0, 1, 0).applyQuaternion(q);
    mg.add(r() < 0.5 ? m.gold : m.silver, box(patch.clone().addScaledVector(out, 2.1), modAxis, out, [1.2, 0.06, 0.9]));
  }
  const port = rod(mEnd, mEnd.clone().addScaledVector(modAxis, 0.6), 1.0, 32);
  mg.add(m.alu, port);
  // The capsule: a cone and its trunk, nose to the port.
  const capBase = mEnd.clone().addScaledVector(modAxis, 4.6);
  const cone = new CylinderGeometry(0.75, 1.9, 4.0, 40, 1, false);
  cone.applyQuaternion(new Quaternion().setFromUnitVectors(v(0, 1, 0), modAxis.clone().negate()));
  const coneMid = mEnd.clone().addScaledVector(modAxis, 2.6);
  cone.translate(coneMid.x, coneMid.y, coneMid.z);
  mg.add(m.white, cone);
  mg.add(m.dark, rod(capBase, capBase.clone().addScaledVector(modAxis, 3.2), 1.9, 40));
  mg.build("station.module", root);
  // The capsule's window (a face at it) and the shade that pulls down over it.
  const winAt = mEnd.clone().addScaledVector(modAxis, 2.0);
  const toEye = winAt.clone().negate().normalize();
  const winNormal = toEye.clone().addScaledVector(modAxis, -toEye.dot(modAxis)).normalize();
  const window = new Group();
  nameNode(window, "secret.capsule.window");
  window.position.copy(winAt).addScaledVector(winNormal, 1.42);
  window.quaternion.setFromUnitVectors(v(0, 0, 1), winNormal);
  const face = new Mesh(new PlaneGeometry(0.42, 0.42), new MeshBasicMaterial({ map: crewFace() }));
  face.position.z = 0.02;
  window.add(face);
  const frame = new Mesh(new TorusGeometry(0.25, 0.04, 8, 24), m.alu);
  window.add(frame);
  root.add(window);
  const shade = new Mesh(new PlaneGeometry(0.44, 0.44), new MeshStandardMaterial({ color: "#d8d3c6", roughness: 0.9 }));
  nameNode(shade, "secret.capsule.shade");
  shade.position.set(0, 0.44, 0.03);
  shade.scale.set(1, 0.02, 1);
  window.add(shade);

  // --- the stowage platform and the drone's cradle, lower right ------------------------------
  const pg = new Geo();
  const pc = vp(0.6, -0.62, 12);
  truss(pg, m, pc.clone().addScaledVector(X, -3.2).addScaledVector(Z, -0.6), pc.clone().addScaledVector(X, 3.2).addScaledVector(Z, -0.6), 0.6, Z, 1.6, 0.05, 0.03);
  pg.add(m.alu, box(pc.clone().addScaledVector(Z, -0.25), X, Z, [6.6, 0.12, 2.4]));
  for (let i = 0; i < 4; i++) {
    const size: [number, number, number] = [0.8 + r() * 0.4, 0.6 + r() * 0.5, 0.8 + r() * 0.7];
    const mat = [m.beta, m.gold, m.beta, m.silver][i] as MeshStandardMaterial;
    pg.add(mat, box(pc.clone().addScaledVector(X, -2.6 + i * 1.15).addScaledVector(Z, size[1] / 2 - 0.19), X, Z, size));
  }
  pg.add(m.white, rod(pc.clone().addScaledVector(Z, -0.6).addScaledVector(X, -2.5), pc.clone().addScaledVector(Z, -6).addScaledVector(Y, -4).addScaledVector(X, -4), 0.14, 12));
  const dock = pc.clone().addScaledVector(X, 2.2).addScaledVector(Z, 0.35);
  pg.add(m.alu, box(dock.clone().addScaledVector(Z, -0.45), X, Z, [1.3, 0.12, 1.3]));
  pg.build("station.platform", root);

  // --- the laser turret below the window ---------------------------------------------------
  const turret = new Geo();
  const tBase = vp(0.24, -0.76, 5.2);
  const forward = v(0, Math.sin((-20 * Math.PI) / 180), -Math.cos((-20 * Math.PI) / 180));
  turret.add(m.dark, rod(tBase.clone().addScaledVector(Z, -1.2), tBase.clone().addScaledVector(Z, -0.2), 0.35, 20));
  const yoke = new SphereGeometry(0.34, 20, 14);
  yoke.translate(tBase.x, tBase.y, tBase.z);
  turret.add(m.white, yoke);
  const muzzle = tBase.clone().addScaledVector(forward, 1.0);
  turret.add(m.alu, rod(tBase, muzzle, 0.1, 16));
  turret.add(m.gold, rod(tBase.clone().addScaledVector(forward, 0.2), tBase.clone().addScaledVector(forward, 0.55), 0.16, 16));
  turret.build("station.turret", root);
  const emitter = new Object3D();
  nameNode(emitter, "emitter");
  emitter.position.copy(muzzle);
  emitter.quaternion.setFromUnitVectors(v(0, 0, -1), forward);
  root.add(emitter);

  // --- running lights: the aim check's nine ---------------------------------------------------
  const lights: [string, Vector3, "red" | "green" | "white"][] = [
    ["1", tMid.clone().addScaledVector(X, -14).addScaledVector(Y, -1.5).addScaledVector(trussUp, -1.2), "red"],
    ["2", tMid.clone().addScaledVector(X, 3.2).addScaledVector(Y, -1.5).addScaledVector(trussUp, -1.2), "white"],
    ["3", tMid.clone().addScaledVector(X, 15).addScaledVector(Y, -1.5).addScaledVector(trussUp, -1.2), "green"],
    ["4", vp(-0.86, 0.05, 30), "red"],
    ["5", wrist.clone().addScaledVector(Z, 0.42), "white"],
    ["6", rRoot.clone().addScaledVector(rAlong, 15.6), "green"],
    ["7", mEnd.clone().addScaledVector(modAxis, 8.85), "red"],
    ["8", tBase.clone().addScaledVector(Z, -0.35).addScaledVector(X, 0.55), "white"],
    ["9", pc.clone().addScaledVector(Z, 0.2).addScaledVector(X, -3.3), "green"],
  ];
  const beacons = new Geo();
  for (const [name, p, kind] of lights) {
    const n = p.clone().negate().normalize();
    const housing = new CylinderGeometry(0.16, 0.2, 0.18, 16);
    housing.applyQuaternion(new Quaternion().setFromUnitVectors(v(0, 1, 0), n));
    housing.translate(p.x - n.x * 0.1, p.y - n.y * 0.1, p.z - n.z * 0.1);
    beacons.add(m.dark, housing);
    const node = new Object3D();
    nameNode(node, `calib.${name}`);
    node.position.copy(p);
    node.userData["light"] = kind;
    node.userData["surface"] = "metal";
    root.add(node);
  }
  beacons.build("station.beacons", root);

  // --- the drone: its cradle, its rounds, and where it hovers to mend each pane ------------------
  const dockNode = new Object3D();
  nameNode(dockNode, "drone.dock");
  dockNode.position.copy(dock);
  dockNode.quaternion.setFromUnitVectors(v(0, 0, -1), dock.clone().negate().normalize());
  root.add(dockNode);
  const route = [dock.clone().add(v(0, 0.8, 2.0)), vp(0.22, 0.3, 6), vp(-0.35, 0.25, 5), vp(-0.45, -0.35, 5.5), vp(0.05, -0.55, 5), vp(0.45, -0.3, 5.5), vp(0.5, 0.35, 7)];
  route.forEach((p, i) => {
    const n = new Object3D();
    nameNode(n, `drone.path.${i + 1}`);
    n.position.copy(p);
    root.add(n);
  });
  for (const pane of designPanes()) {
    const n = new Object3D();
    nameNode(n, `drone.work.${pane.id}`);
    const c = v(pane.center.x, pane.center.y, pane.center.z);
    const nn = v(pane.normal.x, pane.normal.y, pane.normal.z);
    n.position.copy(c).addScaledVector(nn, 1.1);
    n.quaternion.setFromUnitVectors(v(0, 0, -1), nn.clone().negate());
    n.userData["pane"] = pane.id;
    root.add(n);
  }

  // --- the spacewalker's way along the truss, the duck's drift, the debris lanes -----------------
  for (let i = 0; i < 8; i++) {
    const p = tMid.clone().addScaledVector(X, -16 + i * 4.2).addScaledVector(Y, -1.9).addScaledVector(trussUp, -0.4);
    const n = new Object3D();
    nameNode(n, `astronaut.path.${i + 1}`);
    n.position.copy(p);
    n.quaternion.setFromUnitVectors(v(0, 0, -1), X);
    root.add(n);
  }
  (
    [
      [-1.4, 0.35, 70],
      [-0.7, 0.2, 60],
      [0, 0.1, 55],
      [0.7, -0.05, 62],
      [1.4, -0.2, 75],
    ] as const
  ).forEach(([sx, sy, d], i) => {
    const n = new Object3D();
    nameNode(n, `secret.duck.path.${i + 1}`);
    n.position.copy(vp(sx, sy, d));
    root.add(n);
  });
  designLanes().forEach((l, i) => {
    const n = new Object3D();
    nameNode(n, `spawn.${i + 1}`);
    n.position.set(l.x, l.y, l.z);
    n.userData["depth_m"] = Math.round(Math.hypot(l.x, l.y, l.z) * 10) / 10;
    root.add(n);
  });

  // --- the shared sun and planet ---------------------------------------------------------
  const sunNode = new Object3D();
  nameNode(sunNode, "sun");
  sunNode.quaternion.setFromUnitVectors(v(0, 0, 1), sun);
  root.add(sunNode);
  const planet = new Object3D();
  nameNode(planet, "planet");
  planet.position.copy(planetCentre());
  planet.quaternion.copy(planetRotation());
  Object.assign(planet.userData, { radius_m: R_KM * 1000, altitude_m: ALT_KM * 1000, hi_lonlat: [...PLACEHOLDER_HI], storm_lonlat: [...PLACEHOLDER_STORM] });
  root.add(planet);
  void Color;
  return root;
}
