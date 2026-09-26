/** One of MediaPipe's 21 hand points, in the camera image: x right, y down,
 * both 0..1 of the frame; z is depth relative to the wrist (unused for aim). */
export interface Landmark {
  x: number;
  y: number;
  z: number;
}

/**
 * What the tracker saw in one camera frame. Published once per new camera
 * frame, never twice for the same one.
 */
export interface HandFrame {
  /** The hand's 21 points as the camera sees it (not mirrored), or null when no hand is in view. */
  landmarks: readonly Landmark[] | null;
  /** Which hand MediaPipe thinks it is, as the camera sees it. */
  handedness: "Left" | "Right" | null;
  /** When the camera captured the frame, on the performance.now() clock, in ms. */
  capturedAt: number;
  /** Counts camera frames: a new number is a new frame. */
  sequence: number;
}

/** Anything that publishes HandFrames: the camera tracker, or a script in tests. */
export interface HandSource {
  /** Called with every new frame; returns a function that stops listening. */
  subscribe(listener: (frame: HandFrame) => void): () => void;
  /** The newest frame, if there has been one. */
  latest(): HandFrame | null;
}
