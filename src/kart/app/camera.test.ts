import { describe, expect, it, vi } from "vitest";
import { CameraError, type Camera } from "../../tracking/camera";
import type { Tracker } from "../../tracking/tracker";
import type { HandFrame, HandSource } from "../../tracking/types";
import { CameraStack, SwitchableSource } from "./camera";
import { CameraFailure } from "./services";

const frame = (sequence: number): HandFrame => ({ landmarks: null, handedness: null, hands: [], capturedAt: sequence, sequence });

/** A hand source a test can publish to. */
function source(): HandSource & { publish(f: HandFrame): void; listeners: number } {
  const listeners = new Set<(f: HandFrame) => void>();
  let newest: HandFrame | null = null;
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    latest: () => newest,
    publish(f) {
      newest = f;
      for (const listener of [...listeners]) listener(f);
    },
    get listeners() {
      return listeners.size;
    },
  };
}

describe("a source that follows whichever tracker is current", () => {
  it("passes on a tracker's frames to listeners that were there before it", () => {
    const stack = new SwitchableSource();
    const heard: number[] = [];
    stack.subscribe((f) => heard.push(f.sequence));
    const first = source();
    stack.use(first);
    first.publish(frame(1));
    expect(heard).toEqual([1]);
    expect(stack.latest()?.sequence).toBe(1);

    // A tracker for a different number of hands replaces it: the old one is let go of.
    const second = source();
    stack.use(second);
    first.publish(frame(2));
    second.publish(frame(3));
    expect(heard).toEqual([1, 3]);
    expect(first.listeners).toBe(0);
    stack.use(null);
    second.publish(frame(4));
    expect(heard).toEqual([1, 3]);
    expect(stack.latest()).toBeNull();
  });

  it("stops passing frames to a listener that left", () => {
    const stack = new SwitchableSource();
    const a = source();
    stack.use(a);
    const heard: number[] = [];
    const stop = stack.subscribe((f) => heard.push(f.sequence));
    a.publish(frame(1));
    stop();
    a.publish(frame(2));
    expect(heard).toEqual([1]);
  });
});

/** A camera and tracker that count what is done to them. */
function parts() {
  const video = {} as HTMLVideoElement;
  const cameras: { stopped: boolean; size: { width: number; height: number } }[] = [];
  const trackers: { hands: number; started: boolean; disposed: boolean; source: ReturnType<typeof source> }[] = [];
  const stack = new CameraStack({
    makeVideo: () => video,
    open: async (_video, size) => {
      const camera = { stopped: false, size };
      cameras.push(camera);
      return { stop: () => (camera.stopped = true) } as unknown as Camera;
    },
    load: async (hands, progress) => {
      progress(0.5);
      progress(1);
      const made = source();
      const record = { hands, started: false, disposed: false, source: made };
      trackers.push(record);
      return {
        subscribe: made.subscribe,
        latest: made.latest,
        start: () => (record.started = true),
        stop: () => {},
        dispose: () => (record.disposed = true),
        counts: () => ({ frames: 40 * hands, skipped: hands, columns: hands / 2 }),
      } as unknown as Tracker;
    },
  });
  return { stack, cameras, trackers, video };
}

describe("the camera and the tracker behind the wheels", () => {
  it("says the tracker's counts while there is one, for the race to make room for it", async () => {
    const { stack } = parts();
    expect(stack.counts()).toBeNull();
    await stack.start(6);
    expect(stack.counts()).toEqual({ frames: 240, skipped: 6, columns: 3 });
    stack.stop();
    expect(stack.counts()).toBeNull();
  });

  it("opens the camera once, loads the tracker for the hands asked, and reports the download", async () => {
    const { stack, cameras, trackers, video } = parts();
    const seen: number[] = [];
    await stack.start(2, (fraction) => seen.push(fraction));
    expect(seen).toEqual([0.5, 1]);
    expect(cameras).toHaveLength(1);
    expect(trackers).toHaveLength(1);
    expect(trackers[0]).toMatchObject({ hands: 2, started: true });
    expect(stack.video).toBe(video);

    // The same again changes nothing.
    await stack.start(2);
    expect(cameras).toHaveLength(1);
    expect(trackers).toHaveLength(1);

    // Two on one camera: four hands, a new tracker, the same camera.
    await stack.start(4);
    expect(cameras).toHaveLength(1);
    expect(trackers).toHaveLength(2);
    expect(trackers[0]!.disposed).toBe(true);
    expect(trackers[1]).toMatchObject({ hands: 4, started: true });
    // A wheel built before any of it reads from the new tracker.
    const heard: number[] = [];
    stack.source.subscribe((f) => heard.push(f.sequence));
    trackers[1]!.source.publish(frame(7));
    trackers[0]!.source.publish(frame(8));
    expect(heard).toEqual([7]);
  });

  it("asks a crowd of three or four players for a bigger picture, and opens the camera again to do it", async () => {
    const { stack, cameras, trackers } = parts();
    await stack.start(4);
    expect(cameras[0]!.size).toEqual({ width: 1280, height: 720 });
    // Three players on one camera: six hands, a bigger picture, the first camera let go of.
    await stack.start(6);
    expect(cameras).toHaveLength(2);
    expect(cameras[0]!.stopped).toBe(true);
    expect(cameras[1]!.size).toEqual({ width: 1920, height: 1080 });
    expect(trackers[1]).toMatchObject({ hands: 6, started: true });
    // Four players: the same camera, a tracker for eight hands.
    await stack.start(8);
    expect(cameras).toHaveLength(2);
    expect(trackers[2]).toMatchObject({ hands: 8, started: true });
    expect(trackers[1]!.disposed).toBe(true);
    // And back to two: the smaller picture again.
    await stack.start(2);
    expect(cameras).toHaveLength(3);
    expect(cameras[2]!.size).toEqual({ width: 1280, height: 720 });
  });

  it("lets go of everything when stopped", async () => {
    const { stack, cameras, trackers } = parts();
    await stack.start(2);
    stack.stop();
    expect(cameras[0]!.stopped).toBe(true);
    expect(trackers[0]!.disposed).toBe(true);
    // And starts afresh after.
    await stack.start(2);
    expect(cameras).toHaveLength(2);
  });

  it("lets go of what a start opened if the player left before it was done", async () => {
    const { stack, cameras, trackers } = parts();
    const starting = stack.start(2);
    stack.stop();
    await starting;
    expect(cameras.every((camera) => camera.stopped)).toBe(true);
    expect(trackers.every((tracker) => tracker.disposed || !tracker.started)).toBe(true);
  });

  it("says why it could not start, in the screens' words", async () => {
    const denied = new CameraStack({
      makeVideo: () => ({}) as HTMLVideoElement,
      open: async () => {
        throw new CameraError("denied");
      },
    });
    await expect(denied.start(2)).rejects.toMatchObject({ trouble: "denied" });
    await expect(denied.start(2)).rejects.toBeInstanceOf(CameraFailure);

    vi.spyOn(console, "warn").mockImplementation(() => {});
    const model = new CameraStack({
      makeVideo: () => ({}) as HTMLVideoElement,
      open: async () => ({ stop() {} }) as unknown as Camera,
      load: async () => {
        throw new Error("the model did not download");
      },
    });
    await expect(model.start(2)).rejects.toMatchObject({ trouble: "model" });
  });
});
