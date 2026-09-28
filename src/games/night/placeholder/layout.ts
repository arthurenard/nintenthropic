/**
 * Route 9 as the placeholder builds it, in plain numbers: where the lanes
 * run, where the dead stand at the barricade, where the survivors cross,
 * where the secrets and the aim check's jars are. One source for the
 * placeholder road (./road.ts) and for the rules' tests (a synthetic road
 * with the real one's shape), so a balance measured in the tests is the
 * balance played on the placeholder. The real road.glb carries its own
 * numbers in its named nodes; nothing in the game reads this file.
 *
 * Metres; the player at the origin, eyes at 1.7 m, looking north up the
 * road along −Z; left is −X (the corn), right is +X (the motel).
 */
export type P = readonly [number, number, number];

export const EYE: P = [0, 1.7, 0];

/** The barricade: sandbags across the forecourt's edge, its face this far out. */
export const BARRICADE_Z = -2.75;
/** Where the dead stand to claw at it (`barricade.<n>`), spread along it. */
export const SLOTS: readonly P[] = [
  [-1.7, 0, -3.45],
  [-0.85, 0, -3.5],
  [0, 0, -3.55],
  [0.85, 0, -3.5],
  [1.7, 0, -3.45],
];

/** The lanes' waypoints (`lane.<id>.<n>`), from the fog to the barricade. */
export const LANES = {
  // Up the road out of the fog, round the right-hand end of the bus.
  road: { points: [[1.4, 0, -58], [2.4, 0, -52], [4.6, 0, -45.4], [3.0, 0, -34], [1.0, 0, -19], [0.2, 0, -7.5]] as P[], spread: 1.7, cover: 0 },
  // Out of the corn on the left, through the gap in the fence.
  corn: { points: [[-22, 0, -37], [-16, 0, -28], [-10.5, 0, -17.5], [-6.4, 0, -10.8], [-2.4, 0, -6.4]] as P[], spread: 1.3, cover: 29 },
  // Out of the pines past the motel, across the field and onto the shoulder.
  trees: { points: [[23, 0, -63], [15.5, 0, -55], [8.8, 0, -39], [4.4, 0, -21], [1.6, 0, -7.4]] as P[], spread: 1.6, cover: 0 },
} as const;

/** The surprises: where each appears (`spawn.<id>`) and its way out (`spawn.<id>.path.<n>`). */
export const SPAWNS = {
  // Out of the bus's front door, down onto the road: the spawn is the foot
  // of the door (the climb's clip carries the step down from the floor).
  bus: { at: [-2.2, 0, -43.55] as P, path: [[-2.05, 0, -43.0], [-1.0, 0, -26], [-0.2, 0, -7.5]] as P[], spread: 0.3 },
  // From behind the phone booth under the streetlight.
  booth: { at: [7.9, 0, -28.4] as P, path: [[6.3, 0, -23.6], [3.4, 0, -14], [1.3, 0, -7]] as P[], spread: 0.5 },
  // Over the fence, twelve metres out: the spawn is at the rail (the vault's
  // clip carries the body over; the way out starts on the near side).
  fence: { at: [-6.75, 0, -12.2] as P, path: [[-5.9, 0, -12.0], [-2.2, 0, -6.6]] as P[], spread: 0.3 },
} as const;

/** The survivors' runs across the road toward the motel (`path.survivor.<n>.<k>`). */
export const SURVIVOR_PATHS: readonly (readonly P[])[] = [
  [[-8.4, 0, -19.5], [-2.5, 0, -21.5], [4.5, 0, -25.5], [10.5, 0, -31.5], [13.2, 0, -36]],
  [[-8.2, 0, -24.5], [0, 0, -25.5], [7.5, 0, -29], [13.2, 0, -41]],
];
