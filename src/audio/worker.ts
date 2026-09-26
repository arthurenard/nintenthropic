/**
 * A render worker: synthesises takes off the main thread, so building the
 * library never costs the page a frame, and hands the samples back without
 * copying them (the arrays' buffers are transferred).
 */
import type { RenderJob, RenderReply } from "./protocol";
import { renderTake } from "./render";

interface WorkerScope {
  onmessage: ((event: MessageEvent<RenderJob[]>) => void) | null;
  postMessage(message: RenderReply, transfer: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;

/** An array that owns its whole buffer can be transferred; a view into a larger one is copied first. */
function owned(a: Float32Array): Float32Array {
  return a.byteOffset === 0 && a.byteLength === a.buffer.byteLength ? a : a.slice();
}

scope.onmessage = (event) => {
  for (const job of event.data) {
    const t0 = performance.now();
    try {
      const r = renderTake(job.cue, job.take, { sampleRate: job.sampleRate, seed: job.seed });
      const channels = r.channels.map(owned);
      const envelope = owned(r.envelope);
      scope.postMessage(
        { id: job.id, cue: job.cue, take: job.take, sampleRate: job.sampleRate, channels, envelope, ms: performance.now() - t0 },
        [...channels.map((c) => c.buffer as ArrayBuffer), envelope.buffer as ArrayBuffer],
      );
    } catch (error) {
      scope.postMessage({ id: job.id, cue: job.cue, take: job.take, error: String(error) }, []);
    }
  }
};
