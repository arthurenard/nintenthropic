// The secrets on screen, without a renderer: the storm's flashes as a hand
// can catch them, the spacewalker's thumbs-down and his walk after it, and
// the lost tools let go.
import { describe, expect, it } from "vitest";
import { Group, Object3D, Quaternion, Vector3, Vector4 } from "three";
import { mulberry32 } from "../../../engine/rules/rng";
import { contractName, nameNode } from "../../../engine/world/names";
import type { Effects } from "./effects";
import type { PlanetSky } from "./planet";
import { SecretsWorld } from "./secretsWorld";

function world(): { secrets: SecretsWorld; uniforms: Record<string, { value: unknown }>; astronaut: Object3D; parent: Group } {
  const extras = new Group();
  const astronaut = nameNode(new Group(), "astronaut");
  astronaut.add(nameNode(new Group(), "astronaut.arm.R"));
  extras.add(astronaut);
  extras.add(nameNode(new Group(), "toolbag"));
  const uniforms: Record<string, { value: unknown }> = {
    uLightning: { value: new Vector4(0, 1, 0, 0) },
    uStormCell: { value: 0 },
    uHi: { value: new Vector4(0, 1, 0, 0) },
    uFlag: { value: 0 },
  };
  const sky = { uniform: (name: string) => uniforms[name] } as unknown as PlanetSky;
  const effects = { split: () => {} } as unknown as Effects;
  const parent = new Group();
  const path = [new Object3D(), new Object3D()];
  path[0]!.position.set(-10, 6, -20);
  path[1]!.position.set(10, 6, -20);
  const secrets = new SecretsWorld(
    extras,
    parent,
    { astronautPath: path, duckPath: [], armHand: null, capsuleWindow: null, capsuleShade: null, eye: new Vector3(), view: { quaternion: new Quaternion(), fov: 60 } },
    effects,
    sky,
    mulberry32(3),
  );
  return { secrets, uniforms, astronaut, parent };
}

const step = (s: SecretsWorld, seconds: number) => {
  for (let i = 0; i < Math.round(seconds * 60); i++) s.update(1 / 60);
};

describe("the storm", () => {
  it("counts a shot for a flash as long as a hand takes to see it and fire, and each flash once", () => {
    const { secrets } = world();
    secrets.startStorm(new Vector3(1, 0, 0));
    // Run until the first flash.
    let t = 0;
    while (!secrets.flashing && t < 3) {
      step(secrets, 1 / 60);
      t += 1 / 60;
    }
    expect(secrets.flashing).toBe(true);
    // Half a second on (a flash itself is gone in a tenth), with no new flash: still counts, once.
    (secrets as unknown as { nextFlash: number }).nextFlash = 99;
    step(secrets, 0.55);
    expect(secrets.takeFlash()).toBe(true);
    expect(secrets.takeFlash()).toBe(false);
    // A second later it is over.
    step(secrets, 0.6);
    expect(secrets.flashing).toBe(false);
  });

  it("brings its own cloud for the lightning, and takes it away", () => {
    const { secrets, uniforms } = world();
    secrets.startStorm(new Vector3(0, 0, 1));
    expect(uniforms.uStormCell!.value).toBe(1);
    secrets.stopStorm();
    expect(uniforms.uStormCell!.value).toBe(0);
  });

  it("flashes a quarter as bright with Reduced Flashing", () => {
    const peak = (reduced: boolean) => {
      const { secrets, uniforms } = world();
      secrets.reducedFlashing = reduced;
      secrets.startStorm(new Vector3(1, 0, 0));
      let most = 0;
      for (let i = 0; i < 300; i++) {
        secrets.update(1 / 60);
        most = Math.max(most, (uniforms.uLightning!.value as Vector4).w);
      }
      return most;
    };
    expect(peak(false)).toBeGreaterThanOrEqual(1);
    expect(peak(true)).toBeLessThanOrEqual(0.4);
  });
});

describe("the spacewalker", () => {
  it("gives his thumbs-down, then goes back to his walk, and can be shot again", () => {
    const { secrets, astronaut } = world();
    secrets.startAstronaut();
    step(secrets, 5);
    const ids = () => secrets.candidates().map((c) => c.id);
    expect(ids()).toContain("astronaut");
    const before = astronaut.position.clone();
    secrets.astronautShot(false);
    expect(ids()).not.toContain("astronaut");
    step(secrets, 2);
    // Stopped to look at you.
    expect(astronaut.position.distanceTo(before)).toBeLessThan(0.3);
    step(secrets, 3);
    // Back at work, along the truss, and there to be shot again.
    expect(ids()).toContain("astronaut");
    step(secrets, 5);
    expect(astronaut.position.distanceTo(before)).toBeGreaterThan(1);
    secrets.astronautShot(true);
    expect(astronaut.visible).toBe(false);
  });
});

describe("the lost tool bag", () => {
  it("lets its tools go once they have drifted off", () => {
    const { secrets, parent } = world();
    secrets.startToolbag();
    step(secrets, 2);
    secrets.toolbagShot();
    const tools = parent.children.filter((o) => o.visible && contractName(o) === "");
    expect(tools.length).toBeGreaterThan(0);
    step(secrets, 10);
    expect(tools.every((o) => o.visible)).toBe(true);
    step(secrets, 25);
    expect(tools.some((o) => o.visible)).toBe(false);
  });
});
