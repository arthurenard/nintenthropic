/**
 * Every piece of Grip Prix's music, by name: a tune for each track's theme,
 * and the screens around the race.
 */
import type { PieceSpec } from "../score";
import { meadow } from "./meadow";

export const PIECES = {
  meadow,
} satisfies Record<string, PieceSpec>;

export type PieceId = keyof typeof PIECES;
