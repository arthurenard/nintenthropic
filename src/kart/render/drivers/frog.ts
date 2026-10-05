/** Moss the frog: eyes on stalks inside big goggles, a wide grin, a throat that puffs. */
import { MeshBuilder, rgb, shapes, xf } from "../world/builder";
import { INK, armGeometry, body, eye, fur, headBand, legs, orb, type Look } from "./parts";
import type { DriverBuild } from "./types";
import { TAU } from "../math";

const SKIN = rgb("#74c64a");
const BELLY = rgb("#e1f4ac");
const SPOT = rgb("#4b9a38");

export function buildFrog(l: Look): DriverBuild {
  const t = new MeshBuilder();
  body(t, l, { w: 0.27, d: 0.2, chest: fur(SKIN), belly: BELLY });
  legs(t, l, SKIN, 0.1, 0.17);
  // Spots on the shoulders, under the bib.
  for (const sx of [-1, 1]) orb(t, [sx * 0.15, 0.55, -0.12], [0.05, 0.03, 0.05], SPOT, 0);

  const h = new MeshBuilder();
  const head = { c: [0, -0.04, 0] as const, r: [0.335, 0.2, 0.28] as const };
  orb(h, [...head.c], [...head.r], fur(SKIN), 2);
  // The mouth, wide, and a blush each side.
  h.box(0, -0.115, 0.247, 0.36, 0.028, 0.05, INK, 0, 0.12);
  for (const sx of [-1, 1]) {
    orb(h, [sx * 0.2, -0.08, 0.2], [0.05, 0.035, 0.02], rgb("#f59aa0"), 0);
    orb(h, [sx * 0.04, -0.02, 0.265], [0.018, 0.012, 0.012], SPOT, 0);
  }
  // Eyes on bumps; goggle rims round them, and a strap right round the head.
  for (const sx of [-1, 1]) {
    orb(h, [sx * 0.15, 0.15, 0.08], [0.115, 0.105, 0.115], fur(SKIN), 1);
    eye(h, sx * 0.15, 0.165, 0.185, 0.055);
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * TAU;
      h.add(shapes.box(), xf(sx * 0.15 + Math.cos(a) * 0.125, 0.165 + Math.sin(a) * 0.125, 0.15, 0.09, 0.034, 0.1, 0, 0, a + Math.PI / 2), { bottom: l.low, top: l.top });
    }
  }
  headBand(h, head, 0.1, { bottom: l.low, top: l.top }, 0.075, 1.045);
  // A strap over the crown, flush with the head.
  h.box(0, 0.152, -0.02, 0.07, 0.024, 0.3, l.kart, 0, 0.0);

  const sac = new MeshBuilder();
  orb(sac, [0, 0, 0], [0.12, 0.075, 0.1], fur(BELLY), 1);

  return {
    torso: t.build(),
    head: h.build(),
    arm: armGeometry({ fur: SKIN, sleeve: l.vest, r: 0.075, hand: SKIN, handR: 0.105 }),
    shoulder: 0.3,
    crown: 0.4,
    bits: [
      {
        geo: sac.build(),
        at: [0, -0.2, 0.13],
        on: "head",
        move(o, s) {
          o.scale.set(1, 1 + Math.sin(s.time * 6) * 0.2 + s.happy * 0.25, 1 + Math.sin(s.time * 6) * 0.1);
        },
      },
    ],
  };
}
