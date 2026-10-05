/**
 * Keeps the screen awake while a race is on. A phone propped up as a wheel
 * is not touched for minutes at a time, and a screen that goes dark takes
 * the camera with it. Browsers that have no wake lock simply skip it.
 *
 * The lock is let go by the browser whenever the page is hidden, so it is
 * asked for again when the page comes back.
 */
interface Sentinel {
  release(): Promise<void>;
  addEventListener(type: "release", listener: () => void): void;
}

interface WakeLockApi {
  request(type: "screen"): Promise<Sentinel>;
}

const api = (): WakeLockApi | null => {
  const lock = (navigator as { wakeLock?: WakeLockApi }).wakeLock;
  return lock && typeof lock.request === "function" ? lock : null;
};

export class AwakeWhileRacing {
  private sentinel: Sentinel | null = null;
  private wanted = false;
  private readonly onVisible = () => {
    if (this.wanted && document.visibilityState === "visible") void this.request();
  };

  /** Keep the screen on from now until `release`. */
  hold(): void {
    if (this.wanted) return;
    this.wanted = true;
    document.addEventListener("visibilitychange", this.onVisible);
    void this.request();
  }

  release(): void {
    this.wanted = false;
    document.removeEventListener("visibilitychange", this.onVisible);
    const sentinel = this.sentinel;
    this.sentinel = null;
    void sentinel?.release().catch(() => {});
  }

  private async request(): Promise<void> {
    const lock = api();
    if (!lock || this.sentinel) return;
    try {
      const sentinel = await lock.request("screen");
      // Let go of at once if the race ended while the browser was thinking.
      if (!this.wanted) return void sentinel.release().catch(() => {});
      this.sentinel = sentinel;
      sentinel.addEventListener("release", () => {
        if (this.sentinel === sentinel) this.sentinel = null;
      });
    } catch {
      // Low battery, a hidden page, a browser that says no: the screen may sleep, and the race goes on.
    }
  }
}
