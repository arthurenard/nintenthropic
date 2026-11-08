/**
 * Grip Prix's tracks, in the order the lobby offers them: the Acorn Cup,
 * the Comet Cup, and the secret one. Each is data only: the sim and the
 * picture build everything else from it (geometry.ts), and
 * track/mapImage.ts draws any of them top-down to see what it is like (the
 * map test writes them to track/maps/).
 *
 * Features are placed as fractions of the lap, the centre line as waypoints
 * (a closed curve through them). The geometry test checks every track here
 * never passes close to itself; the sim's tracks test races eight bots round
 * each of them.
 */
import type { TrackDef } from "./geometry";
import { crosser, pendulum, stomperRow, sweeper } from "./pieces";

/**
 * The gentle opener: a long start straight over a gentle rise, up the hill
 * with the windmill on it (eight metres, leaning into the long left-hander),
 * down into an S over the meadow that leans one way and then the other,
 * through a hollow, round a wide U-turn and back over a low hill, then down to
 * the pond and round its banked hairpin (the duck) onto the straight again. No
 * drops, no hazards. About 1 km.
 */
export const MEADOW_LOOP: TrackDef = {
  id: "meadow-loop",
  name: "Meadow Loop",
  theme: "meadow",
  blurb: "A gentle opener: up the windmill's hill, down a leaning S over the meadow, through the hollow and round the banked hairpin by the pond.",
  laps: 3,
  width: 14,
  points: [
    { x: 0, z: 0 },
    { x: 0, z: 70, y: 0.8 },
    { x: 0, z: 140, y: 0.4 },
    // Up the windmill's hill, leaning into the long left-hander.
    { x: 20, z: 185, y: 2.6, bank: -0.1 },
    { x: 65, z: 205, y: 6.8, bank: -0.06 },
    { x: 115, z: 195, y: 10.2, bank: -0.08 },
    { x: 145, z: 165, y: 7.4, bank: -0.05 },
    // Down into the S over the meadow, which leans one way and then the other.
    { x: 165, z: 130, y: 3.2, bank: 0.1 },
    { x: 200, z: 115, y: 1.8, width: 13, bank: 0.14 },
    { x: 240, z: 125, y: 2.4, width: 13, bank: -0.14 },
    { x: 270, z: 110, y: 1.6, bank: -0.12 },
    { x: 280, z: 70, y: 0.6, bank: -0.04 },
    { x: 270, z: 20, y: -1.4 },
    { x: 245, z: -20, y: -0.2, bank: -0.12 },
    { x: 205, z: -35, y: 1.4, width: 16, bank: -0.14 },
    { x: 160, z: -20, y: 2.6, width: 16, bank: -0.12 },
    { x: 140, z: 15, y: 3.2 },
    { x: 115, z: 40, y: 2.4, bank: 0.14 },
    { x: 80, z: 35, y: 1.2, bank: 0.14 },
    { x: 60, z: 0, y: 0.4 },
    // Down by the pond and round the banked hairpin.
    { x: 54, z: -20 },
    { x: 52, z: -38, y: -0.3, bank: -0.06 },
    { x: 44, z: -56, y: -0.3, bank: -0.2 },
    { x: 26, z: -64, y: -0.2, bank: -0.24 },
    { x: 8, z: -56, y: -0.1, bank: -0.2 },
    { x: 0, z: -38, bank: -0.08 },
    { x: 0, z: -18 },
  ],
  itemRows: [0.22, 0.55, 0.82],
  boostPads: [
    { at: 0.37, offset: 0 },
    { at: 0.68, offset: 3 },
  ],
  // The inside line of the windmill's left-hander is a strip of boost for whoever hugs it.
  surfaces: [{ from: 0.205, to: 0.275, kind: "boost", offset: -4, width: 3 }],
  routes: [
    {
      // The low road: leaves the start straight, winds south of the windmill through the hollow and fords the creek (a stretch of wet stones, as slippery as ice), to join the
      // meadow's S-bend again. The hill road is the high one (ten metres up) and the longer way; the creek is shorter but slow.
      id: "creek-road",
      kind: "split",
      from: 0.0997,
      to: 0.41,
      width: 11,
      appeal: 0.55,
      points: [
        { x: 30, z: 128, y: 0.3, bank: 0.1 },
        { x: 64, z: 102, y: -0.8, bank: -0.1 },
        { x: 104, z: 124, y: -1.4, bank: 0.1 },
        { x: 144, z: 100, y: -0.3, bank: -0.1 },
        { x: 178, z: 104, y: 2.2 },
      ],
      surfaces: [{ from: 0.38, to: 0.64, kind: "ice", offset: 0, width: 9 }],
      landmarks: [
        { kind: "pond", at: 0.49, offset: 30, scale: 0.8 },
        { kind: "hay-bales", at: 0.3, offset: -26 },
        { kind: "flower-field", at: 0.7, offset: -36 },
      ],
    },
    {
      // The shortcut through the barn: across the inside of the big U-turn, over a hay-bale ramp and the creek (a gap to fly), in one
      // door of the barn and out of the other onto a strip of boost. Narrow, and a fall costs more than it saves.
      id: "barn-cut",
      kind: "shortcut",
      from: 0.503,
      to: 0.765,
      width: 9,
      flare: 26,
      appeal: 0.85,
      points: [
        { x: 252, z: 66, y: 0.4 },
        { x: 214, z: 60, y: -0.3 },
        { x: 178, z: 50, y: 0.4 },
        { x: 146, z: 44, y: 1.5 },
      ],
      ramps: [{ at: 0.4 }],
      drops: [{ from: 0.408, to: 0.47, side: "both", gap: true }],
      surfaces: [
        { from: 0.54, to: 0.62, kind: "mud" },
        { from: 0.84, to: 0.9, kind: "boost", width: 3 },
      ],
      landmarks: [
        { kind: "barn-run", at: 0.66, offset: 0, span: 30 },
      ],
    },
  ],
  landmarks: [
    { kind: "windmill", at: 0.242, offset: -58, scale: 1.6 },
    { kind: "barn", at: 0.0532, offset: -36, turn: 0.3 },
    { kind: "hay-bales", at: 0.029, offset: 17.5 },
    { kind: "hay-bales", at: 0.1694, offset: -20 },
    { kind: "sheep", at: 0.1355, offset: 30 },
    { kind: "sheep", at: 0.1471, offset: 34, scale: 0.9 },
    { kind: "hot-air-balloon", at: 0.1984, offset: -55, scale: 1.5 },
    { kind: "flower-field", at: 0.2662, offset: 42 },
    { kind: "hay-bales", at: 0.3194, offset: 17 },
    { kind: "flower-field", at: 0.392, offset: 42, scale: 1.2 },
    { kind: "barn", at: 0.5033, offset: 36, turn: 3.1 },
    { kind: "flower-field", at: 0.5468, offset: 45 },
    { kind: "hay-bales", at: 0.571, offset: 17 },
    { kind: "sheep", at: 0.6194, offset: 30 },
    { kind: "hot-air-balloon", at: 0.7017, offset: 65, scale: 1.3 },
    { kind: "flower-field", at: 0.7937, offset: 40, scale: 1.2 },
    { kind: "hay-bales", at: 0.842, offset: -17.5 },
    { kind: "pond", at: 0.925, offset: -38, scale: 0.9 },
  ],
  duck: { at: 0.925, offset: -36 },
};

/**
 * Toy karts on a giant kitchen counter, late afternoon, the sun through the window. A chopping-board start
 * straight, round the fruit bowl, a chicane between the salt and the pepper, a ramp off a cookbook over the sink (fall in
 * and the drone fishes you out; the duck floats in the sink), spilt milk (ice) on the east bend, the counter's edge a
 * long open drop on the outside of the sweeping curve with oranges rolling down the straight after it, and under the
 * cheese grater past a spinning teacup. The bends lean into their turns, the curve along the counter's edge highest on
 * its open outside. About 1.2 km.
 */
export const KITCHEN_RALLY: TrackDef = {
  id: "kitchen-rally",
  name: "Kitchen Rally",
  theme: "kitchen",
  laps: 3,
  width: 15,
  blurb: "Toy karts on a giant kitchen counter: round the fruit bowl, between the salt and the pepper, under the cheese grater, over the sink.",
  points: [
    { x: 0, z: 0 },
    { x: 0, z: 31.6 },
    { x: 0, z: 63.3 },
    { x: -6.2, z: 87.4, bank: 0.14 },
    { x: -23.3, z: 105.6, bank: 0.14 },
    { x: -47.1, z: 113.2 },
    { x: -71.7, z: 114.6 },
    { x: -84.3, z: 117.2, bank: -0.12 },
    { x: -95.7, z: 123.3 },
    { x: -103.4, z: 128.9, bank: 0.12 },
    { x: -120.6, z: 136.6, bank: 0.16 },
    { x: -139.4, z: 136.6, bank: 0.16 },
    { x: -156.6, z: 128.9, bank: 0.12 },
    { x: -163.6, z: 123.8, bank: -0.12 },
    { x: -175.7, z: 117.5, bank: -0.14 },
    { x: -189.2, z: 115.1 },
    { x: -229.5, z: 114.2 },
    { x: -269.7, z: 113.4 },
    { x: -310, z: 112.5 },
    { x: -350.3, z: 111.6, width: 17.5 },
    { x: -378.9, z: 103.9, width: 18, bank: 0.16 },
    { x: -400.6, z: 83.9, width: 18, bank: 0.16 },
    { x: -410.6, z: 56, width: 18 },
    { x: -413.5, z: 28.4, width: 18 },
    { x: -416.3, z: 0.8, width: 17.5 },
    { x: -414.7, z: -20.4, width: 15.5, bank: 0.16 },
    { x: -405.8, z: -39.8, bank: 0.16 },
    { x: -390.7, z: -54.8 },
    { x: -361.4, z: -74.9 },
    { x: -332.1, z: -95.1 },
    { x: -327.7, z: -97.8 },
    { x: -300.7, z: -112.2 },
    { x: -273.6, z: -126.7, y: 0.1 },
    // Up onto the cooker top and down off it, round a banked turn at its highest.
    { x: -255.1, z: -131.1, y: 0.5, bank: 0.16 },
    { x: -236.8, z: -126.1, y: 1.5 },
    { x: -215.4, z: -113.8, y: 2.7 },
    { x: -194.1, z: -101.6, y: 3.5 },
    { x: -181.7, z: -97.1, y: 3.7, bank: -0.14 },
    { x: -168.4, z: -97.1, y: 3.7, bank: -0.14 },
    { x: -156, z: -101.7, y: 3.3 },
    { x: -136.4, z: -113.2, y: 2.2 },
    { x: -116.9, z: -124.6, y: 1.0 },
    { x: -99.7, z: -129.8, y: 0.3, bank: 0.16 },
    { x: -82.1, z: -126.5 },
    { x: -52.3, z: -113.1 },
    { x: -22.4, z: -99.7 },
    { x: -10.6, z: -91.3, bank: 0.14 },
    { x: -2.7, z: -79.2, bank: 0.14 },
    { x: 0, z: -65 },
    { x: 0, z: -32.5 },
  ],
  itemRows: [0.0381, 0.2636, 0.6344, 0.8612],
  boostPads: [
    { at: 0.3092, offset: 0 },
    { at: 0.7272, offset: -3 },
    { at: 0.9789, offset: 2 },
  ],
  ramps: [
    { at: 0.3346 },
  ],
  drops: [
    { from: 0.3363, to: 0.3473, side: "both", gap: true },
    { from: 0.4166, to: 0.5097, side: "left" },
  ],
  surfaces: [
    { from: 0.5531, to: 0.5784, kind: "ice" },
    // The cooker's hob rings, a line of boost across its top for whoever keeps to the inside of the turn.
    { from: 0.7125, to: 0.7425, kind: "boost", offset: 4, width: 3 },
  ],
  routes: [
    {
      // The cutlery drawer: out of the straight early, across the inside of the big sweeping curve, down a ramp into a drawer pulled
      // right out of the counter (walnut walls, felt underfoot, spoons and forks laid across overhead), a pea rolling across its
      // middle and a line of boost to be had, and up out of it onto the road again. Narrow, and a third shorter than the curve.
      id: "cutlery-drawer",
      kind: "shortcut",
      from: 0.364,
      to: 0.618,
      width: 9,
      flare: 28,
      appeal: 0.85,
      points: [
        { x: -362, z: 98, y: -0.5 },
        { x: -362, z: 66, y: -2.2 },
        { x: -356, z: 28, y: -2.4 },
        { x: -350, z: -14, y: -2.4 },
        { x: -346, z: -52, y: -1.2 },
      ],
      surfaces: [{ from: 0.4, to: 0.62, kind: "boost", offset: 0, width: 3 }],
      hazards: [{ kind: "pea", at: 0.36, motion: "cross", period: 4.4, radius: 1.5, span: 3.2 }],
      landmarks: [
        { kind: "drawer", at: 0.5, offset: 0, span: 78 },
        { kind: "salt-shaker", at: 0.16, offset: 20, scale: 0.8 },
      ],
    },
  ],
  hazards: [
    { kind: "orange", motion: "roll", period: 4.6, radius: 2.4, offset: 0, at: 0.518, span: 0.0592 },
    { kind: "orange", motion: "roll", period: 4.6, phase: 0.5, radius: 2.4, offset: 0, at: 0.518, span: 0.0592 },
    { kind: "teacup", motion: "orbit", period: 5.5, radius: 2.2, offset: 14, at: 0.8026, span: 9 },
    // The toaster pops: two slices spring up out of the road in turn, by the toaster.
    { kind: "toast", motion: "bob", period: 3.6, radius: 1.1, offset: -3.5, at: 0.7255 },
    { kind: "toast", motion: "bob", period: 3.6, phase: 0.5, radius: 1.1, offset: 3.5, at: 0.7255 },
  ],
  landmarks: [
    { kind: "teapot", at: 0.0169, offset: 80, scale: 1.4, turn: 0.5 },
    { kind: "fruit-bowl", at: 0.0863, offset: 62, scale: 1.2 },
    { kind: "spoon-arch", at: 0.1275, offset: 0, span: 12 },
    { kind: "salt-shaker", at: 0.1491, offset: -27.5 },
    { kind: "pepper-mill", at: 0.1925, offset: 31.5 },
    { kind: "wall-clock", at: 0.2636, offset: -90, scale: 1.4 },
    { kind: "cookbook", at: 0.3177, offset: -30, turn: 0.2 },
    { kind: "cookbook", at: 0.3583, offset: 34, scale: 1.2, turn: -0.4 },
    { kind: "sink", at: 0.3414, offset: 0, span: 16 },
    { kind: "window", at: 0.4216, offset: -100, scale: 2 },
    { kind: "cereal-box", at: 0.236, offset: 48, scale: 1.2 },
    { kind: "fork-arch", at: 0.4924, offset: 0, span: 10 },
    { kind: "mug", at: 0.285, offset: -48 },
    { kind: "toaster", at: 0.7255, offset: -40, turn: 1.57 },
    { kind: "grater", at: 0.879, offset: 0, span: 40 },
    { kind: "cereal-box", at: 0.8396, offset: -34, turn: 0.4 },
    { kind: "mug", at: 0.9299, offset: 40, scale: 1.1 },
  ],
  duck: { at: 0.3414, offset: 4, y: 2.9 },
};

/**
 * A quay circuit at night: a long straight along the water to the lighthouse,
 * over a humpback bridge across a dock (sharp enough to fly), a stack of right
 * angles round the warehouses, each leaning a little into its turn, a swing
 * bridge to fly on the back straight before the forklift crosses it, and a
 * chicane of four more right angles by the cranes, with crabs scuttling
 * across the road there. Wide (16 m) and fast. The duck sits by the
 * lighthouse. About 1.2 km.
 */
export const HARBOUR_LIGHTS: TrackDef = {
  id: "harbour-lights",
  name: "Harbour Lights",
  theme: "harbour",
  blurb: "Night on the quay: over the humpback bridge along the water, round the warehouses, over the swing bridge and through the chicane where the crabs scuttle.",
  laps: 3,
  width: 16,
  points: [
    { x: 0, z: 0 },
    { x: 0, z: 12 },
    { x: 0, z: 75 },
    // The bridge over the dock: a hump to fly.
    { x: 0, z: 96, y: 0.2 },
    { x: 0, z: 106, y: 1.6 },
    { x: 0, z: 114, y: 2.5 },
    { x: 0, z: 122, y: 1.7 },
    { x: 0, z: 130, y: 0.2 },
    { x: 0, z: 138 },
    { x: 0, z: 200 },
    { x: 2, z: 211, bank: -0.1 },
    { x: 9, z: 221, bank: -0.13 },
    { x: 19, z: 228, bank: -0.1 },
    { x: 30, z: 230 },
    { x: 95, z: 230 },
    { x: 106, z: 228, bank: -0.1 },
    { x: 116, z: 221, bank: -0.13 },
    { x: 123, z: 211, bank: -0.1 },
    { x: 125, z: 200 },
    { x: 125, z: 180 },
    { x: 127, z: 169, bank: 0.1 },
    { x: 134, z: 159, bank: 0.13 },
    { x: 144, z: 152, bank: 0.1 },
    { x: 155, z: 150 },
    { x: 235, z: 150 },
    { x: 246, z: 148, bank: -0.1 },
    { x: 256, z: 141, bank: -0.13 },
    { x: 263, z: 131, bank: -0.1 },
    { x: 265, z: 120 },
    // The swing bridge on the back straight.
    { x: 265, z: 108, y: 0.2 },
    { x: 265, z: 100, y: 1.6 },
    { x: 265, z: 92, y: 2.5 },
    { x: 265, z: 84, y: 1.6 },
    { x: 265, z: 76, y: 0.2 },
    { x: 265, z: 70 },
    { x: 265, z: 20 },
    { x: 265, z: -30 },
    { x: 263, z: -41, bank: -0.1 },
    { x: 256, z: -51, bank: -0.13 },
    { x: 246, z: -58, bank: -0.1 },
    { x: 235, z: -60 },
    { x: 200, z: -60 },
    { x: 189, z: -58, bank: -0.1 },
    { x: 179, z: -51, bank: -0.13 },
    { x: 172, z: -41, bank: -0.1 },
    { x: 170, z: -30 },
    { x: 170, z: 5 },
    { x: 168, z: 16, bank: 0.1 },
    { x: 161, z: 26, bank: 0.13 },
    { x: 151, z: 33, bank: 0.1 },
    { x: 140, z: 35 },
    { x: 110, z: 35 },
    { x: 99, z: 33, bank: 0.1 },
    { x: 89, z: 26, bank: 0.13 },
    { x: 82, z: 16, bank: 0.1 },
    { x: 80, z: 5 },
    { x: 80, z: -50 },
    { x: 78, z: -61, bank: -0.1 },
    { x: 71, z: -71, bank: -0.13 },
    { x: 61, z: -78, bank: -0.1 },
    { x: 50, z: -80 },
    { x: 30, z: -80 },
    { x: 19, z: -78, bank: -0.1 },
    { x: 9, z: -71, bank: -0.13 },
    { x: 2, z: -61, bank: -0.1 },
    { x: 0, z: -50 },
  ],
  itemRows: [0.124, 0.36, 0.6, 0.85],
  boostPads: [
    { at: 0.04, offset: 0 },
    { at: 0.5, offset: -3 },
    { at: 0.74, offset: 3 },
  ],
  // The ferry ramp: a slip into the water where the quay's long straight ends, a gap to fly with a trick lip, and the far slip to land on.
  ramps: [{ at: 0.534 }],
  drops: [{ from: 0.5357, to: 0.5462, side: "both", gap: true }],
  routes: [
    {
      // The ship's deck: the quay is the quick, plain way; the other goes up a gangway onto the deck of a cargo ship moored beside
      // the dock (four metres over the water, no barrier either side, stacks of containers and a gantry crane over it) and down a
      // gangway at the other end. A line of boost down the deck pays for the longer way round, if nobody goes over the side.
      id: "ship-deck",
      kind: "split",
      from: 0.03,
      to: 0.157,
      width: 10,
      flare: 30,
      appeal: 0.55,
      points: [
        { x: -16, z: 62, y: 0.1 },
        { x: -38, z: 92, y: 1.2 },
        { x: -46, z: 124, y: 3.6 },
        { x: -46, z: 148, y: 3.5 },
        { x: -38, z: 170, y: 1.4 },
      ],
      drops: [{ from: 0.34, to: 0.72, side: "both" }],
      surfaces: [{ from: 0.4, to: 0.64, kind: "boost", offset: 0, width: 3 }],
      landmarks: [{ kind: "ship-deck", at: 0.5, offset: 0, span: 56 }],
    },
  ],
  hazards: [
    { kind: "crab", at: 0.8509, motion: "cross", period: 5.2, radius: 1.3 },
    { kind: "crab", at: 0.8773, motion: "cross", period: 5.2, phase: 0.5, radius: 1.3 },
    { kind: "forklift", at: 0.41, motion: "cross", period: 8, radius: 2.2 },
    // The gantry crane swings a container round over the dock road; time it.
    { kind: "swing-box", at: 0.64, motion: "orbit", period: 6.4, radius: 2, offset: 0, span: 7 },
  ],
  landmarks: [
    { kind: "containers", at: 0.033, offset: -30 },
    { kind: "buoy", at: 0.0826, offset: 75 },
    { kind: "crane", at: 0.0991, offset: -29, scale: 1.2 },
    { kind: "ship", at: 0.0661, offset: 115, scale: 2.2 },
    { kind: "warehouse", at: 0.1322, offset: -45, scale: 1.4 },
    { kind: "lighthouse", at: 0.1768, offset: 52, scale: 1.2 },
    { kind: "buoy", at: 0.1983, offset: 36 },
    { kind: "containers", at: 0.2354, offset: -30 },
    { kind: "crane", at: 0.285, offset: -38.5, scale: 1.1 },
    { kind: "warehouse", at: 0.3883, offset: -46 },
    { kind: "containers", at: 0.4048, offset: -35.5, scale: 1.1 },
    { kind: "buoy", at: 0.4626, offset: 32 },
    { kind: "ship", at: 0.5039, offset: 120, scale: 2.0 },
    { kind: "crane", at: 0.5039, offset: 27.5, scale: 1.3 },
    { kind: "warehouse", at: 0.5452, offset: -44, scale: 1.3 },
    { kind: "containers", at: 0.5659, offset: -31 },
    { kind: "crane", at: 0.6476, offset: -36 },
    { kind: "containers", at: 0.7476, offset: -28, scale: 1.2 },
    { kind: "warehouse", at: 0.8261, offset: -40 },
    { kind: "crane", at: 0.8344, offset: 30, scale: 1.2 },
    { kind: "buoy", at: 0.9418, offset: 30 },
    { kind: "containers", at: 0.8839, offset: -44 },
  ],
  duck: { at: 0.1834, offset: 58 },
};

/**
 * A winding gorge: a steep climb (sixteen metres at up to 13%, an S that leans
 * into each of its bends) to a hairpin at the top (the sand across its inside
 * is a cut for the brave and a Nitro), a ridge road with a gap in it to jump,
 * then the tumble: off a lip sharp enough to fly, down S-bends that lean one
 * way and the other past rolling boulders, through a narrow neck (12 m), and
 * a dip on the way out before the final bends. Twisty rather than fast. About
 * 1.1 km.
 */
export const CANYON_RUN: TrackDef = {
  id: "canyon-run",
  name: "Canyon Run",
  theme: "canyon",
  blurb: "A winding gorge: climb steeply to the hairpin, race the ridge and leap its gap, fly off the lip and tumble down the leaning bends, and cut the sand if you dare.",
  laps: 3,
  width: 14,
  points: [
    { x: 0, z: 0 },
    { x: 0, z: 36 },
    { x: -3, z: 71, y: 0.3 },
    // The climb: an S that leans into each of its bends, sixteen metres up at 12%.
    { x: -10, z: 107, y: 3.6, bank: 0.14 },
    { x: -45, z: 129, y: 8.2, bank: -0.16 },
    { x: -60, z: 156, y: 12.8 },
    { x: -70, z: 185, y: 15.8 },
    { x: -72, z: 208, y: 16.3 },
    // The hairpin at the top, the sand across its inside.
    { x: -77, z: 221, y: 16.4, bank: 0.1 },
    { x: -90, z: 226, y: 16.4, bank: 0.12 },
    { x: -103, z: 221, y: 16.4, bank: 0.1 },
    { x: -108, z: 208, y: 16.4 },
    // The ridge road: a knife-edge of fast sweepers (the mine's split leaves it and rejoins it), then a straight over the gorge.
    { x: -110, z: 190, y: 16.3, bank: 0.05 },
    { x: -116, z: 160, y: 16.5, bank: 0.05 },
    { x: -114, z: 128, y: 16.5, bank: -0.05 },
    { x: -108, z: 100, y: 16.4, bank: -0.04 },
    { x: -108, z: 80, y: 16.4 },
    { x: -108, z: 60, y: 16.3 },
    { x: -108, z: 14, y: 15.8 },
    { x: -108, z: -24, y: 15.6 },
    // The turn onto the rope bridge: forty-five metres of planks over the gorge, nothing on either side.
    { x: -114, z: -48, y: 15.4, bank: 0.14 },
    { x: -129, z: -62, y: 15.2, bank: 0.12 },
    { x: -150, z: -68, y: 14.9, width: 10, bank: 0.08 },
    { x: -178, z: -67, y: 14.6, width: 10, bank: -0.08 },
    { x: -204, z: -63, y: 14.2, width: 12, bank: 0.05 },
    // The tumble: down through S-bends, each leaning its own way.
    { x: -228, z: -74, y: 11.6, bank: 0.16 },
    { x: -240, z: -95, y: 8.8, bank: -0.18 },
    // The neck: twelve metres between the walls.
    { x: -225, z: -119, y: 4.4, width: 12, bank: 0.12 },
    { x: -184, z: -139, y: 2.8, width: 12 },
    { x: -148, z: -148, y: 1.6, width: 12, bank: -0.14 },
    { x: -129, z: -172, y: 2.4 },
    { x: -90, z: -198, y: 3.4, bank: 0.15 },
    { x: -52, z: -177, y: 2.8, width: 18, bank: 0.15 },
    // The wash: the gorge opens into a wide sandy bed, twenty-two metres across, under the rock crushers.
    { x: -48, z: -131, y: 0.6, width: 22 },
    { x: -43, z: -95, y: 1.4, width: 22, bank: -0.12 },
    { x: -14, z: -70, y: 0.5, bank: 0.12 },
    { x: -4, z: -35, y: 0.1 },
  ],
  itemRows: [0.155, 0.26, 0.64, 0.945],
  boostPads: [
    { at: 0.257, offset: -2 },
    { at: 0.809, offset: 2 },
    // The brave line through the crushers' middle lane.
    { at: 0.93, offset: 0 },
  ],
  // The dynamite barrels at the end of the ridge: a cannon that throws a kart across the gorge, over sixty metres of nothing.
  air: [{ kind: "cannon", at: 0.387, length: 84, height: 9 }],
  drops: [
    { from: 0.3958, to: 0.4541, side: "both", gap: true },
    // The rope bridge has no rails.
    { from: 0.512, to: 0.567, side: "both" },
  ],
  verges: [
    { from: 0.18, to: 0.285, side: "right", distance: 24, surface: "sand" },
  ],
  routes: [
    {
      // The mine: a shortcut through the mesa that the road round the neck's U goes the long way about. Straight on where the road
      // bends away, into a timbered tunnel (rails and lanterns, narrow, a dog-leg through the rock) with two side galleries
      // where ore carts run across it a beat apart, and out into the wash. Seventy metres shorter than the road round, and the
      // carts do not wait.
      id: "mine",
      kind: "shortcut",
      from: 0.693,
      to: 0.893,
      width: 10,
      flare: 22,
      appeal: 0.7,
      points: [
        { x: -150, z: -116, y: 2.1 },
        { x: -124, z: -110, y: 1.7 },
        { x: -92, z: -110, y: 1.3 },
        { x: -66, z: -116, y: 0.9 },
      ],
      hazards: [
        crosser({ at: 0.5, reach: 13, period: 6.6, radius: 1.8 }),
      ],
      landmarks: [{ kind: "mine-tunnel", at: 0.58, offset: 0, span: 50 }],
    },
  ],
  hazards: [
    { kind: "tumbleweed", at: 0.0443, motion: "cross", period: 6, radius: 1.5 },
    // The quarry's rails cross the open ridge: two ore carts, one each way, a lamp lit on the post before each runs.
    crosser({ at: 0.2935, reach: 10, period: 6.4 }),
    crosser({ at: 0.3045, reach: -10, period: 6.4, phase: 0.5 }),
    // Down the tumble, two wrecking balls swing across the road a beat apart.
    pendulum({ at: 0.594, reach: 4.5, period: 3.2 }),
    pendulum({ at: 0.61, reach: 4.5, period: 3.2, phase: 0.5 }),
    { kind: "boulder", at: 0.675, motion: "roll", period: 5, radius: 2.4, offset: -2.5, span: 0.04 },
    // The rails cross the long way round the U as well, past the mesa.
    crosser({ at: 0.7625, reach: 10, period: 5.8, phase: 0.2 }),
    crosser({ at: 0.771, reach: -10, period: 5.8, phase: 0.7 }),
    // The wash: three rock crushers in a wave (the middle lane has the boost).
    ...stomperRow({ at: 0.92, lanes: [-6, 0, 6], period: 4.4, stagger: 0.22, radius: 2.2 }),
  ],
  landmarks: [
    { kind: "mesa", at: 0.058, offset: -88, scale: 1.6 },
    { kind: "cactus-grove", at: 0.037, offset: 34 },
    { kind: "rock-arch", at: 0.1393, offset: 0, span: 16 },
    { kind: "cactus-grove", at: 0.1672, offset: -34 },
    { kind: "mesa", at: 0.2053, offset: 135, scale: 1.4 },
    { kind: "headframe", at: 0.2229, offset: -38, scale: 1.1, turn: 0.8 },
    { kind: "water-tower", at: 0.2433, offset: -34, scale: 1.3 },
    { kind: "mesa", at: 0.3, offset: 180, scale: 0.8 },
    { kind: "mine-cart", at: 0.32, offset: -28, scale: 1.0, turn: -0.5 },
    { kind: "dynamite-shack", at: 0.352, offset: 26, scale: 1.0 },
    { kind: "cactus-grove", at: 0.4, offset: 34 },
    { kind: "mesa", at: 0.4, offset: -80, scale: 1.7 },
    { kind: "rope-bridge", at: 0.5395, offset: 0, span: 52 },
    { kind: "mesa", at: 0.5, offset: -100, scale: 0.9 },
    { kind: "cactus-grove", at: 0.6501, offset: -32, scale: 1.2 },
    { kind: "headframe", at: 0.68, offset: 36, scale: 1.0, turn: -2.4 },
    { kind: "mesa", at: 0.7355, offset: -130, scale: 1.2 },
    { kind: "cactus-grove", at: 0.8173, offset: -34 },
    { kind: "mesa", at: 0.8972, offset: -118, scale: 1.6 },
    { kind: "water-tower", at: 0.9473, offset: -36, scale: 0.9 },
  ],
  duck: { at: 0.2433, offset: -42 },
};

/**
 * A fairground at dusk, every ride lit. Under the entrance arch past the start, a fast run round the carousel,
 * a hairpin by the hook-a-duck stall (the duck), then back through the big top (a tunnel full of lights), a plaza as wide
 * as a square where bumper cars cross and a teacup ride spins beside the road, a ramp off the helter-skelter's foot
 * (trick for a boost), and home under the fireworks. The top straight rolls over a hump and dips under the
 * rollercoaster, and the hairpin by the hook-a-duck stall is banked hard. About 1.1 km.
 */
export const FUN_FAIR: TrackDef = {
  id: "fun-fair",
  name: "Fun Fair",
  theme: "funfair",
  laps: 3,
  width: 14,
  blurb: "Dusk at the fair, every ride lit: under the Ferris wheel, up the coaster or round the midway, into the cannon, through the big top and home under the fireworks.",
  points: [
    { x: 0, z: 0 },
    { x: 0, z: 35 },
    { x: 0, z: 70 },
    { x: 0, z: 105 },
    { x: 0, z: 140 },
    { x: 7.4, z: 167.5, bank: -0.12 },
    { x: 27.5, z: 187.6, bank: -0.12 },
    { x: 55, z: 195 },
    // The midway along the top: rolling ground under the coaster's rails, a hump and a dip, then the banked hairpin. The coaster
    // itself is the other road (the split) on the trestle to the north.
    { x: 98.4, z: 201, y: 0.6, bank: 0.05 },
    { x: 141.8, z: 214, y: 2.6, bank: 0.08 },
    { x: 185.2, z: 203, y: 3.2, bank: -0.08 },
    { x: 228.6, z: 192, y: 0.8, bank: -0.08 },
    { x: 272, z: 195, y: -2.0 },
    { x: 281, z: 192.6, y: -1.9, bank: -0.2 },
    { x: 287.6, z: 186, y: -1.6, bank: -0.3 },
    { x: 290, z: 177, y: -1.3, bank: -0.32 },
    { x: 290, z: 174, y: -1.2, bank: -0.32 },
    { x: 287.6, z: 165, y: -0.9, bank: -0.3 },
    { x: 281, z: 158.4, y: -0.5, bank: -0.2 },
    { x: 272, z: 156, y: -0.2 },
    // The human cannonball's straight.
    { x: 236.3, z: 156 },
    { x: 200.7, z: 156 },
    { x: 165, z: 156 },
    { x: 145, z: 150.6, bank: 0.14 },
    { x: 130.4, z: 136, bank: 0.14 },
    { x: 125, z: 116 },
    // The plaza: a wide street that sways, the carousel in the middle.
    { x: 121, z: 88, width: 24, bank: 0.06 },
    { x: 130, z: 56, width: 24, bank: -0.06 },
    { x: 123, z: 26, width: 23, bank: 0.05 },
    { x: 125, z: -14, width: 21 },
    { x: 125, z: -34, width: 15 },
    { x: 125, z: -70 },
    { x: 119.6, z: -90, bank: -0.14 },
    { x: 105, z: -104.6, bank: -0.14 },
    // The hall of mirrors: a chicane under the swinging boats.
    { x: 85, z: -110 },
    { x: 62.5, z: -102, bank: 0.1 },
    { x: 40, z: -117, bank: -0.1 },
    { x: 20, z: -104.6, bank: -0.14 },
    { x: 5.4, z: -90, bank: -0.14 },
    { x: 0, z: -70 },
    { x: 0, z: -35 },
  ],
  itemRows: [0.1257, 0.3151, 0.4375, 0.6338],
  boostPads: [
    { at: 0.4, offset: 0 },
    { at: 0.5415, offset: -2 },
    { at: 0.8456, offset: 2 },
  ],
  ramps: [
    { at: 0.7485 },
  ],
  // The human cannonball: the pack is fired off the start straight, over the entrance arch and the safety nets beyond it.
  air: [{ kind: "cannon", at: 0.0215, length: 80, height: 7.5 }],
  routes: [
    {
      // The coaster: a split off the midway. The midway is the low road, rolling ground under the rails; the other climbs the
      // coaster's own track on its trestle (no barrier, a fall off it costs you) to the top of the lift hill and plunges
      // down the far side to join the midway again, a line of boost at the bottom of the drop. Longer, higher, and faster.
      id: "coaster",
      kind: "split",
      from: 0.2,
      to: 0.375,
      width: 11,
      flare: 30,
      appeal: 0.6,
      points: [
        { x: 85, z: 224, y: 1.4 },
        { x: 118, z: 250, y: 7.4, bank: 0.1 },
        { x: 150, z: 258, y: 11.5, bank: 0.05 },
        { x: 180, z: 248, y: 7.8, bank: -0.08 },
        { x: 207, z: 228, y: 4.0, bank: -0.06 },
      ],
      drops: [{ from: 0.24, to: 0.76, side: "both" }],
      boostPads: [{ at: 0.78, offset: 0 }],
      landmarks: [{ kind: "coaster-trestle", at: 0.5, offset: 0, span: 84 }],
    },
  ],
  hazards: [
    // Test your strength: two mallets on the first straight, one up while the other comes down.
    ...stomperRow({ kind: "mallet", at: 0.1075, lanes: [-3.5, 3.5], period: 4.2, stagger: 0.5, radius: 2.2 }),
    // The funhouse: striped walls slide across the big top, one each way, a lamp lit before each.
    crosser({ kind: "funhouse-panel", at: 0.4965, reach: 9, period: 5.2 }),
    crosser({ kind: "funhouse-panel", at: 0.5205, reach: -9, period: 5.2, phase: 0.5 }),
    // The carousel turns in the middle of the plaza: a bar of horses, two ways round, to time.
    ...sweeper({ kind: "arm-ball", at: 0.663, offset: 0, length: 9.5, period: 6.5 }),
    { kind: "bumper-car", motion: "cross", period: 5.2, phase: 0.35, radius: 2.1, offset: 0, at: 0.695, span: 11 },
    { kind: "bumper-car", motion: "cross", period: 5.2, phase: 0.7, radius: 2.1, offset: 0, at: 0.718, span: 11 },
    // The pirate ships swing over the chicane, a beat apart.
    pendulum({ kind: "swing-boat", at: 0.858, reach: 3.5, period: 3.4, radius: 2 }),
    pendulum({ kind: "swing-boat", at: 0.88, reach: 3.5, period: 3.4, phase: 0.5, radius: 2 }),
    { kind: "teacup-ride", motion: "orbit", period: 7, radius: 2.6, offset: 26, at: 0.672, span: 14 },
    { kind: "teacup-ride", motion: "orbit", period: 6.4, phase: 0.3, radius: 2.6, offset: -25, at: 0.2605, span: 15 },
  ],
  landmarks: [
    { kind: "entrance-arch", at: 0.0801, offset: 0, span: 16 },
    { kind: "cannon-tent", at: 0.0215, offset: -30, scale: 1, turn: 1.57 },
    { kind: "safety-net", at: 0.097, offset: 0 },
    { kind: "ferris-gate", at: 0.466, offset: 0 },
    { kind: "ferris-wheel", at: 0.0546, offset: -88, scale: 1.5 },
    { kind: "fireworks", at: 0.9836, offset: -30 },
    { kind: "fireworks", at: 0.0273, offset: 36, scale: 1.2 },
    { kind: "food-stall", at: 0.1092, offset: 24 },
    { kind: "carousel", at: 0.1671, offset: -46, scale: 1.2 },
    { kind: "food-stall", at: 0.2, offset: -34, turn: 3.14 },
    { kind: "balloon-stand", at: 0.3042, offset: 28 },
    { kind: "rollercoaster", at: 0.405, offset: 0, span: 34 },
    { kind: "food-stall", at: 0.387, offset: 22 },
    { kind: "hook-a-duck", at: 0.43, offset: 30, scale: 1.2, turn: 1.57 },
    { kind: "big-top", at: 0.5085, offset: 0, span: 56 },
    { kind: "balloon-stand", at: 0.4757, offset: 26 },
    { kind: "fireworks", at: 0.583, offset: 40 },
    { kind: "food-stall", at: 0.6447, offset: 32 },
    { kind: "helter-skelter", at: 0.7558, offset: 36, scale: 1.2 },
    { kind: "balloon-stand", at: 0.7212, offset: 28 },
    { kind: "fireworks", at: 0.8982, offset: 34 },
    { kind: "carousel", at: 0.8565, offset: -40, scale: 0.8 },
  ],
  duck: { at: 0.43, offset: 26, y: 1.2 },
};

/**
 * An alpine pass at blue hour. Across a frozen lake in the valley (level, all ice, wide, penguins waddling over it),
 * then a climb of fifteen metres at up to 15% to the pass, where the road winds three quarters of the way round a
 * mountain hut in a corkscrew, banked hard and falling all the way, with a cliff on its outside and ice on its tight
 * inside line. Along the shoulder, snowballs roll down at you to a crest sharp enough to fly over; then a twisting S
 * that leans one way and the other through the ice cave, a long falling in-run to the ski-jump over the crevasse, and
 * moguls on the way home, where a yeti pops out of a snowdrift. The duck sits by an ice-fishing hole on the lake.
 * About 1.2 km.
 */
export const GLACIER_PASS: TrackDef = {
  id: "glacier-pass",
  name: "Glacier Pass",
  theme: "snow",
  laps: 3,
  width: 14,
  blurb: "An alpine pass at blue hour: slide across the frozen lake, climb to the corkscrew round the hut, fly the crest, twist through the ice cave and leap the crevasse.",
  points: [
    { x: 0, z: 0 },
    { x: 0, z: 39.8 },
    { x: 0, z: 79.6, y: 0.2 },
    { x: 0, z: 119.4, y: 0.6 },
    { x: -3.9, z: 140.6, y: 1, bank: 0.1 },
    { x: -14.9, z: 159, y: 1.3, bank: 0.14 },
    { x: -31.8, z: 172.4, y: 1.5, bank: 0.05 },
    { x: -61.6, z: 188.3, y: 1.6, width: 23 },
    { x: -91.4, z: 204.2, y: 1.6, width: 24 },
    { x: -121.2, z: 220.1, y: 1.6, width: 24 },
    { x: -150.7, z: 227.1, y: 1.8, width: 23 },
    { x: -186, z: 226.4, y: 4, width: 18 },
    { x: -220, z: 225.4, y: 8.8 },
    { x: -248, z: 223.6, y: 13 },
    { x: -270, z: 221.6, y: 15.6 },
    { x: -293.5, z: 224.6, y: 16.6, bank: 0.1 },
    { x: -310, z: 229, y: 16.6, bank: 0.26 },
    { x: -326.5, z: 224.6, y: 16.2, bank: 0.32 },
    { x: -338.6, z: 212.5, y: 15.4, bank: 0.32 },
    { x: -343, z: 196, y: 14.4, bank: 0.32 },
    { x: -338.6, z: 179.5, y: 13.4, bank: 0.32 },
    { x: -326.5, z: 167.4, y: 12.4, bank: 0.32 },
    { x: -310, z: 163, y: 11.6, bank: 0.3 },
    { x: -293.5, z: 167.4, y: 11, bank: 0.2 },
    { x: -277, z: 171.4, y: 10.7, bank: 0.03 },
    { x: -260, z: 172, y: 11 },
    { x: -249, z: 172, y: 12 },
    { x: -240, z: 172, y: 12.7 },
    { x: -233, z: 172, y: 12.6 },
    { x: -222, z: 171.4, y: 10.6 },
    { x: -207, z: 167.5, y: 8.6, bank: -0.1 },
    { x: -192, z: 157, y: 7.8, bank: -0.26 },
    { x: -185, z: 138, y: 7.2, bank: -0.08 },
    { x: -176, z: 117, y: 6.6, bank: 0.24 },
    { x: -160, z: 99, y: 6.1, bank: 0.16 },
    { x: -152, z: 80, y: 5.6, bank: -0.1 },
    { x: -150, z: 60, y: 5.2 },
    // The long falling in-run: the frozen waterfall's split leaves it and rejoins it, then a brow to glide off over the crevasse.
    { x: -150, z: 28.7, y: 4.3 },
    { x: -150, z: -6.2, y: 3.5 },
    { x: -150, z: -41, y: 3.0 },
    { x: -150, z: -66, y: 3.2 },
    { x: -150, z: -90, y: 2.2 },
    { x: -150, z: -120, y: 1.2 },
    { x: -150, z: -148, y: 0.8 },
    { x: -146, z: -168, y: 0.7, bank: 0.12 },
    { x: -132, z: -183, y: 0.7, bank: 0.16 },
    { x: -112, z: -190, y: 0.5, bank: 0.1 },
    // The moguls on the way home.
    { x: -92, z: -189, y: 0.3 },
    { x: -78, z: -185, y: 0 },
    { x: -64, z: -181, y: 1.8 },
    { x: -54, z: -178.5, y: 2.7 },
    { x: -33, z: -172, y: 0.7 },
    { x: -16, z: -163, y: 0.5, bank: 0.12 },
    { x: -4, z: -148, y: 0.3, bank: 0.12 },
    { x: 0, z: -122, y: 0.1 },
    { x: 0, z: -90 },
    { x: 0, z: -60 },
    { x: 0, z: -30 },
  ],
  itemRows: [0.0444, 0.185, 0.444, 0.8],
  boostPads: [
    { at: 0.074, offset: 0 },
    { at: 0.2147, offset: -6 },
    { at: 0.4663, offset: 2 },
    { at: 0.835, offset: -2 },
  ],
  ramps: [
    // A kicker on the frozen lake: a short hop on the ice, a trick for a boost.
    { at: 0.2087, lift: 5 },
  ],
  // The ski jump: off the brow of the in-run, under a parasol, over the crevasse and down onto the flat beyond it.
  air: [{ kind: "glide", at: 0.6875, length: 84, height: 9 }],
  drops: [
    { from: 0.3538, to: 0.4367, side: "left" },
    // The crevasse under the glide: no barrier either side.
    { from: 0.6906, to: 0.747, side: "both" },
  ],
  surfaces: [
    { from: 0.1525, to: 0.2435, kind: "ice" },
    { from: 0.0881, to: 0.1377, kind: "ice", offset: 3.5, width: 7 },
    { from: 0.3568, to: 0.4249, kind: "ice", offset: 4.5, width: 5 },
    { from: 0.8143, to: 0.84, kind: "ice", offset: 3.5, width: 7 },
  ],
  routes: [
    {
      // Behind the falls: a split off the in-run. The main road runs straight down the mountain's foot, under the avalanche's
      // slope (two slabs let go across it a beat apart, a lamp lit on the post before each). The other bears off to the left
      // into a pocket in the cliff, behind a frozen waterfall: a line of boost down the middle, a blue light through the curtain,
      // and two icicles let go in turn beside it. The longer way, and the one the avalanche cannot reach.
      id: "falls",
      kind: "split",
      from: 0.585,
      to: 0.672,
      width: 11,
      flare: 24,
      appeal: 0.55,
      points: [
        { x: -180, z: 68, y: 4.9 },
        { x: -208, z: 44, y: 4.4 },
        { x: -214, z: 14, y: 3.9 },
        { x: -194, z: -12, y: 3.5 },
      ],
      surfaces: [{ from: 0.32, to: 0.78, kind: "boost", offset: 0, width: 3 }],
      hazards: [
        { kind: "icicle", at: 0.5, motion: "crush", period: 5.5, phase: 0.2, radius: 1.5, offset: -2.6, top: 7 },
        { kind: "icicle", at: 0.58, motion: "crush", period: 5.5, phase: 0.6, radius: 1.5, offset: 2.6, top: 7 },
      ],
      landmarks: [{ kind: "frozen-falls", at: 0.5, offset: 0, span: 36 }],
    },
  ],
  hazards: [
    { kind: "penguin", motion: "cross", period: 6.5, radius: 1.6, at: 0.1969, span: 9 },
    { kind: "snowball", motion: "roll", period: 5, radius: 2.2, offset: -2.5, at: 0.4849, span: 0.0296 },
    { kind: "snowball", motion: "roll", period: 5, phase: 0.55, radius: 2.2, offset: -2.5, at: 0.4849, span: 0.0296 },
    { kind: "yeti", motion: "bob", period: 8, phase: 0.1, radius: 2.4, offset: 3.4, at: 0.8868 },
    // The ice cave: icicles let go on a timer, one after another down the cave, shaking first.
    { kind: "icicle", at: 0.5367, motion: "crush", period: 4.5, phase: 0, radius: 1.5, offset: -3.4, top: 7 },
    { kind: "icicle", at: 0.544, motion: "crush", period: 4.5, phase: 0.33, radius: 1.5, offset: 3.4, top: 7 },
    { kind: "icicle", at: 0.5514, motion: "crush", period: 4.5, phase: 0.66, radius: 1.5, offset: -3.4, top: 7 },
    // The avalanche path at the mountain's foot: two slabs of snow let go across the road, a beat apart, from the slope on the left.
    crosser({ kind: "avalanche", at: 0.618, reach: 10, period: 6.6, radius: 3, offset: 0 }),
    crosser({ kind: "avalanche", at: 0.6336, reach: 10, period: 6.6, phase: 0.5, radius: 3, offset: 0 }),
  ],
  landmarks: [
    { kind: "cabin", at: 0.0296, offset: 36 },
    { kind: "pine-snow", at: 0.0074, offset: -32 },
    { kind: "pine-snow", at: 0.037, offset: -36, scale: 1.2 },
    { kind: "pine-snow", at: 0.0592, offset: -34 },
    { kind: "snowman", at: 0.074, offset: 30, scale: 1.3 },
    { kind: "ice-arch", at: 0.166, offset: 0, span: 14 },
    { kind: "igloo", at: 0.188, offset: 40 },
    { kind: "gondola", at: 0.203, offset: -60, scale: 1.2 },
    { kind: "pine-snow", at: 0.207, offset: 34 },
    { kind: "pine-snow", at: 0.285, offset: -38, scale: 1.2 },
    { kind: "igloo", at: 0.269, offset: -40, turn: -0.8 },
    { kind: "snowman", at: 0.332, offset: -32 },
    { kind: "cabin", at: 0.391, offset: 33, turn: 2.5 },
    { kind: "pine-snow", at: 0.475, offset: -34 },
    { kind: "ice-cave", at: 0.544, offset: 0, span: 40 },
    { kind: "pine-snow", at: 0.524, offset: 30, scale: 1.2 },
    { kind: "pine-snow", at: 0.567, offset: 38 },
    { kind: "ski-jump", at: 0.692, offset: 32 },
    { kind: "pine-snow", at: 0.677, offset: 34 },
    { kind: "gondola", at: 0.635, offset: 62 },
    { kind: "igloo", at: 0.728, offset: -44 },
    { kind: "pine-snow", at: 0.8, offset: 34 },
    { kind: "snowman", at: 0.86, offset: -30 },
  ],
  duck: { at: 0.2256, offset: 24 },
};

/**
 * Black rock and rivers of lava round a smoking volcano. Up its flank in switchbacks: a climbing leg, a banked
 * hairpin, another leg (boulders rolling down it at you), another hairpin the other way, past the hot spring where the
 * duck relaxes, and through an obsidian arch onto the ridge, twenty-two metres up, weaving between lava on the outside
 * of its bends with fireballs leaping from it. Then left off the ridge and straight down the mountain: over a brow to
 * fly (a boost pad on it for the brave), a jump over a lava gap, and a stone bridge across the lava lake with nothing
 * either side, a boost strip along its left half only (the quick way is the one beside the lava). About 1.2 km.
 */
export const VOLCANO_RUSH: TrackDef = {
  id: "volcano-rush",
  name: "Volcano Rush",
  theme: "volcano",
  laps: 3,
  width: 14,
  blurb: "Black rock and rivers of lava: switchback up the flank, get fired over a lava tongue by the geyser cannon, weave the erupting ridge, then glide off the brow and down the mountain to the stone bridge.",
  points: [
    // The start straight, then left onto the volcano's flank.
    { x: 0, z: 0 },
    { x: 0, z: 28, y: 0.2 },
    { x: 0, z: 52, y: 0.7 },
    { x: 5, z: 72, y: 1.3, bank: -0.12 },
    { x: 20, z: 88, y: 2, bank: -0.15 },
    { x: 42, z: 95, y: 2.8, bank: -0.04 },
    // The switchbacks: up a leg, round a banked hairpin, up the next, round another.
    { x: 68, z: 95, y: 4.6 },
    { x: 94, z: 95, y: 6.8 },
    { x: 120, z: 95, y: 9 },
    { x: 140, z: 95, y: 10.2, bank: 0.1 },
    { x: 152.5, z: 98.3, y: 10.8, bank: 0.26 },
    { x: 161.7, z: 107.5, y: 11.3, bank: 0.32 },
    { x: 165, z: 120, y: 11.6, bank: 0.32 },
    { x: 161.7, z: 132.5, y: 11.9, bank: 0.32 },
    { x: 152.5, z: 141.7, y: 12.3, bank: 0.26 },
    { x: 140, z: 145, y: 12.7, bank: 0.1 },
    { x: 115, z: 145, y: 14.2 },
    { x: 88, z: 145, y: 16 },
    { x: 62, z: 145, y: 17.6 },
    { x: 38, z: 145, y: 18.7 },
    { x: 15, z: 145, y: 19.4, bank: -0.1 },
    { x: 1.2, z: 148.7, y: 19.8, bank: -0.26 },
    { x: -8.8, z: 158.8, y: 20.1, bank: -0.32 },
    { x: -12.5, z: 172.5, y: 20.4, bank: -0.32 },
    { x: -8.8, z: 186.2, y: 20.7, bank: -0.32 },
    { x: 1.2, z: 196.3, y: 21, bank: -0.26 },
    { x: 15, z: 200, y: 21.3, bank: -0.1 },
    // The ridge, weaving between rivers of lava, twenty-two metres up.
    { x: 40, z: 200, y: 21.8, bank: 0.04 },
    { x: 60.8, z: 204.5, y: 22.2, bank: -0.12 },
    { x: 81.7, z: 200, y: 22.5, bank: 0.04 },
    { x: 102.5, z: 195.5, y: 22.7, bank: 0.14 },
    { x: 123.3, z: 200, y: 22.8, bank: -0.04 },
    { x: 144.2, z: 204.5, y: 22.8, bank: -0.14 },
    { x: 165, z: 200, y: 22.7 },
    // Left off the ridge and straight down the mountain: over the brow, off the ramp, over the lava.
    { x: 186, z: 197.5, y: 22.4, bank: -0.12 },
    { x: 204, z: 189, y: 22, bank: -0.22 },
    { x: 217, z: 175, y: 21.4, bank: -0.18 },
    { x: 224, z: 157, y: 20.6, bank: -0.04 },
    { x: 225, z: 137, y: 19.8 },
    { x: 225, z: 120, y: 19.9 },
    { x: 225, z: 109, y: 19.3 },
    { x: 225, z: 97, y: 17 },
    { x: 225, z: 82, y: 14.4 },
    { x: 225, z: 60, y: 11.4 },
    { x: 225, z: 37, y: 8.8 },
    { x: 225, z: 14, y: 6.6 },
    { x: 225, z: -10, y: 4.6 },
    { x: 225, z: -32, y: 3.3 },
    { x: 222, z: -52, y: 2.6, bank: -0.1 },
    { x: 212, z: -70, y: 2.2, bank: -0.2 },
    { x: 195, z: -80, y: 1.8, bank: -0.1 },
    // The stone bridge across the lava lake, and home.
    { x: 170, z: -82, y: 1.4 },
    { x: 140, z: -82, y: 1.1 },
    { x: 110, z: -82, y: 0.8 },
    { x: 80, z: -82, y: 0.6 },
    { x: 55, z: -82, y: 0.4 },
    { x: 33, z: -78, y: 0.2, bank: -0.1 },
    { x: 13, z: -64, y: 0.1, bank: -0.14 },
    { x: 3, z: -44, bank: -0.04 },
    { x: 0, z: -22 },
  ],
  itemRows: [0.036, 0.141, 0.47, 0.805],
  boostPads: [
    { at: 0.1207, offset: 2 },
    { at: 0.2395, offset: 0 },
    { at: 0.603, offset: 0 },
    { at: 0.957, offset: 2 },
  ],
  // The geyser cannon throws a kart over a gap in the road (a lava tongue) on the flank; the glide takes it off the
  // brow and down the mountain over the open lava fields.
  air: [
    { kind: "cannon", at: 0.251, length: 82, height: 8 },
    { kind: "glide", at: 0.6211, length: 140, height: 11 },
  ],
  drops: [
    { from: 0.259, to: 0.3121, side: "both", gap: true },
    { from: 0.6235, to: 0.7365, side: "both" },
    { from: 0.4344, to: 0.4545, side: "right" },
    { from: 0.469, to: 0.4883, side: "left" },
    { from: 0.5036, to: 0.5229, side: "right" },
    { from: 0.8158, to: 0.893, side: "both" },
  ],
  surfaces: [
    { from: 0.8215, to: 0.885, kind: "boost", offset: -3.5, width: 7 },
  ],
  hazards: [
    // The eruption, on the race clock: a pair of lava bombs leaps from either side of the ridge every 7 s (the middle is
    // clear), and the next pair, half a beat later, a little farther on.
    { kind: "fireball", motion: "bob", period: 7, radius: 1.7, offset: 4.6, at: 0.452 },
    { kind: "fireball", motion: "bob", period: 7, radius: 1.7, offset: -4.6, at: 0.452 },
    { kind: "fireball", motion: "bob", period: 7, phase: 0.5, radius: 1.7, offset: 4.6, at: 0.4925 },
    { kind: "fireball", motion: "bob", period: 7, phase: 0.5, radius: 1.7, offset: -4.6, at: 0.4925 },
    { kind: "boulder", motion: "roll", period: 5.4, radius: 2.5, offset: -2.8, at: 0.145, span: 0.035 },
    { kind: "boulder", motion: "roll", period: 5.4, phase: 0.5, radius: 2.5, offset: -2.8, at: 0.145, span: 0.035 },
    { kind: "geyser", motion: "bob", period: 6.8, radius: 2.4, offset: 0, at: 0.7723 },
  ],
  landmarks: [
    { kind: "volcano", at: 0.4827, offset: 252, scale: 1.7 },
    { kind: "obsidian-arch", at: 0.4183, offset: 0, span: 14 },
    { kind: "basalt-columns", at: 0.008, offset: 45 },
    { kind: "lava-fall", at: 0.1368, offset: -45, scale: 1.2 },
    { kind: "hot-spring", at: 0.3725, offset: 36 },
    { kind: "lava-fall", at: 0.4586, offset: 45, scale: 1.4 },
    { kind: "basalt-columns", at: 0.53, offset: 44, scale: 1.2 },
    { kind: "lava-fall", at: 0.6758, offset: 46 },
    { kind: "basalt-columns", at: 0.724, offset: -55, scale: 1.3 },
    { kind: "basalt-columns", at: 0.7796, offset: 40 },
    { kind: "stone-bridge", at: 0.8544, offset: 0, span: 96 },
    { kind: "lava-fall", at: 0.853, offset: 44, scale: 1.2 },
    { kind: "basalt-columns", at: 0.917, offset: -45 },
    { kind: "basalt-columns", at: 0.62, offset: 40 },
  ],
  duck: { at: 0.3725, offset: 36, y: 0.4 },
};

/**
 * The finale: a glowing ribbon of road high over a ringed planet, which turns under the middle of the lap. Off the
 * line it climbs into the twist, where the ribbon rolls one way and then the other (a boost strip up it, a comet
 * rolling down it at you); along the top, two crests to fly in a row with an asteroid circling the dip between them;
 * round the far end in a banked carousel that falls five metres; back along the lower ribbon, then straight down past
 * the planet (a boost strip on the way) to the long jump between two ribbons, and home. Almost no barriers (go over the
 * edge and the rescue drone brings you back), ring gates to drive through. The duck floats in an astronaut's helmet by
 * a satellite. About 1.2 km.
 */
export const STARLIGHT_RIBBON: TrackDef = {
  id: "starlight-ribbon",
  name: "Starlight Ribbon",
  theme: "space",
  laps: 3,
  width: 20,
  blurb: "The finale, a ribbon of light over a ringed planet: roll through the twist, float over two crests, swing round the carousel under a meteor shower, glide down and get fired across the gap between two ribbons.",
  bank: 8,
  points: [
    // Off the line and up into the twist: the ribbon rolls one way, then the other, as it climbs.
    { x: 0, z: 0 },
    { x: 0, z: 30, y: 0.4 },
    { x: 0, z: 60, y: 1.4 },
    { x: 0, z: 88, y: 3 },
    { x: 0, z: 112, y: 5, bank: -0.32 },
    { x: 0, z: 136, y: 7.4 },
    { x: 0, z: 160, y: 9.8, bank: 0.34 },
    { x: 0, z: 184, y: 12 },
    { x: 0, z: 206, y: 13.6, bank: -0.12 },
    { x: -6, z: 230, y: 15, bank: 0.1 },
    { x: -22, z: 250, y: 16 },
    { x: -45, z: 262, y: 17 },
    // The rollercoaster: two crests to fly.
    { x: -75, z: 264, y: 20.4 },
    { x: -92, z: 264, y: 22 },
    { x: -104, z: 264, y: 21.4 },
    { x: -120, z: 264, y: 18.4 },
    { x: -140, z: 264, y: 17.8 },
    { x: -158, z: 264, y: 20.4 },
    { x: -171, z: 264, y: 22.4 },
    { x: -183, z: 264, y: 22 },
    { x: -200, z: 264, y: 20.6 },
    // The spiral: round the far end, banked hard and falling all the way.
    { x: -222, z: 265.5, y: 20.4, bank: 0.12 },
    { x: -244, z: 265.3, y: 20.4, bank: 0.3 },
    { x: -267.7, z: 263.2, y: 20.1, bank: 0.35 },
    { x: -287.2, z: 249.6, y: 19.4, bank: 0.35 },
    { x: -297.3, z: 228, y: 18.5, bank: 0.35 },
    { x: -295.2, z: 204.3, y: 17.5, bank: 0.35 },
    { x: -281.6, z: 184.8, y: 16.5, bank: 0.35 },
    { x: -260, z: 174.7, y: 15.6, bank: 0.3 },
    { x: -238, z: 174.5, y: 15, bank: 0.1 },
    // Back along the lower ribbon, and down past the planet to the long jump.
    { x: -212, z: 175.5, y: 14.2 },
    { x: -186, z: 176, y: 13.6 },
    { x: -160, z: 176, y: 13.8 },
    { x: -134, z: 175, y: 13 },
    { x: -115, z: 168, y: 12.2, bank: -0.1 },
    { x: -103, z: 152, y: 11.4, bank: -0.1 },
    { x: -100, z: 130, y: 10.6 },
    { x: -100, z: 105, y: 9.6 },
    { x: -100, z: 80, y: 8.4 },
    { x: -100, z: 55, y: 7.2 },
    { x: -100, z: 25, y: 5.8 },
    { x: -100, z: -5, y: 4.4 },
    { x: -100, z: -35, y: 3.2 },
    { x: -98, z: -62, y: 2.6, bank: 0.06 },
    { x: -86, z: -86, y: 2.2, bank: 0.1 },
    { x: -65, z: -99, y: 1.8, bank: 0.06 },
    { x: -38, z: -101, y: 1.4 },
    { x: -16, z: -94, y: 1, bank: 0.06 },
    { x: -3, z: -75, y: 0.6, bank: 0.06 },
    { x: 0, z: -50, y: 0.2 },
    { x: 0, z: -25 },
  ],
  itemRows: [0.0372, 0.2234, 0.4633, 0.8257],
  boostPads: [
    { at: 0.3078, offset: 4 },
    { at: 0.5427, offset: -4 },
    { at: 0.8993, offset: 0 },
  ],
  // Low-gravity lips on the two crests (long floaty arcs, a trick boosts on landing), a solar-sail glide down the lower
  // ribbon to its landing mark, and the cannon that fires a kart across the gap between the two ribbons.
  air: [
    { kind: "lip", at: 0.2482, length: 64, height: 5 },
    { kind: "lip", at: 0.3159, length: 64, height: 5 },
    { kind: "glide", at: 0.6718, length: 70, height: 7 },
    { kind: "cannon", at: 0.7399, length: 88, height: 9 },
  ],
  drops: [
    { from: 0.7595, to: 0.8066, side: "both", gap: true },
    { from: 0.0414, to: 0.7595, side: "both" },
    { from: 0.7942, to: 0.9514, side: "both" },
  ],
  surfaces: [
    { from: 0.0951, to: 0.1365, kind: "boost" },
    { from: 0.5543, to: 0.5957, kind: "boost" },
  ],
  hazards: [
    { kind: "asteroid", motion: "orbit", period: 5.6, radius: 3, offset: 0, at: 0.425, span: 6.4 },
    { kind: "asteroid", motion: "orbit", period: 6.4, phase: 0.4, radius: 3, offset: 0, at: 0.5791, span: 6.4 },
    { kind: "asteroid", motion: "orbit", period: 5.9, phase: 0.7, radius: 3, offset: 0, at: 0.6991, span: 6.4 },
    { kind: "comet", motion: "roll", period: 5.2, radius: 3, offset: -2, at: 0.1655, span: 0.0496 },
    // A meteor shower down the carousel's far side: two streaks, a beat apart, one each side of the ribbon.
    { kind: "comet", motion: "roll", period: 5.5, radius: 2.0, offset: -5.5, at: 0.521, span: 0.04 },
    { kind: "comet", motion: "roll", period: 5.5, phase: 0.5, radius: 2.0, offset: 5.5, at: 0.521, span: 0.04 },
  ],
  landmarks: [
    { kind: "ringed-planet", at: 0.0662, offset: 50, scale: 3.2 },
    { kind: "ring-gate", at: 0.0248, offset: 0, span: 6 },
    { kind: "ring-gate", at: 0.1125, offset: 0, span: 6 },
    { kind: "nebula", at: 0.1655, offset: -200, scale: 3 },
    { kind: "asteroid", at: 0.211, offset: -60, scale: 1.4 },
    { kind: "ring-gate", at: 0.3061, offset: 0, span: 6 },
    { kind: "nebula", at: 0.3558, offset: -230, scale: 2.6 },
    { kind: "satellite", at: 0.3971, offset: -56, scale: 1.1 },
    { kind: "ring-gate", at: 0.5394, offset: 0, span: 6 },
    { kind: "asteroid", at: 0.4633, offset: 44 },
    { kind: "ring-gate", at: 0.5791, offset: 0, span: 6 },
    { kind: "asteroid", at: 0.6122, offset: 64, scale: 1.8 },
    { kind: "ring-gate", at: 0.7115, offset: 0, span: 6 },
    { kind: "space-station", at: 0.7281, offset: -110, scale: 2 },
    { kind: "nebula", at: 0.7942, offset: -180, scale: 2.8 },
    { kind: "ring-gate", at: 0.8993, offset: 0, span: 6 },
    { kind: "satellite", at: 0.9589, offset: -40, scale: 1.2 },
  ],
  duck: { at: 0.9589, offset: -34, y: 6 },
};

/**
 * Secret. An island shaped like an open hand, seen from above: the hand you play with. The road runs up and down every
 * finger (the fingertips are hairpins), round the thumb, and back along the wrist, where a giant wristwatch is the
 * start gantry. A ring to drive through on the long straight by the wrist (the fingers lie too close for anything to
 * stand between them), palm trees, beach huts, crabs and rolling coconuts. The minimap is a hand. The duck sunbathes in
 * sunglasses in the middle of the palm. The hand is tilted: every finger climbs to its tip and back. About 1.2 km.
 */
export const FIVE_FINGER_CIRCUIT: TrackDef = {
  id: "five-finger-circuit",
  name: "Five Finger Circuit",
  theme: "palm",
  laps: 3,
  width: 13,
  blurb: "An island shaped like an open hand: up and down every finger, a cannon off the wrist, and a glide from the thumb's tip down to the water.",
  secret: true,
  points: [
    { x: 0, z: 0 },
    { x: 0, z: 11.4 },
    { x: -2.7, z: 23.8 },
    { x: -10.3, z: 34 },
    { x: -31.5, z: 52.5 },
    { x: -52.7, z: 71 },
    { x: -60.3, z: 81.2 },
    { x: -63, z: 93.6 },
    { x: -63, z: 125.3, y: 0.4 },
    { x: -63, z: 157, y: 1.5 },
    { x: -61.3, z: 163.5, y: 1.7 },
    { x: -56.5, z: 168.3, y: 1.9 },
    { x: -50, z: 170, y: 1.9 },
    { x: -43.5, z: 168.3, y: 1.9 },
    { x: -38.7, z: 163.5, y: 1.7 },
    { x: -37, z: 157, y: 1.5 },
    { x: -37, z: 138, y: 0.8 },
    { x: -35.3, z: 131.5, y: 0.6 },
    { x: -30.5, z: 126.7, y: 0.4 },
    { x: -24, z: 125, y: 0.4 },
    { x: -17.5, z: 126.7, y: 0.4 },
    { x: -12.7, z: 131.5, y: 0.6 },
    { x: -11, z: 138, y: 0.8 },
    { x: -11, z: 175, y: 2.1 },
    { x: -9.3, z: 181.5, y: 2.3 },
    { x: -4.5, z: 186.3, y: 2.5 },
    { x: 2, z: 188, y: 2.6 },
    { x: 8.5, z: 186.3, y: 2.5 },
    { x: 13.3, z: 181.5, y: 2.3 },
    { x: 15, z: 175, y: 2.1 },
    { x: 15, z: 138, y: 0.8 },
    { x: 16.7, z: 131.5, y: 0.6 },
    { x: 21.5, z: 126.7, y: 0.4 },
    { x: 28, z: 125, y: 0.4 },
    { x: 34.5, z: 126.7, y: 0.4 },
    { x: 39.3, z: 131.5, y: 0.6 },
    { x: 41, z: 138, y: 0.8 },
    { x: 41, z: 183, y: 2.4 },
    { x: 42.7, z: 189.5, y: 2.6 },
    { x: 47.5, z: 194.3, y: 2.8 },
    { x: 54, z: 196, y: 2.8 },
    { x: 60.5, z: 194.3, y: 2.8 },
    { x: 65.3, z: 189.5, y: 2.6 },
    { x: 67, z: 183, y: 2.4 },
    { x: 67, z: 138, y: 0.8 },
    { x: 68.7, z: 131.5, y: 0.6 },
    { x: 73.5, z: 126.7, y: 0.4 },
    { x: 80, z: 125, y: 0.4 },
    { x: 86.5, z: 126.7, y: 0.4 },
    { x: 91.3, z: 131.5, y: 0.6 },
    { x: 93, z: 138, y: 0.8 },
    { x: 93, z: 173, y: 2 },
    { x: 94.7, z: 179.5, y: 2.3 },
    { x: 99.5, z: 184.3, y: 2.4 },
    { x: 106, z: 186, y: 2.5 },
    { x: 112.5, z: 184.3, y: 2.4 },
    { x: 117.3, z: 179.5, y: 2.3 },
    { x: 119, z: 173, y: 2 },
    { x: 119, z: 142, y: 0.9 },
    { x: 119, z: 111 },
    { x: 120.5, z: 105.5 },
    { x: 124.5, z: 101.5 },
    { x: 130, z: 100 },
    { x: 135.5, z: 101.5 },
    { x: 139.5, z: 105.5 },
    { x: 147.5, z: 119.4, y: 0.2 },
    { x: 152.3, z: 124.1, y: 0.3 },
    { x: 158.8, z: 125.9, y: 0.4 },
    { x: 165.2, z: 124.1, y: 0.3 },
    { x: 165.3, z: 124.1, y: 0.3 },
    { x: 169.1, z: 120.8, y: 0.2 },
    { x: 171.4, z: 116.2 },
    { x: 171.7, z: 111.1 },
    { x: 170.1, z: 106.3 },
    { x: 156.4, z: 82.7 },
    { x: 142.7, z: 59 },
    { x: 141, z: 54.7 },
    { x: 134.3, z: 26.6 },
    { x: 127.6, z: 13.6 },
    { x: 115.5, z: 5.3 },
    { x: 101, z: 3.8 },
    { x: 90.1, z: 5.3 },
    { x: 77.4, z: 4.3 },
    { x: 66.3, z: -1.8 },
    { x: 58.7, z: -12 },
    { x: 56, z: -24.5 },
    { x: 56, z: -40 },
    { x: 52.2, z: -54 },
    { x: 42, z: -64.2 },
    { x: 28, z: -68 },
    { x: 14, z: -64.2 },
    { x: 3.8, z: -54 },
    { x: 0, z: -40 },
  ],
  itemRows: [0.0324, 0.2466, 0.4545, 0.5977],
  boostPads: [
    { at: 0.096, offset: 0 },
    { at: 0.3914, offset: 1.5 },
    { at: 0.6181, offset: -1.5 },
    { at: 0.8845, offset: 0 },
  ],
  // The wrist launcher fires a kart up the first diagonal; the fingertip lip hops the first finger; the thumb glide
  // takes a kart off the thumb's tip and down to the wrist over the sea, to a landing mark in the lagoon.
  air: [
    { kind: "cannon", at: 0.0461, length: 36, height: 5 },
    { kind: "lip", at: 0.1092, length: 34, height: 3.5 },
    { kind: "glide", at: 0.7186, length: 95, height: 8 },
  ],
  drops: [{ from: 0.7211, to: 0.798, side: "both" }],
  hazards: [
    { kind: "crab", motion: "cross", period: 5.6, radius: 1.3, at: 0.093, span: 6 },
    { kind: "coconut", motion: "roll", period: 4.6, radius: 1.5, offset: -2.6, at: 0.18, span: 0.03 },
    { kind: "beach-ball", motion: "roll", period: 5, radius: 1.9, offset: 2.6, at: 0.653, span: 0.0478 },
    { kind: "crab", motion: "cross", period: 6.2, phase: 0.4, radius: 1.3, at: 0.888, span: 6 },
  ],
  landmarks: [
    { kind: "wristwatch", at: 0, offset: 0, span: 12 },
    { kind: "palm-tree", at: 0.9744, offset: -24 },
    { kind: "palm-tree", at: 0.9829, offset: 24, scale: 1.2 },
    { kind: "beach-hut", at: 0.0537, offset: 30 },
    { kind: "surfboard", at: 0.0656, offset: -26, turn: 0.4 },
    { kind: "palm-tree", at: 0.1219, offset: 24 },
    { kind: "palm-tree", at: 0.1441, offset: 28, scale: 1.3 },
    { kind: "sandcastle", at: 0.1646, offset: 28 },
    { kind: "beach-hut", at: 0.2194, offset: -22, turn: 3.1 },
    { kind: "giant-ring", at: 0.853, offset: 0, span: 10 },
    { kind: "palm-tree", at: 0.2364, offset: -18 },
    { kind: "surfboard", at: 0.29, offset: 24 },
    { kind: "palm-tree", at: 0.3658, offset: -24, scale: 1.2 },
    { kind: "beach-hut", at: 0.4219, offset: 28 },
    { kind: "sandcastle", at: 0.4989, offset: -27.5 },
    { kind: "palm-tree", at: 0.4767, offset: 67.5 },
    { kind: "beach-towel", at: 0.5653, offset: 22 },
    { kind: "palm-tree", at: 0.6028, offset: 28 },
    { kind: "surfboard", at: 0.6386, offset: -25, turn: 2.2 },
    { kind: "beach-hut", at: 0.6442, offset: -26, turn: 1 },
    { kind: "palm-tree", at: 0.7236, offset: 24 },
    { kind: "sandcastle", at: 0.8281, offset: 30 },
    { kind: "palm-tree", at: 0.8863, offset: -24 },
    { kind: "palm-tree", at: 0.9088, offset: 30, scale: 1.3 },
    { kind: "beach-towel", at: 0.9173, offset: -30 },
    { kind: "surfboard", at: 0.9966, offset: 24, turn: 1.2 },
  ],
  duck: { at: 0.0571, offset: -72, y: 0.2 },
};

/** Every track, in the order they are raced: the Acorn Cup, the Comet Cup, then the secret one. */
export const TRACKS: TrackDef[] = [MEADOW_LOOP, KITCHEN_RALLY, HARBOUR_LIGHTS, CANYON_RUN, FUN_FAIR, GLACIER_PASS, VOLCANO_RUSH, STARLIGHT_RIBBON, FIVE_FINGER_CIRCUIT];

/** The two cups of four, in the order they are raced; the secret track is in TRACKS (flagged `secret`) but in no cup. */
export const CUPS: { id: string; name: string; tracks: string[] }[] = [
  { id: "acorn", name: "Acorn Cup", tracks: ["meadow-loop", "kitchen-rally", "harbour-lights", "canyon-run"] },
  { id: "comet", name: "Comet Cup", tracks: ["fun-fair", "glacier-pass", "volcano-rush", "starlight-ribbon"] },
];

export function trackById(id: string): TrackDef {
  return TRACKS.find((track) => track.id === id) ?? TRACKS[0]!;
}
