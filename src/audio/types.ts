import type { AudioBus } from "../engine/types";
import type { Pack } from "./cues/table";
import type { GenerationReport } from "./library";
import type { StreetSpace } from "./routing";

/** What a steerable loop can be told, all optional; whatever is left out stays as it was. */
export interface LoopParams {
  /** Playback rate: pitch and speed together, 1 is natural. */
  rate?: number;
  /** A multiplier on the cue's own level, 0 and up. */
  volume?: number;
  /** -1 (left) .. 1 (right). */
  pan?: number;
  /** Metres from the listener: darker and quieter with distance, as for ``play``. */
  distance?: number;
}

/**
 * A loop that can be steered while it plays: an engine whose pitch follows
 * a speedometer, a wind that rises with a gust. ``AudioBus.loop`` starts a
 * loop that can only be stopped; this one moves.
 */
export interface LoopControl {
  /** Change the loop; each change glides over ``glide`` seconds (default 0.06) so nothing steps or clicks. */
  set(params: LoopParams, glide?: number): void;
  /** Fade out and let go. Safe to call twice. */
  stop(): void;
}

/**
 * What the Web Audio engine offers beyond the bare AudioBus, for the parts of
 * Super Claude Bros. that need more than fire-and-forget cues. Optional on purpose: a
 * silent bus or a test double lacks them, and callers check before using.
 */
export interface SteerableAudio {
  /** The audio clock and graph these belong to. */
  readonly ctx: BaseAudioContext;
  /** Like ``AudioBus.loop`` but steerable (see LoopControl). */
  controlledLoop(cue: string, options?: import("../engine/types").CueOptions): LoopControl;
  /**
   * A bus for long pieces a game renders and plays itself (music): a node to
   * connect buffer sources to. It joins the master after the street's muffle,
   * so volume and mute apply and the limiter still protects the ears.
   */
  musicBus(): AudioNode;
}

/**
 * The AudioBus of the contract, plus what the app (not the games) needs:
 * mute and volume, loading a game's sounds with progress, and a clean shutdown.
 */
export interface AudioEngine extends AudioBus {
  /** Mute or unmute; the app stores the choice and passes it back to createAudioBus next time. */
  setMuted(muted: boolean): void;
  /** The master volume, 0..1 (a slider's position; the engine makes it sound even). Apart from mute. */
  setVolume(volume: number): void;
  readonly volume: number;
  /** Synthesise a pack's sounds (resolves when all are ready; plays before then still work). */
  load(pack: Pack, onProgress?: (fraction: number) => void): Promise<void>;
  /** The walls the street's echoes come off (Dust Creek by default). */
  setSpace(space: Partial<StreetSpace>): void;
  /** How long each pack took to synthesise. */
  readonly generation: readonly GenerationReport[];
  dispose(): void;
}
