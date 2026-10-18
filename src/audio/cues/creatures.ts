/**
 * Throats and hearts: the gang's last breath, the chicken, the crow, a dog
 * down the valley, a horse in the livery, and the player's own heartbeat.
 *
 * Every voice here is a glottal pulse train (with jitter, shimmer and breath)
 * or plain breath noise, run through formant resonances that move over time.
 * None of them are words; the gang's deaths in particular are exhales and
 * grunts, short and breathy, because anything more is a cartoon.
 */
import { type Curve, lerp, sampled } from "../dsp/curves";
import { bandpass, highpass, lowpass } from "../dsp/filters";
import { wrap } from "../dsp/master";
import { type Mono, adsr, fade, normalize, shapeBy } from "../dsp/signal";
import { addMode, formants, glottal, white } from "../dsp/sources";
import { roomMono } from "../dsp/space";
import type { Take } from "../dsp/take";
import { burst, lubDub, puff, thump } from "./kit";

interface VocalOptions {
  /** Fundamental in Hz over u = 0..1. */
  f0: Curve;
  /** How much of the source is voice (1) versus breath alone (0). */
  voicing?: Curve;
  /** Resonances: centre (Hz) over u, a Q and a level. */
  tract: { f: Curve; q: number; amp: number }[];
  jitter?: number;
  shimmer?: number;
  /** Pressed (1) or slack (0) folds. */
  tension?: Curve;
  /** Level over u (an envelope). */
  level?: Curve;
  /** Extra breath riding on the voice, 0..1. */
  breath?: number;
  /** Period-doubling roughness, 0..1. */
  rasp?: number;
}

/**
 * One vocal gesture ``seconds`` long. The night and the ridge have their
 * own: each growls with a different shape (a sine here, a parabola there, a
 * triangle on the ridge), and each pack's takes are tuned to its own.
 */
function vocal(t: Take, seconds: number, o: VocalOptions): Mono {
  const n = t.n(seconds);
  const f0 = sampled(n, o.f0);
  const voice = glottal(n, t.sr, t.rng, f0, {
    jitter: o.jitter ?? 0.02,
    shimmer: o.shimmer ?? 0.1,
    breath: o.breath ?? 0.08,
    tension: o.tension ? sampled(n, o.tension) : 0.5,
  });
  normalize(voice);
  const air = white(n, t.rng);
  const voicing = sampled(n, o.voicing ?? (() => 1));
  const level = sampled(n, o.level ?? (() => 1));
  // Rasp: every other cycle weaker (period doubling), which puts a rough
  // subharmonic under the voice — what makes a crow a crow and not a flute.
  const rasp = o.rasp ?? 0;
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const v = voicing[i]!;
    let s = voice[i]!;
    if (rasp > 0) {
      ph += f0[i]! / (2 * t.sr);
      s *= 1 - rasp * (0.5 + 0.5 * Math.sin(2 * Math.PI * ph));
    }
    voice[i] = (s * v + air[i]! * 0.5 * (1 - v)) * level[i]!;
  }
  const out = formants(voice, t.sr, o.tract.map((f) => ({ freq: f.f, q: f.q, amp: f.amp })));
  // Whatever the level curve does, a gesture starts and ends at silence: a
  // voice cut mid-cycle is a click, which a spectrogram shows as a wall.
  return fade(out, t.sr, 0.004, 0.012);
}

/**
 * A gang member's last breath, one of four shapes (by take): a grunt and a
 * long exhale; a nasal *hngh* and a weak breath out; a gasp in and a dying
 * voiced sigh; a choked *ukh* cut off by the throat closing.
 */
export function banditDeath(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(1.3);
  const pitch = r.range(100, 128) * t.p;
  const shape = t.index % 4;
  const mouth = t.cutoff;
  if (shape === 0 || shape === 3) {
    // The grunt: pressed, short, the mouth half open.
    const len = t.j(shape === 0 ? 0.17 : 0.11, 0.15);
    const grunt = vocal(t, len, {
      f0: (u) => pitch * (1.1 - 0.2 * u),
      tension: () => 0.85,
      jitter: 0.04,
      shimmer: 0.2,
      tract: [
        { f: (u) => lerp(640, 520, u) * mouth, q: 7, amp: 1 },
        { f: (u) => lerp(1150, 1300, u) * mouth, q: 10, amp: 0.5 },
        { f: () => 2450 * mouth, q: 14, amp: 0.2 },
      ],
      level: (u) => Math.min(1, u * 12) * (shape === 3 ? (u < 0.85 ? 1 : (1 - u) / 0.15) : 1 - 0.5 * u),
    });
    t.put(out, grunt, 0.01, 1);
    // Then the air going out of him.
    const at = 0.01 + len + (shape === 0 ? r.range(0.02, 0.06) : r.range(0.06, 0.12));
    const exLen = t.j(shape === 0 ? 0.6 : 0.35, 0.15);
    const exhale = vocal(t, exLen, {
      f0: (u) => pitch * (0.8 - 0.3 * u),
      voicing: (u) => (shape === 0 ? 0.35 * (1 - u) : 0.05),
      jitter: 0.08,
      tract: [
        { f: (u) => lerp(700, 480, u) * mouth, q: 5, amp: 1 },
        { f: (u) => lerp(1250, 1450, u) * mouth, q: 7, amp: 0.6 },
        { f: () => 2500 * mouth, q: 9, amp: 0.25 },
      ],
      level: (u) => Math.min(1, u * 8) * Math.pow(1 - u, 1.4),
    });
    t.put(out, exhale, at, shape === 0 ? 0.55 : 0.4);
  } else if (shape === 1) {
    // Hngh: the mouth shut, the sound through the nose.
    const len = t.j(0.14, 0.2);
    const hum = vocal(t, len, {
      f0: (u) => pitch * (1.15 - 0.25 * u),
      tension: () => 0.8,
      jitter: 0.04,
      tract: [
        { f: () => 260 * mouth, q: 5, amp: 1 },
        { f: () => 1000 * mouth, q: 8, amp: 0.25 },
        { f: () => 2200 * mouth, q: 10, amp: 0.1 },
      ],
      level: (u) => Math.min(1, u * 10) * (1 - 0.6 * u),
    });
    t.put(out, hum, 0.01, 1);
    const breath = vocal(t, t.j(0.45, 0.2), {
      f0: () => pitch,
      voicing: () => 0,
      tract: [
        { f: () => 600 * mouth, q: 4, amp: 1 },
        { f: () => 1500 * mouth, q: 6, amp: 0.5 },
      ],
      level: (u) => Math.min(1, u * 6) * Math.pow(1 - u, 1.6),
    });
    t.put(out, breath, 0.01 + len + r.range(0.05, 0.1), 0.35);
  } else {
    // A gasp in, then a voiced sigh that sinks into a croak.
    const gasp = vocal(t, t.j(0.14, 0.2), {
      f0: () => pitch,
      voicing: () => 0,
      tract: [
        { f: (u) => lerp(500, 800, u) * mouth, q: 6, amp: 1 },
        { f: (u) => lerp(1600, 2000, u) * mouth, q: 8, amp: 0.6 },
      ],
      level: (u) => Math.sin(Math.PI * u),
    });
    t.put(out, gasp, 0.01, 0.45);
    const sigh = vocal(t, t.j(0.62, 0.15), {
      f0: (u) => pitch * (1.05 - 0.45 * u),
      voicing: (u) => 0.9 - 0.5 * u,
      tension: (u) => 0.6 - 0.4 * u,
      jitter: 0.03,
      shimmer: 0.25,
      tract: [
        { f: (u) => lerp(720, 520, u) * mouth, q: 6, amp: 1 },
        { f: (u) => lerp(1100, 1350, u) * mouth, q: 9, amp: 0.5 },
        { f: () => 2450 * mouth, q: 12, amp: 0.18 },
      ],
      level: (u) => Math.min(1, u * 10) * Math.pow(1 - u, 1.2),
    });
    t.put(out, sigh, 0.2, 0.9);
  }
  // A little of the body under it: the breath is heard from the chest.
  highpass(out, t.sr, 90, 2);
  return out;
}

/** A hen: a few *bok*s, sometimes ending in a *ba-GAWK*. */
export function chickenCluck(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(1.4);
  let at = 0.01;
  const count = r.int(2, 5);
  const base = r.range(360, 440) * t.p;
  for (let k = 0; k < count; k++) {
    const len = r.range(0.045, 0.075);
    const f = base * r.range(0.92, 1.1);
    const bok = vocal(t, len, {
      f0: (u) => f * (1.08 - 0.18 * u),
      tension: () => 0.9,
      jitter: 0.03,
      shimmer: 0.2,
      tract: [
        { f: (u) => lerp(1050, 850, u), q: 5, amp: 1 },
        { f: () => 2000, q: 7, amp: 0.6 },
        { f: () => 3300, q: 9, amp: 0.25 },
      ],
      level: (u) => Math.min(1, u * 25) * Math.pow(1 - u, 0.8),
    });
    t.put(out, bok, at, r.range(0.6, 0.9));
    at += len + r.range(0.08, 0.17);
  }
  if (r.chance(0.6) || t.index === 0) {
    const ba = vocal(t, 0.05, {
      f0: () => base * 1.05,
      tension: () => 0.9,
      tract: [{ f: () => 950, q: 5, amp: 1 }, { f: () => 1900, q: 7, amp: 0.5 }],
      level: (u) => Math.min(1, u * 20) * (1 - u),
    });
    t.put(out, ba, at, 0.7);
    const gawk = vocal(t, r.range(0.16, 0.22), {
      f0: (u) => base * (1.2 + 0.5 * Math.sin(Math.PI * Math.min(1, u * 1.4))),
      tension: () => 0.95,
      jitter: 0.05,
      shimmer: 0.25,
      tract: [
        { f: () => 1150, q: 5, amp: 1 },
        { f: (u) => lerp(2100, 1800, u), q: 7, amp: 0.7 },
        { f: () => 3500, q: 9, amp: 0.3 },
      ],
      level: (u) => Math.min(1, u * 15) * Math.pow(1 - u, 0.7),
    });
    t.put(out, gawk, at + 0.08, 1);
  }
  return out;
}

/** Wings beating: bursts of low air with a feather rustle, ``rate`` flaps a second. */
function flaps(t: Take, seconds: number, rate: number): Mono {
  const r = t.rng;
  const out = t.canvas(seconds + 0.1);
  for (let at = 0; at < seconds; at += (1 / rate) * r.range(0.9, 1.1)) {
    const air = puff(t, 0.05, r.range(1500, 2600), 0.006, 0.012);
    t.put(out, air, at, r.range(0.5, 1) * (1 - 0.5 * (at / seconds)));
    const rustle = burst(t, 0.04, 2500, 8000, 0.003, 0.008);
    t.put(out, rustle, at + 0.005, r.range(0.1, 0.25));
  }
  return out;
}

/** The chicken, shot at: wings going, an outraged screech, and two indignant *bwak*s. */
export function chickenSquawk(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(1.3);
  t.put(out, flaps(t, t.j(0.75, 0.15), r.range(11, 14)), 0, 0.5);
  const base = r.range(620, 720) * t.p;
  const sq = vocal(t, t.j(0.36, 0.15), {
    f0: (u) => base * (1 + 0.6 * Math.min(1, u * 6) - 0.3 * Math.max(0, u - 0.5)),
    tension: () => 1,
    jitter: 0.08,
    shimmer: 0.35,
    breath: 0.3,
    rasp: 0.5,
    tract: [
      { f: () => 1250, q: 4, amp: 1 },
      { f: () => 2500, q: 6, amp: 0.8 },
      { f: () => 3900, q: 8, amp: 0.4 },
    ],
    level: (u) => Math.min(1, u * 20) * (u < 0.8 ? 1 : (1 - u) / 0.2),
  });
  t.put(out, sq, 0.04, 1);
  let at = 0.5;
  for (let k = 0; k < 2; k++) {
    const bwak = vocal(t, r.range(0.08, 0.12), {
      f0: (u) => base * (1.05 - 0.25 * u),
      tension: () => 0.95,
      jitter: 0.06,
      shimmer: 0.3,
      tract: [
        { f: () => 1100, q: 5, amp: 1 },
        { f: () => 2200, q: 6, amp: 0.6 },
      ],
      level: (u) => Math.min(1, u * 20) * Math.pow(1 - u, 0.7),
    });
    t.put(out, bwak, at, r.range(0.6, 0.8));
    at += r.range(0.15, 0.22);
  }
  return out;
}

/**
 * A horse in the livery: a squeal rising to a trilled whinny that slides
 * down, a rough low *hrr* under a second, rough voice, and a snort through
 * the nostrils to finish.
 */
export function horseNeigh(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(2.0);
  const top = r.range(900, 1100) * t.p;
  const len = t.j(1.15, 0.12);
  const trill = r.range(9, 12);
  const neigh = vocal(t, len, {
    f0: (u) => {
      const rise = u < 0.2 ? lerp(0.5, 1, u / 0.2) : lerp(1, 0.4, (u - 0.2) / 0.8);
      return top * rise * (1 + 0.1 * Math.sin(2 * Math.PI * trill * u * len) * Math.min(1, u * 5));
    },
    tension: () => 0.9,
    jitter: 0.05,
    shimmer: 0.3,
    breath: 0.25,
    tract: [
      { f: () => 560, q: 4, amp: 0.8 },
      { f: () => 1350, q: 5, amp: 1 },
      { f: () => 2400, q: 6, amp: 0.5 },
      { f: () => 3600, q: 8, amp: 0.2 },
    ],
    level: (u) => Math.min(1, u * 10) * (0.6 + 0.4 * Math.sin(2 * Math.PI * trill * u * len + 1)) * (u < 0.85 ? 1 : (1 - u) / 0.15),
  });
  t.put(out, neigh, 0.02, 1);
  // A second, rougher source a non-harmonic step above: the biphonation a real whinny has.
  const rough = vocal(t, len * 0.7, {
    f0: (u) => top * 1.37 * lerp(0.9, 0.55, u),
    tension: () => 1,
    jitter: 0.1,
    shimmer: 0.4,
    tract: [{ f: () => 1800, q: 4, amp: 1 }, { f: () => 3000, q: 6, amp: 0.5 }],
    level: (u) => Math.sin(Math.PI * u),
  });
  t.put(out, rough, 0.1, 0.25);
  const hrr = vocal(t, 0.35, {
    f0: () => r.range(110, 140),
    tension: () => 0.4,
    jitter: 0.1,
    shimmer: 0.4,
    breath: 0.5,
    tract: [{ f: () => 450, q: 4, amp: 1 }, { f: () => 1100, q: 5, amp: 0.5 }],
    level: (u) => Math.sin(Math.PI * u) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 22 * u * 0.35)),
  });
  t.put(out, hrr, 0.02 + len - 0.08, 0.5);
  // The snort: air through the nostrils, fluttering them.
  const snortAt = 0.02 + len + 0.22;
  const snort = white(t.n(0.3), r);
  bandpass(snort, t.sr, 250, 2200, 2);
  normalize(snort);
  shapeBy(snort, (u) => Math.min(1, u * 15) * Math.pow(1 - u, 1.5) * (0.55 + 0.45 * Math.sin(2 * Math.PI * 30 * u * 0.3)));
  t.put(out, snort, snortAt, 0.45);
  return out;
}

/** A crow on a rooftop: two or three harsh *caaw*s, rough and noisy. */
export function crowCaw(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(1.6);
  let at = 0.01;
  const count = r.int(2, 4);
  const base = r.range(520, 640) * t.p;
  for (let k = 0; k < count; k++) {
    const len = r.range(0.2, 0.3);
    const caw = vocal(t, len, {
      f0: (u) => base * (0.9 + 0.2 * Math.min(1, u * 8) - 0.18 * Math.max(0, u - 0.6)),
      tension: () => 0.95,
      jitter: 0.12,
      shimmer: 0.4,
      breath: 0.7,
      rasp: 0.7,
      tract: [
        { f: (u) => lerp(1350, 1200, u), q: 4, amp: 1 },
        { f: () => 2000, q: 5, amp: 0.7 },
        { f: () => 3200, q: 7, amp: 0.3 },
      ],
      level: (u) => Math.min(1, u * 18) * (u < 0.75 ? 1 : (1 - u) / 0.25),
    });
    t.put(out, caw, at, k === count - 1 ? 0.8 : 1);
    at += len + r.range(0.13, 0.22);
  }
  return out;
}

/**
 * A dog barking somewhere past the edge of town: two or three barks, their
 * top lost to the distance, coming back off the mesa a beat later.
 */
export function dogBarkDistant(t: Take): Mono {
  const r = t.rng;
  const dry = t.canvas(1.2);
  let at = 0.01;
  const count = r.int(2, 4);
  const base = r.range(420, 520) * t.p;
  for (let k = 0; k < count; k++) {
    const len = r.range(0.12, 0.17);
    const bark = vocal(t, len, {
      f0: (u) => base * (1.05 - 0.4 * u),
      voicing: (u) => Math.min(1, u * 10),
      tension: () => 0.9,
      jitter: 0.05,
      shimmer: 0.25,
      breath: 0.2,
      tract: [
        { f: (u) => lerp(750, 550, u), q: 5, amp: 1 },
        { f: (u) => lerp(1450, 950, u), q: 6, amp: 0.7 },
        { f: () => 2600, q: 8, amp: 0.3 },
      ],
      level: (u) => Math.min(1, u * 30) * Math.pow(1 - u, 0.8),
    });
    t.put(dry, bark, at, 1);
    at += len + r.range(0.18, 0.32);
  }
  lowpass(dry, t.sr, t.c(1900), 2);
  highpass(dry, t.sr, 180, 2);
  const out = roomMono(dry, t.sr, r, { t60: 1.1, size: 0.8, damping: 0.3, mix: 0.45, predelay: 0.03, tail: 0.6 });
  // The mesa's echo: a darker copy a quarter second later, and a fainter one.
  const echo = lowpass(Float32Array.from(dry), t.sr, 1100, 2);
  t.put(out, echo, 0.24, 0.3);
  t.put(out, echo, 0.5, 0.12);
  return out;
}

/** The heartbeat loop: one beat at a resting 66–74 bpm, wrapped so it repeats exactly. */
export function heartbeat(t: Take): Mono {
  const r = t.rng;
  const period = 60 / r.range(66, 74);
  const beat = lubDub(t, period * 0.36, 1);
  const render = new Float32Array(t.n(period) + beat.length);
  t.put(render, beat, 0.02, 1);
  return wrap(render, t.n(period));
}

/** One beat, for the engine's hurt heartbeat, which schedules beats itself so its tempo can follow the damage. */
export function heartbeatBeat(t: Take): Mono {
  return lubDub(t, t.j(0.3, 0.05), 1);
}

/**
 * The player's death: the fall into the dust, heard from inside — muffled —
 * two last heartbeats, the second slower and weaker, a low swell under
 * everything, and the ears ringing as the world goes away.
 */
export function deathPlayer(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(3.6);
  const body = t.canvas(3.6);
  t.put(body, thump(t, 0.5, 85 * t.p, 34 * t.p, 0.003, 0.12, 0.5), 0.25, 1);
  t.put(body, burst(t, 0.4, 35, 380, 0.003, 0.09, 4), 0.25, 0.9);
  const dust = puff(t, 0.6, 1600, 0.05, 0.12);
  t.put(body, dust, 0.27, 0.25);
  t.put(body, lubDub(t, 0.3, 1), 0.75, 0.9);
  t.put(body, lubDub(t, 0.36, 1), 1.95, 0.55);
  // Steady tones as undamped resonators (two multiplies a sample, not a sine).
  const swell = t.canvas(3.3);
  for (const [f, a] of [[55, 1], [82.4, 0.6], [110, 0.25]] as const) addMode(swell, t.sr, 0, f * t.p, a, 1000, r.range(0, 6));
  adsr(swell, t.sr, 0.6, 0.8, 0.6, 1.6);
  t.put(body, swell, 0.2, 0.22);
  lowpass(body, t.sr, 1100, 2);
  t.put(out, body, 0, 1);
  // The ringing: two close tones beating, rising in and slowly leaving.
  const ring = t.canvas(3.2);
  const f = r.range(3300, 4100);
  addMode(ring, t.sr, 0, f, 1, 1000, 0);
  addMode(ring, t.sr, 0, f + 2.5, 0.6, 1000, 0);
  shapeBy(ring, (u) => Math.min(1, u * 6) ** 2 * Math.pow(1 - u, 1.5));
  t.put(out, ring, 0.08, 0.035);
  return out;
}
