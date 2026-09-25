/**
 * The mouse (or trackpad) and the touch screen as InputSources, for players
 * without a camera or who prefer them.
 *
 * Reloading. High Noon reloads when the crosshair leaves the view for a
 * moment - the arcade classic - and reads that from Aim.offscreen. A pointer
 * gets there two ways:
 *   - naturally: a mouse that leaves the stage is off the screen until it
 *     comes back (the crosshair stays at the last point it was seen);
 *   - on purpose: right-click, or R, makes a synthetic offscreen moment -
 *     Aim.offscreen is true for RELOAD_MOMENT ms with the crosshair where it
 *     is, as if the player had flicked off the screen and back. With touch, a
 *     two-finger tap does the same.
 * Games need no key handling of their own for it.
 */
import type { Aim, InputKind, InputSource } from "../engine/types";

/** How long a synthetic offscreen moment lasts, in ms: long enough for any
 * game to see at its frame rate, short enough to be one gesture. */
export const RELOAD_MOMENT = 250;

/** A press on the page's own controls over the stage (Pause) is not a shot. */
function onControl(event: Event): boolean {
  return event.target instanceof Element && event.target.closest("button, a, input, select, [data-not-a-shot]") !== null;
}

abstract class PointerInput implements InputSource {
  abstract readonly kind: InputKind;
  protected x = 0.5;
  protected y = 0.5;
  protected seen = false;
  protected down = false;
  protected outside = false;
  protected reloadUntil = Number.NEGATIVE_INFINITY;
  protected capturedAt = 0;
  private shots: { x: number; y: number }[] = [];
  private readonly cleanups: (() => void)[] = [];

  constructor(protected readonly stage: HTMLElement) {}

  protected listen<K extends keyof HTMLElementEventMap>(
    target: HTMLElement | Window,
    type: K,
    handler: (event: HTMLElementEventMap[K]) => void,
    options?: AddEventListenerOptions,
  ): void {
    const listener = handler as EventListener;
    target.addEventListener(type, listener, options);
    this.cleanups.push(() => target.removeEventListener(type, listener, options));
  }

  /** Where an event is, in fractions of the stage. */
  protected place(event: { clientX: number; clientY: number; timeStamp: number }): void {
    const box = this.stage.getBoundingClientRect();
    if (!box.width || !box.height) return;
    this.x = Math.min(Math.max((event.clientX - box.left) / box.width, 0), 1);
    this.y = Math.min(Math.max((event.clientY - box.top) / box.height, 0), 1);
    this.seen = true;
    this.capturedAt = event.timeStamp;
  }

  /** The shot lands where the click was, even if the pointer moves on
   * before the next frame reads it. */
  protected fire(): void {
    this.shots.push({ x: this.x, y: this.y });
  }

  reload(now = performance.now()): void {
    this.reloadUntil = now + RELOAD_MOMENT;
  }

  sample(now: number): Aim {
    const shot = this.shots.shift();
    return {
      x: shot?.x ?? this.x,
      y: shot?.y ?? this.y,
      tracking: this.seen,
      armed: true,
      fired: shot !== undefined,
      travel: this.down ? 1 : 0,
      offscreen: this.outside || now < this.reloadUntil,
      capturedAt: this.capturedAt,
    };
  }

  /** Nothing held over a pause. */
  reset(): void {
    this.shots = [];
    this.down = false;
    this.reloadUntil = Number.NEGATIVE_INFINITY;
  }

  dispose(): void {
    for (const cleanup of this.cleanups.splice(0)) cleanup();
  }
}

export class MouseInput extends PointerInput {
  readonly kind = "mouse" as const;

  constructor(stage: HTMLElement) {
    super(stage);
    this.listen(stage, "pointermove", (event) => {
      if (event.pointerType === "touch") return;
      this.outside = false;
      this.place(event);
    });
    this.listen(stage, "pointerdown", (event) => {
      if (event.pointerType === "touch" || onControl(event)) return;
      this.place(event);
      if (event.button === 2) {
        this.reload(event.timeStamp);
      } else if (event.button === 0) {
        this.down = true;
        this.fire();
      }
    });
    this.listen(window, "pointerup", () => (this.down = false));
    this.listen(stage, "pointerleave", (event) => {
      if (event.pointerType !== "touch") this.outside = true;
    });
    this.listen(stage, "pointerenter", (event) => {
      if (event.pointerType !== "touch") this.outside = false;
    });
    this.listen(stage, "contextmenu", (event) => event.preventDefault());
    this.listen(window, "keydown", (event) => {
      if ((event.key === "r" || event.key === "R") && !event.repeat && !event.metaKey && !event.ctrlKey) {
        this.reload(event.timeStamp);
      }
    });
  }
}

export class TouchInput extends PointerInput {
  readonly kind = "touch" as const;
  private fingers = 0;

  constructor(stage: HTMLElement) {
    super(stage);
    this.listen(
      stage,
      "touchstart",
      (event) => {
        if (onControl(event)) return;
        event.preventDefault(); // no scrolling, zooming or synthetic mouse clicks
        this.fingers = event.touches.length;
        if (event.touches.length >= 2) {
          this.reload(event.timeStamp);
          return;
        }
        const touch = event.changedTouches[0];
        if (!touch) return;
        this.place({ clientX: touch.clientX, clientY: touch.clientY, timeStamp: event.timeStamp });
        this.down = true;
        this.fire();
      },
      { passive: false },
    );
    this.listen(
      stage,
      "touchmove",
      (event) => {
        event.preventDefault();
        const touch = event.touches[0];
        if (touch && this.fingers < 2) this.place({ clientX: touch.clientX, clientY: touch.clientY, timeStamp: event.timeStamp });
      },
      { passive: false },
    );
    this.listen(stage, "touchend", (event) => {
      this.fingers = event.touches.length;
      if (!event.touches.length) this.down = false;
    });
  }
}
