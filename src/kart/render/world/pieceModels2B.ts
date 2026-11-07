/**
 * The second-pass models of the timed set pieces (render/world/pieces.ts draws them: one instanced mesh per kind, posed each
 * frame from the race clock). The first pass drew them as plain boxes and blobs; these are built properly, in each theme's own
 * style, with bevels, bands, rivets and hand-painted details, and all still inside the radius the hazard is sized by.
 *
 * Each model stands on y = 0 (a crusher's underside, a ball's bottom), faces +z, and is `radius` metres across at its widest, so
 * the layer can scale it to the hazard's own radius. Colours may glow (a component above 1): the lamp on a cart, the bulbs on a
 * boat, a mirror's sheen.
 */
import { byHeight, mixRgb, ramp, rgb, rockBlob, scaleRgb, shapes, stamp, torus, xf, type Rgb, type V3 } from "./landmarks/kit";
import { horse } from "./landmarks/funfair/rides";
import { MeshBuilder } from "./builder";

export interface PieceModel {
  build(b: MeshBuilder): void;
  radius: number;
}

const STRIPE_Y = rgb("#f4c20d");
const STRIPE_K = rgb("#2a2420");
const IRON = rgb("#34343e");
const IRON_L = rgb("#5a5a68");
const STEEL = rgb("#9a9cb0");
const GOLD = rgb("#ffc233");
const RUST = rgb("#8a4a2a");
const CREAM = rgb("#fff3d6");
const RED = rgb("#e63950");
const NAVY = rgb("#2a2150");

const hash = (a: number, b = 0): number => {
  const h = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  return h - Math.floor(h);
};

/** Sandstone in bands, darker toward the foot. */
const strata = (seed: number) => (p: V3, i: number, j: number): Rgb => {
  const bands = [rgb("#e39a5d"), rgb("#c97b43"), rgb("#b4562f"), rgb("#d9a066"), rgb("#8a3d24")];
  const k = Math.floor(p[1] / 0.55 + hash(Math.floor(p[1] / 0.55), seed) * 0.8);
  return scaleRgb(bands[Math.abs(k) % bands.length]!, (0.75 + 0.25 * Math.min(1, Math.max(0, p[1] / 3))) * (0.92 + 0.16 * hash(i, j + seed)));
};

/** A hazard-striped skirt: alternating yellow and black slabs round the edge of a square foot. */
function hazardSkirt(b: MeshBuilder, half: number, y: number): void {
  for (let i = 0; i < 8; i++) {
    const t = -half + (i + 0.5) * ((2 * half) / 8);
    const c = i % 2 ? STRIPE_K : STRIPE_Y;
    b.box(t, y, -half, (2 * half) / 8, 0.3, 0.3, c);
    b.box(t, y, half, (2 * half) / 8, 0.3, 0.3, c);
    b.box(-half, y, t, 0.3, 0.3, (2 * half) / 8, c);
    b.box(half, y, t, 0.3, 0.3, (2 * half) / 8, c);
  }
}

export const MODELS_2B: Record<string, PieceModel> = {
  // A block of quarry rock in an iron cage: strata, steel straps with rivets, a hazard-striped skirt, a row of spikes under it
  // (the undersides are what the shadow warns of), and a hydraulic cap on top.
  "rock-crusher": {
    radius: 2.2,
    build(b) {
      hazardSkirt(b, 2.0, 0.7);
      // Spikes under the block.
      for (let i = 0; i < 9; i++) {
        const x = -1.5 + (i % 3) * 1.5;
        const z = -1.5 + Math.floor(i / 3) * 1.5;
        b.add(shapes.cone(5), xf(x, 0.45, z, 0.32, 0.9, 0.32, 0, Math.PI), ramp(IRON, STEEL));
      }
      b.box(0, 0.95, 0, 4.4, 0.35, 4.4, ramp(IRON, IRON_L));
      rockBlob(b, 0, 2.15, 0, 2.15, 1.35, 2.15, strata(7), 3, { detail: 1, roughness: 0.16 });
      rockBlob(b, 0.6, 3.2, -0.4, 1.4, 0.7, 1.3, strata(11), 5, { detail: 1, roughness: 0.2, flatBase: true });
      // Straps and rivets.
      for (const y of [1.55, 2.75]) {
        b.box(0, y, 0, 4.55, 0.28, 4.55, ramp(IRON, IRON_L));
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
          b.blob(Math.cos(a) * 2.28, y, Math.sin(a) * 2.28, 0.16, 0.16, 0.16, STEEL, 0);
        }
      }
      for (const s of [-1, 1]) b.box(s * 2.2, 2.15, 0, 0.3, 2.2, 0.5, ramp(IRON, IRON_L));
      // The hydraulic cap: a plate, a collar and a ram.
      b.box(0, 3.75, 0, 3.0, 0.4, 3.0, ramp(IRON, IRON_L));
      b.post(0, 3.9, 0, 0.95, 0.6, ramp(RUST, scaleRgb(RUST, 1.4)), 10);
      b.post(0, 4.5, 0, 0.55, 0.5, STEEL, 10);
    },
  },
  // A black iron ball with rivets round it, a yellow hazard band, a bright scuffed patch where it has been hitting things, and
  // a shackle eye on top for the chain.
  "wrecking-ball": {
    radius: 1.7,
    build(b) {
      b.blob(0, 1.7, 0, 1.7, 1.7, 1.7, { bottom: rgb("#17171d"), top: rgb("#52525f") }, 2);
      b.blob(0, 1.7, 0, 1.78, 0.34, 1.78, STRIPE_Y, 1);
      b.blob(0, 1.7, 0, 1.8, 0.1, 1.8, STRIPE_K, 1);
      for (let k = 0; k < 10; k++) {
        const a = (k / 10) * Math.PI * 2;
        b.blob(Math.cos(a) * 1.7, 2.55, Math.sin(a) * 1.7 * 0.97, 0.15, 0.15, 0.15, STEEL, 0);
        if (k % 2 === 0) b.blob(Math.cos(a + 0.3) * 1.62, 0.85, Math.sin(a + 0.3) * 1.62, 0.14, 0.14, 0.14, STEEL, 0);
      }
      b.blob(0.7, 1.05, 1.35, 0.55, 0.4, 0.3, rgb("#8c8c9c"), 1);
      // The eye: a collar, then a steel ring standing in the line of the swing.
      b.post(0, 3.2, 0, 0.5, 0.3, ramp(IRON, IRON_L), 8);
      torus(b, 0.34, 0.1, { at: [0, 3.7, 0], facing: "x", ringSegments: 10, tubeSegments: 5, shade: STEEL });
    },
  },
  // A mine cart of riveted iron: tapering sides, a rim, ribs, four spoked wheels on an axle, a coupling at each end, a heap of
  // gold-brown ore and a lamp on a bracket at the front.
  "ore-cart": {
    radius: 2,
    build(b) {
      const side = ramp(rgb("#4a3a34"), rgb("#8a5a3a"));
      // The tub: wider at the top. Four sloping walls.
      b.box(0, 0.62, 0, 2.0, 0.22, 3.4, rgb("#2c2a30"));
      for (const s of [-1, 1]) {
        b.box(s * 1.08, 1.15, 0, 0.18, 1.1, 3.6, side, 0, 0, s * 0.18);
        b.box(0, 1.15, s * 1.75, 2.5, 1.1, 0.18, side, 0, s * -0.12, 0);
        b.box(s * 1.2, 1.74, 0, 0.3, 0.16, 3.8, rgb("#2a2a32"));
        b.box(0, 1.74, s * 1.86, 2.7, 0.16, 0.3, rgb("#2a2a32"));
        for (let r = -1; r <= 1; r++) b.box(s * 1.18, 1.18, r * 1.1, 0.12, 1.0, 0.18, rgb("#3a3036"));
      }
      for (let k = 0; k < 6; k++) b.blob(1.02 * (k % 2 ? 1 : -1), 1.45, -1.4 + k * 0.55, 0.1, 0.1, 0.1, STEEL, 0);
      // Ore heaped over the top.
      rockBlob(b, 0, 1.95, 0, 1.0, 0.55, 1.5, byHeight(1.5, 2.5, rgb("#7a5a2a"), rgb("#e8b03a")), 4, { detail: 1, roughness: 0.3 });
      for (let k = 0; k < 6; k++) b.blob(-0.6 + hash(k, 1) * 1.2, 2.2 + hash(k, 2) * 0.2, -0.9 + hash(k, 3) * 1.8, 0.24, 0.2, 0.24, mixRgb(rgb("#f6d060"), rgb("#ffe9a0"), hash(k, 4)), 0);
      // Wheels on two axles and the couplings.
      for (const z of [-1.2, 1.2]) {
        b.box(0, 0.42, z, 2.6, 0.12, 0.12, IRON);
        for (const x of [-1.2, 1.2]) {
          torus(b, 0.34, 0.1, { at: [x, 0.42, z], facing: "x", ringSegments: 10, tubeSegments: 4, shade: IRON_L });
          b.add(shapes.cylinder(8), xf(x, 0.42, z, 0.12, 0.2, 0.12, 0, 0, Math.PI / 2), STEEL);
        }
      }
      for (const s of [-1, 1]) b.rod([0, 0.6, s * 1.8], [0, 0.55, s * 2.15], 0.2, IRON_L);
      // The lamp on a bracket, glowing.
      b.rod([0, 1.7, 1.85], [0, 2.1, 2.05], 0.08, IRON);
      b.box(0, 2.2, 2.1, 0.4, 0.4, 0.4, IRON);
      b.blob(0, 2.2, 2.2, 0.2, 0.2, 0.2, [4.0, 2.8, 1.1], 0);
    },
  },
  // A frozen stalactite cluster: one long glassy spear and a ring of shorter ones, a crust of rock and snow at the root, drips
  // of paler ice down the sides. Hangs from the roof: only the root of it is hidden by the cave.
  icicle: {
    radius: 1.5,
    build(b) {
      const spear = (x: number, z: number, r: number, h: number, tip = 0): void => {
        b.add(shapes.cone(6), xf(x, h / 2 + tip, z, r, h, r, hash(x * 7, z * 3) * 3, Math.PI), { bottom: rgb("#f2fbff"), top: rgb("#6fb0e6") });
        b.add(shapes.cone(6), xf(x, h / 2 + tip, z, r * 0.6, h * 0.98, r * 0.6, hash(x * 3, z * 7) * 3, Math.PI), { bottom: rgb("#ffffff"), top: rgb("#bfe4ff") });
      };
      spear(0, 0, 1.15, 5.2);
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2 + 0.4;
        spear(Math.cos(a) * 1.0, Math.sin(a) * 1.0, 0.4 + 0.2 * hash(k, 1), 2.2 + 1.8 * hash(k, 2), 0.4);
      }
      // The crust where it hangs from the roof: a lump of rock with snow on it.
      rockBlob(b, 0, 5.6, 0, 1.7, 0.9, 1.7, byHeight(4.7, 6.5, rgb("#3a4660"), rgb("#8ea2c4")), 2, { detail: 1, roughness: 0.25 });
      b.blob(0, 6.1, 0, 1.45, 0.5, 1.45, rgb("#f4fbff"), 1);
    },
  },
  // A carousel horse on its gold pole, galloping along the way the arm turns: the sweeper is a line of them nose to tail.
  "arm-ball": {
    radius: 2.3,
    build(b) {
      const coat = rgb("#fff4ec");
      const h = horse(coat, rgb("#ff9fb2"), RED);
      stamp(b, h, xf(0, 1.55, 0));
      b.post(0, 0, 0, 0.14, 4.2, GOLD, 8);
      b.blob(0, 0.15, 0, 0.55, 0.15, 0.55, GOLD, 0);
      b.post(0, 4.0, 0, 0.24, 0.3, RED, 8);
    },
  },
  // A funhouse wall: a gilt frame round three mirrored panels (pale glass with a bright streak), the two between painted in
  // red and cream zig-zags, a scalloped crest on top with a lamp at each end, and little casters under it.
  "funhouse-panel": {
    radius: 2,
    build(b) {
      const frame = ramp(rgb("#b08a1c"), GOLD);
      b.box(0, 0.35, 0, 0.7, 0.3, 4.3, ramp(NAVY, rgb("#4b3a8c")));
      b.box(0, 3.35, 0, 0.7, 0.3, 4.3, frame);
      for (let i = 0; i < 4; i++) b.box(0, 1.85, -2.05 + i * 1.37, 0.7, 3.0, 0.26, frame);
      for (let p = 0; p < 3; p++) {
        const z = -1.37 + p * 1.37;
        if (p === 1) {
          // Zig-zag stripes.
          for (let k = 0; k < 6; k++) b.box(0, 0.8 + k * 0.5, z, 0.5, 0.5, 1.12, k % 2 ? CREAM : RED, 0, 0, 0);
          for (let k = 0; k < 5; k++) b.rod([0.28, 0.6 + k * 0.55, z - 0.5], [0.28, 0.9 + k * 0.55, z + 0.5], 0.14, k % 2 ? RED : CREAM);
        } else {
          // Mirror: a pale blue sheet with a streak of brighter light across it, both faces.
          for (const s of [-1, 1]) {
            b.box(s * 0.28, 1.85, z, 0.12, 2.7, 1.12, rgb("#9fd2ee"));
            b.rod([s * 0.36, 1.0, z - 0.4], [s * 0.36, 2.8, z + 0.4], 0.22, [1.9, 2.1, 2.3]);
          }
        }
      }
      for (let k = 0; k < 4; k++) b.blob(0, 3.65, -1.7 + k * 1.14, 0.4, 0.3, 0.55, k % 2 ? RED : CREAM, 0);
      for (const s of [-1, 1]) b.blob(0, 3.75, s * 2.0, 0.22, 0.22, 0.22, [4.0, 2.6, 1.0], 0);
      for (const z of [-1.7, 1.7]) b.post(0, 0, z, 0.22, 0.2, IRON, 8);
    },
  },
  // A funfair high-striker mallet: a barrel head hooped in iron, red and cream bands, a gold star on the striking face, and a
  // socket for the handle; the flat of it comes down on the road.
  mallet: {
    radius: 2.2,
    build(b) {
      b.post(0, 0.0, 0, 1.95, 0.22, CREAM, 14);
      b.post(0, 0.2, 0, 1.9, 2.6, { bottom: rgb("#8a5a2c"), top: rgb("#d9a15f") }, 14, 0.96);
      for (const y of [0.55, 2.45]) b.post(0, y, 0, 2.02, 0.26, ramp(IRON, IRON_L), 14);
      b.post(0, 1.2, 0, 2.0, 0.6, RED, 14);
      b.post(0, 1.62, 0, 2.0, 0.16, CREAM, 14);
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        b.blob(Math.cos(a) * 2.0, 2.58, Math.sin(a) * 2.0, 0.13, 0.13, 0.13, STEEL, 0);
      }
      // A star on the top face (the face that strikes is the bottom one, so it is the cap that shows from the camera).
      b.post(0, 2.8, 0, 1.4, 0.2, GOLD, 14);
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2 - Math.PI / 2;
        b.rod([0, 3.0, 0], [Math.cos(a) * 1.1, 3.0, Math.sin(a) * 1.1], 0.34, RED);
      }
      b.post(0, 2.9, 0, 0.55, 0.5, ramp(RUST, scaleRgb(RUST, 1.4)), 10);
      b.post(0, 3.4, 0, 0.4, 0.5, { bottom: rgb("#c58b45"), top: rgb("#e8b36a") }, 8);
    },
  },
  // A pirate ship's boat: a blue hull with a curved prow and stern, a gold rail with a row of bulbs, a mast with a skull flag, a
  // red sail and a porthole stripe, seen from either end.
  "swing-boat": {
    radius: 2,
    build(b) {
      const hull = ramp(rgb("#1a4f94"), rgb("#4fb0ff"));
      b.box(0, 0.75, 0, 2.3, 1.0, 4.2, hull);
      for (const s of [-1, 1]) {
        b.box(0, 1.25, s * 2.3, 2.1, 1.3, 0.8, hull, 0, s * -0.35, 0);
        b.box(0, 1.9, s * 2.75, 1.7, 1.1, 0.5, hull, 0, s * -0.6, 0);
        b.box(0, 2.45, s * 3.0, 0.5, 0.6, 0.5, GOLD, 0, s * -0.7, 0);
        b.blob(0, 2.9, s * 3.05, 0.28, 0.28, 0.28, [4.0, 2.6, 1.0], 0);
      }
      b.box(0, 0.2, 0, 1.9, 0.4, 3.8, ramp(NAVY, rgb("#2a4fa0")));
      b.box(0, 1.55, 0, 2.4, 0.18, 4.4, GOLD);
      for (let k = 0; k < 6; k++) {
        const z = -1.8 + k * 0.72;
        for (const s of [-1, 1]) b.blob(s * 1.2, 1.78, z, 0.16, 0.16, 0.16, [4.0, 2.6, 1.0], 0);
        for (const s of [-1, 1]) b.blob(s * 1.17, 0.85, z, 0.22, 0.22, 0.12, CREAM, 0);
      }
      b.post(0, 1.5, 0, 0.1, 2.9, ramp(rgb("#6a4a2a"), rgb("#b08a52")), 6);
      // The sail and the flag.
      b.box(0.12, 2.6, 0.2, 0.06, 1.7, 1.4, RED, 0, 0, 0.08);
      b.box(0.12, 2.6, 0.2, 0.08, 0.3, 1.4, CREAM, 0, 0, 0.08);
      b.box(0.1, 4.2, 0.55, 0.06, 0.65, 0.95, rgb("#1c1c24"));
      b.blob(0.14, 4.25, 0.55, 0.06, 0.18, 0.18, CREAM, 0);
      b.rod([0.16, 4.1, 0.2], [0.16, 4.1, 0.9], 0.06, CREAM);
    },
  },
  // A slab of mountainside let go: a heap of white powder and packed snow lumps tumbling together, boulders and ice blocks in
  // the heap, a bank of spray out in front. It crosses the whole road, so it is wide and low and ugly to meet.
  avalanche: {
    radius: 3.2,
    build(b) {
      const snow = byHeight(0, 4, rgb("#dde9f4"), rgb("#ffffff"));
      rockBlob(b, 0, 1.5, 0, 3.0, 1.9, 3.0, snow, 1, { detail: 1, roughness: 0.18, flatBase: true });
      for (let k = 0; k < 9; k++) {
        const a = (k / 9) * Math.PI * 2 + 0.3;
        const r = 2.1 + hash(k, 5) * 0.9;
        const s = 0.9 + hash(k, 6) * 0.9;
        rockBlob(b, Math.cos(a) * r, s * 0.9, Math.sin(a) * r, s, s, s, snow, k + 3, { detail: 1, roughness: 0.2, flatBase: true });
      }
      // Dark boulders and blue ice blocks caught in it.
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2 + 1.1;
        rockBlob(b, Math.cos(a) * 1.7, 2.2 + hash(k, 1) * 0.8, Math.sin(a) * 1.7, 0.8, 0.7, 0.8, rgb("#3a3e52"), k + 11, { detail: 0, roughness: 0.3 });
        b.box(Math.cos(a + 0.8) * 1.9, 2.6, Math.sin(a + 0.8) * 1.9, 0.9, 0.7, 0.9, rgb("#9fd8ff"), a, 0.3, 0.2);
      }
      // The spray: a tall plume leaning forward over the heap.
      b.blob(0, 3.6, 0.9, 1.9, 1.4, 1.7, rgb("#f4fbff"), 1);
      b.blob(0.8, 4.4, 1.3, 1.1, 0.9, 1.0, rgb("#ffffff"), 1);
      b.blob(-0.9, 4.1, 1.0, 1.0, 0.8, 0.9, rgb("#e6f2ff"), 1);
    },
  },
};
