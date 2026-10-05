/**
 * Grip Prix's tracks, in the order the lobby offers them. Each is data only:
 * the sim and the picture build everything else from it (geometry.ts).
 * The geometry test checks every track here never passes close to itself.
 */
import type { TrackDef } from "./geometry";

/** A first track: a long start straight, a sweeping hill, an S, a hairpin, and home. About 1 km. */
export const MEADOW_LOOP: TrackDef = {
  id: "meadow-loop",
  name: "Meadow Loop",
  theme: "meadow",
  laps: 3,
  width: 14,
  points: [
    { x: 0, z: 0 },
    { x: 0, z: 70 },
    { x: 0, z: 140 },
    { x: 20, z: 185, y: 1 },
    { x: 65, z: 205, y: 3 },
    { x: 115, z: 195, y: 3.5 },
    { x: 145, z: 165, y: 2 },
    { x: 165, z: 130 },
    { x: 200, z: 115, width: 13 },
    { x: 240, z: 125, width: 13 },
    { x: 270, z: 110 },
    { x: 280, z: 70 },
    { x: 270, z: 20 },
    { x: 245, z: -20 },
    { x: 205, z: -35, width: 16 },
    { x: 160, z: -20, width: 16 },
    { x: 140, z: 15 },
    { x: 115, z: 40 },
    { x: 80, z: 35 },
    { x: 60, z: 0 },
    { x: 45, z: -40 },
    { x: 15, z: -55 },
    { x: -5, z: -35 },
  ],
  itemRows: [0.22, 0.55, 0.82],
  boostPads: [
    { at: 0.37, offset: 0 },
    { at: 0.68, offset: 3 },
  ],
};

/**
 * A winding gorge: a long climb into the hills, a ridge road about twelve
 * metres above the start, and a tumbling descent through a narrow neck
 * (12 m) before the final bends. Twisty rather than fast: the tightest bend
 * is about 16 m across. About 1.1 km.
 */
export const CANYON_RUN: TrackDef = {
  id: "canyon-run",
  name: "Canyon Run",
  theme: "canyon",
  laps: 3,
  width: 14,
  points: [
    { x: 0, z: 0 },
    { x: 0, z: 36 },
    { x: -3, z: 71, y: 0.2 },
    { x: -10, z: 107, y: 2.1 },
    { x: -45, z: 129, y: 3.1 },
    { x: -60, z: 156, y: 5.6 },
    { x: -71, z: 200, y: 8.5 },
    { x: -112, z: 220, y: 9.7 },
    { x: -145, z: 187, y: 12.0 },
    { x: -153, z: 146, y: 11.4 },
    { x: -177, z: 124, y: 10.6 },
    { x: -219, z: 105, y: 10.8 },
    { x: -239, z: 71, y: 11.4 },
    { x: -222, z: 30, y: 11.1 },
    { x: -200, z: -5, y: 9.4 },
    { x: -209, z: -40, y: 8.5 },
    { x: -232, z: -80, y: 5.4 },
    { x: -225, z: -119, y: 3.9, width: 12 },
    { x: -184, z: -139, y: 2.4, width: 12 },
    { x: -148, z: -148, y: 1.5, width: 12 },
    { x: -129, z: -172, y: 2.8 },
    { x: -90, z: -198, y: 4.0 },
    { x: -52, z: -177, y: 3.2 },
    { x: -48, z: -131, y: 2.1 },
    { x: -43, z: -95, y: 1.5 },
    { x: -14, z: -70, y: 0.4 },
    { x: -4, z: -35, y: 0.2 },
  ],
  itemRows: [0.16, 0.4, 0.66, 0.9],
  boostPads: [
    { at: 0.27, offset: -2 },
    { at: 0.8, offset: 2 },
  ],
};

/**
 * A flat quay circuit: a long straight along the water, a stack of right
 * angles round the warehouses and a chicane of four more by the cranes. Wide
 * (16 m) and fast: the straights are 250 m and more. About 1.2 km.
 */
export const HARBOUR_LIGHTS: TrackDef = {
  id: "harbour-lights",
  name: "Harbour Lights",
  theme: "harbour",
  laps: 3,
  width: 16,
  points: [
    { x: 0, z: 0 },
    { x: 0, z: 12 },
    { x: 0, z: 75 },
    { x: 0, z: 138 },
    { x: 0, z: 200 },
    { x: 2, z: 211 },
    { x: 9, z: 221 },
    { x: 19, z: 228 },
    { x: 30, z: 230 },
    { x: 95, z: 230 },
    { x: 106, z: 228 },
    { x: 116, z: 221 },
    { x: 123, z: 211 },
    { x: 125, z: 200 },
    { x: 125, z: 180 },
    { x: 127, z: 169 },
    { x: 134, z: 159 },
    { x: 144, z: 152 },
    { x: 155, z: 150 },
    { x: 235, z: 150 },
    { x: 246, z: 148 },
    { x: 256, z: 141 },
    { x: 263, z: 131 },
    { x: 265, z: 120 },
    { x: 265, z: 70 },
    { x: 265, z: 20 },
    { x: 265, z: -30 },
    { x: 263, z: -41 },
    { x: 256, z: -51 },
    { x: 246, z: -58 },
    { x: 235, z: -60 },
    { x: 200, z: -60 },
    { x: 189, z: -58 },
    { x: 179, z: -51 },
    { x: 172, z: -41 },
    { x: 170, z: -30 },
    { x: 170, z: 5 },
    { x: 168, z: 16 },
    { x: 161, z: 26 },
    { x: 151, z: 33 },
    { x: 140, z: 35 },
    { x: 110, z: 35 },
    { x: 99, z: 33 },
    { x: 89, z: 26 },
    { x: 82, z: 16 },
    { x: 80, z: 5 },
    { x: 80, z: -50 },
    { x: 78, z: -61 },
    { x: 71, z: -71 },
    { x: 61, z: -78 },
    { x: 50, z: -80 },
    { x: 30, z: -80 },
    { x: 19, z: -78 },
    { x: 9, z: -71 },
    { x: 2, z: -61 },
    { x: 0, z: -50 },
  ],
  itemRows: [0.1, 0.36, 0.6, 0.85],
  boostPads: [
    { at: 0.04, offset: 0 },
    { at: 0.5, offset: -3 },
    { at: 0.74, offset: 3 },
  ],
};

export const TRACKS: TrackDef[] = [MEADOW_LOOP, CANYON_RUN, HARBOUR_LIGHTS];

export function trackById(id: string): TrackDef {
  return TRACKS.find((track) => track.id === id) ?? TRACKS[0]!;
}
