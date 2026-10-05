/**
 * The minimap: the track's outline, a dot per kart in its colour, and a ring
 * round each kart a player on this screen is driving. Drawn on a small 2D
 * canvas every frame (a few hundred line segments and eight dots: far cheaper
 * than anything the 3D view does).
 *
 * North is +z, drawn up the screen, with +x to the left: that is the world as
 * seen from above, so a left turn on the road is a left turn on the map.
 */
import type { KartView, RacerSetup } from "../contract";
import type { TrackGeometry } from "../track/geometry";

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
    const pad = 10 * ui;
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

    const draw = (k: KartView, isLocal: boolean) => {
      const [x, y] = this.project(k.x, k.z, w, h, pad);
      const racer = racers.find((r) => r.id === k.id);
      const colour = racer?.colour ?? "#fff";
      const r = (isLocal ? 5.6 : 4.2) * ui;
      if (isLocal) {
        ctx.beginPath();
        ctx.arc(x, y, r + 3 * ui, 0, Math.PI * 2);
        ctx.strokeStyle = "#fff";
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
    };
    for (const k of karts) if (!local.has(k.id)) draw(k, false);
    for (const k of karts) if (local.has(k.id)) draw(k, true);
  }
}
