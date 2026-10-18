/**
 * The library, sound by sound, in Node: no audio device, nothing played.
 * Every take of every cue is rendered and checked the way an ear would be
 * disappointed: silence, clipping, a wrong length, a click at a loop's seam,
 * two takes that are secretly the same, a render that changes from run to run.
 */
import { describe, expect, it } from "vitest";
import { CUES, CUE_NAMES, cuesInPack } from "./cues/table";
import { momentaryMaxDb } from "./dsp/master";
import { type RenderedTake, renderTake, takeCount } from "./render";

const SR = 44100;
const renders = new Map<string, RenderedTake[]>();

function takesOf(cue: string): RenderedTake[] {
  let list = renders.get(cue);
  if (!list) {
    list = [];
    for (let k = 0; k < takeCount(cue); k++) list.push(renderTake(cue, k, { sampleRate: SR, seed: 1 }));
    renders.set(cue, list);
  }
  return list;
}

/** Pearson correlation of two takes over their common length. */
function correlation(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  let ab = 0, aa = 0, bb = 0;
  for (let i = 0; i < n; i++) {
    ab += a[i]! * b[i]!;
    aa += a[i]! * a[i]!;
    bb += b[i]! * b[i]!;
  }
  return ab / Math.sqrt(aa * bb + 1e-30);
}

describe("the cue table", () => {
  it("has every sound High Noon asks for", () => {
    const wanted = [
      "revolver_shot", "revolver_dry", "revolver_cock", "reload_spin", "bandit_shot", "rifle_shot", "bullet_whiz",
      "ricochet", "hit_flesh", "hit_headshot", "hit_wood", "hit_dirt", "hit_metal", "hit_glass", "hit_water",
      "player_hurt", "heartbeat", "death_player", "bandit_death", "body_fall", "dynamite_fuse", "dynamite_explode",
      "dynamite_throw", "wind", "bell_toll", "church_door_creak", "vane_spin", "water_leak",
      ...[1, 2, 3, 4, 5, 6, 7, 8].map((k) => `piano_note_${k}`), "piano_tune", "chicken_cluck", "chicken_squawk",
      "feathers", "tumbleweed_roll", "shutter_bang", "door_creak", "spurs", "horse_neigh", "crow_caw",
      "dog_bark_distant", "glass_break", "bottle_break", "wood_splinter", "poster_flutter", "wave_start",
      "wave_clear", "boss_intro", "duel_whistle", "quick_draw", "streak_up", "secret_found", "golden_unlock",
      "ui_tap", "ui_confirm", "calib_hit", "calib_done", "game_over",
    ];
    for (const cue of wanted) expect(CUE_NAMES, cue).toContain(cue);
  });

  it("marks the loops the game loops", () => {
    for (const cue of ["wind", "heartbeat", "dynamite_fuse", "water_leak", "tumbleweed_roll"]) expect(CUES[cue]!.loop, cue).toBe(true);
  });

  it("keeps the interface and the hurt effect in the core pack, and nothing else there", () => {
    expect(cuesInPack("core").sort()).toEqual(
      ["calib_done", "calib_hit", "heartbeat", "heartbeat_beat", "slowmo_boom", "ui_confirm", "ui_gold", "ui_tap"].sort(),
    );
  });

  it("mixes the gunfight so it reads: the player's shot loudest, the gang's under it, the world and the interface beneath", () => {
    const level = (cue: string): number => CUES[cue]!.level;
    for (const cue of CUE_NAMES) if (cue !== "revolver_shot") expect(level(cue), cue).toBeLessThanOrEqual(level("revolver_shot"));
    expect(level("bandit_shot")).toBeLessThan(level("revolver_shot"));
    expect(level("bandit_shot")).toBeGreaterThan(level("revolver_shot") - 6);
    for (const cue of ["wind", "water_leak", "tumbleweed_roll", "crow_caw", "dog_bark_distant"]) expect(level(cue), cue).toBeLessThan(-12);
    for (const cue of ["ui_tap", "ui_confirm", "calib_hit", "calib_done", "ui_gold"]) expect(level(cue), cue).toBeLessThanOrEqual(-14);
  });

  it("gives every cue at least three takes", () => {
    for (const cue of CUE_NAMES) expect(takeCount(cue), cue).toBeGreaterThanOrEqual(3);
  });
});

describe.each(CUE_NAMES)("%s", (cue) => {
  const spec = CUES[cue]!;

  it("renders finite, audible, unclipped takes of a sensible length", () => {
    for (const take of takesOf(cue)) {
      const n = take.channels[0]!.length;
      let peak = 0;
      for (const ch of take.channels) {
        expect(ch.length).toBe(n);
        for (let i = 0; i < n; i++) {
          const v = ch[i]!;
          if (!Number.isFinite(v)) throw new Error(`${cue} take ${take.take}: non-finite sample at ${i}`);
          peak = Math.max(peak, Math.abs(v));
        }
      }
      expect(peak, `${cue} peak`).toBeLessThanOrEqual(0.99);
      expect(peak, `${cue} is silent`).toBeGreaterThan(0.05);
      expect(momentaryMaxDb(take.channels, SR), `${cue} loudness`).toBeGreaterThan(-30);
      const seconds = n / SR;
      expect(seconds, `${cue} duration`).toBeGreaterThanOrEqual(spec.expect[0]);
      expect(seconds, `${cue} duration`).toBeLessThanOrEqual(spec.expect[1]);
    }
  });

  it("has takes that differ, subtly", () => {
    const takes = takesOf(cue);
    for (let a = 0; a < takes.length; a++) {
      for (let b = a + 1; b < takes.length; b++) {
        const x = takes[a]!.channels[0]!;
        const y = takes[b]!.channels[0]!;
        const same = x.length === y.length && x.every((v, i) => v === y[i]);
        expect(same, `${cue}: takes ${a} and ${b} are identical`).toBe(false);
        expect(correlation(x, y), `${cue}: takes ${a} and ${b}`).toBeLessThan(0.999);
      }
    }
  });

  it("renders the same samples for the same seed, and other samples for another", () => {
    const again = renderTake(cue, 0, { sampleRate: SR, seed: 1 });
    const first = takesOf(cue)[0]!;
    expect(again.channels.length).toBe(first.channels.length);
    again.channels.forEach((ch, c) => expect(ch).toEqual(first.channels[c]));
    const other = renderTake(cue, 0, { sampleRate: SR, seed: 2 });
    expect(other.channels[0]!.length === first.channels[0]!.length && other.channels[0]!.every((v, i) => v === first.channels[0]![i])).toBe(false);
  });

  if (spec.loop) {
    it("loops without a click at the seam", () => {
      for (const take of takesOf(cue)) {
        for (const ch of take.channels) {
          const n = ch.length;
          // The step from the last sample to the first must look like any
          // other step in the loop: no bigger than its 99.5th percentile.
          const steps = new Float32Array(n - 1);
          for (let i = 1; i < n; i++) steps[i - 1] = Math.abs(ch[i]! - ch[i - 1]!);
          const sorted = Float32Array.from(steps).sort();
          const p995 = sorted[Math.floor(0.995 * (sorted.length - 1))]!;
          const seam = Math.abs(ch[0]! - ch[n - 1]!);
          expect(seam, `${cue} take ${take.take}: seam ${seam} vs p99.5 ${p995}`).toBeLessThanOrEqual(p995 * 1.1 + 1e-4);
          // And the level steps across the seam no more than it steps
          // anywhere inside the loop (5 ms blocks, compared neighbour to
          // neighbour): no dip, no swell, no lurch. (A drop of water may
          // land right on the seam; it is still no louder an onset than
          // the loudest inside.)
          const w = Math.round(0.005 * SR);
          const blocks = Math.floor(n / w);
          let total = 0;
          for (let i = 0; i < n; i++) total += ch[i]! * ch[i]!;
          const floor = 1e-3 * Math.sqrt(total / n);
          const level = (b: number): number => {
            const start = b === blocks - 1 ? n - w : b * w;
            let s = 0;
            for (let i = start; i < start + w; i++) s += ch[i]! * ch[i]!;
            return Math.sqrt(s / w) + floor;
          };
          const jumps: number[] = [];
          for (let b = 1; b < blocks; b++) jumps.push(Math.abs(Math.log(level(b) / level(b - 1))));
          const largest = Math.max(...jumps);
          const seamJump = Math.abs(Math.log(level(0) / level(blocks - 1)));
          expect(seamJump, `${cue}: level step at the seam`).toBeLessThanOrEqual(Math.max(largest, Math.log(1.5)));
        }
      }
    });
  } else {
    it("starts and ends at rest", () => {
      for (const take of takesOf(cue)) {
        for (const ch of take.channels) {
          expect(Math.abs(ch[0]!), `${cue} first sample`).toBeLessThan(0.02);
          expect(Math.abs(ch[ch.length - 1]!), `${cue} last sample`).toBeLessThan(0.002);
        }
      }
    });
  }
});

describe("rendering", () => {
  it("refuses an unknown cue rather than inventing one", () => {
    expect(() => renderTake("no_such_sound", 0, { sampleRate: SR, seed: 1 })).toThrow();
  });

  it("renders at other rates too (a 48 kHz device)", () => {
    const r = renderTake("revolver_shot", 0, { sampleRate: 48000, seed: 1 });
    expect(r.sampleRate).toBe(48000);
    const r44 = takesOf("revolver_shot")[0]!;
    const ratio = r.channels[0]!.length / r44.channels[0]!.length;
    expect(ratio).toBeGreaterThan(1.05);
    expect(ratio).toBeLessThan(1.12);
  });

  it("gives the voice stealer an envelope that falls as a shot dies", () => {
    const env = takesOf("revolver_shot")[0]!.envelope;
    let top = 0;
    for (let k = 0; k < 10; k++) top = Math.max(top, env[k]!);
    expect(env[env.length - 3]!).toBeLessThan(top * 0.05);
  });
});

describe("the mix across the games", () => {
  /**
   * How loud a cue reaches the master at its table level: its loudest 50 ms
   * plus its level, less the 3 dB the engine's stereo panner takes off a
   * mono cue at centre (a stereo cue passes it whole).
   */
  function atTheMaster(cue: string): number {
    const take = takesOf(cue)[0]!;
    return momentaryMaxDb(take.channels, SR) + CUES[cue]!.level + (take.channels.length === 1 ? -3.01 : 0);
  }

  it("plays the player's gun as loud in every game, within 1.5 dB", () => {
    const guns = ["revolver_shot", "night_rifle", "orbit_laser", "ridge_rifle_shot"];
    const loud = guns.map(atTheMaster);
    const spread = Math.max(...loud) - Math.min(...loud);
    expect(spread, guns.map((g, i) => `${g} ${loud[i]!.toFixed(1)} dB`).join(", ")).toBeLessThan(1.5);
  });

  it("keeps the glass giving way no louder than the laser that shoots in Orbital Decay", () => {
    expect(atTheMaster("orbit_decompress")).toBeLessThan(atTheMaster("orbit_laser") + 1);
  });
});
