/**
 * Handheld's sound: a Web Audio engine and a library of sounds synthesised in
 * code at load time — no audio file is downloaded or shipped.
 *
 * The app:
 *
 *     const audio = await createAudioBus({ muted: stored, volume });   // once, after a user gesture
 *     audio.setMuted(true);                                             // the app stores the choice
 *     audio.setVolume(0.6);                                             // and this one
 *
 * A game, in its ``load(ctx, onProgress)``:
 *
 *     await loadSoundPack(ctx.audio, "western", (f) => onProgress(0.2 * f));
 *
 * and in play:
 *
 *     ctx.audio.play("bandit_shot", { distance: 38, pan: -0.3 });
 *     const stopWind = ctx.audio.loop("wind");
 *     ctx.audio.setFilter("hurt", 0.34);
 *
 * Every cue name, and how each is played, is in ./cues/table.ts.
 */
import type { AudioBus, CueOptions } from "../engine/types";
import { CUE_NAMES, type Pack } from "./cues/table";
import { WebAudioEngine } from "./engine";
import type { GenerationReport } from "./library";
import type { StreetSpace } from "./routing";
import type { AudioEngine } from "./types";

export type { AudioEngine } from "./types";
export type { Pack } from "./cues/table";
export type { GenerationReport } from "./library";
export { CUE_NAMES };

/** An AudioBus that plays nothing: for tests, for a browser without Web Audio, and before sound is allowed. */
export class NullAudioBus implements AudioEngine {
  private _muted: boolean;
  private _volume = 1;
  readonly generation: readonly GenerationReport[] = [];

  constructor(muted = true) {
    this._muted = muted;
  }

  get muted(): boolean {
    return this._muted;
  }

  setMuted(muted: boolean): void {
    this._muted = muted;
  }

  get volume(): number {
    return this._volume;
  }

  setVolume(volume: number): void {
    this._volume = Math.min(1, Math.max(0, Number.isFinite(volume) ? volume : 0));
  }

  play(_cue: string, _options?: CueOptions): void {}

  loop(_cue: string, _options?: CueOptions): () => void {
    return () => {};
  }

  setFilter(_name: "hurt" | "slowmo", _amount: number): void {}

  hush(): void {}

  load(_pack: Pack, onProgress?: (fraction: number) => void): Promise<void> {
    onProgress?.(1);
    return Promise.resolve();
  }

  setSpace(_space: Partial<StreetSpace>): void {}

  dispose(): void {}
}

/**
 * The game's sound. The app calls this once, after a user gesture (browsers
 * only start audio after one). It never throws: without Web Audio it returns
 * a silent bus. The interface's sounds start synthesising at once; a game's
 * pack when the game asks for it (loadSoundPack) or first plays one of them.
 */
export async function createAudioBus(options: { muted: boolean; volume?: number }): Promise<AudioEngine> {
  const scope = globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  const Context = scope.AudioContext ?? scope.webkitAudioContext;
  const silent = (): AudioEngine => {
    const bus = new NullAudioBus(options.muted);
    bus.setVolume(options.volume ?? 1);
    return bus;
  };
  if (!Context) return silent();
  try {
    const engine = new WebAudioEngine(new Context({ latencyHint: "interactive" }), options);
    void engine.load("core");
    return engine;
  } catch (error) {
    console.warn("Handheld audio: Web Audio is unavailable, playing silently", error);
    return silent();
  }
}

/**
 * Synthesise a game's sounds, reporting progress 0..1 — for a game's
 * loading bar. Works with any AudioBus (a silent one reports done at once).
 */
export function loadSoundPack(bus: AudioBus, pack: Pack, onProgress?: (fraction: number) => void): Promise<void> {
  const engine = bus as Partial<AudioEngine>;
  if (typeof engine.load === "function") return engine.load(pack, onProgress);
  onProgress?.(1);
  return Promise.resolve();
}
