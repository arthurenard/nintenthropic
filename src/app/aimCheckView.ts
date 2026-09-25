/**
 * The aim check's screen, around the logic in src/calibration: it lights the
 * game's targets, feeds the check each camera frame, shows the live aim ring
 * filling toward 95%, celebrates each good shot where it landed, and ends on
 * the moment "Aim 97% - you're ready" before the game begins.
 */
import { AimCheck, type ShotEvent } from "../calibration/aimCheck";
import { READY_SCORE } from "../calibration/score";
import type { CalibrationStage } from "../engine/types";
import { DEFAULT_MAPPING } from "../input/aim";
import type { HandInput, HandReading } from "../input/handInput";
import type { Matrix } from "../input/homography";
import { $, announce, element, icon, replay, setText } from "../ui/dom";

const RING = 2 * Math.PI * 18;
/** How long the ready moment holds before the game starts, ms. */
export const READY_MOMENT = 1500;

export interface AimCheckViewOptions {
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
  private finished = false;
  private readonly cleanups: (() => void)[] = [];

  constructor(private readonly options: AimCheckViewOptions) {
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

  /** Whether the crosshair has a map to be drawn with. */
  get showsCrosshair(): boolean {
    return this.check.mapping !== null && !this.finished;
  }

  get done(): boolean {
    return this.finished;
  }

  private fresh(saved: Matrix | null): AimCheck {
    const { width, height } = this.options.viewport();
    const check = new AimCheck({ saved, targets: this.options.stage.targets(), viewport: { width, height } });
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
    this.check.setTargets(this.options.stage.targets());
    const lit = this.check.lit?.id ?? null;
    if (lit !== this.lit) {
      this.lit = lit;
      this.options.stage.light(lit);
    }
    this.renderTrigger();
  }

  private observe(reading: HandReading): void {
    this.reading = reading;
    if (this.finished) return;
    const event = this.check.observe(
      { pointer: reading.pointer, armed: reading.armed, travel: reading.travel, fired: reading.fired, span: reading.span },
      reading.frame.capturedAt / 1000,
    );
    if (this.check.mappingVersion !== this.version && this.check.mapping) {
      this.version = this.check.mappingVersion;
      this.options.input.setMapping(this.check.mapping);
    }
    if (event) this.shot(event);
  }

  private shot(event: ShotEvent): void {
    const stage = this.options.stage;
    if (event.outcome === "hit") {
      stage.hit(event.target.id);
      this.celebrate(event.target.x, event.target.y, event.target.radius);
    } else if (event.outcome === "miss" && event.landed) {
      stage.miss(event.target.id, event.landed[0], event.landed[1]);
    }
    this.render(true);
    if (this.check.done && this.check.mapping) {
      this.finished = true;
      stage.light(null);
      const score = this.check.measure.score ?? 1;
      this.readyMoment(score);
      const mapping = this.check.mapping;
      window.setTimeout(() => this.options.onDone(mapping, score), this.options.reducedMotion() ? 900 : READY_MOMENT);
    }
  }

  private startOver(): void {
    if (this.finished) return;
    this.check = this.fresh(null);
    this.render(true);
    announce("Starting over. Shoot the lit target.");
  }

  private playAnyway(): void {
    if (this.finished) return;
    this.finished = true;
    this.options.stage.light(null);
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
    const score = check.measure.score;
    const ring = $("check-ring");
    const fill = ring.querySelector<SVGCircleElement>(".fill")!;
    fill.style.strokeDasharray = `${RING}`;
    fill.style.strokeDashoffset = `${RING * (1 - (score ?? 0))}`;
    ring.classList.toggle("ready", check.done);
    $("check-goal").setAttribute("transform", `rotate(${READY_SCORE * 360} 22 22)`);
    setText("check-ring-text", score === null ? "–" : `${Math.round(score * 100)}`);
    setText("check-status", check.done ? "Ready" : score === null ? "Learning Your Aim" : `Aim ${Math.round(score * 100)}%`);
    $("play-anyway").hidden = !check.canPlayAnyway;
    $<HTMLButtonElement>("start-over").disabled = check.shots === 0;
  }

  private renderTrigger(): void {
    const reading = this.reading;
    const state = !reading || !reading.position ? "lost" : reading.armed ? "ready" : "raise";
    const trigger = $("trigger");
    if (trigger.dataset.state === state) return;
    trigger.dataset.state = state;
    setText(trigger.lastElementChild!, { lost: "Show your hand", ready: "Ready to fire", raise: "Raise your thumb" }[state]);
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

  /** "Aim 97% - you're ready." */
  private readyMoment(score: number): void {
    const percent = Math.round(score * 100);
    const card = element("div", "ready-moment glass");
    card.setAttribute("role", "status");
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "ring ready");
    svg.setAttribute("viewBox", "0 0 44 44");
    svg.setAttribute("aria-hidden", "true");
    svg.innerHTML =
      `<circle class="track" cx="22" cy="22" r="18"/>` +
      `<circle class="fill" cx="22" cy="22" r="18" transform="rotate(-90 22 22)" style="stroke-dasharray:${RING};stroke-dashoffset:${RING * (1 - score)};--from:${RING * (1 - Math.min(score, 0.9))}"/>` +
      `<path class="check" d="M14.5 22.6 19.6 27.6 29.5 16.6" style="stroke-dasharray:40;stroke-dashoffset:0"/>`;
    card.append(svg, element("p", "title1 num", `Aim ${percent}%`), element("p", "body secondary", "You’re ready."));
    $("moments").append(card);
    window.setTimeout(() => card.remove(), READY_MOMENT + 400);
    announce(`Aim ${percent}%. You’re ready.`);
  }

  dispose(): void {
    this.options.input.onReading = null;
    for (const cleanup of this.cleanups.splice(0)) cleanup();
  }
}
