/**
 * Who is in the room: four slots, each a player on some device. The host owns
 * the roster and everyone else sees copies of it in the lobby.
 *
 * A slot is also a colour (PLAYER_COLOURS[slot]), so a player keeps their
 * colour for as long as they hold the slot, and nobody else gets it.
 */
import { MAX_PLAYERS, PLAYER_COLOURS, type DriverControl, type LobbyPlayer } from "../contract";
import { TRACKS } from "../track/tracks";
import type { LobbySettings, LobbyState } from "../contract";
import { clamp } from "./util";
import type { WirePlayer } from "./protocol";

export const DEFAULT_SETTINGS: LobbySettings = {
  track: TRACKS[0]!.id,
  laps: 3,
  bots: true,
  racers: 6,
};

const CONTROLS: readonly DriverControl["kind"][] = ["wheel", "keyboard", "gamepad"];

/** Settings with a patch applied, every value kept in range (a guest's garbage cannot break the host). */
export function mergeSettings(current: LobbySettings, patch: Partial<LobbySettings>, maxRacers: number): LobbySettings {
  const track = typeof patch.track === "string" && TRACKS.some((t) => t.id === patch.track) ? patch.track : current.track;
  const laps = Number.isFinite(patch.laps) ? clamp(Math.round(patch.laps!), 1, 5) : current.laps;
  const racers = Number.isFinite(patch.racers) ? clamp(Math.round(patch.racers!), 1, maxRacers) : current.racers;
  return { track, laps, racers, bots: typeof patch.bots === "boolean" ? patch.bots : current.bots };
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
    screen: p.screen === "host" ? "host" : "here",
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

export class Roster {
  private slots: (LobbyPlayer | null)[] = Array.from({ length: MAX_PLAYERS }, () => null);

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
    this.set(device, Array.from({ length: n }, () => ({ name: "", control: "keyboard" as const, screen: "here" as const })));
    return true;
  }

  /**
   * Makes `device`'s players exactly `wanted`: new seats from the lowest free
   * slot, surplus seats (the highest) given up, the names, controls and
   * screens filled in. If the room cannot seat them all the last are left
   * out. Readiness is kept for those who stay.
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
    mine.forEach((slot, i) => {
      const spec = cleanPlayer(wanted[i], `Player ${slot + 1}`);
      const was = this.slots[slot]!;
      this.slots[slot] = {
        slot,
        name: spec.name,
        colour: PLAYER_COLOURS[slot]!,
        device,
        screen: spec.screen === "host" ? this.hostDevice : device,
        control: spec.control,
        ready: was.ready,
      };
    });
  }

  setReady(device: string, ready: boolean): void {
    for (const slot of this.slotsOf(device)) this.slots[slot] = { ...this.slots[slot]!, ready };
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
