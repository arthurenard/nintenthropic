/**
 * The Valle Serra as the placeholder builds it, in plain numbers: the
 * ground's height anywhere (a pure function), the river's and the roads'
 * lines, and where every named thing of the asset contract stands. The
 * placeholder valley (valley.ts) is built from this, and the rules' tests
 * (rules/testkit.ts) play on the same places, so a balance test and a
 * screenshot are of the same valley.
 *
 * Metres, Y up, the player's eye at the origin looking along −Z. The valley
 * floor is 60 m below the eye; the valley runs left to right; the far side
 * climbs through forest and cliffs to peaks 2–3 km away. Distances are the
 * design's: the farm at 250 m, the checkpoint at 280, the bridge at 350,
 * the village and chapel at 500, the dam at 900.
 */

export type XZ = readonly [number, number];
export type XYZ = readonly [number, number, number];

// --- a little deterministic noise -------------------------------------------------

function hash(ix: number, iz: number, seed: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263) ^ Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Smooth value noise in [0, 1]. */
export function noise(x: number, z: number, seed = 1): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz, seed);
  const b = hash(ix + 1, iz, seed);
  const c = hash(ix, iz + 1, seed);
  const d = hash(ix + 1, iz + 1, seed);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

/** Fractal noise, roughly in [−1, 1]. */
export function fbm(x: number, z: number, octaves: number, seed = 1): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let f = 1;
  for (let o = 0; o < octaves; o++) {
    sum += amp * (noise(x * f, z * f, seed + o * 17) * 2 - 1);
    norm += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return sum / norm;
}

/** Ridged noise in [0, 1]: sharp crests, for mountains. */
export function ridged(x: number, z: number, octaves: number, seed = 1): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let f = 1;
  for (let o = 0; o < octaves; o++) {
    const n = 1 - Math.abs(noise(x * f, z * f, seed + o * 31) * 2 - 1);
    sum += amp * n * n;
    norm += amp;
    amp *= 0.5;
    f *= 2.1;
  }
  return sum / norm;
}

const smooth = (a: number, b: number, x: number) => {
  const u = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return u * u * (3 - 2 * u);
};

// --- lines ------------------------------------------------------------------------------

/** Distance from (x, z) to a polyline seen from above, and how far along it that is. */
export function nearestOn(line: readonly XZ[], x: number, z: number): { d: number; s: number; t: number } {
  let best = Number.POSITIVE_INFINITY;
  let bestS = 0;
  let acc = 0;
  let total = 0;
  for (let i = 1; i < line.length; i++) total += Math.hypot(line[i]![0] - line[i - 1]![0], line[i]![1] - line[i - 1]![1]);
  for (let i = 1; i < line.length; i++) {
    const [ax, az] = line[i - 1]!;
    const [bx, bz] = line[i]!;
    const ex = bx - ax;
    const ez = bz - az;
    const len2 = ex * ex + ez * ez;
    const u = len2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / len2)) : 0;
    const d = Math.hypot(ax + ex * u - x, az + ez * u - z);
    const seg = Math.sqrt(len2);
    if (d < best) {
      best = d;
      bestS = acc + seg * u;
    }
    acc += seg;
  }
  return { d: best, s: bestS, t: total > 0 ? bestS / total : 0 };
}

/** The river, flowing from the dam's spillway (right, far) down the valley to the left. */
export const RIVER: readonly XZ[] = [
  [404, -826],
  [400, -740],
  [398, -662],
  [376, -596],
  [336, -528],
  [262, -446],
  [170, -372],
  [95, -336],
  [10, -322],
  [-90, -330],
  [-200, -352],
  [-330, -372],
  [-480, -370],
  [-650, -385],
  [-900, -410],
  [-1300, -430],
];
/** The water's surface, metres (the valley floor is at −60). */
export const RIVER_LEVEL = -61.2;
/** Half the river's width, metres: it widens as it goes down the valley. */
export function riverHalfWidth(t: number): number {
  return 7 + 6 * t;
}

/** The valley road, in the convoy's direction: along the near bank, over the bridge, up to the dam. */
export const ROAD: readonly XZ[] = [
  [-900, -318],
  [-620, -300],
  [-400, -286],
  [-230, -274],
  [-90, -266],
  [40, -262],
  [78, -296],
  [95, -336],
  [112, -374],
  [205, -426],
  [290, -478],
  [336, -548],
  [322, -630],
  [318, -712],
  [316, -800],
];
/** The road on the far bank from the bridge to the village. */
export const VILLAGE_ROAD: readonly XZ[] = [
  [112, -374],
  [40, -398],
  [-40, -428],
  [-100, -452],
  [-150, -462],
];
/** The switchback road climbing the far slope behind the village. */
export const SWITCHBACK: readonly XZ[] = [
  [-150, -462],
  [-210, -520],
  [-120, -560],
  [-230, -610],
  [-130, -655],
  [-250, -700],
];
/** The farm lane down from the farmyard to the road. */
export const FARM_LANE: readonly XZ[] = [
  [-128, -212],
  [-118, -236],
  [-104, -266],
];
export const ROAD_HALF_WIDTH = 3.2;

// --- the ground -------------------------------------------------------------------------

/** The valley floor's height before the river and the roads are cut in. */
function floorHeight(x: number, z: number): number {
  // Gently rising toward the valley's head on the right; small undulations.
  return -60 + smooth(250, 700, x) * 6 + fbm(x * 0.012, z * 0.012, 3, 11) * 1.6;
}

/** Where the valley floor gives way to the far slope (its z), along the valley. */
function farToe(x: number): number {
  return -560 - 70 * smooth(-400, 300, x) + 30 * Math.sin(x / 260);
}

/**
 * Where the near slope meets the floor (its z). The player lies at the
 * brink of the ridge, so the ground falls away steeply right in front of
 * the eye and the whole valley floor is in sight below; to the sides the
 * ridge curls forward a little.
 */
function nearToe(x: number): number {
  return -92 + 14 * Math.sin(x / 170 + 0.6) - 70 * smooth(160, 700, Math.abs(x));
}

/** The far side's rise above the floor, `d` metres beyond its toe: forest, cliffs, then the peaks. */
function farRise(x: number, z: number, d: number): number {
  const body = 540 * (1 - Math.exp(-d / 760)) * (0.82 + 0.3 * fbm(x * 0.0016, 5.5, 2, 45));
  const peaks = ridged(x * 0.0012, z * 0.0012, 5, 41) * 320 * smooth(500, 1900, d);
  const folds = fbm(x * 0.0045, z * 0.0045, 4, 43) * 40 * smooth(0, 350, d);
  // The great cliff: a sheer grey face across the valley, where echoes come from.
  const cliff = 70 * smooth(160, 60, Math.hypot(x - CLIFF_AT[0], (z - CLIFF_AT[1]) * 0.6)) * smooth(-900, -1000, z);
  return body + peaks + folds + cliff;
}

const CLIFF_AT: XZ = [-360, -960];
/** The brink of the ridge, a few metres in front of the eye. */
const BRINK = -1.2;

/** The ground behind the crest: it rolls away, then climbs to the mountains that shade the valley at dawn. */
function behindRidge(x: number, z: number, crest: number): number {
  const back = z - 2;
  return (
    crest -
    0.03 * back +
    smooth(250, 1500, back) * (480 + 200 * fbm(x * 0.002, 7.7, 3, 3)) +
    fbm(x * 0.004, z * 0.004, 4, 9) * 22 * smooth(40, 300, back)
  );
}

/**
 * The ground's height at (x, z): the player's ridge, the valley floor with
 * its river and roads cut in, the far side climbing to the peaks, the
 * mountains behind the ridge (which throw the dawn's shadow across the
 * valley), and the gorge at the valley's head where the dam stands.
 */
export function terrainHeight(x: number, z: number): number {
  const floor = floorHeight(x, z);

  // The player's ridge: a grassy crest just below the eye, then a steep
  // grass-and-rock slope down to the floor, steepest at the top.
  const toe = nearToe(x);
  let h: number;
  const crest = -0.55 + fbm(x * 0.012, 3.1, 2, 5) * 1.2 * smooth(8, 60, Math.abs(x)) + smooth(110, 520, Math.abs(x)) * 26;
  if (z > 2) {
    h = behindRidge(x, z, crest);
  } else if (z > BRINK) {
    // The crest the player lies on, a few metres of grass to the brink.
    h = crest;
  } else if (z > toe) {
    const u = (z - toe) / (BRINK - toe); // 0 at the toe, 1 at the brink
    const shape = Math.pow(u, 1.55);
    h = floor + (crest - floor) * shape + fbm(x * 0.04, z * 0.04, 3, 21) * 1.4 * u * (1 - u) * 4;
  } else {
    h = floor;
  }

  // The far side.
  const ft = farToe(x);
  if (z < ft) h = floor + farRise(x, z, ft - z);

  // The valley's head: a gorge at the right, where the dam holds the reservoir.
  const across = Math.abs(x - GORGE_X);
  const inGorge = 1 - smooth(90, 150, across);
  if (z < -690 && inGorge > 0) {
    const bed = -60 + Math.max(0, -1160 - z) * 0.25;
    h = h * (1 - inGorge) + Math.min(h, bed) * inGorge;
  }

  // The river's bed and its banks.
  const r = nearestOn(RIVER, x, z);
  const half = riverHalfWidth(r.t);
  if (r.d < half + 30) {
    const bank = smooth(half - 2, half + 26, r.d);
    const bed = RIVER_LEVEL - 2.2;
    h = Math.min(h, bed + (h - bed) * bank + 0.8 * bank * (1 - bank));
  }

  // The roads: the ground eased flat under them.
  for (const road of [ROAD, VILLAGE_ROAD, SWITCHBACK]) {
    const q = nearestOn(road, x, z);
    if (q.d < ROAD_HALF_WIDTH + 9) {
      const flatness = 1 - smooth(ROAD_HALF_WIDTH, ROAD_HALF_WIDTH + 9, q.d);
      const centre = roadHeight(road, q.s);
      h = h + (centre - h) * flatness;
    }
  }
  return h;
}

const GORGE_X = 402;

/** A road's height `s` metres along it. */
function roadHeight(road: readonly XZ[], s: number): number {
  const p = pointOn(road, s);
  const x = p[0];
  const z = p[1];
  // Its bed follows the floor, or the slope it climbs; never under the river.
  let h = floorHeight(x, z);
  if (road === SWITCHBACK) h = baseSlope(x, z);
  if (road === ROAD && z < -560) h = floorHeight(x, z) + smooth(-560, -712, z) * 4;
  return Math.max(h, RIVER_LEVEL + 1.4);
}

/** The ground without the roads and river cut in, for the switchback's bed. */
function baseSlope(x: number, z: number): number {
  const ft = farToe(x);
  const floor = floorHeight(x, z);
  if (z >= ft) return floor;
  return floor + farRise(x, z, ft - z) * 0.9;
}

/** The point `s` metres along a line. */
export function pointOn(line: readonly XZ[], s: number): [number, number] {
  let acc = 0;
  for (let i = 1; i < line.length; i++) {
    const [ax, az] = line[i - 1]!;
    const [bx, bz] = line[i]!;
    const seg = Math.hypot(bx - ax, bz - az);
    if (acc + seg >= s || i === line.length - 1) {
      const u = seg > 0 ? Math.max(0, Math.min(1, (s - acc) / seg)) : 0;
      return [ax + (bx - ax) * u, az + (bz - az) * u];
    }
    acc += seg;
  }
  const last = line[line.length - 1]!;
  return [last[0], last[1]];
}

/** The ground's height, or the bridge's deck and the dam's crest where they are. */
export function standHeight(x: number, z: number): number {
  const b = nearestOn(ROAD, x, z);
  if (b.d < ROAD_HALF_WIDTH + 0.5) {
    const onBridge = Math.hypot(x - BRIDGE[0], z - BRIDGE[1]) < BRIDGE_SPAN / 2;
    if (onBridge) return BRIDGE_DECK;
  }
  if (Math.abs(z - DAM.z) < DAM.thick / 2 + 0.5 && x > DAM.x0 && x < DAM.x1) return DAM.crest;
  return terrainHeight(x, z);
}

// --- the places ------------------------------------------------------------------------

/** The stone bridge, 350 m away: its centre over the river, its span, its deck. */
export const BRIDGE: XZ = [95, -336];
export const BRIDGE_SPAN = 44;
export const BRIDGE_DECK = RIVER_LEVEL + 6.5;
/** The line the convoy must not cross: the bridge's near end. */
export const BRIDGE_CROSS: XZ = [84, -312];

/** The dam across the gorge at the valley's head, 900 m away. */
export const DAM = { x0: 312, x1: 492, z: -838, thick: 7, crest: -12, base: -58 } as const;
export const RESERVOIR_LEVEL = -17.5;
export const TUNNEL: XYZ = [520, DAM.crest, -848];

/** The farm, 250 m away on the left. */
export const FARM: XZ = [-128, -206];
export const BARN: XZ = [-152, -222];
export const PASTURE: readonly XZ[] = [
  [-88, -196],
  [-176, -196],
  [-182, -252],
  [-92, -254],
];
export const CART: XZ = [-116, -226];

/** The checkpoint on the road, 280 m away. */
export const CHECKPOINT: XZ = [40, -262];
export const TOWER: XZ = [66, -249];
export const TOWER_HEIGHT = 7.4;
export const SANDBAGS: XZ = [24, -254];

/** The village of stone houses and the chapel, 500 m away across the river. */
export const CHAPEL: XZ = [-96, -482];
export const CHAPEL_TOWER_HEIGHT = 19;
export const HOUSES: readonly (readonly [number, number, number, number, number])[] = [
  // [x, z, width, depth, turn (radians)]
  [-140, -470, 10, 8, 0.1],
  [-162, -486, 9, 7, -0.15],
  [-128, -500, 11, 8, 0.25],
  [-180, -462, 8, 7, 0.05],
  [-110, -455, 9, 7, -0.2],
  [-66, -470, 10, 7, 0.3],
  [-150, -512, 8, 8, 0],
  [-200, -490, 9, 7, 0.4],
  [-58, -498, 8, 6, -0.1],
  [-190, -520, 10, 8, 0.2],
];

/** Posts: [id, kind, x, z, height above the ground, place]. */
export const POSTS: readonly (readonly [string, "sentry" | "tower" | "gunner" | "guard" | "mortar", number, number, number, string])[] = [
  ["tower", "tower", TOWER[0], TOWER[1], TOWER_HEIGHT, "on the watchtower"],
  ["mg", "gunner", SANDBAGS[0], SANDBAGS[1] - 1.4, 0, "at the guard post"],
  ["barrier", "guard", 46, -268, 0, "at the guard post"],
  ["hut", "sentry", 58, -276, 0, "at the guard post"],
  ["bridge.near", "sentry", 72, -306, 0, "at the bridge"],
  ["bridge.far", "sentry", 120, -382, 0, "at the bridge"],
  ["village.well", "sentry", -120, -462, 0, "in the village"],
  ["village.lane", "sentry", -76, -480, 0, "in the village"],
  ["farm.gate", "sentry", -92, -228, 0, "at the farm"],
  ["dam.left", "sentry", 324, -838, 0, "on the dam"],
  ["dam.right", "sentry", 470, -838, 0, "on the dam"],
  ["mortar.village", "mortar", -226, -548, 0, "behind the village"],
  ["mortar.bend", "mortar", 214, -520, 0, "by the river bend"],
];

/** The counter-sniper's nests: [id, x, z, height above ground, place]. */
export const NESTS: readonly (readonly [string, number, number, number, string])[] = [
  ["chapel", CHAPEL[0], CHAPEL[1] + 1.2, 14.5, "in the chapel tower"],
  ["ledge", 176, -612, 0.4, "on the far ledge"],
];

export const COWS: readonly XZ[] = [
  [-110, -210],
  [-140, -232],
  [-160, -214],
  [-126, -244],
  [-102, -238],
  [-168, -242],
];
export const SHEEP_AT: XZ = [-230, -720];
export const SHEPHERD: readonly XZ[] = [
  [-280, -705],
  [-230, -728],
  [-175, -712],
];
export const FARMER: readonly XZ[] = [
  [-104, -206],
  [-150, -212],
  [-164, -240],
  [-116, -246],
  [-104, -206],
];

/** The goat's impossible ledges on the cliff across the valley, each higher than the last. */
export const GOAT_LEDGES: readonly XYZ[] = [
  [232, 0, -664],
  [246, 0, -684],
  [224, 0, -702],
  [244, 0, -722],
];
/** How high above the ground each ledge stands (the cliff's shelves). */
export const GOAT_LIFT = [2, 6, 11, 17] as const;

/** The great cliff face across the valley, and the snowfield beyond with its rock and its yeti. */
export const CLIFF: XZ = [-360, -975];
// 1.85 km out, where the round's arc clears the ground all the way (behind
// the great cliff, the arc over the hold would strike the cliff's top).
export const YETI_ROCK: XZ = [572, -1759];
/** The eagle's circuit high over the valley, and the rock by your scope where it lands. */
export const EAGLE_CENTRE: XYZ = [-30, 80, -430];
export const EAGLE_RADIUS = 130;
// Just over the brink, low on the left of the view: a boulder the eagle lands
// on a couple of metres from the scope, below the aim check's plates.
export const EAGLE_ROCK: XYZ = [-1.3, 1.35, -2.5];

/**
 * The aim check's nine steel plates, on the soldiers' range on the near
 * side and on posts along the road, 120–250 m out: as seen from the eye,
 * a three by three grid of directions [degrees right, degrees up], so they
 * cover the check's view corner to corner.
 */
export const PLATE_ANGLES: readonly (readonly [number, number])[] = [
  [-13, -12.2],
  [0, -12.6],
  [13, -12.2],
  [-14, -15.4],
  [0.5, -15.8],
  [14, -15.4],
  [-12.5, -18.6],
  [-0.5, -19],
  [12.5, -18.6],
];

/**
 * Where each plate hangs: along its direction from the eye, on the ground
 * (a short post) where the ground is within the range's reach, or on a
 * pole standing up from it where the ground falls away beyond 250 m.
 * Returns [x, y, z, pole height] for each: y is the plate's centre.
 */
export function platePositions(): [number, number, number, number][] {
  const out: [number, number, number, number][] = [];
  for (const [azDeg, elDeg] of PLATE_ANGLES) {
    const az = (azDeg * Math.PI) / 180;
    const el = (elDeg * Math.PI) / 180;
    const dx = Math.sin(az) * Math.cos(el);
    const dy = Math.sin(el);
    const dz = -Math.cos(az) * Math.cos(el);
    // Walk out along the line until it meets the ground (or the range's far end).
    let d = 60;
    for (; d < 250; d += 1) {
      const x = dx * d;
      const z = dz * d;
      if (dy * d <= terrainHeight(x, z) + 1.4) break;
    }
    d = Math.max(120, Math.min(245, d));
    const x = dx * d;
    const z = dz * d;
    const ground = terrainHeight(x, z);
    const y = Math.max(dy * d, ground + 1.2);
    out.push([x, y, z, y - ground]);
  }
  return out;
}

/** The sun: toward it from the valley, behind the player's left shoulder, low. */
export const SUN_AZIMUTH = Math.atan2(-0.55, 0.83);
export const SUN_ELEVATION_START = 5.5;
export const SUN_ELEVATION_END = 9;
