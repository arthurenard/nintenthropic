/**
 * The camera in the middle of a game. A camera that ends (unplugged, or taken
 * by the system), or runs without a new frame for three seconds, freezes the
 * round under a sheet: Try Again (the same camera keeps the round and its
 * aim; another starts afresh with its own aim check), Use Mouse or Trackpad
 * (the same round goes on with the pointer), or Choose a Game.
 *
 * Switch Camera, on the camera's picture and in the pause menu, moves to the
 * next camera at once (cameraSwitch.ts takes the steps), and the new camera
 * gets an aim check of its own.
 */
import type { InputKind } from "../engine/types";
import type { Matrix } from "../input/homography";
import { MouseInput, TouchInput } from "../input/pointer";
import { CameraError, chooseCamera, listCameras } from "../tracking/camera";
import { $, announce, toast } from "../ui/dom";
import { touchOnly } from "../ui/touch";
import { switchCamera } from "./cameraSwitch";
import type { HandHold } from "./handHold";
import type { ScopeInPlay } from "./scopeInPlay";
import type { PlayPieces, Session } from "./session";
import { showTrouble, type Fix, type Trouble } from "./sheets";

/** No new camera frame for this long, with the camera running, is a camera that has stopped, ms. */
const CAMERA_STALL = 3000;

/** What the camera's troubles do to the round in play (round.ts), and to the page around it. */
export interface RoundMoves {
  /** The game in play, if there is one. */
  current(): Session | null;
  /** The next round of the same game, through its aim check. */
  again(session: Session, adjust: boolean): void;
  /** Play begins: the aim check, if one is running, is left behind. */
  play(session: Session, mapping: Matrix | null): void;
  /** How a pointer fires, said for the first seconds with it. */
  pointerHint(session: Session): void;
  /** The results stop listening for a fold of the thumb; `rest` puts the camera to rest too. */
  stopListening(session: Session, rest: boolean): void;
  /** The player plays with this from now on, in the arcade too. */
  useControl(control: InputKind): void;
  /** Back to the arcade. */
  back(): void;
}

export class CameraInPlay {
  /** A switch to another camera is under way: the gap with no camera is not a camera that has gone. */
  private switching = false;

  constructor(
    private readonly pieces: PlayPieces,
    private readonly hold: HandHold,
    private readonly scope: ScopeInPlay,
    private readonly round: RoundMoves,
  ) {}

  /**
   * The camera went (unplugged, or taken by the system) during a game. The
   * round is not lost with it: it freezes under a sheet that offers the
   * camera again, the mouse, or the arcade. On the results there is nothing
   * to freeze, only a fold of the thumb that can no longer be seen.
   */
  ended(): void {
    const session = this.round.current();
    if (!session || session.control !== "hand" || this.switching) return;
    if (session.phase === "over") this.round.stopListening(session, true);
    else if (session.phase === "check" || session.phase === "play") this.freeze(session, "stopped");
  }

  /**
   * A hand game whose camera is gone, or running but silent for three
   * seconds (asleep, covered by the system, a driver that gave up), cannot
   * be played: said at once, with the round frozen. Returns whether it was.
   */
  stopped(session: Session, now: number): boolean {
    const camera = this.pieces.camera;
    if (session.control !== "hand" || session.troubled || session.paused || this.switching) return false;
    if (session.phase !== "check" && session.phase !== "play") return false;
    if (!camera.scripted && !camera.camera) {
      this.freeze(session, "stopped");
      return true;
    }
    if (camera.tracking && now - camera.lastFrameAt() > CAMERA_STALL) {
      this.freeze(session, "stalled");
      return true;
    }
    return false;
  }

  /** The round frozen under the camera's trouble, with the fixes that keep it. */
  freeze(session: Session, kind: Trouble): void {
    const { crosshair, hud, pip } = this.pieces;
    this.hold.stop(session);
    session.troubled = true;
    session.paused = false; // the sheet replaces the pause menu, if it was up
    this.pieces.host()?.pause();
    this.pieces.camera.stop();
    crosshair.visible = false;
    crosshair.clear();
    hud.pageHint(null);
    pip.calm();
    this.hold.show("wait");
    const fixes: Record<Fix, () => void> = {
      "Try Again": () => void this.reopen(session),
      "Use Mouse or Trackpad": () => this.continueWithPointer(session),
      "Choose a Game": () => this.round.back(),
      Reload: () => location.reload(),
    };
    // The sheet is a dialog: opening it says its title and words to a screen reader.
    showTrouble(kind, fixes, { secondary: "Use Mouse or Trackpad", tertiary: "Choose a Game" });
  }

  /**
   * Try Again, mid-game: the camera once more. The same camera keeps the
   * round and its aim - back through the wait for the hand and the count;
   * another camera needs its own aim, so the round starts afresh with the
   * aim check.
   */
  private async reopen(session: Session): Promise<void> {
    const camera = this.pieces.camera;
    if (this.round.current() !== session) return;
    const before = session.camera;
    camera.release();
    try {
      if (!camera.scripted) await camera.open();
    } catch (error) {
      if (this.round.current() !== session) return;
      console.warn("The camera could not be opened again.", error);
      this.freeze(session, error instanceof CameraError ? error.trouble : "busy");
      return;
    }
    if (this.round.current() !== session) return;
    session.troubled = false;
    const current = camera.identity();
    // A round begun with no camera at all (it went while the game loaded) has
    // no aim yet either: like another camera, it starts afresh with its check.
    if (current && (!before || current.deviceId !== before.deviceId || current.width !== before.width || current.height !== before.height)) {
      session.camera = current;
      this.round.again(session, false);
      return;
    }
    camera.start();
    if (session.phase === "play" && !session.down) {
      this.hold.waitForHand(session);
    } else {
      this.hold.show(null);
      this.pieces.crosshair.visible = session.phase === "play" && !session.down;
      this.pieces.host()?.resume();
    }
    $("game").focus();
  }

  /**
   * Use Mouse or Trackpad, mid-game: the same round goes on with the
   * pointer. The camera is put away, the preview goes, and the game's hints
   * now speak of clicks. An aim check still running has nothing left to
   * check: the round begins.
   */
  private continueWithPointer(session: Session): void {
    if (this.round.current() !== session) return;
    const control: InputKind = touchOnly() ? "touch" : "mouse";
    this.round.useControl(control);
    this.pieces.camera.stop();
    this.pieces.camera.release();
    session.unsubscribe();
    session.unsubscribe = () => {};
    session.check?.dispose();
    session.input.dispose();
    // The pointer's own input takes the right button from here.
    session.stopScopeMouse();
    session.stopScopeMouse = () => {};
    const stage = $("stage");
    session.scope?.reset();
    session.input = control === "touch" ? new TouchInput(stage, session.scope) : new MouseInput(stage, session.scope);
    session.hand = null;
    session.camera = null;
    session.control = control;
    session.context.input = control;
    this.scope.apply(session);
    session.troubled = false;
    session.lostSince = null;
    this.pieces.pip.hide();
    this.hold.show(null);
    this.showSwitch();
    $("game").dataset.input = control;
    if (session.phase === "check") {
      // The stage is cleared once: a check already done has cleared it.
      if (!session.check?.done) {
        session.game.calibration.light(null);
        session.game.calibration.done();
      }
      this.round.play(session, null);
    } else {
      this.pieces.crosshair.visible = !session.down;
      this.round.pointerHint(session);
    }
    const host = this.pieces.host()!;
    host.aim = (now) => session.input.sample(now);
    host.resume();
    $("game").focus();
  }

  // --- Switch Camera ---------------------------------------------------------------------------

  /** The cameras the browser lists now; Switch Camera shows while there is more than one to choose from. */
  async refresh(): Promise<void> {
    await this.pieces.camera.refresh();
    this.showSwitch();
  }

  /** The two Switch Camera controls - on the camera's picture, and in the pause menu - shown only for a hand player with two or more cameras. */
  showSwitch(): void {
    const show = this.pieces.camera.cameras.length >= 2 && this.round.current()?.control === "hand";
    for (const id of ["switch-camera", "pause-switch-camera"]) {
      const button = $<HTMLButtonElement>(id);
      button.hidden = !show;
      button.disabled = this.switching;
    }
  }

  /**
   * Switch Camera: the next camera at once, the old one let go. The aim check
   * begins again for the new camera - from its saved aim when it has one -
   * and a round already begun starts afresh under it, as it does for any other
   * camera. The new camera is named, calmly.
   */
  async switchCamera(): Promise<void> {
    const camera = this.pieces.camera;
    const session = this.round.current();
    if (!session || session.control !== "hand" || session.troubled || this.switching) return;
    // In the aim check, or from the pause menu; not through the ready moment or the results.
    if (session.phase === "check" ? session.check?.done : !session.paused) return;
    this.switching = true;
    // A keyboard player pressing the button on the picture keeps it in hand, for the next camera.
    const keepFocus = document.activeElement === $("switch-camera");
    this.showSwitch();
    const scripted = camera.scripted;
    const before = session.camera;
    camera.stop();
    const result = await switchCamera({
      cameras: () => listCameras(),
      inUse: () => camera.inUse(),
      release: () => camera.release(),
      open: async () => {
        if (scripted) return scripted.deviceId;
        await camera.open();
        return camera.inUse() ?? "";
      },
      choose: (deviceId) => {
        chooseCamera(deviceId);
        if (scripted) scripted.deviceId = deviceId;
      },
    });
    this.switching = false;
    this.showSwitch();
    if (this.round.current() !== session) {
      // The player left while the camera was opening: it is not wanted now.
      camera.release();
      return;
    }
    void this.refresh();
    // Tracking goes on, unless the round is paused (Resume starts it).
    const carryOn = () => {
      if (!session.paused) camera.start();
    };
    switch (result.kind) {
      case "none":
        carryOn();
        return;
      case "failed":
        this.freeze(session, result.trouble);
        return;
      case "kept":
        toast(`Couldn’t switch to ${result.wanted.label}. Another app may be using it.`, { icon: "exclamation" });
        carryOn();
        return;
      case "switched": {
        toast(result.camera.label, { icon: "camera" });
        const current = camera.identity();
        if (before && current && current.deviceId === before.deviceId && current.width === before.width && current.height === before.height) {
          carryOn(); // the same camera came back (the next one had gone): the round carries on
          return;
        }
        session.camera = current;
        this.round.again(session, false);
        if (keepFocus) $("switch-camera").focus();
        announce(`Switched to ${result.camera.label}. Aim setup. ${session.check?.spoken ?? ""}`);
      }
    }
  }
}
