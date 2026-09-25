import { describe, expect, it } from "vitest";
import {
  DUST_CREEK,
  REFERENCE_DISTANCE,
  SPEED_OF_SOUND,
  type VoiceInfo,
  admit,
  airCutoff,
  combinedCutoff,
  distanceGain,
  echoTaps,
  hurtMix,
  pickTake,
  reverbSend,
  slowmoEngaged,
  slowmoMix,
  travelTime,
  variedRate,
  voiceLevel,
} from "./routing";
import { townImpulse } from "./impulse";

describe("distance", () => {
  it("leaves close sounds alone and falls monotonically past the reference", () => {
    expect(distanceGain(0)).toBe(1);
    expect(distanceGain(REFERENCE_DISTANCE)).toBe(1);
    let previous = 1;
    for (let d = 10; d <= 200; d += 10) {
      const g = distanceGain(d);
      expect(g).toBeLessThan(previous);
      expect(g).toBeGreaterThanOrEqual(0.1);
      previous = g;
    }
  });

  it("puts a shot at 40 m about 10 dB down: far, but still a threat", () => {
    const db = 20 * Math.log10(distanceGain(40));
    expect(db).toBeGreaterThan(-12);
    expect(db).toBeLessThan(-8);
  });

  it("darkens with distance: the crack goes before the boom", () => {
    expect(airCutoff(0)).toBe(20000);
    expect(airCutoff(10)).toBeGreaterThan(14000);
    expect(airCutoff(40)).toBeGreaterThan(5000);
    expect(airCutoff(40)).toBeLessThan(8000);
    expect(airCutoff(60)).toBeLessThan(airCutoff(40));
    expect(airCutoff(1000)).toBe(1500);
  });

  it("arrives at the speed of sound", () => {
    expect(travelTime(0)).toBe(0);
    expect(travelTime(40)).toBeCloseTo(40 / SPEED_OF_SOUND, 6);
    expect(travelTime(40) * 1000).toBeGreaterThan(110);
  });

  it("is wetter far away: the reverb send falls slower than the direct sound", () => {
    const near = reverbSend(0.3, 5) / distanceGain(5);
    const far = reverbSend(0.3, 50) / distanceGain(50);
    expect(far).toBeGreaterThan(near);
    expect(reverbSend(0.3, 50)).toBeLessThan(reverbSend(0.3, 5));
  });

  it("tolerates nonsense", () => {
    expect(distanceGain(Number.NaN)).toBe(1);
    expect(distanceGain(-5)).toBe(1);
    expect(airCutoff(Number.NaN)).toBe(20000);
  });
});

describe("the street's echoes", () => {
  it("slaps the player's own shot off both facades, the building behind, and the church", () => {
    const taps = echoTaps(0, 0);
    const delays = taps.map((t) => t.delay * 1000);
    // Left facade 6 m: 12 m round trip, 35 ms; right 7 m: 41 ms.
    expect(delays.some((d) => Math.abs(d - 35) < 2)).toBe(true);
    expect(delays.some((d) => Math.abs(d - 40.8) < 2)).toBe(true);
    // The church at 62 m answers a third of a second later.
    expect(delays.some((d) => Math.abs(d - (2 * 62 * 1000) / SPEED_OF_SOUND) < 3)).toBe(true);
    // They come from where the walls are.
    const left = taps.find((t) => Math.abs(t.delay * 1000 - 35) < 2)!;
    const right = taps.find((t) => Math.abs(t.delay * 1000 - 40.8) < 2)!;
    expect(left.pan).toBeLessThan(-0.5);
    expect(right.pan).toBeGreaterThan(0.5);
    // Every echo is quieter than the shot and darker than the air alone.
    for (const t of taps) {
      expect(t.gain).toBeLessThan(0.5);
      expect(t.gain).toBeGreaterThan(0);
      expect(t.cutoff).toBeLessThan(20000);
    }
  });

  it("gives a shot 40 m away the echoes of a street, relatively louder than close up", () => {
    const far = echoTaps(40, 0);
    const near = echoTaps(0, 0);
    expect(far.length).toBeGreaterThanOrEqual(3);
    // No tap so close to the direct sound that it would only comb-filter it.
    for (const t of far) expect(t.delay).toBeGreaterThanOrEqual(0.008);
    // The church is 22 m behind the source: its echo comes 2*22/c after the direct.
    expect(far.some((t) => Math.abs(t.delay - (2 * 22) / SPEED_OF_SOUND) < 0.004)).toBe(true);
    const ratio = (taps: typeof far, direct: number): number => Math.max(...taps.map((t) => t.gain)) / direct;
    expect(ratio(far, distanceGain(40))).toBeGreaterThan(ratio(near, distanceGain(0)));
  });

  it("keeps at most the requested number of taps, in time order", () => {
    const taps = echoTaps(20, 0.3, DUST_CREEK, 3);
    expect(taps.length).toBeLessThanOrEqual(3);
    for (let k = 1; k < taps.length; k++) expect(taps[k]!.delay).toBeGreaterThanOrEqual(taps[k - 1]!.delay);
  });

  it("handles a source in a facade window without mirroring it onto itself", () => {
    const taps = echoTaps(20, -0.3);
    for (const t of taps) expect(Number.isFinite(t.delay) && Number.isFinite(t.gain)).toBe(true);
  });
});

describe("hurt", () => {
  it("does nothing when unhurt", () => {
    const m = hurtMix(0);
    expect(m.cutoff).toBe(20000);
    expect(m.duck).toBe(1);
    expect(m.beatGain).toBe(0);
  });

  it("muffles, ducks and races the heart monotonically as damage grows", () => {
    let prev = hurtMix(0);
    for (let x = 0.1; x <= 1.0001; x += 0.1) {
      const m = hurtMix(x);
      expect(m.cutoff).toBeLessThan(prev.cutoff);
      expect(m.duck).toBeLessThan(prev.duck);
      expect(m.bpm).toBeGreaterThan(prev.bpm);
      expect(m.beatGain).toBeGreaterThanOrEqual(prev.beatGain);
      prev = m;
    }
  });

  it("makes one hit (34 of 100) clearly heard and a near death drowning", () => {
    expect(hurtMix(0.34).cutoff).toBeLessThan(7000);
    expect(hurtMix(0.34).cutoff).toBeGreaterThan(3000);
    expect(hurtMix(1).cutoff).toBeCloseTo(700, 0);
    expect(hurtMix(1).bpm).toBe(130);
    expect(hurtMix(0.34).beatGain).toBeGreaterThan(0.2);
  });

  it("clamps its input", () => {
    expect(hurtMix(-1)).toEqual(hurtMix(0));
    expect(hurtMix(3)).toEqual(hurtMix(1));
    expect(hurtMix(Number.NaN)).toEqual(hurtMix(0));
  });
});

describe("slow motion", () => {
  it("drops the rate and darkens, and the darker treatment wins", () => {
    expect(slowmoMix(0).rate).toBe(1);
    expect(slowmoMix(1).rate).toBeCloseTo(0.55, 5);
    expect(slowmoMix(1).reverb).toBeGreaterThan(1);
    expect(combinedCutoff(1, 0)).toBeCloseTo(700, 0);
    expect(combinedCutoff(0, 1)).toBeCloseTo(2500, 0);
    expect(combinedCutoff(0, 0)).toBe(20000);
  });

  it("booms once when it engages, not on every change", () => {
    expect(slowmoEngaged(0, 1)).toBe(true);
    expect(slowmoEngaged(0, 0.2)).toBe(false);
    expect(slowmoEngaged(0.5, 1)).toBe(false);
  });
});

function voice(id: number, cue: string, priority: number, start: number, gain: number, duration = 1): VoiceInfo {
  const envelope = new Float32Array(50);
  // A percussive take: loud at first, decaying.
  for (let k = 0; k < envelope.length; k++) envelope[k] = Math.exp(-k / 8);
  return { id, cue, priority, start, gain, playbackRate: 1, envelope, block: 0.02, duration };
}

describe("voice stealing", () => {
  it("admits freely under the limits", () => {
    const voices = [voice(1, "hit_dirt", 1, 0, 1)];
    expect(admit(voices, { cue: "hit_wood", priority: 1 }, 0.1, 8, 4)).toEqual({ steal: [], drop: false });
  });

  it("replaces the oldest instance of the same cue past its cap", () => {
    const voices = [voice(1, "revolver_shot", 3, 0, 1), voice(2, "revolver_shot", 3, 0.2, 1), voice(3, "revolver_shot", 3, 0.4, 1)];
    expect(admit(voices, { cue: "revolver_shot", priority: 3 }, 0.5, 32, 3)).toEqual({ steal: [1], drop: false });
  });

  it("steals the voice that is quietest now, not the one that started quietest", () => {
    // Voice 1 started loud long ago and has decayed; voice 2 started softer just now.
    const voices = [voice(1, "bandit_shot", 2, 0, 1), voice(2, "hit_dirt", 2, 0.98, 0.3), voice(3, "hit_wood", 2, 0.9, 0.8)];
    const got = admit(voices, { cue: "bandit_shot", priority: 2 }, 1.0, 3, 6);
    expect(got).toEqual({ steal: [1], drop: false });
  });

  it("never steals a voice that outranks the newcomer; drops the newcomer instead", () => {
    const voices = [voice(1, "revolver_shot", 3, 0, 1), voice(2, "player_hurt", 3, 0, 1)];
    expect(admit(voices, { cue: "crow_caw", priority: 0 }, 0.5, 2, 1)).toEqual({ steal: [], drop: true });
  });

  it("measures a voice's level through its envelope, and zero once it has finished", () => {
    const v = voice(1, "x", 1, 0, 0.5, 1);
    expect(voiceLevel(v, 0)).toBeCloseTo(0.5, 5);
    expect(voiceLevel(v, 0.4)).toBeLessThan(voiceLevel(v, 0.1));
    expect(voiceLevel(v, 2)).toBe(0);
    // Scheduled for later: counts as its loudest.
    expect(voiceLevel(v, -1)).toBeCloseTo(0.5, 5);
  });

  it("sorts a wave of shots out so the total never exceeds the limit", () => {
    let voices: VoiceInfo[] = [];
    let id = 0;
    for (let k = 0; k < 100; k++) {
      const now = k * 0.03;
      const cue = k % 3 === 0 ? "revolver_shot" : "bandit_shot";
      const priority = cue === "revolver_shot" ? 3 : 2;
      const { steal, drop } = admit(voices, { cue, priority }, now, 12, 4);
      voices = voices.filter((v) => !steal.includes(v.id));
      if (!drop) voices.push(voice(++id, cue, priority, now, 1));
      expect(voices.length).toBeLessThanOrEqual(12);
      expect(voices.filter((v) => v.cue === cue).length).toBeLessThanOrEqual(4);
    }
  });
});

describe("takes and variation", () => {
  it("never repeats the last take when there is a choice, and reaches every take", () => {
    const seen = new Set<number>();
    let last = -1;
    for (let k = 0; k < 200; k++) {
      const pick = pickTake(4, last, (k * 0.6180339887) % 1);
      expect(pick).toBeGreaterThanOrEqual(0);
      expect(pick).toBeLessThan(4);
      expect(pick).not.toBe(last);
      seen.add(pick);
      last = pick;
    }
    expect(seen.size).toBe(4);
    expect(pickTake(1, 0, 0.9)).toBe(0);
    expect(pickTake(3, -1, 0.999)).toBe(2);
  });

  it("varies the rate within its spread", () => {
    expect(variedRate(1, 0.05, 0)).toBeCloseTo(0.95, 6);
    expect(variedRate(1, 0.05, 1)).toBeCloseTo(1.05, 6);
    expect(variedRate(2, 0, 0.3)).toBe(2);
  });
});

describe("the town's reverb", () => {
  it("is a stereo, finite, decaying impulse whose top dies first", () => {
    const [l, r] = townImpulse(44100);
    expect(l.length).toBe(r.length);
    let corr = 0, el = 0, er = 0;
    for (let i = 0; i < l.length; i++) {
      expect(Number.isFinite(l[i]!)).toBe(true);
      corr += l[i]! * r[i]!;
      el += l[i]! * l[i]!;
      er += r[i]! * r[i]!;
    }
    // Decorrelated channels: that is what makes it wide.
    expect(Math.abs(corr) / Math.sqrt(el * er)).toBeLessThan(0.3);
    const energy = (from: number, to: number): number => {
      let s = 0;
      for (let i = Math.round(from * 44100); i < Math.round(to * 44100); i++) s += l[i]! * l[i]!;
      return s;
    };
    expect(energy(0.6, 0.8)).toBeLessThan(energy(0.05, 0.25) * 0.05);
  });
});
