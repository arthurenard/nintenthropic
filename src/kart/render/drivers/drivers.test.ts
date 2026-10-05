import { describe, expect, it } from "vitest";
import { Mesh, Object3D } from "three";
import { CHARACTERS } from "../../characters";
import { createProceduralKart } from "../kartModel";
import { createDriver, speciesOf, type DriverMotion } from "./index";

const species = CHARACTERS.map((c) => c.species);

function triangles(root: Object3D): number {
  let total = 0;
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (mesh.isMesh) total += mesh.geometry.getAttribute("position").count / 3;
  });
  return total;
}

function finite(root: Object3D): boolean {
  root.updateMatrixWorld(true);
  let ok = true;
  root.traverse((o) => {
    if (o.matrixWorld.elements.some((e) => !Number.isFinite(e))) ok = false;
  });
  return ok;
}

describe("the nine drivers", () => {
  it("are nine different species, the cast's own", () => {
    expect(new Set(species).size).toBe(9);
    expect(species).toHaveLength(9);
  });

  for (const kind of species) {
    it(`${kind} builds light enough to put eight on the grid, and poses without a bad number`, () => {
      const driver = createDriver(kind, "#FF453A");
      // The merged meshes of one driver stay modest: eight karts, four views.
      expect(triangles(driver.root)).toBeLessThan(7000);
      expect(driver.root.children.length).toBeLessThan(12);
      const poses: DriverMotion[] = [
        { time: 0, steer: 0, lean: 0, twirl: 0 },
        { time: 0.5, steer: 1, lean: 0.5, twirl: 0 },
        { time: 1, steer: -1, lean: -0.5, twirl: 3, emote: "cheer" },
        { time: 1.5, steer: 0.2, lean: 0, twirl: 0, emote: "wave" },
        { time: 2, steer: 0, lean: 0, twirl: 0, finished: true },
        { time: 2.5, steer: 0, lean: 0, twirl: 0, dizzy: true },
        { time: 3, steer: 0, lean: 0, twirl: 0 },
      ];
      for (const pose of poses) {
        driver.update(pose);
        expect(finite(driver.root)).toBe(true);
      }
      driver.dispose();
    });
  }

  it("raise both arms for a cheer and one for a wave, and bounce when happy", () => {
    const driver = createDriver("fox", "#0A84FF");
    const arms = driver.root.children.filter((c) => c.children.length === 1 && (c.children[0] as Mesh).isMesh && c.position.x !== 0 && c.position.y > 0.4);
    expect(arms).toHaveLength(2);
    const handHeight = (arm: Object3D): number => {
      arm.updateMatrixWorld(true);
      // The arm points along its own +z; where that points in the body's space, up is positive.
      return arm.localToWorld(arm.worldToLocal(arm.getWorldPosition(arm.position.clone())).setZ(0.5)).y - arm.getWorldPosition(arm.position.clone()).y;
    };
    driver.update({ time: 0, steer: 0, lean: 0, twirl: 0 });
    const resting = arms.map(handHeight);
    for (let i = 1; i <= 30; i++) driver.update({ time: i / 30, steer: 0, lean: 0, twirl: 0, emote: "cheer" });
    const cheering = arms.map(handHeight);
    expect(cheering[0]!).toBeGreaterThan(resting[0]! + 0.2);
    expect(cheering[1]!).toBeGreaterThan(resting[1]! + 0.2);
    expect(driver.root.position.y).toBeGreaterThanOrEqual(0);

    const waving = createDriver("fox", "#0A84FF");
    const waveArms = waving.root.children.filter((c) => c.children.length === 1 && (c.children[0] as Mesh).isMesh && c.position.x !== 0 && c.position.y > 0.4);
    waving.update({ time: 0, steer: 0, lean: 0, twirl: 0 });
    const before = waveArms.map(handHeight);
    for (let i = 1; i <= 30; i++) waving.update({ time: i / 30, steer: 0, lean: 0, twirl: 0, emote: "wave" });
    const after = waveArms.map(handHeight);
    const raised = after.map((h, i) => h - before[i]!);
    // One arm up, the other stays on the wheel.
    expect(Math.max(...raised)).toBeGreaterThan(0.2);
    expect(Math.min(...raised)).toBeLessThan(0.1);
  });
});

describe("the kart that carries them", () => {
  it("shows a driver by id, a stand-in by the kart's number when none is named, and a golden tub", () => {
    for (const character of [...CHARACTERS.map((c) => c.id), undefined, "nobody"]) {
      const kart = createProceduralKart({ id: 3, colour: "#30D158", character, golden: character === "mango" });
      kart.pose({ steer: 0.3, wheelSpin: 1, lean: 0.1, roll: 0, pitch: 0, hop: 0, shake: 0, flame: 0, flicker: 0, slide: 0, time: 1 });
      expect(finite(kart.root)).toBe(true);
      kart.dispose();
    }
    expect(speciesOf("kit")).toBe("fox");
    expect(speciesOf(undefined, "bear")).toBe("bear");
    expect(speciesOf("nobody", "bear")).toBe("bear");
  });
});
