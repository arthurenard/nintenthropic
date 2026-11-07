/**
 * The barriers that stand beside the road, a theme's own: tyre walls in the
 * meadow, fences in the canyon, a painted kerb wall with lamp bollards at the
 * harbour, sugar cubes in the kitchen, snowbanks with slalom poles, basalt
 * boulders with glowing seams, candy-striped rails strung with bulbs at the
 * fair, a holographic rail in space, bamboo on the island.
 *
 * Each stands where the sim's wall is: `wall(i, side)` metres beyond the
 * road's edge (6 by default, farther where the track has a verge) and not at
 * all where that edge is open (a drop).
 */
import type { TrackGeometry } from "../../track/geometry";
import { MeshBuilder, mixRgb, rgb, scaleRgb, shapes, xf, type Rgb, type V3 } from "./builder";
import { hash1, type TrackBuild } from "./trackContext";

const UP: V3 = [0, 1, 0];
const SIDES = [-1, 1] as const;

/**
 * A barrier made of big round lumps (a snowbank, basalt boulders) is drawn that many metres farther out than a thin one: a lump
 * is as wide as two metres, and standing on the wall's line it would reach that far inside it, over ground a kart can drive on.
 * Pushed out, its inner face meets the wall (a kart's body touches the wall at the limit of its centre) and does not pass it.
 */
export const SOFT_PUSH = { snowbank: 0.8, basalt: 0.55 } as const;

/**
 * Does the sim let a kart's centre stand here? A kart is placed by the nearest stretch of road and kept inside that stretch's wall
 * (less its inset), so a piece of barrier that the nearest road sees more than a metre inside its own wall stands on a kart's ground
 * (the inside of a tight U-turn, where the barrier line folds over the other leg, or the first metres of a wide verge).
 */
function onKartGround(b: TrackBuild, x: number, z: number): boolean {
  const track = b.track;
  const p = track.open ? track.projectOpen(x, z) : track.projectLoop(x, z);
  const side = p.offset > 0 ? 1 : -1;
  const k = Math.round((track.open ? p.s - track.origin : p.s) / b.spacing);
  if (Math.abs(p.offset) - p.sample.width / 2 < b.wall(k, side) - 1) return true;
  // Nor on another road of the track: a branch's barrier does not stand on the road it leaves, nor the road's on the branch.
  const others = track.open ? [(track as unknown as { main: TrackGeometry }).main] : track.routes;
  for (const other of others) {
    const q = other.open ? other.projectOpen(x, z) : other.projectLoop(x, z);
    if (Math.abs(q.offset) < q.sample.width / 2 + 1.2) return true;
  }
  return false;
}

/** Walks one side's wall line at an even spacing, calling `emit` at each stop; breaks wherever the edge is open. */
function walk(
  b: TrackBuild,
  side: -1 | 1,
  inset: number,
  step: number,
  emit: (x: number, y: number, z: number, dx: number, dz: number, i: number, count: number) => void,
): void {
  let acc = 0;
  let count = 0;
  let prev: V3 | null = null;
  for (let i = 0; i <= b.n; i++) {
    if (b.open(i, side) > 0.5 || b.gap(i) || b.hidden(i, side)) {
      prev = null;
      acc = 0;
      continue;
    }
    const a = b.S(i);
    const o = side * (a.width / 2 + b.wall(i, side) + inset);
    const p: V3 = [a.x - a.tz * o, a.y + b.bank.liftAt(i, side * (a.width / 2)), a.z + a.tx * o];
    if (prev) {
      const dx = p[0] - prev[0];
      const dz = p[2] - prev[2];
      const len = Math.hypot(dx, dz);
      if (len > 0) {
        let t = step - acc;
        while (t <= len) {
          const f = t / len;
          const x = prev[0] + dx * f;
          const z = prev[2] + dz * f;
          // Not where the sim's nearest road has its kart's ground (the inside of a tight U-turn, a verge's first metres).
          // (A lump is a few metres across: its ends count too.)
          const tx = (dx / len) * 2.2;
          const tz = (dz / len) * 2.2;
          if (onKartGround(b, x, z) || onKartGround(b, x + tx, z + tz) || onKartGround(b, x - tx, z - tz)) count++;
          else emit(x, prev[1] + (p[1] - prev[1]) * f, z, dx / len, dz / len, i - 1, count++);
          t += step;
        }
        acc = len - (t - step);
      }
    }
    prev = p;
  }
}

export function buildBarriers(b: TrackBuild): void {
  switch (b.style.barrier) {
    case "tyres":
      tyres(b);
      break;
    case "fence":
      fence(b);
      break;
    case "bollards":
      bollards(b);
      break;
    case "sugar":
      sugar(b);
      break;
    case "snowbank":
      snowbank(b);
      break;
    case "basalt":
      basalt(b);
      break;
    case "railing":
      railing(b);
      break;
    case "hologram":
      hologram(b);
      break;
    case "bamboo":
      bamboo(b);
      break;
  }
}

// ─── The meadow, the canyon and the harbour ──────────────────────────────────

function tyres(b: TrackBuild): void {
  const steps = b.quality.detailedTyres ? 8 : 6;
  const tyre = (bld: MeshBuilder, cx: number, y: number, cz: number, R: number, H: number, side: Rgb, top: Rgb, rot: number) => {
    const r = R * 0.52;
    const dark = scaleRgb(side, 0.62);
    const inside: Rgb = [0.01, 0.01, 0.012];
    for (let k = 0; k < steps; k++) {
      const a0 = rot + (k / steps) * Math.PI * 2;
      const a1 = rot + ((k + 1) / steps) * Math.PI * 2;
      const o0: V3 = [cx + Math.cos(a0) * R, y, cz + Math.sin(a0) * R];
      const o1: V3 = [cx + Math.cos(a1) * R, y, cz + Math.sin(a1) * R];
      const t0: V3 = [o0[0], y + H, o0[2]];
      const t1: V3 = [o1[0], y + H, o1[2]];
      // Outer wall: lighter at the top, a baked shadow at the foot.
      bld.quad(o1, o0, t0, t1, dark, dark, side, side);
      if (b.quality.detailedTyres) {
        const i0: V3 = [cx + Math.cos(a0) * r, y + H, cz + Math.sin(a0) * r];
        const i1: V3 = [cx + Math.cos(a1) * r, y + H, cz + Math.sin(a1) * r];
        bld.quad(t1, t0, i0, i1, top, top, top, top, UP);
        bld.tri([cx, y + H * 0.35, cz], i1, i0, inside, inside, inside, UP);
      } else {
        bld.tri([cx, y + H, cz], t1, t0, top, top, top, UP);
      }
    }
  };
  const reds = [rgb("#e8352d"), rgb("#f6f6f2")];
  const rubber = rgb("#1d1f24");
  for (const side of SIDES) {
    walk(b, side, 0.55, 1.12, (x, y, z, dx, dz, i, k) => {
      const band = Math.floor(k / 3) % 2;
      const paint = reds[band]!;
      const bld = b.deco[b.chunkOf(i)]!;
      const swing = (k * 2.399) % 6.28;
      tyre(bld, x, y - 0.04, z, 0.56, 0.36, paint, rubber, swing);
      // The second row sits half a tyre along and a little in, like a real stack.
      tyre(bld, x + dx * 0.5 + dz * 0.08 * side, y + 0.34, z + dz * 0.5 - dx * 0.08 * side, 0.54, 0.36, reds[(band + 1) % 2]!, rubber, swing + 0.4);
    });
  }
}

function fence(b: TrackBuild): void {
  const wood = rgb("#b88655");
  const woodLight = rgb("#d3a572");
  const woodDark = scaleRgb(wood, 0.62);
  for (const side of SIDES) {
    let lastX = NaN;
    let lastZ = NaN;
    let lastY = 0;
    walk(b, side, 0.5, 2.6, (x, y, z, _dx, _dz, i, k) => {
      const bld = b.deco[b.chunkOf(i)]!;
      bld.post(x, y - 0.1, z, 0.13, 1.4, { bottom: woodDark, top: wood }, 6);
      bld.box(x, y + 1.32, z, 0.34, 0.1, 0.34, woodLight);
      // A broken run (an open edge, then a fence again) must not join across the gap.
      if (!Number.isNaN(lastX) && k > 0 && Math.hypot(x - lastX, z - lastZ) < 4) {
        const mx = (x + lastX) / 2;
        const mz = (z + lastZ) / 2;
        const my = (y + lastY) / 2;
        const dx = x - lastX;
        const dz = z - lastZ;
        const len = Math.hypot(dx, dz);
        const yaw = Math.atan2(-dz, dx);
        const slope = Math.atan2(y - lastY, len);
        for (const [h, c] of [
          [0.55, wood],
          [1.0, woodLight],
        ] as const) {
          bld.box(mx, my + h, mz, len, 0.13, 0.1, c, yaw, 0, slope);
        }
      }
      lastX = x;
      lastZ = z;
      lastY = y;
    });
  }
}

function bollards(b: TrackBuild): void {
  // A low concrete kerb wall with painted blocks, and bollards with lamps on top.
  const concrete = rgb("#a9b2c6");
  const concreteDark = scaleRgb(concrete, 0.6);
  const paintA = rgb("#2f6bff");
  const paintB = rgb("#f2f4fa");
  const yellow = rgb("#ffcf2e");
  const black = rgb("#1a1d27");
  for (const side of SIDES) {
    for (let i = 0; i < b.n; i++) {
      if (b.open(i, side) > 0.5 || b.gap(i) || b.hidden(i, side)) continue;
      const a = b.S(i);
      const c = b.S(i + 1);
      const o0 = side * (a.width / 2 + b.wall(i, side));
      const o1 = side * (c.width / 2 + b.wall(i + 1, side));
      const t = 0.9;
      const stripe = Math.floor(i / 4) % 2 === 0 ? paintA : paintB;
      const bd = b.deco[b.chunkOf(i)]!;
      const inner0 = b.P(i, o0, -0.04);
      const inner1 = b.P(i + 1, o1, -0.04);
      const outer0 = b.P(i, o0 + side * t, -0.04);
      const outer1 = b.P(i + 1, o1 + side * t, -0.04);
      const up = (p: V3, h: number): V3 => [p[0], p[1] + h, p[2]];
      // Face toward the road, then the top, with a painted band.
      if (side < 0) {
        bd.quad(inner0, inner1, up(inner1, 0.62), up(inner0, 0.62), concreteDark, concreteDark, concrete, concrete);
        bd.quad(up(inner0, 0.62), up(inner1, 0.62), up(outer1, 0.62), up(outer0, 0.62), concrete, concrete, concrete, concrete, UP);
        bd.quad(up(inner0, 0.34), up(inner1, 0.34), up(inner1, 0.5), up(inner0, 0.5), stripe, stripe, stripe, stripe);
      } else {
        bd.quad(inner1, inner0, up(inner0, 0.62), up(inner1, 0.62), concreteDark, concreteDark, concrete, concrete);
        bd.quad(up(inner1, 0.62), up(inner0, 0.62), up(outer0, 0.62), up(outer1, 0.62), concrete, concrete, concrete, concrete, UP);
        bd.quad(up(inner1, 0.34), up(inner0, 0.34), up(inner0, 0.5), up(inner1, 0.5), stripe, stripe, stripe, stripe);
      }
    }
    walk(b, side, 0.45, 5, (x, y, z, _dx, _dz, i) => {
      const bd = b.deco[b.chunkOf(i)]!;
      bd.post(x, y + 0.5, z, 0.17, 0.75, { bottom: black, top: yellow }, 8, 0.9);
      bd.post(x, y + 1.22, z, 0.19, 0.09, [3.4, 2.5, 0.7], 8);
    });
  }
}

// ─── The kitchen, snow, volcano, funfair, space and palm ─────────────────────

/** Sugar cubes, two high, in a slightly untidy wall; every so often a pastel one. */
function sugar(b: TrackBuild): void {
  const white = rgb("#fdfaf2");
  const shadow = rgb("#c5d0e4");
  const tints = [rgb("#ffc9d8"), rgb("#cfe0ff"), rgb("#ffe9b8")];
  for (const side of SIDES) {
    walk(b, side, 0.75, 1.32, (x, y, z, dx, dz, i, k) => {
      const bld = b.deco[b.chunkOf(i)]!;
      const r = hash1(k * 3 + side);
      const s = 1.1 + hash1(k) * 0.18;
      const tint = k % 9 === 4 ? tints[k % 3]! : null;
      const top = tint ? mixRgb(white, tint, 0.8) : white;
      const bottom = tint ? mixRgb(shadow, tint, 0.55) : shadow;
      const yaw = Math.atan2(dx, dz) + (r - 0.5) * 0.4;
      bld.box(x, y + s / 2 - 0.05, z, s, s, s, { bottom, top }, yaw);
      // The second cube sits on the first, a little off true.
      const off = (hash1(k + 7) - 0.5) * 0.3;
      bld.box(x + dz * off, y + s * 1.5 - 0.1, z - dx * off, s * 0.96, s * 0.96, s * 0.96, { bottom: scaleRgb(top, 0.85), top }, yaw + (hash1(k + 3) - 0.5) * 0.5);
      if (k % 3 === 0) {
        const c = tint ?? white;
        bld.box(x - dz * 0.2, y + s * 2.4 - 0.1, z + dx * 0.2, s * 0.8, s * 0.8, s * 0.8, { bottom: scaleRgb(c, 0.88), top: c }, yaw + 0.3);
      }
    });
  }
}

/** A lumpy snowbank with a red-and-white slalom pole now and then. */
function snowbank(b: TrackBuild): void {
  const white = rgb("#f8fbff");
  const shade = rgb("#b9cbea");
  const red = rgb("#e8453c");
  const pole = rgb("#fbfbfb");
  for (const side of SIDES) {
    walk(b, side, 0.75 + SOFT_PUSH.snowbank, 1.55, (x, y, z, dx, dz, i, k) => {
      const bld = b.deco[b.chunkOf(i)]!;
      const r = hash1(k * 5 + side * 11);
      const sc = 0.9 + r * 0.5;
      bld.blob(x, y + 0.35, z, 1.45 * sc, 0.95 * sc, 1.5 * sc, { bottom: shade, top: white }, 0, r * 6);
      // A smaller lump on top, so the bank rolls instead of standing like a wall.
      bld.blob(x, y + 1.1, z, 0.9 * sc, 0.6 * sc, 0.95 * sc, { bottom: scaleRgb(shade, 1.05), top: white }, 0, r * 3);
      if (k % 12 === 6) {
        // A slalom pole a little behind the bank's crest, with a flag.
        const px = x - dz * side * 0.2;
        const pz = z + dx * side * 0.2;
        for (let band = 0; band < 5; band++) bld.post(px, y + 0.9 + band * 0.55, pz, 0.06, 0.55, band % 2 === 0 ? red : pole, 6);
        bld.tri([px, y + 3.5, pz], [px + dx * 0.9, y + 3.2, pz + dz * 0.9], [px, y + 2.9, pz], red);
        bld.tri([px, y + 3.5, pz], [px, y + 2.9, pz], [px + dx * 0.9, y + 3.2, pz + dz * 0.9], red);
      }
    });
  }
}

/** Basalt boulders with a seam of lava now and then and a bright ember above it. */
function basalt(b: TrackBuild): void {
  const dark = rgb("#14121a");
  const top = rgb("#4a4552");
  for (const side of SIDES) {
    walk(b, side, 0.8 + SOFT_PUSH.basalt, 1.9, (x, y, z, dx, dz, i, k) => {
      const bld = b.deco[b.chunkOf(i)]!;
      const r = hash1(k * 7 + side);
      const sx = 1.0 + r * 0.8;
      const sy = 0.8 + hash1(k + 1) * 0.8;
      bld.add(shapes.ball(0), xf(x, y + sy * 0.55, z, sx, sy, 0.9 + hash1(k + 2) * 0.7, r * 6.28), { bottom: dark, top: mixRgb(top, dark, hash1(k + 4) * 0.5) });
      if (k % 4 === 1) {
        // A glowing seam low on the face that looks at the road.
        bld.box(x - dz * side * 0.5, y + 0.45, z + dx * side * 0.5, 0.18, 0.5, 0.9, [3.4, 1.0, 0.18], Math.atan2(dx, dz));
      }
      if (k % 6 === 3) b.glows.push({ x, y: y + 1.0, z, size: 3.4, colour: [1.0, 0.35, 0.08], alpha: 0.5 });
    });
  }
}

/** Candy-striped posts and rails with a bulb on every post, in bloom. */
function railing(b: TrackBuild): void {
  const red = rgb("#ee3a52");
  const cream = rgb("#fff3dc");
  const bulbs: Rgb[] = [
    [4.0, 3.0, 1.1],
    [4.0, 0.8, 1.9],
    [0.9, 3.0, 4.0],
  ];
  const halo: Rgb[] = [
    [1.0, 0.8, 0.35],
    [1.0, 0.3, 0.55],
    [0.3, 0.8, 1.0],
  ];
  for (const side of SIDES) {
    let last: V3 | null = null;
    walk(b, side, 0.5, 3.4, (x, y, z, _dx, _dz, i, k) => {
      const bld = b.deco[b.chunkOf(i)]!;
      for (let band = 0; band < 3; band++) bld.post(x, y - 0.05 + band * 0.42, z, 0.14, 0.42, band % 2 === 0 ? red : cream, 8);
      const bulb = bulbs[k % 3]!;
      bld.blob(x, y + 1.38, z, 0.2, 0.2, 0.2, bulb, 0);
      if (k % 2 === 0) b.glows.push({ x, y: y + 1.4, z, size: 2.4, colour: halo[k % 3]!, alpha: 0.75 });
      if (last && Math.hypot(x - last[0], z - last[2]) < 4.5) {
        bld.rod([last[0], last[1] + 1.0, last[2]], [x, y + 1.0, z], 0.12, cream);
        bld.rod([last[0], last[1] + 0.55, last[2]], [x, y + 0.55, z], 0.12, red);
      }
      last = [x, y, z];
    });
  }
}

/** A thin glowing rail of light on small pylons: the road's edge in space. */
function hologram(b: TrackBuild): void {
  const core: Rgb = [0.15, 1.2, 1.7];
  for (const side of SIDES) {
    walk(b, side, 0.5, 6, (x, y, z, _dx, _dz, i) => {
      const bld = b.deco[b.chunkOf(i)]!;
      bld.post(x, y - 0.1, z, 0.1, 1.3, { bottom: [0.03, 0.12, 0.2], top: [0.5, 2.6, 3.4] }, 6);
      bld.blob(x, y + 1.35, z, 0.17, 0.17, 0.17, [1.0, 4.0, 4.5], 0);
    });
    // The rail: a band of light that is brightest at its middle.
    for (let i = 0; i < b.n; i++) {
      if (b.open(i, side) > 0.5 || b.gap(i) || b.hidden(i, side)) continue;
      const a = b.S(i);
      const c = b.S(i + 1);
      if (b.open(i + 1, side) > 0.5) continue;
      const o0 = side * (a.width / 2 + b.wall(i, side) + 0.5);
      const o1 = side * (c.width / 2 + b.wall(i + 1, side) + 0.5);
      const row = (j: number, o: number, h: number): V3 => b.P(j, o, h);
      const dark: Rgb = [0, 0, 0];
      b.additive.quad(row(i, o0, 0.2), row(i + 1, o1, 0.2), row(i + 1, o1, 0.72), row(i, o0, 0.72), dark, dark, core, core, UP);
      b.additive.quad(row(i, o0, 0.72), row(i + 1, o1, 0.72), row(i + 1, o1, 1.25), row(i, o0, 1.25), core, core, dark, dark, UP);
    }
  }
}

/** Bamboo poles lashed with rope, a pennant now and then. */
function bamboo(b: TrackBuild): void {
  const pale = rgb("#d9d77f");
  const green = rgb("#8f9d44");
  const node = rgb("#6f7332");
  const rope = rgb("#7a5a38");
  const flags = [rgb("#18c7c0"), rgb("#ff6f5e"), rgb("#ffd34d")];
  for (const side of SIDES) {
    let last: V3 | null = null;
    walk(b, side, 0.5, 2.4, (x, y, z, dx, dz, i, k) => {
      const bld = b.deco[b.chunkOf(i)]!;
      const h = 1.85 + hash1(k) * 0.3;
      bld.post(x, y - 0.1, z, 0.11, h, { bottom: green, top: pale }, 6);
      for (const ny of [0.55, 1.2]) bld.post(x, y + ny, z, 0.14, 0.07, node, 6);
      bld.post(x, y + h - 0.1, z, 0.13, 0.05, rope, 6);
      if (last && Math.hypot(x - last[0], z - last[2]) < 3.5) {
        bld.rod([last[0], last[1] + 0.62, last[2]], [x, y + 0.62, z], 0.1, pale);
        bld.rod([last[0], last[1] + 1.38, last[2]], [x, y + 1.38, z], 0.1, pale);
      }
      if (k % 9 === 4) {
        const f = flags[k % 3]!;
        const top = y + h;
        bld.tri([x, top, z], [x + dx * 0.9, top - 0.18, z + dz * 0.9], [x, top - 0.5, z], f);
        bld.tri([x, top, z], [x, top - 0.5, z], [x + dx * 0.9, top - 0.18, z + dz * 0.9], f);
      }
      last = [x, y, z];
    });
  }
}
