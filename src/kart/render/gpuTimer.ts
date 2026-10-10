/**
 * A stopwatch for the GPU, built on EXT_disjoint_timer_query_webgl2 where the
 * browser offers it (desktop Chrome does; Safari does not). The dev page and
 * the bench (tools/perf/bench.mjs) turn it on to say how much of a frame the
 * scene, the shadow passes and the post chain each cost; a game never does.
 *
 * Sections are timed one at a time (queries of this kind cannot nest), and a
 * result arrives a few frames after the section ran, so a reading is a running
 * average, not this frame's.
 */
interface Section {
  query: WebGLQuery;
  label: string;
}

interface TimerExtension {
  TIME_ELAPSED_EXT: number;
  GPU_DISJOINT_EXT: number;
}

export interface GpuReading {
  /** Exponential moving average, ms. */
  ms: number;
  /** Every result so far, summed, and how many there were (for a mean over a run). */
  total: number;
  count: number;
}

export class GpuTimer {
  private readonly ext: TimerExtension | null;
  private readonly free: WebGLQuery[] = [];
  private readonly pending: Section[] = [];
  private active: Section | null = null;
  private readonly readings = new Map<string, GpuReading>();

  constructor(private readonly gl: WebGL2RenderingContext) {
    this.ext = (gl.getExtension("EXT_disjoint_timer_query_webgl2") as TimerExtension | null) ?? null;
  }

  get supported(): boolean {
    return this.ext !== null;
  }

  begin(label: string): void {
    if (!this.ext || this.active || this.pending.length > 64) return;
    const query = this.free.pop() ?? this.gl.createQuery();
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, query);
    this.active = { query, label };
  }

  end(): void {
    if (!this.ext || !this.active) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.pending.push(this.active);
    this.active = null;
  }

  /** Collects the sections the GPU has finished. Call once a frame. */
  poll(): void {
    if (!this.ext) return;
    const gl = this.gl;
    const disjoint = gl.getParameter(this.ext.GPU_DISJOINT_EXT) as boolean;
    while (this.pending.length) {
      const s = this.pending[0]!;
      if (!gl.getQueryParameter(s.query, gl.QUERY_RESULT_AVAILABLE)) break;
      this.pending.shift();
      if (!disjoint) {
        const ms = (gl.getQueryParameter(s.query, gl.QUERY_RESULT) as number) / 1e6;
        const r = this.readings.get(s.label) ?? { ms, total: 0, count: 0 };
        r.ms += (ms - r.ms) * 0.1;
        r.total += ms;
        r.count++;
        this.readings.set(s.label, r);
      }
      this.free.push(s.query);
    }
  }

  reading(label: string): GpuReading | undefined {
    return this.readings.get(label);
  }

  /** Forgets the totals (not the averages), to measure a stretch of frames. */
  resetTotals(): void {
    for (const r of this.readings.values()) {
      r.total = 0;
      r.count = 0;
    }
  }

  dispose(): void {
    for (const s of this.pending) this.gl.deleteQuery(s.query);
    for (const q of this.free) this.gl.deleteQuery(q);
    this.pending.length = 0;
    this.free.length = 0;
  }
}
