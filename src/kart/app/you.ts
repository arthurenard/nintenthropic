/**
 * The You screen: your name, how you drive, and (with the wheel) up to three
 * friends on the same camera, each with a name. What is chosen is remembered
 * (prefs.ts) and comes back the next time. Who sits in the kart is the next
 * screen's question (driver.ts): one thing at a time.
 */
import { $, setText } from "../../ui/dom";
import { cleanName, defaultName } from "./format";
import type { Drive, You } from "./prefs";
import type { Steering } from "./services";
import { Segmented, focusHeading } from "./ui";

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

/** What sharing the camera asks of the players, by how many there are. */
const SHARING: Record<1 | 2 | 3 | 4, string> = {
  1: "You drive alone, with the whole picture.",
  2: "You share one camera: you drive with the left half of the picture, your friend with the right.",
  3: "You share one camera, standing side by side: the picture is split into three columns, left to right in the order below.",
  4: "You share one camera, standing side by side about an arm's length apart: the picture is split into four columns, left to right in the order below. Stand back far enough to fit.",
};

const WHERE = { host: "Host a Race", join: "Join a Race", practice: "Practice" } as const;

type Count = "1" | "2" | "3" | "4";

export class YouScreen {
  private you!: You;
  /** The names when the screen opened: what a cleared field falls back to. */
  private was = { name: "", mates: ["", "", ""] };
  private readonly name = $<HTMLInputElement>("you-name");
  /** The second, third and fourth players' names. */
  private readonly mates = [$<HTMLInputElement>("you-name2"), $<HTMLInputElement>("you-name3"), $<HTMLInputElement>("you-name4")];
  private readonly proceed = $<HTMLButtonElement>("you-continue");
  private readonly drive: Segmented<Drive>;
  private readonly steering: Segmented<Steering>;
  private readonly players: Segmented<Count>;

  constructor(private readonly hooks: YouHooks) {
    this.drive = new Segmented<Drive>($("pick-drive"), (drive) => {
      this.you.drive = drive;
      this.sync();
    });
    this.steering = new Segmented<Steering>($("pick-steering"), (steering) => {
      this.you.steering = steering;
    });
    this.players = new Segmented<Count>($("pick-players"), (count) => {
      const was = this.you.players;
      this.you.players = Number(count) as You["players"];
      this.sync();
      if (this.you.players > was) this.mates[this.you.players - 2]?.focus({ preventScroll: true });
    });
    $("you-back").addEventListener("click", () => hooks.back());
    this.name.addEventListener("input", () => (this.you.name = this.name.value));
    this.mates.forEach((field, i) => field.addEventListener("input", () => (this.you.mates[i] = { ...this.you.mates[i]!, name: field.value })));
    for (const field of [this.name, ...this.mates]) {
      field.addEventListener("keydown", (event) => {
        if (event.key === "Enter") this.finish();
      });
    }
    this.proceed.addEventListener("click", () => this.finish());
  }

  /** Shows the screen with what was remembered. `where` says which door brought the player here. */
  open(you: You, where: keyof typeof WHERE): void {
    this.you = { ...you, mates: you.mates.map((mate) => ({ ...mate })) };
    this.was = { name: you.name, mates: you.mates.map((mate) => mate.name) };
    setText("you-eyebrow", WHERE[where]);
    this.name.value = you.name;
    this.mates.forEach((field, i) => (field.value = you.mates[i]!.name));
    this.drive.value = you.drive;
    this.steering.value = you.steering;
    this.players.value = String(you.players) as Count;
    this.sync();
    focusHeading($("you-title"));
  }

  /** Shows what the current choice needs: steering and friends on the camera only go with the wheel. */
  private sync(): void {
    const wheel = this.you.drive === "wheel";
    const count = this.you.players;
    $("row-steering").hidden = !wheel;
    $("group-second").hidden = !wheel;
    $("row-second").hidden = !wheel || count < 2;
    $("row-third").hidden = !wheel || count < 3;
    $("row-fourth").hidden = !wheel || count < 4;
    setText("foot-players", SHARING[count]);
    setText("foot-drive", ABOUT[this.you.drive]);
  }

  /** The names as the screen reads them now, cleaned (a cleared field is what it was; friends with one name are told apart). */
  finish(): void {
    const name = cleanName(this.name.value, this.was.name);
    const wheel = this.you.drive === "wheel";
    const count = wheel ? this.you.players : 1;
    // Drivers with the same name could not be told apart on the screen.
    const taken = [name];
    const mates = this.you.mates.map((mate, i) => {
      let mateName = cleanName(this.mates[i]!.value, this.was.mates[i]!);
      if (i < count - 1) {
        if (taken.some((other) => other.toLowerCase() === mateName.toLowerCase())) mateName = defaultName(Math.random(), taken);
        taken.push(mateName);
      }
      this.mates[i]!.value = mateName;
      return { ...mate, name: mateName };
    });
    this.you = { ...this.you, name, mates };
    this.name.value = name;
    this.hooks.next(this.you);
  }
}
