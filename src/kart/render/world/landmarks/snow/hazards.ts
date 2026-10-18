/**
 * The snow world's hazards: a penguin waddling across the road, a snowball
 * rolling down it with powder kicked up behind, and a yeti who pops out of a
 * mound of snow to roar.
 */
import { Group, Mesh, type Material } from "three";
import { byHeight, MeshBuilder, ramp, rgb, rockBlob, scaleRgb, shapes, stripes, torus, xf, type Rgb, type V3 } from "../kit";
import { beam, hash, hazardGlass, vec } from "../rockKit";
import type { HazardSpec } from "../types";
import { SNOW, SNOW_LOW, SNOW_MID, snowShade } from "./common";

const meshOf = (b: MeshBuilder, mat: Material): Mesh => new Mesh(b.build(), mat);

/** A penguin waddling along +z: body rocking, flippers swinging, feet taking turns. */
export const penguin: HazardSpec = {
  build(ctx) {
    const root = new Group();
    const body = new Group();
    root.add(body);
    const NAVY = rgb("#232a3c");
    const NAVY_HI = rgb("#3a4560");
    const ORANGE = rgb("#ff9a2a");
    const BELLY: Rgb = [1.35, 1.3, 1.15];
    const b = new MeshBuilder();
    b.blob(0, 0.95, -0.02, 0.5, 0.82, 0.45, ramp(NAVY, NAVY_HI), 1);
    b.blob(0, 0.88, 0.16, 0.4, 0.68, 0.36, ramp([1.0, 0.95, 0.9], BELLY), 1);
    b.blob(0, 1.78, 0.04, 0.31, 0.3, 0.3, ramp(NAVY_HI, NAVY), 1);
    b.blob(0, 1.5, 0.2, 0.24, 0.2, 0.16, ramp(ORANGE, [1.6, 1.3, 0.35]), 0); // the golden throat
    for (const s of [-1, 1]) {
      b.blob(s * 0.2, 1.88, 0.27, 0.1, 0.1, 0.05, rgb("#ffffff"), 0);
      b.blob(s * 0.2, 1.88, 0.31, 0.055, 0.055, 0.03, rgb("#101216"), 0);
      b.blob(s * 0.2, 1.74, 0.26, 0.09, 0.07, 0.06, rgb("#ffb0a8"), 0); // pink cheeks
    }
    b.add(shapes.cone(5), xf(0, 1.74, 0.42, 0.075, 0.32, 0.075, 0, Math.PI / 2 + 0.22), ramp(rgb("#d9701a"), ORANGE));
    b.add(shapes.cone(5), xf(0, 0.55, -0.55, 0.2, 0.5, 0.18, 0, -Math.PI / 2 - 0.5), NAVY); // tail
    // A little red scarf in the track's colours.
    torus(b, 0.27, 0.085, { at: [0, 1.52, 0.02], facing: "y", ringSegments: 10, tubeSegments: 4, shade: stripes(rgb("#d6352e"), rgb("#f5f5ff"), "row", 1) });
    b.box(0.2, 1.3, 0.22, 0.14, 0.55, 0.08, rgb("#d6352e"), 0, 0, 0.1);
    body.add(meshOf(b, ctx.lit));
    const wing = (side: number): Group => {
      const g = new Group();
      g.position.set(side * 0.5, 1.4, 0);
      const f = new MeshBuilder();
      f.blob(side * 0.09, -0.3, 0, 0.07, 0.42, 0.2, ramp(NAVY_HI, NAVY), 0);
      g.add(meshOf(f, ctx.lit));
      body.add(g);
      return g;
    };
    const wings = [wing(-1), wing(1)];
    const foot = (side: number): Group => {
      const g = new Group();
      g.position.set(side * 0.24, 0, 0.05);
      const f = new MeshBuilder();
      f.blob(0, 0.07, 0.14, 0.17, 0.07, 0.3, ramp(rgb("#d9701a"), ORANGE), 0);
      g.add(meshOf(f, ctx.lit));
      root.add(g);
      return g;
    };
    const feet = [foot(-1), foot(1)];
    return {
      root,
      radius: 0.7,
      update(s) {
        // One full waddle (a step with each foot) every 1.4 m of walking.
        const ph = (s.travel / 1.4) * Math.PI * 2;
        body.rotation.z = Math.sin(ph) * 0.14;
        body.rotation.y = Math.sin(ph + 1.2) * 0.05;
        body.position.y = Math.abs(Math.sin(ph)) * 0.05;
        wings[0]!.rotation.z = 0.3 + Math.sin(ph) * 0.4;
        wings[1]!.rotation.z = -0.3 + Math.sin(ph) * 0.4;
        feet[0]!.position.y = Math.max(0, Math.sin(ph)) * 0.13;
        feet[1]!.position.y = Math.max(0, -Math.sin(ph)) * 0.13;
        feet[0]!.position.z = 0.05 + Math.cos(ph) * 0.12;
        feet[1]!.position.z = 0.05 - Math.cos(ph) * 0.12;
      },
    };
  },
};

/** A big rolling snowball: chunky lumps, stones and two sticks stuck in it, and a trail of powder. */
export const snowball: HazardSpec = {
  build(ctx) {
    const root = new Group();
    const inner = new Group();
    inner.position.y = 1.5;
    root.add(inner);
    const b = new MeshBuilder();
    const shade = byHeight(-1.5, 1.5, SNOW_LOW, SNOW);
    rockBlob(b, 0, 0, 0, 1.45, 1.45, 1.45, shade, 3, { detail: 1, roughness: 0.1 });
    // Packed-on lumps all round, so the outline stays chunky as it turns.
    for (let k = 0; k < 14; k++) {
      const y = 1 - 2 * ((k + 0.5) / 14);
      const r = Math.sqrt(1 - y * y);
      const a = k * 2.399;
      const s = 0.4 + hash(k, 2) * 0.3;
      b.blob(Math.cos(a) * r * 1.28, y * 1.28, Math.sin(a) * r * 1.28, s, s * 0.85, s, ramp(SNOW_MID, SNOW), 0, a);
    }
    // Pebbles and a couple of sticks caught in it.
    for (let k = 0; k < 7; k++) {
      const y = 0.9 - k * 0.3 + (hash(k, 7) - 0.5) * 0.2;
      const r = Math.sqrt(Math.max(0.05, 1 - y * y));
      const a = k * 1.9 + 0.5;
      b.blob(Math.cos(a) * r * 1.55, y * 1.55, Math.sin(a) * r * 1.55, 0.2, 0.15, 0.2, rgb("#59606e"), 0, a);
    }
    for (let k = 0; k < 2; k++) {
      const a = 1.1 + k * 2.6;
      const y = 0.3 - k * 0.6;
      const r = Math.sqrt(1 - y * y);
      const p0: V3 = [Math.cos(a) * r * 1.3, y * 1.3, Math.sin(a) * r * 1.3];
      beam(b, p0, vec.add(p0, vec.mul(vec.norm(p0), 0.9)), 0.17, 0.17, [0, 1, 0], rgb("#5b3d26"));
    }
    inner.add(meshOf(b, ctx.lit));
    // Powder kicked up behind: a few translucent puffs trailing along -z.
    const puffs: Mesh[] = [];
    for (let k = 0; k < 3; k++) {
      const pb = new MeshBuilder();
      pb.blob(0, 0, 0, 0.9, 0.55, 0.9, rgb("#e8f0ff"), 0);
      const m = meshOf(pb, hazardGlass());
      root.add(m);
      puffs.push(m);
    }
    return {
      root,
      radius: 1.5,
      update(s) {
        // Rolling without slipping: the turn is the distance over the radius it is drawn at.
        inner.rotation.x = s.travel / (1.5 * root.scale.y);
        puffs.forEach((m, k) => {
          const u = (((s.time * 1.3 + k / 3) % 1) + 1) % 1;
          m.position.set(Math.sin(k * 2.1) * 0.7, 0.4 + u * 0.7, -1.7 - u * 2.2);
          m.scale.setScalar(0.5 + u * 0.9);
        });
      },
    };
  },
};

/** A yeti who pops out of a snow mound to roar: shaggy, blue-faced, tusked, and a bit daft. */
export const yeti: HazardSpec = {
  build(ctx) {
    const root = new Group();
    const mound = new Group();
    const figure = new Group();
    root.add(mound, figure);
    const FUR: Rgb[] = [[1.7, 1.55, 1.15], [1.35, 1.3, 1.2], [1.05, 1.1, 1.2], [1.55, 1.45, 1.2]];
    const furAt = (k: number): Rgb => FUR[k % FUR.length]!;
    // The permanent mound the yeti climbs out of: it stays put while the figure rises.
    const m = new MeshBuilder();
    rockBlob(m, 0, 0, 0, 2.3, 1.25, 2.3, byHeight(0, 1.2, SNOW_MID, SNOW), 5, { detail: 1, roughness: 0.1, flatBase: true });
    for (let k = 0; k < 6; k++) {
      const a = k * 1.05;
      rockBlob(m, Math.cos(a) * 2.1, 0, Math.sin(a) * 2.1, 0.8 + hash(k, 1) * 0.5, 0.45, 0.8, snowShade(0, 0.5), k + 9, { detail: 0, roughness: 0.2, flatBase: true });
    }
    mound.add(meshOf(m, ctx.lit));
    // The figure, about 3.2 m tall with its feet at the origin.
    const f = new MeshBuilder();
    const lump = (cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, k: number, ramped = true) => f.blob(cx, cy, cz, rx, ry, rz, ramped ? ramp(scaleRgb(furAt(k), 0.7), furAt(k)) : furAt(k), 0, k);
    // Legs and feet.
    for (const s of [-1, 1]) {
      lump(s * 0.62, 0.5, 0.05, 0.5, 0.55, 0.5, s + 4);
      lump(s * 0.66, 0.2, 0.45, 0.46, 0.22, 0.55, s + 7);
    }
    // Torso: a big core with shaggy lumps clustered over it.
    f.blob(0, 1.75, 0, 1.15, 1.2, 0.98, ramp(scaleRgb(FUR[1]!, 0.75), FUR[0]!), 1);
    for (let k = 0; k < 44; k++) {
      const y = 1 - 2 * ((k + 0.5) / 44);
      const r = Math.sqrt(1 - y * y);
      const a = k * 2.399;
      const s = 0.26 + hash(k, 3) * 0.14;
      lump(Math.cos(a) * r * 1.1, 1.75 + y * 1.15, Math.sin(a) * r * 0.96, s, s, s, k);
    }
    f.blob(0, 1.5, 0.78, 0.7, 0.8, 0.4, ramp([1.0, 1.0, 1.1], [1.5, 1.5, 1.6]), 0); // pale tummy
    // The head: fur on top, an ice-blue face, huge eyes, a roaring mouth with tusks.
    const head = new Group();
    head.position.set(0, 2.65, 0.1);
    const hb = new MeshBuilder();
    hb.blob(0, 0.1, 0, 0.8, 0.72, 0.74, ramp(scaleRgb(FUR[1]!, 0.85), FUR[0]!), 1);
    for (let k = 0; k < 11; k++) {
      const a = (k / 11) * Math.PI * 2;
      hb.blob(Math.cos(a) * 0.6, 0.5 + hash(k, 5) * 0.12, Math.sin(a) * 0.52 - 0.1, 0.22, 0.2, 0.22, ramp(scaleRgb(furAt(k), 0.8), furAt(k)), 0, a);
    }
    hb.blob(0, 0.15, 0.58, 0.58, 0.5, 0.26, ramp(rgb("#5fb6ec"), rgb("#9fdcff")), 1); // the face
    hb.blob(0, -0.08, 0.76, 0.34, 0.25, 0.13, rgb("#37131c"), 0); // open mouth
    hb.blob(0, -0.17, 0.8, 0.2, 0.08, 0.1, rgb("#e0607a"), 0); // tongue
    for (const s of [-1, 1]) {
      hb.add(shapes.cone(5), xf(s * 0.2, 0, 0.83, 0.09, 0.28, 0.09, 0, 0, 0), rgb("#fffbea")); // tusks, point up from the lower jaw
      hb.add(shapes.cone(5), xf(s * 0.2, -0.08, 0.84, 0.09, -0.3, 0.09), rgb("#fffbea")); // and one down
      hb.blob(s * 0.27, 0.34, 0.74, 0.2, 0.21, 0.1, rgb("#ffffff"), 1); // eyes
      hb.blob(s * 0.27, 0.33, 0.83, 0.09, 0.1, 0.05, rgb("#101216"), 0);
      hb.blob(s * 0.27, 0.57, 0.7, 0.26, 0.1, 0.12, ramp(scaleRgb(FUR[2]!, 0.8), FUR[2]!), 0, s); // shaggy brows
    }
    head.add(meshOf(hb, ctx.lit));
    figure.add(head);
    // Long arms, raised: a chain of lumps from shoulder to a clawed hand.
    const arms: Group[] = [];
    for (const s of [-1, 1]) {
      const g = new Group();
      g.position.set(s * 1.1, 2.35, 0.05);
      const ab = new MeshBuilder();
      const pts: V3[] = [[s * 0.2, 0.0, 0], [s * 0.45, 0.38, 0.08], [s * 0.7, 0.75, 0.18], [s * 0.95, 1.12, 0.28], [s * 1.12, 1.5, 0.36]];
      pts.forEach((p, k) => {
        const r = 0.36 - k * 0.025;
        ab.blob(p[0], p[1], p[2], r, r, r, ramp(scaleRgb(furAt(k + 1), 0.8), furAt(k + 1)), 0, k);
        ab.blob(p[0] + s * 0.15, p[1] + 0.1, p[2] - 0.1, r * 0.8, r * 0.8, r * 0.8, furAt(k + 2), 0, k + 1);
      });
      for (let c = 0; c < 3; c++) {
        const base: V3 = [s * (1.2 + (c - 1) * 0.12), 1.8, 0.4 + (c - 1) * 0.28];
        ab.add(shapes.cone(5), xf(base[0], base[1] + 0.22, base[2], 0.1, 0.5, 0.1, 0, 0, -s * (c - 1) * 0.35), rgb("#eaf2ff"));
      }
      g.add(meshOf(ab, ctx.lit));
      figure.add(g);
      arms.push(g);
    }
    figure.add(meshOf(f, ctx.lit));
    return {
      root,
      radius: 2,
      update(s) {
        // `height` is in the layer's metres; the model is in its own, so divide the scale out.
        const sc = root.scale.y || 1;
        const h = s.height / sc;
        mound.position.y = -h;
        // The yeti stands on the mound as soon as it is up, and hops a little at the top of its pop.
        const feet = h < 1 ? h : 1 + (h - 1) * 0.3;
        // Deep down it sinks a little further, so nothing but mound shows.
        figure.position.y = feet - h - 0.9 * Math.max(0, Math.min(1, (-h - 1.8) / 1.2));
        const up = Math.max(0, Math.min(1, (h + 2.4) / 2.2)); // arms stay tucked while it is mostly buried
        const roar = 0.5 + 0.5 * Math.sin(s.time * 8);
        arms[0]!.rotation.z = -(1 - up) * 1.1 + Math.sin(s.time * 6) * 0.22 * up;
        arms[1]!.rotation.z = (1 - up) * 1.1 - Math.sin(s.time * 6 + 1.3) * 0.22 * up;
        // The head tips back as it roars.
        head.rotation.x = -0.12 * up - roar * 0.12 * up;
        head.rotation.z = Math.sin(s.time * 8) * 0.04;
        figure.rotation.z = Math.sin(s.time * 5) * 0.035 * up;
        figure.scale.set(1 + roar * 0.02 * up, 1 + roar * 0.03 * up, 1);
      },
    };
  },
};
