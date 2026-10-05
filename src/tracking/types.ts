/** One of MediaPipe's 21 hand points, in the camera image: x right, y down,
 * both 0..1 of the frame; z is depth relative to the wrist (unused for aim). */
export interface Landmark {
  x: number;
  y: number;
  z: number;
}

/**
 * One hand the landmarker found in a camera frame. A game that steers with
 * both hands (Grip Prix) reads every one of these; the shooting games only
 * ever look at HandFrame.landmarks, which is the first hand's.
 */
export interface SeenHand {
  /** The 21 points in the camera image, as for HandFrame.landmarks (not mirrored). */
  landmarks: readonly Landmark[];
  /**
   * The same 21 points in MediaPipe's world space: metres, 3D, origin near the
   * hand's centre. Distances between them do not depend on which way the hand
   * faces the camera, which is what tells a fist from an open hand whether
   * the palm, the knuckles or the side of the fist is turned to the lens.
   */
  world: readonly Landmark[];
  /** Which hand MediaPipe thinks it is, as the camera sees it; null when it did not say. */
  handedness: "Left" | "Right" | null;
  /** MediaPipe's confidence in that handedness, 0..1. */
  score: number;
}

/**
 * What the tracker saw in one camera frame. Published once per new camera
 * frame, never twice for the same one.
 */
export interface HandFrame {
  /** The first hand's 21 points as the camera sees it (not mirrored), or null when no hand is in view. */
  landmarks: readonly Landmark[] | null;
  /** Which hand MediaPipe thinks the first one is, as the camera sees it. */
  handedness: "Left" | "Right" | null;
  /**
   * Every hand seen, as many as the tracker was asked to look for (the first
   * is the one `landmarks` and `handedness` describe; empty when none is in
   * view). The shooting games ask for one hand and ignore this.
   */
  hands: readonly SeenHand[];
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
