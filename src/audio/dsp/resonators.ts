/**
 * Resonators built from delay lines: what a tube, a panel or a chassis does to
 * the sound that excites it. Additive to the shared DSP: nothing here changes
 * what another sound does.
 */
import type { Mono } from "./signal";

/**
 * A quarter-wave pipe (closed at the engine end, open at the mouth) as a
 * waveguide: the pressure that runs down it comes back inverted from the open
 * end, a little duller each trip. The resonances are at ``hz`` and its odd
 * multiples, each ringing for about ``1 / (1 - feedback)`` trips. In place, from
 * rest: run it over a loop twice (``circular``) so the seam is settled.
 *
 * @param damp 0 keeps every trip's brightness, towards 1 each trip loses its highs (a muffler).
 */
export function pipeResonance(buf: Mono, sr: number, hz: number, feedback: number, damp = 0.3): Mono {
  const delay = Math.max(2, sr / (2 * Math.max(20, hz)));
  const size = Math.ceil(delay) + 2;
  const line = new Float32Array(size);
  const whole = Math.floor(delay);
  const frac = delay - whole;
  let head = 0;
  let lp = 0;
  const g = Math.min(0.97, Math.max(0, feedback));
  for (let i = 0; i < buf.length; i++) {
    // The sample that left the engine ``delay`` samples ago, between two neighbours.
    const a = line[(head - whole + size * 2) % size]!;
    const b = line[(head - whole - 1 + size * 2) % size]!;
    const back = a + (b - a) * frac;
    lp += (1 - damp) * (back - lp);
    const y = buf[i]! - g * lp;
    buf[i] = y;
    line[head] = y;
    head = (head + 1) % size;
  }
  return buf;
}

/**
 * A comb: the input plus itself ``hz`` later, ``gain`` as loud (positive: peaks at hz and its multiples; negative:
 * notches there). In place; the cheap way to give noise a metallic or tubular ring.
 */
export function comb(buf: Mono, sr: number, hz: number, gain: number): Mono {
  const d = Math.max(1, Math.round(sr / Math.max(20, hz)));
  for (let i = buf.length - 1; i >= d; i--) buf[i]! += gain * buf[i - d]!;
  return buf;
}

/**
 * A slow random wander that repeats exactly every loop: a handful of whole sine cycles (in [2, ``top``] per loop) at
 * random phases, roughly -1..1. ``rand`` is a uniform source.
 */
export function slowWander(n: number, top: number, rand: () => number): Mono {
  const out = new Float32Array(n);
  const parts = Math.max(2, Math.min(6, top));
  let norm = 0;
  for (let k = 0; k < parts; k++) {
    const cycles = 1 + Math.floor(rand() * top);
    const amp = 0.5 + 0.5 * rand();
    const phase = rand() * 2 * Math.PI;
    norm += amp * amp;
    const w = (2 * Math.PI * cycles) / n;
    const cw = Math.cos(w);
    const sw = Math.sin(w);
    let re = Math.cos(phase);
    let im = Math.sin(phase);
    for (let i = 0; i < n; i++) {
      if ((i & 4095) === 0) {
        re = Math.cos(w * i + phase);
        im = Math.sin(w * i + phase);
      }
      out[i]! += amp * im;
      const nr = re * cw - im * sw;
      im = re * sw + im * cw;
      re = nr;
    }
  }
  const s = 1 / Math.sqrt(norm / 2);
  for (let i = 0; i < n; i++) out[i]! *= s * 0.7;
  return out;
}

/**
 * Stick-slip: the irregular grab and release of rubber or metal dragged across something, as a gain between ``floor``
 * and 1 that flickers at about ``hz`` a second. Smoothed random steps (so there is no tone, only a roughness).
 */
export function stickSlip(n: number, sr: number, hz: number, floor: number, rand: () => number): Mono {
  const out = new Float32Array(n);
  // Whole segments, so the last runs into the first and the loop has no seam.
  const segments = Math.max(2, Math.round((n / sr) * hz));
  const knots = new Float32Array(segments + 1);
  for (let k = 0; k < segments; k++) knots[k] = rand();
  knots[segments] = knots[0]!;
  const step = n / segments;
  for (let i = 0; i < n; i++) {
    const p = i / step;
    const k = Math.min(segments - 1, Math.floor(p));
    const u = p - k;
    const smooth = u * u * (3 - 2 * u);
    const v = knots[k]! + (knots[k + 1]! - knots[k]!) * smooth;
    out[i] = floor + (1 - floor) * Math.min(1, v * v * 1.6);
  }
  return out;
}
