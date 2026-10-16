/**
 * The trailer's own one-shot effects, synthesised in Node with the music's
 * instruments (../music/instruments.mjs): whooshes, impacts, risers and so on,
 * for the editor to lay on cuts. Every effect is peak-normalised to -6 dBFS
 * and then moved by its `gain` (dB), so a gain means the same thing for all.
 *
 * The time `t` of an effect is its sync point:
 *   whoosh      the peak of the sweep (default 55 % through it)
 *   riser       the END: it builds up to t and is cut there
 *   swell       the END: a reversed reverb swell that peaks at t
 *   downlifter  the START: a falling sweep that begins at t
 *   everything else (impact, hit, boom, tick, snap, sparkle, zap) its first sample
 *
 * { t, sfx: "whoosh" | "impact" | "hit" | "boom" | "riser" | "downlifter" | "swell" | "tick" | "snap" | "sparkle" | "zap",
 *   dur?, gain? (dB), pan? (-1..1), size?: "small" | "medium" | "large", dir?: "up" | "down" (whoosh) }
 */
import * as I from "../music/instruments.mjs";
import { SR, clamp, convolveStereo, fadeOut, filter, makeIR, mtof, panGains, reversed, rng, secs, whiteNoise } from "../music/dsp.mjs";

export const SFX_NAMES = ["whoosh", "impact", "hit", "boom", "riser", "downlifter", "swell", "tick", "snap", "sparkle", "zap"];

const peakOf2 = (l, r) => {
  let p = 0;
  for (let i = 0; i < l.length; i++) p = Math.max(p, Math.abs(l[i]), Math.abs(r[i]));
  return p;
};

function normalize(l, r, peak = 0.5) {
  const p = peakOf2(l, r);
  if (p > 0) {
    const g = peak / p;
    for (let i = 0; i < l.length; i++) { l[i] *= g; r[i] *= g; }
  }
  return [l, r];
}

function mixInto(dst, src, offset = 0, gain = 1) {
  for (let i = 0; i < src[0].length; i++) {
    const j = i + offset;
    if (j < 0 || j >= dst[0].length) continue;
    dst[0][j] += src[0][i] * gain;
    dst[1][j] += src[1][i] * gain;
  }
}

function mono2(x, pan = 0) {
  const [gl, gr] = panGains(pan);
  const k = Math.SQRT2;
  return [Float32Array.from(x, (v) => v * gl * k), Float32Array.from(x, (v) => v * gr * k)];
}

function withReverb(stereo, { t60 = 1.6, wet = 0.4, tail = 1.8, seed = 3 } = {}) {
  const n = stereo[0].length + secs(tail);
  const mono = new Float32Array(n);
  for (let i = 0; i < stereo[0].length; i++) mono[i] = 0.5 * (stereo[0][i] + stereo[1][i]);
  const ir = makeIR({ t60, preDelay: 0.012, bright: 12000, dark: 2400, seed, lenSec: Math.min(t60 * 1.1, 3) });
  const [rl, rr] = convolveStereo(mono, ir[0], ir[1]);
  const l = new Float32Array(n);
  const r = new Float32Array(n);
  for (let i = 0; i < stereo[0].length; i++) { l[i] = stereo[0][i]; r[i] = stereo[1][i]; }
  for (let i = 0; i < n; i++) { l[i] += rl[i] * wet; r[i] += rr[i] * wet; }
  return [l, r];
}

/** Renders one effect: { t0, l, r } with t0 the time of its first sample (may be before the sync point). */
export function renderSfx(e) {
  const kind = e.sfx;
  const pan = e.pan ?? 0;
  const t = e.t;
  const seed = Math.round(t * 1000) + 7;
  switch (kind) {
    case "whoosh": {
      const dur = e.dur ?? 0.6;
      const down = e.dir === "down";
      const peak = e.peak ?? (down ? 0.4 : 0.55);
      const [l, r] = I.whoosh({ dur, f0: down ? 7500 : 350, f1: down ? 300 : 7500, q: 1.1, peak, seed, pan });
      return { t0: t - dur * peak, ...asLR(normalize(l, r)) };
    }
    case "riser": {
      const dur = e.dur ?? 2.0;
      const n = I.noiseRiser({ dur, f0: 300, f1: 11000, q: 1.3, curve: 2.2, seed });
      const tn = I.toneRiser({ dur, f0: 220, f1: 1760, curve: 2.2, ease: 1.1, vibrato: 0.003 });
      const mix = [new Float32Array(n[0].length), new Float32Array(n[1].length)];
      mixInto(mix, n, 0, 1);
      mixInto(mix, tn, 0, 0.55);
      fadeOut(mix[0], secs(0.006)); fadeOut(mix[1], secs(0.006));
      return { t0: t - dur, ...asLR(normalize(mix[0], mix[1])) };
    }
    case "downlifter": {
      const dur = e.dur ?? 1.2;
      const n = I.noiseRiser({ dur, f0: 250, f1: 9000, q: 1.2, curve: 1.6, seed });
      const l = reversed(n[0]);
      const r = reversed(n[1]);
      const tn = I.toneRiser({ dur, f0: 110, f1: 1100, curve: 1.8, ease: 1.1, vibrato: 0.003 });
      const mix = [l, r];
      mixInto(mix, [reversed(tn[0]), reversed(tn[1])], 0, 0.4);
      for (const c of mix) for (let i = 0; i < Math.min(secs(0.004), c.length); i++) c[i] *= i / secs(0.004);
      return { t0: t, ...asLR(normalize(mix[0], mix[1])) };
    }
    case "swell": {
      const dur = e.dur ?? 1.6;
      const n = secs(dur);
      const src = new Float32Array(n);
      const rand = rng(seed);
      const burst = secs(0.45);
      const nz = filter(whiteNoise(burst, rand), "hp", 1800, 0.7);
      for (let i = 0; i < burst; i++) src[i] = nz[i] * Math.exp(-i / SR / 0.12);
      const ir = makeIR({ t60: 3.0, preDelay: 0.005, seed: 21, bright: 12000, dark: 2500 });
      const [l, r] = convolveStereo(src, ir[0], ir[1]);
      const rl = reversed(l);
      const rr = reversed(r);
      for (let i = 0; i < n; i++) { const g = Math.pow(i / n, 1.1); rl[i] *= g; rr[i] *= g; }
      fadeOut(rl, secs(0.004)); fadeOut(rr, secs(0.004));
      return { t0: t - dur, ...asLR(normalize(rl, rr)) };
    }
    case "impact": {
      const size = e.size ?? "medium";
      const k = size === "small" ? 0.6 : size === "large" ? 1.5 : 1;
      const dur = 2.4 * k + 0.4;
      const out = [new Float32Array(secs(dur)), new Float32Array(secs(dur))];
      const boom = I.boom({ dur, f0: 130, f1: 38, tauP: 0.16, tauA: 0.55 + 0.4 * k, layer: 0.5 });
      mixInto(out, mono2(boom, 0), 0, 0.7);
      mixInto(out, I.noiseBurst({ dur: 1.3 * k + 0.3, tau: 0.25 + 0.25 * k, f0: 15000, f1: 500, tauF: 0.2 + 0.1 * k, seed }), 0, 0.28);
      mixInto(out, mono2(I.crash({ len: 1.8 * k + 0.4, tau: 0.5 + 0.35 * k, seed }), 0), 0, 0.2);
      const wet = withReverb(out, { t60: 1.4 + 0.8 * k, wet: 0.35, tail: 1.2 + k, seed });
      return { t0: t, ...asLR(normalize(wet[0], wet[1])) };
    }
    case "hit": {
      const out = [new Float32Array(secs(0.7)), new Float32Array(secs(0.7))];
      mixInto(out, mono2(I.boom({ dur: 0.7, f0: 120, f1: 48, tauP: 0.06, tauA: 0.16, layer: 0.25, drive: 2.2 }), 0), 0, 0.8);
      mixInto(out, mono2(I.kick({ vel: 1, len: 0.3 }), 0), 0, 0.35);
      mixInto(out, I.noiseBurst({ dur: 0.35, tau: 0.07, f0: 14000, f1: 1500, tauF: 0.08, seed, crack: 0.9 }), 0, 0.3);
      return { t0: t, ...asLR(normalize(out[0], out[1])) };
    }
    case "boom": {
      const dur = e.dur ?? 3;
      const b = I.boom({ dur, f0: 125, f1: 36, tauP: 0.17, tauA: dur * 0.3, layer: 0.5 });
      const wet = withReverb(mono2(b, pan), { t60: 2.2, wet: 0.2, tail: 1 });
      return { t0: t, ...asLR(normalize(wet[0], wet[1])) };
    }
    case "tick": {
      const x = I.tick({ pitch: e.pitch ?? 2300, seed });
      const [l, r] = mono2(x, pan);
      return { t0: t, ...asLR(normalize(l, r)) };
    }
    case "snap": {
      // A thumb-snap: a short bright knock and a low click.
      const n = secs(0.18);
      const rand = rng(seed);
      const nz = filter(whiteNoise(n, rand), "bp", 2100, 1.6);
      const x = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const tt = i / SR;
        x[i] = nz[i] * Math.exp(-tt / 0.014) * 1.2 + Math.sin(2 * Math.PI * 190 * tt) * Math.exp(-tt / 0.02) * 0.5;
      }
      fadeOut(x, secs(0.03));
      const wet = withReverb(mono2(x, pan), { t60: 0.8, wet: 0.25, tail: 0.5 });
      return { t0: t, ...asLR(normalize(wet[0], wet[1])) };
    }
    case "sparkle": {
      const dur = e.dur ?? 0.9;
      const out = [new Float32Array(secs(dur + 1.6)), new Float32Array(secs(dur + 1.6))];
      const scale = [69, 72, 74, 76, 79, 81, 84, 86, 88, 91];
      const count = 9;
      for (let k = 0; k < count; k++) {
        const u = k / (count - 1);
        const note = scale[Math.min(scale.length - 1, Math.floor(u * (scale.length - 1) + 0.0))];
        const [bl, br] = I.bell({ f: mtof(note + 12), dur: 1.4, tau: 0.45, bright: 1.2, pan: ((k * 37) % 11) / 11 * 1.6 - 0.8 });
        mixInto(out, [bl, br], secs(u * dur), 0.5 + 0.5 * u);
      }
      const wet = withReverb(out, { t60: 1.6, wet: 0.3, tail: 0.5 });
      return { t0: t, ...asLR(normalize(wet[0], wet[1])) };
    }
    case "zap": {
      const dur = e.dur ?? 0.28;
      const n = secs(dur);
      const x = new Float32Array(n);
      let ph = 0;
      for (let i = 0; i < n; i++) {
        const u = i / n;
        ph += (3400 * Math.pow(160 / 3400, Math.pow(u, 0.7))) / SR;
        x[i] = (Math.sin(2 * Math.PI * ph) + 0.3 * Math.sin(4 * Math.PI * ph)) * Math.exp(-u * 3.2);
      }
      fadeOut(x, secs(0.02));
      const [l, r] = mono2(x, pan);
      return { t0: t, ...asLR(normalize(l, r)) };
    }
    default:
      throw new Error(`unknown sfx "${kind}" (known: ${SFX_NAMES.join(", ")})`);
  }
}

const asLR = ([l, r]) => ({ l, r });
void clamp;
