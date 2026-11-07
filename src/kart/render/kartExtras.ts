/**
 * Each driver's own touches on the kart: the bits of coachwork that make a
 * kart known at a glance and in silhouette, whoever sits in it. A cotton-tail
 * puff for the rabbit, a dorsal fin for the penguin, bulging eyes on the
 * frog's bonnet, twin swept fins for the fox, a surfboard for the otter, ears
 * on the cat's nose, a roll hoop for the bear, a dish and aerial for the
 * robot, a bill for the duck; and a crown on the golden kart.
 *
 * They are welded into the kart's one body geometry when it is made (the
 * builders merge them in), so they cost no draw call, and a kart without any
 * is as before. In the kart's frame: facing +z, its left +x.
 */
import { Matrix4, type BufferGeometry } from "three";
import { MeshBuilder, mixRgb, rgb, scaleRgb, type Rgb } from "./kartBuilder";
import { SURF } from "./kartMaterial";
import type { Species } from "./drivers";

const WHITE = rgb("#f7f8fb");
const INK: Rgb = [0.03, 0.03, 0.04];
const STEEL: Rgb = [0.62, 0.66, 0.74];
const GOLD: Rgb = [1.0, 0.52, 0.06];

type Make = (b: MeshBuilder, accent: Rgb) => void;

const MAKERS: Record<Species, Make> = {
  rabbit(b, accent) {
    // A cotton-tail puff on the engine cover, and a carrot-orange pair of fins on the wing's ends.
    b.as(SURF.fur, () => {
      b.blob(0, 1.27, -1.04, 0.17, 0.15, 0.15, WHITE, 1);
      b.blob(0.05, 1.32, -1.1, 0.09, 0.08, 0.08, mixRgb(WHITE, accent, 0.12), 1);
    });
    const carrot = rgb("#ff8a2b");
    b.as(SURF.paint, () => {
      for (const sx of [-1, 1]) b.spire(sx * 0.72, 1.17, -1.36, 0.09, 0.34, carrot, 6);
    });
    b.as(SURF.trim, () => {
      for (const sx of [-1, 1]) b.spire(sx * 0.72, 1.45, -1.36, 0.045, 0.14, rgb("#58c23a"), 6);
    });
  },
  penguin(b, accent) {
    // An ice-blue dorsal fin, swept back, with a stripe in the kart's colour.
    const ice = rgb("#bfe6ff");
    b.as(SURF.trim, () => {
      b.slab(0, 1.4, -1.12, 0.04, 0.42, 0.34, 0.018, ice, 0, 0.55);
      b.slab(0, 1.45, -1.17, 0.048, 0.2, 0.14, 0.018, accent, 0, 0.55);
    });
  },
  frog(b) {
    // Bulging eyes on the bonnet: the kart watches the road too.
    for (const sx of [-1, 1]) {
      b.as(SURF.paint, () => b.blob(sx * 0.2, 0.6, 1.14, 0.15, 0.13, 0.15, rgb("#74c64a"), 1));
      b.as(SURF.gloss, () => b.blob(sx * 0.2, 0.62, 1.27, 0.082, 0.082, 0.05, [0.98, 0.99, 1], 1));
      b.as(SURF.gloss, () => b.blob(sx * 0.2, 0.62, 1.31, 0.045, 0.05, 0.03, INK, 1));
    }
  },
  fox(b) {
    // Twin swept tail fins, white-tipped like a brush.
    const fur = rgb("#ee7f2d");
    for (const sx of [-1, 1]) {
      b.as(SURF.paint, () => {
        b.slab(sx * 0.5, 1.1, -1.3, 0.05, 0.56, 0.34, 0.02, fur, sx * 0.16, 0.42, sx * 0.1);
      });
      b.as(SURF.trim, () => b.slab(sx * 0.52, 1.37, -1.46, 0.056, 0.2, 0.2, 0.02, WHITE, sx * 0.16, 0.42, sx * 0.1));
    }
  },
  otter(b, accent) {
    // A surfboard strapped on behind the seat, standing up at the tail.
    const board = rgb("#f2fbff");
    b.as(SURF.paint, () => b.blob(0, 1.42, -1.22, 0.19, 0.5, 0.05, board, 1, 0));
    b.as(SURF.trim, () => {
      b.blob(0, 1.42, -1.265, 0.06, 0.46, 0.012, accent, 1);
    });
    b.as(SURF.steel, () => {
      b.rod([-0.34, 1.0, -1.15], [0.34, 1.0, -1.15], 0.04, STEEL);
      b.rod([-0.3, 1.32, -1.18], [0.3, 1.32, -1.18], 0.03, [0.9, 0.5, 0.2]);
    });
  },
  cat(b, accent) {
    // Pointed ears on the front fenders, and a pair of long whiskers off the nose.
    const fur = rgb("#ffae42");
    for (const sx of [-1, 1]) {
      b.as(SURF.paint, () => b.spire(sx * 0.46, 0.5, 1.02, 0.14, 0.34, fur, 4));
      b.as(SURF.trim, () => b.spire(sx * 0.46, 0.5, 1.07, 0.075, 0.24, mixRgb(WHITE, accent, 0.3), 4));
      b.as(SURF.steel, () => {
        b.rod([sx * 0.2, 0.48, 1.55], [sx * 0.95, 0.58, 1.72], 0.018, WHITE);
        b.rod([sx * 0.2, 0.43, 1.55], [sx * 0.9, 0.38, 1.76], 0.018, WHITE);
      });
    }
  },
  bear(b, accent) {
    // A roll hoop behind the seat, and a chunky bull bar on the nose.
    b.as(SURF.steel, () => {
      b.rod([-0.58, 0.8, -0.72], [-0.52, 1.5, -0.8], 0.07, STEEL);
      b.rod([0.58, 0.8, -0.72], [0.52, 1.5, -0.8], 0.07, STEEL);
      b.rod([-0.52, 1.5, -0.8], [0.52, 1.5, -0.8], 0.07, STEEL);
      b.rod([-0.42, 0.46, 1.72], [0.42, 0.46, 1.72], 0.09, scaleRgb(accent, 0.5));
    });
    b.as(SURF.paint, () => {
      for (const sx of [-1, 1]) b.blob(sx * 0.55, 1.52, -0.8, 0.09, 0.09, 0.09, accent, 1);
    });
  },
  robot(b, accent) {
    // An aerial with a lamp on its tip, and a dish.
    b.as(SURF.steel, () => {
      b.rod([0.52, 1.0, -1.2], [0.52, 1.72, -1.2], 0.03, STEEL);
      b.rod([-0.52, 1.0, -1.2], [-0.52, 1.34, -1.2], 0.035, STEEL);
    });
    b.as(SURF.lamp, () => b.blob(0.52, 1.76, -1.2, 0.055, 0.055, 0.055, [3.0, 0.3, 0.2], 1));
    b.as(SURF.paint, () => b.lathe([[0.001, 0], [0.06, 0.03], [0.17, 0.12], [0.17, 0.14], [0.14, 0.11], [0.001, 0.02]], new Matrix4().makeRotationX(-0.9).setPosition(-0.52, 1.36, -1.2), accent, 16));
  },
  duck(b) {
    // A rubber-duck bill over the nose, and a fan of tail feathers.
    const bill = rgb("#ff9626");
    b.as(SURF.paint, () => {
      b.blob(0, 0.5, 1.7, 0.32, 0.055, 0.3, bill, 1);
      b.blob(0, 0.53, 1.66, 0.22, 0.045, 0.2, rgb("#ffb04d"), 1);
    });
    const yellow = rgb("#ffd83a");
    b.as(SURF.paint, () => {
      for (const k of [-1, 0, 1]) b.spire(k * 0.16, 1.14, -1.1, 0.065, 0.3, yellow, 5);
    });
  },
};

/** The crown the golden kart wears on its engine cover. */
function crown(b: MeshBuilder): void {
  b.as(SURF.gold, () => {
    b.lathe([[0.27, 0], [0.31, 0.16], [0.28, 0.19], [0.25, 0.01]], new Matrix4().setPosition(0, 1.3, -1.0), GOLD, 20);
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      b.spire(Math.cos(a) * 0.28, 1.45, -1.0 + Math.sin(a) * 0.28, 0.07, 0.24, GOLD, 5);
      b.blob(Math.cos(a) * 0.28, 1.72, -1.0 + Math.sin(a) * 0.28, 0.05, 0.05, 0.05, [1.9, 0.5, 0.35], 0);
    }
  });
}

/** One species' touches in the kart's colour (and the golden kart's crown), as a geometry in the kart's frame, or null for none. */
export function kartExtras(species: Species, accent: Rgb, golden: boolean): BufferGeometry | null {
  const b = new MeshBuilder();
  MAKERS[species](b, accent);
  if (golden) crown(b);
  return b.index.length ? b.build() : null;
}
