/**
 * Playing the rendered music: looping a stereo buffer on the audio clock,
 * crossfading between pieces, ducking under a big sound, muffling for the
 * pause menu, and the final-lap switch that changes to the faster, higher
 * version of the same piece on the next beat so the groove never stumbles.
 *
 * The timing arithmetic (where the next beat falls, which beat of the other
 * version matches it) is in pure functions at the top, tested in Node.
 */
import type { ScoreBar } from "./score";

/** A piece ready to play. */
export interface MusicTrack {
  /** The piece's id, "-final" appended for its final-lap version. */
  id: string;
  buffer: AudioBuffer;
  /** Seconds, from the start of the loop, at which each beat falls. */
  beats: Float32Array;
  /** The loop's length, seconds. */
  duration: number;
}

/** Every beat of a piece, seconds from the start of the loop. */
export function beatTimes(bars: readonly ScoreBar[]): Float32Array {
  const out: number[] = [];
  for (const bar of bars) for (let b = 0; b < bar.beats; b++) out.push(bar.start + (b * bar.dur) / bar.beats);
  return Float32Array.from(out);
}

/** The first beat at least ``margin`` seconds after ``position``, wrapping round the loop: its index, and seconds from ``position``. */
export function nextBeat(beats: Float32Array, duration: number, position: number, margin = 0.02): { index: number; wait: number } {
  const p = ((position % duration) + duration) % duration;
  for (let k = 0; k < beats.length; k++) {
    if (beats[k]! >= p + margin) return { index: k, wait: beats[k]! - p };
  }
  // Past the last beat: the loop's first comes round after the end.
  return { index: 0, wait: duration - p + (beats[0] ?? 0) };
}

/** Linear-to-slider volume: perceptual, like the engine's master. */
export const sliderGain = (v: number): number => (v > 0 ? Math.min(1, v) ** 2 : 0);

/** Music sits this far under its rendered level in the mix (the engine's ambience and the effects come first). */
export const MUSIC_TRIM = 0.72;

interface Voice {
  track: MusicTrack;
  source: AudioBufferSourceNode;
  gain: GainNode;
  /** Context time at which the loop's position 0 was (or would have been) heard. */
  origin: number;
}

export class MusicPlayer {
  private readonly ctx: BaseAudioContext;
  private readonly duckGain: GainNode;
  private readonly filter: BiquadFilterNode;
  private readonly master: GainNode;
  private voice: Voice | null = null;
  private volume = 1;
  private paused = false;
  private disposed = false;

  constructor(ctx: BaseAudioContext, destination: AudioNode) {
    this.ctx = ctx;
    this.duckGain = ctx.createGain();
    this.filter = ctx.createBiquadFilter();
    this.filter.type = "lowpass";
    this.filter.frequency.value = 20000;
    this.filter.Q.value = 0.5;
    this.master = ctx.createGain();
    this.master.gain.value = MUSIC_TRIM * sliderGain(this.volume);
    this.duckGain.connect(this.filter).connect(this.master).connect(destination);
  }

  /** What is playing, if anything. */
  get current(): MusicTrack | null {
    return this.voice?.track ?? null;
  }

  /** Seconds into the current loop. */
  position(): number {
    const v = this.voice;
    if (!v) return 0;
    const t = this.ctx.currentTime - v.origin;
    return ((t % v.track.duration) + v.track.duration) % v.track.duration;
  }

  /** Start ``track`` from its beginning, crossfading from whatever is playing over ``fade`` seconds. */
  play(track: MusicTrack, fade = 0.8): void {
    if (this.disposed) return;
    const now = this.ctx.currentTime;
    this.fadeOutCurrent(now, fade);
    this.voice = this.start(track, now, 0, fade);
  }

  /**
   * Change to another version of the same piece (the final lap) on the next
   * beat: the new one starts at the matching beat of its own loop, after a
   * brief equal-power crossfade, so the bar count and the groove carry on.
   * Does nothing useful if nothing is playing (then it just plays).
   */
  switchTo(track: MusicTrack, fade = 0.06): void {
    if (this.disposed) return;
    const old = this.voice;
    if (!old) {
      this.play(track, 0.2);
      return;
    }
    const { index, wait } = nextBeat(old.track.beats, old.track.duration, this.position());
    const when = this.ctx.currentTime + wait;
    const offset = track.beats[Math.min(index, track.beats.length - 1)] ?? 0;
    this.fadeOutCurrent(when, fade);
    this.voice = this.start(track, when, offset, fade);
  }

  /** Fade out and stop. */
  stop(fade = 0.8): void {
    if (this.disposed) return;
    this.fadeOutCurrent(this.ctx.currentTime, fade);
    this.voice = null;
  }

  /** Pull the music down to ``depth`` of its level for ``hold`` seconds, then let it back up over ``release``. */
  duck(depth: number, hold: number, attack = 0.08, release = 0.9): void {
    if (this.disposed) return;
    const g = this.duckGain.gain;
    const now = this.ctx.currentTime;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.setTargetAtTime(Math.max(0, Math.min(1, depth)), now, attack / 3);
    g.setTargetAtTime(1, now + attack + hold, release / 3);
  }

  /** The music's slider, 0..1 (perceptual: half way is a quarter of the power). */
  setVolume(v: number): void {
    this.volume = Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1;
    this.applyMaster();
  }

  /** The pause menu: music quieter and muffled, as if heard through a wall. */
  setPaused(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;
    const now = this.ctx.currentTime;
    this.filter.frequency.setTargetAtTime(paused ? 650 : 20000, now, 0.08);
    this.applyMaster();
  }

  dispose(): void {
    if (this.disposed) return;
    this.stop(0.05);
    this.disposed = true;
    setTimeout(() => {
      this.duckGain.disconnect();
      this.filter.disconnect();
      this.master.disconnect();
    }, 200);
  }

  private applyMaster(): void {
    const now = this.ctx.currentTime;
    const target = MUSIC_TRIM * sliderGain(this.volume) * (this.paused ? 0.45 : 1);
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(this.master.gain.value, now);
    this.master.gain.setTargetAtTime(target, now, 0.04);
  }

  private start(track: MusicTrack, when: number, offset: number, fade: number): Voice {
    const source = this.ctx.createBufferSource();
    source.buffer = track.buffer;
    source.loop = true;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0, Math.max(0, when - 0.001));
    // Equal-power rise: a quarter of a sine.
    gain.gain.setValueCurveAtTime(CURVE_IN, when, Math.max(0.02, fade));
    source.connect(gain).connect(this.duckGain);
    source.start(when, offset);
    return { track, source, gain, origin: when - offset };
  }

  private fadeOutCurrent(when: number, fade: number): void {
    const v = this.voice;
    if (!v) return;
    const d = Math.max(0.02, fade);
    try {
      v.gain.gain.cancelScheduledValues(when);
      v.gain.gain.setValueAtTime(1, when);
      v.gain.gain.setValueCurveAtTime(CURVE_OUT, when, d);
      v.source.stop(when + d + 0.05);
    } catch {
      // Already stopped.
    }
    v.source.onended = () => {
      v.source.disconnect();
      v.gain.disconnect();
    };
  }
}

const CURVE_IN = Float32Array.from({ length: 64 }, (_, k) => Math.sin((0.5 * Math.PI * k) / 63));
const CURVE_OUT = Float32Array.from({ length: 64 }, (_, k) => Math.cos((0.5 * Math.PI * k) / 63));
