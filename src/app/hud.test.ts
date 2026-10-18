// The hint line: the game's words, the page's own over them, and who may
// take back what.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hud } from "./hud";

/** Just enough of the hint's paragraph for the HUD to write to. */
function fakeLine() {
  const classes = new Set<string>();
  return {
    hidden: true,
    textContent: "",
    classList: {
      add: (name: string) => void classes.add(name),
      remove: (name: string) => void classes.delete(name),
      contains: (name: string) => classes.has(name),
    },
  };
}

describe("the hint line", () => {
  let line: ReturnType<typeof fakeLine>;
  const shown = () => (line.hidden ? null : line.textContent);

  beforeEach(() => {
    vi.useFakeTimers();
    line = fakeLine();
    vi.stubGlobal("document", { getElementById: (id: string) => (id === "hint" ? line : null) });
    vi.stubGlobal("window", { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout });
    vi.stubGlobal("requestAnimationFrame", (run: () => void) => run());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("keeps a game's tip said over the page's words when the page takes its own back", () => {
    const hud = new Hud(() => false);
    hud.hint("Click to fire.");
    hud.hint("Right-click or press R to reload.");
    hud.unsay("Click to fire.");
    vi.advanceTimersByTime(1000);
    expect(shown()).toBe("Right-click or press R to reload.");
  });

  it("takes the page's words away when nothing was said since", () => {
    const hud = new Hud(() => false);
    hud.hint("Tap to fire.");
    expect(shown()).toBe("Tap to fire.");
    hud.unsay("Tap to fire.");
    vi.advanceTimersByTime(1000);
    expect(shown()).toBeNull();
  });

  it("lets the page's own hint stand over the game's, and gives the game's back after", () => {
    const hud = new Hud(() => false);
    hud.hint("Aim for the head.");
    hud.pageHint("Show your hand to the camera.");
    expect(shown()).toBe("Show your hand to the camera.");
    hud.pageHint(null);
    expect(shown()).toBe("Aim for the head.");
  });
});
