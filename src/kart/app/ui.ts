/**
 * Small controls and helpers the screens share, in the manner of the
 * arcade's Settings (src/app/settings.ts): segmented controls that are radio
 * groups, switches, a colour dot. The look is settings.css and race.css.
 */
import { element, setText } from "../../ui/dom";

/**
 * A segmented control: buttons with role radio inside a radiogroup. One tab
 * stop (the chosen one), the arrow keys choose, Home and End go to the ends.
 * `--count` and `--index` position its sliding thumb (settings.css).
 */
export class Segmented<T extends string> {
  private radios: HTMLButtonElement[] = [];
  private current: T | null = null;

  constructor(
    private readonly group: HTMLElement,
    private readonly onPick: (value: T) => void,
  ) {
    this.refresh();
    group.addEventListener("keydown", (event) => {
      const at = this.radios.findIndex((radio) => radio.getAttribute("aria-checked") === "true");
      const last = this.radios.length - 1;
      const to = ({ ArrowRight: at + 1, ArrowDown: at + 1, ArrowLeft: at - 1, ArrowUp: at - 1, Home: 0, End: last } as Record<string, number>)[event.key];
      if (to === undefined || this.radios.length === 0) return;
      event.preventDefault();
      this.pick(this.radios[(to + this.radios.length) % this.radios.length]!, true);
    });
  }

  /** Picks up the choices the group has now (a group whose choices are made later, or change). What was chosen stays chosen. */
  refresh(): void {
    this.radios = [...this.group.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
    this.group.style.setProperty("--count", String(this.radios.length));
    for (const radio of this.radios) radio.addEventListener("click", () => this.pick(radio, false));
    if (this.current !== null) this.value = this.current;
  }

  private pick(radio: HTMLButtonElement, focus: boolean): void {
    if (focus) radio.focus();
    if (radio.getAttribute("aria-checked") === "true") return;
    const value = radio.dataset.value as T;
    this.value = value;
    this.onPick(value);
  }

  get value(): T | null {
    return this.current;
  }

  set value(value: T | null) {
    this.current = value;
    this.radios.forEach((radio, i) => {
      const checked = radio.dataset.value === value;
      radio.setAttribute("aria-checked", String(checked));
      radio.tabIndex = checked ? 0 : -1;
      if (checked) this.group.style.setProperty("--index", String(i));
    });
    // Nothing chosen yet: the first is still the one tab stop.
    if (this.radios.length > 0 && !this.radios.some((radio) => radio.tabIndex === 0)) this.radios[0]!.tabIndex = 0;
  }
}

/** An on/off switch: a button with the switch role, labelled by its row. */
export class Switch {
  constructor(
    private readonly button: HTMLButtonElement,
    private readonly onToggle: (on: boolean) => void,
  ) {
    button.addEventListener("click", () => {
      this.on = button.getAttribute("aria-checked") !== "true";
      onToggle(this.on);
    });
  }

  get on(): boolean {
    return this.button.getAttribute("aria-checked") === "true";
  }

  set on(on: boolean) {
    this.button.setAttribute("aria-checked", String(on));
  }

  set disabled(disabled: boolean) {
    this.button.disabled = disabled;
  }
}

/** A player's colour, a small round dot. */
export function colourDot(colour: string): HTMLSpanElement {
  const dot = element("span", "dot");
  dot.style.background = colour;
  dot.setAttribute("aria-hidden", "true");
  return dot;
}

/** A progress bar (the .progress of base.css/screens.css) set to 0..1. */
export function setBar(bar: HTMLElement, fraction: number): void {
  const clamped = Math.max(0, Math.min(1, fraction));
  bar.setAttribute("aria-valuenow", String(Math.round(clamped * 100)));
  (bar.firstElementChild as HTMLElement).style.transform = `scaleX(${clamped})`;
}

/** Moves a screen reader to a screen's heading, without a ring or a scroll. */
export function focusHeading(heading: HTMLElement | null): void {
  heading?.focus({ preventScroll: true });
}

/** A button's label and whether it can be pressed, set only when they changed. */
export function setButton(button: HTMLButtonElement, label: string, disabled = false): void {
  setText(button, label);
  if (button.disabled !== disabled) button.disabled = disabled;
}
