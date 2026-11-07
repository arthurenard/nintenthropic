/**
 * Playing the rendered music: looping a stereo buffer on the audio clock,
 * crossfading between pieces, ducking under a big sound, muffling for the
 * pause menu, and the final-lap switch that changes to the faster, higher
 * version of the same piece on the next beat so the groove never stumbles.
 *
 * The timing arithmetic (where the next beat falls, which beat of the other
 * version matches it) is in pure functions at the top, tested in Node.
 */
import { volumeGain } from "../../../audio/routing";
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
  /** False for a one-shot (a jingle): it plays once and ends. */
  loop?: boolean;
  /** Seconds, from the start of the loop, at which each bar falls (the invincibility layer starts on one). */
  barStarts?: Float32Array;
  /** A race theme's invincibility layer: one bar that loops over the music while a comet burns. */
  comet?: AudioBuffer;
  /** The final-lap version's fanfare, played as the music lifts. */
  stinger?: AudioBuffer;
}

/** The structural part of a rendered piece that a track is made from (see ./render.ts). */
export interface RenderedLike {
  id: string;
  sampleRate: number;
  left: Float32Array;
  right: Float32Array;
  loopSamples: number;
  bars: readonly ScoreBar[];
  transpose: number;
  loop?: boolean;
  comet?: { left: Float32Array; right: Float32Array; sampleRate: number };
  stinger?: { left: Float32Array; right: Float32Array; sampleRate: number };
}

function bufferOf(ctx: BaseAudioContext, left: Float32Array, right: Float32Array, sampleRate: number): AudioBuffer {
  const buffer = ctx.createBuffer(2, left.length, sampleRate);
  buffer.copyToChannel(left as Float32Array<ArrayBuffer>, 0);
  buffer.copyToChannel(right as Float32Array<ArrayBuffer>, 1);
  return buffer;
}

/** A rendered piece as something the player can play: its buffer, its beats and bars, its comet layer and stinger. */
export function makeMusicTrack(ctx: BaseAudioContext, r: RenderedLike): MusicTrack {
  return {
    id: r.id + (r.transpose ? "-final" : ""),
    buffer: bufferOf(ctx, r.left, r.right, r.sampleRate),
    beats: beatTimes(r.bars),
    barStarts: Float32Array.from(r.bars.map((b) => b.start)),
    duration: r.loopSamples / r.sampleRate,
    loop: r.loop !== false,
    ...(r.comet ? { comet: bufferOf(ctx, r.comet.left, r.comet.right, r.comet.sampleRate) } : {}),
    ...(r.stinger ? { stinger: bufferOf(ctx, r.stinger.left, r.stinger.right, r.stinger.sampleRate) } : {}),
  };
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

/** Music sits this far under its rendered level in the mix (the engine's ambience and the effects come first). */
export const MUSIC_TRIM = 0.64;

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
  private readonly shelf: BiquadFilterNode;
  private intensity = 0;
  private voice: Voice | null = null;
  private comet: { source: AudioBufferSourceNode; gain: GainNode } | null = null;
  private cometWanted = false;
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
    this.master.gain.value = MUSIC_TRIM * volumeGain(this.volume);
    this.shelf = ctx.createBiquadFilter();
    this.shelf.type = "highshelf";
    this.shelf.frequency.value = 3500;
    this.shelf.gain.value = 0;
    this.duckGain.connect(this.filter).connect(this.shelf).connect(this.master).connect(destination);
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
    this.stopComet(now, 0.2);
    this.fadeOutCurrent(now, fade);
    this.voice = this.start(track, now, 0, fade);
    if (this.cometWanted) this.startComet();
  }

  /**
   * The invincibility layer: while a comet burns, a bar of glittering
   * percussion and bell pings loops over the music, coming in on the next bar
   * line and leaving in a breath. Nothing happens for a piece without one.
   */
  setComet(on: boolean): void {
    if (this.disposed || this.cometWanted === on) return;
    this.cometWanted = on;
    if (on) this.startComet();
    else this.stopComet(this.ctx.currentTime, 0.5);
  }

  private startComet(when?: number, offset?: number): void {
    const v = this.voice;
    if (!v || !v.track.comet || this.comet) return;
    const track = v.track;
    let at = when;
    if (at === undefined) {
      const bars = track.barStarts ?? track.beats;
      const { wait } = nextBeat(bars, track.duration, this.position(), 0.03);
      at = this.ctx.currentTime + wait;
    }
    void offset;
    const source = this.ctx.createBufferSource();
    source.buffer = track.comet!;
    source.loop = true;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0, Math.max(0, at - 0.001));
    gain.gain.linearRampToValueAtTime(1, at + 0.35);
    source.connect(gain).connect(this.duckGain);
    source.start(at);
    this.comet = { source, gain };
  }

  private stopComet(when: number, fade: number): void {
    const c = this.comet;
    if (!c) return;
    this.comet = null;
    try {
      c.gain.gain.cancelScheduledValues(when);
      c.gain.gain.setValueAtTime(c.gain.gain.value, when);
      c.gain.gain.linearRampToValueAtTime(0, when + fade);
      c.source.stop(when + fade + 0.05);
    } catch {
      // Already stopped.
    }
    c.source.onended = () => {
      c.source.disconnect();
      c.gain.disconnect();
    };
  }

  /**
   * Change to another version of the same piece (the final lap) on the next
   * beat: the new one starts at the matching beat of its own loop, after a
   * brief equal-power crossfade, so the bar count and the groove carry on.
   * If nothing is playing, it simply starts the track.
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
    // The final-lap fanfare lands on the downbeat of the lifted music, which ducks a little under it.
    if (track.stinger) {
      const s = this.ctx.createBufferSource();
      s.buffer = track.stinger;
      const g = this.ctx.createGain();
      g.gain.value = 0.9;
      s.connect(g).connect(this.master);
      s.start(when);
      s.onended = () => {
        s.disconnect();
        g.disconnect();
      };
      const duck = this.duckGain.gain;
      duck.setValueAtTime(1, Math.max(this.ctx.currentTime, when - 0.01));
      duck.setTargetAtTime(0.55, when, 0.02);
      duck.setTargetAtTime(1, when + 1.1, 0.35);
    }
    if (this.comet) {
      // The layer carries on in the lifted tempo: the old bar leaves, the new one comes in with the music.
      this.stopComet(when, 0.05);
      this.startComet(when);
    }
  }

  /** Fade out and stop. */
  stop(fade = 0.8): void {
    if (this.disposed) return;
    this.stopComet(this.ctx.currentTime, Math.min(fade, 0.4));
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

  /**
   * How hard the race is going, 0..1 (the leading local kart's lap, from the first to the last): the music opens up a
   * little as it goes, a high shelf rising to +3 dB and the level by half a dB, slowly, so no one hears it move.
   */
  setIntensity(level: number): void {
    if (this.disposed) return;
    const v = Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 0;
    if (Math.abs(v - this.intensity) < 0.02) return;
    this.intensity = v;
    const now = this.ctx.currentTime;
    this.shelf.gain.setTargetAtTime(3 * v, now, 2.5);
    this.applyMaster();
  }

  /** The music's slider, 0..1, squared like the engine's master volume: half way is a quarter of the level, about 12 dB down. */
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
      this.shelf.disconnect();
      this.master.disconnect();
    }, 200);
  }

  private applyMaster(): void {
    const now = this.ctx.currentTime;
    const target = MUSIC_TRIM * volumeGain(this.volume) * (this.paused ? 0.45 : 1) * (1 + 0.06 * this.intensity);
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(this.master.gain.value, now);
    this.master.gain.setTargetAtTime(target, now, 0.04);
  }

  private start(track: MusicTrack, when: number, offset: number, fade: number): Voice {
    const source = this.ctx.createBufferSource();
    source.buffer = track.buffer;
    source.loop = track.loop !== false;
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
