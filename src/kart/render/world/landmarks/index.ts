/**
 * The registry of everything the picture can build beside, over or on the
 * road, by the names the tracks use (docs/GRIP_PRIX.md). One module per
 * theme: a file, or a folder for the funfair, the kitchen and the snow, whose
 * models are many. `common.ts` holds what every theme shares (the rubber
 * duck); kit.ts and rockKit.ts hold the shapes they are all built from.
 *
 * A name the picture does not know is left out (a landmark) or drawn as a
 * plain marker ball (a hazard), never an error: a track written before a
 * model exists still loads.
 */
import * as canyon from "./canyon";
import * as common from "./common";
import * as funfair from "./funfair";
import * as harbour from "./harbour";
import * as kitchen from "./kitchen";
import * as meadow from "./meadow";
import * as palm from "./palm";
import * as palm2 from "./palm2";
import * as snow from "./snow";
import * as space from "./space";
import * as volcano from "./volcano";
import * as volcano2 from "./volcano2";
import type { HazardSpec, LandmarkSpec } from "./types";

const THEME_FILES = [meadow, canyon, harbour, kitchen, snow, volcano, volcano2, funfair, space, palm, palm2, common];

/** Every landmark by name. Names are unique across themes. */
export const LANDMARKS: Readonly<Record<string, LandmarkSpec>> = Object.assign({}, ...THEME_FILES.map((m) => m.LANDMARKS));

/** Every hazard by name ("boulder" and "crab" serve two themes and look right in each). */
export const HAZARDS: Readonly<Record<string, HazardSpec>> = Object.assign({}, ...THEME_FILES.map((m) => m.HAZARDS));

/** The names each theme's tracks may use, for the gallery and the dev tracks. */
export const THEME_LANDMARKS: Readonly<Record<string, readonly string[]>> = {
  meadow: ["windmill", "barn", "barn-run", "pond", "hay-bales", "hot-air-balloon", "sheep", "flower-field", "farm-gate", "oak"],
  canyon: ["mesa", "rock-arch", "cactus-grove", "water-tower", "mine-cart", "mine-tunnel", "rope-bridge", "headframe", "dynamite-shack"],
  harbour: ["crane", "lighthouse", "ship", "ship-deck", "containers", "warehouse", "buoy", "drawbridge"],
  kitchen: ["teapot", "fruit-bowl", "toaster", "grater", "drawer", "salt-shaker", "pepper-mill", "cookbook", "cereal-box", "mug", "fork-arch", "spoon-arch", "sink", "window", "wall-clock", "mixer", "cooker", "spatula", "drainer"],
  snow: ["igloo", "cabin", "snowman", "ice-arch", "ice-cave", "pine-snow", "gondola", "ski-jump", "frozen-falls"],
  volcano: ["volcano", "lava-fall", "basalt-columns", "stone-bridge", "obsidian-arch", "hot-spring", "lava-tube"],
  funfair: ["ferris-wheel", "carousel", "big-top", "rollercoaster", "entrance-arch", "food-stall", "balloon-stand", "hook-a-duck", "helter-skelter", "fireworks", "ferris-gate", "coaster-trestle", "cannon-tent", "safety-net"],
  space: ["ringed-planet", "ring-gate", "asteroid", "satellite", "space-station", "nebula"],
  palm: ["palm-tree", "beach-hut", "surfboard", "sandcastle", "beach-towel", "giant-ring", "wristwatch", "tiki-arch"],
};

/** The hazard kinds each theme's tracks may use, with how each moves (hazards.ts). */
export const THEME_HAZARDS: Readonly<Record<string, readonly { kind: string; motion: "cross" | "roll" | "bob" | "orbit" | "swing" | "crush" | "slide" }[]>> = {
  meadow: [{ kind: "hay-roll", motion: "roll" }, { kind: "sheep-flock", motion: "slide" }, { kind: "acorn", motion: "crush" }],
  canyon: [{ kind: "boulder", motion: "roll" }, { kind: "tumbleweed", motion: "cross" }, { kind: "rock-crusher", motion: "crush" }, { kind: "wrecking-ball", motion: "swing" }, { kind: "ore-cart", motion: "slide" }],
  harbour: [{ kind: "crab", motion: "cross" }, { kind: "forklift", motion: "cross" }, { kind: "swing-box", motion: "orbit" }, { kind: "cargo-box", motion: "swing" }],
  kitchen: [{ kind: "orange", motion: "roll" }, { kind: "pea", motion: "cross" }, { kind: "teacup", motion: "orbit" }, { kind: "toast", motion: "bob" }, { kind: "whisk", motion: "orbit" }, { kind: "drip", motion: "crush" }],
  snow: [{ kind: "penguin", motion: "cross" }, { kind: "snowball", motion: "roll" }, { kind: "yeti", motion: "bob" }, { kind: "icicle", motion: "crush" }, { kind: "arm-ball", motion: "orbit" }, { kind: "avalanche", motion: "slide" }],
  volcano: [{ kind: "fireball", motion: "bob" }, { kind: "boulder", motion: "roll" }, { kind: "geyser", motion: "bob" }, { kind: "ember-rock", motion: "crush" }, { kind: "lava-surge", motion: "slide" }],
  funfair: [{ kind: "teacup-ride", motion: "orbit" }, { kind: "bumper-car", motion: "cross" }, { kind: "arm-ball", motion: "orbit" }, { kind: "mallet", motion: "crush" }, { kind: "funhouse-panel", motion: "slide" }, { kind: "swing-boat", motion: "swing" }],
  space: [{ kind: "asteroid", motion: "orbit" }, { kind: "comet", motion: "roll" }, { kind: "meteor", motion: "crush" }, { kind: "plasma-orb", motion: "orbit" }],
  palm: [{ kind: "crab", motion: "cross" }, { kind: "coconut", motion: "roll" }, { kind: "beach-ball", motion: "roll" }, { kind: "tide-wave", motion: "slide" }, { kind: "coconut-bunch", motion: "crush" }],
};
