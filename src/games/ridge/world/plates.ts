/**
 * The aim check's nine steel plates, on the soldiers' range on the near
 * side of the valley and on posts along the road, 120-250 m out. The lit one
 * gets a painted white circle; a hit rings it - the round takes its time to
 * get there, and the clang takes longer to come back - and it swings on its
 * crossbar; a miss throws up dust beside it.
 */
import { DoubleSide, Mesh, MeshBasicMaterial, RingGeometry, Vector3, type Object3D, type PerspectiveCamera } from "three";
import type { CalibrationStage, CalibrationTarget } from "../../../engine/types";
import type { Sound } from "../../../engine/world/sound";
import { timeOfFlight } from "../rules/ballistics";
import type { Effects } from "./effects";
import type { Heightfield } from "./heightfield";

interface Plate {
  id: string;
  pivot: Object3D;
  centre: Vector3;
  ring: Mesh;
  /** The swing: angle and speed about the crossbar. */
  swing: number;
  spin: number;
  /** Seconds until a round already fired at it arrives. */
  pending: number[];
  target: CalibrationTarget;
}

const tmp = new Vector3();
const UP = new Vector3(0, 1, 0);
const BACK = new Vector3(0, 0, 1);

export class PlateStage implements CalibrationStage {
  private readonly plates: Plate[] = [];
  private lit: string | null = null;
  /** Rounds that missed, on their way into the ground beside a plate. */
  private readonly misses: { at: Vector3; t: number }[] = [];
  active = true;

  constructor(
    pivots: Object3D[],
    parent: Object3D,
    private readonly camera: () => PerspectiveCamera,
    private readonly effects: Effects,
    private readonly sound: Sound,
    private readonly heightfield: Heightfield,
    private readonly view: () => { width: number; height: number },
  ) {
    const paint = new MeshBasicMaterial({ color: "#f4f2ec", side: DoubleSide, transparent: true, opacity: 0.95, depthWrite: false, name: "paint" });
    pivots.forEach((pivot, i) => {
      pivot.updateMatrixWorld(true);
      // The plate's face is a metre below its pivot (its crossbar).
      const centre = pivot.localToWorld(new Vector3(0, -0.95, 0));
      const ring = new Mesh(new RingGeometry(1.05, 1.45, 40), paint);
      ring.position.copy(centre);
      ring.lookAt(0, 0, 0);
      ring.visible = false;
      ring.renderOrder = 2;
      parent.add(ring);
      this.plates.push({ id: `plate.${i + 1}`, pivot, centre, ring, swing: 0, spin: 0, pending: [], target: { id: `plate.${i + 1}`, x: 0.5, y: 0.5, radius: 0.04 } });
    });
  }

  /** Where each plate is in the view now, and how big a zone it gets. */
  targets(): CalibrationTarget[] {
    if (!this.active) return [];
    const cam = this.camera();
    const { width, height } = this.view();
    const side = Math.min(width, height);
    const out: CalibrationTarget[] = [];
    for (const p of this.plates) {
      tmp.copy(p.centre).project(cam);
      p.target.x = (tmp.x + 1) / 2;
      p.target.y = (1 - tmp.y) / 2;
      // The painted circle's size on screen, and never less than a hand can hit.
      const d = p.centre.distanceTo(cam.position);
      const px = (1.45 / d / Math.tan((cam.fov * Math.PI) / 360)) * (height / 2);
      p.target.radius = Math.max(0.034, Math.min(0.06, px / side));
      if (tmp.z < 1 && p.target.x > 0 && p.target.x < 1 && p.target.y > 0 && p.target.y < 1) out.push(p.target);
    }
    return out;
  }

  begin(): void {
    this.active = true;
    for (const p of this.plates) {
      p.swing = 0;
      p.spin = 0;
      p.pending.length = 0;
      p.pivot.rotation.x = 0;
    }
    this.misses.length = 0;
    this.light(null);
  }

  light(id: string | null): void {
    this.lit = id;
    for (const p of this.plates) p.ring.visible = p.id === id && this.active;
  }

  /** A good shot: the round arrives after its flight, rings the plate and swings it. */
  hit(id: string): void {
    const p = this.plates.find((x) => x.id === id);
    if (!p) return;
    p.pending.push(timeOfFlight(p.centre.distanceTo(this.camera().position)));
  }

  /** A miss: dust beside the plate, where the round went into the ground. */
  miss(id: string, x: number, y: number): void {
    const p = this.plates.find((q) => q.id === id);
    if (!p) return;
    const cam = this.camera();
    const d = p.centre.distanceTo(cam.position);
    tmp.set(x * 2 - 1, 1 - y * 2, 0.5).unproject(cam).sub(cam.position).normalize().multiplyScalar(d).add(cam.position);
    const g = this.heightfield.height(tmp.x, tmp.z);
    tmp.y = Math.min(tmp.y, g + 0.2);
    // On the game's clock, so a pause holds it and the test hook's time moves it.
    this.misses.push({ at: tmp.clone(), t: timeOfFlight(d) });
  }

  done(): void {
    this.light(null);
    this.sound.play("calib_done", { volume: 0.8 });
    this.active = false;
  }

  update(dt: number): void {
    for (let i = this.misses.length - 1; i >= 0; i--) {
      const m = this.misses[i]!;
      m.t -= dt;
      if (m.t > 0) continue;
      this.misses.splice(i, 1);
      this.effects.impact("grass", m.at, UP, BACK);
      this.sound.at("ridge_hit_dirt", m.at, 0.7);
    }
    for (const p of this.plates) {
      for (let i = p.pending.length - 1; i >= 0; i--) {
        p.pending[i]! -= dt;
        if (p.pending[i]! > 0) continue;
        p.pending.splice(i, 1);
        p.spin += 3.2;
        this.effects.impact("metal", p.centre, tmp.copy(this.camera().position).sub(p.centre).normalize(), new Vector3(0, 0, 1));
        // The clang comes back across the range after it (the cue travels).
        this.sound.at("ridge_plate_ring", p.centre, 1);
      }
      // A damped pendulum on its crossbar.
      p.spin += (-18 * p.swing - 1.6 * p.spin) * dt;
      p.swing += p.spin * dt;
      p.pivot.rotation.x = p.swing;
    }
  }

  get litId(): string | null {
    return this.lit;
  }

  /** The plates' centres, for framing the aim check's view on them. */
  centres(): Vector3[] {
    return this.plates.map((p) => p.centre);
  }
}
