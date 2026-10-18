/**
 * The library's pool of render workers, with stand-in workers the test
 * answers by hand (Node has no Worker, and the timing is the point).
 * Nothing is played.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cuesInPack } from "./cues/table";
import { SoundLibrary } from "./library";
import type { RenderJob, RenderReply } from "./protocol";
import { takeCount } from "./render";

class FakeWorker {
  static made: FakeWorker[] = [];
  onmessage: ((event: { data: RenderReply }) => void) | null = null;
  onerror: (() => void) | null = null;
  /** Jobs handed over and not yet answered, oldest first. */
  held: RenderJob[] = [];
  terminated = false;

  constructor() {
    FakeWorker.made.push(this);
  }

  postMessage(jobs: RenderJob[]): void {
    this.held.push(...jobs);
  }

  /** Finish the oldest job it holds, as a worker would. */
  answer(): RenderJob {
    const job = this.held.shift()!;
    const channels = [new Float32Array(480).fill(0.1)];
    this.onmessage!({ data: { id: job.id, cue: job.cue, take: job.take, sampleRate: job.sampleRate, channels, envelope: new Float32Array(1), ms: 1 } });
    return job;
  }

  terminate(): void {
    this.terminated = true;
  }
}

const ctx = {
  sampleRate: 48000,
  createBuffer: (channels: number, length: number, sampleRate: number) => ({ numberOfChannels: channels, length, sampleRate, duration: length / sampleRate, copyToChannel() {} }),
} as unknown as BaseAudioContext;

describe("the render workers", () => {
  beforeEach(() => {
    FakeWorker.made = [];
    vi.stubGlobal("Worker", FakeWorker);
    vi.spyOn(console, "info").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("keeps two jobs with every worker, so none waits on a busy page for its next", () => {
    const library = new SoundLibrary(ctx, 1, 2);
    void library.load("core");
    const [a, b] = FakeWorker.made;
    expect(a!.held).toHaveLength(2);
    expect(b!.held).toHaveLength(2);
    a!.answer();
    expect(a!.held).toHaveLength(2); // handed the next at once
    expect(b!.held).toHaveLength(2);
    library.dispose();
  });

  it("finishes a pack, and one whose worker died finishes on the others with nothing lost", async () => {
    const library = new SoundLibrary(ctx, 1, 2);
    let progress = 0;
    const done = library.load("core", (f) => (progress = f));
    const [a, b] = FakeWorker.made;
    a!.answer();
    // b dies holding two jobs: they go back in the queue, to a.
    b!.onerror!();
    expect(b!.terminated).toBe(true);
    while (a!.held.length) a!.answer();
    await done;
    expect(progress).toBe(1);
    const takes = cuesInPack("core").reduce((n, cue) => n + takeCount(cue), 0);
    for (const cue of cuesInPack("core")) expect(library.get(cue)?.length, cue).toBe(takeCount(cue));
    expect(takes).toBeGreaterThan(4);
    library.dispose();
  });

  it("gives a sound asked for now to the next worker free", () => {
    const library = new SoundLibrary(ctx, 1, 1);
    void library.load("core");
    const [a] = FakeWorker.made;
    const wanted = cuesInPack("core").find((cue) => !a!.held.some((job) => job.cue === cue))!;
    void library.request(wanted);
    a!.answer();
    expect(a!.held.at(-1)!.cue).toBe(wanted);
    library.dispose();
  });
});
