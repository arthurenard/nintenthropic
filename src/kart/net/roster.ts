/**
 * Who is in the room: four slots, each a player on some device. The host owns
 * the roster and everyone else sees copies of it in the lobby.
 *
 * A slot is also a colour (PLAYER_COLOURS[slot]), so a player keeps their
 * colour for as long as they hold the slot, and nobody else gets it.
 */
import { characterById } from "../characters";
import {
  MAX_PLAYERS,
  PLAYER_COLOURS,
  type DriverControl,
  type LobbyPlayer,
  type LobbySettings,
  type LobbyState,
} from "../contract";
import { CUPS, TRACKS } from "../track/tracks";
import { clamp } from "./util";
import type { WirePlayer } from "./protocol";

export const DEFAULT_SETTINGS: LobbySettings = {
  track: TRACKS[0]!.id,
  laps: 3,
  bots: true,
  racers: 6,
  display: "own",
  mode: "race",
  cup: CUPS[0]!.id,
  mirror: false,
};

const CONTROLS: readonly DriverControl["kind"][] = ["wheel", "keyboard", "gamepad"];

/** Settings with a patch applied, every value kept in range (a guest's garbage cannot break the host). */
export function mergeSettings(current: LobbySettings, patch: Partial<LobbySettings>, maxRacers: number): LobbySettings {
  const track = typeof patch.track === "string" && TRACKS.some((t) => t.id === patch.track) ? patch.track : current.track;
  const laps = Number.isFinite(patch.laps) ? clamp(Math.round(patch.laps!), 1, 5) : current.laps;
  const racers = Number.isFinite(patch.racers) ? clamp(Math.round(patch.racers!), 1, maxRacers) : current.racers;
  const display = patch.display === "own" || patch.display === "host" ? patch.display : current.display;
  const mode = patch.mode === "race" || patch.mode === "grand-prix" ? patch.mode : current.mode;
  const cup = typeof patch.cup === "string" && CUPS.some((c) => c.id === patch.cup) ? patch.cup : current.cup;
  const mirror = typeof patch.mirror === "boolean" ? patch.mirror : current.mirror;
  return { track, laps, racers, display, bots: typeof patch.bots === "boolean" ? patch.bots : current.bots, mode, cup, mirror };
}

/** A name a person typed, cleaned up for display. */
export function cleanName(name: unknown, fallback: string): string {
  const text = typeof name === "string" ? name.replace(/\s+/g, " ").trim().slice(0, 16) : "";
  return text || fallback;
}

export function cleanPlayer(player: unknown, fallback: string): WirePlayer {
  const p = (typeof player === "object" && player !== null ? player : {}) as Partial<WirePlayer>;
  return {
    name: cleanName(p.name, fallback),
    control: CONTROLS.includes(p.control as DriverControl["kind"]) ? (p.control as DriverControl["kind"]) : "keyboard",
    screen: p.screen === "host" || p.screen === "auto" ? p.screen : "here",
    ...(typeof p.character === "string" && characterById(p.character) ? { character: p.character } : {}),
    ...(p.golden === true ? { golden: true } : {}),
  };
}

/**
 * The karts a device draws, one viewport each, in slot order: those whose
 * player's `screen` is this device (their own, or the host's big screen).
 */
export function kartsOnScreen(lobby: LobbyState, device: string): number[] {
  if (lobby.phase !== "racing") return [];
  const out: number[] = [];
  for (const player of lobby.players) {
    if (player.screen !== device) continue;
    for (const [kart, slot] of Object.entries(lobby.karts)) if (slot === player.slot) out.push(Number(kart));
  }
  return out;
}

/**
 * `kartsOnScreen` for a session that is asked every frame, more than once: worked out once for each lobby it is
 * asked of (a lobby is never changed once made, a new one replaces it), and a new array handed out each time,
 * since callers keep what they are given.
 */
export class ScreenKarts {
  private lobby: LobbyState | null = null;
  private device = "";
  private karts: number[] = [];

  of(lobby: LobbyState, device: string): number[] {
    if (lobby !== this.lobby || device !== this.device) {
      this.lobby = lobby;
      this.device = device;
      this.karts = kartsOnScreen(lobby, device);
    }
    return this.karts.slice();
  }
}

/**
 * True when the race is watched on the host's screen by someone else's
 * players (a guest's device that is only a wheel): the host's pause then
 * has to stop the race for everyone, because they have no screen of their own
 * to carry on watching.
 */
export function sharesHostScreen(lobby: LobbyState): boolean {
  return lobby.players.some((player) => player.device !== lobby.host && player.screen === lobby.host);
}

/**
 * Two friends who both kept the default name (or both typed "Sam") would be
 * one name on the results and the split screen: the later one is "Sam 2".
 * `taken` holds the names (lower case) already in the room.
 */
function tellApart(name: string, taken: ReadonlySet<string>): string {
  if (!taken.has(name.toLowerCase())) return name;
  for (let n = 2; n <= MAX_PLAYERS + 1; n++) {
    const suffix = ` ${n}`;
    const tried = `${name.slice(0, 16 - suffix.length).trimEnd()}${suffix}`;
    if (!taken.has(tried.toLowerCase())) return tried;
  }
  return name;
}

export class Roster {
  private slots: (LobbyPlayer | null)[] = Array.from({ length: MAX_PLAYERS }, () => null);
  /** What each player asked for (their `screen`), before "auto" is settled by the host's display setting. */
  private wants: ("here" | "host" | "auto")[] = Array.from({ length: MAX_PLAYERS }, () => "here");
  private display: LobbySettings["display"] = "own";

  constructor(private hostDevice: string) {}

  get count(): number {
    return this.slots.filter(Boolean).length;
  }

  get free(): number {
    return MAX_PLAYERS - this.count;
  }

  /** The slots `device` holds, lowest first. */
  slotsOf(device: string): number[] {
    const out: number[] = [];
    this.slots.forEach((player, slot) => {
      if (player?.device === device) out.push(slot);
    });
    return out;
  }

  deviceOfSlot(slot: number): string | null {
    return this.slots[slot]?.device ?? null;
  }

  /** Gives `device` a seat for `n` players, or none at all if there are not enough. */
  reserve(device: string, n: number): boolean {
    if (this.free < n) return false;
    this.set(device, Array.from({ length: n }, () => ({ name: "", control: "keyboard" as const, screen: "auto" as const })));
    return true;
  }

  /** Where "auto" players are shown from now on: the host's `display` setting. */
  setDisplay(display: LobbySettings["display"]): void {
    if (display === this.display) return;
    this.display = display;
    this.slots.forEach((player, slot) => {
      if (player) this.slots[slot] = { ...player, screen: this.screenFor(player.device, this.wants[slot]!) };
    });
  }

  private screenFor(device: string, want: "here" | "host" | "auto"): string {
    // The host's own players are on the host's screen whatever they asked.
    if (device === this.hostDevice) return device;
    const host = want === "auto" ? this.display === "host" : want === "host";
    return host ? this.hostDevice : device;
  }

  /**
   * Makes `device`'s players exactly `wanted`: new seats from the lowest free
   * slot, surplus seats (the highest) given up, the names, controls and
   * screens filled in. If the room cannot seat them all the last are left
   * out. Readiness is kept for those who stay. The players come back in this
   * order, lowest slot first: the Nth of `wanted` holds the Nth of the
   * device's slots.
   */
  set(device: string, wanted: readonly WirePlayer[]): void {
    const mine = this.slotsOf(device);
    while (mine.length > wanted.length) {
      const slot = mine.pop()!;
      this.slots[slot] = null;
    }
    while (mine.length < wanted.length) {
      const slot = this.slots.findIndex((p) => p === null);
      if (slot < 0) break;
      this.slots[slot] = { slot, name: "", colour: PLAYER_COLOURS[slot]!, device, screen: device, control: "keyboard", ready: false };
      mine.push(slot);
      mine.sort((a, b) => a - b);
    }
    // The names already in the room that are not this device's own to change.
    const taken = new Set(this.slots.filter((p) => p && p.device !== device).map((p) => p!.name.toLowerCase()));
    mine.forEach((slot, i) => {
      const spec = cleanPlayer(wanted[i], `Player ${slot + 1}`);
      const was = this.slots[slot]!;
      this.wants[slot] = spec.screen;
      const name = tellApart(spec.name, taken);
      taken.add(name.toLowerCase());
      this.slots[slot] = {
        slot,
        name,
        colour: PLAYER_COLOURS[slot]!,
        device,
        screen: this.screenFor(device, spec.screen),
        control: spec.control,
        ready: was.ready,
        ...(spec.character ? { character: spec.character } : {}),
        ...(spec.golden ? { golden: true } : {}),
      };
    });
  }

  setReady(device: string, ready: boolean): void {
    for (const slot of this.slotsOf(device)) this.slots[slot] = { ...this.slots[slot]!, ready };
  }

  /** Whose hands are gone (in the order of the device's slots). True when something changed. */
  setLost(device: string, lost: readonly boolean[]): boolean {
    let changed = false;
    this.slotsOf(device).forEach((slot, i) => {
      const was = this.slots[slot]!;
      const now = lost[i] === true;
      if ((was.handsLost === true) === now) return;
      this.slots[slot] = { ...was, handsLost: now };
      changed = true;
    });
    return changed;
  }

  /** Nobody's hands are gone (a race is over or about to begin). True when something changed. */
  clearLost(): boolean {
    let changed = false;
    this.slots.forEach((player, slot) => {
      if (!player?.handsLost) return;
      this.slots[slot] = { ...player, handsLost: false };
      changed = true;
    });
    return changed;
  }

  /** Takes `device` out of the room; returns the slots it held. */
  remove(device: string): number[] {
    const held = this.slotsOf(device);
    for (const slot of held) this.slots[slot] = null;
    return held;
  }

  /** The players in slot order (copies, so a lobby handed out never changes under its reader). */
  players(): LobbyPlayer[] {
    return this.slots.filter((p): p is LobbyPlayer => p !== null).map((p) => ({ ...p }));
  }
}
