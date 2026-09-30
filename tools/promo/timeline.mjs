/**
 * The promo's plan: what is on screen when, and what the soundtrack adds to it.
 * Scenes overlap by XFADE seconds (a cross-fade, never a wipe). A game's `pre`
 * is how long the real game is simulated (unrecorded) before its clip begins,
 * and its `seed` picks the game's own random draw, so a take is repeatable.
 */
export const FPS = 60;
export const XFADE = 0.4;

export const SEGMENTS = [
  { id: "cold", scene: "cold", dur: 3.6, fadeIn: 0.6, pip: false },
  { id: "title", scene: "title", dur: 3.0, pip: false, transition: "fadeblack" },
  {
    id: "western",
    scene: "western",
    dur: 7.4,
    pre: 2.2,
    seed: 1851,
    caption: { title: "High Noon", line: "Six shots. Spare the townsfolk.", from: 1.0, to: 6.5 },
  },
  {
    id: "night",
    scene: "night",
    dur: 7.4,
    pre: 3.0,
    seed: 1851,
    caption: { title: "Dead of Night", line: "Follow the beam. The dead follow you.", from: 1.0, to: 6.5 },
  },
  {
    id: "orbit",
    scene: "orbit",
    dur: 7.4,
    pre: 4.0,
    seed: 1851,
    caption: { title: "Orbital Decay", line: "Break the wreckage before it reaches the glass.", from: 1.0, to: 6.5 },
  },
  {
    id: "ridge",
    scene: "ridge",
    dur: 7.4,
    pre: 3.0,
    seed: 1851,
    caption: { title: "Overwatch Ridge", line: "One rifle, a six-times scope. Read the wind.", from: 1.0, to: 6.5 },
  },
  { id: "end", scene: "end", dur: 4.8, fadeOut: 0.7, pip: false },
];

/** Where each segment starts on the video's clock, and the total length. */
export function layout() {
  let t = 0;
  const starts = SEGMENTS.map((s, i) => {
    const start = t;
    t += s.dur - (i < SEGMENTS.length - 1 ? XFADE : 0);
    return start;
  });
  return { starts, total: t };
}

/** Sounds the cards add themselves (the games' own cues, played by the same engine), at video times. */
export function cardSounds(starts) {
  const at = (id) => starts[SEGMENTS.findIndex((s) => s.id === id)];
  return [
    // The finger fires, and the illustration's target answers.
    { t: at("cold") + 1.23, cue: "revolver_shot", options: { volume: 0.55 } },
    { t: at("cold") + 1.3, cue: "calib_hit", options: { volume: 1 } },
    { t: at("title") + 0.35, cue: "ui_confirm", options: { volume: 1 } },
    { t: at("end") + 0.4, cue: "calib_done", options: { volume: 1 } },
  ];
}

// The bed: A minor ninth, F major seventh, C major seventh, G sixth, then home on C.
const hz = (n) => 440 * Math.pow(2, (n - 69) / 12);
export function music(starts, total) {
  const at = (id) => starts[SEGMENTS.findIndex((s) => s.id === id)];
  const chord = (t, ...midi) => ({ t, notes: midi.map(hz) });
  const chords = [
    chord(0, 45, 52, 57, 60, 64, 71), // Am9
    chord(at("title") + 1.6, 41, 48, 53, 57, 60, 64), // Fmaj7
    chord(at("night") - 0.6, 48, 55, 59, 64, 67), // Cmaj7
    chord(at("ridge") - 0.6, 43, 50, 57, 62, 64, 71), // G6/9
    chord(at("end") - 0.2, 36, 48, 55, 59, 64, 67, 74), // Cmaj9
  ];
  const plucks = [];
  const box = (t, notes, gap, g = 1) => notes.forEach((n, i) => plucks.push({ t: t + i * gap, f: hz(n), g }));
  // The cold open and the title: a small rising figure.
  box(at("cold") + 0.5, [69, 72, 76], 0.3, 0.7);
  box(at("title") + 0.35, [76, 79, 83, 88], 0.26, 0.9);
  // The end card: the figure comes home.
  box(at("end") + 0.3, [72, 76, 79, 84, 88], 0.34, 0.9);
  return { chords, plucks, padGain: 0.055 };
}
