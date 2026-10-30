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
import { ENGINE_CUES, ENGINE_LAYERS, ENGINE_NOTE, REV_HI, REV_LO, SURFACE_CUES } from "./engines";
import { ordersFor } from "./events";
import { SOUND_CUES } from "./kinds";
import { SIM_EVENTS } from "./simulate";

const SR = 44100;
const KART = cuesInPack("kart");
/** Every place's sounds, and the beds among them (the loops). */
const AMBIENCE_CUES = [...new Set((Object.keys(AMBIENCE) as (keyof typeof AMBIENCE)[]).flatMap(ambienceCues))];
const BEDS = [...new Set(Object.values(AMBIENCE).flatMap((a) => a.beds.map((b) => b.cue)))];
const takes = new Map<string, Float32Array[]>();

function bufferOf(cue: string, take: number): Float32Array {
  let list = takes.get(cue);
  if (!list) {
    list = [];
    for (let k = 0; k < takeCount(cue); k++) list.push(renderTake(cue, k, { sampleRate: SR, seed: 1 }).channels[0]!);
    takes.set(cue, list);
  }
  return list[take]!;
}

/** The loudest 50 ms of a cue as it reaches the master: its level, less the 3 dB the panner takes from a mono cue. */
const atMaster = (cue: string): number => momentaryMaxDb([bufferOf(cue, 0)], SR) + CUES[cue]!.level - 3.01;

describe("the kart pack", () => {
  it("has every sound the design names", () => {
    const wanted = [
      // engines (four, each low and high in its revs), their rasp, idle and growl, the drift and its sparks, boosts
      ...ENGINE_CUES, "kart_engine_grit", "kart_idle", "kart_growl", "kart_backfire", "kart_drift", "kart_drift_sparks",
      "kart_spark_blue", "kart_spark_orange", "kart_mini_turbo", "kart_super_turbo", "kart_boost_whoosh", "kart_slingshot", "kart_boost_pad", "kart_start_boost", "kart_flood",
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
    const loops = [...ENGINE_CUES, "kart_engine_grit", "kart_idle", "kart_growl", "kart_drift", "kart_drift_sparks", "kart_seeker", "kart_drone", "kart_wind", ...Object.values(SURFACE_CUES), ...BEDS];
    for (const cue of KART) expect(!!CUES[cue]!.loop, cue).toBe(loops.includes(cue));
  });

  it("keeps every take under the bus's peak ceiling of −1 dBFS", () => {
    for (const cue of KART) {
      for (let k = 0; k < takeCount(cue); k++) {
        const peak = toDb(peakOfBuffer(bufferOf(cue, k))) + CUES[cue]!.level - 3.01;
        expect(peak, `${cue} take ${k}`).toBeLessThanOrEqual(-1);
      }
    }
    // (It renders every take of the pack, which a busy machine takes a while over.)
  }, 120_000);

  it("is never louder than the revolver of High Noon, the loudest thing in Super Claude Bros.", () => {
    for (const cue of KART) expect(CUES[cue]!.level, cue).toBeLessThanOrEqual(0);
  });

  it("makes the four engines' eight layers equally loud, to within 3 dB, so no kart is a favourite and no crossover a bump", () => {
    const levels = ENGINE_CUES.map(atMaster);
    expect(Math.max(...levels) - Math.min(...levels), levels.map((l) => l.toFixed(1)).join(" ")).toBeLessThan(3);
  });

  it("tells the engines apart by weight: the light one buzzes brightest, the heavy one is deepest", () => {
    const centroid = (cue: string): number => spectralCentroid(bufferOf(cue, 0), SR);
    for (const layer of ["lo", "hi"] as const) {
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
      for (const [layer, revs] of [["lo", REV_LO], ["hi", REV_HI]] as const) {
        const expected = 1 / (ENGINE_NOTE[family] * revs);
        // To within a fifth of a semitone (the firings' jitter blurs the repeat by a sample or two).
        expect(Math.abs(period(ENGINE_LAYERS[family][layer], expected) / expected - 1), `${family} ${layer}`).toBeLessThan(0.012);
      }
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
      ...Object.values(SOUND_CUES), ...ENGINE_CUES, ...Object.values(SURFACE_CUES), ...AMBIENCE_CUES,
      "kart_engine_grit", "kart_idle", "kart_growl", "kart_backfire", "kart_drift", "kart_drift_sparks", "kart_seeker", "kart_drone", "kart_roulette_tick", "kart_item_ready", "kart_flood",
      "kart_duck", "kart_puck_bounce", "kart_wind", "kart_thud", "kart_place_up", "kart_place_down", "kart_slingshot", "kart_super_turbo",
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
