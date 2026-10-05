/**
 * Words and numbers for Grip Prix's screens, as DESIGN.md writes them:
 * short, warm, second person, tabular figures. Pure functions, so the screens
 * stay thin and these can be tested.
 */

/** A room's code is this many letters. */
export const CODE_LENGTH = 4;

/**
 * What a code field holds as it is typed: capitals only, letters only, at
 * most four. Typing "ab1c-d" into it leaves "ABCD".
 */
export function normaliseCode(text: string): string {
  return text.toUpperCase().replace(/[^A-Z]/g, "").slice(0, CODE_LENGTH);
}

/** A whole code: exactly four letters. */
export const isCode = (text: string): boolean => /^[A-Z]{4}$/.test(text);

/** A code for a screen reader, one letter at a time: "A, B, C, D". */
export const spellCode = (code: string): string => code.split("").join(", ");

/**
 * The code a link names (`race.html?join=ABCD`), or null for none or one that
 * is not four letters. A link is typed and pasted by people, so it is cleaned
 * the way the field cleans it.
 */
export function joinParam(search: string): string | null {
  const code = normaliseCode(new URLSearchParams(search).get("join") ?? "");
  return isCode(code) ? code : null;
}

/**
 * The address a guest opens to join a room: this page without its own query
 * or hash, `?join=CODE`, and `net=local` kept when the host is using it (the
 * guest has to speak the host's way of talking).
 */
export function joinUrl(page: string, code: string, net?: string | null): string {
  const url = new URL(page);
  url.search = "";
  url.hash = "";
  url.searchParams.set("join", code);
  if (net) url.searchParams.set("net", net);
  return url.toString();
}

/**
 * A race time as it is read at the finish: minutes, seconds and a tenth,
 * "0:48.3". The tenth is cut, not rounded, so 59.97 never reads "0:60.0".
 * No time (a kart that did not finish) is a dash.
 */
export function raceTime(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return "–";
  const tenths = Math.max(0, Math.floor(seconds * 10 + 1e-6));
  const whole = Math.floor(tenths / 10);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}.${tenths % 10}`;
}

/** "1st", "2nd", "3rd", "4th"... "11th", "21st". */
export function ordinal(place: number): string {
  const n = Math.max(0, Math.round(place));
  const teen = n % 100 >= 11 && n % 100 <= 13;
  const suffix = teen ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${suffix}`;
}

/** "Lap 2/3": the lap being driven, never past the last (a finished kart is on lap laps + 1). */
export function lapLabel(lap: number, laps: number): string {
  return `Lap ${Math.max(1, Math.min(lap, laps))}/${laps}`;
}

/** "1 lap", "3 laps". */
export const lapsLabel = (laps: number): string => `${laps} ${laps === 1 ? "lap" : "laps"}`;

// --- names -----------------------------------------------------------------------------------

/** Friendly, short, and nobody's trademark: a first name for a driver who has not typed one. */
export const DEFAULT_NAMES = [
  "Juno",
  "Pip",
  "Otto",
  "Mika",
  "Ziggy",
  "Poppy",
  "Remy",
  "Tilly",
  "Bram",
  "Nova",
  "Kit",
  "Wren",
  "Orla",
  "Finn",
  "Sunny",
  "Echo",
] as const;

/** The longest name a driver may have: it has to fit in a split-screen corner. */
export const NAME_LENGTH = 14;

/**
 * A name as typed, made fit to show: control characters gone, runs of
 * spaces one space, trimmed, at most NAME_LENGTH letters (whole characters,
 * never half an emoji). Nothing left, the fallback.
 */
export function cleanName(text: string, fallback: string): string {
  const clean = [...text.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim()].slice(0, NAME_LENGTH).join("").trim();
  return clean || fallback;
}

/**
 * A default name that nobody else in the room-to-be has: the next in the
 * list from where `random` (0..1) points, skipping names already `taken`
 * (ignoring case). Always a name, even if every one is taken.
 */
export function defaultName(random: number, taken: readonly string[] = []): string {
  const used = new Set(taken.map((name) => name.toLowerCase()));
  const start = Math.floor(Math.min(0.999999, Math.max(0, random)) * DEFAULT_NAMES.length);
  for (let i = 0; i < DEFAULT_NAMES.length; i++) {
    const name = DEFAULT_NAMES[(start + i) % DEFAULT_NAMES.length]!;
    if (!used.has(name.toLowerCase())) return name;
  }
  return DEFAULT_NAMES[start]!;
}
