import { beforeEach, describe, expect, it } from "vitest";
import { BoxGeometry, Float32BufferAttribute, Group, Mesh, MeshStandardMaterial, Object3D } from "three";
import { createDriver } from "./drivers";
import { CHARACTERS } from "../characters";
import { BOT_COLOURS, PLAYER_COLOURS } from "../contract";
import { cluster } from "./farLod";
import { createArtKart, bakeArt, forRacer, resetArtKart, type ArtKit } from "./kartArt";
import { liveryColour, liveryNode } from "./livery";
import { MeshBuilder, rgb } from "./kartBuilder";
import { SURF, kartMaterial } from "./kartMaterial";
import { KART_HALF_WIDTH, KART_EXHAUST, WHEEL_FRONT, WHEEL_REAR } from "./kartSpec";
import type { KartPose } from "./kart";

// ── The art's contract, read from the file itself (art/kart/karts/build.py wrote it) ──

interface Gltf {
  nodes: { name?: string; mesh?: number; translation?: number[]; rotation?: number[]; scale?: number[]; matrix?: number[] }[];
  meshes: { name?: string; primitives: { attributes: { POSITION: number }; indices?: number; material?: number }[] }[];
  materials: { name: string }[];
  accessors: { count: number; min?: number[]; max?: number[] }[];
}

async function readGlb(): Promise<{ json: Gltf; bytes: number }> {
  const fs = (await import("node:fs" as string)) as { readFileSync(path: string): Uint8Array };
  const url = (await import("node:url" as string)) as { fileURLToPath(url: string): string };
  const file = url.fileURLToPath(new URL("../../../public/assets/kart/karts.glb", import.meta.url).href);
  const data = fs.readFileSync(file);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  expect(view.getUint32(0, true)).toBe(0x46546c67); // "glTF"
  const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(data.subarray(20, 20 + jsonLength))) as Gltf;
  return { json, bytes: data.byteLength };
}

function nodeStats(json: Gltf, name: string): { tris: number; min: number[]; max: number[]; materials: string[] } {
  const node = json.nodes.find((n) => n.name === name);
  expect(node, `the node ${name}`).toBeDefined();
  // The pieces sit at the kart's own origin: no transform on the node (so its mesh bounds are its bounds).
  expect(node!.translation ?? node!.rotation ?? node!.scale ?? node!.matrix, `${name} has no transform`).toBeUndefined();
  const mesh = json.meshes[node!.mesh!]!;
  let tris = 0;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const materials = new Set<string>();
  for (const p of mesh.primitives) {
    tris += json.accessors[p.indices!]!.count / 3;
    const pos = json.accessors[p.attributes.POSITION]!;
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i]!, pos.min![i]!);
      max[i] = Math.max(max[i]!, pos.max![i]!);
    }
    materials.add(json.materials[p.material!]!.name);
  }
  return { tris, min, max, materials: [...materials] };
}

describe("the Blender kart's file (public/assets/kart/karts.glb)", () => {
  it("holds a body for each weight class, a wheel for each, the steering wheel and every driver's livery, in the contract's budget", async () => {
    const { json, bytes } = await readGlb();
    const steering = nodeStats(json, "kart.steering");
    for (const [body, wheel] of [["kart.body", "kart.wheel"], ["kart.body.light", "kart.wheel.light"], ["kart.body.heavy", "kart.wheel.heavy"]] as const) {
      const b = nodeStats(json, body);
      const w = nodeStats(json, wheel);
      // One kart on screen is one body, one wheel (drawn four times) and the steering wheel.
      expect(b.tris, body).toBeLessThanOrEqual(9500);
      expect(b.tris + w.tris + steering.tris, body).toBeLessThanOrEqual(14000);
      expect(b.materials).toContain("paint");
      expect(b.materials).toContain("tail");
    }
    // The middle one is also named for its class.
    expect(json.nodes.find((n) => n.name === "kart.body.middle")).toBeDefined();
    expect(bytes).toBeLessThanOrEqual(1_000_000);
    const known = new Set(["paint", "trim", "livery", "stripe", "chrome", "rim", "steel", "rubber", "tread", "plastic", "seat", "lamp", "tail", "glass"]);
    for (const m of json.materials) expect(known.has(m.name), `material ${m.name}`).toBe(true);
    // Every driver's pattern exists on every class's body, and is small (it is welded into the body of the kart).
    for (const c of CHARACTERS) {
      for (const weight of ["light", "middle", "heavy"] as const) {
        const l = nodeStats(json, liveryNode(weight, c.livery.pattern));
        expect(l.materials).toEqual(["livery"]);
        expect(l.tris).toBeLessThanOrEqual(1300);
      }
    }
  });

  it("gives the three weight classes bodies of their own: the buggy narrow, the muscle kart wide with its fenders", async () => {
    const { json } = await readGlb();
    const light = nodeStats(json, "kart.body.light");
    const middle = nodeStats(json, "kart.body");
    const heavy = nodeStats(json, "kart.body.heavy");
    expect(light.max[0]! - light.min[0]!).toBeLessThan(middle.max[0]! - middle.min[0]! - 0.05);
    expect(heavy.max[0]! - heavy.min[0]!).toBeGreaterThan(middle.max[0]! + 0.3);
    // Wide, but no wider than the widest tyre the collisions know.
    expect(heavy.max[0]).toBeLessThanOrEqual(KART_HALF_WIDTH + 0.02);
    // All three keep the tailpipes where the flames come out.
    for (const b of [light, middle, heavy]) expect(b.min[2]).toBeLessThan(KART_EXHAUST.forward);
  });

  it("is the code-built kart's size, so the wheels, the driver and the collisions still line up", async () => {
    const { json } = await readGlb();
    const body = nodeStats(json, "kart.body");
    // Metres, y up, facing +z, resting on y = 0.2 (the tub's belly) and no wider than its sides and the chrome U round the nose.
    expect(body.min[0]).toBeGreaterThan(-0.85);
    expect(body.max[0]).toBeLessThan(0.85);
    for (const name of ["kart.body.light", "kart.body.heavy"]) {
      const b = nodeStats(json, name);
      expect(b.min[1], name).toBeGreaterThan(0.1);
      expect(b.max[1], name).toBeLessThan(2.4);
      expect(b.min[2], name).toBeGreaterThan(-1.75);
      expect(b.max[2], name).toBeLessThan(1.95);
    }
    expect(body.min[1]).toBeGreaterThan(0.1);
    expect(body.max[1]).toBeLessThan(1.6);
    expect(body.min[2]).toBeGreaterThan(-1.75);
    expect(body.max[2]).toBeLessThan(1.95);
    // The tailpipes' mouths where the flames and the smoke come out.
    expect(body.min[2]).toBeLessThan(KART_EXHAUST.forward);

    const wheel = nodeStats(json, "kart.wheel");
    // One wheel, its origin at the hub: as tall as a rear tyre, its outer face out to +x (not past the kart's widest point).
    expect(wheel.max[1]).toBeCloseTo(WHEEL_REAR.r, 1);
    expect(wheel.min[1]).toBeCloseTo(-WHEEL_REAR.r, 1);
    expect(wheel.max[2]).toBeCloseTo(WHEEL_REAR.r, 1);
    expect(wheel.max[0]).toBeLessThanOrEqual(KART_HALF_WIDTH - WHEEL_REAR.x + 0.01);
    expect(wheel.max[0]).toBeGreaterThan(WHEEL_REAR.w / 2 - 0.03);
    expect(wheel.min[0]).toBeLessThan(-0.1);

    const steering = nodeStats(json, "kart.steering");
    expect(steering.max[0]).toBeLessThan(0.25);
    expect(steering.min[0]).toBeGreaterThan(-0.25);
  });
});

// ── What the game makes of it, tried on a small stand-in for the art ──

function art(): Map<string, Object3D> {
  const box = (name: string, colour: number, ao: number, extra?: (m: MeshStandardMaterial) => void): Mesh => {
    const g = new BoxGeometry(1, 1, 1);
    const n = g.getAttribute("position").count;
    g.setAttribute("color", new Float32BufferAttribute(new Float32Array(n * 3).fill(ao), 3));
    const m = new MeshStandardMaterial({ name, color: colour });
    extra?.(m);
    return new Mesh(g, m);
  };
  const body = new Group();
  body.add(box("paint", 0xffffff, 0.5), box("chrome", 0xffffff, 1), box("lamp", 0xffffff, 1, (m) => { m.emissive.setRGB(1, 0.9, 0.5); m.emissiveIntensity = 2; }), box("stripe", 0xffffff, 1), box("trim", 0xffffff, 1));
  const wheel = new Group();
  wheel.add(box("rubber", 0x222222, 1), box("paint", 0xffffff, 1), box("rim", 0xffffff, 1));
  const steering = box("plastic", 0x222222, 1);
  return new Map<string, Object3D>([
    ["kart.body", body],
    ["kart.wheel", wheel],
    ["kart.steering", steering],
  ]);
}

function stub(): MeshBuilder {
  const b = new MeshBuilder();
  b.as(SURF.plastic, () => b.box(0, 0, 0, 0.1, 0.1, 0.1, [1, 1, 1]));
  return b;
}

const kit: ArtKit = {
  flame: () => stub().build(),
  flameMaterial: kartMaterial(),
  plate: () => stub().build(),
  driver: () => createDriver("fox", "#ff453a", [0, 0.9, -0.28], kartMaterial()),
};

const pose = (over: Partial<KartPose> = {}): KartPose => ({ steer: 0, wheelSpin: 0, lean: 0, roll: 0, pitch: 0, hop: 0, shake: 0, flame: 0, flicker: 0, slide: 0, time: 0, ...over });

function colourAt(g: { getAttribute(name: string): { getX(i: number): number; getY(i: number): number; getZ(i: number): number } }, i: number): number[] {
  const c = g.getAttribute("color");
  return [c.getX(i), c.getY(i), c.getZ(i)];
}

describe("the Blender kart as the game draws it", () => {
  beforeEach(() => resetArtKart());

  it("reads the glTF materials by name into kart surfaces, and marks the paint for the racer's colour", () => {
    const base = bakeArt(art().get("kart.body")!, "body", false);
    const count = base.tint.length;
    expect(count).toBe(5 * 24);
    // The first box is the paint: tinted, glossy, shaded by the baked occlusion (0.5).
    expect(base.tint[0]).toBe(1);
    expect(colourAt(base.geometry, 0)).toEqual([0.5, 0.5, 0.5]);
    expect([...base.geometry.getAttribute("aSurf").array.slice(0, 4)]).toEqual([...SURF.paint].map((v) => Math.fround(v)));
    // The chrome is not tinted.
    expect(base.tint[24]).toBe(0);
    expect(base.geometry.getAttribute("aSurf").getX(24)).toBe(SURF.chrome[0]);
    // A lamp shines: its emissive colour times its strength, over-bright, with the glow surface.
    const lamp = 48;
    expect(base.tint[lamp]).toBe(0);
    expect(colourAt(base.geometry, lamp)[0]).toBeCloseTo(2, 5);
    expect(colourAt(base.geometry, lamp)[2]).toBeCloseTo(1, 5);
    expect(base.geometry.getAttribute("aSurf").getW(lamp)).toBe(1);
  });

  it("multiplies the racer's colour into the tinted vertices only, sharing the other buffers", () => {
    const base = bakeArt(art().get("kart.body")!, "body", false);
    const red = rgb("#ff0000");
    const g = forRacer(base, red);
    expect(colourAt(g, 0)).toEqual([0.5 * red[0], 0.5 * red[1], 0.5 * red[2]]);
    expect(colourAt(g, 24)).toEqual([1, 1, 1]);
    expect(g.getAttribute("position")).toBe(base.geometry.getAttribute("position"));
    expect(g.getAttribute("color")).not.toBe(base.geometry.getAttribute("color"));
  });

  it("makes the golden kart's paint and trim gold, and its racing stripe the racer's colour; its wheels' rims are gold too, their painted caps the racer's", () => {
    const gold = bakeArt(art().get("kart.body")!, "body", true);
    expect(gold.tint[0]).toBe(0); // the paint is gold, not the racer's
    expect(gold.geometry.getAttribute("aSurf").getX(0)).toBeCloseTo(SURF.gold[0], 5);
    expect(colourAt(gold.geometry, 0)[0]).toBeGreaterThan(colourAt(gold.geometry, 0)[2]!);
    const stripe = 72;
    expect(gold.tint[stripe]).toBe(1);
    const wheel = bakeArt(art().get("kart.wheel")!, "wheel", true);
    expect(wheel.tint[24]).toBe(1); // the wheel's painted cap stays the racer's
    expect(wheel.geometry.getAttribute("aSurf").getX(48)).toBeCloseTo(SURF.gold[0], 5); // the rim is gold
  });

  it("tints a livery with the driver's second colour, and swaps one that would vanish into the paint for a light or a dark", () => {
    const livery = new Group();
    livery.add(
      (() => {
        const m = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial({ name: "livery", color: 0xffffff }));
        const n = m.geometry.getAttribute("position").count;
        m.geometry.setAttribute("color", new Float32BufferAttribute(new Float32Array(n * 3).fill(1), 3));
        return m;
      })(),
    );
    const base = bakeArt(livery, "body", false);
    expect(base.tint[0]).toBe(2);
    const second = rgb("#00ff00");
    const g = forRacer(base, rgb("#ff0000"), second);
    expect(colourAt(g, 0)).toEqual([...second]);
    // Cream on a yellow kart reads as nothing: the pattern goes dark. On a dark kart it goes light.
    const yellow = rgb("#ffd60a");
    const onYellow = liveryColour(yellow, "#fff1dc");
    expect(onYellow[0] + onYellow[1] + onYellow[2]).toBeLessThan(0.6);
    const navy = rgb("#0a1a4a");
    const onNavy = liveryColour(navy, "#101a40");
    expect(onNavy[0] + onNavy[1] + onNavy[2]).toBeGreaterThan(2.5);
    // A colour that already reads is kept.
    expect(liveryColour(rgb("#0a84ff"), "#ffb347")).toEqual(rgb("#ffb347"));
  });

  it("picks the body by the driver's weight class, and the driver's own pattern", () => {
    const nodes = art();
    for (const name of ["kart.body.light", "kart.body.heavy", "kart.wheel.light", "kart.wheel.heavy"]) nodes.set(name, nodes.get(name.startsWith("kart.body") ? "kart.body" : "kart.wheel")!.clone(true));
    const asked: string[] = [];
    const get = (n: string): Object3D | null => {
      asked.push(n);
      return nodes.get(n)?.clone(true) ?? null;
    };
    for (const [character, body, wheel, pattern] of [
      ["bun", "kart.body.light", "kart.wheel.light", "kart.livery.light.spots"],
      ["kit", "kart.body", "kart.wheel", "kart.livery.middle.flames"],
      ["bramble", "kart.body.heavy", "kart.wheel.heavy", "kart.livery.heavy.chevrons"],
    ] as const) {
      resetArtKart();
      asked.length = 0;
      expect(createArtKart({ id: 1, colour: "#30D158", character }, kit, get)).not.toBeNull();
      expect(asked, character).toContain(body);
      expect(asked, character).toContain(wheel);
      expect(asked, character).toContain(pattern);
    }
  });

  it("falls back to the one kart.body when the file has no bodies by class", () => {
    const nodes = art();
    resetArtKart();
    expect(createArtKart({ id: 1, colour: "#30D158", character: "bramble" }, kit, (n) => nodes.get(n)?.clone(true) ?? null)).not.toBeNull();
  });

  it("keeps every driver's pattern readable on every racer colour (a luma gap, or colours far apart, after the swap)", () => {
    const luma = (c: readonly number[]): number => 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
    let worst = Infinity;
    for (const paint of [...PLAYER_COLOURS, ...BOT_COLOURS]) {
      for (const c of CHARACTERS) {
        const accent = rgb(paint);
        const got = liveryColour(accent, c.livery.colour);
        const diff = Math.abs(luma(got) - luma(accent));
        const apart = Math.hypot(got[0] - accent[0], got[1] - accent[1], got[2] - accent[2]);
        expect(diff > 0.2 || apart >= 1, `${c.id} on ${paint}`).toBe(true);
        worst = Math.min(worst, diff);
      }
    }
    expect(worst).toBeGreaterThanOrEqual(0);
  });

  it("keeps the kart's own wheel when the file has a light body but no light wheel", () => {
    const nodes = art();
    nodes.set("kart.body.light", nodes.get("kart.body")!.clone(true));
    resetArtKart();
    const model = createArtKart({ id: 1, colour: "#30D158", character: "bun" }, kit, (n) => nodes.get(n)?.clone(true) ?? null);
    expect(model).not.toBeNull();
  });

  it("thins the far kart on a grid: fewer triangles, the same surfaces and bounds", () => {
    const b = new MeshBuilder();
    b.as(SURF.paint, () => b.blob(0, 0, 0, 1, 0.5, 2, [1, 0, 0], 3));
    b.as(SURF.chrome, () => b.blob(0, 1, 0, 0.3, 0.3, 0.3, [1, 1, 1], 3));
    const full = b.build();
    const thin = cluster(full, 0.4);
    expect(thin.index!.count).toBeLessThan(full.index!.count / 2);
    expect(thin.index!.count).toBeGreaterThan(30);
    const surfs = new Set<number>();
    for (let i = 0; i < thin.getAttribute("aSurf").count; i++) surfs.add(Math.round(thin.getAttribute("aSurf").getX(i) * 100));
    expect(surfs.size).toBe(2);
    thin.computeBoundingBox();
    expect(thin.boundingBox!.max.z).toBeGreaterThan(1.5);
    expect(thin.boundingBox!.max.z).toBeLessThanOrEqual(2.01);
  });

  it("never gives the far kart a zero normal, even where faces turned opposite ways share a cell (a NaN pixel the glow spreads into a black block)", () => {
    // A thin plate: its top and its underside on the same four corners, one surface.
    const corners = [-0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 0, 0.5, -0.5, 0, 0.5];
    const position = [...corners, ...corners];
    const normal = [...Array(4).fill([0, 1, 0]).flat(), ...Array(4).fill([0, -1, 0]).flat()];
    const plate = new BoxGeometry().toNonIndexed();
    plate.deleteAttribute("uv");
    plate.setAttribute("position", new Float32BufferAttribute(position, 3));
    plate.setAttribute("normal", new Float32BufferAttribute(normal, 3));
    plate.setAttribute("color", new Float32BufferAttribute(new Array(24).fill(1), 3));
    plate.setAttribute("aSurf", new Float32BufferAttribute(new Array(32).fill(0.5), 4));
    plate.setIndex([0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6]);
    const unit = (g: ReturnType<typeof cluster>) => {
      const n = g.getAttribute("normal");
      for (let i = 0; i < n.count; i++) expect(Math.hypot(n.getX(i), n.getY(i), n.getZ(i)), `normal ${i}`).toBeCloseTo(1, 3);
    };
    unit(cluster(plate, 0.2));
    // And every driver's real far kart, from the karts file.
    const nodes = art();
    for (const c of CHARACTERS) {
      resetArtKart();
      const model = createArtKart({ id: 2, colour: "#30D158", character: c.id }, kit, (n) => nodes.get(n)?.clone(true) ?? null);
      const lod = model!.root.children[0] as unknown as { levels: { object: Object3D }[] };
      lod.levels[1]!.object.traverse((o) => {
        if ((o as Mesh).isMesh) unit((o as Mesh).geometry as ReturnType<typeof cluster>);
      });
      model!.dispose();
    }
  });

  it("builds a model that the actor can pose: wheels spin, the front pair steers, the steering wheel turns, a far version takes over", () => {
    const nodes = art();
    const model = createArtKart({ id: 3, colour: "#30D158", character: "fox" }, kit, (n) => nodes.get(n)?.clone(true) ?? null);
    expect(model).not.toBeNull();
    const kart = model!;
    kart.pose(pose({ steer: 1, wheelSpin: 2.5, flame: 1, flicker: 0.5, squash: 0.5 }));
    kart.root.updateMatrixWorld(true);
    const moved: Object3D[] = [];
    kart.root.traverse((o) => {
      if (o.matrixWorld.elements.some((e) => !Number.isFinite(e))) throw new Error("a non-finite transform");
      moved.push(o);
    });
    // The front wheels sit at their hubs and turn into the bend; the rear pair spins about the rear axle.
    const at = (x: number, y: number, z: number) => moved.find((o) => Math.abs(o.position.x - x) < 1e-6 && Math.abs(o.position.y - y) < 1e-6 && Math.abs(o.position.z - z) < 1e-6);
    for (const sx of [-1, 1]) {
      const pivot = at(sx * WHEEL_FRONT.x, WHEEL_FRONT.y, WHEEL_FRONT.z);
      expect(pivot, "a front hub").toBeDefined();
      expect(pivot!.rotation.y).toBeCloseTo(-0.5, 5);
      expect((pivot!.children[0] as Mesh).rotation.x).toBeCloseTo(2.5, 5);
    }
    expect(at(0, WHEEL_REAR.y, WHEEL_REAR.z)!.rotation.x).toBeCloseTo(2.5, 5);
    // Flames burn at the pipes.
    expect(at(KART_EXHAUST.right, KART_EXHAUST.y, KART_EXHAUST.forward + 0.02)!.visible).toBe(true);
    kart.pose(pose({ flame: 0 }));
    expect(at(KART_EXHAUST.right, KART_EXHAUST.y, KART_EXHAUST.forward + 0.02)!.visible).toBe(false);
    // Near and far versions of the kart, the far one from the renderer's distance (the tier's, or the load governor's step), held near for Big Heads.
    const lod = kart.root.children[0] as unknown as { levels: { distance: number }[]; userData: { far?: number } };
    expect(lod.levels).toHaveLength(2);
    kart.pose(pose({}));
    expect(lod.levels[1]!.distance).toBe(34);
    lod.userData.far = 20;
    kart.pose(pose({}));
    expect(lod.levels[1]!.distance).toBe(20);
    kart.pose(pose({ headScale: 1.8 }));
    expect(lod.levels[1]!.distance).toBe(Infinity);
    kart.pose(pose({}));
    expect(lod.levels[1]!.distance).toBe(20);
    expect(() => kart.dispose()).not.toThrow();
  });

  it("is a different kart for the golden racer, and none at all (the code-built one) without art", () => {
    const nodes = art();
    const get = (n: string): Object3D | null => nodes.get(n)?.clone(true) ?? null;
    expect(createArtKart({ id: 0, colour: "#ff0000", golden: true }, kit, get)).not.toBeNull();
    resetArtKart();
    expect(createArtKart({ id: 0, colour: "#ff0000" }, kit, () => null)).toBeNull();
  });
});
