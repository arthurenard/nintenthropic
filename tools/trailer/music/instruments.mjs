/**
 * The trailer's instruments and effects, each a function that returns the
 * samples of one note or hit (mono Float32Array, or a [left, right] pair for
 * the wide ones). All of it is synthesised: oscillators, noise, envelopes and
 * filters. Shared by the music (compose.mjs) and the mixer's extra effects.
 */
import { SR, TAU, Svf, clamp, db, fadeIn, fadeOut, filter, mtof, pulseAt, reversed, rng, sawAt, secs, whiteNoise } from "./dsp.mjs";

const norm = (x, peak = 1) => {
  let p = 0;
  for (let i = 0; i < x.length; i++) p = Math.max(p, Math.abs(x[i]));
  if (p > 0) for (let i = 0; i < x.length; i++) x[i] *= peak / p;
  return x;
};

// --- drums --------------------------------------------------------------------------------------------------------

/** A tight electronic kick: a sine that falls from 185 Hz to 48 Hz in a few ms, a click, a touch of drive. */
export function kick({ vel = 1, f0 = 185, f1 = 48, tauP = 0.03, tauA = 0.17, len = 0.5, click = 0.3, drive = 1.7, seed = 1 } = {}) {
  const n = secs(len);
  const out = new Float32Array(n);
  const rand = rng(seed);
  const hp = new Svf();
  hp.set(2800, 0.7);
  let ph = 0.25;
  const norm0 = Math.tanh(drive);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    ph += (f1 + (f0 - f1) * Math.exp(-t / tauP)) / SR;
    const a = (1 - Math.exp(-t / 0.0005)) * Math.exp(-t / tauA);
    hp.tick(rand() * 2 - 1);
    const s = Math.tanh(drive * Math.sin(TAU * ph) * a) / norm0 + hp.hp * Math.exp(-t / 0.0022) * click;
    out[i] = s * vel;
  }
  return fadeOut(out, secs(0.05));
}

/** A snare: a falling tone, band-passed noise for the wires and a bright snap. */
export function snare({ vel = 1, tone = 185, len = 0.42, seed = 2, snap = 0.5, wires = 0.9 } = {}) {
  const n = secs(len);
  const out = new Float32Array(n);
  const rand = rng(seed);
  const bp = new Svf();
  bp.set(3600, 0.6);
  const hp = new Svf();
  hp.set(6500, 0.7);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    ph += (tone * (1 + 0.55 * Math.exp(-t / 0.012))) / SR;
    const body = Math.sin(TAU * ph) * Math.exp(-t / 0.055) * 0.6;
    const z = rand() * 2 - 1;
    bp.tick(z);
    hp.tick(z);
    const w = bp.bp * bp.k * Math.exp(-t / 0.105) * wires;
    const s = hp.hp * Math.exp(-t / 0.032) * snap;
    out[i] = Math.tanh(1.5 * (body + w + s)) * 0.8 * vel * (1 - Math.exp(-t / 0.0004));
  }
  return fadeOut(out, secs(0.06));
}

/** A clap: four close noise bursts and a short tail, through a band around 1.3 kHz. */
export function clap({ vel = 1, len = 0.34, seed = 3 } = {}) {
  const n = secs(len);
  const out = new Float32Array(n);
  const rand = rng(seed);
  const bp = new Svf();
  bp.set(1350, 0.9);
  const hp = new Svf();
  hp.set(520, 0.7);
  const bursts = [0, 0.0105, 0.0215, 0.034];
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let e = 0;
    for (let k = 0; k < 3; k++) if (t >= bursts[k]) e = Math.max(e, Math.exp(-(t - bursts[k]) / 0.0055));
    if (t >= bursts[3]) e = Math.max(e, Math.exp(-(t - bursts[3]) / 0.07) * 0.9);
    hp.tick(rand() * 2 - 1);
    bp.tick(hp.hp);
    out[i] = (bp.bp * bp.k * 1.2 + bp.lo * 0.1) * e * vel;
  }
  return fadeOut(out, secs(0.05));
}

const METAL = [205.3, 304.4, 369.6, 522.7, 540, 800];

/** A hat: six detuned squares and noise through a high-pass. `open` rings, otherwise a tick. */
export function hat({ vel = 1, open = false, len = null, seed = 4 } = {}) {
  const dur = len ?? (open ? 0.22 : 0.06);
  const n = secs(dur);
  const out = new Float32Array(n);
  const rand = rng(seed);
  const hp = new Svf();
  hp.set(7600, 0.8);
  const hp2 = new Svf();
  hp2.set(9000, 0.6);
  const ph = METAL.map((_, k) => (k * 0.37) % 1);
  const tau = open ? 0.075 : 0.014;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let m = 0;
    for (let k = 0; k < 6; k++) {
      ph[k] = (ph[k] + (METAL[k] * 2.7) / SR) % 1;
      m += ph[k] < 0.5 ? 1 : -1;
    }
    hp.tick(m / 6);
    hp2.tick(rand() * 2 - 1);
    out[i] = (hp.hp * 0.55 + hp2.hp * 0.55) * Math.exp(-t / tau) * vel * (1 - Math.exp(-t / 0.0003));
  }
  return fadeOut(out, secs(open ? 0.05 : 0.01));
}

/** A shaker: a short burst of band-limited noise. */
export function shaker({ vel = 1, seed = 5 } = {}) {
  const n = secs(0.07);
  const rand = rng(seed);
  const x = whiteNoise(n, rand);
  const y = filter(x, "bp", 9500, 0.9);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    y[i] *= Math.min(1, t / 0.012) * Math.exp(-t / 0.018) * vel * 1.4;
  }
  return fadeOut(y, secs(0.01));
}

/** A tom / taiko: a sine falling to `f`, a skin of noise, as long as `decay` says. */
export function tom({ f = 110, vel = 1, decay = 0.2, len = null, seed = 6, drop = 1.7, skin = 0.25 } = {}) {
  const n = secs(len ?? decay * 4);
  const out = new Float32Array(n);
  const rand = rng(seed);
  const bp = new Svf();
  bp.set(f * 3.2, 1.2);
  let ph = 0.25;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    ph += (f * (1 + (drop - 1) * Math.exp(-t / 0.03))) / SR;
    bp.tick(rand() * 2 - 1);
    const body = Math.sin(TAU * ph) * Math.exp(-t / decay);
    const s = bp.bp * bp.k * Math.exp(-t / 0.05) * skin;
    out[i] = Math.tanh(1.4 * (body + s)) * 0.85 * vel * (1 - Math.exp(-t / 0.0006));
  }
  return fadeOut(out, secs(0.06));
}

/** A crash: noise and metal above 3 kHz, a long shimmering decay. */
export function crash({ vel = 1, len = 2.6, tau = 0.7, seed = 8, bright = 14000 } = {}) {
  const n = secs(len);
  const out = new Float32Array(n);
  const rand = rng(seed);
  const hp = new Svf();
  hp.set(3200, 0.7);
  const lp = new Svf();
  const ph = METAL.map((_, k) => (k * 0.21) % 1);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    if ((i & 31) === 0) lp.set(bright * Math.pow(0.4, Math.min(1, t / 1.5)), 0.6);
    let m = 0;
    for (let k = 0; k < 6; k++) {
      ph[k] = (ph[k] + (METAL[k] * 3.3) / SR) % 1;
      m += ph[k] < 0.5 ? 1 : -1;
    }
    hp.tick(rand() * 2 - 1 + m * 0.12);
    lp.tick(hp.hp);
    const env = (1 - Math.exp(-t / 0.0015)) * (0.35 * Math.exp(-t / 0.06) + 0.65 * Math.exp(-t / tau));
    out[i] = lp.lo * env * vel * 0.8;
  }
  return fadeOut(out, secs(0.25));
}

/** A clock's tick: a short wooden knock and a click. */
export function tick({ vel = 1, pitch = 2300, seed = 9 } = {}) {
  const n = secs(0.07);
  const out = new Float32Array(n);
  const rand = rng(seed);
  const bp = new Svf();
  bp.set(pitch * 1.4, 2.5);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    bp.tick(rand() * 2 - 1);
    const wood = Math.sin(TAU * pitch * t) * Math.exp(-t / 0.0065) * 0.8;
    out[i] = (wood + bp.bp * bp.k * Math.exp(-t / 0.004) * 0.9) * vel * (1 - Math.exp(-t / 0.0003));
  }
  return fadeOut(out, secs(0.015));
}

// --- bass ----------------------------------------------------------------------------------------------------------

/** A sub bass note: a sine with a touch of saturation (which gives small speakers a third harmonic to play). */
export function subNote({ f, dur, vel = 1, drive = 1.6, atk = 0.006, rel = 0.05, second = 0.25 }) {
  const n = secs(dur + rel);
  const out = new Float32Array(n);
  const k = Math.tanh(drive);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const ph = TAU * f * t;
    const s = Math.sin(ph) + second * Math.sin(2 * ph + 0.4);
    const env = Math.min(1, t / atk) * (t < dur ? 1 : Math.max(0, 1 - (t - dur) / rel));
    out[i] = (Math.tanh(drive * s * 0.8) / k) * env * vel;
  }
  return out;
}

/**
 * A reese bass note: detuned saws (two per ear plus one an octave down) through
 * a resonant low-pass that closes after the attack, then a bit of drive.
 * `cut` is [start Hz, floor Hz, tau s].
 */
export function reese({ f, dur, vel = 1, detune = 0.011, cut = [900, 260, 0.12], q = 1.3, drive = 2.0, rel = 0.03, atk = 0.004, openness = 0 }) {
  const n = secs(dur + rel);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  const voices = [
    { m: 1 - detune, pan: 0 }, { m: 1 + detune * 0.8, pan: 0 }, { m: 0.5, pan: 2 },
    { m: 1 + detune, pan: 1 }, { m: 1 - detune * 0.7, pan: 1 },
  ];
  const ph = voices.map((_, i) => (i * 0.313) % 1);
  const fl = new Svf();
  const fr = new Svf();
  const dk = Math.tanh(drive);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    if ((i & 7) === 0) {
      const fc = (cut[1] + (cut[0] - cut[1]) * Math.exp(-t / cut[2])) * (1 + 3.2 * openness);
      fl.set(fc, q);
      fr.set(fc, q);
    }
    let l = 0, r = 0;
    for (let v = 0; v < voices.length; v++) {
      const vd = voices[v];
      const dt = (f * vd.m) / SR;
      ph[v] += dt;
      if (ph[v] >= 1) ph[v] -= 1;
      const s = sawAt(ph[v], dt) * (vd.m === 0.5 ? 0.9 : 0.55);
      if (vd.pan === 0) l += s;
      else if (vd.pan === 1) r += s;
      else { l += s * 0.7; r += s * 0.7; }
    }
    fl.tick(l);
    fr.tick(r);
    const env = Math.min(1, t / atk) * (t < dur ? 1 : Math.max(0, 1 - (t - dur) / rel));
    L[i] = (Math.tanh(drive * fl.lo * 0.7) / dk) * env * vel;
    R[i] = (Math.tanh(drive * fr.lo * 0.7) / dk) * env * vel;
  }
  return [L, R];
}

// --- chords, plucks, leads -----------------------------------------------------------------------------------------------

/**
 * A supersaw: seven band-limited saws per note, spread in pitch and across the
 * stereo field, through a low-pass that may move (cut(t) in Hz) and an
 * amplitude envelope (attack, release; `decay` > 0 makes it a stab).
 */
export function supersaw({ notes, dur, vel = 1, spread = 22, atk = 0.01, rel = 0.1, cut = 4000, q = 0.8, width = 0.85, voices = 7, decay = 0, sustain = 0, seed = 11, hpf = 0 }) {
  const n = secs(dur + rel);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  const rand = rng(seed);
  const vs = [];
  for (const note of notes) {
    const f = mtof(note);
    for (let v = 0; v < voices; v++) {
      const u = voices === 1 ? 0 : (v / (voices - 1)) * 2 - 1;
      const cents = u * spread * (0.8 + 0.2 * rand());
      const pan = clamp(u * width, -1, 1);
      const a = (pan + 1) * 0.25 * Math.PI;
      vs.push({ f: f * Math.pow(2, cents / 1200), ph: rand(), gl: Math.cos(a), gr: Math.sin(a), g: 1 - 0.45 * Math.abs(u) });
    }
  }
  const norm0 = 1 / Math.sqrt(vs.length) / 1.35;
  const fl = new Svf();
  const fr = new Svf();
  const hl = hpf ? new Svf() : null;
  const hr = hpf ? new Svf() : null;
  if (hl) { hl.set(hpf, 0.7); hr.set(hpf, 0.7); }
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let l = 0, r = 0;
    for (let v = 0; v < vs.length; v++) {
      const o = vs[v];
      const dt = o.f / SR;
      o.ph += dt;
      if (o.ph >= 1) o.ph -= 1;
      const s = sawAt(o.ph, dt) * o.g;
      l += s * o.gl;
      r += s * o.gr;
    }
    if ((i & 15) === 0) {
      const fc = typeof cut === "function" ? cut(t) : cut;
      fl.set(fc, q);
      fr.set(fc, q);
    }
    fl.tick(l);
    fr.tick(r);
    let yl = fl.lo, yr = fr.lo;
    if (hl) { hl.tick(yl); hr.tick(yr); yl = hl.hp; yr = hr.hp; }
    let env = Math.min(1, t / atk);
    if (decay > 0) env *= sustain + (1 - sustain) * Math.exp(-t / decay);
    if (t > dur) env *= Math.max(0, 1 - (t - dur) / rel);
    L[i] = yl * env * vel * norm0;
    R[i] = yr * env * vel * norm0;
  }
  return [L, R];
}

/** A pluck: two detuned saws and a pulse through a low-pass whose cutoff snaps shut, for the motif and the arps. */
export function pluck({ f, dur, vel = 1, bright = 5200, floor = 900, tauF = 0.09, tauA = null, atk = 0.002, rel = 0.06, detune = 0.004, pulse = 0.35, pan = 0, seed = 13 }) {
  const n = secs(dur + rel);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  const ta = tauA ?? dur / 2.2;
  const rand = rng(seed);
  const p1 = rand(), p2 = rand(), p3 = rand();
  let a = p1, b = p2, c = p3;
  const fl = new Svf();
  const fr = new Svf();
  const pl = Math.cos((clamp(pan, -1, 1) + 1) * 0.25 * Math.PI);
  const pr = Math.sin((clamp(pan, -1, 1) + 1) * 0.25 * Math.PI);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const d1 = (f * (1 - detune)) / SR, d2 = (f * (1 + detune)) / SR, d3 = f / SR;
    a = (a + d1) % 1; b = (b + d2) % 1; c = (c + d3) % 1;
    const sa = sawAt(a, d1), sb = sawAt(b, d2), sc = pulseAt(c, d3, 0.5) * pulse;
    if ((i & 15) === 0) {
      const fc = floor + (bright - floor) * Math.exp(-t / tauF);
      fl.set(fc, 0.9);
      fr.set(fc, 0.9);
    }
    fl.tick(sa * 0.55 + sc * 0.5);
    fr.tick(sb * 0.55 + sc * 0.5);
    let env = Math.min(1, t / atk) * Math.exp(-t / ta);
    if (t > dur) env *= Math.max(0, 1 - (t - dur) / rel);
    L[i] = fl.lo * env * vel * pl * 1.2;
    R[i] = fr.lo * env * vel * pr * 1.2;
  }
  return [L, R];
}

/** A bell / glass pluck: sine partials with a slow decay and a bright first moment. */
export function bell({ f, dur = 1.6, vel = 1, tau = 0.7, bright = 1, pan = 0 }) {
  const n = secs(dur);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  const parts = [[1, 1, 1], [2.0, 0.42, 0.55], [3.01, 0.22, 0.35], [4.2, 0.12 * bright, 0.2], [5.43, 0.07 * bright, 0.12]];
  const pl = Math.cos((clamp(pan, -1, 1) + 1) * 0.25 * Math.PI);
  const pr = Math.sin((clamp(pan, -1, 1) + 1) * 0.25 * Math.PI);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let s = 0;
    for (const [m, g, d] of parts) s += Math.sin(TAU * f * m * t + 0.3 * m) * g * Math.exp(-t / (tau * d + 0.02));
    s *= (1 - Math.exp(-t / 0.002));
    L[i] = s * vel * pl * 0.5;
    R[i] = s * vel * pr * 0.5;
  }
  fadeOut(L, secs(0.05));
  fadeOut(R, secs(0.05));
  return [L, R];
}

// --- risers and swells --------------------------------------------------------------------------------------------------------

/**
 * A rising noise sweep: a band-pass whose centre climbs exponentially from f0 to f1 while the
 * level builds as u^curve; ends at full level on its last sample (cut it there).
 */
export function noiseRiser({ dur, f0 = 300, f1 = 9000, q = 1.4, curve = 2.2, vel = 1, seed = 21, ease = 1.4, flutter = 0 }) {
  const n = secs(dur);
  const out = [new Float32Array(n), new Float32Array(n)];
  for (let ch = 0; ch < 2; ch++) {
    const rand = rng(seed + ch * 101);
    const f = new Svf();
    const hp = new Svf();
    for (let i = 0; i < n; i++) {
      const u = i / n;
      if ((i & 15) === 0) {
        const fc = f0 * Math.pow(f1 / f0, Math.pow(u, ease));
        f.set(fc, q);
        hp.set(fc * 0.25, 0.7);
      }
      hp.tick(rand() * 2 - 1);
      f.tick(hp.hp);
      let g = Math.pow(u, curve);
      if (flutter) g *= 1 - flutter * (0.5 - 0.5 * Math.cos(TAU * (6 + 18 * u) * u * dur * 0.5));
      out[ch][i] = f.bp * f.k * g * vel;
    }
    fadeIn(out[ch], secs(0.02));
  }
  return out;
}

/** A rising tone (two detuned saws and a sine) gliding from f0 to f1 and growing. */
export function toneRiser({ dur, f0 = 220, f1 = 1760, vel = 1, curve = 2, ease = 1, trackLp = 3, vibrato = 0.003, saw = 0.5 }) {
  const n = secs(dur);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  let p1 = 0, p2 = 0.3, p3 = 0.6;
  const fl = new Svf();
  const fr = new Svf();
  for (let i = 0; i < n; i++) {
    const u = i / n;
    const t = i / SR;
    const f = f0 * Math.pow(f1 / f0, Math.pow(u, ease)) * (1 + vibrato * Math.sin(TAU * 5.2 * t) * u);
    const d = f / SR;
    p1 = (p1 + d * 0.996) % 1; p2 = (p2 + d * 1.004) % 1; p3 = (p3 + d) % 1;
    if ((i & 15) === 0) { fl.set(f * trackLp, 0.9); fr.set(f * trackLp, 0.9); }
    fl.tick(sawAt(p1, d) * saw);
    fr.tick(sawAt(p2, d) * saw);
    const sine = Math.sin(TAU * p3);
    const g = Math.pow(u, curve);
    L[i] = (fl.lo + sine * 0.6) * g * vel * 0.5;
    R[i] = (fr.lo + sine * 0.6) * g * vel * 0.5;
  }
  fadeIn(L, secs(0.02));
  fadeIn(R, secs(0.02));
  return [L, R];
}

/** The low boom of an impact: a sine that falls from `f0` to `f1`, saturated for harmonics, and a second layer on A. */
export function boom({ dur = 3, f0 = 130, f1 = 38, tauP = 0.17, tauA = 0.9, vel = 1, drive = 1.9, layer = 0.5, layerHz = 55 }) {
  const n = secs(dur);
  const out = new Float32Array(n);
  let ph = 0.25;
  let ph2 = 0.25;
  const k = Math.tanh(drive);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    ph += (f1 + (f0 - f1) * Math.exp(-t / tauP)) / SR;
    ph2 += (layerHz * (1 + 0.5 * Math.exp(-t / 0.2))) / SR;
    const s = Math.sin(TAU * ph) * Math.exp(-t / tauA) + layer * Math.sin(TAU * ph2) * Math.exp(-t / (tauA * 1.3));
    out[i] = (Math.tanh(drive * s) / k) * (1 - Math.exp(-t / 0.0007)) * vel;
  }
  return fadeOut(out, secs(Math.min(0.5, dur * 0.2)));
}

/** The noise burst of an impact: white noise whose low-pass falls fast, plus a bright crack. Stereo. */
export function noiseBurst({ dur = 1.6, tau = 0.45, vel = 1, f0 = 16000, f1 = 450, tauF = 0.3, seed = 31, crack = 0.6 }) {
  const n = secs(dur);
  const out = [new Float32Array(n), new Float32Array(n)];
  for (let ch = 0; ch < 2; ch++) {
    const rand = rng(seed + ch * 53);
    const lp = new Svf();
    const hp = new Svf();
    hp.set(180, 0.7);
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      if ((i & 15) === 0) lp.set(f1 + (f0 - f1) * Math.exp(-t / tauF), 0.8);
      const z = rand() * 2 - 1;
      lp.tick(z);
      hp.tick(lp.lo);
      const env = (1 - Math.exp(-t / 0.0008)) * Math.exp(-t / tau);
      out[ch][i] = hp.hp * env * vel + z * crack * Math.exp(-t / 0.006) * vel * 0.5;
    }
    fadeOut(out[ch], secs(Math.min(0.4, dur * 0.25)));
  }
  return out;
}

/** A whoosh: band-passed noise that sweeps (up or down) with a bell-shaped level. Stereo. */
export function whoosh({ dur = 0.6, f0 = 400, f1 = 7000, q = 1.1, vel = 1, peak = 0.55, seed = 41, pan = 0 }) {
  const n = secs(dur);
  const out = [new Float32Array(n), new Float32Array(n)];
  const pg = [Math.cos((clamp(pan, -1, 1) + 1) * 0.25 * Math.PI) * Math.SQRT2, Math.sin((clamp(pan, -1, 1) + 1) * 0.25 * Math.PI) * Math.SQRT2];
  for (let ch = 0; ch < 2; ch++) {
    const rand = rng(seed + ch * 17);
    const f = new Svf();
    for (let i = 0; i < n; i++) {
      const u = i / n;
      if ((i & 15) === 0) f.set(f0 * Math.pow(f1 / f0, u), q);
      f.tick(rand() * 2 - 1);
      // Rises to `peak` of the length, then falls.
      const g = u < peak ? Math.pow(u / peak, 1.8) : Math.pow(1 - (u - peak) / (1 - peak), 1.4);
      out[ch][i] = f.bp * f.k * g * vel * pg[ch] * 0.8;
    }
    fadeIn(out[ch], secs(0.01));
    fadeOut(out[ch], secs(0.02));
  }
  return out;
}

export { norm, reversed };
