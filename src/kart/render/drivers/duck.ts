/** Dabble the rubber duck: round and yellow, an orange bill, a swim cap helmet and a perky tail. */
import { MeshBuilder, rgb } from "../kartBuilder";
import { INK, WHITE, armGeometry, body, helmet, eyes, fur, legs, orb, surfaceZ, type Look } from "./parts";
import type { DriverBuild } from "./types";

const YELLOW = rgb("#ffd83a");
const PALE = rgb("#ffeb91");
const BILL = rgb("#ff9626");
const BILL_LOW = rgb("#f2791c");

export function buildDuck(l: Look): DriverBuild {
  const t = new MeshBuilder();
  body(t, l, { w: 0.3, d: 0.23, chest: fur(YELLOW), belly: PALE });
  legs(t, l, BILL, 0.09);

  const h = new MeshBuilder();
  const r = [0.315, 0.285, 0.3] as const;
  orb(h, [0, 0, 0], r, fur(YELLOW), 2);
  orb(h, [0, -0.065, 0.315], [0.14, 0.05, 0.115], fur(BILL), 1);
  orb(h, [0, -0.115, 0.3], [0.115, 0.032, 0.09], fur(BILL_LOW), 1);
  for (const sx of [-1, 1]) {
    orb(h, [sx * 0.04, -0.045, 0.415], [0.014, 0.01, 0.01], INK, 0);
    orb(h, [sx * 0.2, -0.07, 0.2], [0.05, 0.035, 0.02], rgb("#ffa86b"), 0);
  }
  eyes(h, 0.125, 0.075, surfaceZ([0, 0, 0], [...r], 0.125, 0.075) - 0.004, 0.047);
  // A swim cap, with its ridge and a bobble.
  helmet(h, l, [0, 0.05, -0.01], [0.33, 0.3, 0.315], 0.42, { stripe: false });
  h.box(0, 0.3, -0.02, 0.045, 0.045, 0.5, WHITE);
  orb(h, [0, 0.34, -0.01], [0.045, 0.04, 0.045], WHITE, 0);

  const tail = new MeshBuilder();
  orb(tail, [0, 0.02, -0.1], [0.1, 0.07, 0.14], fur(YELLOW), 1, [0, -0.4, 0]);
  orb(tail, [0, 0.11, -0.19], [0.065, 0.065, 0.09], fur(PALE), 1, [0, -0.7, 0]);

  return {
    torso: t.build(),
    head: h.build(),
    arm: armGeometry({ fur: YELLOW, sleeve: undefined, r: 0.072, hand: YELLOW, handR: 0.09 }),
    shoulder: 0.33,
    crown: 0.52,
    bits: [
      {
        geo: tail.build(),
        at: [0, 0.12, -0.24],
        on: "torso",
        move(o, s) {
          o.rotation.y = Math.sin(s.time * 11) * 0.3 * (0.25 + s.happy) + s.steer * 0.3;
        },
      },
    ],
  };
}
