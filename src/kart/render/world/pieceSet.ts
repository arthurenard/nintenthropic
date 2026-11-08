/**
 * The set pieces of Meadow, Kitchen and Harbour (track/pieces.ts lists their kinds, world/pieces.ts draws them with the
 * others): an acorn that drops from an oak bough, a tap's drip, a whisk's head on the mixer's arm and a container swung
 * from a crane. Each is one model on y = 0 facing +z, drawn instanced; the dress says how its gantry, pole or chain is
 * painted and where on it they hang.
 */
import { MeshBuilder, rgb, scaleRgb, shapes, xf, type Rgb, type V3 } from "./builder";
import type { PieceModel } from "./pieces";

const BARK = rgb("#6b4526");
const BARK_L = rgb("#a2703d");
const STEEL: Rgb = [0.62, 0.7, 0.82];
const STEEL_L: Rgb = [0.95, 1.05, 1.2];

/** A closed loop of thin rods in a vertical plane turned by `yaw` about the model's axis, an ellipse `rx` wide and `ry` tall about (0, cy). */
function wireLoop(b: MeshBuilder, yaw: number, rx: number, ry: number, cy: number, thick: number, paint: Rgb, n = 8): void {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const at = (k: number): V3 => {
    const a = (k / n) * Math.PI * 2;
    const x = Math.sin(a) * rx;
    return [x * c, cy + Math.cos(a) * ry, x * s];
  };
  for (let k = 0; k < n; k++) b.rod(at(k), at(k + 1), thick, paint);
}

export const SET_MODELS: Record<string, PieceModel> = {
  // An acorn: a tan nut ending in a point at the foot, a scaly dark cap, a short stalk to the bough.
  acorn: {
    radius: 1.3,
    hang: 3.5,
    gantry: rgb("#5a3a1c"),
    rod: rgb("#4a3018"),
    build(b) {
      const nut = { bottom: rgb("#9a6a30"), top: rgb("#d9a050") };
      b.blob(0, 1.75, 0, 1.12, 1.4, 1.12, nut, 1);
      b.add(shapes.cone(8), xf(0, 0.38, 0, 0.5, 0.78, 0.5, 0, Math.PI), rgb("#7a4c20"));
      // The cap: a flattened dome with rows of little scales round it.
      b.blob(0, 2.95, 0, 1.3, 0.78, 1.3, { bottom: rgb("#4a2c14"), top: rgb("#7a4a24") }, 1);
      for (let k = 0; k < 10; k++) {
        const a = (k / 10) * Math.PI * 2;
        b.blob(Math.cos(a) * 1.05, 2.7, Math.sin(a) * 1.05, 0.34, 0.2, 0.34, rgb("#3a2210"), 0);
        b.blob(Math.cos(a + 0.3) * 0.7, 3.2, Math.sin(a + 0.3) * 0.7, 0.3, 0.18, 0.3, rgb("#3a2210"), 0);
      }
      b.post(0, 3.55, 0, 0.17, 0.5, BARK, 6);
      b.blob(0.32, 1.9, 0.5, 0.2, 0.55, 0.12, rgb("#f0c27a"), 0);
    },
  },
  // A water drop: a round belly at the foot with a tail drawn up to the tap, clear blue with a bright glint.
  drip: {
    radius: 0.8,
    hang: 2.9,
    gantry: STEEL,
    rod: STEEL_L,
    flush: 0.35,
    build(b) {
      b.blob(0, 0.8, 0, 0.8, 0.8, 0.8, { bottom: rgb("#2a86e0"), top: rgb("#7fd4ff") }, 1);
      b.add(shapes.cone(8), xf(0, 1.95, 0, 0.62, 1.7, 0.62), { bottom: rgb("#52b2f2"), top: rgb("#d4f2ff") });
      b.blob(-0.27, 1.05, 0.5, 0.17, 0.3, 0.1, [2.0, 2.2, 2.4], 0);
    },
  },
  // A balloon whisk's head: four wire loops round a short stem, a steel collar on top.
  whisk: {
    radius: 1.25,
    rod: STEEL_L,
    build(b) {
      const wire = STEEL_L;
      for (let k = 0; k < 4; k++) wireLoop(b, (k / 4) * Math.PI, 0.95, 1.15, 1.25, 0.1, k % 2 ? wire : scaleRgb(wire, 0.82));
      b.post(0, 2.2, 0, 0.3, 0.6, { bottom: rgb("#8a96aa"), top: rgb("#dfe8f6") }, 8);
      b.blob(0, 0.2, 0, 0.22, 0.22, 0.22, scaleRgb(wire, 0.8), 0);
    },
  },
  // A shipping container hung from a crane's spreader: corrugated sides, corner castings, locking bars on the door end.
  "cargo-box": {
    radius: 2,
    hang: 3.4,
    alongRoad: true,
    build(b) {
      const side = { bottom: rgb("#a83a1c"), top: rgb("#e0643a") };
      b.box(0, 1.55, 0, 2.3, 2.5, 5.8, side);
      for (let i = 0; i < 12; i++) {
        const z = -2.6 + i * 0.47;
        for (const x of [-1.17, 1.17]) b.box(x, 1.55, z, 0.1, 2.3, 0.17, scaleRgb(rgb("#b84626"), 0.85));
      }
      for (const x of [-1, 1]) for (const z of [-2.8, 2.8]) for (const y of [0.35, 2.75]) b.box(x * 1.05, y, z, 0.3, 0.3, 0.3, rgb("#2a2a30"));
      b.box(0, 2.88, 0, 2.5, 0.22, 6.0, rgb("#e8b020"));
      for (const z of [-2.9, 2.9]) b.box(0, 1.55, z, 2.0, 2.3, 0.1, rgb("#8a2c14"));
      for (const x of [-0.55, 0.55]) b.box(x, 1.55, 3.0, 0.12, 2.2, 0.1, scaleRgb(STEEL, 0.9));
      b.post(0, 3.0, 0, 0.18, 0.55, rgb("#3a3a44"), 6);
    },
  },
};
