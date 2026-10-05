/**
 * The start screen: Grip Prix's title over its meadow, and three ways in -
 * open a race of your own, join a friend's with its four-letter code, or
 * practise alone. The code field turns whatever is typed (or pasted) into
 * capitals, letters only, four at most.
 */
import { $ } from "../../ui/dom";
import { isCode, normaliseCode } from "./format";

export interface StartHooks {
  host(): void;
  join(code: string): void;
  practice(): void;
}

export type StartChoice = "host" | "join" | "practice";

export class StartScreen {
  private readonly host = $<HTMLButtonElement>("start-host");
  private readonly practice = $<HTMLButtonElement>("start-practice");
  private readonly go = $<HTMLButtonElement>("join-go");
  private readonly field = $<HTMLInputElement>("join-code");
  private busy = false;

  constructor(hooks: StartHooks) {
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
    this.host.textContent = choice === "host" ? "Opening…" : "Host a Race";
    this.go.textContent = choice === "join" ? "Joining…" : "Join a Race";
    this.sync();
  }

  private sync(): void {
    this.go.disabled = this.busy || !isCode(this.field.value);
  }
}
