/**
 * The menus with a gamepad, for the player on the sofa who has no mouse: the
 * d-pad (or the stick) moves the focus to the nearest thing that way, A presses
 * what has it, B goes back a step where going back loses nothing (the You
 * screen, the wheel check, a sheet), and Start opens and closes the pause
 * sheet. On a slider, left and right move it. The focus ring shows as it does
 * for the keyboard.
 *
 * The driver stage reads the pad itself (driver.ts), and in a race the pad
 * drives: there only Start, and the pause sheet's buttons, listen. The pad is
 * looked at only while one is connected.
 */
import { $ } from "../../ui/dom";
import { nearestBox, navPresses, type Direction, type NavKey } from "./nav";

export interface PadHooks {
  /** The screen showing (app.ts's ScreenName). */
  screen(): string;
  /** Start in a race: the pause sheet. */
  pause(): void;
}

/** Everything the d-pad can land on. Every choice of a segmented control is one (A chooses it), not just the chosen one. */
const TARGETS = 'button:not(:disabled), a[href], input:not(:disabled):not([type="hidden"]), [tabindex="0"]';

/** Where B goes back a step, by screen: only where leaving loses nothing (the lobby's Leave would close a room). */
const BACK: Record<string, string> = { you: "you-back", count: "count-back", check: "check-back", howto: "howto-back" };

/** How often the pad is looked at, ms. */
const POLL_MS = 60;

export class PadMenus {
  private readonly held = new Set<NavKey>();
  private timer = 0;
  /** The press before this one: on the start screen B then A is the end of the Konami code, not a click. */
  private last: NavKey | null = null;

  constructor(private readonly hooks: PadHooks) {
    if (typeof navigator === "undefined" || typeof navigator.getGamepads !== "function") return;
    // A browser tells the page of a pad on its first press; until then there is nothing to look at.
    window.addEventListener("gamepadconnected", () => this.watch());
    window.addEventListener("gamepaddisconnected", () => {
      if (!this.pad()) this.unwatch();
    });
    if (this.pad()) this.watch();
  }

  private pad(): Gamepad | null {
    return navigator.getGamepads().find((candidate): candidate is Gamepad => !!candidate?.connected) ?? null;
  }

  private watch(): void {
    if (this.timer) return;
    this.timer = window.setInterval(() => {
      if (document.hidden) return;
      for (const press of navPresses(this.pad(), this.held)) this.press(press);
    }, POLL_MS);
  }

  private unwatch(): void {
    window.clearInterval(this.timer);
    this.timer = 0;
    this.held.clear();
  }

  private press(key: NavKey): void {
    const last = this.last;
    this.last = key;
    const screen = this.hooks.screen();
    const sheet = document.querySelector<HTMLDialogElement>("dialog[open]");
    if (key === "menu") {
      if (screen !== "race") return;
      const pause = $<HTMLDialogElement>("pause-sheet");
      if (pause.open) pause.close();
      else if (!sheet) {
        this.hooks.pause();
        // The sheet opens on Resume: ringed, as the pad is what will move from it.
        const resume = document.activeElement;
        if (pause.open && resume instanceof HTMLElement) show(resume);
      }
      return;
    }
    // The stage has its own pad, and a race's pad is the wheel: only a sheet over them is ours.
    if (!sheet && (screen === "driver" || screen === "race")) return;
    if (key === "back") return this.back(screen, sheet);
    if (key === "confirm") {
      if (screen === "start" && last === "back" && !sheet) return;
      return this.confirm(sheet ?? $(`screen-${screen}`));
    }
    this.move(key, sheet ?? $(`screen-${screen}`));
  }

  private back(screen: string, sheet: HTMLDialogElement | null): void {
    if (sheet) {
      // A trouble needs an answer; the others are left by closing them (the pause sheet resumes).
      if (sheet.id !== "trouble") sheet.close();
      return;
    }
    const button = BACK[screen];
    if (button) $<HTMLButtonElement>(button).click();
  }

  private confirm(root: HTMLElement): void {
    const focused = this.focused(root);
    if (!focused) return this.focusFirst(root);
    if (focused instanceof HTMLInputElement) {
      // A text field cannot be typed into with a pad; its form (the race code's) can be sent.
      if (focused.type !== "range") focused.form?.requestSubmit();
      return;
    }
    focused.click();
  }

  private move(direction: Direction, root: HTMLElement): void {
    const focused = this.focused(root);
    if (!focused) return this.focusFirst(root);
    if (focused instanceof HTMLInputElement && focused.type === "range" && (direction === "left" || direction === "right")) {
      const step = Number(focused.step) || 1;
      const value = Number(focused.value) + (direction === "right" ? 2 : -2) * step;
      focused.value = String(Math.min(Number(focused.max || 100), Math.max(Number(focused.min || 0), value)));
      focused.dispatchEvent(new Event("input", { bubbles: true }));
      return;
    }
    const targets = this.targets(root).filter((target) => target !== focused);
    const at = nearestBox(focused.getBoundingClientRect(), targets.map((target) => target.getBoundingClientRect()), direction);
    if (at >= 0) show(targets[at]!);
  }

  /** What has the focus, if it is one of the things the pad moves between here. */
  private focused(root: HTMLElement): HTMLElement | null {
    const active = document.activeElement;
    return active instanceof HTMLElement && active.matches(TARGETS) && this.reachable(active, root) ? active : null;
  }

  /** The first press on a screen puts the focus on its main button (or the first thing there is), and does nothing else. */
  private focusFirst(root: HTMLElement): void {
    const targets = this.targets(root);
    const main = targets.find((target) => target.classList.contains("primary")) ?? targets[0];
    if (main) show(main);
  }

  private targets(root: HTMLElement): HTMLElement[] {
    const inside = [...root.querySelectorAll<HTMLElement>(TARGETS)];
    // The speaker in the corner is on every screen but the race, outside them all.
    const sound = document.getElementById("sound-button");
    if (sound && root.tagName !== "DIALOG") inside.push(sound);
    return inside.filter((target) => this.reachable(target, root));
  }

  /** On the screen (or the sheet) and drawn: not inside something hidden, not invisible, not switched off. */
  private reachable(target: HTMLElement, root: HTMLElement): boolean {
    if (!(root.contains(target) || target.id === "sound-button")) return false;
    if (target.getClientRects().length === 0 || target.getAttribute("aria-disabled") === "true") return false;
    return getComputedStyle(target).visibility === "visible";
  }
}

/** Focus, with the ring a keyboard would show (a pad press is not a pointer). */
function show(target: HTMLElement): void {
  target.focus({ focusVisible: true } as FocusOptions);
}
