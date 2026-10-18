import { Vector3, type PointLight, type ShaderMaterial } from "three";
import type { Sound } from "../../../engine/world/sound";
import type { NightUniforms } from "./shading";

/**
 * The night breathing between shots: the sodium streetlight buzzing and,
 * now and then, faltering - a stutter, a dropout and the slow warm-up back
 * (it steadies in the breathers); the crickets and frogs that fall silent
 * when the dead are close and start again when they are gone; the wind in
 * the corn; the power lines; a dog far across the fields, an owl.
 */
export class Ambient {
  /** The lamp's output now: 1 steady … 0 out. */
  on = 1;
  private faultIn = 8;
  private fault = 0;
  private dropout = 0;
  private warm = 1;
  private crickets = false;
  private cricketsHold = 0;
  private dogIn = 24;
  private owlIn = 40;
  private readonly lamp = new Vector3();
  /** The breather: the lamp steadies. */
  steady = false;
  /** Settings.reducedFlashing: the lamp's stutter becomes a slow dip, never a strobe. */
  reducedFlashing = false;
  /** The lamp as shown (eased, with reduced flashing). */
  private shown = 1;
  private time = 0;

  constructor(
    private readonly sound: Sound,
    private readonly u: NightUniforms,
    private readonly street: PointLight,
    private readonly streetPower: number,
    private readonly lampGlow: ShaderMaterial | null,
    lampAt: Vector3,
    private readonly random: () => number,
  ) {
    this.lamp.copy(lampAt);
  }

  /** The night's beds: from the moment the road is loaded, through the aim check. */
  start(): void {
    this.sound.loop("wind", "night_wind", { volume: 0.55 });
    this.sound.loop("hum", "night_hum", { volume: 0.4 });
    this.sound.loopAt("buzz", "night_buzz", this.lamp, 0.75);
    this.setCrickets(true);
  }

  private setCrickets(on: boolean): void {
    if (on === this.crickets) return;
    this.crickets = on;
    if (on) this.sound.loop("crickets", "night_crickets", { volume: 0.8 });
    else this.sound.stopLoop("crickets");
  }

  /** `nearest`: how far the nearest of the living dead is (Infinity for none). */
  update(dt: number, nearest: number): void {
    this.time += dt;
    // The crickets: silent while the dead are within 18 m, back when none is within 26 m.
    this.cricketsHold -= dt;
    if (nearest < 18 && this.crickets) {
      this.setCrickets(false);
      this.cricketsHold = 2;
    } else if (!this.crickets && nearest > 26 && this.cricketsHold <= 0) {
      this.setCrickets(true);
    }
    this.flicker(dt);
    // Far-off life.
    this.dogIn -= dt;
    if (this.dogIn <= 0) {
      this.dogIn = 25 + this.random() * 30;
      this.sound.play("night_dog", { volume: 0.6, pan: this.random() * 1.6 - 0.8, distance: 180 + this.random() * 200 });
    }
    this.owlIn -= dt;
    if (this.owlIn <= 0) {
      this.owlIn = 35 + this.random() * 40;
      this.sound.play("night_owl", { volume: 0.5, pan: 0.3 + this.random() * 0.6, distance: 70 + this.random() * 60 });
    }
    this.u.uWind.value = 0.55 + 0.35 * Math.sin(this.time * 0.21) * Math.sin(this.time * 0.13 + 1);
  }

  /** The lamp: steady, with now and then a stutter, or a dropout and a warm-up. */
  private flicker(dt: number): void {
    if (this.steady) {
      this.fault = 0;
      this.dropout = 0;
      this.warm = Math.min(1, this.warm + dt * 0.8);
      this.on = this.warm;
    } else {
      this.faultIn -= dt;
      if (this.faultIn <= 0 && this.fault <= 0 && this.dropout <= 0) {
        this.faultIn = 7 + this.random() * 13;
        if (this.random() < 0.3) {
          this.dropout = 0.35 + this.random() * 0.6;
          this.warm = 0;
        } else {
          this.fault = 0.4 + this.random() * 1.1;
        }
        this.sound.at("night_flicker", this.lamp, 0.9, 0.9 + this.random() * 0.2);
      }
      if (this.dropout > 0) {
        this.dropout -= dt;
        this.on = 0.04;
      } else if (this.fault > 0) {
        this.fault -= dt;
        // A sodium lamp's stutter: sharp dips at twenty-odd a second.
        const s = Math.sin(this.time * 131) * Math.sin(this.time * 47 + 2);
        this.on = s > 0.25 ? 0.12 + this.random() * 0.2 : 0.85 + this.random() * 0.15;
      } else {
        // The warm-up after a dropout: sodium comes back slowly, pink then orange.
        this.warm = Math.min(1, this.warm + dt * 0.7);
        this.on = 0.1 + 0.9 * this.warm * this.warm;
      }
    }
    // With reduced flashing the lamp dims and comes back over a third of a
    // second: a sodium lamp failing, not a strobe.
    this.shown = this.reducedFlashing ? this.shown + (Math.max(0.35, this.on) - this.shown) * Math.min(1, dt / 0.35) : this.on;
    this.u.uStreetOn.value = this.shown;
    this.street.intensity = this.streetPower * this.shown;
    if (this.lampGlow) {
      const full = typeof this.lampGlow.userData["glow"] === "number" ? (this.lampGlow.userData["glow"] as number) : 1;
      (this.lampGlow.uniforms["uGlow"] as { value: number }).value = full * (0.04 + 0.96 * this.shown);
    }
  }

  reset(): void {
    this.on = 1;
    this.shown = 1;
    this.warm = 1;
    this.fault = 0;
    this.dropout = 0;
    this.faultIn = 8;
    this.steady = false;
  }
}
