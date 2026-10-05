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

export const TRACKS: TrackDef[] = [MEADOW_LOOP];

export function trackById(id: string): TrackDef {
  return TRACKS.find((track) => track.id === id) ?? TRACKS[0]!;
}
