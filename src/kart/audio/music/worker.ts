/**
 * A music render worker: synthesises one piece off the main thread, reporting
 * progress stage by stage, and hands the finished samples back without
 * copying them. The page never drops a frame while a track is made.
 */
import { PIECES, type PieceId } from "./pieces";
import { PieceRenderer } from "./render";
import type { MusicJob, MusicReply } from "./protocol";

interface WorkerScope {
  onmessage: ((event: MessageEvent<MusicJob>) => void) | null;
  postMessage(message: MusicReply, transfer?: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = (event) => {
  const job = event.data;
  try {
    const spec = PIECES[job.id as PieceId];
    if (!spec) throw new Error(`no piece "${job.id}"`);
    const renderer = new PieceRenderer(spec, { sampleRate: job.sampleRate, tempoScale: job.tempoScale, transpose: job.transpose });
    const stages = renderer.stages();
    stages.forEach((stage, k) => {
      stage();
      scope.postMessage({ job: job.job, progress: (k + 1) / stages.length });
    });
    const result = renderer.finished();
    const transfer = [result.left, result.right, result.comet?.left, result.comet?.right, result.stinger?.left, result.stinger?.right]
      .filter((a): a is Float32Array => !!a)
      .map((a) => a.buffer as ArrayBuffer);
    scope.postMessage({ job: job.job, result }, transfer);
  } catch (error) {
    scope.postMessage({ job: job.job, error: String(error) });
  }
};
