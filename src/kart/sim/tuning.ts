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
    /** A boost raises the top speed by this factor and makes the kart pull much harder. */
    boostSpeed: 1.35,
    boostTau: 0.45,
    brakeDecel: 30,
    /** Slower than this is a standstill for the reverse. */
    standstill: 0.5,
    /** Brake held at a standstill this long and the kart reverses. */
    reverseDelay: 0.3,
    reverseTop: 7,
    reverseTau: 0.6,
    /** Nothing goes faster than this, whatever bumps, slides and hills do: a boosted top speed and a little over. */
    maxSpeed: 36,
    /** A spinning kart sheds speed with this rate constant (1/s). */
    spinDrag: 2.5,
  },

  /**
   * Hills. Along the road's grade (rise per metre the way the kart goes) gravity
   * pulls at `pull` m/s^2 per unit of grade: a kart slows climbing and gathers
   * speed coming down. Downhill the top speed rises by `downTop` per unit of
   * grade, and the steepest of the descent over the last `carry` metres counts,
   * so the speed a kart gathered is carried out of the dip rather than braked
   * off at its foot. The grade is read over `span` metres either side.
   */
  slope: {
    pull: 9,
    downTop: 1.1,
    carry: 22,
    span: 2,
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
    /** Of the sideways speed the ground's grip removes, this share comes out as forward speed; the rest is scrubbed. */
    slideKept: 0.88,
    /**
     * A nose turned further than this from the way the kart is going (radians:
     * the end of a power-slide, a shove) swings back toward it at `align` (1/s,
     * on the road; less on slippery ground), as the grip pulls the travel round to
     * meet it. Ordinary steering never slides this far.
     */
    slipFree: 0.26,
    align: 7,
  },

  hop: {
    /** `drift` rising above this speed hops. */
    minSpeed: 10,
    /** ...and starts a drift if the wheel is turned more than this. */
    minSteer: 0.3,
    time: 0.25,
    height: 0.35,
  },

  /**
   * What each kind of ground does to the kart. `top` is the top speed, `boostTop`
   * the top speed under a boost on rough ground (on smooth ground a boost is
   * the usual +35%), `grip` the rate (1/s) the velocity is pulled into the
   * heading, `decel` how fast speed over the limit is shed, and `accel`, `brake`
   * and `coast` scale pulling away, braking and rolling to a stop. `rough` is
   * what the kart reports as off the road: no drift charge, dust and spray.
   *
   * A boost on rough ground carries the kart at nearly full speed, which is
   * what makes a verge cut worth taking with a Nitro. Sand and snow are a
   * little slower than grass, mud very slow, ice has almost no grip and next to
   * no brake (the kart slides on, in the direction it was going), and a boost
   * strip drives as road. The road's `top` is `drive.topSpeed`, which the bots
   * and the steering read, so the two change together.
   */
  ground: {
    road: { rough: false, top: 24, boostTop: 0, grip: 9, gripDrift: 4.2, decel: 9, accel: 1, brake: 1, coast: 1 },
    boost: { rough: false, top: 24, boostTop: 0, grip: 9, gripDrift: 4.2, decel: 9, accel: 1, brake: 1, coast: 1 },
    ice: { rough: false, top: 24, boostTop: 0, grip: 1.2, gripDrift: 1.0, decel: 5, accel: 0.65, brake: 0.25, coast: 0.3 },
    grass: { rough: true, top: 11, boostTop: 21, grip: 6, gripDrift: 4.2, decel: 10, accel: 1, brake: 1, coast: 1 },
    sand: { rough: true, top: 9, boostTop: 20, grip: 5, gripDrift: 4.2, decel: 12, accel: 1, brake: 1, coast: 1 },
    snow: { rough: true, top: 10, boostTop: 20, grip: 3.5, gripDrift: 3, decel: 10, accel: 1, brake: 1, coast: 1 },
    mud: { rough: true, top: 7, boostTop: 11, grip: 8, gripDrift: 4.2, decel: 16, accel: 1, brake: 1, coast: 1 },
  },

  /** The ground beyond the road where a verge does not say, by theme (grass for the rest). */
  groundByTheme: { canyon: "sand", snow: "snow", palm: "sand" } as Readonly<Record<string, "sand" | "snow">>,

  ramp: {
    /**
     * A ramp's `lift` (TrackDef: 7 unless it says) sets how big it is: a wedge
     * `length` metres long rising to `height` x lift / 7 at the lip (the picture
     * draws the same wedge: render/world/features.ts), and the jump. The kart
     * climbs the wedge as part of the road and leaves the lip from its top,
     * rising at lift x `launch` m/s at top speed: about 1.2 s in the air, the
     * top of the arc some 3.5 m over the road.
     */
    lift: 7,
    length: 16,
    height: 2.4,
    launch: 0.72,
    gravity: 12.5,
    /** The lift scales with speed over top speed, between these. */
    minShare: 0.4,
    maxShare: 1.3,
    /** Slower than this the kart only rolls off the lip and drops. */
    minSpeed: 9,
    /** In the air the wheel turns the way the kart flies this fast (rad/s at full lock), and its nose swings round to it at `airAlign` (1/s). */
    airTurn: 0.55,
    airAlign: 4,
    /** A kart this much higher than another passes over it. */
    passOver: 1.1,
    /** A trick in the air boosts on landing for this long; a trick with a shake right at the lip for `kickBoost`. */
    trickBoost: 0.8,
    kickBoost: 1.1,
    /**
     * Shaking the wheel this long before the lip, or this long after it, kicks the
     * jump: `kickLift` more upward speed (m/s) and `kickSpeed` more speed.
     */
    kickBefore: 0.3,
    kickAfter: 0.2,
    kickLift: 1.8,
    kickSpeed: 1.06,
    /**
     * Over a crest the road falls away: where its curvature times the speed
     * squared outdoes the pull of gravity by `crest`, the kart leaves the road and
     * flies. A flight that never rises `quiet` metres off the road is not a jump
     * (no sound, no trick).
     */
    crest: 1.08,
    quiet: 0.3,
  },

  /** Falling off an open edge, and the drone that fetches the kart. */
  fall: {
    /** Past the road's edge by this much on an open side: over. */
    edge: 0.5,
    /** The whole rescue takes this long: falling, hooked and carried, set down. The kart stays where it went over (the picture does the rest) until it is set down. */
    rescue: 2.5,
    /** Set down on the centre line this far behind where it fell... */
    back: 15,
    /** ...or this far before a gap it fell into: room to get up to the speed the jump needs (about 21 m/s after 35 m from a standstill). */
    runUp: 48,
    /** Hazards and items pass through the kart for this long after it is set down. */
    immune: 1.5,
  },

  hazard: {
    /** Hit by a hazard: the spin of an item hit, then this much longer before another can touch it. */
    immuneAfter: 1.6,
    /** A kart higher than this in the air flies over a hazard. */
    clearHeight: 0.8,
  },

  /**
   * A drift is a power-slide: the kart goes round the way it is travelling,
   * its tail out and its nose `slip` radians inside that, the wheel holding it.
   * Into the drift (own way: 1) it comes round tighter and the tail swings
   * further; against it (other way: -1) it runs wider with the tail tucked in.
   */
  drift: {
    /** The way it goes turns at base + range * own of a full turn: 0.4..1.4. */
    steerBase: 0.9,
    steerRange: 0.5,
    /** The nose is slip + slipRange * own inside the way it goes: 15°..33°. */
    slip: 0.42,
    slipRange: 0.16,
    /** The tail swings out to it at this rate (1/s): most of the way within the hop. */
    swing: 9,
    /** Of the top speed, a drift keeps this much. */
    keep: 0.97,
    /** Charge grows at 1.0 per tick at a middling turn, 0.7 at the loosest and 1.3 at the tightest. */
    rateLoose: 0.7,
    rateTight: 1.3,
    /** Charge needed, in seconds of a middling turn: blue, orange, and the hottest. */
    level1: 1.0,
    level2: 2.1,
    level3: 3.4,
    boost1: 0.7,
    boost2: 1.3,
    boost3: 1.9,
    /** Slower than this the drift is over (no boost). */
    minSpeed: 4,
    /** A brake this hard ends a drift (the boost is still earned). */
    endBrake: 0.5,
    /**
     * The wheel held this hard against the drift (own at or below minus this)
     * for `againstTime` seconds straightens the kart out of it (the boost is
     * still earned): the way out of a slide toward the other side of the road.
     */
    against: 0.8,
    againstTime: 0.25,
  },

  /**
   * Slipstream: right behind another kart (within `reach` metres behind it and
   * `side` metres either side of its line, both faster than `minSpeed` and going
   * the same way within `angle`), a kart pushes less air: its top speed is
   * `top` higher, and after `charge` seconds there it is flung out with a boost
   * of `boost` seconds; then `rest` seconds before a wake charges it again. Out of
   * the wake the charge drains twice as fast.
   */
  draft: {
    reach: 14,
    near: 2,
    side: 1.8,
    minSpeed: 14,
    angle: 0.5,
    top: 1.03,
    charge: 1.5,
    boost: 0.7,
    rest: 2.5,
  },

  boost: {
    nitro: 1.5,
    nitro3: 1.0,
    pad: 1.0,
    /** A boost strip keeps a boost of this length topped up while a kart is on it. */
    strip: 0.4,
    start: 1.0,
    /** A pad is this long and wide (half-extents, metres). */
    padHalfLength: 3.5,
    padHalfWidth: 3.2,
  },

  start: {
    countdown: 3,
    ready: 0.5,
    /**
     * Throttle that came on within this long before Go gives the start boost:
     * the whole of "1" on the lights, which is what a player is told ("close
     * your hands on 1"). A player who closes their hands as the 1 comes up
     * has the throttle on about 0.8 s before Go (the hands' own delay: the
     * 0.12 s a fist must last, and the camera), so a shorter window would miss
     * them.
     */
    boostWindow: 1.0,
    /** ...and held since before this floods the engine... */
    floodAfter: 1.2,
    /** ...for this long after Go. */
    flood: 0.6,
  },

  bump: {
    /** How lively a bump is: at 0 the karts would move on together, at 1 they would part as fast as they met. */
    restitution: 0.6,
    /** A shove off the middle turns the kart: radians per m/s of sideways shove per metre off its middle. */
    yaw: 0.035,
    /** ...but never more than this. */
    maxYaw: 0.2,
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
    /**
     * Nose against the barrier and slower than this (m/s), with the throttle
     * on: the wheel turns the kart as it would at this speed (the tyres
     * scrabble it round), so a kart that met the barrier head-on is never
     * wedged there.
     */
    pivot: 4,
  },

  items: {
    boxesPerRow: 5,
    /** Boxes in a row are spread over this much of the road's width. */
    rowSpread: 0.68,
    /**
     * A box is taken when a kart's centre is this close (metres, flat). Sized from the drawn cube (render/world/boxes.ts BOX_SIZE, 1.6 m):
     * its rotating corner reaches 1.13 m, a kart's wheels are 1.16 m out from its middle, so anything that visibly touches takes it.
     * Any less and a kart could drive a wheel through the glass and nothing would happen.
     */
    pickupRadius: 2.3,
    /** A kart higher in the air than this flies over a box. */
    boxClear: 2.4,
    respawn: 3,
    roulette: 1.0,
    puck: { speed: 40, life: 6, hitRadius: 1.4, ownerGrace: 0.5, spawnAhead: 2.5 },
    seeker: { speed: 36, life: 10, hitRadius: 1.4, homing: 30, turnRate: 4.5, lookahead: 14, ownerGrace: 0.5, spawnAhead: 2.5 },
    slick: { behind: 2.5, radius: 1.7, max: 12, ownerGrace: 1.0 },
    /** A hit spins the kart this long, leaves a fifth of its speed, and ends its drift. */
    spin: 1.2,
    spinSpeedKept: 0.2,
    /** Comet: untouchable (items, hazards, bumps) and faster for a while; what it touches spins. Rough ground does not slow it. */
    comet: { duration: 6, speed: 1.15 },
    /** Storm: every kart ahead of the user spins briefly, then crawls at a share of its top speed. At most one per `cooldown` seconds. */
    storm: { spin: 0.7, zap: 3, speed: 0.6, cooldown: 15 },
    /**
     * Skyrocket: flies along the centre line to the leader (or the runner-up
     * when the user leads) at `speed` m/s, bursts within `reach` m of them but
     * not before `minFlight` s, or after `life` s at the latest; everyone within `burstRadius` spins.
     * `height` is how high it arcs in the picture.
     */
    skyrocket: { speed: 60, minFlight: 1.0, life: 8, reach: 2.5, burstRadius: 9, height: 14 },
    /** Blast: an instant ring round the user. */
    blast: { radius: 7 },
    /** Decoy: dropped behind like a slick; looks like an item box. */
    decoy: { behind: 2.5, radius: 1.7, max: 8, ownerGrace: 1.0 },
    /**
     * Odds by place, as weights in ITEM_KINDS order [nitro, nitro3, puck,
     * seeker, slick, puck3, comet, storm, skyrocket, blast, decoy]: first
     * place gets the first row, a middle place the second, last place the
     * third, the places between a blend. The leader gets slicks, decoys, pucks
     * and blasts, the middle pucks, seekers and nitros, the back nitro3s, comets
     * and, rarely, storms and skyrockets (a seeker is no use to the leader, so
     * none; a storm or skyrocket only from the back half).
     */
    oddsFirst: [18, 0, 20, 0, 22, 0, 0, 0, 0, 16, 24],
    oddsMid: [18, 8, 20, 14, 4, 14, 4, 0, 0, 6, 8],
    oddsLast: [12, 24, 4, 16, 0, 6, 22, 8, 8, 0, 0],
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
    /** Karts stand this far either side of the middle, left and right in turn, as a share of the road's width. */
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
    /** The curvature a bot plans a bend's speed for is at least this share of the tightest part of the line round there. */
    peakShare: 0.85,
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
    /** Keeps this far (metres) beyond edgeMargin from an open edge, and up to dropSlack more at skill 0; bends beside one are planned for a lower sideways acceleration. */
    dropMargin: 1.6,
    dropSlack: 2.4,
    dropLateral: 22,
    /** A verge is a cut worth taking when its barrier is at least this far out and the road it skips is at least this many times the straight line. */
    cutMinDistance: 12,
    cutGain: 1.3,
    /** A cut runs from this far (metres) inside the verge's start to this far inside its end. */
    cutInset: 12,
    /** Ice: a bot plans its bends for this sideways acceleration, never faster than iceTop, and brakes for it this hard (m/s^2). */
    iceLateral: 9,
    iceTop: 17,
    iceBrake: 5,
    /** Mud it cannot avoid: never faster than this. */
    mudTop: 10,
    /** Keeps this far (metres) off the edge of a patch of mud or ice it goes round. */
    patchClearance: 1.8,
    /** A bot takes a ramp straight from this far before it (metres) and keeps its wheel straight in the air. */
    rampStraight: 26,
    /** Nearer than this (metres) to a ramp's lip a bot holds its speed whatever the plan says. */
    rampSpeedNear: 60,
    /** Hazards: looks this far ahead in time (s) in steps of this, and keeps this far (metres, beyond their size) clear, more for the gentler. */
    hazardLook: 2.6,
    hazardStep: 0.15,
    hazardClear: 0.9,
    /** A kart swings across the road at about this many m/s when dodging. */
    dodgeRate: 5.5,
    /** The nearest to the road's edge a bot goes to get round a hazard (metres in from it). */
    hazardEdge: 1.4,
    /** Skill under which a bot does not look for hazards at all. */
    hazardSkill: 0,
    /** Skill from which a bot takes a verge cut when it holds a Nitro; it commits to the cut, and fires the Nitro, once the cut starts within this far (metres) plus 8 ahead. */
    cutSkill: 0.7,
    cutNitroBefore: 6,
    /** A bot tricks off a ramp when an id-and-lap lottery falls under its skill times (1 - this), plus this for a bot sharper than 0.45. */
    trickBase: 0.2,
    /** A bot steers at least this far (metres) clear of the middle of a slick. */
    slickClearance: 3.4,
    /** and starts steering clear of one this far (metres) before the point it is aiming at. */
    slickNotice: 30,
    /** A bot reads its speed plan this many seconds ahead of itself. */
    planAhead: 0.2,
    /** Rubber band: a bot more than `start` metres from the best player eases off up to `easeOff`, or pushes up to `push`, by `span` metres. */
    rubberStart: 60,
    rubberSpan: 140,
    easeOff: 0.06,
    push: 0.05,
    /** Stuck: slower than this for this long and a bot backs up for a while. */
    stuckSpeed: 1.5,
    stuckTime: 1.0,
    backTime: 1.0,
    /** A bot drifts a bend that is tighter than this curvature and has at least this much left (metres, or this many seconds at its speed, whichever is more): enough to charge a boost. */
    driftCurvature: 1 / 60,
    driftMinLength: 24,
    driftMinTime: 1.5,
    /** ...but not a hairpin as tight as this (a bot slides out of it): the wheel is too hard over to leave room for a drift. */
    driftMaxCurvature: 1 / 15,
    /** ...and only going faster than this (m/s). */
    driftMinSpeed: 14,
    /** A bot waits this long (seconds, low..high skill) after getting an item before using it. */
    itemWaitSlow: 2.6,
    itemWaitFast: 0.7,
    /** A bot holds any item that would spin someone (itself, or whoever it storms or sends a rocket to) within this far (metres) before the lip of a jump over a gap. */
    itemGapQuiet: 140,
    /** And uses it regardless after this long. */
    itemHoldMax: 14,
  },
} as const;
