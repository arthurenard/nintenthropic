/** Rivet the robot: a boxy steel body with a glowing chest lamp, headphone ears in the kart's colour and a blinking red antenna. */
import { MeshBuilder, mixRgb, rgb, scaleRgb, shapes, xf, type Rgb } from "../kartBuilder";
import { INK, armGeometry, dome, orb, shell, tube, type Look } from "./parts";
import { SURF } from "../kartMaterial";
import type { DriverBuild } from "./types";

const STEEL = rgb("#a4b4ca");
const SHADE = rgb("#5c687c");
const PALE = rgb("#dbe3ee");
const GLOW: Rgb = [0.35, 2.3, 2.5];

export function buildRobot(l: Look): DriverBuild {
  const steel = { bottom: scaleRgb(STEEL, 0.62), top: PALE };
  const t = new MeshBuilder();
  t.surf = SURF.steel;
  // Hips, chest, and the plate on the back.
  t.box(0, 0.1, -0.02, 0.5, 0.2, 0.4, { bottom: SHADE, top: STEEL });
  t.box(0, 0.35, 0, 0.6, 0.5, 0.4, steel);
  t.box(0, 0.35, 0, 0.54, 0.54, 0.44, steel);
  t.box(0, 0.37, -0.215, 0.44, 0.3, 0.05, { bottom: l.low, top: l.top }, 0, 0.1);
  // The chest lamp and two vents.
  t.as(SURF.lamp, () => t.add(shapes.cylinder(10), xf(0, 0.4, 0.205, 0.085, 0.03, 0.085, 0, Math.PI / 2, 0), GLOW));
  for (const sy of [0.25, 0.3]) t.box(0, sy, 0.205, 0.26, 0.02, 0.02, INK);
  // A backpack tank each side, capped in the kart's colour.
  for (const sx of [-1, 1]) {
    t.add(shapes.cylinder(8), xf(sx * 0.13, 0.4, -0.3, 0.075, 0.34, 0.075), STEEL);
    t.add(shapes.cylinder(8), xf(sx * 0.13, 0.58, -0.3, 0.082, 0.07, 0.082), { bottom: l.low, top: l.top });
  }
  // Shoulder balls, a neck, and thighs.
  for (const sx of [-1, 1]) {
    orb(t, [sx * 0.33, 0.47, 0.02], [0.105, 0.105, 0.105], SHADE, 1);
    tube(t, [sx * 0.15, 0.04, 0.0], [sx * 0.19, 0.0, 0.4], 0.085, { bottom: SHADE, top: STEEL });
    t.box(sx * 0.19, 0.0, 0.47, 0.15, 0.13, 0.2, SHADE);
  }
  t.add(shapes.cylinder(8), xf(0, 0.62, 0.0, 0.1, 0.14, 0.1), SHADE);

  const h = new MeshBuilder();
  h.surf = SURF.steel;
  // A head of three overlapping boxes, to take the edge off.
  h.box(0, 0.02, 0, 0.5, 0.36, 0.44, steel);
  h.box(0, 0.02, 0, 0.44, 0.42, 0.44, steel);
  h.box(0, 0.02, 0, 0.44, 0.36, 0.5, steel);
  // The face plate, two glowing eyes and a mouth of dots.
  h.as(SURF.gloss, () => h.box(0, 0.0, 0.225, 0.4, 0.26, 0.04, [0.02, 0.03, 0.06]));
  h.as(SURF.lamp, () => {
    for (const sx of [-1, 1]) h.box(sx * 0.1, 0.03, 0.25, 0.1, 0.08, 0.02, GLOW);
    for (const sx of [-1, 0, 1]) h.box(sx * 0.07, -0.08, 0.25, 0.04, 0.025, 0.02, mixRgb(GLOW, [1, 1, 1], 0.2));
  });
  // The helmet: a flat cap in the kart's colour, a visor brim, headphone ears.
  dome(h, [0, 0.17, -0.01], [0.285, 0.15, 0.27], shell(l), 0.55);
  h.as(SURF.paint, () => h.box(0, 0.16, 0.235, 0.46, 0.05, 0.12, { bottom: l.low, top: l.top }));
  for (const sx of [-1, 1]) {
    h.add(shapes.cylinder(12), xf(sx * 0.285, 0.0, 0.0, 0.11, 0.08, 0.11, 0, 0, Math.PI / 2), { bottom: l.low, top: l.top });
    h.add(shapes.cylinder(12), xf(sx * 0.33, 0.0, 0.0, 0.06, 0.03, 0.06, 0, 0, Math.PI / 2), SHADE);
  }
  // The antenna's stem; its bulb is a bit that blinks.
  tube(h, [0, 0.3, -0.04], [0, 0.45, -0.06], 0.014, SHADE);

  const bulb = new MeshBuilder();
  bulb.surf = SURF.lamp;
  orb(bulb, [0, 0, 0], [0.05, 0.05, 0.05], [2.4, 0.35, 0.3], 1);

  return {
    torso: t.build(),
    head: h.build(),
    arm: armGeometry({ fur: STEEL, sleeve: undefined, r: 0.065, hand: SHADE, handR: 0.1, surf: SURF.steel }),
    shoulder: 0.35,
    headAt: [0, 0.88, 0.05],
    crown: 0.52,
    bits: [
      {
        geo: bulb.build(),
        at: [0, 0.47, -0.06],
        on: "head",
        move(o, s) {
          o.scale.setScalar(0.7 + 0.5 * (0.5 + 0.5 * Math.sin(s.time * 5 + s.happy * 8)) + s.dizzy * 0.4);
        },
      },
    ],
  };
}
