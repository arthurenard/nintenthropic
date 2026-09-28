import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DownloadError, STALL_AFTER, fetchBytes } from "./fetch";

/** A body that hands out `chunks` bytes at the given times (ms from the start), then ends - or never does. */
function trickle(parts: { at: number; bytes: number }[], end: number | null): ReadableStream<Uint8Array> {
  let cancelled = false;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of parts) setTimeout(() => !cancelled && controller.enqueue(new Uint8Array(part.bytes)), part.at);
      if (end !== null) setTimeout(() => !cancelled && controller.close(), end);
    },
    cancel() {
      cancelled = true;
    },
  });
}

/** fetch() answering with `body` after `headersAt` ms, or never; it honours the abort signal, as the browser's does. */
function fakeFetch(body: () => ReadableStream<Uint8Array>, headersAt: number | null = 0, length?: number) {
  return vi.fn((_url: string, init?: RequestInit) => {
    return new Promise<Response>((resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("The download was aborted.", "AbortError")));
      if (headersAt === null) return;
      setTimeout(() => resolve(new Response(body(), { headers: length ? { "Content-Length": String(length) } : {} })), headersAt);
    });
  });
}

describe("downloads that stall", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("give up when nothing has arrived for twenty seconds", async () => {
    vi.stubGlobal("fetch", fakeFetch(() => trickle([{ at: 100, bytes: 450 }], null), 0, 1000));
    const progress: number[] = [];
    const download = fetchBytes("models/hand.task", (f) => progress.push(f));
    const outcome = download.then(
      () => null,
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(STALL_AFTER - 1000);
    expect(progress.at(-1)).toBeCloseTo(0.45, 2); // "Getting ready… 45%", and then nothing
    await vi.advanceTimersByTimeAsync(2000);
    const error = await outcome;
    expect(error).toBeInstanceOf(DownloadError);
    expect((error as DownloadError).stalled).toBe(true);
    expect((error as DownloadError).url).toBe("models/hand.task");
  });

  it("give up on a server that never answers", async () => {
    vi.stubGlobal("fetch", fakeFetch(() => trickle([], null), null));
    const outcome = fetchBytes("assets/town.glb").then(
      () => null,
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(STALL_AFTER + 100);
    const error = await outcome;
    expect(error).toBeInstanceOf(DownloadError);
    expect((error as DownloadError).stalled).toBe(true);
  });

  it("wait as long as it takes while bytes keep arriving", async () => {
    // A slow line: a piece every fifteen seconds, for a minute.
    const parts = [1, 2, 3, 4].map((i) => ({ at: i * 15_000, bytes: 250 }));
    vi.stubGlobal("fetch", fakeFetch(() => trickle(parts, 61_000), 0, 1000));
    let done: ArrayBuffer | null = null;
    const download = fetchBytes("assets/sky.webp", () => {}).then((bytes) => (done = bytes));
    await vi.advanceTimersByTimeAsync(62_000);
    await download;
    expect(done).not.toBeNull();
    expect(done!.byteLength).toBe(1000);
  });

  it("say which file failed, and that it failed, when the server refuses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("missing", { status: 404 })),
    );
    const error = await fetchBytes("assets/chicken.glb").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DownloadError);
    expect((error as DownloadError).status).toBe(404);
    expect((error as DownloadError).stalled).toBe(false);
    // Nothing left waiting to fire later.
    expect(vi.getTimerCount()).toBe(0);
  });
});
