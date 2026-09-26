import type { AudioBus } from "../engine/types";
import type { Pack } from "./cues/table";
import type { GenerationReport } from "./library";
import type { StreetSpace } from "./routing";

/**
 * The AudioBus of the contract, plus what the app (not the games) needs:
 * mute, loading a game's sounds with progress, and a clean shutdown.
 */
export interface AudioEngine extends AudioBus {
  /** Mute or unmute; the app stores the choice and passes it back to createAudioBus next time. */
  setMuted(muted: boolean): void;
  /** Synthesise a pack's sounds (resolves when all are ready; plays before then still work). */
  load(pack: Pack, onProgress?: (fraction: number) => void): Promise<void>;
  /** The walls the street's echoes come off (Dust Creek by default). */
  setSpace(space: Partial<StreetSpace>): void;
  /** How long each pack took to synthesise. */
  readonly generation: readonly GenerationReport[];
  dispose(): void;
}
