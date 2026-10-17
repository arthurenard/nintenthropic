/**
 * The pause sheet's Graphics row (Auto, Low, Medium, High), the Frame Rate
 * switch, and the little readout the switch turns on. The choice is kept on
 * the device (prefs.ts) and read by the renderer when the next race is built,
 * so the footnote says so; Restart in the same sheet is the way to see it now.
 */
import { $, setText } from "../../ui/dom";
import { probeStage } from "./driver";
import { TIER_NAMES, loadCeiling, loadFpsReadout, loadGraphics, saveFpsReadout, saveGraphics, type Graphics, type TierName } from "./prefs";
import { Segmented, Switch } from "./ui";
import type { TrackerCounts } from "./handsFirst";

const NAME: Record<Graphics, string> = { auto: "Auto", low: "Low", medium: "Medium", high: "High" };

/** What Auto draws in: the device's own tier, less what the safety net took off after a slow race. */
export function autoTier(guessed: TierName, ceiling: TierName | null): TierName {
  return ceiling && TIER_NAMES.indexOf(ceiling) < TIER_NAMES.indexOf(guessed) ? ceiling : guessed;
}

/** The words under the rows: what the choice does, and when. */
export function graphicsNote(choice: Graphics, guessed: TierName | null, ceiling: TierName | null): string {
  if (choice !== "auto") return `${NAME[choice]} graphics from the next race.`;
  if (!guessed) return "Auto picks the graphics to suit this device, from the next race.";
  const tier = autoTier(guessed, ceiling);
  const held = tier !== guessed;
  return held ? `Auto is using ${NAME[tier]} here: a race ran slowly, so it stepped down.` : `Auto uses ${NAME[tier]} on this device.`;
}

export class GraphicsControls {
  private readonly pick: Segmented<Graphics>;
  private readonly fps: Switch;
  private guessed: TierName | null = null;

  constructor(private readonly onFps: (on: boolean) => void) {
    this.pick = new Segmented<Graphics>($("pause-graphics"), (choice) => {
      saveGraphics(choice);
      this.say();
    });
    this.fps = new Switch($<HTMLButtonElement>("pause-fps"), (on) => {
      saveFpsReadout(on);
      onFps(on);
    });
    this.sync();
    onFps(this.fps.on);
    // Each time the sheet opens it shows what is kept now (a slow race may have lowered Auto since).
    const sheet = $<HTMLDialogElement>("pause-sheet");
    new MutationObserver(() => sheet.open && this.sync()).observe(sheet, { attributes: true, attributeFilter: ["open"] });
    // Asked of the browser once, when the sheet is first made; the note only gets more exact.
    void probeStage().then((probe) => {
      this.guessed = probe.tier;
      this.say();
    });
  }

  /** Shows what is kept (the sheet opens on it each time). */
  sync(): void {
    this.pick.value = loadGraphics();
    this.fps.on = loadFpsReadout();
    this.say();
  }

  private say(): void {
    setText($("graphics-note"), graphicsNote(this.pick.value ?? loadGraphics(), this.guessed, loadCeiling()));
  }
}

/**
 * The readout's numbers: frames over half a second, so it reads steadily, and with a wheel on this screen how many times
 * a second each player's hands were read ("60 fps · hands 29/s": the camera gives 30).
 */
export class FrameRate {
  private frames = 0;
  private seconds = 0;
  private on = false;
  private handsFrom: TrackerCounts | null = null;

  constructor(private readonly element: HTMLElement) {}

  show(on: boolean): void {
    this.on = on;
    this.element.hidden = !on;
    this.frames = 0;
    this.seconds = 0;
    this.handsFrom = null;
  }

  /** One drawn frame, `dt` seconds after the one before; `hands`, the tracker's running counts while it reads. */
  tick(dt: number, hands: TrackerCounts | null = null): void {
    if (!this.on || !(dt > 0)) return;
    this.frames++;
    this.seconds += dt;
    if (this.seconds < 0.5) return;
    setText(this.element, frameRateText(this.frames / this.seconds, hands && this.handsFrom ? readsPerColumn(this.handsFrom, hands, this.seconds) : null));
    this.handsFrom = hands ? { ...hands } : null;
    this.frames = 0;
    this.seconds = 0;
  }
}

/** Each player's column's reads a second between two of the tracker's counts; null when they are not one tracker's. */
export function readsPerColumn(from: TrackerCounts, to: TrackerCounts, seconds: number): number | null {
  const read = to.frames - from.frames;
  if (read < 0 || !(seconds > 0)) return null;
  return read / Math.max(1, to.columns ?? 1) / seconds;
}

export function frameRateText(fps: number, hands: number | null): string {
  return hands === null ? `${Math.round(fps)} fps` : `${Math.round(fps)} fps · hands ${Math.round(hands)}/s`;
}
