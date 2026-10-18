/**
 * A game's life once it has loaded, one round after another: the aim check
 * in the game's own world (with the hand), play, the pause menu, the results
 * - and Play Again, Restart or Adjust Aim, the next round of the same game.
 * The engine's host draws the world; every frame, the page draws the
 * crosshair over it and watches for a hand or a camera that has gone.
 *
 * The round held for the hand is handHold.ts's, the camera mid-game
 * cameraInPlay.ts's and the scope scopeInPlay.ts's: this is the round they
 * hold, and the one place a session begins and ends.
 */
import { browserStore, loadAim, saveAim } from "../calibration/storage";
import { IDLE_AIM } from "../engine/common";
import { Samples } from "../engine/stats";
import type { Aim, Game, GameContext, GameEntry, GameStats, InputKind, InputSource } from "../engine/types";
import { HandInput } from "../input/handInput";
import type { Matrix } from "../input/homography";
import { MouseInput, TouchInput } from "../input/pointer";
import { scopeKeys, scopeMouse } from "../input/scope";
import { $, announce, setText, toast } from "../ui/dom";
import { AimCheckView } from "./aimCheckView";
import { CameraInPlay } from "./cameraInPlay";
import { HandHold } from "./handHold";
import { FireToPlay, HandWatch } from "./handWatch";
import { controlClass, type Preferences } from "./prefs";
import { recordRound, showResults } from "./results";
import type { ScopeInPlay } from "./scopeInPlay";
import type { PlayPieces, Session } from "./session";
import { closeSheet, closeSheets, openSheet } from "./sheets";
import type { Spot } from "./yielding";

/** How long after the results arrive the world stops drawing under them, ms. */
const RESULTS_SETTLE = 2000;
/** How long the results listen for a fold of the thumb before the camera rests, ms. */
const FIRE_LISTENS = 60_000;

/** What the round asks of the page around it. */
export interface RoundHooks {
  /** The player plays with this from now on, in the arcade too (Use Mouse or Trackpad, mid-game). */
  useControl(control: InputKind): void;
  /** Back to the arcade, on the game just played. */
  back(): void;
  /** The game's address, back in the address bar: the browser's Back, which paused the round, left it behind. */
  restoreAddress(entry: GameEntry): void;
}

/** How an aim check ended: its score, the shots it took, and whether the aim was set or the player played anyway. */
export interface CheckEnding {
  score: number | null;
  shots: number;
  ended: "ready" | "anyway";
}

export class RoundController {
  /** The round held while the hand is gone. */
  readonly hold: HandHold;
  /** The camera going, stalling or switched mid-game. */
  readonly cameraInPlay: CameraInPlay;
  /** How the last aim check ended, for the tests. */
  lastCheck: CheckEnding | null = null;
  /** Camera capture to crosshair drawn, ms: for the performance report. */
  readonly latency = new Samples(600);
  private lastDrawnCapture = 0;
  private session: Session | null = null;

  constructor(
    private readonly pieces: PlayPieces,
    /** The player's settings as chosen, for the difficulty a new round takes up. */
    private readonly preferences: Preferences,
    private readonly scope: ScopeInPlay,
    private readonly hooks: RoundHooks,
  ) {
    this.hold = new HandHold(pieces, () => this.session, (session, now) => this.cameraInPlay.stopped(session, now));
    this.cameraInPlay = new CameraInPlay(pieces, this.hold, scope, {
      current: () => this.session,
      again: (session, adjust) => this.again(session, adjust),
      play: (session, mapping) => this.play(session, mapping),
      pointerHint: (session) => this.pointerHint(session),
      stopListening: (session, rest) => this.stopListening(session, rest),
      useControl: (control) => hooks.useControl(control),
      back: () => hooks.back(),
    });
    const { hud, crosshair } = pieces;
    hud.onGameOver = (stats) => this.roundOver(stats);
    // A game's own reticle (a scope's picture) in place of the page's crosshair.
    hud.onCrosshair = (style) => {
      crosshair.hiddenByGame = style === "none";
      if (style === "none") crosshair.clear();
    };
    // A fallen player has no gun: a crosshair over the death scene read as
    // one still to be fired.
    hud.onPlayerDown = () => {
      crosshair.visible = false;
      crosshair.clear();
      // The death plays out as it is: no waiting for a hand that has nothing left to do.
      if (this.session) this.session.down = true;
      hud.pageHint(null);
    };
  }

  /** The game in play, if there is one. */
  get current(): Session | null {
    return this.session;
  }

  /** A game, loaded, begins its session: its input, its scope, the camera read, and its first round. */
  begin(entry: GameEntry, game: Game, context: GameContext, adjust: boolean): void {
    const { camera, pip } = this.pieces;
    const host = this.pieces.host()!;
    const control = context.input ?? "hand";
    const stage = $("stage");
    const viewport = () => ({ width: stage.clientWidth, height: stage.clientHeight });
    let input: InputSource & { reset(): void };
    let hand: HandInput | null = null;
    const scope = this.scope.forGame(entry, control);
    if (control === "hand") {
      hand = new HandInput(camera.source(), viewport, undefined, scope);
      input = hand;
    } else {
      input = control === "touch" ? new TouchInput(stage, scope) : new MouseInput(stage, scope);
      pip.hide();
    }
    const session: Session = {
      entry,
      game,
      context,
      control,
      input,
      hand,
      check: null,
      phase: "loading",
      paused: false,
      held: false,
      troubled: false,
      down: false,
      idle: false,
      watch: new HandWatch(performance.now()),
      camera: hand ? camera.identity() : null,
      unsubscribe: () => {},
      lostSince: null,
      noteUntil: 0,
      result: null,
      fire: null,
      timers: [],
      scope,
      // Shift scopes in every game with a scope; the right button too, with the hand (a pointer does it itself).
      stopScopeKeys: scope ? scopeKeys(scope) : () => {},
      stopScopeMouse: scope && control === "hand" ? scopeMouse(scope, stage) : () => {},
      scoped: false,
      faceAway: null,
    };
    if (hand) {
      session.unsubscribe = camera.source().subscribe((frame) => {
        camera.frameAt = performance.now();
        pip.draw(frame, camera.frameAt);
      });
      pip.show(!camera.scripted);
    }
    this.session = session;
    this.scope.apply(session);
    if (hand) camera.start();
    void this.cameraInPlay.refresh();
    host.setGame(game);
    host.onFrame = ({ now, aim }) => this.frame(session, now, aim);
    this.round(session, adjust);
    host.start();
    requestAnimationFrame(() => ($("game").dataset.ready = "true"));
  }

  /** A round of the session's game: the aim check first with the hand, then play. */
  private round(session: Session, adjust: boolean): void {
    const host = this.pieces.host()!;
    const hand = session.hand;
    const camera = session.camera;
    if (hand && camera) {
      const stage = $("stage");
      const saved = adjust ? null : loadAim(browserStore(), camera, session.entry.id);
      session.phase = "check";
      session.check = new AimCheckView({
        stage: session.game.calibration,
        input: hand,
        saved,
        viewport: () => ({ width: stage.clientWidth, height: stage.clientHeight }),
        reducedMotion: () => this.pieces.settings.reducedMotion,
        onDone: (mapping, score) => {
          this.lastCheck = { score, shots: session.check?.check.shots ?? 0, ended: "ready" };
          if (!saveAim(browserStore(), camera, mapping, Date.now(), session.entry.id)) toast("This window can’t save your aim. It works until you close it.");
          this.play(session, mapping);
        },
        onPlayAnyway: (mapping) => {
          const check = session.check?.check;
          this.lastCheck = { score: check?.measure.score ?? null, shots: check?.shots ?? 0, ended: "anyway" };
          this.play(session, mapping);
          // The crosshair has not been shown yet: it appears with the game, and the hint says what it is.
          if (this.session !== session || session.phase !== "play") return;
          // Said as the page's own hint (see frame): the game's first tips, on the game's line, would take the words away at once.
          session.noteUntil = performance.now() + 3500;
        },
      });
      // The check judges its shots; the game sees them too, to answer with
      // the gun's sound and smoke (it scores nothing before start()). While
      // the aim is learned the game is told it rests on the lit target (see
      // AimCheckView.aimFor): nothing it draws follows the unfinished aim.
      host.aim = (now) => {
        const aim = hand.sample(now);
        return session.check ? session.check.aimFor(aim) : aim;
      };
      announce(`${session.entry.title}. Aim setup. ${session.check.spoken}`);
    } else {
      host.aim = (now) => session.input.sample(now);
      this.play(session, null);
    }
    $("game").dataset.phase = session.phase;
  }

  private play(session: Session, mapping: Matrix | null): void {
    // Once: the check's ready moment may end after the round already began
    // (the player switched to the mouse under it).
    if (this.session !== session || session.phase === "play") return;
    session.check?.dispose();
    session.check = null;
    if (mapping && session.hand) session.hand.setMapping(mapping);
    session.phase = "play";
    $("game").dataset.phase = "play";
    session.game.start();
    session.watch.watch(performance.now());
    this.pieces.host()!.aim = (now) => session.input.sample(now);
    this.pieces.crosshair.visible = true;
    if (session.control !== "hand") this.pointerHint(session);
  }

  /** How a pointer fires, said for the first seconds with it. */
  private pointerHint(session: Session): void {
    const words = session.control === "touch" ? "Tap to fire." : "Click to fire.";
    this.pieces.hud.hint(words);
    // Only these words go: the game's first tip, said over them, keeps its full time.
    window.setTimeout(() => this.session === session && this.pieces.hud.unsay(words), 3500);
  }

  /** Every animation frame, after the game has drawn. */
  private frame(session: Session, now: number, aim: Aim): void {
    const { crosshair, hud, yielding } = this.pieces;
    if (session.phase === "check" && session.check) {
      session.check.frame();
      crosshair.visible = session.check.showsCrosshair;
    }
    const stage = $("stage");
    const [width, height] = [stage.clientWidth, stage.clientHeight];
    const lit = session.check && !session.check.done ? session.check.check.lit : null;
    const target = lit ? { x: lit.x * width, y: lit.y * height, r: lit.radius * Math.min(width, height) } : null;
    crosshair.draw(aim, now, target);
    // The corners' chrome steps aside for what the player is aiming at.
    const spots: Spot[] = [];
    if (crosshair.visible && aim.tracking && !aim.offscreen) spots.push({ x: aim.x * width, y: aim.y * height, r: 28 });
    if (target) spots.push(target);
    yielding.update(spots);
    this.scope.watch(session, now, aim);
    // How long a camera frame takes to reach the crosshair: from its capture
    // to the moment the crosshair is drawn from it (the screen shows that
    // frame at the next vsync). Measured on the clock, not the frame's own
    // timestamp, which is taken before a frame's work begins.
    if (aim.tracking && aim.capturedAt !== this.lastDrawnCapture) {
      this.lastDrawnCapture = aim.capturedAt;
      if (aim.capturedAt > 0) this.latency.push(performance.now() - aim.capturedAt);
    }
    if (this.cameraInPlay.stopped(session, now)) return;
    if (session.phase === "play" && session.control === "hand" && !session.down) {
      // A hand lost in play is said after a moment - unless it left the
      // picture across an edge, which is the reload - and a hand gone for
      // longer holds the round until it is back (see handHold.ts).
      if (!aim.tracking && !aim.offscreen) session.lostSince ??= now;
      else session.lostSince = null;
      const note = now < session.noteUntil ? "The crosshair now follows your finger." : null;
      hud.pageHint(session.lostSince !== null && now - session.lostSince > 600 ? "Show your hand to the camera." : (this.scope.faceAwayHint(session, now) ?? note));
      const event = session.watch.update(now, aim.tracking);
      if (event) this.hold.answer(session, event);
    }
  }

  // --- the pause menu ----------------------------------------------------------------------

  pause(): void {
    const session = this.session;
    if (!session || session.paused || session.troubled || session.phase === "over" || session.phase === "loading") return;
    session.paused = true;
    // Paused while waiting for the hand: the menu takes the hold's place,
    // and Resume brings the wait back.
    this.hold.stop(session);
    this.pieces.host()?.pause();
    this.pieces.camera.stop();
    this.pieces.crosshair.clear();
    // A paused game is not looking for the hand: nothing asks for it.
    this.pieces.hud.pageHint(null);
    session.lostSince = null;
    this.pieces.pip.calm();
    $("adjust-aim").hidden = session.control !== "hand";
    this.cameraInPlay.showSwitch();
    void this.cameraInPlay.refresh();
    setText("pause-title", "Paused");
    openSheet("pause-sheet");
    $("resume").focus();
    announce("Paused");
  }

  resume(): void {
    const session = this.session;
    closeSheet("pause-sheet");
    if (!session || !session.paused) return;
    session.paused = false;
    // Paused by the browser's Back, the round left its address behind: it
    // comes back with the round, so the next Back pauses again rather than
    // leaving the page.
    this.hooks.restoreAddress(session.entry);
    // Nothing held from before the pause: no stale fold fires on return.
    session.input.reset();
    this.pieces.camera.start();
    $("game").focus();
    // With the hand, play does not drop the player straight back into the
    // fight: it waits to see the hand, and counts them in. The mouse is
    // where it was, and the aim check and the fall have nothing to wait for.
    if (session.control === "hand" && session.phase === "play" && !session.down) {
      this.hold.waitForHand(session);
      return;
    }
    this.pieces.host()?.resume();
  }

  // --- the results ---------------------------------------------------------------------------

  /** The game has ended: its record is weighed and kept at once, then the results follow. */
  private roundOver(stats: GameStats): void {
    const session = this.session;
    if (session && session.phase !== "over") {
      recordRound(session.entry, stats, { difficulty: this.pieces.settings.difficulty, control: controlClass(session.control) });
    }
    this.gameOver(stats);
    this.syncDifficulty();
  }

  private gameOver(stats: GameStats): void {
    const session = this.session;
    if (!session || session.phase === "over") return;
    const { settings } = this.pieces;
    this.hold.stop(session);
    session.phase = "over";
    $("game").dataset.phase = "over";
    this.pieces.crosshair.visible = false;
    this.pieces.hud.pageHint(null);
    // With the hand, the camera goes on reading under the results, so a fold
    // of the thumb can play again.
    if (session.control !== "hand") this.pieces.camera.stop();
    // The world plays out its last moment before the card arrives.
    this.later(session, settings.reducedMotion ? 400 : 1200, () => {
      session.result = showResults(session.entry, stats, settings.reducedMotion);
      this.listenForFire(session);
      // Once the world has played out under the card, it stops drawing:
      // the last frame stays, and nothing is spent on a view no one plays.
      this.later(session, RESULTS_SETTLE, () => {
        this.pieces.host()?.stop();
        session.idle = true;
      });
    });
  }

  /** A timer for this round's results, dropped if the round moves on first. */
  private later(session: Session, ms: number, run: () => void): void {
    const timer = window.setTimeout(() => {
      session.timers = session.timers.filter((t) => t !== timer);
      if (this.session === session && session.phase === "over") run();
    }, ms);
    session.timers.push(timer);
  }

  /**
   * Play Again with the hand: while the results are up, a deliberate fold
   * of the thumb presses it (see FireToPlay). The card says so, only to a
   * hand player; after a minute of no one playing the camera rests.
   */
  private listenForFire(session: Session): void {
    const hand = session.hand;
    const line = $("results-fire");
    if (!hand || !this.pieces.camera.tracking) {
      line.hidden = true;
      return;
    }
    line.hidden = false;
    const fire = new FireToPlay(performance.now());
    session.fire = fire;
    hand.onReading = (reading) => {
      const shot = fire.observe(performance.now(), {
        seen: reading.position !== null,
        armed: reading.armed,
        travel: reading.travel,
        fired: reading.fired,
      });
      if (!shot || session.fire !== fire || !$<HTMLDialogElement>("results").open) return;
      this.stopListening(session, false);
      $("again").click();
    };
    this.later(session, FIRE_LISTENS, () => this.stopListening(session, true));
  }

  /** The results stop listening for a fold; `rest` puts the camera to rest too. */
  private stopListening(session: Session, rest: boolean): void {
    session.fire = null;
    if (session.hand) session.hand.onReading = null;
    $("results-fire").hidden = true;
    if (rest) this.pieces.camera.stop();
  }

  // --- the next round, and the end -----------------------------------------------------------

  /** The next round on the same game: Play Again, Restart, Adjust Aim, a new camera. */
  again(session: Session, adjust: boolean): void {
    const { camera, crosshair, hud, pip, settings } = this.pieces;
    closeSheets();
    this.hold.stop(session);
    for (const timer of session.timers.splice(0)) window.clearTimeout(timer);
    this.stopListening(session, false);
    session.check?.dispose();
    session.check = null;
    session.result = null;
    session.lostSince = null;
    session.troubled = false;
    session.down = false;
    session.idle = false;
    session.phase = "loading";
    session.input.reset();
    hud.reset(settings.unlocks.has("golden"));
    crosshair.visible = false;
    crosshair.clear();
    if (session.hand) pip.show(!camera.scripted);
    // With the mouse there is no check to call begin(): the game hears of
    // its new round from begin() all the same, then start().
    if (!session.hand) session.game.calibration.begin?.();
    this.round(session, adjust);
    camera.start();
    // Whatever stopped the world - the pause menu, the camera's trouble, the
    // results left a while - it runs again for the new round.
    session.paused = false;
    this.pieces.host()!.resume();
    $("game").focus();
  }

  /** The session ends: its game is put away, and the game's view is left as a new game will want it. */
  end(): void {
    const { camera, crosshair, hud, pip, settings, yielding } = this.pieces;
    const session = this.session;
    this.session = null;
    if (session) {
      this.hold.stop(session);
      for (const timer of session.timers.splice(0)) window.clearTimeout(timer);
      this.stopListening(session, false);
      session.check?.dispose();
      session.stopScopeKeys();
      session.stopScopeMouse();
      session.unsubscribe();
      session.input.dispose();
      session.game.dispose();
    }
    const host = this.pieces.host();
    if (host) {
      host.stop();
      host.onFrame = null;
      host.aim = () => IDLE_AIM;
      host.setGame(null);
    }
    camera.stop();
    this.scope.stop();
    crosshair.visible = false;
    crosshair.hiddenByGame = false;
    crosshair.clear();
    pip.hide();
    yielding.reset();
    hud.reset(settings.unlocks.has("golden"));
    closeSheets();
  }

  /**
   * The difficulty the game reads at start(). While a round is in play it
   * stays the one that round began with, so its record is kept under the
   * difficulty it was played at; a new choice takes over when the round ends
   * or a new one begins (`now`).
   */
  syncDifficulty(now = false): void {
    if (now || this.session?.phase !== "play") this.pieces.settings.difficulty = this.preferences.difficulty;
  }
}
