/**
 * The funfair's hazards: a teacup ride that spins as it orbits on the road,
 * and a bumper car that crosses it, rocking with the ground it covers.
 */
import { Group, Mesh } from "three";
import { byHeight, lathe, MeshBuilder, mixRgb, pipe, ramp, rgb, scaleRgb, shapes, stripes, torus, tube, xf } from "../kit";
import type { HazardSpec } from "../types";
import { bulb, GOLD, lightAt, STEEL, TAU, WHITE } from "./common";

export const teacupRide: HazardSpec = {
  build(ctx) {
    const base = new MeshBuilder();
    const baseGlow = new MeshBuilder();
    // A round platform ringed with bulbs.
    lathe(base, [[0, 0], [2.3, 0], [2.3, 0.22], [2.1, 0.34], [0, 0.34]], { segments: 16, shade: stripes(rgb("#6b58b8"), rgb("#9a86e8")), caps: "top" });
    for (let q = 0; q < 14; q++) {
      const a = (q / 14) * TAU;
      bulb(baseGlow, Math.cos(a) * 2.05, 0.42, Math.sin(a) * 2.05, 0.3, lightAt(q));
    }
    // The cup: striped pastel body, gold rim, a handle, a seat, a bar and a little wheel.
    const cup = new MeshBuilder();
    const pastel = stripes(rgb("#ff9ec8"), rgb("#fff3f8"));
    lathe(cup, [[0.7, 0.34], [1.15, 0.5], [1.55, 0.95], [1.68, 1.5], [1.66, 1.75]], { segments: 12, shade: pastel, caps: "bottom" });
    lathe(cup, [[1.64, 1.7], [1.78, 1.7], [1.78, 1.9], [1.64, 1.9]], { segments: 12, shade: GOLD });
    lathe(cup, [[1.5, 1.7], [1.2, 0.95], [0.7, 0.5]], { segments: 12, shade: rgb("#c9a3d9") });
    cup.box(0, 1.0, -0.75, 1.9, 0.3, 0.7, ramp(rgb("#2a6fd0"), rgb("#58a8f0")));
    cup.box(0, 1.55, -1.1, 1.9, 0.7, 0.2, rgb("#58a8f0"));
    tube(cup, [[-0.75, 1.65, 0.55], [-0.75, 1.9, 0.7], [0.75, 1.9, 0.7], [0.75, 1.65, 0.55]], { radius: 0.09, sides: 4, shade: STEEL });
    torus(cup, 0.38, 0.09, { at: [0, 1.45, 0.1], facing: "y", ringSegments: 10, tubeSegments: 4, shade: GOLD });
    pipe(cup, [0, 0.95, 0.1], [0, 1.45, 0.1], 0.1, STEEL, 4);
    tube(cup, [[1.72, 1.55, 0], [2.05, 1.5, 0], [2.15, 1.2, 0], [1.9, 0.85, 0], [1.6, 0.8, 0]], { radius: 0.12, sides: 4, shade: GOLD });
    const g = new Group();
    const baseMesh = new Mesh(base.build(), ctx.lit);
    const baseGlowMesh = new Mesh(baseGlow.build(), ctx.glow);
    const spin = new Group();
    spin.add(new Mesh(cup.build(), ctx.lit));
    g.add(baseMesh, baseGlowMesh, spin);
    return {
      root: g,
      radius: 2.3,
      update(s) {
        spin.rotation.y = s.time * 2.8;
        spin.position.y = 0;
      },
    };
  },
};

export const bumperCar: HazardSpec = {
  build(ctx) {
    const b = new MeshBuilder();
    const gl = new MeshBuilder();
    const col = rgb("#ff3d7a");
    // A round-bodied dodgem: floor skirt, bubble body, black rubber ring, seat and wheel.
    lathe(b, [[0.7, 0.2], [1.0, 0.3], [1.08, 0.7], [0.98, 1.05], [0.7, 1.25], [0.45, 1.3]], { segments: 12, shade: byHeight(0.2, 1.3, scaleRgb(col, 0.7), mixRgb(col, WHITE, 0.2)) });
    torus(b, 1.16, 0.24, { at: [0, 0.55, 0], facing: "y", ringSegments: 14, tubeSegments: 5, shade: rgb("#232323") });
    b.box(0, 1.0, -0.35, 0.9, 0.3, 0.6, rgb("#3b82ff"));
    b.box(0, 1.35, -0.62, 0.9, 0.7, 0.18, rgb("#1fc8c8"));
    b.box(0, 1.15, 0.45, 0.6, 0.3, 0.3, rgb("#fff1d6"));
    torus(b, 0.28, 0.07, { at: [0, 1.45, 0.4], facing: "z", ringSegments: 10, tubeSegments: 4, shade: rgb("#232323") });
    b.rod([0, 1.2, 0.5], [0, 1.45, 0.4], 0.14, STEEL);
    // The pole at the back, topped by a sparkling lamp.
    pipe(b, [0, 1.0, -0.78], [0, 3.4, -0.78], 0.09, STEEL, 5);
    b.blob(0, 3.5, -0.78, 0.2, 0.2, 0.2, STEEL, 0);
    gl.add(shapes.ball(1), xf(0, 3.72, -0.78, 0.26), [4, 3.4, 1.2]);
    gl.rod([-0.45, 3.72, -0.78], [0.45, 3.72, -0.78], 0.09, [3, 2.6, 1]);
    gl.rod([0, 3.27, -0.78], [0, 4.17, -0.78], 0.09, [3, 2.6, 1]);
    // The headlamp, and a stripe down the bonnet.
    gl.add(shapes.ball(0), xf(0, 0.8, 1.0, 0.22, 0.2, 0.12), [4, 3.4, 1.8]);
    b.box(0, 1.28, 0.1, 0.18, 0.06, 1.0, WHITE);
    const inner = new Group();
    inner.add(new Mesh(b.build(), ctx.lit), new Mesh(gl.build(), ctx.glow));
    const root = new Group();
    root.add(inner);
    return {
      root,
      radius: 1.5,
      update(s) {
        // The whole car rocks a little with the road it covers.
        inner.rotation.z = 0.06 * Math.sin(s.travel * 0.9);
        inner.rotation.x = 0.04 * Math.sin(s.travel * 1.4 + 1);
        inner.position.y = 0.04 * (1 + Math.sin(s.travel * 2.2));
      },
    };
  },
};
