import { describe, expect, it } from "vitest";
import { REDUCED_FLASH, ScreenFlash } from "./flash";

const DT = 1 / 60;

function trace(reduced: boolean, amount = 0.35, seconds = 2): number[] {
  const f = new ScreenFlash();
  const out: number[] = [];
  f.kick(amount, reduced);
  out.push(f.value);
  for (let i = 0; i < seconds / DT; i++) out.push(f.update(DT));
  return out;
}

const biggestStep = (xs: number[]) => xs.reduce((m, x, i) => (i ? Math.max(m, Math.abs(x - (xs[i - 1] as number))) : m), xs[0] as number);

describe("the screen's flash", () => {
  it("jumps and fades in a blink on Standard", () => {
    const t = trace(false);
    expect(t[0]).toBe(0.35);
    expect(t[Math.round(0.5 / DT)]).toBeLessThan(0.01);
  });

  it("with reduced flashing, peaks at a tenth of the brightness at most", () => {
    const peak = Math.max(...trace(true));
    expect(peak).toBeGreaterThan(0);
    expect(peak).toBeLessThanOrEqual(0.35 * REDUCED_FLASH);
  });

  it("with reduced flashing, swells and ebbs instead of jumping", () => {
    const soft = trace(true);
    const hard = trace(false);
    expect(soft[0]).toBe(0); // nothing at once
    const top = soft.indexOf(Math.max(...soft));
    expect(top * DT).toBeGreaterThan(0.1); // it rises over a tenth of a second or more
    // No frame brightens or darkens the picture by more than a sliver.
    expect(biggestStep(soft)).toBeLessThan(0.02);
    expect(biggestStep(soft)).toBeLessThan(biggestStep(hard) / 10);
    expect(soft[soft.length - 1]).toBeLessThan(0.002);
  });

  it("keeps the brighter of two flashes, in either manner", () => {
    const f = new ScreenFlash();
    f.kick(0.3, false);
    f.kick(0.1, false);
    expect(f.value).toBe(0.3);
    const g = new ScreenFlash();
    g.kick(0.3, true);
    g.kick(0.1, true);
    let peak = 0;
    for (let i = 0; i < 60; i++) peak = Math.max(peak, g.update(DT));
    expect(peak).toBeGreaterThan(0.1 * REDUCED_FLASH);
  });
});
