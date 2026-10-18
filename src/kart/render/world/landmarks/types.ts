/**
 * What a landmark or a hazard model is, as far as the rest of the picture is
 * concerned. A landmark is a set piece beside (or over) the road: a giant
 * teapot, a ferris wheel, an ice cave. A hazard is a thing that moves on its
 * own (an orange rolling down the counter, a penguin waddling across).
 *
 * Both are built in code from a MeshBuilder (world/builder.ts), a few
 * faceted shapes welded into one vertex-coloured geometry. A model never
 * touches the scene: it hands back geometry, and the layer (place.ts)
 * merges, places, bends and animates it. That is what keeps thirty
 * landmarks down to a handful of draw calls.
 *
 * Model space: metres, y up, the model's front is +z, its right is -x
 * (three.js's convention, as for the karts), its base is on y = 0 and it
 * stands about the origin. Colours are linear RGB (`rgb("#ff8800")`); a
 * component above 1 glows (it is drawn unlit, in the `glow` builder).
 */
import type { Object3D } from "three";
import type { TrackTheme } from "../../../track/geometry";
import type { MeshBuilder, V3 } from "../builder";

/** What a model is told when it is asked to build itself. */
export interface LandmarkContext {
  /** A seeded random source: the same landmark looks the same every time. */
  rnd: () => number;
  theme: TrackTheme;
  /** Night or dusk scenes: windows and lamps can glow. */
  night: boolean;
  /**
   * The `scale` the track asked for (default 1). The layer scales the model
   * itself.
   */
  scale: number;
  /**
   * For a span landmark only: metres of road it covers, and the road's half
   * width there. The model is built in the road's own frame: x is metres to
   * the RIGHT of the centre line, y up, z metres ALONG the road (travel is
   * +z), centred on 0, from -span/2 to +span/2. The layer bends it along the
   * road, so cut anything long into pieces of 3 m or less along z.
   */
  span: number;
  halfWidth: number;
}

/** A part that moves (a windmill's sails, a ferris wheel, a carousel's roof). */
export interface MovingPart {
  /** Geometry of the part, in model space as assembled (not about its pivot). */
  lit?: MeshBuilder;
  glow?: MeshBuilder;
  glass?: MeshBuilder;
  /** The point it turns about, in model space. */
  pivot: V3;
  /**
   * Poses the part for clock time `t` seconds: set `part.rotation` /
   * `part.position` (relative to the pivot) / `part.scale`. Cheap, please:
   * it runs every frame.
   */
  update(t: number, part: Object3D): void;
}

/** A soft round light (the stand-in for bloom): a lamp, a window, a bulb, a star. */
export interface Halo {
  x: number;
  y: number;
  z: number;
  /** Diameter, metres. */
  size: number;
  /** Linear RGB, may exceed 1. */
  colour: readonly [number, number, number];
  alpha: number;
  /** 0 steady, up to 1 flickers; each halo twinkles at its own phase. */
  twinkle?: number;
}

export interface LandmarkModel {
  /** Solid, lit, vertex coloured. */
  lit: MeshBuilder;
  /** Unlit and bright: windows, bulbs, neon, lava, anything that gives light. */
  glow?: MeshBuilder;
  /** Translucent (ice, glass, tent canvas, water): drawn with half opacity, no depth write. */
  glass?: MeshBuilder;
  moving?: MovingPart[];
  halos?: Halo[];
  /**
   * The model's normals are meant (a Blender-made one, rounded and bevelled):
   * the layer keeps them when it bakes the model into the chunk instead of
   * flattening every triangle, which is the look of the code-built models.
   */
  smooth?: boolean;
}

export interface LandmarkSpec {
  build(ctx: LandmarkContext): LandmarkModel;
  /** Over the road: built in the road's frame (see LandmarkContext.span), bent along it. */
  span?: boolean;
  /** Metres it covers if the track does not say (span landmarks). */
  defaultSpan?: number;
  /**
   * A thing that stands on the ground wants it flat under its footprint of
   * this radius; the layer keeps clutter off it. Default 0: no keep-out.
   */
  footprint?: number;
}

// ─── Hazards ─────────────────────────────────────────────────────────────────

/** What a hazard model is told when it is built. */
export interface HazardContext {
  rnd: () => number;
  theme: TrackTheme;
  night: boolean;
  /** The shared materials: lit (vertex colours, standard) and glow (vertex colours, unlit). */
  lit: import("three").Material;
  glow: import("three").Material;
}

/** Everything a hazard model needs to animate itself on one frame. */
export interface HazardState {
  /** Race clock, seconds. */
  time: number;
  /** Metres it has walked or rolled along its path so far (for legs and wheels). */
  travel: number;
  /** Metres per second right now. */
  speed: number;
  /** 0..1 through its cycle (hazardAt's `cycle`). */
  cycle: number;
  /** Height above the road: negative while a "bob" hazard is down in the ground. */
  height: number;
  /** Can it hit a kart now? */
  active: boolean;
  /** +1 / -1: which way it faces across its motion, for things that waddle. */
  heading: number;
}

export interface HazardModel {
  /** Built facing +z, base on y = 0; the layer places it and turns it to its heading. */
  root: Object3D;
  /** The radius, metres, this model naturally has; it is scaled to the hazard's own `radius`. */
  radius: number;
  /** Poses the model (legs, wheels, flames) after the layer has placed `root`. */
  update(s: HazardState): void;
}

export interface HazardSpec {
  build(ctx: HazardContext): HazardModel;
}
