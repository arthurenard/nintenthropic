/**
 * Small textures drawn on a canvas at load: the road's asphalt and paint, the
 * boost pad's chevrons, soft glows and shadow blobs, the start gantry's
 * banner. Drawn, not downloaded, like every Handy asset until art exists.
 */
import { CanvasTexture, LinearMipmapLinearFilter, LinearFilter, RepeatWrapping, SRGBColorSpace, ClampToEdgeWrapping } from "three";
import { seededRandom } from "../../../engine/random";
import type { ThemeStyle } from "./themes";

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("2D canvas unavailable");
  return [c, ctx];
}

function finish(t: CanvasTexture, anisotropy: number, repeatT = false): CanvasTexture {
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = anisotropy;
  t.wrapS = ClampToEdgeWrapping;
  t.wrapT = repeatT ? RepeatWrapping : ClampToEdgeWrapping;
  t.minFilter = LinearMipmapLinearFilter;
  t.magFilter = LinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

/** Metres of road one repeat of the asphalt texture covers, lengthways. */
export const ROAD_TILE = 12;

/**
 * The road across its width (u: 0 left edge .. 1 right edge) and one tile
 * along it (v): speckled asphalt, two darker rubbered-in lanes, white edge
 * lines and a dashed centre line, the shoulders fading to the theme's dust.
 */
export function roadTexture(style: ThemeStyle, anisotropy: number, size = 512): CanvasTexture {
  const W = size;
  const H = size;
  const f = size / 512;
  const [c, ctx] = canvas(W, H);
  const rnd = seededRandom(7);
  ctx.fillStyle = style.road.base;
  ctx.fillRect(0, 0, W, H);

  // Large soft blotches, so the surface is never flat.
  for (let i = 0; i < 60; i++) {
    const x = rnd() * W;
    const y = rnd() * H;
    const r = (30 + rnd() * 90) * f;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const light = rnd() > 0.5;
    g.addColorStop(0, light ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.06)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  // Rubbered-in lanes: two faint dark bands where the karts run.
  for (const cx of [0.3, 0.7]) {
    const g = ctx.createLinearGradient((cx - 0.12) * W, 0, (cx + 0.12) * W, 0);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(0.5, "rgba(0,0,0,0.13)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect((cx - 0.12) * W, 0, 0.24 * W, H);
  }

  // Fine grain.
  for (let i = 0; i < 9000 * f * f; i++) {
    const x = rnd() * W;
    const y = rnd() * H;
    const s = (1 + rnd() * 1.6) * f;
    ctx.fillStyle = rnd() > 0.5 ? style.road.speckle : "#000";
    ctx.globalAlpha = 0.05 + rnd() * 0.16;
    ctx.fillRect(x, y, s, s);
  }
  ctx.globalAlpha = 1;

  // Shoulders: dust or damp drifting in from each edge.
  for (const side of [0, 1]) {
    const x0 = side === 0 ? 0 : W;
    const g = ctx.createLinearGradient(x0, 0, side === 0 ? W * 0.16 : W * 0.84, 0);
    g.addColorStop(0, style.road.shoulder);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = g;
    ctx.fillRect(side === 0 ? 0 : W * 0.84, 0, W * 0.16, H);
    ctx.globalAlpha = 1;
  }

  // Edge lines, a little worn.
  const line = (x: number, w: number, colour: string, alpha: number) => {
    ctx.fillStyle = colour;
    ctx.globalAlpha = alpha;
    ctx.fillRect(x * W, 0, w * W, H);
    ctx.globalAlpha = 1;
  };
  line(0.035, 0.016, style.road.edge, 0.92);
  line(0.949, 0.016, style.road.edge, 0.92);
  // Centre dashes.
  if (style.road.dash) {
    ctx.fillStyle = style.road.line;
    ctx.globalAlpha = 0.85;
    ctx.fillRect(0.4915 * W, H * 0.04, 0.017 * W, H * 0.3);
    ctx.globalAlpha = 1;
  }
  // Wear: knock bits out of the paint.
  for (let i = 0; i < 260 * f; i++) {
    const x = rnd() < 0.5 ? 0.035 * W + rnd() * 0.016 * W : 0.949 * W + rnd() * 0.016 * W;
    ctx.fillStyle = style.road.base;
    ctx.globalAlpha = 0.18 + rnd() * 0.3;
    ctx.fillRect(x, rnd() * H, (0.8 + rnd() * 1.6) * f, (1 + rnd() * 3) * f);
  }
  ctx.globalAlpha = 1;
  return finish(new CanvasTexture(c), anisotropy, true);
}

/**
 * A boost pad's skin: chevrons pointing along the road (increasing v) on deep
 * blue, repeating lengthways so the pad can scroll them forward.
 */
export function chevronTexture(anisotropy: number): CanvasTexture {
  const W = 256;
  const H = 256;
  const [c, ctx] = canvas(W, H);
  ctx.fillStyle = "#0b2a7a";
  ctx.fillRect(0, 0, W, H);
  const g = ctx.createLinearGradient(0, 0, W, 0);
  g.addColorStop(0, "rgba(40,190,255,0.0)");
  g.addColorStop(0.5, "rgba(40,190,255,0.28)");
  g.addColorStop(1, "rgba(40,190,255,0.0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // Canvas y grows downward; the texture's v grows upward, so a chevron whose
  // tip is at the TOP of the canvas points along +v, the way the kart drives.
  const chevron = (y: number, colour: string, alpha: number) => {
    ctx.beginPath();
    ctx.moveTo(W * 0.5, y);
    ctx.lineTo(W * 0.92, y + H * 0.2);
    ctx.lineTo(W * 0.92, y + H * 0.34);
    ctx.lineTo(W * 0.5, y + H * 0.14);
    ctx.lineTo(W * 0.08, y + H * 0.34);
    ctx.lineTo(W * 0.08, y + H * 0.2);
    ctx.closePath();
    ctx.fillStyle = colour;
    ctx.globalAlpha = alpha;
    ctx.fill();
    ctx.globalAlpha = 1;
  };
  chevron(H * 0.04, "#7bf0ff", 1);
  chevron(H * 0.54, "#ffffff", 1);
  return finish(new CanvasTexture(c), anisotropy, true);
}

/** A soft white disc fading to nothing: light pools, glows and shadow blobs are this, tinted. */
export function glowTexture(inner = 0.0, falloff = 1.6): CanvasTexture {
  const S = 128;
  const [c, ctx] = canvas(S, S);
  const g = ctx.createRadialGradient(S / 2, S / 2, S * 0.5 * inner, S / 2, S / 2, S / 2);
  const stops = 12;
  for (let i = 0; i <= stops; i++) {
    const t = i / stops;
    g.addColorStop(t, `rgba(255,255,255,${Math.pow(1 - t, falloff).toFixed(3)})`);
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.generateMipmaps = true;
  t.minFilter = LinearMipmapLinearFilter;
  t.needsUpdate = true;
  return t;
}

/** The start gantry's banner: the game's name on a dark ground between two chequered ends. */
export function bannerTexture(anisotropy: number): CanvasTexture {
  const W = 1024;
  const H = 192;
  const [c, ctx] = canvas(W, H);
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#1d1f27");
  g.addColorStop(1, "#0d0f14");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // Chequered ends.
  const cell = H / 4;
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 3; col++) {
      for (const x0 of [col * cell, W - (col + 1) * cell]) {
        ctx.fillStyle = (row + col) % 2 === 0 ? "#fbfbf7" : "#15171d";
        ctx.fillRect(x0, row * cell, cell, cell);
      }
    }
  }
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = '800 112px -apple-system, BlinkMacSystemFont, "SF Pro Display", "Helvetica Neue", system-ui, sans-serif';
  // Letter-spaced by hand: canvas letterSpacing is not everywhere yet.
  const text = "GRIP PRIX";
  const spacing = 10;
  const widths = [...text].map((ch) => ctx.measureText(ch).width + spacing);
  let x = W / 2 - widths.reduce((a, b) => a + b, 0) / 2;
  ctx.textAlign = "left";
  [...text].forEach((ch, i) => {
    ctx.fillText(ch, x, H / 2 + 4);
    x += widths[i]!;
  });
  // A thin accent under the name.
  ctx.fillStyle = "#30d158";
  ctx.fillRect(W * 0.3, H - 22, W * 0.4, 6);
  return finish(new CanvasTexture(c), anisotropy);
}
