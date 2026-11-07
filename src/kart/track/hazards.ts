/**
 * Where a track's hazards are at a moment of the race. A pure function of
 * the race's time, so the sim (which spins out the karts they touch) and
 * every screen (which draws them) agree without a byte on the network.
 */
import type { HazardDef, TrackGeometry } from "./geometry";

export interface HazardPose {
  x: number;
  /** Its height above the road there (a bobbing thing below 0 is under the ground). */
  y: number;
  z: number;
  /** Which way it faces (contract.ts's heading): the way it is going. */
  heading: number;
  /** Can it hit a kart now? (A bobbing thing that is down cannot.) */
  active: boolean;
  /** 0..1 through its cycle, for the picture's animation. */
  cycle: number;
  /**
   * 0..1: how near it is to acting, once it has told you (a crusher shakes and its lamp goes red before it
   * slams; a cart's whistle sounds before it crosses). 0 when it is not about to.
   */
  warn: number;
}

/**
 * How far from `at` (metres, along the road or across it) a hazard can be: the sim and the bots skip the ones that
 * are nowhere near. Add the hazard's radius and the kart's.
 */
export function hazardReach(hazard: HazardDef, trackLength: number): number {
  switch (hazard.motion) {
    case "roll":
      return (hazard.span ?? 0.05) * trackLength;
    case "orbit":
      return (hazard.span ?? 8) + Math.abs(hazard.offset ?? 0);
    case "cross":
      return hazard.span ?? 12;
    case "swing":
      return Math.abs(hazard.span ?? 5) + Math.abs(hazard.offset ?? 0);
    case "slide":
      return Math.abs(hazard.span ?? 12);
    default:
      return 0;
  }
}

const smooth01 = (t: number): number => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

/** The crusher's cycle: when it starts to shake, to fall, to lie, to rise (fractions of `period`). */
export const CRUSH = { warn: 0.5, fall: 0.72, down: 0.8, rise: 0.9 } as const;

/** How high a "crush" hazard's underside is when it is up: well clear of any kart. */
export function crushTop(hazard: HazardDef): number {
  return hazard.top ?? hazard.radius * 3.2 + 2.5;
}

/**
 * The road where a hazard stands (at its `at`), worked out once: every pose of the same hazard is arithmetic on it, so
 * the sim, the bots (which ask for a dozen poses of every hazard near them a tick) and the picture do not walk the
 * track's samples each time.
 */
interface Frame {
  track: TrackGeometry;
  x: number;
  z: number;
  tx: number;
  tz: number;
  width: number;
  heading: number;
}

const frames = new WeakMap<HazardDef, Frame>();

function frameOf(track: TrackGeometry, hazard: HazardDef): Frame {
  let f = frames.get(hazard);
  if (!f || f.track !== track) {
    const c = track.at(hazard.at * track.length);
    f = { track, x: c.x, z: c.z, tx: c.tx, tz: c.tz, width: c.width, heading: Math.atan2(c.tx, c.tz) };
    frames.set(hazard, f);
  }
  return f;
}

/** `hazard` at race time `time` (seconds since the start; the countdown is time 0). */
export function hazardAt(track: TrackGeometry, hazard: HazardDef, time: number): HazardPose {
  const cycle = (((time / hazard.period + (hazard.phase ?? 0)) % 1) + 1) % 1;
  const centre = hazard.at * track.length;
  const offset = hazard.offset ?? 0;
  const f = frameOf(track, hazard);
  /** The world x and z at `lateral` metres right of the road where the hazard stands. */
  const px = (lateral: number) => f.x - f.tz * lateral;
  const pz = (lateral: number) => f.z + f.tx * lateral;
  switch (hazard.motion) {
    case "cross": {
      const half = hazard.span ?? f.width / 2 + 1;
      // A smooth there and back: eases at each side as a walker turns round.
      const side = -Math.cos(cycle * Math.PI * 2);
      const going = Math.sin(cycle * Math.PI * 2) >= 0 ? 1 : -1;
      return { x: px(offset + side * half), y: 0, z: pz(offset + side * half), heading: f.heading - (going * Math.PI) / 2, active: true, cycle, warn: 0 };
    }
    case "roll": {
      const span = (hazard.span ?? 0.05) * track.length;
      const s = centre - cycle * span;
      const p = track.point(s, offset);
      return { ...p, y: 0, heading: track.heading(s) + Math.PI, active: true, cycle, warn: 0 };
    }
    case "bob": {
      // Up for most of the first half of the cycle, down (and harmless) the rest.
      const height = Math.sin(cycle * Math.PI * 2);
      return { x: px(offset), y: height * hazard.radius * 1.5, z: pz(offset), heading: f.heading, active: height > 0.2, cycle, warn: 0 };
    }
    case "orbit": {
      const radius = hazard.span ?? 8;
      const angle = cycle * Math.PI * 2 * (hazard.dir ?? 1);
      return {
        x: px(offset) + Math.sin(angle) * radius,
        y: 0,
        z: pz(offset) + Math.cos(angle) * radius,
        heading: angle + Math.PI / 2,
        active: true,
        cycle,
        warn: 0,
      };
    }
    case "swing": {
      // A wrecking ball on a long chain, swinging across the road. It is low (and dangerous) through the middle of
      // its swing and lifts clear of a kart's roof at each end.
      const amp = hazard.span ?? 5; // signed: a negative span starts the swing the other way (mirror mode)
      const s = Math.sin(cycle * Math.PI * 2);
      const lift = s * s * hazard.radius * 2.6;
      const going = Math.cos(cycle * Math.PI * 2) >= 0 ? 1 : -1;
      return { x: px(offset + s * amp), y: lift, z: pz(offset + s * amp), heading: f.heading - (going * Math.PI) / 2, active: lift < hazard.radius * 0.9, cycle, warn: 0 };
    }
    case "crush": {
      // Up, a shake and a lamp (the telegraph), a fast fall, down for a moment, up again.
      const top = crushTop(hazard);
      let y = top;
      let warn = 0;
      if (cycle >= CRUSH.warn && cycle < CRUSH.fall) {
        warn = (cycle - CRUSH.warn) / (CRUSH.fall - CRUSH.warn);
        y = top * (1 - 0.05 * smooth01(warn));
      } else if (cycle >= CRUSH.fall && cycle < CRUSH.down) {
        const f = (cycle - CRUSH.fall) / (CRUSH.down - CRUSH.fall);
        warn = 1;
        y = top * 0.95 * (1 - f * f);
      } else if (cycle >= CRUSH.down && cycle < CRUSH.rise) {
        warn = 1;
        y = 0;
      } else if (cycle >= CRUSH.rise) {
        y = top * smooth01((cycle - CRUSH.rise) / (1 - CRUSH.rise));
      }
      return { x: px(offset), y, z: pz(offset), heading: f.heading, active: y < 1.0, cycle, warn };
    }
    case "slide": {
      // Something that crosses the whole road once a cycle, from out of sight on one side to out of sight on the
      // other (a negative `span` goes right to left), then waits: a lamp and a whistle come first.
      const half = Math.abs(hazard.span ?? f.width / 2 + 3);
      const d = hazard.dir ?? ((hazard.span ?? 1) < 0 ? -1 : 1);
      const run = 0.5;
      const lead = 0.22;
      if (cycle < run) {
        const u = cycle / run;
        const lateral = offset + d * (-1 + 2 * u) * half;
        return { x: px(lateral), y: 0, z: pz(lateral), heading: f.heading - (d * Math.PI) / 2, active: true, cycle, warn: 0 };
      }
      const warn = cycle > 1 - lead ? (cycle - (1 - lead)) / lead : 0;
      return { x: px(offset - d * half), y: -hazard.radius * 4, z: pz(offset - d * half), heading: f.heading - (d * Math.PI) / 2, active: false, cycle, warn };
    }
  }
}
