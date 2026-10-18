/**
 * The game view's own controls: Pause and the pause menu, the hold's Pause
 * Menu, the results' buttons and Share, Full Screen, Switch Camera, the
 * Scope button, what Esc does on each sheet over the game, and the keys a
 * game answers - Esc to pause, P or Space to pause and resume.
 */
import { $, toast } from "../ui/dom";
import { shareResult } from "./results";
import type { RoundController } from "./round";
import type { ScopeInPlay } from "./scopeInPlay";

/** What the game view's controls ask of the page, beyond the round itself. */
export interface GameViewActions {
  /** A new round of the same game (`adjust`: with a fresh aim check). */
  restart(adjust: boolean): void;
  /** Back to the arcade. */
  back(): void;
  /** Settings, over the pause menu. */
  openSettings(): void;
}

export function wireGameView(round: RoundController, scope: ScopeInPlay, page: GameViewActions): void {
  $("pause").onclick = () => round.pause();
  $("resume").onclick = () => round.resume();
  $("pause-settings").onclick = () => page.openSettings();
  // A new round from the pause sheet plays at the difficulty chosen now.
  $("restart").onclick = () => {
    round.syncDifficulty(true);
    page.restart(false);
  };
  $("adjust-aim").onclick = () => {
    round.syncDifficulty(true);
    page.restart(true);
  };
  $("choose-game").onclick = () => page.back();
  $("choose").onclick = () => page.back();
  $("again").onclick = () => page.restart(false);
  $("loading-cancel").onclick = () => page.back();
  $("share").onclick = async () => {
    const result = round.current?.result;
    if (!result) return;
    const button = $<HTMLButtonElement>("share");
    button.disabled = true;
    try {
      await shareResult(result);
    } finally {
      button.disabled = false;
    }
  };
  $("fullscreen").onclick = () => {
    const request = document.fullscreenElement ? document.exitFullscreen() : $("game").requestFullscreen?.();
    request?.catch(() => toast("Full screen isn’t available here."));
  };
  // The game going full screen is drawn over everything shown before it -
  // the pause sheet its button is on included, which would leave a frozen
  // game and no menu: the sheet is shown again, over it.
  document.addEventListener("fullscreenchange", () => {
    const sheet = $<HTMLDialogElement>("pause-sheet");
    if (!document.fullscreenElement || !sheet.open) return;
    const focused = document.activeElement;
    sheet.close();
    sheet.showModal();
    if (focused instanceof HTMLElement) focused.focus();
  });
  // Esc on a sheet over the game: the pause sheet resumes; results and
  // trouble stay until the player chooses; loading goes back to the arcade.
  $("pause-sheet").addEventListener("cancel", (event) => {
    event.preventDefault();
    round.resume();
  });
  $("results").addEventListener("cancel", (event) => event.preventDefault());
  // A camera's trouble mid-game holds the round: it stays until the player chooses.
  $("alert").addEventListener("cancel", (event) => {
    if (round.current?.troubled) event.preventDefault();
  });
  $("hold-menu").onclick = () => round.pause();
  for (const id of ["switch-camera", "pause-switch-camera"]) $(id).onclick = () => void round.cameraInPlay.switchCamera();
  navigator.mediaDevices?.addEventListener?.("devicechange", () => void round.cameraInPlay.refresh());
  scope.wireButton();
  $("loading").addEventListener("cancel", (event) => {
    event.preventDefault();
    page.back();
  });
  window.addEventListener("keydown", (event) => gameKey(round, event));
}

/** The keys a game answers: Esc pauses; P and Space pause and resume. */
function gameKey(round: RoundController, event: KeyboardEvent): void {
  const target = event.target as HTMLElement | null;
  if (target && ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName)) return;
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  const session = round.current;
  if (!session || document.body.dataset.view !== "game" || session.phase === "over" || session.troubled) return;
  // Space presses a focused button, as it always does.
  if (key === " " && target?.tagName === "BUTTON") return;
  if (event.repeat) return;
  if (key === "Escape") {
    // On the pause sheet Esc is the sheet's own cancel, which resumes.
    if (!session.paused) {
      event.preventDefault();
      round.pause();
    }
  } else if (key === "p" || key === " ") {
    event.preventDefault();
    if (session.paused) round.resume();
    else round.pause();
  }
}
