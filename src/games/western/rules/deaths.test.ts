import { describe, expect, it } from "vitest";
import { chooseDeath } from "./deaths";
import { mulberry32 } from "./rng";
import type { Cover, CoverKind, Emerge } from "./types";

function cover(kind: CoverKind, emerge: Emerge, level: 0 | 1 | 2 = 0): Cover {
  const p = { x: 5, y: level * 3.5, z: -20 };
  return { id: `${kind}.${emerge}`, kind, emerge, level, exposed: p, hidden: p, distance: 20.6, side: 1, tags: [] };
}

describe("chooseDeath", () => {
  const r = mulberry32(1);

  it("slumps a man over the barrel, crate or wagon he rose from behind", () => {
    for (const kind of ["barrel", "crate", "wagon"] as const) {
      expect(chooseDeath(cover(kind, "rise"), "body", "aiming", r).clip).toBe("death_slump");
    }
  });

  it("never slumps a man who leaned out round a crate's or wagon's end: nothing is under him", () => {
    for (let i = 0; i < 20; i++) {
      for (const kind of ["crate", "wagon"] as const) {
        for (const emerge of ["lean_left", "lean_right"] as const) {
          const d = chooseDeath(cover(kind, emerge), i % 2 ? "head" : "body", "aiming", r);
          expect(d.clip).not.toBe("death_slump");
          expect(d.fall).toBe(false);
        }
      }
    }
  });

  it("drops men from windows, roofs and the tower into the street", () => {
    for (const kind of ["window", "roof", "tower"] as const) expect(chooseDeath(cover(kind, "rise", 1), "body", "aiming", r).fall).toBe(true);
  });
});
