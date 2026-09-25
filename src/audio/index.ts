import type { AudioBus, CueOptions } from "../engine/types";

/** An AudioBus that plays nothing: for tests, and until the sound library lands. */
export class NullAudioBus implements AudioBus {
  readonly muted = true;
  play(_cue: string, _options?: CueOptions): void {}
  loop(_cue: string, _options?: CueOptions): () => void {
    return () => {};
  }
  setFilter(_name: "hurt" | "slowmo", _amount: number): void {}
}

/**
 * The game's sound. The app calls this once, after a user gesture (browsers
 * only start audio after one). A stub until the sound library is built.
 */
export async function createAudioBus(_options: { muted: boolean }): Promise<AudioBus> {
  return new NullAudioBus();
}
