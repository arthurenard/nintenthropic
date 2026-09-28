/**
 * What lies right in front of the eye on the ridge: a few grass blades and
 * wildflowers, out of focus, moving in the wind, and the rifle's barrel on
 * its rock at the bottom of the view (golden, for a player who has earned
 * it). Seen only without the scope; the scope's narrow view passes over
 * them. Out of focus is painted in: the blades are soft-edged sprites, the
 * rifle is dark and low in contrast.
 */
import {
  CanvasTexture,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  Vector3,
  type Material,
} from "three";
import type { AtmosphereUniforms } from "./atmosphere";
import { patchStandard } from "./atmosphere";

/** A soft, out-of-focus grass blade (or a flower on its stalk), painted once. */
function bladeTexture(kind: "blade" | "flower", color: string): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 256;
  const g = c.getContext("2d")!;
  g.filter = "blur(5px)";
  g.fillStyle = kind === "blade" ? color : "#3f5a2c";
  g.beginPath();
  // A blade: wide at its foot, tapering and curving to a point.
  g.moveTo(24, 256);
  g.quadraticCurveTo(26, 120, 40, 18);
  g.quadraticCurveTo(34, 130, 40, 256);
  g.fill();
  if (kind === "flower") {
    g.fillStyle = color;
    g.beginPath();
    g.arc(40, 24, 9, 0, Math.PI * 2);
    g.fill();
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

interface Blade {
  mesh: Mesh;
  phase: number;
  stiffness: number;
  lean: number;
}

export class Foreground {
  readonly root = new Group();
  private readonly blades: Blade[] = [];
  readonly rifle = new Group();
  /** The grass the fallen view tips into. */
  private readonly fallen = new Group();
  private readonly metal: MeshStandardMaterial;
  private readonly wood: MeshStandardMaterial;
  private t = 0;
  private kick = 0;
  private readonly aimYaw = { v: 0 };
  private readonly aimPitch = { v: 0 };

  constructor(atmosphere: AtmosphereUniforms) {
    this.root.name = "foreground";
    const kinds: [string, "blade" | "flower", number][] = [
      ["#5c7440", "blade", 26],
      ["#6e8446", "blade", 14],
      ["#8a8a52", "blade", 8],
      ["#cfc8b2", "flower", 2],
      ["#e8c440", "flower", 3],
      ["#9b7ab8", "flower", 2],
    ];
    let seed = 11;
    const rnd = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (const [color, kind, n] of kinds) {
      const mat = new MeshBasicMaterial({ map: bladeTexture(kind, color), transparent: true, depthWrite: false, side: DoubleSide, name: "blade" });
      mat.color.setScalar(0.62);
      for (let i = 0; i < n; i++) {
        const h = kind === "flower" ? 0.2 + rnd() * 0.12 : 0.12 + rnd() * 0.22;
        const geo = new PlaneGeometry(h * 0.25, h);
        geo.translate(0, h / 2, 0);
        const m = new Mesh(geo, mat);
        // In a band just ahead of the eye, low, thickest at the sides.
        const side = rnd() < 0.5 ? -1 : 1;
        const x = side * (0.15 + Math.pow(rnd(), 0.8) * 1.1);
        const z = -(0.45 + rnd() * 0.7);
        m.position.set(x, -0.6 - rnd() * 0.06, z);
        m.rotation.y = (rnd() - 0.5) * 1.2;
        m.renderOrder = 6;
        this.root.add(m);
        this.blades.push({ mesh: m, phase: rnd() * 6.28, stiffness: 0.6 + rnd() * 0.8, lean: (rnd() - 0.5) * 0.3 });
      }
    }
    // Where the head comes to rest when the player falls: tall grass right by
    // the eye on both sides, shown only as the view tips over into it.
    this.fallen.visible = false;
    this.root.add(this.fallen);
    for (const [color, kind, n] of kinds) {
      const mat = new MeshBasicMaterial({ map: bladeTexture(kind, color), transparent: true, depthWrite: false, side: DoubleSide, name: "blade.fallen" });
      mat.color.setScalar(0.5);
      for (let i = 0; i < Math.ceil(n * 0.8); i++) {
        const h = 0.35 + rnd() * 0.4;
        const geo = new PlaneGeometry(h * 0.22, h);
        geo.translate(0, h / 2, 0);
        const m = new Mesh(geo, mat);
        const side = rnd() < 0.5 ? -1 : 1;
        m.position.set(side * (0.08 + rnd() * 0.7), -0.62 - rnd() * 0.05, -(0.12 + rnd() * 0.8));
        m.rotation.y = (rnd() - 0.5) * 1.6;
        m.renderOrder = 6;
        this.fallen.add(m);
        this.blades.push({ mesh: m, phase: rnd() * 6.28, stiffness: 0.6 + rnd() * 0.8, lean: (rnd() - 0.5) * 0.4 });
      }
    }
    // The rifle: its barrel and the scope's front bell resting on the rock at the bottom right.
    this.metal = new MeshStandardMaterial({ color: "#1d1f20", metalness: 0.85, roughness: 0.42, name: "rifle.metal" });
    this.wood = new MeshStandardMaterial({ color: "#3a2a1d", roughness: 0.7, name: "rifle.wood" });
    const barrel = new Mesh(new CylinderGeometry(0.011, 0.014, 0.85, 12), this.metal);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.z = -0.42;
    const fore = new Mesh(new CylinderGeometry(0.03, 0.035, 0.4, 10), this.wood);
    fore.rotation.x = Math.PI / 2;
    fore.scale.set(1, 1, 0.8);
    fore.position.set(0, -0.02, -0.05);
    const tube = new Mesh(new CylinderGeometry(0.02, 0.02, 0.32, 16), this.metal);
    tube.rotation.x = Math.PI / 2;
    tube.position.set(0, 0.075, 0.02);
    const bell = new Mesh(new CylinderGeometry(0.03, 0.021, 0.09, 16), this.metal);
    bell.rotation.x = Math.PI / 2;
    bell.position.set(0, 0.075, -0.17);
    const lens = new Mesh(new CylinderGeometry(0.026, 0.026, 0.002, 16), new MeshStandardMaterial({ color: "#0b1418", metalness: 0.2, roughness: 0.05, name: "lens" }));
    lens.rotation.x = Math.PI / 2;
    lens.position.set(0, 0.075, -0.216);
    const muzzle = new Mesh(new CylinderGeometry(0.016, 0.016, 0.05, 10), this.metal);
    muzzle.rotation.x = Math.PI / 2;
    muzzle.position.z = -0.86;
    this.rifle.add(barrel, fore, tube, bell, lens, muzzle);
    this.rifle.position.set(0.3, -0.47, -0.4);
    this.rifle.renderOrder = 6;
    // The rifle itself stays below the frame: at a prone eye's distance it would be a
    // dark bar across the valley. Its muzzle (for the smoke) is where it would be.
    this.rifle.visible = false;
    this.root.add(this.rifle);
    for (const m of [this.metal, this.wood] as Material[]) patchStandard(m, atmosphere, true);
  }

  /** The rifle's muzzle, in the world (for its smoke). */
  muzzle(out: Vector3): Vector3 {
    this.rifle.updateMatrixWorld(true);
    return this.rifle.localToWorld(out.set(0, 0, -0.9));
  }

  set golden(on: boolean) {
    this.metal.color.set(on ? "#b8902e" : "#1d1f20");
    this.metal.roughness = on ? 0.25 : 0.42;
    this.wood.color.set(on ? "#6a4a24" : "#3a2a1d");
  }

  fire(): void {
    this.kick = 1;
  }

  /** 0 alive … 1 lying in the grass: its blades come into view with the fall. */
  fall(progress: number): void {
    this.fallen.visible = progress > 0.05;
  }

  /**
   * Once a frame: the wind in the grass; the rifle turned a little toward
   * where the player aims (its rear stays at the shoulder), and its kick.
   */
  update(dt: number, windX: number, aim: { x: number; y: number }, visible: boolean): void {
    this.t += dt;
    this.root.visible = visible;
    if (!visible) return;
    const gust = 0.5 + 0.5 * Math.sin(this.t * 0.7);
    for (const b of this.blades) {
      const sway = Math.sin(this.t * (1.3 + b.stiffness) + b.phase) * 0.06 * (0.6 + gust);
      b.mesh.rotation.z = b.lean + sway - windX * 0.025 * b.stiffness;
    }
    this.aimYaw.v += (-(aim.x - 0.5) * 0.35 - this.aimYaw.v) * Math.min(1, dt * 4);
    this.aimPitch.v += (-(aim.y - 0.5) * 0.25 - this.aimPitch.v) * Math.min(1, dt * 4);
    this.kick *= Math.exp(-dt / 0.12);
    this.rifle.rotation.set(this.aimPitch.v + this.kick * 0.08, this.aimYaw.v, 0);
    this.rifle.position.z = -0.4 + this.kick * 0.05;
  }

  dispose(): void {
    this.root.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh) return;
      m.geometry.dispose();
      const mat = m.material as MeshBasicMaterial;
      mat.map?.dispose();
      mat.dispose();
    });
  }
}

export type { Color };
