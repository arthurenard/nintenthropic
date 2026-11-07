/**
 * What the items and the race's moments sound like, as orders (no audio device): each item's pick-up chime, the rocket's siren for the kart it hunts,
 * what is heard when something hits, bumps by force, a horn for each driver, and how many sounds eight karts can ask for at once.
 */
import { describe, expect, it } from "vitest";
import { CUES } from "../../audio/cues/table";
import { ITEM_CHIMES } from "../../audio/cues/kart-items";
import type { HitCause, ItemKind, KartView, RaceEvent } from "../contract";
import { ITEM_KINDS } from "../sim/state";
import { TUNING } from "../sim/tuning";
import { CLONK_FROM, HORNS, ROULETTE, chimeOrder, emoteOrder, ordersFor } from "./events";
import type { Scene } from "./scene";

const event = (e: object): RaceEvent => ({ id: 1, tick: 0, ...e }) as RaceEvent;
const kart = (id: number, x: number, place: number, finished: number | null = null): KartView => ({ id, x, y: 0, z: 0, heading: 0, place, finished }) as unknown as KartView;

/** Kart 0 is on this screen, in third; 1 leads, 2 is second, 3 is behind and has finished. */
const scene = (over: Partial<Scene> = {}): Scene => ({
  locals: [{ kart: 0, pan: 0 }],
  karts: new Map([[0, kart(0, 0, 3)], [1, kart(1, 6, 1)], [2, kart(2, 9, 2)], [3, kart(3, 12, 4, 90)]]),
  laps: 3,
  ...over,
});

describe("the item reel", () => {
  it("turns as long as the sim's roulette, so the chime lands with it", () => {
    expect(ROULETTE).toBe(TUNING.items.roulette);
  });

  it("has a chime of its own for every item, heard by the player who took the box and nobody else", () => {
    expect([...ITEM_CHIMES].sort()).toEqual([...ITEM_KINDS].sort());
    for (const item of ITEM_KINDS) {
      const chime = chimeOrder(item, 0);
      expect(chime!.distance).toBe(0);
      expect(CUES[chime!.cue], item).toBeDefined();
      // Another kart's box bursts for the screen, and says nothing of what was in it.
      expect(ordersFor(event({ type: "pickup", kart: 1, item }), scene()).map((o) => o.cue)).toEqual(["kart_box_smash"]);
    }
  });

  it("gives the triple items their own sounds, not the single item's twice", () => {
    expect(ordersFor(event({ type: "use", kart: 0, item: "nitro3" }), scene())[0]!.cue).toBe("kart_nitro_triple");
    expect(ordersFor(event({ type: "use", kart: 0, item: "nitro" }), scene())[0]!.cue).toBe("kart_nitro");
    expect(ordersFor(event({ type: "use", kart: 0, item: "puck3" }), scene())[0]!.rate).toBeGreaterThan(ordersFor(event({ type: "use", kart: 0, item: "puck" }), scene())[0]!.rate);
    expect(ordersFor(event({ type: "use", kart: 0, item: "seeker" }), scene())[0]!.cue).toBe("kart_seeker_launch");
  });
});

describe("the skyrocket", () => {
  const siren = (owner: number, local: number, over: Partial<Scene> = {}) =>
    ordersFor(event({ type: "use", kart: owner, item: "skyrocket" }), scene({ locals: [{ kart: local, pan: -0.4 }], ...over })).filter((o) => o.cue === "kart_skyrocket_warn");

  it("sounds a siren for the kart it hunts, the leader of the others, when that kart is on this screen", () => {
    const [warn, ...rest] = siren(0, 1);
    expect(rest).toEqual([]);
    expect(warn).toMatchObject({ pan: -0.4, distance: 0, priority: 3 });
    expect(warn!.delay).toBeGreaterThan(0);
  });

  it("does not warn the owner, nor a kart that is not the leader, nor one that has finished", () => {
    // Kart 1 leads; its own rocket is sent after the runner-up.
    expect(siren(1, 1)).toEqual([]);
    expect(siren(1, 2)).toHaveLength(1);
    expect(siren(0, 2)).toEqual([]);
    expect(siren(0, 3)).toEqual([]);
  });
});

describe("being hit", () => {
  const cues = (cause: HitCause): string[] => ordersFor(event({ type: "hit", kart: 0, by: 1, cause }), scene()).map((o) => o.cue).sort();

  it("spins out on oil with a skid, and is hit by a seeker with a lock", () => {
    expect(cues("slick")).toEqual(["kart_slick_skid", "kart_spinout"]);
    expect(cues("seeker")).toEqual(["kart_hit", "kart_seeker_lock"]);
    expect(cues("decoy")).toEqual(["kart_decoy_pop", "kart_spinout"]);
    expect(cues("storm")).toEqual(["kart_spinout"]);
    for (const cause of ["puck", "skyrocket", "blast", "comet"] as HitCause[]) expect(cues(cause), cause).toEqual(["kart_hit"]);
  });
});

describe("kart against kart", () => {
  const bump = (strength: number) => ordersFor(event({ type: "bump", a: 0, b: 1, strength }), scene())[0]!;

  it("taps for a graze and clonks for a hard hit, louder and lower the harder", () => {
    expect(bump(0.2).cue).toBe("kart_bump");
    expect(bump(CLONK_FROM).cue).toBe("kart_bump_hard");
    expect(bump(1).cue).toBe("kart_bump_hard");
    expect(bump(1).volume).toBeGreaterThan(bump(CLONK_FROM).volume);
    expect(bump(0.4).volume).toBeGreaterThan(bump(0.1).volume);
    expect(bump(1).rate).toBeLessThan(bump(CLONK_FROM).rate);
  });
});

describe("a trick landed", () => {
  it("is cheered for the player's own kart", () => {
    const land = (kart: number, boost: boolean) => ordersFor(event({ type: "land", kart, boost, strength: 0.4 }), scene()).map((o) => o.cue);
    expect(land(0, true)).toContain("kart_land_cheer");
    expect(land(0, false)).not.toContain("kart_land_cheer");
    expect(land(1, true)).not.toContain("kart_land_cheer");
  });
});

describe("the horns", () => {
  it("give every driver a horn of their own", () => {
    const characters = ["bun", "pepper", "moss", "kit", "juniper", "mango", "bramble", "rivet", "dabble"];
    const cues = characters.map((character) => {
      const racers = [{ id: 0, character }];
      return ordersFor(event({ type: "horn", kart: 0 }), scene({ racers }))[0]!.cue;
    });
    expect(new Set(cues).size).toBe(characters.length);
    for (const character of characters) expect(HORNS[character], character).toBeDefined();
    for (const cue of Object.values(HORNS)) expect(CUES[cue], cue).toBeDefined();
  });
});

describe("emotes", () => {
  it("cheer and wave have their own sounds, and nothing else does", () => {
    expect(emoteOrder("cheer", 0.3)).toMatchObject({ cue: "kart_emote_cheer", pan: 0.3, distance: 0 });
    expect(emoteOrder("wave", -0.3)).toMatchObject({ cue: "kart_emote_wave", pan: -0.3 });
    expect(emoteOrder(null, 0)).toBeNull();
    expect(emoteOrder(undefined, 0)).toBeNull();
  });
});

describe("eight karts at once", () => {
  it("ask for a bounded number of sounds that carry, and every item cue is capped in instances", () => {
    const items: ItemKind[] = [...ITEM_KINDS];
    // Eight karts, all within earshot of the one on this screen, each using an item in the same frame.
    const crowd: Scene = {
      locals: [{ kart: 0, pan: 0 }],
      karts: new Map(Array.from({ length: 8 }, (_, i) => [i, kart(i, i * 2, i + 1)])),
      laps: 3,
    };
    let orders = 0;
    for (let i = 0; i < 8; i++) {
      orders += ordersFor(event({ type: "use", kart: i, item: items[i]! }), crowd).length;
      orders += ordersFor(event({ type: "hit", kart: i, by: null, cause: "slick" }), crowd).length;
    }
    // At most a few per kart (the race audio caps the frame at eight and each cue at two on top of it: race-audio.test.ts).
    expect(orders).toBeLessThanOrEqual(8 * 4);
    for (const cue of Object.keys(CUES).filter((c) => c.startsWith("kart_") && !CUES[c]!.loop)) {
      expect(CUES[cue]!.maxInstances ?? 99, cue).toBeLessThanOrEqual(5);
    }
  });
});
