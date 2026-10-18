/**
 * The engine's decisions, as pure functions: how loud, how dark and how late
 * a sound is at a distance, where the street's echoes come from, what "hurt"
 * and "slow motion" do to the mix, and which voice to give up when too many
 * play at once. The Web Audio code (./engine.ts) only applies these numbers,
 * so everything here is tested in Node without an audio device.
 */

export const SPEED_OF_SOUND = 343;
/** Within this many metres a sound is "close": full level, full brightness. */
export const REFERENCE_DISTANCE = 8;
/** How fast level falls past the reference: 0.7 is gentler than the physical 1/r (1.0), as games need. */
export const ROLLOFF = 0.7;
/** The quietest distance can make a sound, so a far event is faint but never lost. */
export const MIN_DISTANCE_GAIN = 0.1;
/** The overall level of the street's echoes relative to the image-source law. */
export const ECHO_LEVEL = 0.55;

/** Level at ``distance`` metres, 0..1. */
export function distanceGain(distance: number): number {
  if (!(distance > REFERENCE_DISTANCE)) return 1;
  return Math.max(MIN_DISTANCE_GAIN, Math.pow(REFERENCE_DISTANCE / distance, ROLLOFF));
}

/**
 * The low-pass that air (and the ground) put on a sound ``distance`` metres
 * away, Hz. Air absorbs the top octaves over tens of metres, and a gunshot
 * down the street loses its crack before it loses its boom.
 */
export function airCutoff(distance: number): number {
  if (!(distance > 0)) return 20000;
  return Math.min(20000, Math.max(1500, 20000 * Math.exp(-distance / 35)));
}

/**
 * The master level for the volume slider's position, 0..1. The ear hears
 * level logarithmically, so a straight line from silence to full would put
 * nearly all the change in the slider's first quarter; squaring it spreads
 * the change evenly along the travel (half way is about -12 dB).
 */
export function volumeGain(volume: number): number {
  if (!(volume > 0)) return 0;
  return Math.min(1, volume) ** 2;
}

/** Seconds for sound to travel ``distance`` metres. */
export function travelTime(distance: number): number {
  return distance > 0 ? distance / SPEED_OF_SOUND : 0;
}

/**
 * The send to the town's reverb for a sound at ``distance``, applied before
 * distance attenuation. It falls more slowly than the direct sound, so far
 * sounds are wetter — which is most of what makes them sound far.
 */
export function reverbSend(base: number, distance: number): number {
  return base * Math.pow(distanceGain(distance), 0.35);
}

/** The street the listener stands in: facades either side, a building behind, the church ahead. */
export interface StreetSpace {
  /** Metres to the facade on the left and on the right. */
  left: number;
  right: number;
  /** Metres to the building behind the listener. */
  behind: number;
  /** Metres to the far end of the street (the church). */
  depth: number;
  /** How much each surface returns: weathered wood and glass, the building behind, the church and the mesa. */
  facade: number;
  back: number;
  far: number;
}

/** Dust Creek as docs/HIGH_NOON.md describes it: a 13 m street, the church about 60 m away. */
export const DUST_CREEK: StreetSpace = { left: 6, right: 7, behind: 11, depth: 62, facade: 0.7, back: 0.6, far: 0.9 };

export interface EchoTap {
  /** Seconds after the direct sound arrives. */
  delay: number;
  /** Gain relative to the source at full level (compare with distanceGain). */
  gain: number;
  /** Where it comes from, -1..1. */
  pan: number;
  /** Its low-pass, Hz: air over the longer path and a wall's absorption per bounce. */
  cutoff: number;
}

/**
 * The street's slap-back for a source ``distance`` metres away at stereo
 * position ``pan``, by the image-source method: each wall mirrors the source,
 * and the mirrored source's path length gives the echo's delay, level and
 * direction. The walls here are the two facades (first and second order —
 * the flutter between them), the building behind the listener and the far
 * end of the street. Echoes within 8 ms of the direct sound are left out:
 * the ear fuses them into it, and all they would add is a comb filter.
 *
 * The player's own shot (distance 0) gets the classic sequence: a slap off
 * each facade at 35-40 ms, one off the building behind, and the church
 * answering a third of a second later.
 */
export function echoTaps(distance: number, pan: number, space: StreetSpace = DUST_CREEK, max = 5): EchoTap[] {
  const d = Math.max(0, distance);
  // The source in street coordinates: x across (+ right), z along (− ahead).
  const x = Math.max(-space.left + 0.5, Math.min(space.right - 0.5, d * Math.max(-1, Math.min(1, pan))));
  const z = -Math.sqrt(Math.max(0, d * d - x * x));
  const direct = Math.max(Math.hypot(x, z), 0.5);
  const W = space.left + space.right;
  // Of the two second-order images (left-then-right, right-then-left) only
  // the nearer: for a source near the middle they arrive together, and one
  // tap carries the flutter as well as two would.
  const second = Math.abs(x + 2 * W) < Math.abs(x - 2 * W) ? x + 2 * W : x - 2 * W;
  const images: { x: number; z: number; gain: number; bounces: number }[] = [
    { x: -2 * space.left - x, z, gain: space.facade, bounces: 1 },
    { x: 2 * space.right - x, z, gain: space.facade, bounces: 1 },
    { x: second, z, gain: space.facade * space.facade, bounces: 2 },
    { x, z: 2 * space.behind - z, gain: space.back, bounces: 1 },
    { x, z: -2 * space.depth - z, gain: space.far, bounces: 1 },
  ];
  const taps: EchoTap[] = [];
  for (const im of images) {
    const path = Math.hypot(im.x, im.z);
    const delay = (path - direct) / SPEED_OF_SOUND;
    if (delay < 0.008) continue;
    const gain = ECHO_LEVEL * im.gain * distanceGain(path);
    const cutoff = airCutoff(path) * Math.pow(0.7, im.bounces);
    taps.push({ delay, gain, pan: Math.max(-1, Math.min(1, (0.9 * im.x) / path)), cutoff });
  }
  taps.sort((a, b) => b.gain - a.gain);
  return taps.filter((tap) => tap.gain >= 0.02).slice(0, max).sort((a, b) => a.delay - b.delay);
}

export interface HurtMix {
  /** The low-pass over the world and the effects, Hz. */
  cutoff: number;
  /** Its resonance: a touch of it gives the underwater feel. */
  q: number;
  /** Gain on the world and the effects (the heartbeat and the interface are not ducked). */
  duck: number;
  /** Heartbeat tempo and level, and a small rise in its pitch as it races. */
  bpm: number;
  beatGain: number;
  beatRate: number;
}

const clamp01 = (x: number): number => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);
const smoothstep = (a: number, b: number, x: number): number => {
  const u = clamp01((x - a) / (b - a));
  return u * u * (3 - 2 * u);
};

/**
 * What being hurt (0 none .. 1 about to die) does to the sound: the world
 * muffles (a low-pass sliding exponentially from open to 700 Hz, so one hit
 * is clearly heard and three are drowning), recedes by up to 5 dB, and a
 * heartbeat rises from 72 to 130 bpm, fading in from a light graze.
 */
export function hurtMix(amount: number): HurtMix {
  const x = clamp01(amount);
  return {
    cutoff: 20000 * Math.pow(700 / 20000, Math.pow(x, 0.8)),
    q: 0.7 + 0.5 * x,
    duck: 1 - 0.45 * x,
    bpm: 72 + 58 * x,
    beatGain: x < 0.05 ? 0 : smoothstep(0.05, 0.7, x),
    beatRate: 1 + 0.06 * x,
  };
}

export interface SlowmoMix {
  /** Multiplier on every voice's playback rate: pitch and time fall together. */
  rate: number;
  /** A low-pass that closes with it, Hz. */
  cutoff: number;
  /** Multiplier on the reverb's return: slow motion sounds bigger. */
  reverb: number;
}

/** Slow motion (0 off .. 1 full): everything an octave-ish down, darker, wetter. */
export function slowmoMix(amount: number): SlowmoMix {
  const x = clamp01(amount);
  return {
    rate: 1 - 0.45 * x,
    cutoff: 20000 * Math.pow(2500 / 20000, x),
    reverb: 1 + 1.5 * x,
  };
}

/** The one low-pass both treatments share: the darker of the two wins. */
export function combinedCutoff(hurt: number, slowmo: number): number {
  return Math.min(hurtMix(hurt).cutoff, slowmoMix(slowmo).cutoff);
}

/** Whether slow motion just engaged (so the boom plays once, not on every small change). */
export function slowmoEngaged(previous: number, next: number): boolean {
  return previous < 0.1 && next >= 0.3;
}

// --- voices ------------------------------------------------------------------------------

export interface VoiceInfo {
  id: number;
  cue: string;
  /** 0 garnish .. 3 the player's own. */
  priority: number;
  /** Context time it starts (may be in the future, for delayed and far sounds). */
  start: number;
  /** Its gain at the bus. */
  gain: number;
  playbackRate: number;
  /** The take's RMS per ``block`` seconds (see envelopeOf), or null if unknown. */
  envelope: Float32Array | null;
  block: number;
  /** Seconds of buffer. */
  duration: number;
}

/** How loud a voice is at ``now``: its gain times its take's envelope at that point. */
export function voiceLevel(v: VoiceInfo, now: number): number {
  const elapsed = (now - v.start) * v.playbackRate;
  if (elapsed >= v.duration) return 0;
  if (!v.envelope || v.envelope.length === 0) return v.gain * (elapsed < 0 ? 1 : 1 - elapsed / v.duration);
  // Not started yet: it will be as loud as its loudest block.
  if (elapsed < 0) {
    let top = 0;
    for (const e of v.envelope) top = Math.max(top, e);
    return v.gain * top;
  }
  const k = Math.min(v.envelope.length - 1, Math.floor(elapsed / v.block));
  return v.gain * v.envelope[k]!;
}

export interface Admission {
  /** Voices to fade out now to make room. */
  steal: number[];
  /** True when the new sound should not play at all. */
  drop: boolean;
}

/**
 * Admit a new voice. Two rules, in order:
 *
 * 1. A cue has at most ``maxInstances`` voices: the oldest of them goes (a
 *    fourth revolver shot replaces the first, whose tail is all that is left).
 * 2. At most ``maxVoices`` in all: the voice that is *quietest right now*
 *    among those of no higher priority goes (the oldest on a tie), so a wave
 *    of shots steals the fading tails of earlier ones, never the player's
 *    own shot. If every voice outranks the newcomer, the newcomer is dropped.
 */
export function admit(
  voices: readonly VoiceInfo[],
  incoming: { cue: string; priority: number },
  now: number,
  maxVoices: number,
  maxInstances: number,
): Admission {
  const steal: number[] = [];
  const same = voices.filter((v) => v.cue === incoming.cue).sort((a, b) => a.start - b.start || a.id - b.id);
  let excess = same.length - maxInstances + 1;
  for (let k = 0; k < same.length && excess > 0; k++, excess--) steal.push(same[k]!.id);
  const remaining = voices.filter((v) => !steal.includes(v.id));
  if (remaining.length < maxVoices) return { steal, drop: false };
  let best: VoiceInfo | null = null;
  let bestLevel = Infinity;
  for (const v of remaining) {
    if (v.priority > incoming.priority) continue;
    const level = voiceLevel(v, now);
    if (level < bestLevel - 1e-9 || (Math.abs(level - bestLevel) <= 1e-9 && best !== null && v.start < best.start)) {
      best = v;
      bestLevel = level;
    }
  }
  if (!best) return { steal, drop: true };
  steal.push(best.id);
  return { steal, drop: false };
}

/** Pick a take at random, never the same one twice running when there is a choice. */
export function pickTake(count: number, last: number, random: number): number {
  if (count <= 1) return 0;
  if (last < 0 || last >= count) return Math.min(count - 1, Math.floor(random * count));
  const k = Math.min(count - 2, Math.floor(random * (count - 1)));
  return k >= last ? k + 1 : k;
}

/** A play-time rate: the requested rate, varied by up to ±``spread``. */
export function variedRate(rate: number, spread: number, random: number): number {
  return rate * (1 + spread * (2 * random - 1));
}
