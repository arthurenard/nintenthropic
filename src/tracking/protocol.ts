/** Messages between the page and the tracking worker. */
import type { FaceReading, Landmark } from "./types";

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
      /** How many hands the landmarker looks for: 1 in the game (see input/trust.ts); 2 only to measure. */
      hands?: number;
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
      landmarks: Landmark[] | null;
      handedness: "Left" | "Right" | null;
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
