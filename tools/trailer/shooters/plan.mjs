/**
 * The eight clips: how each is captured. `pre` is how long the real game is
 * simulated (unrecorded, in simulated seconds) before the clip's first frame,
 * `seed` is the game's own random draw, `frames` the clip's length at 60 fps,
 * `query` anything else the game's dev harness is asked (a start wave). A slow
 * clip (slow: 2) is simulated at 120 steps a second, one step per frame, so it
 * plays at half speed. The staging itself (who comes out when, where the hand
 * points) is in directors.ts; `moments` here are only the few notes that the
 * game's own record of the take (moments.mjs) cannot give.
 */
export const CLIPS = [
  {
    id: "hn-hero",
    game: "High Noon",
    seed: 1851,
    pre: 5.0,
    frames: 210,
    slow: 1,
    query: "wave=3",
    what: "High Noon opening: four hits in two and a half seconds in the sunlit street (a quick-draw headshot, a lit dynamite stick shot out of the air in a fireball, two more bandits).",
    moments: [],
  },
  {
    id: "hn-2",
    game: "High Noon",
    seed: 1851,
    pre: 5.0,
    frames: 210,
    slow: 1,
    query: "wave=4",
    what: "High Noon: two dynamiters, one each side of the street; both lit sticks shot out of the air, two fireballs and black smoke over the town.",
    moments: [],
  },
  {
    id: "dn-1",
    game: "Dead of Night",
    seed: 1851,
    pre: 5.0,
    frames: 210,
    slow: 1,
    what: "Dead of Night: the flashlight beam sweeps across the foggy road and finds the dead walking in; headshots as the beam settles on them.",
    moments: [{ t: 0.0, what: "the beam begins its sweep from the right, over the empty road" }],
  },
  {
    id: "dn-2",
    game: "Dead of Night",
    seed: 1851,
    pre: 5.0,
    frames: 210,
    slow: 1,
    what: "Dead of Night: a crowd of the dead in the beam; the bloater among them swells with each hit, bursts in green gas and takes its neighbours down.",
    moments: [],
  },
  {
    id: "od-1",
    game: "Orbital Decay",
    seed: 1851,
    pre: 13.0,
    frames: 210,
    slow: 1,
    what: "Orbital Decay: the heat laser breaks a flurry of debris against the planet vista, beams and flashes across the cupola's panes, the heat gauge climbing.",
    moments: [],
  },
  {
    id: "od-2",
    game: "Orbital Decay",
    seed: 1851,
    pre: 13.0,
    frames: 210,
    slow: 1,
    what: "Orbital Decay: a torn slab is split by the laser close to the glass in a flash and a spray of pieces, then a big piece slams the right-hand pane.",
    moments: [],
  },
  {
    id: "or-1",
    game: "Overwatch Ridge",
    seed: 1851,
    pre: 4.5,
    frames: 210,
    slow: 1,
    what: "Overwatch Ridge: the wide valley at golden hour, the scope rises, the view pans across the valley onto the tower's lookout, the long shot lands.",
    moments: [
      { t: 0.8, what: "the pan across the valley begins" },
      { t: 1.5, what: "the view settles on the lookout on the tower" },
    ],
  },
  {
    id: "or-slow",
    game: "Overwatch Ridge",
    seed: 1851,
    pre: 4.6,
    frames: 300,
    slow: 2,
    what: "Overwatch Ridge in slow motion (120 steps a second, played at half speed): the crosshair on the tower's lookout 294 m away, the shot, the round's flight, the headshot.",
    moments: [],
  },
];
