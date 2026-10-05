/**
 * Item boxes: translucent cubes that turn and bob above the road, a bright
 * frame whose colour drifts through the rainbow, a glowing gem inside, and a
 * pool of light beneath. All slots are drawn as instances (four draw calls
 * for any number of boxes).
 *
 * A taken box shrinks away and pops back when it returns. Where the sim says
 * which boxes exist (ThingViews of kind "box") those are drawn; otherwise the
 * track's own `itemRows` give the positions, five across the road.
 */
import {
  AdditiveBlending,
  BoxGeometry,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Euler,
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  OctahedronGeometry,
  PlaneGeometry,
  Quaternion,
  Vector3,
} from "three";
import type { ThingView } from "../../contract";
import type { TrackGeometry } from "../../track/geometry";
import { damp } from "../math";
import { MeshBuilder } from "./builder";
import { glowTexture } from "./textures";

const CAPACITY = 64;
const SIZE = 1.5;

export interface BoxSlot {
  id: number;
  x: number;
  y: number;
  z: number;
  active: boolean;
}

/** The slots a track's own rows make: five boxes across the road at each row. */
export function rowSlots(track: TrackGeometry): BoxSlot[] {
  const out: BoxSlot[] = [];
  let id = 0;
  for (const at of track.def.itemRows) {
    const c = track.at(at * track.length);
    const spread = Math.min(2.6, (c.width - 3) / 4);
    for (let k = -2; k <= 2; k++) {
      const p = track.point(c.s, k * spread);
      out.push({ id: id++, x: p.x, y: p.y, z: p.z, active: true });
    }
  }
  return out;
}

export function slotsFromThings(things: readonly ThingView[]): BoxSlot[] | null {
  let any = false;
  const out: BoxSlot[] = [];
  for (const t of things) {
    if (t.kind !== "box") continue;
    any = true;
    out.push({ id: t.id, x: t.x, y: t.y, z: t.z, active: t.active });
  }
  return any ? out : null;
}

interface State {
  scale: number;
  seen: number;
}

export class ItemBoxes {
  readonly group = new Group();
  private readonly shell: InstancedMesh;
  private readonly frame: InstancedMesh;
  private readonly gem: InstancedMesh;
  private readonly pool: InstancedMesh;
  private readonly states = new Map<number, State>();
  private readonly resources: { dispose(): void }[] = [];
  private frameNo = 0;

  constructor() {
    const shellGeo = new BoxGeometry(SIZE, SIZE, SIZE);
    const shellMat = new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.3, depthWrite: false, side: DoubleSide });
    this.shell = new InstancedMesh(shellGeo, shellMat, CAPACITY);

    const fb = new MeshBuilder();
    const t = 0.085;
    const h = SIZE / 2;
    const white: [number, number, number] = [1, 1, 1];
    for (const y of [-h, h]) {
      for (const z of [-h, h]) fb.box(0, y, z, SIZE + t, t, t, white);
      for (const x of [-h, h]) fb.box(x, y, 0, t, t, SIZE + t, white);
    }
    for (const x of [-h, h]) for (const z of [-h, h]) fb.box(x, 0, z, t, SIZE + t, t, white);
    const frameGeo = fb.build();
    const frameMat = new MeshBasicMaterial({ vertexColors: true });
    this.frame = new InstancedMesh(frameGeo, frameMat, CAPACITY);

    const gemGeo = new OctahedronGeometry(0.46, 0);
    gemGeo.scale(0.8, 1.15, 0.8);
    const gemMat = new MeshBasicMaterial({ color: new Color(2.2, 1.9, 0.9) });
    this.gem = new InstancedMesh(gemGeo, gemMat, CAPACITY);

    const poolTex = glowTexture(0, 1.2);
    const poolGeo = new PlaneGeometry(3.6, 3.6);
    poolGeo.rotateX(-Math.PI / 2);
    const poolMat = new MeshBasicMaterial({ map: poolTex, transparent: true, blending: AdditiveBlending, depthWrite: false, opacity: 0.7, fog: true });
    this.pool = new InstancedMesh(poolGeo, poolMat, CAPACITY);

    this.resources.push(shellGeo, shellMat, frameGeo, frameMat, gemGeo, gemMat, poolTex, poolGeo, poolMat);
    for (const m of [this.shell, this.frame, this.gem, this.pool]) {
      m.instanceMatrix.setUsage(DynamicDrawUsage);
      m.count = 0;
      m.frustumCulled = false;
      this.group.add(m);
    }
    this.shell.renderOrder = 6;
    this.pool.renderOrder = 4;
    this.group.renderOrder = 6;
  }

  update(slots: readonly BoxSlot[], time: number, dt: number): void {
    this.frameNo++;
    const m = new Matrix4();
    const q = new Quaternion();
    const e = new Euler();
    const p = new Vector3();
    const s = new Vector3();
    const colour = new Color();
    let n = 0;
    for (const slot of slots) {
      if (n >= CAPACITY) break;
      let st = this.states.get(slot.id);
      if (!st) {
        st = { scale: slot.active ? 1 : 0, seen: 0 };
        this.states.set(slot.id, st);
      }
      st.seen = this.frameNo;
      st.scale = damp(st.scale, slot.active ? 1 : 0, slot.active ? 9 : 22, dt);
      // A tiny overshoot as it returns, so it pops rather than fades.
      const pop = slot.active && st.scale < 0.98 ? 1 + Math.sin(st.scale * Math.PI) * 0.12 : 1;
      const sc = st.scale * pop;
      if (sc < 0.02) continue;
      const phase = slot.id * 1.7;
      const bob = Math.sin(time * 2.0 + phase) * 0.12;
      p.set(slot.x, slot.y + 1.25 + bob, slot.z);
      e.set(Math.sin(time * 0.9 + phase) * 0.35 + 0.35, time * 1.3 + phase, Math.cos(time * 0.7 + phase) * 0.3, "YXZ");
      q.setFromEuler(e);
      m.compose(p, q, s.set(sc, sc, sc));
      this.shell.setMatrixAt(n, m);
      this.frame.setMatrixAt(n, m);
      // The gem turns the other way and breathes.
      e.set(0, -time * 2.2 + phase, 0);
      q.setFromEuler(e);
      const breathe = sc * (1 + Math.sin(time * 4 + phase) * 0.08);
      m.compose(p, q, s.set(breathe, breathe, breathe));
      this.gem.setMatrixAt(n, m);
      p.set(slot.x, slot.y + 0.07, slot.z);
      m.compose(p, q.identity(), s.set(sc, sc, sc));
      this.pool.setMatrixAt(n, m);
      colour.setHSL((time * 0.12 + slot.id * 0.037) % 1, 0.9, 0.62);
      this.shell.setColorAt(n, colour);
      this.frame.setColorAt(n, colour.multiplyScalar(1.3));
      this.pool.setColorAt(n, colour);
      n++;
    }
    for (const mesh of [this.shell, this.frame, this.gem, this.pool]) {
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    // Forget slots that have gone (a new race).
    if (this.states.size > CAPACITY * 2) {
      for (const [id, st] of this.states) if (st.seen !== this.frameNo) this.states.delete(id);
    }
  }

  /** World positions of the boxes now showing, for the pickup sparkle. */
  nearest(x: number, z: number, within: number, slots: readonly BoxSlot[]): BoxSlot | null {
    let best: BoxSlot | null = null;
    let bestD = within * within;
    for (const s of slots) {
      const d = (s.x - x) ** 2 + (s.z - z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best;
  }

  dispose(): void {
    for (const r of this.resources) r.dispose();
    for (const m of [this.shell, this.frame, this.gem, this.pool]) m.dispose();
  }
}
