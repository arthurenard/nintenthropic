/** Mango the cat: pointed ears through a helmet, striped, whiskers, and a tall tail that curls. */
import { MeshBuilder, rgb } from "../kartBuilder";
import { INK, WHITE, armGeometry, body, helmet, eyes, fur, horn, legs, orb, surfaceZ, type Look } from "./parts";
import type { DriverBuild } from "./types";

const FUR = rgb("#ffae42");
const STRIPE = rgb("#d9701c");
const CREAM = rgb("#ffe9c7");
const PINK = rgb("#f59fb0");

export function buildCat(l: Look): DriverBuild {
  const t = new MeshBuilder();
  body(t, l, { w: 0.24, d: 0.19, belly: CREAM });
  legs(t, l, CREAM, 0.082);
  // Stripes across the shoulders, under the bib.
  for (const sx of [-1, 1]) for (const k of [0, 1]) t.box(sx * (0.2 - k * 0.0), 0.5 - k * 0.07, -0.02 - k * 0.0, 0.06, 0.035, 0.28, STRIPE, 0, 0, sx * 0.4);

  const h = new MeshBuilder();
  const r = [0.3, 0.26, 0.27] as const;
  orb(h, [0, 0, 0], r, fur(FUR), 2);
  for (const sx of [-1, 1]) {
    orb(h, [sx * 0.19, -0.09, 0.1], [0.12, 0.1, 0.14], fur(FUR), 1);
    // Cheek stripes.
    for (const dy of [-0.02, 0.03]) h.box(sx * 0.285, -0.07 + dy, 0.1, 0.03, 0.022, 0.1, STRIPE, 0, 0, sx * 0.2);
  }
  orb(h, [0, -0.08, 0.235], [0.1, 0.07, 0.075], fur(CREAM), 1);
  orb(h, [0, -0.04, 0.3], [0.032, 0.024, 0.02], PINK, 0);
  eyes(h, 0.115, 0.055, surfaceZ([0, 0, 0], [...r], 0.115, 0.055) - 0.004, 0.047);
  for (const sx of [-1, 1]) for (const dy of [-0.02, 0.012]) h.box(sx * 0.17, -0.075 + dy, 0.265, 0.2, 0.008, 0.008, WHITE, sx * 0.3, 0, dy * 5);
  // Ears.
  for (const sx of [-1, 1]) {
    horn(h, [sx * 0.17, 0.2, -0.02], [sx * 0.24, 0.53, -0.05], 0.115, { bottom: FUR, top: STRIPE }, 4, 0.05);
    horn(h, [sx * 0.17, 0.2, 0.01], [sx * 0.225, 0.46, -0.02], 0.07, PINK, 4, 0.03);
  }
  helmet(h, l, [0, 0.05, -0.01], [0.31, 0.28, 0.29], 0.4);
  void INK;

  // A tail that rises behind the seat and curls over, rings of stripe.
  const tail = new MeshBuilder();
  const links: [number, number, number, number][] = [
    [0, 0.0, -0.07, 0.095],
    [0, 0.08, -0.14, 0.092],
    [0, 0.17, -0.19, 0.09],
    [0, 0.27, -0.21, 0.088],
    [0, 0.37, -0.2, 0.086],
    [0, 0.46, -0.16, 0.084],
    [0, 0.53, -0.09, 0.082],
  ];
  links.forEach(([x, y, z, rad], i) => orb(tail, [x, y, z], [rad, rad * 1.1, rad], fur(i % 2 === 0 || i === 6 ? FUR : STRIPE), 1));

  return {
    torso: t.build(),
    head: h.build(),
    arm: armGeometry({ fur: FUR, sleeve: l.vest, r: 0.066, hand: CREAM }),
    shoulder: 0.27,
    crown: 0.62,
    bits: [
      {
        geo: tail.build(),
        at: [0, 0.12, -0.24],
        on: "torso",
        move(o, s) {
          o.rotation.z = Math.sin(s.time * 3) * 0.16 + s.steer * 0.3 + Math.sin(s.time * 13) * 0.25 * s.happy;
        },
      },
    ],
  };
}
