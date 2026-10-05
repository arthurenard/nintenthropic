/**
 * The shapes that dress the world, each a small vertex-coloured geometry with
 * its base on y = 0, built from a few faceted primitives. Colours at the foot
 * are darker than at the top: a baked ambient occlusion that makes flat
 * shapes sit on the ground instead of hovering.
 *
 * The scenery places them (scenery.ts) as instances: one draw call per kind.
 */
import type { BufferGeometry } from "three";
import { MeshBuilder, mixRgb, rgb, scaleRgb, shapes, xf, type Rgb } from "./builder";

const ramp = (bottom: Rgb, top: Rgb) => ({ bottom, top });

// ─── Meadow ────────────────────────────────────────────────────────────────

export function roundTree(): BufferGeometry {
  const b = new MeshBuilder();
  const bark = rgb("#8a5a34");
  b.post(0, 0, 0, 0.3, 2.4, ramp(scaleRgb(bark, 0.55), bark), 6, 0.75);
  const dark = rgb("#2f9a46");
  const light = rgb("#7fdc55");
  b.blob(0, 3.5, 0, 1.9, 1.7, 1.9, ramp(dark, light), 1);
  b.blob(1.0, 2.9, 0.3, 1.3, 1.15, 1.3, ramp(scaleRgb(dark, 0.9), mixRgb(dark, light, 0.8)), 0, 0.5);
  b.blob(-0.8, 4.2, -0.5, 1.2, 1.1, 1.2, ramp(mixRgb(dark, light, 0.3), light), 0, 1.1);
  return b.build();
}

export function pineTree(): BufferGeometry {
  const b = new MeshBuilder();
  const bark = rgb("#6d4528");
  b.post(0, 0, 0, 0.26, 1.6, ramp(scaleRgb(bark, 0.6), bark), 6);
  const dark = rgb("#1f7c45");
  const light = rgb("#47b95a");
  b.spire(0, 1.2, 0, 1.9, 2.6, ramp(dark, mixRgb(dark, light, 0.5)), 8);
  b.spire(0, 2.8, 0, 1.5, 2.3, ramp(mixRgb(dark, light, 0.2), mixRgb(dark, light, 0.75)), 8);
  b.spire(0, 4.2, 0, 1.05, 2.1, ramp(mixRgb(dark, light, 0.4), light), 8);
  return b.build();
}

export function bush(): BufferGeometry {
  const b = new MeshBuilder();
  const dark = rgb("#2f9246");
  const light = rgb("#6fcf50");
  b.blob(0, 0.55, 0, 0.95, 0.72, 0.95, ramp(dark, light), 0);
  b.blob(0.7, 0.4, 0.2, 0.62, 0.5, 0.62, ramp(dark, mixRgb(dark, light, 0.8)), 0, 0.7);
  return b.build();
}

export function rock(): BufferGeometry {
  const b = new MeshBuilder();
  const base = rgb("#8f9399");
  b.blob(0, 0.55, 0, 1.2, 0.8, 1.0, ramp(scaleRgb(base, 0.6), mixRgb(base, [1, 1, 1], 0.2)), 0, 0.3);
  b.blob(0.8, 0.28, 0.4, 0.62, 0.42, 0.55, ramp(scaleRgb(base, 0.6), base), 0, 1.3);
  return b.build();
}

/** A tuft of flowers: white, so each instance's colour picks its petals. */
export function flowers(): BufferGeometry {
  const b = new MeshBuilder();
  const stem = rgb("#3f9a3a");
  const petal: Rgb = [1, 1, 1];
  const spots: [number, number, number][] = [
    [0, 0, 0.55],
    [0.35, 0.28, 0.42],
    [-0.3, 0.22, 0.38],
    [0.1, -0.35, 0.34],
  ];
  for (const [x, z, h] of spots) {
    b.post(x, 0, z, 0.025, h, stem, 4);
    b.blob(x, h + 0.04, z, 0.17, 0.1, 0.17, ramp(mixRgb(petal, [0.4, 0.4, 0.4], 0.3), petal), 0);
  }
  b.blob(0, 0.05, 0, 0.36, 0.14, 0.36, stem, 0);
  return b.build();
}

export function hayBale(): BufferGeometry {
  const b = new MeshBuilder();
  const hay = rgb("#e6c35a");
  b.add(shapes.cylinder(10), xf(0, 0.8, 0, 0.85, 1.2, 0.85, 0, Math.PI / 2, 0), ramp(scaleRgb(hay, 0.7), hay));
  return b.build();
}

export function windmill(): { tower: BufferGeometry; blades: BufferGeometry } {
  const t = new MeshBuilder();
  const white = rgb("#f4efe6");
  const red = rgb("#d6453a");
  t.post(0, 0, 0, 3.1, 9.5, ramp(scaleRgb(white, 0.65), white), 10, 0.62);
  t.post(0, 0, 0, 3.25, 0.9, scaleRgb(red, 0.8), 10, 0.98);
  t.spire(0, 9.3, 0, 2.5, 2.8, ramp(scaleRgb(red, 0.8), red), 10);
  t.box(0, 4.2, 2.1, 1.2, 1.8, 0.4, rgb("#5aa7e8"));
  t.box(0, 1.1, 2.9, 1.5, 2.1, 0.5, rgb("#7a4d2c"));
  const bl = new MeshBuilder();
  const wood = rgb("#7a4d2c");
  const sail = rgb("#fbf8ef");
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2 + Math.PI / 4;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    // Spar and sail, in the plane facing +z.
    bl.add(shapes.box(), xf(dx * 4.2, dy * 4.2, 0, 0.3, 8.2, 0.3, 0, 0, a - Math.PI / 2), wood);
    bl.add(shapes.box(), xf(dx * 5.0 - dy * 0.95, dy * 5.0 + dx * 0.95, 0.05, 0.1, 6.0, 1.7, 0, 0, a - Math.PI / 2), sail);
  }
  bl.blob(0, 0, 0.2, 0.7, 0.7, 0.7, red, 0);
  return { tower: t.build(), blades: bl.build() };
}

export function barn(): BufferGeometry {
  const b = new MeshBuilder();
  const red = rgb("#c9473b");
  const roof = rgb("#5b4a49");
  const trim = rgb("#f6f0e6");
  b.box(0, 2.6, 0, 11, 5.2, 7.5, ramp(scaleRgb(red, 0.6), red));
  // Pitched roof: two slabs.
  b.box(-2.9, 6.1, 0, 6.6, 0.35, 8.4, roof, 0, 0, 0.62);
  b.box(2.9, 6.1, 0, 6.6, 0.35, 8.4, roof, 0, 0, -0.62);
  b.box(0, 3.0, 3.8, 3.3, 3.6, 0.2, trim);
  b.box(0, 3.0, 3.85, 3.0, 3.3, 0.2, scaleRgb(red, 0.7));
  return b.build();
}

export function cloud(seed: number): BufferGeometry {
  const b = new MeshBuilder();
  const lit: Rgb = [1, 1, 1];
  const shade = rgb("#cfe2f7");
  const bumps = 5 + (seed % 3);
  for (let i = 0; i < bumps; i++) {
    const a = (i / bumps) * 2 - 1;
    const r = 0.9 + 0.5 * Math.sin(i * 2.1 + seed);
    b.blob(a * 2.1, 0.25 + 0.35 * Math.cos(i * 1.7 + seed), Math.sin(i * 3.3 + seed) * 0.5, r * 1.15, r * 0.8, r * 0.95, ramp(shade, lit), 1);
  }
  return b.build();
}

// ─── Canyon ────────────────────────────────────────────────────────────────

const STRATA = ["#c4552f", "#d9784a", "#e69a5c", "#cf6a3d", "#edb273", "#b94a2b"].map(rgb);

/** A flat-topped mesa of weathered layers; radius 1, height 1, stretched at placement. */
export function mesa(seed: number): BufferGeometry {
  const b = new MeshBuilder();
  const layers = 5;
  let y = 0;
  let r = 1;
  for (let k = 0; k < layers; k++) {
    const h = (1 / layers) * (0.8 + 0.4 * Math.sin(seed * 3 + k * 2.2));
    const col = STRATA[(k + seed) % STRATA.length]!;
    const top = k === layers - 1;
    const rTop = k % 2 === 0 ? r * 0.93 : r * 1.0;
    b.add(shapes.frustum(rTop / r, 9), xf(0, y + h / 2, 0, r, h, r, k * 0.4 + seed), ramp(scaleRgb(col, 0.78), col));
    if (top) b.add(shapes.cylinder(9), xf(0, y + h + 0.004, 0, rTop * 0.99, 0.01, rTop * 0.99, k * 0.4 + seed), rgb("#e9c18a"));
    y += h;
    r = rTop;
  }
  return b.build();
}

export function boulder(): BufferGeometry {
  const b = new MeshBuilder();
  const rock = rgb("#c98355");
  b.blob(0, 0.6, 0, 1.3, 0.9, 1.1, ramp(scaleRgb(rock, 0.6), mixRgb(rock, [1, 0.9, 0.75], 0.2)), 0, 0.4);
  b.blob(1.0, 0.3, 0.5, 0.7, 0.5, 0.65, ramp(scaleRgb(rock, 0.6), rock), 0, 1.1);
  return b.build();
}

export function cactus(): BufferGeometry {
  const b = new MeshBuilder();
  const g = rgb("#4f9a52");
  const dark = scaleRgb(g, 0.6);
  b.post(0, 0, 0, 0.42, 4.6, ramp(dark, mixRgb(g, [1, 1, 0.7], 0.15)), 7, 0.85);
  b.blob(0, 4.6, 0, 0.36, 0.3, 0.36, g, 0);
  // Two arms.
  b.post(0.95, 2.0, 0, 0.26, 0.5, ramp(dark, g), 6);
  b.box(0.55, 2.2, 0, 0.9, 0.46, 0.46, g);
  b.post(0.95, 2.2, 0, 0.26, 1.7, ramp(dark, g), 6, 0.9);
  b.box(-0.55, 3.0, 0, 0.9, 0.42, 0.42, g);
  b.post(-0.95, 2.9, 0, 0.24, 1.3, ramp(dark, g), 6, 0.9);
  return b.build();
}

export function dryBush(): BufferGeometry {
  const b = new MeshBuilder();
  const o = rgb("#a39b4f");
  b.blob(0, 0.45, 0, 0.8, 0.55, 0.8, ramp(scaleRgb(o, 0.55), o), 0);
  b.blob(0.5, 0.3, 0.3, 0.5, 0.36, 0.5, ramp(scaleRgb(o, 0.55), mixRgb(o, [1, 0.9, 0.6], 0.2)), 0, 0.5);
  return b.build();
}

export function rockArch(): BufferGeometry {
  const b = new MeshBuilder();
  const col = rgb("#c9663a");
  const light = rgb("#e8935a");
  const leg = (x: number, lean: number) => {
    b.add(shapes.frustum(0.72, 7), xf(x, 11, 0, 4.2, 22, 4.6, 0.2, 0, lean), ramp(scaleRgb(col, 0.7), light));
  };
  leg(-9, 0.04);
  leg(9, -0.04);
  b.add(shapes.frustum(0.88, 8), xf(0, 23, 0, 4.4, 6, 4.4, 0, 0, Math.PI / 2), ramp(light, mixRgb(light, [1, 0.9, 0.7], 0.3)));
  b.box(0, 21.5, 0, 22, 5, 7.5, ramp(col, light), 0.05);
  return b.build();
}

// ─── Harbour ───────────────────────────────────────────────────────────────

/** A shipping container, white so the instance colour paints it; 6.1 x 2.6 x 2.4 m. */
export function container(): BufferGeometry {
  const b = new MeshBuilder();
  const w: Rgb = [0.92, 0.92, 0.92];
  b.box(0, 1.3, 0, 6.1, 2.6, 2.4, ramp(scaleRgb(w, 0.7), w));
  // Corrugation: darker ribs along the long sides.
  for (let k = -2; k <= 2; k++) {
    for (const side of [-1, 1]) b.box(k * 1.15, 1.3, side * 1.205, 0.12, 2.5, 0.05, scaleRgb(w, 0.78));
  }
  b.box(0, 2.62, 0, 6.15, 0.06, 2.45, scaleRgb(w, 0.6));
  return b.build();
}

export function warehouse(): BufferGeometry {
  const b = new MeshBuilder();
  const wall = rgb("#a9b4cc");
  const roof = rgb("#56627f");
  const win: Rgb = [3.2, 2.5, 1.2];
  b.box(0, 4.5, 0, 34, 9, 15, ramp(scaleRgb(wall, 0.6), wall));
  b.box(0, 9.6, 0, 34.6, 1.3, 15.6, roof);
  b.box(0, 10.7, 0, 30, 1.2, 8, scaleRgb(roof, 0.85));
  for (let i = -5; i <= 5; i++) {
    b.box(i * 2.9, 6.3, 7.55, 1.6, 1.2, 0.06, win);
    b.box(i * 2.9, 6.3, -7.55, 1.6, 1.2, 0.06, win);
  }
  b.box(-11, 2.2, 7.55, 5.2, 4.4, 0.14, rgb("#ffb347"));
  return b.build();
}

export function crane(): { structure: BufferGeometry; light: [number, number, number] } {
  const b = new MeshBuilder();
  const red = rgb("#e24a3b");
  const white = rgb("#f2f4f8");
  const steel = rgb("#3a4156");
  const H = 34;
  for (const [x, z] of [
    [-10, -6],
    [10, -6],
    [-10, 6],
    [10, 6],
  ] as const) {
    b.box(x, H / 2, z, 1.1, H, 1.1, ramp(scaleRgb(red, 0.6), red));
  }
  b.box(0, H * 0.35, 6, 21, 0.9, 0.9, white);
  b.box(0, H * 0.35, -6, 21, 0.9, 0.9, white);
  b.box(0, H * 0.7, 6, 21, 0.9, 0.9, white);
  b.box(0, H * 0.7, -6, 21, 0.9, 0.9, white);
  b.box(0, H + 1.2, 0, 24, 2.6, 15, ramp(white, scaleRgb(white, 0.85)));
  // The boom reaches out over the water, the back arm over the quay.
  b.box(0, H + 1.6, 36, 3.2, 2.2, 62, ramp(red, red));
  b.box(0, H + 2.4, -22, 2.6, 2.0, 24, red);
  b.box(0, H - 4, 40, 0.3, 11, 0.3, steel);
  b.box(0, H - 10, 40, 3.5, 2, 2.2, steel);
  b.box(0, H + 4, 0, 6, 5, 5, steel);
  return { structure: b.build(), light: [0, H + 5.6, 0] };
}

export function ship(): BufferGeometry {
  const b = new MeshBuilder();
  const hull = rgb("#23305a");
  const red = rgb("#c8493e");
  const white = rgb("#eceff6");
  b.box(0, 3, 0, 22, 8, 105, ramp(scaleRgb(hull, 0.6), hull));
  b.box(0, 1.4, 0, 22.3, 2.6, 105.4, ramp(scaleRgb(red, 0.55), red));
  b.add(shapes.cone(4), xf(0, 3, 62, 11, 18, 8, Math.PI / 4, Math.PI / 2, 0), ramp(scaleRgb(hull, 0.6), hull));
  b.box(0, 12, -34, 16, 14, 18, ramp(scaleRgb(white, 0.7), white));
  b.box(0, 21, -34, 14, 4, 10, white);
  for (let k = -3; k <= 3; k++) {
    b.box(k * 2, 13, -43.1, 1.2, 1.1, 0.1, [3.2, 2.6, 1.3]);
    b.box(k * 2, 21, -39.1, 1.2, 1.0, 0.1, [3.2, 2.6, 1.3]);
  }
  // Stacked containers on the deck.
  const cols = ["#d9473b", "#2f6bff", "#2fb3a1", "#f2a33a", "#d9473b", "#ffffff"].map(rgb);
  for (let z = -10; z <= 40; z += 7) {
    for (let x = -1; x <= 1; x += 1) {
      for (let h = 0; h < 2 + ((z + x + 10) % 2); h++) {
        b.box(x * 2.6 * 1.2, 8.8 + h * 2.7, z, 2.4, 2.6, 6.1, cols[(z * 3 + x * 7 + h * 5 + 60) % cols.length]!);
      }
    }
  }
  return b.build();
}

export function warehouseLamp(): BufferGeometry {
  const b = new MeshBuilder();
  const steel = rgb("#2f3548");
  b.post(0, 0, 0, 0.16, 5.5, steel, 6);
  b.box(0, 5.6, 0, 0.9, 0.2, 0.5, [4, 3, 1.6]);
  return b.build();
}

export function barrels(): BufferGeometry {
  const b = new MeshBuilder();
  const cols = [rgb("#d9473b"), rgb("#2f6bff"), rgb("#ffb703")];
  [
    [0, 0, 0],
    [0.9, 0.2, 1],
    [-0.5, 0.9, 2],
    [0.4, -0.9, 0],
  ].forEach(([x, z, c]) => {
    const col = cols[c!]!;
    b.post(x!, 0, z!, 0.4, 1.0, ramp(scaleRgb(col, 0.6), col), 8);
  });
  return b.build();
}
