/** Bramble the bear: broad and round, round ears over a helmet's edge, a tan muzzle, a stub of a tail. */
import { MeshBuilder, rgb } from "../kartBuilder";
import { INK, armGeometry, body, helmet, eyes, fur, legs, orb, surfaceZ, type Look } from "./parts";
import type { DriverBuild } from "./types";

const FUR = rgb("#7b4a2d");
const TAN = rgb("#dbb58c");

export function buildBear(l: Look): DriverBuild {
  const t = new MeshBuilder();
  body(t, l, { w: 0.34, d: 0.26, belly: TAN });
  legs(t, l, FUR, 0.115, 0.19);
  orb(t, [0, 0.13, -0.31], [0.09, 0.085, 0.085], fur(FUR), 1);

  const h = new MeshBuilder();
  const r = [0.33, 0.295, 0.3] as const;
  orb(h, [0, 0, 0], r, fur(FUR), 2);
  orb(h, [0, -0.09, 0.225], [0.15, 0.115, 0.125], fur(TAN), 1);
  orb(h, [0, -0.045, 0.335], [0.052, 0.036, 0.03], INK, 0);
  h.box(0, -0.09, 0.335, 0.014, 0.05, 0.014, INK);
  for (const sx of [-1, 1]) h.box(sx * 0.03, -0.125, 0.33, 0.06, 0.013, 0.014, INK, 0, 0, sx * 0.4);
  eyes(h, 0.13, 0.065, surfaceZ([0, 0, 0], [...r], 0.13, 0.065) - 0.004, 0.042);
  // Round ears that stand clear of the helmet.
  for (const sx of [-1, 1]) {
    orb(h, [sx * 0.215, 0.285, -0.07], [0.105, 0.105, 0.065], fur(FUR), 1);
    orb(h, [sx * 0.215, 0.285, -0.03], [0.065, 0.065, 0.03], fur(TAN), 0);
  }
  helmet(h, l, [0, 0.03, -0.01], [0.335, 0.31, 0.32], 0.4);

  return {
    torso: t.build(),
    head: h.build(),
    arm: armGeometry({ fur: FUR, sleeve: l.vest, r: 0.095, hand: FUR, handR: 0.115 }),
    shoulder: 0.37,
    crown: 0.5,
    bits: [],
  };
}
