/**
 * How each track theme looks: its sky, light, ground and paint, as plain data.
 * The world builders read these and nothing else, so a new theme is a new
 * entry here plus whatever scenery it wants (scenery.ts).
 *
 * Meadow is a bright morning, canyon the last warm hour of the day, harbour a
 * clear night under lamps. All three are saturated but never garish: the
 * karts are the loudest things on screen.
 */
import type { TrackTheme } from "../../track/geometry";

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
  barrier: "tyres" | "fence" | "bollards";
  /** Dust thrown up off the road. */
  dust: string;
  /** World margin around the track's bounds, metres, and the ground's grid cell. */
  margin: number;
}

export const THEMES: Record<TrackTheme, ThemeStyle> = {
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
    fog: { colour: "#cfe6fb", near: 110, far: 560 },
    light: { skyColour: "#d7e9ff", groundColour: "#8dba62", hemiIntensity: 1.75, sunColour: "#fff1d2", sunIntensity: 2.5 },
    exposure: 1.0,
    road: { base: "#4b5059", speckle: "#6a707a", line: "#f4f4ef", edge: "#fbfbf6", shoulder: "#4b5059", dash: true },
    verge: ["#79d255", "#6ac648"],
    kerb: ["#ff3b30", "#fbfbf7"],
    barrier: "tyres",
    dust: "#c8b78a",
    margin: 300,
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
    light: { skyColour: "#6f86d8", groundColour: "#26305c", hemiIntensity: 1.55, sunColour: "#9fb4ff", sunIntensity: 1.5 },
    exposure: 1.0,
    road: { base: "#3a4052", speckle: "#59607a", line: "#ffd25a", edge: "#f1f4ff", shoulder: "#2f3547", dash: true },
    verge: ["#8d97ad", "#7d879e"],
    kerb: ["#ffb300", "#262c3c"],
    barrier: "bollards",
    dust: "#8f98ae",
    margin: 260,
  },
};

export function styleFor(theme: TrackTheme): ThemeStyle {
  return THEMES[theme] ?? THEMES.meadow;
}
