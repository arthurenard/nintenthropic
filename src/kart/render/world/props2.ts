/**
 * The small shapes that dress the six newer worlds, scattered as instances
 * (sceneryWorlds.ts): crumbs and fruit on the kitchen counter, snowy pines,
 * basalt and charred trees, fairground trees with fairy lights, floating
 * asteroids, palms. Same house style as props.ts: faceted, vertex coloured,
 * a darker foot so each sits on the ground, base on y = 0.
 */
import type { BufferGeometry } from "three";
import { MeshBuilder, mixRgb, rgb, scaleRgb, shapes, xf, type Rgb } from "./builder";
import { rockBlob } from "./landmarks/kit";

const ramp = (bottom: Rgb, top: Rgb) => ({ bottom, top });

// ─── Kitchen ─────────────────────────────────────────────────────────────────

export function crumb(): BufferGeometry {
  const b = new MeshBuilder();
  const c = rgb("#e6cc98");
  rockBlob(b, 0, 0.45, 0, 1.0, 0.55, 0.8, (p) => mixRgb(scaleRgb(c, 0.7), c, Math.min(1, Math.max(0, p[1] / 0.9))), 3, { detail: 0, roughness: 0.3, flatBase: true });
  rockBlob(b, 0.9, 0.25, 0.3, 0.55, 0.32, 0.5, scaleRgb(c, 0.92), 8, { detail: 0, roughness: 0.3, flatBase: true });
  return b.build();
}

export function pea(): BufferGeometry {
  const b = new MeshBuilder();
  const g = rgb("#6ccf3a");
  b.blob(0, 0.9, 0, 0.95, 0.9, 0.95, ramp(scaleRgb(g, 0.6), mixRgb(g, [1, 1, 0.7], 0.15)), 1);
  b.blob(0.3, 1.35, 0.3, 0.22, 0.14, 0.22, [1.2, 1.5, 1.0], 0);
  return b.build();
}

export function rice(): BufferGeometry {
  const b = new MeshBuilder();
  const w = rgb("#fbf6e9");
  b.blob(0, 0.32, 0, 0.32, 0.3, 0.95, ramp(scaleRgb(w, 0.78), w), 0);
  return b.build();
}

export function bean(): BufferGeometry {
  const b = new MeshBuilder();
  const c = rgb("#5a3a22");
  b.blob(0, 0.45, 0, 0.7, 0.5, 1.0, ramp(scaleRgb(c, 0.6), mixRgb(c, [1, 0.8, 0.6], 0.15)), 1);
  b.box(0, 0.95, 0, 0.1, 0.07, 1.5, scaleRgb(c, 0.4));
  return b.build();
}

export function sugarGrain(): BufferGeometry {
  const b = new MeshBuilder();
  const w = rgb("#fffdf6");
  b.box(0, 0.45, 0, 0.9, 0.9, 0.9, ramp(scaleRgb(w, 0.78), w), 0.5);
  return b.build();
}

export function tomato(): BufferGeometry {
  const b = new MeshBuilder();
  const r = rgb("#e83a2c");
  b.blob(0, 2.7, 0, 3.6, 2.9, 3.6, ramp(scaleRgb(r, 0.55), mixRgb(r, [1, 0.7, 0.5], 0.2)), 2);
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    b.blob(Math.cos(a) * 1.1, 5.45, Math.sin(a) * 1.1, 1.3, 0.2, 0.5, rgb("#3f9a34"), 0, -a);
  }
  b.blob(0, 5.7, 0, 0.3, 0.55, 0.3, rgb("#3a7a2a"), 0);
  b.blob(-1.4, 4.2, 1.8, 0.7, 0.45, 0.5, [1.5, 1.2, 1.1], 0);
  return b.build();
}

export function egg(): BufferGeometry {
  const b = new MeshBuilder();
  const w = rgb("#f5e6cf");
  b.blob(0, 2.3, 0, 2.1, 2.9, 2.1, ramp(scaleRgb(w, 0.7), w), 2);
  b.blob(-0.7, 3.4, 1.3, 0.5, 0.8, 0.3, [1.4, 1.35, 1.25], 0);
  return b.build();
}

export function cookie(): BufferGeometry {
  const b = new MeshBuilder();
  const d = rgb("#c98a43");
  b.add(shapes.cylinder(12), xf(0, 0.55, 0, 3.2, 1.1, 3.2), ramp(scaleRgb(d, 0.55), d));
  b.add(shapes.cylinder(12), xf(0, 1.05, 0, 3.0, 0.2, 3.0), mixRgb(d, [1, 0.85, 0.5], 0.25));
  const chip = rgb("#3a2216");
  for (let k = 0; k < 9; k++) {
    const a = k * 2.4;
    const r = 0.5 + (k % 3) * 0.8;
    b.blob(Math.cos(a) * r, 1.2, Math.sin(a) * r, 0.42, 0.22, 0.42, chip, 0);
  }
  return b.build();
}

// ─── Snow ────────────────────────────────────────────────────────────────────

export function snowPine(): BufferGeometry {
  const b = new MeshBuilder();
  const bark = rgb("#5a3d28");
  const dark = rgb("#16573b");
  const mid = rgb("#2b7a4b");
  const snow = rgb("#f6faff");
  const shade = rgb("#b3c8e6");
  b.post(0, 0, 0, 0.3, 2.0, ramp(scaleRgb(bark, 0.6), bark), 6);
  // Tiers of boughs, each with a cap of snow riding on it.
  const tiers = [
    [0.9, 2.5, 2.6],
    [2.4, 2.2, 2.3],
    [3.9, 1.8, 2.0],
    [5.2, 1.4, 1.8],
    [6.3, 0.95, 1.6],
  ] as const;
  tiers.forEach(([y, r, h], k) => {
    b.spire(0, y, 0, r, h, ramp(scaleRgb(dark, 0.9), mixRgb(dark, mid, 0.5)), 8);
    b.spire(0, y + h * 0.36, 0, r * 0.82, h * 0.7, ramp(shade, snow), 8);
    if (k % 2 === 0) b.blob(r * 0.6, y + h * 0.3, 0.2, 0.5, 0.3, 0.5, snow, 0);
  });
  return b.build();
}

export function snowRock(): BufferGeometry {
  const b = new MeshBuilder();
  const rock = rgb("#59627a");
  rockBlob(b, 0, 0.7, 0, 1.5, 1.1, 1.3, (p) => mixRgb(scaleRgb(rock, 0.7), rock, Math.min(1, p[1] / 1.6)), 4, { detail: 1, roughness: 0.2, flatBase: true });
  // The snow lying on top of it.
  b.blob(0.1, 1.55, 0, 1.2, 0.5, 1.05, ramp(rgb("#c7d6ee"), rgb("#f8fbff")), 1);
  return b.build();
}

export function snowDrift(): BufferGeometry {
  const b = new MeshBuilder();
  const w = rgb("#f8fbff");
  const s = rgb("#bccdea");
  b.blob(0, 0.1, 0, 2.6, 0.9, 1.5, ramp(s, w), 1);
  b.blob(1.7, 0, 0.4, 1.4, 0.55, 0.9, ramp(s, w), 0);
  return b.build();
}

export function iceCrystals(): BufferGeometry {
  const b = new MeshBuilder();
  const tip: Rgb = [0.7, 1.7, 2.4];
  const foot: Rgb = [0.25, 0.7, 1.2];
  for (let k = 0; k < 6; k++) {
    const a = k * 1.1;
    const h = 1.6 + (k % 3) * 0.9;
    b.add(shapes.cone(5), xf(Math.cos(a) * 0.6, h / 2, Math.sin(a) * 0.6, 0.28, h, 0.28, a, 0.12 * Math.cos(a), 0.12 * Math.sin(a)), ramp(foot, tip));
  }
  return b.build();
}

/** A small lit cabin far off in the snow: a warm window is the whole point. */
export function farCabin(): BufferGeometry {
  const b = new MeshBuilder();
  const log = rgb("#6b4a32");
  b.box(0, 1.8, 0, 6.5, 3.6, 5, ramp(scaleRgb(log, 0.6), log));
  b.box(-1.7, 4.2, 0, 4.2, 0.4, 6.2, rgb("#f6faff"), 0, 0, 0.55);
  b.box(1.7, 4.2, 0, 4.2, 0.4, 6.2, rgb("#f6faff"), 0, 0, -0.55);
  b.box(0, 2.0, 2.55, 1.3, 1.1, 0.1, [4.0, 2.7, 1.1]);
  b.box(-2.2, 2.0, 2.55, 0.9, 1.0, 0.1, [4.0, 2.7, 1.1]);
  b.box(2.0, 5.4, -1.0, 0.8, 1.6, 0.8, rgb("#5a5360"));
  return b.build();
}

// ─── Volcano ─────────────────────────────────────────────────────────────────

export function basaltBoulder(): BufferGeometry {
  const b = new MeshBuilder();
  const c = rgb("#1d1a22");
  rockBlob(b, 0, 0.8, 0, 1.6, 1.1, 1.4, (p) => mixRgb(scaleRgb(c, 0.6), mixRgb(c, rgb("#4a4452"), 0.7), Math.min(1, p[1] / 1.7)), 7, { detail: 1, roughness: 0.3, flatBase: true });
  rockBlob(b, 1.2, 0.4, 0.5, 0.8, 0.55, 0.7, scaleRgb(c, 1.1), 2, { detail: 0, roughness: 0.3, flatBase: true });
  return b.build();
}

export function basaltSpike(): BufferGeometry {
  const b = new MeshBuilder();
  const c = rgb("#201d27");
  const top = rgb("#4c4655");
  b.add(shapes.frustum(0.7, 6), xf(0, 3, 0, 1.4, 6, 1.4, 0.3), ramp(scaleRgb(c, 0.7), top));
  b.add(shapes.frustum(0.5, 6), xf(1.5, 2, 0.6, 0.9, 4, 0.9, 1.0), ramp(scaleRgb(c, 0.7), mixRgb(top, c, 0.4)));
  b.add(shapes.cone(6), xf(-0.9, 4, -0.7, 0.7, 8, 0.7, 0.6), ramp(c, top));
  return b.build();
}

export function charredTree(): BufferGeometry {
  const b = new MeshBuilder();
  const c = rgb("#17141a");
  b.post(0, 0, 0, 0.35, 5.5, ramp(scaleRgb(c, 0.7), rgb("#2c2530")), 6, 0.45);
  b.rod([0, 3.0, 0], [1.6, 5.0, 0.4], 0.16, c);
  b.rod([0, 4.0, 0], [-1.4, 6.2, -0.3], 0.14, c);
  b.rod([0, 5.0, 0], [0.4, 7.6, 0.6], 0.1, c);
  b.rod([1.6, 5.0, 0.4], [2.4, 6.4, 0.2], 0.08, c);
  // An ember or two still glowing in the char.
  b.blob(0.1, 2.0, 0.3, 0.12, 0.3, 0.1, [3.2, 0.9, 0.12], 0);
  return b.build();
}

export function emberRock(): BufferGeometry {
  const b = new MeshBuilder();
  const c = rgb("#1b181f");
  rockBlob(b, 0, 0.7, 0, 1.3, 0.9, 1.2, (p) => mixRgb(scaleRgb(c, 0.7), rgb("#3c3744"), Math.min(1, Math.max(0, p[1] / 1.5))), 5, { detail: 1, roughness: 0.25, flatBase: true });
  // Seams of glowing rock between the plates.
  b.box(0, 0.8, 1.05, 1.9, 0.14, 0.18, [3.4, 1.05, 0.2], 0, 0, 0.3);
  b.box(0.6, 0.55, 0.9, 0.12, 0.9, 0.16, [3.0, 0.9, 0.18], 0.3);
  return b.build();
}

export function ashMound(): BufferGeometry {
  const b = new MeshBuilder();
  b.blob(0, 0, 0, 3.4, 1.1, 2.6, ramp(rgb("#3a343c"), rgb("#6b6068")), 1);
  return b.build();
}

// ─── Funfair ─────────────────────────────────────────────────────────────────

export function fairTree(): BufferGeometry {
  const b = new MeshBuilder();
  const bark = rgb("#4a3a4a");
  const leaf = rgb("#2d6a5a");
  b.post(0, 0, 0, 0.35, 2.8, ramp(scaleRgb(bark, 0.7), bark), 6, 0.7);
  b.blob(0, 4.6, 0, 2.6, 2.3, 2.6, ramp(scaleRgb(leaf, 0.55), mixRgb(leaf, rgb("#6bb58a"), 0.4)), 1);
  b.blob(1.3, 3.8, 0.5, 1.6, 1.4, 1.6, ramp(scaleRgb(leaf, 0.5), leaf), 0);
  // Fairy lights wound through the crown.
  const bulbs: Rgb[] = [[4, 3, 1.2], [4, 0.8, 1.9], [1, 3, 4], [1.4, 4, 1.6]];
  for (let k = 0; k < 14; k++) {
    const a = k * 2.1;
    const h = 3.4 + Math.sin(k * 1.7) * 1.4;
    const r = 2.1 + Math.cos(k) * 0.4;
    b.blob(Math.cos(a) * r, h, Math.sin(a) * r, 0.17, 0.17, 0.17, bulbs[k % 4]!, 0);
  }
  return b.build();
}

export function fairStall(): BufferGeometry {
  const b = new MeshBuilder();
  const red = rgb("#ee3a52");
  const cream = rgb("#fff3dc");
  b.box(0, 1.5, 0, 6, 3, 3.6, ramp(rgb("#3b2a52"), rgb("#6a4a8a")));
  b.box(0, 1.9, 1.9, 5.2, 1.4, 0.15, [3.8, 2.6, 1.0]);
  // A striped awning over the counter.
  for (let k = 0; k < 8; k++) b.box(-3.2 + k * 0.92 + 0.46, 3.55, 1.6, 0.92, 0.18, 3.4, k % 2 ? cream : red, 0, 0.35);
  b.box(0, 1.1, 1.95, 6, 0.2, 0.9, cream);
  b.post(-2.9, 0, 2.7, 0.08, 3.4, rgb("#d6dbe4"), 6);
  b.post(2.9, 0, 2.7, 0.08, 3.4, rgb("#d6dbe4"), 6);
  return b.build();
}

export function crateStack(): BufferGeometry {
  const b = new MeshBuilder();
  const wood = rgb("#8a5d36");
  b.box(0, 0.6, 0, 1.2, 1.2, 1.2, ramp(scaleRgb(wood, 0.6), wood), 0.1);
  b.box(1.3, 0.6, 0.3, 1.2, 1.2, 1.2, ramp(scaleRgb(wood, 0.6), wood), -0.2);
  b.box(0.5, 1.8, 0.1, 1.1, 1.1, 1.1, ramp(scaleRgb(wood, 0.7), wood), 0.5);
  b.post(-1.3, 0, 0.4, 0.45, 0.9, rgb("#c0392b"), 8);
  return b.build();
}

// ─── Space ───────────────────────────────────────────────────────────────────

export function floatingRock(seed: number): BufferGeometry {
  const b = new MeshBuilder();
  const c = rgb(["#6e6a86", "#7d6a78", "#5d6a86"][seed % 3]!);
  rockBlob(b, 0, 0, 0, 1.2, 0.9, 1.1, (p) => mixRgb(scaleRgb(c, 0.55), mixRgb(c, rgb("#d6d2ee"), 0.4), Math.min(1, Math.max(0, (p[1] + 1) / 2))), seed + 1, { detail: 1, roughness: 0.32 });
  // A crystal or two growing from it, lit from within.
  const glow: Rgb = seed % 2 ? [0.5, 2.6, 3.4] : [3.2, 0.7, 2.4];
  b.add(shapes.cone(5), xf(0.5, 0.95, 0.1, 0.22, 0.9, 0.22, 0, 0.3, 0.2), glow);
  b.add(shapes.cone(5), xf(-0.4, 0.8, 0.4, 0.16, 0.6, 0.16, 0, -0.4, 0.1), glow);
  return b.build();
}

// ─── Palm ────────────────────────────────────────────────────────────────────

export function palmTree(seed: number): BufferGeometry {
  const b = new MeshBuilder();
  const bark = rgb("#b58e62");
  const dark = rgb("#7d5c3c");
  const lean = 0.2 + (seed % 3) * 0.09;
  // A curving, tapering trunk of short segments, ringed where they meet.
  let x = 0;
  let y = 0;
  const segs = 6;
  for (let k = 0; k < segs; k++) {
    const r0 = 0.42 - k * 0.04;
    const nx = x + Math.sin(lean + k * 0.035) * 0.8;
    const ny = y + 1.5;
    b.rod([x, y - 0.1, 0], [nx, ny, 0], r0 * 1.7, ramp(k === 0 ? scaleRgb(dark, 0.7) : dark, bark));
    b.post(nx, ny - 0.08, 0, r0 * 1.15, 0.14, dark, 6);
    x = nx;
    y = ny;
  }
  const g1 = rgb("#2a8f3c");
  const g2 = rgb("#7fcc4a");
  // Fronds: a broad, folded blade arching out of the crown and drooping, dark underneath and bright on top.
  const count = 9;
  for (let f = 0; f < count; f++) {
    const a = (f / count) * Math.PI * 2 + seed * 0.7;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    const px = -dz;
    const pz = dx;
    const reach = 4.6 - (f % 3) * 0.5;
    const pts: [number, number, number][] = [];
    for (let k = 0; k <= 4; k++) {
      const t = k / 4;
      pts.push([x + dx * reach * t, y + 0.25 + 2.0 * Math.sin(t * 1.9) - 2.1 * t * t, dz * reach * t]);
    }
    for (let k = 0; k < 4; k++) {
      const t0 = k / 4;
      const t1 = (k + 1) / 4;
      const w0 = 1.15 * Math.sin(Math.PI * Math.min(1, t0 * 0.95 + 0.12)) + 0.08;
      const w1 = 1.15 * Math.sin(Math.PI * Math.min(1, t1 * 0.95 + 0.12)) + 0.02;
      const p0 = pts[k]!;
      const p1 = pts[k + 1]!;
      // The blade droops to each side of the midrib.
      const fold0 = 0.35 * w0;
      const fold1 = 0.35 * w1;
      const c0 = mixRgb(g1, g2, t0);
      const c1 = mixRgb(g1, g2, t1);
      for (const s of [-1, 1]) {
        b.quad(
          [p0[0], p0[1], p0[2]],
          [p0[0] + px * s * w0, p0[1] - fold0, p0[2] + pz * s * w0],
          [p1[0] + px * s * w1, p1[1] - fold1, p1[2] + pz * s * w1],
          [p1[0], p1[1], p1[2]],
          scaleRgb(c0, 1.05),
          scaleRgb(c0, 0.62),
          scaleRgb(c1, 0.62),
          scaleRgb(c1, 1.05),
        );
      }
    }
  }
  b.blob(x, y - 0.1, 0.4, 0.3, 0.3, 0.3, rgb("#5a3f27"), 0);
  b.blob(x + 0.3, y - 0.3, -0.3, 0.3, 0.3, 0.3, rgb("#6a4a2c"), 0);
  b.blob(x - 0.3, y - 0.25, 0.2, 0.28, 0.28, 0.28, rgb("#6a4a2c"), 0);
  return b.build();
}

export function tropicalBush(): BufferGeometry {
  const b = new MeshBuilder();
  const g = rgb("#2f9a3f");
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2;
    b.add(shapes.cone(4), xf(Math.cos(a) * 0.5, 0.8, Math.sin(a) * 0.5, 0.35, 1.8, 0.8, a, 0.9, 0), ramp(scaleRgb(g, 0.6), mixRgb(g, rgb("#9be06a"), 0.4)));
  }
  b.blob(0, 0.3, 0, 0.5, 0.35, 0.5, rgb("#d6455d"), 0);
  return b.build();
}

export function coralRock(): BufferGeometry {
  const b = new MeshBuilder();
  const c = rgb("#d9c7b0");
  rockBlob(b, 0, 0.7, 0, 1.4, 1.0, 1.2, (p) => mixRgb(scaleRgb(c, 0.65), c, Math.min(1, p[1] / 1.7)), 9, { detail: 1, roughness: 0.25, flatBase: true });
  return b.build();
}

export function parasol(): BufferGeometry {
  const b = new MeshBuilder();
  b.post(0, 0, 0, 0.07, 3.0, rgb("#e8ebf2"), 6);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    b.add(shapes.cone(3), xf(Math.cos(a) * 0.9, 2.75, Math.sin(a) * 0.9, 0.9, 0.7, 0.9, -a + Math.PI / 2, 0, 0), k % 2 ? rgb("#ff5d6c") : rgb("#fffaf0"));
  }
  b.box(1.6, 0.18, 0.4, 0.8, 0.12, 1.9, rgb("#17c3c0"), 0.6);
  return b.build();
}

export function sailboat(): BufferGeometry {
  const b = new MeshBuilder();
  b.box(0, 0.4, 0, 1.8, 0.8, 5.5, ramp(rgb("#c43a3a"), rgb("#f4f4f4")));
  b.post(0, 0.8, 0.3, 0.07, 6.2, rgb("#e8ebf2"), 5);
  b.tri([0, 1.2, 0.4], [0, 6.6, 0.4], [0, 1.2, -2.6], rgb("#ffffff"));
  b.tri([0, 1.2, 0.4], [0, 1.2, -2.6], [0, 6.6, 0.4], rgb("#ffffff"));
  b.tri([0, 1.5, 0.7], [0, 5.6, 0.7], [0, 1.5, 2.8], rgb("#ffd34d"));
  b.tri([0, 1.5, 0.7], [0, 1.5, 2.8], [0, 5.6, 0.7], rgb("#ffd34d"));
  return b.build();
}

/** A fairground lamp post with a globe on top (the halo is added where it stands). */
export function fairLamp(): BufferGeometry {
  const b = new MeshBuilder();
  const steel = rgb("#8b94aa");
  b.post(0, 0, 0, 0.14, 4.4, ramp(scaleRgb(steel, 0.6), steel), 6, 0.7);
  b.post(0, 3.9, 0, 0.3, 0.22, rgb("#e9edf7"), 8);
  b.blob(0, 4.7, 0, 0.42, 0.42, 0.42, [4, 3.2, 1.8], 1);
  return b.build();
}
