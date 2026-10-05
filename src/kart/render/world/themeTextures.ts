/**
 * The painted details that make each world's surfaces read: the walnut
 * grain of the kitchen's road, glowing cracks in the volcano's basalt, a
 * glass lattice for the space ribbon; the marble of the counter, the
 * cobbles of the fairground, the sand's ripples; and the patches that
 * change how the road drives (ice, mud, sand, snow).
 *
 * All drawn on a canvas at load, tileable, in greys where the ground's own
 * vertex colour does the tinting. Drawn, not downloaded, like every Handy
 * asset until art exists.
 */
import { CanvasTexture, ClampToEdgeWrapping, LinearFilter, LinearMipmapLinearFilter, RepeatWrapping, SRGBColorSpace } from "three";
import { seededRandom } from "../../../engine/random";
import type { Surface } from "../../track/geometry";
import type { ThemeStyle } from "./themes";

type Ctx = CanvasRenderingContext2D;

function canvas(w: number, h: number): [HTMLCanvasElement, Ctx] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("2D canvas unavailable");
  return [c, ctx];
}

function finish(c: HTMLCanvasElement, anisotropy: number, repeat: boolean): CanvasTexture {
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = anisotropy;
  t.wrapS = repeat ? RepeatWrapping : ClampToEdgeWrapping;
  t.wrapT = repeat ? RepeatWrapping : ClampToEdgeWrapping;
  t.minFilter = LinearMipmapLinearFilter;
  t.magFilter = LinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

/** Draws `draw` at the nine offsets round a tile, so whatever crosses an edge wraps and the texture tiles. */
function wrapped(ctx: Ctx, W: number, H: number, draw: (dx: number, dy: number) => void): void {
  for (const dx of [-W, 0, W]) for (const dy of [-H, 0, H]) draw(dx, dy);
}

// ─── The road ────────────────────────────────────────────────────────────────

/**
 * Extra paint on the road, in two stages: "under" (after the asphalt's
 * blotches, before the paint lines) and "over" (everything last: cracks,
 * confetti, snow).
 */
export function paintRoadTheme(ctx: Ctx, style: ThemeStyle, W: number, H: number, f: number, rnd: () => number, stage: "under" | "over"): void {
  switch (style.id) {
    case "kitchen": {
      if (stage !== "under") return;
      // Walnut: long streaks along the board and the odd cathedral of figured grain.
      for (let i = 0; i < 170 * f; i++) {
        const x = rnd() * W;
        const w = (0.6 + rnd() * 2.2) * f;
        ctx.fillStyle = rnd() > 0.5 ? "rgba(255,206,150,0.13)" : "rgba(20,8,2,0.2)";
        ctx.fillRect(x, 0, w, H);
      }
      for (let i = 0; i < 14; i++) {
        const x = rnd() * W;
        const y = rnd() * H;
        const rx = (5 + rnd() * 12) * f;
        const ry = (70 + rnd() * 200) * f;
        wrapped(ctx, W, H, (dx, dy) => {
          for (let k = 0; k < 5; k++) {
            ctx.strokeStyle = `rgba(20,8,2,${0.16 - k * 0.025})`;
            ctx.lineWidth = (1.4 + k * 0.5) * f;
            ctx.beginPath();
            ctx.ellipse(x + dx, y + dy, rx * (0.45 + k * 0.2), ry * (0.45 + k * 0.2), 0, 0, Math.PI * 2);
            ctx.stroke();
          }
        });
      }
      return;
    }
    case "snow": {
      if (stage !== "over") return;
      // Windblown snow lying in patches, thicker toward the edges.
      for (let i = 0; i < 90 * f; i++) {
        const edge = rnd() < 0.7;
        const x = edge ? (rnd() < 0.5 ? rnd() * 0.18 : 0.82 + rnd() * 0.18) * W : rnd() * W;
        const y = rnd() * H;
        const r = (4 + rnd() * 16) * f;
        wrapped(ctx, W, H, (dx, dy) => {
          const g = ctx.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
          g.addColorStop(0, "rgba(246,250,255,0.55)");
          g.addColorStop(1, "rgba(246,250,255,0)");
          ctx.fillStyle = g;
          ctx.fillRect(x + dx - r, y + dy - r, r * 2, r * 2);
        });
      }
      return;
    }
    case "volcano": {
      if (stage !== "over") return;
      // Hairline cracks, dark in the paint (the glow is the emissive map's).
      const cracks = crackPaths(rnd, W, H, 9, f);
      ctx.strokeStyle = "rgba(0,0,0,0.5)";
      ctx.lineWidth = 2.2 * f;
      wrapped(ctx, W, H, (dx, dy) => strokePaths(ctx, cracks, dx, dy));
      return;
    }
    case "funfair": {
      if (stage !== "over") return;
      // Confetti and trodden straw from a thousand visitors.
      const palette = ["#ff4d8d", "#ffd84d", "#4dd2ff", "#8dff7a", "#ffffff", "#ff9a3c"];
      for (let i = 0; i < 160 * f; i++) {
        ctx.fillStyle = palette[Math.floor(rnd() * palette.length)]!;
        ctx.globalAlpha = 0.35 + rnd() * 0.45;
        const s = (1.5 + rnd() * 3) * f;
        const x = rnd() * W;
        const y = rnd() * H;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(rnd() * 3.14);
        ctx.fillRect(-s, -s / 2, s * 2, s);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
      return;
    }
    case "palm": {
      if (stage !== "over") return;
      // Blown sand across the tarmac, and a few shells.
      for (let i = 0; i < 80 * f; i++) {
        const x = rnd() * W;
        const y = rnd() * H;
        const r = (6 + rnd() * 22) * f;
        wrapped(ctx, W, H, (dx, dy) => {
          const g = ctx.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
          g.addColorStop(0, "rgba(236,214,160,0.4)");
          g.addColorStop(1, "rgba(236,214,160,0)");
          ctx.fillStyle = g;
          ctx.fillRect(x + dx - r, y + dy - r, r * 2, r * 2);
        });
      }
      return;
    }
    case "space": {
      if (stage !== "under") return;
      // Deep glass with a faint depth of light in it.
      const g = ctx.createLinearGradient(0, 0, W, 0);
      g.addColorStop(0, "rgba(40,120,220,0.18)");
      g.addColorStop(0.5, "rgba(10,40,120,0.0)");
      g.addColorStop(1, "rgba(40,120,220,0.18)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      return;
    }
    default:
      return;
  }
}

/** Jagged polylines for cracks, in tile coordinates. */
function crackPaths(rnd: () => number, W: number, H: number, count: number, f: number): [number, number][][] {
  const paths: [number, number][][] = [];
  for (let i = 0; i < count; i++) {
    let x = rnd() * W;
    let y = rnd() * H;
    let a = rnd() * Math.PI * 2;
    const pts: [number, number][] = [[x, y]];
    const steps = 4 + Math.floor(rnd() * 7);
    for (let k = 0; k < steps; k++) {
      a += (rnd() - 0.5) * 1.5;
      const l = (18 + rnd() * 46) * f;
      x += Math.cos(a) * l;
      y += Math.sin(a) * l;
      pts.push([x, y]);
    }
    paths.push(pts);
  }
  return paths;
}

function strokePaths(ctx: Ctx, paths: [number, number][][], dx: number, dy: number): void {
  for (const p of paths) {
    ctx.beginPath();
    p.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x + dx, y + dy) : ctx.lineTo(x + dx, y + dy)));
    ctx.stroke();
  }
}

/**
 * The road's emissive map: lines of light on a black ground, for the worlds
 * whose road glows (the volcano's cracks, the space ribbon's lattice and
 * edge lines). Null for the others.
 */
export function roadGlowTexture(style: ThemeStyle, anisotropy: number, size: number): CanvasTexture | null {
  if (style.id !== "volcano" && style.id !== "space") return null;
  const W = size;
  const H = size;
  const f = size / 512;
  const [c, ctx] = canvas(W, H);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  const rnd = seededRandom(23);
  if (style.id === "volcano") {
    const paths = crackPaths(rnd, W, H, 9, f);
    wrapped(ctx, W, H, (dx, dy) => {
      ctx.strokeStyle = "rgba(255,90,10,0.4)";
      ctx.lineWidth = 5 * f;
      strokePaths(ctx, paths, dx, dy);
      ctx.strokeStyle = "rgba(255,190,70,0.8)";
      ctx.lineWidth = 1.6 * f;
      strokePaths(ctx, paths, dx, dy);
    });
  } else {
    // A lattice of light: lines along the road every eighth of its width, cross lines every 1.5 m, a bright centre dash.
    ctx.strokeStyle = "rgba(60,200,255,0.5)";
    ctx.lineWidth = 1.4 * f;
    for (let k = 1; k < 8; k++) {
      ctx.beginPath();
      ctx.moveTo((k / 8) * W, 0);
      ctx.lineTo((k / 8) * W, H);
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(60,200,255,0.34)";
    for (let k = 0; k < 8; k++) {
      const y = (k / 8) * H;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }
    // Chevrons pointing the way (the road is along v: the tip toward the top of the canvas is +v).
    ctx.strokeStyle = "rgba(120,240,255,0.5)";
    ctx.lineWidth = 3 * f;
    for (const cx of [0.25, 0.75]) {
      ctx.beginPath();
      ctx.moveTo((cx - 0.07) * W, H * 0.62);
      ctx.lineTo(cx * W, H * 0.5);
      ctx.lineTo((cx + 0.07) * W, H * 0.62);
      ctx.stroke();
    }
    // Edge lines and the centre dashes, bright.
    ctx.fillStyle = "rgba(150,250,255,1)";
    ctx.fillRect(0.035 * W, 0, 0.016 * W, H);
    ctx.fillRect(0.949 * W, 0, 0.016 * W, H);
    ctx.fillStyle = "rgba(150,250,255,0.85)";
    ctx.fillRect(0.4915 * W, H * 0.04, 0.017 * W, H * 0.3);
  }
  return finish(c, anisotropy, true);
}

// ─── The ground ──────────────────────────────────────────────────────────────

export interface GroundDetail {
  map: CanvasTexture;
  /** An emissive map for ground that glows (cracks), or null. */
  glow: CanvasTexture | null;
  /** Metres one repeat covers. */
  metres: number;
}

/** A theme's ground detail: greys that multiply the vertex colours. Null where the plain vertex colours are enough. */
export function groundDetail(style: ThemeStyle, anisotropy: number, size = 512): GroundDetail | null {
  const W = size;
  const f = size / 512;
  const rnd = seededRandom(41);
  switch (style.id) {
    case "kitchen": {
      const [c, ctx] = canvas(W, W);
      ctx.fillStyle = "#f4f4f4";
      ctx.fillRect(0, 0, W, W);
      // Soft clouds in the stone.
      for (let i = 0; i < 40; i++) {
        const x = rnd() * W;
        const y = rnd() * W;
        const r = (30 + rnd() * 90) * f;
        wrapped(ctx, W, W, (dx, dy) => {
          const g = ctx.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
          g.addColorStop(0, rnd() > 0.5 ? "rgba(255,255,255,0.35)" : "rgba(150,160,175,0.16)");
          g.addColorStop(1, "rgba(255,255,255,0)");
          ctx.fillStyle = g;
          ctx.fillRect(x + dx - r, y + dy - r, r * 2, r * 2);
        });
      }
      // Veins: long wandering lines, a wide faint stroke under a thin dark one.
      for (let i = 0; i < 9; i++) {
        let x = rnd() * W;
        let y = rnd() * W;
        let a = rnd() * Math.PI * 2;
        const pts: [number, number][] = [[x, y]];
        for (let k = 0; k < 22; k++) {
          a += (rnd() - 0.5) * 0.9;
          x += Math.cos(a) * 26 * f;
          y += Math.sin(a) * 26 * f;
          pts.push([x, y]);
        }
        wrapped(ctx, W, W, (dx, dy) => {
          ctx.strokeStyle = "rgba(120,135,165,0.13)";
          ctx.lineWidth = 8 * f;
          strokePaths(ctx, [pts], dx, dy);
          ctx.strokeStyle = "rgba(85,100,135,0.5)";
          ctx.lineWidth = 1.6 * f;
          strokePaths(ctx, [pts], dx, dy);
        });
      }
      return { map: finish(c, anisotropy, true), glow: null, metres: 110 };
    }
    case "snow": {
      const [c, ctx] = canvas(W, W);
      ctx.fillStyle = "#fbfbfb";
      ctx.fillRect(0, 0, W, W);
      // Wind-sculpted ripples and a scatter of glinting crystals.
      for (let i = 0; i < 60; i++) {
        const y = rnd() * W;
        const x = rnd() * W;
        const len = (60 + rnd() * 160) * f;
        wrapped(ctx, W, W, (dx, dy) => {
          ctx.strokeStyle = "rgba(190,205,232,0.22)";
          ctx.lineWidth = (1.5 + rnd() * 3) * f;
          ctx.beginPath();
          ctx.moveTo(x + dx, y + dy);
          ctx.quadraticCurveTo(x + len / 2 + dx, y + dy + (rnd() - 0.5) * 30 * f, x + len + dx, y + dy + (rnd() - 0.5) * 10 * f);
          ctx.stroke();
        });
      }
      for (let i = 0; i < 700 * f * f; i++) {
        ctx.fillStyle = rnd() > 0.5 ? "rgba(255,255,255,0.9)" : "rgba(170,190,225,0.35)";
        const s = (0.8 + rnd() * 1.4) * f;
        ctx.fillRect(rnd() * W, rnd() * W, s, s);
      }
      return { map: finish(c, anisotropy, true), glow: null, metres: 52 };
    }
    case "volcano": {
      const [c, ctx] = canvas(W, W);
      ctx.fillStyle = "#c9c9c9";
      ctx.fillRect(0, 0, W, W);
      for (let i = 0; i < 70; i++) {
        const x = rnd() * W;
        const y = rnd() * W;
        const r = (20 + rnd() * 70) * f;
        wrapped(ctx, W, W, (dx, dy) => {
          const g = ctx.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
          g.addColorStop(0, rnd() > 0.5 ? "rgba(255,255,255,0.22)" : "rgba(0,0,0,0.22)");
          g.addColorStop(1, "rgba(0,0,0,0)");
          ctx.fillStyle = g;
          ctx.fillRect(x + dx - r, y + dy - r, r * 2, r * 2);
        });
      }
      const paths = crackPaths(rnd, W, W, 7, f * 3.4);
      wrapped(ctx, W, W, (dx, dy) => {
        ctx.strokeStyle = "rgba(0,0,0,0.75)";
        ctx.lineWidth = 4 * f;
        strokePaths(ctx, paths, dx, dy);
      });
      const [g, gx] = canvas(W, W);
      gx.fillStyle = "#000";
      gx.fillRect(0, 0, W, W);
      wrapped(gx, W, W, (dx, dy) => {
        gx.strokeStyle = "rgba(255,80,10,0.3)";
        gx.lineWidth = 7 * f;
        strokePaths(gx, paths, dx, dy);
        gx.strokeStyle = "rgba(255,170,50,0.75)";
        gx.lineWidth = 2.2 * f;
        strokePaths(gx, paths, dx, dy);
      });
      return { map: finish(c, anisotropy, true), glow: finish(g, anisotropy, true), metres: 80 };
    }
    case "funfair": {
      const [c, ctx] = canvas(W, W);
      ctx.fillStyle = "#555";
      ctx.fillRect(0, 0, W, W);
      // Cobbles in staggered rows.
      const rows = 16;
      const rowH = W / rows;
      for (let r = 0; r < rows; r++) {
        const cols = 12;
        const colW = W / cols;
        for (let k = 0; k < cols; k++) {
          const x = k * colW + (r % 2 ? colW / 2 : 0) + 1.5 * f;
          const y = r * rowH + 1.5 * f;
          const shade = 150 + Math.floor(rnd() * 95);
          ctx.fillStyle = `rgb(${shade},${shade},${shade})`;
          ctx.beginPath();
          ctx.roundRect(x, y, colW - 3 * f, rowH - 3 * f, 5 * f);
          ctx.fill();
          if (x + colW > W) {
            ctx.beginPath();
            ctx.roundRect(x - W, y, colW - 3 * f, rowH - 3 * f, 5 * f);
            ctx.fill();
          }
        }
      }
      return { map: finish(c, anisotropy, true), glow: null, metres: 26 };
    }
    case "palm": {
      const [c, ctx] = canvas(W, W);
      ctx.fillStyle = "#f6f6f6";
      ctx.fillRect(0, 0, W, W);
      // Wind ripples: long shallow wavy lines.
      for (let i = 0; i < 38; i++) {
        const y0 = (i / 38) * W;
        wrapped(ctx, W, W, (dx, dy) => {
          ctx.strokeStyle = "rgba(205,180,130,0.3)";
          ctx.lineWidth = 3.2 * f;
          ctx.beginPath();
          for (let x = 0; x <= W; x += 16) {
            const y = y0 + Math.sin((x / W) * Math.PI * 4 + i) * 6 * f + Math.sin((x / W) * Math.PI * 10 + i * 2) * 2 * f;
            if (x === 0) ctx.moveTo(x + dx, y + dy);
            else ctx.lineTo(x + dx, y + dy);
          }
          ctx.stroke();
        });
      }
      for (let i = 0; i < 1200 * f * f; i++) {
        ctx.fillStyle = rnd() > 0.5 ? "rgba(255,255,255,0.7)" : "rgba(180,150,100,0.3)";
        const s = (0.8 + rnd() * 1.2) * f;
        ctx.fillRect(rnd() * W, rnd() * W, s, s);
      }
      return { map: finish(c, anisotropy, true), glow: null, metres: 44 };
    }
    default:
      return null;
  }
}

// ─── Patches on the road ─────────────────────────────────────────────────────

/** The skin of a patch that changes how the road drives: pattern in the pixels, colour in the vertices. */
export function surfaceTexture(kind: Surface, anisotropy: number): CanvasTexture {
  const S = 256;
  const [c, ctx] = canvas(S, S);
  const rnd = seededRandom(kind.length * 977 + kind.charCodeAt(0));
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, S, S);
  switch (kind) {
    case "ice": {
      // Hairline cracks and long glassy streaks.
      for (let i = 0; i < 26; i++) {
        const y = rnd() * S;
        ctx.strokeStyle = `rgba(150,200,255,${0.1 + rnd() * 0.18})`;
        ctx.lineWidth = 1 + rnd() * 4;
        ctx.beginPath();
        ctx.moveTo(rnd() * S, y);
        ctx.lineTo(rnd() * S, y + (rnd() - 0.5) * 90);
        ctx.stroke();
      }
      const paths = crackPaths(rnd, S, S, 12, 0.5);
      ctx.strokeStyle = "rgba(255,255,255,0.7)";
      ctx.lineWidth = 1.2;
      wrapped(ctx, S, S, (dx, dy) => strokePaths(ctx, paths, dx, dy));
      break;
    }
    case "mud": {
      for (let i = 0; i < 70; i++) {
        const x = rnd() * S;
        const y = rnd() * S;
        const r = 6 + rnd() * 28;
        wrapped(ctx, S, S, (dx, dy) => {
          const g = ctx.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
          g.addColorStop(0, rnd() > 0.45 ? "rgba(255,255,255,0.35)" : "rgba(30,15,5,0.4)");
          g.addColorStop(1, "rgba(0,0,0,0)");
          ctx.fillStyle = g;
          ctx.fillRect(x + dx - r, y + dy - r, r * 2, r * 2);
        });
      }
      // Wheel ruts.
      for (const x of [0.3, 0.7]) {
        const g = ctx.createLinearGradient((x - 0.09) * S, 0, (x + 0.09) * S, 0);
        g.addColorStop(0, "rgba(0,0,0,0)");
        g.addColorStop(0.5, "rgba(20,10,0,0.4)");
        g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = g;
        ctx.fillRect((x - 0.09) * S, 0, 0.18 * S, S);
      }
      break;
    }
    case "sand":
    case "grass": {
      for (let i = 0; i < 18; i++) {
        const y0 = (i / 18) * S;
        ctx.strokeStyle = kind === "sand" ? "rgba(170,130,70,0.28)" : "rgba(30,90,20,0.2)";
        ctx.lineWidth = 3;
        ctx.beginPath();
        for (let x = 0; x <= S; x += 8) {
          const y = y0 + Math.sin((x / S) * Math.PI * 4 + i) * 4;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      for (let i = 0; i < 900; i++) {
        ctx.fillStyle = rnd() > 0.5 ? "rgba(255,255,255,0.35)" : "rgba(100,70,30,0.25)";
        ctx.fillRect(rnd() * S, rnd() * S, 1.5, 1.5);
      }
      break;
    }
    case "snow": {
      for (let i = 0; i < 50; i++) {
        const x = rnd() * S;
        const y = rnd() * S;
        const r = 8 + rnd() * 26;
        wrapped(ctx, S, S, (dx, dy) => {
          const g = ctx.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
          g.addColorStop(0, "rgba(255,255,255,0.5)");
          g.addColorStop(1, "rgba(255,255,255,0)");
          ctx.fillStyle = g;
          ctx.fillRect(x + dx - r, y + dy - r, r * 2, r * 2);
        });
      }
      for (let i = 0; i < 500; i++) {
        ctx.fillStyle = "rgba(150,175,215,0.35)";
        ctx.fillRect(rnd() * S, rnd() * S, 1.5, 1.5);
      }
      break;
    }
    default:
      break;
  }
  return finish(c, anisotropy, true);
}
