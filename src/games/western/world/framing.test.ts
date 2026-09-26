import { describe, expect, it } from "vitest";
import { checkFraming, chromeKeepOut, fitFraming, framingFits, projectSight, type FitOptions, type Sight } from "./framing";
import { PlayerCamera } from "./playerCamera";
import { Quaternion, Vector3 } from "three";

const RAD = Math.PI / 180;

const options = (over: Partial<FitOptions> = {}): FitOptions => ({
  minFov: 20,
  maxFov: 45,
  minPitch: -1 * RAD,
  maxPitch: 6 * RAD,
  preferPitch: 4 * RAD,
  slack: 0,
  marginX: 0.02,
  marginY: 0.02,
  keepOut: [],
  ...over,
});

/** A man's head and chest `d` metres down the street, `x` metres to the side, feet `y` below the eye. */
function man(x: number, d: number, feet = -1.7): Sight[] {
  return [
    { x, y: feet + 1.95, z: -d, clear: true },
    { x, y: feet + 1.3, z: -d, clear: true },
  ];
}

describe("projectSight", () => {
  it("puts a point straight ahead in the middle, and moves it down as the view pitches up", () => {
    const ahead = { x: 0, y: 0, z: -10, clear: true };
    expect(projectSight(ahead, { fov: 40, pitch: 0 }, 1.6)).toEqual({ x: 0.5, y: 0.5 });
    const up = projectSight(ahead, { fov: 40, pitch: 5 * RAD }, 1.6)!;
    expect(up.x).toBeCloseTo(0.5);
    expect(up.y).toBeGreaterThan(0.6);
  });

  it("sees nothing behind the eye", () => {
    expect(projectSight({ x: 0, y: 0, z: 5, clear: false }, { fov: 40, pitch: 0 }, 1.6)).toBeNull();
  });
});

describe("fitFraming", () => {
  // A street: men near the facades 15 m out, one far down the middle, one on a roof.
  const street = [...man(-6, 15), ...man(6, 15), ...man(0, 50), ...man(-7, 25, 5.5)];

  it("closes in as far as the widest point allows, and not further", () => {
    const f = fitFraming(street, 16 / 10, options());
    expect(f.fov).toBeLessThan(40);
    expect(framingFits(street, f, 16 / 10, options())).toBe(true);
    expect(framingFits(street, { fov: f.fov - 0.5, pitch: f.pitch }, 16 / 10, options())).toBe(false);
  });

  it("opens by the slack it is given", () => {
    const tight = fitFraming(street, 16 / 10, options());
    const roomy = fitFraming(street, 16 / 10, options({ slack: 1 }));
    expect(roomy.fov).toBeCloseTo(tight.fov + 1);
  });

  it("keeps targets out from under the chrome, but not what only has to be seen", () => {
    const corner = { x0: 0, y0: 0, x1: 0.2, y1: 0.2 };
    const f = fitFraming(street, 16 / 10, options({ keepOut: [corner] }));
    expect(f.fov).toBeLessThan(45);
    for (const p of street) {
      const v = projectSight(p, f, 16 / 10)!;
      expect(v.x > corner.x1 || v.y > corner.y1).toBe(true);
    }
    const seenOnly = street.map((p) => ({ ...p, clear: false }));
    expect(fitFraming(seenOnly, 16 / 10, options({ keepOut: [corner] })).fov).toBeLessThanOrEqual(f.fov);
  });

  it("prefers the pitch it is asked for when there is room", () => {
    const near = [...man(-1, 30), ...man(1, 30)];
    const f = fitFraming(near, 16 / 10, options({ minFov: 40 }));
    expect(f.pitch).toBeCloseTo(4 * RAD, 2);
  });

  it("frames a wider window tighter, since the street's width is the limit", () => {
    const wide = fitFraming(street, 21 / 9, options());
    const square = fitFraming(street, 4 / 3, options());
    expect(wide.fov).toBeLessThan(square.fov);
  });

  it("falls back to the widest view when nothing fits", () => {
    const beside = [{ x: 10, y: 0, z: -1, clear: true }];
    expect(fitFraming(beside, 16 / 10, options()).fov).toBe(45);
  });
});

describe("checkFraming", () => {
  it("is the town's own lens from 4:3 up", () => {
    expect(checkFraming(45, 16 / 9)).toEqual({ fov: 45, pitch: 0 });
    expect(checkFraming(45, 4 / 3).fov).toBeCloseTo(45);
  });

  it("widens for a narrower window, so the sides stay in view", () => {
    const narrow = checkFraming(45, 1);
    expect(narrow.fov).toBeGreaterThan(45);
    // The same horizontal reach as 45° at 4:3.
    const half = (f: number, a: number) => Math.atan(Math.tan((f * RAD) / 2) * a);
    expect(half(narrow.fov, 1)).toBeCloseTo(half(45, 4 / 3));
  });
});

describe("chromeKeepOut", () => {
  it("clears the picture-in-picture only for the hand", () => {
    expect(chromeKeepOut(1440, 900, true).length).toBe(chromeKeepOut(1440, 900, false).length + 1);
  });

  it("covers the score panel in the top-left corner", () => {
    const [score] = chromeKeepOut(1440, 900, false);
    expect(score!.x0).toBe(0);
    expect(score!.x1 * 1440).toBeGreaterThan(200);
    expect(score!.y1 * 900).toBeGreaterThan(186);
  });
});

describe("PlayerCamera framing", () => {
  const eye = new Vector3(0, 1.7, 0);

  it("eases to a new framing and lands on it exactly", () => {
    const cam = new PlayerCamera(eye, new Quaternion(), 45);
    cam.still = true;
    cam.setFraming({ fov: 33, pitch: 4 * RAD }, 1.4);
    cam.update(0.7);
    expect(cam.camera.fov).toBeGreaterThan(33);
    expect(cam.camera.fov).toBeLessThan(45);
    cam.update(0.8);
    expect(cam.camera.fov).toBeCloseTo(33);
    // Pitched up: the view's forward points above the horizon.
    const forward = new Vector3(0, 0, -1).applyQuaternion(cam.camera.quaternion);
    expect(Math.asin(forward.y)).toBeCloseTo(4 * RAD, 3);
  });

  it("jumps at once with no time to ease", () => {
    const cam = new PlayerCamera(eye, new Quaternion(), 45);
    cam.setFraming({ fov: 30, pitch: 0 }, 1);
    cam.update(0.1);
    cam.setFraming({ fov: 45, pitch: 0 }, 0);
    expect(cam.camera.fov).toBe(45);
  });
});
