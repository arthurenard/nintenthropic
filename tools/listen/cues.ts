/**
 * The entry the cue renderer (cues.mjs) bundles: every take of a Grip Prix cue rendered in Node, with the cue's bus
 * level applied, so a measurement is of what reaches the master. Nothing here plays anything.
 */
import { CUES, cuesInPack } from "../../src/audio/cues/table";
import { renderTake, takeCount } from "../../src/audio/render";

export interface CueRender {
  cue: string;
  level: number;
  loop: boolean;
  bus: string;
  sr: number;
  /** The mono-summed take at its table level (a mono cue is panned centre: -3 dB, as the engine does it). */
  left: Float32Array;
  right: Float32Array;
}

export const kartCues = (): string[] => cuesInPack("kart");

export function renderCue(cue: string, take = 0, sr = 44100): CueRender {
  const spec = CUES[cue]!;
  const r = renderTake(cue, take, { sampleRate: sr, seed: 1 });
  const gain = Math.pow(10, spec.level / 20);
  const pan = r.channels.length > 1 ? 1 : Math.SQRT1_2;
  const l = Float32Array.from(r.channels[0]!, (v) => v * gain * pan);
  const rr = Float32Array.from(r.channels[1] ?? r.channels[0]!, (v) => v * gain * pan);
  return { cue, level: spec.level, loop: !!spec.loop, bus: spec.bus, sr, left: l, right: rr };
}

export { takeCount };
