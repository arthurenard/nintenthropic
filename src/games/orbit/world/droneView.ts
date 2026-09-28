/**
 * The repair drone as the player sees it: parked on its cradle on the
 * platform, then - when the rules send it - flying out on a curve past the
 * windows to the pane it is to mend, turning to face the glass, welding
 * with a little blue arc, puffing cold gas to hold station, blinking the
 * station's running lights. Shot, it spins away tumbling and comes back
 * when the rules say it may.
 */
import { Object3D, Quaternion, Vector3 } from "three";
import { contractName } from "../../../engine/world/names";
import type { Drone } from "../rules/drone";
import type { Effects } from "./effects";

const tmp = new Vector3();
const tmp2 = new Vector3();
const q = new Quaternion();
const FORWARD = new Vector3(0, 0, 1);
const HINGE = new Vector3(1, 0, 0);
/** The welder arm reaching out to the glass (radians at the shoulder and the elbow, on their hinges). */
const REACH = { shoulder: -0.7, elbow: 0.9 };

export class DroneView {
  readonly root: Object3D;
  private readonly thrusters: Object3D[] = [];
  private tip: Object3D | null = null;
  private shoulder: Object3D | null = null;
  private elbow: Object3D | null = null;
  private readonly armRest: Quaternion[] = [];
  /** How far the welder arm is out: 0 folded .. 1 reaching to the glass. */
  private reach = 0;
  private readonly lights: Object3D[] = [];
  private readonly from = new Vector3();
  private readonly to = new Vector3();
  private readonly bend = new Vector3();
  private readonly dockPos = new Vector3();
  private readonly dockQuat = new Quaternion();
  private readonly spin = new Vector3();
  private readonly drift = new Vector3();
  private lastState = "";
  private time = 0;
  private puffTimer = 0;
  /** The pane it is welding, and how bright its arc is (for the glass). */
  welding: number | null = null;
  weldLight = 0;

  constructor(
    model: Object3D,
    parent: Object3D,
    dock: Object3D | null,
    private readonly work: (pane: number) => { pos: Vector3; facing: Vector3 },
    private readonly effects: Effects,
    private readonly random: () => number,
  ) {
    this.root = model;
    this.root.name = "orbit.drone";
    parent.add(this.root);
    if (dock) {
      dock.getWorldPosition(this.dockPos);
      dock.getWorldQuaternion(this.dockQuat);
    }
    model.traverse((o) => {
      const n = contractName(o);
      if (/^thruster\.\d+$/.test(n)) this.thrusters.push(o);
      if (n === "weld.tip") this.tip = o;
      if (n === "arm.shoulder") this.shoulder = o;
      if (n === "arm.elbow") this.elbow = o;
      if (n === "light.nav") this.lights.push(...o.children);
    });
    this.root.position.copy(this.dockPos);
    this.root.quaternion.copy(this.dockQuat);
    this.armRest.push(this.shoulder?.quaternion.clone() ?? new Quaternion(), this.elbow?.quaternion.clone() ?? new Quaternion());
  }

  /** The welder arm: out while mending, folded otherwise. */
  private moveArm(dt: number, out: boolean): void {
    this.reach += ((out ? 1 : 0) - this.reach) * (1 - Math.exp(-dt * 3));
    const e = this.reach * this.reach * (3 - 2 * this.reach);
    if (this.shoulder) this.shoulder.quaternion.copy(this.armRest[0] as Quaternion).multiply(q.setFromAxisAngle(HINGE, REACH.shoulder * e));
    if (this.elbow) this.elbow.quaternion.copy(this.armRest[1] as Quaternion).multiply(q.setFromAxisAngle(HINGE, REACH.elbow * e));
  }

  /** Where an errand's end is. */
  private anchor(a: "dock" | number, out: Vector3, facing?: Vector3): Vector3 {
    if (a === "dock") {
      out.copy(this.dockPos);
      facing?.copy(FORWARD).applyQuaternion(this.dockQuat);
      return out;
    }
    const w = this.work(a);
    facing?.copy(w.facing);
    return out.copy(w.pos);
  }

  /** Follow the rules' drone. `eye` is where the player is (the drone keeps out of the way). */
  update(drone: Drone, dt: number, eye: Vector3): void {
    this.time += dt;
    const state = `${drone.state}:${String(drone.from)}:${String(drone.to)}`;
    if (state !== this.lastState) {
      this.lastState = state;
      // A new leg starts from wherever it is now, bowed out away from the cupola.
      this.from.copy(this.root.position);
      this.anchor(drone.to, this.to);
      const mid = tmp.copy(this.from).add(this.to).multiplyScalar(0.5);
      this.bend.copy(mid).sub(eye).normalize().multiplyScalar(Math.min(4, this.from.distanceTo(this.to) * 0.35));
      if (drone.state === "knocked") {
        this.spin.set(this.random() - 0.5, this.random() - 0.5, this.random() - 0.5).normalize().multiplyScalar(5 + this.random() * 3);
        this.drift.copy(this.root.position).sub(eye).normalize().multiplyScalar(2.2).add(tmp.set(this.random() - 0.5, this.random() * 0.5, this.random() - 0.5));
        this.burst(6);
      } else if (drone.state === "flying" || drone.state === "returning") {
        this.burst(3);
      }
    }
    this.welding = null;
    this.weldLight = Math.max(0, this.weldLight - dt * 6);
    this.moveArm(dt, drone.state === "setting" || drone.state === "mending");
    switch (drone.state) {
      case "docked":
        this.root.position.lerp(this.dockPos, 1 - Math.exp(-dt * 3));
        this.root.quaternion.slerp(this.dockQuat, 1 - Math.exp(-dt * 3));
        break;
      case "flying":
      case "returning": {
        const k = drone.progress;
        const e = k * k * (3 - 2 * k);
        // A quadratic curve: out and round, not through the glass.
        const a = tmp.copy(this.from).lerp(this.to, e);
        a.addScaledVector(this.bend, 4 * e * (1 - e));
        this.root.position.copy(a);
        // Facing where it goes; at the end, the glass.
        const facing = tmp2.set(0, 0, 0);
        this.anchor(drone.to, new Vector3(), facing);
        const goal = new Quaternion().setFromUnitVectors(FORWARD, facing.lengthSq() > 0 ? facing : FORWARD);
        this.root.quaternion.slerp(goal, 1 - Math.exp(-dt * 2.5));
        this.puffTimer -= dt;
        if (this.puffTimer <= 0) {
          this.puffTimer = 0.35 + this.random() * 0.4;
          this.burst(1);
        }
        break;
      }
      case "setting":
      case "mending": {
        const facing = tmp2;
        this.anchor(drone.to, this.to, facing);
        // Holding station: a slow bob, the odd puff.
        this.root.position.copy(this.to).add(tmp.set(Math.sin(this.time * 1.3) * 0.02, Math.sin(this.time * 0.9) * 0.03, 0));
        this.root.quaternion.slerp(q.setFromUnitVectors(FORWARD, facing), 1 - Math.exp(-dt * 4));
        this.puffTimer -= dt;
        if (this.puffTimer <= 0) {
          this.puffTimer = 0.8 + this.random() * 1.4;
          this.burst(1);
        }
        if (drone.state === "mending" && typeof drone.to === "number") {
          this.welding = drone.to;
          this.weldLight = 0.6 + 0.4 * this.random();
          const at = this.tip ? this.tip.getWorldPosition(tmp) : tmp.copy(this.root.position);
          this.effects.weld(at, tmp2.copy(facing).negate());
        }
        break;
      }
      case "knocked":
        this.root.position.addScaledVector(this.drift, dt);
        this.root.quaternion.premultiply(q.setFromAxisAngle(tmp.copy(this.spin).normalize(), this.spin.length() * dt));
        this.spin.multiplyScalar(Math.exp(-dt * 0.15));
        this.drift.multiplyScalar(Math.exp(-dt * 0.1));
        break;
    }
    // The running lights: steady red and green, the white strobe.
    for (const l of this.lights) {
      const strobe = l.position.y > 0.2;
      l.visible = !strobe || this.time % 1.3 < 0.08;
    }
  }

  /** Cold gas from a few thrusters. */
  private burst(n: number): void {
    for (let i = 0; i < n && this.thrusters.length; i++) {
      const t = this.thrusters[Math.floor(this.random() * this.thrusters.length)] as Object3D;
      t.getWorldPosition(tmp);
      tmp2.copy(tmp).sub(this.root.position).normalize();
      this.effects.thruster(tmp, tmp2);
    }
  }

  /** Where the welder's tip is (or the drone, without one). */
  tipPosition(out: Vector3): Vector3 {
    return this.tip ? this.tip.getWorldPosition(out) : out.copy(this.root.position);
  }

  /** How big it is for a shot, and where. */
  get center(): Vector3 {
    return this.root.position;
  }

  reset(): void {
    this.root.position.copy(this.dockPos);
    this.root.quaternion.copy(this.dockQuat);
    this.lastState = "";
    this.welding = null;
    this.reach = 0;
    this.moveArm(0, false);
  }
}
