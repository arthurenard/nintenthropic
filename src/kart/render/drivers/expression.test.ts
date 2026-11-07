import { describe, expect, it } from "vitest";
import { BoxGeometry, MeshBasicMaterial, SphereGeometry } from "three";
import { FACES, Face, MOODS, moodOf } from "./expression";
import { createDriver } from "./index";

/** A head: a ball of the right size, its front at z = 0.2. */
const head = () => new SphereGeometry(0.2, 24, 16);

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
      const face = new Face(species, head(), new MeshBasicMaterial());
      const seen = new Set<unknown>();
      for (const [i, mood] of MOODS.entries()) {
        face.update(10 + i, mood);
        expect(face.current).toBe(mood);
        const g = face.mesh.geometry;
        expect(g.index!.count, `${species} ${mood}`).toBeGreaterThan(0);
        expect(g.index!.count / 3, `${species} ${mood} stays light`).toBeLessThan(700);
        seen.add(g);
      }
      expect(seen.size).toBe(MOODS.length);
    }
  });

  it("shares a species' geometries between drivers, and holds a mood a moment before a milder one replaces it", () => {
    const a = new Face("fox", head(), new MeshBasicMaterial());
    const b = new Face("fox", head(), new MeshBasicMaterial());
    a.update(1, "determined");
    b.update(1, "determined");
    expect(a.mesh.geometry).toBe(b.mesh.geometry);
    a.update(1.05, "effort"); // too soon: held
    expect(a.current).toBe("determined");
    a.update(1.4, "effort");
    expect(a.current).toBe("effort");
    a.update(1.45, "shocked"); // a hit shows at once
    expect(a.current).toBe("shocked");
    a.update(1.5, "happy");
    expect(a.current).toBe("happy");
  });

  it("is left to the species that have one: a robot's screen and the stand-ins' own faces get none", () => {
    expect(() => new Face("robot", new BoxGeometry(0.4, 0.4, 0.4), new MeshBasicMaterial())).toThrow();
    // The code-built stand-in (no art loaded here) wears no live face, only its lids.
    const d = createDriver("fox", "#ff453a", [0, 0, 0]);
    expect(() => d.update({ time: 1, steer: 0, lean: 0, twirl: 0 })).not.toThrow();
    d.dispose();
  });
});
