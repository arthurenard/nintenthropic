/**
 * What devices say to each other. Every message is one JSON object with a
 * short type `t`; the whole protocol is versioned, and a host and a guest of
 * different versions refuse each other cleanly (`reject: "version"`) rather
 * than misread each other halfway through a race.
 *
 * Which channel carries what:
 *
 *   reliable    hello, welcome, reject, configure, ready, lobby, start,
 *               events, results, ping, pong, leave
 *   unreliable  in (a guest's inputs), snap (the host's race, 30 times a second)
 *
 * Bump PROTOCOL_VERSION whenever a message changes shape.
 */
import type {
  DriveInput,
  DriverControl,
  LobbyState,
  RaceEvent,
  RaceResult,
  RacerSetup,
  RaceSnapshot,
} from "../contract";
import { clamp } from "./util";

export const PROTOCOL_VERSION = 3;

/** Each input packet carries this many of the latest inputs, so a lost packet costs nothing. */
export const INPUTS_PER_PACKET = 6;

/** A player a device brings, as the host needs to know them. */
export interface WirePlayer {
  name: string;
  control: DriverControl["kind"];
  /**
   * "here" shows the race on their own device; "host" on the host's big
   * screen; "auto" wherever the host's `display` setting says.
   */
  screen: "here" | "host" | "auto";
  /** Their driver (characters.ts id), and whether the kart is golden. */
  character?: string;
  golden?: boolean;
}

/**
 * One tick of one kart's input, numbered, and small: whole numbers in
 * hundredths, so both ends (the guest predicting, the host driving) use exactly
 * the same values.
 *
 *   [seq, steer, throttle, brake, drift, itemPresses, horn, emote]
 *
 * `horn` is the count of honks, ever (like itemPresses); `emote` is 0 none,
 * 1 cheer, 2 wave. The last two are sent only when there is something to
 * say, and read as none when absent, so older senders still work.
 */
export type WireInput = [number, number, number, number, 0 | 1, number, number?, number?];

const EMOTES = [null, "cheer", "wave"] as const;

/** What a guest needs to build the race the host is about to run. */
export interface StartInfo {
  /** The track by id: guests rebuild it with trackById, so no track data crosses the wire. */
  track: string;
  /** The track is flipped left for right (Mirror mode): guests rebuild it with mirrorTrack. Absent: not. */
  mirror?: boolean;
  laps: number;
  seed: number;
  racers: RacerSetup[];
  lobby: LobbyState;
}

export type ToHost =
  | { t: "hello"; v: number; device: string; /** How many players this device brings, 1 to 4. */ n: number }
  | { t: "configure"; players: WirePlayer[] }
  | { t: "ready"; ready: boolean }
  /** Whose hands (in the order the players were configured) have been out of the picture for a while. */
  | { t: "lost"; lost: boolean[] }
  /**
   * Per kart: its latest inputs, oldest first. `r` names the race (its seed)
   * so a packet that wandered in late from the last race is not taken for this one's.
   */
  | { t: "in"; r: number; k: [kart: number, inputs: WireInput[]][] }
  | { t: "ping"; at: number }
  | { t: "leave" };

export type ToGuest =
  | { t: "welcome"; v: number; device: string; lobby: LobbyState }
  | { t: "reject"; reason: "full" | "version" | "started" }
  | { t: "lobby"; lobby: LobbyState }
  | { t: "start"; start: StartInfo }
  /** The race as it is: `acks` is, for this guest's karts, the last `seq` the host applied. */
  | { t: "snap"; r: number; acks: Record<number, number>; state: RaceSnapshot }
  | { t: "events"; events: RaceEvent[] }
  | { t: "results"; result: RaceResult; lobby: LobbyState }
  | { t: "pong"; at: number }
  | { t: "leave" };

export type Message = ToHost | ToGuest;

export function encode(message: Message): string {
  return JSON.stringify(message);
}

/**
 * A snapshot message, with the (large) race state already turned into JSON:
 * the host does that once and shares it with every guest, adding only each
 * guest's own acks.
 */
export function encodeSnapshot(stateJson: string, race: number, acks: Record<number, number>): string {
  return `{"t":"snap","r":${race},"acks":${JSON.stringify(acks)},"state":${stateJson}}`;
}

/** A message from the wire, or null if it is not one of ours. Never throws. */
export function decode(data: string): Message | null {
  try {
    const value: unknown = JSON.parse(data);
    if (typeof value === "object" && value !== null && typeof (value as { t?: unknown }).t === "string") {
      return value as Message;
    }
  } catch {
    /* garbage: ignore it */
  }
  return null;
}

export function encodeInput(seq: number, input: DriveInput): WireInput {
  const horn = Math.max(0, Math.floor(input.horn ?? 0));
  const emote = Math.max(0, EMOTES.indexOf(input.emote ?? null));
  const wire: WireInput = [
    seq,
    Math.round(clamp(input.steer, -1, 1) * 100),
    Math.round(clamp(input.throttle, 0, 1) * 100),
    Math.round(clamp(input.brake, 0, 1) * 100),
    input.drift ? 1 : 0,
    Math.max(0, Math.floor(input.itemPresses)),
  ];
  if (horn > 0 || emote > 0) wire.push(horn, emote);
  return wire;
}

export function decodeInput(wire: readonly (number | undefined)[]): DriveInput {
  const num = (value: number | undefined) => (typeof value === "number" && Number.isFinite(value) ? value : 0);
  const input: DriveInput = {
    steer: clamp(num(wire[1]), -100, 100) / 100,
    throttle: clamp(num(wire[2]), 0, 100) / 100,
    brake: clamp(num(wire[3]), 0, 100) / 100,
    drift: num(wire[4]) === 1,
    itemPresses: Math.max(0, Math.floor(num(wire[5]))),
  };
  // Only when there is one, so an input that cannot honk reads as it always did.
  const horn = Math.max(0, Math.floor(num(wire[6])));
  if (horn > 0) input.horn = horn;
  const emote = EMOTES[Math.floor(num(wire[7]))];
  if (emote) input.emote = emote;
  return input;
}

/**
 * The input as the other end will read it. A guest predicts with this, not
 * with the raw input, so what it predicts and what the host drives are the
 * same numbers.
 */
export function quantiseInput(input: DriveInput): DriveInput {
  return decodeInput(encodeInput(0, input));
}
