import type { Cover, Role } from "./types";

/** What landed the hit that felled the player, as the match saw it. */
export interface Felled {
  source: "bullet" | "dynamite";
  /** Who fired or threw it, if known. */
  role: Role | null;
  /** Where he was when he fired or threw. */
  cover: Cover | null;
  /** The late-wave pressure at that moment, 0 (none) to 1 (the gang at its boldest). */
  pressure: number;
}

/** Past this much pressure, the length of the wave is what did it. */
export const LATE_PRESSURE = 0.5;

/** A place in the town as a player would say it: "behind" + "the wagon". */
export interface Place {
  at: "at" | "behind" | "in" | "on";
  name: string;
}

/** The real Dust Creek's covers, by id, as you would point them out. */
const PLACES: Readonly<Record<string, Place>> = {
  "saloon.door": { at: "at", name: "the saloon doors" },
  "saloon.balcony_door": { at: "on", name: "the saloon balcony" },
  "saloon.balcony_near": { at: "on", name: "the saloon balcony" },
  "saloon.balcony_far": { at: "on", name: "the saloon balcony" },
  "saloon.roof": { at: "on", name: "the saloon roof" },
  "saloon.alley": { at: "in", name: "the alley by the saloon" },
  "barber.door": { at: "at", name: "the barber’s door" },
  "livery.door": { at: "at", name: "the livery door" },
  "livery.loft": { at: "in", name: "the livery loft" },
  "street.wagon": { at: "behind", name: "the wagon" },
  "street.wagon_end": { at: "behind", name: "the wagon" },
  "sheriff.door": { at: "at", name: "the sheriff’s door" },
  "sheriff.crates": { at: "behind", name: "the crates by the sheriff’s" },
  "hotel.door": { at: "at", name: "the hotel door" },
  "hotel.window_up_1": { at: "in", name: "a hotel window" },
  "hotel.window_up_2": { at: "in", name: "a hotel window" },
  "hotel.window_up_3": { at: "in", name: "a hotel window" },
  "hotel.alley": { at: "in", name: "the alley by the hotel" },
  "undertaker.door": { at: "at", name: "the undertaker’s door" },
  "street.crates_right": { at: "behind", name: "the crates" },
  "street.pump": { at: "behind", name: "the pump" },
  "street.cart": { at: "behind", name: "the cart" },
  "street.barrels_right": { at: "behind", name: "the barrels" },
  "street.freight": { at: "behind", name: "the freight" },
  "street.duel": { at: "in", name: "the street" },
  "church.tower": { at: "in", name: "the church tower" },
  "street.far_barrels": { at: "behind", name: "the barrels at the far end" },
  blacksmith: { at: "at", name: "the blacksmith’s corner" },
};

/** Buildings a cover's id may start with, as they go before a noun. */
const BUILDINGS: Readonly<Record<string, string>> = {
  saloon: "saloon",
  barber: "barber’s",
  livery: "livery",
  sheriff: "sheriff’s",
  hotel: "hotel",
  undertaker: "undertaker’s",
  church: "church",
  bank: "bank",
  store: "store",
  blacksmith: "blacksmith’s",
};

/**
 * Where a cover is, in words. The real town's covers are named one by one;
 * any other (the placeholder town, a new cover) by its kind and building.
 */
export function placeOf(cover: Cover): Place {
  const known = PLACES[cover.id];
  if (known) return known;
  const building = BUILDINGS[cover.id.toLowerCase().split(/[._]/)[0] ?? ""];
  const of = (noun: string, otherwise: string) => (building ? `the ${building} ${noun}` : otherwise);
  switch (cover.kind) {
    case "door":
      return { at: "at", name: of("door", "a doorway") };
    case "window":
      return { at: "in", name: building ? `a ${building} window` : "a window" };
    case "roof":
      return cover.level >= 2 ? { at: "on", name: of("roof", "a rooftop") } : { at: "on", name: of("balcony", "a balcony") };
    case "tower":
      return { at: "in", name: of("tower", "the bell tower") };
    case "corner":
      return { at: "at", name: of("corner", "a corner") };
    case "barrel":
      return { at: "behind", name: "the barrels" };
    case "crate":
      return { at: "behind", name: "the crates" };
    case "wagon":
      return { at: "behind", name: "the wagon" };
  }
}

function who(role: Role | null): string {
  switch (role) {
    case "boss":
      return "Black Jack Carver";
    case "rifleman":
      return "a rifleman";
    case "duelist":
      return "the duelist";
    default:
      return "a bandit";
  }
}

/**
 * Who felled the player, and where he stood, for the tombstone: "a rifleman
 * on the saloon roof", "dynamite", "Black Jack Carver at the livery door".
 */
export function felledBy(f: Felled): string {
  if (f.source === "dynamite") return "dynamite";
  const place = f.cover ? placeOf(f.cover) : null;
  return place ? `${who(f.role)} ${place.at} ${place.name}` : who(f.role);
}

/** The one thing that would help most next time, matched to what did it. */
export function advice(f: Felled): string {
  if (f.source === "dynamite") return "Shoot it in the air, before it lands.";
  if (f.pressure >= LATE_PRESSURE) return "The longer a wave lasts, the bolder they get.";
  switch (f.role) {
    case "rifleman":
      return "Riflemen aim longer from up high, so there’s time to look up.";
    case "boss":
      return "One shot to the head brings him down.";
    case "duelist":
      return "Draw the moment the bell tolls.";
    default:
      return "Watch for the glint: it means he’s about to fire.";
  }
}

/** What landed the last hit, as a sentence: "A rifleman on the saloon roof." The fall card's line, and the results note's first words. */
export function felledCause(f: Felled): string {
  if (f.source === "dynamite") {
    const place = f.cover ? placeOf(f.cover) : null;
    return place ? `Dynamite from ${place.at === "behind" ? "behind " : ""}${place.name}.` : "Dynamite.";
  }
  const by = felledBy(f);
  return `${by.charAt(0).toUpperCase()}${by.slice(1)}.`;
}

/**
 * The results card's line under the outcome: what landed the last hit, then
 * what would help. "A rifleman on the saloon roof. Riflemen aim longer from
 * up high, so there’s time to look up."
 */
export function felledNote(f: Felled): string {
  return `${felledCause(f)} ${advice(f)}`;
}
