/**
 * The ballad on the station's radio: a slow 1950s doo-wop in C, from the old
 * tube radio behind the counter.
 */
import { midiHz, sampled } from "../../dsp/curves";
import { biquad, highpass, lowpass } from "../../dsp/filters";
import { wrap } from "../../dsp/master";
import { type Mono, normalize, shapeBy } from "../../dsp/signal";
import { addMode, addString, bandNoise, click, formants, glottal, saw, white } from "../../dsp/sources";
import type { Take } from "../../dsp/take";
import { burst, thump } from "../kit";

/** The lead's melody over two bars of 12/8: [eighth, midi, eighths long]. An original doo-wop line in C. */
const BALLAD_LEAD: readonly [number, number, number][] = [
  [0, 64, 3], [3, 67, 3],
  [6, 69, 4], [10, 67, 1], [11, 64, 1],
  [12, 65, 3], [15, 69, 3],
  [18, 67, 3], [21, 65, 1.5], [22.5, 62, 1.5],
];

/** I–vi–IV–V, two chords a bar: the bass's root, fifth and walk into the next chord; the piano's triplet chord; the group's "ooh". */
const BALLAD_CHORDS: readonly { bass: readonly [number, number, number]; tri: readonly number[]; pad: readonly number[] }[] = [
  { bass: [48, 43, 47], tri: [67, 72, 76], pad: [55, 60, 64] },
  { bass: [45, 40, 43], tri: [69, 72, 76], pad: [57, 60, 64] },
  { bass: [41, 48, 42], tri: [69, 72, 77], pad: [57, 60, 65] },
  { bass: [43, 50, 47], tri: [71, 74, 77], pad: [55, 59, 65] },
];

/**
 * A 1950s ballad from the old tube radio behind the counter: a slow 12/8
 * doo-wop in C — I, vi, IV, V, two chords a bar — the piano hammering its
 * triplet chords on every eighth, an upright bass walking root, fifth and a
 * step into the next chord, brushes swirling on the snare with a tap on the
 * backbeat, the group's soft "ooh" under a crooner's "oh" (formant vowels,
 * no words). All of it through the radio: the little speaker's 250–3500 Hz,
 * its cone and cabinet honking, the tube's soft asymmetric saturation, a
 * thin static and crackle.
 *
 * The loop is exactly two bars: every event is placed on the bars' grid and
 * wrapped round, the brushes' swirl and the static are built over exactly
 * one loop, the speaker's filters run over the whole render before the wrap
 * (which filters the loop circularly), and the saturation is applied after
 * it, sample by sample. The seam is just the next beat.
 *
 * The radio passes nothing above 3.5 kHz, so the table plays the band at
 * half the rate (see halfRate): the longest sound of the night for half of
 * what it would cost, with nothing audible lost.
 */
export function nightBallad(t: Take): Mono {
  const r = t.rng;
  const beat = 60 / r.range(56, 64);
  const length = t.n(8 * beat);
  const eighth = length / 24 / t.sr;
  const chordLen = 6 * eighth;
  const n = length + t.n(0.7);
  const loopSec = length / t.sr;
  const time = (u: number): number => (u * n) / t.sr;
  const human = (): number => 0.004 + r.range(0, 0.008);

  const piano = new Float32Array(n);
  const bass = new Float32Array(n);
  BALLAD_CHORDS.forEach((chord, c) => {
    for (let e = 0; e < 6; e++) {
      const at = (c * 6 + e) * eighth + human();
      const accent = e === 0 ? 0.85 : e === 3 ? 0.7 : 0.5;
      for (const midi of chord.tri) {
        addString(piano, t.sr, r, at, midiHz(midi), accent * r.range(0.9, 1.05), {
          t60: 1.4, brightness: 0.45, pulse: 0.0022, position: 0.13, length: eighth * 0.92, release: 0.035,
        });
      }
    }
    const [root, fifth, walk] = chord.bass;
    const steps: [number, number, number][] = [[0, root, 2.8], [3, fifth, 1.8], [5, walk, 0.9]];
    for (const [e, midi, len] of steps) {
      addString(bass, t.sr, r, (c * 6 + e) * eighth + human(), midiHz(midi), e === 0 ? 1 : 0.8, {
        t60: 1.5, brightness: 0.15, hardness: 900, position: 0.22, length: len * eighth, release: 0.08,
      });
    }
  });
  normalize(piano);
  normalize(bass);

  const drums = new Float32Array(n);
  for (let b = 0; b < 8; b++) {
    const at = b * 3 * eighth + human();
    if (b % 2 === 0) {
      t.put(drums, thump(t, 0.25, 95, 55, 0.003, 0.05, 0.5), at, 0.5);
      t.put(drums, burst(t, 0.04, 200, 900, 0.001, 0.008, 2), at, 0.15);
    } else {
      t.put(drums, burst(t, 0.2, 900, 7000, 0.004, 0.05, 2), at, 0.55);
      addMode(drums, t.sr, at, r.range(185, 205), 0.3, 0.03, 0);
      t.put(drums, burst(t, 0.2, 2000, 6000, 0.006, 0.07, 2), at, 0.25);
    }
  }
  for (let e = 0; e < 24; e++) {
    t.put(drums, burst(t, 0.04, 3000, 9000, 0.001, 0.012, 2), e * eighth + human(), e % 3 === 0 ? 0.12 : 0.07);
  }
  // The swirl: brushes circling on the head, one sweep a beat, built over exactly one loop.
  const swirl = bandNoise(length, t.sr, r, 1200, 6000, 2);
  shapeBy(swirl, (u) => 0.35 + 0.65 * Math.sin(Math.PI * 8 * u) ** 2);
  t.put(drums, swirl, 0, 0.1);

  // The crooner: one legato line, gliding into each note, a vibrato once a note is held, a breath between the phrases.
  const notes = BALLAD_LEAD.map(([e, midi, len], k) => ({
    at: e * eighth,
    end: (e + len) * eighth,
    midi,
    from: BALLAD_LEAD[(k + BALLAD_LEAD.length - 1) % BALLAD_LEAD.length]![1],
  }));
  const vib = r.range(5.0, 5.8);
  const noteAt = (s: number): (typeof notes)[number] => {
    let k = notes.length - 1;
    while (k > 0 && notes[k]!.at > s) k--;
    return notes[k]!;
  };
  const f0 = sampled(n, (u) => {
    const s = time(u);
    const note = noteAt(s);
    const held = s - note.at;
    const m = note.midi + (note.from - note.midi) * Math.exp(-held / 0.045);
    return midiHz(m + 0.18 * Math.min(1, Math.max(0, (held - 0.25) / 0.3)) * Math.sin(2 * Math.PI * vib * s));
  });
  const level = sampled(n, (u) => {
    const s = time(u);
    if (s >= loopSec) return 0;
    const ps = s < loopSec / 2 ? 0 : loopSec / 2;
    const swell = 0.85 + 0.15 * Math.min(1, (s - noteAt(s).at) / 0.3);
    return Math.min(1, (s - ps) / 0.06) * Math.min(1, (ps + loopSec / 2 - s) / 0.12) * swell;
  });
  const voice = glottal(n, t.sr, r, f0, { jitter: 0.008, shimmer: 0.05, breath: 0.06, tension: 0.45 });
  normalize(voice);
  const lead = formants(voice, t.sr, [
    { freq: 420, q: 5, amp: 1 },
    { freq: 850, q: 6, amp: 0.55 },
    { freq: 2500, q: 10, amp: 0.18 },
  ]);
  // The station's leveller: through a fixed "oh" a low E comes out several
  // dB under an A (its harmonics miss the resonances), and a crooner on the
  // air never did. A slow follower (a note's worth, so the vibrato still
  // breathes) evens the notes; then the phrasing goes on.
  const settle = Math.exp(-1 / (0.12 * t.sr));
  let env = 0;
  for (let i = 0; i < Math.min(n, t.n(0.2)); i++) env = settle * env + (1 - settle) * Math.abs(lead[i]!);
  for (let i = 0; i < n; i++) {
    env = settle * env + (1 - settle) * Math.abs(lead[i]!);
    lead[i] = (lead[i]! / (env + 1e-4)) * level[i]!;
  }
  normalize(lead);

  // The group's "ooh": three voices on the chord, re-sung at each change.
  const group = new Float32Array(n);
  for (let v = 0; v < 3; v++) {
    const wob = r.range(4.4, 5.2);
    const freq = sampled(n, (u) => {
      const s = time(u);
      const c = Math.min(3, Math.floor(s / chordLen));
      return midiHz(BALLAD_CHORDS[c]!.pad[v]!) * (1 + 0.004 * Math.sin(2 * Math.PI * wob * s + v));
    });
    const s = saw(n, t.sr, freq, 0, r.next());
    for (let i = 0; i < n; i++) group[i]! += s[i]!;
  }
  shapeBy(group, (u) => {
    const s = time(u);
    if (s >= loopSec) return 0;
    const x = s % chordLen;
    return Math.min(1, x / 0.08) * Math.min(1, (chordLen - x) / 0.06);
  }, 16);
  const ooh = formants(group, t.sr, [
    { freq: 330, q: 4, amp: 1 },
    { freq: 800, q: 5, amp: 0.45 },
  ]);
  lowpass(ooh, t.sr, 2500, 2);
  normalize(ooh);

  // The radio's own: static over exactly one loop, crackles as events.
  const mix = new Float32Array(n);
  const staticNoise = white(length, r);
  for (let k = 0, c = r.int(12, 24); k < c; k++) {
    t.put(mix, click(t.sr, r, r.range(0.0008, 0.002), 800, 8000), r.range(0.01, loopSec), r.range(0.03, 0.12));
  }
  for (let i = 0; i < n; i++) {
    mix[i]! += 0.5 * piano[i]! + 0.65 * bass[i]! + 0.45 * drums[i]! + 0.8 * lead[i]! + 0.3 * ooh[i]!;
  }
  t.put(mix, staticNoise, 0, 0.015);

  // The speaker: a small cone in a wooden cabinet — nothing under 250 Hz or
  // over 3.5 kHz, the cone honking in the upper mids, the box a little.
  highpass(mix, t.sr, 250, 2);
  lowpass(mix, t.sr, 3500, 4);
  biquad(mix, t.sr, "peak", 1500, 0.8, 7);
  biquad(mix, t.sr, "peak", 520, 1.6, 1.5);
  const out = normalize(wrap(mix, length));
  // The output tube: a soft, slightly asymmetric bend (a little even harmonic warmth).
  const drive = 1.8;
  const bias = 0.12;
  const off = Math.tanh(drive * bias);
  const norm = Math.tanh(drive * (1 + bias)) - off;
  for (let i = 0; i < length; i++) out[i] = (Math.tanh(drive * (out[i]! + bias)) - off) / norm;
  return out;
}
