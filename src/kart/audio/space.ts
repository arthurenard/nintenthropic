/**
 * The room each track sounds in. Every effect that asks for a send goes through one convolution reverb; here is the
 * impulse response it rings in, made once per track from the theme: an open meadow barely answers (a short, airy
 * bloom with the top gone fast), a kitchen is hard tile, the funfair a big top, the glacier and the volcano caves
 * that hold a sound for two seconds, space a long dark hall with nothing to soak it up. Pure functions of the theme
 * (a fixed seed each), so a race sounds the same on every device.
 */
import { townImpulse } from "../../audio/impulse";
import type { TrackTheme } from "./kinds";

export interface Space {
  /** The impulse response's length, s. */
  seconds: number;
  /** T60 of the low, middle and top bands, s. */
  t60: [number, number, number];
  /** The reverb return's level (the engine's default is 0.55). */
  level: number;
  /** Silence before the first reflection, s: a bigger place answers later. */
  predelay: number;
  seed: number;
}

export const SPACES: Record<TrackTheme, Space> = {
  meadow: { seconds: 0.9, t60: [0.7, 0.42, 0.16], level: 0.42, predelay: 0.012, seed: 0x1a01 },
  kitchen: { seconds: 1.1, t60: [0.8, 0.85, 0.6], level: 0.5, predelay: 0.004, seed: 0x1a02 },
  harbour: { seconds: 1.3, t60: [1.0, 0.65, 0.26], level: 0.48, predelay: 0.02, seed: 0x1a03 },
  canyon: { seconds: 1.9, t60: [1.7, 1.1, 0.4], level: 0.5, predelay: 0.045, seed: 0x1a04 },
  funfair: { seconds: 1.7, t60: [1.3, 1.1, 0.55], level: 0.5, predelay: 0.022, seed: 0x1a05 },
  snow: { seconds: 2.3, t60: [2.0, 1.5, 0.75], level: 0.58, predelay: 0.018, seed: 0x1a06 },
  volcano: { seconds: 2.1, t60: [1.9, 1.2, 0.45], level: 0.55, predelay: 0.03, seed: 0x1a07 },
  space: { seconds: 2.6, t60: [2.4, 1.6, 0.6], level: 0.55, predelay: 0.05, seed: 0x1a08 },
  palm: { seconds: 0.95, t60: [0.75, 0.45, 0.18], level: 0.42, predelay: 0.014, seed: 0x1a09 },
};

const cache = new Map<string, [Float32Array, Float32Array]>();

/** The track's impulse response at this sample rate (cached: a second race on the same theme reuses it). */
export function spaceImpulse(theme: TrackTheme, sr: number): [Float32Array, Float32Array] {
  const key = `${theme}@${sr}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const s = SPACES[theme] ?? SPACES.meadow;
  const [l, r] = townImpulse(sr, { seconds: s.seconds, t60: s.t60, seed: s.seed });
  const pre = Math.round(s.predelay * sr);
  const out: [Float32Array, Float32Array] = [new Float32Array(l.length + pre), new Float32Array(r.length + pre)];
  out[0].set(l, pre);
  out[1].set(r, pre);
  cache.set(key, out);
  return out;
}

/** What a bus must offer to take a room (the arcade's Web Audio engine does; a test double does not). */
export interface HasRoom {
  setImpulse(left: Float32Array, right: Float32Array, level?: number): void;
  setMix?(mix: { glue?: { threshold: number; ratio: number; knee?: number }; ceiling?: number; trimDb?: number }): void;
  resetRoom?(): void;
  readonly ctx?: { readonly sampleRate: number };
}

/** Put the bus in the track's room, when it can be. Returns whether it was. */
export function enterRoom(bus: unknown, theme: TrackTheme): boolean {
  const b = bus as Partial<HasRoom> | null;
  if (!b || typeof b.setImpulse !== "function") return false;
  const sr = b.ctx?.sampleRate ?? 48000;
  const [l, r] = spaceImpulse(theme, sr);
  b.setImpulse(l, r, (SPACES[theme] ?? SPACES.meadow).level);
  // The race's finish: glue so eight engines and the effects sit together, and a ceiling with room for the true peak.
  b.setMix?.({ glue: { threshold: -20, ratio: 2.5, knee: 12 }, ceiling: -2, trimDb: -2.7 });
  return true;
}

/** Hand the bus back to the arcade's plain room and master when the race is over. */
export function leaveRoom(bus: unknown): void {
  (bus as Partial<HasRoom> | null)?.resetRoom?.();
}
