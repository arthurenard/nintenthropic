/**
 * The You screen: your name, how you drive, and (with the wheel) a second
 * player on the same camera. What is chosen is remembered (prefs.ts) and
 * comes back the next time.
 */
import { $, setText } from "../../ui/dom";
import { cleanName, defaultName } from "./format";
import type { Drive, You } from "./prefs";
import type { Steering } from "./services";
import { Segmented, Switch, focusHeading } from "./ui";

export interface YouHooks {
  back(): void;
  next(you: You): void;
}

/** What each way of driving needs to be told, in a line under the choice. */
const ABOUT: Record<Drive, string> = {
  wheel:
    "Hold your fists up like a wheel and turn it. Open your hands to brake. Steering is how far you turn for full lock: Gentle 50°, Normal 40°, Quick 30°.",
  keyboard: "Arrows or WASD to steer, Space to drift, E or Shift for your item.",
  gamepad: "Left stick to steer, the triggers to go and stop, A to drift, B or X for your item.",
};

const WHERE = { host: "Host a Race", join: "Join a Race", practice: "Practice" } as const;

export class YouScreen {
  private you!: You;
  /** The name and the second name when the screen opened: what a cleared field falls back to. */
  private was = { name: "", second: "" };
  private readonly name = $<HTMLInputElement>("you-name");
  private readonly second = $<HTMLInputElement>("you-name2");
  private readonly proceed = $<HTMLButtonElement>("you-continue");
  private readonly drive: Segmented<Drive>;
  private readonly steering: Segmented<Steering>;
  private readonly two: Switch;

  constructor(private readonly hooks: YouHooks) {
    this.drive = new Segmented<Drive>($("pick-drive"), (drive) => {
      this.you.drive = drive;
      this.sync();
    });
    this.steering = new Segmented<Steering>($("pick-steering"), (steering) => {
      this.you.steering = steering;
    });
    this.two = new Switch($<HTMLButtonElement>("switch-second"), (on) => {
      this.you.second = on;
      this.sync();
      if (on) this.second.focus({ preventScroll: true });
    });
    $("you-back").addEventListener("click", () => hooks.back());
    this.name.addEventListener("input", () => (this.you.name = this.name.value));
    this.second.addEventListener("input", () => (this.you.secondName = this.second.value));
    for (const field of [this.name, this.second]) {
      field.addEventListener("keydown", (event) => {
        if (event.key === "Enter") this.finish();
      });
    }
    this.proceed.addEventListener("click", () => this.finish());
  }

  /** Shows the screen with what was remembered. `where` says which door brought the player here. */
  open(you: You, where: keyof typeof WHERE): void {
    this.you = { ...you };
    this.was = { name: you.name, second: you.secondName };
    setText("you-eyebrow", WHERE[where]);
    this.name.value = you.name;
    this.second.value = you.secondName;
    this.drive.value = you.drive;
    this.steering.value = you.steering;
    this.two.on = you.second;
    this.setBusy(false);
    this.sync();
    focusHeading($("you-title"));
  }

  /** The camera is starting: Continue waits. */
  setBusy(busy: boolean): void {
    this.proceed.disabled = busy;
    this.proceed.textContent = busy ? "Starting Camera…" : "Continue";
  }

  /** Shows what the current choice needs: steering and a second player only go with the wheel. */
  private sync(): void {
    const wheel = this.you.drive === "wheel";
    $("row-steering").hidden = !wheel;
    $("group-second").hidden = !wheel;
    $("row-second").hidden = !wheel || !this.you.second;
    setText("foot-drive", ABOUT[this.you.drive]);
  }

  private finish(): void {
    const name = cleanName(this.name.value, this.was.name);
    const wheel = this.you.drive === "wheel";
    // Two drivers with the same name could not be told apart on the screen.
    let secondName = cleanName(this.second.value, this.was.second);
    if (secondName.toLowerCase() === name.toLowerCase()) secondName = defaultName(Math.random(), [name]);
    this.you = { ...this.you, name, secondName, second: wheel && this.you.second };
    this.name.value = name;
    this.second.value = secondName;
    this.hooks.next(this.you);
  }
}
