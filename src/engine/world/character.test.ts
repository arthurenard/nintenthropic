import { Bone, Group, Vector3, type Object3D } from "three";
import { describe, expect, it } from "vitest";
import type { LoadedAsset } from "../types";
import { Rig, patchRigFragment, templateFrom } from "./character";
import { nameNode } from "./names";

const SOURCE = ["#include <common>", "void main() {", "#include <lights_fragment_begin>", "#include <lights_fragment_maps>", "#include <opaque_fragment>", "}"].join("\n");

describe("the rig shader patch", () => {
  const out = patchRigFragment(SOURCE);

  it("applies the key light to the directional light (the chunk is expanded to reach its line)", () => {
    expect(out).not.toContain("#include <lights_fragment_begin>");
    const at = out.indexOf("getDirectionalLightInfo( directionalLight, directLight );");
    expect(at).toBeGreaterThan(0);
    expect(out.slice(at, at + 120)).toContain("directLight.color *= uKeyLight;");
    expect(out.split("uKeyLight;").length - 1).toBe(2);
  });

  it("declares its uniforms and leaves the rest of the shader's includes alone", () => {
    expect(out).toContain("uniform float uKeyLight;");
    expect(out).toContain("uniform float uShade;");
    expect(out).toContain("outgoingLight *= uShade;");
    expect(out).toContain("#include <lights_fragment_maps>");
    expect(out).toContain("#include <opaque_fragment>");
  });
});

/** A bare humanoid armature on the contract's bone names, as a loaded file would give it. */
function armature(): LoadedAsset {
  const scene = new Group();
  const bone = (name: string, parent: Object3D, x: number, y: number, z = 0): Bone => {
    const b = nameNode(new Bone(), name);
    b.position.set(x, y, z);
    parent.add(b);
    return b;
  };
  const hips = bone("hips", scene, 0, 1);
  const spine = bone("spine", hips, 0, 0.15);
  const chest = bone("chest", spine, 0, 0.2);
  const neck = bone("neck", chest, 0, 0.2);
  bone("head", neck, 0, 0.1);
  for (const [side, x] of [["L", 1], ["R", -1]] as const) {
    const arm = bone(`upper_arm.${side}`, chest, 0.18 * x, 0.15);
    const fore = bone(`forearm.${side}`, arm, 0.28 * x, 0);
    bone(`hand.${side}`, fore, 0.25 * x, 0);
    const thigh = bone(`thigh.${side}`, hips, 0.1 * x, -0.05);
    const shin = bone(`shin.${side}`, thigh, 0, -0.45);
    bone(`foot.${side}`, shin, 0, -0.45, 0.05);
  }
  return { scene, animations: [] };
}

describe("a rig's joints", () => {
  it("are where its bones stand now: moved, turned, aiming and hit, before anything is drawn", () => {
    const parent = new Group();
    parent.position.set(2, 0, -5);
    const rig = new Rig(templateFrom("bandit", armature()));
    parent.add(rig.root);
    rig.root.position.set(-3, 0.5, -20);
    rig.root.rotation.y = 2.4;
    rig.aimAt(new Vector3(0, 1.7, 0), 1);
    rig.hitReact(1, 1);
    rig.kick();
    for (let i = 0; i < 5; i++) rig.update(1 / 60);
    const j = rig.updateJoints();
    const expected = (name: string) => rig.bone(name)!.getWorldPosition(new Vector3());
    const pairs: [Vector3, string][] = [
      [j.hips, "hips"], [j.neck, "neck"], [j.shoulderL, "upper_arm.L"], [j.shoulderR, "upper_arm.R"],
      [j.elbowL, "forearm.L"], [j.elbowR, "forearm.R"], [j.handL, "hand.L"], [j.handR, "hand.R"],
      [j.thighL, "thigh.L"], [j.thighR, "thigh.R"], [j.kneeL, "shin.L"], [j.kneeR, "shin.R"],
      [j.footL, "foot.L"], [j.footR, "foot.R"],
    ];
    for (const [got, bone] of pairs) expect(got.distanceTo(expected(bone)), bone).toBeLessThan(1e-6);
    // The head's centre a little above its bone.
    expect(j.head.distanceTo(expected("head"))).toBeCloseTo(0.09, 6);
    // And they follow the rig when it moves again, with no render between.
    rig.root.position.x += 1;
    const handBefore = j.handR.clone();
    rig.updateJoints();
    expect(j.handR.x - handBefore.x).toBeCloseTo(1, 6);
  });
});
