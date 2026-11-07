/**
 * Party Rules: a twist card the host deals for a race, or for a whole cup.
 *
 * A card is data only. Each says what changes (a size, a weight class, a share
 * of top speed, how slippery the road is, how the boxes behave...) and the sim
 * and the picture read it where it belongs: physics and items in `sim/`, sizes
 * in `render/`. Nothing here moves by itself, so a card is the same on every
 * device that is given its id, and that id is all that ever crosses the wire.
 *
 * The host's lobby choice (`LobbySettings.rules`) is one of
 *   "normal"   no card,
 *   a card id  that card, every race,
 *   "shuffle"  a card of the host's picking for each race,
 *   "daily"    Today's Card: one card for the whole date, the same for
 *              everyone who picks it on that date (the date is the seed).
 * The host turns the choice into a card (`dealCard`) as each race starts and
 * sends the card's id to the guests.
 */
import type { Weight } from "./characters";
import type { ItemKind } from "./contract";

export type CardId = "tiny" | "bigheads" | "heavy" | "feather" | "ice" | "frenzy" | "pucks" | "turbo" | "reverse";

/** What a card changes. Every number is a multiplier, so 1 is "as usual". */
export interface RuleEffects {
  /** Kart and driver size (the picture's; the sim shrinks the kart's bumping circle to match). */
  size: number;
  /** The driver's head (the picture's). */
  headScale: number;
  /** How quickly the wheel turns the kart. */
  turn: number;
  /** Every kart drives as this weight class instead of its driver's. */
  weight: Weight | null;
  /** On top of the weight class. */
  topSpeed: number;
  acceleration: number;
  grip: number;
  /** Every road is as slippery as ice (the verge keeps its own ground). */
  slippery: boolean;
  /** Seconds before a driven-through item box is back; null for the usual. */
  boxRespawn: number | null;
  /** How much likelier the strongest items are. */
  strongItems: number;
  /** Boxes give only these items (null: any). */
  itemsOnly: readonly ItemKind[] | null;
  /** The grid is turned round: the last place starts on pole. */
  reverseGrid: boolean;
}

export const NO_RULE: Readonly<RuleEffects> = Object.freeze({
  size: 1,
  headScale: 1,
  turn: 1,
  weight: null,
  topSpeed: 1,
  acceleration: 1,
  grip: 1,
  slippery: false,
  boxRespawn: null,
  strongItems: 1,
  itemsOnly: null,
  reverseGrid: false,
});

export interface Card {
  id: CardId;
  /** Title Case, on the picker, the intro and the results. */
  name: string;
  /** One short sentence a player can take in at a glance. */
  line: string;
  /** The page's line icon (race.html's sprite). */
  icon: string;
  effects: Readonly<RuleEffects>;
}

const card = (id: CardId, name: string, line: string, icon: string, effects: Partial<RuleEffects>): Card => ({
  id,
  name,
  line,
  icon,
  effects: Object.freeze({ ...NO_RULE, ...effects }),
});

/** The items that are the strongest: the ones the Item Frenzy deals more of. */
export const STRONG_ITEMS: readonly ItemKind[] = ["nitro3", "seeker", "puck3", "comet", "storm", "skyrocket", "blast"];

export const CARDS: readonly Card[] = [
  card("tiny", "Tiny Karts", "Karts and drivers shrink to 60%, and turn a little quicker.", "bolt", { size: 0.6, turn: 1.12 }),
  card("bigheads", "Big Heads", "Every driver’s head is almost twice its size.", "sparkles", { headScale: 1.8 }),
  card("heavy", "Heavy Day", "Every kart drives like a heavyweight: hard to shove, slow to start.", "weight", { weight: "heavy" }),
  card("feather", "Feather Day", "Every kart drives like a lightweight: quick off the line, easy to shove.", "weight", { weight: "light" }),
  card("ice", "Ice Day", "Every road is as slippery as ice. Ease into the bends.", "wheel", {
    slippery: true,
  }),
  card("frenzy", "Item Frenzy", "Boxes come back at once, and the big items come more often.", "bolt", {
    boxRespawn: 0.5,
    strongItems: 3,
  }),
  card("pucks", "Pucks Only", "Every box gives a puck. Aim well.", "bolt", { itemsOnly: ["puck", "puck3"] }),
  card("turbo", "Turbo Day", "Everything is faster: 15% more top speed and a quicker pick-up.", "gauge", {
    topSpeed: 1.15,
    acceleration: 1.15,
  }),
  card("reverse", "Reverse Grid", "The back of the field starts up front.", "trophy", { reverseGrid: true }),
];

const BY_ID = new Map<string, Card>(CARDS.map((c) => [c.id, c]));

/** A card by id, or undefined for none or an id this build does not know (a newer host's, say). */
export function cardById(id: string | undefined | null): Card | undefined {
  return id ? BY_ID.get(id) : undefined;
}

/** What a card changes; nothing for no card or an unknown one. */
export function effectsOf(id: string | undefined | null): Readonly<RuleEffects> {
  return cardById(id)?.effects ?? NO_RULE;
}

// ─── The host's choice ─────────────────────────────────────────────────────────────────────────────────────────

export const NORMAL = "normal";
export const SHUFFLE = "shuffle";
export const DAILY = "daily";

/** The lobby's choices, in the order the picker lists them: no card, the cards, then the two ways of leaving it to chance. */
export const CHOICES: readonly { id: string; name: string; line: string; icon: string }[] = [
  { id: NORMAL, name: "Normal", line: "No twist. The race as it comes.", icon: "check" },
  ...CARDS.map(({ id, name, line, icon }) => ({ id, name, line, icon })),
  { id: SHUFFLE, name: "Shuffle", line: "A different card for every race.", icon: "restart" },
  { id: DAILY, name: "Today’s Card", line: "One card for the whole day, the same for everyone who plays it today.", icon: "flag" },
];

/** A choice this build knows, or "normal" (a guest's garbage, or a newer host's card, cannot break the room). */
export function cleanChoice(choice: unknown): string {
  return typeof choice === "string" && CHOICES.some((c) => c.id === choice) ? choice : NORMAL;
}

/** Today's date as the daily card's seed: the calendar date in UTC, so the whole world has the same card on the same date. */
export function todayKey(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

/** A well-mixed 32-bit number from text (FNV-1a, then a finaliser, so dates a day apart land far apart). */
export function hashText(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Today's Card for a date ("2026-11-07"): the same on every device, every time. */
export function dailyCard(day: string): CardId {
  return CARDS[hashText(`nintenthropic:${day}`) % CARDS.length]!.id;
}

/**
 * The card for a race, from the host's choice. Shuffle draws from `seed` (the race's own), never the card just
 * played (`last`), so a cup does not repeat itself; Today's Card ignores both and reads `day`. Null: no card.
 */
export function dealCard(choice: string | undefined, seed: number, day: string, last?: string | null): CardId | null {
  const picked = cleanChoice(choice);
  if (picked === NORMAL) return null;
  if (picked === DAILY) return dailyCard(day);
  if (picked === SHUFFLE) {
    const pool = CARDS.filter((c) => c.id !== last);
    return pool[hashText(`shuffle:${seed}`) % pool.length]!.id;
  }
  return cardById(picked)?.id ?? null;
}

/** What the lobby, intro and results call the host's choice: the card's name, or the choice's. */
export function choiceName(choice: string | undefined): string {
  return CHOICES.find((c) => c.id === cleanChoice(choice))?.name ?? "Normal";
}
