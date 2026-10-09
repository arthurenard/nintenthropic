/**
 * The start screen: Grip Prix's title over its key art, and three ways in -
 * open a race of your own, join a friend's with its four-letter code, or
 * practise alone. The code field turns whatever is typed (or pasted) into
 * capitals, letters only, four at most.
 *
 * The key art (assets/kart/title.webp) is fetched after the page is up, and
 * not at all by a phone that came with a link to join (it is on its way to a
 * room, and the art is the heaviest thing here); until it is drawn, or where
 * it never comes, the page's own meadow and road are the picture.
 */
import { $, replay, toast } from "../../ui/dom";
import { enterKonami } from "../unlocks";
import { KonamiDetector, konamiKey, padPresses, type KonamiKey } from "./eggs";
import { isCode, normaliseCode } from "./format";

export interface StartHooks {
  host(): void;
  join(code: string): void;
  practice(): void;
  /** The Konami code was entered here; `first` when it is the first time on this device. */
  konami?(first: boolean): void;
}

export type StartChoice = "host" | "join" | "practice";

/** The key art: 2560 x 1440, the action on the right and the left calm. */
export const TITLE_ART = "assets/kart/title.webp";

/** A button's words: the span inside it when it has an icon beside them. */
const label = (button: HTMLElement, text: string) => {
  const span = button.querySelector("span");
  (span ?? button).textContent = text;
};

export interface StartOptions {
  /** Fetch the key art. False for a phone arriving with a link to join. */
  art?: boolean;
}

export class StartScreen {
  private readonly host = $<HTMLButtonElement>("start-host");
  private readonly practice = $<HTMLButtonElement>("start-practice");
  private readonly go = $<HTMLButtonElement>("join-go");
  private readonly field = $<HTMLInputElement>("join-code");
  private busy = false;
  private readonly code = new KonamiDetector();
  private readonly padDown = new Set<KonamiKey>();

  constructor(hooks: StartHooks, options: StartOptions = {}) {
    if (options.art !== false) this.drawArt();
    this.host.addEventListener("click", () => hooks.host());
    this.practice.addEventListener("click", () => hooks.practice());
    this.field.addEventListener("input", () => {
      // Setting the value moves the caret to the end; only do so when the text changed.
      const clean = normaliseCode(this.field.value);
      if (clean !== this.field.value) this.field.value = clean;
      this.sync();
    });
    $("join-form").addEventListener("submit", (event) => {
      event.preventDefault();
      if (!this.busy && isCode(this.field.value)) hooks.join(this.field.value);
    });
    this.watchForTheCode(hooks);
  }

  /** The key art, once the page has had its first paint and the browser has a moment: it fades in over the drawn meadow. */
  private drawArt(): void {
    const image = $<HTMLImageElement>("start-art");
    const fetch = () => {
      image.addEventListener("load", () => {
        image.hidden = false;
        // A frame shown at no opacity first lets the fade run.
        requestAnimationFrame(() => image.classList.add("ready"));
      });
      image.addEventListener("error", () => image.remove());
      image.src = TITLE_ART;
    };
    if (typeof requestIdleCallback === "function") requestIdleCallback(fetch, { timeout: 1500 });
    else window.setTimeout(fetch, 300);
  }

  // --- the Konami code -----------------------------------------------------------------------------------

  /** Up, up, down, down, left, right, left, right, B, A on the keys, or on a gamepad, anywhere on this screen. */
  private watchForTheCode(hooks: StartHooks): void {
    const screen = $("screen-start");
    const entered = () => {
      const first = enterKonami();
      replay($("gold-flash"), "go");
      toast(first ? "Golden Kart unlocked — and a secret track." : "The Golden Kart is already yours.", { icon: "check", tone: "gold" });
      hooks.konami?.(first);
    };
    window.addEventListener("keydown", (event) => {
      if (screen.hidden || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      // Typing a race code is not entering a cheat; nor is anything over a sheet.
      if ((target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) || document.querySelector("dialog[open]")) {
        this.code.reset();
        return;
      }
      if (this.code.press(konamiKey(event.code))) entered();
    });
    if (typeof navigator === "undefined" || typeof navigator.getGamepads !== "function") return;
    window.setInterval(() => {
      if (screen.hidden || document.hidden) return;
      const pad = navigator.getGamepads().find((candidate) => candidate?.connected);
      for (const key of padPresses(pad, this.padDown)) if (this.code.press(key)) entered();
    }, 50);
  }

  /** Fills the code field (a link's ?join=, or a code that was not found, to correct). */
  setCode(code: string): void {
    this.field.value = normaliseCode(code);
    this.sync();
  }

  focusCode(): void {
    this.field.focus({ preventScroll: true });
    this.field.select();
  }

  /** While a room is being opened or joined: nothing else can be pressed, and the button says what is happening. */
  setBusy(choice: StartChoice | null): void {
    this.busy = choice !== null;
    this.host.disabled = this.practice.disabled = this.field.disabled = this.busy;
    label(this.host, choice === "host" ? "Opening…" : "Host a Race");
    this.go.textContent = choice === "join" ? "Joining…" : "Join a Race";
    this.sync();
  }

  private sync(): void {
    this.go.disabled = this.busy || !isCode(this.field.value);
  }
}
