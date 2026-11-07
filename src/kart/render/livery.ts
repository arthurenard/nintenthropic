/**
 * A kart's livery: the second colour that makes the pattern on its flanks and
 * hood (the nodes `kart.livery.<class>.<pattern>` of karts.glb). The racer's
 * own colour is the paint; the driver brings a pattern and a colour for it,
 * and when that colour would vanish into the paint (cream stripes on a yellow
 * kart) it is swapped for a light or a dark that reads.
 */
import { characterById, weightOf, type LiveryPattern, type Weight } from "../characters";
import type { Rgb } from "./kartBuilder";
import { rgb } from "./kartBuilder";

export type { LiveryPattern };

/** How bright a colour looks (linear-ish luma of the kart's colour numbers, 0..1). */
function luma(c: Rgb): number {
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

const LIGHT: Rgb = [0.97, 0.97, 1];
const DARK: Rgb = [0.05, 0.05, 0.08];

/** The pattern colour to lay on paint `accent`: the one asked for if it reads against it, else white or near-black. */
export function liveryColour(accent: Rgb, wanted: string): Rgb {
  const want = rgb(wanted);
  const diff = Math.abs(luma(want) - luma(accent));
  const apart = Math.hypot(want[0] - accent[0], want[1] - accent[1], want[2] - accent[2]);
  if (diff > 0.22 || apart > 1.0) return want;
  return luma(accent) > 0.5 ? DARK : LIGHT;
}

/** The name of the file's node for a livery on a weight class's body. */
export function liveryNode(weight: Weight, pattern: LiveryPattern): string {
  return `kart.livery.${weight}.${pattern}`;
}

/** The pattern and the colour wanted for a character (a plain stripe pair for none). */
export function liveryOf(character: string | undefined): { pattern: LiveryPattern; colour: string } {
  return characterById(character)?.livery ?? { pattern: "twin", colour: "#f4f5f8" };
}

/** The weight class that picks a racer's body. */
export function bodyClass(character: string | undefined): Weight {
  return weightOf(character);
}
