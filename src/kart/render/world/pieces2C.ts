/**
 * The second pass's timed set pieces, drawn by pieces.ts like the first pass's: a model for each kind and a few notes on how it behaves.
 *
 *  - ember-rock (Volcano Rush): a bomb of black crust and live lava that comes in from the crater. It is a "crush"
 *    hazard that falls from the sky: no piston, no gantry. Its shadow on the road grows and reddens first (the
 *    telegraph), the rock itself drops out of the sky glowing, lies a moment and cools.
 *  - meteor (Starlight Ribbon): the same fall, an ice-blue rock with a long tail, striking the ribbon.
 *  - lava-surge (Volcano Rush): a tongue of lava that runs across the road on a beat ("slide"), a beacon before it.
 *  - tide-wave (Five Finger Circuit): a wave that washes across the beach road ("slide"), a flag and a lamp before it.
 *  - plasma-orb (Starlight Ribbon): a ball on an arm turning round a hub ("orbit", from `sweeper`).
 *
 * Models stand on y = 0, face +z (the way they move) and are `radius` metres across at their widest; the layer scales
 * them to each hazard's own radius.
 */
import { MeshBuilder, mixRgb, rgb, scaleRgb, shapes, xf, type Rgb } from "./builder";
import { rockBlob } from "./landmarks/kit";

export interface PieceModel2C {
  build(b: MeshBuilder): void;
  radius: number;
}

/** How a kind is dressed by the layer: whether it falls out of the sky, what draws under a slide. */
export interface PieceStyle2C {
  /** A "crush" that falls out of the sky: it has no piston or gantry, shows nothing until it warns, and cools when it has landed. */
  sky?: boolean;
  /** A "slide" without rails and sleepers. */
  bare?: boolean;
  /** A slide that rises out of the lake or the sea beside the road while it warns (instead of a lamp), then runs across. */
  rise?: boolean;
  /** How deep below the road a rising slide starts, as a share of the usual (default 1; 0: it appears at the road's edge and grows). */
  riseK?: number;
  /** Not flushed red-hot as it warns (the colour is its own: sea water, ice). */
  noFlush?: boolean;
  /** A lamp post at its way in (default true; false where there is nowhere to stand: a bridge, a beach). */
  post?: boolean;
  /** The lamp's colour while it waits (steady) and when it is about to come, as linear RGB. */
  lamp?: { idle: Rgb; warn: Rgb };
}

const LAVA_HOT: Rgb = [1.9, 1.2, 0.3];
const LAVA: Rgb = [1.5, 0.5, 0.08];
const LAVA_DEEP: Rgb = [1.0, 0.25, 0.05];
const CRUST_DARK: Rgb = [0.03, 0.022, 0.026];
const CRUST: Rgb = [0.09, 0.06, 0.06];

/** A lump with a lumpy rock look: a ball with a flat-ish bottom, split into a few plates. */
function plated(b: MeshBuilder, cx: number, cy: number, cz: number, r: number, bottom: Rgb, top: Rgb, seed: number): void {
  b.blob(cx, cy, cz, r, r * 0.82, r, { bottom, top }, 1, seed);
}

export const MODELS_2C: Record<string, PieceModel2C> = {
  // A bomb of the crater: a lump of black crust cracked open on glowing lava, a plume of flame streaming up behind it
  // (it is falling).
  "ember-rock": {
    radius: 2.2,
    build(b) {
      rockBlob(b, 0, 1.7, 0, 2.05, 1.75, 2.05, (p) => mixRgb([0.025, 0.018, 0.02], [0.16, 0.1, 0.09], Math.max(0, Math.min(1, (p[1] - 0.3) / 3.4))), 7, { detail: 1, roughness: 0.2 });
      // Cracks that run round it, bright lava in the seams: zigzags of thin bars over the surface, wandering from pole to pole.
      const R: [number, number, number] = [2.12, 1.82, 2.12];
      for (let k = 0; k < 7; k++) {
        let lon = k * 0.9 + 0.3;
        let lat = -0.15 + (k % 3) * 0.45;
        let prev: [number, number, number] | null = null;
        for (let i = 0; i < 6; i++) {
          const pt: [number, number, number] = [Math.cos(lat) * Math.sin(lon) * R[0], 1.7 + Math.sin(lat) * R[1], Math.cos(lat) * Math.cos(lon) * R[2]];
          if (prev) b.rod(prev, pt, 0.2, (k + i) % 3 === 0 ? LAVA_HOT : LAVA);
          prev = pt;
          lon += 0.4 + 0.2 * Math.sin(k * 3 + i * 2);
          lat += 0.28 * Math.cos(k + i * 1.7);
          lat = Math.max(-0.6, Math.min(1.25, lat));
        }
      }
      // Molten underneath, hidden from the side by the lip of the rock.
      b.blob(0, 0.7, 0, 1.35, 0.4, 1.35, { bottom: LAVA_DEEP, top: LAVA }, 0);
      // The flame it trails (up, because it is coming down): three layers, hottest in the middle, tapering away.
      b.add(shapes.cone(6), xf(0, 5.6, 0, 1.45, 6.2, 1.45), { bottom: LAVA_DEEP, top: [0.7, 0.14, 0.04] });
      b.add(shapes.cone(6), xf(0, 4.9, 0, 0.95, 4.6, 0.95), { bottom: LAVA, top: LAVA_DEEP });
      b.add(shapes.cone(5), xf(0, 4.3, 0, 0.55, 3.2, 0.55), { bottom: LAVA_HOT, top: LAVA });
      // A few sparks flung off it.
      for (let i = 0; i < 5; i++) {
        const a = i * 1.9;
        b.blob(Math.cos(a) * 2.2, 3.4 + (i % 3) * 0.9, Math.sin(a) * 2.2, 0.26, 0.26, 0.26, LAVA_HOT, 0);
      }
    },
  },
  // A meteor: pale ice-rock with crystal facets, a blue-white core and a streak of light behind it.
  meteor: {
    radius: 2.2,
    build(b) {
      const ICE: Rgb = [0.55, 0.78, 1.0];
      const ICE_HOT: Rgb = [0.7, 1.5, 2.6];
      const VIOLET: Rgb = [0.25, 0.2, 1.1];
      b.blob(0, 1.7, 0, 1.9, 1.55, 1.9, { bottom: [0.1, 0.12, 0.28], top: [0.45, 0.55, 0.9] }, 1, 1.1);
      // Crystal spikes bristling out of it.
      for (let i = 0; i < 9; i++) {
        const a = i * 0.7 + 0.2;
        const tilt = 0.7 + 0.12 * (i % 3);
        b.add(shapes.cone(4), xf(Math.cos(a) * 1.5, 1.8 + 0.7 * Math.sin(i * 2.3), Math.sin(a) * 1.5, 0.42, 1.8 + 0.3 * (i % 2), 0.42, -a, 0, 0), { bottom: ICE, top: ICE_HOT });
        void tilt;
      }
      b.blob(0, 1.7, 0, 1.1, 1.0, 1.1, ICE_HOT, 1);
      // The tail: a long cone of light, violet at its end.
      b.add(shapes.cone(6), xf(0, 6.6, 0, 1.15, 6.8, 1.15), { bottom: ICE_HOT, top: VIOLET });
      b.add(shapes.cone(5), xf(0, 5.4, 0, 0.55, 4.6, 0.55), { bottom: [1.4, 2.2, 3.0], top: ICE_HOT });
      for (let i = 0; i < 6; i++) {
        const a = i * 1.1;
        b.blob(Math.cos(a) * 2.1, 3.0 + (i % 3) * 1.1, Math.sin(a) * 2.1, 0.22, 0.22, 0.22, ICE_HOT, 0);
      }
    },
  },
  // A tongue of lava: a glowing swell with dark crust plates riding on it, fingers of flame along its crest, beads at its
  // front. Wide along x (the road), it moves along +z (across the road).
  "lava-surge": {
    radius: 1.5,
    build(b) {
      b.blob(0, 0.3, 0, 2.4, 1.1, 1.9, { bottom: LAVA_DEEP, top: LAVA }, 1);
      b.blob(0, 0.85, 0.35, 2.0, 1.1, 1.2, { bottom: LAVA, top: LAVA_HOT }, 1);
      // The front: a lip of bright lava, leaning forwards, with beads flying off it.
      b.blob(0, 1.3, 1.0, 1.8, 0.6, 0.65, LAVA_HOT, 1);
      for (let i = 0; i < 7; i++) {
        const x = -1.9 + i * 0.63;
        b.blob(x, 1.9 + 0.4 * Math.sin(i * 2.2), 1.75 + 0.3 * (i % 2), 0.22, 0.22, 0.22, LAVA_HOT, 0);
      }
      // Fingers of flame licking up along the crest.
      for (let i = 0; i < 6; i++) {
        const x = -1.8 + i * 0.72;
        b.add(shapes.cone(5), xf(x, 2.1 + 0.2 * (i % 2), 0.2 + 0.2 * (i % 3), 0.34, 1.5 + 0.5 * (i % 2), 0.34), { bottom: LAVA_HOT, top: LAVA_DEEP });
      }
      // Crust plates drifting on it.
      for (let i = 0; i < 5; i++) {
        b.box(-1.6 + i * 0.8, 1.7 + 0.1 * (i % 2), -0.7 + (i % 2) * 0.6, 0.9, 0.26, 0.7, { bottom: CRUST_DARK, top: [0.16, 0.1, 0.09] }, i * 0.9);
      }
      // The wake: a darker, cooler skirt behind.
      b.blob(0, 0.14, -1.4, 2.3, 0.22, 1.0, LAVA_DEEP, 0);
    },
  },
  // A breaker rolling up the beach: a teal swell with a curling lip of foam, spray at its crest, a sheet of foam behind.
  "tide-wave": {
    radius: 1.5,
    build(b) {
      const DEEP: Rgb = rgb("#0f8fa6");
      const MID: Rgb = rgb("#37c3d1");
      const FOAM: Rgb = rgb("#f5fdfd");
      b.blob(0, 0.35, -0.2, 2.35, 0.85, 1.7, { bottom: DEEP, top: MID }, 1);
      b.blob(0, 0.8, 0.45, 2.2, 0.8, 1.1, { bottom: MID, top: rgb("#8ee7ea") }, 1);
      // The curl: the crest leans over its own face. Foam all along the lip.
      for (let i = 0; i < 7; i++) {
        const x = -1.9 + i * 0.63;
        const h = 1.45 + 0.18 * Math.sin(i * 2.4);
        b.blob(x, h, 0.9 + 0.15 * (i % 2), 0.5, 0.34, 0.42, FOAM, 1);
      }
      b.blob(0, 1.25, 1.15, 2.0, 0.28, 0.4, { bottom: rgb("#bdf1f2"), top: FOAM }, 1);
      // Spray off the top, and a skirt of foam where it has been.
      for (let i = 0; i < 6; i++) b.blob(-1.6 + i * 0.64, 2.0 + 0.3 * Math.sin(i * 3.1), 0.7, 0.16, 0.16, 0.16, FOAM, 0);
      b.blob(0, 0.1, -1.5, 2.3, 0.12, 0.9, FOAM, 0);
      b.blob(0.6, 0.12, -2.0, 1.4, 0.1, 0.5, scaleRgb(FOAM, 0.9), 0);
    },
  },
  // A ball of plasma on its arm: a hot core in a glass shell, a ring round it and a few spikes.
  "plasma-orb": {
    radius: 1.4,
    build(b) {
      const CORE: Rgb = [1.7, 0.9, 2.2];
      const HALO: Rgb = [0.5, 1.4, 2.2];
      b.blob(0, 1.4, 0, 1.4, 1.4, 1.4, { bottom: [0.35, 0.15, 0.7], top: [1.2, 0.6, 1.9] }, 1);
      b.blob(0, 1.4, 0, 0.8, 0.8, 0.8, CORE, 1);
      // A ring, tilted, built of eight short bars.
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        b.box(Math.cos(a) * 1.55, 1.4 + Math.sin(a) * 0.5, Math.sin(a) * 1.55, 0.7, 0.2, 0.3, HALO, -a);
      }
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        b.add(shapes.cone(4), xf(Math.cos(a) * 1.5, 1.4 + (i % 2 ? 0.8 : -0.8), Math.sin(a) * 1.5, 0.2, 0.9, 0.2, a, 0, i % 2 ? 0.6 : -0.6), HALO);
      }
    },
  },
};

export const STYLES_2C: Record<string, PieceStyle2C> = {
  "ember-rock": { sky: true },
  meteor: { sky: true, noFlush: true },
  "lava-surge": { bare: true, rise: true, post: false },
  "tide-wave": { bare: true, rise: true, riseK: 0, post: false, noFlush: true },
  "plasma-orb": { noFlush: true },
};

export const KINDS_2C: readonly string[] = Object.keys(MODELS_2C);
