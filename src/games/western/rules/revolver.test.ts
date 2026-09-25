import { describe, expect, it } from "vitest";
import { Revolver } from "./revolver";

describe("the revolver", () => {
  it("fires six rounds, then clicks", () => {
    const r = new Revolver();
    for (let i = 0; i < 6; i++) expect(r.trigger()).toBe("fired");
    expect(r.rounds).toBe(0);
    expect(r.trigger()).toBe("dry");
    expect(r.trigger()).toBe("dry");
  });

  it("reloads in 0.9 s and cannot fire meanwhile", () => {
    const r = new Revolver();
    r.trigger();
    expect(r.reload()).toBe(true);
    expect(r.trigger()).toBe("reloading");
    expect(r.update(0.5, false)).toBe(null);
    expect(r.reloading).toBe(true);
    expect(r.update(0.41, false)).toBe("done");
    expect(r.rounds).toBe(6);
    expect(r.trigger()).toBe("fired");
  });

  it("reloads when the aim leaves the screen, once per exit", () => {
    const r = new Revolver();
    r.trigger();
    r.trigger();
    expect(r.update(0.016, true)).toBe("started");
    // Staying off screen does not restart it.
    for (let i = 0; i < 100; i++) r.update(0.016, true);
    expect(r.rounds).toBe(6);
    expect(r.reloading).toBe(false);
    // Coming back and leaving again with a full cylinder does nothing.
    r.update(0.016, false);
    expect(r.update(0.016, true)).toBe(null);
  });

  it("does not reload a full cylinder", () => {
    const r = new Revolver();
    expect(r.reload()).toBe(false);
    expect(r.update(0.016, true)).toBe(null);
  });

  it("an empty gun reloads from the gesture", () => {
    const r = new Revolver();
    for (let i = 0; i < 6; i++) r.trigger();
    r.update(0.016, false);
    expect(r.update(0.016, true)).toBe("started");
    let done = false;
    for (let i = 0; i < 60 && !done; i++) done = r.update(0.016, true) === "done";
    expect(done).toBe(true);
    expect(r.rounds).toBe(6);
  });
});
