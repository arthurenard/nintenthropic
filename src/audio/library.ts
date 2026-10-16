/**
 * The sound library at run time: every cue's takes as AudioBuffers,
 * synthesised a pack at a time by a small pool of Workers (so the page never
 * drops a frame while it happens), in parallel, longest first so the pool
 * finishes together. A cue asked for before its pack has arrived jumps the
 * queue; a short one can even be rendered on the spot. If Workers cannot be
 * started (an unusual host, a strict policy), the same jobs run on the main
 * thread one take per task, so a frame is never held for more than one take.
 */
import { CUES, type Pack, cuesInPack } from "./cues/table";
import type { RenderJob, RenderReply } from "./protocol";
import { renderTake, takeCount } from "./render";

export interface LoadedTake {
  buffer: AudioBuffer;
  /** RMS per 20 ms, for voice stealing. */
  envelope: Float32Array;
}

export interface GenerationReport {
  pack: string;
  cues: number;
  takes: number;
  /** Wall-clock time from the request to the last take, ms. */
  ms: number;
  /** DSP time summed over every worker, ms. */
  cpuMs: number;
  workers: number;
}

interface Slot {
  worker: Worker;
  busy: RenderJob | null;
}

/** Envelope block size used by render.ts's envelopeOf. */
export const ENVELOPE_BLOCK = 0.02;

export class SoundLibrary {
  private readonly takes = new Map<string, (LoadedTake | undefined)[]>();
  private readonly waiting = new Map<string, (() => void)[]>();
  private readonly queue: RenderJob[] = [];
  private readonly queued = new Set<string>();
  private readonly slots: Slot[] = [];
  private readonly packs = new Map<string, Promise<void>>();
  private readonly packListeners: { names: Set<string>; left: number; total: number; tick: () => void }[] = [];
  private nextId = 1;
  private cpuMs = 0;
  private mainThreadTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  readonly reports: GenerationReport[] = [];
  readonly sampleRate: number;

  constructor(
    private readonly ctx: BaseAudioContext,
    private readonly seed = 1,
    workers = defaultWorkerCount(),
  ) {
    // Render at the context's rate (no resampling on the way out), but never
    // above 48 kHz: nothing here has anything to say above 20 kHz, and a
    // 96 kHz device would otherwise double the synthesis time.
    this.sampleRate = Math.min(48000, Math.max(22050, ctx.sampleRate));
    for (let k = 0; k < workers; k++) {
      try {
        const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module", name: "handy-audio" });
        const slot: Slot = { worker, busy: null };
        worker.onmessage = (event: MessageEvent<RenderReply>) => this.received(slot, event.data);
        worker.onerror = () => this.lost(slot);
        this.slots.push(slot);
      } catch {
        break;
      }
    }
  }

  /** The takes of ``cue`` that are ready (at least one), or undefined. */
  get(cue: string): LoadedTake[] | undefined {
    const list = this.takes.get(cue)?.filter((t): t is LoadedTake => t !== undefined);
    return list && list.length > 0 ? list : undefined;
  }

  /** Synthesise every cue of ``pack``; resolves when all its takes are ready. */
  load(pack: Pack, onProgress?: (fraction: number) => void): Promise<void> {
    const existing = this.packs.get(pack);
    if (existing) {
      if (onProgress) void existing.then(() => onProgress(1));
      return existing;
    }
    const names = cuesInPack(pack);
    const start = performance.now();
    const cpuBefore = this.cpuMs;
    let total = 0;
    const jobs: RenderJob[] = [];
    for (const cue of names) {
      for (let take = 0; take < takeCount(cue); take++) {
        total++;
        if (this.has(cue, take)) continue;
        jobs.push(this.job(cue, take));
      }
    }
    // Longest first: the pool finishes together instead of waiting on one long tail.
    jobs.sort((a, b) => cost(b.cue) - cost(a.cue));
    const promise = new Promise<void>((resolve) => {
      const listener = {
        names: new Set(names),
        left: jobs.length,
        total,
        tick: () => {
          listener.left--;
          onProgress?.(1 - listener.left / Math.max(1, total));
          if (listener.left <= 0) {
            this.packListeners.splice(this.packListeners.indexOf(listener), 1);
            const report: GenerationReport = {
              pack,
              cues: names.length,
              takes: total,
              ms: performance.now() - start,
              cpuMs: this.cpuMs - cpuBefore,
              workers: this.slots.length,
            };
            this.reports.push(report);
            console.info(
              `Handheld audio: ${report.cues} sounds (${report.takes} takes) of "${pack}" synthesised in ${report.ms.toFixed(0)} ms ` +
                `(${report.cpuMs.toFixed(0)} ms of DSP on ${report.workers || "the main"} thread${report.workers === 1 ? "" : "s"})`,
            );
            resolve();
          }
        },
      };
      this.packListeners.push(listener);
      if (jobs.length === 0) {
        listener.left = 1;
        listener.tick();
      }
    });
    this.packs.set(pack, promise);
    for (const job of jobs) this.enqueue(job, false);
    this.pump();
    return promise;
  }

  /** Make ``cue`` ready as soon as possible; resolves when its first take is. */
  request(cue: string): Promise<void> {
    if (this.get(cue)) return Promise.resolve();
    const spec = CUES[cue];
    if (spec && !this.packs.has(spec.pack)) void this.load(spec.pack);
    // Move its takes to the front of the queue.
    for (let take = takeCount(cue) - 1; take >= 0; take--) {
      if (this.has(cue, take)) continue;
      const k = this.queue.findIndex((j) => j.cue === cue && j.take === take);
      if (k >= 0) this.queue.unshift(...this.queue.splice(k, 1));
      else if (!this.queued.has(`${cue}#${take}`)) this.enqueue(this.job(cue, take), true);
    }
    this.pump();
    return new Promise((resolve) => {
      const list = this.waiting.get(cue) ?? [];
      list.push(resolve);
      this.waiting.set(cue, list);
    });
  }

  /**
   * Render one take of ``cue`` right now, on this thread: for a short sound
   * wanted this instant (a shot fired before its pack arrived). A few
   * milliseconds for anything under a second or so.
   */
  renderNow(cue: string): LoadedTake | undefined {
    const have = this.takes.get(cue) ?? [];
    let take = 0;
    while (have[take]) take++;
    if (take >= takeCount(cue)) return have[0];
    const t0 = performance.now();
    const r = renderTake(cue, take, { sampleRate: this.sampleRate, seed: this.seed });
    this.cpuMs += performance.now() - t0;
    return this.store(cue, take, r.channels, r.envelope, true);
  }

  dispose(): void {
    this.disposed = true;
    for (const slot of this.slots) slot.worker.terminate();
    this.slots.length = 0;
    if (this.mainThreadTimer !== null) clearTimeout(this.mainThreadTimer);
  }

  private has(cue: string, take: number): boolean {
    return this.takes.get(cue)?.[take] !== undefined;
  }

  private job(cue: string, take: number): RenderJob {
    return { id: this.nextId++, cue, take, sampleRate: this.sampleRate, seed: this.seed };
  }

  private enqueue(job: RenderJob, front: boolean): void {
    const key = `${job.cue}#${job.take}`;
    if (this.queued.has(key)) return;
    this.queued.add(key);
    if (front) this.queue.unshift(job);
    else this.queue.push(job);
  }

  /** Hand queued jobs to idle workers (or to the main thread without any). */
  private pump(): void {
    if (this.disposed) return;
    if (this.slots.length === 0) {
      this.pumpMainThread();
      return;
    }
    for (const slot of this.slots) {
      if (slot.busy) continue;
      const job = this.nextJob();
      if (!job) return;
      slot.busy = job;
      slot.worker.postMessage([job]);
    }
  }

  private nextJob(): RenderJob | undefined {
    while (this.queue.length > 0) {
      const job = this.queue.shift()!;
      if (!this.has(job.cue, job.take)) return job;
      this.finishJob(job.cue, job.take);
    }
    return undefined;
  }

  private pumpMainThread(): void {
    if (this.mainThreadTimer !== null || this.queue.length === 0) return;
    this.mainThreadTimer = setTimeout(() => {
      this.mainThreadTimer = null;
      const job = this.nextJob();
      if (job) {
        const t0 = performance.now();
        try {
          const r = renderTake(job.cue, job.take, { sampleRate: job.sampleRate, seed: job.seed });
          this.cpuMs += performance.now() - t0;
          this.store(job.cue, job.take, r.channels, r.envelope, false);
        } catch (error) {
          console.warn(`Handheld audio: could not synthesise "${job.cue}"`, error);
        }
        this.finishJob(job.cue, job.take);
      }
      this.pumpMainThread();
    }, 0);
  }

  private received(slot: Slot, reply: RenderReply): void {
    slot.busy = null;
    if (this.disposed) return;
    if ("error" in reply) {
      console.warn(`Handheld audio: could not synthesise "${reply.cue}": ${reply.error}`);
    } else {
      this.cpuMs += reply.ms;
      if (!this.has(reply.cue, reply.take)) this.store(reply.cue, reply.take, reply.channels, reply.envelope, false);
    }
    this.finishJob(reply.cue, reply.take);
    this.pump();
  }

  /** A worker died: requeue what it was doing and carry on without it. */
  private lost(slot: Slot): void {
    const index = this.slots.indexOf(slot);
    if (index >= 0) this.slots.splice(index, 1);
    slot.worker.terminate();
    if (slot.busy) {
      this.queue.unshift(slot.busy);
      slot.busy = null;
    }
    this.pump();
  }

  private finishJob(cue: string, take: number): void {
    const key = `${cue}#${take}`;
    if (!this.queued.delete(key)) return;
    for (const listener of [...this.packListeners]) if (listener.names.has(cue)) listener.tick();
  }

  private store(cue: string, take: number, channels: Float32Array[], envelope: Float32Array, now: boolean): LoadedTake {
    const buffer = this.ctx.createBuffer(channels.length, channels[0]!.length, this.sampleRate);
    channels.forEach((ch, k) => buffer.copyToChannel(ch as Float32Array<ArrayBuffer>, k));
    const loaded: LoadedTake = { buffer, envelope };
    const list = this.takes.get(cue) ?? [];
    list[take] = loaded;
    this.takes.set(cue, list);
    // A take rendered on the spot is not queued, but must not be rendered again.
    if (now) {
      const k = this.queue.findIndex((j) => j.cue === cue && j.take === take);
      if (k >= 0) {
        this.queue.splice(k, 1);
        this.finishJob(cue, take);
      }
    }
    const waiters = this.waiting.get(cue);
    if (waiters) {
      this.waiting.delete(cue);
      for (const resolve of waiters) resolve();
    }
    return loaded;
  }
}

/** Relative cost of a cue, for ordering jobs: its longest expected duration. */
function cost(cue: string): number {
  const spec = CUES[cue];
  return spec ? spec.expect[1] : 1;
}

/** Leave a core for the page and one for the hand tracker; four is plenty. */
function defaultWorkerCount(): number {
  const cores = typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 4 : 4;
  return Math.max(1, Math.min(4, cores - 2));
}
