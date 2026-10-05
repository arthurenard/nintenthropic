/**
 * The things on the track that are not karts: the puck (a hovering disc that
 * spins and leaves a cyan trail), the seeker (a red glowing missile with a
 * fin) and the slick (a glossy dark puddle with an oily rainbow edge). Item
 * boxes are drawn by world/boxes.ts.
 *
 * Models are made once and shared; each thing on the track is a small
 * object that follows its ThingView by id.
 */
import { AdditiveBlending, BufferGeometry, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial, MeshLambertMaterial, MeshPhongMaterial, type Material, type Object3D } from "three";
import type { ThingView } from "../contract";
import type { Effects } from "./effects";
import { MeshBuilder, rgb, scaleRgb, shapes, xf } from "./world/builder";

interface Visual {
  kind: ThingView["kind"];
  obj: Object3D;
  /** Parts animated each frame. */
  spin?: Object3D;
  seen: number;
}

function puckGeometry(): BufferGeometry {
  const b = new MeshBuilder();
  const rubber = rgb("#23262e");
  const rim: [number, number, number] = [0.5, 2.4, 3.0];
  b.add(shapes.cylinder(16), xf(0, 0.14, 0, 0.5, 0.28, 0.5), { bottom: scaleRgb(rubber, 0.6), top: rubber });
  b.add(shapes.cylinder(16), xf(0, 0.2, 0, 0.53, 0.07, 0.53), rim);
  b.add(shapes.cylinder(16), xf(0, 0.285, 0, 0.36, 0.02, 0.36), rgb("#3a3f4c"));
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2;
    b.box(Math.cos(a) * 0.24, 0.3, Math.sin(a) * 0.24, 0.16, 0.02, 0.07, k % 2 === 0 ? [3.2, 1.8, 0.4] : [1, 1, 1], -a);
  }
  return b.build();
}

function seekerGeometry(): BufferGeometry {
  const b = new MeshBuilder();
  const hot: [number, number, number] = [2.6, 0.28, 0.2];
  const dark = rgb("#3a1018");
  b.blob(0, 0.5, 0, 0.36, 0.34, 0.78, { bottom: [1.6, 0.14, 0.1], top: hot }, 1);
  // A dark nose, a fin on the back and two small wings.
  b.add(shapes.cone(8), xf(0, 0.5, 0.86, 0.22, 0.5, 0.22, 0, Math.PI / 2, 0), dark);
  b.box(0, 0.98, -0.42, 0.06, 0.52, 0.5, dark);
  for (const s of [-1, 1]) b.box(s * 0.36, 0.5, -0.38, 0.4, 0.05, 0.34, dark, 0, 0, s * 0.1);
  return b.build();
}

function puddleGeometry(variant: number): BufferGeometry {
  const sides = 22;
  const R = 1.7;
  const pos: number[] = [];
  const col: number[] = [];
  const nor: number[] = [];
  const edge = (i: number): [number, number] => {
    const a = (i / sides) * Math.PI * 2;
    const r = R * (1 + 0.16 * Math.sin(3 * a + variant * 1.7) + 0.09 * Math.sin(5 * a + variant * 2.9) + 0.05 * Math.sin(8 * a + variant));
    return [Math.cos(a) * r, Math.sin(a) * r];
  };
  const centre = rgb("#06070d");
  for (let i = 0; i < sides; i++) {
    const [x0, z0] = edge(i);
    const [x1, z1] = edge(i + 1);
    // An oily sheen toward the rim: teal, then violet.
    const hue = (k: number) => (k % 2 === 0 ? rgb("#1d6f86") : rgb("#4b2a8c"));
    const rimA = hue(i);
    const rimB = hue(i + 1);
    const mid = rgb("#10122a");
    // Inner ring at 55%.
    const ring = (x: number, z: number): [number, number] => [x * 0.55, z * 0.55];
    const [ix0, iz0] = ring(x0, z0);
    const [ix1, iz1] = ring(x1, z1);
    const tri = (a: number[], b: number[], c: number[], ca: readonly number[], cb: readonly number[], cc: readonly number[]) => {
      pos.push(...a, ...b, ...c);
      col.push(...ca, ...cb, ...cc);
      nor.push(0, 1, 0, 0, 1, 0, 0, 1, 0);
    };
    // Centre fan to the inner ring (viewed from above, counter-clockwise).
    tri([0, 0, 0], [ix1, 0, iz1], [ix0, 0, iz0], centre, mid, mid);
    // Inner ring to the rim.
    tri([ix0, 0, iz0], [ix1, 0, iz1], [x1, 0, z1], mid, mid, rimB);
    tri([ix0, 0, iz0], [x1, 0, z1], [x0, 0, z0], mid, rimB, rimA);
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new Float32BufferAttribute(col, 3));
  g.setAttribute("normal", new Float32BufferAttribute(nor, 3));
  g.computeBoundingSphere();
  return g;
}

export class Things {
  readonly group = new Group();
  private readonly visuals = new Map<number, Visual>();
  private readonly puck: BufferGeometry;
  private readonly seeker: BufferGeometry;
  private readonly puddles: BufferGeometry[];
  private readonly lit: MeshLambertMaterial;
  private readonly slickMat: MeshPhongMaterial;
  private readonly sheenMat: MeshBasicMaterial;
  private readonly resources: { dispose(): void }[];
  private frameNo = 0;

  constructor(private readonly fx: Effects) {
    this.puck = puckGeometry();
    this.seeker = seekerGeometry();
    this.puddles = [0, 1, 2, 3].map(puddleGeometry);
    this.lit = new MeshLambertMaterial({ vertexColors: true });
    this.slickMat = new MeshPhongMaterial({
      vertexColors: true,
      shininess: 140,
      specular: 0x8a9cff,
      transparent: true,
      opacity: 0.95,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
      depthWrite: false,
    });
    this.sheenMat = new MeshBasicMaterial({ color: 0x6674b8, transparent: true, opacity: 0.35, blending: AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    this.resources = [this.puck, this.seeker, ...this.puddles, this.lit, this.slickMat, this.sheenMat];
  }

  private make(t: ThingView): Visual {
    const g = new Group();
    let spin: Object3D | undefined;
    switch (t.kind) {
      case "puck": {
        const m = new Mesh(this.puck, this.lit);
        g.add(m);
        spin = m;
        break;
      }
      case "seeker":
        g.add(new Mesh(this.seeker, this.lit));
        break;
      case "slick": {
        const geo = this.puddles[((t.id % 4) + 4) % 4]!;
        const m = new Mesh(geo, this.slickMat);
        m.renderOrder = 2;
        g.add(m);
        const sheen = new Mesh(geo, this.sheenMat);
        sheen.scale.set(0.34, 1, 0.22);
        sheen.position.set(-0.45, 0.012, 0.5);
        sheen.renderOrder = 3;
        g.add(sheen);
        break;
      }
      default:
        break;
    }
    this.group.add(g);
    return { kind: t.kind, obj: g, spin, seen: this.frameNo };
  }

  update(things: readonly ThingView[], time: number): void {
    this.frameNo++;
    for (const t of things) {
      if (t.kind === "box" || !t.active) continue;
      let v = this.visuals.get(t.id);
      if (v && v.kind !== t.kind) {
        this.group.remove(v.obj);
        this.visuals.delete(t.id);
        v = undefined;
      }
      if (!v) {
        v = this.make(t);
        this.visuals.set(t.id, v);
      }
      v.seen = this.frameNo;
      const o = v.obj;
      switch (t.kind) {
        case "puck": {
          o.position.set(t.x, t.y + 0.32 + Math.sin(time * 9 + t.id) * 0.04, t.z);
          if (v.spin) v.spin.rotation.y = time * 14 + t.id;
          this.fx.glowNow(t.x, t.y + 0.4, t.z, 1.7, 0.2, 0.9, 1.2, 0.5);
          if ((this.frameNo & 1) === 0) this.fx.trail(t.x, t.y + 0.35, t.z, 0.3, 0.85, 1.0, 0.3);
          break;
        }
        case "seeker": {
          o.position.set(t.x, t.y + 0.25, t.z);
          o.rotation.y = t.heading;
          const pulse = 0.75 + 0.25 * Math.sin(time * 18 + t.id);
          this.fx.glowNow(t.x, t.y + 0.75, t.z, 3.4 * pulse + 0.6, 1.0, 0.18, 0.1, 0.8);
          this.fx.trail(t.x - Math.sin(t.heading) * 0.8, t.y + 0.7, t.z - Math.cos(t.heading) * 0.8, 1.0, 0.45, 0.12, 0.5);
          break;
        }
        case "slick": {
          o.position.set(t.x, t.y + 0.035, t.z);
          o.rotation.y = t.heading;
          const s = 1 + Math.sin(time * 1.6 + t.id) * 0.012;
          o.scale.set(s, 1, s);
          break;
        }
        default:
          break;
      }
    }
    for (const [id, v] of this.visuals) {
      if (v.seen !== this.frameNo) {
        this.group.remove(v.obj);
        this.visuals.delete(id);
      }
    }
  }

  clear(): void {
    for (const v of this.visuals.values()) this.group.remove(v.obj);
    this.visuals.clear();
  }

  dispose(): void {
    this.clear();
    for (const r of this.resources) r.dispose();
  }
}

export type { Material };
