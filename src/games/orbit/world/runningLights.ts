/**
 * The aim check, as part of the game: the station's nine running lights -
 * red, green and white navigation beacons on the truss, the arrays, the
 * radiator, the arm, the capsule and the platform - placed to cover the
 * screen's corners, edges and centre. The one to shoot blinks brighter; a
 * hit turns it steady green with a soft ring swelling round it. At the end
 * they settle back into their slow blink.
 */
import { AdditiveBlending, Color, Mesh, MeshBasicMaterial, SphereGeometry, Sprite, SpriteMaterial, CanvasTexture, Vector3, type Object3D, type PerspectiveCamera } from "three";
import type { CalibrationStage, CalibrationTarget } from "../../../engine/types";
import type { Sound } from "../../../engine/world/sound";
import { placeTarget } from "../../../engine/world/targets";
import type { Effects } from "./effects";

interface Light {
  id: string;
  node: Object3D;
  base: Color;
  lens: Mesh;
  flare: Sprite;
  hit: boolean;
  target: CalibrationTarget;
  pos: Vector3;
}

const KIND: Record<"red" | "green" | "white", Color> = {
  red: new Color(4, 0.35, 0.25),
  green: new Color(0.35, 4, 0.7),
  white: new Color(3.6, 3.6, 3.4),
};
const HIT = new Color(0.4, 5, 1.2);

/** A soft round glow for the beacons' flare. */
function glowTexture(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  if (g) {
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.2, "rgba(255,255,255,0.55)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
  }
  return new CanvasTexture(c);
}

const STEPS = [0, 2, 4, 7, 9, 12, 14, 16, 19];

export class RunningLights implements CalibrationStage {
  private readonly lights: Light[] = [];
  private readonly list: CalibrationTarget[] = [];
  private lit: string | null = null;
  private time = 0;
  private hits = 0;
  private ended = false;
  active = true;

  constructor(
    nodes: { node: Object3D; light: "red" | "green" | "white" }[],
    parent: Object3D,
    private readonly camera: PerspectiveCamera,
    private readonly effects: Effects,
    private readonly sound: Sound,
  ) {
    const glow = glowTexture();
    const lensGeo = new SphereGeometry(0.07, 16, 12);
    nodes.forEach((n, i) => {
      const id = `light.${i + 1}`;
      const base = KIND[n.light].clone();
      const lens = new Mesh(lensGeo, new MeshBasicMaterial({ color: base.clone() }));
      const pos = n.node.getWorldPosition(new Vector3());
      lens.position.copy(pos);
      const flare = new Sprite(new SpriteMaterial({ map: glow, color: base.clone(), blending: AdditiveBlending, transparent: true, depthWrite: false }));
      flare.position.copy(pos);
      flare.scale.setScalar(1.2);
      flare.renderOrder = 8;
      parent.add(lens, flare);
      this.lights.push({ id, node: n.node, base, lens, flare, hit: false, target: { id, x: 0.5, y: 0.5, radius: 0.04 }, pos });
    });
  }

  begin(): void {
    this.reset();
  }

  /** Where each light is on screen, and the zone that counts as a hit. */
  targets(): CalibrationTarget[] {
    this.list.length = 0;
    this.camera.updateMatrixWorld();
    for (const l of this.lights) {
      // Its flare's size on screen: 0.6 m round the lamp.
      if (l.hit || !placeTarget(l.target, this.camera, l.pos, 0.6)) continue;
      if (l.target.x < 0.02 || l.target.x > 0.98 || l.target.y < 0.02 || l.target.y > 0.98) continue;
      this.list.push(l.target);
    }
    return this.list;
  }

  light(id: string | null): void {
    this.lit = id;
  }

  hit(id: string): void {
    const l = this.lights.find((x) => x.id === id);
    if (!l || l.hit) return;
    l.hit = true;
    if (this.lit === id) this.lit = null;
    this.effects.pulse(l.pos, l.pos.distanceTo(this.camera.position));
    // Each good hit a step up the pentatonic scale: the check plays a little tune.
    this.sound.play("calib_hit", { volume: 0.8, rate: Math.pow(2, (STEPS[Math.min(STEPS.length - 1, this.hits)] as number) / 12) });
    this.hits++;
  }

  miss(_id: string, _x: number, _y: number): void {
    // The laser's own beam shows where the shot went.
  }

  done(): void {
    if (this.ended) return;
    this.ended = true;
    this.lit = null;
    this.sound.play("calib_done");
  }

  reset(): void {
    this.active = true;
    this.ended = false;
    this.hits = 0;
    this.lit = null;
    for (const l of this.lights) l.hit = false;
  }

  /** The lit one blinks brighter; hit ones stay steady green; the rest keep a slow beacon's blink. */
  update(dt: number): void {
    this.time += dt;
    for (const [i, l] of this.lights.entries()) {
      const lens = l.lens.material as MeshBasicMaterial;
      const flare = l.flare.material as SpriteMaterial;
      const d = l.pos.distanceTo(this.camera.position);
      let k: number;
      let colour = l.base;
      if (l.hit && !this.ended) {
        colour = HIT;
        k = 1;
      } else if (l.id === this.lit) {
        k = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(this.time * 9));
      } else {
        // A navigation beacon's blink, each on its own beat.
        const phase = (this.time * 0.8 + i * 0.37) % 1;
        k = phase < 0.12 ? 1 : 0.25;
      }
      lens.color.copy(colour).multiplyScalar(0.35 + 0.65 * k);
      flare.color.copy(colour).multiplyScalar(k * 0.5);
      const lit = l.id === this.lit ? 2.2 : 1;
      // About the same size on screen near or far: a beacon, not a lamp in your face.
      l.flare.scale.setScalar(Math.min(1.6, Math.max(0.12, d * 0.035)) * lit * (0.6 + 0.4 * k));
    }
  }

  get finished(): boolean {
    return this.lights.every((l) => l.hit);
  }
}
