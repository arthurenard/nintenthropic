import { describe, expect, it } from "vitest";
import { Mesh, MeshBasicMaterial, SphereGeometry } from "three";
import { MeshBuilder } from "../kartBuilder";
import { SURF } from "../kartMaterial";
import { FACES, Face, MOODS, moodOf } from "./expression";
import { createDriver } from "./index";

/** A head in the kart's vertex format: a ball of the right size, its front at z = 0.2. */
function head() {
  const b = new MeshBuilder();
  b.as(SURF.fur, () => b.blob(0, 0, 0, 0.2, 0.2, 0.2, [1, 1, 1], 2));
  return b.build();
}
const faceOn = (species: "fox", h = head()) => {
  const mesh = new Mesh(h, new MeshBasicMaterial());
  return { face: new Face(species, h, mesh), mesh };
};

describe("a driver's mood", () => {
  const calm = { happy: 0, dizzy: 0, steer: 0, rest: 0 };
  it("is determined while racing, calm at rest, gritted in a hard bend, shocked when dizzy, happy at a cheer", () => {
    expect(moodOf(calm)).toBe("determined");
    expect(moodOf({ ...calm, rest: 1 })).toBe("calm");
    expect(moodOf({ ...calm, steer: -0.9 })).toBe("effort");
    expect(moodOf({ ...calm, dizzy: 1 })).toBe("shocked");
    expect(moodOf({ ...calm, happy: 1 })).toBe("happy");
    // Dizzy beats a cheer, which beats a bend.
    expect(moodOf({ happy: 1, dizzy: 1, steer: 1, rest: 0 })).toBe("shocked");
    expect(moodOf({ happy: 1, dizzy: 0, steer: 1, rest: 0 })).toBe("happy");
  });
});

describe("a driver's face", () => {
  it("has a brow or a mouth for the species whose models carry none of their own, in a geometry for each mood", () => {
    for (const species of Object.keys(FACES) as (keyof typeof FACES)[]) {
      const h = head();
      const mesh = new Mesh(h, new MeshBasicMaterial());
      const face = new Face(species, h, mesh);
      const seen = new Set<unknown>();
      for (const [i, mood] of MOODS.entries()) {
        face.update(10 + i, mood);
        expect(face.current).toBe(mood);
        const g = mesh.geometry;
        // The head with its face welded on: more than the head alone, and still light.
        expect(g.index!.count, `${species} ${mood}`).toBeGreaterThan(h.index!.count);
        expect((g.index!.count - h.index!.count) / 3, `${species} ${mood} stays light`).toBeLessThan(700);
        seen.add(g);
      }
      expect(seen.size).toBe(MOODS.length);
      face.dispose();
    }
  });

  it("holds a mood a moment before a milder one replaces it, and shows a hit or a cheer at once", () => {
    const { face } = faceOn("fox");
    face.update(1, "determined");
    face.update(1.05, "effort"); // too soon: held
    expect(face.current).toBe("determined");
    face.update(1.4, "effort");
    expect(face.current).toBe("effort");
    face.update(1.45, "shocked");
    expect(face.current).toBe("shocked");
    face.update(1.5, "happy");
    expect(face.current).toBe("happy");
  });

  it("is left to the species that have one: a robot's screen and the stand-ins' own faces get none", () => {
    const h = head();
    expect(() => new Face("robot", h, new Mesh(h, new MeshBasicMaterial()))).toThrow();
    // The code-built stand-in (no art loaded here) wears no live face, only its lids.
    const d = createDriver("fox", "#ff453a", [0, 0, 0]);
    expect(() => d.update({ time: 1, steer: 0, lean: 0, twirl: 0 })).not.toThrow();
    d.dispose();
  });
});
