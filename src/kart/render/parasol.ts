/**
 * The parasol a kart opens over a glide (sim/air.ts, `KartView.glide`): a striped dome on eight strings, opened with
 * a little overshoot, swaying with the wheel. Two draw calls while it is up and none otherwise; the geometry and the
 * material are shared by every kart.
 */
import { BufferGeometry, DoubleSide, Float32BufferAttribute, Group, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, type Object3D } from "three";

const PANELS = 8;
const RADIUS = 1.75;
const RISE = 0.7;
const HEIGHT = 2.6;

let shared: { dome: BufferGeometry; strings: BufferGeometry; domeMat: MeshBasicMaterial; stringMat: LineBasicMaterial } | null = null;

function parts(): NonNullable<typeof shared> {
  if (shared) return shared;
  const pos: number[] = [];
  const col: number[] = [];
  const A: [number, number, number] = [1.0, 0.36, 0.22];
  const B: [number, number, number] = [1.0, 0.93, 0.78];
  const ring = (k: number, r: number, y: number): [number, number, number] => [Math.sin((k / PANELS) * Math.PI * 2) * r, y, Math.cos((k / PANELS) * Math.PI * 2) * r];
  for (let k = 0; k < PANELS; k++) {
    const c = k % 2 === 0 ? A : B;
    const top: [number, number, number] = [0, HEIGHT + RISE, 0];
    const mid0 = ring(k, RADIUS * 0.62, HEIGHT + RISE * 0.72);
    const mid1 = ring(k + 1, RADIUS * 0.62, HEIGHT + RISE * 0.72);
    const rim0 = ring(k, RADIUS, HEIGHT);
    const rim1 = ring(k + 1, RADIUS, HEIGHT);
    for (const p of [top, mid0, mid1, mid0, rim0, rim1, mid0, rim1, mid1]) {
      pos.push(...p);
      col.push(...c);
    }
  }
  const dome = new BufferGeometry();
  dome.setAttribute("position", new Float32BufferAttribute(pos, 3));
  dome.setAttribute("color", new Float32BufferAttribute(col, 3));
  dome.computeBoundingSphere();
  const lines: number[] = [];
  for (let k = 0; k < PANELS; k++) {
    const r = ring(k, RADIUS, HEIGHT);
    lines.push(...r, 0, 0.55, -0.1);
  }
  const strings = new BufferGeometry();
  strings.setAttribute("position", new Float32BufferAttribute(lines, 3));
  strings.computeBoundingSphere();
  shared = {
    dome,
    strings,
    domeMat: new MeshBasicMaterial({ vertexColors: true, side: DoubleSide, fog: false }),
    stringMat: new LineBasicMaterial({ color: 0xf3efe6, fog: false }),
  };
  return shared;
}

export class Parasol {
  readonly group = new Group();
  private open = 0;
  private sway = 0;

  constructor() {
    const p = parts();
    this.group.add(new Mesh(p.dome, p.domeMat), new LineSegments(p.strings, p.stringMat));
    for (const child of this.group.children as Object3D[]) child.frustumCulled = false;
    this.group.visible = false;
  }

  /** `glide`: 1 while the kart is gliding, 0 otherwise; `steer` -1..1 sways it. */
  update(glide: number, steer: number, dt: number): void {
    const target = glide > 0 ? 1 : 0;
    this.open += (target - this.open) * Math.min(1, dt * (target ? 9 : 14));
    const g = this.group;
    if (this.open < 0.02) {
      g.visible = false;
      return;
    }
    g.visible = true;
    // Opens a touch past full and settles: an overshoot from the ease of the open.
    const s = this.open * (1 + 0.12 * Math.sin(this.open * Math.PI));
    this.sway += (steer - this.sway) * Math.min(1, dt * 5);
    g.scale.set(s, s, s);
    g.rotation.set(-0.12, 0, -this.sway * 0.18);
  }
}
