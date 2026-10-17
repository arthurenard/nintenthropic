/**
 * MediaPipe's answer for one camera frame as the tracker's own SeenHands,
 * shared by the worker and the page tracker so both read it the same way.
 */
import type { Landmark, SeenHand } from "./types";

/** How many hands are looked for when this many players share a camera: two each, at most eight. */
export function handsFor(players: number): number {
  return 2 * Math.max(1, Math.min(4, Math.round(players)));
}

/**
 * Three or four players on one camera stand side by side a metre or two
 * back, so each hand is small. Detection and presence confidence come down a
 * little (0.5 to 0.4) for that crowd, and the camera is asked for more
 * pixels; one or two players keep the settings they have always had.
 */
export function isCrowd(hands: number): boolean {
  return hands >= 6;
}

export function handConfidence(hands: number): number {
  return isCrowd(hands) ? 0.4 : 0.5;
}

/**
 * How many side-by-side tiles the picture is read in: one for each player once two or more share the camera (tiles.ts),
 * else the whole picture. Two players' tiles give each palm nearly twice the pixels in MediaPipe's palm detector (a
 * tile 0.56 of the picture wide is squeezed into its 192-pixel square instead of all of it), and are read side by side.
 */
export function tilesFor(hands: number): number {
  return hands >= 4 ? Math.floor(hands / 2) : 1;
}

/**
 * The worker each tile is read in, and its delegate (tracker.ts, lanes), all at once: the first on the GPU and the others
 * on the CPU, or for four players, on a machine with the cores for it, all on the CPU. Landmarkers on the GPU beside a
 * race take turns on it with the race and with each other. Measured on an M4 Max beside as many views as players
 * (docs/GRIP_PRIX.md, Performance): three players read by one worker, tile after tile, 10.3 reads a second each; a
 * worker each all on the GPU, 4.8; the first on the GPU and the others on the CPU, with the race giving up pixels for
 * them (app/handsFirst.ts), 22.5 to 25.2. Four: 7 by one worker; 21.5 to 22.3 once all four were on the CPU, 11.3 with
 * one left on the GPU. Null for the whole picture.
 */
export function lanesFor(tiles: number, cores: number = typeof navigator === "undefined" ? 8 : navigator.hardwareConcurrency || 4): ("GPU" | "CPU")[] | null {
  if (tiles <= 1) return null;
  const allCpu = tiles >= 4 && cores >= 8;
  return Array.from({ length: tiles }, (_, i) => (i === 0 && !allCpu ? "GPU" : "CPU"));
}

/** The camera size asked for: 1920x1080 for a crowd (so small hands keep their pixels), else 1280x720. */
export function cameraSize(hands: number): { width: number; height: number } {
  return isCrowd(hands) ? { width: 1920, height: 1080 } : { width: 1280, height: 720 };
}

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
