/**
 * Which karts a view's shadow pass draws. The sun's shadow map is drawn again
 * for every view, aimed at that view's kart, and each kart near it is a dozen
 * draws in it: with four views, close to half the frame's draw calls. A kart
 * behind the camera throws a shadow nobody in that view can see, so it is left
 * out of that view's shadow pass; whatever the view can see of a kart or of
 * its shadow keeps it in.
 */
import { Sphere, Vector3, type Frustum } from "three";

/** How tall a kart and its driver stand, metres (the rabbit's ears are the tallest), and how far a kart reaches round its middle. */
const KART_TOP = 2.9;
const KART_REACH = 2.4;

const _sphere = new Sphere();

/**
 * Whether a kart drawn at (x, y, z) over a road at `roadY` could put any of itself or its shadow in `frustum`:
 * one sphere round the kart and the point where the sun lays the shadow of its top on the road. `sun` points at
 * the sun; `reach` caps a low sun's long shadow (the shadow map covers no more than that round a view's kart).
 */
export function shadowInView(frustum: Frustum, x: number, y: number, z: number, roadY: number, sun: Vector3, reach: number): boolean {
  const drop = Math.max(0, y + KART_TOP - roadY);
  const flat = Math.hypot(sun.x, sun.z);
  const along = flat > 1e-6 ? Math.min(reach, (drop * flat) / Math.max(0.02, sun.y)) : 0;
  const sx = flat > 1e-6 ? x - (sun.x / flat) * along : x;
  const sz = flat > 1e-6 ? z - (sun.z / flat) * along : z;
  const cy = y + 1;
  _sphere.center.set((x + sx) / 2, (cy + roadY) / 2, (z + sz) / 2);
  _sphere.radius = Math.hypot(x - sx, cy - roadY, z - sz) / 2 + KART_REACH;
  return frustum.intersectsSphere(_sphere);
}

/** A kart's shadow casters, switched off and back on as a whole (KartActor.castShadows). */
export class Casters {
  private off: { castShadow: boolean }[] = [];
  private casting = true;

  /** Switches the casting meshes under `root` off (remembering which they were) or back on. */
  set(root: { traverse(fn: (o: { castShadow: boolean; isMesh?: boolean }) => void): void }, on: boolean): void {
    if (on === this.casting) return;
    this.casting = on;
    if (on) {
      for (const m of this.off) m.castShadow = true;
      this.off = [];
      return;
    }
    root.traverse((o) => {
      if (o.isMesh && o.castShadow) {
        o.castShadow = false;
        this.off.push(o);
      }
    });
  }
}
