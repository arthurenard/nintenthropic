/**
 * Sheets over the page - the camera's question, the loading bar, the pause
 * menu, results - and the calm, actionable way trouble is told: what
 * happened and what to do, in one or two lines, with the fix as a button.
 */
import { $, icon, setText } from "../ui/dom";

export function openSheet(id: string): HTMLDialogElement {
  const sheet = $<HTMLDialogElement>(id);
  if (!sheet.open) sheet.showModal();
  return sheet;
}

export function closeSheet(id: string): void {
  const sheet = $<HTMLDialogElement>(id);
  if (sheet.open) sheet.close();
}

export function closeSheets(): void {
  for (const sheet of document.querySelectorAll<HTMLDialogElement>("dialog[open]")) sheet.close();
}

export type Trouble =
  | "denied"
  | "busy"
  | "missing"
  | "insecure"
  | "stopped"
  | "stalled"
  | "webgl"
  | "model"
  | "game"
  | "offline"
  | "context";

/** The fixes a trouble can offer, by their button's label. */
export type Fix = "Try Again" | "Use Mouse or Trackpad" | "Choose a Game" | "Reload";

interface TroubleSheet {
  icon: string;
  title: string;
  body: string;
  primary: Fix;
  secondary?: Fix;
  tertiary?: Fix;
}

export const TROUBLES: Record<Trouble, TroubleSheet> = {
  denied: {
    icon: "camera",
    title: "Camera Is Off",
    body: "Your browser is blocking the camera for this page. Allow it from the address bar, then Try Again.",
    primary: "Try Again",
    secondary: "Use Mouse or Trackpad",
  },
  busy: {
    icon: "camera",
    title: "Camera Is Busy",
    body: "Your camera is being used by another app. Close it, then Try Again.",
    primary: "Try Again",
    secondary: "Use Mouse or Trackpad",
  },
  missing: {
    icon: "camera",
    title: "No Camera Found",
    body: "Connect a camera, then Try Again. Or play with your mouse.",
    primary: "Try Again",
    secondary: "Use Mouse or Trackpad",
  },
  insecure: {
    icon: "camera",
    title: "Camera Unavailable",
    body: "Your browser only shares the camera with secure pages. Open Handy from its https address.",
    primary: "Use Mouse or Trackpad",
    secondary: "Choose a Game",
  },
  // The camera going mid-game: the round waits, frozen, under the sheet.
  stopped: {
    icon: "camera",
    title: "Camera Stopped",
    body: "Your camera disconnected. Reconnect it, then Try Again.",
    primary: "Try Again",
    secondary: "Use Mouse or Trackpad",
    tertiary: "Choose a Game",
  },
  stalled: {
    icon: "camera",
    title: "Camera Stopped",
    body: "Your camera stopped sending a picture. Check it, then Try Again.",
    primary: "Try Again",
    secondary: "Use Mouse or Trackpad",
    tertiary: "Choose a Game",
  },
  webgl: {
    icon: "cube",
    title: "3D Is Turned Off",
    body: "Your browser can’t draw the game right now. Turn on hardware acceleration in its settings, then Reload.",
    primary: "Reload",
  },
  model: {
    icon: "wifi",
    title: "Couldn’t Get Ready",
    body: "The one-time download didn’t finish. Check your internet connection, then Try Again.",
    primary: "Try Again",
    secondary: "Use Mouse or Trackpad",
  },
  game: {
    icon: "wifi",
    title: "Couldn’t Load the Game",
    body: "Part of the game didn’t arrive. Check your internet connection, then Try Again.",
    primary: "Try Again",
    secondary: "Choose a Game",
  },
  // A download that failed with the browser offline. The mouse helps only
  // when it was the hand's download: the page offers it then (see App.fail).
  offline: {
    icon: "wifi-off",
    title: "You’re Offline",
    body: "Connect to the internet, then Try Again.",
    primary: "Try Again",
    secondary: "Choose a Game",
  },
  context: {
    icon: "exclamation",
    title: "Something Went Wrong",
    body: "Your graphics restarted and the game stopped. Try Again to start it afresh.",
    primary: "Try Again",
    secondary: "Choose a Game",
  },
};

/**
 * Shows a trouble's sheet. `choices` replaces its second and third fixes
 * where the moment calls for others (the camera failing again mid-game
 * offers the mouse and the arcade, not a new game).
 */
export function showTrouble(
  kind: Trouble,
  fixes: Record<Fix, () => void>,
  choices: { secondary?: Fix | null; tertiary?: Fix | null } = {},
): void {
  closeSheets();
  const sheet = TROUBLES[kind];
  const badge = $("alert-icon");
  badge.replaceChildren(icon(sheet.icon));
  badge.classList.add("danger");
  setText("alert-title", sheet.title);
  setText("alert-body", sheet.body);
  for (const [id, label] of [
    ["alert-primary", sheet.primary],
    ["alert-secondary", choices.secondary === undefined ? sheet.secondary : choices.secondary],
    ["alert-tertiary", choices.tertiary === undefined ? sheet.tertiary : choices.tertiary],
  ] as const) {
    const button = $<HTMLButtonElement>(id);
    button.hidden = !label;
    if (!label) continue;
    setText(button, label);
    button.onclick = () => {
      closeSheet("alert");
      fixes[label]();
    };
  }
  openSheet("alert");
  $("alert-primary").focus();
}

/** The loading sheet: shown only if getting ready takes a moment, with real numbers. */
export class LoadingSheet {
  private shown = false;
  private readonly timer: number;
  private fraction = 0;

  constructor(firstTime: boolean) {
    setText("loading-title", "Getting ready…");
    $("loading-note").hidden = !firstTime;
    this.set(0);
    // A start that is ready in a blink never flashes a sheet.
    this.timer = window.setTimeout(() => {
      this.shown = true;
      openSheet("loading");
    }, 350);
  }

  set(fraction: number): void {
    this.fraction = Math.max(this.fraction, Math.min(1, fraction));
    const percent = Math.round(this.fraction * 100);
    setText("loading-title", percent > 0 ? `Getting ready… ${percent}%` : "Getting ready…");
    const bar = $("loading-bar");
    bar.setAttribute("aria-valuenow", String(percent));
    (bar.firstElementChild as HTMLElement).style.transform = `scaleX(${this.fraction})`;
  }

  close(): void {
    window.clearTimeout(this.timer);
    if (this.shown) closeSheet("loading");
  }
}
