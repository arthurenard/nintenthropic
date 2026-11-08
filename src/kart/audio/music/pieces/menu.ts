/**
 * Pick Your Kart: the title screen and the lobby. Sunny jazz-funk with a
 * city-pop shine, F major at 122 beats a minute. A Rhodes comps on rootless
 * extended chords (maj9, m9, 9) under a punchy synth bass that pops the octave,
 * a bright synth lead states a syncopated four-note hook, a clavinet answers it
 * in the gaps, a muted guitar scratches sixteenths, and brass stabs mark the
 * turnarounds, all over a tight pop kit with ghosted snares and a swung hat.
 * The Rhodes opens alone, the groove drops in, the hook plays twice (the second
 * time with the clavinet and horns), a bridge on longer notes over strings,
 * then the hook once more a tone higher with the horns on the melody, and a
 * two-bar turn on the dominant that falls back into the Rhodes. 40 bars, about
 * 79 seconds.
 */
import { bass, chords, drums, tune } from "./dsl";
import type { PieceSpec } from "../score";

// --- a little notation for the written-out comping --------------------------------------------------------------

/**
 * One bar from a rhythm and a chord: 'x' starts a note (the chord struck together), 'X' an accented one, '.' is a
 * rest and '-' holds what came before. "x--x....x-.." over "a3+c4+e4+g4" is a chord, another a dotted beat later...
 * The rhythm may be shorter than a bar (half a bar for a split bar).
 */
function bar(rhythm: string, notes: string, staccato = false): string {
  const items: { rest: boolean; accent: boolean; len: number }[] = [];
  for (const c of rhythm) {
    const last = items[items.length - 1];
    if (c === "-") {
      if (last) last.len++;
    } else if (c === ".") {
      if (last?.rest) last.len++;
      else items.push({ rest: true, accent: false, len: 1 });
    } else {
      items.push({ rest: false, accent: c === "X", len: 1 });
    }
  }
  return items.map((i) => (i.rest ? `r:${i.len}` : `${notes}${i.accent ? "!" : ""}${staccato ? "'" : ""}:${i.len}`)).join(" ");
}

/** A rest of ``n`` bars of 4/4. */
const rest = (n: number): string => Array.from({ length: n }, () => "r:16").join(" | ");

/** Puts a staccato mark on every note of a hand-written line. */
const crisp = (line: string): string => line.replace(/([a-g][#b]?\d)(?=[:+])/g, "$1'");

// The comping rhythms: the Rhodes plays one on odd bars and the other on even ones, so it answers itself.
const COMP1 = "x--x--X---x-x.x.";
const COMP2 = "x--x----X--x--x-";
const COMP_SPARSE = "x-----x---------";
const SCRATCH = "x.xx.Xx.x.xx.Xx.";

const alternate = (voicings: string[]): string => voicings.map((v, i) => bar(i % 2 === 0 ? COMP1 : COMP2, v)).join(" | ");
const scratch = (voicings: string[]): string => voicings.map((v) => bar(SCRATCH, v, true)).join(" | ");

// --- the hook ------------------------------------------------------------------------------------------------------

// Eight bars over Fmaj9 Dm9 Gm9 C9 Am7 Abmaj9 Gm9 C9. The hook: a skip up to a held fifth, back down the chord, three times in a
// row down the harmony (bars 1-3), a rising answer on the dominant (bar 4), then a longer line that peaks and settles.
const HOOK =
  "r:2 c5:2 e5:2 g5:3 e5:1 c5:2 r:4 | r:2 a4:2 c5:2 d5:3 c5:1 a4:2 r:4 | " +
  "r:2 bb4:2 d5:2 f5:3 d5:1 bb4:2 r:4 | r:2 g4:2 bb4:2 c5:2 e5:2 g5:4 r:2 | " +
  "e5:3 c5:1 a4:2 c5:2 e5:3 g5:1 a5:4 | g5:3 eb5:1 c5:2 eb5:2 g5:4 r:4 | " +
  "bb5:3 g5:1 d5:2 f5:2 g5:6 r:2 | g5:3 e5:1 c5:2 e5:2 bb4:2 c5:2 d5:2 r:2";

// The same hook with the last bar leaning forward into the bridge: a run up the chord.
const HOOK2 = HOOK.replace(/ \| g5:3 e5:1 c5:2 e5:2 bb4:2 c5:2 d5:2 r:2$/, " | g4:2 bb4:2 d5:2 e5:2 g5:2 bb5:2 d6:4");

// Eight bars over Bbmaj9 Am9 Dm9 G9 Cm9 F9 Bbmaj9 Am7|D9: longer notes that glide, a second tune over the same band.
const BRIDGE =
  "d6:6 c6:2 a5:4 f5:4 | e6:6 c6:2 a5:8 | f6:4 e6:2 d6:2 c6:4 a5:4 | d6:6 b5:2 g5:4 r:4 | " +
  "eb6:4 d6:2 c6:2 bb5:4 g5:4 | c6:3 a5:1 f5:4 eb5:4 g5:4 | d6:4 f6:4 a6:6 g6:2 | e6:4 c6:2 a5:2 f#5:2 a5:2 d6:4";

// The clavinet's answers in the gaps of the hook (A2 and the lift).
const CLAV = crisp(
  "r:12 a4:1 c5:1 e5:2 | r:12 a4:1 c5:1 d5:2 | r:12 bb4:1 d5:1 f5:2 | r:14 e5:2 | " + "r:16 | r:12 c5:1 eb5:1 g5:2 | r:14 d5:1 f5:1 | r:14 e5:1 g5:1",
);

// The turn: the hook's opening and its answer on Gm9 and C9, then a line that falls home to F.
const TURN_LEAD = "r:2 bb4:2 d5:2 f5:3 d5:1 bb4:2 r:4 | r:2 g4:2 bb4:2 c5:2 e5:2 g5:4 r:2 | bb4:4 d5:4 e5:4 g5:4 | f5:4 g5:2 bb5:2 e5:2 d5:2 c5:4";

// --- the Rhodes: rootless voicings, each chord moving as little as it can from the last ---------------------------------

const V_A = ["a3+c4+e4+g4", "a3+c4+e4+f4", "bb3+d4+f4+a4", "bb3+d4+e4+g4", "c4+e4+g4+a4", "c4+eb4+g4+bb4", "d4+f4+a4+bb4", "bb3+d4+e4+g4"];
const V_B = ["a3+c4+d4+f4", "g3+b3+c4+e4", "a3+c4+e4+f4", "b3+d4+f4+a4", "bb3+d4+eb4+g4", "a3+c4+eb4+g4", "a3+c4+d4+f4"];
const RHODES_A = alternate(V_A);
const RHODES_B = alternate(V_B) + " | " + bar("x--x--X-", "c4+e4+g4+a4") + " " + bar("x--x--x-", "c4+e4+f#4+a4");
// (a bar is eight steps for each of its two chords, so the Rhodes plays half a bar of each)

const CHANK_B = scratch(V_B) + " | " + bar("x.xx.Xx.", "c4+e4+g4+a4", true) + " " + bar("x.xx.Xx.", "c4+e4+f#4+a4", true);

const RHODES_INTRO = bar(COMP_SPARSE, V_A[0]!) + " | " + bar(COMP2, V_A[0]!);
const RHODES_INTRO2 = bar(COMP1, "bb3+d4+f4+a4") + " | " + bar(COMP2, "bb3+d4+e4+g4");
const RHODES_TURN =
  bar(COMP1, "bb3+d4+f4+a4") +
  " | " +
  bar(COMP2, "bb3+d4+e4+g4") +
  " | " +
  bar("x--x--X-", "bb3+d4+f4+a4") +
  " " +
  bar("x--x--x-", "bb3+d4+e4+g4") +
  " | " +
  bar("x--x--X-", "bb3+c4+f4+g4") +
  " " +
  bar("x-x-X-x-", "bb3+d4+e4+g4");

// Horn stabs on the last bars of the phrases: C9 on the "and" of three and the "and" of four.
const STAB = "bb4+d5+e5+g5";
const STABS_A2 = rest(3) + " | " + bar("..........X.x-..", STAB) + " | " + rest(3) + " | " + bar("..........X.x-..", STAB);
const STABS_B = rest(7) + " | " + bar("........X-X-X-..", "c5+e5+f#5+a5");
const STABS_TURN = rest(3) + " | " + bar("........X-.-X-X.", "bb4+c5+f5+g5");

// The drums.
const groove = {
  kick: "X..o..x...x..o..",
  snare: "....X..o.o..X.o.",
  hat: "xoxoxoxoxoxoxo..",
  "hat-open": "..............x.",
};
const grooveBridge = {
  kick: "X.....x.......o.",
  rim: "....x.......x...",
  clap: "....x.......x...",
  hat: "xoxoxoxoxoxoxoxo",
  tambourine: "..x...x...x...x.",
};
const grooveLift = {
  ...groove,
  clap: "....x.......x...",
  tambourine: "x.x.x.x.x.x.x.x.",
};
const grooveIntro = { rim: "....x.......x...", hat: "x.x.x.x.x.x.x.x.", kick: "X.......X......." };
const fill = { snare: "o.o.xxXX" };
const fillBig = { snare: "xxxxxxXX", "tom-mid": "......x.", kick: "X......." };

export const menu: PieceSpec = {
  id: "menu",
  name: "Pick Your Kart",
  key: { tonic: "F", scale: "major" },
  bpm: 122,
  swing: 0.12,
  rack: {
    bass: { inst: "bass-funk", level: -2.5, pan: 0, highpass: 45, duck: 0.25, comp: { threshold: -17, ratio: 3, attack: 0.01, release: 0.1 } },
    rhodes: {
      inst: "rhodes-bright",
      level: -4.5,
      pan: -0.2,
      reverb: 0.2,
      chorus: 0.35,
      highpass: 140,
      lowpass: 5500,
      tremolo: { rate: 4.6, depth: 0.16, pan: true },
    },
    lead: {
      inst: "lead-funk",
      level: 0,
      pan: 0.05,
      reverb: 0.22,
      delay: 0.18,
      highpass: 350,
      lowpass: 7000,
      comp: { threshold: -16, ratio: 2.5, attack: 0.008, release: 0.1 },
    },
    lead2: { inst: "epiano", level: -0.5, pan: 0.05, reverb: 0.25, delay: 0.2, highpass: 300, lowpass: 6500 },
    clav: { inst: "clav", level: -3, pan: 0.3, reverb: 0.1, delay: 0.12, highpass: 400, lowpass: 6500 },
    chank: { inst: "gtr-muted", level: -7, pan: 0.45, reverb: 0.06, highpass: 500, lowpass: 5500 },
    brass: { inst: "brass-stab", level: -4, pan: -0.15, reverb: 0.22, highpass: 300, lowpass: 6500 },
    horns: { inst: "brass-section", level: -5, pan: -0.1, reverb: 0.25, highpass: 200, lowpass: 5500 },
    pad: { inst: "string-ens", level: -9.5, pan: 0.05, reverb: 0.35, chorus: 0.3, lowpass: 3200, highpass: 180 },
    drums: { inst: "drums", level: -3.5, kit: "pop" },
  },
  fx: {
    reverb: { t60: 1.3, size: 0.55, mix: 0.22, predelay: 0.014, damping: 0.5 },
    delay: { beats: 0.75, feedback: 0.28, tone: 3000, mix: 0.16 },
    master: { air: 1.2 },
  },
  sections: [
    {
      name: "Rhodes",
      bars: 2,
      level: 0.8,
      chords: "Fmaj9 Fmaj9",
      parts: {
        rhodes: tune(RHODES_INTRO, { vel: 0.72 }),
        drums: drums(grooveIntro, { vel: 0.8 }),
      },
    },
    {
      name: "Drop",
      bars: 2,
      level: 0.9,
      chords: "Gm9 C9",
      parts: {
        bass: bass("funkSparse", { floor: 36 }),
        rhodes: tune(RHODES_INTRO2, { vel: 0.74 }),
        chank: tune(scratch(["bb3+d4+f4+a4", "bb3+d4+e4+g4"]), { vel: 0.5 }),
        brass: tune(rest(1) + " | " + bar("..........X.x-..", STAB), { vel: 0.8 }),
        drums: drums(groove, { fill, fillEvery: 2, vel: 0.85 }),
      },
    },
    {
      name: "A",
      bars: 8,
      level: 0.94,
      chords: "Fmaj9 Dm9 Gm9 C9 Am7 Abmaj9 Gm9 C9",
      parts: {
        bass: bass("funkA"),
        rhodes: tune(RHODES_A, { vel: 0.7 }),
        lead: tune(HOOK, { vel: 0.8 }),
        chank: tune(scratch(V_A), { vel: 0.5 }),
        drums: drums(groove, { fill, fillEvery: 4 }),
      },
    },
    {
      name: "A2",
      bars: 8,
      level: 1,
      chords: "Fmaj9 Dm9 Gm9 C9 Am7 Abmaj9 Gm9 C9",
      parts: {
        bass: bass("funkB"),
        rhodes: tune(RHODES_A, { vel: 0.7 }),
        lead: tune(HOOK2, { vel: 0.82 }),
        clav: tune(CLAV, { vel: 0.8 }),
        chank: tune(scratch(V_A), { vel: 0.5 }),
        brass: tune(STABS_A2, { vel: 0.85 }),
        drums: drums(grooveLift, { fill, fillEvery: 4, vel: 0.95 }),
      },
    },
    {
      name: "B",
      bars: 8,
      level: 0.8,
      chords: "Bbmaj9 Am9 Dm9 G9 Cm9 F9 Bbmaj9 Am7|D9",
      parts: {
        bass: bass("funkSparse"),
        rhodes: tune(RHODES_B, { vel: 0.66 }),
        lead2: tune(BRIDGE, { vel: 0.72, shift: -12 }),
        chank: tune(CHANK_B, { vel: 0.5 }),
        pad: chords("pad", { centre: 62, size: 3, vel: 0.55 }),
        brass: tune(STABS_B, { vel: 0.85 }),
        drums: drums(grooveBridge, { fill, fillEvery: 4 }),
      },
    },
    {
      name: "Lift",
      bars: 8,
      level: 1.1,
      shift: 2,
      chords: "Fmaj9 Dm9 Gm9 C9 Am7 Abmaj9 Gm9 C9",
      parts: {
        bass: bass("funkLift"),
        rhodes: tune(RHODES_A, { vel: 0.72 }),
        lead: tune(HOOK, { vel: 0.84 }),
        horns: tune(HOOK, { vel: 0.7, shift: -12 }),
        clav: tune(CLAV, { vel: 0.8 }),
        chank: tune(scratch(V_A), { vel: 0.5 }),
        brass: tune(STABS_A2, { vel: 0.85 }),
        pad: chords("pad", { centre: 62, size: 3, vel: 0.5 }),
        drums: drums(grooveLift, { fill: fillBig, fillEvery: 4, crash: true, vel: 1 }),
      },
    },
    {
      name: "Turn",
      bars: 4,
      level: 0.94,
      chords: "Gm9 C9 Gm9|C9 C7sus4|C9",
      parts: {
        bass: bass("funkSparse"),
        rhodes: tune(RHODES_TURN, { vel: 0.72 }),
        lead: tune(TURN_LEAD, { vel: 0.78 }),
        brass: tune(STABS_TURN, { vel: 0.85 }),
        drums: drums(groove, { fill: fillBig, fillEvery: 2, vel: 0.9 }),
      },
    },
  ],
};
