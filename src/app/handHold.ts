/**
 * The round held for the hand. A hand gone in play for longer than any
 * reload's swing freezes the round - the world stops, as for a pause - while
 * the camera goes on looking, under a "Show Your Hand" card; seen steadily
 * again, the player is counted back in 3-2-1. Resuming from the pause menu
 * with the hand goes through the same wait and count.
 *
 * When to hold, ask and count is handWatch.ts's timing; this is what each of
 * those moments does to the round and shows on the screen.
 */
import { $, announce, replay, setText } from "../ui/dom";
import type { HandWatchEvent } from "./handWatch";
import type { PlayPieces, Session } from "./session";

/** The hold on screen: the dimmed world alone, the card asking for the hand, or a beat of the count. */
export type HoldState = "wait" | "lost" | "count";

export class HandHold {
  /** The small loop that watches for the hand while the world's own loop is stopped. */
  private loop = 0;

  constructor(
    private readonly pieces: PlayPieces,
    private readonly current: () => Session | null,
    /** Whether the camera itself has stopped (cameraInPlay.ts), which a hand's absence must not be taken for. */
    private readonly cameraStopped: (session: Session, now: number) => boolean,
  ) {}

  /** What the hand watch decided: hold the round, ask for the hand, count, carry on. */
  answer(session: Session, event: HandWatchEvent): void {
    switch (event.type) {
      case "hold":
        this.hold(session);
        this.show("lost");
        announce("Show your hand to carry on. The round waits for you.");
        break;
      case "ask":
        this.show("lost");
        announce("Show your hand to carry on.");
        break;
      case "count":
        this.show("count", event.beat);
        if (event.beat === 3) announce("Get ready.");
        break;
      case "go":
        this.release(session);
        break;
    }
  }

  /**
   * Freezes the round - the world stops, as for a pause - while the camera
   * goes on looking for the hand. The corners' chrome stays, the preview
   * grows so the player can see themselves, and a small loop watches for the
   * hand, since the world's own loop is stopped.
   */
  hold(session: Session): void {
    const { crosshair, hud, yielding } = this.pieces;
    session.held = true;
    session.lostSince = null;
    this.pieces.host()?.pause();
    crosshair.visible = false;
    crosshair.clear();
    hud.pageHint(null);
    yielding.reset();
    if (!this.loop) this.loop = requestAnimationFrame(this.tick);
  }

  /** Back from the pause menu or a camera's trouble: the round waits to see the hand, then counts the player in. */
  waitForHand(session: Session): void {
    this.hold(session);
    session.watch.hold(performance.now());
    this.show("wait");
  }

  private readonly tick = (now: number): void => {
    const session = this.current();
    if (!session || !session.held || session.paused || session.troubled) {
      this.loop = 0;
      return;
    }
    this.loop = requestAnimationFrame(this.tick);
    if (this.cameraStopped(session, now)) return;
    const event = session.watch.update(now, session.input.sample(now).tracking);
    if (event) this.answer(session, event);
  };

  /** The hand is back and the count is done: the round carries on. */
  private release(session: Session): void {
    session.held = false;
    this.show(null);
    // Nothing held from before: no stale fold fires as the world starts.
    session.input.reset();
    this.pieces.crosshair.visible = !session.down;
    this.pieces.host()?.resume();
  }

  /** The hold on screen, or nothing (null). */
  show(state: HoldState | null, beat = 0): void {
    const game = $("game");
    if (state) game.dataset.hold = state;
    else delete game.dataset.hold;
    if (state === "count") {
      const numeral = $("hold-beat");
      setText(numeral, String(beat));
      numeral.className = "";
      replay(numeral, this.pieces.settings.reducedMotion ? "beat-calm" : "beat");
    }
  }

  /** The hold is over, whatever it was waiting for: the loop stops and the screen clears. */
  stop(session: Session): void {
    session.held = false;
    cancelAnimationFrame(this.loop);
    this.loop = 0;
    this.show(null);
  }
}
