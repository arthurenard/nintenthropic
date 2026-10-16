/**
 * The eyes from a face landmarker's result: all Handheld keeps of a face. Apart
 * from face.ts so the page's tracker can read results without loading
 * MediaPipe itself (that runs in the worker).
 */
import type { FaceLandmarkerResult } from "@mediapipe/tasks-vision";
import type { FaceReading } from "./types";

/** The eyes' blink scores from a result, or null when there was no face. */
export function eyesFrom(result: FaceLandmarkerResult): FaceReading | null {
  const shapes = result.faceBlendshapes?.[0]?.categories;
  if (!shapes?.length) return null;
  let blinkLeft = 0;
  let blinkRight = 0;
  for (const shape of shapes) {
    if (shape.categoryName === "eyeBlinkLeft") blinkLeft = shape.score;
    else if (shape.categoryName === "eyeBlinkRight") blinkRight = shape.score;
  }
  return { blinkLeft, blinkRight };
}
