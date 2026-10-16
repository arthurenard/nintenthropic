/**
 * The Handheld trailer's music: a 40-second electronic trailer cue at 120 BPM in
 * A minor, synthesised entirely in code (see dsp.mjs and instruments.mjs) and
 * written as a WAV. Nothing here plays a sound: it is arithmetic on arrays.
 *
 *   node tools/trailer/music/compose.mjs [--out tools/trailer/out/music] [--lufs -14]
 *
 * Writes music.wav (48 kHz stereo, 32-bit float, exactly 40.000 s), cues.json
 * (the times of impacts, drops, risers and fills, for the editor), and, with
 * analyze.mjs, spectrogram.png and an RMS-per-bar table.
 *
 * The grid (bars of 2 s, beats of 0.5 s):
 *   bars 1-2   0-4     the hook: a thump on each word at 0/1/2/3 s (A C E A), drone, ticking clock, a rising tone;
 *                      a lock-on blip at 3.5, then a breath (near silence) to 4.0
 *   4.0               DROP 1
 *   bars 3-9   4-18    groove (fills at 8, 12, 16), the motif enters at bar 4
 *   bar 10     18-20   half-time, a riser into 20.0
 *   bar 11     20-22   break: pad and the motif alone, riser and reverse swell into 22.0
 *   22.0              DROP 2 (bigger)
 *   bars 12-15 22-30   driving (fills at 26, 30)
 *   bars 16-17 30-34   climax, a snare roll in the last two beats
 *   34.0              the hit, the resolution (A major), a long tail
 *   bars 18-20 34-40   sparse; the motif once on a soft pluck; faded out by 40.0
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as I from "./instruments.mjs";
import {
  SR, Svf, biquad, clamp, compress, convolveStereo, db, fadeIn, fadeOut, filter, limit, makeIR, measure, mtof, panGains, pingPong,
  reversed, rng, secs, smoothstep, softClip, toDb, whiteNoise, writeWav,
} from "./dsp.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i < 0 ? fallback : argv[i + 1];
};
const OUT = resolve(HERE, opt("out", "../out/music"));
const TARGET_LUFS = Number(opt("lufs", -14));
const TOTAL = 40;
const N = secs(TOTAL);
const T0 = Date.now();
const log = (...a) => console.log(`[music ${((Date.now() - T0) / 1000).toFixed(1).padStart(5)}s]`, ...a);

// --- the grid and the harmony ----------------------------------------------------------------------------------------

/** The start (s) of bar n (1-based). */
const bar = (n) => (n - 1) * 2;
/** The time of a 16th-note step (0..15, fractions allowed) within bar n. */
const step = (n, s) => bar(n) + s * 0.125;

/** sub: the sub bass (MIDI); rs: the reese's note; pad: the voicing. */
const CHORDS = {
  Am: { sub: 33, rs: 45, pad: [57, 60, 64, 69] },
  F: { sub: 29, rs: 41, pad: [57, 60, 65, 69] },
  C: { sub: 36, rs: 48, pad: [55, 60, 64, 67] },
  G: { sub: 31, rs: 43, pad: [55, 59, 62, 67] },
  E: { sub: 28, rs: 40, pad: [56, 59, 64, 68] },
  A: { sub: 33, rs: 45, pad: [57, 61, 64, 69, 71] },
};
const HARMONY = [
  [0, 4, "Am"],
  [4, 6, "Am"], [6, 8, "F"], [8, 10, "C"], [10, 12, "G"], [12, 14, "Am"], [14, 16, "F"], [16, 18, "C"], [18, 20, "G"],
  [20, 21, "F"], [21, 22, "E"],
  [22, 24, "Am"], [24, 26, "F"], [26, 28, "C"], [28, 30, "G"],
  [30, 31, "Am"], [31, 32, "F"], [32, 33, "C"], [33, 34, "E"],
  [34, 40, "A"],
];
const chordAt = (t) => CHORDS[HARMONY.find(([a, b]) => t >= a && t < b)?.[2] ?? "A"];

/** How open the filters are (0..1) through the piece: the "filter opening" of bars 7-8 and so on. */
function openness(t) {
  if (t < 4) return 0.1;
  if (t < 12) return 0.3;
  if (t < 16) return 0.3 + 0.45 * smoothstep((t - 12) / 4);
  if (t < 20) return 0.75;
  if (t < 22) return 0.5;
  if (t < 30) return 0.9;
  return 1;
}

/** The hook's words land here (s); the lock-on sound of the sight is at LOCK_ON. */
const HOOK_HITS = [0, 1, 2, 3];
const LOCK_ON = 3.5;
/** The break's card: the wheel starts to turn here (s). */
const WHEEL_TURN = 21.4;

/** The motif: A C E D in a 3+3+2 rhythm, a pentatonic hook that fits every chord. */
const MOTIF = { notes: [69, 72, 76, 74], steps: [0, 3, 6, 8], lens: [0.34, 0.34, 0.25, 0.62] };

// --- the stems and sends ---------------------------------------------------------------------------------------------------

const mk = () => ({ l: new Float32Array(N), r: new Float32Array(N) });
const STEM = { dr: mk(), ba: mk(), ha: mk(), le: mk(), fx: mk() };
const SEND = { hall: new Float32Array(N), plate: new Float32Array(N), big: new Float32Array(N), echo: new Float32Array(N) };
const DUCK = {};
/** Overall balance of each stem (every send follows it, so wet and dry keep their ratio). */
const STEMG = { dr: 1, ba: 0.68, ha: 1.6, le: 2.0, fx: 1 };
/** Level through the piece in dB: drop 1 a little under drop 2, the break dipping then building. */
function trimDb(t) {
  if (t < 4) return 0;
  if (t < 20) return -0.5;
  if (t < 22) return -4.5 + 4.0 * smoothstep((t - 20) / 2);
  if (t < 30) return 0;
  if (t < 34) return 0.6;
  return 0;
}
const TRIM = new Float32Array(N);
for (let i = 0; i < N; i++) TRIM[i] = db(trimDb(i / SR));

/**
 * Puts a sound (mono, or a [left, right] pair) into a stem at time t (s), with a level,
 * a pan (mono only), sends to the reverbs and the delay, and a sidechain class (see DUCK).
 */
function put(stem, t, x, o = {}) {
  const stereo = Array.isArray(x);
  const xl = stereo ? x[0] : x;
  const xr = stereo ? x[1] : x;
  const s0 = Math.round(t * SR);
  const g = (o.gain ?? 1) * STEMG[stem];
  const [pl, pr] = stereo ? [1, 1] : panGains(o.pan ?? 0);
  const duck = o.duck ? DUCK[o.duck] : null;
  const sends = [["hall", o.hall], ["plate", o.plate], ["big", o.big], ["echo", o.echo]].filter(([, v]) => v);
  const dl = STEM[stem].l;
  const dr = STEM[stem].r;
  for (let i = 0, j = s0; i < xl.length; i++, j++) {
    if (j < 0) continue;
    if (j >= N) break;
    const k = g * TRIM[j] * (duck ? duck[j] : 1);
    const a = xl[i] * k;
    const b = xr[i] * k;
    dl[j] += a * pl;
    dr[j] += b * pr;
    if (sends.length) {
      const m = (a * pl + b * pr) * 0.5;
      for (const [name, v] of sends) SEND[name][j] += m * v;
    }
  }
}

// --- the score: drums first, because the sidechain follows the kicks ------------------------------------------------------

const ev = { kick: [], snare: [], clap: [], hat: [], shaker: [], tom: [], crash: [], revCrash: [] };
const cues = { drops: [], impacts: [], risers: [], fills: [], crashes: [], sections: [], notes: [] };

const kickAt = (t, vel = 1) => ev.kick.push({ t, vel });
const snareAt = (t, vel = 1) => ev.snare.push({ t, vel });
const clapAt = (t, vel = 1) => ev.clap.push({ t, vel });
const hatAt = (t, vel, open = false) => ev.hat.push({ t, vel, open });
const tomAt = (t, f, vel = 1, decay = 0.2) => ev.tom.push({ t, f, vel, decay });

/** A bar of the main groove. `hv` scales the hats; `ghost` adds a kick; `shaker` adds 16th shakes. */
function grooveBar(b, { hv = 1, ghost = null, shaker = false, snareVel = 0.8, clapVel = 0.9, fill = null, rolling = false } = {}) {
  for (const s of [0, 4, 8, 12]) kickAt(step(b, s), s === 0 ? 1 : 0.92);
  if (ghost) for (const [s, v] of ghost) kickAt(step(b, s), v);
  // The backbeat: a clap on the snare. A fill may take the last one.
  clapAt(step(b, 4), clapVel);
  snareAt(step(b, 4), snareVel);
  if (fill !== "tom") {
    clapAt(step(b, 12), clapVel);
    snareAt(step(b, 12), snareVel);
  }
  for (let s = 0; s < 16; s++) {
    if (fill && s >= 13) continue; // the fill speaks here
    const t = step(b, s);
    if (s % 4 === 2) hatAt(t, 0.62 * hv, true);
    else hatAt(t, (s % 4 === 0 ? 0.5 : s % 4 === 1 ? 0.27 : 0.32) * hv, false);
    if (shaker && s % 2 === 1) ev.shaker.push({ t, vel: 0.5 });
  }
  if (fill === "snare16") {
    [[13, 0.5], [14, 0.66], [15, 0.95]].forEach(([s, v]) => snareAt(step(b, s), v));
    clapAt(step(b, 15), 0.7);
  } else if (fill === "tom") {
    [[12, 210, 0.8], [13, 175, 0.85], [14, 145, 0.95], [15, 115, 1.0]].forEach(([s, f, v]) => tomAt(step(b, s), f, v, 0.22));
    snareAt(step(b, 12), 0.6);
  } else if (fill === "roll") {
    [[13, 0.5], [14, 0.62], [14.5, 0.7], [15, 0.82], [15.5, 1.0]].forEach(([s, v]) => snareAt(step(b, s), v));
    [[14, 0.5], [15, 0.7], [15.5, 0.9]].forEach(([s, v]) => clapAt(step(b, s), v));
  }
}

/** Half-time: the backbeat once, on beat 3; the hats in eighths. */
function halfTimeBar(b) {
  for (const [s, v] of [[0, 1], [6, 0.6], [10, 0.85]]) kickAt(step(b, s), v);
  clapAt(step(b, 8), 1);
  snareAt(step(b, 8), 0.9);
  for (let s = 0; s < 16; s += 2) {
    if (s >= 14) continue;
    hatAt(step(b, s), s === 12 ? 0.55 : 0.4, false);
  }
  hatAt(step(b, 14), 0.5, true);
  // A flourish into the break.
  [[12, 0.4], [13, 0.5], [14, 0.6], [14.5, 0.68], [15, 0.78], [15.5, 0.95]].forEach(([s, v]) => snareAt(step(b, s), v));
}

// Drop 1: bars 3-9
grooveBar(3, { hv: 0.85 });
grooveBar(4, { hv: 0.85, fill: "snare16" });
grooveBar(5, { ghost: [[10, 0.55]] });
grooveBar(6, { fill: "tom" });
grooveBar(7, { ghost: [[10, 0.55]], shaker: true });
grooveBar(8, { fill: "roll", shaker: true });
grooveBar(9, { ghost: [[10, 0.55]], shaker: true });
halfTimeBar(10);
// Drop 2: bars 12-15
grooveBar(12, { hv: 1.1, ghost: [[10, 0.6]], shaker: true, snareVel: 0.95, clapVel: 1 });
grooveBar(13, { hv: 1.1, ghost: [[10, 0.6]], shaker: true, snareVel: 0.95, clapVel: 1, fill: "snare16" });
grooveBar(14, { hv: 1.15, ghost: [[10, 0.6], [14, 0.5]], shaker: true, snareVel: 1, clapVel: 1 });
grooveBar(15, { hv: 1.15, ghost: [[10, 0.6]], shaker: true, snareVel: 1, clapVel: 1, fill: "roll" });
// The climax: bars 16-17, and the snare roll over the last two beats
grooveBar(16, { hv: 1.2, ghost: [[6, 0.5], [10, 0.65], [14, 0.5]], shaker: true, snareVel: 1, clapVel: 1 });
{
  const b = 17;
  for (const s of [0, 4]) kickAt(step(b, s), s === 0 ? 1 : 0.92);
  kickAt(step(b, 6), 0.6);
  kickAt(step(b, 8), 0.95); // 33.0
  clapAt(step(b, 4), 1); snareAt(step(b, 4), 1);
  for (let s = 0; s < 8; s++) {
    const t = step(b, s);
    if (s % 4 === 2) hatAt(t, 0.7, true); else hatAt(t, s % 4 === 0 ? 0.55 : 0.3, false);
    if (s % 2 === 1) ev.shaker.push({ t, vel: 0.55 });
  }
  // the roll: eighths, sixteenths, thirty-seconds, rising
  [[33.0, 0.5], [33.25, 0.56], [33.5, 0.62], [33.625, 0.68], [33.75, 0.74], [33.8125, 0.8], [33.875, 0.88], [33.9375, 0.97]].forEach(([t, v]) => {
    snareAt(t, v);
    if (v > 0.7) clapAt(t, v * 0.8);
  });
}

// Accents: crashes on the downbeat after a fill, and the toms that mark the big bars.
const crashes = [[8, 0.7], [12, 0.7], [16, 0.9], [26, 0.9], [30, 1.0]];
for (const [t, v] of crashes) {
  ev.crash.push({ t, vel: v });
  cues.crashes.push(t);
}
// taiko hits under the bar lines of the second drop
const taikos = [[22, 1], [24, 0.8], [26, 0.9], [28, 0.8], [30, 1], [32, 1]];
for (const [t, v] of taikos) ev.tom.push({ t, f: 60, vel: v, decay: 0.42, taiko: true });

cues.fills.push(
  { start: 7.5, end: 8.0, kind: "snare16", hit: 8.0 },
  { start: 11.5, end: 12.0, kind: "toms", hit: 12.0 },
  { start: 15.5, end: 16.0, kind: "snare roll", hit: 16.0 },
  { start: 25.5, end: 26.0, kind: "snare16", hit: 26.0 },
  { start: 29.5, end: 30.0, kind: "snare roll", hit: 30.0 },
  { start: 33.0, end: 34.0, kind: "build: snare roll, eighths to 32nds", hit: 34.0 },
);

// --- sidechain curves from the kicks --------------------------------------------------------------------------------------------

function duckCurve(depth, release, extra = []) {
  const c = new Float32Array(N).fill(1);
  const R = secs(release);
  const A = secs(0.004);
  for (const { t, vel = 1 } of [...ev.kick, ...extra]) {
    const s0 = Math.round(t * SR);
    const d = depth * (0.55 + 0.45 * vel);
    for (let i = 0; i < R + A && s0 + i < N; i++) {
      let g;
      if (i < A) g = 1 - d * (i / A);
      else {
        const u = (i - A) / R;
        g = 1 - d * (1 - u) * (1 - u);
      }
      const j = s0 + i;
      if (g < c[j]) c[j] = g;
    }
  }
  return c;
}
// The big hits duck everything for a moment so they land.
const BIG_HITS = [{ t: 4, vel: 1 }, { t: 22, vel: 1 }, { t: 34, vel: 1 }];
DUCK.bass = duckCurve(0.93, 0.21, BIG_HITS);
DUCK.pad = duckCurve(0.62, 0.3, BIG_HITS);
DUCK.lead = duckCurve(0.2, 0.18, []);
DUCK.arp = duckCurve(0.35, 0.22, []);
DUCK.fx = duckCurve(0.3, 0.25, BIG_HITS);

// --- render the drums ----------------------------------------------------------------------------------------------------------------

const DRUM = {
  kick: I.kick({}),
  kickBig: I.kick({ f0: 200, f1: 46, tauA: 0.2, drive: 2.0, len: 0.6 }),
  snare: I.snare({}),
  clap: I.clap({}),
  hatC: [0, 1, 2].map((s) => I.hat({ seed: 4 + s })),
  hatO: [0, 1].map((s) => I.hat({ open: true, seed: 14 + s, len: 0.2 })),
  shaker: [0, 1, 2].map((s) => I.shaker({ seed: 5 + s })),
  crash: I.crash({}),
};

function renderDrums() {
  const rand = rng(99);
  for (const e of ev.kick) {
    const big = e.t === 4 || e.t === 22 || e.t === 34;
    const k = big ? DRUM.kickBig : DRUM.kick;
    put("dr", e.t, k, { gain: 0.42 * e.vel, plate: 0, hall: 0 });
  }
  for (const e of ev.snare) put("dr", e.t, DRUM.snare, { gain: 0.8 * e.vel, pan: 0, plate: 0.5, hall: 0.12 });
  for (const e of ev.clap) put("dr", e.t, DRUM.clap, { gain: 0.85 * e.vel, pan: 0, plate: 0.55, hall: 0.2 });
  for (const e of ev.hat) {
    const arr = e.open ? DRUM.hatO : DRUM.hatC;
    const pan = (rand() - 0.5) * 0.5;
    put("dr", e.t, arr[Math.floor(rand() * arr.length)], { gain: 1.0 * e.vel, pan, plate: e.open ? 0.15 : 0.04 });
  }
  for (const e of ev.shaker) put("dr", e.t, DRUM.shaker[Math.floor(rand() * 3)], { gain: 0.7 * e.vel, pan: (rand() - 0.5) * 0.8 });
  for (const e of ev.tom) {
    const x = e.taiko ? I.tom({ f: e.f, decay: e.decay, len: 1.6, drop: 1.8, skin: 0.35, vel: 1 }) : I.tom({ f: e.f, decay: e.decay, vel: 1 });
    put("dr", e.t, x, { gain: (e.taiko ? 0.55 : 0.45) * e.vel, pan: e.taiko ? 0 : clamp(((e.f - 160) / 100) * 0.5, -0.5, 0.5), plate: e.taiko ? 0.3 : 0.25, big: e.taiko ? 0.35 : 0.1 });
  }
  for (const e of ev.crash) put("fx", e.t, DRUM.crash, { gain: 0.5 * e.vel, big: 0.35, hall: 0.1 });
}

// --- bass ---------------------------------------------------------------------------------------------------------------------------------------

function renderBass() {
  // The sub: one sustained note per chord, ducked by the kick.
  for (const [a, b, name] of HARMONY) {
    if (a < 4 || a >= 34 || a === 18) continue;
    const c = CHORDS[name];
    if (a >= 20 && a < 22) {
      // the break: the sub alone, swelling
      const x = I.subNote({ f: mtof(c.sub), dur: b - a - 0.02, vel: 1, atk: 0.15, rel: 0.1 });
      put("ba", a, x, { gain: 0.13 + 0.07 * (a - 20) });
      continue;
    }
    const x = I.subNote({ f: mtof(c.sub), dur: b - a - 0.015, vel: 1 });
    put("ba", a, x, { gain: a >= 22 ? 0.34 : 0.3, duck: "bass" });
  }
  // The half-time bar: two long notes, the filter closing.
  {
    const c = CHORDS.G;
    put("ba", 18, I.subNote({ f: mtof(c.sub), dur: 1.97, vel: 1, atk: 0.01 }), { gain: 0.3, duck: "bass" });
    for (const [t, d] of [[18, 0.98], [19, 0.95]]) {
      const [l, r] = I.reese({ f: mtof(c.rs), dur: d, cut: [650, 240, 0.55], q: 1.2, openness: 0.2 });
      put("ba", t, [l, r], { gain: 0.3, duck: "bass" });
    }
  }
  const patA = [{ s: 2, l: 1.6 }, { s: 6, l: 1.6 }, { s: 10, l: 1.0 }, { s: 11, l: 0.9, o: 12 }, { s: 14, l: 1.6 }];
  const patB = [{ s: 0, l: 1.7, v: 0.7 }, { s: 2, l: 1.2 }, { s: 3, l: 0.9, o: 12 }, { s: 6, l: 1.5 }, { s: 8, l: 1.5, v: 0.85 }, { s: 10, l: 1.1 }, { s: 11, l: 0.9, o: 12 }, { s: 14, l: 1.4, o: 7 }];
  const patC = Array.from({ length: 16 }, (_, s) => ({ s, l: 0.85, o: [0, 0, 12, 0, 0, 12, 0, 0, 0, 0, 12, 0, 0, 12, 7, 12][s], v: s % 4 === 0 ? 0.75 : 1 }));
  const play = (b, pat, gain, cutBase) => {
    const t0 = bar(b);
    for (const p of pat) {
      const t = t0 + p.s * 0.125;
      const c = chordAt(t);
      const f = mtof(c.rs + (p.o ?? 0));
      const [l, r] = I.reese({ f, dur: p.l * 0.125, vel: p.v ?? 1, cut: [cutBase * 2.4, cutBase, 0.09], q: 1.25, openness: openness(t) * 0.55 });
      put("ba", t, [l, r], { gain, duck: "bass" });
    }
  };
  for (let b = 3; b <= 9; b++) play(b, patA, 0.3, 320);
  for (let b = 12; b <= 15; b++) play(b, patB, 0.36, 380);
  for (const b of [16, 17]) {
    // the last two beats of 17 thin out: a pedal on E
    if (b === 17) {
      const t0 = bar(b);
      for (const p of patC.filter((p) => p.s < 8)) {
        const t = t0 + p.s * 0.125;
        const [l, r] = I.reese({ f: mtof(chordAt(t).rs + (p.o ?? 0)), dur: p.l * 0.125, vel: p.v ?? 1, cut: [900, 420, 0.09], q: 1.25, openness: 0.55 });
        put("ba", t, [l, r], { gain: 0.38, duck: "bass" });
      }
      const [l, r] = I.reese({ f: mtof(40), dur: 0.98, cut: [700, 380, 0.4], q: 1.2, openness: 0.4 });
      put("ba", 33, [l, r], { gain: 0.38, duck: "bass" });
    } else play(b, patC, 0.38, 420);
  }
}

// --- harmony: the pad, the stabs, the arp -----------------------------------------------------------------------------------------

function renderHarmony() {
  // Pads: one supersaw chord per harmony segment of the two drops.
  for (const [a, b, name] of HARMONY) {
    const c = CHORDS[name];
    if (a < 4 || a >= 34) continue;
    const inBreak = a >= 20 && a < 22;
    const drop2 = a >= 22;
    if (inBreak) continue;
    const cut = (t) => 450 * Math.pow(14, openness(a + t));
    const notes = drop2 ? [...c.pad, c.pad[0] - 12] : c.pad;
    const [l, r] = I.supersaw({
      notes, dur: b - a - 0.03, vel: 1, spread: drop2 ? 28 : 17, voices: drop2 ? 7 : 5, width: drop2 ? 0.95 : 0.65, atk: 0.02, rel: 0.25, cut, q: 0.8, seed: Math.floor(a * 10), hpf: 150,
    });
    put("ha", a, [l, r], { gain: drop2 ? 0.62 : 0.46, duck: "pad", hall: 0.3, plate: 0.1 });
  }
  // Offbeat stabs in the second drop and the climax.
  const stab = (t, notes, vel) => {
    const [l, r] = I.supersaw({ notes, dur: 0.11, rel: 0.1, decay: 0.07, sustain: 0.1, spread: 20, voices: 5, width: 0.9, atk: 0.003, cut: (u) => 800 + 5200 * Math.exp(-u / 0.06) * (0.6 + 0.4 * openness(t)), q: 0.9, seed: Math.floor(t * 100) });
    put("ha", t, [l, r], { gain: 0.5 * vel, duck: "arp", hall: 0.25, echo: 0.28, plate: 0.1 });
  };
  for (let b = 12; b <= 17; b++) {
    for (const s of [2, 6, 10, 14]) {
      const t = step(b, s);
      if (t >= 33.0) continue;
      if (b === 13 && s === 14) continue;
      if (b === 15 && s === 14) continue; // under the fill
      const c = chordAt(t);
      stab(t, c.pad.map((n) => n + 12), s === 2 ? 0.8 : 0.9);
    }
  }
  // The arp: plucks on the sixteenths, bars 5-9 (lighter first), 14-15, and the climax.
  const seq = [0, 1, 2, 3, 2, 1, 0, 1, 2, 3, 2, 1, 2, 3, 3, 2];
  const arpBars = [[5, 0.55, 8], [6, 0.7, 0], [7, 0.9, 0], [8, 0.9, 0], [9, 1, 0], [14, 0.9, 0], [15, 0.9, 0], [16, 1, 0], [17, 1, 0]];
  for (const [b, v, from] of arpBars) {
    for (let s = from; s < 16; s++) {
      const t = step(b, s);
      if (t >= 33.0) continue;
      if ((b === 4 || b === 6 || b === 8 || b === 15) && s >= 13) continue;
      const c = chordAt(t);
      const n = c.pad[seq[s] % c.pad.length] + (b >= 14 ? 12 : 12);
      const [l, r] = I.pluck({ f: mtof(n), dur: 0.1, bright: 6200, floor: 1500, tauF: 0.05, tauA: 0.07, vel: 1, pan: s % 2 ? 0.4 : -0.4, detune: 0.003, pulse: 0.2, seed: s });
      put("ha", t, [l, r], { gain: (s % 4 === 0 ? 0.34 : 0.24) * v, duck: "arp", echo: 0.2, plate: 0.12, hall: 0.1 });
    }
  }
}

// --- the motif and the lead -------------------------------------------------------------------------------------------------------------

function motif(t0, { oct = 0, gain = 0.3, kind = "pluck", speed = 1, notes = MOTIF.notes, send = {} } = {}) {
  MOTIF.steps.forEach((s, k) => {
    const t = t0 + (s * 0.125) / speed;
    const f = mtof(notes[k] + oct * 12);
    const len = MOTIF.lens[k] / speed;
    if (kind === "pluck") {
      const [l, r] = I.pluck({ f, dur: len, bright: 6800, floor: 1100, tauF: 0.12, tauA: len / 2, vel: 1, pan: 0, seed: k + 5 });
      put("le", t, [l, r], { gain, duck: "lead", echo: 0.5, plate: 0.15, hall: 0.2, ...send });
    } else if (kind === "super") {
      const [l, r] = I.supersaw({ notes: [notes[k] + oct * 12], dur: len, rel: 0.16, decay: 0.3, sustain: 0.3, spread: 16, voices: 5, width: 0.7, atk: 0.004, cut: (u) => 1800 + 6000 * Math.exp(-u / 0.15), q: 0.8, seed: k + 50 });
      put("le", t, [l, r], { gain, duck: "lead", echo: 0.3, plate: 0.1, hall: 0.2, ...send });
    } else if (kind === "bell") {
      const [l, r] = I.bell({ f, dur: 2.4 / speed, tau: 0.9, bright: 1.2, vel: 1 });
      put("le", t, [l, r], { gain, hall: 0.55, big: 0.5, echo: 0.35, ...send });
    }
  });
}

function renderLead() {
  // Drop 1: the motif from bar 4. In bar 6 and 8 the last note lifts.
  for (const b of [4, 5, 6, 7, 8, 9]) motif(bar(b), { gain: 0.5 + 0.03 * (b - 4), kind: "pluck" });
  for (const b of [7, 8, 9]) motif(bar(b), { oct: 1, gain: 0.26, kind: "pluck" });
  // Half-time: the motif stretched over the bar.
  {
    const t0 = bar(10);
    [69, 72, 76, 74].forEach((n, k) => {
      const f = mtof(n);
      const [l, r] = I.pluck({ f, dur: k === 3 ? 0.85 : 0.45, bright: 6000, floor: 1000, tauF: 0.14, vel: 1, seed: k + 20 });
      put("le", t0 + k * 0.5, [l, r], { gain: 0.45, duck: "lead", echo: 0.5, plate: 0.2, hall: 0.3 });
    });
  }
  // The break: a bell, then the answer on the dominant (E, G#, B, A).
  motif(20, { gain: 0.18, kind: "bell", oct: 0 });
  motif(21, { gain: 0.16, kind: "bell", oct: 0, notes: [76, 80, 83, 81] });
  // Drop 2: a supersaw lead an octave under a high pluck.
  for (const b of [12, 13, 14, 15, 16, 17]) {
    if (b === 17) {
      motif(bar(b), { gain: 0.56, kind: "super", oct: 0, speed: 1 });
      motif(bar(b), { gain: 0.3, kind: "pluck", oct: 1 });
      continue;
    }
    motif(bar(b), { gain: b >= 16 ? 0.62 : 0.56, kind: "super", oct: 0 });
    motif(bar(b), { gain: b >= 16 ? 0.34 : 0.28, kind: "pluck", oct: 1 });
    if (b === 16) {
      // the climax answers itself in double time half way
      motif(step(b, 8), { gain: 0.36, kind: "pluck", oct: 1, speed: 2, notes: [72, 76, 79, 76] });
    }
  }
  // The end card: the motif once, lifted to A major, on a soft pluck.
  {
    const notes = [69, 73, 76, 81];
    notes.forEach((n, k) => {
      const t = 36 + k * 0.5;
      const [l, r] = I.pluck({ f: mtof(n), dur: k === 3 ? 1.2 : 0.4, bright: 4200, floor: 900, tauF: 0.2, tauA: k === 3 ? 0.9 : 0.25, vel: 1, seed: k + 90 });
      put("le", t, [l, r], { gain: 0.3, echo: 0.55, hall: 0.4, big: 0.5, plate: 0.12 });
    });
  }
}

// --- the intro, the break, the risers, the impacts -----------------------------------------------------------------------------------------------

function renderIntro() {
  // A low drone: sub A1, saws on A2 E3 A3, a low-pass that opens over 3.4 s, a crescendo.
  const dur = 3.5;
  const swell = (t, from, to, p = 1.5) => db(from + (to - from) * Math.pow(clamp(t / 3.4, 0, 1), p));
  const sub = I.subNote({ f: 55, dur: dur, atk: 0.5, vel: 1, drive: 1.4 });
  for (let i = 0; i < sub.length; i++) sub[i] *= swell(i / SR, -32, -8, 1.3);
  put("fx", 0, sub, { gain: 0.8, hall: 0.2 });
  const saw = I.supersaw({ notes: [45, 52, 57], dur, atk: 0.4, rel: 0.05, spread: 12, voices: 3, width: 0.7, cut: (t) => 150 * Math.pow(20, Math.pow(clamp(t / 3.4, 0, 1), 1.2)) * (1 + 0.06 * Math.sin(t * 2.5)), q: 1.5, seed: 3 });
  for (let i = 0; i < saw[0].length; i++) { const g = swell(i / SR, -28, -10, 1.4); saw[0][i] *= g; saw[1][i] *= g; }
  put("fx", 0, saw, { gain: 0.95, hall: 0.45, big: 0.15 });
  // A pad of Am coming in over the second bar.
  const pad = I.supersaw({ notes: [57, 60, 64, 69], dur: 2.3, atk: 1.4, rel: 0.05, spread: 15, voices: 5, width: 0.8, cut: (t) => 380 * Math.pow(9, clamp(t / 2.3, 0, 1)), q: 0.9, seed: 4 });
  put("fx", 1.15, pad, { gain: 0.42, hall: 0.5 });
  // The rising tone: A3 up three octaves to A6.
  const tone = I.toneRiser({ dur: 3.3, f0: 220, f1: 1760, curve: 1.7, ease: 1.1, trackLp: 3.5, vel: 1 });
  put("fx", 0.15, tone, { gain: 0.46, hall: 0.6, echo: 0.2 });
  // The hook's words land on 0, 1, 2 and 3 s: a pitched thump on the motif's notes (A C E, then A an octave up),
  // each a little louder than the last, with a tick and a puff of noise on top and a short sub under it.
  HOOK_HITS.forEach((t, k) => {
    const midi = [45, 48, 52, 57][k];
    const v = [0.62, 0.74, 0.87, 1.0][k];
    put("dr", t, I.tom({ f: mtof(midi), decay: 0.3, len: 1.0, drop: 2.2, skin: 0.12, vel: 1 }), { gain: 0.62 * v, plate: 0.25, hall: 0.35, big: 0.15 });
    put("fx", t, I.boom({ dur: 0.9, f0: 100, f1: 50, tauP: 0.05, tauA: 0.22, vel: 1, layer: 0.2, layerHz: 55 }), { gain: 0.3 * v, hall: 0.1 });
    put("dr", t, I.tick({ pitch: 1500, vel: 1, seed: 300 + k }), { gain: 0.5 * v, plate: 0.2 });
    put("fx", t, I.noiseBurst({ dur: 0.25, tau: 0.05, f0: 12000, f1: 2500, tauF: 0.05, vel: 1, seed: 340 + k, crack: 0.5 }), { gain: 0.14 * v, hall: 0.15 });
  });
  // Ticks: quarters in bar 1, eighths in the first half of bar 2, sixteenths in the second half, none in the last beat.
  const clockTimes = [0.5, 1.0, 1.5, 2.0, 2.25, 2.5, 2.75, 3.0, 3.125, 3.25, 3.375];
  clockTimes.forEach((t, i) => {
    const vel = 0.35 + 0.65 * (i / (clockTimes.length - 1));
    const x = I.tick({ pitch: i % 2 ? 1900 : 2500, vel, seed: 100 + i });
    put("dr", t, x, { gain: 0.8, pan: i % 2 ? 0.35 : -0.35, plate: 0.3, hall: 0.1 });
    if (t >= 2.0) put("dr", t, I.hat({ vel: 1, seed: 40 + i }), { gain: 0.2 * (0.4 + 0.6 * (t - 2) / 1.4), pan: i % 2 ? -0.3 : 0.3 });
  });
}

/** A reverse swell: a burst through a long reverb, reversed so that it peaks (and ends) exactly at `peak`. */
const IR_SWELL = () => makeIR({ t60: 3.0, preDelay: 0.005, seed: 21, bright: 12000, dark: 2500 });
function reverseSwell(peak, len, { gain = 0.5, tone = null } = {}) {
  const n = secs(len);
  const src = new Float32Array(n);
  const rand = rng(peak * 7);
  const burst = secs(0.5);
  const nz = filter(whiteNoise(burst, rand), "hp", 1800, 0.7);
  for (let i = 0; i < burst; i++) src[i] = nz[i] * Math.exp(-i / SR / 0.12) * 0.7;
  if (tone) {
    const [pl] = I.supersaw({ notes: tone, dur: 0.4, atk: 0.004, rel: 0.2, spread: 20, voices: 5, cut: 5000, seed: 5 });
    for (let i = 0; i < Math.min(pl.length, n); i++) src[i] += pl[i] * 0.45;
  }
  const ir = IR_SWELL();
  const [l, r] = convolveStereo(src, ir[0], ir[1]);
  const rl = reversed(l);
  const rr = reversed(r);
  // Normalise, shape the rise, and fade the last few ms so it does not click.
  let p = 0;
  for (let i = 0; i < n; i++) p = Math.max(p, Math.abs(rl[i]), Math.abs(rr[i]));
  for (let i = 0; i < n; i++) {
    const u = i / n;
    const g = (gain / p) * Math.pow(u, 1.1);
    rl[i] *= g;
    rr[i] *= g;
  }
  fadeOut(rl, secs(0.004));
  fadeOut(rr, secs(0.004));
  put("fx", peak - len, [rl, rr], { gain: 1, hall: 0.0, big: 0.12 });
}

function renderBreakAndRisers() {
  // Bar 10: a riser into 20.0.
  {
    const n = I.noiseRiser({ dur: 2.0, f0: 250, f1: 9500, q: 1.5, curve: 2.0, vel: 1, seed: 61 });
    fadeOut(n[0], secs(0.004)); fadeOut(n[1], secs(0.004));
    put("fx", 18, n, { gain: 0.26, hall: 0.15 });
    const tn = I.toneRiser({ dur: 2.0, f0: 98, f1: 880, curve: 2.2, ease: 1.2, vel: 1 });
    fadeOut(tn[0], secs(0.004)); fadeOut(tn[1], secs(0.004));
    put("fx", 18, tn, { gain: 0.14, hall: 0.2 });
    cues.risers.push({ start: 18, peak: 20.0, name: "bar 10 riser" });
  }
  // A reverse crash into each fill's target.
  for (const t of [8, 12, 16, 26, 30]) {
    const c = reversed(I.crash({ len: 1.4, tau: 0.5, vel: 1, seed: 70 + t }));
    put("fx", t - 1.4, c, { gain: t === 16 || t === 30 ? 0.3 : 0.2, big: 0.1 });
  }
  // The break (20-22): a soft thump on the cut, the pad, the riser, the swell.
  {
    const x = I.boom({ dur: 1.8, f0: 100, f1: 44, tauP: 0.1, tauA: 0.45, vel: 1, layer: 0.3 });
    put("fx", 20, x, { gain: 0.36, big: 0.2 });
    cues.impacts.push({ t: 20.0, size: "small", name: "cut into the break" });
    const pad1 = I.supersaw({ notes: [53, 57, 60, 64, 69], dur: 1.0, atk: 0.3, rel: 0.4, spread: 18, voices: 7, width: 0.9, cut: (t) => 500 * Math.pow(9, clamp(t / 1.0, 0, 1)), q: 0.9, seed: 71 });
    put("ha", 20, pad1, { gain: 0.2, hall: 0.4, big: 0.4 });
    const pad2 = I.supersaw({ notes: [52, 56, 59, 64, 68, 71], dur: 1.0, atk: 0.1, rel: 0.05, spread: 22, voices: 7, width: 0.95, cut: (t) => 1500 * Math.pow(7, clamp(t / 1.0, 0, 1)), q: 0.9, seed: 72 });
    for (let i = 0; i < pad2[0].length; i++) { const g = 0.45 + 0.55 * smoothstep(i / SR / 1.0); pad2[0][i] *= g; pad2[1][i] *= g; }
    fadeOut(pad2[0], secs(0.01)); fadeOut(pad2[1], secs(0.01));
    put("ha", 21, pad2, { gain: 0.26, hall: 0.3, big: 0.3 });
    const nz = I.noiseRiser({ dur: 2.0, f0: 400, f1: 13000, q: 1.2, curve: 2.4, vel: 1, seed: 81, flutter: 0.0 });
    fadeOut(nz[0], secs(0.004)); fadeOut(nz[1], secs(0.004));
    put("fx", 20, nz, { gain: 0.2, hall: 0.1 });
    const tn = I.toneRiser({ dur: 2.0, f0: 330, f1: 3520, curve: 2.4, ease: 1.1, vel: 1, vibrato: 0.004 });
    fadeOut(tn[0], secs(0.004)); fadeOut(tn[1], secs(0.004));
    put("fx", 20, tn, { gain: 0.12, hall: 0.25, echo: 0.2 });
    // 16th clock ticks come back in the last beat, answering the intro.
    for (let k = 0; k < 8; k++) {
      const t = 21.0 + k * 0.125;
      put("dr", t, I.tick({ pitch: k % 2 ? 1900 : 2500, vel: 0.4 + 0.6 * (k / 7), seed: 200 + k }), { gain: 0.4, pan: k % 2 ? 0.3 : -0.3, plate: 0.3 });
    }
    reverseSwell(22, 1.6, { gain: 0.34, tone: [57, 64, 69, 72] });
    // The wheel turns at 21.4: a soft sweep under it.
    put("fx", WHEEL_TURN - 0.25, I.whoosh({ dur: 0.7, f0: 500, f1: 5200, peak: 0.45, vel: 1, seed: 612 }), { gain: 0.16, hall: 0.2 });
    cues.risers.push({ start: 20, peak: 22.0, name: "break riser" }, { start: 20.4, peak: 22.0, name: "reverse swell" });
  }
  // The climax riser and the build: 30 to 34.
  {
    const n = I.noiseRiser({ dur: 4.0, f0: 500, f1: 14000, q: 1.2, curve: 2.6, vel: 1, seed: 91, ease: 1.6 });
    fadeOut(n[0], secs(0.004)); fadeOut(n[1], secs(0.004));
    put("fx", 30, n, { gain: 0.26, hall: 0.1 });
    const tn = I.toneRiser({ dur: 4.0, f0: 220, f1: 3520, curve: 2.2, ease: 1.3, vel: 1, vibrato: 0.004 });
    fadeOut(tn[0], secs(0.004)); fadeOut(tn[1], secs(0.004));
    put("fx", 30, tn, { gain: 0.14, hall: 0.2 });
    reverseSwell(34, 1.9, { gain: 0.45, tone: [57, 61, 64, 69] });
    cues.risers.push({ start: 30, peak: 34.0, name: "climax riser" }, { start: 32.1, peak: 34.0, name: "reverse swell" });
  }
  // Small whooshes before the second drop's phrase turns.
  for (const t of [26, 30]) {
    const w = I.whoosh({ dur: 0.9, f0: 500, f1: 8000, peak: 0.9, vel: 1, seed: 500 + t });
    put("fx", t - 0.9, w, { gain: 0.18, hall: 0.1 });
  }
}

/** The big hits. size: 1 = drop 1, 1.5 = drop 2, 2.2 = the final. */
function impact(t, size, name, { chord = null } = {}) {
  const long = size > 2 ? 6.2 : size > 1.2 ? 4.2 : 3.2;
  put("fx", t, I.boom({ dur: long, f0: 140, f1: 37, tauP: 0.17, tauA: 0.7 + 0.45 * size, vel: 1, layer: 0.55 }), { gain: 0.38 + 0.04 * size, big: 0.1 });
  const nb = I.noiseBurst({ dur: long * 0.55, tau: 0.35 + 0.3 * size, vel: 1, f0: 16000, f1: 500, tauF: 0.28 + 0.1 * size, seed: 31 + Math.floor(t) });
  put("fx", t, nb, { gain: 0.3 + 0.06 * size, big: 0.45, hall: 0.1 });
  put("fx", t, I.crash({ len: long * 0.8, tau: 0.8 + 0.4 * size, seed: 8 + Math.floor(t) }), { gain: 0.4 + 0.06 * size, big: 0.4 });
  if (size > 1.2 && chord) {
    const [l, r] = I.supersaw({
      notes: chord, dur: size > 2 ? 3.6 : 1.5, rel: size > 2 ? 2.0 : 0.9, atk: 0.003, decay: size > 2 ? 2.4 : 0.9, sustain: size > 2 ? 0.4 : 0.25,
      spread: size > 2 ? 34 : 30, voices: 7, width: 1, cut: (u) => 1800 + 9000 * Math.exp(-u / 0.8), q: 0.8, seed: 77 + Math.floor(t),
    });
    put("ha", t, [l, r], { gain: size > 2 ? 0.56 : 0.5, big: 0.4, hall: 0.2 });
  }
  cues.impacts.push({ t, size: size > 2 ? "huge" : size > 1.2 ? "large" : "medium", name });
}

function renderImpacts() {
  impact(4, 1, "drop 1");
  impact(22, 1.5, "drop 2", { chord: [33, 45, 52, 57, 60, 64, 69, 72] });
  impact(34, 2.2, "final hit", { chord: [33, 45, 52, 57, 61, 64, 69, 73, 76] });
  // The final chord rings: A major added 9th, a bright lift; bells and a shimmer above it.
  {
    const [l, r] = I.supersaw({ notes: [45, 52, 57, 61, 64, 69, 71], dur: 4.7, atk: 0.04, rel: 0.6, spread: 20, voices: 7, width: 0.9, decay: 1.7, sustain: 0.2, cut: (u) => 3200 * Math.pow(0.5, u / 4), q: 0.7, seed: 301 });
    put("ha", 34, [l, r], { gain: 0.17, big: 0.6, hall: 0.2 });
    put("ba", 34, I.subNote({ f: 55, dur: 3.0, atk: 0.01, rel: 1.4, drive: 1.5 }), { gain: 0.28 });
    [[81, 0, 0.7], [85, 0.06, 0.55], [88, 0.12, 0.5], [93, 0.2, 0.3]].forEach(([n, dt, v]) => {
      const [bl, br] = I.bell({ f: mtof(n), dur: 4.5, tau: 2.4, bright: 0.8, vel: 1, pan: (n % 7) / 7 - 0.5 });
      put("le", 34 + dt, [bl, br], { gain: 0.16 * v, big: 0.7, hall: 0.2 });
    });
  }
}

// --- the master -------------------------------------------------------------------------------------------------------------------------------------------

function reverbs() {
  const out = {};
  const run = (name, send, irOpts) => {
    const ir = makeIR(irOpts);
    const [l, r] = convolveStereo(send, ir[0], ir[1]);
    out[name] = [l, r];
    log(`reverb ${name}: ${(ir[0].length / SR).toFixed(1)} s tail`);
  };
  run("plate", SEND.plate, { t60: 1.1, preDelay: 0.004, bright: 15000, dark: 4500, early: false, seed: 5, lowCut: 220, lenSec: 1.3 });
  run("hall", SEND.hall, { t60: 2.6, preDelay: 0.018, bright: 13000, dark: 2200, seed: 9, lenSec: 3.0 });
  run("big", SEND.big, { t60: 5.2, preDelay: 0.028, bright: 12000, dark: 1600, seed: 13, lenSec: 5.6, lowCut: 160 });
  const echo = pingPong(SEND.echo, { time: 0.375, feedback: 0.4, tone: 3800 });
  out.echo = echo;
  return out;
}

function breathMask(t) {
  if (t < 3.44) return 1;
  if (t < 3.5) return 0.002 + 0.998 * (0.5 + 0.5 * Math.cos((Math.PI * (t - 3.44)) / 0.06));
  if (t < 3.985) return 0.002;
  if (t < 4.0) return 0.002 + 0.998 * (0.5 - 0.5 * Math.cos((Math.PI * (t - 3.985)) / 0.015));
  return 1;
}

function stemTable(ret) {
  const rms = (l, r, a, b) => {
    let e = 0;
    for (let i = a; i < b; i++) e += l[i] * l[i] + r[i] * r[i];
    return toDb(Math.sqrt(e / (2 * (b - a))));
  };
  console.log("bar    dr     ba     ha     le     fx   | plate  hall   big   echo  (pre-master RMS dBFS)");
  for (let b = 1; b <= 20; b++) {
    const a = secs((b - 1) * 2), z = secs(b * 2);
    const row = Object.keys(STEM).map((k) => rms(STEM[k].l, STEM[k].r, a, z).toFixed(0).padStart(5));
    const rr = ["plate", "hall", "big", "echo"].map((k) => rms(ret[k][0], ret[k][1], a, z).toFixed(0).padStart(5));
    console.log(`${String(b).padStart(2)}  ${row.join("  ")}  | ${rr.join("  ")}`);
  }
}

/** Mid/side width over time for the harmony and the lead: a little wider in drop 1, much wider in drop 2. */
function widthAt(t) {
  if (t < 4) return 1;
  if (t < 20) return 1.2;
  if (t < 22) return 1.1;
  if (t < 34) return 2.0;
  return 1.4;
}
function widen(stem) {
  for (let i = 0; i < N; i++) {
    const w = widthAt(i / SR);
    const m = 0.5 * (stem.l[i] + stem.r[i]);
    const sd = 0.5 * (stem.l[i] - stem.r[i]) * w;
    stem.l[i] = m + sd;
    stem.r[i] = m - sd;
  }
}

function sumAndMaster() {
  const ret = reverbs();
  if (argv.includes("--stems")) stemTable(ret);
  widen(STEM.ha);
  widen(STEM.le);
  const gain = { dr: 1, ba: 1, ha: 1, le: 1, fx: 1 };
  const RET = { plate: 0.5, hall: 0.55, big: 0.6, echo: 0.5 };
  const L = new Float32Array(N);
  const R = new Float32Array(N);
  for (const k of Object.keys(STEM)) {
    const s = STEM[k];
    for (let i = 0; i < N; i++) { L[i] += s.l[i] * gain[k]; R[i] += s.r[i] * gain[k]; }
  }
  for (const k of Object.keys(ret)) {
    for (let i = 0; i < N; i++) { L[i] += ret[k][0][i] * RET[k]; R[i] += ret[k][1][i] * RET[k]; }
  }
  // The breath before the drop: everything from 3.44 to 4.0 is muted, then a breath of noise is laid in.
  for (let i = 0; i < secs(4.0); i++) {
    const m = breathMask(i / SR);
    L[i] *= m;
    R[i] *= m;
  }
  // The sight locks on at 3.5: two small bright blips and a low knock, laid in after the mask (it is the only thing in the last beat but the breath).
  {
    const n = secs(0.6);
    const l = new Float32Array(n), r = new Float32Array(n);
    const blip = (t0, f, len, v) => {
      const a = secs(t0);
      for (let i = 0; i < secs(len * 2.2); i++) {
        const t = i / SR;
        const e = (1 - Math.exp(-t / 0.0007)) * Math.exp(-t / (len / 2.5));
        const x = (Math.sin(2 * Math.PI * f * t) + 0.22 * Math.sin(4 * Math.PI * f * t)) * e * v;
        l[a + i] += x * 0.9;
        r[a + i] += x * 1.1;
      }
    };
    blip(0, 1760, 0.1, 1.0);
    blip(0.07, 2637, 0.14, 0.75);
    const knock = I.tom({ f: 150, decay: 0.07, len: 0.3, drop: 2.0, skin: 0.1, vel: 1 });
    for (let i = 0; i < knock.length; i++) { l[i] += knock[i] * 0.55; r[i] += knock[i] * 0.55; }
    const click = I.tick({ pitch: 3200, vel: 1, seed: 77 });
    for (let i = 0; i < click.length; i++) { l[i] += click[i] * 0.4; r[i] += click[i] * 0.4; }
    const mono = new Float32Array(n);
    for (let i = 0; i < n; i++) mono[i] = 0.5 * (l[i] + r[i]);
    const ir = makeIR({ t60: 0.9, preDelay: 0.004, seed: 41, bright: 12000, dark: 3500, early: false, lenSec: 1.0 });
    const [wl, wr] = convolveStereo(mono, ir[0], ir[1]);
    const a = secs(LOCK_ON);
    for (let i = 0; i < n; i++) {
      L[a + i] += (l[i] + wl[i] * 0.3) * 0.2;
      R[a + i] += (r[i] + wr[i] * 0.3) * 0.2;
    }
  }
  {
    const rand = rng(1234);
    const len = secs(0.38);
    const nz = filter(whiteNoise(len, rand), "lp", 3800, 0.7);
    const nz2 = filter(whiteNoise(len, rand), "lp", 3800, 0.7);
    for (let i = 0; i < len; i++) {
      const u = i / len;
      const e = Math.sin(Math.PI * Math.pow(u, 1.6)) ;
      const j = secs(3.6) + i;
      L[j] += nz[i] * e * 0.012;
      R[j] += nz2[i] * e * 0.012;
    }
  }
  // Just before the final hit, a hair of silence so it lands.
  {
    const a = secs(33.955), b = secs(34.0);
    for (let i = a; i < b; i++) {
      const u = (i - a) / (b - a);
      const m = u < 0.25 ? 1 - 0.97 * smoothstep(u / 0.25) : 0.03;
      L[i] *= m; R[i] *= m;
    }
  }
  // Remove sub-sonic rubbish, then a little presence and air.
  const out = [L, R].map((X) => {
    const f = new Svf();
    f.set(24, 0.7);
    for (let i = 0; i < N; i++) { f.tick(X[i]); X[i] = f.hp; }
    let y = biquad(X, "peak", 3200, 0.8, 1.6);
    y = biquad(y, "highshelf", 6000, 0.7, 2.4);
    return y;
  });
  return out;
}

function finish(L0, R0) {
  // Gain search for the target loudness with the master chain in the loop.
  let pre = 1.0;
  let ceiling = -1.9;
  let best = null;
  for (let round = 0; round < 14; round++) {
    const L = Float32Array.from(L0, (v) => v * pre);
    const R = Float32Array.from(R0, (v) => v * pre);
    const gr = compress(L, R, { threshold: -7, ratio: 1.6, attack: 0.02, release: 0.15, knee: 8, makeup: 0 });
    softClip(L, 0.78);
    softClip(R, 0.78);
    const lim = limit(L, R, { ceiling: db(ceiling), lookahead: 0.003, release: 0.09 });
    // the tail: fade out from 38.5 to 40.0 (cosine), first and last samples exactly zero
    const f0 = secs(38.5);
    for (let i = f0; i < N; i++) {
      const g = 0.5 + 0.5 * Math.cos((Math.PI * (i - f0)) / (N - f0));
      L[i] *= g; R[i] *= g;
    }
    for (let i = 0; i < secs(0.001); i++) { const g = i / secs(0.001); L[i] *= g; R[i] *= g; }
    L[N - 1] = R[N - 1] = 0;
    writeWav(`${OUT}/music.wav`, L, R);
    const m = measure(`${OUT}/music.wav`);
    log(`round ${round}: pre ${toDb(pre).toFixed(2)} dB, ceiling ${ceiling.toFixed(2)} dBFS, comp ${gr.toFixed(1)} dB, limiter ${lim.toFixed(1)} dB -> ${m.lufs} LUFS, LRA ${m.lra}, true peak ${m.tp} dBTP`);
    best = { L, R, m };
    const err = TARGET_LUFS - m.lufs;
    const over = m.tp + 1.15;
    if (Math.abs(err) < 0.15 && over <= 0 && m.tp > -1.8) break;
    if (over > 0) ceiling -= over;
    else if (m.tp < -1.8) ceiling += (-1.3 - m.tp) * 0.8;
    pre *= db(err * 0.95);
  }
  return best;
}

// --- go ----------------------------------------------------------------------------------------------------------------------------------------------

mkdirSync(OUT, { recursive: true });
log("rendering drums");
renderDrums();
renderIntro();
log("bass");
renderBass();
log("harmony");
renderHarmony();
log("lead");
renderLead();
log("risers, break, swells");
renderBreakAndRisers();
renderImpacts();
log("reverbs and master");
const [L0, R0] = sumAndMaster();
const { m } = finish(L0, R0);

// --- cues.json ----------------------------------------------------------------------------------------------------------------------------------------

cues.drops.push({ t: 4.0, name: "drop 1" }, { t: 22.0, name: "drop 2" });
cues.sections.push(
  { from: 0, to: 3.5, name: "hook: thumps on 0/1/2/3, drone, clock, rising tone" },
  { from: 3.5, to: 4.0, name: "lock-on blip at 3.5, then a breath (near silence)" },
  { from: 4, to: 18, name: "groove A" },
  { from: 18, to: 20, name: "half-time + riser" },
  { from: 20, to: 22, name: "break (pad, motif, riser, reverse swell)" },
  { from: 22, to: 30, name: "drop 2 driving" },
  { from: 30, to: 34, name: "climax" },
  { from: 34, to: 40, name: "resolution, sparse end card, tail" },
);
cues.notes.push("motif: A C E D (3+3+2) from bar 4, in A major lift at 36.0 on the end card", "everything is on the 0.125 s grid; a 'flash' list of the strongest accents is in `flashes`");
const flashes = [
  { t: 0.0, strength: 1, what: "hook word 1: No controller." },
  { t: 1.0, strength: 1, what: "hook word 2: No keyboard." },
  { t: 2.0, strength: 2, what: "hook word 3: No mouse." },
  { t: 3.0, strength: 2, what: "hook word 4: Just your hands." },
  { t: 3.5, strength: 1, what: "lock-on blip" },
  { t: 4.0, strength: 3, what: "drop 1" },
  { t: 8.0, strength: 1, what: "crash after fill" },
  { t: 12.0, strength: 1, what: "crash after fill" },
  { t: 16.0, strength: 2, what: "crash after fill" },
  { t: 20.0, strength: 1, what: "cut into the break (riser peak)" },
  { t: 21.4, strength: 1, what: "the wheel starts to turn" },
  { t: 22.0, strength: 4, what: "drop 2" },
  { t: 26.0, strength: 2, what: "crash after fill" },
  { t: 30.0, strength: 2, what: "climax begins" },
  { t: 34.0, strength: 5, what: "final hit" },
];
const out = {
  bpm: 120,
  beat: 0.5,
  bar: 2,
  duration: TOTAL,
  sampleRate: SR,
  key: "A minor, ending in A major",
  loudness: { lufs: m.lufs, truePeak: m.tp, lra: m.lra },
  hook: { hits: HOOK_HITS, lockOn: LOCK_ON, note: "a pitched thump on each of 0/1/2/3 s (A C E A, rising in level), a lock-on blip at 3.5, then the breath" },
  turn: { wheelTurn: WHEEL_TURN, go: 22.0, note: "ticks in sixteenths from 21.0, a soft sweep at 21.4, the swell peaks at 22.0" },
  breath: { from: 3.5, to: 4.0 },
  drops: cues.drops,
  impacts: cues.impacts.sort((a, b) => a.t - b.t),
  risers: cues.risers.sort((a, b) => a.peak - b.peak),
  fills: cues.fills,
  crashes: cues.crashes,
  halfTime: { from: 18, to: 20 },
  break: { from: 20, to: 22 },
  climax: { from: 30, to: 34 },
  tail: { from: 34, fadeFrom: 38.5, silentAt: 40 },
  flashes,
  grid: {
    kicks: ev.kick.map((e) => +e.t.toFixed(4)).sort((a, b) => a - b),
    claps: ev.clap.map((e) => +e.t.toFixed(4)).sort((a, b) => a - b),
  },
  sections: cues.sections,
  notes: cues.notes,
};
writeFileSync(`${OUT}/cues.json`, JSON.stringify(out, null, 2));
log(`done: ${OUT}/music.wav, ${OUT}/cues.json`);
