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
}

/** `hazard` at race time `time` (seconds since the start; the countdown is time 0). */
export function hazardAt(track: TrackGeometry, hazard: HazardDef, time: number): HazardPose {
  const cycle = (((time / hazard.period + (hazard.phase ?? 0)) % 1) + 1) % 1;
  const centre = hazard.at * track.length;
  const offset = hazard.offset ?? 0;
  switch (hazard.motion) {
    case "cross": {
      const half = hazard.span ?? track.at(centre).width / 2 + 1;
      // A smooth there and back: eases at each side as a walker turns round.
      const side = -Math.cos(cycle * Math.PI * 2);
      const p = track.point(centre, offset + side * half);
      const going = Math.sin(cycle * Math.PI * 2) >= 0 ? 1 : -1;
      return { ...p, y: 0, heading: track.heading(centre) - (going * Math.PI) / 2, active: true, cycle };
    }
    case "roll": {
      const span = (hazard.span ?? 0.05) * track.length;
      const s = centre - cycle * span;
      const p = track.point(s, offset);
      return { ...p, y: 0, heading: track.heading(s) + Math.PI, active: true, cycle };
    }
    case "bob": {
      // Up for the middle half of the cycle, down (and harmless) the rest.
      const height = Math.sin(cycle * Math.PI * 2);
      const p = track.point(centre, offset);
      return { ...p, y: height * hazard.radius * 1.5, heading: track.heading(centre), active: height > 0.2, cycle };
    }
    case "orbit": {
      const radius = hazard.span ?? 8;
      const angle = cycle * Math.PI * 2;
      const c = track.point(centre, offset);
      return {
        x: c.x + Math.sin(angle) * radius,
        y: 0,
        z: c.z + Math.cos(angle) * radius,
        heading: angle + Math.PI / 2,
        active: true,
        cycle,
      };
    }
  }
}
