/**
 * The minimap: the track's outline and a dot per kart in its colour. A kart a
 * player on this screen is driving has a larger dot with a white ring and
 * their place in it; the leader wears a small gold crown. Drawn on a small 2D
 * canvas every frame (a few hundred line segments and eight dots: far cheaper
 * than anything the 3D view does).
 *
 * North is +z, drawn up the screen, with +x to the left: that is the world as
 * seen from above, so a left turn on the road is a left turn on the map.
 */
import type { KartView, RacerSetup } from "../contract";
import type { TrackGeometry } from "../track/geometry";

const GOLD = "#ffd60a";

/** Whether black reads better than white on this "#RRGGBB". */
export function darkText(hex: string): boolean {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return false;
  const n = parseInt(m[1]!, 16);
  const luma = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return luma > 0.6;
}

/** A small gold crown standing on (x, y). */
function crown(ctx: CanvasRenderingContext2D, x: number, y: number, u: number): void {
  ctx.beginPath();
  ctx.moveTo(x - 6.5 * u, y);
  ctx.lineTo(x - 7 * u, y - 7.5 * u);
  ctx.lineTo(x - 3.2 * u, y - 4 * u);
  ctx.lineTo(x, y - 9 * u);
  ctx.lineTo(x + 3.2 * u, y - 4 * u);
  ctx.lineTo(x + 7 * u, y - 7.5 * u);
  ctx.lineTo(x + 6.5 * u, y);
  ctx.closePath();
  ctx.fillStyle = GOLD;
  ctx.fill();
  ctx.lineJoin = "round";
  ctx.lineWidth = 1.3 * u;
  ctx.strokeStyle = "rgba(0,0,0,0.7)";
  ctx.stroke();
}

export class Minimap {
  private points: [number, number][] = [];
  private cx = 0;
  private cz = 0;
  private bw = 1;
  private bh = 1;
  private start: [number, number, number, number] = [0, 0, 0, 1];
  /** Width over height of the outline's bounds: what the canvas should be shaped like. */
  aspect = 1;

  setTrack(track: TrackGeometry): void {
    const step = Math.max(1, Math.round(4 / track.spacing));
    this.points = [];
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < track.samples.length; i += step) {
      const s = track.samples[i]!;
      this.points.push([s.x, s.z]);
      minX = Math.min(minX, s.x);
      maxX = Math.max(maxX, s.x);
      minZ = Math.min(minZ, s.z);
      maxZ = Math.max(maxZ, s.z);
    }
    this.cx = (minX + maxX) / 2;
    this.cz = (minZ + maxZ) / 2;
    this.bw = Math.max(1, maxX - minX);
    this.bh = Math.max(1, maxZ - minZ);
    this.aspect = this.bw / this.bh;
    const s0 = track.at(0);
    this.start = [s0.x, s0.z, s0.tx, s0.tz];
  }

  /** World (x, z) to canvas pixels for a canvas of `w` x `h`. */
  private project(x: number, z: number, w: number, h: number, pad: number): [number, number] {
    const scale = Math.min((w - pad * 2) / this.bw, (h - pad * 2) / this.bh);
    return [w / 2 - (x - this.cx) * scale, h / 2 - (z - this.cz) * scale];
  }

  /**
   * Draws into `canvas`, whose CSS size is `w` x `h`. `ui` is the HUD's scale,
   * so lines and dots grow with the view.
   */
  draw(canvas: HTMLCanvasElement, w: number, h: number, dpr: number, ui: number, karts: readonly KartView[], racers: readonly RacerSetup[], local: ReadonlySet<number>): void {
    const bw = Math.max(1, Math.round(w * dpr));
    const bh = Math.max(1, Math.round(h * dpr));
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx || this.points.length === 0) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const pad = 18 * ui;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    const trace = () => {
      ctx.beginPath();
      this.points.forEach((p, i) => {
        const [x, y] = this.project(p[0], p[1], w, h, pad);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
    };
    trace();
    ctx.strokeStyle = "rgba(0,0,0,0.55)";
    ctx.lineWidth = 9 * ui;
    ctx.stroke();
    trace();
    ctx.strokeStyle = "rgba(255,255,255,0.88)";
    ctx.lineWidth = 5 * ui;
    ctx.stroke();

    // The start line.
    const [sx, sy] = this.project(this.start[0], this.start[1], w, h, pad);
    const tx = -this.start[2];
    const tz = -this.start[3];
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 2 * ui;
    ctx.beginPath();
    ctx.moveTo(sx - tz * 6 * ui, sy - tx * 6 * ui);
    ctx.lineTo(sx + tz * 6 * ui, sy + tx * 6 * ui);
    ctx.stroke();

    const leader = karts.find((k) => k.place === 1)?.id ?? -1;
    const dot = (k: KartView, isLocal: boolean) => {
      const [x, y] = this.project(k.x, k.z, w, h, pad);
      const colour = racers.find((r) => r.id === k.id)?.colour ?? "#ffffff";
      const r = (isLocal ? 7.6 : 4.8) * ui;
      let top = r;
      if (isLocal || k.id === leader) {
        // A player's dot wears a white ring; a leader nobody here is driving, a gold one.
        top = r + 2.6 * ui;
        ctx.beginPath();
        ctx.arc(x, y, top, 0, Math.PI * 2);
        ctx.strokeStyle = isLocal ? "#ffffff" : GOLD;
        ctx.lineWidth = 2.2 * ui;
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = colour;
      ctx.fill();
      ctx.lineWidth = 1.4 * ui;
      ctx.strokeStyle = "rgba(0,0,0,0.6)";
      ctx.stroke();
      if (isLocal) {
        // Their place, in the dot.
        ctx.font = `800 ${(r * 1.3).toFixed(1)}px -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = darkText(colour) ? "#111" : "#fff";
        ctx.fillText(String(k.place), x, y + r * 0.06);
      }
      return { x, y, top };
    };
    const crowns: { x: number; y: number; top: number }[] = [];
    for (const k of karts) if (!local.has(k.id)) {
      const d = dot(k, false);
      if (k.id === leader) crowns.push(d);
    }
    // Best place on top of the others: a leading player's number must stay readable.
    const mine = karts.filter((k) => local.has(k.id)).sort((a, b) => b.place - a.place);
    for (const k of mine) {
      const d = dot(k, true);
      if (k.id === leader) crowns.push(d);
    }
    for (const c of crowns) crown(ctx, c.x, c.y - c.top - 1.5 * ui, ui);
  }
}
