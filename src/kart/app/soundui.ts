/**
 * The race page's sound controls: a speaker in the corner of every screen
 * but the race (Handy's own sound preference, on or off, which the arcade
 * shares), and in the pause sheet that speaker again with the Music and
 * Effects sliders. M turns sound off and on from anywhere.
 */
import { $, toast } from "../../ui/dom";
import type { SoundService } from "./services";

export class SoundControls {
  private readonly buttons = [$<HTMLButtonElement>("sound-button"), $<HTMLButtonElement>("sheet-sound")];
  private readonly music = $<HTMLInputElement>("pause-music");
  private readonly effects = $<HTMLInputElement>("pause-effects");

  constructor(private readonly sound: SoundService) {
    for (const button of this.buttons) button.addEventListener("click", () => this.toggle(false));
    this.music.addEventListener("input", () => {
      sound.setLevels({ music: Number(this.music.value) / 100 });
      this.draw();
    });
    this.effects.addEventListener("input", () => {
      sound.setLevels({ effects: Number(this.effects.value) / 100 });
      this.draw();
    });
    this.sync();
  }

  /** Sound off, or on again. `say`: the toast that tells it (for the key, which has no button to show it). */
  toggle(say = true): void {
    this.sound.setMuted(!this.sound.muted);
    this.sync();
    if (say) toast(this.sound.muted ? "Sound off." : "Sound on.", { icon: this.sound.muted ? "speaker-off" : "speaker" });
  }

  /** Shows the state as it is: the speakers, the sliders' places. */
  sync(): void {
    const muted = this.sound.muted;
    for (const button of this.buttons) {
      button.setAttribute("aria-pressed", String(muted));
      button.setAttribute("aria-label", muted ? "Turn Sound On" : "Turn Sound Off");
    }
    const levels = this.sound.levels();
    this.music.value = String(Math.round(levels.music * 100));
    this.effects.value = String(Math.round(levels.effects * 100));
    this.music.disabled = this.effects.disabled = muted;
    this.draw();
  }

  /** The sliders' filled part. */
  private draw(): void {
    this.music.style.setProperty("--value", `${this.music.value}%`);
    this.effects.style.setProperty("--value", `${this.effects.value}%`);
  }
}
