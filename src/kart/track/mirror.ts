/**
 * Mirror mode: a track flipped left for right. Every point's x is negated,
 * which turns every right-hander into a left-hander, and every lateral thing
 * (metres right of the centre line, or a side of the road) follows: offsets
 * are negated, "left" and "right" swap, a landmark's turn and a point's lean
 * (`bank`) are negated. What runs along the lap (fractions, ramps, heights,
 * widths) is untouched.
 *
 * The flipped track is a TrackDef like any other, memoised so that asking
 * twice gives the same object (the sim's and the picture's per-track caches
 * are keyed by it). Its id is the original's plus MIRROR_SUFFIX.
 */
import type { RouteDef, TrackDef } from "./geometry";
import { trackById } from "./tracks";

export const MIRROR_SUFFIX = "-mirror";

const mirrors = new WeakMap<TrackDef, TrackDef>();

/** Negated, without ever producing -0 (it would show in a snapshot or a test). */
const flip = (n: number): number => (n === 0 ? 0 : -n);
const flipped = (n: number | undefined): number | undefined => (n === undefined ? undefined : flip(n));
const swapSide = <S extends "left" | "right">(side: S): S => (side === "left" ? "right" : "left") as S;

/** Copies `object` with `key: value` set only when there is a value (the track data leaves optional fields out). */
function withDefined<T extends object, K extends keyof T>(object: T, key: K, value: T[K] | undefined): T {
  return value === undefined ? object : { ...object, [key]: value };
}

/** The track as seen in a mirror. */
function mirrorRoute(route: RouteDef): RouteDef {
  const out: RouteDef = {
    ...route,
    points: route.points.map((point) => withDefined({ ...point, x: flip(point.x) }, "bank", flipped(point.bank))),
  };
  if (route.boostPads) out.boostPads = route.boostPads.map((pad) => ({ ...pad, offset: flip(pad.offset) }));
  if (route.drops) out.drops = route.drops.map((drop) => (drop.side === "both" ? { ...drop } : { ...drop, side: swapSide(drop.side) }));
  if (route.verges) out.verges = route.verges.map((verge) => ({ ...verge, side: swapSide(verge.side) }));
  if (route.surfaces) out.surfaces = route.surfaces.map((surface) => withDefined({ ...surface }, "offset", flipped(surface.offset)));
  if (route.hazards) out.hazards = route.hazards.map((hazard) => withDefined({ ...hazard }, "offset", flipped(hazard.offset)));
  if (route.landmarks) out.landmarks = route.landmarks.map((landmark) => withDefined({ ...landmark, offset: flip(landmark.offset) }, "turn", flipped(landmark.turn)));
  return out;
}

export function mirrorTrack(def: TrackDef): TrackDef {
  const known = mirrors.get(def);
  if (known) return known;
  const mirrored: TrackDef = {
    ...def,
    id: def.id + MIRROR_SUFFIX,
    points: def.points.map((point) => withDefined({ ...point, x: flip(point.x) }, "bank", flipped(point.bank))),
    boostPads: def.boostPads?.map((pad) => ({ ...pad, offset: flip(pad.offset) })),
    drops: def.drops?.map((drop) => (drop.side === "both" ? { ...drop } : { ...drop, side: swapSide(drop.side) })),
    verges: def.verges?.map((verge) => ({ ...verge, side: swapSide(verge.side) })),
    surfaces: def.surfaces?.map((surface) => withDefined({ ...surface }, "offset", flipped(surface.offset))),
    hazards: def.hazards?.map((hazard) => withDefined({ ...hazard }, "offset", flipped(hazard.offset))),
    landmarks: def.landmarks?.map((landmark) => withDefined({ ...landmark, offset: flip(landmark.offset) }, "turn", flipped(landmark.turn))),
    duck: def.duck ? { ...def.duck, offset: flip(def.duck.offset) } : undefined,
    routes: def.routes?.map(mirrorRoute),
  };
  // Optional fields the original did not have stay absent, not undefined.
  for (const key of ["boostPads", "drops", "verges", "surfaces", "hazards", "landmarks", "duck", "routes"] as const) {
    if (mirrored[key] === undefined) delete mirrored[key];
  }
  mirrors.set(def, mirrored);
  // A mirror of the mirror is the track itself.
  mirrors.set(mirrored, def);
  return mirrored;
}

/** Is this track a mirror image? */
export function isMirrored(def: TrackDef): boolean {
  return def.id.endsWith(MIRROR_SUFFIX);
}

/** The track a race is run on: `id`, mirrored if the room asked. */
export function raceTrack(id: string, mirror: boolean | undefined): TrackDef {
  const def = trackById(id);
  return mirror ? mirrorTrack(def) : def;
}

/** A track by the id a race reports (`RaceView.track.id`): a mirrored track's id finds its mirror. */
export function trackByRaceId(id: string): TrackDef {
  return id.endsWith(MIRROR_SUFFIX) ? mirrorTrack(trackById(id.slice(0, -MIRROR_SUFFIX.length))) : trackById(id);
}
