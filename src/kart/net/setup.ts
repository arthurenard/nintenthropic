/**
 * From a lobby to a grid: who races, in what order, under what name. Only the
 * host does this; guests are sent the answer.
 */
import {
  BOT_COLOURS,
  MAX_RACERS,
  type LobbyPlayer,
  type LobbySettings,
  type RacerSetup,
  type RaceSetup,
} from "../contract";
import { trackById } from "../track/tracks";
import { seeded } from "./util";

/** Friendly, original names for the bots. Nobody's trademark in here. */
export const BOT_NAMES = [
  "Pebble", "Marmalade", "Zigzag", "Biscuit", "Comet", "Mochi", "Sprocket", "Juno",
  "Waffles", "Tango", "Pip", "Nova", "Rusty", "Clementine", "Bramble", "Skipper",
] as const;

export interface BuiltSetup {
  setup: RaceSetup;
  /** Kart id → the lobby slot that drives it (bots absent). */
  karts: Record<number, number>;
}

/**
 * The grid: bots first, so they start at the front, then the players in slot
 * order behind them; kart ids are the grid positions, 0.. . With bots on, the
 * grid is filled up to `settings.racers` (never fewer than the players, never
 * more than MAX_RACERS); with bots off it is the players alone.
 */
export function buildSetup(players: readonly LobbyPlayer[], settings: LobbySettings, seed: number): BuiltSetup {
  const total = settings.bots ? Math.min(MAX_RACERS, Math.max(settings.racers, players.length)) : players.length;
  const botCount = total - players.length;
  const random = seeded(seed ^ 0x9e3779b9);

  // A shuffle of the names, so the same seed gives the same field everywhere.
  const names = [...BOT_NAMES];
  for (let i = names.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [names[i], names[j]] = [names[j]!, names[i]!];
  }

  const racers: RacerSetup[] = [];
  const karts: Record<number, number> = {};
  for (let i = 0; i < botCount; i++) {
    racers.push({
      id: racers.length,
      name: names[i % names.length]!,
      colour: BOT_COLOURS[i % BOT_COLOURS.length]!,
      player: null,
      // A spread from gentle to sharp, in a shuffled order.
      skill: Math.round((0.35 + 0.6 * ((i * 0.618033988) % 1)) * 100) / 100,
    });
  }
  for (const player of players) {
    const id = racers.length;
    racers.push({ id, name: player.name, colour: player.colour, player: player.slot });
    karts[id] = player.slot;
  }
  return {
    setup: { track: trackById(settings.track), laps: settings.laps, seed, racers },
    karts,
  };
}
