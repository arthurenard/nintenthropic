/**
 * Which delegate a tracking worker's landmarker should run on, learnt on the machine it runs on.
 *
 * The GPU is the quicker on most computers, alone. Beside a race it is not always: the race's frames and the
 * landmarker take turns on the one GPU, at every step of a read on the GPU delegate; the CPU delegate waits on it too
 * (MediaPipe takes every picture in through WebGL), but less. Which is quicker depends on the machine and on what the
 * race asks of its GPU, and cannot be told from the GPU's name or the number of cores (but for a GPU drawn in software,
 * which the worker leaves alone from the start), so it is measured where it matters: a worker whose landmarker has been
 * slow (its median over the last LOOK frames, or over at least LOOK_LEAST that took LOOK_MS between them, above
 * SLOW_MS) is asked to try the other delegate (inference.worker.ts: both read frames in turn for TRY_FRAMES, or until
 * one is plainly the quicker, and the quicker is kept). The same worker is not asked again for RETRY_MS (longer each
 * time a try changed nothing), and only one worker tries at a time (Trials).
 */

/** A landmarker slower than this (median, ms per camera frame) is worth a try of the other delegate: under ~25 reads a second. */
export const SLOW_MS = 40;
/** The frames the median is taken over: about a second and a half of camera... */
export const LOOK = 45;
/** ...or fewer, once they add up to this long, ms (a landmarker taking seconds a frame is judged in seconds, not minutes). */
export const LOOK_MS = 1500;
/** Fewest frames to judge on. */
export const LOOK_LEAST = 5;
/** Frames left out after a start or a change of delegate (shaders being built). */
export const SETTLE = 5;
/** Frames a try lasts, both landmarkers together. */
export const TRY_FRAMES = 24;
/** After a try, the same worker is not asked again for this long, ms; twice as long after each try that changed nothing, up to RETRY_MOST. */
export const RETRY_MS = 60_000;
export const RETRY_MOST = 8 * 60_000;

export type Delegate = "GPU" | "CPU";

const other = (delegate: Delegate): Delegate => (delegate === "GPU" ? "CPU" : "GPU");

/** Watches one worker's frames and says when it should try the other delegate. */
export class DelegateWatch {
  private readonly recent: number[] = [];
  private skip = SETTLE;
  private trying = false;
  private triedAt = -Infinity;
  private retry = RETRY_MS;

  constructor(public delegate: Delegate) {}

  /** A frame read in `ms`, at `now` (ms): the delegate worth trying now, or null. Call `start` when the try is asked for. */
  push(ms: number, now: number): Delegate | null {
    if (this.trying) return null;
    if (this.skip > 0) {
      this.skip--;
      return null;
    }
    this.recent.push(ms);
    if (this.recent.length > LOOK) this.recent.shift();
    const enough = this.recent.length >= LOOK || (this.recent.length >= LOOK_LEAST && this.recent.reduce((sum, v) => sum + v, 0) >= LOOK_MS);
    if (!enough || now - this.triedAt < this.retry) return null;
    const sorted = [...this.recent].sort((a, b) => a - b);
    if (sorted[Math.floor(sorted.length / 2)]! <= SLOW_MS) return null;
    return other(this.delegate);
  }

  /** The worker has been asked to try: nothing more is proposed until `tried`. */
  start(): void {
    this.trying = true;
  }

  /** The try is over: `kept` is the delegate the worker reads with now. */
  tried(kept: Delegate, now: number): void {
    this.trying = false;
    this.triedAt = now;
    // Both slow (or the other could not be made): asking again every minute would only cost a landmarker each time.
    this.retry = kept === this.delegate ? Math.min(this.retry * 2, RETRY_MOST) : RETRY_MS;
    if (kept !== this.delegate) this.skip = SETTLE;
    this.delegate = kept;
    this.recent.length = 0;
  }

  /** The worker's landmarker was made again on `delegate` (its GPU went: gpu.ts): the old one's times say nothing now. */
  restarted(delegate: Delegate, now: number): void {
    this.delegate = delegate;
    this.recent.length = 0;
    this.skip = SETTLE;
    this.triedAt = now;
  }

  get busy(): boolean {
    return this.trying;
  }
}

/** One try at a time across a tracker's workers: two at once would each measure the other's disturbance. */
export class Trials {
  private running = false;

  /** Takes the turn if it is free. */
  begin(): boolean {
    if (this.running) return false;
    this.running = true;
    return true;
  }

  end(): void {
    this.running = false;
  }
}
