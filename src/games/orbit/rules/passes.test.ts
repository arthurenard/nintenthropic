import { describe, expect, it } from "vitest";
import { countFor, isDerelictPass, passSpec } from "./passes";
import type { Kind } from "./tuning";

const total = (mix: Partial<Record<Kind, number>>) => Object.values(mix).reduce((s, n) => s + (n ?? 0), 0);

describe("the passes", () => {
  it("send 10, 14, 18, 22, the Derelict and 16, then four more each", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8].map(countFor)).toEqual([10, 14, 18, 22, 16, 26, 30, 34]);
    expect(passSpec(5).derelict).toBe(true);
    expect(passSpec(10).derelict).toBe(true);
    expect(passSpec(10).count).toBe(countFor(9) + 4 - 10);
    expect([1, 2, 3, 4, 6, 9, 11].some(isDerelictPass)).toBe(false);
  });

  it("brings in the kinds as the design says", () => {
    expect(Object.keys(passSpec(1).mix).sort()).toEqual(["chunk", "shrapnel"]);
    expect(passSpec(2).mix.slab ?? 0).toBeGreaterThan(0);
    expect(passSpec(2).mix.shard ?? 0).toBe(0);
    expect(passSpec(3).mix.shard ?? 0).toBeGreaterThan(0);
    expect(passSpec(3).mix.foil ?? 0).toBe(0);
    expect(passSpec(4).mix.foil ?? 0).toBeGreaterThan(0);
  });

  it("sends exactly its count", () => {
    for (let p = 1; p <= 20; p++) expect(total(passSpec(p).mix), `pass ${p}`).toBe(passSpec(p).count);
  });

  it("grows faster, fuller and with more slabs after the fifth", () => {
    let last = passSpec(1);
    for (let p = 2; p <= 16; p++) {
      const s = passSpec(p);
      expect(s.speed, `speed ${p}`).toBeGreaterThanOrEqual(last.speed);
      expect(s.maxActive, `active ${p}`).toBeGreaterThanOrEqual(last.maxActive);
      expect(s.gap[1], `gap ${p}`).toBeLessThanOrEqual(last.gap[1]);
      expect(s.gap[0]).toBeLessThanOrEqual(s.gap[1]);
      last = s;
    }
    const share = (p: number) => (passSpec(p).mix.slab ?? 0) / passSpec(p).count;
    expect(share(12)).toBeGreaterThan(share(6));
  });

  it("says something useful under each title", () => {
    expect(passSpec(1).subtitle).toBe("Shoot the debris before it hits the glass.");
    expect(passSpec(5).subtitle).toBe("The Derelict. Hit its fuel tank.");
    for (let p = 1; p <= 12; p++) expect(passSpec(p).subtitle.length).toBeGreaterThan(5);
  });
});
