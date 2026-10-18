/**
 * The things on the track that are not karts: the puck (a hovering disc that
 * spins and leaves a cyan trail), the seeker (a red glowing missile with a
 * fin), the slick (a glossy dark puddle with an oily rainbow edge) and the
 * skyrocket (a white and red rocket arcing high over the pack, trailing fire
 * and smoke). Item boxes, and the decoys that pass for them, are drawn by
 * world/boxes.ts.
 *
 * Models are made once and shared; each thing on the track is a small
 * object that follows its ThingView by id.
 */
import { AdditiveBlending, BufferGeometry, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial, MeshPhysicalMaterial, type Object3D } from "three";
import type { ThingView } from "../contract";
import type { Effects } from "./effects";
import { MeshBuilder, rgb, shapes, xf } from "./kartBuilder";
import { SURF, kartMaterial, withStudioFallback } from "./kartMaterial";

interface Visual {
  kind: ThingView["kind"];
  obj: Object3D;
  /** Parts animated each frame. */
  spin?: Object3D;
  seen: number;
  /** Where it was last frame (a rocket points along its flight). */
  prev?: [number, number, number];
}

function puckGeometry(): BufferGeometry {
  const b = new MeshBuilder();
  const rubber = { bottom: [0.025, 0.027, 0.034] as const, top: [0.07, 0.075, 0.09] as const };
  // A rounded black puck, a ring of cyan light round its waist, a chrome plate on top with four glowing chevrons.
  b.as(SURF.rubber, () => b.lathe([[0.001, 0], [0.44, 0], [0.5, 0.04], [0.525, 0.14], [0.5, 0.24], [0.42, 0.285], [0.001, 0.285]], xf(0, 0, 0), rubber, 30));
  b.as(SURF.lamp, () => b.torus(0.522, 0.034, xf(0, 0.145, 0), [0.5, 2.8, 3.8], 34, 6));
  b.as(SURF.chrome, () => b.lathe([[0.001, 0.3], [0.33, 0.3], [0.37, 0.285], [0.36, 0.27], [0.001, 0.27]], xf(0, 0, 0), [0.9, 0.93, 1], 28));
  b.as(SURF.lamp, () => {
    for (let k = 0; k < 4; k++) {
      const a = (k * Math.PI) / 2;
      b.slab(Math.cos(a) * 0.23, 0.31, Math.sin(a) * 0.23, 0.17, 0.03, 0.075, 0.012, k % 2 === 0 ? [4.2, 2.4, 0.4] : [3, 3.2, 3.6], -a);
    }
  });
  return b.build();
}

function seekerGeometry(): BufferGeometry {
  const b = new MeshBuilder();
  const dark = rgb("#2a0d14");
  // A glossy red body with a pale stripe, a dark nose, a fin, two wings, and the jet burning at the back.
  b.as(SURF.paint, () => b.blob(0, 0.5, 0, 0.36, 0.34, 0.8, { bottom: [0.5, 0.03, 0.03], top: [1.0, 0.08, 0.06] }, 2));
  b.as(SURF.trim, () => b.blob(0, 0.67, 0.02, 0.1, 0.05, 0.62, [0.97, 0.97, 1], 1));
  b.as(SURF.plastic, () => {
    b.add(shapes.cone(10), xf(0, 0.5, 0.88, 0.22, 0.5, 0.22, 0, Math.PI / 2, 0), dark);
    b.slab(0, 0.98, -0.42, 0.07, 0.52, 0.5, 0.025, dark);
    for (const s of [-1, 1]) b.slab(s * 0.38, 0.5, -0.38, 0.42, 0.055, 0.36, 0.02, dark, 0, 0, s * 0.1);
  });
  b.as(SURF.lamp, () => b.blob(0, 0.5, -0.84, 0.16, 0.16, 0.2, [3.2, 1.0, 0.18], 1));
  return b.build();
}

function rocketGeometry(): BufferGeometry {
  const b = new MeshBuilder();
  const white = rgb("#f4f5f9");
  const red = rgb("#e8392c");
  const dark = rgb("#2b2e3b");
  // A body, a red ogive nose and band, four fins, a porthole and a nozzle with its fire, all along +z.
  const along = (x: number, y: number, z: number) => xf(x, y, z, 1, 1, 1, 0, Math.PI / 2, 0);
  b.as(SURF.paint, () => {
    b.lathe([[0.001, -1.2], [0.36, -1.15], [0.4, -0.9], [0.4, 0.6], [0.37, 1.0], [0.001, 1.0]], along(0, 0, 0), white, 30);
    b.lathe([[0.37, 1.0], [0.28, 1.35], [0.14, 1.65], [0.001, 1.85]], along(0, 0, 0), red, 30);
    b.lathe([[0.405, 0.2], [0.405, 0.5], [0.4, 0.5], [0.4, 0.2]], along(0, 0, 0), red, 30);
    for (const a of [0, Math.PI / 2, Math.PI, (Math.PI * 3) / 2]) b.slab(Math.cos(a) * 0.52, Math.sin(a) * 0.52, -0.95, 0.62, 0.07, 0.62, 0.025, red, 0, 0, a);
  });
  b.as(SURF.glass, () => b.blob(0, 0.4, 0.9, 0.12, 0.12, 0.08, [0.3, 0.7, 1.0], 1));
  b.as(SURF.plastic, () => b.lathe([[0.2, -1.35], [0.3, -1.15], [0.001, -1.15]], along(0, 0, 0), dark, 20));
  b.as(SURF.lamp, () => b.blob(0, 0, -1.3, 0.16, 0.16, 0.3, [3.2, 1.3, 0.2], 1));
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
  readonly puck: BufferGeometry;
  private readonly seeker: BufferGeometry;
  private readonly rocket: BufferGeometry;
  private readonly puddles: BufferGeometry[];
  /** The puck's model and material, for the pucks orbiting a kart that holds three (itemfx.ts). */
  readonly lit: MeshPhysicalMaterial;
  private readonly slickMat: MeshPhysicalMaterial;
  private readonly sheenMat: MeshBasicMaterial;
  private readonly resources: { dispose(): void }[];
  private frameNo = 0;

  constructor(private readonly fx: Effects) {
    this.puck = puckGeometry();
    this.seeker = seekerGeometry();
    this.rocket = rocketGeometry();
    this.puddles = [0, 1, 2, 3].map(puddleGeometry);
    this.lit = kartMaterial();
    // Oil on the road: nearly black, glassy, with the rainbow film of a thin layer.
    this.slickMat = new MeshPhysicalMaterial({
      vertexColors: true,
      roughness: 0.06,
      metalness: 0.15,
      clearcoat: 1,
      clearcoatRoughness: 0.03,
      iridescence: 1,
      iridescenceIOR: 1.6,
      iridescenceThicknessRange: [220, 620],
      transparent: true,
      opacity: 0.96,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
      depthWrite: false,
    });
    this.sheenMat = new MeshBasicMaterial({ color: 0x6674b8, transparent: true, opacity: 0.35, blending: AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    this.resources = [this.puck, this.seeker, this.rocket, ...this.puddles, this.slickMat, this.sheenMat];
    // A slick nobody dropped, kept hidden: the renderer's warm-up shows what is hidden while the loading screen is up,
    // so the oil's shader is built then and not the first time a slick comes into view (a stall of 300 ms and more).
    const standIn = new Group();
    standIn.add(new Mesh(this.puddles[0]!, this.slickMat), new Mesh(this.puddles[0]!, this.sheenMat));
    standIn.visible = false;
    this.group.add(standIn);
  }

  private make(t: ThingView): Visual {
    const g = new Group();
    let spin: Object3D | undefined;
    switch (t.kind) {
      case "puck": {
        const m = new Mesh(this.puck, this.lit);
        m.castShadow = true;
        withStudioFallback(m);
        g.add(m);
        spin = m;
        break;
      }
      case "seeker":
        {
          const m = new Mesh(this.seeker, this.lit);
          m.castShadow = true;
          withStudioFallback(m);
          g.add(m);
        }
        break;
      case "skyrocket": {
        const m = new Mesh(this.rocket, this.lit);
        m.scale.set(1.5, 1.5, 1.5);
        m.castShadow = true;
        withStudioFallback(m);
        g.add(m);
        break;
      }
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
      if (t.kind === "box" || t.kind === "decoy" || !t.active) continue;
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
        case "skyrocket": {
          o.position.set(t.x, t.y, t.z);
          const p = v.prev;
          if (p) {
            const dx = t.x - p[0];
            const dy = t.y - p[1];
            const dz = t.z - p[2];
            const flat = Math.hypot(dx, dz);
            if (flat + Math.abs(dy) > 0.02) o.rotation.set(-Math.atan2(dy, Math.max(flat, 0.001)), flat > 0.01 ? Math.atan2(dx, dz) : t.heading, 0, "YXZ");
          } else {
            o.rotation.set(0, t.heading, 0);
          }
          v.prev = [t.x, t.y, t.z];
          const back = [-Math.sin(o.rotation.y) * Math.cos(o.rotation.x), Math.sin(o.rotation.x), -Math.cos(o.rotation.y) * Math.cos(o.rotation.x)] as const;
          const flicker = 0.8 + 0.2 * Math.sin(time * 40 + t.id);
          // The flame at its tail, a glow, and a long grey trail that hangs behind.
          this.fx.glowNow(t.x + back[0] * 2.2, t.y + back[1] * 2.2, t.z + back[2] * 2.2, 2.4 * flicker, 2.2, 1.0, 0.25, 0.8);
          this.fx.trail(t.x + back[0] * 1.9, t.y + back[1] * 1.9, t.z + back[2] * 1.9, 1.6, 0.8, 0.2, 0.9);
          this.fx.smoke(t.x + back[0] * 2.4, t.y + back[1] * 2.4, t.z + back[2] * 2.4, 1.0, 1.7, 0.3);
          if ((this.frameNo & 1) === 0) this.fx.smoke(t.x + back[0] * 3.2, t.y + back[1] * 3.2, t.z + back[2] * 3.2, 1.3, 2.1, 0.3);
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
