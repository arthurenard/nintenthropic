/**
 * How each track theme looks: its sky, light, ground and paint, as plain data.
 * The world builders read these and nothing else, so a new theme is a new
 * entry here plus whatever its ground (terrain.ts), scenery (scenery.ts) and
 * landmarks (landmarks/) want.
 *
 * Nine worlds, each its own hour: the meadow a bright morning, the canyon the
 * last warm hour of the day, the harbour a clear night under lamps; the
 * kitchen a golden late afternoon through a window; the glacier pass blue
 * hour with an aurora; the volcano a red sky over black rock and lava; the
 * funfair dusk with every ride lit; the starlight ribbon deep space; the
 * palm island midday on a turquoise sea. All are saturated but never
 * garish: the karts are the loudest things on screen.
 */
import type { TrackTheme } from "../../track/geometry";

/** How a theme walls the road in. */
export type BarrierStyle =
  /** A double row of red and white tyres. */
  | "tyres"
  /** Wooden posts and rails. */
  | "fence"
  /** A painted kerb wall with lamp bollards. */
  | "bollards"
  /** Sugar cubes, two high. */
  | "sugar"
  /** A snowbank with slalom poles. */
  | "snowbank"
  /** Basalt boulders with glowing seams. */
  | "basalt"
  /** Candy-striped rails strung with bulbs. */
  | "railing"
  /** A glowing holographic rail on posts. */
  | "hologram"
  /** Bamboo poles lashed with rope. */
  | "bamboo";

export interface ThemeStyle {
  id: TrackTheme;
  night: boolean;
  sky: {
    zenith: string;
    mid: string;
    horizon: string;
    /** Direction toward the sun (or moon), not necessarily unit length. */
    sunDir: [number, number, number];
    sunColour: string;
    /** Angular radius of the disc, radians. */
    sunSize: number;
    glow: string;
    stars: boolean;
    clouds: boolean;
    cloudColour: string;
    cloudShade: string;
    /** Curtains of light across the sky (the glacier pass) or a nebula's colour clouds (space). */
    extras?: "aurora" | "nebula";
  };
  fog: { colour: string; near: number; far: number };
  light: {
    skyColour: string;
    groundColour: string;
    hemiIntensity: number;
    sunColour: string;
    sunIntensity: number;
  };
  exposure: number;
  road: {
    base: string;
    speckle: string;
    line: string;
    edge: string;
    /** The road fades to this at its very edges (dust, wet shoulders). */
    shoulder: string;
    dash: boolean;
  };
  /** The two mowing/paving stripes of the verge, and the barrier the theme uses. */
  verge: [string, string];
  kerb: [string, string];
  barrier: BarrierStyle;
  /** Dust thrown up off the road. */
  dust: string;
  /** World margin around the track's bounds, metres, and the ground's grid cell. */
  margin: number;
  /** Street lamps with pools of light along the road (the harbour). */
  lamps: boolean;
  /** Bunting along the start straight (daytime worlds). */
  bunting: boolean;
}

const FIRST_THEMES: Record<"meadow" | "canyon" | "harbour", ThemeStyle> = {
  meadow: {
    id: "meadow",
    night: false,
    sky: {
      zenith: "#2b78e4",
      mid: "#62aef5",
      horizon: "#d3ebff",
      sunDir: [0.5, 0.74, -0.45],
      sunColour: "#fff6dc",
      sunSize: 0.045,
      glow: "#ffe9b5",
      stars: false,
      clouds: true,
      cloudColour: "#ffffff",
      cloudShade: "#c7dcf5",
    },
    fog: { colour: "#c4def6", near: 140, far: 760 },
    light: { skyColour: "#d7e9ff", groundColour: "#8dba62", hemiIntensity: 1.45, sunColour: "#fff1d2", sunIntensity: 2.2 },
    exposure: 1.0,
    road: { base: "#4b5059", speckle: "#6a707a", line: "#f4f4ef", edge: "#fbfbf6", shoulder: "#4b5059", dash: true },
    verge: ["#79d255", "#6ac648"],
    kerb: ["#ff3b30", "#fbfbf7"],
    barrier: "tyres",
    dust: "#c8b78a",
    margin: 300,
    lamps: false,
    bunting: true,
  },
  canyon: {
    id: "canyon",
    night: false,
    sky: {
      zenith: "#3b82d0",
      mid: "#f3b27c",
      horizon: "#ffe0b0",
      sunDir: [-0.72, 0.36, 0.55],
      sunColour: "#fff0c8",
      sunSize: 0.055,
      glow: "#ffb866",
      stars: false,
      clouds: true,
      cloudColour: "#ffe8d0",
      cloudShade: "#e9a77e",
    },
    fog: { colour: "#f6cc9b", near: 100, far: 520 },
    light: { skyColour: "#ffd9b0", groundColour: "#c98550", hemiIntensity: 1.6, sunColour: "#ffd9a0", sunIntensity: 2.9 },
    exposure: 1.0,
    road: { base: "#57504d", speckle: "#7b726c", line: "#f6e6c4", edge: "#fff3dc", shoulder: "#b99a72", dash: true },
    verge: ["#e6c088", "#dcb37a"],
    kerb: ["#ff7a1a", "#fff2dc"],
    barrier: "fence",
    dust: "#d9b680",
    margin: 320,
    lamps: false,
    bunting: true,
  },
  harbour: {
    id: "harbour",
    night: true,
    sky: {
      zenith: "#050a22",
      mid: "#122052",
      horizon: "#3a4f94",
      sunDir: [-0.45, 0.5, 0.74],
      sunColour: "#f2f6ff",
      sunSize: 0.032,
      glow: "#7e9cff",
      stars: true,
      clouds: false,
      cloudColour: "#5a6ea8",
      cloudShade: "#2b3a70",
    },
    fog: { colour: "#26356f", near: 70, far: 430 },
    light: { skyColour: "#8aa2f0", groundColour: "#3d4a82", hemiIntensity: 2.1, sunColour: "#b4c6ff", sunIntensity: 2.3 },
    exposure: 1.0,
    road: { base: "#4a5370", speckle: "#6c7698", line: "#ffd25a", edge: "#f1f4ff", shoulder: "#3a425c", dash: true },
    verge: ["#8d97ad", "#7d879e"],
    kerb: ["#ffb300", "#262c3c"],
    barrier: "bollards",
    dust: "#8f98ae",
    margin: 260,
    lamps: true,
    bunting: false,
  },
};

const NEW_THEMES: Record<"kitchen" | "snow" | "volcano" | "funfair" | "space" | "palm", ThemeStyle> = {
  // Toy karts on a giant counter in late-afternoon light: warm gold, long soft shadows, a walnut road on pale marble.
  kitchen: {
    id: "kitchen",
    night: false,
    sky: {
      zenith: "#8a76b4",
      mid: "#f0b27c",
      horizon: "#ffe1b0",
      sunDir: [0.62, 0.3, -0.72],
      sunColour: "#fff0c4",
      sunSize: 0.07,
      glow: "#ffb866",
      stars: false,
      clouds: false,
      cloudColour: "#fff0dc",
      cloudShade: "#f0b890",
    },
    fog: { colour: "#f4d2a4", near: 170, far: 980 },
    light: { skyColour: "#ffe8cc", groundColour: "#d9a468", hemiIntensity: 1.5, sunColour: "#ffd29a", sunIntensity: 2.8 },
    exposure: 1.0,
    road: { base: "#5b3b2a", speckle: "#7d573e", line: "#f6e7c6", edge: "#fff4dc", shoulder: "#3d2619", dash: true },
    verge: ["#e8625d", "#fbefe6"],
    kerb: ["#2f7fd6", "#fbf7ee"],
    barrier: "sugar",
    dust: "#f6ecd8",
    margin: 240,
    lamps: false,
    bunting: false,
  },
  // An alpine pass at blue hour: deep blue sky, a rosy glow behind the peaks, an aurora, snow that holds the last light.
  snow: {
    id: "snow",
    night: true,
    sky: {
      zenith: "#0b1745",
      mid: "#35569f",
      horizon: "#b4c9ee",
      sunDir: [-0.62, 0.05, 0.78],
      sunColour: "#ffd2d8",
      sunSize: 0.05,
      glow: "#ff9fb4",
      stars: true,
      clouds: false,
      cloudColour: "#8fa6d8",
      cloudShade: "#4d6199",
      extras: "aurora",
    },
    fog: { colour: "#9db5dd", near: 100, far: 680 },
    light: { skyColour: "#9ab6ff", groundColour: "#e6eeff", hemiIntensity: 2.0, sunColour: "#d2dcff", sunIntensity: 1.7 },
    exposure: 1.0,
    road: { base: "#434b5e", speckle: "#6a738a", line: "#fbfdff", edge: "#ffffff", shoulder: "#dbe7f6", dash: true },
    verge: ["#eef4fc", "#dce8f8"],
    kerb: ["#e8453c", "#ffffff"],
    barrier: "snowbank",
    dust: "#ffffff",
    margin: 320,
    lamps: false,
    bunting: false,
  },
  // Black basalt among rivers of lava under a red sky; the road itself picks up the glow.
  volcano: {
    id: "volcano",
    night: true,
    sky: {
      zenith: "#240814",
      mid: "#7d2418",
      horizon: "#ff8c3c",
      sunDir: [0.25, 0.1, 0.96],
      sunColour: "#ffc27a",
      sunSize: 0.085,
      glow: "#ff6a2a",
      stars: false,
      clouds: true,
      cloudColour: "#7a4a44",
      cloudShade: "#2e1418",
    },
    fog: { colour: "#74281a", near: 80, far: 560 },
    light: { skyColour: "#ff9a68", groundColour: "#d4501a", hemiIntensity: 1.5, sunColour: "#ffa466", sunIntensity: 1.9 },
    exposure: 1.0,
    road: { base: "#2c2a32", speckle: "#4c4854", line: "#ffb04a", edge: "#ffd592", shoulder: "#1b181f", dash: true },
    verge: ["#3b3742", "#312d38"],
    kerb: ["#ff6a1a", "#25222b"],
    barrier: "basalt",
    dust: "#6e6168",
    margin: 320,
    lamps: false,
    bunting: false,
  },
  // Dusk at the fair: a purple sky going to coral, strings of bulbs, every ride lit.
  funfair: {
    id: "funfair",
    night: true,
    sky: {
      zenith: "#190f4d",
      mid: "#7a2f93",
      horizon: "#ff7f70",
      sunDir: [0.3, 0.1, 0.95],
      sunColour: "#ffb690",
      sunSize: 0.06,
      glow: "#ff8a8a",
      stars: true,
      clouds: false,
      cloudColour: "#b06ab0",
      cloudShade: "#5a2a7a",
    },
    fog: { colour: "#6b3a8c", near: 120, far: 700 },
    light: { skyColour: "#caa2ff", groundColour: "#6a4378", hemiIntensity: 1.95, sunColour: "#ffb4a4", sunIntensity: 1.5 },
    exposure: 1.0,
    road: { base: "#3b3252", speckle: "#5e547a", line: "#ffe27a", edge: "#ffffff", shoulder: "#2a2340", dash: true },
    verge: ["#5d4482", "#523a76"],
    kerb: ["#ff3d7f", "#fff0d0"],
    barrier: "railing",
    dust: "#cdb3e0",
    margin: 280,
    lamps: false,
    bunting: false,
  },
  // Deep space: a glassy road ribbon with glowing edges over a ringed planet; there is no ground.
  space: {
    id: "space",
    night: true,
    sky: {
      zenith: "#02030e",
      mid: "#0a0e33",
      horizon: "#2a1f6b",
      sunDir: [0.55, 0.38, -0.74],
      sunColour: "#fff6e0",
      sunSize: 0.03,
      glow: "#9fb0ff",
      stars: true,
      clouds: false,
      cloudColour: "#5a5ab0",
      cloudShade: "#2a2a6a",
      extras: "nebula",
    },
    fog: { colour: "#0b0d33", near: 220, far: 1200 },
    light: { skyColour: "#8ea4ff", groundColour: "#6a38b0", hemiIntensity: 1.7, sunColour: "#fff0dc", sunIntensity: 2.3 },
    exposure: 1.0,
    road: { base: "#0f2c4e", speckle: "#2c5c9c", line: "#74f2ff", edge: "#8af4ff", shoulder: "#0a2040", dash: true },
    verge: ["#143562", "#102c54"],
    kerb: ["#00e5ff", "#ff3ec9"],
    barrier: "hologram",
    dust: "#7ab4ff",
    margin: 160,
    lamps: false,
    bunting: false,
  },
  // Midday on a sunny island: turquoise sea, pale sand, white clouds.
  palm: {
    id: "palm",
    night: false,
    sky: {
      zenith: "#1c78de",
      mid: "#58bdf4",
      horizon: "#daf5ff",
      sunDir: [0.38, 0.84, -0.3],
      sunColour: "#fffbe8",
      sunSize: 0.045,
      glow: "#fff0c0",
      stars: false,
      clouds: true,
      cloudColour: "#ffffff",
      cloudShade: "#c9e2f8",
    },
    fog: { colour: "#c2eaf6", near: 240, far: 1150 },
    light: { skyColour: "#dff4ff", groundColour: "#f0d79e", hemiIntensity: 1.5, sunColour: "#fff2d2", sunIntensity: 2.5 },
    exposure: 1.0,
    road: { base: "#6a6561", speckle: "#8f8981", line: "#ffffff", edge: "#ffffff", shoulder: "#d8c598", dash: true },
    verge: ["#f1dba4", "#e9d096"],
    kerb: ["#17c3c0", "#fffaf0"],
    barrier: "bamboo",
    dust: "#f1dba8",
    margin: 360,
    lamps: false,
    bunting: true,
  },
};

export const THEMES: Record<TrackTheme, ThemeStyle> = { ...FIRST_THEMES, ...NEW_THEMES };

export function styleFor(theme: TrackTheme): ThemeStyle {
  return THEMES[theme] ?? THEMES.meadow;
}
