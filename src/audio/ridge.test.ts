/**
 * Overwatch Ridge's pack, as a table: every cue belongs to it, the ones that
 * happen across the valley arrive late, the ones in the player's hands and
 * head never do, and the rifle is the loudest thing in it. (Every take of
 * every cue is rendered and checked with the rest of the library in
 * sounds.test.ts.)
 */
import { describe, expect, it } from "vitest";
import { RIDGE_CUES } from "./cues/ridge";
import { CUES, cuesInPack } from "./cues/table";

const NAMES = Object.keys(RIDGE_CUES);

/** Heard from where they happen, hundreds of metres off: delayed by distance / 343 m/s. */
const FAR = [
  "ridge_hit_dirt", "ridge_hit_rock", "ridge_hit_metal", "ridge_hit_glass", "ridge_hit_water", "ridge_hit_wood",
  "ridge_hit_flesh", "ridge_body_fall", "ridge_glass_shatter", "ridge_far_shot", "ridge_mg_burst", "ridge_mortar_launch",
  "ridge_cowbell", "ridge_dog", "ridge_church_bell", "ridge_siren", "ridge_goat", "ridge_cow_moo", "ridge_sheep",
  "ridge_eagle", "ridge_duck_squeak", "ridge_steam", "ridge_whistle_alarm", "ridge_cheese_roll", "ridge_yeti",
  "ridge_plate_ring",
];

/** At the player (or timed by the game): never delayed. */
const HERE = [
  "ridge_rifle_shot", "ridge_bolt", "ridge_reload", "ridge_dry", "ridge_scope_in", "ridge_scope_out", "ridge_breath",
  "ridge_crack_near", "ridge_mortar_whistle", "ridge_mortar_blast", "ridge_hurt", "ridge_scope_crack", "ridge_death",
  "ridge_echo", "ridge_stage_start", "ridge_stage_clear", "ridge_secret", "ridge_streak", "ridge_kill", "ridge_game_over",
  "ridge_golden",
];

const LOOPS = ["ridge_breath", "ridge_wind_grass", "ridge_river", "ridge_birds", "ridge_truck"];

describe("the ridge pack", () => {
  it("is in the cue table, all of it in pack \"ridge\", and nothing else is", () => {
    for (const cue of NAMES) {
      expect(CUES[cue], cue).toBe(RIDGE_CUES[cue]);
      expect(RIDGE_CUES[cue]!.pack, cue).toBe("ridge");
    }
    expect(cuesInPack("ridge").sort()).toEqual([...NAMES].sort());
  });

  it("delays what happens across the valley, and nothing at the player", () => {
    for (const cue of FAR) expect(RIDGE_CUES[cue]?.travel, cue).toBe(true);
    for (const cue of [...HERE, ...LOOPS]) expect(RIDGE_CUES[cue]?.travel ?? false, cue).toBe(false);
    // Every cue is one or the other: a new one has to say which.
    expect(new Set([...FAR, ...HERE, ...LOOPS])).toEqual(new Set(NAMES));
  });

  it("loops the beds and the breath, and nothing else", () => {
    for (const cue of NAMES) expect(RIDGE_CUES[cue]!.loop ?? false, cue).toBe(LOOPS.includes(cue));
  });

  it("makes the rifle the loudest thing in the valley, its roll its own (no engine echo)", () => {
    const rifle = RIDGE_CUES.ridge_rifle_shot!;
    for (const cue of NAMES) if (cue !== "ridge_rifle_shot") expect(RIDGE_CUES[cue]!.level, cue).toBeLessThan(rifle.level);
    expect(rifle.echo ?? 0).toBe(0);
    expect(rifle.takes).toBeGreaterThanOrEqual(4);
  });

  it("keeps the music's pitch exact", () => {
    for (const cue of ["ridge_stage_start", "ridge_stage_clear", "ridge_secret", "ridge_streak", "ridge_kill", "ridge_game_over", "ridge_golden"]) {
      expect(RIDGE_CUES[cue]!.vary, cue).toBe(0);
    }
  });
});
