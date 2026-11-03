/**
 * The small pure parts: codes, the wire format, the lobby's roster and the
 * grid, the view blending, and the autopilot.
 */
import { describe, expect, it } from "vitest";
import { IDLE_INPUT, MAX_RACERS, TICK, type DriveInput, type KartView, type LobbyPlayer, type LobbyState, type RaceSnapshot, type RaceView } from "../contract";
import { TrackGeometry } from "../track/geometry";
import { MEADOW_LOOP, TRACKS } from "../track/tracks";
import { Autopilot } from "./autopilot";
import { TickClock } from "./clock";
import { CODE_ALPHABET, joinCodeFrom, joinUrl, makeCode, parseCode, peerIdFor } from "./codes";
import { EventFeed } from "./feed";
import { gridKart, stepFakeKart } from "./fakeRace";
import { decode, decodeInput, encode, encodeInput, encodeSnapshot, packState, quantiseInput, unpackState } from "./protocol";
import { DEFAULT_SETTINGS, Roster, ScreenKarts, cleanName, cleanPlayer, kartsOnScreen, mergeSettings } from "./roster";
import { BOT_NAMES, buildSetup } from "./setup";
import { seeded } from "./util";
import { DisplayClock, LagMeter, MAX_LAG, RENDER_LAG, SnapshotBuffer, blendViews } from "./view";

describe("room codes", () => {
  it("are four letters from the alphabet without I or O", () => {
    expect(CODE_ALPHABET).toBe("ABCDEFGHJKLMNPQRSTUVWXYZ");
    const random = seeded(5);
    for (let i = 0; i < 200; i++) expect(makeCode(random)).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/);
  });

  it("are read forgivingly and refused when wrong", () => {
    expect(parseCode("abcd")).toBe("ABCD");
    expect(parseCode(" a-b c d ")).toBe("ABCD");
    expect(parseCode("ABC")).toBeNull();
    expect(parseCode("ABCDE")).toBeNull();
    expect(parseCode("AB1D")).toBeNull();
    expect(parseCode("ABOD")).toBeNull();
    expect(parseCode(null)).toBeNull();
  });

  it("make a join address next to the page, and read the code back out of one", () => {
    expect(joinUrl("WXYZ", "https://example.com/game/race.html?x=1#y")).toBe("https://example.com/game/race.html?join=WXYZ");
    expect(joinUrl("WXYZ", "http://localhost:5173/")).toBe("http://localhost:5173/race.html?join=WXYZ");
    expect(joinCodeFrom("?join=wxyz")).toBe("WXYZ");
    expect(joinCodeFrom("?join=nope")).toBeNull();
    expect(joinCodeFrom("")).toBeNull();
    expect(peerIdFor("WXYZ")).toBe("grip-prix-v1-WXYZ");
  });
});

describe("the wire format", () => {
  it("rounds an input to hundredths and back, identically at both ends", () => {
    const input: DriveInput = { steer: -0.3333, throttle: 1, brake: 0.004, drift: true, itemPresses: 7 };
    const wire = encodeInput(42, input);
    expect(wire).toEqual([42, -33, 100, 0, 1, 7]);
    expect(decodeInput(wire)).toEqual({ steer: -0.33, throttle: 1, brake: 0, drift: true, itemPresses: 7 });
    expect(quantiseInput(input)).toEqual(decodeInput(wire));
    // Idempotent: what both ends hold survives another trip.
    expect(quantiseInput(quantiseInput(input))).toEqual(quantiseInput(input));
  });

  it("carries the horn, the emote and the shakes only when there is something to say", () => {
    const input: DriveInput = { steer: 0, throttle: 1, brake: 0, drift: false, itemPresses: 2, shakes: 5 };
    const wire = encodeInput(3, input);
    expect(wire).toEqual([3, 0, 100, 0, 0, 2, 0, 0, 5]);
    expect(decodeInput(wire)).toEqual(input);
    expect(encodeInput(3, { ...input, shakes: 0 })).toEqual([3, 0, 100, 0, 0, 2]);
    expect(decodeInput([3, 0, 100, 0, 0, 2]).shakes).toBeUndefined();
    expect(decodeInput([3, 0, 100, 0, 0, 2, 0, 0, -4]).shakes).toBeUndefined();
  });

  it("carries the wheel's slide beside the drift, and only when there is one", () => {
    const input: DriveInput = { steer: 1, throttle: 0, brake: 1, drift: false, slide: true, itemPresses: 0 };
    expect(encodeInput(1, input)).toEqual([1, 100, 0, 100, 2, 0]);
    expect(decodeInput(encodeInput(1, input))).toEqual(input);
    expect(decodeInput(encodeInput(1, { ...input, drift: true }))).toEqual({ ...input, drift: true });
    expect(decodeInput(encodeInput(1, { ...input, slide: false })).slide).toBeUndefined();
  });

  it("keeps wild values in range", () => {
    expect(decodeInput([1, 9999, -5, 400, 0, -3])).toEqual({ steer: 1, throttle: 0, brake: 1, drift: false, itemPresses: 0 });
    expect(decodeInput([1, Number.NaN, 0, 0, 0, 0]).steer).toBe(0);
    expect(quantiseInput({ ...IDLE_INPUT, steer: 7 }).steer).toBe(1);
  });

  it("decodes messages, and ignores anything that is not one", () => {
    expect(decode(encode({ t: "ping", at: 5 }))).toEqual({ t: "ping", at: 5 });
    expect(decode("not json")).toBeNull();
    expect(decode("42")).toBeNull();
    expect(decode("null")).toBeNull();
    expect(decode('{"x":1}')).toBeNull();
  });

  it("builds a snapshot message around state that is already JSON", () => {
    const state = { tick: 9, karts: [1, 2] };
    const text = encodeSnapshot(JSON.stringify(state), 99, { 3: 17 });
    expect(JSON.parse(text)).toEqual({ t: "snap", r: 99, acks: { 3: 17 }, state });
  });

  describe("a snapshot's kart table", () => {
    const wire = (state: RaceSnapshot) => JSON.parse(JSON.stringify(packState(state))) as RaceSnapshot;
    /** Rows like karts': mostly zeros and repeats, a few floats that change every time, some -1s, a 54-wide row (two words). */
    const karts = (random: () => number, count: number, width = 54): number[][] =>
      Array.from({ length: count }, () =>
        Array.from({ length: width }, (_, i) => (i < 8 ? Math.round(random() * 1e5) / 1e3 - 20 : i % 7 === 0 ? -1 : random() < 0.25 ? Math.floor(random() * 5) : 0)),
      );

    it("comes back exactly as it would have been sent whole, for any table", () => {
      const random = seeded(77);
      for (let i = 0; i < 300; i++) {
        const k = karts(random, 1 + Math.floor(random() * 12), [1, 5, 29, 30, 31, 54, 60, 61][i % 8]!);
        // The same row twice, a row of nothing, and every kind of zero.
        if (k.length > 2) {
          k[1] = k[0]!.slice();
          k[2] = k[2]!.map(() => 0);
          k[0]![0] = -0;
        }
        const state = { tick: i, rng: 3, k, eg: [[1, 2]] };
        const whole = JSON.parse(JSON.stringify(state)) as RaceSnapshot;
        expect(unpackState(wire(state))).toEqual(whole);
      }
    });

    it("is a third smaller than the table sent whole, for a table like a race's", () => {
      const random = seeded(5);
      let packed = 0;
      let whole = 0;
      for (let i = 0; i < 50; i++) {
        const k = karts(random, 8);
        // Four bots with the same bot fields, four players with none.
        packed += JSON.stringify(packState({ tick: i, k }).kp).length;
        whole += JSON.stringify(k).length;
      }
      expect(packed / whole).toBeLessThan(0.75);
    });

    it("leaves a snapshot with no table, or an odd one, as it is", () => {
      const fake = { tick: 4, karts: [{ x: 1 }], places: 0 };
      expect(packState(fake)).toBe(fake);
      expect(unpackState(fake)).toBe(fake);
      for (const k of [[], [[]], [[1, 2], [3]], [[1, "2"]], [[1, null]], "karts", 7, null]) {
        const odd = { tick: 1, k } as unknown as RaceSnapshot;
        expect(packState(odd)).toBe(odd);
      }
    });

    it("is refused when it does not add up, never read as something else", () => {
      const good = wire({ tick: 1, k: [[1, 0, 2], [1, 3, 2]] });
      const kp = good.kp as unknown[];
      expect(unpackState(good)).toEqual({ tick: 1, k: [[1, 0, 2], [1, 3, 2]] });
      const bad = (packed: unknown) => unpackState({ tick: 1, kp: packed } as unknown as RaceSnapshot);
      expect(bad("rows")).toBeNull();
      expect(bad([])).toBeNull();
      expect(bad([0, [0]])).toBeNull();
      expect(bad([2.5, [0]])).toBeNull();
      expect(bad([1e9, [0]])).toBeNull();
      // A word missing; a value missing; a value too many; a word that is not a number; a row that is not a row.
      expect(bad([3, []])).toBeNull();
      expect(bad([3, [0b101, 7]])).toBeNull();
      expect(bad([3, [0b001, 7, 8]])).toBeNull();
      expect(bad([3, ["x", 7]])).toBeNull();
      expect(bad([3, 5])).toBeNull();
      expect(bad([...kp, [0, 5]])).toBeNull();
    });
  });
});

describe("the tick clock", () => {
  it("turns elapsed time into whole ticks and carries the rest", () => {
    const clock = new TickClock();
    expect(clock.ticks(1000, 5)).toBe(0); // the first call only starts the count
    expect(clock.ticks(1000 + 1000 / 60 / 2, 5)).toBe(0);
    expect(clock.ticks(1000 + 1000 / 60, 5)).toBe(1);
    let total = 0;
    for (let i = 1; i <= 60; i++) total += clock.ticks(1000 + 1000 / 60 + (i * 1000) / 30, 5);
    expect(total).toBe(120);
  });

  it("never runs more than the cap, and drops what it cannot run", () => {
    const clock = new TickClock();
    clock.ticks(0, 5);
    expect(clock.ticks(10_007, 5)).toBe(5);
    expect(clock.ticks(10_007 + 1000 / 60, 5)).toBe(1);
  });
});

describe("the event feed", () => {
  it("lets each id through once and hands over what is new", () => {
    const feed = new EventFeed();
    const event = (id: number) => ({ id, tick: id, type: "bump" as const, a: 0, b: 1, strength: 1 });
    feed.push([event(1), event(2)]);
    feed.push([event(2), event(3)]);
    expect(feed.drain().map((e) => e.id)).toEqual([1, 2, 3]);
    feed.push([event(3), event(4)]);
    expect(feed.drain().map((e) => e.id)).toEqual([4]);
    expect(feed.drain()).toEqual([]);
  });
});

describe("the roster", () => {
  const spec = (name: string, screen: "here" | "host" = "here") => ({ name, control: "wheel" as const, screen });

  it("seats players in the lowest free slot and takes a device's seats back whole", () => {
    const roster = new Roster("host");
    roster.set("host", [spec("Ann")]);
    roster.set("a", [spec("Bob"), spec("Bea")]);
    roster.set("b", [spec("Cy")]);
    expect(roster.players().map((p) => [p.slot, p.name, p.device])).toEqual([
      [0, "Ann", "host"],
      [1, "Bob", "a"],
      [2, "Bea", "a"],
      [3, "Cy", "b"],
    ]);
    expect(roster.free).toBe(0);
    expect(roster.reserve("c", 1)).toBe(false);
    expect(roster.remove("a")).toEqual([1, 2]);
    expect(roster.free).toBe(2);
    expect(roster.reserve("c", 2)).toBe(true);
    expect(roster.slotsOf("c")).toEqual([1, 2]);
  });

  it("carries each player's driver and golden kart, and drops a driver that does not exist", () => {
    const roster = new Roster("host");
    roster.set("a", [
      { ...spec("Bob"), character: "rivet", golden: true },
      { ...spec("Bea"), character: "nobody", golden: false },
    ]);
    const [bob, bea] = roster.players();
    expect(bob).toMatchObject({ character: "rivet", golden: true });
    expect(bea!.character).toBeUndefined();
    expect(bea!.golden).toBeUndefined();
    // A guest's garbage cannot break the host.
    expect(cleanPlayer({ name: "X", control: "wheel", character: 7, golden: "yes" }, "P").character).toBeUndefined();
  });

  it("keeps readiness when names change, and points 'host' players at the host's screen", () => {
    const roster = new Roster("host");
    roster.set("a", [spec("Bob", "host")]);
    roster.setReady("a", true);
    roster.set("a", [spec("Robert", "host")]);
    expect(roster.players()[0]).toMatchObject({ name: "Robert", ready: true, device: "a", screen: "host" });
    roster.set("a", [spec("Robert", "here")]);
    expect(roster.players()[0]!.screen).toBe("a");
  });

  it("cleans up what a guest sends", () => {
    expect(cleanName("  Very   Long Name That Goes On And On ", "x")).toBe("Very Long Name T");
    expect(cleanName(42, "Player 3")).toBe("Player 3");
    const roster = new Roster("host");
    roster.set("a", [{ name: "", control: "joystick" as never, screen: "elsewhere" as never }]);
    expect(roster.players()[0]).toMatchObject({ name: "Player 1", control: "keyboard", screen: "a" });
  });

  it("hands out copies", () => {
    const roster = new Roster("host");
    roster.set("host", [spec("Ann")]);
    const first = roster.players();
    first[0]!.name = "Changed";
    expect(roster.players()[0]!.name).toBe("Ann");
  });

  it("says which karts a screen draws as `kartsOnScreen` does, a new array each time, and again for a new lobby", () => {
    const lobby = (screens: string[], phase: LobbyState["phase"] = "racing"): LobbyState => ({
      code: "ABCD",
      host: "h",
      players: screens.map((screen, slot) => ({ slot, name: `P${slot}`, colour: "#fff", device: slot === 0 ? "h" : `g${slot}`, screen, control: "keyboard", ready: true })),
      settings: { ...DEFAULT_SETTINGS },
      phase,
      result: null,
      karts: { 4: 0, 5: 1, 6: 2, 7: 3 },
    });
    const screen = new ScreenKarts();
    const room = lobby(["h", "h", "g2", "h"]);
    expect(screen.of(room, "h")).toEqual(kartsOnScreen(room, "h"));
    expect(screen.of(room, "h")).toEqual([4, 5, 7]);
    const first = screen.of(room, "h");
    first.push(99);
    expect(screen.of(room, "h")).toEqual([4, 5, 7]);
    expect(screen.of(room, "g2")).toEqual([6]);
    expect(screen.of(lobby(["h", "g1", "g2", "h"]), "h")).toEqual([4, 7]);
    expect(screen.of(lobby(["h", "h", "g2", "h"], "lobby"), "h")).toEqual([]);
  });
});

describe("settings", () => {
  it("start at three laps, six racers, bots on", () => {
    expect(DEFAULT_SETTINGS).toMatchObject({ laps: 3, racers: 6, bots: true, track: TRACKS[0]!.id });
  });

  it("stay in range whatever is sent", () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, { laps: 9, racers: 40, bots: false }, MAX_RACERS);
    expect(merged).toMatchObject({ laps: 5, racers: MAX_RACERS, bots: false });
    expect(mergeSettings(DEFAULT_SETTINGS, { laps: Number.NaN, track: 7 as never }, MAX_RACERS)).toEqual(DEFAULT_SETTINGS);
    expect(mergeSettings(DEFAULT_SETTINGS, { laps: 0, racers: 0 }, MAX_RACERS)).toMatchObject({ laps: 1, racers: 1 });
  });
});

describe("the grid", () => {
  const players = (n: number): LobbyPlayer[] =>
    Array.from({ length: n }, (_, slot) => ({
      slot,
      name: `P${slot}`,
      colour: ["#FF453A", "#0A84FF", "#30D158", "#FFD60A"][slot]!,
      device: "d",
      screen: "d",
      control: "keyboard",
      ready: true,
    }));

  it("puts bots at the front and players behind, ids in grid order", () => {
    const { setup, karts } = buildSetup(players(2), DEFAULT_SETTINGS, 123);
    expect(setup.racers.map((r) => [r.id, r.player])).toEqual([[0, null], [1, null], [2, null], [3, null], [4, 0], [5, 1]]);
    expect(karts).toEqual({ 4: 0, 5: 1 });
    expect(setup.laps).toBe(3);
    expect(setup.track.id).toBe(MEADOW_LOOP.id);
    expect(setup.seed).toBe(123);
    expect(setup.racers[4]).toMatchObject({ name: "P0", colour: "#FF453A" });
  });

  it("seats each player with their driver, and gives the bots the drivers nobody picked (never the duck)", () => {
    const picked = players(2).map((p, i) => ({ ...p, character: i === 0 ? "bun" : "rivet", golden: i === 1 }));
    const { setup } = buildSetup(picked, { ...DEFAULT_SETTINGS, racers: 8 }, 5);
    const bots = setup.racers.filter((r) => r.player === null);
    const humans = setup.racers.filter((r) => r.player !== null);
    expect(humans.map((r) => [r.character, r.golden ?? false])).toEqual([["bun", false], ["rivet", true]]);
    expect(bots).toHaveLength(6);
    // Six bots, six drivers left of the eight: all different, none a player's, none the duck.
    expect(new Set(bots.map((b) => b.character)).size).toBe(6);
    for (const bot of bots) expect(["bun", "rivet", "dabble", undefined]).not.toContain(bot.character);
    // The same seed, the same drivers.
    expect(buildSetup(picked, { ...DEFAULT_SETTINGS, racers: 8 }, 5).setup.racers.map((r) => r.character)).toEqual(setup.racers.map((r) => r.character));
    // A full grid with one player: seven bots, and every one of them still has a driver.
    expect(buildSetup(players(1), { ...DEFAULT_SETTINGS, racers: 8 }, 5).setup.racers.every((r) => r.character !== undefined || r.player !== null)).toBe(true);
  });

  it("fills to the racers wanted, never fewer than the players, never past the cap", () => {
    expect(buildSetup(players(4), { ...DEFAULT_SETTINGS, racers: 2 }, 1).setup.racers).toHaveLength(4);
    expect(buildSetup(players(1), { ...DEFAULT_SETTINGS, racers: 99 }, 1).setup.racers).toHaveLength(MAX_RACERS);
    expect(buildSetup(players(3), { ...DEFAULT_SETTINGS, bots: false }, 1).setup.racers).toHaveLength(3);
  });

  it("names the bots from the friendly list, all different, the same for the same seed", () => {
    const a = buildSetup(players(1), { ...DEFAULT_SETTINGS, racers: 8 }, 77).setup.racers.slice(0, 7);
    const b = buildSetup(players(1), { ...DEFAULT_SETTINGS, racers: 8 }, 77).setup.racers.slice(0, 7);
    expect(a).toEqual(b);
    expect(new Set(a.map((r) => r.name)).size).toBe(7);
    for (const bot of a) {
      expect(BOT_NAMES).toContain(bot.name);
      expect(bot.skill).toBeGreaterThanOrEqual(0.3);
      expect(bot.skill).toBeLessThanOrEqual(1);
    }
    const c = buildSetup(players(1), { ...DEFAULT_SETTINGS, racers: 8 }, 78).setup.racers.slice(0, 7);
    expect(c.map((r) => r.name)).not.toEqual(a.map((r) => r.name));
  });
});

function view(time: number, karts: Partial<KartView>[], extra: Partial<RaceView> = {}): RaceView {
  return {
    tick: Math.round(time / TICK),
    phase: "racing",
    countdown: 0,
    time,
    laps: 3,
    track: MEADOW_LOOP,
    racers: [],
    karts: karts.map(
      (k, id) =>
        ({
          id, x: 0, y: 0, z: 0, heading: 0, speed: 0, steer: 0, drift: 0, driftLevel: 0, boost: 0, spin: 0, hop: 0,
          offroad: false, item: null, itemUses: 0, rolling: false, place: 1, lap: 1, lapProgress: 0, wrongWay: false, finished: null,
          ...k,
        }) as KartView,
    ),
    things: [],
    events: [],
    ...extra,
  };
}

describe("blending views", () => {
  it("glides position and heading, and takes everything else from the newer", () => {
    const a = view(0, [{ x: 0, z: 0, heading: 0, place: 3, speed: 5 }]);
    const b = view(1, [{ x: 10, z: 20, heading: 1, place: 2, speed: 9 }], { phase: "racing", time: 1 });
    const mid = blendViews(a, b, 0.25);
    expect(mid.karts[0]).toMatchObject({ x: 2.5, z: 5, heading: 0.25, place: 2, speed: 9 });
    expect(mid.time).toBe(1);
  });

  it("turns the short way round the circle", () => {
    const a = view(0, [{ heading: Math.PI - 0.1 }]);
    const b = view(1, [{ heading: -Math.PI + 0.1 }]);
    const mid = blendViews(a, b, 0.5).karts[0]!.heading;
    expect(Math.abs(Math.abs(mid) - Math.PI)).toBeLessThan(1e-9);
  });

  it("glides things that are the same thing, and snaps ones that appeared, vanished or changed", () => {
    const thing = (id: number, x: number, extra = {}) => ({ id, kind: "puck" as const, x, y: 0, z: 0, heading: 0, active: true, ...extra });
    const a = view(0, [{}], { things: [thing(1, 0), thing(2, 0), thing(3, 0)] });
    const b = view(1, [{}], { things: [thing(1, 10), thing(3, 10, { active: false }), thing(4, 7)] });
    expect(blendViews(a, b, 0.5).things.map((t) => t.x)).toEqual([5, 10, 7]);
  });

  it("hands back what did not move as it is, and still finds a thing whose place in the list changed", () => {
    const box = (id: number) => ({ id, kind: "box" as const, x: id * 3, y: 1, z: 2, heading: 0.5, active: true });
    const a = view(0, [{ x: 4 }, { x: 0 }], { things: [box(0), box(1), box(2)] });
    const b = view(1, [{ x: 4 }, { x: 10 }], { things: [box(1), box(2), { ...box(0), x: 9 }] });
    const mid = blendViews(a, b, 0.5);
    // The kart and the boxes that stand still are the newer view's own, not copies.
    expect(mid.karts[0]).toBe(b.karts[0]);
    expect(mid.karts[1]).not.toBe(b.karts[1]);
    expect(mid.karts[1]!.x).toBe(5);
    expect(mid.things[0]).toBe(b.things[0]);
    expect(mid.things[1]).toBe(b.things[1]);
    expect(mid.things[2]!.x).toBe(4.5);
  });

  it("blends as it always has: karts and things by id, in any order, against a plain version", () => {
    const random = seeded(31);
    const plain = (a: RaceView, b: RaceView, f: number): RaceView => {
      const before = new Map(a.karts.map((k) => [k.id, k]));
      const things = new Map(a.things.map((t) => [t.id, t]));
      const glide = <T extends { x: number; y: number; z: number; heading: number }>(was: T, now: T): T => ({
        ...now,
        x: was.x + (now.x - was.x) * f,
        y: was.y + (now.y - was.y) * f,
        z: was.z + (now.z - was.z) * f,
        heading: was.heading + Math.atan2(Math.sin(now.heading - was.heading), Math.cos(now.heading - was.heading)) * f,
      });
      return {
        ...b,
        karts: b.karts.map((k) => (before.has(k.id) ? glide(before.get(k.id)!, k) : k)),
        things: b.things.map((t) => {
          const was = things.get(t.id);
          return was && was.kind === t.kind && was.active && t.active ? glide(was, t) : t;
        }),
      };
    };
    const kinds = ["box", "puck", "seeker"] as const;
    const draw = (still: boolean): RaceView => {
      const ids = [0, 1, 2, 3, 4, 5].filter(() => random() < 0.8).sort(() => random() - 0.5);
      return view(
        random(),
        [0, 1, 2, 3].map((id) => ({ id, x: still ? id : random() * 50, z: still ? 1 : random() * 50, heading: still ? 0.2 : random() * 6 - 3, place: id + 1 })),
        {
          things: ids.map((id) => ({ id, kind: kinds[random() < 0.8 ? 0 : 1 + Math.floor(random() * 2)]!, x: still ? 7 : random() * 50, y: 0, z: 3, heading: 0, active: random() < 0.9 })),
        },
      );
    };
    for (let i = 0; i < 200; i++) {
      const still = i % 4 === 0;
      const a = draw(still);
      const b = draw(still);
      const f = random() * 1.2;
      const got = blendViews(a, b, f);
      const want = plain(a, b, f);
      // Within rounding: the angles are blended the same way, by a different sum.
      expect(got.karts.map((k) => k.id)).toEqual(want.karts.map((k) => k.id));
      for (const [i, k] of got.karts.entries()) {
        for (const key of ["x", "y", "z", "heading"] as const) expect(k[key]).toBeCloseTo(want.karts[i]![key], 9);
      }
      expect(got.things.map((t) => [t.id, t.kind, t.active])).toEqual(want.things.map((t) => [t.id, t.kind, t.active]));
      for (const [i, t] of got.things.entries()) {
        for (const key of ["x", "y", "z", "heading"] as const) expect(t[key]).toBeCloseTo(want.things[i]![key], 9);
      }
    }
  });
});

describe("the snapshot buffer", () => {
  const at = (time: number, x: number) => view(time, [{ x }]);

  it("ignores a tick no newer than the newest", () => {
    const buffer = new SnapshotBuffer();
    expect(buffer.push(10, at(10 * TICK, 1))).toBe(true);
    expect(buffer.push(10, at(10 * TICK, 99))).toBe(false);
    expect(buffer.push(8, at(8 * TICK, 99))).toBe(false);
    expect(buffer.push(12, at(12 * TICK, 2))).toBe(true);
    expect(buffer.size).toBe(2);
  });

  it("glides between the two around a time, and holds at the ends", () => {
    const buffer = new SnapshotBuffer();
    expect(buffer.at(0)).toBeNull();
    buffer.push(0, at(0, 0));
    expect(buffer.at(5)!.karts[0]!.x).toBe(0);
    buffer.push(6, at(6 * TICK, 6));
    buffer.push(12, at(12 * TICK, 18));
    expect(buffer.at(-1)!.karts[0]!.x).toBe(0);
    expect(buffer.at(3 * TICK)!.karts[0]!.x).toBeCloseTo(3, 9);
    expect(buffer.at(9 * TICK)!.karts[0]!.x).toBeCloseTo(12, 9);
  });

  it("carries on past the newest for a tenth of a second, at the last pace, then holds", () => {
    const buffer = new SnapshotBuffer();
    buffer.push(0, at(0, 0));
    buffer.push(6, at(6 * TICK, 6)); // 60 m/s
    const newest = 6 * TICK;
    expect(buffer.at(newest + 0.05)!.karts[0]!.x).toBeCloseTo(6 + 3, 6);
    expect(buffer.at(newest + 0.1)!.karts[0]!.x).toBeCloseTo(6 + 6, 6);
    expect(buffer.at(newest + 5)!.karts[0]!.x).toBeCloseTo(6 + 6, 6);
  });

  it("keeps only the recent past", () => {
    const buffer = new SnapshotBuffer();
    for (let i = 0; i < 100; i++) buffer.push(i * 2, at(i * 2 * TICK, i));
    expect(buffer.size).toBeLessThanOrEqual(20);
    expect(buffer.newest!.view.karts[0]!.x).toBe(99);
  });
});

describe("the display clock", () => {
  it("starts a lag behind the newest snapshot and keeps pace with real time", () => {
    const clock = new DisplayClock();
    let newest = 5;
    let shown = clock.advance(0, newest);
    expect(shown).toBeCloseTo(5 - RENDER_LAG, 9);
    for (let i = 0; i < 120; i++) {
      newest += TICK;
      const next = clock.advance(TICK, newest);
      expect(next).toBeGreaterThan(shown); // never stops, never goes back
      shown = next;
    }
    expect(newest - shown).toBeCloseTo(RENDER_LAG, 1);
  });

  it("leans back toward the lag after a stall, without a jump, and jumps only when far out", () => {
    const clock = new DisplayClock();
    const t0 = clock.advance(0, 5);
    // Snapshots stop for 0.2 s while frames go on: the clock slows rather than overrun.
    let shown = t0;
    for (let i = 0; i < 12; i++) shown = clock.advance(TICK, 5);
    expect(shown - t0).toBeLessThan(0.2);
    expect(shown - t0).toBeGreaterThan(0.1);
    // A huge gap resets it.
    expect(clock.advance(TICK, 50)).toBeCloseTo(50 - RENDER_LAG, 9);
  });
});

describe("the lag meter", () => {
  /** Feeds `seconds` of snapshots (every second tick) that each take `delay(i)` seconds to arrive; returns the lag. */
  function feed(meter: LagMeter, seconds: number, delay: (i: number) => number, from = 0): number {
    let lag = meter.lag;
    for (let i = from; i < from + seconds * 30; i++) lag = meter.note(i * 2 * TICK, 100 + i * 2 * TICK + delay(i));
    return lag;
  }

  /** Dice for the line's unevenness, the same every run. */
  function dice(seed: number) {
    let s = seed;
    return () => ((s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  }

  it("is RENDER_LAG on a steady line, however slow, and on one Wi-Fi's few milliseconds of unevenness", () => {
    expect(new LagMeter().lag).toBe(RENDER_LAG);
    expect(feed(new LagMeter(), 5, () => 0.15)).toBe(RENDER_LAG);
    const roll = dice(1);
    expect(feed(new LagMeter(), 5, () => 0.003 + roll() * 0.012)).toBe(RENDER_LAG);
  });

  it("grows with an uneven line, enough to cover nine arrivals in ten, and no further than MAX_LAG", () => {
    const roll = dice(2);
    // Up to 60 ms late at random: the lag covers ~54 ms of it on top of the spacing.
    const lag = feed(new LagMeter(), 5, () => 0.04 + roll() * 0.06);
    expect(lag).toBeGreaterThan(2 * TICK + 0.05);
    expect(lag).toBeLessThan(2 * TICK + 0.06 + 0.02 + 0.001);
    expect(feed(new LagMeter(), 5, () => roll() * 0.45)).toBe(MAX_LAG);
  });

  it("does not grow for one hiccup, rises at once for a bad line, and eases back once it steadies", () => {
    const meter = new LagMeter();
    feed(meter, 2, () => 0.05);
    // The host stalls for a fifth of a second: six snapshots straggle in late, then all is well.
    expect(feed(meter, 2, (i) => (i < 66 ? 0.05 + (66 - i) * 2 * TICK : 0.05), 60)).toBe(RENDER_LAG);
    const roll = dice(3);
    const bad = feed(meter, 1, () => 0.05 + roll() * 0.1, 120);
    expect(bad).toBeGreaterThan(0.12);
    // Steady again: it comes down, not at once, but within a few seconds.
    const soon = feed(meter, 0.5, () => 0.05, 150);
    expect(soon).toBeGreaterThan(0.1);
    expect(feed(meter, 6, () => 0.05, 165)).toBeLessThan(RENDER_LAG + 0.002);
  });

  it("starts over after a stop (the host paused), rather than read the pause as lateness", () => {
    const meter = new LagMeter();
    feed(meter, 2, () => 0.05);
    // The race stood still for 4 s: the host's clock did not move, this device's did.
    expect(feed(meter, 2, () => 4.05, 60)).toBe(RENDER_LAG);
  });

  it("leads the display clock to a longer lag without a jump", () => {
    const clock = new DisplayClock();
    let newest = 5;
    let shown = clock.advance(0, newest, RENDER_LAG);
    for (let i = 0; i < 240; i++) {
      newest += TICK;
      const next = clock.advance(TICK, newest, 0.15);
      expect(next).toBeGreaterThan(shown);
      expect(next - shown).toBeLessThan(TICK * 1.2);
      shown = next;
    }
    // Measured just after a frame's advance, which is a tick on from the target.
    expect(newest - shown).toBeCloseTo(0.15 - TICK, 3);
  });
});

describe("the autopilot", () => {
  /** Drives the fake physics round the real track for as long as it takes to do `laps`. */
  function drive(def = MEADOW_LOOP, laps = 2, onTick?: (offset: number, speed: number) => void) {
    const geometry = TrackGeometry.build(def);
    const kart = gridKart(geometry, 0);
    const pilot = new Autopilot(geometry, 0);
    let ticks = 0;
    let worst = 0;
    let topSpeed = 0;
    let distance = 0;
    let previous = geometry.project(kart.x, kart.z);
    while (distance < laps * geometry.length && ticks < 60 * 200) {
      const view = { x: kart.x, z: kart.z, heading: kart.heading, speed: kart.speed, item: null, rolling: false } as KartView;
      stepFakeKart(kart, pilot.drive(view));
      ticks++;
      const here = geometry.project(kart.x, kart.z, previous.s);
      distance += geometry.delta(previous.s, here.s);
      previous = here;
      worst = Math.max(worst, Math.abs(here.offset) / (here.sample.width / 2));
      topSpeed = Math.max(topSpeed, kart.speed);
      onTick?.(here.offset, kart.speed);
    }
    return { seconds: ticks * TICK, worst, topSpeed, distance, length: geometry.length };
  }

  it("goes round the track twice, on the road the whole way, at a sane pace", () => {
    const run = drive(MEADOW_LOOP, 2);
    expect(run.distance).toBeGreaterThan(2 * run.length);
    // Never past the road's edge (1 is the edge itself).
    expect(run.worst).toBeLessThan(0.9);
    // About a kilometre a lap at up to 24 m/s: neither crawling nor flying.
    const lap = run.seconds / 2;
    expect(lap).toBeGreaterThan(run.length / 24);
    expect(lap).toBeLessThan(run.length / 9);
    expect(run.topSpeed).toBeLessThanOrEqual(24.5);
  });

  it("presses an item once when it has one, and not again at once", () => {
    const geometry = TrackGeometry.build(MEADOW_LOOP);
    const pilot = new Autopilot(geometry, 4);
    const start = geometry.point(0);
    const holding = { x: start.x, z: start.z, heading: 0, speed: 10, item: "nitro", rolling: false } as KartView;
    const rolling = { ...holding, rolling: true } as KartView;
    expect(pilot.drive(rolling).itemPresses).toBe(4);
    expect(pilot.drive(holding).itemPresses).toBe(5);
    expect(pilot.drive(holding).itemPresses).toBe(5);
    for (let i = 0; i < 100; i++) pilot.drive(holding);
    expect(pilot.drive(holding).itemPresses).toBe(6);
  });
});
