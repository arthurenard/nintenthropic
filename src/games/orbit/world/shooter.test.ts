// Aim Assist in Orbital Decay's shots: the real Shooter, through a window made
// of fakes (a camera, a piece of debris at a known place, the drone, the Moon).
import { describe, expect, it } from "vitest";
import { Group, PerspectiveCamera, Vector3 } from "three";
import { ASSIST_BOOST } from "../../../engine/rules/assist";
import { Fragment } from "../rules/debris";
import type { Motion } from "../rules/motion";
import { KINDS } from "../rules/tuning";
import type { DebrisView } from "./debrisView";
import { ASSIST, Shooter, type ShotResult, type SkyTargets } from "./shooter";

const FOV = 45;
const ASPECT = 16 / 9;
const TAN_HALF = Math.tan((FOV * Math.PI) / 360);
const metres = (fraction: number, distance: number) => fraction * 2 * TAN_HALF * distance;

class Window {
  readonly settings = { aimAssist: true };
  readonly camera = new PerspectiveCamera(FOV, ASPECT, 0.1, 400);
  readonly chunk: Fragment;
  moon: SkyTargets["moon"] = null;
  drone: { center: Vector3; radius: number } | null = null;
  private readonly shooter: Shooter;
  private readonly at: Vector3;

  constructor(at = new Vector3(0, 0, -20)) {
    this.at = at;
    this.camera.position.set(0, 0, 0);
    this.camera.updateMatrixWorld(true);
    this.camera.updateProjectionMatrix();
    this.chunk = new Fragment(1, "chunk", 0, 0, {} as Motion, { axis: { x: 0, y: 1, z: 0 }, rate: 0, phase: 0, face: { x: 0, y: 0, z: 1 } }, "pane");
    const debris = {
      bounds: () => ({ center: this.at, radius: KINDS.chunk.radius }),
      tankAt: () => null,
    } as unknown as DebrisView;
    this.shooter = new Shooter(this.camera, debris, new Group(), this.settings);
  }

  /** A shot at a point, moved sideways by a fraction of the view's smaller side. */
  shoot(point: Vector3, dx = 0): ShotResult {
    const p = point.clone().project(this.camera);
    const sky: SkyTargets = { moon: this.moon, planet: () => null };
    return this.shooter.shoot((p.x + 1) / 2 + dx / ASPECT, (1 - p.y) / 2, 0, [this.chunk], this.drone, [], sky);
  }
}

describe("Aim Assist in Orbital Decay", () => {
  it("forgives a piece of debris a little more than the game always did", () => {
    const w = new Window();
    const at = new Vector3(0, 0, -20);
    // 3% is 50 cm at 20 m: past the chunk's own 42 cm and its 2.6% (43 cm), inside what assist gives it (58 cm).
    expect(metres(ASSIST.debris, 20)).toBeLessThan(metres(0.03, 20));
    expect(metres(0.03, 20)).toBeLessThan(metres(ASSIST.debris * ASSIST_BOOST, 20));
    expect(w.shoot(at, 0.03).hit).toBe("debris");
    expect(w.shoot(at, 0.04).hit).not.toBe("debris");
  });

  it("is exact when it is off, and read on every shot", () => {
    const w = new Window();
    const at = new Vector3(0, 0, -20);
    w.settings.aimAssist = false;
    expect(w.shoot(at).hit).toBe("debris");
    expect(w.shoot(at, 0.03).hit).not.toBe("debris");
    // 40 cm is inside the chunk's real 42 cm; 45 cm is not.
    expect(w.shoot(at, 0.4 / metres(1, 20)).hit).toBe("debris");
    expect(w.shoot(at, 0.45 / metres(1, 20)).hit).not.toBe("debris");
    w.settings.aimAssist = true;
    expect(w.shoot(at, 0.03).hit).toBe("debris");
  });

  it("never helps a shot onto the drone: only a real hit counts, on or off", () => {
    const w = new Window(new Vector3(0, 5, -20));
    w.drone = { center: new Vector3(0, 0, -20), radius: 0.5 };
    const at = w.drone.center;
    expect(w.shoot(at).hit).toBe("drone");
    // 3% is 50 cm at 20 m, right at the drone's edge; 3.5% (58 cm) is beside it: nothing, with assist's help for the debris above.
    expect(w.shoot(at, 0.035).hit).not.toBe("drone");
    w.settings.aimAssist = false;
    expect(w.shoot(at).hit).toBe("drone");
    expect(w.shoot(at, 0.035).hit).not.toBe("drone");
  });

  it("does not widen the sky's secrets: the Moon is as easy to hit as the game made it, and exact when off", () => {
    const w = new Window(new Vector3(0, 30, -300));
    w.moon = { dir: new Vector3(0, 0, -1), radius: 0.001 };
    const at = new Vector3(0, 0, -100);
    // 1.8% is inside the sky's 2% allowance; 2.4% is past it, and would be inside it if the boost reached it.
    expect(w.shoot(at, 0.018).hit).toBe("secret");
    expect(w.shoot(at, 0.024).hit).not.toBe("secret");
    w.settings.aimAssist = false;
    expect(w.shoot(at, 0.018).hit).not.toBe("secret");
  });
});
