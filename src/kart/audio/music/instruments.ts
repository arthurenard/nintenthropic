/**
 * The band: every instrument a Grip Prix tune can ask for, each a preset (a
 * handful of numbers) for one of the engines in src/audio/dsp/voices.ts. A
 * piece names them in its rack ("bass: pizz", "lead: whistle"); nothing else
 * decides how anything sounds.
 */
import { type Voice, breathy, fm, modal, organ, plucked, subtractive } from "../../../audio/dsp/voices";
import { buzz, drive, guitar, layer, rhodes, riseIn, shaped } from "./synth";

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

  // --- the produced band: layered and body-modelled instruments ----------------------------------------------------------------
  /** An upright bass: a damped string with the wood's thump under it. */
  upright: layer(
    { voice: shaped(plucked({ t60: 0.9, brightness: 0.3, hardness: 1600, position: 0.3, damp: 0.07 }), (buf, n) => riseIn(buf, n.sr)), gain: 1 },
    { voice: subtractive({ oscs: [{ wave: "sine" }], cutoff: 500, attack: 0.003, decay: 0.12, sustain: 0.1, release: 0.06, fixedPhase: true }), gain: 0.55 },
  ),
  /** A slap bass: the thumb's thud, the string's pop an octave up, a flick of noise. */
  slap: layer(
    {
      voice: subtractive({
        oscs: [{ wave: "saw", level: 0.55 }, { wave: "square", level: 0.5, mult: 0.5 }],
        cutoff: 80, keytrack: 1.6, envOct: 3.4, fdecay: 0.07, fsustain: 0.12, q: 2.2, noise: 0.05,
        attack: 0.002, decay: 0.22, sustain: 0.35, release: 0.06, fixedPhase: true, velBright: 1,
      }),
      gain: 1,
    },
    { voice: guitar({ t60: 0.5, brightness: 0.95, hardness: 9000, position: 0.1, damp: 0.04, click: 0.4 }), gain: 0.28, mult: 2 },
  ),
  /** A picked electric bass: plucked string, a round sub, a little grit. */
  "bass-pick": layer(
    { voice: guitar({ t60: 0.8, brightness: 0.45, hardness: 3000, position: 0.15, damp: 0.05, click: 0.2 }), gain: 1 },
    { voice: subtractive({ oscs: [{ wave: "sine" }], cutoff: 400, attack: 0.004, decay: 0.3, sustain: 0.6, release: 0.07, fixedPhase: true }), gain: 0.5 },
  ),
  /** A thick synth bass: two saws and a sub, the filter slamming shut. */
  "bass-fat": layer(
    {
      voice: subtractive({
        oscs: [{ wave: "saw", cents: -12, level: 0.5 }, { wave: "saw", cents: 12, level: 0.5 }, { wave: "square", level: 0.3, mult: 0.5 }],
        cutoff: 110, keytrack: 1.1, envOct: 3, fdecay: 0.14, fsustain: 0.12, q: 3, drive: 1.8,
        attack: 0.003, decay: 0.2, sustain: 0.6, release: 0.06, fixedPhase: true,
      }),
    },
    { voice: subtractive({ oscs: [{ wave: "sine" }], cutoff: 300, attack: 0.004, decay: 0.5, sustain: 0.8, release: 0.06, fixedPhase: true }), gain: 0.55, mult: 0.5 },
  ),
  "gtr-nylon": guitar({ t60: 1.1, brightness: 0.5, hardness: 3200, position: 0.2, damp: 0.1, click: 0.15, body: [[110, 1.2, 4], [210, 1.4, 3], [2400, 1.5, 2]] }),
  "gtr-steel": guitar({ t60: 1.4, brightness: 0.85, hardness: 7500, position: 0.14, damp: 0.12, click: 0.3, double: { cents: 4, level: 0.45 }, body: [[100, 1.2, 4], [190, 1.4, 3], [2200, 1.2, 3]] }),
  "gtr-clean": guitar({ t60: 2, brightness: 0.8, hardness: 6500, position: 0.12, damp: 0.35, click: 0.2, body: [[140, 1, 2], [2800, 1.4, 3]] }),
  /** A banjo: bright, short, with a drumhead's ring. */
  "banjo-bright": guitar({ t60: 0.5, brightness: 0.95, hardness: 9500, position: 0.1, damp: 0.04, click: 0.35, body: [[420, 3, 6], [1500, 2, 4]] }),
  "uke-bright": guitar({ t60: 0.6, brightness: 0.7, hardness: 6000, position: 0.14, damp: 0.05, click: 0.2, double: { cents: 5, level: 0.4 }, body: [[330, 2, 5], [900, 1.5, 3]] }),
  /** A rhythm guitar for power chords: a sustaining string, saturated by the part's drive. */
  "gtr-power": guitar({ t60: 1.2, brightness: 0.7, hardness: 4500, position: 0.1, damp: 0.05, click: 0.1, body: [[160, 1, 3]] }),
  /** A lead guitar: held longer, singing, with vibrato from the playing. */
  "gtr-lead": shaped(
    subtractive({
      oscs: [{ wave: "saw", cents: -4, level: 0.5 }, { wave: "saw", cents: 4, level: 0.5 }, { wave: "square", level: 0.15, mult: 2 }],
      cutoff: 1500, keytrack: 1.6, envOct: 0.7, fdecay: 0.35, fsustain: 0.65, q: 1.4, attack: 0.006, decay: 0.5, sustain: 0.85, release: 0.14,
      vibrato: { rate: 5.4, depth: 24, delay: 0.16 }, glide: { semitones: -0.5, time: 0.04 },
    }),
    (buf) => drive(buf, 3.2),
  ),
  /** A punchy funk synth bass: two saws and a square through a resonant filter that snaps shut, a sine at the same pitch for body (no octave below: it stays out of the kick's way) and a thin pluck an octave up for the pop. */
  "bass-funk": layer(
    {
      voice: subtractive({
        oscs: [{ wave: "saw", cents: -7, level: 0.5 }, { wave: "saw", cents: 7, level: 0.5 }, { wave: "square", level: 0.25 }],
        cutoff: 130, keytrack: 1.2, envOct: 3.2, fdecay: 0.09, fsustain: 0.15, q: 2.6, drive: 1.6,
        attack: 0.002, decay: 0.22, sustain: 0.5, release: 0.06, fixedPhase: true, velBright: 0.9,
      }),
    },
    { voice: subtractive({ oscs: [{ wave: "sine" }], cutoff: 300, attack: 0.003, decay: 0.25, sustain: 0.6, release: 0.05, fixedPhase: true }), gain: 0.35 },
    { voice: guitar({ t60: 0.25, brightness: 0.95, hardness: 9000, position: 0.1, damp: 0.2, click: 0.5 }), gain: 0.2, mult: 2 },
  ),
  /** A clavinet: a short, hard, nasal string, damped almost at once. */
  clav: guitar({ t60: 0.3, brightness: 0.98, hardness: 9800, position: 0.07, damp: 0.5, click: 0.55, body: [[2400, 1.6, 4], [900, 1.2, 2]] }),
  /** A muted funk guitar: a chank, mostly click and a stopped string. */
  "gtr-muted": guitar({ t60: 0.14, brightness: 0.85, hardness: 8000, position: 0.12, damp: 0.6, click: 0.5, body: [[1800, 1.3, 3]] }),
  /** A bright jazz-funk synth lead: pulse and saw, a filter that opens on the attack, only a late vibrato. */
  "lead-funk": subtractive({
    oscs: [{ wave: "pulse", width: 0.36, level: 0.5 }, { wave: "saw", cents: 6, level: 0.4 }, { wave: "saw", cents: -6, level: 0.25, mult: 0.5 }],
    cutoff: 1100, keytrack: 1.3, envOct: 1.6, fdecay: 0.22, fsustain: 0.45, q: 1.5,
    attack: 0.004, decay: 0.3, sustain: 0.65, release: 0.09, vibrato: { rate: 5.4, depth: 10, delay: 0.35 }, velBright: 0.6,
  }),
  rhodes: rhodes({ tau: 1.1, warm: 1.7, bark: 1.6, drive: 1.3 }),
  "rhodes-bright": rhodes({ tau: 0.8, warm: 2.2, bark: 2.6, barkTau: 0.05, drive: 1.6 }),
  "rhodes-soft": rhodes({ tau: 1.4, warm: 1.1, bark: 0.8, drive: 1 }),
  accordion: buzz({ saws: 3, spread: 16, pulse: 0.3, base: 500, track: 3.5, open: 0.6, swell: 0.08, rest: 0.8, q: 1, attack: 0.05, release: 0.09, tremolo: { rate: 5, depth: 0.1 }, breath: 0.012, formant: [1800, 3] }),
  musette: buzz({ saws: 4, spread: 26, pulse: 0.35, base: 600, track: 3.2, open: 0.5, swell: 0.06, rest: 0.85, q: 1, attack: 0.04, release: 0.08, tremolo: { rate: 6, depth: 0.08 }, formant: [2200, 3] }),
  /** A brass section: five saws, a scoop into the pitch, the horns blooming then settling. */
  "brass-section": buzz({ saws: 5, spread: 14, base: 300, track: 2.2, open: 2.1, swell: 0.07, rest: 0.55, q: 1.4, attack: 0.025, release: 0.1, scoop: -1.2, scoopTime: 0.06, vibrato: { rate: 5.6, depth: 14, delay: 0.3 }, formant: [1100, 4], drive: 1.6, velBright: 0.9 }),
  "brass-stab": buzz({ saws: 5, spread: 12, base: 320, track: 2.4, open: 2.3, swell: 0.035, rest: 0.4, q: 1.5, attack: 0.01, release: 0.08, scoop: -1.6, scoopTime: 0.04, formant: [1200, 5], drive: 2, velBright: 1 }),
  "trumpet-mute": buzz({ saws: 3, spread: 6, base: 500, track: 2, open: 1.6, swell: 0.05, rest: 0.7, q: 4, attack: 0.03, release: 0.1, scoop: -0.7, scoopTime: 0.05, vibrato: { rate: 5.4, depth: 18, delay: 0.22 }, breath: 0.02, formant: [1500, 6] }),
  "horn-soft": buzz({ saws: 3, spread: 6, base: 220, track: 1.2, open: 1.2, swell: 0.1, rest: 0.7, q: 1, attack: 0.07, release: 0.18, vibrato: { rate: 5, depth: 10, delay: 0.3 }, formant: [500, 3], velBright: 0.5 }),
  sax: buzz({ saws: 2, spread: 5, pulse: 0.35, base: 500, track: 2.2, open: 1, swell: 0.06, rest: 0.8, q: 2.5, attack: 0.03, release: 0.1, vibrato: { rate: 5.2, depth: 24, delay: 0.16 }, breath: 0.06, formant: [900, 5], drive: 1.4 }),
  reed: buzz({ saws: 2, spread: 8, pulse: 0.28, base: 900, track: 2.5, open: 0.7, swell: 0.1, rest: 0.8, q: 2, attack: 0.05, release: 0.12, vibrato: { rate: 6, depth: 22, delay: 0.25 }, breath: 0.05, tremolo: { rate: 6, depth: 0.1 }, formant: [1400, 4] }),
  supersaw: buzz({ saws: 7, spread: 24, base: 700, track: 3, open: 1.3, swell: 0.18, rest: 0.8, q: 1, attack: 0.01, release: 0.16, vibrato: { rate: 5.4, depth: 12, delay: 0.25 }, scoop: -0.4, scoopTime: 0.05, drive: 1.3 }),
  /** A synthwave lead: a supersaw that slides into every note. */
  "supersaw-lead": buzz({ saws: 5, spread: 18, base: 900, track: 3.2, open: 1.1, swell: 0.12, rest: 0.85, q: 1.3, attack: 0.008, release: 0.18, vibrato: { rate: 5.6, depth: 16, delay: 0.2 }, scoop: -2, scoopTime: 0.07, drive: 1.5 }),
  "string-ens": buzz({ saws: 6, spread: 18, base: 500, track: 2, open: 0.5, swell: 0.4, rest: 0.8, q: 0.8, attack: 0.22, release: 0.5, vibrato: { rate: 5.5, depth: 8, delay: 0.3 }, velBright: 0.3 }),
  "choir-ooh": buzz({ saws: 5, spread: 12, base: 1200, track: 1, open: 0.4, swell: 0.3, rest: 0.8, q: 0.8, attack: 0.18, release: 0.45, vibrato: { rate: 5.5, depth: 16, delay: 0.3 }, breath: 0.02, vowel: [[340, 1], [800, 0.45], [2400, 0.12]], vowelMix: 0.9 }),
  "choir-aah": buzz({ saws: 5, spread: 14, base: 1500, track: 1, open: 0.4, swell: 0.3, rest: 0.8, q: 0.8, attack: 0.15, release: 0.4, vibrato: { rate: 5.6, depth: 18, delay: 0.25 }, breath: 0.02, vowel: [[700, 1], [1150, 0.55], [2600, 0.15]], vowelMix: 0.9 }),
  "pad-warm": buzz({ saws: 5, spread: 30, base: 350, track: 1.2, open: 1.2, swell: 1.2, rest: 0.6, q: 0.9, attack: 0.5, release: 0.9 }),
  /** Steel pan with a shimmer layer: the fundamental, its octave, and a detuned ring. */
  "steel-pan": layer(
    { voice: modal({ partials: [[1, 1, 1], [2, 0.75, 0.8], [3.01, 0.35, 0.55], [4.2, 0.12, 0.25]], tau: 0.5, chorus: { cents: 7, level: 0.65 }, hammer: { level: 0.22, tau: 0.003, low: 3500 }, damp: 0.2 }), gain: 1 },
    { voice: fm({ ratio: 2, index: 1.2, indexTau: 0.08, tau: 0.35, release: 0.12, attack: 0.001 }), gain: 0.2, mult: 2 },
  ),
  /** Glittering ice: a glockenspiel with a high FM bell struck with it. */
  "ice-bell": layer(
    { voice: modal({ partials: [[1, 1, 1], [2.76, 0.5, 0.5], [5.4, 0.28, 0.3], [8.93, 0.15, 0.18]], tau: 0.7, free: true, hammer: { level: 0.14, tau: 0.002, low: 8000 } }), gain: 1 },
    { voice: fm({ ratio: 3.5, index: 2.2, indexTau: 0.4, tau: 1, release: 0.3, attack: 0.001 }), gain: 0.3, mult: 2 },
  ),
  "music-box": modal({ partials: [[1, 1, 1], [3.01, 0.4, 0.4], [6.1, 0.18, 0.2]], tau: 0.5, free: true, hammer: { level: 0.2, tau: 0.001, low: 9000 } }),
  /** A jazz organ: percussive upper partials on the attack, the drawbars set for a singing line. */
  "organ-jazz": organ({ harmonics: [1, 0.9, 0.7, 0.35, 0.15, 0.1], shimmer: { rate: 6.1, depth: 0.15, cents: 5 }, chiff: 0.07, attack: 0.006 }),
  /** A fairground calliope: steam-bright pipes, a breath at each note. */
  calliope: organ({ harmonics: [1, 0.3, 0.8, 0.2, 0.6, 0.15, 0.45, 0.1, 0.3], shimmer: { rate: 4.2, depth: 0.1, cents: 12 }, chiff: 0.14, attack: 0.012 }),
  /** A bright, hard synth arp pluck with a ping on top. */
  "arp-synth": layer(
    {
      voice: subtractive({
        oscs: [{ wave: "saw", cents: -8, level: 0.5 }, { wave: "saw", cents: 8, level: 0.5 }],
        cutoff: 450, keytrack: 1.6, envOct: 3.2, fdecay: 0.1, fsustain: 0, q: 2.2,
        attack: 0.002, decay: 0.16, sustain: 0.05, release: 0.07, fixedPhase: true, velBright: 0.8,
      }),
    },
    { voice: fm({ ratio: 3, index: 1.5, indexTau: 0.05, tau: 0.12, release: 0.05, attack: 0.001 }), gain: 0.18, mult: 2 },
  ),
} satisfies Record<string, Voice>;

export type InstrumentName = keyof typeof INSTRUMENTS;

export function isInstrument(name: string): name is InstrumentName {
  return Object.prototype.hasOwnProperty.call(INSTRUMENTS, name);
}
