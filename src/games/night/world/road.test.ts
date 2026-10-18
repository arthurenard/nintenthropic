import { Euler, Mesh, PerspectiveCamera, Quaternion, Vector3, type Object3D } from "three";
import { checkFraming } from "../../../engine/world/framing";
import { beforeAll, describe, expect, it } from "vitest";
import { contractName } from "../../../engine/world/names";
import { buildPlaceholderRoad } from "../placeholder/road";
import { SIGN_LETTERS } from "../rules/secrets";
import { jarSeen } from "./jars";
import { RoadQueries } from "./queries";
import { readRoad, surfaceOf, type RoadLayout } from "./road";
import { playFraming, playSights, secretSpots } from "./sights";

/**
 * The road's contract (docs/DEAD_OF_NIGHT.md, "Asset contract"), read from
 * the placeholder built to it: what the game finds in road.glb, and that
 * the aim check's jars and the secrets can be seen from the eye.
 */
let road: RoadLayout;
let queries: RoadQueries;

// Building the whole placeholder road takes seconds on a busy machine: more than a hook's usual ten.
beforeAll(() => {
  road = readRoad(buildPlaceholderRoad());
  queries = new RoadQueries(road);
}, 60_000);

/** The aim check's view: the road's own lens, at 16:10. */
function checkCamera(): PerspectiveCamera {
  const cam = new PerspectiveCamera(road.fov, 16 / 10, 0.1, 400);
  cam.position.copy(road.eye);
  cam.quaternion.copy(road.eyeQuaternion);
  cam.updateMatrixWorld(true);
  return cam;
}

function onScreen(cam: PerspectiveCamera, p: Vector3): { x: number; y: number } {
  const v = p.clone().project(cam);
  return { x: (v.x + 1) / 2, y: (1 - v.y) / 2 };
}

const centre = (o: Object3D) => o.getWorldPosition(new Vector3());

describe("the road's contract", () => {
  it("has the eye at 1.7 m looking up the road, and the moon", () => {
    expect(road.eye.y).toBeCloseTo(1.7, 5);
    expect(road.fov).toBe(50);
    const ahead = new Vector3(0, 0, -1).applyQuaternion(road.eyeQuaternion);
    expect(ahead.z).toBeLessThan(-0.9);
    // Moonlight from high on the left, falling toward the road.
    expect(road.moonDirection.y).toBeLessThan(-0.5);
    expect(road.moonDirection.x).toBeGreaterThan(0);
  });

  it("has every lane and surprise, from the fog to the barricade", () => {
    expect(road.lanes.map((l) => l.id).sort()).toEqual(["booth", "bus", "corn", "fence", "road", "trees"]);
    for (const lane of road.lanes) {
      const first = lane.points[0]!;
      const last = lane.points[lane.points.length - 1]!;
      expect(Math.hypot(last.x, last.z), lane.id).toBeLessThan(9);
      expect(Math.hypot(first.x, first.z), lane.id).toBeGreaterThan(11);
      expect(lane.spread, lane.id).toBeGreaterThan(0);
    }
  });

  it("measures how far the corn hides the corn lane's dead", () => {
    const corn = road.lanes.find((l) => l.id === "corn")!;
    expect(corn.cover).toBeGreaterThan(20);
    expect(corn.cover).toBeLessThan(40);
    for (const lane of road.lanes) if (lane.id !== "corn") expect(lane.cover, lane.id).toBe(0);
    expect(road.corn.length).toBeGreaterThan(0);
  });

  it("has five places at the barricade, in front of it, within the view", () => {
    expect(road.slots.length).toBe(5);
    for (const s of road.slots) {
      expect(s.pos.z).toBeLessThan(-3);
      expect(Math.abs(Math.atan2(s.pos.x, -s.pos.z))).toBeLessThan((28 * Math.PI) / 180);
    }
  });

  it("has the practical lights, the survivors' runs, and the shadow catcher", () => {
    expect(road.streetLight).not.toBeNull();
    expect(road.neonLight).not.toBeNull();
    expect(road.motelLights.length).toBeGreaterThan(0);
    expect(road.survivorPaths.length).toBe(2);
    for (const path of road.survivorPaths) {
      // Across the road, left to right, toward the motel.
      expect(path[0]!.x).toBeLessThan(-5);
      expect(path[path.length - 1]!.x).toBeGreaterThan(10);
    }
    expect(road.groundShadow.length).toBe(1);
  });

  it("has every secret", () => {
    const s = road.secrets;
    expect([...s.sign.keys()].sort()).toEqual([...SIGN_LETTERS].sort());
    for (const node of [s.scarecrow, s.scarecrowHead, s.boothLight, s.motelPhone, s.driveInLamp, s.driveInScreen, s.radio, s.duck, s.moonDisc]) expect(node).not.toBeNull();
    // The head turns on its own, and goes with the scarecrow.
    let under = false;
    for (let n: Object3D | null = s.scarecrowHead; n; n = n.parent) if (n === s.scarecrow) under = true;
    expect(under).toBe(true);
    expect(s.catSpots.length).toBe(4);
  });

  it("says what every surface is made of, and keeps the corn and the glass from stopping a bullet", () => {
    const kinds = new Set<string>();
    road.root.traverse((o) => {
      if ((o as Mesh).isMesh) kinds.add(surfaceOf(o));
    });
    for (const k of ["asphalt", "dirt", "wood", "metal", "glass", "plant", "sandbag", "water"]) expect(kinds, k).toContain(k);
    const solid = new Set<Object3D>(road.solids);
    for (const m of road.corn) expect(solid.has(m)).toBe(false);
    for (const m of road.solids) expect(surfaceOf(m)).not.toBe("glass");
  });
});

describe("what the eye can see", () => {
  it("stands nine jars where the eye sees them, over the corners, edges and middle of the check's view", () => {
    expect(road.calib.length).toBe(9);
    const cam = checkCamera();
    const spots = road.calib.map((node) => {
      const base = centre(node);
      expect(jarSeen(queries, road.eye, base), contractName(node)).toBe(true);
      return onScreen(cam, base);
    });
    for (const p of spots) {
      expect(p.x).toBeGreaterThan(0.05);
      expect(p.x).toBeLessThan(0.95);
      expect(p.y).toBeGreaterThan(0.05);
      expect(p.y).toBeLessThan(0.95);
    }
    const xs = spots.map((p) => p.x);
    const ys = spots.map((p) => p.y);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(0.55);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(0.35);
    // Each third across has jars in it.
    for (const [lo, hi] of [[0, 1 / 3], [1 / 3, 2 / 3], [2 / 3, 1]] as const) expect(spots.filter((p) => p.x >= lo && p.x < hi).length).toBeGreaterThanOrEqual(2);
  });

  it("keeps every secret on screen in play, whatever the window's shape", () => {
    const sights = playSights(road);
    const spots = secretSpots(road);
    // The eight secrets: the sign's eight letters, six other things and the cat's four perches.
    expect(spots.length).toBe(SIGN_LETTERS.length + 6 + 4);
    // The cat never perches where a shot meant for it would find another secret first.
    const cats = road.secrets.catSpots;
    for (const c of cats) {
      for (const { at } of spots.slice(0, spots.length - cats.length)) expect(c.distanceTo(at), `cat at ${c.toArray().join(", ")}`).toBeGreaterThan(1.2);
    }
    for (const [w, h] of [[1280, 1066], [1280, 800], [1280, 720], [2560, 1440], [2560, 1080]] as const) {
      for (const hand of [true, false]) {
        const check = checkFraming(road.fov, w / h);
        const play = playFraming(sights, w, h, road.fov, check.fov, hand);
        const cam = new PerspectiveCamera(play.fov, w / h, 0.1, 400);
        cam.position.copy(road.eye);
        cam.quaternion.copy(road.eyeQuaternion).multiply(new Quaternion().setFromEuler(new Euler(play.pitch, 0, 0, "YXZ")));
        cam.updateMatrixWorld(true);
        for (const { at: p, minAspect } of spots) {
          // The radio only from about 3:2 (sights.ts, RADIO_ASPECT).
          if (minAspect !== undefined && w / h < minAspect) continue;
          const at = onScreen(cam, p);
          const where = `${w}x${h} ${hand ? "hand" : "mouse"} (${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)})`;
          expect(at.x, where).toBeGreaterThan(0.01);
          expect(at.x, where).toBeLessThan(0.99);
          expect(at.y, where).toBeGreaterThan(0.01);
          expect(at.y, where).toBeLessThan(0.99);
        }
      }
    }
  });

  it("shows the secrets from the barricade", () => {
    const cam = checkCamera();
    const s = road.secrets;
    for (const node of [...s.sign.values(), s.moonDisc, s.boothLight, s.radio, s.duck, s.scarecrow]) {
      const p = onScreen(cam, centre(node!));
      expect(p.x, contractName(node!)).toBeGreaterThan(0.02);
      expect(p.x, contractName(node!)).toBeLessThan(0.98);
      expect(p.y, contractName(node!)).toBeGreaterThan(0.02);
      expect(p.y, contractName(node!)).toBeLessThan(0.98);
    }
  });
});
