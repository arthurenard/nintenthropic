/**
 * The renderers behind the race screen and the podium, made when they are first needed.
 *
 * The page's code for drawing a race (three.js, the world, the landmarks, the post chain) is about a megabyte that the start
 * screen, the lobby and a phone that is only a wheel never use. These stand-ins have the renderer's own interface and wait
 * until the first `load` (or `show`) to fetch it; what the screen says to them before then (the size, the views, what each
 * driver drives with, the resolution's ceiling) is kept and handed over when the real one exists. If the real one cannot
 * be made (no WebGL), `load` rejects with the reason, as the screens already expect of a load that fails.
 */
import type { ControlKind, RaceRenderer } from "../contract";
import type { PodiumEntry, PodiumRenderer } from "../render/podium";

export function lazyRenderer(make: () => Promise<RaceRenderer>): RaceRenderer {
  let real: RaceRenderer | null = null;
  let disposed = false;
  let size: [number, number, number] | null = null;
  let views: readonly number[] | null = null;
  let controls: Readonly<Record<number, ControlKind>> | null = null;
  let ceiling = 1;
  let rivals: Readonly<Record<number, number>> | null = null;
  return {
    async load(track, racers, onProgress) {
      const made = await make();
      if (disposed) {
        made.dispose();
        return;
      }
      real = made;
      if (size) made.resize(...size);
      if (views) made.setViews(views);
      if (controls) made.setControls?.(controls);
      if (rivals) made.setRivals?.(rivals);
      if (ceiling < 1) made.limitResolution?.(ceiling);
      await made.load(track, racers, onProgress);
    },
    setViews(karts) {
      views = karts;
      real?.setViews(karts);
    },
    frame(view, dt) {
      real?.frame(view, dt);
    },
    resize(width, height, dpr) {
      size = [width, height, dpr];
      real?.resize(width, height, dpr);
    },
    setControls(kinds) {
      controls = kinds;
      real?.setControls?.(kinds);
    },
    setRivals(next) {
      rivals = next;
      real?.setRivals?.(next);
    },
    limitResolution(value) {
      ceiling = value;
      real?.limitResolution?.(value);
    },
    dispose() {
      disposed = true;
      real?.dispose();
      real = null;
    },
  };
}

/** The podium's picture, the same way; one that cannot be made takes its canvas away, so the standings stand on the night behind them. */
export function lazyPodium(canvas: HTMLCanvasElement, make: () => Promise<PodiumRenderer>): PodiumRenderer {
  let real: PodiumRenderer | null = null;
  let disposed = false;
  let winners: readonly PodiumEntry[] | null = null;
  let size: [number, number, number] | null = null;
  void make().then(
    (made) => {
      if (disposed) {
        made.dispose();
        return;
      }
      real = made;
      if (size) made.resize(...size);
      if (winners) made.show(winners);
    },
    () => canvas.remove(),
  );
  return {
    show(entries) {
      winners = entries;
      real?.show(entries);
    },
    frame(dt) {
      real?.frame(dt);
    },
    resize(width, height, dpr) {
      size = [width, height, dpr];
      real?.resize(width, height, dpr);
    },
    dispose() {
      disposed = true;
      real?.dispose();
      real = null;
    },
  };
}
