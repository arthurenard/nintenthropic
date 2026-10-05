/** Pepper the penguin: a dark back, a white face and belly, an orange beak, a scarf and a pom-pom cap. */
import { MeshBuilder, rgb } from "../kartBuilder";
import { WHITE, armGeometry, body, collar, helmet, eyes, fur, horn, legs, orb, scarfTail, surfaceZ, type Look } from "./parts";
import type { DriverBuild } from "./types";

const DARK = rgb("#2b3044");
const ORANGE = rgb("#f7a22c");

export function buildPenguin(l: Look): DriverBuild {
  const t = new MeshBuilder();
  body(t, l, { w: 0.3, d: 0.24, chest: fur(DARK), belly: WHITE });
  legs(t, l, ORANGE, 0.09);
  collar(t, l, 0.23, 0.2);

  const h = new MeshBuilder();
  const r = [0.3, 0.27, 0.285] as const;
  orb(h, [0, 0, 0], r, fur(DARK), 2);
  // The white face, cut in a heart round the eyes.
  const face = { c: [0, -0.05, 0.1] as const, r: [0.225, 0.2, 0.2] as const };
  orb(h, [...face.c], [...face.r], fur(WHITE), 1);
  eyes(h, 0.1, 0.03, surfaceZ([...face.c], [...face.r], 0.1, 0.03) - 0.004, 0.04);
  horn(h, [0, -0.07, 0.28], [0, -0.1, 0.46], 0.075, ORANGE, 4, 0.045);
  for (const sx of [-1, 1]) orb(h, [sx * 0.15, -0.1, 0.2], [0.04, 0.03, 0.02], rgb("#f59aa6"), 0);
  // A knitted helmet with a pom-pom.
  helmet(h, l, [0, 0.05, -0.01], [0.315, 0.3, 0.31], 0.42, { stripe: false });
  orb(h, [0, 0.35, -0.01], [0.075, 0.07, 0.075], WHITE, 1);

  // A little tail of feathers, behind the seat.
  orb(t, [0, 0.12, -0.3], [0.09, 0.05, 0.12], fur(DARK), 1, [0, 0.45, 0]);
  const scarf = scarfTail(l);

  return {
    torso: t.build(),
    head: h.build(),
    arm: armGeometry({ fur: DARK, sleeve: undefined, r: 0.072, hand: DARK, handR: 0.09 }),
    shoulder: 0.33,
    crown: 0.5,
    bits: [scarf],
  };
}
