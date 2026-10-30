/**
 * Grip Prix's wheel on its own, at /src/kart/input/dev.html on the dev server
 * (`npm run dev`): the first thing to try with real hands.
 *
 * It opens the camera, loads the hand tracker looking for two hands (four for
 * "Two on This Camera"), and shows the mirrored picture with the wheel the
 * game sees drawn on it, next to the numbers the kart would be given: the
 * angle, the steer, the grip, the mode, the drift, the item presses, the shakes. Nothing
 * is sent anywhere; nothing makes a sound.
 *
 * window.__wheelDev gives the console the controls and the tracker.
 */
import "../../ui/base.css";
import "../../app/settings.css";
import "./dev.css";
import { CameraError, openCamera, type Camera } from "../../tracking/camera";
import { lanesFor, tilesFor } from "../../tracking/hands";
import { MODEL_BYTES, WASM_BYTES } from "../../tracking/sizes";
import { loadTracker, type Tracker } from "../../tracking/tracker";
import { $, element, replay, setText } from "../../ui/dom";
import type { WheelStatus } from "../contract";
import { wheelControl, type WheelControl } from "./control";
import { WheelPreview } from "./preview";
import { STEERING_LOCK, WHEEL, type Steering } from "./wheel";

// ─── Remembered between visits ──────────────────────────────────────────────

const KEY = "handy.kart.input-dev.v1";
interface Saved {
  steering: Steering;
  two: boolean;
}

function load(): Saved {
  const saved: Saved = { steering: "normal", two: new URLSearchParams(location.search).get("two") === "1" };
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<Saved> | null;
    if (stored?.steering && stored.steering in STEERING_LOCK) saved.steering = stored.steering;
    if (typeof stored?.two === "boolean" && !location.search.includes("two=")) saved.two = stored.two;
  } catch {
    // Nothing kept: the defaults.
  }
  return saved;
}

function save(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Not kept.
  }
}

const state = load();

// ─── Words ───────────────────────────────────────────────────────────────────

const GRIP_WORDS: Record<WheelStatus["grip"], string> = { fists: "Fists", open: "Open", "one-open": "One Open", none: "None" };
const MODE_WORDS: Record<WheelStatus["mode"], string> = { drive: "Drive", brake: "Brake", lost: "Lost" };
const TROUBLE: Record<string, [string, string]> = {
  denied: ["Your camera is off for this page.", "Allow it in your browser's settings, then Try Again."],
  busy: ["Your camera is being used by another app.", "Close it, then Try Again."],
  missing: ["No camera found.", "Plug one in, then Try Again."],
  insecure: ["The camera needs a secure page.", "Open this on localhost or over HTTPS, then Try Again."],
};

/** A number with a real minus sign, and no "-0.0". */
function signed(value: number, digits: number, unit = ""): string {
  const rounded = Number(value.toFixed(digits));
  const text = Math.abs(rounded).toFixed(digits);
  return `${rounded < 0 ? "−" : rounded > 0 ? "+" : ""}${text}${unit}`;
}

// ─── The page ────────────────────────────────────────────────────────────────

const video = $<HTMLVideoElement>("camera");
const previews = $("previews");
const side = $("side");
const notice = $("notice");
const noticeAction = $<HTMLButtonElement>("notice-action");

let camera: Camera | null = null;
let tracker: Tracker | null = null;
let generation = 0;
let hint: { text: string; until: number } | null = null;

interface Blocking {
  title: string;
  detail: string;
  action?: { label: string; run: () => void };
}
let blocking: Blocking | null = null;

function render(): void {
  const mode = blocking ? "blocking" : "hint";
  const saying = hint && performance.now() < hint.until ? { title: hint.text, detail: "" } : null;
  const shown: Blocking | null = blocking ?? saying ?? (lostWho !== null ? { title: "Show Both Hands", detail: lostWho } : null);
  notice.hidden = !shown;
  if (!shown) return;
  notice.dataset.kind = mode;
  setText("notice-title", shown.title);
  setText("notice-detail", shown.detail);
  $("notice-detail").hidden = !shown.detail;
  const action = blocking?.action;
  noticeAction.hidden = !action;
  if (action) {
    setText(noticeAction, action.label);
    noticeAction.onclick = action.run;
  }
}

/** Null while every wheel is seen; else who has lost their hands, said under "Show Both Hands" (empty for a lone player). */
let lostWho: string | null = null;

function say(text: string, seconds = 2.5): void {
  hint = { text, until: performance.now() + seconds * 1000 };
}

// ─── One player's numbers ────────────────────────────────────────────────────

const ROWS: [string, string][] = [
  ["angle", "Angle"],
  ["steer", "Steer"],
  ["grip", "Grip"],
  ["mode", "Mode"],
  ["hands", "Hands Seen"],
  ["fingers", "Fingers Out"],
  ["drift", "Drift"],
  ["items", "Item Presses"],
  ["shakes", "Shakes"],
  ["pedals", "Throttle · Brake"],
  ["level", "Level"],
];

interface Player {
  control: WheelControl;
  preview: WheelPreview;
  values: Map<string, HTMLElement>;
  bar: HTMLElement;
  items: number;
  shakes: number;
  drifting: boolean;
}

function buildPlayer(title: string | null, half: "left" | "right" | null): Player {
  const control = wheelControl(tracker!, {
    steering: state.steering,
    half,
    aspect: () => (video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : 16 / 9),
  });
  const preview = new WheelPreview({ size: "full", half });
  preview.attach(video);
  previews.append(preview.canvas);

  const group = element("section", "group player");
  if (title) group.append(element("h3", "group-title", title));
  const rows = element("div", "rows");
  const values = new Map<string, HTMLElement>();
  let bar!: HTMLElement;
  for (const [key, label] of ROWS) {
    const row = element("div", "row");
    row.append(element("span", "row-label", label));
    const value = element("span", "row-value num", "–");
    values.set(key, value);
    if (key === "steer") {
      const track = element("span", "steer-bar");
      bar = element("i");
      track.append(bar);
      row.append(track);
    }
    row.append(value);
    rows.append(row);
  }
  group.append(rows);
  playersHost.append(group);
  return { control, preview, values, bar, items: 0, shakes: 0, drifting: false };
}

let players: Player[] = [];
/** Where each player's numbers go: the top of the side panel. */
const playersHost = element("div", "players");
let holding = false;

function clearPlayers(): void {
  for (const player of players) {
    player.control.dispose();
    player.preview.dispose();
  }
  players = [];
  previews.replaceChildren();
  playersHost.replaceChildren();
}

function setPlayers(): void {
  clearPlayers();
  previews.classList.toggle("two", state.two);
  players = state.two ? [buildPlayer("Player 1 · Left Half", "left"), buildPlayer("Player 2 · Right Half", "right")] : [buildPlayer(null, null)];
}

// ─── The controls ────────────────────────────────────────────────────────────

const INFO = ["fps", "delay", "reading", "runs", "camera"] as const;
const info = new Map<string, HTMLElement>();

function buildSide(): void {
  side.replaceChildren(playersHost);

  // Steering and Two on This Camera
  const settings = element("section", "group");
  settings.append(element("h3", "group-title", "Settings"));
  const rows = element("div", "rows");
  const steering = element("div", "row");
  steering.append(element("span", "row-label", "Steering"));
  const picker = element("div", "segmented");
  picker.setAttribute("role", "radiogroup");
  picker.setAttribute("aria-label", "Steering");
  picker.style.setProperty("--count", "3");
  const options: [Steering, string][] = [
    ["gentle", "Gentle"],
    ["normal", "Normal"],
    ["quick", "Quick"],
  ];
  const radios = options.map(([value, label]) => {
    const radio = element("button", undefined, label);
    radio.type = "button";
    radio.setAttribute("role", "radio");
    radio.dataset.value = value;
    radio.addEventListener("click", () => chooseSteering(value));
    picker.append(radio);
    return radio;
  });
  const markSteering = () => {
    radios.forEach((radio, i) => {
      const checked = radio.dataset.value === state.steering;
      radio.setAttribute("aria-checked", String(checked));
      radio.tabIndex = checked ? 0 : -1;
      if (checked) picker.style.setProperty("--index", String(i));
    });
    setText(steeringFoot, `Full lock at ${STEERING_LOCK[state.steering]}°. Nothing inside ±${WHEEL.deadZone}°.`);
  };
  const chooseSteering = (value: Steering) => {
    state.steering = value;
    for (const player of players) player.control.steering = value;
    markSteering();
    save();
  };
  steering.append(picker);
  const two = element("div", "row");
  two.append(element("span", "row-label", "Two on This Camera"));
  const toggle = element("button", "switch");
  toggle.type = "button";
  toggle.setAttribute("role", "switch");
  toggle.setAttribute("aria-label", "Two on This Camera");
  toggle.setAttribute("aria-checked", String(state.two));
  toggle.addEventListener("click", () => {
    state.two = !state.two;
    toggle.setAttribute("aria-checked", String(state.two));
    save();
    void start();
  });
  two.append(toggle);
  rows.append(steering, two);
  const steeringFoot = element("p", "group-foot");
  settings.append(rows, steeringFoot);

  // The level
  const level = element("section", "group");
  level.append(element("h3", "group-title", "Level"));
  const levelRows = element("div", "rows");
  const setRow = element("div", "row action");
  const setLevel = element("button", "row-action", "Set Level");
  setLevel.type = "button";
  setLevel.addEventListener("click", () => {
    const missing = players.filter((player) => !player.control.setLevel());
    if (missing.length) say(players.length > 1 ? "Show both hands, both players." : "Show both hands first.");
    else say("Level set. Zero is where your wheel is now.");
  });
  setRow.append(setLevel);
  const holdRow = element("div", "row action");
  const hold = element("button", "row-action");
  hold.type = "button";
  const holdLabel = element("span", undefined, "Hold Level for a Second");
  const ring = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  ring.setAttribute("class", "ring");
  ring.setAttribute("viewBox", "0 0 24 24");
  ring.innerHTML = '<circle class="track" cx="12" cy="12" r="10"/><circle class="fill" cx="12" cy="12" r="10"/>';
  hold.append(holdLabel, ring);
  hold.addEventListener("click", () => {
    holding = !holding;
    for (const player of players) {
      if (holding) player.control.startAutoLevel(() => finished());
      else player.control.cancelAutoLevel();
    }
    setText(holdLabel, holding ? "Holding… Keep It Still" : "Hold Level for a Second");
  });
  const finished = () => {
    if (!players.every((player) => player.control.levelled && player.control.levelProgress >= 1)) return;
    holding = false;
    setText(holdLabel, "Hold Level for a Second");
    say("Level set. Zero is where your wheel is now.");
  };
  holdRow.append(hold);
  const forgetRow = element("div", "row action");
  const forget = element("button", "row-action", "Forget Level");
  forget.type = "button";
  forget.addEventListener("click", () => {
    for (const player of players) {
      player.control.cancelAutoLevel();
      player.control.resetLevel();
    }
    holding = false;
    setText(holdLabel, "Hold Level for a Second");
  });
  forgetRow.append(forget);
  levelRows.append(setRow, holdRow, forgetRow);
  level.append(levelRows, element("p", "group-foot", "Zero is where your wheel is when you set it, so a tilted camera is no trouble."));
  levelRing = ring;

  // Tracking
  const tracking = element("section", "group");
  tracking.append(element("h3", "group-title", "Tracking"));
  const trackingRows = element("div", "rows");
  const labels: Record<(typeof INFO)[number], string> = { fps: "Frame Rate", delay: "Camera to Wheel", reading: "Hand Reading", runs: "Runs On", camera: "Camera" };
  for (const key of INFO) {
    const row = element("div", "row");
    row.append(element("span", "row-label", labels[key]));
    const value = element("span", "row-value num", "–");
    info.set(key, value);
    row.append(value);
    trackingRows.append(row);
  }
  tracking.append(trackingRows);

  // How to drive
  const guide = element("section", "group");
  guide.append(element("h3", "group-title", "How to Drive"));
  const text = element("div", "rows");
  const lines = element("div", "guide");
  lines.innerHTML = [
    "<span><b>Drive.</b> Both fists up. The kart goes by itself.</span>",
    "<span><b>Steer.</b> Turn the wheel. The angle between your hands steers.</span>",
    "<span><b>Brake.</b> Open both hands. Keep them open to back up.</span>",
    "<span><b>Item.</b> Flick one hand open and shut, the other staying a fist.</span>",
    "<span><b>Drift.</b> Open both hands in a bend at speed, then close them to let go. Or lift the wheel sharply while turning, and straighten it.</span>",
  ].join("");
  text.append(lines);
  guide.append(text);

  side.append(settings, level, tracking, guide);
  markSteering();
}

let levelRing: SVGElement | null = null;

// ─── Frame rate ──────────────────────────────────────────────────────────────

const arrivals: number[] = [];
let stopCounting: (() => void) | null = null;

/** Frames read a second, for each player's column (two players, each read in a worker of their own, publish a frame each). */
function fps(): number {
  const now = performance.now();
  while (arrivals.length && now - arrivals[0]! > 1000) arrivals.shift();
  return Math.round(arrivals.length / (tracker?.counts().columns ?? 1));
}

// ─── Each animation frame ─────────────────────────────────────────────────────

let lastInfo = 0;

function frame(now: number): void {
  requestAnimationFrame(frame);
  const lost: number[] = [];
  let progress = 1;
  players.forEach((player, index) => {
    const { control } = player;
    const input = control.sample(now);
    const status = control.wheel;
    progress = Math.min(progress, control.levelProgress);
    player.preview.draw(status, { levelProgress: holding ? control.levelProgress : 0 });
    const v = player.values;
    const set = (key: string, text: string, tone = "") => {
      const node = v.get(key)!;
      setText(node, text);
      if (tone) node.dataset.tone = tone;
      else delete node.dataset.tone;
    };
    set("angle", signed(status.angle, 1, "°"));
    set("steer", signed(status.steer, 2));
    player.bar.style.setProperty("--steer", String(status.steer));
    if (status.steer < 0) player.bar.setAttribute("data-negative", "");
    else player.bar.removeAttribute("data-negative");
    set("grip", GRIP_WORDS[status.grip]);
    set("mode", MODE_WORDS[status.mode], status.mode);
    set("hands", String(status.hands));
    const fingers = control.fingers;
    set("fingers", `L ${fingers.left ?? "–"} · R ${fingers.right ?? "–"}`);
    set("drift", input.drift ? "On" : "Off", input.drift ? "on" : "");
    if (input.drift && !player.drifting) replay(v.get("drift")!, "pulse");
    player.drifting = input.drift;
    set("items", String(input.itemPresses));
    if (input.itemPresses !== player.items) {
      player.items = input.itemPresses;
      replay(v.get("items")!, "pulse");
    }
    const shakes = input.shakes ?? 0;
    set("shakes", String(shakes));
    if (shakes !== player.shakes) {
      player.shakes = shakes;
      replay(v.get("shakes")!, "pulse");
    }
    set("pedals", `${input.throttle.toFixed(0)} · ${input.brake.toFixed(0)}`);
    set("level", control.levelled ? signed(control.level, 1, "°") : "Not Set");
    if (status.mode === "lost") lost.push(index + 1);
  });
  lostWho = lost.length === 0 ? null : players.length > 1 ? `Player ${lost.join(" and ")}` : "";
  levelRing?.style.setProperty("--progress", String(holding ? progress : 0));
  if (now - lastInfo > 200) {
    lastInfo = now;
    updateInfo();
  }
  render();
}

function updateInfo(): void {
  const set = (key: string, text: string) => setText(info.get(key)!, text);
  if (!tracker) {
    for (const key of INFO) set(key, "–");
    return;
  }
  const stats = tracker.stats();
  set("fps", `${fps()} a second`);
  set("delay", `${stats.delay.p50.toFixed(0)} ms`);
  set("reading", `${stats.inference.p50.toFixed(0)} ms`);
  set("runs", `${tracker.delegate} · ${tracker.where === "worker" ? "worker" : "page"}`);
  set("camera", camera ? `${camera.width} × ${camera.height}` : "–");
}

// ─── Starting ────────────────────────────────────────────────────────────────

async function start(): Promise<void> {
  const mine = ++generation;
  stopCounting?.();
  clearPlayers();
  tracker?.dispose();
  tracker = null;
  holding = false;
  blocking = { title: "Getting ready…", detail: "" };
  try {
    camera ??= await openCamera(video);
    if (mine !== generation) return;
    let wasm = 0;
    let model = 0;
    // Each download weighed by its size, so the percentage moves as the bytes do.
    const progress = () => {
      const fraction = (wasm * WASM_BYTES + model * MODEL_BYTES) / (WASM_BYTES + MODEL_BYTES);
      if (blocking && mine === generation) blocking = { title: "Getting ready…", detail: `${Math.round(fraction * 100)}%` };
    };
    const hands = state.two ? 4 : 2;
    const tiles = tilesFor(hands);
    const loaded = await loadTracker(
      {
        wasm: (fraction) => {
          wasm = fraction;
          progress();
        },
        model: (fraction) => {
          model = fraction;
          progress();
        },
      },
      // Two hands for one wheel, four for two wheels on one camera, read as the game reads them (a tile and a worker each).
      { hands, tiles, lanes: lanesFor(tiles) ?? undefined, adapt: true },
    );
    if (mine !== generation) {
      loaded.dispose();
      return;
    }
    tracker = loaded;
    stopCounting = loaded.subscribe(() => arrivals.push(performance.now()));
    setPlayers();
    loaded.start(video);
    blocking = null;
  } catch (error) {
    if (mine !== generation) return;
    console.warn("The wheel check could not start.", error);
    const [title, detail] =
      error instanceof CameraError
        ? (TROUBLE[error.trouble] ?? ["The camera could not start.", "Try Again."])
        : ["The hand tracker could not load.", "Check your connection, then Try Again."];
    blocking = { title: title!, detail: detail!, action: { label: "Try Again", run: () => void start() } };
  }
}

buildSide();
requestAnimationFrame(frame);
window.addEventListener("pagehide", () => camera?.stop());
Object.defineProperty(window, "__wheelDev", {
  value: {
    get players() {
      return players.map((player) => player.control);
    },
    get tracker() {
      return tracker;
    },
    get blocking() {
      return blocking;
    },
    state,
  },
});
void start();
