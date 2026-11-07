/**
 * The Blender-made kart (art/kart/karts/build.py, public/assets/kart/karts.glb)
 * as a `KartModel`: the same API as the code-built kart (kartModel.ts), so the
 * actor, the effects and the drivers cannot tell them apart.
 *
 * The file holds three nodes (see art/kart/README.md): `kart.body` (the whole
 * fixed kart), `kart.wheel` (one wheel, origin at its hub, axis x, outer face
 * toward +x, rear size) and `kart.steering`. Their glTF materials are read by
 * NAME and turned into the kart surfaces of kartMaterial.ts, so the whole kart
 * is drawn by the one shared material (lit by the sky's reflections, the baked
 * sun, the rim light) in a handful of draw calls:
 *
 *   paint    the racer's colour under a clear coat (gold on the golden kart)
 *   seat     the racer's colour, dark cloth
 *   trim, stripe, chrome, rim, steel, rubber, tread, plastic, glass   as they say
 *   lamp, tail   emissive (the glTF's own emissive colour and strength)
 *
 * Ambient occlusion is in the file's vertex colours. A racer's colour is
 * multiplied into the paint vertices when the racer's geometry is made (the
 * position, normal and surface buffers are shared by every kart).
 */
import { BufferGeometry, Float32BufferAttribute, Group, LOD, Matrix3, Matrix4, Mesh, Vector3, type Material, type MeshStandardMaterial, type Object3D } from "three";
import type { Weight } from "../characters";
import type { RacerSetup } from "../contract";
import { artNode, hasArt } from "./art";
import type { Driver } from "./drivers";
import { mergeBaked, rgb, type Rgb } from "./kartBuilder";
import { brakeLights } from "./brakeLights";
import { SURF, kartMaterial, withStudioFallback, type Surf } from "./kartMaterial";
import { bodyClass, liveryColour, liveryNode, liveryOf } from "./livery";
import { FAR_DISTANCE, KART_EXHAUST, STEERING, WHEEL_FRONT, WHEEL_REAR } from "./kartSpec";
import type { KartModel } from "./kart";

/** The front wheels are the rear wheel's model drawn this much smaller. */
export const FRONT_SCALE = WHEEL_FRONT.r / WHEEL_REAR.r;

const GOLD: Rgb = [1.0, 0.52, 0.06];

/** What the art kart borrows from the code-built one: its flames, its numbered plate and its drivers. */
export interface ArtKit {
  flame(): BufferGeometry;
  flameMaterial: Material;
  /** The kart's number, written on its plate: a geometry in the kart's own frame. */
  plate(id: number, accent: Rgb): BufferGeometry;
  /** This driver's own touches of coachwork (kartExtras.ts), welded into the body; null for none. */
  extras?(accent: Rgb, golden: boolean, weight: Weight): BufferGeometry | null;
  driver(): Driver;
}

export type Part = "body" | "wheel" | "steering";

interface Look {
  surf: Surf;
  /** The racer's colour is multiplied in (1), or their livery's second colour (2). */
  tint: 0 | 1 | 2;
  /** Replaces the material's own base colour. */
  colour?: Rgb;
}

/** The kart surface for a glTF material name (and a guess from its PBR numbers for a name that is not known). */
function lookOf(material: MeshStandardMaterial, part: Part, golden: boolean): Look {
  const gold = golden && part === "body";
  switch (material.name) {
    case "paint":
      return gold ? { surf: SURF.gold, tint: 0, colour: GOLD } : { surf: SURF.paint, tint: 1 };
    case "trim":
      return gold ? { surf: SURF.gold, tint: 0, colour: GOLD } : { surf: SURF.trim, tint: 0 };
    case "livery":
      return { surf: SURF.trim, tint: 2 };
    case "stripe":
      return gold ? { surf: SURF.trim, tint: 1 } : { surf: SURF.trim, tint: 0 };
    case "seat":
      return { surf: SURF.cloth, tint: 1 };
    case "chrome":
      return { surf: SURF.chrome, tint: 0 };
    case "rim":
      return golden && part === "wheel" ? { surf: SURF.gold, tint: 0, colour: GOLD } : { surf: SURF.chrome, tint: 0 };
    case "steel":
      return { surf: SURF.steel, tint: 0 };
    case "rubber":
    case "tread":
      return { surf: SURF.rubber, tint: 0 };
    case "plastic":
      return { surf: SURF.plastic, tint: 0 };
    case "glass":
      return { surf: SURF.glass, tint: 0 };
    case "lamp":
    case "tail":
      return { surf: SURF.lamp, tint: 0, colour: emitted(material, material.name === "tail" ? [2.8, 0.1, 0.07] : [1.9, 1.75, 1.35]) };
  }
  if (material.emissive.r + material.emissive.g + material.emissive.b > 0.01) return { surf: SURF.lamp, tint: 0, colour: emitted(material, [1.9, 1.75, 1.35]) };
  if (material.metalness > 0.8) return { surf: material.roughness < 0.2 ? SURF.chrome : SURF.steel, tint: 0 };
  return { surf: SURF.plastic, tint: 0 };
}

/** The colour an emissive material gives off (the glTF's emissive colour times its strength), over-bright so the bloom takes it. */
function emitted(material: MeshStandardMaterial, fallback: Rgb): Rgb {
  const e = material.emissive;
  const k = material.emissiveIntensity;
  return e.r + e.g + e.b > 0.01 ? [e.r * k, e.g * k, e.b * k] : fallback;
}

/** A node's meshes welded into one geometry in the shared kart attributes, and which vertices take the racer's colour. */
export interface Base {
  geometry: BufferGeometry;
  tint: Uint8Array;
  /** Which vertices belong to the tail lamps (the material "tail"), which light up when the kart brakes. */
  tail?: Uint8Array;
}

const bases = new Map<string, Base | null>();

/** Forgets what was made of the art (a test swaps the art under it; the game never needs this). */
export function resetArtKart(): void {
  bases.clear();
}

function baseOf(name: string, part: Part, golden: boolean, get: (name: string) => Object3D | null): Base | null {
  const key = `${name}|${golden ? "gold" : ""}`;
  const hit = bases.get(key);
  if (hit !== undefined) return hit;
  const node = get(name);
  const base = node ? bakeArt(node, part, golden) : null;
  bases.set(key, base);
  return base;
}

/** A node's meshes welded into one geometry in the shared kart attributes (see Base). The node's own frame is the geometry's. */
export function bakeArt(node: Object3D, part: Part, golden: boolean): Base {
  node.updateMatrixWorld(true);
  const inverse = new Matrix4().copy(node.matrixWorld).invert();
  const position: number[] = [];
  const normal: number[] = [];
  const color: number[] = [];
  const surfs: number[] = [];
  const index: number[] = [];
  const tint: number[] = [];
  const tail: number[] = [];
  const m = new Matrix4();
  const nm = new Matrix3();
  const p = new Vector3();
  const n = new Vector3();
  node.traverse((o: Object3D) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    const geometry = mesh.geometry;
    const pos = geometry.getAttribute("position");
    const nor = geometry.getAttribute("normal");
    const col = geometry.getAttribute("color");
    const material = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as MeshStandardMaterial;
    const look = lookOf(material, part, golden);
    const base = look.colour ?? [material.color.r, material.color.g, material.color.b];
    m.multiplyMatrices(inverse, mesh.matrixWorld);
    nm.getNormalMatrix(m);
    const first = position.length / 3;
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i).applyMatrix4(m);
      n.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize();
      position.push(p.x, p.y, p.z);
      normal.push(n.x, n.y, n.z);
      const ao = col ? col.getX(i) : 1;
      const aoG = col ? col.getY(i) : 1;
      const aoB = col ? col.getZ(i) : 1;
      color.push(base[0] * ao, base[1] * aoG, base[2] * aoB);
      surfs.push(look.surf[0], look.surf[1], look.surf[2], look.surf[3]);
      tint.push(look.tint);
      tail.push(material.name === "tail" ? 1 : 0);
    }
    const idx = geometry.index;
    if (idx) for (let i = 0; i < idx.count; i++) index.push(idx.getX(i) + first);
    else for (let i = 0; i < pos.count; i++) index.push(i + first);
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(position, 3));
  geometry.setAttribute("normal", new Float32BufferAttribute(normal, 3));
  geometry.setAttribute("color", new Float32BufferAttribute(color, 3));
  geometry.setAttribute("aSurf", new Float32BufferAttribute(surfs, 4));
  geometry.setIndex(index);
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  return { geometry, tint: Uint8Array.from(tint), tail: Uint8Array.from(tail) };
}

/** A racer's copy of a base: the buffers are shared, only the colours differ. */
export function forRacer(base: Base, accent: Rgb, second: Rgb = accent): BufferGeometry {
  const src = base.geometry;
  const g = new BufferGeometry();
  for (const name of ["position", "normal", "aSurf"]) g.setAttribute(name, src.getAttribute(name));
  g.setIndex(src.index);
  const from = src.getAttribute("color").array as Float32Array;
  const to = new Float32Array(from.length);
  for (let i = 0; i < base.tint.length; i++) {
    const k = base.tint[i]!;
    const c = k === 2 ? second : accent;
    to[i * 3] = from[i * 3]! * (k ? c[0] : 1);
    to[i * 3 + 1] = from[i * 3 + 1]! * (k ? c[1] : 1);
    to[i * 3 + 2] = from[i * 3 + 2]! * (k ? c[2] : 1);
  }
  g.setAttribute("color", new Float32BufferAttribute(to, 3));
  g.boundingSphere = src.boundingSphere!.clone();
  g.boundingBox = src.boundingBox!.clone();
  return g;
}

/** Is the modelled kart in the art that was loaded? */
export function hasArtKart(): boolean {
  return hasArt("kart.body") && hasArt("kart.wheel");
}

/** The wheel model placed on a hub: scaled, mirrored for the right-hand side (its outer face then looks toward -x), centred on `at`. */
function placed(wheel: BufferGeometry, side: 1 | -1, scale: number, at: readonly [number, number, number]): BufferGeometry {
  const m = new Matrix4().makeTranslation(at[0], at[1], at[2]);
  if (side < 0) m.multiply(new Matrix4().makeRotationY(Math.PI));
  m.multiply(new Matrix4().makeScale(scale, scale, scale));
  return mergeBaked([{ geometry: wheel, matrix: m }]);
}

/** The Blender kart for `racer`, or null when its art is not loaded. */
export function createArtKart(racer: Pick<RacerSetup, "id" | "colour" | "character" | "golden">, kit: ArtKit, get: (name: string) => Object3D | null = artNode): KartModel | null {
  const golden = racer.golden === true;
  // The body is the weight class's (light, middle or heavy); a file without it gives the one `kart.body`.
  const weight = bodyClass(racer.character);
  const body = (weight !== "middle" && baseOf(`kart.body.${weight}`, "body", golden, get)) || baseOf("kart.body", "body", golden, get);
  const wheel = (weight !== "middle" && baseOf(`kart.wheel.${weight}`, "wheel", golden, get)) || baseOf("kart.wheel", "wheel", golden, get);
  if (!body || !wheel) return null;
  const steering = baseOf("kart.steering", "steering", golden, get);
  const accent = rgb(racer.colour);
  const want = liveryOf(racer.character);
  // The second colour: the driver's own, kept off the golden kart (gold and cream) and off paint it would vanish into.
  const second: Rgb = golden ? [0.98, 0.93, 0.78] : liveryColour(accent, want.colour);
  const livery = baseOf(liveryNode(weight, want.pattern), "body", golden, get);
  const material = kartMaterial();

  // ── The racer's geometry: the buffers are shared, the colours are theirs ──
  const racerBody = forRacer(body, accent, second);
  const liveryGeo = livery ? forRacer(livery, accent, second) : null;
  const plateGeo = kit.plate(racer.id, accent);
  const extrasGeo = kit.extras?.(accent, golden, weight) ?? null;
  const bodyGeo = mergeBaked([
    { geometry: racerBody, matrix: new Matrix4() },
    { geometry: plateGeo, matrix: new Matrix4() },
    ...(liveryGeo ? [{ geometry: liveryGeo, matrix: new Matrix4() }] : []),
    ...(extrasGeo ? [{ geometry: extrasGeo, matrix: new Matrix4() }] : []),
  ]);
  racerBody.dispose();
  liveryGeo?.dispose();
  plateGeo.dispose();
  extrasGeo?.dispose();
  const brake = brakeLights(body);
  const wheelGeo = forRacer(wheel, accent);
  // The front wheels turn about their hubs: each is its own mesh, drawn about its hub. The rear pair is one mesh on the rear axle.
  const frontGeo = [placed(wheelGeo, -1, FRONT_SCALE, [0, 0, 0]), placed(wheelGeo, 1, FRONT_SCALE, [0, 0, 0])];
  const rearGeo = mergeBaked([
    { geometry: placed(wheelGeo, -1, 1, [-WHEEL_REAR.x, 0, 0]), matrix: new Matrix4() },
    { geometry: placed(wheelGeo, 1, 1, [WHEEL_REAR.x, 0, 0]), matrix: new Matrix4() },
  ]);
  const steeringGeo = steering ? forRacer(steering, accent) : null;
  const flameGeo = kit.flame();

  // ── The near kart ──
  const root = new Group();
  const near = new Group();
  const bodyGroup = new Group();
  near.add(bodyGroup);
  const chassis = new Mesh(bodyGeo, material);
  chassis.castShadow = true;
  chassis.receiveShadow = true;
  withStudioFallback(chassis);
  bodyGroup.add(chassis);

  const driver = kit.driver();
  bodyGroup.add(driver.root);

  const wheelPivot = new Group();
  wheelPivot.position.set(...STEERING.at);
  wheelPivot.rotation.x = STEERING.tilt;
  let wheelRim: Mesh | null = null;
  if (steeringGeo) {
    wheelRim = new Mesh(steeringGeo, material);
    wheelRim.castShadow = true;
    wheelPivot.add(wheelRim);
  }
  bodyGroup.add(wheelPivot);

  if (brake) bodyGroup.add(brake.mesh);

  const flames: Mesh[] = [];
  for (const sx of [-1, 1]) {
    const f = new Mesh(flameGeo, kit.flameMaterial);
    f.position.set(sx * KART_EXHAUST.right, KART_EXHAUST.y, KART_EXHAUST.forward + 0.02);
    f.visible = false;
    f.renderOrder = 12;
    bodyGroup.add(f);
    flames.push(f);
  }

  const fronts: { pivot: Group; mesh: Mesh }[] = [];
  for (const [i, sx] of ([-1, 1] as const).entries()) {
    const pivot = new Group();
    pivot.position.set(sx * WHEEL_FRONT.x, WHEEL_FRONT.y, WHEEL_FRONT.z);
    const mesh = new Mesh(frontGeo[i]!, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    pivot.add(mesh);
    near.add(pivot);
    fronts.push({ pivot, mesh });
  }
  const rearMesh = new Mesh(rearGeo, material);
  rearMesh.position.set(0, WHEEL_REAR.y, WHEEL_REAR.z);
  rearMesh.castShadow = true;
  rearMesh.receiveShadow = true;
  near.add(rearMesh);

  // ── The far kart: everything welded, driver at rest ──
  let farGeo: BufferGeometry;
  {
    const parts: { geometry: BufferGeometry; matrix: Matrix4 }[] = [{ geometry: bodyGeo, matrix: new Matrix4() }];
    parts.push({ geometry: rearGeo, matrix: new Matrix4().makeTranslation(0, WHEEL_REAR.y, WHEEL_REAR.z) });
    for (const [i, sx] of ([-1, 1] as const).entries()) parts.push({ geometry: frontGeo[i]!, matrix: new Matrix4().makeTranslation(sx * WHEEL_FRONT.x, WHEEL_FRONT.y, WHEEL_FRONT.z) });
    const d = kit.driver();
    d.update({ time: 0, steer: 0, lean: 0, twirl: 0 });
    const driverFar = d.bake();
    d.dispose();
    parts.push({ geometry: driverFar, matrix: new Matrix4() });
    farGeo = mergeBaked(parts);
    driverFar.dispose();
  }
  wheelGeo.dispose();
  const farRoot = new Group();
  const farBody = new Group();
  const farMesh = new Mesh(farGeo, material);
  farMesh.castShadow = true;
  withStudioFallback(farMesh);
  farBody.add(farMesh);
  farRoot.add(farBody);

  const lod = new LOD();
  lod.addLevel(near, 0);
  lod.addLevel(farRoot, FAR_DISTANCE, 0.1);
  root.add(lod);

  return {
    root,
    pose(p) {
      const squash = p.squash ?? 0;
      bodyGroup.position.y = p.hop + p.shake - squash * 0.07;
      bodyGroup.rotation.set(-p.pitch, p.slide, p.roll, "YXZ");
      bodyGroup.scale.set(1 + squash * 0.035, 1 - squash * 0.06, 1 + squash * 0.035);
      farBody.position.y = bodyGroup.position.y;
      farBody.rotation.copy(bodyGroup.rotation);
      driver.update({ time: p.time ?? 0, steer: p.steer, lean: p.lean, twirl: p.twirl ?? 0, emote: p.emote, finished: p.finished, dizzy: p.dizzy, lookBack: p.lookBack, rest: p.rest, shut: p.shut });
      brake?.show(p.brake ?? 0);
      if (wheelRim) wheelRim.rotation.z = -p.steer * STEERING.turn;
      for (const f of fronts) {
        f.pivot.rotation.y = -p.steer * 0.5;
        f.mesh.rotation.x = p.wheelSpin;
        f.pivot.scale.y = 1 - squash * 0.02;
      }
      rearMesh.rotation.x = p.wheelSpin;
      const on = p.flame > 0.02;
      for (const f of flames) {
        f.visible = on;
        if (on) {
          const s = p.flame * (0.8 + 0.5 * p.flicker);
          f.scale.set(0.8 + 0.3 * p.flicker, 0.8 + 0.3 * p.flicker, 0.5 + s * 1.5);
        }
      }
    },
    dispose() {
      for (const g of [bodyGeo, ...frontGeo, rearGeo, steeringGeo, flameGeo, farGeo, brake?.mesh.geometry]) g?.dispose();
      driver.dispose();
    },
  };
}
