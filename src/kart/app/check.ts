/**
 * The wheel check: a large picture of your wheel and, one idea at a time,
 * what to do with it. The first time: hold your fists up, hold it level,
 * turn it, open your hands to brake. After that, only "Hold it level" - the
 * level is the one thing that changes with where the camera stands.
 *
 * Two players on one camera are checked side by side, each in their own
 * picture; three or four share one picture of the whole camera, split into
 * their columns, with a chip for each (their colour, name, and the ring and
 * tick). The words say what the player furthest behind has still to do.
 */
import type { EdgeWay } from "../contract";
import { $, announce, element, icon, setText } from "../../ui/dom";
import { EdgeHint } from "./edgeHint";
import { setWheelChecked } from "./prefs";
import type { Disposable, Services, WheelControl } from "./services";
import { focusHeading } from "./ui";

export interface CheckPlayer {
  name: string;
  colour: string;
  control: WheelControl;
}

export interface CheckHooks {
  /** Everyone's wheel is set. */
  done(): void;
  back(): void;
}

type Step = "fists" | "level" | "turn" | "brake" | "ready";

const FIRST_TIME: readonly Step[] = ["fists", "level", "turn", "brake", "ready"];
const RETURNING: readonly Step[] = ["level", "ready"];

const WORDS: Record<Step, readonly [title: string, detail: string]> = {
  fists: ["Hold your fists up, like a wheel", "Keep both fists in view of the camera."],
  level: ["Hold it level", "Hold the wheel steady for a second."],
  turn: ["Turn it", "Turn the wheel all the way left, then right."],
  brake: ["Open your hands to brake", "Open both hands, then close them to go again."],
  ready: ["Ready", "Your wheel is set."],
};

/** Hands nearing the edge of the picture (or of the player's column): which way to move, as they see themself. */
const EDGE_DETAIL: Record<EdgeWay, string> = {
  left: "Move a little to your left.",
  right: "Move a little to your right.",
  down: "Lower your hands a little.",
  up: "Raise your hands a little.",
};

/** How far the wheel must turn, degrees, to count as turned. */
const TURNED = 20;
/** A condition must hold this long, ms, to count (a flicker of a hand does not). */
const HOLD = 350;
/** After the last step, how long "Ready" shows before the check hands on, ms. */
const READY_FOR = 1500;
/**
 * Fewer than two hands this long, ms, and the words say so. Longer than the race's LOST_FOR because the check counts
 * from the moment a hand drops out of the wheel's count, where the race counts from the wheel's own "lost", which has
 * already waited 0.3 s.
 */
const LOST_FOR = 600;

interface Entry {
  player: CheckPlayer;
  step: number;
  /** When the current condition began to hold, or null. */
  since: number | null;
  left: boolean;
  right: boolean;
  lostSince: number | null;
  /** Their hands nearing the edge of the picture. */
  edge: EdgeHint;
  figure: HTMLElement;
  ring: SVGCircleElement;
  preview: Disposable;
}

const NO_PICTURE: Disposable = { dispose() {} };

export class CheckScreen {
  private steps: readonly Step[] = FIRST_TIME;
  private entries: Entry[] = [];
  private shared: Disposable | null = null;
  private frame = 0;
  private timer = 0;
  private shown = "";

  constructor(
    private readonly services: Services,
    private readonly hooks: CheckHooks,
  ) {
    $("check-back").addEventListener("click", () => {
      this.stop();
      hooks.back();
    });
    $("check-continue").addEventListener("click", () => this.finish());
  }

  /** Starts checking these players' wheels. `returning`: they have done the whole check before. */
  start(players: CheckPlayer[], returning: boolean): void {
    this.stop();
    this.steps = returning ? RETURNING : FIRST_TIME;
    this.shown = "";
    const pictures = $("check-pictures");
    pictures.dataset.count = String(players.length);
    const together = players.length >= 3;
    this.entries = players.map((player) => this.build(player, players.length > 1, together));
    $("screen-check").toggleAttribute("data-shared", together);
    if (together) {
      // One picture of the whole camera, its columns marked, and a chip for each player under it.
      const figure = element("figure", "check-shared");
      const view = element("div", "wheel-view wide");
      figure.append(view);
      this.shared = this.services.previewColumns(
        view,
        players.map((player) => ({ control: player.control, name: player.name, colour: player.colour })),
        "large",
      );
      const chips = element("div", "check-chips");
      chips.append(...this.entries.map((entry) => entry.figure));
      pictures.replaceChildren(figure, chips);
    } else {
      pictures.replaceChildren(...this.entries.map((entry) => entry.figure));
    }
    // One pip for each thing to do. A returning player has only one: no pips.
    const pips = $("check-steps");
    pips.hidden = returning;
    pips.replaceChildren(...this.steps.slice(0, -1).map(() => element("li")));
    // Hidden but holding its place, so the picture does not jump when it appears.
    $("check-continue").style.visibility = "hidden";
    this.enter(0);
    this.words(performance.now());
    focusHeading($("check-title"));
    const loop = (now: number) => {
      this.frame = requestAnimationFrame(loop);
      this.tick(now);
    };
    this.frame = requestAnimationFrame(loop);
  }

  stop(): void {
    cancelAnimationFrame(this.frame);
    window.clearTimeout(this.timer);
    this.timer = 0;
    for (const entry of this.entries) entry.preview.dispose();
    this.entries = [];
    this.shared?.dispose();
    this.shared = null;
  }

  private build(player: CheckPlayer, named: boolean, together: boolean): Entry {
    const figure = element("figure", together ? "check-picture check-chip" : "check-picture");
    const view = element("div", "wheel-view");
    // One round badge in the picture's corner: a ring that fills while the wheel is held level,
    // then a green tick when this wheel is set. It stays out of the way of the wheel itself.
    const ring = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    ring.setAttribute("viewBox", "0 0 48 48");
    ring.setAttribute("class", "level-ring");
    ring.setAttribute("aria-hidden", "true");
    const track = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    const fill = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    for (const circle of [track, fill]) {
      circle.setAttribute("cx", "24");
      circle.setAttribute("cy", "24");
      circle.setAttribute("r", "18");
    }
    track.setAttribute("class", "ring-track");
    fill.setAttribute("class", "ring-fill");
    fill.setAttribute("pathLength", "100");
    fill.setAttribute("transform", "rotate(-90 24 24)");
    fill.setAttribute("stroke-dasharray", "0 100");
    ring.append(track, fill);
    const badge = element("span", "check-badge glass");
    badge.setAttribute("aria-hidden", "true");
    const tick = icon("check");
    tick.setAttribute("class", "tick");
    badge.append(ring, tick);
    if (!together) figure.append(view);
    figure.append(badge);
    if (named) {
      const caption = element("figcaption", "check-name");
      const dot = element("span", "dot");
      dot.style.background = player.colour;
      caption.append(dot, player.name);
      figure.append(caption);
    }
    const preview = together ? NO_PICTURE : this.services.preview(view, player.control, "large");
    return { player, step: 0, since: null, left: false, right: false, lostSince: null, edge: new EdgeHint(), figure, ring: fill, preview };
  }

  /** A player arrives at a step: the level starts afresh as they come to it. */
  private enter(index: number, only?: Entry): void {
    for (const entry of only ? [only] : this.entries) {
      entry.step = index;
      entry.since = null;
      entry.lostSince = null;
      if (this.steps[index] === "level") entry.player.control.level.reset();
      entry.figure.dataset.step = this.steps[index];
      if (this.steps[index] === "ready") entry.ring.setAttribute("stroke-dasharray", "100 100");
    }
  }

  private tick(now: number): void {
    for (const entry of this.entries) this.advance(entry, now);
    this.words(now);
    if (this.entries.length && this.entries.every((entry) => this.steps[entry.step] === "ready") && !this.timer) {
      $("check-continue").style.visibility = "visible";
      setWheelChecked();
      this.timer = window.setTimeout(() => this.finish(), READY_FOR);
    }
  }

  private advance(entry: Entry, now: number): void {
    const step = this.steps[entry.step]!;
    const wheel = entry.player.control.wheel;
    // How long the hands have been gone, for the words.
    entry.lostSince = wheel.hands < 2 ? (entry.lostSince ?? now) : null;
    entry.edge.update(wheel.mode === "lost" ? null : (wheel.edge ?? null), now);
    const holds = (condition: boolean) => {
      entry.since = condition ? (entry.since ?? now) : null;
      return entry.since !== null && now - entry.since >= HOLD;
    };
    let next = false;
    switch (step) {
      case "fists":
        next = holds(wheel.hands === 2);
        break;
      case "level": {
        const progress = entry.player.control.level.progress();
        entry.ring.setAttribute("stroke-dasharray", `${Math.round(progress * 100)} 100`);
        if (progress >= 1) {
          entry.player.control.level.set();
          next = true;
        }
        break;
      }
      case "turn":
        if (wheel.hands === 2) {
          if (wheel.angle <= -TURNED) entry.left = true;
          if (wheel.angle >= TURNED) entry.right = true;
        }
        next = entry.left && entry.right;
        break;
      case "brake":
        next = holds(wheel.mode === "brake");
        break;
      case "ready":
        break;
    }
    if (next) this.enter(entry.step + 1, entry);
  }

  /** The words for what the player furthest behind still has to do. */
  private words(now: number): void {
    if (!this.entries.length) return;
    const behind = this.entries.reduce((a, b) => (b.step < a.step ? b : a));
    const step = this.steps[behind.step]!;
    const title = WORDS[step][0];
    let detail = WORDS[step][1];
    if (step === "level" && behind.player.control.wheel.hands < 2) detail = "Hold both fists up, like a wheel.";
    if (step === "turn" && behind.left !== behind.right) detail = "Now the other way.";
    // Hands nearing the edge, anyone's (named when there are several): where they sit now is where they will race.
    const edging = step === "ready" ? undefined : behind.edge.shown ? behind : this.entries.find((entry) => entry.edge.shown);
    if (edging?.edge.shown) {
      const words = EDGE_DETAIL[edging.edge.shown];
      detail = this.entries.length > 1 ? `${edging.player.name}: ${words.charAt(0).toLowerCase()}${words.slice(1)}` : words;
    }
    if ((step === "level" || step === "turn" || step === "brake") && behind.lostSince !== null && now - behind.lostSince > LOST_FOR) {
      detail = "Show both hands.";
    }
    const index = Math.min(behind.step, this.steps.length - 1);
    const key = `${title}|${detail}|${index}`;
    if (key === this.shown) return;
    const titleChanged = !this.shown.startsWith(`${title}|`);
    this.shown = key;
    setText("check-title", title);
    setText("check-detail", detail);
    $("check-steps")
      .querySelectorAll("li")
      .forEach((pip, i) => {
        pip.classList.toggle("done", i < index);
        pip.classList.toggle("now", i === index);
      });
    if (titleChanged) announce(title);
  }

  private finish(): void {
    if (!this.entries.length) return;
    this.stop();
    this.hooks.done();
  }
}
