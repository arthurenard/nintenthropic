import { describe, expect, it } from "vitest";
import type { RaceRenderer, RaceView, RacerSetup, TrackDef } from "../contract";
import type { PodiumRenderer } from "../render/podium";
import { lazyPodium, lazyRenderer } from "./lazyRenderer";

const track = {} as TrackDef;
const racers: RacerSetup[] = [];

/** A renderer that says what it was told. */
function recorder(): { renderer: RaceRenderer; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    renderer: {
      async load(_t, _r, onProgress) {
        calls.push("load");
        onProgress?.(1);
      },
      setViews: (karts) => calls.push(`views ${karts.join(",")}`),
      frame: (_v, dt) => calls.push(`frame ${dt}`),
      resize: (w, h, d) => calls.push(`resize ${w}x${h}@${d}`),
      setControls: (kinds) => calls.push(`controls ${Object.keys(kinds).join(",")}`),
      dispose: () => calls.push("dispose"),
    },
  };
}

describe("the renderer that is made when it is first needed", () => {
  it("makes nothing until the race is loaded, then hands over what it was told meanwhile, in an order that works", async () => {
    const { renderer, calls } = recorder();
    let made = 0;
    const lazy = lazyRenderer(async () => (made++, renderer));
    lazy.resize(800, 600, 2);
    lazy.resize(1000, 700, 2);
    lazy.setViews([0, 1]);
    lazy.setControls?.({ 0: "keyboard" });
    lazy.frame({} as RaceView, 0.016);
    expect(made).toBe(0);
    expect(calls).toEqual([]);
    const progress: number[] = [];
    await lazy.load(track, racers, (f) => progress.push(f));
    expect(made).toBe(1);
    // The last size only, then the views, the controls, and the load itself.
    expect(calls).toEqual(["resize 1000x700@2", "views 0,1", "controls 0", "load"]);
    expect(progress).toEqual([1]);
    lazy.frame({} as RaceView, 0.02);
    lazy.setViews([2]);
    expect(calls.slice(4)).toEqual(["frame 0.02", "views 2"]);
  });

  it("rejects the load with the reason the renderer could not be made", async () => {
    const lazy = lazyRenderer(async () => {
      throw new Error("no webgl");
    });
    await expect(lazy.load(track, racers)).rejects.toThrow("no webgl");
    lazy.frame({} as RaceView, 0.016);
    lazy.dispose();
  });

  it("lets a renderer that arrives after the race was left go at once", async () => {
    const { renderer, calls } = recorder();
    const lazy = lazyRenderer(async () => renderer);
    const loading = lazy.load(track, racers);
    lazy.dispose();
    await loading;
    expect(calls).toEqual(["dispose"]);
  });

  it("disposes a renderer it made, once", async () => {
    const { renderer, calls } = recorder();
    const lazy = lazyRenderer(async () => renderer);
    await lazy.load(track, racers);
    lazy.dispose();
    lazy.dispose();
    expect(calls.filter((c) => c === "dispose")).toHaveLength(1);
  });
});

describe("the podium that is made when it is first needed", () => {
  function podium(): { picture: PodiumRenderer; calls: string[] } {
    const calls: string[] = [];
    return {
      calls,
      picture: {
        show: (winners) => calls.push(`show ${winners.length}`),
        frame: (dt) => calls.push(`frame ${dt}`),
        resize: (w, h, d) => calls.push(`resize ${w}x${h}@${d}`),
        dispose: () => calls.push("dispose"),
      },
    };
  }
  const winners = [{ name: "Ana", colour: "#fff", character: "bun" }];
  /** A canvas as far as the podium cares: it can be taken off the page. */
  const canvasStub = (): { canvas: HTMLCanvasElement; removed: () => boolean } => {
    let removed = false;
    return { canvas: { remove: () => void (removed = true) } as unknown as HTMLCanvasElement, removed: () => removed };
  };

  it("shows the winners and the size once the picture is there, and draws frames after", async () => {
    const { picture, calls } = podium();
    const lazy = lazyPodium(canvasStub().canvas, async () => picture);
    lazy.show(winners);
    lazy.resize(640, 360, 2);
    lazy.frame(0.016);
    expect(calls).toEqual([]);
    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toEqual(["resize 640x360@2", "show 1"]);
    lazy.frame(0.02);
    expect(calls.at(-1)).toBe("frame 0.02");
  });

  it("takes its canvas away when the picture cannot be made", async () => {
    const { canvas, removed } = canvasStub();
    lazyPodium(canvas, async () => {
      throw new Error("no webgl");
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(removed()).toBe(true);
  });

  it("lets a picture that arrives after the screen was left go", async () => {
    const { picture, calls } = podium();
    const lazy = lazyPodium(canvasStub().canvas, async () => picture);
    lazy.dispose();
    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toEqual(["dispose"]);
  });
});
