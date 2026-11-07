/**
 * What a Grip Prix kart sounds like where it meets the world: the tyres on the
 * road, the squeal of a slide and the sparks under it, the surface under the
 * wheels (grass, sand, snow, ice, mud), the wind and the slipstream, a barrier
 * scraped along, the chassis creaking over a bump, a rival rushing past.
 *
 * Every loop is stereo. The rule for the pictures: what is low and heavy (a
 * rumble, a thump) is one thing in the middle; what is high and grainy (a
 * hiss, a patter of grains, a swish) is made twice, independently, one for
 * each ear, so the sum is never thinner than either side and the field is
 * wide. Loops are periodic by construction (whole cycles, wrapped grains,
 * cross-faded noise), so each is as smooth at its seam as anywhere.
 */
import { midiHz } from "../dsp/curves";
import { bandpass, highpass, lowpass, svf } from "../dsp/filters";
import { settle, slowWander, stickSlip } from "../dsp/resonators";
import { type Mono, normalize } from "../dsp/signal";
import { addMode, bandNoise, brown, pink, white } from "../dsp/sources";
import type { Take } from "../dsp/take";
import { loopify } from "../dsp/master";
import { narrow } from "./kart-engines";
import { bubble } from "./kit";
import { TAU, addCycles, addWrapped, cyclic, drive, expo, grains, noiseLoop, times } from "./kart-kit";

/**
 * Both ears, each made by ``make`` with its own draws of the noise, then pulled towards the middle so the sum to
 * mono loses at most a dB and a half: ``width`` 1 keeps them fully apart, 0 is one signal.
 */
const both = (make: (side: number) => Mono, width = 0.7): Mono[] => narrow([make(-1), make(1)], width);

/** A mix of weighted layers into a fresh buffer. */
function mix(n: number, layers: readonly (readonly [Mono, number])[]): Mono {
  const out = new Float32Array(n);
  for (const [layer, gain] of layers) for (let i = 0; i < n; i++) out[i]! += gain * layer[i]!;
  return out;
}

const phase = (t: Take): number => t.rng.range(0, TAU);

// --- the road -------------------------------------------------------------------------------------------------

/**
 * The tyres rolling on the road: a low rumble of rubber on tarmac, the hum of
 * the tread (it rises with the speed, as the loop is played faster), the fine
 * grain of the surface, and the thump of a joint in the road every so often
 * (faster with the speed, which is how a road is counted). Quiet, swelling
 * with speed; it falls away in the air, which is half of what makes a jump
 * feel airborne.
 */
export function tyreRoad(t: Take): Mono[] {
  const seconds = 2;
  const n = t.n(seconds);
  const r = t.rng;
  const rumbleShared = noiseLoop(t, seconds, (m) => bandpass(brown(m, r), t.sr, 50, 420, 2), 0.3);
  normalize(rumbleShared);
  times(rumbleShared, cyclic(n, 3, 0.3, phase(t)));
  // The tread's hum: two partials of the tyre's pattern, whole cycles, breathing.
  const hum = new Float32Array(n);
  addCycles(hum, Math.round(170 * seconds * t.p), 1, phase(t));
  addCycles(hum, Math.round(255 * seconds * t.p), 0.5, phase(t));
  addCycles(hum, Math.round(340 * seconds * t.p), 0.22, phase(t));
  times(hum, cyclic(n, 5, 0.6, phase(t)));
  return both(() => {
    const rumble = noiseLoop(t, seconds, (m) => bandpass(brown(m, r), t.sr, 50, 420, 2), 0.3);
    normalize(rumble);
    times(rumble, cyclic(n, 3, 0.3, phase(t)));
    const grain = noiseLoop(t, seconds, (m) => bandpass(pink(m, r), t.sr, 800, 4200, 2), 0.3);
    normalize(grain);
    times(grain, cyclic(n, 11, 0.5, phase(t)));
    times(grain, cyclic(n, 17, 0.3, phase(t)));
    const joints = grains(t, seconds, 4, (s) => {
      const g = new Float32Array(t.n(0.12));
      addMode(g, t.sr, 0, r.range(62, 95), s, 0.02, phase(t));
      const tick = bandpass(white(t.n(0.004), r), t.sr, 600, 2500, 2);
      expo(tick, t.sr, 0.001, 0.0002);
      for (let i = 0; i < tick.length; i++) g[i]! += 0.6 * tick[i]!;
      return g;
    });
    return mix(n, [[rumbleShared, 0.55], [rumble, 0.45], [hum, 0.09], [grain, 0.34], [joints, 0.42]]);
  });
}

// --- the drift --------------------------------------------------------------------------------------------------

/**
 * The tyres' squeal in a drift: noise through three narrow resonances (the
 * rubber's own, an octave-and-a-bit apart, not harmonics) whose centres
 * wander as the grip comes and goes, so it whistles like a real tyre instead
 * of beeping, shuddering with the rubber's stick and slip, over the scrub of
 * the tread going sideways and a hiss. Each ear has its own tyre, a hair apart
 * in pitch. The game steers its pitch with the slip and climbs it as the
 * sparks tier up.
 */
export function driftScreech(t: Take): Mono[] {
  const seconds = 1.2;
  const n = t.n(seconds);
  const over = t.n(0.3);
  const m = n + over;
  const r = t.rng;
  return both((side) => {
    const w1 = slowWander(m, 7, () => r.next());
    const w2 = slowWander(m, 19, () => r.next());
    const f1 = new Float32Array(m);
    const base = 1050 * t.p * (1 + 0.014 * side);
    for (let i = 0; i < m; i++) f1[i] = base * (1 + 0.04 * w1[i]! + 0.018 * w2[i]!);
    const f2 = f1.map((f) => f * 1.52);
    const f3 = f1.map((f) => f * 2.31);
    const src = white(m, r);
    const a = normalize(svf(Float32Array.from(src), t.sr, "bp", f1, 38));
    const b = normalize(svf(Float32Array.from(src), t.sr, "bp", f2, 30));
    const c = normalize(svf(Float32Array.from(src), t.sr, "bp", f3, 22));
    const squeal = mix(m, [[a, 1], [b, 0.55], [c, 0.3]]);
    const slip = stickSlip(m, t.sr, 38, 0.35, () => r.next());
    const grip = cyclic(m, 6, 0.3, phase(t));
    times(squeal, slip);
    times(squeal, grip);
    const scrub = bandNoise(m, t.sr, r, 380, 1500, 2);
    times(scrub, stickSlip(m, t.sr, 17, 0.3, () => r.next()));
    const hiss = bandNoise(m, t.sr, r, 2200, 8000, 2);
    const whole = mix(m, [[squeal, 0.85], [scrub, 0.28], [hiss, 0.3]]);
    return loopify(whole, n);
  });
}

/**
 * The sparks of a drift, fizzing under the squeal: a dense crackle of tiny
 * bright clicks over a hiss, with a glint of ringing sparks above them.
 * Silent before the first spark; RaceAudio raises it and pitches it up at each
 * level, so the charge is heard building before it is let go.
 */
export function driftSparks(t: Take): Mono[] {
  const seconds = 1.2;
  const n = t.n(seconds);
  const r = t.rng;
  return both(() => {
    const crackle = grains(t, seconds, 260, (s) => {
      const len = t.n(r.range(0.0006, 0.0025));
      const g = white(len, r);
      for (let i = 0; i < len; i++) g[i]! *= Math.exp((-4 * i) / len) * (0.4 + s * s);
      return g;
    });
    settle(crackle, (twice) => bandpass(twice, t.sr, 2400, 10000, 2));
    normalize(crackle);
    const hiss = noiseLoop(t, seconds, (m) => bandNoise(m, t.sr, r, 4200, 10000, 2));
    times(hiss, cyclic(n, 9, 0.5, phase(t)));
    // Glints: a spark that rings for a moment, high.
    const glint = grains(t, seconds, 16, (s) => {
      const g = new Float32Array(t.n(0.04));
      addMode(g, t.sr, 0, r.range(3200, 7800), s, r.range(0.003, 0.009), phase(t));
      return g;
    });
    return mix(n, [[crackle, 0.8], [hiss, 0.32], [glint, 0.2]]);
  });
}

// --- the ground --------------------------------------------------------------------------------------------------

/** Ice: a hiss of fine crystals, glassy ticks, and the whole lake creaking as the kart's weight crosses it. */
export function surfaceIce(t: Take): Mono[] {
  const seconds = 2;
  const n = t.n(seconds);
  const r = t.rng;
  const creak = (side: number): Mono => {
    const out = new Float32Array(n);
    for (let k = 0; k < 2; k++) {
      const len = t.n(0.7);
      const f0 = r.range(130, 190) * (1 + 0.03 * side);
      const f = new Float32Array(len);
      for (let i = 0; i < len; i++) f[i] = f0 * Math.pow(1.7, Math.pow(i / len, 1.3));
      const body = new Float32Array(len);
      let ph = 0;
      for (let i = 0; i < len; i++) {
        ph += (TAU * f[i]!) / t.sr;
        body[i] = Math.sin(ph) + 0.5 * Math.sin(2 * ph) + 0.3 * Math.sin(3.01 * ph);
      }
      times(body, stickSlip(len, t.sr, 45, 0.15, () => r.next()));
      for (let i = 0; i < len; i++) body[i]! *= Math.sin((Math.PI * i) / len) ** 2;
      addWrapped(out, body, Math.floor(((k + r.range(0.1, 0.6)) / 2) * n), 1);
    }
    return out;
  };
  return both((side) => {
    const hiss = noiseLoop(t, seconds, (m) => highpass(white(m, r), t.sr, 4800, 2), 0.3);
    normalize(hiss);
    times(hiss, cyclic(n, 3, 0.4, phase(t)));
    const ticks = grains(t, seconds, 8, (s) => {
      const g = new Float32Array(t.n(0.04));
      addMode(g, t.sr, 0, r.range(3200, 8200), s, r.range(0.002, 0.007), phase(t));
      return g;
    });
    const sing = noiseLoop(t, seconds, (m) => bandNoise(m, t.sr, r, 1150, 1450, 2), 0.3);
    normalize(sing);
    times(sing, cyclic(n, 2, 0.8, phase(t)));
    return mix(n, [[hiss, 0.3], [ticks, 0.55], [creak(side), 0.2], [sing, 0.07]]);
  });
}

/** Snow: dry squeaky crunch, grain after grain, with the fump of the pack giving way under the wheels. */
export function surfaceSnow(t: Take): Mono[] {
  const seconds = 2;
  const n = t.n(seconds);
  const r = t.rng;
  return both(() => {
    const crunch = grains(t, seconds, 36, (s) => {
      const len = t.n(r.range(0.008, 0.03));
      const g = bandpass(white(len, r), t.sr, r.range(900, 2400), r.range(3500, 7000), 2);
      if (r.next() < 0.3) addMode(g, t.sr, 0, r.range(2200, 3600), 0.5 * s, 0.006, phase(t));
      return expo(g, t.sr, 0.006 + 0.004 * s, 0.0005);
    });
    const fump = grains(t, seconds, 5, (s) => {
      const g = lowpass(white(t.n(0.06), r), t.sr, r.range(160, 320), 2);
      for (let i = 0; i < g.length; i++) g[i]! *= Math.sin((Math.PI * i) / g.length) ** 2 * s * 3;
      return g;
    });
    const air = noiseLoop(t, seconds, (m) => bandNoise(m, t.sr, r, 3500, 8500, 2), 0.3);
    times(air, cyclic(n, 4, 0.5, phase(t)));
    return mix(n, [[crunch, 1], [fump, 0.5], [air, 0.12]]);
  });
}

/** Sand and gravel: a coarse rush, a patter of grains, stones knocking. */
export function surfaceSand(t: Take): Mono[] {
  const seconds = 2;
  const n = t.n(seconds);
  const r = t.rng;
  const bed = noiseLoop(t, seconds, (m) => bandNoise(m, t.sr, r, 250, 900, 2), 0.3);
  times(bed, cyclic(n, 5, 0.5, phase(t)));
  return both(() => {
    const rush = noiseLoop(t, seconds, (m) => bandNoise(m, t.sr, r, 1800, 8500, 2), 0.3);
    times(rush, cyclic(n, 7, 0.4, phase(t)));
    const patter = grains(t, seconds, 280, (s) => {
      const len = t.n(r.range(0.0003, 0.0012));
      const g = white(len, r);
      for (let i = 0; i < len; i++) g[i]! *= Math.exp((-3 * i) / len) * s;
      return g;
    });
    settle(patter, (twice) => bandpass(twice, t.sr, 2200, 9000, 2));
    normalize(patter);
    const stones = grains(t, seconds, 26, (s) => {
      const g = new Float32Array(t.n(0.03));
      addMode(g, t.sr, 0, r.range(500, 2600), s, r.range(0.002, 0.006), phase(t));
      const tick = bandpass(white(t.n(0.006), r), t.sr, 2000, 7000, 2);
      expo(tick, t.sr, 0.0015, 0.0003);
      for (let i = 0; i < tick.length; i++) g[i]! += 0.8 * tick[i]!;
      return g;
    });
    return mix(n, [[rush, 0.42], [patter, 0.5], [stones, 0.55], [bed, 0.22]]);
  });
}

/** Mud: a thick low slosh, wet slaps of the tread pulling out, bubbles bursting, a gurgle underneath. */
export function surfaceMud(t: Take): Mono[] {
  const seconds = 2;
  const n = t.n(seconds);
  const r = t.rng;
  const gurgle = new Float32Array(n);
  addCycles(gurgle, Math.round(88 * seconds), 1, phase(t));
  addCycles(gurgle, Math.round(131 * seconds), 0.5, phase(t));
  times(gurgle, cyclic(n, 3, 0.8, phase(t)));
  return both(() => {
    const body = noiseLoop(t, seconds, (m) => lowpass(brown(m, r), t.sr, 650, 2), 0.3);
    normalize(body);
    times(body, cyclic(n, 3, 0.6, phase(t)));
    const slaps = grains(t, seconds, 13, (s) => {
      const len = t.n(r.range(0.07, 0.13));
      const g = white(len, r);
      svf(g, t.sr, "bp", (u: number) => r.range(0.9, 1.1) * 1000 * Math.pow(0.26, u), 3);
      for (let i = 0; i < len; i++) {
        const u = i / len;
        g[i]! *= Math.min(1, u * 14) * Math.pow(1 - u, 1.6) * 2.4 * s;
      }
      return g;
    });
    const pops = grains(t, seconds, 11, () => {
      const g = bubble(t, r.range(180, 650), r.range(0.012, 0.03), 1.8);
      return g.length > 0 ? g : new Float32Array(1);
    });
    const crackle = grains(t, seconds, 45, (s) => {
      const len = t.n(r.range(0.001, 0.004));
      const g = bandpass(white(len, r), t.sr, 1000, 3500, 2);
      for (let i = 0; i < len; i++) g[i]! *= Math.exp((-3 * i) / len) * s;
      return g;
    });
    return mix(n, [[body, 0.5], [slaps, 0.65], [pops, 0.9], [crackle, 0.3], [gurgle, 0.12]]);
  });
}

/** Grass: a soft swish of the verge against the wheels, a sizzle of blades, stalks snapping, the turf's thrum. */
export function surfaceGrass(t: Take): Mono[] {
  const seconds = 2;
  const n = t.n(seconds);
  const r = t.rng;
  const thrum = noiseLoop(t, seconds, (m) => bandpass(brown(m, r), t.sr, 70, 260, 2), 0.3);
  normalize(thrum);
  times(thrum, cyclic(n, 7, 0.4, phase(t)));
  return both(() => {
    const swish = noiseLoop(t, seconds, (m) => bandpass(pink(m, r), t.sr, 600, 4500, 2), 0.3);
    normalize(swish);
    times(swish, cyclic(n, 5, 0.5, phase(t)));
    times(swish, cyclic(n, 3, 0.3, phase(t)));
    const sizzle = noiseLoop(t, seconds, (m) => bandNoise(m, t.sr, r, 4500, 9000, 2), 0.3);
    times(sizzle, cyclic(n, 9, 0.6, phase(t)));
    const snaps = grains(t, seconds, 22, (s) => {
      const tick = bandpass(white(t.n(0.003), r), t.sr, 2500, 6500, 2);
      return expo(tick, t.sr, 0.0008 + 0.0008 * s, 0.0002);
    });
    return mix(n, [[swish, 0.7], [sizzle, 0.22], [snaps, 0.38], [thrum, 0.3]]);
  });
}

// --- the air ---------------------------------------------------------------------------------------------------

/**
 * The wind past a fast kart and round one in the air: a broad rush of air that swells and eases differently in each
 * ear, a thin whistle round the edges, the flutter of buffeting and a fine hiss. Steered by the game (louder and
 * higher with speed, loudest off a jump).
 */
export function windRush(t: Take): Mono[] {
  const seconds = 2;
  const n = t.n(seconds);
  const r = t.rng;
  return both((side) => {
    const rush = noiseLoop(t, seconds, (m) => bandpass(pink(m, r), t.sr, 180, 2400, 2), 0.3);
    normalize(rush);
    times(rush, cyclic(n, 2 + (side > 0 ? 1 : 0), 0.4, phase(t)));
    times(rush, cyclic(n, 5, 0.25, phase(t)));
    const whistle = noiseLoop(t, seconds, (m) => bandNoise(m, t.sr, r, 1100, 1400, 2), 0.3);
    normalize(whistle);
    times(whistle, cyclic(n, 3 + (side > 0 ? 0 : 1), 0.85, phase(t)));
    const flutter = stickSlip(n, t.sr, 11, 0.55, () => r.next());
    times(rush, flutter);
    const hiss = noiseLoop(t, seconds, (m) => bandNoise(m, t.sr, r, 2800, 7500, 2), 0.3);
    normalize(hiss);
    times(hiss, cyclic(n, 5, 0.55, phase(t)));
    return mix(n, [[rush, 0.82], [whistle, 0.16], [hiss, 0.2]]);
  });
}

/**
 * Sitting in another kart's wake: the air torn and turbulent, a deep roar with a fast buffeting, a ripping band that
 * sweeps up and down, wide and all round. Steered up as the draft charges.
 */
export function slipstreamRush(t: Take): Mono[] {
  const seconds = 2;
  const n = t.n(seconds);
  const r = t.rng;
  return both((side) => {
    const roar = noiseLoop(t, seconds, (m) => bandpass(brown(m, r), t.sr, 50, 800, 2), 0.3);
    normalize(roar);
    times(roar, stickSlip(n, t.sr, 22, 0.4, () => r.next()));
    const sweepPhase = phase(t);
    const tear = noiseLoop(t, seconds, (m) => {
      const x = white(m, r);
      return svf(x, t.sr, "bp", (u: number) => 2600 + 1700 * Math.sin(TAU * 3 * u * (m / n) + sweepPhase + side), 1.6);
    }, 0.3);
    normalize(tear);
    times(tear, cyclic(n, 6, 0.6, phase(t)));
    const hiss = noiseLoop(t, seconds, (m) => highpass(white(m, r), t.sr, 5000, 2), 0.3);
    normalize(hiss);
    return mix(n, [[roar, 0.7], [tear, 0.34], [hiss, 0.1]]);
  });
}

/**
 * A barrier scraped along: plastic and metal dragging with a rough, flickering
 * grip, the panel ringing at its own pitches, grit under it and a thin squeal
 * above. Steered by the speed the kart rubs along at; held while the contact lasts.
 */
export function barrierScrape(t: Take): Mono[] {
  const seconds = 1;
  const n = t.n(seconds);
  const r = t.rng;
  return both((side) => {
    const grit = noiseLoop(t, seconds, (m) => bandpass(white(m, r), t.sr, 600, 5200, 2), 0.2);
    normalize(grit);
    const panel = Float32Array.from(grit);
    // The panel's modes: the barrier rings at these pitches wherever the rubbing excites them.
    const rung = new Float32Array(n);
    for (const [hz, g] of [[380, 1], [760, 0.7], [1900, 0.5], [3300, 0.3]] as const) {
      const band = Float32Array.from(panel);
      settle(band, (twice) => bandpass(twice, t.sr, hz * (1 + 0.02 * side) * 0.9, hz * (1 + 0.02 * side) * 1.1, 2));
      for (let i = 0; i < n; i++) rung[i]! += g * band[i]!;
    }
    normalize(rung);
    const stick = stickSlip(n, t.sr, 34, 0.2, () => r.next());
    const shudder = cyclic(n, 9, 0.5, phase(t));
    const out = mix(n, [[rung, 0.8], [grit, 0.35]]);
    times(out, stick);
    times(out, shudder);
    // A thin squeal where the paint grabs.
    const squeal = new Float32Array(n);
    addCycles(squeal, Math.round(2350 * seconds * t.p), 1, phase(t));
    times(squeal, stickSlip(n, t.sr, 21, 0, () => r.next()));
    for (let i = 0; i < n; i++) out[i]! += 0.05 * squeal[i]!;
    return out;
  });
}

/** The chassis creaking as the suspension takes a bump: a short stick-slip groan, falling, with a rattle of the loose parts. */
export function suspensionCreak(t: Take): Mono[] {
  const r = t.rng;
  const len = t.n(0.5);
  return both((side) => {
    const f0 = r.range(210, 280) * (1 + 0.025 * side);
    const body = new Float32Array(len);
    let ph = 0;
    for (let i = 0; i < len; i++) {
      const u = i / len;
      ph += (TAU * f0 * Math.pow(0.62, u)) / t.sr;
      body[i] = Math.sin(ph) + 0.45 * Math.sin(2 * ph) + 0.25 * Math.sin(3.02 * ph);
    }
    times(body, stickSlip(len, t.sr, 38, 0.1, () => r.next()));
    for (let i = 0; i < len; i++) body[i]! *= Math.sin(0.5 * Math.PI * Math.min(1, (i / len) * 4)) * Math.pow(1 - i / len, 1.4);
    const rattle = bandpass(white(len, r), t.sr, 1800, 5200, 2);
    for (let i = 0; i < len; i++) rattle[i]! *= Math.exp((-5 * i) / len) * (r.next() < 0.18 ? 1 : 0.15);
    for (let i = 0; i < len; i++) body[i]! += 0.14 * rattle[i]!;
    return body;
  });
}

/**
 * A kart rushing past: a burst of air with a pressure bump, its pitch falling
 * as it goes (the Doppler of the air itself), different in each ear.
 */
export function passWhoosh(t: Take): Mono[] {
  const seconds = 0.9;
  const n = t.n(seconds);
  const r = t.rng;
  return both((side) => {
    const air = white(n, r);
    svf(air, t.sr, "bp", (u: number) => 2900 * Math.pow(0.17, Math.pow(u, 0.7)) * (1 + 0.04 * side), 1.4);
    normalize(air);
    const env = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const u = i / n;
      env[i] = Math.min(1, u * 9) ** 2 * Math.pow(1 - u, 2.2);
    }
    times(air, env);
    // The pressure wave: a soft low bump just after the front passes.
    const bump = new Float32Array(n);
    addMode(bump, t.sr, 0.1, midiHz(31) * t.p, 0.6, 0.06, 0);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = air[i]! + bump[i]!;
    drive(out, 1.2);
    return out;
  });
}
