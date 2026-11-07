/**
 * Canyon Run's second-pass set pieces: the old mine's timbered tunnel through the mesa (the split's dark way), the swaying
 * rope bridge over the gorge, the pit-head with its turning winding wheel, and the dynamite shack by the cannon.
 *
 * The two spans (`mine-tunnel`, `rope-bridge`) are built in the road's frame (x right, y up, z along; see types.ts) and
 * stand clear of the road: anything within the solid band (0.45 to 5 m) is kept beyond the barrier and the camera's margin,
 * so the tunnel's posts hug its walls and its cross beams sit over 5 m up, and the rope bridge's cables stand outside the
 * deck. What is flat on the road (rails, sleepers, planks) is under 0.45 m and may lie on it.
 */
import { Object3D } from "three";
import { MeshBuilder, mixRgb, ramp, rgb, rockBlob, scaleRgb, shapes, xf, type Rgb, type Shade, type V3 } from "./kit";
import { beam, drift, hash, noisyArch } from "./rockKit";
import type { Halo, LandmarkSpec, MovingPart } from "./types";

// ─── Palette ─────────────────────────────────────────────────────────────────

const SAND = rgb("#e0b578");
const RED = rgb("#b04a2a");
const DEEP_RED = rgb("#8a3524");
const TAN = rgb("#d9a066");
const ORANGE = rgb("#d9783a");
const CREAM = rgb("#ecd3a2");
const CAP = rgb("#6b3a2e");
const DUST = rgb("#d9b680");
const TIMBER = rgb("#7a4a26");
const TIMBER_DARK = rgb("#4a2c18");
const TIMBER_PALE = rgb("#a8743f");
const IRON = rgb("#2e2a2c");
const RUST = rgb("#8a4a2a");
const ROPE = rgb("#c9a56a");
const ROPE_DARK = rgb("#7a5c34");
/** Lantern light: above 1, so it glows. */
const LAMP: Rgb = [4.2, 2.5, 0.9];
const STRATA = [CREAM, ORANGE, RED, TAN, DEEP_RED, SAND, ORANGE, CAP];

/** Sandstone bands by height, darker the deeper in. */
function rockShade(seed: number, tone = 1, band = 2.4): Shade {
  return (p, i, j) => {
    const k = Math.floor(p[1] / band + hash(Math.floor(p[1] / band), seed) * 0.8);
    const c = STRATA[Math.abs(k) % STRATA.length]!;
    return scaleRgb(c, tone * (0.88 + 0.2 * hash(i, j, seed + 3)));
  };
}

/** A plank (or sleeper) lying across the road: a thin box tinted by its own hash. */
function plank(b: MeshBuilder, x: number, y: number, z: number, w: number, t: number, d: number, seed: number, dark = 1): void {
  b.box(x, y, z, w, t, d, scaleRgb(mixRgb(TIMBER_DARK, TIMBER_PALE, hash(seed, 3)), dark * (0.8 + 0.3 * hash(seed, 4))), 0, 0, (hash(seed, 5) - 0.5) * 0.02);
}

// ─── The mine's tunnel ───────────────────────────────────────────────────────

/**
 * A mine gallery driven into the mesa: a rough rock tube thick enough to be a hill, timbered every few metres with a pair of
 * posts at the wall and a cap beam across over 5 m up (a lantern hanging from each), rails and sleepers laid along the
 * floor with a pair of side-gallery mouths where the carts run in from, a heavy timber portal at each end with a hanging
 * sign, and a spoil heap at each mouth. Warm lantern light all the way down it.
 */
export const mineTunnel: LandmarkSpec = {
  span: true,
  defaultSpan: 40,
  build(ctx) {
    const lit = new MeshBuilder();
    const glow = new MeshBuilder();
    const halos: Halo[] = [];
    const hw = Math.max(13.4, ctx.halfWidth + 8.4);
    const top = 10.6;
    const legs = 4.6;
    const half = ctx.span / 2;
    const lip = 2.4;
    const thick = (t: number, zt: number) => (4.2 + 2.4 * Math.sin(Math.PI * t)) * (0.7 + 0.3 * Math.pow(Math.sin(Math.PI * zt), 0.5));
    const body = { halfIn: hw, topIn: top, legs, thick, steps: Math.max(6, Math.round(ctx.span / 3)), arcSteps: 14, rough: 0.55, seed: 11, skirt: 3 };
    noisyArch(lit, { ...body, z0: -half + lip, z1: half - lip, inner: rockShade(2, 0.62), outer: rockShade(7, 1.0, 2.8) });
    // The mouths: fatter, paler rock either end, and a hill of rubble on top, so it reads as a mesa with a hole through it.
    for (const s of [-1, 1]) {
      const z0 = s < 0 ? -half : half - lip - 0.01;
      noisyArch(lit, { ...body, thick: (t) => 5.4 + 2.6 * Math.sin(Math.PI * t), steps: 2, rough: 0.9, seed: 30 + s, z0, z1: z0 + lip + 0.01, inner: rockShade(4, 0.8), outer: rockShade(9, 1.05, 2.8) });
    }
    for (let k = 0; k < 9; k++) {
      const z = -half * 0.9 + (k / 8) * half * 1.8;
      const x = (hash(k, 7) - 0.5) * 9;
      const s = 4.2 + hash(k, 8) * 3.4;
      rockBlob(lit, x, top + 4.4 + 2.4 * Math.sin((k / 8) * Math.PI), z, s * 1.2, s * 0.7, s, rockShade(40 + k, 1.05), k + 3, { detail: 1, roughness: 0.22, flatBase: true });
    }
    for (const s of [-1, 1]) for (let k = 0; k < 3; k++) drift(lit, s * (hw + 4.8 + k * 0.7), -half * 0.55 + k * half * 0.55, 3.8, 1.5, 3.4, (p) => scaleRgb(DUST, 0.8 + 0.12 * p[1]), k + s * 5);
    // Timber sets: two posts at the wall and a cap beam across, every 5 m; a lantern from each beam.
    const sets: number[] = [];
    for (let z = -half + lip + 3; z <= half - lip - 2; z += 5) sets.push(z);
    for (const z of sets) {
      const px = hw - 0.5;
      for (const s of [-1, 1]) {
        lit.box(s * px, legs * 0.5 + 0.8, z, 0.62, legs + 1.6, 0.62, { bottom: TIMBER_DARK, top: TIMBER }, 0, 0, 0);
        // A diagonal brace from the post up under the beam, held above the camera's band.
        beam(lit, [s * px, 5.2, z], [s * (px - 2.6), 6.5, z], 0.34, 0.34, [0, 0, 1], TIMBER_DARK, TIMBER);
      }
      lit.box(0, 6.1, z, 2 * px + 0.6, 0.55, 0.7, { bottom: TIMBER_DARK, top: TIMBER_PALE });
      // The lantern: an iron cage and a bright core, a short chain above it.
      lit.rod([0, 6.0, z], [0, 5.5, z], 0.07, IRON);
      lit.box(0, 5.2, z, 0.5, 0.55, 0.5, IRON);
      glow.box(0, 5.2, z, 0.34, 0.4, 0.34, LAMP);
      halos.push({ x: 0, y: 5.2, z, size: 11, colour: [3.2, 1.9, 0.7], alpha: 0.42, twinkle: 0.1 });
    }
    // The floor: sleepers and a pair of rails the length of the tunnel, one track down the middle, under 0.45 m so they may lie on the road.
    const rail = rgb("#6c6a6e");
    for (let z = -half + lip; z <= half - lip; z += 1.3) plank(lit, 0, 0.1, z, 3.6, 0.1, 0.34, Math.round(z * 10));
    for (const x of [-1.5, 1.5]) lit.box(x, 0.2, 0, 0.14, 0.14, ctx.span - 2 * lip, rail);
    // The side galleries: a dark mouth in each wall where the carts come from (the hazards cross the road here), framed in
    // timber, with rails leading to it. The carts run at about a quarter and three quarters of the way along; the mouths are drawn on
    // the walls at both, so each cart has somewhere to come from.
    for (const z of [-half * 0.22, half * 0.22]) {
      for (const s of [-1, 1]) {
        const x = s * (hw - 0.15);
        glow.box(x, 2.3, z, 0.1, 4.2, 3.6, [0.05, 0.03, 0.02]);
        for (const dz of [-2.1, 2.1]) lit.box(x - s * 0.1, 2.3, z + dz, 0.5, 4.6, 0.5, { bottom: TIMBER_DARK, top: TIMBER });
        lit.box(x - s * 0.1, 4.7, z, 0.6, 0.5, 4.8, { bottom: TIMBER_DARK, top: TIMBER_PALE });
        // a red warning lamp over each mouth
        glow.box(x - s * 0.5, 5.6, z, 0.3, 0.3, 0.3, [4.4, 0.45, 0.35]);
        halos.push({ x: x - s * 0.6, y: 5.6, z, size: 6, colour: [3.5, 0.5, 0.4], alpha: 0.4, twinkle: 0.2 });
      }
      for (let x = -hw + 1; x <= hw - 1; x += 1.4) lit.box(x, 0.1, z, 0.34, 0.1, 3.2, TIMBER_DARK);
      for (const dz of [-0.8, 0.8]) lit.box(0, 0.2, z + dz, 2 * hw - 2, 0.14, 0.14, rail);
    }
    // The portals: heavy square-set timbers at each mouth, a lintel, and a hanging plank sign with a lamp.
    for (const s of [-1, 1]) {
      const z = s * (half - 1.1);
      const px = hw + 0.4;
      for (const x of [-px, px]) lit.box(x, 5.6, z, 1.4, 11.6, 1.4, { bottom: TIMBER_DARK, top: TIMBER });
      lit.box(0, 11.4, z, 2 * px + 1.8, 1.4, 1.6, { bottom: TIMBER_DARK, top: TIMBER_PALE });
      for (const x of [-px * 0.62, px * 0.62]) beam(lit, [x * 1.4, 11.2, z], [x * 0.82, 9.2, z], 0.6, 0.5, [0, 0, 1], TIMBER_DARK, TIMBER);
      lit.box(0, 8.2, z - s * 0.2, 7.6, 1.5, 0.3, ramp(TIMBER_DARK, TIMBER));
      // Chalked letters: pale bars in rows, the shape of a name.
      for (let k = 0; k < 7; k++) lit.box(-2.7 + k * 0.9, 8.2, z - s * 0.4, 0.5, 0.6 + 0.4 * hash(k, 5), 0.1, rgb("#efe0b8"));
      glow.box(-3.2, 7.1, z - s * 0.5, 0.3, 0.4, 0.3, LAMP);
      glow.box(3.2, 7.1, z - s * 0.5, 0.3, 0.4, 0.3, LAMP);
      halos.push({ x: -3.2, y: 7.1, z: z - s * 0.8, size: 8, colour: [3.2, 1.9, 0.7], alpha: 0.5, twinkle: 0.1 }, { x: 3.2, y: 7.1, z: z - s * 0.8, size: 8, colour: [3.2, 1.9, 0.7], alpha: 0.5, twinkle: 0.1 });
    }
    // Light down the length: a halo high in the roof every so often, so the dark has pools in it.
    for (let z = -half + 6; z <= half - 5; z += 10) halos.push({ x: 0, y: top - 2, z, size: 22, colour: [2.4, 1.3, 0.5], alpha: 0.2, twinkle: 0.06 });
    return { lit, glow, halos };
  },
};

// ─── The rope bridge ─────────────────────────────────────────────────────────

/**
 * A rope bridge over the gorge: a deck of planks laid on the road (a gap here and there, a few cocked), two heavy hand ropes
 * hung from stout end posts and sagging between rope-wrapped posts either side, hangers down to the deck, and a stone
 * cairn at each end. Everything that stands higher than the deck is outside the road's edge.
 */
export const ropeBridge: LandmarkSpec = {
  span: true,
  defaultSpan: 52,
  build(ctx) {
    const lit = new MeshBuilder();
    const L = ctx.span;
    const half = L / 2;
    const hw = ctx.halfWidth;
    // The deck: planks across the road, a hair above it, with a thin dark gap between most.
    const step = 0.95;
    let n = 0;
    for (let z = -half + 1; z <= half - 1; z += step, n++) {
      const edge = Math.min(1, (half - Math.abs(z)) / 3);
      if (edge <= 0 || hash(n, 9) < 0.04) continue;
      plank(lit, 0, 0.09, z, 2 * hw + 0.2, 0.12, step - 0.12, n, 0.9);
    }
    // Two long stringers under the deck and the ropes they hang from.
    const rx = hw + 2.1;
    for (const s of [-1, 1]) {
      const post = (z: number): void => {
        lit.box(s * rx, 1.35, z, 0.42, 2.8, 0.42, { bottom: TIMBER_DARK, top: TIMBER });
        lit.box(s * rx, 2.8, z, 0.6, 0.18, 0.6, TIMBER_PALE);
        // rope lashings
        for (const y of [0.5, 1.1, 1.7]) lit.box(s * rx, y, z, 0.52, 0.1, 0.52, ROPE_DARK);
      };
      // The hand rope: a long catenary from the end posts, sagging to a metre and a half, cut into short straight pieces.
      const pts: V3[] = [];
      const seg = Math.max(8, Math.round(L / 2));
      for (let k = 0; k <= seg; k++) {
        const t = k / seg;
        const z = -half + 0.4 + t * (L - 0.8);
        const sag = 4 * t * (1 - t);
        pts.push([s * rx, 2.9 - 1.4 * sag, z]);
      }
      for (let k = 0; k < seg; k++) lit.rod(pts[k]!, pts[k + 1]!, 0.26, k % 2 ? ROPE : scaleRgb(ROPE, 0.88));
      // A second, lower rope along the edge of the deck.
      lit.box(s * (hw + 0.1), 0.25, 0, 0.24, 0.24, L - 1, ROPE_DARK);
      // Posts every few metres, and a hanger from the rope to the lower line at each.
      for (let z = -half + 0.4; z <= half - 0.3; z += 4.4) {
        post(z);
        const t = (z + half - 0.4) / (L - 0.8);
        const sag = 4 * Math.max(0, Math.min(1, t)) * (1 - Math.max(0, Math.min(1, t)));
        lit.rod([s * rx, 2.9 - 1.4 * sag, z], [s * (hw + 0.1), 0.3, z], 0.1, ROPE_DARK);
      }
      // The end posts: tall, with a cross-piece and a cap.
      for (const e of [-1, 1]) {
        const z = e * (half - 0.4);
        lit.box(s * rx, 3.6, z, 0.8, 7.4, 0.8, { bottom: TIMBER_DARK, top: TIMBER });
        lit.box(s * rx, 7.5, z, 1.3, 0.4, 1.3, IRON);
        // Cable stays to the ground beyond.
        lit.rod([s * rx, 7.2, z], [s * (rx + 2.4), 0.2, z + e * 5.5], 0.18, ROPE_DARK);
      }
    }
    // A stone cairn and a heap of planks at each end.
    for (const e of [-1, 1]) {
      for (const s of [-1, 1]) {
        const z = e * (half + 1.6);
        for (let k = 0; k < 4; k++) rockBlob(lit, s * (rx + 3.2 + hash(k, e + s) * 1.8), 0, z + (hash(k, 3) - 0.5) * 3, 1.2 + hash(k, 5), 0.8 + hash(k, 6) * 0.7, 1.2 + hash(k, 7), rockShade(60 + k, 1), k + 9, { detail: 0, roughness: 0.3, flatBase: true });
      }
    }
    return { lit };
  },
};

// ─── The pit-head ────────────────────────────────────────────────────────────

/**
 * The mine's headframe: a tall timber A-frame over a shaft with a winding wheel at its top (it turns slowly), a corrugated
 * engine shed with a smoking pipe, an ore bin on legs and a loading chute, and a few rusted carts at its foot.
 */
export const headframe: LandmarkSpec = {
  footprint: 14,
  build(ctx) {
    const lit = new MeshBuilder();
    const glow = new MeshBuilder();
    const H = 19;
    const base = 5.6;
    // Two A-frames side by side along z, braced across.
    for (const z of [-2.4, 2.4]) {
      for (const s of [-1, 1]) {
        beam(lit, [s * base, -1, z], [s * 1.15, H, z], 0.9, 0.9, [0, 0, 1], TIMBER_DARK, TIMBER);
        beam(lit, [s * base * 0.62, 5.2, z], [s * base * 0.62 + s * 0.01, 5.2, z], 0.2, 0.2, [0, 0, 1], TIMBER);
      }
      for (const y of [4.5, 9.5, 14]) {
        const k = 1 - (y + 1) / (H + 1);
        lit.box(0, y, z, 2 * (1.15 + (base - 1.15) * k), 0.5, 0.6, { bottom: TIMBER_DARK, top: TIMBER_PALE });
      }
    }
    for (const y of [5, 11]) {
      const k = 1 - (y + 1) / (H + 1);
      for (const s of [-1, 1]) beam(lit, [s * (1.15 + (base - 1.15) * k), y, -2.4], [s * (1.15 + (base - 1.15) * (1 - (y + 6) / (H + 1))), y + 6, 2.4], 0.34, 0.34, [0, 1, 0], TIMBER_DARK, TIMBER);
    }
    // The wheel house at the top: a platform, an axle, and the cable going down to the shaft.
    lit.box(0, H, 0, 3.4, 0.5, 6.2, { bottom: TIMBER_DARK, top: TIMBER_PALE });
    lit.box(0, H + 0.2, 0, 0.5, 0.5, 6.8, IRON);
    lit.rod([0, H + 4.6, 0.2], [2.4, -0.5, 0.2], 0.12, IRON);
    lit.rod([0, H + 4.6, -0.2], [-2.4, -0.5, -0.2], 0.12, IRON);
    // The shaft collar and a cage.
    lit.box(0, 0.25, 0, 5.4, 0.6, 5.4, { bottom: TIMBER_DARK, top: TIMBER });
    lit.box(0, 1.6, 0, 3.0, 2.2, 3.0, { bottom: IRON, top: scaleRgb(RUST, 1.1) });
    // The engine shed: corrugated roof sloping one way, a smoking pipe.
    const sx = -10;
    lit.box(sx, 2.0, 0, 7.2, 4.0, 8.4, { bottom: TIMBER_DARK, top: TIMBER });
    lit.box(sx, 4.4, 0, 8.0, 0.4, 9.2, ramp(RUST, scaleRgb(RUST, 1.3)), 0, 0, 0.18);
    lit.post(sx + 2.2, 4.2, 2.4, 0.5, 4.2, ramp(IRON, scaleRgb(IRON, 1.5)), 8, 0.8);
    glow.box(sx + 3.62, 2.2, 0, 0.1, 1.4, 1.6, LAMP);
    // The ore bin on legs, with a chute and a few heaped carts below.
    const bx = 11;
    for (const dx of [-2.6, 2.6]) for (const dz of [-2, 2]) lit.box(bx + dx, 3.2, dz, 0.5, 6.6, 0.5, { bottom: TIMBER_DARK, top: TIMBER });
    lit.box(bx, 7.4, 0, 7.6, 2.4, 6, ramp(rgb("#5a3a26"), TIMBER));
    lit.add(shapes.cone(4), xf(bx, 5.6, 0, 3.2, 2.2, 2.8, Math.PI / 4, Math.PI, 0), ramp(RUST, IRON));
    beam(lit, [bx - 2, 5.2, 0], [bx - 5.6, 2.6, 0], 1.2, 0.3, [0, 0, 1], TIMBER_DARK, TIMBER);
    for (let k = 0; k < 3; k++) {
      const x = 5 + k * 2.6;
      lit.box(x, 0.9, 7 + (k % 2) * 0.8, 2.0, 1.2, 3.0, { bottom: rgb("#4a3a2e"), top: rgb("#7a5a3a") }, 0.1 * k);
      lit.blob(x, 1.7, 7 + (k % 2) * 0.8, 0.9, 0.4, 1.3, ramp(rgb("#6a4a28"), rgb("#d6a23a")), 1);
    }
    // Spoil heap round it all.
    rockBlob(lit, -3, 0, -8, 7, 3.4, 5.6, rockShade(81, 0.9), 2, { detail: 1, roughness: 0.25, flatBase: true });
    rockBlob(lit, 4, 0, -9, 5, 2.4, 4.2, rockShade(82, 1.0), 3, { detail: 1, roughness: 0.25, flatBase: true });
    // A lamp at the shaft that glows all night.
    glow.box(0, 3.6, 3.1, 0.3, 0.4, 0.3, LAMP);
    // The wheel turns: a big spoked wheel about the axle (x axis), slowly.
    const wheel = new MeshBuilder();
    const R = 4.2;
    const ring: V3[] = [];
    for (let k = 0; k <= 20; k++) ring.push([0, H + 0.2 + Math.cos((k / 20) * Math.PI * 2) * R, Math.sin((k / 20) * Math.PI * 2) * R]);
    for (let k = 0; k < 20; k++) wheel.rod(ring[k]!, ring[k + 1]!, 0.5, IRON);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      wheel.rod([0, H + 0.2, 0], [0, H + 0.2 + Math.cos(a) * R, Math.sin(a) * R], 0.3, TIMBER);
    }
    wheel.post(0, H - 0.2, 0, 0.9, 0.8, IRON);
    wheel.box(0, H + 0.2, 0, 1.4, 1.4, 1.4, IRON);
    const spin: MovingPart = {
      lit: wheel,
      pivot: [0, H + 0.2, 0],
      update(t: number, part: Object3D) {
        part.rotation.x = t * 0.35;
      },
    };
    return { lit, glow, moving: [spin], halos: [{ x: sx + 3.9, y: 2.2, z: 0, size: 7, colour: [3.2, 1.9, 0.7], alpha: 0.4, twinkle: 0.1 }] };
  },
};

// ─── The dynamite shack ──────────────────────────────────────────────────────

/**
 * A rickety shack of planks beside the cannon's pad: a tin roof, a hand-lettered DANGER board, a stack of red crates
 * and barrels of dynamite spilling out of the door, and the plunger box with its wires running off to the barrels.
 */
export const dynamiteShack: LandmarkSpec = {
  footprint: 9,
  build() {
    const lit = new MeshBuilder();
    const glow = new MeshBuilder();
    const CRATE = rgb("#c23a2a");
    const CRATE_DARK = rgb("#7a2018");
    // The shack: plank walls, a lean-to tin roof, a door open on the dark.
    lit.box(0, 2.1, 0, 7.4, 4.2, 5.6, { bottom: TIMBER_DARK, top: TIMBER });
    for (let k = -3; k <= 3; k++) lit.box(k * 1.0, 2.1, 2.85, 0.08, 4.1, 0.1, TIMBER_DARK);
    lit.box(0, 4.55, 0, 8.4, 0.35, 6.8, ramp(RUST, scaleRgb(RUST, 1.35)), 0, 0.14, 0);
    for (let k = -4; k <= 4; k++) lit.box(k * 0.9, 4.75, 0.1, 0.12, 0.12, 6.9, scaleRgb(RUST, 1.5), 0, 0.14, 0);
    glow.box(0.6, 1.7, 2.9, 1.9, 3.2, 0.05, [0.06, 0.03, 0.02]);
    for (const x of [-0.5, 1.7]) lit.box(x - 0.5 + 0.4, 1.7, 2.95, 0.22, 3.4, 0.3, TIMBER_DARK);
    // The board: DANGER in pale bars on red.
    lit.box(-2.2, 3.2, 3.0, 2.8, 1.0, 0.16, rgb("#8a1e18"));
    for (let k = 0; k < 6; k++) lit.box(-3.2 + k * 0.4, 3.2, 3.12, 0.22, 0.6, 0.06, rgb("#f4e8c8"));
    // Crates and barrels.
    for (let k = 0; k < 6; k++) {
      const x = 4.6 + (k % 3) * 1.25;
      const y = 0.55 + Math.floor(k / 3) * 1.1;
      lit.box(x, y, 1.6 - (k % 2) * 0.4, 1.15, 1.05, 1.15, { bottom: CRATE_DARK, top: CRATE }, 0.1 * k);
      lit.box(x, y + 0.53, 1.6 - (k % 2) * 0.4, 0.5, 0.04, 1.2, rgb("#f4e8c8"), 0.1 * k);
    }
    for (let k = 0; k < 4; k++) {
      const x = -4.9 + (k % 2) * 1.1;
      const z = 1.9 + Math.floor(k / 2) * 1.2;
      lit.post(x, 0, z, 0.6, 1.4, ramp(CRATE_DARK, CRATE), 8, 0.95);
      lit.post(x, 1.4, z, 0.6, 0.12, rgb("#f4e8c8"), 8);
      glow.box(x, 1.55, z, 0.1, 0.1, 0.1, [4.4, 0.45, 0.35]);
    }
    // The plunger box: a crate on a post with a T handle, a pair of wires snaking off.
    lit.box(-7.2, 0.7, 5.4, 1.1, 1.4, 1.1, { bottom: TIMBER_DARK, top: TIMBER_PALE });
    lit.rod([-7.2, 1.4, 5.4], [-7.2, 2.5, 5.4], 0.14, IRON);
    lit.box(-7.2, 2.5, 5.4, 0.9, 0.14, 0.14, IRON);
    lit.rod([-6.7, 0.2, 5.4], [-5.0, 0.12, 3.0], 0.06, [0.05, 0.05, 0.06]);
    lit.rod([-5.0, 0.12, 3.0], [-4.6, 0.2, 2.2], 0.06, [0.05, 0.05, 0.06]);
    // Scattered sand and rock round it.
    for (let k = 0; k < 4; k++) drift(lit, (hash(k, 1) - 0.5) * 16, (hash(k, 2) - 0.2) * 8, 2.4 + hash(k, 3) * 1.4, 0.4, 1.6, (p) => scaleRgb(DUST, 0.8 + 0.2 * p[1]), k + 30);
    return { lit, glow };
  },
};

export const MINE_LANDMARKS: Record<string, LandmarkSpec> = {
  "mine-tunnel": mineTunnel,
  "rope-bridge": ropeBridge,
  headframe,
  "dynamite-shack": dynamiteShack,
};
