/**
 * The names the rest of Grip Prix uses for sound: which music to play, and the
 * few sounds outside the race's own events that a screen may ask for.
 */
import type { TrackDef } from "../contract";
import type { PieceId } from "./music/pieces";

/** A track's theme: which world it is set in. */
export type TrackTheme = TrackDef["theme"];

/**
 * What the music can be. A track's theme plays that track's tune (and its
 * faster final-lap version, which the race switches to by itself); "race"
 * means the theme loaded with ``load``. "menu" and "lobby" share a tune.
 */
export type MusicKind = TrackTheme | "race" | "menu" | "lobby" | "results" | "results-win" | "podium";

/** The piece that plays for a kind (a theme's own tune; "lobby" is the menu's). */
export function pieceFor(kind: MusicKind, loaded: TrackTheme | null): PieceId | null {
  switch (kind) {
    case "race":
      return loaded;
    case "lobby":
      return "menu";
    default:
      return kind;
  }
}

/** Sounds a screen may ask for by name with ``RaceAudio.play``. */
export type KartSound =
  | "ui-select"
  | "ui-back"
  | "ui-ready"
  | "ui-join"
  | "ui-leave"
  | "ui-start"
  /** The rubber duck every game hides. */
  | "duck"
  /** A two-tone horn. */
  | "horn"
  /** The lap chime, the fanfares, for a screen that wants them. */
  | "lap"
  | "final-lap"
  | "finish-win"
  | "finish-ok"
  | "cheer"
  /** The results' applause. */
  | "applause"
  /** The photo finish's camera. */
  | "shutter"
  /** The Konami code: the gold sting, the same as the arcade's (a core cue, loaded with the engine). */
  | "gold";

export const SOUND_CUES: Record<KartSound, string> = {
  "ui-select": "kart_ui_select",
  "ui-back": "kart_ui_back",
  "ui-ready": "kart_ui_ready",
  "ui-join": "kart_ui_join",
  "ui-leave": "kart_ui_leave",
  "ui-start": "kart_ui_start",
  duck: "kart_duck",
  horn: "kart_horn",
  lap: "kart_lap",
  "final-lap": "kart_final_lap",
  "finish-win": "kart_finish_win",
  "finish-ok": "kart_finish_ok",
  cheer: "kart_cheer",
  applause: "kart_applause",
  shutter: "kart_shutter",
  gold: "ui_gold",
};
