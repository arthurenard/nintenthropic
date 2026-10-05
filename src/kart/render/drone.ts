/**
 * The rescue drone: Grip Prix's own little propeller drone with a hook. When
 * a kart goes over an open edge (or into lava, or off the ribbon into space)
 * it dives in from ahead, hooks the kart, carries it back to the road and
 * lets it go.
 *
 * A chubby white four-rotor machine with a teal canopy and orange hazard
 * stripes, a lamp for an eye, ring guards round the rotors, and a winch with
 * a cable and a red hook. Built facing +z, about three metres across.
 * Not anybody else's design: just the sort of thing a toy-scale breakdown
 * service would send.
 */
import { AdditiveBlending, Group, Mesh, MeshBasicMaterial, MeshLambertMaterial, type BufferGeometry } from "three";
import { TAU } from "./math";
import { MeshBuilder, mixRgb, rgb, scaleRgb, shapes, xf, type Rgb, type V3 } from "./world/builder";

const ARMS: readonly V3[] = [
  [1.45, 0.25, 1.35],
  [-1.45, 0.25, 1.35],
  [1.45, 0.25, -1.35],
  [-1.45, 0.25, -1.35],
];

/** How long the cable is when it hangs fully out, metres. */
export const CABLE_MAX = 6;

export class RescueDrone {
  readonly root = new Group();
  private readonly rotors: Group[] = [];
  private readonly cable: Group;
  private readonly cableMesh: Mesh;
  private readonly hook: Group;
  private readonly lamp: Mesh;
  private readonly geometries: BufferGeometry[] = [];
  private readonly materials: { dispose(): void }[] = [];

  constructor() {
    const white = rgb("#f4f7fc");
    const teal = rgb("#1fb5b0");
    const orange = rgb("#ff8a1c");
    const dark = rgb("#2b2f3b");
    const lit = new MeshLambertMaterial({ vertexColors: true });
    const glow = new MeshBasicMaterial({ vertexColors: true });
    const blur = new MeshBasicMaterial({ color: 0xcfe9ff, transparent: true, opacity: 0.16, depthWrite: false, blending: AdditiveBlending });
    this.materials.push(lit, glow, blur);
    const keep = (g: BufferGeometry): BufferGeometry => {
      this.geometries.push(g);
      return g;
    };

    // The body: a rounded pod with a canopy and an orange belt.
    const body = new MeshBuilder();
    body.blob(0, 0, 0, 0.95, 0.55, 1.2, { bottom: scaleRgb(white, 0.7), top: white }, 1);
    body.blob(0, 0.28, -0.15, 0.62, 0.34, 0.8, { bottom: scaleRgb(teal, 0.7), top: mixRgb(teal, white, 0.25) }, 1);
    body.add(shapes.cylinder(14), xf(0, -0.02, 0, 0.98, 0.14, 1.22), orange);
    body.box(0, -0.52, 0, 0.5, 0.22, 0.5, dark);
    body.box(0, 0.62, -0.1, 0.1, 0.34, 0.1, dark);
    body.blob(0, 0.82, -0.1, 0.1, 0.1, 0.1, [3.2, 0.2, 0.2], 0);
    // Four arms and motor housings.
    for (const [x, y, z] of ARMS) {
      body.rod([0, 0.05, 0], [x * 0.8, y, z * 0.8], 0.16, white);
      body.add(shapes.cylinder(8), xf(x, y - 0.02, z, 0.24, 0.3, 0.24), dark);
      // Ring guard round each rotor.
      const ring = 18;
      for (let k = 0; k < ring; k++) {
        const a0 = (k / ring) * TAU;
        const a1 = ((k + 1) / ring) * TAU;
        const p0: V3 = [x + Math.cos(a0) * 0.92, y + 0.02, z + Math.sin(a0) * 0.92];
        const p1: V3 = [x + Math.cos(a1) * 0.92, y + 0.02, z + Math.sin(a1) * 0.92];
        body.rod(p0, p1, 0.07, k % 2 ? white : orange);
      }
      body.rod([x, y, z], [x + 0.92 * Math.sign(x) * 0.7, y + 0.02, z + 0.92 * Math.sign(z) * 0.7], 0.05, white);
    }
    this.root.add(new Mesh(keep(body.build()), lit));

    // The eye: a lamp at the front.
    const eye = new MeshBuilder();
    eye.blob(0, 0.05, 1.12, 0.3, 0.22, 0.1, [4.5, 4.0, 2.8], 0);
    eye.blob(0, 0.05, 1.18, 0.12, 0.1, 0.05, [0.2, 0.2, 0.25], 0);
    this.lamp = new Mesh(keep(eye.build()), glow);
    this.root.add(this.lamp);

    // Rotors: two blades each, turning, with a faint disc of blur.
    const blades = new MeshBuilder();
    blades.box(0, 0, 0, 1.6, 0.05, 0.2, dark);
    blades.box(0, 0, 0, 0.2, 0.05, 1.6, mixRgb(dark, white, 0.2), Math.PI / 4);
    blades.blob(0, 0.05, 0, 0.14, 0.1, 0.14, orange, 0);
    const bladeGeo = keep(blades.build());
    for (const [x, y, z] of ARMS) {
      const g = new Group();
      g.position.set(x, y + 0.2, z);
      g.add(new Mesh(bladeGeo, lit));
      const disc = new MeshBuilder();
      const seg = 14;
      for (let k = 0; k < seg; k++) {
        const a0 = (k / seg) * TAU;
        const a1 = ((k + 1) / seg) * TAU;
        const c: Rgb = [1, 1, 1];
        disc.tri([0, 0.02, 0], [Math.cos(a0) * 0.85, 0.02, Math.sin(a0) * 0.85], [Math.cos(a1) * 0.85, 0.02, Math.sin(a1) * 0.85], c);
      }
      g.add(new Mesh(keep(disc.build()), blur));
      this.root.add(g);
      this.rotors.push(g);
    }

    // The winch cable, which lengthens by scaling, and the red hook at its foot.
    this.cable = new Group();
    this.cable.position.set(0, -0.62, 0);
    const rope = new MeshBuilder();
    rope.rod([0, 0, 0], [0, -1, 0], 0.07, rgb("#3a3f4c"));
    this.cableMesh = new Mesh(keep(rope.build()), lit);
    this.cable.add(this.cableMesh);
    this.hook = new Group();
    const hookB = new MeshBuilder();
    const red = rgb("#e8352d");
    hookB.add(shapes.cylinder(8), xf(0, -0.1, 0, 0.12, 0.3, 0.12), dark);
    const arcPts: V3[] = [];
    for (let k = 0; k <= 8; k++) {
      const a = -Math.PI * 0.2 + (k / 8) * Math.PI * 1.3;
      arcPts.push([0, -0.5 - Math.cos(a) * 0.32 + 0.28, Math.sin(a) * 0.34]);
    }
    for (let k = 0; k < arcPts.length - 1; k++) hookB.rod(arcPts[k]!, arcPts[k + 1]!, 0.1, red);
    this.hook.add(new Mesh(keep(hookB.build()), lit));
    this.cable.add(this.hook);
    this.root.add(this.cable);
    this.root.visible = false;
  }

  /** Poses the drone: where, which way, how far the cable is paid out (0..CABLE_MAX), and the clock for the rotors. */
  pose(x: number, y: number, z: number, yaw: number, pitch: number, roll: number, cable: number, time: number): void {
    this.root.visible = true;
    this.root.position.set(x, y, z);
    this.root.rotation.set(pitch, yaw, roll, "YXZ");
    for (let k = 0; k < this.rotors.length; k++) this.rotors[k]!.rotation.y = time * 55 * (k % 2 ? 1 : -1) + k;
    const len = Math.max(0.3, cable);
    this.cableMesh.scale.y = len;
    this.hook.position.y = -len;
    // The lamp blinks, slowly.
    this.lamp.visible = Math.sin(time * 6) > -0.6;
  }

  hide(): void {
    this.root.visible = false;
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    this.root.removeFromParent();
  }
}
