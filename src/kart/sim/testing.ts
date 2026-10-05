/**
 * Helpers for the simulation's tests: races with a few karts, scripted
 * inputs, and a way to put a kart in a state (an item in hand, nearly home)
 * by editing a snapshot, which is the one supported way to reach in.
 */
import { IDLE_INPUT, type DriveInput, type KartView, type RaceEvent, type RacerSetup, type RaceSetup, type TrackDef } from "../contract";
import { GO_TICK } from "./kart";
import { createSimRace, type SimRace } from "./race";
import { KART_AT } from "./snapshot";
import { ITEM_KINDS } from "./state";

/** A wide round arena, so a kart can drift in circles without ever leaving the road. */
export const ARENA: TrackDef = {
  id: "arena",
  name: "Arena",
  theme: "meadow",
  laps: 3,
  width: 70,
  points: Array.from({ length: 28 }, (_, i) => {
    const a = (i / 28) * Math.PI * 2;
    return { x: 150 * Math.cos(a), z: 150 * Math.sin(a) };
  }),
  itemRows: [],
};

export function racer(id: number, player: number | null = null, skill = 1): RacerSetup {
  return { id, name: `Kart ${id}`, colour: "#ffffff", player, skill };
}

/** `players` people then `bots` bots, in grid order. */
export function racers(players: number, bots: number, skill = 1): RacerSetup[] {
  return [
    ...Array.from({ length: players }, (_, i) => racer(i, i)),
    ...Array.from({ length: bots }, (_, i) => racer(players + i, null, skill)),
  ];
}

export function race(track: TrackDef, list: RacerSetup[], options: { laps?: number; seed?: number } = {}): SimRace {
  const setup: RaceSetup = { track, laps: options.laps ?? track.laps, seed: options.seed ?? 1, racers: list };
  return createSimRace(setup);
}

export function input(over: Partial<DriveInput> = {}): DriveInput {
  return { ...IDLE_INPUT, ...over };
}

export type Script = (tick: number) => Map<number, DriveInput> | DriveInput | undefined;

/** Steps `count` ticks; a script gives each tick's inputs (a bare DriveInput is kart 0's). Collects the events. */
export function run(r: SimRace, count: number, script: Script = () => undefined): RaceEvent[] {
  const events: RaceEvent[] = [];
  for (let i = 0; i < count; i++) {
    const given = script(r.tick);
    const inputs = given === undefined ? new Map<number, DriveInput>() : given instanceof Map ? given : new Map([[0, given]]);
    r.step(inputs);
    events.push(...r.takeEvents());
  }
  return events;
}

/** Steps through the countdown to the first racing tick. */
export function toGo(r: SimRace, script?: Script): RaceEvent[] {
  return run(r, GO_TICK - r.tick, script);
}

export function view(r: SimRace, id = 0): KartView {
  return r.view().karts.find((k) => k.id === id)!;
}

/** Sets some of a kart's numbers (by `KART_AT` name) in the race, through a snapshot. Items are given by name. */
export function patch(r: SimRace, index: number, values: Partial<Record<keyof typeof KART_AT, number>>): void {
  const snap = r.snapshot();
  const row = (snap.k as number[][])[index]!;
  for (const [name, value] of Object.entries(values)) row[KART_AT[name as keyof typeof KART_AT]] = value;
  r.restore(JSON.parse(JSON.stringify(snap)));
}

/** Puts an item in a kart's hand. */
export function give(r: SimRace, index: number, item: (typeof ITEM_KINDS)[number]): void {
  patch(r, index, { item: ITEM_KINDS.indexOf(item), uses: item === "nitro3" ? 3 : 1, roll: 0 });
}

/** Counts events of a type for a kart. */
export function count(events: RaceEvent[], type: RaceEvent["type"], kart?: number): number {
  return events.filter((e) => e.type === type && (kart === undefined || ("kart" in e && e.kart === kart))).length;
}
