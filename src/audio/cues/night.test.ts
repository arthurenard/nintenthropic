/**
 * Dead of Night's sounds, as the game asks for them. Every cue is also
 * rendered and checked take by take by ../sounds.test.ts (length, level,
 * clipping, seams, takes that differ); this checks the pack itself: that it
 * has everything the game plays, loops what the game loops, mixes the rifle
 * over everything and the beds under everything, and costs no more to
 * synthesise than High Noon's pack does.
 */
import { describe, expect, it } from "vitest";
import { renderTake, takeCount } from "../render";
import { CUES, type Pack, cuesInPack } from "./table";

/** Every cue Dead of Night plays (src/games/night). */
const WANTED = [
  // the rifle
  "night_rifle", "night_lever", "night_dry", "night_round_in", "night_click",
  // bullets landing
  "night_hit", "night_headshot", "night_hit_metal", "night_hit_wood", "night_hit_ground", "night_hit_glass",
  "night_hit_corn", "night_hit_water", "night_hit_sandbag", "night_mask_clang", "night_ricochet",
  // the dead
  "night_groan", "night_snarl", "night_dead_fall", "night_body_fall", "night_shuffle", "night_claw", "night_lunge",
  "night_bloat_burst", "night_mech_roar", "night_swing", "night_climb", "night_vault", "night_corn_rustle",
  // the player
  "night_hurt", "night_death",
  // the night
  "night_crickets", "night_wind", "night_buzz", "night_hum", "night_projector", "night_ballad",
  // world events and secrets
  "night_flicker", "night_dog", "night_owl", "night_bell", "night_survivor_daughter", "night_survivor_owner",
  "night_jar_break", "night_neon", "night_phone_ring", "night_howl", "night_hiss", "night_squeak", "night_scarecrow",
  // stingers and the interface
  "night_wave_start", "night_wave_clear", "night_boss", "night_game_over", "night_secret", "night_streak", "night_golden",
];

/** The ambient beds: always there, so always under the action. */
const BEDS = ["night_crickets", "night_wind", "night_buzz", "night_hum", "night_projector"];
/** What the game loops: the beds and the radio. */
const LOOPS = [...BEDS, "night_ballad"];

describe("the night pack", () => {
  it("has every sound Dead of Night asks for, all in the night pack, and nothing else", () => {
    for (const cue of WANTED) {
      expect(CUES[cue], cue).toBeDefined();
      expect(CUES[cue]!.pack, cue).toBe("night");
    }
    expect(cuesInPack("night").sort()).toEqual([...WANTED].sort());
  });

  it("marks the loops the game loops, and nothing else", () => {
    for (const cue of WANTED) expect(!!CUES[cue]!.loop, cue).toBe(LOOPS.includes(cue));
  });

  it("mixes the player's rifle over everything else in the night", () => {
    const rifle = CUES.night_rifle!.level;
    for (const cue of WANTED) if (cue !== "night_rifle") expect(CUES[cue]!.level, cue).toBeLessThan(rifle);
  });

  it("keeps the beds under −14 dB", () => {
    for (const cue of BEDS) expect(CUES[cue]!.level, cue).toBeLessThan(-14);
  });

  it("gives the sounds heard many times in a row more takes", () => {
    expect(takeCount("night_groan")).toBeGreaterThanOrEqual(6);
    expect(takeCount("night_round_in")).toBeGreaterThanOrEqual(5);
    expect(takeCount("night_rifle")).toBeGreaterThanOrEqual(4);
  });

  it("costs no more to synthesise than the western pack", () => {
    // CPU time of this process (Vitest runs each test file in its own), so
    // the other test files working alongside do not count against either
    // pack; wall-clock time where there is no process to ask.
    const proc = (globalThis as { process?: { cpuUsage(): { user: number; system: number } } }).process;
    const now = (): number => {
      if (!proc) return performance.now();
      const u = proc.cpuUsage();
      return (u.user + u.system) / 1000;
    };
    const cost = (pack: Pack): number => {
      const start = now();
      for (const cue of cuesInPack(pack)) {
        for (let k = 0; k < takeCount(cue); k++) renderTake(cue, k, { sampleRate: 48000, seed: 1 });
      }
      return now() - start;
    };
    // Warm both up (the first render of anything pays for compiling it),
    // then measure each pack in alternating rounds and keep its fastest.
    for (const pack of ["western", "night"] as const) {
      for (const cue of cuesInPack(pack)) renderTake(cue, 0, { sampleRate: 48000, seed: 7 });
    }
    const western: number[] = [];
    const night: number[] = [];
    for (let round = 0; round < 3; round++) {
      if (round % 2 === 0) {
        western.push(cost("western"));
        night.push(cost("night"));
      } else {
        night.push(cost("night"));
        western.push(cost("western"));
      }
    }
    const w = Math.min(...western);
    const n = Math.min(...night);
    expect(n, `night ${n.toFixed(0)} ms against western ${w.toFixed(0)} ms`).toBeLessThanOrEqual(w * 1.1);
  }, 600_000);
});
