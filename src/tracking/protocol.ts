/** Messages between the page and the tracking worker. */
import type { Landmark } from "./types";

export type ToWorker =
  | {
      type: "init";
      /** The ES-module loader script's URL (a module worker cannot run the classic one). */
      loader: string;
      wasm: ArrayBuffer;
      model: ArrayBuffer;
      prefer: "GPU" | "CPU";
    }
  | {
      type: "frame";
      image: VideoFrame | ImageBitmap;
      /** Strictly increasing, in ms, as the landmarker insists. */
      timestamp: number;
      capturedAt: number;
      sequence: number;
    };

export type FromWorker =
  | { type: "ready"; delegate: "GPU" | "CPU" }
  | { type: "failed"; message: string }
  | {
      type: "result";
      sequence: number;
      capturedAt: number;
      landmarks: Landmark[] | null;
      handedness: "Left" | "Right" | null;
      /** Time spent in the landmarker, ms. */
      inference: number;
    };
