/**
 * The band: every instrument a Grip Prix tune can ask for, each a preset (a
 * handful of numbers) for one of the engines in src/audio/dsp/voices.ts. A
 * piece names them in its rack ("bass: pizz", "lead: whistle"); nothing else
 * decides how anything sounds.
 */
import { type Voice, breathy, fm, modal, organ, plucked, subtractive } from "../../../audio/dsp/voices";

export const INSTRUMENTS = {
  // --- basses --------------------------------------------------------------------------------------
  /** An upright's pizzicato: a dull, short string. */
  pizz: plucked({ t60: 0.8, brightness: 0.3, hardness: 1500, position: 0.25, damp: 0.06 }),
  /** A round pop bass: a saw and a square an octave down, closing as it sounds. */
  "bass-pop": subtractive({
    oscs: [{ wave: "saw", level: 0.55 }, { wave: "square", level: 0.45, mult: 0.5 }],
    cutoff: 120, keytrack: 1.2, envOct: 2.2, fdecay: 0.13, fsustain: 0.15, q: 1.2,
    attack: 0.004, decay: 0.35, sustain: 0.55, release: 0.08, fixedPhase: true, velBright: 0.6,
  }),
  /** A deep sine with a little triangle: the floor under a kick-led groove. */
  sub: subtractive({
    oscs: [{ wave: "sine", level: 0.8 }, { wave: "tri", level: 0.35 }],
    cutoff: 700, attack: 0.006, decay: 0.3, sustain: 0.7, release: 0.1, fixedPhase: true,
  }),
  /** Synthwave: two detuned saws through a resonant low-pass that snaps shut. */
  "bass-synth": subtractive({
    oscs: [{ wave: "saw", cents: -9, level: 0.5 }, { wave: "saw", cents: 9, level: 0.5 }, { wave: "square", level: 0.3, mult: 0.5 }],
    cutoff: 140, keytrack: 1, envOct: 2.6, fdecay: 0.11, fsustain: 0.1, q: 2.4,
    attack: 0.003, decay: 0.2, sustain: 0.6, release: 0.06, fixedPhase: true,
  }),
  /** Rock bass: a driven saw. */
  "bass-rock": subtractive({
    oscs: [{ wave: "saw", level: 0.7 }, { wave: "square", level: 0.5, mult: 0.5 }],
    cutoff: 260, keytrack: 1.5, envOct: 1.4, fdecay: 0.18, fsustain: 0.3, q: 1.5, drive: 2.5,
    attack: 0.003, decay: 0.25, sustain: 0.6, release: 0.07, fixedPhase: true,
  }),
  /** A marimba-ish bass (palm): a thick wooden bar. */
  "bass-marimba": modal({
    partials: [[1, 1, 1], [3.9, 0.12, 0.3]], tau: 0.22, hammer: { level: 0.22, tau: 0.004, low: 1200 }, damp: 0.1,
  }),

  // --- strings and plucks ---------------------------------------------------------------------------------
  uke: plucked({ t60: 0.55, brightness: 0.65, hardness: 5500, position: 0.14, damp: 0.04, double: { cents: 5, level: 0.5 } }),
  banjo: plucked({ t60: 0.45, brightness: 0.95, hardness: 9000, position: 0.1, damp: 0.04 }),
  /** A clean electric guitar with a long twang. */
  twang: plucked({ t60: 1.6, brightness: 0.8, hardness: 6500, position: 0.12, damp: 0.3 }),
  harp: plucked({ t60: 2.2, brightness: 0.55, hardness: 4500, position: 0.2, damp: 0 }),
  /** A palm-muted, distorted rhythm guitar. */
  "guitar-dist": subtractive({
    oscs: [{ wave: "saw", cents: -6, level: 0.5 }, { wave: "saw", cents: 6, level: 0.5 }],
    cutoff: 500, keytrack: 2, envOct: 1.4, fdecay: 0.1, fsustain: 0.4, q: 1.2, drive: 5,
    attack: 0.003, decay: 0.2, sustain: 0.55, release: 0.05, velBright: 0.5,
  }),
  /** A singing, distorted lead guitar. */
  "lead-dist": subtractive({
    oscs: [{ wave: "saw", cents: -5, level: 0.5 }, { wave: "saw", cents: 5, level: 0.5 }, { wave: "square", level: 0.2, mult: 2 }],
    cutoff: 1800, keytrack: 1.5, envOct: 0.6, fdecay: 0.3, fsustain: 0.6, q: 1.6, drive: 3.5,
    attack: 0.008, decay: 0.4, sustain: 0.8, release: 0.12, vibrato: { rate: 5.2, depth: 22, delay: 0.18 },
  }),

  // --- keys ------------------------------------------------------------------------------------------------
  /** A tine electric piano: FM with a bark at the strike. */
  epiano: fm({ ratio: 1, index: 1.4, indexTau: 0.25, tau: 0.9, release: 0.18, octave: 0.12, velIndex: 0.8 }),
  organ: organ({ harmonics: [1, 0.7, 0.5, 0.4, 0.28, 0.22, 0.15], shimmer: { rate: 6.4, depth: 0.12, cents: 6 }, chiff: 0.05 }),
  /** A fairground pipe organ: hollow, bright, with a calliope breath. */
  "organ-pipe": organ({ harmonics: [1, 0.05, 0.75, 0.05, 0.5, 0.05, 0.35, 0, 0.2], shimmer: { rate: 5.4, depth: 0.1, cents: 8 }, chiff: 0.09 }),
  /** The same, gentler and lower: the oom-pah chords. */
  "organ-soft": organ({ harmonics: [1, 0.45, 0.3, 0.15, 0.08], shimmer: { rate: 5, depth: 0.08, cents: 5 } }),

  // --- tuned percussion ----------------------------------------------------------------------------------------
  glock: modal({ partials: [[1, 1, 1], [2.76, 0.5, 0.5], [5.4, 0.28, 0.3], [8.93, 0.15, 0.18]], tau: 0.6, free: true, hammer: { level: 0.14, tau: 0.002, low: 8000 } }),
  celesta: modal({ partials: [[1, 1, 1], [2, 0.35, 0.6], [4.1, 0.3, 0.35], [6.3, 0.12, 0.2]], tau: 0.5, free: true, hammer: { level: 0.1, tau: 0.002, low: 9000 } }),
  marimba: modal({ partials: [[1, 1, 1], [3.93, 0.2, 0.28], [9.2, 0.05, 0.1]], tau: 0.3, hammer: { level: 0.25, tau: 0.003, low: 2500 }, damp: 0.1 }),
  vibes: modal({ partials: [[1, 1, 1], [4, 0.28, 0.4], [10, 0.08, 0.15]], tau: 1.1, tremolo: { rate: 5.2, depth: 0.35 }, hammer: { level: 0.08, tau: 0.003, low: 4000 }, damp: 0.25 }),
  /** A steel pan: a ringing fundamental with its octave and twelfth, shimmering by a few cents. */
  steel: modal({
    partials: [[1, 1, 1], [2, 0.75, 0.8], [3.01, 0.35, 0.55], [4.2, 0.12, 0.25]], tau: 0.45,
    chorus: { cents: 7, level: 0.65 }, hammer: { level: 0.2, tau: 0.003, low: 3500 }, damp: 0.2,
  }),
  /** A big tubular bell, ringing on. */
  bell: modal({ partials: [[1, 0.8, 1], [2, 0.5, 0.8], [2.4, 0.45, 0.7], [3, 0.4, 0.6], [4.5, 0.3, 0.4], [6.1, 0.15, 0.25]], tau: 1.6, free: true, hammer: { level: 0.12, tau: 0.003, low: 3000 } }),
  /** A small jingle-bell chime for snow. */
  chime: modal({ partials: [[1, 1, 1], [2.32, 0.6, 0.6], [4.25, 0.35, 0.4], [6.63, 0.2, 0.25]], tau: 0.9, free: true, chorus: { cents: 11, level: 0.45 } }),
  /** A glassy FM bell for the space tune. */
  "bell-fm": fm({ ratio: 3.5, index: 2.4, indexTau: 0.6, tau: 1.4, release: 0.3, velIndex: 0.5, attack: 0.002 }),

  // --- pads and brass -----------------------------------------------------------------------------------------------
  pad: subtractive({
    oscs: [{ wave: "saw", cents: -11, level: 0.35 }, { wave: "saw", cents: 0, level: 0.35 }, { wave: "saw", cents: 11, level: 0.35 }],
    cutoff: 500, keytrack: 1, envOct: 0.8, fdecay: 1.2, fsustain: 0.6, q: 0.9,
    attack: 0.35, decay: 1, sustain: 0.85, release: 0.7,
  }),
  strings: subtractive({
    oscs: [{ wave: "saw", cents: -8, level: 0.4 }, { wave: "saw", cents: 8, level: 0.4 }, { wave: "tri", level: 0.3, mult: 0.5 }],
    cutoff: 900, keytrack: 1.5, envOct: 0.5, fdecay: 0.9, fsustain: 0.7, q: 0.8,
    attack: 0.22, decay: 1, sustain: 0.85, release: 0.5, vibrato: { rate: 5.6, depth: 9, delay: 0.3 },
  }),
  /** A gated, glowing synth pad for the night tune. */
  "pad-glow": subtractive({
    oscs: [{ wave: "saw", cents: -14, level: 0.4 }, { wave: "saw", cents: 14, level: 0.4 }, { wave: "pulse", width: 0.3, level: 0.25 }],
    cutoff: 700, keytrack: 1.2, envOct: 1, fdecay: 0.25, fsustain: 0.5, q: 1.4,
    attack: 0.02, decay: 0.6, sustain: 0.7, release: 0.2,
  }),
  brass: subtractive({
    oscs: [{ wave: "saw", cents: -6, level: 0.5 }, { wave: "saw", cents: 6, level: 0.5 }],
    cutoff: 350, keytrack: 1.6, envOct: 2, fdecay: 0.12, fsustain: 0.5, q: 1.3,
    attack: 0.03, decay: 0.4, sustain: 0.75, release: 0.1, velBright: 0.8, vibrato: { rate: 5.5, depth: 10, delay: 0.25 },
  }),
  /** A mellow muted trumpet for the kitchen. */
  "trumpet-muted": subtractive({
    oscs: [{ wave: "saw", level: 0.6 }, { wave: "pulse", width: 0.2, level: 0.35 }],
    cutoff: 700, keytrack: 1.1, envOct: 1.4, fdecay: 0.18, fsustain: 0.55, q: 3.2,
    attack: 0.025, decay: 0.5, sustain: 0.8, release: 0.1, vibrato: { rate: 5.4, depth: 14, delay: 0.2 }, glide: { semitones: -0.6, time: 0.05 }, noise: 0.03,
  }),

  // --- leads -------------------------------------------------------------------------------------------------------------
  "lead-saw": subtractive({
    oscs: [{ wave: "saw", cents: -7, level: 0.45 }, { wave: "saw", cents: 7, level: 0.45 }, { wave: "square", level: 0.2, mult: 0.5 }],
    cutoff: 1400, keytrack: 2, envOct: 1.2, fdecay: 0.25, fsustain: 0.5, q: 1.1,
    attack: 0.01, decay: 0.3, sustain: 0.8, release: 0.12, vibrato: { rate: 5.6, depth: 14, delay: 0.2 },
  }),
  /** A toy square lead, the colour of a handheld console. */
  "lead-square": subtractive({
    oscs: [{ wave: "pulse", width: 0.3, level: 0.55 }, { wave: "square", cents: 4, level: 0.3 }],
    cutoff: 3200, keytrack: 1.5, attack: 0.004, decay: 0.2, sustain: 0.7, release: 0.08,
    vibrato: { rate: 5.8, depth: 12, delay: 0.25 },
  }),
  /** A soft triangle lead, rounded and kind. */
  "lead-tri": subtractive({
    oscs: [{ wave: "tri", level: 0.8 }, { wave: "sine", level: 0.3, mult: 2 }],
    cutoff: 3500, attack: 0.012, decay: 0.3, sustain: 0.8, release: 0.1, vibrato: { rate: 5.2, depth: 10, delay: 0.25 },
  }),
  /** A bright arpeggio pluck: a saw whose filter closes at once. */
  "pluck-synth": subtractive({
    oscs: [{ wave: "saw", cents: -6, level: 0.5 }, { wave: "square", cents: 6, level: 0.4 }],
    cutoff: 500, keytrack: 1.5, envOct: 3, fdecay: 0.09, fsustain: 0, q: 1.6,
    attack: 0.002, decay: 0.14, sustain: 0.05, release: 0.06, fixedPhase: true, velBright: 0.7,
  }),
  whistle: breathy({ h2: 0.04, h3: 0.01, breath: 0.12, breathBand: [2200, 6500], vibrato: { rate: 5.5, depth: 24, delay: 0.22 }, scoop: -45, scoopTime: 0.06, attack: 0.03, release: 0.09 }),
  flute: breathy({ h2: 0.18, h3: 0.06, breath: 0.16, breathBand: [900, 5000], vibrato: { rate: 5.2, depth: 18, delay: 0.25 }, scoop: -30, scoopTime: 0.05, attack: 0.04, release: 0.1 }),
  /** A reedy harmonica. */
  harmonica: subtractive({
    oscs: [{ wave: "pulse", width: 0.28, level: 0.5 }, { wave: "saw", cents: 5, level: 0.35 }],
    cutoff: 1500, keytrack: 1.2, envOct: 0.8, fdecay: 0.2, fsustain: 0.7, q: 2,
    attack: 0.04, decay: 0.4, sustain: 0.8, release: 0.12, vibrato: { rate: 6, depth: 20, delay: 0.3 }, noise: 0.05,
  }),
} satisfies Record<string, Voice>;

export type InstrumentName = keyof typeof INSTRUMENTS;

export function isInstrument(name: string): name is InstrumentName {
  return Object.prototype.hasOwnProperty.call(INSTRUMENTS, name);
}
