/**
 * Questions the screens ask of the room (`LobbyState`), answered in one place
 * so the lobby, the race and the results agree: who is on this device, which
 * kart is theirs, who is the host, whether the race may start, how the
 * standings read.
 */
import type { LobbyPlayer, LobbyState, RaceResult, RacerSetup } from "../contract";
import { BOT_COLOURS, MAX_PLAYERS, PLAYER_COLOURS } from "../contract";
import { ordinal } from "./format";

/**
 * The players this device brought, by slot. They appear in the lobby in the
 * order the screens gave them to `setLocalPlayers`, so the Nth of these is
 * the Nth of the device's controls.
 */
export function localPlayers(lobby: LobbyState, device: string): LobbyPlayer[] {
  return lobby.players.filter((player) => player.device === device).sort((a, b) => a.slot - b.slot);
}

/**
 * The colours the room will give the players this device is about to bring
 * (`count` of them): the lowest slots nobody on another device has, in order,
 * as the room hands them out. A guess for the driver screen, which shows
 * each player's kart in its colour before the room has been told who they are.
 */
export function previewColours(players: readonly Pick<LobbyPlayer, "slot" | "device">[], device: string, count: number): string[] {
  const taken = new Set(players.filter((player) => player.device !== device).map((player) => player.slot));
  const free: number[] = [];
  for (let slot = 0; slot < MAX_PLAYERS; slot++) if (!taken.has(slot)) free.push(slot);
  return Array.from({ length: count }, (_, i) => PLAYER_COLOURS[(free[i] ?? i) % PLAYER_COLOURS.length]!);
}

/** The kart a lobby slot is driving in the race being run, or null (not in it). */
export function kartOf(lobby: LobbyState, slot: number): number | null {
  for (const [kart, owner] of Object.entries(lobby.karts)) if (owner === slot) return Number(kart);
  return null;
}

/** The name the lobby calls the host by: their first player's, else "the host". */
export function hostName(lobby: LobbyState): string {
  return lobby.players.find((player) => player.device === lobby.host)?.name ?? "the host";
}

/** Everyone is ready, and there is someone to race: the host's Start may be pressed. */
export function canStart(lobby: LobbyState): boolean {
  return lobby.players.length > 0 && lobby.players.every((player) => player.ready);
}

/**
 * What the host's Start says while it cannot be pressed: who is still getting
 * ready ("Waiting for Sam to get ready."), or nothing once all are.
 */
export function waitingLine(lobby: LobbyState): string {
  const names = lobby.players.filter((player) => !player.ready).map((player) => player.name);
  if (!names.length) return "";
  return names.length <= 2 ? `Waiting for ${names.join(" and ")} to get ready.` : `Waiting for ${names.length} players to get ready.`;
}

/**
 * Where a player's race is shown, as the viewer reads it: "Big screen" when
 * it is not on the player's own device (it is on the host's, with everyone
 * else who chose it), otherwise "This screen" for the viewer's own device
 * and "Their screen" for another's.
 */
export function screenLabel(player: LobbyPlayer, device: string): string {
  if (player.screen !== player.device) return "Big screen";
  return player.device === device ? "This screen" : "Their screen";
}

/**
 * True when this device shows a race: some player's `screen` is it (its own
 * players', or the host's big screen for those who chose it). A phone that
 * is only a wheel does not. Unlike `Session.views()`, it holds outside a
 * race too (the podium asks it).
 */
export function showsRace(lobby: LobbyState, device: string): boolean {
  return lobby.players.some((player) => player.screen === device);
}

/** One line of the standings, ready to draw. */
export interface StandingRow {
  kart: number;
  place: number;
  /** "1st" */
  placeLabel: string;
  name: string;
  colour: string;
  /** A player on this device. */
  mine: boolean;
  bot: boolean;
  time: number | null;
  bestLap: number | null;
  /** The quickest lap of the race (gold). */
  fastest: boolean;
}

/**
 * The results, with names and colours. The standings say whose they are; a
 * result that does not is read against the race's grid (`racers`), then the
 * lobby (a player), and a bot nobody knows is "Racer N", so a row is never blank.
 */
export function standingRows(result: RaceResult, racers: readonly RacerSetup[], lobby: LobbyState, device: string): StandingRow[] {
  const mineSlots = new Set(localPlayers(lobby, device).map((player) => player.slot));
  const best = result.standings.reduce<number | null>(
    (fastest, row) => (row.bestLap !== null && (fastest === null || row.bestLap < fastest) ? row.bestLap : fastest),
    null,
  );
  return result.standings.map((row) => {
    const racer = racers.find((candidate) => candidate.id === row.kart);
    const slot = lobby.karts[row.kart] ?? racer?.player ?? null;
    const player = slot === null ? undefined : lobby.players.find((candidate) => candidate.slot === slot);
    return {
      kart: row.kart,
      place: row.place,
      placeLabel: ordinal(row.place),
      // The standings carry their own names and colours; the grid and the lobby are for results from a sim that does not.
      name: row.name ?? racer?.name ?? player?.name ?? `Racer ${row.kart + 1}`,
      colour: row.colour ?? racer?.colour ?? player?.colour ?? BOT_COLOURS[row.kart % BOT_COLOURS.length]!,
      mine: slot !== null && mineSlots.has(slot),
      bot: slot === null,
      time: row.time,
      bestLap: row.bestLap,
      fastest: best !== null && row.bestLap === best,
    };
  });
}
