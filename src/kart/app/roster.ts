/**
 * Questions the screens ask of the room (`LobbyState`), answered in one place
 * so the lobby, the race and the results agree: who is on this device, which
 * kart is theirs, who is the host, whether the race may start, how the
 * standings read.
 */
import type { LobbyPlayer, LobbyState, RaceResult, RacerSetup } from "../contract";
import { BOT_COLOURS } from "../contract";
import { ordinal } from "./format";

/**
 * The players this device brought, by slot. They appear in the lobby in the
 * order the screens gave them to `setLocalPlayers`, so the Nth of these is
 * the Nth of the device's controls.
 */
export function localPlayers(lobby: LobbyState, device: string): LobbyPlayer[] {
  return lobby.players.filter((player) => player.device === device).sort((a, b) => a.slot - b.slot);
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

/** How many players are not ready yet. */
export const waitingOn = (lobby: LobbyState): number => lobby.players.filter((player) => !player.ready).length;

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
 * The results, with names and colours. The karts' names come from the race's
 * grid (`racers`) when it is known; a kart not in it is named from the lobby
 * (a player) or "Racer N" (a bot) so a row is never blank.
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
      name: racer?.name ?? player?.name ?? `Racer ${row.kart + 1}`,
      colour: racer?.colour ?? player?.colour ?? BOT_COLOURS[row.kart % BOT_COLOURS.length]!,
      mine: slot !== null && mineSlots.has(slot),
      bot: slot === null,
      time: row.time,
      bestLap: row.bestLap,
      fastest: best !== null && row.bestLap === best,
    };
  });
}
