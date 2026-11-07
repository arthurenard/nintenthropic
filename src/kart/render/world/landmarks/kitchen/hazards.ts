/**
 * The kitchen's hazards: an orange that rolls down the road and a pea that
 * rolls across it (the shine on each stays on top while the ball turns under
 * it), and a teacup that spins and rocks as it orbits, puffing steam.
 */
import { Group, Mesh, type Object3D } from "three";
import { byHeight, lathe, MeshBuilder, mixRgb, ramp, rgb, rockBlob, scaleRgb, shapes, torus, tube, xf } from "../kit";
import type { HazardSpec } from "../types";
import { bezier, BLUE, CHINA, LEAF, lift, ORANGE, plaque, STALK, TAU } from "./common";

/** A ball rolls without slipping: the turn is the distance over the radius, and the layer has scaled the root by metres per natural unit. */
const rollAngle = (travel: number, root: Object3D, naturalRadius: number): number => travel / (naturalRadius * root.scale.x);

/** The ball of a rolling hazard on its own group (so it can turn), and a still highlight patch that stays put on top. */
function rollingBall(ctx: { lit: import("three").Material }, ball: MeshBuilder, highlight: MeshBuilder, r: number): { root: Group; spin: Group } {
  const spin = new Group();
  spin.add(new Mesh(ball.build(), ctx.lit));
  spin.position.y = r;
  const still = new Mesh(highlight.build(), ctx.lit);
  still.position.y = r;
  const root = new Group();
  root.add(spin, still);
  return { root, spin };
}

export const orange: HazardSpec = {
  build(ctx) {
    const b = new MeshBuilder();
    // The peel: a ball with a dimpled skin (every vertex nudged), darker at the foot.
    rockBlob(b, 0, 0, 0, 1, 0.97, 1, byHeight(-1, 1, scaleRgb(ORANGE, 0.7), mixRgb(ORANGE, [1, 1, 0.6], 0.12)), 5, { detail: 2, roughness: 0.035 });
    // The button where the stalk was, with a leaf, and darker pores scattered round it.
    b.blob(0, 0.96, 0, 0.2, 0.07, 0.2, LEAF, 0);
    b.rod([0, 0.98, 0], [0.12, 1.12, 0], 0.07, STALK);
    b.add(shapes.ball(0), xf(0.34, 1.0, 0.06, 0.34, 0.05, 0.14, 0.1, 0, 0.35), ramp(scaleRgb(LEAF, 0.7), LEAF));
    for (let k = 0; k < 14; k++) {
      const a = k * 2.4;
      const y = Math.sin(k * 1.7) * 0.85;
      const r = Math.sqrt(1 - y * y);
      b.blob(Math.cos(a) * r, y, Math.sin(a) * r, 0.07, 0.07, 0.07, scaleRgb(ORANGE, 0.58), 0);
    }
    // The shine does not turn with the peel.
    const h = new MeshBuilder();
    plaque(h, [0, 0, 0], 1.0, [0.3, 0.7, 0.65], 0.22, 0.4, 0.06, mixRgb(ORANGE, [1.6, 1.5, 1.2], 0.6), -0.5);
    const { root, spin } = rollingBall(ctx, b, h, 1);
    return {
      root,
      radius: 1,
      update(s) {
        spin.rotation.x = rollAngle(s.travel, root, 1);
      },
    };
  },
};

export const pea: HazardSpec = {
  build(ctx) {
    const b = new MeshBuilder();
    const green = lift("#6fd13b", 1.25);
    // A glossy pea: a smooth ball (finer than the orange's), with the pod's seam running round it and a tiny dark scar.
    b.blob(0, 0, 0, 0.7, 0.68, 0.7, ramp(scaleRgb(green, 0.65), mixRgb(green, [1, 1, 0.7], 0.18)), 2);
    torus(b, 0.7, 0.07, { facing: "z", ringSegments: 16, tubeSegments: 4, shade: scaleRgb(green, 0.5) });
    b.blob(0, 0.66, 0, 0.1, 0.05, 0.1, rgb("#2d4d1a"), 0);
    const h = new MeshBuilder();
    plaque(h, [0, 0, 0], 0.7, [0.35, 0.65, 0.7], 0.14, 0.27, 0.05, mixRgb(green, [1.6, 1.8, 1.4], 0.7), -0.5);
    const { root, spin } = rollingBall(ctx, b, h, 0.7);
    return {
      root,
      radius: 0.7,
      update(s) {
        // It crosses the road: the ball turns about its x axis as it advances along z.
        spin.rotation.x = rollAngle(s.travel, root, 0.7);
      },
    };
  },
};

export const teacup: HazardSpec = {
  build(ctx) {
    const cup = new MeshBuilder();
    const china = CHINA;
    // A saucer with a raised ring, and the cup on it with a rolled lip; the tea inside is dark.
    lathe(cup, [[0, 0.02], [0.8, 0.02], [1.0, 0.08], [1.6, 0.46], [1.66, 0.56], [1.55, 0.56], [1.0, 0.3], [0, 0.26]], { segments: 14, shade: byHeight(0, 0.6, scaleRgb(china, 0.8), china) });
    lathe(cup, [[0, 0.24], [0.5, 0.24], [0.55, 0.36], [0.98, 1.0], [1.08, 1.5], [1.14, 1.58], [1.05, 1.62], [0.96, 1.52], [0.9, 1.4], [0, 1.2]], { segments: 14, shade: byHeight(0.2, 1.6, scaleRgb(china, 0.85), china) });
    cup.add(shapes.cylinder(14), xf(0, 1.3, 0, 0.9, 0.06, 0.9), lift("#7a4320", 1.3));
    // Cobalt bands round the rim and the saucer, and a ring of painted dots.
    lathe(cup, [[1.1, 1.36], [1.16, 1.36], [1.17, 1.56], [1.11, 1.56]], { segments: 14, shade: BLUE });
    lathe(cup, [[1.5, 0.43], [1.62, 0.5], [1.64, 0.56], [1.5, 0.52]], { segments: 14, shade: BLUE });
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * TAU;
      cup.blob(Math.cos(a) * 1.04, 0.78, Math.sin(a) * 1.04, 0.1, 0.1, 0.1, BLUE, 0);
    }
    // The handle: a loop on one side.
    tube(cup, bezier([1.0, 1.25, 0], [1.9, 1.35, 0], [1.9, 0.5, 0], [0.7, 0.55, 0], 8), { radius: 0.12, sides: 5, shade: china });
    // Steam: three pale puffs of glow that drift up and thin out, kept apart from the china.
    const puffs: Mesh[] = [];
    const glowMat = ctx.glow;
    for (let k = 0; k < 3; k++) {
      const g = new MeshBuilder();
      g.blob(0, 0, 0, 0.24, 0.24, 0.24, [1.3, 1.3, 1.4], 1);
      const m = new Mesh(g.build(), glowMat);
      puffs.push(m);
    }
    const body = new Group();
    body.add(new Mesh(cup.build(), ctx.lit), ...puffs);
    const wobble = new Group();
    wobble.add(body);
    wobble.position.y = 0.5;
    body.position.y = -0.5;
    const root = new Group();
    root.add(wobble);
    return {
      root,
      radius: 1.6,
      update(s) {
        // Spinning about its own axis and rocking a little, as if on a ride.
        body.rotation.y = s.time * 2.6;
        wobble.rotation.x = Math.sin(s.time * 2.1) * 0.1;
        wobble.rotation.z = Math.cos(s.time * 2.1) * 0.1;
        puffs.forEach((p, k) => {
          const u = (s.time * 0.5 + k / 3) % 1;
          p.position.set(Math.sin(u * 6 + k * 2) * 0.22, 1.7 + u * 1.3, Math.cos(u * 5 + k) * 0.18);
          p.scale.setScalar(Math.max(0.01, Math.sin(Math.PI * u) * (1 + u)));
        });
      },
    };
  },
};

/** A slice of toast that shoots up out of the toaster's slot and drops back, on a spring: harmless while it is down. */
export const toast: HazardSpec = {
  build(ctx) {
    const b = new MeshBuilder();
    const crust = lift("#b9722c", 1.3);
    const crumb = lift("#f0cf8a", 1.3);
    b.box(0, 1.0, 0, 1.6, 2.0, 0.3, ramp(crust, crumb));
    b.blob(0, 2.0, 0, 0.8, 0.45, 0.15, crust, 1);
    b.box(0, 1.0, 0.16, 1.2, 1.6, 0.05, lift("#e0a850", 1.4));
    const root = new Group();
    root.add(new Mesh(b.build(), ctx.lit));
    return {
      root,
      radius: 1,
      update(s) {
        root.rotation.z = Math.sin(s.time * 1.7) * 0.08;
        root.rotation.y = Math.sin(s.cycle * Math.PI * 4) * 0.35;
      },
    };
  },
};
