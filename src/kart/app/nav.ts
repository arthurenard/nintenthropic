/**
 * Moving about a menu with a gamepad: the d-pad or the left stick to move,
 * A to choose, B to go back, Start for the pause sheet. As the Konami code
 * does (eggs.ts), it reads what was newly pressed since the last look, so a
 * held button moves once.
 */

export type NavKey = "left" | "right" | "up" | "down" | "confirm" | "back" | "menu";

/** The standard layout's buttons. */
const BUTTONS: readonly [number, NavKey][] = [
  [14, "left"],
  [15, "right"],
  [12, "up"],
  [13, "down"],
  [0, "confirm"],
  [1, "back"],
  [9, "menu"],
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

/** Where something is on the screen, as getBoundingClientRect has it. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type Direction = "left" | "right" | "up" | "down";

/**
 * The box a press of the d-pad lands on, from `from`: the nearest that way among those that share some of its column (or
 * its row, going sideways), so a stack of buttons is walked in order whatever their widths; only when none does, the
 * nearest off to the side, a step aside costing twice a step ahead. -1 when nothing is that way.
 */
export function nearestBox(from: Box, boxes: readonly Box[], direction: Direction): number {
  const sideways = direction === "left" || direction === "right";
  const middle = (box: Box) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
  /** How far apart two boxes are across the way of the press: 0 when they overlap. */
  const gap = (box: Box) =>
    sideways
      ? Math.max(0, from.y - (box.y + box.height), box.y - (from.y + from.height))
      : Math.max(0, from.x - (box.x + box.width), box.x - (from.x + from.width));
  const here = middle(from);
  let best = -1;
  let bestScore = Infinity;
  boxes.forEach((box, i) => {
    const there = middle(box);
    const dx = there.x - here.x;
    const dy = there.y - here.y;
    const ahead = direction === "right" ? dx : direction === "left" ? -dx : direction === "down" ? dy : -dy;
    // Only what is clearly that way: a neighbour in the same row is not "down" from here.
    if (ahead < 4) return;
    const apart = gap(box);
    const offset = Math.abs(sideways ? dy : dx);
    const score = apart === 0 ? ahead + 0.25 * offset : 100_000 + ahead + 2 * apart;
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}
