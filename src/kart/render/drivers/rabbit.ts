/** Bun the rabbit: tall ears through a helmet, a pom-pom tail, a buck tooth. */
import { MeshBuilder, rgb } from "../world/builder";
import { INK, WHITE, armGeometry, body, dome, eyes, fur, legs, orb, shell, surfaceZ, type Look } from "./parts";
import type { DriverBuild } from "./types";

const FUR = rgb("#f3ede6");
const CHEEK = rgb("#fffaf4");
const PINK = rgb("#f2a2b6");

export function buildRabbit(l: Look): DriverBuild {
  const t = new MeshBuilder();
  body(t, l, { w: 0.24, d: 0.19, belly: CHEEK });
  legs(t, l, FUR, 0.085);

  const h = new MeshBuilder();
  const c = [0, 0, 0] as const;
  const r = [0.29, 0.265, 0.28] as const;
  orb(h, c, r, fur(FUR), 2);
  for (const sx of [-1, 1]) orb(h, [sx * 0.125, -0.09, 0.19], [0.105, 0.095, 0.095], fur(CHEEK), 1);
  orb(h, [0, -0.07, 0.235], [0.085, 0.065, 0.065], fur(CHEEK), 1);
  orb(h, [0, -0.035, 0.29], [0.035, 0.028, 0.025], PINK, 0);
  // Buck tooth.
  h.box(0, -0.125, 0.27, 0.05, 0.06, 0.02, WHITE);
  eyes(h, 0.115, 0.05, surfaceZ([...c], [...r], 0.115, 0.05) - 0.002, 0.044);
  // Tall ears, leaning back and apart, pink inside; they come up through the helmet.
  for (const sx of [-1, 1]) {
    orb(h, [sx * 0.13, 0.44, -0.12], [0.07, 0.25, 0.045], fur(FUR), 1, [0, -0.38, -sx * 0.22]);
    orb(h, [sx * 0.13, 0.43, -0.085], [0.042, 0.2, 0.02], PINK, 1, [0, -0.38, -sx * 0.22]);
  }
  // The helmet: a cap over the crown with a peak.
  dome(h, [0, 0.045, -0.01], [0.315, 0.29, 0.31], shell(l), 0.42);
  h.box(0, 0.125, 0.29, 0.36, 0.035, 0.13, l.low, 0, -0.16);
  orb(h, [0, 0.33, -0.01], [0.05, 0.03, 0.05], WHITE, 0);
  void INK;

  const tail = new MeshBuilder();
  orb(tail, [0, 0, 0], [0.13, 0.12, 0.12], fur(CHEEK), 1);

  return {
    torso: t.build(),
    head: h.build(),
    arm: armGeometry({ fur: FUR, sleeve: l.vest, r: 0.068, hand: CHEEK }),
    shoulder: 0.27,
    crown: 0.62,
    bits: [
      {
        geo: tail.build(),
        at: [0, 0.14, -0.3],
        on: "torso",
        move(o, s) {
          o.position.x = Math.sin(s.time * 17) * 0.035 * s.happy - s.steer * 0.03;
          o.scale.setScalar(1 + Math.sin(s.time * 17) * 0.06 * s.happy);
        },
      },
    ],
  };
}
