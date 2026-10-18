import { BufferAttribute, BufferGeometry, Group, Mesh, MeshBasicMaterial } from "three";
import { describe, expect, it } from "vitest";
import { buildPlaceholderRoad } from "../placeholder/road";
import { readRoad } from "./road";
import { vertexLayers } from "./stage";

describe("the corn's baked layers", () => {
  it("arrive under glTF's underscored names and are read under the material's own", () => {
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(new Float32Array(9), 3));
    g.setAttribute("_albedo", new BufferAttribute(new Float32Array([0.1, 0.2, 0.3, 0.1, 0.2, 0.3, 0.1, 0.2, 0.3]), 3));
    g.setAttribute("_flicker", new BufferAttribute(new Float32Array([0.5, 0.25, 0]), 1));
    g.setAttribute("_sway", new BufferAttribute(new Float32Array([0, 0.5, 1]), 1));
    vertexLayers(new Mesh(g, new MeshBasicMaterial()));
    expect(g.getAttribute("albedo").getX(0)).toBeCloseTo(0.1, 6);
    expect(g.getAttribute("street").getX(1)).toBe(0.25);
    expect(g.getAttribute("sway").getX(2)).toBe(1);
    expect(g.hasAttribute("_albedo")).toBe(false);
  });

  it("stand in as no albedo and no lamp where a file leaves them out", () => {
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(new Float32Array(9), 3));
    vertexLayers(new Mesh(g, new MeshBasicMaterial()));
    expect(g.getAttribute("albedo").count).toBe(3);
    expect(g.getAttribute("street").getX(0)).toBe(0);
  });
});

describe("the streetlight's masks", () => {
  // Building the whole placeholder road takes seconds on a busy machine: more than a test's usual five.
  it("are scaled back up by what the export divided them by", () => {
    const root = buildPlaceholderRoad();
    expect(readRoad(root).flickerScale).toBe(1);
    const scaled = new Group();
    scaled.add(...root.children.slice());
    scaled.userData["flicker_scale"] = 8.25;
    expect(readRoad(scaled).flickerScale).toBe(8.25);
  }, 60_000);
});
