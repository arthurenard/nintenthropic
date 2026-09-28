/**
 * What the station sounds like when nothing is happening: its fans and
 * pumps, always; now and then the radio - a Quindar beep and a few words
 * from the ground; the hull ticking as it crosses from sun to shadow and
 * back; and the master alarm's soft two-tone while any pane is low.
 */
import type { Sound } from "../../../engine/world/sound";

export class Ambient {
  private radioIn = 18;
  private alarmOn = false;
  running = false;

  constructor(
    private readonly sound: Sound,
    private readonly random: () => number,
  ) {}

  /** The station's hum: started once the world is up, kept over pauses. */
  start(): void {
    this.sound.loop("hum", "orbit_hum", { volume: 0.8 });
  }

  /** The master alarm, on while a pane is under 35. */
  alarm(on: boolean): void {
    if (on === this.alarmOn) return;
    this.alarmOn = on;
    if (on) this.sound.loop("alarm", "orbit_alarm", { volume: 0.7 });
    else this.sound.stopLoop("alarm");
  }

  /** The hull ticking with the change of temperature (sunset, sunrise). */
  creak(): void {
    const n = 1 + Math.floor(this.random() * 3);
    for (let i = 0; i < n; i++) this.sound.play("orbit_creak", { volume: 0.5 + this.random() * 0.4, delay: this.random() * 1.5, pan: this.random() * 1.6 - 0.8 });
  }

  update(dt: number): void {
    if (!this.running) return;
    this.radioIn -= dt;
    if (this.radioIn <= 0) {
      this.radioIn = 35 + this.random() * 40;
      this.sound.play("orbit_radio", { volume: 0.55, pan: 0.35 });
    }
  }

  stop(): void {
    this.alarm(false);
    this.running = false;
  }
}
