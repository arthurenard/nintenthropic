/**
 * The Settings sheet: grouped rows in the manner of the system's own
 * settings - segmented controls for a choice of a few, switches for on and
 * off, a slider for the volume, a menu for the camera - opened from the
 * arcade's gear and from the pause sheet. Every change takes effect at once
 * and is remembered; the difficulty and the camera wait for the next round
 * where one is in play, and the sheet says so.
 *
 * The sheet only shows and edits the player's Preferences; the app puts
 * them into effect (SettingsHost.changed).
 */
import type { Difficulty, GameEntry } from "../engine/types";
import type { Steadiness } from "../input/aim";
import { listCameras } from "../tracking/camera";
import { $, setText, toast } from "../ui/dom";
import type { CrosshairStyle } from "./crosshair";
import type { Preferences, ScopePreferences } from "./prefs";
import { closeSheet, openSheet } from "./sheets";

declare const __HANDY_VERSION__: string;

/** Handy's version, from package.json (Vite writes it in at build time). */
export const VERSION: string = typeof __HANDY_VERSION__ === "string" ? __HANDY_VERSION__ : "dev";

export interface SettingsHost {
  /** The player's settings; the sheet edits them in place, then calls changed(). */
  readonly preferences: Preferences;
  /** How the player scopes, in the games with a scope; edited in place like the rest. */
  readonly scope: ScopePreferences;
  /** The games that can be played with a scope: the Scope group shows only while there is one. */
  scopeGames(): readonly GameEntry[];
  /** A touch screen, with no Shift or right button: its scope is the Scope button. */
  touch(): boolean;
  /** What the system asks for, which Reduce Motion follows until the player chooses. */
  systemReducesMotion(): boolean;
  /** A preference was changed on the sheet: save it and put it into effect. */
  changed(key: keyof Preferences | "scope"): void;
  /** The interface's tap, at the volume just chosen. */
  audition(): void;
  /** The camera that will open next: the player's choice, or the one in use or used last. */
  currentCamera(): string | null;
  chooseCamera(deviceId: string): void;
  hasSavedAim(): boolean;
  forgetSavedAim(): void;
  /** Forget everything Handy keeps, and start again as on the first visit. */
  reset(): void;
  /** The facts for a bug report (never anything personal). */
  systemInfo(): Promise<SystemFacts>;
}

const AIM_FOOT = "Steady holds a shaky hand still. Responsive follows quick moves closely.";
const CAMERA_FOOT = "Your aim is saved for each camera.";

/**
 * The Scope group's footnote: how to scope, as the player has it set, in
 * their terms (the Scope button on a touch screen).
 */
export function scopeFoot(scope: ScopePreferences, touch: boolean, eye: boolean): string {
  const button = touch ? "the Scope button" : "Shift or the right mouse button";
  const withEye = eye && scope.eye;
  if (scope.button === "hold") {
    return withEye ? `Close one eye for a moment, or hold ${button}, to look through the scope.` : `Hold ${button} to look through the scope.`;
  }
  return withEye
    ? `Close one eye for a moment to look through the scope, or press ${button}: once to look, again to stop.`
    : `Press ${button} once to look through the scope, and again to stop.`;
}

/** Where the sheet was opened: from the arcade, or over a paused game. */
export type SettingsContext = "home" | "pause";

/**
 * A segmented control as a radio group: one tab stop, the arrow keys move
 * the choice (and the focus with it), as native radio buttons do.
 */
class Segmented<T extends string> {
  private readonly radios: HTMLButtonElement[];

  constructor(
    private readonly group: HTMLElement,
    onPick: (value: T) => void,
  ) {
    this.radios = [...group.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
    group.style.setProperty("--count", String(this.radios.length));
    const pick = (radio: HTMLButtonElement, focus: boolean) => {
      if (focus) radio.focus();
      if (radio.getAttribute("aria-checked") === "true") return;
      this.value = radio.dataset.value as T;
      onPick(radio.dataset.value as T);
    };
    for (const radio of this.radios) radio.addEventListener("click", () => pick(radio, false));
    group.addEventListener("keydown", (event) => {
      const at = this.radios.findIndex((radio) => radio.getAttribute("aria-checked") === "true");
      const last = this.radios.length - 1;
      const to = (
        {
          ArrowRight: at + 1,
          ArrowDown: at + 1,
          ArrowLeft: at - 1,
          ArrowUp: at - 1,
          Home: 0,
          End: last,
        } as Record<string, number>
      )[event.key];
      if (to === undefined) return;
      event.preventDefault();
      pick(this.radios[(to + this.radios.length) % this.radios.length]!, true);
    });
  }

  set value(value: T) {
    this.radios.forEach((radio, i) => {
      const checked = radio.dataset.value === value;
      radio.setAttribute("aria-checked", String(checked));
      radio.tabIndex = checked ? 0 : -1;
      if (checked) this.group.style.setProperty("--index", String(i));
    });
  }
}

/** An on/off switch: a button with the switch role, labelled by its row. */
class Switch {
  constructor(
    private readonly button: HTMLButtonElement,
    onToggle: (on: boolean) => void,
  ) {
    button.addEventListener("click", () => {
      const on = button.getAttribute("aria-checked") !== "true";
      this.on = on;
      onToggle(on);
    });
  }

  set on(on: boolean) {
    this.button.setAttribute("aria-checked", String(on));
  }
}

export class SettingsSheet {
  private readonly sheet = $<HTMLDialogElement>("settings");
  private readonly difficulty: Segmented<Difficulty>;
  private readonly crosshairSize: Segmented<CrosshairStyle["size"]>;
  private readonly steadiness: Segmented<Steadiness>;
  private readonly highContrast: Switch;
  private readonly cameraInPlay: Switch;
  private readonly reduceMotion: Switch;
  private readonly reduceFlashing: Switch;
  private readonly eyeScope: Switch;
  private readonly scopeButton: Segmented<ScopePreferences["button"]>;
  private readonly volume = $<HTMLInputElement>("volume");
  private readonly camera = $<HTMLSelectElement>("camera-choice");
  private context: SettingsContext = "home";
  private readonly onDevices = () => void this.listCameras();

  constructor(private readonly host: SettingsHost) {
    const prefs = host.preferences;
    const change = (key: keyof Preferences | "scope") => host.changed(key);
    this.difficulty = new Segmented($("pick-difficulty"), (value) => {
      prefs.difficulty = value;
      change("difficulty");
    });
    this.crosshairSize = new Segmented($("pick-crosshair"), (value) => {
      prefs.crosshair = { ...prefs.crosshair, size: value };
      change("crosshair");
    });
    this.steadiness = new Segmented($("pick-steadiness"), (value) => {
      prefs.steadiness = value;
      change("steadiness");
    });
    this.highContrast = new Switch($("switch-contrast"), (on) => {
      prefs.crosshair = { ...prefs.crosshair, highContrast: on };
      change("crosshair");
    });
    this.cameraInPlay = new Switch($("switch-preview"), (on) => {
      prefs.cameraInPlay = on;
      change("cameraInPlay");
    });
    this.reduceMotion = new Switch($("switch-motion"), (on) => {
      prefs.reduceMotion = on;
      change("reduceMotion");
    });
    this.reduceFlashing = new Switch($("switch-flashing"), (on) => {
      prefs.reduceFlashing = on;
      change("reduceFlashing");
    });
    this.eyeScope = new Switch($("switch-eye-scope"), (on) => {
      host.scope.eye = on;
      this.showScopeFoot();
      change("scope");
    });
    this.scopeButton = new Segmented($("pick-scope-button"), (value) => {
      host.scope.button = value;
      this.showScopeFoot();
      change("scope");
    });
    this.volume.addEventListener("input", () => {
      prefs.volume = Number(this.volume.value) / 100;
      this.showVolume();
      change("volume");
    });
    // Let go of the slider: a tap at the new level, as the system does.
    this.volume.addEventListener("change", () => host.audition());
    this.camera.addEventListener("change", () => {
      host.chooseCamera(this.camera.value);
      this.say(this.context === "pause" ? "Your next game uses this camera." : "");
    });

    $("settings-done").onclick = () => this.close();
    $("forget-aim").onclick = () => {
      host.forgetSavedAim();
      this.showForget();
      toast("Saved aim forgotten.", { icon: "check" });
      this.say("Saved aim forgotten.");
    };
    $("settings-privacy").onclick = () => openSheet("privacy");
    $("copy-info").onclick = () => void this.copyInfo();
    $("reset").onclick = () => {
      openSheet("confirm");
      $("confirm-cancel").focus();
    };
    $("confirm-cancel").onclick = () => closeSheet("confirm");
    $("confirm-reset").onclick = () => host.reset();
    setText("version", VERSION);

    // The rows scroll under the title: a hairline says so, as in the system.
    const body = $("settings-body");
    body.addEventListener("scroll", () => this.sheet.classList.toggle("scrolled", body.scrollTop > 0), { passive: true });
    this.sheet.addEventListener("close", () => navigator.mediaDevices?.removeEventListener?.("devicechange", this.onDevices));
    // Keys pressed on these sheets are theirs: P or Space must not resume
    // the game under them. M still mutes, anywhere.
    for (const id of ["settings", "confirm", "privacy"]) {
      $(id).addEventListener("keydown", (event) => {
        if (event.key.toLowerCase() !== "m") event.stopPropagation();
      });
    }
  }

  /** Shows the sheet with the settings as they are now. */
  show(context: SettingsContext): void {
    this.context = context;
    this.render();
    const inGame = context === "pause";
    setText(
      "foot-difficulty",
      `Relaxed is slower and gentler, with records of its own.${inGame ? " A change applies when the next round begins." : ""}`,
    );
    setText("foot-aim", AIM_FOOT);
    setText("foot-camera", CAMERA_FOOT);
    this.say("");
    void this.listCameras();
    navigator.mediaDevices?.addEventListener?.("devicechange", this.onDevices);
    const body = $("settings-body");
    body.scrollTop = 0;
    this.sheet.classList.remove("scrolled");
    openSheet("settings");
    $("settings-done").focus();
  }

  close(): void {
    closeSheet("confirm");
    closeSheet("settings");
  }

  /** Every control from the preferences as they are. */
  render(): void {
    const prefs = this.host.preferences;
    this.difficulty.value = prefs.difficulty;
    this.crosshairSize.value = prefs.crosshair.size;
    this.steadiness.value = prefs.steadiness;
    this.highContrast.on = prefs.crosshair.highContrast;
    this.cameraInPlay.on = prefs.cameraInPlay;
    this.reduceMotion.on = prefs.reduceMotion ?? this.host.systemReducesMotion();
    this.reduceFlashing.on = prefs.reduceFlashing;
    this.renderScope();
    this.volume.value = String(Math.round(prefs.volume * 100));
    this.showVolume();
    this.showForget();
  }

  /**
   * The Scope group, only while a game with a scope can be played; its eye
   * row only while one of those reads the eye.
   */
  private renderScope(): void {
    const games = this.host.scopeGames();
    $("scope-group").hidden = games.length === 0;
    const eyeRow = $("switch-eye-scope").closest(".row") as HTMLElement;
    eyeRow.hidden = !games.some((game) => game.uses?.eye);
    this.eyeScope.on = this.host.scope.eye;
    this.scopeButton.value = this.host.scope.button;
    this.showScopeFoot();
  }

  private showScopeFoot(): void {
    const eye = this.host.scopeGames().some((game) => game.uses?.eye);
    setText("foot-scope", scopeFoot(this.host.scope, this.host.touch(), eye));
  }

  private showVolume(): void {
    const percent = Math.round(this.host.preferences.volume * 100);
    this.volume.style.setProperty("--value", `${percent}%`);
    this.volume.setAttribute("aria-valuetext", `${percent}%`);
  }

  private showForget(): void {
    $<HTMLButtonElement>("forget-aim").disabled = !this.host.hasSavedAim();
  }

  /**
   * The Camera row, only when there is a choice to make: the browser names
   * its cameras once it may use one, and lists at most one before that.
   */
  private async listCameras(): Promise<void> {
    const row = $("camera-row");
    const cameras = await listCameras();
    row.hidden = cameras.length < 2;
    // Over a game, the camera in use stays until the next one.
    setText("foot-camera", `${CAMERA_FOOT}${this.context === "pause" && !row.hidden ? " A new camera takes over from your next game." : ""}`);
    if (row.hidden) return;
    const current = this.host.currentCamera();
    const chosen = cameras.some((camera) => camera.deviceId === current) ? current : cameras[0]!.deviceId;
    this.camera.replaceChildren(
      ...cameras.map((camera, i) => {
        const option = document.createElement("option");
        option.value = camera.deviceId;
        option.textContent = camera.label || `Camera ${i + 1}`;
        option.selected = camera.deviceId === chosen;
        return option;
      }),
    );
  }

  private async copyInfo(): Promise<void> {
    const text = formatSystemInfo(await this.host.systemInfo());
    const copied = await copyText(text, this.sheet);
    toast(copied ? "Copied." : "Couldn’t copy. Your browser didn’t allow it.", { icon: copied ? "check" : "exclamation" });
    this.say(copied ? "Copied." : "Couldn’t copy.");
  }

  /** Said to a screen reader from inside the sheet (the page's own live region is behind it). */
  private say(message: string): void {
    const status = $("settings-status");
    status.textContent = "";
    if (message) requestAnimationFrame(() => (status.textContent = message));
  }
}

/** Onto the clipboard; the old way where the new one is refused. */
async function copyText(text: string, within: HTMLElement): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // A modal sheet makes the page outside it inert: the scratch field goes inside.
    const field = document.createElement("textarea");
    field.value = text;
    field.setAttribute("readonly", "");
    field.className = "visually-hidden";
    within.append(field);
    field.select();
    try {
      return document.execCommand("copy");
    } catch {
      return false;
    } finally {
      field.remove();
    }
  }
}

// --- the facts for a bug report -------------------------------------------------------------

export interface SystemFacts {
  version: string;
  userAgent: string;
  gpu: string | null;
  tracker: { where: string; delegate: string } | null;
  /** Frame to frame, and each frame's own work, ms; null before a game has run. */
  frames: { interval: { p50: number; p95: number }; work: { p50: number; p95: number } } | null;
  /** Camera frame to crosshair, ms; null before the hand has been followed. */
  latency: { p50: number; p95: number } | null;
  quality: { tier: string; scale: number } | null;
  screen: { width: number; height: number; windowWidth: number; windowHeight: number; pixelRatio: number };
}

const ms = (value: number) => `${value.toFixed(1)} ms`;

/**
 * The system info copied for a bug report: the browser and its system, the
 * graphics chip, where the hand is tracked, the timings and the screen.
 * Nothing personal: no camera's name, no picture, nothing typed.
 */
export function formatSystemInfo(facts: SystemFacts): string {
  const { screen } = facts;
  const lines = [
    `Handy ${facts.version}`,
    `Browser: ${facts.userAgent}`,
    `Graphics: ${facts.gpu || "unknown"}${facts.quality ? ` (${facts.quality.tier}, ${Math.round(facts.quality.scale * 100)}% resolution)` : ""}`,
    `Hand tracking: ${facts.tracker ? `${facts.tracker.where}, ${facts.tracker.delegate}` : "not started"}`,
    `Frame time: ${facts.frames ? `${ms(facts.frames.interval.p50)} p50, ${ms(facts.frames.interval.p95)} p95 (work ${ms(facts.frames.work.p50)} p50, ${ms(facts.frames.work.p95)} p95)` : "no game played yet"}`,
    `Camera to crosshair: ${facts.latency ? `${ms(facts.latency.p50)} p50, ${ms(facts.latency.p95)} p95` : "not measured yet"}`,
    `Screen: ${screen.width}×${screen.height}, window ${screen.windowWidth}×${screen.windowHeight}, pixel ratio ${screen.pixelRatio}`,
  ];
  return `${lines.join("\n")}\n`;
}
