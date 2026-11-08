/**
 * What devices say to each other. Every message is one JSON object with a
 * short type `t`; the whole protocol is versioned, and a host and a guest of
 * different versions refuse each other cleanly (`reject: "version"`) rather
 * than misread each other halfway through a race.
 *
 * Which channel carries what:
 *
 *   reliable    hello, welcome, reject, configure, ready, lost, lobby, start,
 *               events, results, photo, ping, pong, leave
 *   unreliable  in (a guest's inputs), snap (the host's race, 30 times a second)
 *
 * Bump PROTOCOL_VERSION whenever a message changes shape, or the way devices
 * connect (7: one WebRTC connection with a lossy channel, see peer.ts; 8: the
 * finish-line photos).
 */
import {
  MAX_PHOTO_CHARS,
  type DriveInput,
  type DriverControl,
  type LobbyState,
  type RaceEvent,
  type RaceResult,
  type RacerSetup,
  type RaceSnapshot,
} from "../contract";
import { clamp } from "./util";

export const PROTOCOL_VERSION = 11;

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
 *   [seq, steer, throttle, brake, drift, itemPresses, horn, emote, shakes]
 *
 * `drift` holds bits: 1 the drift held, 2 the brake is the wheel's slide.
 * `horn` is the count of honks, ever (like itemPresses); `emote` is 0 none,
 * 1 cheer, 2 wave; `shakes` the count of shakes, ever. The last three are sent
 * only when there is something to say, and read as none when absent, so the
 * packets that go sixty times a second stay as short as they can.
 */
export type WireInput = [number, number, number, number, 0 | 1 | 2 | 3, number, number?, number?, number?];

const EMOTES = [null, "cheer", "wave"] as const;

/** What a guest needs to build the race the host is about to run. */
export interface StartInfo {
  /** The track by id: guests rebuild it with trackById, so no track data crosses the wire. */
  track: string;
  /** The track is flipped left for right (Mirror mode): guests rebuild it with mirrorTrack. Absent: not. */
  mirror?: boolean;
  /** The Party Rules card dealt for this race (rules.ts card id). Absent: none. */
  card?: string;
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
  /** A finish-line photo of one of this device's players (their kart `kart` in race `r`), sent once the race is decided. */
  | PhotoMessage
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
  /** Another device's finish-line photo, passed on by the host (and the host's own players'). */
  | PhotoMessage
  | { t: "pong"; at: number }
  | { t: "leave" };

/** A finish-line photo on the wire: the race (its seed), the kart, and the picture as a JPEG data URL (`isPhoto`). */
export interface PhotoMessage {
  t: "photo";
  r: number;
  kart: number;
  jpeg: string;
}

export type Message = ToHost | ToGuest;

const PHOTO_HEAD = "data:image/jpeg;base64,";
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * Whether `value` is a finish-line photo as one is sent: a JPEG data URL of base64 and nothing else, no longer than
 * MAX_PHOTO_CHARS. Anything else from the wire is dropped before a screen could show it.
 */
export function isPhoto(value: unknown): value is string {
  return typeof value === "string" && value.length <= MAX_PHOTO_CHARS && value.startsWith(PHOTO_HEAD) && BASE64.test(value.slice(PHOTO_HEAD.length));
}

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

/** The fields of a row are told apart in words of this many bits: a number's bit operations reach 32 and the sign takes one. */
const WORD = 30;
/** The widest row a guest will unpack; it does not take the host's word for how wide a table is. */
const MAX_WIDTH = 1024;

/**
 * Whether `rows` is a table: at least one row, every row an array of numbers, all of one width.
 * (`k`, a race's kart table, is one; a stand-in race's snapshot has none.)
 */
function isTable(rows: unknown): rows is number[][] {
  if (!Array.isArray(rows) || rows.length === 0) return false;
  const width = (rows[0] as unknown[] | undefined)?.length;
  if (!width || width > MAX_WIDTH) return false;
  // (Counted loops: `for...of` over a table's numbers boxes every one of them, seven kilobytes a snapshot.)
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r] as unknown;
    if (!Array.isArray(row) || row.length !== width) return false;
    for (let i = 0; i < width; i++) if (typeof row[i] !== "number") return false;
  }
  return true;
}

/**
 * A snapshot ready to be written: its kart table `k` (a row of numbers a kart, most of them the same as the kart before
 * or zero) becomes `kp`, the width and then each row as what differs from the row before it (the first from zeros): a
 * word of bits for every 30 fields, one bit for each field that differs, then the values of those fields in order.
 * About a third less to send. `unpackState` gives the table back exactly as `JSON.parse(JSON.stringify(k))` would have it.
 * A snapshot without such a table is left as it is.
 */
export function packState(state: RaceSnapshot): RaceSnapshot {
  const rows = state.k;
  if (!isTable(rows)) return state;
  const width = rows[0]!.length;
  const words = Math.ceil(width / WORD);
  const packed: (number | number[])[] = [width];
  let base: readonly number[] = new Array<number>(width).fill(0);
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r]!;
    // Counted first, so that a row is made once, at its size.
    let differ = 0;
    for (let i = 0; i < width; i++) if (row[i] !== base[i]) differ++;
    const coded = new Array<number>(words + differ);
    let used = words;
    for (let word = 0; word < words; word++) {
      let bits = 0;
      for (let bit = 0, i = word * WORD; bit < WORD && i < width; bit++, i++) {
        if (row[i] === base[i]) continue;
        bits |= 1 << bit;
        coded[used++] = row[i]!;
      }
      coded[word] = bits;
    }
    packed.push(coded);
    base = row;
  }
  // (`k` unset is left out of the JSON.)
  return { ...state, k: undefined, kp: packed };
}

/**
 * The snapshot as `packState` wrote it, with its kart table back as `k`; one without a packed table as it came. Null
 * for one that does not add up (a guest takes nobody's word for a table's shape): it is to be ignored.
 */
export function unpackState(state: RaceSnapshot): RaceSnapshot | null {
  const packed = state.kp;
  if (packed === undefined) return state;
  if (!Array.isArray(packed)) return null;
  const width = packed[0];
  if (typeof width !== "number" || !Number.isInteger(width) || width < 1 || width > MAX_WIDTH) return null;
  const words = Math.ceil(width / WORD);
  const rows: number[][] = [];
  let base: number[] = new Array<number>(width).fill(0);
  for (let r = 1; r < packed.length; r++) {
    const coded = packed[r] as unknown;
    if (!Array.isArray(coded) || coded.length < words) return null;
    const row = base.slice();
    let at = words;
    for (let word = 0; word < words; word++) {
      const bits = coded[word];
      if (typeof bits !== "number") return null;
      for (let bit = 0, i = word * WORD; bit < WORD && i < width; bit++, i++) {
        if (((bits >>> bit) & 1) === 0) continue;
        if (at >= coded.length) return null;
        row[i] = coded[at++] as number;
      }
    }
    if (at !== coded.length) return null;
    rows.push(row);
    base = row;
  }
  return { ...state, k: rows, kp: undefined };
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
  const shakes = Math.max(0, Math.floor(input.shakes ?? 0));
  const wire: WireInput = [
    seq,
    Math.round(clamp(input.steer, -1, 1) * 100),
    Math.round(clamp(input.throttle, 0, 1) * 100),
    Math.round(clamp(input.brake, 0, 1) * 100),
    ((input.drift ? 1 : 0) | (input.slide ? 2 : 0)) as 0 | 1 | 2 | 3,
    Math.max(0, Math.floor(input.itemPresses)),
  ];
  if (horn > 0 || emote > 0 || shakes > 0) wire.push(horn, emote);
  if (shakes > 0) wire.push(shakes);
  return wire;
}

export function decodeInput(wire: readonly (number | undefined)[]): DriveInput {
  const num = (value: number | undefined) => (typeof value === "number" && Number.isFinite(value) ? value : 0);
  const input: DriveInput = {
    steer: clamp(num(wire[1]), -100, 100) / 100,
    throttle: clamp(num(wire[2]), 0, 100) / 100,
    brake: clamp(num(wire[3]), 0, 100) / 100,
    drift: (num(wire[4]) & 1) === 1,
    itemPresses: Math.max(0, Math.floor(num(wire[5]))),
  };
  if ((num(wire[4]) & 2) === 2) input.slide = true;
  // Only when there is one, so an input that cannot honk reads as it always did.
  const horn = Math.max(0, Math.floor(num(wire[6])));
  if (horn > 0) input.horn = horn;
  const emote = EMOTES[Math.floor(num(wire[7]))];
  if (emote) input.emote = emote;
  const shakes = Math.max(0, Math.floor(num(wire[8])));
  if (shakes > 0) input.shakes = shakes;
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
