/**
 * When something goes wrong: a sheet that says what happened and what to do,
 * calmly, in a line or two, with the way back as a button (DESIGN.md,
 * Voice). Nothing here is an error code or a stack trace.
 */
import { $, icon, setText } from "../../ui/dom";
import { relayReady } from "../net/ice";

export type TroubleKind =
  | "not-found"
  | "full"
  | "host-left"
  | "network"
  | "unreachable"
  | "started"
  | "version"
  | "camera-denied"
  | "camera-busy"
  | "camera-missing"
  | "camera-insecure"
  | "camera-model"
  | "load"
  | "webgl";

interface TroubleWords {
  icon: string;
  title: string;
  body: string;
  /** What to say instead when the room had a relay, and players need not share a Wi-Fi (net/ice.ts). */
  relayed?: string;
}

export const TROUBLES: Record<TroubleKind, TroubleWords> = {
  "not-found": {
    icon: "exclamation",
    title: "No Race Found",
    body: "There’s no race with that code. Check it and try again.",
  },
  full: {
    icon: "exclamation",
    title: "Race Is Full",
    body: "This race is full. Ask the host to make room, or start a race of your own.",
  },
  "host-left": {
    icon: "exclamation",
    title: "Race Ended",
    body: "The host left the race.",
  },
  network: {
    icon: "wifi-off",
    title: "Connection Lost",
    body: "Lost the connection to the race. Make sure everyone is on the same Wi-Fi, then try again.",
    relayed: "Lost the connection to the race. Make sure everyone is online, then try again.",
  },
  unreachable: {
    icon: "wifi-off",
    title: "Can’t Reach the Race",
    body: "The race didn’t answer. Join from the same Wi-Fi as the host, then try again.",
    relayed: "The race didn’t answer. Check your internet connection, then try again.",
  },
  started: {
    icon: "exclamation",
    title: "Race Already Started",
    body: "That race has already started. Ask the host to start another, then join again.",
  },
  version: {
    icon: "exclamation",
    title: "Different Version",
    body: "The host is running a different version of Grip Prix. Reload this page to get the latest, then try again.",
  },
  "camera-denied": {
    icon: "camera",
    title: "Camera Is Off",
    body: "Your browser is blocking the camera for this page. Allow it from the address bar, then Try Again.",
  },
  "camera-busy": {
    icon: "camera",
    title: "Camera Is Busy",
    body: "Your camera is being used by another app. Close it, then Try Again.",
  },
  "camera-missing": {
    icon: "camera",
    title: "No Camera Found",
    body: "Connect a camera, then Try Again. Or drive with the keyboard.",
  },
  "camera-insecure": {
    icon: "camera",
    title: "Camera Unavailable",
    body: "Your browser only shares the camera with secure pages. Open Grip Prix from its https address.",
  },
  "camera-model": {
    icon: "wifi",
    title: "Hand Tracking Didn’t Load",
    body: "The part that sees your hands didn’t arrive. Check your internet connection, then Try Again. Or drive with the keyboard.",
  },
  webgl: {
    icon: "exclamation",
    title: "Can’t Show the Race",
    body: "Your browser can’t draw 3D graphics right now. Close other tabs that use graphics, then Try Again.",
  },
  load: {
    icon: "wifi",
    title: "Couldn’t Load the Race",
    body: "Part of the game didn’t arrive. Check your internet connection, then Try Again.",
  },
};

/** A button on a trouble sheet. The first is the main one; the rest are quieter. */
export interface Fix {
  label: string;
  run(): void;
}

/** Shows a trouble's sheet with these fixes, the first as the main button. */
export function showTrouble(kind: TroubleKind, fixes: readonly Fix[]): void {
  const sheet = $<HTMLDialogElement>("trouble");
  const words = TROUBLES[kind];
  $("trouble-icon").replaceChildren(icon(words.icon));
  setText("trouble-title", words.title);
  setText("trouble-body", words.relayed && relayReady() ? words.relayed : words.body);
  const buttons = fixes.map((fix, i) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `button wide ${i === 0 ? "primary" : "plain"}`;
    button.textContent = fix.label;
    button.addEventListener("click", () => {
      closeTrouble();
      fix.run();
    });
    return button;
  });
  $("trouble-actions").replaceChildren(...buttons);
  // The sheet needs an answer: the way out is one of its buttons, not Escape.
  sheet.oncancel = (event) => event.preventDefault();
  for (const open of document.querySelectorAll<HTMLDialogElement>("dialog[open]")) if (open !== sheet) open.close();
  if (!sheet.open) sheet.showModal();
  buttons[0]?.focus();
}

export function closeTrouble(): void {
  const sheet = $<HTMLDialogElement>("trouble");
  if (sheet.open) sheet.close();
}
