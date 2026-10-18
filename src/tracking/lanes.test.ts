import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TRY_FRAMES } from "./adapt";
import type { FromWorker, ToWorker } from "./protocol";
import { makeLaneTracker } from "./tracker";
import type { HandFrame, SeenHand } from "./types";

/** A worker that keeps what it is sent and answers when told to. */
class FakeWorker {
  readonly sent: ToWorker[] = [];
  private readonly listeners: ((event: MessageEvent<FromWorker>) => void)[] = [];
  terminated = false;
  addEventListener(_type: "message", listener: (event: MessageEvent<FromWorker>) => void): void {
    this.listeners.push(listener);
  }
  postMessage(message: ToWorker): void {
    this.sent.push(message);
  }
  terminate(): void {
    this.terminated = true;
  }
  answer(message: FromWorker): void {
    for (const listener of this.listeners) listener({ data: message } as MessageEvent<FromWorker>);
  }
  /** The frames it was handed. */
  get frames(): Extract<ToWorker, { type: "frame" }>[] {
    return this.sent.filter((m): m is Extract<ToWorker, { type: "frame" }> => m.type === "frame");
  }
}

/** A VideoFrame that remembers the part of the picture it was cut to. */
class FakeFrame {
  closed = false;
  constructor(
    readonly source: unknown,
    readonly init: { timestamp: number; visibleRect?: { x: number; y: number; width: number; height: number } },
  ) {}
  close(): void {
    this.closed = true;
  }
}

/** A hand in the middle of a tile's own picture. */
const hand = (x = 0.5): SeenHand => {
  const landmarks = Array.from({ length: 21 }, (_, i) => ({ x: x + (i % 5) * 0.004, y: 0.5 - (i % 4) * 0.01, z: 0 }));
  return { landmarks, world: landmarks, handedness: null, score: 0.9 };
};

describe("players sharing a camera, each read in a worker of their own", () => {
  let callbacks: ((now: number, metadata: { captureTime: number }) => void)[] = [];
  const video = {
    videoWidth: 1920,
    videoHeight: 1080,
    requestVideoFrameCallback: (callback: (now: number, metadata: { captureTime: number }) => void) => callbacks.push(callback),
    cancelVideoFrameCallback: () => {},
  } as unknown as HTMLVideoElement;
  /** The camera delivers a frame: every lane due and free is sent its column. */
  const tick = (at: number) => {
    const due = callbacks;
    callbacks = [];
    for (const callback of due) callback(at, { captureTime: at });
  };

  beforeEach(() => {
    callbacks = [];
    vi.stubGlobal("VideoFrame", FakeFrame);
    vi.stubGlobal("performance", { now: () => 1000 });
    vi.stubGlobal("cancelAnimationFrame", () => {});
  });
  afterEach(() => vi.unstubAllGlobals());

  const make = (delegates: ("GPU" | "CPU")[], adapt = false) => {
    const workers = delegates.map(() => new FakeWorker());
    const tracker = makeLaneTracker(
      workers.map((worker, i) => ({ worker: worker as unknown as Worker, delegate: delegates[i]! })),
      adapt,
    );
    return { tracker, workers };
  };

  it("hands each worker its own column of the frame, cut on even pixels, and drops a frame for a worker still busy", () => {
    const { tracker, workers } = make(["GPU", "CPU", "CPU"]);
    tracker.start(video);
    tick(100);
    const rects = workers.map((w) => (w.frames[0]!.image as unknown as FakeFrame).init.visibleRect!);
    expect(rects[0]!.x).toBe(0);
    expect(rects[2]!.x + rects[2]!.width).toBe(1920);
    for (const rect of rects) {
      expect(rect.x % 2).toBe(0);
      expect(rect.width % 2).toBe(0);
      expect(rect.height).toBe(1080);
    }
    // The second column overlaps both neighbours.
    expect(rects[1]!.x).toBeLessThan(rects[0]!.x + rects[0]!.width);
    // Nobody has answered: the next frame is dropped for all three.
    tick(133);
    expect(workers.map((w) => w.frames.length)).toEqual([1, 1, 1]);
    expect(tracker.counts()).toEqual({ frames: 0, skipped: 3, columns: 3 });
  });

  it("publishes each column's news as soon as it comes, naming the column read, with the others' hands as last seen", () => {
    const { tracker, workers } = make(["GPU", "CPU"]);
    const frames: HandFrame[] = [];
    tracker.subscribe((frame) => frames.push(frame));
    tracker.start(video);
    tick(100);
    workers[1]!.answer({ type: "result", sequence: 0, capturedAt: 100, hands: [hand(0.4)], inference: 20, face: false });
    expect(frames).toHaveLength(1);
    const right = frames[0]!.read![0]!;
    expect(right[0]).toBeGreaterThan(0.4);
    expect(right[1]).toBe(1);
    expect(frames[0]!.hands).toHaveLength(1);
    // The first column's answer: both columns' hands, the first's read.
    workers[0]!.answer({ type: "result", sequence: 0, capturedAt: 100, hands: [hand(0.5)], inference: 25, face: false });
    expect(frames).toHaveLength(2);
    expect(frames[1]!.read![0]![0]).toBe(0);
    expect(frames[1]!.hands).toHaveLength(2);
    expect(tracker.counts().frames).toBe(2);
    // Each worker is free again for the next camera frame.
    tick(133);
    expect(workers.map((w) => w.frames.length)).toEqual([2, 2]);
  });

  it("asks a slow worker to try the other delegate, one worker at a time, and never a second onto the GPU", () => {
    const { tracker, workers } = make(["GPU", "CPU"], true);
    tracker.start(video);
    // Both slow, frame after frame.
    for (let f = 0; f < 120; f++) {
      tick(100 + f * 33);
      for (const worker of workers) worker.answer({ type: "result", sequence: f, capturedAt: 100 + f * 33, hands: [hand()], inference: 70, face: false });
    }
    const tries = workers.map((w) => w.sent.filter((m) => m.type === "try"));
    // The GPU worker tries the CPU; the CPU worker may not try the GPU while the first has it.
    expect(tries[0]).toEqual([{ type: "try", delegate: "CPU", frames: TRY_FRAMES }]);
    expect(tries[1]).toEqual([]);
    // It kept the CPU: the GPU is free, and the other may try it once its turn comes.
    workers[0]!.answer({ type: "tried", kept: "CPU", times: { GPU: 70, CPU: 40 } });
    expect(tracker.delegates).toEqual(["CPU", "CPU"]);
    for (let f = 120; f < 200; f++) {
      tick(100 + f * 33);
      for (const worker of workers) worker.answer({ type: "result", sequence: f, capturedAt: 100 + f * 33, hands: [hand()], inference: 70, face: false });
    }
    expect(workers[1]!.sent.filter((m) => m.type === "try")).toEqual([{ type: "try", delegate: "GPU", frames: TRY_FRAMES }]);
  });

  it("follows a worker made again on another delegate, its GPU gone", () => {
    const { tracker, workers } = make(["GPU", "CPU"], true);
    tracker.start(video);
    workers[0]!.answer({ type: "restarted", delegate: "CPU" });
    expect(tracker.delegates).toEqual(["CPU", "CPU"]);
    // Its frames go on as before.
    tick(100);
    workers[0]!.answer({ type: "result", sequence: 0, capturedAt: 100, hands: [hand()], inference: 20, face: false });
    tick(133);
    expect(workers[0]!.frames).toHaveLength(2);
  });

  it("counts a frame a busy worker missed only at a reading's pace: a 60 fps camera's in-between frames are not drops", () => {
    const { tracker, workers } = make(["GPU", "CPU"]);
    tracker.start(video);
    for (let f = 0; f < 60; f++) {
      const at = 100 + f * (1000 / 60);
      tick(at);
      // Each worker takes 25 ms: it is free again for every other frame.
      if (f % 2 === 1) for (const worker of workers) worker.answer({ type: "result", sequence: f, capturedAt: at, hands: [hand()], inference: 25, face: false });
    }
    const counts = tracker.counts();
    expect(counts.frames).toBeGreaterThan(55);
    expect(counts.skipped).toBe(0);
    expect(tracker.stats().skipped).toBeGreaterThan(50);
  });

  it("stops by cancelling the camera's callback, never an animation frame that happens to have its number", () => {
    const cancelled: string[] = [];
    vi.stubGlobal("cancelAnimationFrame", (id: number) => cancelled.push(`animation ${id}`));
    let ids = 0;
    const camera = {
      ...video,
      requestVideoFrameCallback: (callback: (now: number, metadata: { captureTime: number }) => void) => {
        callbacks.push(callback);
        return ++ids;
      },
      cancelVideoFrameCallback: (id: number) => cancelled.push(`video ${id}`),
    } as unknown as HTMLVideoElement;
    const { tracker } = make(["GPU", "CPU"]);
    tracker.start(camera);
    tick(100);
    tracker.stop();
    // The video's callbacks are counted from 1, as the game loop's animation frames are: #2 is both.
    expect(cancelled).toEqual(["video 2"]);
    tracker.stop();
    expect(cancelled).toEqual(["video 2"]);
  });

  it("lets every worker go when it is done", () => {
    const { tracker, workers } = make(["GPU", "CPU", "CPU", "CPU"]);
    tracker.start(video);
    tracker.dispose();
    expect(workers.every((w) => w.terminated)).toBe(true);
  });
});
