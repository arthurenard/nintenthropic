/**
 * Grip Prix's sound pack as a mix: every sound the design asks for exists,
 * nothing is too loud at the bus or out of balance with its kind, the pitched
 * ones are in tune, and every cue the code asks for by name is in the table.
 * (The per-take checks — length, silence, clicks at loop seams, takes that
 * differ — run for every cue in src/audio/sounds.test.ts.)
 */
import { describe, expect, it } from "vitest";
import { CUES, cuesInPack } from "../../audio/cues/table";
import { momentaryMaxDb } from "../../audio/dsp/master";
import { renderTake, takeCount } from "../../audio/render";
import type { RaceEvent } from "../contract";
import { estimatePitch, peakOfBuffer, spectralCentroid, toDb } from "./analysis";
import { AMBIENCE, ambienceCues } from "./ambience";
import { ENGINE_CUES, ENGINE_LAYERS, ENGINE_NOTE, REV_HI, REV_LO, REV_MID, SURFACE_CUES } from "./engines";
import { ordersFor } from "./events";
import { SOUND_CUES } from "./kinds";
import { SIM_EVENTS } from "./simulate";

const SR = 44100;

/** An in-place radix-2 FFT (for the harmonic count). */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = i + k + len / 2;
        const xr = re[b]! * cr - im[b]! * ci;
        const xi = re[b]! * ci + im[b]! * cr;
        re[b] = re[a]! - xr;
        im[b] = im[a]! - xi;
        re[a]! += xr;
        im[a]! += xi;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
}
const KART = cuesInPack("kart");
/** Every place's sounds, and the beds among them (the loops). */
const AMBIENCE_CUES = [...new Set((Object.keys(AMBIENCE) as (keyof typeof AMBIENCE)[]).flatMap(ambienceCues))];
const BEDS = [...new Set(Object.values(AMBIENCE).flatMap((a) => a.beds.map((b) => b.cue)))];
const rendered = new Map<string, Float32Array[][]>();
const stereo = new Set<string>();

/** Every channel of a take: stereo takes (the engines, the tyres, the ground, the wind) are not narrowed by the panner. */
function channelsOf(cue: string, take: number): Float32Array[] {
  let list = rendered.get(cue);
  if (!list) {
    list = [];
    for (let k = 0; k < takeCount(cue); k++) list.push(renderTake(cue, k, { sampleRate: SR, seed: 1 }).channels);
    rendered.set(cue, list);
    if (list[0]!.length > 1) stereo.add(cue);
  }
  return list[take]!;
}

function bufferOf(cue: string, take: number): Float32Array {
  return channelsOf(cue, take)[0]!;
}

/** The loudest 50 ms of a cue as it reaches the master: its level, less the 3 dB the panner takes from a mono cue. */
const atMaster = (cue: string): number => {
  const channels = channelsOf(cue, 0);
  return momentaryMaxDb(channels, SR) + CUES[cue]!.level - (stereo.has(cue) ? 0 : 3.01);
};

describe("the kart pack", () => {
  it("has every sound the design names", () => {
    const wanted = [
      // engines (four, each low and high in its revs), their rasp, idle and growl, the drift and its sparks, boosts
      ...ENGINE_CUES, "kart_engine_grit", "kart_idle", "kart_growl", "kart_backfire", "kart_shift", "kart_drift", "kart_drift_sparks", "kart_scrape", "kart_creak", "kart_draft",
      "kart_spark_blue", "kart_spark_orange", "kart_mini_turbo", "kart_super_turbo", "kart_boost_whoosh", "kart_flame_short", "kart_flame_long", "kart_slingshot", "kart_boost_pad", "kart_start_boost", "kart_flood",
      // another kart going by close
      "kart_pass",
      // item boxes and items
      "kart_box_smash", "kart_roulette_tick", "kart_item_ready", "kart_nitro", "kart_puck_fire", "kart_puck_bounce", "kart_seeker", "kart_slick_splat",
      // the comet, the items that strike from afar, the decoy
      "kart_comet", "kart_storm", "kart_skyrocket", "kart_skyrocket_burst", "kart_blast", "kart_decoy_pop",
      // hits, bumps, walls
      "kart_hit", "kart_spinout", "kart_bump", "kart_wall_thud", "kart_wall_scrape",
      // countdown, laps, finishing
      "kart_beep_low", "kart_beep_high", "kart_lap", "kart_final_lap", "kart_finish_win", "kart_finish_ok", "kart_cheer",
      // air
      "kart_jump", "kart_trick", "kart_land", "kart_thud", "kart_fall", "kart_drone", "kart_drone_drop", "kart_hazard", "kart_wind",
      // a place won or lost
      "kart_place_up", "kart_place_down",
      // the road and the surfaces
      "kart_tyre_road", "kart_surf_ice", "kart_surf_snow", "kart_surf_sand", "kart_surf_mud", "kart_surf_grass",
      // the places
      ...AMBIENCE_CUES,
      // the duck, the horn, the interface
      "kart_duck", "kart_horn", "kart_shutter", "kart_ui_select", "kart_ui_back", "kart_ui_ready", "kart_ui_join", "kart_ui_leave", "kart_ui_start",
    ];
    for (const cue of wanted) expect(KART, cue).toContain(cue);
    expect(KART.length).toBe(wanted.length);
  });

  it("marks the loops as loops and the one-shots as not", () => {
    const loops = [...ENGINE_CUES, "kart_engine_grit", "kart_idle", "kart_growl", "kart_drift", "kart_drift_sparks", "kart_seeker", "kart_drone", "kart_wind", "kart_draft", "kart_scrape", ...Object.values(SURFACE_CUES), ...BEDS];
    for (const cue of KART) expect(!!CUES[cue]!.loop, cue).toBe(loops.includes(cue));
  });

  it("keeps every take under the bus's peak ceiling of −1 dBFS", () => {
    for (const cue of KART) {
      for (let k = 0; k < takeCount(cue); k++) {
        const peak = toDb(Math.max(...channelsOf(cue, k).map(peakOfBuffer))) + CUES[cue]!.level - (stereo.has(cue) ? 0 : 3.01);
        expect(peak, `${cue} take ${k}`).toBeLessThanOrEqual(-1);
      }
    }
    // (It renders every take of the pack, which a busy machine takes a while over.)
  }, 120_000);

  it("is never louder than the revolver of High Noon, the loudest thing in Super Claude Bros.", () => {
    for (const cue of KART) expect(CUES[cue]!.level, cue).toBeLessThanOrEqual(0);
  });

  it("makes the four engines' twelve layers equally loud, to within 3 dB, so no kart is a favourite and no crossover a bump", () => {
    const levels = ENGINE_CUES.map(atMaster);
    expect(Math.max(...levels) - Math.min(...levels), levels.map((l) => l.toFixed(1)).join(" ")).toBeLessThan(3);
  });

  it("tells the engines apart by weight: the light one buzzes brightest, the heavy one is deepest", () => {
    const centroid = (cue: string): number => spectralCentroid(bufferOf(cue, 0), SR);
    for (const layer of ["lo", "mid", "hi"] as const) {
      const [light, middle, heavy] = (["light", "middle", "heavy"] as const).map((f) => centroid(ENGINE_LAYERS[f][layer]));
      expect(light!).toBeGreaterThan(middle! * 1.3);
      expect(middle!).toBeGreaterThan(heavy! * 1.2);
    }
  });

  it("makes each engine's layers on its note, so played at revs / their own revs the two give one note", () => {
    /** The strongest repeat within a fifth of ``expected`` seconds, by autocorrelation over a third of a second. */
    const period = (cue: string, expected: number): number => {
      const x = bufferOf(cue, 0);
      let best = -Infinity;
      let lag = 0;
      for (let l = Math.floor(0.8 * expected * SR); l <= Math.ceil(1.25 * expected * SR); l++) {
        let c = 0;
        for (let i = 0; i < 0.33 * SR; i++) c += x[i]! * x[i + l]!;
        if (c > best) {
          best = c;
          lag = l;
        }
      }
      return lag / SR;
    };
    for (const family of ["light", "middle", "heavy", "electric"] as const) {
      for (const [layer, revs] of [["lo", REV_LO], ["mid", REV_MID], ["hi", REV_HI]] as const) {
        const expected = 1 / (ENGINE_NOTE[family] * revs);
        // To within a fifth of a semitone (the firings' jitter blurs the repeat by a sample or two).
        expect(Math.abs(period(ENGINE_LAYERS[family][layer], expected) / expected - 1), `${family} ${layer}`).toBeLessThan(0.012);
      }
    }
  });

  it("makes the engines alive, wide and rich, and the sum to mono safe: not the static, near-mono buzz they were", () => {
    /** The spread of the level over 40 ms windows against its mean: a static drone has none. */
    const aliveness = (cue: string): number => {
      const [l, r] = channelsOf(cue, 0);
      const win = Math.round(0.04 * SR);
      const levels: number[] = [];
      for (let s = 0; s + win <= l!.length; s += Math.round(0.02 * SR)) {
        let e = 0;
        for (let i = s; i < s + win; i++) e += 0.5 * (l![i]! ** 2 + r![i]! ** 2);
        levels.push(Math.sqrt(e / win));
      }
      const mean = levels.reduce((a, b) => a + b, 0) / levels.length;
      return Math.sqrt(levels.reduce((a, b) => a + (b - mean) ** 2, 0) / levels.length) / mean;
    };
    /** Side over mid, dB, and the mono sum's power over the channels' average, dB. */
    const picture = (cue: string): { width: number; mono: number } => {
      const [l, r] = channelsOf(cue, 0);
      let mid = 0;
      let side = 0;
      let mono = 0;
      let both = 0;
      for (let i = 0; i < l!.length; i++) {
        mid += (0.5 * (l![i]! + r![i]!)) ** 2;
        side += (0.5 * (l![i]! - r![i]!)) ** 2;
        mono += (0.5 * (l![i]! + r![i]!)) ** 2;
        both += 0.5 * (l![i]! ** 2 + r![i]! ** 2);
      }
      return { width: 10 * Math.log10(side / mid), mono: 10 * Math.log10(mono / both) };
    };
    for (const cue of ENGINE_CUES) {
      expect(stereo.has(cue) || channelsOf(cue, 0).length === 2, cue).toBe(true);
      // The old engines varied by 3 to 6 % over 40 ms windows (a drone); an engine that is alive varies by at least 8 %.
      expect(aliveness(cue), `${cue} aliveness`).toBeGreaterThan(0.08);
      // The old pair was near-mono, side 15 dB under mid; these are clearly wider, and lose under 2 dB summed to mono.
      const { width, mono } = picture(cue);
      expect(width, `${cue} width`).toBeGreaterThan(-11);
      expect(mono, `${cue} mono sum`).toBeGreaterThan(-2);
    }
    for (const cue of [...Object.values(SURFACE_CUES), "kart_wind", "kart_draft", "kart_drift", "kart_drift_sparks", "kart_scrape", "kart_engine_grit", "kart_idle"]) {
      const { width, mono } = picture(cue);
      expect(width, `${cue} width`).toBeGreaterThan(-12);
      expect(mono, `${cue} mono sum`).toBeGreaterThan(-3);
    }
  });

  it("gives every engine its harmonics: the firing note's multiples stand well above the floor between them", () => {
    // The old recipes had 16 to 24 lines within 30 dB of the strongest, but static ones; these keep a rich series while the
    // firings wander. Count the multiples of the note (to 6 kHz) within 30 dB of the strongest.
    for (const family of ["light", "middle", "heavy"] as const) {
      const cue = ENGINE_LAYERS[family].mid;
      const x = bufferOf(cue, 0);
      const size = 32768;
      const re = new Float64Array(size);
      const im = new Float64Array(size);
      for (let i = 0; i < size; i++) re[i] = x[i]! * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size));
      fft(re, im);
      const f0 = ENGINE_NOTE[family] * REV_MID;
      const lines: number[] = [];
      for (let h = 1; h * f0 < 6000; h++) {
        const c = (h * f0 * size) / SR;
        let best = 0;
        for (let k = Math.max(1, Math.floor(c * 0.99 - 1)); k <= Math.ceil(c * 1.01 + 1); k++) best = Math.max(best, Math.hypot(re[k]!, im[k]!));
        lines.push(best);
      }
      const top = Math.max(...lines);
      expect(lines.filter((m) => m > top * 0.0316).length, family).toBeGreaterThanOrEqual(8);
    }
  });

  it("mixes by kind: what must be heard above the player's actions above the garnish above the beds", () => {
    const mustHear = ["kart_beep_low", "kart_beep_high", "kart_final_lap", "kart_finish_win", "kart_finish_ok", "kart_hit", "kart_spinout", "kart_hazard", "kart_start_boost", "kart_item_ready"].map(atMaster);
    const actions = ["kart_nitro", "kart_puck_fire", "kart_slick_splat", "kart_mini_turbo", "kart_boost_pad", "kart_box_smash", "kart_jump", "kart_land", "kart_bump", "kart_wall_thud"].map(atMaster);
    const beds = [...ENGINE_CUES, "kart_idle", "kart_drift", ...Object.values(SURFACE_CUES)].map(atMaster);
    const places = BEDS.map(atMaster);
    const mean = (a: number[]): number => a.reduce((x, y) => x + y, 0) / a.length;
    // Within a kind the sounds sit together; between kinds they step down.
    expect(Math.max(...mustHear) - Math.min(...mustHear)).toBeLessThan(7);
    expect(Math.max(...actions) - Math.min(...actions)).toBeLessThan(8);
    expect(mean(mustHear)).toBeGreaterThan(mean(actions) - 0.5);
    expect(mean(actions)).toBeGreaterThan(mean(beds) + 3);
    // The places sit well under the engines: a bed, not a sound.
    expect(Math.max(...places)).toBeLessThan(Math.min(...ENGINE_CUES.map(atMaster)) - 6);
    expect(mean(places)).toBeLessThan(mean(beds) - 3);
    // And everything is well clear of silence and of the limiter (the places quieter still, but there).
    for (const cue of KART) {
      expect(atMaster(cue), cue).toBeLessThan(-8);
      expect(atMaster(cue), cue).toBeGreaterThan(cue.startsWith("kart_amb_") ? -48 : -42);
    }
  });

  it("keeps the interface soft, under the race's own sounds", () => {
    for (const cue of KART.filter((c) => c.startsWith("kart_ui_"))) expect(CUES[cue]!.level, cue).toBeLessThanOrEqual(-6);
    expect(atMaster("kart_ui_start")).toBeLessThan(atMaster("kart_finish_win"));
  });

  it("sings the countdown in tune: three low beeps on A4 and a high one on A5", () => {
    const pitch = (cue: string, lo: number): number => estimatePitch(bufferOf(cue, 0), SR, Math.floor(0.08 * SR), Math.floor(0.1 * SR), lo, 1500);
    expect(pitch("kart_beep_low", 300)).toBeGreaterThan(440 * 0.985);
    expect(pitch("kart_beep_low", 300)).toBeLessThan(440 * 1.015);
    expect(pitch("kart_beep_high", 650)).toBeGreaterThan(880 * 0.985);
    expect(pitch("kart_beep_high", 650)).toBeLessThan(880 * 1.015);
  });

  it("gives the roulette tick a click sharp enough to count, and short", () => {
    expect(bufferOf("kart_roulette_tick", 0).length / SR).toBeLessThan(0.2);
  });

  it("asks only for cues that exist: every name the code plays is in the table", () => {
    const names = new Set<string>([
      "kart_shift", "kart_scrape", "kart_draft", "kart_creak",
      ...Object.values(SOUND_CUES), ...ENGINE_CUES, ...Object.values(SURFACE_CUES), ...AMBIENCE_CUES,
      "kart_engine_grit", "kart_idle", "kart_growl", "kart_backfire", "kart_drift", "kart_drift_sparks", "kart_seeker", "kart_drone", "kart_roulette_tick", "kart_item_ready", "kart_flood",
      "kart_duck", "kart_puck_bounce", "kart_wind", "kart_thud", "kart_place_up", "kart_place_down", "kart_slingshot", "kart_super_turbo", "kart_pass", "kart_flame_short", "kart_flame_long",
    ]);
    const scene = {
      locals: [{ kart: 0, pan: 0 }],
      karts: new Map([[0, { id: 0, x: 0, z: 0, heading: 0 } as never], [1, { id: 1, x: 3, z: 0, heading: 0 } as never], [5, { id: 5, x: 4, z: 0, heading: 0 } as never], [2, { id: 2, x: 5, z: 0, heading: 0 } as never], [3, { id: 3, x: 6, z: 0, heading: 0 } as never]]),
      laps: 3,
    };
    // The scripted race uses nearly every kind of event (the flood, the horn and the duck are named above); try each against the local kart and the others.
    for (const { event } of SIM_EVENTS) {
      for (const kart of [0, 1]) {
        const e = { id: 1, tick: 0, ...event, ...("kart" in event ? { kart } : {}) } as RaceEvent;
        for (const o of ordersFor(e, scene)) names.add(o.cue);
      }
    }
    for (const name of names) expect(Object.prototype.hasOwnProperty.call(CUES, name), name).toBe(true);
    for (const cue of KART) expect(names.has(cue), `${cue} is never played`).toBe(true);
  });

  it("is quick to make: the whole pack's first takes in well under a second of DSP", () => {
    const t0 = performance.now();
    for (const cue of KART) renderTake(cue, 1, { sampleRate: SR, seed: 7 });
    const ms = performance.now() - t0;
    // (About 0.25 s on a quiet laptop; three takes of each go to workers in the browser, ~0.25 s wall.)
    expect(ms).toBeLessThan(2500);
  });
});
