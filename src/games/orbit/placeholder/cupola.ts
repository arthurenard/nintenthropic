/**
 * The placeholder cupola: the seven-windowed dome of the art's build
 * (art/orbit/orbitlib/cupola.py) at its exact size - a round window in the
 * top plate, six trapezoids in the sloping facets round it, the machined
 * frame with raised window rims and rings of bolts, blue handrails, a
 * laptop on an arm, LED strips at the base, a few things adrift on
 * tethers - with its light "baked" into vertex colours and drawn unlit, as
 * the real cupola's is baked into textures. Its nodes are the contract's:
 * camera.player, sun, planet, pane.center and pane.1…6, hud.anchor, float.*.
 */
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  CylinderGeometry,
  ExtrudeGeometry,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  Path,
  Quaternion,
  Shape,
  ShapeGeometry,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  Vector3,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { nameNode } from "../../../engine/world/names";
import { CUPOLA, FACET_PANE, facet, viewAxes, VIEW_FOV_DEG, VIEW_PITCH_DEG, windowCorners } from "../rules/layout";
import { ALT_KM, planetCentre, planetRotation, R_KM, sunDirection } from "./geometry";
import { PLACEHOLDER_HI, PLACEHOLDER_STORM } from "./planetMaps";

const RAD = Math.PI / 180;

/** The cupola's own frame (x right, y along its axis, z up) into the world. */
function cupolaMatrix(): Matrix4 {
  const { right, up, forward } = viewAxes();
  return new Matrix4().makeBasis(new Vector3(right.x, right.y, right.z), new Vector3(forward.x, forward.y, forward.z), new Vector3(up.x, up.y, up.z));
}

const v = (x: number, y: number, z: number) => new Vector3(x, y, z);

/** A pale interior light, cool LEDs round the base and a little blue from the planet below. */
function bakeLight(p: Vector3, n: Vector3, toWorld: Matrix4): Color {
  // In the cupola's frame: the LED ring sits at the base, the eye near the axis.
  const inv = toWorld.clone().invert();
  const q = p.clone().applyMatrix4(inv);
  const nn = n.clone().transformDirection(inv);
  const led = new Vector3(0, CUPOLA.aBase + 0.05, -0.2);
  const toLed = led.clone().sub(q);
  const d = toLed.length();
  const lambert = Math.max(0, nn.dot(toLed.normalize()));
  const ledLight = (0.55 * lambert) / (1 + d * d * 1.6) + 0.08;
  // The eye-side faces of the forging catch the room's light; faces toward space get the planet's blue.
  const facingEye = Math.max(0, -nn.dot(q.clone().normalize()));
  const earth = Math.max(0, -nn.z) * 0.12;
  const c = new Color(0.9, 0.95, 1.0).multiplyScalar(ledLight + facingEye * 0.18);
  c.add(new Color(0.35, 0.55, 0.9).multiplyScalar(earth));
  // Deeper into the corners, darker: a crude occlusion by distance from the axis.
  const occl = 0.75 + 0.25 * Math.min(1, Math.max(0, 1.2 - Math.hypot(q.x, q.z)));
  return c.multiplyScalar(occl);
}

/** Paint a geometry (already in the world) with its albedo under the baked light. */
function bake(g: BufferGeometry, albedo: Color, toWorld: Matrix4, gloss = 0): BufferGeometry {
  const geo = g.index ? g.toNonIndexed() : g;
  geo.computeVertexNormals();
  const pos = geo.getAttribute("position");
  const nor = geo.getAttribute("normal");
  const col = new Float32Array(pos.count * 3);
  const p = new Vector3();
  const n = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    n.fromBufferAttribute(nor, i);
    const light = bakeLight(p, n, toWorld);
    // A metal edge catches a highlight from the LEDs.
    const spec = gloss * Math.pow(Math.max(0, n.y * 0.4 + 0.6), 8) * 0.25;
    col[i * 3] = albedo.r * light.r + spec;
    col[i * 3 + 1] = albedo.g * light.g + spec;
    col[i * 3 + 2] = albedo.b * light.b + spec;
  }
  geo.setAttribute("color", new BufferAttribute(col, 3));
  return geo;
}

class Batch {
  private readonly parts = new Map<string, { albedo: Color; gloss: number; geos: BufferGeometry[] }>();
  constructor(private readonly toWorld: Matrix4) {}
  add(key: string, albedo: string, gloss: number, g: BufferGeometry, m?: Matrix4): void {
    const geo = g.clone();
    if (m) geo.applyMatrix4(m);
    let part = this.parts.get(key);
    if (!part) {
      part = { albedo: new Color(albedo), gloss, geos: [] };
      this.parts.set(key, part);
    }
    // Only the attributes every part shares, so they merge.
    for (const name of Object.keys(geo.attributes)) if (name !== "position" && name !== "normal") geo.deleteAttribute(name);
    part.geos.push(geo.index ? geo.toNonIndexed() : geo);
  }
  build(parent: Object3D, material: MeshBasicMaterial): void {
    for (const [key, part] of this.parts) {
      const merged = mergeGeometries(part.geos.map((g) => g.applyMatrix4(this.toWorld)), false);
      if (!merged) continue;
      const mesh = new Mesh(bake(merged, part.albedo, this.toWorld, part.gloss), material);
      nameNode(mesh, `cupola.${key}`);
      parent.add(mesh);
    }
  }
}

/** A flat outline (with holes) extruded `depth` along a frame's +Z, placed by `m`. */
function extrude(shape: Shape, depth: number, m: Matrix4, bevel = 0): BufferGeometry {
  const g = new ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 1, curveSegments: 48 });
  g.applyMatrix4(m);
  return g;
}

/** A facet's frame: x along its edge, y down the slant, z outward; origin at the middle of its top edge. */
function facetMatrix(k: number): Matrix4 {
  const f = facet(k);
  const lat = v(f.lateral.x, f.lateral.y, f.lateral.z);
  const s = v(f.slant.x, f.slant.y, f.slant.z);
  const o = v(-f.inward.x, -f.inward.y, -f.inward.z);
  const m = new Matrix4().makeBasis(lat, s, o).setPosition(v(f.top.x, f.top.y, f.top.z));
  // Keep it right-handed, so extruded faces point the right way.
  if (m.determinant() < 0) m.makeBasis(lat.clone().negate(), s, o).setPosition(v(f.top.x, f.top.y, f.top.z));
  return m;
}

function trapezoid(h0: number, h1: number, len: number, t0 = 0, t1 = 1): { x: number; y: number }[] {
  return [
    { x: -h0, y: t0 * len },
    { x: h0, y: t0 * len },
    { x: h1, y: t1 * len },
    { x: -h1, y: t1 * len },
  ];
}

function shapeOf(points: { x: number; y: number }[], holes: { x: number; y: number }[][] = []): Shape {
  const s = new Shape();
  points.forEach((p, i) => (i === 0 ? s.moveTo(p.x, p.y) : s.lineTo(p.x, p.y)));
  s.closePath();
  for (const h of holes) {
    const path = new Path();
    [...h].reverse().forEach((p, i) => (i === 0 ? path.moveTo(p.x, p.y) : path.lineTo(p.x, p.y)));
    path.closePath();
    s.holes.push(path);
  }
  return s;
}

function circle(r: number, n = 64): { x: number; y: number }[] {
  return Array.from({ length: n }, (_, i) => ({ x: r * Math.cos((i / n) * Math.PI * 2), y: r * Math.sin((i / n) * Math.PI * 2) }));
}

function inset(poly: { x: number; y: number }[], by: number): { x: number; y: number }[] {
  const cx = poly.reduce((s, p) => s + p.x, 0) / poly.length;
  const cy = poly.reduce((s, p) => s + p.y, 0) / poly.length;
  return poly.map((p) => {
    const dx = p.x - cx;
    const dy = p.y - cy;
    const l = Math.hypot(dx, dy) || 1;
    return { x: p.x - (dx / l) * by, y: p.y - (dy / l) * by };
  });
}

/** The laptop's screen: a quiet dark page with the planet's outline and a few lines. */
function laptopScreen(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 160;
  const g = c.getContext("2d");
  if (g) {
    g.fillStyle = "#0b1422";
    g.fillRect(0, 0, 256, 160);
    g.strokeStyle = "rgba(140, 190, 255, 0.8)";
    g.lineWidth = 2;
    g.beginPath();
    g.arc(90, 190, 120, Math.PI * 1.15, Math.PI * 1.85);
    g.stroke();
    g.fillStyle = "rgba(220, 235, 255, 0.85)";
    g.font = "600 13px -apple-system, Helvetica, sans-serif";
    g.fillText("MERIDIAN · PASS", 16, 26);
    g.fillStyle = "rgba(160, 190, 220, 0.6)";
    for (let i = 0; i < 5; i++) g.fillRect(150, 40 + i * 14, 70 + ((i * 37) % 30), 5);
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

export function buildPlaceholderCupola(): Group {
  const root = new Group();
  nameNode(root, "cupola");
  const toWorld = cupolaMatrix();
  const batch = new Batch(toWorld);
  const C = CUPOLA;

  // --- the forging: the top plate with the centre window's hole ----------------
  const topHex = Array.from({ length: 6 }, (_, j) => {
    const a = 30 * RAD + j * 60 * RAD;
    const rc = C.rTop / Math.cos(30 * RAD);
    return { x: rc * Math.cos(a), y: rc * Math.sin(a) };
  });
  // Plate's local (X, Y, Z) is the cupola's (x, z, y), lifted to the top plane.
  const plate = new Matrix4().set(1, 0, 0, 0, 0, 0, 1, C.aTop, 0, 1, 0, 0, 0, 0, 0, 1);
  batch.add("forging", "#50555c", 0.4, extrude(shapeOf(topHex, [circle(C.rCentre)]), C.shell, plate));
  // The centre window's rim, standing proud on the inside, and its bolts.
  const rimIn = new Matrix4().set(1, 0, 0, 0, 0, 0, 1, C.aTop - 0.022, 0, 1, 0, 0, 0, 0, 0, 1);
  batch.add("rim", "#8c9198", 1, extrude(shapeOf(circle(C.rCentre + 0.05), [circle(C.rCentre)]), 0.022, rimIn));
  const bolt = new CylinderGeometry(0.009, 0.009, 0.012, 8);
  bolt.rotateX(Math.PI / 2);
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const m = new Matrix4().makeTranslation(Math.cos(a) * (C.rCentre + 0.028), C.aTop - 0.028, Math.sin(a) * (C.rCentre + 0.028));
    m.multiply(new Matrix4().makeRotationX(Math.PI / 2));
    batch.add("bolts", "#a7adb3", 1, bolt, m);
  }

  // --- the six facets, each with its window --------------------------------------
  for (let k = 0; k < 6; k++) {
    const f = facet(k);
    const m = facetMatrix(k);
    const outline = trapezoid(f.half(0), f.half(1), f.length);
    const w0 = f.half(C.winT0) - C.mullion;
    const w1 = f.half(C.winT1) - C.mullion;
    const win = trapezoid(w0, w1, f.length, C.winT0, C.winT1);
    batch.add("forging", "#50555c", 0.4, extrude(shapeOf(outline, [win]), C.shell, m));
    // The window's retention frame, proud of the inner face.
    const rim = m.clone().multiply(new Matrix4().makeTranslation(0, 0, -0.018));
    batch.add("rim", "#8c9198", 1, extrude(shapeOf(inset(win, -0.045), [win]), 0.018, rim));
    // A ring of bolts round it.
    const ring = inset(win, -0.024);
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!;
      const b = ring[(i + 1) % ring.length]!;
      for (let s = 0; s < 4; s++) {
        const t = (s + 0.5) / 4;
        const bm = m.clone().multiply(new Matrix4().makeTranslation(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, -0.022));
        batch.add("bolts", "#a7adb3", 1, bolt, bm);
      }
    }
    // The mullions' cover ribs along the facet's edges.
    for (const side of [-1, 1]) {
      const rib = new BoxGeometry(0.03, f.length, 0.02);
      const rm = m.clone().multiply(new Matrix4().makeTranslation(side * (f.half(0.5) - 0.015), f.length / 2, -0.012));
      rm.multiply(new Matrix4().makeRotationZ(-side * Math.atan2(f.half(1) - f.half(0), f.length)));
      batch.add("rim", "#7a7f86", 1, rib, rm);
    }
    // Blue handrails on stand-offs, low on three facets.
    if (k === 0 || k === 3 || k === 4) {
      const y = f.length * 0.8;
      const w = f.half(0.8) * 0.7;
      const rail = new CylinderGeometry(0.012, 0.012, w * 2, 10);
      rail.rotateZ(Math.PI / 2);
      batch.add("rail", "#2e62ad", 0.6, rail, m.clone().multiply(new Matrix4().makeTranslation(0, y, -0.07)));
      for (const sx of [-w, w]) {
        const post = new CylinderGeometry(0.008, 0.008, 0.07, 8);
        post.rotateX(Math.PI / 2);
        batch.add("rail", "#2e62ad", 0.6, post, m.clone().multiply(new Matrix4().makeTranslation(sx, y, -0.035)));
      }
    }
  }

  // --- the base: a ring round the bottom, and the skirt behind the eye -----------
  const baseOuter = Array.from({ length: 6 }, (_, j) => {
    const a = 30 * RAD + j * 60 * RAD;
    const rc = (C.rBase + 0.45) / Math.cos(30 * RAD);
    return { x: rc * Math.cos(a), y: rc * Math.sin(a) };
  });
  const baseInner = Array.from({ length: 6 }, (_, j) => {
    const a = 30 * RAD + j * 60 * RAD;
    const rc = C.rBase / Math.cos(30 * RAD);
    return { x: rc * Math.cos(a), y: rc * Math.sin(a) };
  });
  const basePlane = new Matrix4().set(1, 0, 0, 0, 0, 0, 1, C.aBase - 0.06, 0, 1, 0, 0, 0, 0, 0, 1);
  batch.add("panels", "#c9c6bf", 0, extrude(shapeOf(baseOuter, [baseInner]), 0.06, basePlane));
  const skirt = new CylinderGeometry(C.rBase + 0.45, C.rBase + 0.45, 1.2, 6, 1, true);
  skirt.rotateY(30 * RAD);
  batch.add("panels", "#b9b6af", 0, skirt, new Matrix4().makeTranslation(0, C.aBase - 0.66, 0));
  // LED strips round the base: the room's light.
  const leds: BufferGeometry[] = [];
  for (let j = 0; j < 6; j++) {
    const a = j * 60 * RAD;
    const strip = new BoxGeometry(0.5, 0.012, 0.018);
    strip.applyMatrix4(new Matrix4().makeRotationY(-a + Math.PI / 2));
    strip.applyMatrix4(new Matrix4().makeTranslation(Math.cos(a) * (C.rBase + 0.02), C.aBase + 0.01, Math.sin(a) * (C.rBase + 0.02)));
    strip.applyMatrix4(toWorld);
    leds.push(strip);
  }
  const ledMesh = new Mesh(mergeGeometries(leds)!, new MeshBasicMaterial({ color: new Color(1.4, 1.5, 1.6) }));
  nameNode(ledMesh, "cupola.leds");
  root.add(ledMesh);

  // --- a laptop on an arm, lower right ------------------------------------------
  const laptop = new Group();
  nameNode(laptop, "cupola.laptop");
  const screen = new Mesh(new BoxGeometry(0.34, 0.22, 0.012), new MeshBasicMaterial({ color: "#1d2127" }));
  const face = new Mesh(new BoxGeometry(0.31, 0.19, 0.001), new MeshBasicMaterial({ map: laptopScreen() }));
  face.position.z = 0.007;
  screen.add(face);
  const base = new Mesh(new BoxGeometry(0.34, 0.015, 0.24), new MeshBasicMaterial({ color: "#2a2e34" }));
  base.position.set(0, -0.115, 0.11);
  screen.add(base);
  laptop.add(screen);
  // Placed low and to the right, turned toward the eye.
  laptop.position.copy(v(0.62, 0.52, -0.42).applyMatrix4(toWorld));
  laptop.lookAt(new Vector3(0, 0, 0));
  laptop.rotateX(-0.25);
  root.add(laptop);
  const armGeo = new CylinderGeometry(0.014, 0.014, 0.42, 8);
  armGeo.rotateZ(Math.PI / 2.6);
  batch.add("rim", "#6d737a", 1, armGeo, new Matrix4().makeTranslation(0.82, 0.52, -0.5));

  batch.build(root, new MeshBasicMaterial({ vertexColors: true }));

  // --- the panes: each window's glass, its own mesh, UVs across it -----------------
  const centre = new CircleGeometry(C.rCentre, 64);
  // Circle is in its XY plane: lay it in the top plate, facing out along the axis.
  centre.applyMatrix4(new Matrix4().set(1, 0, 0, 0, 0, 0, 1, C.aTop + C.shell * 0.5, 0, 1, 0, 0, 0, 0, 0, 1));
  centre.applyMatrix4(toWorld);
  addPane(root, 0, centre);
  for (let k = 0; k < 6; k++) {
    const f = facet(k);
    const m = facetMatrix(k);
    const w0 = f.half(C.winT0) - C.mullion;
    const w1 = f.half(C.winT1) - C.mullion;
    const win = trapezoid(w0, w1, f.length, C.winT0, C.winT1);
    const g = new ShapeGeometry(shapeOf(win));
    // UVs across the glass, 0..1 each way.
    const uv = g.getAttribute("uv");
    const pos = g.getAttribute("position");
    const minX = -Math.max(w0, w1);
    const spanX = 2 * Math.max(w0, w1);
    const minY = C.winT0 * f.length;
    const spanY = (C.winT1 - C.winT0) * f.length;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) - minX) / spanX, 1 - (pos.getY(i) - minY) / spanY);
    g.applyMatrix4(m.clone().multiply(new Matrix4().makeTranslation(0, 0, C.shell * 0.5)));
    g.applyMatrix4(toWorld);
    addPane(root, FACET_PANE[k] as number, g);
    void windowCorners;
  }

  // --- things adrift on tethers ----------------------------------------------------
  const floats: [string, Mesh, Vector3][] = [
    ["float.1", new Mesh(new CylinderGeometry(0.006, 0.006, 0.14, 8), new MeshStandardMaterial({ color: "#d8d2c4" })), v(-0.34, 0.95, 0.42)],
    ["float.2", new Mesh(new SphereGeometry(0.05, 20, 14), new MeshStandardMaterial({ color: "#3d7bd1", roughness: 0.9 })), v(0.38, 1.05, 0.36)],
    ["float.3", new Mesh(new BoxGeometry(0.1, 0.14, 0.002), new MeshStandardMaterial({ color: "#f2eee4", roughness: 0.9 })), v(-0.5, 0.75, -0.3)],
  ];
  for (const [name, mesh, at] of floats) {
    const node = new Group();
    nameNode(node, name);
    node.position.copy(at.applyMatrix4(toWorld));
    node.add(mesh);
    mesh.rotation.set(0.6, 0.3, 0.9);
    root.add(node);
  }

  // --- the contract's empties ------------------------------------------------------
  const cam = new PerspectiveCamera(VIEW_FOV_DEG, 16 / 9, 0.05, 1000);
  nameNode(cam, "camera.player");
  cam.quaternion.setFromAxisAngle(v(1, 0, 0), VIEW_PITCH_DEG * RAD);
  cam.userData["fov_deg"] = VIEW_FOV_DEG;
  cam.userData["pitch_deg"] = VIEW_PITCH_DEG;
  root.add(cam);
  const sun = new Object3D();
  nameNode(sun, "sun");
  // −Z along the sunlight: +Z toward the sun.
  sun.quaternion.setFromUnitVectors(v(0, 0, 1), sunDirection());
  root.add(sun);
  const planet = new Object3D();
  nameNode(planet, "planet");
  planet.position.copy(planetCentre());
  planet.quaternion.copy(planetRotation());
  Object.assign(planet.userData, {
    radius_m: R_KM * 1000,
    altitude_m: ALT_KM * 1000,
    cloud_height_m: 6000,
    atmosphere_m: 100000,
    hi_lonlat: [...PLACEHOLDER_HI],
    storm_lonlat: [...PLACEHOLDER_STORM],
  });
  root.add(planet);
  const hud = new Object3D();
  nameNode(hud, "hud.anchor");
  hud.position.copy(v(0, C.aTop, 0).applyMatrix4(toWorld));
  hud.quaternion.copy(new Quaternion().setFromRotationMatrix(toWorld));
  root.add(hud);
  // The ring round the whole thing's foot (a hatch behind the eye), so nothing shows through.
  const hatch = new Mesh(new TorusGeometry(1.6, 0.4, 8, 24), new MeshBasicMaterial({ color: "#1b1d20" }));
  hatch.position.copy(v(0, -0.6, 0).applyMatrix4(toWorld));
  hatch.quaternion.copy(new Quaternion().setFromRotationMatrix(toWorld));
  hatch.rotateX(Math.PI / 2);
  root.add(hatch);
  return root;
}

function addPane(root: Group, id: number, g: BufferGeometry): void {
  const mesh = new Mesh(g, new MeshBasicMaterial({ color: "#dfe8ee", transparent: true, opacity: 0.06, depthWrite: false }));
  nameNode(mesh, id === 0 ? "pane.center" : `pane.${id}`);
  mesh.userData["pane"] = id;
  root.add(mesh);
}
