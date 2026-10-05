/**
 * Room codes: four letters people can read out over a table or a phone call.
 * I and O are left out of the alphabet so they are never mistaken for 1 and 0
 * (the digits are not used at all, so a typed "0" can be told to be wrong).
 */

export const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ";
export const CODE_LENGTH = 4;

/** A fresh code. `random` is injectable so tests can ask for the same one twice. */
export function makeCode(random: () => number = Math.random): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
  return code;
}

/** What a person typed, as a code (upper case, letters from the alphabet only), or null if it is not one. */
export function parseCode(text: string | null | undefined): string | null {
  const code = (text ?? "").toUpperCase().replace(/[^A-Z]/g, "");
  if (code.length !== CODE_LENGTH) return null;
  for (const letter of code) if (!CODE_ALPHABET.includes(letter)) return null;
  return code;
}

/**
 * The address that joins a room: `race.html?join=CODE` next to the page we
 * are on (or next to `base`, when there is no page, as in tests). It is what
 * the QR code on the host's screen holds.
 */
export function joinUrl(code: string, base?: string): string {
  const here = base ?? (typeof location !== "undefined" ? location.href : "http://localhost/");
  const url = new URL("race.html", here);
  url.search = "";
  url.hash = "";
  url.searchParams.set("join", code);
  return url.toString();
}

/** The code in a page's query string (`?join=CODE`), or null. */
export function joinCodeFrom(search: string): string | null {
  return parseCode(new URLSearchParams(search).get("join"));
}

/** The peer id the host of room `code` registers under at the PeerJS broker. */
export function peerIdFor(code: string): string {
  return `grip-prix-v1-${code}`;
}
