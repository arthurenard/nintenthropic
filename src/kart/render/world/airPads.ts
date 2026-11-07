/**
 * The picture of a track's launch and air sections (sim/air.ts): the glowing chevrons of the pad across the road, a
 * pair of beacon posts (cannon barrels for a cannon) at its edges, and, for a glide, the target rings painted where
 * the flight comes down. Flat light on the road and a few solid posts at the road's edge, so nothing stands where a
 * kart can be; the flight itself is the kart's own height (the sim's).
 */
import { buildArcs, type ArcKind, type ArcSite } from "../../sim/air";
import { rgb, scaleRgb, type Rgb, type V3 } from "./builder";
import type { TrackBuild } from "./trackContext";

const UP: V3 = [0, 1, 0];

/** Each kind's light, and the colour of its posts. */
const LOOK: Record<ArcKind, { light: Rgb; post: Rgb }> = {
  cannon: { light: [1.7, 0.6, 0.1], post: rgb("#3a3f4d") },
  glide: { light: [0.25, 1.2, 1.7], post: rgb("#eef4ff") },
  lip: { light: [1.5, 0.3, 1.4], post: rgb("#5b3d8f") },
};

export function buildAirPads(b: TrackBuild): void {
  const def = b.track.def;
  if (!def.air?.length) return;
  const P = (s: number, o: number, dy = 0.05): V3 => {
    const q = b.track.at(s);
    return [q.x - q.tz * o, q.y + b.bank.lift(s, o) + dy, q.z + q.tx * o];
  };
  for (const site of buildArcs(def, b.track)) {
    const look = LOOK[site.kind];
    const half = b.track.at(site.s).width / 2;
    const lo = Math.max(site.lo, -half + 0.6);
    const hi = Math.min(site.hi, half - 0.6);
    if (hi - lo < 1) continue;
    chevrons(b, site, look.light, lo, hi, P);
    posts(b, site, look.post, look.light);
    if (site.kind === "glide") target(b, site, look.light, P);
  }
}

/** Arrow heads pointing the way, brightest at the lip. */
function chevrons(b: TrackBuild, site: ArcSite, light: Rgb, lo: number, hi: number, P: (s: number, o: number, dy?: number) => V3): void {
  const mid = (lo + hi) / 2;
  const count = 5;
  for (let k = 0; k < count; k++) {
    const s = site.s - 1.2 - (count - 1 - k) * 1.5;
    const glow = scaleRgb(light, 0.35 + 0.65 * ((k + 1) / count));
    const none: Rgb = [0, 0, 0];
    // One chevron: two slanted bands from the edges toward a point ahead at the middle.
    for (const [from, to] of [[lo, mid], [hi, mid]] as const) {
      b.additive.quad(P(s - 0.9, from), P(s - 0.2, from), P(s + 0.9, to), P(s + 0.2, to), glow, glow, glow, glow, UP);
    }
    b.additive.quad(P(s - 1, lo), P(s - 1, hi), P(s - 1.4, hi), P(s - 1.4, lo), none, none, none, none, UP);
  }
  // A soft bar of light along the pad's lip.
  const bar = scaleRgb(light, 1.0);
  b.additive.quad(P(site.s - 0.5, lo), P(site.s - 0.5, hi), P(site.s, hi), P(site.s, lo), scaleRgb(bar, 0.3), scaleRgb(bar, 0.3), bar, bar, UP);
  b.glows.push({ ...glowAt(P(site.s - 1, mid, 1.2)), size: 5, colour: scaleRgb(light, 0.55), alpha: 0.5 });
}

function glowAt(p: V3): { x: number; y: number; z: number } {
  return { x: p[0], y: p[1], z: p[2] };
}

/** Posts at the road's edges, beside the pad: a cannon's barrels point along the road and up. */
function posts(b: TrackBuild, site: ArcSite, post: Rgb, light: Rgb): void {
  const i = Math.round(site.s / b.spacing);
  const a = b.S(i);
  const bld = b.deco[b.chunkOf(i)]!;
  for (const side of [-1, 1] as const) {
    // Beyond the barrier and the camera's margin, like the start gantry's legs: nothing solid where a kart or camera can be.
    const p = b.P(i - 1, side * (a.width / 2 + b.wall(i, side) + 1.8), 0);
    if (site.kind === "cannon") {
      // A barrel: a thick tube leaning forward, lit at its mouth.
      const dir: V3 = [a.tx, 0, a.tz];
      const base: V3 = [p[0], p[1] + 1.3, p[2]];
      const mouth: V3 = [p[0] + dir[0] * 3.2, p[1] + 4.6, p[2] + dir[2] * 3.2];
      bld.post(p[0], p[1], p[2], 0.8, 1.4, post, 8);
      bld.rod(base, mouth, 1.0, post);
      bld.blob(mouth[0] + dir[0] * 0.2, mouth[1] + 0.15, mouth[2] + dir[2] * 0.2, 0.8, 0.8, 0.8, scaleRgb(light, 0.7), 0);
    } else {
      bld.post(p[0], p[1], p[2], 0.16, 6.5, post, 6);
      bld.blob(p[0], p[1] + 6.8, p[2], 0.55, 0.55, 0.55, scaleRgb(light, 0.7), 0);
    }
  }
}

/** Rings painted on the road where a glide comes down; landing inside the inner one gives the boost. */
function target(b: TrackBuild, site: ArcSite, light: Rgb, P: (s: number, o: number, dy?: number) => V3): void {
  const s = site.s + site.length;
  const segs = 20;
  const ring = (r0: number, r1: number, c: Rgb): void => {
    for (let k = 0; k < segs; k++) {
      const a0 = (k / segs) * Math.PI * 2;
      const a1 = ((k + 1) / segs) * Math.PI * 2;
      // Metres along the road (s) and across it (offset), a flat ring in the road's own plane.
      const pt = (r: number, a: number): V3 => P(s + Math.cos(a) * r, Math.sin(a) * r, 0.06);
      b.additive.quad(pt(r0, a0), pt(r1, a0), pt(r1, a1), pt(r0, a1), c, c, c, c, UP);
    }
  };
  ring(2.55, 3.0, scaleRgb(light, 0.9));
  ring(1.35, 1.65, scaleRgb(light, 0.6));
  ring(0, 0.45, scaleRgb(light, 1.1));
}
