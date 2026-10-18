import { CanvasTexture, LinearFilter, LinearMipmapLinearFilter, SRGBColorSpace, type Texture } from "three";
import { mulberry32 } from "../rules/rng";

/**
 * Sprite art for effects, painted into canvases at load (no image files):
 * an atlas of five cells for the particle system, and a bullet hole for
 * decals. Cells: 0 soft dot, 1 smoke puff, 2 four-point star (flash, glint,
 * spark), 3 streak (feather, droplet, splinter at a distance), 4 a lens
 * flare's hair-thin line (the sun glinting off a gun).
 */
export const ATLAS_CELLS = 5;

export function particleAtlas(): Texture {
  const cell = 128;
  const c = document.createElement("canvas");
  c.width = cell * ATLAS_CELLS;
  c.height = cell;
  const g = c.getContext("2d");
  if (!g) throw new Error("2D canvas unavailable");
  const r = mulberry32(99);
  // 0: soft dot.
  {
    const grad = g.createRadialGradient(cell / 2, cell / 2, 0, cell / 2, cell / 2, cell / 2);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.35, "rgba(255,255,255,0.6)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, cell, cell);
  }
  // 1: smoke puff: overlapping soft blobs, lumpy edge.
  {
    const x0 = cell;
    for (let i = 0; i < 14; i++) {
      const a = r() * Math.PI * 2;
      const d = r() * cell * 0.18;
      const x = x0 + cell / 2 + Math.cos(a) * d;
      const y = cell / 2 + Math.sin(a) * d;
      const rad = cell * (0.18 + r() * 0.16);
      const grad = g.createRadialGradient(x, y, 0, x, y, rad);
      grad.addColorStop(0, "rgba(255,255,255,0.32)");
      grad.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = grad;
      g.fillRect(x0, 0, cell, cell);
    }
  }
  // 2: four-point star with a hot core.
  {
    const x0 = cell * 2;
    const cx = x0 + cell / 2;
    const cy = cell / 2;
    const core = g.createRadialGradient(cx, cy, 0, cx, cy, cell * 0.28);
    core.addColorStop(0, "rgba(255,255,255,1)");
    core.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = core;
    g.fillRect(x0, 0, cell, cell);
    g.globalCompositeOperation = "lighter";
    for (const [w, h] of [
      [cell * 0.5, 3],
      [3, cell * 0.5],
    ]) {
      const grad = g.createRadialGradient(cx, cy, 0, cx, cy, cell * 0.5);
      grad.addColorStop(0, "rgba(255,255,255,0.95)");
      grad.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = grad;
      g.fillRect(cx - (w as number), cy - (h as number), (w as number) * 2, (h as number) * 2);
    }
    g.globalCompositeOperation = "source-over";
  }
  // 3: a soft streak.
  {
    const x0 = cell * 3;
    const grad = g.createRadialGradient(x0 + cell / 2, cell / 2, 0, x0 + cell / 2, cell / 2, cell / 2);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.save();
    g.translate(x0 + cell / 2, cell / 2);
    g.scale(1, 0.28);
    g.translate(-(x0 + cell / 2), -cell / 2);
    g.fillStyle = grad;
    g.fillRect(x0, 0, cell, cell);
    g.restore();
  }
  // 4: a lens flare's line: hair-thin across the cell, brightest at the middle
  // and dying away toward the ends, with a faint halo round it.
  {
    const x0 = cell * 4;
    const img = g.createImageData(cell, cell);
    for (let y = 0; y < cell; y++) {
      for (let x = 0; x < cell; x++) {
        const u = (x + 0.5) / cell - 0.5;
        const v = (y + 0.5) / cell - 0.5;
        const along = Math.max(0, 1 - Math.abs(u) * 2);
        const line = Math.exp(-((v / 0.012) ** 2)) * along ** 1.6;
        const halo = Math.exp(-((v / 0.05) ** 2)) * along ** 3 * 0.25;
        const a = Math.min(1, line + halo);
        const i = (y * cell + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
        img.data[i + 3] = Math.round(a * 255);
      }
    }
    g.putImageData(img, x0, 0);
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.minFilter = LinearMipmapLinearFilter;
  t.magFilter = LinearFilter;
  return t;
}

/** A bullet hole: a dark core, a ring of torn fibre, faint scorch. */
export function bulletHoleTexture(): Texture {
  const s = 128;
  const c = document.createElement("canvas");
  c.width = s;
  c.height = s;
  const g = c.getContext("2d");
  if (!g) throw new Error("2D canvas unavailable");
  const r = mulberry32(7);
  const scorch = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  scorch.addColorStop(0, "rgba(20,14,10,0.55)");
  scorch.addColorStop(0.5, "rgba(30,22,16,0.25)");
  scorch.addColorStop(1, "rgba(30,22,16,0)");
  g.fillStyle = scorch;
  g.fillRect(0, 0, s, s);
  g.fillStyle = "rgba(60,44,30,0.7)";
  for (let i = 0; i < 18; i++) {
    const a = r() * Math.PI * 2;
    const len = s * (0.12 + r() * 0.18);
    g.save();
    g.translate(s / 2, s / 2);
    g.rotate(a);
    g.fillRect(0, -1.5, len, 3);
    g.restore();
  }
  g.fillStyle = "rgba(8,6,5,1)";
  g.beginPath();
  g.arc(s / 2, s / 2, s * 0.11, 0, Math.PI * 2);
  g.fill();
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}
