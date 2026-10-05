/**
 * Every number the simulation is tuned by, in one place (docs/GRIP_PRIX.md,
 * "Sim"). Metres, seconds, radians, unless a name says otherwise.
 *
 * Timers the simulation counts down are kept in whole ticks in its state (a
 * sum of 1/60s rounded to the millisecond would run fast); `ticks()` turns a
 * time given here into them.
 */
import { TICK_HZ } from "../contract";

/** Seconds to whole ticks. */
export function ticks(seconds: number): number {
  return Math.round(seconds * TICK_HZ);
}

export const TUNING = {
  /** A kart is a circle this big, for bumping other karts and standing off the barrier. */
  kartRadius: 1.1,
  /** A barrier stands this far beyond each edge of the road. */
  barrierGap: 6,
  /** The kart's centre stops this far short of the barrier. */
  barrierInset: 0.8,

  drive: {
    /** Top speed on the road. */
    topSpeed: 24,
    /** The pull toward top speed has this time constant: 1 - e^(-3/tau) = 90% after 3 s. */
    accelTau: 3 / Math.LN10,
    /** With nothing pressed the kart rolls to a stop: a flat drag plus one that grows with speed. */
    coastDrag: 1.5,
    coastDragPerSpeed: 0.12,
    /** Top speed on the grass and sand (more than half the width from the centre). */
    offroadTop: 11,
    /** Speed above the limit (grass, or a boost that has ended) is shed at this rate. */
    overspeedDecel: 9,
    offroadDecel: 10,
    /** A boost raises the top speed by this factor and makes the kart pull much harder. */
    boostSpeed: 1.35,
    boostTau: 0.45,
    /** On the grass a boost is worth less. */
    boostSpeedOffroad: 1.15,
    brakeDecel: 30,
    /** Slower than this is a standstill for the reverse. */
    standstill: 0.5,
    /** Brake held at a standstill this long and the kart reverses. */
    reverseDelay: 0.3,
    reverseTop: 7,
    reverseTau: 0.6,
    /** A spinning kart sheds speed with this rate constant (1/s). */
    spinDrag: 2.5,
  },

  steer: {
    /** The wheel at full lock turns the kart this fast (rad/s)... */
    yawMax: 2.2,
    /** ...reaching it by this speed, from nothing at a standstill... */
    yawFullAt: 6,
    /** ...and keeping this share of it at top speed. */
    yawAtTop: 0.8,
    /** The steer eases toward the wheel with this rate (1/s), so the front wheels do not snap. */
    response: 18,
    /** Rate (1/s) at which sideways speed is pulled into the heading: a slight slide, never ice. */
    grip: 9,
    gripDrift: 4.2,
    gripOffroad: 6,
    /** Of the sideways speed the grip removes, this share comes out as forward speed; the rest is scrubbed. */
    slideKept: 0.85,
  },

  hop: {
    /** `drift` rising above this speed hops. */
    minSpeed: 10,
    /** ...and starts a drift if the wheel is turned more than this. */
    minSteer: 0.3,
    time: 0.25,
    height: 0.35,
  },

  drift: {
    /** In a drift the steer is remapped to base + range * (own way: 1, other way: -1): 0.4..1.4 of a full turn. */
    steerBase: 0.9,
    steerRange: 0.5,
    /** Charge grows at 1.0 per tick at a middling turn, 0.7 at the loosest and 1.3 at the tightest. */
    rateLoose: 0.7,
    rateTight: 1.3,
    /** Charge needed, in seconds of a middling turn. */
    level1: 1.0,
    level2: 2.2,
    boost1: 0.7,
    boost2: 1.4,
    /** Slower than this the drift is over (no boost). */
    minSpeed: 4,
    /** A brake this hard ends a drift without the boost. */
    cancelBrake: 0.5,
  },

  boost: {
    nitro: 1.5,
    nitro3: 1.0,
    pad: 1.0,
    start: 1.0,
    /** A pad is this long and wide (half-extents, metres). */
    padHalfLength: 3.5,
    padHalfWidth: 3.2,
  },

  start: {
    countdown: 3,
    ready: 0.5,
    /** Throttle that came on within this long before Go gives the start boost... */
    boostWindow: 0.6,
    /** ...and held since before this floods the engine... */
    floodAfter: 1.2,
    /** ...for this long after Go. */
    flood: 0.6,
  },

  bump: {
    /** Of the overlap, the faster kart gives way for this share less: the faster one shoves harder. */
    restitution: 0.35,
    /** A kart weighs 1 + speed / this much in a bump. */
    weightPerSpeed: 12,
    /** Closing speed that makes a bump of strength 1. */
    fullStrength: 10,
    /** Quieter than this and no bump is reported. */
    minReport: 1.5,
  },

  wall: {
    /** Of the speed along the barrier, this much is kept after a hit. */
    keep: 0.7,
    /** Hits slower than this only scrape. */
    minHit: 3,
    /** A scrape costs this much speed per second. */
    scrape: 3,
    /** After a hit the heading turns this far toward the way the kart is now going. */
    nudge: 0.5,
    /** Hit speed (m/s) that makes a wall event of strength 1. */
    fullStrength: 20,
  },

  items: {
    boxesPerRow: 5,
    /** Boxes in a row are spread over this much of the road's width. */
    rowSpread: 0.68,
    pickupRadius: 1.7,
    respawn: 3,
    roulette: 1.0,
    puck: { speed: 40, life: 6, hitRadius: 1.4, ownerGrace: 0.5, spawnAhead: 2.5 },
    seeker: { speed: 36, life: 10, hitRadius: 1.4, homing: 30, turnRate: 4.5, lookahead: 14, ownerGrace: 0.5, spawnAhead: 2.5 },
    slick: { behind: 2.5, radius: 1.7, max: 12, ownerGrace: 1.0 },
    /** A hit spins the kart this long, leaves a fifth of its speed, and ends its drift. */
    spin: 1.2,
    spinSpeedKept: 0.2,
    /**
     * Odds by place, as weights [nitro, nitro3, puck, seeker, slick]: first
     * place gets the left row, last place the right, the places between a
     * blend. The leader gets slicks and pucks, the back of the pack nitros and
     * seekers (and a seeker is no use to the leader, so none).
     */
    oddsFirst: [25, 5, 35, 0, 35],
    oddsLast: [35, 25, 8, 32, 0],
  },

  race: {
    /** Past the first player home, the rest have this long. */
    grace: 25,
    /** Facing more than this far from the track's direction... */
    wrongAngle: (110 * Math.PI) / 180,
    /** ...at more than this speed... */
    wrongSpeed: 3,
    /** ...for this long is going the wrong way. */
    wrongTime: 1.5,
    /** Where a kart on the grid stands: this far behind the line for pole, and each place further back by this much. */
    gridFirst: 3.5,
    gridStep: 3.2,
    /** Pairs of karts stand this far either side of the middle, as a share of the road's width. */
    gridSide: 0.19,
  },

  bots: {
    /** Skill 0..1 scales top speed between these. */
    topSpeedLow: 0.92,
    topSpeedHigh: 1.0,
    /** Sideways acceleration (m/s^2) a bot plans its bends for; sharper bends mean less speed. */
    lateral: 27,
    /** A bot plans to brake this hard (m/s^2) for the speed of a bend. */
    planBrake: 16,
    /** Fastest a bot plans for in a straight line. */
    planCap: 50,
    /** Curvature-smoothing and line-cutting: bends tighter than 1/cutCurvature cut the full distance. */
    cutCurvature: 1 / 45,
    /** Of the room between the road's middle and its edge (less a margin), a bot cuts this much at most. */
    cutShare: 0.7,
    edgeMargin: 2.8,
    /** A bot's own lane, as a share of the road's half-width, at most. */
    laneShare: 0.3,
    /** Looks this far ahead: base + per m/s of speed, between the limits. */
    lookBase: 5,
    lookPerSpeed: 0.6,
    lookMin: 6,
    lookMax: 20,
    /** At the start a bot times the lights well with this chance (low skill..high), and a poor one floods with up to this chance. */
    startBoostLow: 0.1,
    startBoostHigh: 0.9,
    floodChance: 0.12,
    /** A bot steers at least this far (metres) clear of the middle of a slick. */
    slickClearance: 3.3,
    /** A bot reads its speed plan this many seconds ahead of itself. */
    planAhead: 0.2,
    /** Rubber band: a bot more than `start` metres from the best player eases off up to `easeOff`, or pushes up to `push`, by `span` metres. */
    rubberStart: 60,
    rubberSpan: 140,
    easeOff: 0.05,
    push: 0.04,
    /** Stuck: slower than this for this long and a bot backs up for a while. */
    stuckSpeed: 1.5,
    stuckTime: 1.0,
    backTime: 1.0,
    /** A bot drifts a bend that is tighter than this curvature and lasts at least this long (metres). */
    driftCurvature: 1 / 55,
    driftMinLength: 55,
    driftMinSpeed: 14,
    /** A bot waits this long (seconds, low..high skill) after getting an item before using it. */
    itemWaitSlow: 2.6,
    itemWaitFast: 0.7,
    /** And uses it regardless after this long. */
    itemHoldMax: 14,
  },
} as const;
