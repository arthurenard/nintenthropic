/**
 * Auto, the You screen's first choice for the players on the camera: the
 * camera comes on and counts everyone holding up their fists (headCount.ts),
 * then the drivers are chosen for that many. The picture shows the whole
 * camera, split into the columns the players counted so far would each drive
 * in, named, with a dot on every hand it sees: so a friend left out can see
 * why, and everyone sees where they will stand. The count moves on by itself
 * once it has held for a moment; Continue moves on at once.
 */
import type { HandFrame, SeenHand } from "../../tracking/types";
import { $, announce, setText } from "../../ui/dom";
import { HeadCounter } from "./headCount";
import type { Disposable, Services } from "./services";
import { focusHeading } from "./ui";

export interface CountHooks {
  back(): void;
  /** This many players are on the camera. */
  done(players: 1 | 2 | 3 | 4): void;
}

/** A player who may be counted: their name and their colour in the room, in seat order (you first). */
export interface CountSeat {
  name: string;
  colour: string;
}

/** Once the count has settled, how long it shows before the screen moves on, ms. */
export const SHOWN_FOR = 900;

const plural = (players: number): string => `${players} ${players === 1 ? "Player" : "Players"}`;

/** Where a hand is: the middle of its palm (wrist and the middle finger's knuckle), in the camera's own picture. */
function palm(hand: SeenHand): { x: number; y: number } {
  const wrist = hand.landmarks[0]!;
  const knuckle = hand.landmarks[9]!;
  return { x: (wrist.x + knuckle.x) / 2, y: (wrist.y + knuckle.y) / 2 };
}

export class CountScreen {
  private counter = new HeadCounter();
  private seats: CountSeat[] = [];
  /** The hands in the newest picture. */
  private hands: { x: number; y: number }[] = [];
  private players: 0 | 1 | 2 | 3 | 4 = 0;
  private settledAt: number | null = null;
  private picture: Disposable | null = null;
  private unsubscribe: (() => void) | null = null;
  private timer = 0;
  private said = "";

  constructor(
    private readonly services: Services,
    private readonly hooks: CountHooks,
  ) {
    $("count-back").addEventListener("click", () => {
      this.stop();
      hooks.back();
    });
    $("count-continue").addEventListener("click", () => this.finish());
  }

  /**
   * Shows the screen while the camera comes on. `seats` are everyone who may be counted (as many as the room has seats
   * for this device), in the order their columns go left to right.
   */
  open(seats: readonly CountSeat[]): void {
    this.stop();
    this.seats = [...seats];
    this.players = 0;
    this.settledAt = null;
    this.said = "";
    this.say("Turning the camera on", "Then everyone driving holds up both fists.");
    $("count-continue").style.visibility = "hidden";
    focusHeading($("count-title"));
  }

  /** The tracker is downloading (the first visit fetches about 20 MB): how far, 0..1. */
  loading(fraction: number): void {
    if (this.timer || fraction >= 1) return;
    this.say("Turning the camera on", `Getting the hand tracker ready: ${Math.round(fraction * 100)}%`);
  }

  /** The camera is on: count. */
  start(): void {
    this.stop();
    this.counter.reset(performance.now());
    this.picture = this.services.previewCount($("count-picture"), () => ({
      // One player drives with the whole picture: no columns until there are two.
      seats: this.players >= 2 ? this.seats.slice(0, this.players) : [],
      hands: this.hands,
    }));
    this.unsubscribe = this.services.camera.hands.subscribe((frame) => this.seen(frame));
    this.timer = window.setInterval(() => this.tick(), 100);
    this.tick();
  }

  private seen(frame: HandFrame): void {
    this.hands = frame.hands.map(palm);
    this.counter.push(frame.hands.length, performance.now());
  }

  private tick(): void {
    const now = performance.now();
    const count = this.counter.read(now);
    // Never more than the room has seats for.
    const players = Math.min(count.players, this.seats.length) as 0 | 1 | 2 | 3 | 4;
    this.players = players;
    if (count.settled && players > 0) {
      this.settledAt ??= now;
      if (now - this.settledAt >= SHOWN_FOR) {
        this.finish();
        return;
      }
    } else this.settledAt = null;
    $("count-continue").style.visibility = players > 0 ? "visible" : "hidden";
    if (players === 0) this.say("Fists up, everyone driving", "Hold both fists up like a wheel, side by side. Up to four players.");
    else if (this.settledAt !== null) {
      if (this.say(plural(players), players === 1 ? "Next, choose your driver." : "Next, choose your drivers.")) announce(`${plural(players)} counted.`);
    } else if (players >= this.seats.length) this.say(plural(players), this.seats.length < 4 ? "That fills the room." : "That fills the camera.");
    else this.say(plural(players), "Anyone else driving? Fists up now.");
  }

  /** Puts these words up; false if they were up already. */
  private say(title: string, detail: string): boolean {
    const now = `${title}\n${detail}`;
    if (now === this.said) return false;
    this.said = now;
    setText("count-title", title);
    setText("count-detail", detail);
    return true;
  }

  /** On with the players counted (Continue, or the count settled). */
  private finish(): void {
    const players = this.players;
    if (players === 0) return;
    this.stop();
    this.hooks.done(players);
  }

  /** Stops counting and takes the picture down (the camera is the app's to stop). */
  stop(): void {
    window.clearInterval(this.timer);
    this.timer = 0;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.picture?.dispose();
    this.picture = null;
    $("count-picture").replaceChildren();
    this.hands = [];
  }
}
