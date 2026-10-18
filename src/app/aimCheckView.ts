/**
 * The aim check's screen, around the logic in src/calibration: it lights the
 * game's targets, feeds the check each camera frame, takes each target as it
 * is shot, fills a calm ring as the aim is learned, and ends on the moment
 * "Aim Set - the crosshair now follows your finger" before the game begins.
 *
 * The player points their finger at the lit target; the game learns where that
 * is. So the crosshair is not shown while the aim is being learned - an
 * unfinished crosshair is only wrong, and a player who sees it steers it onto
 * the targets instead of pointing - and nothing the game draws follows the
 * unfinished aim either (see aimFor). The crosshair arrives with the "Aim Set"
 * moment, already right, and stays for play.
 */
import { AimCheck, FramingHelp, type Framing, type ShotEvent } from "../calibration/aimCheck";
import { READY_SCORE } from "../calibration/score";
import type { Aim, CalibrationStage } from "../engine/types";
import { DEFAULT_MAPPING } from "../input/aim";
import type { HandInput, HandReading } from "../input/handInput";
import type { Matrix } from "../input/homography";
import { $, announce, element, icon, replay, setText } from "../ui/dom";

const RING = 2 * Math.PI * 18;
/** How long the ready moment holds before the game starts, ms. */
export const READY_MOMENT = 1500;

export interface AimCheckViewOptions {
  /**
   * The game's targets. The stage answers each shot in its own world - a
   * bottle breaking with its ting, dust where a miss lands - and plays the
   * check's closing flourish when it is told done(), so the page adds no
   * sound of its own that would ring twice.
   */
  stage: CalibrationStage;
  input: HandInput;
  saved: Matrix | null;
  viewport: () => { width: number; height: number };
  /** The check reached 95%: save this aim and start the game. */
  onDone: (mapping: Matrix, score: number) => void;
  /** The player chose to play below 95%. */
  onPlayAnyway: (mapping: Matrix | null) => void;
  reducedMotion: () => boolean;
}

export class AimCheckView {
  check: AimCheck;
  private lit: string | null = null;
  private version = 0;
  private reading: HandReading | null = null;
  /** Live framing help for the pill, from what the camera sees (held a second, so it never flickers). */
  private readonly framing = new FramingHelp();
  private help: Framing = null;
  private finished = false;
  /** The stage has been asked to stand its targets up again since they ran out. */
  private restood = false;
  /** The ready moment's timer: a check put away (Restart, Switch Camera) must not start the game later. */
  private readyTimer = 0;
  /** Where the game is told the aim rests while it is learned: the lit target (the last one, or the middle, with none). */
  private rest: [number, number] = [0.5, 0.5];
  private readonly cleanups: (() => void)[] = [];

  constructor(private readonly options: AimCheckViewOptions) {
    // Every target stands, whatever the last round left broken.
    options.stage.begin?.();
    this.check = this.fresh(options.saved);
    options.input.onReading = (reading) => this.observe(reading);
    const startOver = $("start-over");
    const playAnyway = $("play-anyway");
    const restart = () => this.startOver();
    const anyway = () => this.playAnyway();
    startOver.addEventListener("click", restart);
    playAnyway.addEventListener("click", anyway);
    this.cleanups.push(
      () => startOver.removeEventListener("click", restart),
      () => playAnyway.removeEventListener("click", anyway),
    );
    this.render(true);
  }

  /**
   * Whether the page draws the crosshair: not while the aim is being
   * learned (it would be wrong, and it would be chased), only from the
   * moment it is set, over "Aim Set", to follow the finger from there.
   */
  get showsCrosshair(): boolean {
    return this.finished && this.check.mapping !== null;
  }

  /** What a screen reader hears of the card: its title and its line. */
  get spoken(): string {
    return `${this.check.words.title}. ${this.check.words.detail}`;
  }

  /**
   * The aim the game is given. While the aim is learned the game's own
   * picture of it (the flashlight's beam, the rifle's sway, a laser's
   * shot) rests on the lit target instead of following the unfinished aim -
   * the shot is where the finger pointed, and the game answers it there - and
   * the shot is never "off the screen". Once the aim is set it is the real one.
   */
  aimFor(aim: Aim): Aim {
    if (this.finished) return aim;
    const lit = this.check.lit;
    if (lit) this.rest = [lit.x, lit.y];
    return { ...aim, x: this.rest[0], y: this.rest[1], offscreen: false };
  }

  get done(): boolean {
    return this.finished;
  }

  private fresh(saved: Matrix | null): AimCheck {
    const { width, height } = this.options.viewport();
    const noun = this.options.stage.noun;
    const check = new AimCheck({ saved, targets: this.options.stage.targets(), viewport: { width, height }, ...(noun ? { noun } : {}) });
    this.options.input.setMapping(saved ?? DEFAULT_MAPPING);
    this.version = 0;
    this.lit = null;
    return check;
  }

  /** Every animation frame: follow the targets as the view moves, light the one to shoot. */
  frame(): void {
    if (this.finished) return;
    const { width, height } = this.options.viewport();
    this.check.setViewport(width, height);
    const offered = this.check.canPlayAnyway;
    let targets = this.options.stage.targets();
    // Every target broken before the aim is proven: a stage that can stand
    // them up again does so once, and the check carries on.
    if (!targets.length && this.check.shots > 0 && !this.restood && this.options.stage.begin) {
      this.restood = true;
      this.options.stage.begin();
      targets = this.options.stage.targets();
    }
    if (targets.length) this.restood = false;
    this.check.setTargets(targets);
    if (this.check.canPlayAnyway !== offered) this.render(true);
    const lit = this.check.lit?.id ?? null;
    if (lit !== this.lit) {
      this.lit = lit;
      this.options.stage.light(lit);
    }
    this.renderTrigger();
  }

  private observe(reading: HandReading): void {
    this.reading = reading;
    this.help = this.framing.update(reading.position ? reading.pointer : null, reading.span, reading.frame.capturedAt);
    if (this.finished) return;
    const before = this.check.progress;
    const event = this.check.observe(
      { pointer: reading.pointer, armed: reading.armed, travel: reading.travel, fired: reading.fired, span: reading.span },
      reading.frame.capturedAt / 1000,
    );
    if (this.check.mappingVersion !== this.version && this.check.mapping) {
      this.version = this.check.mappingVersion;
      this.options.input.setMapping(this.check.mapping);
    }
    if (event) this.shot(event, before);
  }

  private shot(event: ShotEvent, before: number): void {
    const stage = this.options.stage;
    // Every shot that counts takes its target, wherever an unfinished map
    // would have put it: the shot is where the finger pointed. How well the
    // aim is learned shows in the ring, never in a landing place to steer by.
    if (event.outcome === "hit" || event.outcome === "miss") {
      stage.hit(event.target.id);
      this.celebrate(event.target.x, event.target.y, event.target.radius);
    }
    this.render(true);
    if (this.check.done && this.check.mapping) {
      this.finished = true;
      // The stage clears (and plays its flourish) with the ready moment,
      // while the game waits for start() a moment later.
      stage.light(null);
      stage.done();
      $("game").dataset.phase = "ready";
      const score = this.check.measure.score ?? 1;
      this.readyMoment(before);
      const mapping = this.check.mapping;
      this.readyTimer = window.setTimeout(() => this.options.onDone(mapping, score), this.options.reducedMotion() ? 900 : READY_MOMENT);
    }
  }

  private startOver(): void {
    if (this.finished) return;
    this.options.stage.begin?.();
    this.check = this.fresh(null);
    this.rest = [0.5, 0.5];
    this.render(true);
    announce(`Starting over. ${this.spoken}`);
  }

  private playAnyway(): void {
    if (this.finished) return;
    this.finished = true;
    this.options.stage.light(null);
    this.options.stage.done();
    this.options.onPlayAnyway(this.check.mapping);
  }

  /** The words, the ring and the buttons. */
  private render(fresh: boolean): void {
    const check = this.check;
    const words = $("check-words");
    if (fresh && $("check-title").textContent !== check.words.title) {
      if (!this.options.reducedMotion()) replay(words, "fresh");
    }
    setText("check-title", check.words.title);
    setText("check-detail", check.words.detail);
    // The ring fills as the aim is learned, and never falls back; the number
    // in it is the shots taken. No percentage: the aim is the game's to learn,
    // not the player's to score.
    const ring = $("check-ring");
    const fill = ring.querySelector<SVGCircleElement>(".fill")!;
    fill.style.strokeDasharray = `${RING}`;
    fill.style.strokeDashoffset = `${RING * (1 - check.progress)}`;
    ring.classList.toggle("ready", check.done);
    $("check-goal").setAttribute("transform", `rotate(${READY_SCORE * 360} 22 22)`);
    setText("check-ring-text", check.shots === 0 ? "–" : String(check.shots));
    setText("check-status", check.done ? "Aim Set" : "Learning Your Aim");
    $("play-anyway").hidden = !check.canPlayAnyway;
    // Start Over has nothing to undo before the first shot.
    $("start-over").hidden = check.shots === 0;
  }

  /**
   * The pill: whether the hand is seen and the gun cocked - or, when the
   * camera has seen a framing problem for a second, what to do about it.
   */
  private renderTrigger(): void {
    const reading = this.reading;
    const state = !reading || !reading.position ? "lost" : this.help ?? (reading.armed ? "ready" : "raise");
    const trigger = $("trigger");
    if (trigger.dataset.state === state) return;
    trigger.dataset.state = state;
    setText(
      trigger.lastElementChild!,
      {
        lost: "Show your hand",
        ready: "Ready to fire",
        raise: "Raise your thumb",
        closer: "Come a little closer",
        back: "Move back a little",
        edge: "Keep your hand in the picture",
      }[state],
    );
  }

  /** A good shot, celebrated where the target hung. */
  private celebrate(x: number, y: number, radius: number): void {
    const { width, height } = this.options.viewport();
    const size = Math.max(40, radius * 2 * Math.min(width, height) * 1.6);
    const ring = element("div", "burst");
    const check = element("div", "burst-check");
    check.append(icon("check"));
    for (const [node, scale] of [
      [ring, 1.25],
      [check, 0.42],
    ] as const) {
      node.style.left = `${x * 100}%`;
      node.style.top = `${y * 100}%`;
      node.style.width = node.style.height = `${Math.max(size * scale, 22)}px`;
      node.addEventListener("animationend", () => node.remove());
      $("bursts").append(node);
    }
  }

  /**
   * "Aim Set: the crosshair now follows your finger." The ring closes from
   * where it stood, and the crosshair appears under it, right.
   */
  private readyMoment(from: number): void {
    const { title, detail } = this.check.words;
    const card = element("div", "ready-moment glass");
    card.setAttribute("role", "status");
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "ring ready");
    svg.setAttribute("viewBox", "0 0 44 44");
    svg.setAttribute("aria-hidden", "true");
    svg.innerHTML =
      `<circle class="track" cx="22" cy="22" r="18"/>` +
      `<circle class="fill" cx="22" cy="22" r="18" transform="rotate(-90 22 22)" style="stroke-dasharray:${RING};stroke-dashoffset:0;--from:${RING * (1 - from)}"/>` +
      `<path class="check" d="M14.5 22.6 19.6 27.6 29.5 16.6" style="stroke-dasharray:40;stroke-dashoffset:0"/>`;
    card.append(svg, element("p", "title1", title), element("p", "body secondary", detail));
    $("moments").append(card);
    window.setTimeout(() => card.remove(), READY_MOMENT + 400);
    announce(`${title}. ${detail}`);
  }

  dispose(): void {
    window.clearTimeout(this.readyTimer);
    this.options.input.onReading = null;
    for (const cleanup of this.cleanups.splice(0)) cleanup();
  }
}
