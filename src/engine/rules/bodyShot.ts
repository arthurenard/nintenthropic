/**
 * How a shot is weighed against a figure built on the shared humanoid
 * armature (High Noon's gang and townsfolk, Dead of Night's dead and its
 * survivors): a sphere for the head, a capsule for the torso and the limbs,
 * from the joints the rig gives (engine/world/character.ts's Joints).
 */
import { effectiveRadius, probePoint, probeSegment, type RayProbe, type V3 } from "./raymath";

/** The joints of a figure a shot is weighed against, in world space. */
export interface BodyJoints {
  head: V3;
  hips: V3;
  neck: V3;
  shoulderL: V3;
  elbowL: V3;
  handL: V3;
  shoulderR: V3;
  elbowR: V3;
  handR: V3;
  thighL: V3;
  kneeL: V3;
  footL: V3;
  thighR: V3;
  kneeR: V3;
  footR: V3;
}

/** A figure's shapes for a shot: its head's and torso's radii, metres, and whether it stands on its legs. */
export interface BodyShape {
  head: number;
  torso: number;
  /** On its feet: its legs can be hit, and a shot above its neck is for the head. A crawler is not. */
  upright: boolean;
}

/** Where a shot meets a figure. */
export interface BodyHit {
  part: "head" | "body" | "limb";
  /** Metres along the shot. */
  t: number;
  /** How near the middle of its zone the shot was, 0 (dead centre) to 1 (the edge). */
  score: number;
  /** The shot passes through the figure itself, not only through Aim Assist's allowance round it. */
  physical: boolean;
}

const probe: RayProbe = { t: 0, miss: 0 };

/**
 * Where a shot from `o` along `d` (a unit direction) meets a figure, into
 * `out`, or null if it passes it by. The head and the torso are widened to
 * Aim Assist's angles (`aHead`, `aTorso`); the limbs take only a clean hit.
 * A shot passing above an upright figure's neck is a headshot or a miss,
 * never a body shot. And a shot that passes through any of its real shapes
 * is a real hit, whatever zone the allowance calls it: with assist an arm's
 * hit can read as the body's, and must not become a near miss.
 */
export function weighBody(o: V3, d: V3, j: BodyJoints, shape: BodyShape, aHead: number, aTorso: number, out: BodyHit): BodyHit | null {
  probePoint(o, d, j.head, probe);
  if (probe.t <= 0) return null;
  const tH = probe.t;
  const missH = probe.miss;
  const rH = effectiveRadius(shape.head, tH, aHead);
  probeSegment(o, d, j.hips, j.neck, probe);
  const tT = probe.t;
  const missT = probe.miss;
  const rT = effectiveRadius(shape.torso, tT, aTorso);
  let limbT = 0;
  let limbScore = Number.POSITIVE_INFINITY;
  const limb = (a: V3, b: V3, r: number) => {
    probeSegment(o, d, a, b, probe);
    const s = probe.miss / r;
    if (s < limbScore) {
      limbScore = s;
      limbT = probe.t;
    }
  };
  limb(j.shoulderL, j.elbowL, 0.065);
  limb(j.elbowL, j.handL, 0.055);
  limb(j.shoulderR, j.elbowR, 0.065);
  limb(j.elbowR, j.handR, 0.055);
  if (shape.upright) {
    limb(j.thighL, j.kneeL, 0.09);
    limb(j.kneeL, j.footL, 0.07);
    limb(j.thighR, j.kneeR, 0.09);
    limb(j.kneeR, j.footR, 0.07);
  }
  // Where the shot passes the head: above the neck, or not.
  const aboveNeck = shape.upright && d.y * tH + o.y > j.neck.y + 0.03;
  const scoreH = missH / rH;
  const scoreT = missT / rT;
  const real = missH <= shape.head || missT <= shape.torso || limbScore <= 1;
  if (aboveNeck) return scoreH <= 1 ? hit(out, "head", tH, scoreH, missH <= shape.head) : null;
  if (limbScore <= 1 && limbScore < scoreT && missT > shape.torso) return hit(out, "limb", limbT, limbScore * 0.5, true);
  if (scoreT <= 1 || scoreH <= 1) {
    if (scoreH <= 1 && scoreH < scoreT) return hit(out, "head", tH, scoreH, real);
    return hit(out, "body", tT, scoreT, real);
  }
  return null;
}

function hit(out: BodyHit, part: BodyHit["part"], t: number, score: number, physical: boolean): BodyHit {
  out.part = part;
  out.t = t;
  out.score = score;
  out.physical = physical;
  return out;
}

/**
 * A shot at an innocent (a townsperson, a survivor), who gets no help.
 * Through the head or the body it is a hit, `t` metres along the shot. Close
 * beside one, as near as a torso would be helped (`aTorso`), it is no hit,
 * and `t` is where it passed them: no near miss farther along counts, since
 * a wrong hit is worse than none (assist.ts's `choose`, its `guardAt`).
 * Nowhere near, `t` is infinite.
 */
export function weighInnocent(o: V3, d: V3, j: Pick<BodyJoints, "head" | "hips" | "neck">, aTorso: number, out: { hit: boolean; t: number }): { hit: boolean; t: number } {
  probePoint(o, d, j.head, probe);
  let through = probe.t > 0 && probe.miss <= 0.14;
  let t = probe.t;
  if (!through) {
    probeSegment(o, d, j.hips, j.neck, probe);
    through = probe.t > 0 && probe.miss <= 0.22;
    t = probe.t;
  }
  if (through) {
    out.hit = true;
    out.t = t;
    return out;
  }
  probePoint(o, d, j.head, probe);
  const headT = probe.t;
  const nearHead = probe.t > 0 && probe.miss <= effectiveRadius(0.14, probe.t, aTorso);
  probeSegment(o, d, j.hips, j.neck, probe);
  const nearBody = probe.t > 0 && probe.miss <= effectiveRadius(0.22, probe.t, aTorso);
  out.hit = false;
  out.t = Math.min(nearHead ? headT : Number.POSITIVE_INFINITY, nearBody ? probe.t : Number.POSITIVE_INFINITY);
  return out;
}
