/**
 * Moving about a menu with a gamepad: the d-pad or the left stick to move,
 * A to choose, B to go back. As the Konami code does (eggs.ts), it reads
 * what was newly pressed since the last look, so a held button moves once.
 */

export type NavKey = "left" | "right" | "up" | "down" | "confirm" | "back";

/** The standard layout's buttons. */
const BUTTONS: readonly [number, NavKey][] = [
  [14, "left"],
  [15, "right"],
  [12, "up"],
  [13, "down"],
  [0, "confirm"],
  [1, "back"],
];

/** How far the stick must lean to count as a press. */
const LEAN = 0.6;

/** The presses a pad made since the last look (`was` keeps what was down). */
export function navPresses(pad: Pick<Gamepad, "buttons" | "axes"> | null | undefined, was: Set<NavKey>): NavKey[] {
  const down = new Set<NavKey>();
  if (pad) {
    for (const [index, key] of BUTTONS) if (pad.buttons[index]?.pressed) down.add(key);
    const x = pad.axes[0] ?? 0;
    const y = pad.axes[1] ?? 0;
    if (x <= -LEAN) down.add("left");
    if (x >= LEAN) down.add("right");
    if (y <= -LEAN) down.add("up");
    if (y >= LEAN) down.add("down");
  }
  const pressed = [...down].filter((key) => !was.has(key));
  was.clear();
  for (const key of down) was.add(key);
  return pressed;
}

/** A key on the keyboard as a menu reads it, or null for any other. */
export function navKey(event: Pick<KeyboardEvent, "key">): NavKey | null {
  switch (event.key) {
    case "ArrowLeft":
      return "left";
    case "ArrowRight":
      return "right";
    case "ArrowUp":
      return "up";
    case "ArrowDown":
      return "down";
    case "Enter":
      return "confirm";
    default:
      return null;
  }
}

/** Where a move lands in a grid of `count` things, `columns` across, from `at`: edges stop (nothing wraps off the grid). */
export function moveIn(at: number, key: NavKey, count: number, columns: number): number {
  const delta = key === "left" ? -1 : key === "right" ? 1 : key === "up" ? -columns : key === "down" ? columns : 0;
  if (delta === 0) return at;
  const next = at + delta;
  if (next < 0 || next >= count) return at;
  // A step to the side does not wrap onto another row.
  if (Math.abs(delta) === 1 && Math.floor(next / columns) !== Math.floor(at / columns)) return at;
  return next;
}
