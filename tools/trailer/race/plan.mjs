/**
 * The Grip Prix clips for the trailer. One entry per clip:
 *
 *   id, what          the clip's name and a line for the edit
 *   query             the dev page's parameters (src/kart/render/dev.ts); capture adds sim=1, manual=1, quality=high, scale=1 ...
 *   simSeed           the real sim's seed (every clip is the same race on every run)
 *   skip              simulated seconds before anything is drawn (from the first light of the countdown)
 *   pre, frames       frames drawn but not kept (the camera and the sparks settle; they also warm the engines of the sound), and frames kept
 *   views             the karts the split screen follows (one: that kart's own camera; setViews)
 *   hud               false hides the HUD
 *   P                 plain data for setup and director
 *   setup(grip, P)    runs in the page once (see shoot.mjs); director(grip, P) returns frame(f, view), run before each frame is drawn
 *   moments           where the edit may want to cut on a beat: events found in the recorded views ({ event, ...match, nth, what }),
 *                     or a time found by eye ({ t, what })
 *
 * Directors run in the page and use window.__rig (rig.mjs): chase and orbit cameras, points on the track.
 * Kart ids: 0 Bun (the leader on the grid), 1 Pepper, 2 Moss (the frog), 3 Kit, 4 Juniper, 5 Mango, 6 Bramble, 7 Rivet.
 */
export const CLIPS = [
  {
    id: "gp-go",
    what: "The start on Meadow Loop from the back of the grid: the camera dives over eight karts under the red lights; GO; the whole pack launches in flames and the kart under the camera drives out under the GRIP PRIX gantry",
    query: "track=meadow-loop",
    simSeed: 5,
    views: [7],
    pre: 60,
    frames: 330,
    moments: [
      { event: "countdown", n: 2, what: "second red light" },
      { event: "countdown", n: 1, what: "third red light" },
      { event: "countdown", n: 0, what: "GO: the lights go green and the pack launches" },
      { event: "boost", kart: 7, source: "start", what: "the kart under the camera launches with a start boost" },
    ],
  },
  {
    id: "gp-drift",
    what: "Canyon Run, golden hour: a long right-hand drift, the sparks go blue, then orange, then the release throws the kart into a boost with flames (chase camera)",
    query: "track=canyon-run",
    simSeed: 5,
    skip: 11.4,
    pre: 120,
    frames: 270,
    // A bot only charges to the blue sparks in this bend: the leader is given a head start on its charge so that the orange comes too.
    P: { hero: 0, boostSparks: 48, chase: { back: 4.7, up: 1.6, swing: 2.2, look: 3, fov: 66, boostFov: 10, lean: 2.5 } },
    director: (grip, P) => {
      const R = window.__rig;
      let prev = 0;
      let done = false;
      R.follow(P.hero);
      const chase = R.chase(P.hero, P.chase);
      return (f, view) => {
        chase(view);
        const k = R.kartById(view, P.hero);
        if (!done && k.drift !== 0 && prev === 0 && P.boostSparks) {
          done = true;
          grip.demo.patch(P.hero, { charge: R.charge(P.hero) + P.boostSparks });
        }
        prev = k.drift;
      };
    },
    moments: [
      { event: "drift-level", kart: 0, level: 1, what: "blue sparks" },
      { event: "drift-level", kart: 0, level: 2, what: "orange sparks" },
      { event: "boost", kart: 0, source: "drift", what: "drift released: boost with flames" },
    ],
  },
  {
    id: "gp-four",
    what: "Four-way split screen on Five Finger Circuit (karts 3, 5, 4, 6; the centre map and standings): four karts in close racing on a beach, pucks flying, a drift boost",
    query: "track=five-finger-circuit",
    simSeed: 5,
    skip: 10,
    pre: 60,
    frames: 300,
    views: [3, 5, 4, 6],
    moments: [
      { event: "hit", kart: 3, cause: "puck", what: "a puck hits the top-left kart" },
      { event: "use", kart: 3, item: "puck3", what: "the top-left kart throws a puck" },
      { event: "drift-level", kart: 5, level: 1, what: "blue sparks in the top-right view" },
      { event: "boost", kart: 5, source: "drift", what: "drift boost in the top-right view" },
    ],
  },
  {
    id: "gp-jump",
    what: "Kitchen Rally: all eight karts leap off the ramp in a row, a low camera at the counter's edge, tricks in the air against the sunset sky and the giant kitchen's cabinets, then the landing boosts",
    query: "track=kitchen-rally",
    simSeed: 5,
    skip: 20.9,
    pre: 30,
    frames: 240,
    P: { at: 0.3346, eye: { d: 9, off: -7.2, up: 0.5 }, fov: 68, hero: 0, lookUp: 3.0 },
    director: (grip, P) => {
      const R = window.__rig;
      const eye = R.pt(P.at, P.eye.d, P.eye.off, P.eye.up);
      let look = null;
      return (f, view) => {
        R.follow(P.hero);
        const t = R.body(R.kartById(view, P.hero), P.lookUp);
        look = look ? R.dampV(look, t, 6) : t;
        R.cam(eye, look, P.fov, 0);
      };
    },
    moments: [
      { event: "jump", kart: 1, what: "the first kart takes off from the ramp" },
      { event: "jump", kart: 0, what: "the leader takes off" },
      { event: "trick", kart: 0, what: "trick in the air" },
      { event: "land", kart: 0, what: "the leader lands with a boost (the others follow over the next half second)" },
    ],
  },
  {
    id: "gp-item",
    what: "Meadow Loop: a skyrocket fired from mid-pack; the camera rides it over the road, the red target zone closes on the leader and it bursts; karts around the burst spin out with stars",
    query: "track=meadow-loop",
    simSeed: 5,
    skip: 6,
    pre: 20,
    frames: 300,
    P: { user: 5, item: "skyrocket", useAt: 60, chase: { back: 6.5, up: 2.8, look: 12, lookUp: 1.2, fov: 62 }, ride: { back: 9, up: 2.6, lookAhead: 14 } },
    director: (grip, P) => {
      const R = window.__rig;
      R.follow(P.user);
      const chase = R.chase(P.user, P.chase);
      let f0 = null;
      let burst = null;
      let last = null;
      let prevRocket = null;
      let eyeR = null;
      let heading = null;
      return (f, view) => {
        if (f === P.useAt) grip.demo.forceUse(P.user, P.item);
        const C = chase(view, 1 / 60, false);
        const rocket = view.things.find((t) => t.kind === "skyrocket");
        if (rocket && f0 === null) f0 = f;
        if (!rocket && f0 !== null && burst === null) burst = f;
        let w = 0;
        if (f0 !== null) w = R.smooth((f - f0) / 14);
        if (burst !== null) w = 1 - R.smooth((f - burst - 70) / 40);
        if (rocket) {
          if (prevRocket) {
            const hd = Math.atan2(rocket.x - prevRocket.x, rocket.z - prevRocket.z);
            heading = heading === null ? hd : R.angle(heading, hd, 0.3);
          }
          prevRocket = rocket;
          last = rocket;
        }
        let eye = C.eye;
        let look = C.look;
        let fov = C.fov;
        if (last && w > 0) {
          const h = heading ?? 0;
          if (rocket) {
            const target = { x: last.x - Math.sin(h) * P.ride.back, y: Math.max(last.y + P.ride.up, 1.8), z: last.z - Math.cos(h) * P.ride.back };
            eyeR = eyeR ? R.dampV(eyeR, target, 16) : target;
          }
          const lookR = rocket
            ? { x: last.x + Math.sin(h) * P.ride.lookAhead, y: Math.max(last.y - 1.5, 1.0), z: last.z + Math.cos(h) * P.ride.lookAhead }
            : R.body(R.kartById(view, 0), 1.0);
          eye = R.mix(C.eye, eyeR, w);
          look = R.mix(C.look, lookR, w);
          fov = R.lerp(C.fov, 58, w);
        }
        R.cam(eye, look, fov, 0);
      };
    },
    moments: [
      { event: "use", kart: 5, item: "skyrocket", what: "the skyrocket is fired" },
      { event: "strike", item: "skyrocket", what: "the skyrocket bursts on the leader" },
      { event: "hit", kart: 0, cause: "skyrocket", what: "the leader spins out" },
    ],
  },
  {
    id: "gp-night",
    what: "Harbour Lights at night, from behind a mid-pack kart: tail lamps, headlight pools on the road, cranes, the lighthouse beam and a nitro boost",
    query: "track=harbour-lights",
    simSeed: 5,
    skip: 12,
    pre: 30,
    frames: 300,
    hud: false,
    P: { hero: 5, nitroAt: 70, chase: { back: 6.2, up: 2.4, look: 12, lookUp: 1.4, fov: 64, boostFov: 9 } },
    director: (grip, P) => {
      const R = window.__rig;
      R.follow(P.hero);
      const chase = R.chase(P.hero, P.chase);
      return (f, view) => {
        if (f === P.nitroAt) grip.demo.forceUse(P.hero, "nitro");
        chase(view);
      };
    },
    moments: [{ event: "use", kart: 5, item: "nitro", what: "nitro: flames from the exhausts" }],
  },
  {
    id: "gp-cine",
    what: "Volcano Rush: a camera rides alongside a tight pack at the roadside (Kit leading), swinging round it, lava-streaked volcano and glowing lava gate behind, a geyser erupting at the end",
    query: "track=volcano-rush",
    simSeed: 5,
    skip: 12,
    pre: 30,
    frames: 300,
    hud: false,
    P: { hero: 3, orbit: { az: [-105, -60], r: [10, 8], h: [1.5, 1.4], fov: [46, 42], ahead: -1, lookUp: 2.0, n: 280 } },
    director: (grip, P) => {
      const R = window.__rig;
      R.follow(P.hero);
      const orbit = R.orbit(P.hero, P.orbit);
      return (f, view) => {
        orbit(view, Math.max(0, f));
      };
    },
    moments: [
      { t: 3.67, what: "a lava geyser erupts at the roadside beside the pack (the biggest burst is at about 4.2 s)" },
    ],
  },
  {
    id: "gp-finish",
    what: "Fun Fair at dusk: the leader crosses the finish line under the GRIP PRIX gantry, confetti, the camera tilts up to the fireworks over the fair",
    query: "track=fun-fair&laps=1",
    simSeed: 5,
    skip: 47.2,
    pre: 60,
    frames: 300,
    hud: false,
    P: { hero: 0, chase: { back: 6, up: 2.4, look: 14, lookUp: 3.2, fov: 66 }, tilt: { to: 12, wait: 25, over: 90 } },
    // The fireworks are a player's prize: the winner is shown to the renderer as a person (the sim still drives it as a bot).
    setup: (grip) => {
      grip.demo.racers[0].player = 0;
    },
    director: (grip, P) => {
      const R = window.__rig;
      R.follow(P.hero);
      const chase = R.chase(P.hero, P.chase);
      let done = null;
      return (f, view) => {
        if (done === null && view.events.some((e) => e.type === "finish" && e.kart === P.hero)) done = f;
        const C = chase(view, 1 / 60, false);
        const up = done === null ? 0 : P.tilt.to * R.smoother((f - done - P.tilt.wait) / P.tilt.over);
        R.cam(C.eye, { x: C.look.x, y: C.look.y + up, z: C.look.z }, C.fov, 0);
      };
    },
    moments: [{ event: "finish", kart: 0, what: "the leader crosses the line: confetti" }],
  },
];
