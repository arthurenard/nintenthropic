import { CylinderGeometry, Group, Mesh, MeshStandardMaterial, Vector3, type Object3D } from "three";
import type { Dynamite } from "../rules/dynamite";
import type { Effects } from "./effects";

const tip = new Vector3();

/**
 * The sticks in flight: a red cylinder tumbling end over end along the
 * rules' arc, its fuse spitting sparks the whole way — the brightest moving
 * thing on screen, so it can be seen and shot.
 */
export class DynamiteView {
  private readonly sticks: Group[] = [];
  private readonly spin: number[] = [];

  constructor(
    parent: Object3D,
    private readonly rules: readonly Dynamite[],
    private readonly fx: Effects,
  ) {
    const red = new MeshStandardMaterial({ color: "#b3241a", roughness: 0.6, emissive: "#3a0804", name: "dynamite" });
    const paper = new MeshStandardMaterial({ color: "#d8cfb8", roughness: 0.9 });
    const body = new CylinderGeometry(0.035, 0.035, 0.26, 12);
    const fuse = new CylinderGeometry(0.004, 0.004, 0.08, 4);
    for (let i = 0; i < rules.length; i++) {
      const g = new Group();
      const b = new Mesh(body, red);
      b.castShadow = true;
      const f = new Mesh(fuse, paper);
      f.position.y = 0.17;
      g.add(b, f);
      g.visible = false;
      parent.add(g);
      this.sticks.push(g);
      this.spin.push(0);
    }
  }

  update(dt: number): void {
    for (let i = 0; i < this.rules.length; i++) {
      const s = this.rules[i] as Dynamite;
      const g = this.sticks[s.id] as Group;
      if (s.state === "exploded") {
        g.visible = false;
        continue;
      }
      g.visible = true;
      g.position.set(s.position.x, s.position.y + (s.airborne ? 0 : 0.035), s.position.z);
      if (s.airborne) {
        this.spin[s.id] = (this.spin[s.id] as number) + dt * 9;
        g.rotation.set(this.spin[s.id] as number, s.age * 2, 0.4);
      } else {
        // On the ground it lies and rolls a little.
        g.rotation.x += (Math.PI / 2 - g.rotation.x) * Math.min(1, dt * 10);
        g.rotation.z = 0;
      }
      tip.set(0, 0.21, 0).applyQuaternion(g.quaternion).add(g.position);
      this.fx.fuse(tip);
      if (Math.random() < 0.5) this.fx.fuse(tip);
    }
  }
}
