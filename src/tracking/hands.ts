/**
 * MediaPipe's answer for one camera frame as the tracker's own SeenHands,
 * shared by the worker and the page tracker so both read it the same way.
 */
import type { Landmark, SeenHand } from "./types";

/** The parts of a HandLandmarkerResult the tracker reads (so a test needs no MediaPipe). */
export interface RawHands {
  landmarks: readonly (readonly Landmark[])[];
  worldLandmarks?: readonly (readonly Landmark[])[];
  handedness?: readonly (readonly { categoryName: string; score: number }[])[];
}

const copy = (points: readonly Landmark[]): Landmark[] => points.map(({ x, y, z }) => ({ x, y, z }));

/**
 * Every complete hand in the result (21 points), in MediaPipe's order, which
 * is also the order the first hand has always been taken in.
 *
 * Should a hand come without its world points (MediaPipe always sends them,
 * but a hand with no metric 3D must not vanish from the shooting games), the
 * image points stand in: the fist-or-open test then works from a flatter
 * picture rather than failing.
 */
export function seenHands(result: RawHands): SeenHand[] {
  const hands: SeenHand[] = [];
  result.landmarks.forEach((points, index) => {
    if (points.length < 21) return;
    const world = result.worldLandmarks?.[index];
    const category = result.handedness?.[index]?.[0];
    const name = category?.categoryName;
    hands.push({
      landmarks: copy(points),
      world: world && world.length >= 21 ? copy(world) : copy(points),
      handedness: name === "Left" || name === "Right" ? name : null,
      score: category?.score ?? 0,
    });
  });
  return hands;
}
