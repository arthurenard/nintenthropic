/** Messages between the page and the tracking worker. */
import type { FaceReading, SeenHand } from "./types";

export type ToWorker =
  | {
      type: "init";
      /** The ES-module loader script's URL (a module worker cannot run the classic one). */
      loader: string;
      wasm: ArrayBuffer;
      /** The runtime's binary on the site, for a face landmarker started later (cached by then). */
      binary: string;
      model: ArrayBuffer;
      prefer: "GPU" | "CPU";
      /** How many hands the landmarker looks for: 1 in the shooting games (see input/trust.ts); 2 for Grip Prix's wheel, 4 for two wheels on one camera. */
      hands?: number;
      /** Detection and presence confidence, 0..1 (0.5 when absent; lower for three or four players on one camera, see handConfidence). */
      confidence?: number;
      /**
       * Players sharing the camera, read in tiles (tiles.ts): one landmarker for each of this many
       * vertical slices of the picture, two hands to a slice, so small hands keep their pixels. 1 or absent: the whole picture.
       */
      tiles?: number;
      /** The face landmarker's model, for a game that reads the eye; it can also come later ("face"). */
      face?: ArrayBuffer;
    }
  | {
      /** Add the face landmarker, for the first game that reads the eye. */
      type: "face";
      model: ArrayBuffer;
    }
  | {
      type: "frame";
      image: VideoFrame | ImageBitmap;
      /** Strictly increasing, in ms, as the landmarkers insist. */
      timestamp: number;
      capturedAt: number;
      sequence: number;
      /** Read the face on this frame too (after the hand, whose result goes first). */
      face?: boolean;
    };

export type FromWorker =
  | { type: "ready"; delegate: "GPU" | "CPU"; face: boolean }
  | { type: "failed"; message: string }
  | { type: "face-ready"; delegate: "GPU" | "CPU" }
  | { type: "face-failed"; message: string }
  | {
      type: "result";
      sequence: number;
      capturedAt: number;
      /** Every hand seen, the first one first (empty when none). */
      hands: SeenHand[];
      /** Time spent in the landmarker, ms. */
      inference: number;
      /** A face reading for this frame follows. */
      face: boolean;
    }
  | {
      type: "face-result";
      sequence: number;
      capturedAt: number;
      /** The eyes, or null when no face was found. */
      eyes: FaceReading | null;
      /** Time spent in the face landmarker, ms. */
      inference: number;
    };
