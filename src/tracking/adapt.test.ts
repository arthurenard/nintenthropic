import { describe, expect, it } from "vitest";
import { DelegateWatch, LOOK, LOOK_LEAST, LOOK_MS, RETRY_MOST, RETRY_MS, SETTLE, SLOW_MS, Trials } from "./adapt";

/** Feeds `count` frames of `ms` each, 33 ms apart from `from`; returns the first proposal and when it came. */
function feed(watch: DelegateWatch, ms: number, count: number, from = 0): { proposal: string | null; at: number } {
  for (let i = 0; i < count; i++) {
    const at = from + i * 33;
    const proposal = watch.push(ms, at);
    if (proposal) return { proposal, at };
  }
  return { proposal: null, at: from + count * 33 };
}

describe("when a tracking worker tries the other delegate", () => {
  it("never, while its landmarker keeps up", () => {
    expect(feed(new DelegateWatch("GPU"), SLOW_MS - 5, 1000).proposal).toBeNull();
  });

  it("once it has been slow for the frames it looks at, past the first ones (shaders being built)", () => {
    const watch = new DelegateWatch("GPU");
    // The first SETTLE frames are left out, however slow.
    expect(feed(watch, 500, SETTLE).proposal).toBeNull();
    const ms = SLOW_MS + 20;
    const slow = feed(watch, ms, 2 * LOOK);
    expect(slow.proposal).toBe("CPU");
    // A second and a half of reading, at most LOOK frames.
    expect(slow.at).toBe((Math.min(LOOK, Math.max(LOOK_LEAST, Math.ceil(LOOK_MS / ms))) - 1) * 33);
  });

  it("within a few frames when each takes seconds (a GPU drawn in software)", () => {
    const watch = new DelegateWatch("GPU");
    feed(watch, 12_000, SETTLE);
    const slow = feed(watch, 12_000, LOOK);
    expect(slow.proposal).toBe("CPU");
    expect(slow.at).toBe((LOOK_LEAST - 1) * 33);
  });

  it("not for a slow frame or two among quick ones", () => {
    const watch = new DelegateWatch("CPU");
    for (let i = 0; i < 400; i++) expect(watch.push(i % 4 === 0 ? 120 : 20, i * 33)).toBeNull();
  });

  it("proposes the GPU to a slow CPU worker, and nothing more while the try runs", () => {
    const watch = new DelegateWatch("CPU");
    const first = feed(watch, 70, SETTLE + LOOK);
    expect(first.proposal).toBe("GPU");
    watch.start();
    expect(feed(watch, 70, 200, first.at).proposal).toBeNull();
  });

  it("keeps what the try kept, settles again after a change, and asks again only after a while", () => {
    const watch = new DelegateWatch("GPU");
    const first = feed(watch, 70, SETTLE + LOOK);
    watch.start();
    watch.tried("CPU", first.at);
    expect(watch.delegate).toBe("CPU");
    // Still slow on the CPU: no new try before RETRY_MS.
    const soon = feed(watch, 70, Math.floor(RETRY_MS / 33) - 5, first.at + 33);
    expect(soon.proposal).toBeNull();
    const later = feed(watch, 70, 200, first.at + RETRY_MS);
    expect(later.proposal).toBe("GPU");
  });
});

describe("a worker whose landmarker was made again (its GPU went)", () => {
  it("reads on the delegate it was made on, measured afresh, and is not asked to try for a while", () => {
    const watch = new DelegateWatch("GPU");
    feed(watch, 70, SETTLE + LOOK - 3);
    watch.restarted("CPU", 5000);
    expect(watch.delegate).toBe("CPU");
    // The old landmarker's slow frames are forgotten, the first of the new one's left out, and no try within RETRY_MS.
    expect(feed(watch, 70, Math.floor(RETRY_MS / 33) - 5, 5033).proposal).toBeNull();
    expect(feed(watch, 70, 200, 5000 + RETRY_MS).proposal).toBe("GPU");
  });
});

describe("a worker slow on both delegates", () => {
  it("is asked again less and less often, not every minute", () => {
    const watch = new DelegateWatch("GPU");
    let at = 0;
    const asked: number[] = [];
    while (at < 30 * 60_000) {
      const proposal = feed(watch, 70, 4000, at);
      at = proposal.at + 33;
      if (!proposal.proposal) continue;
      asked.push(proposal.at);
      watch.start();
      // The try changes nothing: the other is as slow.
      watch.tried("GPU", proposal.at);
    }
    const gaps = asked.slice(1).map((t, i) => t - asked[i]!);
    expect(gaps[0]).toBeGreaterThanOrEqual(RETRY_MS);
    expect(gaps[1]!).toBeGreaterThanOrEqual(2 * RETRY_MS);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(RETRY_MOST + 5000);
    expect(asked.length).toBeLessThan(10);
  });
});

describe("tries across a tracker's workers", () => {
  it("are one at a time", () => {
    const trials = new Trials();
    expect(trials.begin()).toBe(true);
    expect(trials.begin()).toBe(false);
    trials.end();
    expect(trials.begin()).toBe(true);
  });
});
