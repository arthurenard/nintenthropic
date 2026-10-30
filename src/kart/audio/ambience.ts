/**
 * Each place's air, very quietly under the engines: the beds that loop for
 * a theme (each played twice, apart in the stereo field) and the things that
 * now and then happen far off, how often and how far. Pure data and a pure
 * scheduler, so it is tested in Node; RaceAudio plays what it says.
 */
import type { TrackTheme } from "./kinds";

export interface AmbienceBed {
  cue: string;
  /** Playback rate: a breeze slowed is a canyon's wind, a hum slowed is a spaceship's. */
  rate: number;
  /** A multiplier on the cue's own (already low) level. */
  volume: number;
}

export interface AmbienceSpot {
  cue: string;
  /** Seconds between two, at random in this range. */
  every: [number, number];
  /** How far off, metres (darker and quieter with distance), at random in this range. */
  distance: [number, number];
  /** Playback rate, at random in this range. */
  rate: [number, number];
  volume: number;
}

export interface Ambience {
  beds: AmbienceBed[];
  spots: AmbienceSpot[];
}

const bird = (rate: [number, number], every: [number, number] = [2.5, 6]): AmbienceSpot => ({ cue: "kart_amb_bird", every, distance: [18, 45], rate, volume: 1 });

export const AMBIENCE: Record<TrackTheme, Ambience> = {
  // Larks over a summer meadow.
  meadow: { beds: [{ cue: "kart_amb_breeze", rate: 1, volume: 0.8 }], spots: [bird([0.9, 1.12])] },
  // A giant kitchen: the fridge hums, a pot bubbles on the stove.
  kitchen: { beds: [{ cue: "kart_amb_hum", rate: 1, volume: 0.7 }], spots: [{ cue: "kart_amb_bubble", every: [3, 7], distance: [15, 35], rate: [0.85, 1.15], volume: 1 }] },
  // Water lapping at the quay, a sea breeze, the gulls.
  harbour: {
    beds: [{ cue: "kart_amb_water", rate: 1, volume: 0.85 }, { cue: "kart_amb_breeze", rate: 0.9, volume: 0.45 }],
    spots: [{ cue: "kart_amb_gull", every: [4, 9], distance: [20, 50], rate: [0.9, 1.1], volume: 1 }],
  },
  // A dry wind down the canyon, a hawk high over it.
  canyon: {
    beds: [{ cue: "kart_amb_breeze", rate: 0.72, volume: 1 }],
    spots: [{ cue: "kart_amb_hawk", every: [8, 15], distance: [35, 70], rate: [0.92, 1.06], volume: 1 }],
  },
  // The crowd at the fair, the generators' hum, the high striker's bell.
  funfair: {
    beds: [{ cue: "kart_amb_crowd", rate: 1, volume: 0.9 }, { cue: "kart_amb_hum", rate: 1.25, volume: 0.25 }],
    spots: [{ cue: "kart_amb_ding", every: [7, 14], distance: [30, 60], rate: [0.97, 1.03], volume: 1 }],
  },
  // A thin cold wind, the ice creaking.
  snow: {
    beds: [{ cue: "kart_amb_breeze", rate: 1.2, volume: 0.75 }],
    spots: [{ cue: "kart_amb_creak", every: [6, 13], distance: [20, 45], rate: [0.8, 1.2], volume: 1 }],
  },
  // The mountain's rumble, lava blorping in its pools.
  volcano: {
    beds: [{ cue: "kart_amb_rumble", rate: 1, volume: 1 }],
    spots: [{ cue: "kart_amb_lava", every: [2, 5], distance: [15, 40], rate: [0.8, 1.2], volume: 1 }],
  },
  // A spaceship's deep drone and the hiss of the void, a radio bleeping somewhere.
  space: {
    beds: [{ cue: "kart_amb_hum", rate: 0.62, volume: 0.45 }, { cue: "kart_amb_breeze", rate: 0.5, volume: 0.5 }],
    spots: [{ cue: "kart_amb_bleep", every: [3, 8], distance: [15, 40], rate: [1, 1], volume: 1 }],
  },
  // Surf on the beach, wind in the palms, tropical birds.
  palm: {
    beds: [{ cue: "kart_amb_water", rate: 0.75, volume: 0.8 }, { cue: "kart_amb_breeze", rate: 0.9, volume: 0.45 }],
    spots: [bird([1.25, 1.5], [3, 7])],
  },
};

/** The cues a theme uses (for the tests). */
export function ambienceCues(theme: TrackTheme): string[] {
  const a = AMBIENCE[theme];
  return [...a.beds.map((b) => b.cue), ...a.spots.map((s) => s.cue)];
}

/** Where each bed's two copies sit in the stereo field. */
export const BED_PANS = [-0.75, 0.75] as const;

/** A small seeded random source, so a race's far-off happenings repeat in tests. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SpotOrder {
  cue: string;
  rate: number;
  volume: number;
  pan: number;
  distance: number;
}

/**
 * The far-off happenings: each spot comes round at its own random interval. ``tick`` is called every frame with the
 * clock and returns the spots due.
 */
export class SpotClock {
  private readonly next: number[];
  constructor(
    private readonly spots: readonly AmbienceSpot[],
    private readonly random: () => number,
    start: number,
  ) {
    // The first of each comes a little in, not at once.
    this.next = spots.map((s) => start + s.every[0] * (0.4 + 0.6 * random()));
  }

  tick(clock: number): SpotOrder[] {
    const due: SpotOrder[] = [];
    const r = this.random;
    const pick = (range: [number, number]): number => range[0] + (range[1] - range[0]) * r();
    this.spots.forEach((s, k) => {
      if (clock < this.next[k]!) return;
      due.push({ cue: s.cue, rate: pick(s.rate), volume: s.volume, pan: (r() * 2 - 1) * 0.85, distance: pick(s.distance) });
      this.next[k] = clock + pick(s.every);
    });
    return due;
  }
}
