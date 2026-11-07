/**
 * The drum kits: each core drum is built in layers with a real transient (a
 * beater's tick over a pitched body over a sub, a snare's crack over its wires
 * and its shell, a hat from six detuned metal squares) instead of one decaying
 * sine. A piece picks a *kit style*; drums the style does not remake (congas,
 * shakers, cowbells...) come from the shared kit in src/audio/dsp/voices.ts.
 */
import { biquad } from "../../../audio/dsp/filters";
import type { Rng } from "../../../audio/dsp/rng";
import { type Mono, samples } from "../../../audio/dsp/signal";
import { type DrumKind, drumHit, softClip } from "../../../audio/dsp/voices";

export type KitStyle = "pop" | "rock" | "brush" | "electro" | "latin" | "march";

const TAU = 2 * Math.PI;

/** A sine with a falling pitch and a falling level. */
function body(sr: number, n: number, f0: number, f1: number, pitchTau: number, ampTau: number, level = 1): Mono {
  const out = new Float32Array(n);
  const pk = Math.exp(-1 / Math.max(1, pitchTau * sr));
  const ak = Math.exp(-1 / Math.max(1, ampTau * sr));
  let f = f0 - f1;
  let a = level;
  let ph = 0;
  for (let i = 0; i < n; i++) {
    out[i] = a * Math.sin(ph);
    ph += (TAU * (f1 + f)) / sr;
    f *= pk;
    a *= ak;
  }
  return out;
}

/** A burst of noise, band-passed and decaying. */
function burst(sr: number, n: number, rng: Rng, kind: "bandpass" | "highpass" | "lowpass", freq: number, q: number, tau: number, attack = 0.0004): Mono {
  const out = rng.fill(new Float32Array(n));
  biquad(out, sr, kind, freq, q);
  const k = Math.exp(-1 / Math.max(1, tau * sr));
  const an = Math.max(1, attack * sr);
  let e = 1;
  for (let i = 0; i < n; i++) {
    out[i]! *= e * (i < an ? i / an : 1);
    e *= k;
  }
  return out;
}

function add(dst: Mono, src: Mono, gain: number, at = 0): void {
  const end = Math.min(dst.length, src.length + at);
  for (let i = Math.max(0, at); i < end; i++) dst[i]! += gain * src[i - at]!;
}

/** Six detuned metal squares: the cymbals' and hats' inharmonic shimmer. */
function metal(sr: number, n: number, base: number, tau: number, rng: Rng): Mono {
  const out = new Float32Array(n);
  for (const r of [2, 3, 4.16, 5.43, 6.79, 8.21]) {
    const f = base * r * rng.range(0.985, 1.015);
    if (f > sr * 0.4) continue;
    const w = (TAU * f) / sr;
    let ph = rng.next() * TAU;
    const k = Math.exp(-1 / (tau * sr));
    let a = 1;
    for (let i = 0; i < n; i++) {
      out[i]! += (Math.sin(ph) > 0 ? 1 : -1) * a;
      ph += w;
      a *= k;
    }
  }
  return out;
}

function finish(out: Mono, vel: number): Mono {
  const g = 0.35 + 0.65 * vel;
  let peak = 0;
  for (let i = 0; i < out.length; i++) peak = Math.max(peak, Math.abs(out[i]!));
  const norm = peak > 0 ? g / peak : 0;
  for (let i = 0; i < out.length; i++) out[i]! *= norm;
  const fade = Math.min(out.length >> 1, 48);
  for (let i = 0; i < fade; i++) out[out.length - 1 - i]! *= i / fade;
  return out;
}

/** Rebuilt kicks, snares, hats and toms for a style; everything else falls through to the shared kit. */
export function kitHit(style: KitStyle, kind: DrumKind, sr: number, rng: Rng, vel: number): Mono {
  const L = (s: number): number => samples(sr, s);
  const hard = 0.6 + 0.8 * vel;
  switch (kind) {
    case "kick":
    case "kick-soft": {
      const soft = kind === "kick-soft" || style === "brush";
      const big = style === "rock";
      const out = new Float32Array(L(big ? 0.5 : 0.36));
      add(out, body(sr, out.length, soft ? 100 : big ? 125 : 165, soft ? 52 : 46, soft ? 0.03 : 0.018, big ? 0.2 : soft ? 0.13 : 0.15), 1);
      add(out, body(sr, out.length, 50, 44, 0.05, big ? 0.3 : 0.2), 0.55, L(0.002));
      if (!soft) {
        add(out, burst(sr, L(0.012), rng, "bandpass", big ? 2600 : 3800, 1, 0.0018), 0.55 * hard);
        add(out, body(sr, L(0.01), 1400, 900, 0.002, 0.002), 0.35 * hard);
      } else {
        add(out, burst(sr, L(0.02), rng, "lowpass", 900, 0.7, 0.004), 0.3);
      }
      return finish(out, vel);
    }
    case "kick-808": {
      const out = body(sr, L(0.7), 130, 42, 0.06, 0.34, 1);
      for (let i = 0; i < out.length; i++) out[i] = softClip(1.8 * out[i]!) / softClip(1.8);
      add(out, burst(sr, L(0.01), rng, "bandpass", 3000, 1, 0.0015), 0.25);
      return finish(out, vel);
    }
    case "snare": {
      const big = style === "rock";
      const out = new Float32Array(L(big ? 0.4 : 0.3));
      add(out, body(sr, out.length, big ? 205 : 235, big ? 160 : 175, 0.05, big ? 0.07 : 0.05), 0.75);
      add(out, body(sr, out.length, big ? 330 : 380, 280, 0.03, 0.03), 0.35);
      add(out, burst(sr, out.length, rng, "bandpass", big ? 3000 : 3800, 0.7, big ? 0.13 : 0.085, 0.0006), 0.85 * hard);
      add(out, burst(sr, out.length, rng, "highpass", 6500, 0.7, 0.05), 0.35);
      add(out, burst(sr, L(0.006), rng, "bandpass", 2200, 1.2, 0.0012), 0.7 * hard);
      if (big) add(out, burst(sr, out.length, rng, "lowpass", 1400, 0.7, 0.2, 0.01), 0.2);
      return finish(out, vel);
    }
    case "snare-brush": {
      const out = new Float32Array(L(0.26));
      add(out, burst(sr, out.length, rng, "bandpass", 4800, 0.6, 0.075, 0.012), 0.8);
      add(out, burst(sr, out.length, rng, "highpass", 7500, 0.7, 0.05, 0.02), 0.25);
      add(out, body(sr, out.length, 200, 170, 0.02, 0.035), 0.16);
      return finish(out, vel);
    }
    case "snare-electro": {
      const out = new Float32Array(L(0.34));
      add(out, body(sr, out.length, 290, 170, 0.014, 0.05), 0.6);
      add(out, burst(sr, out.length, rng, "highpass", 1600, 0.7, 0.12), 0.85);
      add(out, burst(sr, L(0.04), rng, "bandpass", 1500, 1.2, 0.012), 0.5, L(0.012));
      return finish(out, vel);
    }
    case "hat": {
      const out = metal(sr, L(0.12), 330, 0.02, rng);
      biquad(out, sr, "highpass", 6800, 0.8);
      add(out, burst(sr, out.length, rng, "highpass", 8000, 0.8, 0.017), 1.4);
      return finish(out, vel);
    }
    case "hat-open": {
      const out = metal(sr, L(0.5), 330, 0.13, rng);
      biquad(out, sr, "highpass", 6200, 0.8);
      add(out, burst(sr, out.length, rng, "highpass", 7500, 0.8, 0.12), 1.2);
      return finish(out, vel);
    }
    case "tom-low":
    case "tom-mid":
    case "tom-high": {
      const f = kind === "tom-low" ? 95 : kind === "tom-mid" ? 135 : 190;
      const big = style === "rock" || style === "march";
      const out = new Float32Array(L(0.55));
      add(out, body(sr, out.length, f * 1.5, f, 0.045, big ? 0.2 : 0.14), 1);
      add(out, body(sr, out.length, f * 2.1, f * 1.8, 0.03, 0.06), 0.25);
      add(out, burst(sr, L(0.014), rng, "bandpass", 2400, 1, 0.003), 0.45 * hard);
      return finish(out, vel);
    }
    case "crash": {
      const out = metal(sr, L(1.8), 410, 0.45, rng);
      biquad(out, sr, "highpass", 4000, 0.8);
      add(out, burst(sr, out.length, rng, "highpass", 5200, 0.8, 0.6, 0.002), 1.5);
      return finish(out, vel);
    }
    case "ride": {
      const out = metal(sr, L(1.1), 520, 0.28, rng);
      biquad(out, sr, "highpass", 4500, 0.8);
      add(out, burst(sr, L(0.02), rng, "bandpass", 5500, 1, 0.004), 0.8);
      return finish(out, vel);
    }
    default:
      return drumHit(kind, sr, rng, vel);
  }
}
