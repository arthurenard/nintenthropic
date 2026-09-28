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

/**
 * What the face landmarker saw of the eyes in one camera frame: its
 * blendshapes' eyeBlinkLeft and eyeBlinkRight, 0 (open) to 1 (shut), as the
 * camera sees them (the player's left eye is the camera's right).
 */
export interface FaceReading {
  blinkLeft: number;
  blinkRight: number;
}

/**
 * The face in one camera frame, for a game that reads the eye (Overwatch
 * Ridge's scope). Published after the frame's HandFrame, so the aim never
 * waits for the face; on every camera frame the face is read on (every
 * frame, or every other: see tracker.ts).
 */
export interface FaceFrame {
  /** The eyes, or null when no face was found. */
  eyes: FaceReading | null;
  /** When the camera captured the frame, on the performance.now() clock, in ms. */
  capturedAt: number;
}

/** Anything that publishes HandFrames: the camera tracker, or a script in tests. */
export interface HandSource {
  /** Called with every new frame; returns a function that stops listening. */
  subscribe(listener: (frame: HandFrame) => void): () => void;
  /** The newest frame, if there has been one. */
  latest(): HandFrame | null;
  /**
   * Called with the face on every frame it is read on, while the face is
   * being read (see Tracker.readFace). Optional: a source that cannot read
   * faces has none.
   */
  subscribeFace?(listener: (face: FaceFrame) => void): () => void;
}
