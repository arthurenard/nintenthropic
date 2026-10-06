/**
 * What the pieces that build a track's meshes (track.ts, barriers.ts,
 * trackFeatures.ts) share: the sampled centre line with its banking, the
 * features worked out per sample, and the builders they write into.
 */
import type { TrackGeometry, TrackSample } from "../../track/geometry";
import type { QualitySettings } from "../quality";
import type { Bank } from "./bank";
import type { MeshBuilder, Rgb, V3 } from "./builder";
import type { Features } from "./features";
import type { Terrain } from "./terrain";
import type { ThemeStyle } from "./themes";

/** A soft round light standing in for bloom. */
export interface Glow {
  x: number;
  y: number;
  z: number;
  size: number;
  colour: Rgb;
  alpha: number;
}

export interface TrackBuild {
  track: TrackGeometry;
  style: ThemeStyle;
  terrain: Terrain;
  quality: QualitySettings;
  features: Features;
  bank: Bank;
  /** Number of samples, and the metres between them. */
  n: number;
  spacing: number;
  /** Sample `i`, wrapping. */
  S(i: number): TrackSample;
  /** A point `off` metres right of sample i's centre line, lifted by `dy`, following the bank. */
  P(i: number, off: number, dy?: number): V3;
  /** The chunk (about 48 m of track) sample `i` belongs to. */
  chunkOf(i: number): number;
  /** Solid, vertex coloured, lit; one builder per chunk. */
  deco: MeshBuilder[];
  /** Bright additive ribbons (glowing edges, holographic rails): one builder, vertex colour is the light. */
  additive: MeshBuilder;
  glows: Glow[];
  /** Where sample i's barrier stands beyond the road's edge on `side` (-1 left, 1 right), metres. */
  wall(i: number, side: -1 | 1): number;
  /** True where the barrier line at sample i on `side` runs through another stretch's ground: no barrier is drawn there. */
  hidden(i: number, side: -1 | 1): boolean;
  /** How open that edge is at sample i, 0..1. */
  open(i: number, side: -1 | 1): number;
  /** The road is missing at sample i (a gap to jump). */
  gap(i: number): boolean;
}

/** A cheap repeatable hash of an integer to 0..1, for varying repeated things without a random source. */
export function hash1(n: number): number {
  const h = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return h - Math.floor(h);
}
