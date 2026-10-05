/** Juniper the otter: sleek and brown, a cream muzzle with whiskers, swim goggles pushed up, a scarf, a flat tail. */
import { MeshBuilder, rgb, shapes, xf } from "../world/builder";
import { INK, WHITE, armGeometry, body, collar, eyes, fur, headBand, legs, orb, scarfTail, surfaceZ, type Look } from "./parts";
import type { DriverBuild } from "./types";

const FUR = rgb("#8a5c3b");
const CREAM = rgb("#ecd6b4");
const GLASS = [0.25, 0.8, 1.25] as const;

export function buildOtter(l: Look): DriverBuild {
  const t = new MeshBuilder();
  body(t, l, { w: 0.26, d: 0.2, belly: CREAM });
  legs(t, l, FUR, 0.088);
  collar(t, l, 0.22, 0.18);

  const h = new MeshBuilder();
  const head = { c: [0, 0, 0] as const, r: [0.29, 0.26, 0.28] as const };
  orb(h, [...head.c], [...head.r], fur(FUR), 2);
  orb(h, [0, -0.095, 0.2], [0.15, 0.11, 0.12], fur(CREAM), 1);
  orb(h, [0, -0.05, 0.305], [0.048, 0.035, 0.03], INK, 0);
  eyes(h, 0.115, 0.055, surfaceZ([0, 0, 0], [...head.r], 0.115, 0.055) - 0.004, 0.042);
  // Whiskers.
  for (const sx of [-1, 1]) for (const dy of [-0.012, 0.02]) h.box(sx * 0.2, -0.09 + dy, 0.27, 0.19, 0.008, 0.008, WHITE, sx * 0.25, 0, dy * 6);
  // Small round ears, low.
  for (const sx of [-1, 1]) {
    orb(h, [sx * 0.225, 0.14, -0.06], [0.07, 0.07, 0.05], fur(FUR), 1);
    orb(h, [sx * 0.23, 0.14, -0.035], [0.04, 0.04, 0.025], fur(CREAM), 0);
  }
  // Swim goggles pushed up on the forehead, and their strap right round.
  headBand(h, head, 0.16, { bottom: l.low, top: l.top }, 0.07, 1.05);
  for (const sx of [-1, 1]) {
    const z = surfaceZ([0, 0, 0], [...head.r], sx * 0.105, 0.18) + 0.008;
    h.add(shapes.cylinder(12), xf(sx * 0.105, 0.19, z, 0.098, 0.07, 0.098, 0, 1.0, 0), { bottom: l.low, top: l.top });
    h.add(shapes.cylinder(12), xf(sx * 0.105, 0.2, z + 0.03, 0.075, 0.04, 0.075, 0, 1.0, 0), GLASS);
  }

  const tail = new MeshBuilder();
  orb(tail, [0, 0, -0.17], [0.1, 0.06, 0.2], fur(FUR), 1, [0, -0.15, 0]);
  orb(tail, [0, 0.05, -0.4], [0.08, 0.045, 0.18], fur(FUR), 1, [0, -0.35, 0]);

  return {
    torso: t.build(),
    head: h.build(),
    arm: armGeometry({ fur: FUR, sleeve: l.vest, r: 0.07, hand: CREAM }),
    shoulder: 0.29,
    crown: 0.4,
    bits: [
      scarfTail(l),
      {
        geo: tail.build(),
        at: [0, 0.21, -0.25],
        on: "torso",
        move(o, s) {
          o.rotation.y = Math.sin(s.time * 3.4) * 0.14 + s.steer * 0.3 + Math.sin(s.time * 14) * 0.3 * s.happy;
          o.rotation.x = 0.1;
        },
      },
    ],
  };
}
