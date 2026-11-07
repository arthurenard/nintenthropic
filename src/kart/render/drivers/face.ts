/**
 * A driver's eyelids: one small mesh that closes over both eyes. The eyes
 * themselves are beads modelled into the head (drivers.glb, or the code-built
 * stand-in), so a blink is a lid in the face's own colour that slides down over
 * them and lifts again; a happy driver (a cheer, the finish) keeps it shut and
 * wears the eyes as two upturned arcs, ^ ^, the way a cartoon grins.
 *
 * One mesh per driver, built from a geometry shared by every driver of a
 * species (it depends on nothing but the species), in the kart material: no
 * new shader, and no draw call at all while the eyes are open.
 */
import { BufferGeometry, Mesh, TorusGeometry, type Material } from "three";
import { MeshBuilder, rgb, xf, type Rgb } from "../kartBuilder";
import { SURF } from "../kartMaterial";
import { INK } from "./parts";
import type { Species } from "./types";

/** Where a species' eyes are in the head's space (x is the left eye's), their size and the colours of the skin round them and of the lashes. */
interface Eyes {
  x: number;
  y: number;
  r: number;
  skin: string;
  lash?: Rgb;
  /** The eyes are a slot (a robot's), not a bead: the lid is a flat plate. */
  flat?: boolean;
}

export const EYES: Record<Species, Eyes> = {
  rabbit: { x: 0.115, y: 0.05, r: 0.045, skin: "#f3ede6" },
  penguin: { x: 0.1, y: 0.035, r: 0.043, skin: "#f8f9ff" },
  frog: { x: 0.15, y: 0.168, r: 0.056, skin: "#74c64a" },
  fox: { x: 0.118, y: 0.058, r: 0.043, skin: "#ee7f2d" },
  otter: { x: 0.115, y: 0.055, r: 0.043, skin: "#8a5c3b" },
  cat: { x: 0.115, y: 0.055, r: 0.047, skin: "#ffae42" },
  bear: { x: 0.13, y: 0.065, r: 0.042, skin: "#7b4a2d" },
  duck: { x: 0.125, y: 0.075, r: 0.047, skin: "#ffd83a" },
  robot: { x: 0.1, y: 0.03, r: 0.05, skin: "#0a1020", lash: [0.35, 2.4, 2.6], flat: true },
};

const cache = new Map<string, BufferGeometry>();

/** The front of the head round an eye: the highest z of the head's vertices within `r` of (x, y). */
function frontAt(head: BufferGeometry, x: number, y: number, r: number): number {
  const p = head.getAttribute("position");
  let z = -Infinity;
  for (let i = 0; i < p.count; i++) {
    if (Math.abs(p.getX(i) - x) < r && Math.abs(p.getY(i) - y) < r) z = Math.max(z, p.getZ(i));
  }
  return z;
}

/** The lid geometry for `species` (both lids, and their lashes), about the eyes' mid point (0, eye y, eye z), or null if the head has no eyes there. */
function lidGeometry(species: Species, head: BufferGeometry): { geometry: BufferGeometry; y: number; z: number; reach: number } | null {
  const e = EYES[species];
  const front = frontAt(head, e.x, e.y, e.r * 0.8);
  if (!Number.isFinite(front)) return null;
  // The bead's centre sits a little under the face, its radius out along z being 0.8 of its size.
  const bead = e.flat ? 0.012 : e.r * 0.8;
  const z = front - bead;
  const key = `${species}|${z.toFixed(3)}`;
  const reach = e.r * 1.3;
  let geometry = cache.get(key);
  if (!geometry) {
    const b = new MeshBuilder();
    const skin = rgb(e.skin);
    for (const sx of [-1, 1]) {
      b.as(SURF.fur, () => {
        if (e.flat) b.slab(sx * e.x, 0, 0.0, e.r * 2.2, e.r * 2.6, bead * 2 + 0.012, 0.012, skin);
        else b.blob(sx * e.x, 0, 0, e.r * 1.12, reach, bead + 0.007, skin, 1);
      });
      // The lash: an arc over the closed eye, ^, in the face's ink (a robot's, in light).
      const arc = new TorusGeometry(e.r * 0.72, e.r * 0.11, 5, 12, Math.PI);
      const lash = e.lash ?? INK;
      b.as(e.lash ? SURF.lamp : SURF.cloth, () => b.geometry(arc, xf(sx * e.x, -e.r * 0.3, bead + 0.006 + (e.flat ? 0.008 : 0), 1, 1, 0.5), lash));
      arc.dispose();
    }
    geometry = b.build();
    cache.set(key, geometry);
  }
  return { geometry, y: e.y, z, reach };
}

/** The lids on one driver's head. */
export class Lids {
  readonly mesh: Mesh;
  private readonly y: number;
  private readonly reach: number;
  private next: number;
  private blinkAt = -1;
  private double = false;

  constructor(
    species: Species,
    head: BufferGeometry,
    material: Material,
    /** Drivers blink at their own times: this seeds when. */
    seed: number,
  ) {
    const made = lidGeometry(species, head);
    if (!made) throw new Error("no eyes");
    this.mesh = new Mesh(made.geometry, material);
    this.mesh.position.set(0, made.y, made.z);
    this.mesh.visible = false;
    this.y = made.y;
    this.reach = made.reach;
    this.next = 0.6 + (seed % 7) * 0.37;
  }

  /**
   * Sets how shut the eyes are at `time`: a blink every few seconds (now and
   * then two), half shut and heavy when dizzy, shut while happy.
   */
  update(time: number, happy: number, dizzy: number, shut = 0): void {
    // The blink: a lid that comes down quickly and goes up a little slower.
    if (this.blinkAt < 0 && time >= this.next) {
      this.blinkAt = time;
      this.double = Math.sin(time * 12.9898) > 0.55;
    }
    let blink = 0;
    if (this.blinkAt >= 0) {
      const u = (time - this.blinkAt) / 0.2;
      if (u >= 1) {
        if (this.double) {
          this.double = false;
          this.blinkAt = time;
        } else {
          this.blinkAt = -1;
          this.next = time + 2.2 + (Math.sin(time * 78.233) * 0.5 + 0.5) * 3.2;
        }
      } else {
        blink = Math.sin(u * Math.PI) ** 0.7;
      }
    }
    if (time < this.next - 6) this.next = time + 1;
    const closed = Math.min(1, Math.max(blink, happy, dizzy * 0.5, shut));
    const show = closed > 0.04;
    this.mesh.visible = show;
    if (show) {
      // Anchored at the top of the eye, the lid slides down it as it grows.
      this.mesh.scale.y = closed;
      this.mesh.position.y = this.y + this.reach * (1 - closed);
    }
  }
}
