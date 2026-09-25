/**
 * Rendering one take of one cue: pure TypeScript on Float32Arrays, with no
 * Web Audio anywhere, so it runs the same in a Worker, on the main thread,
 * and in Node under Vitest.
 */
import { CUES, type CueSpec } from "./cues/table";
import { envelopeOf, finish } from "./dsp/master";
import { hashSeed } from "./dsp/rng";
import { Take } from "./dsp/take";

export interface RenderOptions {
  sampleRate: number;
  /** The library's seed: the same seed renders the same library, sample for sample. */
  seed: number;
}

export interface RenderedTake {
  cue: string;
  take: number;
  sampleRate: number;
  /** One (mono) or two (stereo) channels. */
  channels: Float32Array[];
  loop: boolean;
  /** RMS per 20 ms block, for the engine's voice stealing. */
  envelope: Float32Array;
}

export function cueSpec(cue: string): CueSpec | undefined {
  return Object.prototype.hasOwnProperty.call(CUES, cue) ? CUES[cue] : undefined;
}

export function takeCount(cue: string): number {
  return cueSpec(cue)?.takes ?? 3;
}

/** Render take ``take`` of ``cue``. Throws on an unknown cue: callers check first. */
export function renderTake(cue: string, take: number, o: RenderOptions): RenderedTake {
  const spec = cueSpec(cue);
  if (!spec) throw new Error(`unknown cue "${cue}"`);
  const t = new Take(o.sampleRate, hashSeed(o.seed, cue, take), take);
  const raw = spec.recipe(t);
  const channels = Array.isArray(raw) ? raw : [raw];
  const done = finish(channels, o.sampleRate, { loop: !!spec.loop, trim: spec.trim });
  return {
    cue,
    take,
    sampleRate: o.sampleRate,
    channels: done,
    loop: !!spec.loop,
    envelope: envelopeOf(done, o.sampleRate),
  };
}
