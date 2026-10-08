/**
 * The modelled drivers (public/assets/kart/drivers.glb, built by art/kart/drivers/): the file keeps its contract
 * (every species, every part the rig turns, pivots where the rig puts them, under the budgets), and the rig
 * assembles a driver from it (fromArt.ts) in the kart's colour.
 */
import { describe, expect, it, vi } from "vitest";
import { BufferGeometry, Float32BufferAttribute, Mesh, MeshBasicMaterial, type Object3D } from "three";
import { CHARACTERS } from "../../characters";
import { buildFox } from "./fox";
import { ART_BITS, driverFromArt, hasDriverArt } from "./fromArt";
import { createDriver } from "./index";
import { look } from "./parts";

const nodes = vi.hoisted(() => new Map<string, Object3D>());
vi.mock("../art", () => ({
  artNode: (name: string) => nodes.get(name)?.clone(true) ?? null,
  hasArt: (name: string) => nodes.has(name),
}));

interface Glb {
  nodes: { name?: string; mesh?: number; translation?: number[]; rotation?: number[]; scale?: number[] }[];
  meshes: { primitives: { indices?: number; material?: number }[] }[];
  accessors: { count: number }[];
  materials: { name?: string }[];
}

interface Files {
  readFileSync(path: string): { length: number; readUInt32LE(offset: number): number; subarray(from: number, to: number): { toString(encoding: string): string } };
}
const fs = (await import("node:fs" as string)) as Files;

function readGlb(path: string): { json: Glb; bytes: number } {
  const file = fs.readFileSync(path);
  const length = file.readUInt32LE(12);
  return { json: JSON.parse(file.subarray(20, 20 + length).toString("utf8")) as Glb, bytes: file.length };
}

const MATERIALS = ["fur", "cloth", "trim", "plastic", "steel", "gloss", "glass", "lamp", "glow", "paint", "paintcloth", "vest"];
const species = [...new Set(CHARACTERS.map((c) => c.species))];

describe("drivers.glb", () => {
  const { json, bytes } = readGlb(new URL("../../../../public/assets/kart/drivers.glb", import.meta.url).pathname);
  const named = (name: string) => json.nodes.find((n) => n.name === name);

  it("is small", () => {
    expect(bytes).toBeLessThan(1.5 * 1024 * 1024);
  });

  for (const sp of species) {
    it(`${sp}: has the parts the rig turns, their pivots at the joints, under 5k triangles, in materials the game knows`, () => {
      for (const part of ["head", "torso", "arm.L", "arm.R", "helmet", ...ART_BITS[sp]]) expect(named(`driver.${sp}.${part}`), `${sp}.${part}`).toBeDefined();
      // The head turns at its centre, the arms at the shoulders (the left one, +x, and its mirror).
      const head = named(`driver.${sp}.head`)!.translation!;
      expect(head[1]).toBeGreaterThan(0.8);
      expect(head[1]).toBeLessThan(0.92);
      const left = named(`driver.${sp}.arm.L`)!.translation!;
      const right = named(`driver.${sp}.arm.R`)!.translation!;
      expect(left[0]).toBeGreaterThan(0.2);
      expect(right[0]).toBeCloseTo(-left[0]!, 5);
      expect(left[1]).toBeCloseTo(0.46, 3);
      expect(right[1]).toBeCloseTo(0.46, 3);
      // Nodes are placed by translation alone: no turn or scale to undo.
      for (const n of json.nodes.filter((n) => n.name?.startsWith(`driver.${sp}.`))) {
        expect(n.rotation ?? [0, 0, 0, 1]).toEqual([0, 0, 0, 1]);
        expect(n.scale ?? [1, 1, 1]).toEqual([1, 1, 1]);
      }
      let triangles = 0;
      for (const n of json.nodes.filter((n) => n.name?.startsWith(`driver.${sp}.`) && n.mesh !== undefined)) {
        for (const p of json.meshes[n.mesh!]!.primitives) {
          triangles += json.accessors[p.indices!]!.count / 3;
          expect(MATERIALS).toContain(json.materials[p.material!]!.name);
        }
      }
      expect(triangles).toBeGreaterThan(2500);
      expect(triangles).toBeLessThanOrEqual(5000);
    });
  }
});

/** A one-triangle stand-in for a part: three vertices of `grey`, in the named material. */
function fake(name: string, material: string, at: [number, number, number], grey = 0.5): Object3D {
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute([0, 0, 0, 0.1, 0, 0, 0, 0.1, 0], 3));
  g.setAttribute("normal", new Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  g.setAttribute("color", new Float32BufferAttribute(new Array(9).fill(grey), 3));
  const m = new Mesh(g, Object.assign(new MeshBasicMaterial(), { name: material }));
  m.userData["name"] = name;
  m.position.set(...at);
  return m;
}

describe("a driver from the art", () => {
  it("is the stand-in until every part is there, then assembles from the art in the kart's colour", () => {
    nodes.clear();
    expect(hasDriverArt("fox")).toBe(false);
    expect(createDriver("fox", "#FF0000").root.children.length).toBeGreaterThan(0);

    nodes.set("driver.fox.head", fake("driver.fox.head", "fur", [0, 0.84, 0.06]));
    nodes.set("driver.fox.helmet", fake("driver.fox.helmet", "paint", [0, 0.84, 0.06], 1));
    nodes.set("driver.fox.torso", fake("driver.fox.torso", "vest", [0, 0, 0], 1));
    nodes.set("driver.fox.arm.L", fake("driver.fox.arm.L", "fur", [0.3, 0.46, 0.02]));
    expect(hasDriverArt("fox")).toBe(false);
    nodes.set("driver.fox.arm.R", fake("driver.fox.arm.R", "glow", [-0.3, 0.46, 0.02], 0.1));
    nodes.set("driver.fox.tail", fake("driver.fox.tail", "lamp", [0, 0.2, -0.26], 1));
    expect(hasDriverArt("fox")).toBe(true);

    const l = look("#FF0000");
    const built = driverFromArt("fox", l, buildFox(l))!;
    expect(built).not.toBeNull();
    // The head and its helmet are one geometry (6 vertices), at the head's joint.
    expect(built.head.getAttribute("position").count).toBe(6);
    expect(built.headAt![1]).toBeCloseTo(0.84, 5);
    // Both arms, each where the file puts it; the right one is its own geometry.
    expect(built.shoulderAt![0]).toBeCloseTo(0.3, 5);
    expect(built.armR).toBeDefined();
    expect(built.armR).not.toBe(built.arm);
    // The tail is the art's, at its own pivot, keeping the stand-in's motion.
    expect(built.bits[0]!.at).toEqual([0, expect.closeTo(0.2, 5), expect.closeTo(-0.26, 5)]);
    expect(built.bits[0]!.move).toBeTypeOf("function");
    // Paint takes the kart's colour: full light is its bright shade.
    const color = built.head.getAttribute("color");
    expect(color.getX(3)).toBeCloseTo(l.top[0], 4);
    expect(color.getY(3)).toBeCloseTo(l.top[1], 4);
    // Lamps and glows are over-bright; every vertex carries its surface.
    expect(built.bits[0]!.geo.getAttribute("color").getX(0)).toBeGreaterThan(1.5);
    expect(built.armR!.getAttribute("color").getX(0)).toBeGreaterThan(0.5);
    expect(built.arm.getAttribute("aSurf").count).toBe(3);

    // The rig poses it like any other driver.
    const driver = createDriver("fox", "#FF0000");
    driver.update({ time: 0, steer: 0.5, lean: 0.2, twirl: 0 });
    driver.update({ time: 0.5, steer: 0, lean: 0, twirl: 0, emote: "cheer" });
    driver.root.updateMatrixWorld(true);
    expect(driver.root.matrixWorld.elements.every(Number.isFinite)).toBe(true);
    expect(driver.bake().getAttribute("position").count).toBeGreaterThan(0);
    driver.dispose();
    nodes.clear();
  });
});
