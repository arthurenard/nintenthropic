/**
 * How to Drive: one quick screen between the wheel check (or choosing keys or
 * a pad) and the lobby, with every move on a card of its own: steer, go,
 * brake, drift and boost, use an item, honk. A card lights while its move is
 * being made (an item or a honk flashes its card), so the screen is tried as
 * much as read. Continue goes on, and so, for hands, does raising both open
 * hands (the cheer): a player holding the wheel up never has to reach for the
 * mouse.
 *
 * The words are the players' own controls': the hands' gestures, the keys'
 * caps, the pad's buttons. Several players on this device all light the same
 * cards.
 */
import type { ControlKind, DriveInput, DriverControl, WheelStatus } from "../contract";
import { $, element, icon } from "../../ui/dom";
import { focusHeading } from "./ui";

export type MoveId = "steer" | "go" | "brake" | "drift" | "item" | "honk";

export interface Move {
  id: MoveId;
  title: string;
  /** What to do, in a line. */
  line: string;
  /** The keys or buttons, shown as caps (keys and pads); absent for hands, which show `icon`. */
  keys?: readonly string[];
  /** The icon's name in the page's sprite (#i-…), for hands. */
  icon?: string;
}

export interface HowTo {
  title: string;
  lead: string;
  moves: readonly Move[];
  /** The rest, in a line under the cards: the flying start and the trick. */
  more: string;
}

/** Every move, said for what the player drives with. */
export function howToDrive(kind: ControlKind): HowTo {
  switch (kind) {
    case "keyboard":
      return {
        title: "How to Drive",
        lead: "Try each key. Its card lights up.",
        moves: [
          { id: "steer", title: "Steer", keys: ["←", "→"], line: "Or A and D." },
          { id: "go", title: "Go", keys: ["↑"], line: "Or W." },
          { id: "brake", title: "Brake", keys: ["↓"], line: "Hold it to back up." },
          { id: "drift", title: "Drift and Boost", keys: ["Space"], line: "Hold it in a bend to drift. Let go to boost." },
          { id: "item", title: "Use an Item", keys: ["E"], line: "Or Shift." },
          { id: "honk", title: "Honk", keys: ["H"], line: "Honk as you overtake." },
        ],
        more: "Press ↑ just before Go for a flying start. In the air, press Space for a trick.",
      };
    case "gamepad":
      return {
        title: "How to Drive",
        lead: "Try each button. Its card lights up.",
        moves: [
          { id: "steer", title: "Steer", keys: ["Left Stick"], line: "Or the d-pad." },
          { id: "go", title: "Go", keys: ["RT"], line: "The right trigger." },
          { id: "brake", title: "Brake", keys: ["LT"], line: "Hold it to back up." },
          { id: "drift", title: "Drift and Boost", keys: ["A"], line: "Hold it in a bend to drift. Let go to boost." },
          { id: "item", title: "Use an Item", keys: ["B"], line: "Or X." },
          { id: "honk", title: "Honk", keys: ["Y"], line: "Honk as you overtake." },
        ],
        more: "Pull the right trigger just before Go for a flying start. In the air, press A for a trick.",
      };
    case "wheel":
      return {
        title: "How to Drive",
        lead: "Try each move. Its card lights up.",
        moves: [
          { id: "steer", title: "Steer", icon: "wheel", line: "Turn your fists like a wheel." },
          { id: "go", title: "Go", icon: "gauge", line: "Keep your fists closed. The kart goes by itself." },
          { id: "brake", title: "Brake", icon: "brake", line: "Open both hands." },
          { id: "drift", title: "Drift and Boost", icon: "bolt", line: "In a bend, open both hands to drift. Close them to boost." },
          { id: "item", title: "Use an Item", icon: "sparkles", line: "Flick one hand open and shut." },
          { id: "honk", title: "Honk", icon: "speaker", line: "Clap." },
        ],
        more: "Close your fists on the 1 for a flying start. In the air, shake the wheel for a trick.",
      };
  }
}

/** A wheel turned further than this lights Steer (and turns open hands from a brake into a drift). */
export const TURNING = 0.3;

/** The moves being held right now (an item and a honk are moments, counted apart). */
export function heldMoves(kind: ControlKind, input: DriveInput, wheel: WheelStatus | null): Set<MoveId> {
  const on = new Set<MoveId>();
  if (kind === "wheel") {
    if (!wheel || wheel.hands < 2) return on;
    const turning = Math.abs(wheel.steer) > TURNING;
    if (turning) on.add("steer");
    if (wheel.mode === "drive" && wheel.grip === "fists") on.add("go");
    if (wheel.mode === "brake") on.add(turning ? "drift" : "brake");
    return on;
  }
  if (Math.abs(input.steer) > TURNING) on.add("steer");
  if (input.throttle > 0) on.add("go");
  if (input.brake > 0) on.add("brake");
  if (input.drift) on.add("drift");
  return on;
}

/** How long an item's or a honk's card stays lit after it, ms. */
const FLASH = 700;

interface Counts {
  items: number;
  horns: number;
}

export interface HowToHooks {
  done(): void;
  back(): void;
}

export class HowToScreen {
  private controls: readonly DriverControl[] = [];
  private kind: ControlKind = "keyboard";
  private cards = new Map<MoveId, HTMLElement>();
  private counts: Counts[] = [];
  private flashUntil = new Map<MoveId, number>();
  private frame = 0;
  private finished = false;

  constructor(private readonly hooks: HowToHooks) {
    $("howto-back").addEventListener("click", () => {
      this.stop();
      hooks.back();
    });
    $("howto-continue").addEventListener("click", () => this.finish());
  }

  /** Shows the moves for these controls (all of one kind: a device drives with hands, keys or a pad). */
  start(controls: readonly DriverControl[]): void {
    this.stop();
    this.controls = controls;
    this.kind = controls[0]?.kind ?? "keyboard";
    this.finished = false;
    const how = howToDrive(this.kind);
    $("howto-title").textContent = how.title;
    $("howto-lead").textContent = how.lead;
    $("howto-more").textContent = how.more;
    $("howto-cheer").hidden = this.kind !== "wheel";
    this.cards.clear();
    this.flashUntil.clear();
    $("howto-moves").replaceChildren(...how.moves.map((move) => this.card(move)));
    // Counted from here: an item flicked or a honk made before the screen came up does not light a card.
    this.counts = controls.map((control) => {
      const input = control.sample(performance.now());
      return { items: input.itemPresses, horns: input.horn ?? 0 };
    });
    focusHeading($("howto-title"));
    const loop = (now: number) => {
      this.frame = requestAnimationFrame(loop);
      this.tick(now);
    };
    this.frame = requestAnimationFrame(loop);
  }

  stop(): void {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  private card(move: Move): HTMLElement {
    const card = element("li", "move glass");
    card.dataset.move = move.id;
    const glyph = element("span", "move-glyph");
    glyph.setAttribute("aria-hidden", "true");
    if (move.keys) glyph.append(...move.keys.map((key) => element("kbd", key.length > 2 ? "wide" : undefined, key)));
    else if (move.icon) glyph.append(icon(move.icon));
    card.append(glyph, element("span", "move-title", move.title), element("span", "move-line secondary", move.line));
    this.cards.set(move.id, card);
    return card;
  }

  private tick(now: number): void {
    const held = new Set<MoveId>();
    let cheer = false;
    this.controls.forEach((control, i) => {
      const input = control.sample(now);
      for (const move of heldMoves(this.kind, input, control.wheel)) held.add(move);
      const counts = this.counts[i];
      if (counts) {
        if (input.itemPresses > counts.items) this.flash("item", now);
        if ((input.horn ?? 0) > counts.horns) this.flash("honk", now);
        counts.items = input.itemPresses;
        counts.horns = input.horn ?? 0;
      }
      if (this.kind === "wheel" && input.emote === "cheer") cheer = true;
    });
    for (const [move, card] of this.cards) card.classList.toggle("on", held.has(move) || (this.flashUntil.get(move) ?? 0) > now);
    if (cheer) this.finish();
  }

  /** A moment (an item, a honk) lights its card a little while and pops it, each time it comes; a held move only lights it. */
  private flash(move: MoveId, now: number): void {
    this.flashUntil.set(move, now + FLASH);
    const card = this.cards.get(move);
    if (!card) return;
    card.classList.remove("pop");
    // Read the layout so the animation starts again from its beginning.
    void card.offsetWidth;
    card.classList.add("pop");
  }

  private finish(): void {
    if (this.finished) return;
    this.finished = true;
    this.stop();
    this.hooks.done();
  }
}
