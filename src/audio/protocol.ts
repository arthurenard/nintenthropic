/** Messages between the library (main thread) and its render workers. */

export interface RenderJob {
  id: number;
  cue: string;
  take: number;
  sampleRate: number;
  seed: number;
}

export type RenderReply =
  | {
      id: number;
      cue: string;
      take: number;
      sampleRate: number;
      channels: Float32Array[];
      envelope: Float32Array;
      /** Milliseconds of DSP it took. */
      ms: number;
    }
  | { id: number; cue: string; take: number; error: string };
