import { describe, expect, it } from "vitest";
import { advice, felledBy, felledNote, LATE_PRESSURE, placeOf, type Felled } from "./felled";
import { Match } from "./match";
import { mulberry32 } from "../../../engine/rules/rng";
import { playUntilDeath, Recorder, standIdle, testCovers } from "./testkit";
import type { Cover, CoverKind } from "./types";

function cover(id: string, kind: CoverKind, level: 0 | 1 | 2 = 0): Cover {
  const p = { x: 0, y: 0, z: -20 };
  return { id, kind, emerge: "rise", level, exposed: p, hidden: p, distance: 20, side: 0, tags: [] };
}

const at = (c: Cover) => {
  const p = placeOf(c);
  return `${p.at} ${p.name}`;
};

describe("the town's places, in words", () => {
  it("names the real Dust Creek's covers as you would point them out", () => {
    expect(at(cover("saloon.balcony_near", "roof", 1))).toBe("on the saloon balcony");
    expect(at(cover("livery.door", "door"))).toBe("at the livery door");
    expect(at(cover("street.wagon", "wagon"))).toBe("behind the wagon");
    expect(at(cover("saloon.roof", "roof", 2))).toBe("on the saloon roof");
    expect(at(cover("church.tower", "tower", 2))).toBe("in the church tower");
    expect(at(cover("hotel.window_up_2", "window", 1))).toBe("in a hotel window");
    expect(at(cover("barber.door", "door"))).toBe("at the barber’s door");
  });

  it("names any other cover by its kind and building", () => {
    expect(at(cover("bank_roof", "roof", 2))).toBe("on the bank roof");
    expect(at(cover("saloon_door", "door"))).toBe("at the saloon door");
    expect(at(cover("sheriff_door", "door"))).toBe("at the sheriff’s door");
    expect(at(cover("hotel_window_3", "window", 1))).toBe("in a hotel window");
    expect(at(cover("store_barrels", "barrel"))).toBe("behind the barrels");
    expect(at(cover("wagon_bed", "wagon"))).toBe("behind the wagon");
    expect(at(cover("church_tower", "tower", 2))).toBe("in the church tower");
    expect(at(cover("mystery", "door"))).toBe("at a doorway");
  });

  it("has a name for every cover of the test town", () => {
    for (const c of testCovers()) expect(placeOf(c).name.length, c.id).toBeGreaterThan(3);
  });
});

describe("what felled the player, and what would help", () => {
  const roof = cover("saloon.roof", "roof", 2);
  const wagon = cover("street.wagon", "wagon");
  const door = cover("livery.door", "door");

  it("points a rifleman out on his roof, and says they aim longer up high", () => {
    const f: Felled = { source: "bullet", role: "rifleman", cover: roof, pressure: 0 };
    expect(felledBy(f)).toBe("a rifleman on the saloon roof");
    expect(felledNote(f)).toBe("A rifleman on the saloon roof. Riflemen aim longer from up high, so there’s time to look up.");
  });

  it("says to shoot dynamite in the air", () => {
    const f: Felled = { source: "dynamite", role: "dynamiter", cover: wagon, pressure: 0.9 };
    expect(felledBy(f)).toBe("dynamite");
    expect(felledNote(f)).toBe("Dynamite from behind the wagon. Shoot it in the air, before it lands.");
    expect(felledNote({ ...f, cover: door })).toBe("Dynamite from the livery door. Shoot it in the air, before it lands.");
    expect(felledNote({ ...f, cover: null })).toBe("Dynamite. Shoot it in the air, before it lands.");
  });

  it("tells an ordinary bandit's victim to watch for the glint", () => {
    const f: Felled = { source: "bullet", role: "gunman", cover: wagon, pressure: 0 };
    expect(felledNote(f)).toBe("A bandit behind the wagon. Watch for the glint: it means he’s about to fire.");
    expect(advice({ ...f, role: "runner" })).toBe(advice(f));
  });

  it("names Black Jack Carver, and how to bring him down", () => {
    const f: Felled = { source: "bullet", role: "boss", cover: door, pressure: 0 };
    expect(felledNote(f)).toBe("Black Jack Carver at the livery door. One shot to the head brings him down.");
  });

  it("says the gang grows bolder when a long wave overran the player", () => {
    const f: Felled = { source: "bullet", role: "gunman", cover: wagon, pressure: LATE_PRESSURE };
    expect(advice(f)).toBe("The longer a wave lasts, the bolder they get.");
    expect(advice({ ...f, role: "rifleman" })).toBe("The longer a wave lasts, the bolder they get.");
  });

  it("keeps every note to two short sentences", () => {
    for (const source of ["bullet", "dynamite"] as const) {
      for (const role of ["gunman", "rifleman", "runner", "dynamiter", "boss", "duelist"] as const) {
        for (const c of testCovers()) {
          for (const pressure of [0, 1]) {
            const note = felledNote({ source, role, cover: c, pressure });
            expect(note.split(". ").length, note).toBeLessThanOrEqual(2);
            expect(note.length, note).toBeLessThanOrEqual(110);
            expect(note).toMatch(/^[A-Z].*\.$/);
          }
        }
      }
    }
  });
});

describe("the results' note", () => {
  it("is absent while the player stands", () => {
    const match = new Match({ random: mulberry32(1), covers: testCovers(), listener: new Recorder() });
    match.start();
    expect(match.felled).toBeNull();
    expect(match.results().note).toBeUndefined();
  });

  it("says what landed the last hit when the gang overran an idle player", () => {
    for (const seed of [1, 2, 3]) {
      const { match } = standIdle(seed, "standard", 240);
      const f = match.felled;
      expect(f, `seed ${seed}`).not.toBeNull();
      const note = match.results().note as string;
      expect(note).toBe(felledNote(f as Felled));
      // Never shooting, the wave dragged on: that is what did it.
      expect(note).toContain("The longer a wave lasts, the bolder they get.");
      if (f?.source === "bullet" && f.cover) expect(note).toContain(placeOf(f.cover).name);
    }
  });

  it("knows dynamite from a bullet, and the last hit from the others", () => {
    const found = new Set<string>();
    for (let seed = 1; seed <= 12; seed++) {
      const { match, listener } = playUntilDeath(seed, { reaction: 1.3, accuracy: 0.45 });
      const f = match.felled;
      if (!f) continue;
      found.add(f.source);
      expect(listener.last("playerHit")?.args[3]).toBe(f.source);
      const note = match.results().note as string;
      if (f.source === "dynamite") {
        expect(f.cover).not.toBeNull();
        expect(note).toMatch(/^Dynamite from .+\. Shoot it in the air, before it lands\.$/);
      } else {
        expect(note.startsWith("Dynamite")).toBe(false);
      }
    }
    expect([...found].sort()).toEqual(["bullet", "dynamite"]);
  });
});
