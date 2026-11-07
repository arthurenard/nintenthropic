/**
 * The look of a finish-line photo on each track: a gentle colour filter that flatters faces (warm in the meadow, cool on
 * the glacier, night over the harbour...), the little animated effects that play over it, and the stamp that frames it.
 * By place too: the winner wears a crown and a gold burst, the podium sparkles, and last place gets a small rain cloud.
 * Plain data and plain choices, tested without a DOM (photoFx/effects.ts draws them).
 */

/** The effects that can play over a photo (effects.ts draws each as a pure function of the clock). */
export type EffectId =
  | "petals"
  | "butterflies"
  | "balloon"
  | "sprinkles"
  | "steam"
  | "flour"
  | "fireworks"
  | "beam"
  | "flare"
  | "dustDevil"
  | "tumbleweed"
  | "confetti"
  | "snow"
  | "frost"
  | "glitter"
  | "embers"
  | "lava"
  | "shooting"
  | "twinkle"
  | "planet"
  | "leaves"
  | "bubbles"
  | "glint";

/** What sits over a card by its place. */
export type Flourish = "crown" | "sparkle" | "cloud";

export interface Look {
  id: string;
  /** The track's name, for the stamp. */
  name: string;
  /** A CSS/canvas filter on the photo itself: mild, so faces keep their colour. */
  filter: string;
  /** A soft-light wash from the top to the foot of the picture, and how strong it is (0..1). */
  tint: readonly [top: string, foot: string, strength: number];
  /** How dark the corners go (0..1). */
  vignette: number;
  /** How far the sky is darkened toward night (0..1), so lights and fireworks show over a bright picture. */
  night: number;
  /** The effects, in drawing order. */
  effects: readonly EffectId[];
  /** The moment of the loop that shows the effects best: the frame the shared picture freezes. */
  peak: number;
  /** The stamp's accent colour. */
  accent: string;
}

/** The length of every effect's loop, seconds: each one repeats within it, so a clip joins up with itself. */
export const LOOP = 4;

const neutral: Look = {
  id: "",
  name: "Grip Prix",
  filter: "saturate(1.06) contrast(1.02)",
  tint: ["#9fc4ff", "#ffd6a8", 0.18],
  vignette: 0.28,
  night: 0,
  effects: ["glitter"],
  peak: 1.4,
  accent: "#ffd60a",
};

export const LOOKS: Record<string, Look> = {
  "meadow-loop": {
    id: "meadow-loop",
    name: "Meadow Loop",
    filter: "saturate(1.14) brightness(1.04) sepia(0.1) contrast(1.02)",
    tint: ["#fff0b0", "#ffb98a", 0.3],
    vignette: 0.24,
    night: 0,
    effects: ["balloon", "petals", "butterflies"],
    peak: 1.5,
    accent: "#8be36a",
  },
  "kitchen-rally": {
    id: "kitchen-rally",
    name: "Kitchen Rally",
    filter: "saturate(1.2) brightness(1.06) sepia(0.14) contrast(1.03)",
    tint: ["#ffe2b0", "#ff9d7a", 0.32],
    vignette: 0.22,
    night: 0,
    effects: ["steam", "sprinkles", "flour"],
    peak: 1.3,
    accent: "#ff8fb8",
  },
  "harbour-lights": {
    id: "harbour-lights",
    name: "Harbour Lights",
    filter: "saturate(1.1) brightness(0.98) contrast(1.08) hue-rotate(-6deg)",
    tint: ["#1d3b8f", "#e08bff", 0.36],
    vignette: 0.4,
    night: 0.55,
    effects: ["beam", "fireworks"],
    peak: 0.95,
    accent: "#ffd479",
  },
  "canyon-run": {
    id: "canyon-run",
    name: "Canyon Run",
    filter: "saturate(1.16) brightness(1.05) sepia(0.2) contrast(1.05)",
    tint: ["#ffd48a", "#e0763a", 0.36],
    vignette: 0.3,
    night: 0,
    effects: ["tumbleweed", "dustDevil", "flare"],
    peak: 1.2,
    accent: "#ffb15e",
  },
  "fun-fair": {
    id: "fun-fair",
    name: "Fun Fair",
    filter: "saturate(1.28) brightness(1.04) contrast(1.06)",
    tint: ["#7a3fe0", "#ff6fb5", 0.34],
    vignette: 0.34,
    night: 0.36,
    effects: ["fireworks", "confetti"],
    peak: 0.8,
    accent: "#ff5fa8",
  },
  "glacier-pass": {
    id: "glacier-pass",
    name: "Glacier Pass",
    filter: "saturate(0.96) brightness(1.08) contrast(1.02) hue-rotate(8deg)",
    tint: ["#bfe4ff", "#7fb4ff", 0.34],
    vignette: 0.2,
    night: 0,
    effects: ["frost", "snow", "glitter"],
    peak: 1.4,
    accent: "#bfe8ff",
  },
  "volcano-rush": {
    id: "volcano-rush",
    name: "Volcano Rush",
    filter: "saturate(1.18) brightness(0.98) contrast(1.1) sepia(0.12)",
    tint: ["#3a0e12", "#ff6a1f", 0.42],
    vignette: 0.42,
    night: 0.32,
    effects: ["lava", "embers"],
    peak: 1.6,
    accent: "#ff7a2f",
  },
  "starlight-ribbon": {
    id: "starlight-ribbon",
    name: "Starlight Ribbon",
    filter: "saturate(1.12) brightness(0.98) contrast(1.08) hue-rotate(-10deg)",
    tint: ["#2a1a78", "#7a52ff", 0.4],
    vignette: 0.42,
    night: 0.5,
    effects: ["planet", "twinkle", "shooting"],
    peak: 1.3,
    accent: "#b9a2ff",
  },
  "five-finger-circuit": {
    id: "five-finger-circuit",
    name: "Five Finger Circuit",
    filter: "saturate(1.2) brightness(1.06) contrast(1.03)",
    tint: ["#7ef0e0", "#ffe7a0", 0.3],
    vignette: 0.22,
    night: 0,
    effects: ["leaves", "bubbles", "glint"],
    peak: 1.5,
    accent: "#5fe8d2",
  },
};

/** The look of a track's photos (a plain one for a track with none of its own). */
export function lookFor(trackId: string | undefined): Look {
  return (trackId && LOOKS[trackId]) || neutral;
}

/**
 * What sits over a card by place: the winner's crown and gold burst (a lone player has won), the podium's sparkles, a
 * little rain cloud for the last of three or more, nothing for the rest.
 */
export function flourishFor(place: number, field: number): Flourish | null {
  if (place === 1) return "crown";
  if (place === 2 || place === 3) return "sparkle";
  if (field >= 3 && place >= field) return "cloud";
  return null;
}
