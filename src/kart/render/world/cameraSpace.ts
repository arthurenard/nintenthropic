/**
 * Where the chase camera may be. The picture keeps everything solid out of the
 * drivable area and a camera's width beyond the barrier (corridor.test.ts), so
 * the camera is clear of it as long as it stays there: this holds it. It slides
 * back toward the road when a bend would swing it out past that margin, rises
 * when the ground (or a ramp's wedge) is in the way, and stays under the roof of a tunnel or an arch.
 * Continuous in the camera's position, so it never makes the view jump.
 */
import type { Vector3 } from "three";
import type { TrackGeometry } from "../../track/geometry";
import type { Bank } from "./bank";
import { rampHeight, SOLID_MARGIN, type Features } from "./features";
import type { Roof } from "./landmarks/place";
import type { Terrain } from "./terrain";

/** The camera keeps this far above the ground. */
const FLOOR = 0.9;
/** And this far under a roof. */
const ROOM = 0.6;

export interface CameraSpace {
  /**
   * Moves `pos`, where a camera behind the kart at `kart` would like to be, to the nearest place clear of the ground,
   * the margin beyond the barrier and any roof. The kart's own height is the least it may be pressed down to.
   */
  fit(pos: Vector3, kart: { x: number; y: number; z: number }): void;
}

export function createCameraSpace(track: TrackGeometry, terrain: Terrain, features: Features, roofs: readonly Roof[], bank: Bank): CameraSpace {
  const n = track.samples.length;
  return {
    fit(pos, kart) {
      // Where the camera is along the kart's own road: a bend can swing it across to another stretch of the lap (a hairpin's other leg).
      const kp = track.project(kart.x, kart.z);
      const p = track.project(pos.x, pos.z, kp.s);
      const half = p.sample.width / 2;
      const side = p.offset > 0 ? 1 : -1;
      const i = Math.round(p.s / track.spacing) % n;

      // Not past the margin beyond the barrier (an open edge has none: the ground falls away there, and nothing stands in the void).
      const open = (side < 0 ? features.dropLeft : features.dropRight)[i]! > 0.5;
      if (!open) {
        const most = half + (side < 0 ? features.wallLeft : features.wallRight)[i]! + SOLID_MARGIN - 0.2;
        const back = Math.abs(p.offset) - most;
        // Only where the kart itself is inside it: a kart that is out (falling, in a jump) takes the camera with it.
        if (back > 0 && Math.abs(kp.offset) <= most + 1) {
          pos.x += side * back * p.sample.tz;
          pos.z -= side * back * p.sample.tx;
        }
      }

      // Not in the ground, nor in a ramp's wedge (which stands on the road): above them where it is, and above them halfway
      // to the kart, so a rise between them does not hide the kart.
      const wedge = Math.abs(p.offset) < half ? rampHeight(features.ramps, p.s, track.length) : 0;
      const ground = Math.max(terrain.heightAt(pos.x, pos.z), wedge > 0 ? p.sample.y + bank.lift(p.s, p.offset) + wedge : -Infinity) + FLOOR;
      if (pos.y < ground) pos.y = ground;
      const mx = (pos.x + kart.x) / 2;
      const mz = (pos.z + kart.z) / 2;
      let need = terrain.heightAt(mx, mz) + FLOOR * 0.7;
      if (features.ramps.length) {
        const ms = p.s + track.delta(p.s, kp.s) / 2;
        const mo = (p.offset + kp.offset) / 2;
        const midWedge = Math.abs(mo) < half ? rampHeight(features.ramps, ms, track.length) : 0;
        if (midWedge > 0) need = Math.max(need, track.at(ms).y + bank.lift(ms, mo) + midWedge + FLOOR * 0.7);
      }
      const line = (pos.y + kart.y + 1.3) / 2;
      if (need > line) pos.y += (need - line) * 2;

      // Under a roof.
      const lift = bank.lift(p.s, p.offset);
      for (const roof of roofs) {
        const d = track.delta(roof.s0, p.s);
        const k = Math.round(d / roof.step);
        if (k < -1 || k > roof.heights.length) continue;
        let h = Infinity;
        for (let q = Math.max(0, k - 1); q <= Math.min(roof.heights.length - 1, k + 1); q++) h = Math.min(h, roof.heights[q]!);
        if (!Number.isFinite(h)) continue;
        const ceiling = p.sample.y + lift + h - ROOM;
        if (pos.y > ceiling) pos.y = Math.max(ceiling, kart.y + 1);
      }
    },
  };
}
