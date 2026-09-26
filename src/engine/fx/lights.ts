import { Color, PointLight, type Object3D, type Vector3 } from "three";

/**
 * A few point lights that live in the scene for good and flash on demand
 * (muzzle flashes, explosions). Adding or removing a light changes every lit
 * material's shader and stalls the frame while it recompiles, so the pool is
 * fixed: an idle light just sits at intensity zero.
 */
export class LightPool {
  private readonly lights: PointLight[] = [];
  private readonly peak: Float32Array;
  private readonly left: Float32Array;
  private readonly duration: Float32Array;
  private next = 0;

  constructor(parent: Object3D, count: number) {
    this.peak = new Float32Array(count);
    this.left = new Float32Array(count);
    this.duration = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const l = new PointLight(0xffffff, 0, 8, 2);
      l.castShadow = false;
      parent.add(l);
      this.lights.push(l);
    }
  }

  flash(at: Vector3, color: Color, intensity: number, distance: number, duration: number): void {
    if (this.lights.length === 0) return;
    const i = this.next;
    this.next = (this.next + 1) % this.lights.length;
    const l = this.lights[i] as PointLight;
    l.position.copy(at);
    l.color.copy(color);
    l.distance = distance;
    this.peak[i] = intensity;
    this.left[i] = duration;
    this.duration[i] = duration;
    l.intensity = intensity;
  }

  update(dt: number): void {
    for (let i = 0; i < this.lights.length; i++) {
      const l = this.lights[i] as PointLight;
      if ((this.left[i] as number) <= 0) {
        l.intensity = 0;
        continue;
      }
      this.left[i] = (this.left[i] as number) - dt;
      const k = Math.max(0, (this.left[i] as number) / (this.duration[i] as number));
      l.intensity = (this.peak[i] as number) * k * k;
    }
  }

  dispose(): void {
    for (const l of this.lights) l.removeFromParent();
  }
}
