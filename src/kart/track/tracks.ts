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

/** Seconds the flock takes to cross Meadow's road, once a beat; the farm gate's lamp blinks in the last fifth of it (picture/landmarks/meadow). */
export const SHEEP_PERIOD = 7.2;

/** The drawbridge's leaf on Harbour's start straight, raised for a quarter of every ten seconds (the signals and the counterweights follow it). */
export const DRAWBRIDGE = { period: 10, from: 0.7, to: 0.95 } as const;

/**
 * The gentle opener, a bigger and busier one than it was. Off the line the road passes the farm gate, kinks, and climbs the
 * windmill's hill (eleven metres, a long left-hander with a strip of boost on its inside) with round hay bales rolling down
 * it at you and a lip on the outside of the bend for a hop; or, from the straight, it takes the creek road, low through the
 * hollow, over the ford (wet stones as slippery as ice) and up under two oaks that let go their acorns on a beat. The roads
 * meet again on the way down from the crest, where a glide takes the kart off the brow and floats it 90 m down the hill over
 * the pond to the meadow. Then the S over the meadow and the big U-turn, a flock of sheep crossing the bottom of it (the
 * gate's lamp blinks before), with the barn cut across its inside (a hay ramp, a creek to fly and the barn itself). The
 * road home is a low hill, and the banked hairpin round the pond (the duck). About 1.15 km.
 */
export const MEADOW_LOOP: TrackDef = {
  id: "meadow-loop",
  name: "Meadow Loop",
  theme: "meadow",
  blurb: "A gentle opener: up the windmill's hill or down the creek road, glide off the crest over the pond, past the crossing sheep and through the barn.",
  laps: 3,
  width: 14,
  points: [
    { x: 0, z: 0 },
    { x: 0, z: 60, y: 0.3 },
    { x: 0, z: 118, y: 0.8 },
    // A quick kink at the farm gate, and up the windmill's hill.
    { x: -8, z: 146, y: 1.2, bank: 0.1 },
    { x: 2, z: 178, y: 2, bank: -0.1 },
    { x: 30, z: 206, y: 3.6, bank: -0.12 },
    { x: 74, z: 222, y: 5.4, bank: -0.12 },
    { x: 120, z: 220, y: 7.6, bank: -0.12 },
    { x: 160, z: 200, y: 9.4, bank: -0.12 },
    { x: 186, z: 168, y: 10.6, bank: -0.08 },
    { x: 196, z: 134, y: 11 },
    // Down the east side, over the pond.
    { x: 196, z: 104, y: 9.8 },
    { x: 195, z: 72, y: 7.4 },
    { x: 194, z: 40, y: 4.6 },
    { x: 194, z: 8, y: 2.8 },
    // The S over the meadow.
    { x: 204, z: -22, y: 2.2, width: 13, bank: 0.12 },
    { x: 188, z: -52, y: 1.4, width: 13, bank: -0.14 },
    { x: 202, z: -80, y: 0.8, bank: -0.12 },
    // The big U-turn.
    { x: 196, z: -112, y: 0 },
    { x: 166, z: -136, y: -1, width: 16, bank: -0.16 },
    { x: 124, z: -134, y: -0.6, width: 16, bank: -0.14 },
    { x: 98, z: -106, y: 0.6, bank: -0.1 },
    { x: 92, z: -66, y: 2.2 },
    { x: 94, z: -24, y: 3.2 },
    { x: 82, z: 12, y: 4, bank: 0.14 },
    { x: 50, z: 26, y: 3, bank: 0.14 },
    { x: 40, z: 4, y: 1.6 },
    // Down by the pond and round the banked hairpin.
    { x: 40, z: -38, y: 0.2 },
    { x: 33, z: -66, y: -0.3, bank: -0.2 },
    { x: 14, z: -80, y: -0.2, bank: -0.24 },
    { x: -6, z: -64, y: -0.1, bank: -0.2 },
    { x: 0, z: -44 },
    { x: 0, z: -24 },
  ],
  itemRows: [0.1934, 0.5898, 0.8219],
  boostPads: [
    { at: 0.6188, offset: 0 },
    { at: 0.8412, offset: 2 },
  ],
  // The inside line of the windmill's left-hander is a strip of boost for whoever hugs it.
  surfaces: [{ from: 0.1934, to: 0.2708, kind: "boost", offset: -4, width: 3 }],
  // A lip on the outside of the climb for a hop, and the glide off the brow down the hill over the pond.
  air: [
    { kind: "lip", at: 0.2823, length: 32, height: 3, offset: 3, width: 6 },
    { kind: "glide", at: 0.4249, length: 76, height: 8 },
  ],
  drops: [{ from: 0.4269, to: 0.4891, side: "both" }],
  hazards: [
    // Round hay bales roll down the climb at whoever goes up.
    { kind: "hay-roll", at: 0.2030, motion: "roll", period: 6.2, radius: 1.35, offset: -3, span: 0.0599 },
    { kind: "hay-roll", at: 0.2030, motion: "roll", period: 6.2, phase: 0.5, radius: 1.35, offset: 3, span: 0.0599 },
    // The flock crosses once every beat, once the gate's lamp has blinked.
    { kind: "sheep-flock", at: 0.6323, motion: "slide", period: SHEEP_PERIOD, radius: 2.2, span: 12 },
  ],
  routes: [
    {
      // The low road: leaves the start straight, winds south of the windmill through the hollow, fords the creek (a stretch of
      // wet stones, as slippery as ice) and climbs out under two oaks that drop their acorns on a beat, to meet the hill road
      // on its way down from the crest. The hill road is the high one, faster and longer; the creek road is shorter but slow.
      id: "creek-road",
      kind: "split",
      from: 0.0776,
      to: 0.3988,
      width: 11,
      appeal: 0.55,
      points: [
        { x: 26, z: 118, y: 0.4, bank: 0.1 },
        { x: 56, z: 90, y: -0.8, bank: -0.1 },
        { x: 92, z: 80, y: -1.6, bank: 0.1 },
        { x: 128, z: 100, y: 0.8, bank: 0.1 },
        { x: 152, z: 128, y: 6.2, bank: -0.1 },
        { x: 170, z: 142, y: 9.6 },
        { x: 186, z: 134, y: 11 },
      ],
      surfaces: [{ from: 0.28, to: 0.46, kind: "ice", offset: 0, width: 9 }],
      hazards: [
        { kind: "acorn", at: 0.7, motion: "crush", period: 4.4, radius: 1.3, offset: -3 },
        { kind: "acorn", at: 0.7, motion: "crush", period: 4.4, phase: 0.33, radius: 1.3, offset: 3 },
        { kind: "acorn", at: 0.8, motion: "crush", period: 4.4, phase: 0.66, radius: 1.3, offset: 0 },
      ],
      landmarks: [
        { kind: "oak", at: 0.7, offset: -18 },
        { kind: "oak", at: 0.7, offset: 18, turn: 3.14 },
        { kind: "pond", at: 0.38, offset: 30, scale: 0.8 },
        { kind: "hay-bales", at: 0.35, offset: 32 },
        { kind: "flower-field", at: 0.5, offset: -36 },
      ],
    },
    {
      // The shortcut through the barn: across the inside of the big U-turn, over a hay-bale ramp and the creek (a gap to fly), in one
      // door of the barn and out of the other onto a strip of boost. Narrow, and a fall costs more than it saves.
      id: "barn-cut",
      kind: "shortcut",
      from: 0.5657,
      to: 0.7334,
      width: 9,
      flare: 30,
      appeal: 0.85,
      points: [
        { x: 184, z: -92, y: 0.4 },
        { x: 154, z: -88, y: -0.3 },
        { x: 130, z: -80, y: 0.4 },
        { x: 112, z: -70, y: 1.5 },
      ],
      ramps: [{ at: 0.4 }],
      drops: [{ from: 0.408, to: 0.47, side: "both", gap: true }],
      surfaces: [
        { from: 0.84, to: 0.9, kind: "boost", width: 3 },
      ],
      landmarks: [{ kind: "barn-run", at: 0.6, offset: 0, span: 26 }],
    },
  ],
  landmarks: [
    { kind: "windmill", at: 0.2655, offset: -52, scale: 1.6 },
    { kind: "barn", at: 0.0514, offset: -36, turn: 0.3 },
    { kind: "hay-bales", at: 0.0280, offset: 17.5 },
    { kind: "sheep", at: 0.1310, offset: 30 },
    { kind: "hot-air-balloon", at: 0.1918, offset: 55, scale: 1.5 },
    { kind: "flower-field", at: 0.2574, offset: 42 },
    { kind: "flower-field", at: 0.3790, offset: 42, scale: 1.2 },
    { kind: "pond", at: 0.4593, offset: -34, scale: 1 },
    { kind: "pond", at: 0.4641, offset: 34, scale: 1 },
    { kind: "barn", at: 0.5300, offset: 40, turn: 3.1 },
    { kind: "farm-gate", at: 0.6323, offset: -17.5 },
    { kind: "farm-gate", at: 0.6323, offset: 17.5 },
    { kind: "sheep", at: 0.5990, offset: 30 },
    { kind: "hot-air-balloon", at: 0.6785, offset: 65, scale: 1.3 },
    { kind: "hay-bales", at: 0.8142, offset: -17.5 },
    { kind: "pond", at: 0.9250, offset: 40, scale: 0.9 },
  ],
  duck: { at: 0.9250, offset: 38 },
};

/**
 * Toy karts on a giant kitchen counter, late afternoon, the sun through the window. A chopping-board start straight, round
 * the fruit bowl, a chicane between the salt and the pepper, then the sink: a ramp off a cookbook over it (fall in and the
 * drone fishes you out; the duck floats there) or round it down the steel drainer, where a tap drips on a beat. The counter
 * sweeps right round the oranges rolling at you (the cutlery drawer is the way across its inside), up to the mixer's
 * spinning whisk, over the cooker (four metres up, a spatula to hop off) and down to the spilt milk on the corner. The last
 * straight starts at the toaster: a pair of slots that fire the kart across the crumb tray, a pair of slices popping on the
 * far side, and under the cheese grater home. The bends lean into their turns. About 1.25 km.
 */
export const KITCHEN_RALLY: TrackDef = {
  id: "kitchen-rally",
  name: "Kitchen Rally",
  theme: "kitchen",
  laps: 3,
  width: 15,
  blurb: "Toy karts on a giant kitchen counter: over the sink or down the drainer, round the whisk, over the cooker and through the toaster's cannon.",
  points: [
    { x: 0.0, z: 0.0 },  // s 0
    { x: 0.0, z: 16.1 },  // s 16
    { x: 0.0, z: 32.2 },  // s 32
    { x: 0.0, z: 48.3 },  // s 48
    { x: 0.0, z: 64.4 },  // s 64
    { x: 0.0, z: 80.5 },  // s 80
    { x: 0.0, z: 96.5 },  // s 97
    { x: -0.1, z: 112.6, bank: 0.03 },  // s 113
    { x: -2.9, z: 128.4, bank: 0.14 },  // s 129
    { x: -9.8, z: 142.9, bank: 0.14 },  // s 145
    { x: -20.3, z: 155.0, bank: 0.14 },  // s 161
    { x: -33.7, z: 163.9, bank: 0.14 },  // s 177
    { x: -48.9, z: 169.0, bank: 0.14 },  // s 193
    { x: -64.9, z: 169.8, bank: 0.03 },  // s 209
    { x: -80.8, z: 167.3, bank: -0.04 },  // s 225
    { x: -96.7, z: 164.6, bank: -0.10 },  // s 241
    { x: -112.4, z: 166.8, bank: -0.03 },  // s 257
    { x: -126.5, z: 174.6, bank: 0.06 },  // s 274
    { x: -142.2, z: 177.3, bank: 0.02 },  // s 290
    { x: -158.0, z: 174.7 },  // s 306
    { x: -173.9, z: 171.9 },  // s 322
    { x: -189.7, z: 169.1 },  // s 338
    { x: -205.6, z: 166.3 },  // s 354
    { x: -221.4, z: 163.5 },  // s 370
    { x: -237.3, z: 160.8 },  // s 386
    { x: -253.1, z: 158.0 },  // s 402
    { x: -269.0, z: 155.2 },  // s 418
    { x: -284.8, z: 152.2, bank: 0.01 },  // s 434
    { x: -300.2, z: 147.7, width: 16.6, bank: 0.09 },  // s 451
    { x: -314.9, z: 141.1, width: 17.9, bank: 0.09 },  // s 467
    { x: -328.6, z: 132.8, width: 18, bank: 0.10 },  // s 483
    { x: -341.2, z: 122.8, width: 18, bank: 0.10 },  // s 499
    { x: -352.4, z: 111.2, width: 18, bank: 0.10 },  // s 515
    { x: -362.0, z: 98.3, width: 18, bank: 0.10 },  // s 531
    { x: -369.8, z: 84.3, width: 18, bank: 0.10 },  // s 547
    { x: -375.8, z: 69.4, width: 18, bank: 0.10 },  // s 563
    { x: -379.9, z: 53.8, width: 18, bank: 0.10 },  // s 579
    { x: -381.8, z: 37.8, width: 18, bank: 0.10 },  // s 595
    { x: -381.8, z: 21.8, width: 18, bank: 0.10 },  // s 611
    { x: -379.6, z: 5.8, width: 18, bank: 0.10 },  // s 628
    { x: -375.5, z: -9.7, width: 18, bank: 0.10 },  // s 644
    { x: -369.4, z: -24.6, width: 18, bank: 0.10 },  // s 660
    { x: -361.4, z: -38.5, width: 18, bank: 0.10 },  // s 676
    { x: -351.7, z: -51.4, width: 18, bank: 0.10 },  // s 692
    { x: -340.4, z: -62.8, width: 17.8, bank: 0.09 },  // s 708
    { x: -327.8, z: -72.8, width: 16.3, bank: 0.10 },  // s 724
    { x: -314.0, z: -81.0, bank: 0.01 },  // s 740
    { x: -299.4, z: -87.9, y: 0.31, width: 19 },  // s 756
    { x: -284.8, z: -94.7, y: 0.86, width: 19 },  // s 772
    { x: -270.2, z: -101.5, y: 1.57, width: 19 },  // s 788
    { x: -255.7, z: -108.3, y: 2.33, width: 19 },  // s 805
    { x: -241.1, z: -115.1, y: 3.06, width: 16.5 },  // s 821
    { x: -226.5, z: -121.9, y: 3.63, bank: -0.02 },  // s 837
    { x: -213.3, z: -131.0, y: 3.96, bank: -0.08 },  // s 853
    { x: -202.2, z: -142.7, y: 4, bank: 0.03 },  // s 869
    { x: -189.7, z: -152.8, y: 4.03, bank: 0.08 },  // s 885
    { x: -175.4, z: -160.1, y: 4.08 },  // s 901
    { x: -160.9, z: -166.9, y: 4.13 },  // s 917
    { x: -146.3, z: -173.7, y: 4.17 },  // s 933
    { x: -131.7, z: -180.5, y: 4.2 },  // s 949
    { x: -117.1, z: -187.3, y: 4.03 },  // s 965
    { x: -102.5, z: -194.1, y: 3.23 },  // s 981
    { x: -87.4, z: -199.3, y: 2.09, bank: 0.11 },  // s 998
    { x: -71.3, z: -199.7, y: 0.96, bank: 0.10 },  // s 1014
    { x: -56.0, z: -195.2, y: 0.17, bank: 0.10 },  // s 1030
    { x: -42.7, z: -186.2, bank: 0.10 },  // s 1046
    { x: -32.8, z: -173.6, bank: 0.10 },  // s 1062
    { x: -27.2, z: -158.5 },  // s 1078
    { x: -24.4, z: -142.7 },  // s 1094
    { x: -21.6, z: -126.9 },  // s 1110
    { x: -18.8, z: -111.0 },  // s 1126
    { x: -16.0, z: -95.2 },  // s 1142
    { x: -13.2, z: -79.3 },  // s 1158
    { x: -10.4, z: -63.5 },  // s 1175
    { x: -7.6, z: -47.6 },  // s 1191
    { x: -4.8, z: -31.8 },  // s 1207
    { x: -2.0, z: -15.9 },  // s 1223
  ],
  itemRows: [0.0484, 0.2018, 0.4278, 0.7797],
  boostPads: [
    { at: 0.3794, offset: 0 },
    { at: 0.7668, offset: 2 },
  ],
  ramps: [{ at: 0.3245 }],
  // The sink's gap, and the crumb tray under the toaster's cannon.
  drops: [
    { from: 0.3277, to: 0.3390, side: "both", gap: true },
    { from: 0.8927, to: 0.9395, side: "both", gap: true },
  ],
  air: [
    // The spatula lying across the cooker's top: a kicker for a hop.
    { kind: "lip", at: 0.7305, length: 34, height: 3.2, offset: -3, width: 6 },
    // The toaster's slots fire a kart across the crumb tray.
    { kind: "cannon", at: 0.8879, length: 70, height: 8 },
  ],
  surfaces: [
    // The cooker's hob rings: a line of boost up the climb.
    { from: 0.6457, to: 0.6877, kind: "boost", offset: 0, width: 3 },
    // Spilt milk on the corner.
    { from: 0.8071, to: 0.8540, kind: "ice" },
  ],
  routes: [
    {
      // The drainer: round the sink on the right instead of jumping it. Down the steel draining board (ribbed, wet, slippery
      // as ice) into a trough three metres below the counter, where the tap drips on a beat, and up the far end onto the
      // counter again past where the others land. Two ways of much the same length; the drainer is the safe one.
      id: "drainer",
      kind: "split",
      from: 0.2462,
      to: 0.3648,
      width: 10.5,
      flare: 26,
      appeal: 0.55,
      points: [
        { x: -178.1, z: 148.8, y: -1.2 },
        { x: -201.9, z: 122.3, y: -3.2 },
        { x: -235.0, z: 114.4, y: -3.2 },
        { x: -271.1, z: 134.5, y: -1 },
      ],
      surfaces: [{ from: 0.28, to: 0.7, kind: "ice", width: 7 }],
      hazards: [
        { kind: "drip", at: 0.46, motion: "crush", period: 3.8, radius: 0.8, top: 6, offset: -3 },
        { kind: "drip", at: 0.5, motion: "crush", period: 3.8, phase: 0.5, radius: 0.8, top: 6, offset: 3 },
      ],
      landmarks: [{ kind: "drainer", at: 0.5, offset: 0, span: 70 }],
    },
    {
      // The cutlery drawer: out of the sweeping curve early, across its inside, down a ramp into a drawer pulled right out of
      // the counter (walnut walls, felt underfoot, spoons and forks laid across overhead), a pea rolling across its middle and
      // a line of boost to be had, and up out of it onto the road again. Narrow, and a fifth shorter than the curve.
      id: "cutlery-drawer",
      kind: "shortcut",
      from: 0.3648,
      to: 0.5973,
      width: 9,
      flare: 28,
      appeal: 0.85,
      points: [
        { x: -312.2, z: 100.2, y: -0.6 },
        { x: -314.0, z: 61.7, y: -2.2 },
        { x: -308.1, z: 31.5, y: -2.4 },
        { x: -313.6, z: 2.5, y: -1.2 },
        { x: -318.0, z: -34.6, y: -0.3 },
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
    // The oranges roll round the sweeping curve at whoever drives it.
    { kind: "orange", motion: "roll", period: 6.4, radius: 1.7, offset: -3.4, at: 0.5004, span: 0.055 },
    { kind: "orange", motion: "roll", period: 6.4, phase: 0.5, radius: 1.7, offset: 3.4, at: 0.5004, span: 0.055 },
    // The mixer's whisk turns across the road: two beaters, half a turn apart.
    ...sweeper({ kind: "whisk", at: 0.6312, offset: 0, length: 5.6, from: 2.6, period: 5.2, radius: 1.25, both: true }),
    // The toast pops: two slices spring up out of the road in turn, by the toaster.
    { kind: "toast", motion: "bob", period: 3.6, radius: 1.1, offset: -3.5, at: 0.9605 },
    { kind: "toast", motion: "bob", period: 3.6, phase: 0.5, radius: 1.1, offset: 3.5, at: 0.9605 },
  ],
  landmarks: [
    { kind: "teapot", at: 0.0169, offset: 80, scale: 1.4, turn: 0.5 },
    { kind: "fruit-bowl", at: 0.1291, offset: 62, scale: 1.2 },
    { kind: "spoon-arch", at: 0.1824, offset: 0, span: 12 },
    { kind: "salt-shaker", at: 0.2034, offset: -27.5 },
    { kind: "pepper-mill", at: 0.2260, offset: 31.5 },
    { kind: "wall-clock", at: 0.2696, offset: -90, scale: 1.4 },
    { kind: "cookbook", at: 0.2954, offset: -30, turn: 0.2 },
    { kind: "cookbook", at: 0.3551, offset: -46, scale: 1.2, turn: -0.4 },
    { kind: "sink", at: 0.3334, offset: 0 },
    { kind: "window", at: 0.05, offset: -100, scale: 2 },
    { kind: "cereal-box", at: 0.2421, offset: 48, scale: 1.2 },
    { kind: "fork-arch", at: 0.4197, offset: 0, span: 10 },
    { kind: "mug", at: 0.2276, offset: -48 },
    { kind: "mixer", at: 0.6312, offset: 0, span: 16 },
    { kind: "cooker", at: 0.6457, offset: 0, span: 56 },
    { kind: "spatula", at: 0.7305, offset: 21, turn: 1.57 },
    { kind: "toaster", at: 0.8879, offset: -42, turn: 1.57 },
    { kind: "grater", at: 0.9766, offset: 0, span: 30 },
    { kind: "cereal-box", at: 0.8394, offset: 46, turn: 0.4 },
    { kind: "mug", at: 0.9282, offset: 40, scale: 1.1 },
  ],
  duck: { at: 0.3334, offset: 4, y: 2.9 },
};

/**
 * A quay circuit at night, a long headland loop. Off the line the quay runs along the water to the drawbridge, whose leaf
 * rises and falls on the race clock (a lamp and a bell before it goes up; with the leaf raised the kart flies off its tip,
 * with it lowered the bridge is just road), then sweeps left, up onto the sea wall and round the lighthouse hairpin with the
 * open water on its outside, and down past the warehouses in a chicane. Then the ship: the main road goes up a gangway onto
 * the deck of a cargo ship (boost down the deck, no barrier, a gantry crane over it) and off the stern in the ship's
 * cannon, across the water to the pier; the quay beside it is the plain, safe way, with a forklift and the crabs crossing.
 * Two cranes swing containers across the road, half a beat apart, before the dry-dock hairpin; the ferry ramp is a gap to fly
 * on the way home. Wide (16 m) and fast. The duck sits by the lighthouse. About 1.2 km.
 */
export const HARBOUR_LIGHTS: TrackDef = {
  id: "harbour-lights",
  name: "Harbour Lights",
  theme: "harbour",
  blurb: "Night on the quay: fly the drawbridge when it is up, round the lighthouse, up the gangway and off the ship's cannon, then dodge the swinging containers.",
  laps: 3,
  width: 16,
  points: [
    { x: 0.0, z: 0.0 },  // s 0
    { x: 0.0, z: 16.0 },  // s 16
    { x: 0.0, z: 32.0 },  // s 32
    { x: 0.0, z: 48.0 },  // s 48
    { x: 0.0, z: 64.0 },  // s 64
    { x: 0.0, z: 80.0 },  // s 80
    { x: 0.0, z: 95.9 },  // s 96
    { x: 0.0, z: 111.9 },  // s 112
    { x: 0.1, z: 127.9 },  // s 128
    { x: 1.2, z: 143.9, bank: -0.04 },  // s 144
    { x: 3.5, z: 159.7, bank: -0.05 },  // s 160
    { x: 6.8, z: 175.4, bank: -0.05 },  // s 176
    { x: 11.1, z: 190.7, bank: -0.05 },  // s 192
    { x: 16.6, z: 205.8, y: 0.15, bank: -0.05 },  // s 208
    { x: 23.1, z: 220.4, y: 1.2, bank: -0.05 },  // s 224
    { x: 30.5, z: 234.5, y: 2.74, bank: -0.04 },  // s 240
    { x: 39.0, z: 248.1, y: 4.19 },  // s 256
    { x: 45.6, z: 262.6, y: 4.97, bank: 0.06 },  // s 272
    { x: 46.8, z: 278.4, y: 5, bank: 0.16 },  // s 288
    { x: 42.4, z: 293.7, y: 5, bank: 0.16 },  // s 304
    { x: 32.9, z: 306.5, y: 5, bank: 0.16 },  // s 320
    { x: 19.6, z: 315.2, y: 5, bank: 0.16 },  // s 336
    { x: 4.1, z: 318.7, y: 5, bank: 0.16 },  // s 352
    { x: -11.7, z: 316.6, y: 5, bank: 0.16 },  // s 368
    { x: -25.7, z: 309.2, y: 5, bank: 0.11 },  // s 384
    { x: -36.4, z: 297.4, y: 4.24 },  // s 400
    { x: -45.3, z: 284.1, y: 2.4 },  // s 416
    { x: -54.2, z: 270.8, y: 0.62, bank: -0.06 },  // s 432
    { x: -63.2, z: 257.6, bank: -0.10 },  // s 448
    { x: -74.1, z: 245.9, bank: -0.10 },  // s 464
    { x: -88.0, z: 238.3, bank: -0.02 },  // s 480
    { x: -102.8, z: 232.2, bank: 0.06 },  // s 496
    { x: -115.0, z: 222.0, bank: 0.10 },  // s 512
    { x: -123.3, z: 208.5, bank: 0.10 },  // s 528
    { x: -127.0, z: 193.0 },  // s 544
    { x: -128.7, z: 177.1, y: 0.68 },  // s 560
    { x: -130.3, z: 161.2, y: 2.46, width: 15.6 },  // s 576
    { x: -131.9, z: 145.2, y: 3, width: 14 },  // s 592
    { x: -133.6, z: 129.3, y: 3, width: 14 },  // s 608
    { x: -135.2, z: 113.4, y: 3, width: 14 },  // s 624
    { x: -136.8, z: 97.5, y: 3, width: 14 },  // s 640
    { x: -138.5, z: 81.6, y: 3, width: 14.4 },  // s 656
    { x: -140.1, z: 65.7, y: 3 },  // s 672
    { x: -141.7, z: 49.8, y: 3 },  // s 688
    { x: -143.4, z: 33.9, y: 3 },  // s 704
    { x: -145.0, z: 18.0, y: 2.33 },  // s 720
    { x: -146.7, z: 2.1, y: 0.55 },  // s 736
    { x: -147.2, z: -13.8, bank: 0.10 },  // s 752
    { x: -142.0, z: -28.9, bank: 0.09 },  // s 768
    { x: -132.2, z: -41.4, bank: -0.05 },  // s 784
    { x: -125.9, z: -56.0, bank: -0.10 },  // s 800
    { x: -125.5, z: -71.9 },  // s 816
    { x: -127.2, z: -87.8 },  // s 832
    { x: -128.8, z: -103.7 },  // s 848
    { x: -130.4, z: -119.6 },  // s 864
    { x: -132.1, z: -135.5 },  // s 880
    { x: -133.6, z: -151.4 },  // s 895
    { x: -131.2, z: -167.2, bank: 0.15 },  // s 911
    { x: -123.4, z: -181.1, bank: 0.16 },  // s 927
    { x: -111.4, z: -191.4, bank: 0.16 },  // s 943
    { x: -96.4, z: -196.9, bank: 0.16 },  // s 959
    { x: -80.5, z: -196.8, bank: 0.16 },  // s 975
    { x: -65.6, z: -191.3, bank: 0.16 },  // s 991
    { x: -53.6, z: -180.9, bank: 0.02 },  // s 1007
    { x: -44.7, z: -167.6 },  // s 1023
    { x: -36.7, z: -153.7, bank: 0.02 },  // s 1039
    { x: -29.4, z: -139.5, bank: 0.03 },  // s 1055
    { x: -22.9, z: -124.9, bank: 0.03 },  // s 1071
    { x: -17.2, z: -110.0, bank: 0.03 },  // s 1087
    { x: -12.2, z: -94.8, bank: 0.03 },  // s 1103
    { x: -8.1, z: -79.3, bank: 0.03 },  // s 1119
    { x: -4.8, z: -63.7, bank: 0.03 },  // s 1135
    { x: -2.4, z: -47.9, bank: 0.03 },  // s 1151
    { x: -0.8, z: -32.0, bank: 0.03 },  // s 1167
    { x: -0.1, z: -16.0, bank: 0.03 },  // s 1183
  ],
  itemRows: [0.0375, 0.3419, 0.6712, 0.7879],
  boostPads: [
    { at: 0.3585, offset: 0 },
    { at: 0.8588, offset: 3 },
  ],
  // The ferry ramp: a slip into the water on the home straight, a gap to fly with a trick lip, and the far slip to land on.
  ramps: [{ at: 0.9088 }],
  drops: [
    // The dock the drawbridge crosses, the sea wall's outer edge, the ship's deck, the water between the stern and the pier, the ferry slip.
    { from: 0.0825, to: 0.1059, side: "both" },
    { from: 0.2185, to: 0.3269, side: "left" },
    { from: 0.4919, to: 0.5436, side: "both" },
    { from: 0.5470, to: 0.5870, side: "both", gap: true },
    { from: 0.9122, to: 0.9239, side: "both", gap: true },
  ],
  air: [
    // The drawbridge's leaf: live only while it is raised.
    { kind: "lip", at: 0.0792, length: 30, height: 3.4, timed: DRAWBRIDGE },
    // The ship's stern cannon: across the water to the pier.
    { kind: "cannon", at: 0.5436, length: 56, height: 7 },
  ],
  surfaces: [
    // A line of boost down the ship's deck.
    { from: 0.4969, to: 0.5353, kind: "boost", offset: 0, width: 3 },
  ],
  routes: [
    {
      // The quay: the plain way beside the ship, at ground level, with a forklift and crabs scuttling across. The main road goes
      // over the deck (the way with the boost and the cannon); the quay is as long and has nothing to fall off.
      id: "quay",
      kind: "split",
      from: 0.4336,
      to: 0.6470,
      width: 12,
      flare: 26,
      appeal: 0.3,
      points: [
        { x: -108.8, z: 174.7, y: 0.6 },
        { x: -90, z: 137.3, y: 1.3 },
        { x: -92, z: 83.3, y: 1.2 },
        { x: -100, z: 27.8, y: 0.9 },
        { x: -131.5, z: -7.8, y: 0.1 },
      ],
      hazards: [
        { kind: "crab", at: 0.3, motion: "cross", period: 5.2, radius: 1.3 },
        { kind: "crab", at: 0.4, motion: "cross", period: 5.2, phase: 0.5, radius: 1.3 },
        { kind: "forklift", at: 0.6, motion: "cross", period: 8, radius: 2.2 },
      ],
      landmarks: [
        { kind: "containers", at: 0.2, offset: 24 },
        { kind: "containers", at: 0.75, offset: 24, scale: 1.1 },
      ],
    },
  ],
  hazards: [
    // Two cranes swing a container across the road each, half a beat apart.
    pendulum({ kind: "cargo-box", at: 0.6971, offset: 0, reach: 6, period: 6.4, radius: 2 }),
    pendulum({ kind: "cargo-box", at: 0.7237, offset: 0, reach: 6, period: 6.4, phase: 0.5, radius: 2 }),
  ],
  landmarks: [
    { kind: "containers", at: 0.0500, offset: -30 },
    { kind: "drawbridge", at: 0.0792, offset: 0 },
    { kind: "buoy", at: 0.1584, offset: 36 },
    { kind: "lighthouse", at: 0.2727, offset: 52, scale: 1.2 },
    { kind: "buoy", at: 0.3002, offset: -36 },
    { kind: "warehouse", at: 0.3919, offset: -50, scale: 1.4 },
    { kind: "warehouse", at: 0.4169, offset: 62 },
    { kind: "ship", at: 0.5170, offset: -118, scale: 2.2 },
    { kind: "ship-deck", at: 0.5170, offset: 0, span: 56 },
    { kind: "crane", at: 0.5837, offset: -52, scale: 1.2 },
    { kind: "containers", at: 0.6504, offset: -52, scale: 1.1 },
    { kind: "crane", at: 0.6971, offset: -36, scale: 1.3 },
    { kind: "crane", at: 0.7237, offset: 36, scale: 1.1 },
    { kind: "warehouse", at: 0.7754, offset: -54, scale: 1.3 },
    { kind: "buoy", at: 0.8088, offset: -34 },
    { kind: "containers", at: 0.8672, offset: 33 },
    { kind: "crane", at: 0.9172, offset: -30, scale: 1.2 },
    { kind: "containers", at: 0.9797, offset: -36 },
    { kind: "warehouse", at: 0.9422, offset: -42 },
  ],
  duck: { at: 0.2752, offset: 58 },
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
    // The ridge road, and the gap in it.
    { x: -108, z: 180, y: 16.3 },
    { x: -109, z: 130, y: 16.2 },
    { x: -113, z: 80, y: 16 },
    { x: -122, z: 40, y: 15.6, bank: -0.16 },
    // The tumble: a lip to fly off, then down through the S-bends, each leaning its own way.
    // The rope bridge: ten metres of planks over the gorge, nothing on either side.
    { x: -154.6, z: 20, y: 15.3, width: 10 },
    { x: -170.2, z: 13.3, y: 14.9, width: 10 },
    { x: -181.1, z: 8.3, y: 12.6 },
    { x: -200, z: -5, y: 10.4, bank: 0.18 },
    { x: -209, z: -40, y: 8.6, bank: -0.18 },
    { x: -232, z: -80, y: 6.2, bank: 0.15 },
    // The neck: twelve metres between the walls.
    { x: -225, z: -119, y: 4.4, width: 12, bank: 0.12 },
    { x: -184, z: -139, y: 2.8, width: 12 },
    { x: -148, z: -148, y: 1.6, width: 12, bank: -0.14 },
    { x: -129, z: -172, y: 2.4 },
    { x: -90, z: -198, y: 3.4, bank: 0.15 },
    { x: -52, z: -177, y: 2.8, width: 18, bank: 0.15 },
    // The wash: the gorge opens into a wide sandy bed, twenty-two metres across, under the rock crushers.
    { x: -48, z: -131, y: 0.6, width: 22 },
    { x: -43, z: -95, y: 1.4, width: 18, bank: -0.12 },
    { x: -14, z: -70, y: 0.5, bank: 0.12 },
    { x: -4, z: -35, y: 0.1 },
  ],
  itemRows: [0.16, 0.31, 0.66, 0.9],
  boostPads: [
    { at: 0.27, offset: -2 },
    { at: 0.8, offset: 2 },
    // The brave line through the crushers' middle lane.
    { at: 0.8755, offset: 0 },
  ],
  ramps: [
    { at: 0.3715 },
  ],
  drops: [
    { from: 0.3729, to: 0.3854, side: "both", gap: true },
    // The rope bridge has no rails.
    { from: 0.452, to: 0.492, side: "both" },
  ],
  verges: [
    { from: 0.1885, to: 0.3046, side: "right", distance: 24, surface: "sand" },
  ],
  hazards: [
    { kind: "tumbleweed", at: 0.0464, motion: "cross", period: 6, radius: 1.5 },
    { kind: "boulder", at: 0.6427, motion: "roll", period: 5, radius: 2.4, offset: -2.5, span: 0.0557 },
    { kind: "boulder", at: 0.6427, motion: "roll", period: 5, phase: 0.55, radius: 2.4, offset: -2.5, span: 0.0557 },
    // The mine rails cross the ridge road: two ore carts, one each way, a lamp lit on the post before each runs.
    crosser({ at: 0.29, reach: 10, period: 6.4 }),
    crosser({ at: 0.299, reach: -10, period: 6.4, phase: 0.5 }),
    // The quarry on the way down: two wrecking balls swing across the road a beat apart.
    pendulum({ at: 0.527, reach: 4.5, period: 3.2 }),
    pendulum({ at: 0.549, reach: 4.5, period: 3.2, phase: 0.5 }),
    // The rails cross again out of the neck.
    crosser({ at: 0.738, reach: 10, period: 5.8, phase: 0.2 }),
    crosser({ at: 0.748, reach: -10, period: 5.8, phase: 0.7 }),
    // The wash: three rock crushers in a wave (the middle lane has the boost).
    ...stomperRow({ at: 0.862, lanes: [-6, 0, 6], period: 4.4, stagger: 0.22, radius: 2.2 }),
  ],
  landmarks: [
    { kind: "mesa", at: 0.065, offset: -88, scale: 1.6 },
    { kind: "cactus-grove", at: 0.0418, offset: 34 },
    { kind: "rock-arch", at: 0.1393, offset: 0, span: 16 },
    { kind: "cactus-grove", at: 0.1672, offset: -34 },
    { kind: "mesa", at: 0.2053, offset: 112, scale: 1.8 },
    { kind: "mine-cart", at: 0.2229, offset: -38, scale: 1.1, turn: 0.8 },
    { kind: "water-tower", at: 0.2433, offset: -34, scale: 1.3 },
    { kind: "mesa", at: 0.3083, offset: -65, scale: 1.5 },
    { kind: "cactus-grove", at: 0.3343, offset: -30 },
    { kind: "mesa", at: 0.3808, offset: -78, scale: 1.7 },
    { kind: "cactus-grove", at: 0.4829, offset: 34 },
    { kind: "mine-cart", at: 0.548, offset: -26, scale: 1.0, turn: -0.5 },
    { kind: "mesa", at: 0.5387, offset: 62 },
    { kind: "cactus-grove", at: 0.6501, offset: -32, scale: 1.2 },
    { kind: "mesa", at: 0.7355, offset: -80, scale: 1.4 },
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
  blurb: "Dusk at the fair, every ride lit: under the arch, through the big top, across the bumper-car plaza, off the helter-skelter, home under the fireworks.",
  points: [
    { x: 0, z: 0 },
    { x: 0, z: 35 },
    { x: 0, z: 70 },
    { x: 0, z: 105 },
    { x: 0, z: 140 },
    { x: 7.4, z: 167.5, bank: -0.12 },
    { x: 27.5, z: 187.6, bank: -0.12 },
    { x: 55, z: 195 },
    // Along the top on the rollercoaster's own course: the lift hill (six and a half metres at 5%) with a weave
    // either side of the crest, then the plunge (nearly nine metres in under ninety) to the dip under the
    // coaster, and round the banked hairpin.
    { x: 98.4, z: 201, y: 0.8, bank: 0.06 },
    { x: 141.8, z: 214, y: 4.6, bank: 0.1 },
    { x: 185.2, z: 203, y: 6.4, bank: -0.1 },
    { x: 228.6, z: 192, y: 1.2, bank: -0.1 },
    { x: 272, z: 195, y: -2.4 },
    { x: 281, z: 192.6, y: -2.2, bank: -0.2 },
    { x: 287.6, z: 186, y: -1.8, bank: -0.3 },
    { x: 290, z: 177, y: -1.5, bank: -0.32 },
    { x: 290, z: 174, y: -1.4, bank: -0.32 },
    { x: 287.6, z: 165, y: -1, bank: -0.3 },
    { x: 281, z: 158.4, y: -0.6, bank: -0.2 },
    { x: 272, z: 156, y: -0.2 },
    { x: 236.3, z: 156 },
    { x: 200.7, z: 156 },
    { x: 165, z: 156 },
    { x: 145, z: 150.6, bank: 0.14 },
    { x: 130.4, z: 136, bank: 0.14 },
    { x: 125, z: 116 },
    { x: 125, z: 78.8, width: 24 },
    { x: 125, z: 41.6, width: 24 },
    { x: 125, z: 4.4, width: 22.5 },
    { x: 125, z: -32.8 },
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
  itemRows: [0.041, 0.3151, 0.4703, 0.6338],
  boostPads: [
    { at: 0.3515, offset: 0 },
    { at: 0.4921, offset: -2 },
    { at: 0.8456, offset: 2 },
  ],
  ramps: [
    { at: 0.7485 },
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
    { kind: "ferris-wheel", at: 0.0546, offset: -88, scale: 1.5 },
    { kind: "fireworks", at: 0.9836, offset: -30 },
    { kind: "fireworks", at: 0.0273, offset: 36, scale: 1.2 },
    { kind: "food-stall", at: 0.1092, offset: 24 },
    { kind: "carousel", at: 0.1671, offset: -46, scale: 1.2 },
    { kind: "food-stall", at: 0.2587, offset: 26, turn: 3.14 },
    { kind: "balloon-stand", at: 0.3042, offset: 28 },
    { kind: "rollercoaster", at: 0.3879, offset: 0, span: 34 },
    { kind: "food-stall", at: 0.387, offset: 22 },
    { kind: "hook-a-duck", at: 0.43, offset: 30, scale: 1.2, turn: 1.57 },
    { kind: "big-top", at: 0.5085, offset: 0, span: 56 },
    { kind: "balloon-stand", at: 0.4757, offset: 26 },
    { kind: "fireworks", at: 0.583, offset: 40 },
    { kind: "food-stall", at: 0.6447, offset: 32 },
    { kind: "ferris-wheel", at: 0.6993, offset: -64, scale: 0.9 },
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
    { x: -150, z: 28.7, y: 4.2 },
    { x: -150, z: -6.2, y: 2.9 },
    { x: -150, z: -41.1, y: 1.8 },
    { x: -150, z: -76, y: 1.6 },
    { x: -145.4, z: -95.9, y: 1.5, bank: 0.12 },
    { x: -132.4, z: -111.7, y: 1.4, bank: 0.16 },
    { x: -113.8, z: -120.1, y: 1.3, bank: 0.1 },
    { x: -93.4, z: -119.5, y: 1.2 },
    { x: -78.4, z: -115.5, y: 0 },
    { x: -63.4, z: -111.5, y: 1.8 },
    { x: -54, z: -109, y: 2.7 },
    { x: -33.4, z: -103.5, y: 0.7 },
    { x: -16.1, z: -94.5, y: 0.5, bank: 0.12 },
    { x: -4.2, z: -79, y: 0.3, bank: 0.12 },
    { x: 0, z: -60, y: 0.1 },
    { x: 0, z: -30 },
  ],
  itemRows: [0.0496, 0.2065, 0.4956, 0.847],
  boostPads: [
    { at: 0.0826, offset: 0 },
    { at: 0.2395, offset: -6 },
    { at: 0.5204, offset: 2 },
    { at: 0.6938, offset: -2 },
    { at: 0.862, offset: -2 },
  ],
  ramps: [
    // A kicker on the frozen lake: a short hop on the ice, a trick for a boost.
    { at: 0.233, lift: 5 },
    { at: 0.74 },
  ],
  drops: [
    { from: 0.7415, to: 0.753, side: "both", gap: true },
    { from: 0.395, to: 0.487, side: "left" },
  ],
  surfaces: [
    { from: 0.17, to: 0.272, kind: "ice" },
    { from: 0.0986, to: 0.1537, kind: "ice", offset: 3.5, width: 7 },
    { from: 0.398, to: 0.474, kind: "ice", offset: 4.5, width: 5 },
    { from: 0.8, to: 0.833, kind: "ice", offset: 3.5, width: 7 },
  ],
  hazards: [
    { kind: "penguin", motion: "cross", period: 6.5, radius: 1.6, at: 0.2195, span: 9 },
    { kind: "snowball", motion: "roll", period: 5, radius: 2.2, offset: -2.5, at: 0.541, span: 0.033 },
    { kind: "snowball", motion: "roll", period: 5, phase: 0.55, radius: 2.2, offset: -2.5, at: 0.541, span: 0.033 },
    { kind: "yeti", motion: "bob", period: 8, phase: 0.1, radius: 2.4, offset: 3.4, at: 0.8736 },
    // The ice cave: icicles let go on a timer, one after another down the cave, shaking first.
    { kind: "icicle", at: 0.5985, motion: "crush", period: 4.5, phase: 0, radius: 1.5, offset: -3.4, top: 7 },
    { kind: "icicle", at: 0.607, motion: "crush", period: 4.5, phase: 0.33, radius: 1.5, offset: 3.4, top: 7 },
    { kind: "icicle", at: 0.6155, motion: "crush", period: 4.5, phase: 0.66, radius: 1.5, offset: -3.4, top: 7 },
    // The avalanche path: big snowballs thunder down the in-run, one down each side in turn.
    { kind: "snowball", motion: "roll", period: 4.6, radius: 2.2, offset: -4.2, at: 0.678, span: 0.03 },
    { kind: "snowball", motion: "roll", period: 4.6, phase: 0.5, radius: 2.2, offset: 4.2, at: 0.678, span: 0.03 },
  ],
  landmarks: [
    { kind: "cabin", at: 0.0331, offset: 36 },
    { kind: "pine-snow", at: 0.0083, offset: -32 },
    { kind: "pine-snow", at: 0.0413, offset: -36, scale: 1.2 },
    { kind: "pine-snow", at: 0.066, offset: -34 },
    { kind: "snowman", at: 0.0826, offset: 30, scale: 1.3 },
    { kind: "ice-arch", at: 0.1852, offset: 0, span: 14 },
    { kind: "igloo", at: 0.2099, offset: 40 },
    { kind: "gondola", at: 0.2265, offset: -60, scale: 1.2 },
    { kind: "pine-snow", at: 0.2315, offset: 34 },
    { kind: "pine-snow", at: 0.318, offset: -38, scale: 1.2 },
    { kind: "igloo", at: 0.3, offset: -40, turn: -0.8 },
    { kind: "snowman", at: 0.37, offset: -32 },
    { kind: "cabin", at: 0.436, offset: 33, turn: 2.5 },
    { kind: "pine-snow", at: 0.53, offset: -34 },
    { kind: "ice-cave", at: 0.607, offset: 0, span: 40 },
    { kind: "pine-snow", at: 0.585, offset: 30, scale: 1.2 },
    { kind: "pine-snow", at: 0.6332, offset: 38 },
    { kind: "ski-jump", at: 0.7301, offset: 31.5 },
    { kind: "pine-snow", at: 0.7548, offset: 34 },
    { kind: "gondola", at: 0.7086, offset: 62 },
    { kind: "igloo", at: 0.8129, offset: -44 },
    { kind: "pine-snow", at: 0.8751, offset: 34 },
    { kind: "snowman", at: 0.8938, offset: -30 },
  ],
  duck: { at: 0.2513, offset: 24 },
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
