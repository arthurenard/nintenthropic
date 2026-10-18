/**
 * Noticing a landmarker whose GPU has gone.
 *
 * Chrome restarts its GPU's process after a driver fault, or after a frame that
 * hung the GPU, and every WebGL context on the page and in its workers is lost
 * with it. A landmarker reading on the GPU delegate then finds nothing, on every
 * frame from then on, without an error: measured in headless Chrome tracking
 * e2e/fixtures/hand.jpg in the worker with the GPU's process crashed (CDP
 * Browser.crashGpuProcess), 30 frames a second read and not one hand, for
 * good: the player is shown "Show Your Hand" until the page is reloaded (the
 * page keeps its tracker for every round, so Try Again does not mend it). The
 * CPU delegate read on through it.
 *
 * So a task made on the GPU is handed a canvas of its own (MediaPipe's `canvas`
 * option: it would otherwise make an OffscreenCanvas of 1x1 itself), and the
 * context MediaPipe made there is asked, once a frame, whether it is lost
 * (inference.worker.ts makes a lost one again).
 */

/** The part of a WebGL context asked here. */
interface Context {
  isContextLost(): boolean;
}

export class GpuWatch {
  private readonly contexts = new WeakMap<object, Context>();

  constructor(private readonly makeCanvas: () => OffscreenCanvas | undefined = () => (typeof OffscreenCanvas === "undefined" ? undefined : new OffscreenCanvas(1, 1))) {}

  /** The canvas for a task made on `delegate`: one of its own on the GPU, to watch; none on the CPU (MediaPipe needs none there). */
  canvasFor(delegate: "GPU" | "CPU"): OffscreenCanvas | undefined {
    return delegate === "GPU" ? this.makeCanvas() : undefined;
  }

  /**
   * Remembers the context of the canvas a task was made on. MediaPipe makes it while the task starts, and asks for it
   * the same way on every frame (webgl2, else webgl), so this finds that one and makes none of its own.
   */
  watch<T extends object>(task: T, canvas: OffscreenCanvas | undefined): T {
    const context: Context | null | undefined = canvas && (canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
    if (context && typeof context.isContextLost === "function") this.contexts.set(task, context);
    return task;
  }

  /** Whether the task's GPU has gone (false for one on the CPU, or none). */
  lost(task: object | null | undefined): boolean {
    return !!task && this.contexts.get(task)?.isContextLost() === true;
  }
}
