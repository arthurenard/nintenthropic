/**
 * The page's sound. Browsers start audio only after a gesture, so the page is
 * silent until the player's first click or key press (or Play, at the latest),
 * which makes the sound engine; until then a silent stand-in keeps the volume
 * and the mute to hand it. The two Mute buttons - the bar's and the pause
 * sheet's - say which it is.
 */
import type { AudioEngine } from "../audio/index";
import { $ } from "../ui/dom";
import { prefs } from "./prefs";

/** What the page and its games use of the sound engine. */
export type PageAudio = Pick<AudioEngine, "play" | "loop" | "setFilter" | "setMuted" | "muted" | "setVolume" | "volume">;

/** Silence, until the sound engine arrives with the first gesture. */
function silence(muted: boolean): PageAudio {
  let quiet = muted;
  let level = 1;
  return {
    get muted() {
      return quiet;
    },
    get volume() {
      return level;
    },
    play() {},
    loop: () => () => {},
    setFilter() {},
    setMuted(value: boolean) {
      quiet = value;
    },
    setVolume(value: number) {
      level = value;
    },
  };
}

export class PageSound {
  /** The sound engine once it is made; silence before. */
  audio: PageAudio = silence(prefs.muted);
  /** The player's mute, remembered between visits. */
  muted = prefs.muted;
  private ready: Promise<void> | null = null;

  /** @param volume The player's volume (Settings), read when the engine is made. */
  constructor(private readonly volume: () => number) {}

  /**
   * Makes the sound engine, once; the interface's sounds start synthesising
   * at once, off the page. Its code is fetched then too: the first screen
   * does not wait for it.
   */
  wake(): Promise<void> {
    this.ready ??= import("../audio/index").then(({ createAudioBus }) => createAudioBus({ muted: this.muted, volume: this.volume() })).then(
      (audio) => {
        this.audio = audio;
        audio.setMuted(this.muted);
        audio.setVolume(this.volume());
      },
      (error: unknown) => console.warn("Sound is unavailable.", error),
    );
    return this.ready;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    prefs.muted = muted;
    this.audio.setMuted(muted);
    for (const id of ["mute", "sheet-mute"]) {
      $(id).setAttribute("aria-pressed", String(muted));
      $(id).setAttribute("aria-label", muted ? "Unmute" : "Mute");
    }
  }
}
