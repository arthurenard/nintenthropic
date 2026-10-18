import { describe, expect, it } from "vitest";
import type { Nest, V3 } from "../rules/types";
import { settleNest, settleNests, type NestWorld } from "./nestSpot";

/** A valley of boxes on flat ground at y = 0, for nests to be settled in. */
interface Box {
  min: V3;
  max: V3;
}

function boxes(list: Box[]): NestWorld {
  const crosses = (a: V3, b: V3, box: Box) => {
    let t0 = 0;
    let t1 = 1;
    for (const k of ["x", "y", "z"] as const) {
      const d = b[k] - a[k];
      if (Math.abs(d) < 1e-9) {
        if (a[k] < box.min[k] || a[k] > box.max[k]) return false;
        continue;
      }
      let ta = (box.min[k] - a[k]) / d;
      let tb = (box.max[k] - a[k]) / d;
      if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta);
      t1 = Math.min(t1, tb);
      if (t0 > t1) return false;
    }
    return true;
  };
  return {
    clear: (a, b) => b.y > 0 && list.every((box) => !crosses(a, b, box)),
    floor: (x, z, top) => {
      let y = top >= 0 ? 0 : null;
      for (const box of list) {
        if (x < box.min.x || x > box.max.x || z < box.min.z || z > box.max.z || box.max.y > top) continue;
        if (y === null || box.max.y > y) y = box.max.y;
      }
      return y;
    },
  };
}

const EYE: V3 = { x: 0, y: 60, z: 0 };
const nest = (at: V3, id = "sniper.1"): Nest => ({ id, exposed: at, hidden: { ...at }, heading: 0, place: "on the far ledge" });

describe("the counter-sniper's nest, settled where the ridge can see him", () => {
  it("leaves a nest already in plain sight as the art made it", () => {
    const open = nest({ x: 0, y: 0, z: -800 });
    expect(settleNest(open, EYE, boxes([]))).toBe(open);
  });

  it("lifts a man the art buried in his ledge onto the rock's own top", () => {
    // A crag whose top is a metre over the nest's point.
    const world = boxes([{ min: { x: -6, y: 0, z: -806 }, max: { x: 6, y: 21, z: -794 } }]);
    const settled = settleNest(nest({ x: 0, y: 20, z: -800 }), EYE, world)!;
    expect(settled.exposed).toEqual({ x: 0, y: 21, z: -800 });
  });

  it("brings a man lying behind the back of an opening forward into it, onto its sill", () => {
    // A belfry: its back wall half a metre in front of the nest, the opening's sill and lintel in front of that.
    const wall = { min: { x: -3, y: 0, z: -500.5 }, max: { x: 3, y: 26, z: -499.9 } };
    const sill = { min: { x: -3, y: 0, z: -499.9 }, max: { x: 3, y: 20, z: -499.2 } };
    const lintel = { min: { x: -3, y: 22.2, z: -499.9 }, max: { x: 3, y: 26, z: -499.2 } };
    const floor = { min: { x: -3, y: 0, z: -503 }, max: { x: 3, y: 20, z: -500.5 } };
    const settled = settleNest(nest({ x: 0, y: 20, z: -501 }), EYE, boxes([wall, sill, lintel, floor]))!;
    expect(settled).not.toBeNull();
    expect(settled.exposed.y).toBe(20);
    expect(settled.exposed.z).toBeGreaterThan(-499.9);
    expect(settled.exposed.z).toBeLessThan(-499.2);
    // He faces the ridge from there.
    expect(settled.heading).toBeCloseTo(Math.atan2(EYE.x - settled.exposed.x, EYE.z - settled.exposed.z));
  });

  it("never moves him off the edge of his ledge to lie on the ground far below", () => {
    // A pillar whose own top is hidden from the ridge by a wall in front: in front of the pillar is only a long drop.
    const pillar = { min: { x: -1, y: 0, z: -801 }, max: { x: 1, y: 30, z: -799 } };
    const parapet = { min: { x: -1, y: 0, z: -799 }, max: { x: 1, y: 33, z: -798.5 } };
    expect(settleNest(nest({ x: 0, y: 30, z: -800 }), EYE, boxes([pillar, parapet]))).toBeNull();
  });

  it("leaves out a nest no round could ever reach, while another remains", () => {
    const shut = { min: { x: -4, y: 0, z: -504 }, max: { x: 4, y: 40, z: -496 } };
    const world = boxes([shut]);
    const hidden = nest({ x: 0, y: 20, z: -500 }, "sniper.1");
    const open = nest({ x: 50, y: 0, z: -900 }, "sniper.2");
    expect(settleNests([hidden, open], EYE, world).map((n) => n.id)).toEqual(["sniper.2"]);
    // With none that can be seen, the art's are kept: the stage still has its sniper.
    expect(settleNests([hidden], EYE, world).map((n) => n.id)).toEqual(["sniper.1"]);
  });
});
