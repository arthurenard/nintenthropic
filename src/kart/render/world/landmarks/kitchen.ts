/**
 * The kitchen's landmarks and hazards: toy karts on a giant counter, so a
 * teapot is thirty metres tall (docs/GRIP_PRIX.md, "What each theme can build").
 */
import { Group, Mesh } from "three";
import { byHeight, lathe, MeshBuilder, mixRgb, ramp, rgb, scaleRgb, tube, type V3 } from "./kit";
import type { HazardSpec, LandmarkSpec } from "./types";

const CHINA = rgb("#f7f3ea");
const BLUE = rgb("#2b6fc6");

export const LANDMARKS: Record<string, LandmarkSpec> = {
  /** A blue-and-white china teapot, thirty metres tall, its spout toward the road. */
  teapot: {
    footprint: 14,
    build() {
      const lit = new MeshBuilder();
      const shade = byHeight(0, 24, scaleRgb(CHINA, 0.72), CHINA);
      // The belly, turned from a profile: foot, bulge, shoulder, neck, lid and knob.
      lathe(
        lit,
        [
          [0, -2],
          [9, -2],
          [9.5, 0],
          [12.5, 4],
          [14.5, 10],
          [14, 15],
          [11, 20],
          [7.5, 22.5],
          [7.6, 23.2],
          [5.6, 24.4],
          [3.4, 26],
          [0.9, 27.2],
          [1.6, 28.6],
          [1.6, 30.2],
          [0, 31],
        ],
        { segments: 14, shade },
      );
      // Cobalt bands round the belly and the foot.
      for (const [y, r, h] of [[2.2, 11.4, 1.1], [9.5, 14.7, 1.4], [16.5, 12.8, 1.0]] as const) {
        lathe(lit, [[r, y - h / 2], [r + 0.12, y - h / 2], [r + 0.12, y + h / 2], [r, y + h / 2]], { segments: 14, shade: BLUE });
      }
      lathe(lit, [[8.4, 21.8], [8.9, 22.6], [6.4, 24.2], [5.9, 23.4]], { segments: 14, shade: BLUE });
      // The spout curls out toward +z and up; the handle loops behind.
      const spout: V3[] = [];
      for (let k = 0; k <= 8; k++) {
        const t = k / 8;
        spout.push([0, 6 + Math.pow(t, 1.6) * 14 + t * 2, 11 + t * 11 - (t * t) * 3]);
      }
      tube(lit, spout, { radius: (t) => 3.2 - 1.8 * t, sides: 8, shade, caps: true });
      const handle: V3[] = [];
      for (let k = 0; k <= 12; k++) {
        const a = -0.5 + (k / 12) * 2.6;
        handle.push([0, 14 + Math.sin(a) * 8.4, -12 - Math.cos(a) * 7 + 2.5]);
      }
      tube(lit, handle, { radius: 1.8, sides: 8, shade });
      // A little painted flower on the front.
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        lit.blob(Math.cos(a) * 2.6, 12 + Math.sin(a) * 2.6, 14.35, 1.5, 1.5, 0.35, rgb("#e8625d"), 0);
      }
      lit.blob(0, 12, 14.6, 1.3, 1.3, 0.4, rgb("#ffd34d"), 0);
      return { lit };
    },
  },
};

const ORANGE = rgb("#ff8a1c");

export const HAZARDS: Record<string, HazardSpec> = {
  /** An orange rolling down the counter against the traffic. */
  orange: {
    build(ctx) {
      const b = new MeshBuilder();
      b.blob(0, 0, 0, 1, 1, 1, ramp(scaleRgb(ORANGE, 0.75), mixRgb(ORANGE, [1, 1, 0.6], 0.12)), 2);
      // The little green button where the stalk was, and a few dimples.
      b.blob(0, 0.98, 0, 0.18, 0.06, 0.18, rgb("#4a8f2d"), 0);
      for (let k = 0; k < 10; k++) {
        const a = k * 2.4;
        const y = Math.sin(k * 1.7) * 0.8;
        const r = Math.sqrt(1 - y * y);
        b.blob(Math.cos(a) * r, y, Math.sin(a) * r, 0.1, 0.1, 0.1, scaleRgb(ORANGE, 0.62), 0);
      }
      const inner = new Group();
      inner.add(new Mesh(b.build(), ctx.lit));
      const root = new Group();
      inner.position.y = 1;
      root.add(inner);
      return {
        root,
        radius: 1,
        update(s) {
          // Rolling along its heading (+z): the turn is the distance over the radius.
          inner.rotation.x = s.travel;
        },
      };
    },
  },
};
