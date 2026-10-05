/**
 * Tyre marks: dark strips laid behind the rear wheels while a kart drifts,
 * spins or brakes hard on the road, fading away over a few seconds. One
 * dynamic mesh of pooled quads in a ring buffer, one draw call, nothing
 * allocated while racing.
 */
import { BufferAttribute, BufferGeometry, DynamicDrawUsage, Mesh, MeshBasicMaterial } from "three";
import type { KartView } from "../contract";
import { KART_REAR_WHEEL } from "./kartModel";

const LIFE = 9;
const WIDTH = 0.3;
const STEP = 0.45;
const PEAK = 0.5;

interface Trail {
  /** Last mark's centre, or NaN when the strip is broken. */
  x: number;
  z: number;
  y: number;
  /** The left and right edges of the last mark. */
  lx: number;
  lz: number;
  rx: number;
  rz: number;
}

export class Skids {
  readonly mesh: Mesh;
  private readonly capacity: number;
  private readonly positions: Float32Array;
  private readonly colours: Float32Array;
  private readonly born: Float32Array;
  private readonly trails = new Map<string, Trail>();
  private next = 0;
  private moved = false;
  private clock = 0;
  private readonly material: MeshBasicMaterial;

  constructor(capacity = 1800) {
    this.capacity = capacity;
    this.positions = new Float32Array(capacity * 4 * 3);
    this.colours = new Float32Array(capacity * 4 * 4);
    this.born = new Float32Array(capacity).fill(-1e9);
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(this.positions, 3).setUsage(DynamicDrawUsage));
    geometry.setAttribute("color", new BufferAttribute(this.colours, 4).setUsage(DynamicDrawUsage));
    const index = new Uint32Array(capacity * 6);
    for (let q = 0; q < capacity; q++) {
      const v = q * 4;
      index.set([v, v + 1, v + 2, v, v + 2, v + 3], q * 6);
    }
    geometry.setIndex(new BufferAttribute(index, 1));
    this.material = new MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
      fog: true,
    });
    this.mesh = new Mesh(geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
  }

  /** Adds this frame's marks for `kart`, if it is laying them. */
  kart(k: KartView): void {
    const marking = !k.offroad && k.hop < 0.08 && (k.drift !== 0 || k.spin > 0) && Math.abs(k.speed) > 4;
    const fx = Math.sin(k.heading);
    const fz = Math.cos(k.heading);
    const rx = -Math.cos(k.heading);
    const rz = Math.sin(k.heading);
    for (const side of [-1, 1]) {
      const key = `${k.id}:${side}`;
      let t = this.trails.get(key);
      if (!t) {
        t = { x: NaN, z: NaN, y: 0, lx: 0, lz: 0, rx: 0, rz: 0 };
        this.trails.set(key, t);
      }
      if (!marking) {
        t.x = NaN;
        continue;
      }
      const x = k.x + rx * side * KART_REAR_WHEEL.right + fx * KART_REAR_WHEEL.forward;
      const z = k.z + rz * side * KART_REAR_WHEEL.right + fz * KART_REAR_WHEEL.forward;
      const y = k.y + 0.035;
      // Across the wheel: along the kart's right.
      const lx = x - rx * WIDTH * 0.5;
      const lz = z - rz * WIDTH * 0.5;
      const ex = x + rx * WIDTH * 0.5;
      const ez = z + rz * WIDTH * 0.5;
      if (Number.isNaN(t.x) || Math.hypot(x - t.x, z - t.z) > 3) {
        t.x = x;
        t.z = z;
        t.y = y;
        t.lx = lx;
        t.lz = lz;
        t.rx = ex;
        t.rz = ez;
        continue;
      }
      if (Math.hypot(x - t.x, z - t.z) < STEP) continue;
      this.push(t, lx, lz, ex, ez, y);
      t.x = x;
      t.z = z;
      t.y = y;
      t.lx = lx;
      t.lz = lz;
      t.rx = ex;
      t.rz = ez;
    }
  }

  private push(t: Trail, lx: number, lz: number, rx: number, rz: number, y: number): void {
    const q = this.next;
    this.next = (this.next + 1) % this.capacity;
    const p = this.positions;
    const o = q * 12;
    // The strip from the last mark's edges to this one's.
    p[o] = t.lx;
    p[o + 1] = t.y;
    p[o + 2] = t.lz;
    p[o + 3] = t.rx;
    p[o + 4] = t.y;
    p[o + 5] = t.rz;
    p[o + 6] = rx;
    p[o + 7] = y;
    p[o + 8] = rz;
    p[o + 9] = lx;
    p[o + 10] = y;
    p[o + 11] = lz;
    this.born[q] = this.clock;
    this.moved = true;
  }

  update(dt: number): void {
    this.clock += dt;
    const c = this.colours;
    for (let q = 0; q < this.capacity; q++) {
      const age = this.clock - this.born[q]!;
      const a = age >= LIFE ? 0 : PEAK * Math.min(1, age * 8) * (1 - age / LIFE);
      const o = q * 16;
      for (let v = 0; v < 4; v++) {
        c[o + v * 4] = 0.02;
        c[o + v * 4 + 1] = 0.02;
        c[o + v * 4 + 2] = 0.03;
        c[o + v * 4 + 3] = a;
      }
    }
    const geometry = this.mesh.geometry;
    if (this.moved) (geometry.getAttribute("position") as BufferAttribute).needsUpdate = true;
    this.moved = false;
    (geometry.getAttribute("color") as BufferAttribute).needsUpdate = true;
  }

  clear(): void {
    this.born.fill(-1e9);
    this.trails.clear();
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
