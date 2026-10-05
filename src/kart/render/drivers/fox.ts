/** Kit the fox: pointed ears through a helmet, a white-tipped brush of a tail, a sharp snout. */
import { MeshBuilder, rgb } from "../world/builder";
import { armGeometry, body, dome, eyes, fur, horn, legs, orb, shell, surfaceZ, type Look } from "./parts";
import type { DriverBuild } from "./types";

const FUR = rgb("#ee7f2d");
const CREAM = rgb("#fff0da");
const DARK = rgb("#4a2d25");

export function buildFox(l: Look): DriverBuild {
  const t = new MeshBuilder();
  body(t, l, { w: 0.25, d: 0.19, belly: CREAM });
  legs(t, l, DARK, 0.085);

  const h = new MeshBuilder();
  const r = [0.29, 0.26, 0.27] as const;
  orb(h, [0, 0, 0], r, fur(FUR), 2);
  // Cheek ruffs.
  for (const sx of [-1, 1]) orb(h, [sx * 0.2, -0.1, 0.1], [0.115, 0.1, 0.15], fur(CREAM), 1, [sx * 0.3, 0, 0]);
  // The snout: orange above, cream below, a black nose.
  orb(h, [0, -0.045, 0.27], [0.095, 0.075, 0.13], fur(FUR), 1);
  orb(h, [0, -0.1, 0.26], [0.085, 0.05, 0.105], fur(CREAM), 1);
  orb(h, [0, -0.03, 0.395], [0.042, 0.032, 0.03], DARK, 0);
  eyes(h, 0.115, 0.06, surfaceZ([0, 0, 0], [...r], 0.115, 0.06) - 0.004, 0.04);
  // Ears: tall pyramids, dark-tipped, cream inside.
  for (const sx of [-1, 1]) {
    horn(h, [sx * 0.15, 0.2, -0.04], [sx * 0.25, 0.58, -0.1], 0.125, { bottom: FUR, top: DARK }, 4, 0.06);
    horn(h, [sx * 0.15, 0.2, -0.0], [sx * 0.235, 0.5, -0.06], 0.075, { bottom: CREAM, top: CREAM }, 4, 0.03);
  }
  dome(h, [0, 0.05, -0.01], [0.305, 0.28, 0.29], shell(l), 0.4);
  h.box(0, 0.125, 0.28, 0.34, 0.035, 0.12, l.low, 0, -0.16);

  // The brush: big, trailing, a white tip.
  const tail = new MeshBuilder();
  orb(tail, [0, 0.0, -0.12], [0.12, 0.12, 0.17], fur(FUR), 1);
  orb(tail, [0, 0.04, -0.32], [0.16, 0.16, 0.21], fur(FUR), 1);
  orb(tail, [0, 0.09, -0.52], [0.12, 0.12, 0.16], fur(CREAM), 1);

  return {
    torso: t.build(),
    head: h.build(),
    arm: armGeometry({ fur: FUR, sleeve: l.vest, r: 0.068, hand: DARK }),
    shoulder: 0.28,
    crown: 0.66,
    bits: [
      {
        geo: tail.build(),
        at: [0, 0.2, -0.26],
        on: "torso",
        move(o, s) {
          o.rotation.y = Math.sin(s.time * 4) * 0.16 + s.steer * 0.35 + Math.sin(s.time * 15) * 0.4 * s.happy;
          o.rotation.x = -0.18 - s.happy * 0.1;
        },
      },
    ],
  };
}
