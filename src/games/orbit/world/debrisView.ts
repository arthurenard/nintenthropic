/**
 * The debris as the player sees it: each fragment the rules send, drawn
 * where its arc and its tumble say, from the art's variant of its kind -
 * faceted metal that flashes when a facet catches the sun, solar cells
 * that flash blue face-on, gold foil that tears away, pre-fractured pieces
 * that come apart from exactly where they sat in the whole - and the
 * Derelict, turning end over end, venting from its tank when it is hit and
 * coming apart into its pieces.
 */
import { Group, Mesh, Object3D, Quaternion, Vector3, type Material } from "three";
import { contractName } from "../../../engine/world/names";
import { disposablesUnder, type Disposable } from "../../../engine/world/scene";
import type { Fragment } from "../rules/debris";
import type { Effects } from "./effects";
import type { DerelictParts, Library, Variant } from "./library";

interface View {
  f: Fragment;
  root: Object3D;
  /** Its turn at angle 0: the art's facing brought round to the rules'. */
  base: Quaternion;
  /** Where it is drawn off its path, fading to nothing (a piece leaving the whole). */
  offset: Vector3;
  size: number;
  wrap: Object3D | null;
  /** A few facet normals in its own frame, for the sun's flashes. */
  facets: Vector3[];
  key: string;
  /** The Derelict's: its tank vents after a hit until this time. */
  plumeUntil: number;
  lastGlint: number;
}

interface Drifter {
  obj: Object3D;
  vel: Vector3;
  axis: Vector3;
  spin: number;
  life: number;
}

const tmp = new Vector3();
const tmp2 = new Vector3();
const toEye = new Vector3();
const q = new Quaternion();
const q2 = new Quaternion();
const Z = new Vector3(0, 0, 1);
/** How much larger than life each kind is drawn, 90 m out (none 15 m out): the Derelict least. */
const FAR_BOOST: Record<string, number> = { shrapnel: 2.2, chunk: 1.8, foil: 1.8, shard: 1.4, slab: 1.2, derelict: 0.6 };

export class DebrisView {
  readonly group = new Group();
  private readonly views = new Map<number, View>();
  private readonly pool = new Map<string, Object3D[]>();
  private readonly drifters: Drifter[] = [];
  private time = 0;
  /** Toward the sun, and how much of it reaches here (0 at night). */
  readonly sun = new Vector3(0, 1, 0);
  sunlight = 1;

  constructor(
    parent: Object3D,
    private readonly library: Library,
    private readonly derelict: DerelictParts,
    private readonly effects: Effects,
    private readonly eye: Vector3,
    private readonly random: () => number,
  ) {
    this.group.name = "orbit.debris";
    parent.add(this.group);
  }

  private variantFor(f: Fragment): { source: Object3D; size: number; key: string; wrap: boolean } | null {
    if (f.kind === "derelict") return { source: this.derelict.root, size: this.derelict.size, key: "derelict", wrap: false };
    // A piece of something pre-fractured: that piece of that whole.
    const parent = f.parent ? this.views.get(f.parent.id) : undefined;
    if (f.parent && f.parent.kind === "derelict") {
      const piece = this.derelict.pieces[f.variant % Math.max(1, this.derelict.pieces.length)];
      if (piece) return { source: piece, size: this.derelict.size * 0.35, key: `derelict.piece.${f.variant}`, wrap: false };
    }
    if (f.parent && parent && parent.f.parent === null) {
      const whole = this.variantOf(parent.f);
      const piece = whole?.pieces[f.variant];
      if (whole && piece) return { source: piece, size: whole.size / Math.sqrt(Math.max(2, whole.pieces.length)), key: `${whole.name}.piece.${f.variant}`, wrap: false };
    }
    const list = this.library[f.kind];
    if (list.length === 0) return null;
    const v = f.parent ? (list[(f.id * 7) % list.length] as Variant) : (list[f.variant % list.length] as Variant);
    return { source: v.whole, size: v.size * (f.parent ? 0.7 : 1), key: v.name, wrap: f.kind === "foil" };
  }

  private variantOf(f: Fragment): Variant | null {
    if (f.kind === "derelict") return null;
    const list = this.library[f.kind];
    return list.length ? (list[f.variant % list.length] as Variant) : null;
  }

  private take(key: string, source: Object3D): Object3D {
    const free = this.pool.get(key);
    const obj = free?.pop() ?? source.clone(true);
    obj.visible = true;
    obj.traverse((o) => (o.visible = true));
    return obj;
  }

  private give(v: View): void {
    v.root.visible = false;
    v.root.removeFromParent();
    const list = this.pool.get(v.key) ?? [];
    list.push(v.root);
    this.pool.set(v.key, list);
  }

  /** A fragment has come: draw it. */
  add(f: Fragment, t: number): void {
    const variant = this.variantFor(f);
    if (!variant) return;
    const root = this.take(variant.key, variant.source);
    this.group.add(root);
    const face0 = f.face(f.born);
    const base = new Quaternion();
    const offset = new Vector3();
    const parent = f.parent ? this.views.get(f.parent.id) : undefined;
    if (parent && (variant.key.includes(".piece.") || f.parent?.kind === "derelict")) {
      // Where the piece sat in the whole, as the whole was turned when it split.
      const parentQ = this.orientation(parent, t, new Quaternion());
      const localQ = variant.source.quaternion;
      const turned = parentQ.clone().multiply(localQ);
      const now = q2.setFromAxisAngle(f.tumble.axis as unknown as Vector3, f.angle(t)).invert();
      base.copy(now).multiply(turned);
      const assembled = parent.root.position.clone().add(tmp.copy(variant.source.position).multiplyScalar(parent.root.scale.x).applyQuaternion(parentQ));
      offset.copy(assembled).sub(f.position(t, tmp2) as Vector3);
    } else {
      const local = f.kind === "derelict" ? this.derelict.tankDir : Z;
      base.setFromUnitVectors(local, new Vector3(face0.x, face0.y, face0.z));
    }
    const facets: Vector3[] = [];
    for (let i = 0; i < 3; i++) facets.push(new Vector3(this.random() - 0.5, this.random() - 0.5, this.random() - 0.5).normalize());
    const wrap = variant.wrap ? findNodeIn(root, /\.wrap$/) : null;
    const view: View = { f, root, base, offset, size: variant.size, wrap, facets, key: variant.key, plumeUntil: -1, lastGlint: -1 };
    this.views.set(f.id, view);
    if (f.kind === "derelict") {
      for (const name of ["derelict.body", "tank"]) {
        const n = findNodeIn(root, new RegExp(`^${name.replace(".", "\\.")}$`));
        if (n) n.visible = true;
      }
    }
    this.place(view, t, 0);
  }

  private orientation(v: View, t: number, out: Quaternion): Quaternion {
    const axis = v.f.tumble.axis;
    return out.setFromAxisAngle(tmp2.set(axis.x, axis.y, axis.z), v.f.angle(t)).multiply(v.base);
  }

  private place(v: View, t: number, dt: number): void {
    const p = v.f.position(t, tmp);
    v.offset.multiplyScalar(Math.exp(-dt / 0.3));
    v.root.position.set(p.x + v.offset.x, p.y + v.offset.y, p.z + v.offset.z);
    this.orientation(v, t, v.root.quaternion);
    // Far out, larger than life, so it reads as more than a speck (the
    // smaller the kind, the more); life size near the glass.
    const d = v.root.position.distanceTo(this.eye);
    const boost = 1 + (FAR_BOOST[v.f.kind] ?? 1.5) * Math.min(1, Math.max(0, (d - 15) / 75));
    v.root.scale.setScalar(boost);
  }

  /** How big it is (metres) and where, for the shots and the rings. */
  bounds(id: number): { center: Vector3; radius: number } | null {
    const v = this.views.get(id);
    if (!v) return null;
    return { center: v.root.position, radius: (v.size / 2) * v.root.scale.x };
  }

  /** The Derelict's tank, in the world, if it is drawn. */
  tankAt(id: number, out: Vector3): Vector3 | null {
    const v = this.views.get(id);
    if (!v || v.f.kind !== "derelict") return null;
    const tank = findNodeIn(v.root, /^tank$/);
    if (tank) return tank.getWorldPosition(out);
    return out.copy(this.derelict.tankDir).multiplyScalar(1.2).applyQuaternion(v.root.quaternion).add(v.root.position);
  }

  /** It ended (vaporised, split, struck, gone by): take it away. */
  remove(id: number): void {
    const v = this.views.get(id);
    if (!v) return;
    this.views.delete(id);
    this.give(v);
  }

  /** The foil wrap torn off. */
  strip(id: number): void {
    const v = this.views.get(id);
    if (v?.wrap) v.wrap.visible = false;
  }

  /** The Derelict's tank hit: it vents. */
  vent(id: number, t: number): void {
    const v = this.views.get(id);
    if (v) v.plumeUntil = t + 2.2;
  }

  /** The Derelict comes apart: its wings and bits tumble off (for show; the pieces are the rules'). */
  breakup(id: number): void {
    const v = this.views.get(id);
    if (!v) return;
    v.root.updateMatrixWorld(true);
    for (const panel of this.derelict.panels) {
      const name = contractName(panel);
      const mine = findNodeIn(v.root, new RegExp(`^${name.replace(".", "\\.")}$`));
      if (!mine) continue;
      const obj = mine.clone(true);
      mine.getWorldPosition(obj.position);
      mine.getWorldQuaternion(obj.quaternion);
      obj.scale.setScalar(v.root.scale.x);
      this.group.add(obj);
      const out = obj.position.clone().sub(v.root.position).normalize();
      const vel = this.velocity(v.f).add(out.multiplyScalar(1.5 + this.random() * 2));
      this.drifters.push({ obj, vel, axis: new Vector3(this.random() - 0.5, this.random() - 0.5, this.random() - 0.5).normalize(), spin: 0.8 + this.random() * 1.5, life: 8 });
    }
  }

  private velocity(f: Fragment): Vector3 {
    const s = 1 / 60;
    const a = f.position(this.time);
    const b = f.position(this.time + s);
    return new Vector3((b.x - a.x) / s, (b.y - a.y) / s, (b.z - a.z) / s);
  }

  /** Where it is drawn now. */
  positionOf(id: number): Vector3 | null {
    return this.views.get(id)?.root.position ?? null;
  }

  update(t: number, dt: number): void {
    this.time = t;
    for (const v of this.views.values()) {
      this.place(v, t, dt);
      this.flash(v, t);
      this.sparkle(v);
      if (v.f.kind === "derelict" && t < v.plumeUntil) {
        const tank = this.tankAt(v.f.id, tmp);
        if (tank) {
          const out = tmp2.copy(tank).sub(v.root.position).normalize();
          const vel = this.velocity(v.f);
          this.effects.plume(tank, out, vel, Math.min(1.5, (v.plumeUntil - t) * 0.8) * v.root.scale.x);
        }
      }
    }
    for (let i = this.drifters.length - 1; i >= 0; i--) {
      const d = this.drifters[i] as Drifter;
      d.life -= dt;
      d.obj.position.addScaledVector(d.vel, dt);
      d.obj.quaternion.premultiply(q.setFromAxisAngle(d.axis, d.spin * dt));
      if (d.life <= 0) {
        d.obj.removeFromParent();
        this.drifters.splice(i, 1);
      }
    }
  }

  /**
   * Far out in the sun, anything bright is a point of light before it is a
   * shape: a faint steady sparkle on each fragment, fading as it comes near
   * enough to read by itself.
   */
  private sparkle(v: View): void {
    if (this.sunlight < 0.05) return;
    const d = v.root.position.distanceTo(this.eye);
    const k = Math.min(1, Math.max(0, (d - 18) / 30)) * this.sunlight * Math.min(1, 0.45 + v.size * 0.35);
    if (k < 0.02) return;
    this.effects.sparkle(v.root.position, d, k);
  }

  /** A facet squarely mirroring the sun into the eye: a flash. */
  private flash(v: View, t: number): void {
    if (this.sunlight < 0.05 || t - v.lastGlint < 0.05) return;
    const pos = v.root.position;
    toEye.copy(this.eye).sub(pos);
    const d = toEye.length();
    toEye.divideScalar(d);
    const s = this.sun;
    let best = 0;
    let blue = false;
    const check = (n: Vector3, isFace: boolean) => {
      for (const sign of isFace ? [1, -1] : [1]) {
        const nx = n.x * sign;
        const ny = n.y * sign;
        const nz = n.z * sign;
        const ns = nx * s.x + ny * s.y + nz * s.z;
        if (ns <= 0) continue;
        // The sun mirrored in the facet.
        const rx = -s.x + 2 * ns * nx;
        const ry = -s.y + 2 * ns * ny;
        const rz = -s.z + 2 * ns * nz;
        const a = rx * toEye.x + ry * toEye.y + rz * toEye.z;
        if (a <= 0) continue;
        const g = Math.pow(a, isFace ? 90 : 160);
        if (g > best) {
          best = g;
          blue = isFace && sign > 0;
        }
      }
    };
    if (v.f.kind === "shard") {
      const face = v.f.face(t);
      check(tmp.set(face.x, face.y, face.z), true);
    }
    for (const n of v.facets) check(tmp.copy(n).applyQuaternion(v.root.quaternion), false);
    if (best < 0.12) return;
    v.lastGlint = t;
    this.effects.glint(tmp.copy(pos), d, Math.min(1, best) * this.sunlight, blue);
  }

  /** Everything away (a new game). */
  clear(): void {
    for (const id of [...this.views.keys()]) this.remove(id);
    for (const d of this.drifters) d.obj.removeFromParent();
    this.drifters.length = 0;
  }

  /**
   * Lets go of what the scene does not hold when the game is put away: the
   * library's wholes and pieces and the Derelict's parts (kept loose, out of
   * any scene, for the views to clone) and the views parked in the pool.
   * The page frees what came from files itself; stand-ins built in code
   * (development, tests) are freed only here.
   */
  dispose(): void {
    const loose = new Set<Disposable>();
    for (const list of Object.values(this.library)) {
      for (const v of list) {
        disposablesUnder(v.whole, loose);
        for (const p of v.pieces) disposablesUnder(p, loose);
      }
    }
    disposablesUnder(this.derelict.root, loose);
    for (const p of this.derelict.pieces) disposablesUnder(p, loose);
    for (const parked of this.pool.values()) for (const o of parked) disposablesUnder(o, loose);
    for (const d of this.drifters) disposablesUnder(d.obj, loose);
    for (const d of loose) d.dispose();
  }

  /** Every material the debris uses, for warming up and the tone. */
  materials(): Material[] {
    const out = new Set<Material>();
    const visit = (o: Object3D) =>
      o.traverse((c) => {
        const m = (c as Mesh).material;
        if (m) for (const x of Array.isArray(m) ? m : [m]) out.add(x);
      });
    for (const list of Object.values(this.library)) for (const v of list) {
      visit(v.whole);
      for (const p of v.pieces) visit(p);
    }
    visit(this.derelict.root);
    for (const p of this.derelict.pieces) visit(p);
    return [...out];
  }
}

function findNodeIn(root: Object3D, pattern: RegExp): Object3D | null {
  let found: Object3D | null = null;
  root.traverse((o) => {
    if (!found && pattern.test(contractName(o))) found = o;
  });
  return found;
}
