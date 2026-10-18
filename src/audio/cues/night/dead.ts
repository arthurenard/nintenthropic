/**
 * The dead: a walker's groan and a runner's snarl, the last air going out of
 * one as it drops and the body landing, their feet on the road and their
 * claws on the barricade, a runner's lunge, a bloater bursting, the
 * Mechanic's roar and his tyre iron, and the dead climbing out of the bus,
 * over a fence and through the corn.
 */
import { type Curve, lerp } from "../../dsp/curves";
import { highpass, lowpass, resonate, svf } from "../../dsp/filters";
import { type Mono, adsr, normalize, shapeBy, wobble } from "../../dsp/signal";
import { addMode, bandNoise, click, decayInPlace, white } from "../../dsp/sources";
import type { Take } from "../../dsp/take";
import { addShard, bubble, burst, creak, flicker, knock, scatter, thump, wanderTrack } from "../kit";
import { type VocalOptions, footfall, leafRasp, sandTrickle, scrape, vocal } from "./layers";

/**
 * A dead man's groan, one of six shapes (by take): a low moan sinking from
 * "uh" to "oh"; a rattling exhale (the voice a slow creak of separate
 * pulses, fluttering with what is in the throat); a gurgling growl (the
 * false folds growling at half the pitch, the resonances wobbling with
 * liquid, bubbles bursting through); a hoarse moan rising as the mouth opens
 * and breaking at the top; a wet choke (short strangled pushes cut off by
 * the throat, then a wheeze back in); a long hollow "oo" whose voice drops
 * into a croak and back. Every one is a rough irregular throat plus layered
 * breath, and its pitch wanders: nothing here is steady, because nothing
 * about them is.
 */
export function nightGroan(t: Take): Mono {
  const r = t.rng;
  const shape = t.index % 6;
  const m = t.cutoff;
  const pitch = r.range(66, 90) * t.p;
  const len = t.j([1.7, 1.25, 1.45, 1.85, 1.2, 2.0][shape]!, 0.08);
  const out = t.canvas(len + 0.1);
  const drift = wanderTrack(t.n(len), r, 5, t.sr);
  const wander = (u: number): number => 1 + 0.07 * (2 * drift(u) - 1);
  const hoarse = (at: number, seconds: number, gain: number, f1: number, f2: number, env: Curve): void => {
    const air = vocal(t, seconds, {
      f0: () => pitch,
      voicing: () => 0,
      tract: [{ f: () => f1 * m, q: 3, amp: 1 }, { f: () => f2 * m, q: 4, amp: 0.55 }, { f: () => 2800 * m, q: 6, amp: 0.2 }],
      level: env,
      flutter: { rate: 12, depth: 0.4 },
    });
    t.put(out, air, at, gain);
  };
  if (shape === 0) {
    const moan = vocal(t, len, {
      f0: (u) => pitch * (0.97 + 0.1 * Math.sin(Math.PI * u) - 0.14 * u) * wander(u),
      voicing: (u) => 0.8 - 0.35 * Math.max(0, u - 0.6),
      tension: (u) => 0.35 + 0.2 * Math.sin(Math.PI * u),
      jitter: 0.07, shimmer: 0.3, breath: 0.25, rasp: 0.25, wet: 0.05,
      tract: [
        { f: () => 290 * m, q: 3, amp: 0.35 },
        { f: (u) => lerp(580, 450, u) * m, q: 5, amp: 1 },
        { f: (u) => lerp(1080, 820, u) * m, q: 7, amp: 0.5 },
        { f: () => 2450 * m, q: 10, amp: 0.18 },
      ],
      level: (u) => Math.pow(Math.min(1, u / 0.25), 1.5) * Math.pow(1 - u, 0.9),
      flutter: { rate: 4, depth: 0.3 },
    });
    t.put(out, moan, 0.02, 1);
    hoarse(0.02 + len * 0.35, len * 0.6, 0.22, 700, 1350, (u) => Math.sin(Math.PI * u) ** 2);
  } else if (shape === 1) {
    const rattle = vocal(t, len, {
      f0: (u) => pitch * 0.5 * (1 - 0.25 * u) * wander(u),
      voicing: (u) => 0.55 - 0.35 * u,
      tension: () => 0.2,
      jitter: 0.25, shimmer: 0.5, breath: 0.5,
      tract: [
        { f: (u) => lerp(650, 500, u) * m, q: 4, amp: 1 },
        { f: (u) => lerp(1250, 1000, u) * m, q: 6, amp: 0.55 },
        { f: () => 2500 * m, q: 8, amp: 0.2 },
      ],
      level: (u) => Math.min(1, u * 8) * Math.pow(1 - u, 1.1),
      flutter: { rate: 27, depth: 0.6 },
    });
    t.put(out, rattle, 0.02, 1);
    hoarse(0.02, len, 0.45, 820, 1700, (u) => Math.min(1, u * 5) * Math.pow(1 - u, 1.4));
  } else if (shape === 2) {
    const growl = vocal(t, len, {
      f0: (u) => pitch * 1.12 * (1 + 0.08 * Math.sin(Math.PI * u)) * wander(u),
      voicing: () => 0.85,
      tension: () => 0.75,
      jitter: 0.08, shimmer: 0.35, breath: 0.2, rasp: 0.65, wet: 0.16, wetRate: 13,
      tract: [
        { f: () => 300 * m, q: 3, amp: 0.3 },
        { f: (u) => lerp(640, 540, u) * m, q: 5, amp: 1 },
        { f: (u) => lerp(990, 900, u) * m, q: 6, amp: 0.6 },
        { f: () => 2400 * m, q: 9, amp: 0.2 },
      ],
      level: (u) => Math.pow(Math.sin(Math.PI * u), 0.7) * (0.7 + 0.3 * Math.sin(3 * Math.PI * u)),
      flutter: { rate: 18, depth: 0.35 },
    });
    t.put(out, growl, 0.02, 1);
    for (let k = 0, c = r.int(4, 8); k < c; k++) {
      t.put(out, bubble(t, r.range(160, 380) * t.p, r.range(0.008, 0.02), r.range(1.4, 2)), 0.02 + r.range(0.15, 0.85) * len, r.range(0.08, 0.2));
    }
  } else if (shape === 3) {
    const rise = vocal(t, len, {
      f0: (u) => pitch * (u < 0.82 ? 0.85 + 0.6 * Math.pow(u / 0.82, 1.3) : lerp(1.45, 1.1, (u - 0.82) / 0.18)) * wander(u),
      voicing: (u) => 0.65 + 0.2 * Math.sin(Math.PI * u),
      tension: (u) => 0.4 + 0.45 * u,
      jitter: 0.09, shimmer: 0.35, breath: 0.45, rasp: 0.2,
      tract: [
        { f: (u) => lerp(500, 740, u * 1.3) * m, q: 5, amp: 1 },
        { f: (u) => lerp(880, 1250, u) * m, q: 7, amp: 0.55 },
        { f: () => 2500 * m, q: 10, amp: 0.2 },
        { f: () => 3400 * m, q: 12, amp: 0.08 },
      ],
      level: (u) => Math.pow(Math.min(1, u / 0.35), 1.2) * (u < 0.85 ? 1 : (1 - u) / 0.15),
      flutter: { rate: 6, depth: 0.2 },
    });
    t.put(out, rise, 0.02, 1);
    hoarse(0.02 + len * 0.2, len * 0.8, 0.3, 760, 1500, (u) => Math.sin(Math.PI * u));
  } else if (shape === 4) {
    let at = 0.02;
    const pushes = r.int(3, 5);
    for (let k = 0; k < pushes; k++) {
      const bl = r.range(0.08, 0.14);
      const lift = 1.25 - 0.1 * k;
      const ukh = vocal(t, bl, {
        f0: (u) => pitch * lift * (1.05 - 0.2 * u),
        voicing: (u) => 0.7 - 0.4 * u,
        tension: () => 0.95,
        jitter: 0.1, shimmer: 0.4, breath: 0.35, rasp: 0.5, wet: 0.2, wetRate: 16,
        tract: [{ f: () => 560 * m, q: 5, amp: 1 }, { f: () => 1050 * m, q: 6, amp: 0.6 }, { f: () => 2450 * m, q: 9, amp: 0.2 }],
        // The throat shutting on it: cut off, not faded.
        level: (u) => Math.min(1, u * 20) * (u < 0.75 ? 1 : (1 - u) / 0.25),
      });
      t.put(out, ukh, at, 1 - 0.12 * k);
      at += bl + r.range(0.05, 0.1);
    }
    const wl = Math.max(0.2, len - at);
    const wheeze = vocal(t, wl, {
      f0: () => pitch,
      voicing: () => 0,
      tract: [{ f: (u) => lerp(420, 620, u) * m, q: 6, amp: 1 }, { f: () => 1850 * m, q: 12, amp: 0.8 }, { f: () => 3100 * m, q: 14, amp: 0.3 }],
      level: (u) => Math.sin(Math.PI * Math.min(1, u * 1.1)) ** 1.5,
    });
    t.put(out, wheeze, at, 0.35);
  } else {
    const breakAt = r.range(0.35, 0.55);
    const breakLen = r.range(0.05, 0.08);
    const hollow = vocal(t, len, {
      // The voice drops into a croak an octave down for a moment, and back.
      f0: (u) => pitch * 1.05 * (1 - 0.18 * u) * (Math.abs(u - breakAt) < breakLen ? 0.5 : 1) * wander(u),
      voicing: () => 0.85,
      tension: () => 0.45,
      jitter: 0.06, shimmer: 0.25, breath: 0.3, rasp: 0.3,
      tract: [
        { f: (u) => lerp(380, 480, u) * m, q: 5, amp: 1 },
        { f: (u) => lerp(760, 860, u) * m, q: 6, amp: 0.5 },
        { f: () => 2300 * m, q: 9, amp: 0.12 },
      ],
      level: (u) => Math.pow(Math.min(1, u / 0.35), 1.6) * Math.pow(1 - u, 0.8),
      flutter: { rate: 5, depth: 0.25 },
    });
    t.put(out, hollow, 0.02, 1);
    hoarse(0.02 + len * 0.5, len * 0.45, 0.2, 600, 1100, (u) => Math.sin(Math.PI * u) ** 1.5);
  }
  highpass(out, t.sr, 65, 2);
  return out;
}

/**
 * A runner: harsher, faster and higher than a walker — the voice pressed
 * hard, the false folds tearing under it, the mouth wide open. One of four
 * shapes (by take): a snarl tearing up into a shriek and a hiss of breath
 * pulled back; two short snarls; a long rising shriek that cracks at the
 * top; a gnashing snarl with the teeth clacking and a spit.
 */
export function nightSnarl(t: Take): Mono {
  const r = t.rng;
  const shape = t.index % 4;
  const m = t.cutoff;
  const pitch = r.range(200, 260) * t.p;
  const out = t.canvas(1.1);
  const open = (k: number): VocalOptions["tract"] => [
    { f: (u) => lerp(820, 950, u) * m * k, q: 5, amp: 1 },
    { f: () => 1750 * m * k, q: 6, amp: 0.8 },
    { f: () => 2750 * m * k, q: 8, amp: 0.45 },
    { f: () => 3700 * m * k, q: 10, amp: 0.2 },
  ];
  const snarl = (at: number, seconds: number, gain: number, lift: number): void => {
    const s = vocal(t, seconds, {
      f0: (u) => pitch * lift * (0.8 + 0.25 * Math.sin(Math.PI * u)),
      tension: () => 0.95,
      jitter: 0.1, shimmer: 0.45, breath: 0.4, rasp: 0.75, wet: 0.08,
      tract: open(0.9),
      level: (u) => Math.min(1, u * 14) * (u < 0.7 ? 1 : (1 - u) / 0.3),
      flutter: { rate: 30, depth: 0.35 },
    });
    t.put(out, s, at, gain);
  };
  const inhale = (at: number, seconds: number, gain: number): void => {
    const h = vocal(t, seconds, {
      f0: () => pitch,
      voicing: () => 0,
      tract: [{ f: () => 900 * m, q: 5, amp: 0.6 }, { f: () => 2200 * m, q: 8, amp: 1 }, { f: () => 3600 * m, q: 9, amp: 0.5 }],
      level: (u) => Math.sin(Math.PI * u) ** 1.2,
    });
    t.put(out, h, at, gain);
  };
  if (shape === 0) {
    snarl(0.01, 0.16, 0.8, 0.5);
    const shriek = vocal(t, 0.5, {
      f0: (u) => pitch * (0.9 + 0.6 * Math.min(1, u * 2.5)),
      tension: () => 1,
      jitter: 0.06, shimmer: 0.35, breath: 0.35, rasp: 0.5,
      tract: open(1),
      level: (u) => Math.min(1, u * 10) * (u < 0.8 ? 1 : (1 - u) / 0.2),
    });
    t.put(out, shriek, 0.15, 1);
    inhale(0.7, 0.18, 0.35);
  } else if (shape === 1) {
    snarl(0.01, r.range(0.18, 0.24), 1, r.range(0.9, 1.05));
    snarl(0.32, r.range(0.22, 0.3), 0.9, r.range(1.0, 1.2));
    inhale(0.66, 0.16, 0.3);
  } else if (shape === 2) {
    const crack = r.range(0.78, 0.86);
    const long = vocal(t, 0.75, {
      f0: (u) => pitch * (u < crack ? 0.75 + 0.85 * u : 1.4 * 0.62),
      tension: (u) => 0.85 + 0.15 * u,
      jitter: 0.07, shimmer: 0.35, breath: 0.3, rasp: 0.45,
      tract: open(1.05),
      level: (u) => Math.min(1, u * 8) * (u < 0.88 ? 1 : (1 - u) / 0.12),
    });
    t.put(out, long, 0.02, 1);
    inhale(0.8, 0.14, 0.25);
  } else {
    snarl(0.01, r.range(0.42, 0.52), 1, r.range(0.8, 0.95));
    // Teeth: two or three hard clacks through it, and a spit.
    for (let k = 0, c = r.int(2, 4); k < c; k++) {
      const at = r.range(0.08, 0.45);
      t.put(out, click(t.sr, r, 0.002, 1500, 9000), at, 0.35);
      addMode(out, t.sr, at, r.range(2200, 3000), 0.12, 0.004, 0);
    }
    t.put(out, burst(t, 0.06, 900, 8000, 0.0008, 0.012, 2, 1), r.range(0.55, 0.65), 0.35);
  }
  highpass(out, t.sr, 120, 2);
  return out;
}

/**
 * The last air going out of one as it drops, one of four shapes (by take):
 * a long rattling exhale (the voice a creak of separate pulses, rattling
 * with what is in the throat); a choked groan and then the breath; a
 * gurgling rattle; a voiced sigh cut off by the throat closing.
 */
export function nightDeadFall(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(1.1);
  const shape = t.index % 4;
  const m = t.cutoff;
  const pitch = r.range(70, 90) * t.p;
  const exhale = (at: number, seconds: number, gain: number, voiced: number): void => {
    const ex = vocal(t, seconds, {
      f0: (u) => pitch * 0.45 * (1 - 0.3 * u),
      voicing: (u) => voiced * (1 - u),
      tension: () => 0.2,
      jitter: 0.3, shimmer: 0.5, breath: 0.6,
      tract: [
        { f: (u) => lerp(640, 480, u) * m, q: 4, amp: 1 },
        { f: (u) => lerp(1200, 1000, u) * m, q: 6, amp: 0.5 },
        { f: () => 2400 * m, q: 8, amp: 0.2 },
      ],
      level: (u) => Math.min(1, u * 10) * Math.pow(1 - u, 1.2),
      flutter: { rate: 26, depth: 0.55 },
    });
    t.put(out, ex, at, gain);
  };
  if (shape === 0) {
    exhale(0.02, t.j(0.85, 0.1), 1, 0.5);
  } else if (shape === 1) {
    const len = t.j(0.2, 0.15);
    const groan = vocal(t, len, {
      f0: (u) => pitch * (1.1 - 0.35 * u),
      tension: () => 0.85,
      jitter: 0.08, shimmer: 0.35, breath: 0.3, rasp: 0.5,
      tract: [{ f: () => 560 * m, q: 5, amp: 1 }, { f: () => 1000 * m, q: 6, amp: 0.55 }, { f: () => 2400 * m, q: 9, amp: 0.2 }],
      level: (u) => Math.min(1, u * 15) * (u < 0.8 ? 1 : (1 - u) / 0.2),
    });
    t.put(out, groan, 0.02, 1);
    exhale(0.02 + len + r.range(0.04, 0.09), t.j(0.55, 0.12), 0.6, 0.15);
  } else if (shape === 2) {
    const rattle = vocal(t, t.j(0.8, 0.1), {
      f0: (u) => pitch * 0.32 * (1 - 0.2 * u),
      voicing: (u) => 0.75 - 0.4 * u,
      tension: () => 0.3,
      jitter: 0.35, shimmer: 0.6, breath: 0.45, wet: 0.2, wetRate: 14,
      tract: [{ f: () => 520 * m, q: 5, amp: 1 }, { f: () => 950 * m, q: 6, amp: 0.6 }, { f: () => 2300 * m, q: 8, amp: 0.2 }],
      level: (u) => Math.min(1, u * 12) * Math.pow(1 - u, 1.1),
      flutter: { rate: 20, depth: 0.5 },
    });
    t.put(out, rattle, 0.02, 1);
    for (let k = 0, c = r.int(2, 5); k < c; k++) {
      t.put(out, bubble(t, r.range(200, 420) * t.p, r.range(0.008, 0.016), r.range(1.4, 2)), r.range(0.15, 0.6), r.range(0.06, 0.14));
    }
  } else {
    const len = t.j(0.55, 0.12);
    const sigh = vocal(t, len, {
      f0: (u) => pitch * (1.05 - 0.4 * u),
      voicing: (u) => 0.9 - 0.5 * u,
      tension: (u) => 0.55 - 0.35 * u,
      jitter: 0.05, shimmer: 0.3, breath: 0.35, rasp: 0.2,
      tract: [
        { f: (u) => lerp(700, 520, u) * m, q: 6, amp: 1 },
        { f: (u) => lerp(1100, 1300, u) * m, q: 8, amp: 0.5 },
        { f: () => 2450 * m, q: 11, amp: 0.18 },
      ],
      level: (u) => Math.min(1, u * 8) * (u < 0.9 ? Math.pow(1 - u * 0.6, 1.2) : ((1 - u) / 0.1) * 0.46),
    });
    t.put(out, sigh, 0.02, 1);
    // The glottis shutting: a small wet click.
    t.put(out, click(t.sr, r, 0.002, 400, 3500), 0.02 + len - 0.01, 0.15);
  }
  highpass(out, t.sr, 70, 2);
  return out;
}

/**
 * A body onto wet asphalt: the torso's heavy thud and the second of the
 * limbs and head, each with the wet slap the road gives back, cloth
 * rustling. Half the takes go down in two stages: the knees first, then
 * the rest.
 */
export function nightBodyFall(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(t.L(0.95));
  const knees = t.index % 2 === 1;
  const hits: [number, number, number][] = knees
    ? [[0, 0.55, 260], [t.j(0.22, 0.2), 1.0, 200], [t.j(0.36, 0.15), 0.45, 230]]
    : [[0, 1.0, 200], [t.j(0.15, 0.3), 0.55, 170]];
  if (!knees && r.chance(0.6)) hits.push([t.j(0.3, 0.2), 0.3, 230]);
  for (const [at, gain, cutoff] of hits) {
    t.put(out, burst(t, 0.3, 35, t.c(cutoff * t.p), 0.004, t.d(0.055), 4), at, t.g(gain));
    t.put(out, thump(t, 0.25, 115 * t.p, 45 * t.p, 0.004, t.d(0.045), 0.5), at, t.g(0.7 * gain));
    const slap = flicker(t, 0.08, 500, 3500, 250);
    decayInPlace(slap, t.sr, 0.001, 0.012);
    t.put(out, slap, at + 0.002, t.g(0.3 * gain));
  }
  const cloth = bandNoise(t.n(0.25), t.sr, r, 400, 3000, 2);
  adsr(cloth, t.sr, 0.02, 0.06, 0.3, 0.12);
  t.put(out, cloth, 0.01, t.g(0.15));
  return out;
}

/**
 * Feet dragging on asphalt: two or three steps, the bad leg dragged — each
 * a soft flat footfall and then the shoe scraped forward over the grit
 * (a band of friction noise catching and letting go, a few grains rolling
 * under it); the good leg only scuffs. The gait is uneven, and the last
 * step is always the bad leg, dragged to the end.
 */
export function nightShuffle(t: Take): Mono {
  const r = t.rng;
  const seconds = t.L(1.45);
  const out = t.canvas(seconds);
  const steps = r.int(2, 4);
  const first = r.range(0.01, 0.05);
  const last = seconds - r.range(0.47, 0.52);
  for (let k = 0; k < steps; k++) {
    const dragged = (steps - 1 - k) % 2 === 0;
    const at = k === 0 ? first : k === steps - 1 ? last : first + ((last - first) * k) / (steps - 1) * r.range(0.85, 1.15);
    const level = r.range(0.75, 1);
    footfall(out, t, at, level * 0.7);
    const len = dragged ? r.range(0.36, 0.42) : r.range(0.1, 0.16);
    const drag = scrape(t, len, r.range(1300, 2200) * t.p, r.range(70, 140));
    const from = at + (dragged ? 0.03 : 0.01);
    t.put(out, drag, from, level * (dragged ? 0.55 : 0.28));
    scatter(out, t, dragged ? r.int(6, 12) : r.int(2, 4), from, from + len, 2000, 8000, 0.12 * level, 1.1);
  }
  return out;
}

/**
 * Clawing at the barricade: a body thumping against the sandbags and
 * planks, then fingers and nails raking — across burlap, whose weave turns
 * the drag into a coarse buzzing rasp (a catch for every thread), or across
 * the planks in a squealing stick-slip — fibres picked loose, and sometimes
 * a second, weaker shove.
 */
export function nightClaw(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(t.L(0.8));
  const shove = (at: number, gain: number): void => {
    t.put(out, burst(t, 0.2, 35, 240, 0.003, t.d(0.045), 4), at, gain);
    t.put(out, knock(t, r.range(160, 220) * t.p, t.d(0.03), 1), at, gain * 0.45);
  };
  shove(0.01, t.g(0.8));
  let at = 0.01 + r.range(0.03, 0.08);
  for (let k = 0, rakes = r.int(2, 4); k < rakes; k++) {
    const len = r.range(0.14, 0.26);
    const wood = r.chance(0.35);
    const v0 = r.range(90, 160);
    const v1 = r.range(200, 320);
    const rake = wood
      ? creak(t, len, (u) => 300 + 500 * Math.sin(Math.PI * u), [[900, 6, 1], [2100, 7, 0.5], [3900, 8, 0.25]], 0.5)
      : creak(t, len, (u) => v0 + (v1 - v0) * Math.sin(Math.PI * Math.min(1, u * 1.3)), [[1300, 1.4, 1], [3200, 1.8, 0.7], [6500, 2, 0.35]], 0.8);
    adsr(rake, t.sr, len * 0.15, len * 0.3, 0.7, len * 0.3);
    t.put(out, rake, at, t.g(wood ? 0.35 : 0.5));
    scatter(out, t, r.int(4, 8), at, at + len, 2000, 8000, 0.12, 1.2);
    at += len * r.range(0.5, 0.9);
  }
  if (r.chance(0.6)) shove(r.range(0.4, 0.55), t.g(0.45));
  return out;
}

/**
 * A runner's lunge into the barricade: a hoarse bark of forced breath, half
 * voice and half air, and a tenth of a second later the impact — a heavy
 * body into sand and planks, the planks rattling in their frame, sand
 * shifting, and the breath knocked out of it.
 */
export function nightLunge(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(t.L(0.75));
  const m = t.cutoff;
  const pitch = r.range(150, 200) * t.p;
  const bark = vocal(t, t.j(0.17, 0.15), {
    f0: (u) => pitch * (1.15 - 0.35 * u),
    voicing: (u) => 0.55 - 0.3 * u,
    tension: () => 0.9,
    jitter: 0.08, shimmer: 0.35, breath: 0.5, rasp: 0.6,
    tract: [
      { f: (u) => lerp(780, 650, u) * m, q: 5, amp: 1 },
      { f: (u) => lerp(1350, 1200, u) * m, q: 6, amp: 0.6 },
      { f: () => 2500 * m, q: 9, amp: 0.3 },
      { f: () => 3500 * m, q: 10, amp: 0.12 },
    ],
    level: (u) => Math.min(1, u * 25) * Math.pow(1 - u, 0.8),
  });
  t.put(out, bark, 0.005, t.g(0.8));
  const hit = t.j(0.13, 0.2);
  t.put(out, burst(t, 0.3, 30, 280, 0.002, t.d(0.06), 4), hit, t.g(1.0));
  t.put(out, thump(t, 0.3, 105 * t.p, 40 * t.p, 0.002, t.d(0.06), 0.5), hit, t.g(0.75));
  t.put(out, knock(t, r.range(150, 210) * t.p, t.d(0.045), 1), hit, t.g(0.5));
  t.put(out, click(t.sr, r, 0.004, 500, 7000), hit, t.g(0.4));
  for (let k = 0; k < 2; k++) {
    t.put(out, knock(t, r.range(220, 320) * t.p, 0.02, 1), hit + 0.035 + k * r.range(0.03, 0.06), t.g(0.18));
  }
  t.put(out, sandTrickle(t, 0.35), hit + 0.02, t.g(0.12));
  const ugh = vocal(t, 0.16, {
    f0: () => pitch * 0.7,
    voicing: () => 0.25,
    tension: () => 0.8,
    jitter: 0.1, breath: 0.5,
    tract: [{ f: () => 600 * m, q: 4, amp: 1 }, { f: () => 1150 * m, q: 5, amp: 0.5 }],
    level: (u) => Math.min(1, u * 12) * Math.pow(1 - u, 1.5),
  });
  t.put(out, ugh, hit + 0.01, t.g(0.3));
  return out;
}

/**
 * A bloater bursting: its skin straining for an instant, then a muffled wet
 * rupture — a gut, not a balloon: a deep thump, a low-passed blast of air, a
 * thick wet tear — the gas hissing out through the tear and sputtering,
 * a few big bubbles gurgling as it empties, and what was inside it
 * pattering down onto the road and the sandbags, thinning out.
 */
export function nightBloatBurst(t: Take): Mono {
  const r = t.rng;
  const seconds = t.L(1.9);
  const out = t.canvas(seconds);
  const strain = creak(t, 0.07, (u) => 60 + 140 * u, [[220, 3, 1], [520, 4, 0.6]], 0.6);
  adsr(strain, t.sr, 0.03, 0.02, 0.8, 0.01);
  t.put(out, strain, 0.005, t.g(0.2));
  const at = 0.07;
  t.put(out, thump(t, 0.5, 95 * t.p, 32 * t.p, 0.002, t.d(0.08), 0.5), at, t.g(0.9));
  t.put(out, burst(t, 0.4, 40, t.c(650), 0.002, t.d(0.06), 4), at, t.g(1.0));
  const tear = flicker(t, 0.5, 250, t.c(2400), 120);
  adsr(tear, t.sr, 0.004, 0.08, 0.35, 0.25);
  decayInPlace(tear, t.sr, 0, t.d(0.12));
  t.put(out, tear, at + 0.002, t.g(0.7));
  const hissLen = t.j(0.9, 0.15);
  const n = t.n(hissLen);
  const gas = bandNoise(n, t.sr, r, 900, t.c(6500), 2);
  const sput = wobble(n, t.sr, 22, () => r.next());
  for (let i = 0; i < n; i++) gas[i]! *= 0.45 + 0.55 * Math.abs(sput[i]!);
  adsr(gas, t.sr, 0.03, 0.2, 0.5, hissLen * 0.5);
  decayInPlace(gas, t.sr, 0, 0.35);
  t.put(out, gas, at + 0.02, t.g(0.35));
  for (let k = 0, c = r.int(3, 6); k < c; k++) {
    t.put(out, bubble(t, r.range(140, 320) * t.p, r.range(0.02, 0.04), r.range(1.3, 1.8)), at + r.range(0.08, 0.5), r.range(0.12, 0.25));
  }
  const span = seconds - at - 0.4;
  for (let k = 0, c = r.int(22, 34); k < c; k++) {
    const when = at + 0.15 + Math.pow(r.next(), 1.6) * span;
    const size = r.range(0.3, 1) * (1 - (0.6 * (when - at)) / seconds);
    t.put(out, burst(t, 0.04, 350, 3500, 0.0005, r.range(0.004, 0.012)), when, 0.25 * size);
    if (r.chance(0.3)) t.put(out, bubble(t, r.range(600, 1400), r.range(0.005, 0.01), 1.5), when + 0.003, 0.1 * size);
  }
  return out;
}

/**
 * The Mechanic's roar, heard through a steel welding mask: a loud breath in
 * through the mask's slot, then a huge man's roar — pressed, rough, the
 * false folds growling under it, the mouth wide — muffled by the steel over
 * his face (the top gone) and ringing inside it: a short comb of the mask's
 * cavity and a few sharp resonances of the shell.
 */
export function nightMechRoar(t: Take): Mono {
  const r = t.rng;
  const len = t.j(2.2, 0.1);
  const out = t.canvas(len + 0.35);
  const pitch = r.range(72, 88) * t.p;
  const m = 0.9 * t.cutoff;
  const drift = wanderTrack(t.n(len), r, 4, t.sr);
  const inhale = vocal(t, 0.28, {
    f0: () => pitch,
    voicing: () => 0,
    tract: [{ f: (u) => lerp(500, 700, u), q: 4, amp: 1 }, { f: () => 1600, q: 5, amp: 0.5 }],
    level: (u) => Math.sin(Math.PI * u) ** 1.5,
  });
  t.put(out, inhale, 0, 0.2);
  const roar = vocal(t, len, {
    f0: (u) => pitch * (0.9 + 0.35 * Math.min(1, u * 4) - 0.3 * Math.max(0, u - 0.7)) * (1 + 0.06 * (2 * drift(u) - 1)),
    tension: (u) => 0.75 + 0.2 * Math.sin(Math.PI * u),
    jitter: 0.06, shimmer: 0.3, breath: 0.35, rasp: 0.55,
    tract: [
      { f: (u) => lerp(620, 760, u * 3) * m, q: 6, amp: 1 },
      { f: () => 1150 * m, q: 7, amp: 0.7 },
      { f: () => 2450 * m, q: 9, amp: 0.35 },
      { f: () => 3300 * m, q: 11, amp: 0.15 },
    ],
    level: (u) => Math.pow(Math.min(1, u * 5), 1.5) * (u < 0.8 ? 1 : Math.pow((1 - u) / 0.2, 1.3)),
    flutter: { rate: 9, depth: 0.2 },
  });
  t.put(out, roar, 0.22, 1);
  // Inside the mask: a feedback comb (the cavity), then the shell's own ringing modes.
  lowpass(out, t.sr, t.c(1900), 2);
  const d = t.n(r.range(0.0009, 0.0013));
  const fb = r.range(0.4, 0.5);
  for (let i = d; i < out.length; i++) out[i]! += fb * out[i - d]!;
  resonate(out, t.sr, r.range(600, 680) * t.p, 18, 0.9);
  resonate(out, t.sr, r.range(1400, 1550) * t.p, 24, 0.7);
  resonate(out, t.sr, r.range(2250, 2450) * t.p, 30, 0.4);
  highpass(out, t.sr, 60, 2);
  return out;
}

/**
 * The Mechanic's tyre iron: swung — a whoosh swelling as it comes down,
 * with the thin whistle of its hooked end — and striking the barricade: the
 * iron's own clang (a free bar's partials, 1 : 2.76 : 5.40 : 8.93), the
 * planks' knock and the sand's thud, grit jumping.
 */
export function nightSwing(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(t.L(0.9));
  const sw = t.j(0.3, 0.15);
  const n = t.n(sw + 0.04);
  const rise = (u: number): number => Math.sin(Math.PI * Math.min(1, u * 1.1));
  const air = white(n, r);
  svf(air, t.sr, "bp", (u) => (500 + 1300 * rise(u)) * t.p, 2.2, 16);
  normalize(air);
  const whistle = white(n, r);
  svf(whistle, t.sr, "bp", (u) => (500 + 1300 * rise(u)) * 1.9 * t.p, 14, 16);
  lowpass(whistle, t.sr, 4000, 2);
  normalize(whistle);
  for (let i = 0; i < n; i++) air[i] = air[i]! * 0.8 + whistle[i]! * 0.25;
  shapeBy(air, (u) => Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.05)), 2) * (0.3 + 0.7 * u));
  t.put(out, air, 0, t.g(0.45));
  const at = sw;
  t.put(out, click(t.sr, r, 0.004, 900, 12000), at, t.g(1.1));
  const f = r.range(650, 900) * t.p;
  for (const [k, a, tau] of [[1, 0.5, 0.13], [2.756, 0.35, 0.07], [5.404, 0.2, 0.04], [8.933, 0.1, 0.02]] as const) {
    addMode(out, t.sr, at, f * k * r.range(0.99, 1.01), a * r.sign(), t.d(tau), 0);
  }
  t.put(out, knock(t, r.range(150, 220) * t.p, t.d(0.04), 1), at, t.g(0.8));
  t.put(out, burst(t, 0.2, 35, 260, 0.002, t.d(0.05), 4), at, t.g(0.85));
  scatter(out, t, r.int(4, 8), at + 0.01, at + 0.25, 1500, 7000, 0.1, 1.4);
  return out;
}

/**
 * Something climbing out of the burned school bus: its weight on buckled
 * sheet steel — a low metallic groan and the pops of panels snapping
 * between shapes — safety glass crunching under a foot, and then a
 * two-footed thump down onto the road and a scuff.
 */
export function nightClimb(t: Take): Mono {
  const r = t.rng;
  const seconds = t.L(1.55);
  const out = t.canvas(seconds);
  const groanLen = r.range(0.55, 0.8);
  const walk = wanderTrack(t.n(groanLen), r, 5, t.sr);
  const metal = creak(t, groanLen, (u) => 35 + 70 * walk(u), [[300, 9, 1], [760, 12, 0.7], [1500, 14, 0.4], [2700, 16, 0.2]], 0.5);
  adsr(metal, t.sr, 0.1, 0.2, 0.7, 0.2);
  t.put(out, metal, 0.02, t.g(0.5));
  for (let k = 0, c = r.int(2, 4); k < c; k++) {
    const at = r.range(0.05, 0.75);
    const f = r.range(150, 320);
    t.put(out, click(t.sr, r, 0.003, 600, 8000), at, 0.4);
    addMode(out, t.sr, at, f, 0.5 * r.sign(), r.range(0.05, 0.09), 0);
    addMode(out, t.sr, at, f * r.range(1.6, 1.9), 0.3 * r.sign(), r.range(0.03, 0.06), 0);
    addMode(out, t.sr, at, f * r.range(3.1, 3.6), 0.15, r.range(0.015, 0.03), 0);
    t.put(out, burst(t, 0.05, 80, 600, 0.0008, 0.012, 2), at, 0.35);
  }
  for (let c = 0, count = r.int(1, 3); c < count; c++) {
    const at = r.range(0.15, 0.8);
    scatter(out, t, r.int(18, 30), at, at + r.range(0.06, 0.12), 2500, 10000, 0.3, 1.0);
    t.put(out, burst(t, 0.05, 400, 2600, 0.001, 0.01), at, 0.25);
    for (let k = 0; k < 2; k++) addShard(out, t, at + r.range(0, 0.1), r.range(3500, 8000), r.range(0.04, 0.1), r.range(0.008, 0.02));
  }
  const land = seconds - r.range(0.4, 0.5);
  t.put(out, burst(t, 0.25, 35, 260, 0.003, t.d(0.05), 4), land, t.g(0.9));
  t.put(out, thump(t, 0.2, 110 * t.p, 48 * t.p, 0.003, 0.04, 0.5), land, t.g(0.6));
  footfall(out, t, land + r.range(0.04, 0.09), t.g(0.5), 1.8);
  t.put(out, scrape(t, 0.2, 1800, 110), land + 0.06, t.g(0.2));
  scatter(out, t, r.int(4, 8), land, land + 0.25, 2000, 8000, 0.1, 1.3);
  return out;
}

/**
 * A body going over a split-rail fence: the rail creaking under its weight
 * (dry, then wet wood: a slow stick-slip), hands and knees knocking the
 * rail, cloth dragging over it, and a heavy thud onto the wet grass — grass
 * gives no slap, only a swish — and a second, lighter one.
 */
export function nightVault(t: Take): Mono {
  const r = t.rng;
  const seconds = t.L(1.0);
  const out = t.canvas(seconds);
  const creakLen = r.range(0.3, 0.42);
  const load = r.range(0.9, 1.1);
  const rail = creak(t, creakLen, (u) => (50 + 70 * Math.sin(Math.PI * u)) * load, [[240, 4, 1], [600, 5, 0.7], [1300, 6, 0.35]], 0.45);
  adsr(rail, t.sr, 0.05, 0.1, 0.7, 0.1);
  t.put(out, rail, 0.02, t.g(0.6));
  t.put(out, knock(t, r.range(260, 340) * t.p, 0.025, 1), 0.02, t.g(0.45));
  t.put(out, knock(t, r.range(230, 300) * t.p, 0.02, 1), 0.02 + r.range(0.1, 0.2), t.g(0.3));
  const cloth = bandNoise(t.n(0.25), t.sr, r, 500, 3500, 2);
  adsr(cloth, t.sr, 0.04, 0.08, 0.4, 0.1);
  t.put(out, cloth, 0.08, t.g(0.15));
  const land = 0.02 + creakLen + r.range(0.08, 0.16);
  t.put(out, burst(t, 0.3, 30, 200, 0.004, t.d(0.06), 4), land, t.g(1.0));
  t.put(out, thump(t, 0.25, 90 * t.p, 40 * t.p, 0.004, t.d(0.05), 0.5), land, t.g(0.7));
  const grass = bandNoise(t.n(0.15), t.sr, r, 1500, 6000, 2);
  decayInPlace(grass, t.sr, 0.004, 0.04);
  t.put(out, grass, land, t.g(0.2));
  t.put(out, burst(t, 0.2, 35, 220, 0.004, 0.035, 4), land + r.range(0.1, 0.18), t.g(0.45));
  return out;
}

/**
 * Something pushing through tall dry corn: two to four surges as it
 * shoulders forward, each the long leaves rasping and crackling against it
 * and each other, the stalks bending with a hollow creak, and now and then
 * one snapping.
 */
export function nightCornRustle(t: Take): Mono {
  const r = t.rng;
  const seconds = t.L(1.45);
  const out = t.canvas(seconds);
  const surges = r.int(2, 5);
  const bumps: [number, number, number][] = [];
  for (let k = 0; k < surges; k++) {
    const c = 0.15 + (0.65 * (k + r.range(0.2, 0.8))) / surges;
    bumps.push([c, r.range(0.08, 0.14), r.range(0.6, 1)]);
  }
  const envelope = (u: number): number => {
    let e = 0;
    for (const [c, w, a] of bumps) e += a * Math.exp(-(((u - c) / w) ** 2));
    return Math.min(1, e) * Math.min(1, u * 20) * Math.min(1, (1 - u) * 12);
  };
  const rasp = leafRasp(t, seconds, r.range(50, 80));
  shapeBy(rasp, envelope, 32);
  t.put(out, rasp, 0, t.g(0.6));
  const hush = bandNoise(t.n(seconds), t.sr, r, 700, 2600, 2);
  shapeBy(hush, envelope, 64);
  t.put(out, hush, 0, t.g(0.15));
  for (const [c, w, a] of bumps) {
    const at = c * seconds;
    scatter(out, t, r.int(8, 16), Math.max(0, at - w * seconds), at + w * seconds, 2000, 9000, 0.2 * a, 1.0);
    const bend = creak(t, r.range(0.15, 0.25), (u) => 25 + 35 * Math.sin(Math.PI * u), [[500, 4, 1], [1200, 5, 0.6], [2600, 6, 0.3]], 0.6);
    adsr(bend, t.sr, 0.04, 0.05, 0.7, 0.05);
    t.put(out, bend, Math.max(0, at - 0.05), 0.2 * a);
  }
  if (r.chance(0.35)) {
    const at = r.range(0.3, 0.8) * seconds;
    t.put(out, click(t.sr, r, 0.003, 900, 11000), at, 0.4);
    t.put(out, knock(t, r.range(600, 850), 0.008, 1), at, 0.3);
  }
  return lowpass(out, t.sr, t.c(9000), 2);
}
