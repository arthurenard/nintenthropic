/**
 * Driving with the keyboard (testing, and anyone who cannot or would rather
 * not hold their hands up):
 *
 *   Left / Right or A / D   steer
 *   Up or W                 throttle
 *   Down or S               brake, and back up if held
 *   Space                   drift, held (in the air: a trick)
 *   Left, Right, Left fast  a shake (in the air: a trick)
 *   E or Shift              use the item
 *   H                       honk
 *   C / V                   cheer / wave, held
 *
 * Steering is eased: the wheel turns to the key over about a quarter of a
 * second and comes back faster, so a tap is a nudge and a hold is a turn.
 * Jumping straight to full lock (what the key says) would make the kart
 * twitch like a mouse click.
 */
import type { DriveInput, DriverControl } from "../contract";
import { ShakeCounter } from "./shake";

const LEFT = ["ArrowLeft", "KeyA"];
const RIGHT = ["ArrowRight", "KeyD"];
const THROTTLE = ["ArrowUp", "KeyW"];
const BRAKE = ["ArrowDown", "KeyS"];
const DRIFT = ["Space"];
const ITEM = ["KeyE", "ShiftLeft", "ShiftRight"];
const HORN = ["KeyH"];
const CHEER = ["KeyC"];
const WAVE = ["KeyV"];
/** Keys the page would otherwise scroll with. On a focused button they are left alone, so Space still presses it. */
const SCROLLS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Space"]);

/** Full lock per second while a key is held, and coming back to the centre. */
const TURN_RATE = 3.5;
const RETURN_RATE = 6;
/** A gap in sampling longer than this (a hidden tab) is not a time to turn through, seconds. */
const LONGEST_STEP = 0.1;

const all = [...LEFT, ...RIGHT, ...THROTTLE, ...BRAKE, ...DRIFT, ...ITEM, ...HORN, ...CHEER, ...WAVE];

/** Typing in a field is not driving. */
function typing(target: EventTarget | null): boolean {
  const element = target as { tagName?: string; isContentEditable?: boolean } | null;
  const tag = element?.tagName?.toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || element?.isContentEditable === true;
}

export function keyboardControl(target: EventTarget = window): DriverControl {
  const down = new Set<string>();
  let steer = 0;
  let last: number | null = null;
  let presses = 0;
  let horns = 0;
  // From one arrow to the other and back: the keys' -1, 0, 1 must go all the way across.
  const shaker = new ShakeCounter(1.5);

  const held = (keys: readonly string[]) => keys.some((key) => down.has(key));

  const onKeyDown = (event: Event) => {
    const { code, target: from } = event as KeyboardEvent;
    if (!all.includes(code) || typing(from)) return;
    if (SCROLLS.has(code) && (from as { tagName?: string } | null)?.tagName?.toUpperCase() !== "BUTTON") event.preventDefault();
    // Counted on the press, not on the key repeating while it is held (nor twice when E and Shift go down together).
    if (ITEM.includes(code) && !held(ITEM)) presses++;
    if (HORN.includes(code) && !down.has(code)) horns++;
    down.add(code);
  };
  const onKeyUp = (event: Event) => {
    down.delete((event as KeyboardEvent).code);
  };
  // A key released while the window was elsewhere never says so.
  const onBlur = () => down.clear();

  target.addEventListener("keydown", onKeyDown);
  target.addEventListener("keyup", onKeyUp);
  target.addEventListener("blur", onBlur);
  const global = globalThis as { addEventListener?: (type: string, listener: () => void) => void; removeEventListener?: (type: string, listener: () => void) => void };
  if (target !== (globalThis as unknown)) global.addEventListener?.("blur", onBlur);

  return {
    kind: "keyboard",
    wheel: null,
    sample(now: number): DriveInput {
      const seconds = last === null ? 0 : Math.min(LONGEST_STEP, Math.max(0, (now - last) / 1000));
      last = now;
      const goal = (held(RIGHT) ? 1 : 0) - (held(LEFT) ? 1 : 0);
      shaker.push(now / 1000, goal);
      // Toward a key at the turning rate; toward the centre, or across it to the other key, at the faster one.
      const rate = goal !== 0 && Math.sign(goal) === Math.sign(steer || goal) ? TURN_RATE : RETURN_RATE;
      const step = rate * seconds;
      steer = Math.abs(goal - steer) <= step ? goal : steer + Math.sign(goal - steer) * step;
      const braking = held(BRAKE);
      return {
        steer,
        throttle: held(THROTTLE) && !braking ? 1 : 0,
        brake: braking ? 1 : 0,
        drift: held(DRIFT),
        itemPresses: presses,
        horn: horns,
        shakes: shaker.count,
        emote: held(CHEER) ? "cheer" : held(WAVE) ? "wave" : null,
      };
    },
    dispose() {
      target.removeEventListener("keydown", onKeyDown);
      target.removeEventListener("keyup", onKeyUp);
      target.removeEventListener("blur", onBlur);
      global.removeEventListener?.("blur", onBlur);
      down.clear();
    },
  };
}
