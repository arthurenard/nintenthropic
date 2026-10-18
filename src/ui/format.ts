/** Numbers and words as the design language writes them (DESIGN.md, Voice). */

/** Scores group thousands: 1,240. */
export function formatScore(value: number): string {
  return Math.round(value || 0).toLocaleString("en-US");
}

/** Times read 0:48. */
export function formatTime(seconds: number): string {
  const whole = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

const SMALL_WORDS = new Set(["a", "an", "and", "as", "at", "for", "in", "of", "on", "the", "to"]);

/** Title Case for titles and buttons: "Choose a Game", "Dead of Night". */
export function titleCase(text: string): string {
  return text
    .toLowerCase()
    .split(" ")
    .map((word, i) => (i && SMALL_WORDS.has(word) ? word : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(" ");
}

/** A file name for a game's share card: super-claude-bros-high-noon.png. */
export function shareFileName(title: string): string {
  return `super-claude-bros-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}.png`;
}
