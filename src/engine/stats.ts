/** Summaries of timings, for the debug overlay and the performance report. */

export interface Percentiles {
  mean: number;
  p50: number;
  p95: number;
  max: number;
}

export function percentiles(values: readonly number[]): Percentiles {
  if (!values.length) return { mean: 0, p50: 0, p95: 0, max: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
  return {
    mean: sorted.reduce((a, b) => a + b, 0) / sorted.length,
    p50: at(0.5),
    p95: at(0.95),
    max: sorted[sorted.length - 1]!,
  };
}

/** A rolling window of numbers. */
export class Samples {
  private readonly values: number[] = [];

  constructor(private readonly size = 600) {}

  push(value: number): void {
    this.values.push(value);
    if (this.values.length > this.size) this.values.shift();
  }

  clear(): void {
    this.values.length = 0;
  }

  get count(): number {
    return this.values.length;
  }

  summary(): Percentiles {
    return percentiles(this.values);
  }
}
