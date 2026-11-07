/**
 * Launch and air sections: cannons, glides and half-pipe lips.
 *
 * A pad across the road throws the kart into a planned flight. The flight is not integrated with gravity; its height
 * above the road is a function of how far along the road the kart has got since the pad (`arcHeight`), so where it
 * lands is designed, not hoped for, a slow kart simply takes longer, and the sim, the bots, a guest's prediction and
 * every picture agree without a byte more on the network. The kart keeps its sideways freedom: the wheel turns its
 * flight (a glide turns twice as well as a jump), and a gentle autopilot keeps its course along the road, so a bend
 * under the flight does not carry a kart who lets go of the wheel into the scenery.
 *
 * Pure maths and tables; the sim's air code (kart.ts) applies it.
 */
import type { AirSection, TrackDef, TrackGeometry } from "../track/geometry";

export type ArcKind = AirSection["kind"];

export interface ArcSite {
  kind: ArcKind;
  /** The pad: the kart that crosses this line, within `lo`..`hi` metres right of the centre, is thrown. */
  s: number;
  lo: number;
  hi: number;
  /** Metres of road the flight covers, and the top of its arc. */
  length: number;
  height: number;
}

/** A glide climbs for this share of its length, then floats down. */
const GLIDE_RISE = 0.1;
/** How the glide's descent bends (1: straight down, more: it floats and settles late). */
const GLIDE_SINK = 1.5;

export function buildArcs(def: TrackDef, geo: TrackGeometry): ArcSite[] {
  const half = def.width / 2;
  return (def.air ?? []).map((a) => {
    const middle = a.offset ?? 0;
    const reach = a.width === undefined ? Infinity : a.width / 2;
    return {
      kind: a.kind,
      s: geo.wrap(a.at * geo.length),
      lo: Math.max(middle - reach, -half * 4),
      hi: Math.min(middle + reach, half * 4),
      length: a.length,
      height: a.height,
    };
  });
}

/** Height above the road after `d` metres of a flight of `site` (0 outside it). */
export function arcHeight(site: ArcSite, d: number): number {
  if (d <= 0 || d >= site.length) return 0;
  const u = d / site.length;
  if (site.kind !== "glide") return 4 * site.height * u * (1 - u);
  if (u < GLIDE_RISE) return site.height * Math.sin((u / GLIDE_RISE) * (Math.PI / 2));
  return site.height * (1 - Math.pow((u - GLIDE_RISE) / (1 - GLIDE_RISE), GLIDE_SINK));
}

/** The flight's climb per metre along the road (times the speed along the road, the vertical speed). */
export function arcSlope(site: ArcSite, d: number): number {
  const e = 0.25;
  const lo = Math.max(0, d - e);
  return (arcHeight(site, d + e) - arcHeight(site, lo)) / (d + e - lo);
}

/** The site whose flight `s` (metres along the lap) is in, or null. */
export function arcAt(arcs: readonly ArcSite[], geo: TrackGeometry, s: number): ArcSite | null {
  for (let i = 0; i < arcs.length; i++) {
    const a = arcs[i]!;
    const d = geo.delta(a.s, s);
    if (d >= -2 && d <= a.length + 6) return a;
  }
  return null;
}

/** The numbers of the air sections. */
export const AIR = {
  /** A cannon throws the kart at least this fast along the road (m/s). */
  cannonSpeed: 21,
  /** A planned flight never slows below this (m/s): a storm or a hit mid-flight cannot leave a kart hanging. */
  flightFloor: 12,
  lipFloor: 8,
  /** Slower than this a pad does nothing (a glide or lip); a cannon takes any kart. */
  minSpeed: 5,
  cannonMinSpeed: 2,
  lipMinSpeed: 9,
  /** The wheel turns the flight this fast at full lock (rad/s): a cannon, a lip and a glide. */
  turnCannon: 0.45,
  turnGlide: 1.1,
  /** The autopilot swings the flight toward the road's direction this fast per radian of error (1/s). */
  assist: 2.4,
  /** Where it looks along the road (m). */
  assistLook: 10,
  /** A glide landed within this of the road's middle (m) boosts for `glideBoost` seconds. */
  glideTarget: 3,
  glideBoost: 0.7,
};
