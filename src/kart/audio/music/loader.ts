/**
 * Making the music, off the page's critical path. A piece is synthesised once
 * (about 0.4 s of DSP for a minute of music on a laptop) in a Worker so no
 * frame is held; where Workers are unavailable (a strict policy, Node under
 * tests) the same stages run on the main thread one at a time with a yield
 * between, so no frame is held for longer than one part's worth of synthesis.
 */
import { PIECES, type PieceId } from "./pieces";
import type { MusicJob, MusicReply } from "./protocol";
import { MUSIC_SAMPLE_RATE, PieceRenderer, type RenderedMusic } from "./render";

/** The final lap: the same piece this much faster and this many semitones higher. */
export const FINAL_LAP = { tempoScale: 1.1, transpose: 1 } as const;

export interface MusicRenderer {
  /** Render a piece (or its final-lap version); ``onProgress`` gets 0..1. */
  render(id: PieceId, final: boolean, onProgress?: (fraction: number) => void): Promise<RenderedMusic>;
  dispose(): void;
}

const yieldToMain = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** Render on this thread, a stage at a time. */
export async function renderOnMainThread(
  id: PieceId,
  final: boolean,
  onProgress?: (fraction: number) => void,
  sampleRate = MUSIC_SAMPLE_RATE,
): Promise<RenderedMusic> {
  const spec = PIECES[id];
  if (!spec) throw new Error(`no piece "${id}"`);
  const renderer = new PieceRenderer(spec, { sampleRate, ...(final ? FINAL_LAP : {}) });
  const stages = renderer.stages();
  for (let k = 0; k < stages.length; k++) {
    stages[k]!();
    onProgress?.((k + 1) / stages.length);
    await yieldToMain();
  }
  return renderer.finished();
}

interface Pending {
  resolve: (r: RenderedMusic) => void;
  reject: (e: Error) => void;
  onProgress?: (fraction: number) => void;
  id: PieceId;
  final: boolean;
}

/**
 * A renderer that uses up to two Workers (the normal and the final-lap
 * version of a track render side by side) and falls back to the main thread.
 */
export function createMusicRenderer(mode: "auto" | "worker" | "main" = "auto", sampleRate = MUSIC_SAMPLE_RATE): MusicRenderer {
  const canWork = mode !== "main" && typeof Worker !== "undefined";
  const workers: Worker[] = [];
  const idle: Worker[] = [];
  const pending = new Map<number, Pending>();
  const queue: { job: number; pending: Pending }[] = [];
  const busyWith = new Map<Worker, number>();
  let next = 1;
  let disposed = false;
  let broken = !canWork;

  const dispatch = (): void => {
    while (queue.length > 0 && !broken && !disposed) {
      let worker = idle.pop();
      if (!worker && workers.length < 2) {
        try {
          worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module", name: "grip-prix-music" });
          worker.onmessage = (event: MessageEvent<MusicReply>) => received(worker!, event.data);
          worker.onerror = () => failed(worker!);
          workers.push(worker);
        } catch {
          broken = true;
          drainToMain();
          return;
        }
      }
      if (!worker) return;
      const item = queue.shift()!;
      busyWith.set(worker, item.job);
      const message: MusicJob = { job: item.job, id: item.pending.id, sampleRate, ...(item.pending.final ? FINAL_LAP : { tempoScale: 1, transpose: 0 }) };
      worker.postMessage(message);
    }
  };

  const received = (worker: Worker, reply: MusicReply): void => {
    const p = pending.get(reply.job);
    if (!p) return;
    if ("progress" in reply) {
      p.onProgress?.(reply.progress);
      return;
    }
    pending.delete(reply.job);
    busyWith.delete(worker);
    idle.push(worker);
    if ("error" in reply) p.reject(new Error(reply.error));
    else p.resolve(reply.result);
    dispatch();
  };

  /** A worker died (a policy, an out-of-memory): its job and everything queued run on the main thread instead. */
  const failed = (worker: Worker): void => {
    broken = true;
    const job = busyWith.get(worker);
    if (job !== undefined) {
      const p = pending.get(job);
      if (p) queue.unshift({ job, pending: p });
    }
    worker.terminate();
    drainToMain();
  };

  const drainToMain = (): void => {
    for (const item of queue.splice(0)) {
      const p = item.pending;
      pending.delete(item.job);
      renderOnMainThread(p.id, p.final, p.onProgress, sampleRate).then(p.resolve, p.reject);
    }
  };

  return {
    render(id, final, onProgress) {
      if (disposed) return Promise.reject(new Error("the music renderer was disposed"));
      if (broken) return renderOnMainThread(id, final, onProgress, sampleRate);
      return new Promise<RenderedMusic>((resolve, reject) => {
        const job = next++;
        const p: Pending = { resolve, reject, onProgress, id, final };
        pending.set(job, p);
        queue.push({ job, pending: p });
        dispatch();
      });
    },
    dispose() {
      disposed = true;
      for (const w of workers) w.terminate();
      workers.length = 0;
      for (const p of pending.values()) p.reject(new Error("the music renderer was disposed"));
      pending.clear();
      queue.length = 0;
    },
  };
}
