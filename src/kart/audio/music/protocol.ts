/** Messages between the music loader (main thread) and its render worker. */
import type { RenderedMusic } from "./render";

export interface MusicJob {
  job: number;
  id: string;
  sampleRate: number;
  tempoScale: number;
  transpose: number;
}

export type MusicReply =
  | { job: number; progress: number }
  | { job: number; result: RenderedMusic }
  | { job: number; error: string };
