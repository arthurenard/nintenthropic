/**
 * Stand-ins for everything the screens ask of `Services` (services.ts), so
 * the screens can be built, looked at and tested before the real net, input
 * and render parts are wired in. Nothing here is Grip Prix: it is the
 * cheapest thing that behaves like it.
 *
 *   - A fake room whose race moves karts round a circle (and ends).
 *   - A fake wheel driven by the keyboard: arrows or A/D turn it, S or Down
 *     opens the hands (brake), H takes both hands away, Space drifts.
 *   - A 2D-canvas renderer with a bare HUD, and a drawn "camera" for the
 *     wheel's picture.
 *
 * A few room codes act out the troubles, for seeing and testing them:
 * ZZZZ is not found, FULL is full, LEFT is a host who leaves, DROP loses the
 * connection. A room we host gets a pretend guest, Sam, a moment after it opens.
 *
 * Delete this file's use (main.ts) once the real services are wired.
 */
import {
  IDLE_INPUT,
  MAX_RACERS,
  PLAYER_COLOURS,
  BOT_COLOURS,
  TICK,
  type DriveInput,
  type DriverControl,
  type KartView,
  type LobbySettings,
  type LobbyState,
  type LocalPlayerSetup,
  type RaceEvent,
  type RaceRenderer,
  type RaceResult,
  type RaceView,
  type RacerSetup,
  type Session,
  type SessionClosed,
  type TrackDef,
  type WheelStatus,
} from "../contract";
import { trackById, TRACKS } from "../track/tracks";
import { lapLabel, ordinal, raceTime } from "./format";
import {
  CameraFailure,
  SessionFailure,
  STEERING_DEGREES,
  type CameraService,
  type Disposable,
  type Services,
  type SessionOptions,
  type WheelControl,
  type WheelOptions,
} from "./services";

const params = (): URLSearchParams => new URLSearchParams(typeof location === "undefined" ? "" : location.search);
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

// --- keys ---------------------------------------------------------------------------------------------

/** The keys held now, by `KeyboardEvent.code`, for the fake controls. Shared by all of them. */
const held = new Set<string>();
let presses = 0;
let listening = 0;

function onKeyDown(event: KeyboardEvent): void {
  const target = event.target as HTMLElement | null;
  if (target && ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName)) return;
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  // A focused button keeps its Space.
  if (event.code === "Space" && target?.tagName === "BUTTON") return;
  if (event.code === "KeyE" || event.code === "ShiftLeft" || event.code === "ShiftRight") {
    if (!event.repeat && !held.has(event.code)) presses++;
  }
  held.add(event.code);
  if (event.code.startsWith("Arrow") || event.code === "Space") event.preventDefault();
}
const onKeyUp = (event: KeyboardEvent) => held.delete(event.code);
const onBlur = () => held.clear();

function listen(): () => void {
  if (listening++ === 0) {
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
  }
  return () => {
    if (--listening === 0) {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      held.clear();
    }
  };
}

const anyHeld = (...codes: string[]) => codes.some((code) => held.has(code));

// --- the controls ---------------------------------------------------------------------------------------

function fakeKeyboard(): DriverControl {
  const stop = listen();
  return {
    kind: "keyboard",
    wheel: null,
    sample(): DriveInput {
      const steer = (anyHeld("ArrowRight", "KeyD") ? 1 : 0) - (anyHeld("ArrowLeft", "KeyA") ? 1 : 0);
      return {
        steer,
        throttle: anyHeld("ArrowUp", "KeyW") ? 1 : 0,
        brake: anyHeld("ArrowDown", "KeyS") ? 1 : 0,
        drift: held.has("Space"),
        itemPresses: presses,
      };
    },
    dispose: stop,
  };
}

function fakeGamepad(): DriverControl {
  const pad = () => [...(navigator.getGamepads?.() ?? [])].find((p): p is Gamepad => !!p);
  return {
    kind: "gamepad",
    wheel: null,
    sample(): DriveInput {
      const p = pad();
      if (!p) return IDLE_INPUT;
      const axis = p.axes[0] ?? 0;
      return {
        steer: Math.abs(axis) < 0.12 ? 0 : clamp(axis, -1, 1),
        throttle: p.buttons[7]?.value ?? 0,
        brake: p.buttons[6]?.value ?? 0,
        drift: !!p.buttons[0]?.pressed,
        itemPresses: p.buttons[1]?.pressed || p.buttons[2]?.pressed ? 1 : 0,
      };
    },
    dispose() {},
  };
}

/**
 * A wheel that is the keyboard in disguise: turning, opening the hands and
 * losing them all show on `wheel` as a real one's would. It keeps itself
 * up to date on the animation frame, since the wheel check reads it without
 * ever sampling it.
 */
function fakeWheel(options: WheelOptions): WheelControl {
  const stop = listen();
  const limit = STEERING_DEGREES[options.steering];
  const keys = {
    left: options.half === "right" ? ["ArrowLeft"] : options.half === "left" ? ["KeyA"] : ["ArrowLeft", "KeyA"],
    right: options.half === "right" ? ["ArrowRight"] : options.half === "left" ? ["KeyD"] : ["ArrowRight", "KeyD"],
    brake: options.half === "right" ? ["ArrowDown"] : options.half === "left" ? ["KeyS"] : ["ArrowDown", "KeyS"],
  };
  let angle = 0;
  let level = 0;
  let levelled = false;
  let levelSince: number | null = null;
  let last = performance.now();
  const status: WheelStatus = {
    hands: 2,
    left: { x: 0.34, y: 0.6, size: 0.16, open: false },
    right: { x: 0.66, y: 0.6, size: 0.16, open: false },
    angle: 0,
    steer: 0,
    grip: "fists",
    mode: "drive",
    levelled: false,
  };

  const update = (now: number) => {
    const dt = clamp((now - last) / 1000, 0, 0.1);
    last = now;
    const target = ((anyHeld(...keys.right) ? 1 : 0) - (anyHeld(...keys.left) ? 1 : 0)) * 38;
    angle += (target - angle) * Math.min(1, dt * 9);
    const lost = held.has("KeyH");
    const open = anyHeld(...keys.brake);
    const turned = angle - level;
    status.hands = lost ? 0 : 2;
    status.mode = lost ? "lost" : open ? "brake" : "drive";
    status.grip = lost ? "none" : open ? "open" : "fists";
    status.angle = turned;
    // A dead zone of 4 degrees, then a curve that is gentle near the middle.
    const unit = clamp((Math.abs(turned) - 4) / (limit - 4), 0, 1);
    status.steer = Math.sign(turned) * unit ** 1.4;
    status.levelled = levelled;
    const radians = (turned * Math.PI) / 180;
    const place = (side: -1 | 1) => ({
      x: 0.5 + side * 0.16 * Math.cos(radians),
      y: 0.6 + side * 0.16 * Math.sin(radians) * 0.75,
      size: 0.16,
      open,
    });
    status.left = lost ? null : place(-1);
    status.right = lost ? null : place(1);
  };
  let frame = requestAnimationFrame(function loop(now) {
    update(now);
    frame = requestAnimationFrame(loop);
  });

  return {
    kind: "wheel",
    wheel: status,
    level: {
      progress() {
        const now = performance.now();
        if (status.hands !== 2 || Math.abs(angle - level) > 6) levelSince = null;
        else levelSince ??= now;
        return levelSince === null ? 0 : clamp((now - levelSince) / 1000, 0, 1);
      },
      set() {
        level = angle;
        levelled = true;
      },
      reset() {
        level = 0;
        levelled = false;
        levelSince = null;
      },
    },
    sample(now: number): DriveInput {
      update(now);
      return {
        steer: status.mode === "lost" ? 0 : status.steer,
        throttle: status.mode === "drive" ? 1 : 0,
        brake: status.mode === "brake" ? 1 : 0,
        drift: held.has("Space"),
        itemPresses: presses,
      };
    },
    dispose() {
      cancelAnimationFrame(frame);
      stop();
    },
  };
}

// --- the camera and the wheel's picture ------------------------------------------------------------------

function fakeCamera(): CameraService {
  let asked = false;
  return {
    async permission() {
      return params().get("fail") === "camera" ? "denied" : asked ? "granted" : "prompt";
    },
    async start() {
      await wait(250);
      // `?fail=camera` acts out a camera the browser refuses.
      if (params().get("fail") === "camera") throw new CameraFailure("denied");
      asked = true;
    },
    stop() {},
  };
}

/** The wheel's picture: a drawn room and person, the ring through the hands, a dot for each. */
function fakePreview(container: HTMLElement, control: DriverControl, size: "corner" | "large"): Disposable {
  const canvas = document.createElement("canvas");
  canvas.className = "fake-preview";
  canvas.width = size === "large" ? 640 : 240;
  canvas.height = size === "large" ? 480 : 180;
  container.append(canvas);
  const ctx = canvas.getContext("2d")!;
  const colours = { drive: "#30D158", brake: "#FF9F0A", lost: "#FF453A" } as const;
  let frame = 0;

  const draw = () => {
    const { width: w, height: h } = canvas;
    const room = ctx.createLinearGradient(0, 0, 0, h);
    room.addColorStop(0, "#3a4252");
    room.addColorStop(1, "#1d222b");
    ctx.fillStyle = room;
    ctx.fillRect(0, 0, w, h);
    // A head and shoulders, dim, so it reads as a person in front of a camera.
    ctx.fillStyle = "#2a303b";
    ctx.beginPath();
    ctx.ellipse(w / 2, h * 1.02, w * 0.36, h * 0.34, 0, Math.PI, 0);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(w / 2, h * 0.34, w * 0.1, h * 0.17, 0, 0, Math.PI * 2);
    ctx.fill();
    const wheel = control.wheel;
    if (wheel) {
      const colour = colours[wheel.mode];
      const { left, right } = wheel;
      if (left && right) {
        const cx = ((left.x + right.x) / 2) * w;
        const cy = ((left.y + right.y) / 2) * h;
        const radius = Math.hypot((right.x - left.x) * w, (right.y - left.y) * h) / 2;
        ctx.lineWidth = Math.max(3, w / 90);
        ctx.strokeStyle = colour;
        ctx.globalAlpha = 0.9;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      for (const hand of [left, right]) {
        if (!hand) continue;
        ctx.beginPath();
        ctx.arc(hand.x * w, hand.y * h, w * 0.035, 0, Math.PI * 2);
        if (hand.open) {
          ctx.lineWidth = Math.max(2, w / 120);
          ctx.strokeStyle = "#fff";
          ctx.stroke();
        } else {
          ctx.fillStyle = "#fff";
          ctx.fill();
        }
      }
    }
    frame = requestAnimationFrame(draw);
  };
  draw();
  return {
    dispose() {
      cancelAnimationFrame(frame);
      canvas.remove();
    },
  };
}

// --- the picture of a race ---------------------------------------------------------------------------------

/** Where each of `count` viewports sits in a w × h window: the whole window, halves, quadrants. */
export function viewportRects(count: number, w: number, h: number): { x: number; y: number; w: number; h: number }[] {
  if (count <= 1) return [{ x: 0, y: 0, w, h }];
  if (count === 2) {
    return w >= h
      ? [
          { x: 0, y: 0, w, h: h / 2 },
          { x: 0, y: h / 2, w, h: h / 2 },
        ]
      : [
          { x: 0, y: 0, w: w / 2, h },
          { x: w / 2, y: 0, w: w / 2, h },
        ];
  }
  const rects = [
    { x: 0, y: 0, w: w / 2, h: h / 2 },
    { x: w / 2, y: 0, w: w / 2, h: h / 2 },
    { x: 0, y: h / 2, w: w / 2, h: h / 2 },
    { x: w / 2, y: h / 2, w: w / 2, h: h / 2 },
  ];
  return rects.slice(0, count);
}

class FakeRenderer implements RaceRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  private views: number[] = [];
  private huds: { root: HTMLElement; top: HTMLElement; place: HTMLElement; centre: HTMLElement }[] = [];
  private size = { w: 1, h: 1, dpr: 1 };
  private radius = 60;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly hud: HTMLElement,
  ) {
    this.ctx = canvas.getContext("2d")!;
  }

  async load(_track: TrackDef, _racers: readonly RacerSetup[], onProgress?: (fraction: number) => void): Promise<void> {
    for (let i = 1; i <= 4; i++) {
      await wait(60);
      onProgress?.(i / 4);
    }
  }

  setViews(karts: readonly number[]): void {
    this.views = [...karts];
    this.hud.replaceChildren();
    this.huds = this.views.map(() => {
      const root = document.createElement("div");
      root.className = "fake-hud";
      const top = document.createElement("p");
      top.className = "fake-hud-top glass num";
      const place = document.createElement("p");
      place.className = "fake-hud-place num";
      const centre = document.createElement("p");
      centre.className = "fake-hud-centre";
      root.append(top, place, centre);
      this.hud.append(root);
      return { root, top, place, centre };
    });
    this.layout();
  }

  resize(width: number, height: number, dpr: number): void {
    this.size = { w: Math.max(1, width), h: Math.max(1, height), dpr };
    this.canvas.width = Math.round(this.size.w * dpr);
    this.canvas.height = Math.round(this.size.h * dpr);
    this.layout();
  }

  private layout(): void {
    const rects = viewportRects(this.views.length, this.size.w, this.size.h);
    this.huds.forEach((hud, i) => {
      const r = rects[i]!;
      Object.assign(hud.root.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
    });
  }

  frame(view: RaceView, _dt: number): void {
    const { ctx } = this;
    const { w, h, dpr } = this.size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#6cc24a";
    ctx.fillRect(0, 0, w, h);
    const rects = viewportRects(this.views.length, w, h);
    this.views.forEach((id, i) => {
      const rect = rects[i]!;
      const me = view.karts.find((kart) => kart.id === id) ?? view.karts[0]!;
      this.drawWorld(view, me, rect);
      this.drawHud(view, me, this.huds[i]);
    });
  }

  private drawWorld(view: RaceView, me: KartView, rect: { x: number; y: number; w: number; h: number }): void {
    const { ctx } = this;
    ctx.save();
    ctx.beginPath();
    ctx.rect(rect.x, rect.y, rect.w, rect.h);
    ctx.clip();
    const sky = ctx.createLinearGradient(0, rect.y, 0, rect.y + rect.h);
    sky.addColorStop(0, "#7cc9ff");
    sky.addColorStop(0.3, "#9fdc72");
    sky.addColorStop(1, "#5ab244");
    ctx.fillStyle = sky;
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    const scale = rect.h / 70;
    ctx.translate(rect.x + rect.w / 2, rect.y + rect.h * 0.7);
    ctx.rotate(-me.heading);
    ctx.scale(scale, scale);
    ctx.translate(-me.x, me.z);
    // The road: a ring, with its edge and its centre line.
    ctx.lineCap = "butt";
    ctx.strokeStyle = "#e9ecef";
    ctx.lineWidth = 16;
    ctx.beginPath();
    ctx.arc(0, 0, this.radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = "#5f6670";
    ctx.lineWidth = 13;
    ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,0.8)";
    ctx.lineWidth = 0.6;
    ctx.setLineDash([4, 5]);
    ctx.stroke();
    ctx.setLineDash([]);
    for (const kart of view.karts) {
      const racer = view.racers.find((candidate) => candidate.id === kart.id);
      ctx.save();
      ctx.translate(kart.x, -kart.z);
      ctx.rotate(kart.heading);
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      ctx.fillRect(-1.3, -2.1, 2.6, 4.4);
      ctx.fillStyle = racer?.colour ?? "#fff";
      ctx.beginPath();
      ctx.roundRect(-1.1, -2, 2.2, 4, 0.7);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.fillRect(-0.7, -1.3, 1.4, 0.7);
      ctx.restore();
    }
    ctx.restore();
  }

  private drawHud(view: RaceView, me: KartView, hud: FakeRenderer["huds"][number] | undefined): void {
    if (!hud) return;
    const top = `${lapLabel(me.lap, view.laps)}  ·  ${raceTime(view.time)}`;
    if (hud.top.textContent !== top) hud.top.textContent = top;
    const place = me.finished !== null ? `${ordinal(me.place)}!` : ordinal(me.place);
    if (hud.place.textContent !== place) hud.place.textContent = place;
    const centre = view.phase === "countdown" ? (view.countdown > 3 ? "Ready" : String(Math.ceil(view.countdown))) : view.time < 1 ? "Go!" : "";
    if (hud.centre.textContent !== centre) hud.centre.textContent = centre;
  }

  dispose(): void {
    this.hud.replaceChildren();
  }
}

// --- the room ----------------------------------------------------------------------------------------------

/** A kart in the fake race: it goes round a circle, further the more throttle it is given. */
interface FakeKart {
  id: number;
  slot: number | null;
  /** A player on this device: its control is sampled. */
  local: LocalPlayerSetup | null;
  /** How hard it drives when nobody is asking (bots and far-off players). */
  pace: number;
  /** Radians travelled round the circle, in total. */
  angle: number;
  speed: number;
  steer: number;
  lapStart: number;
  best: number | null;
  finished: number | null;
}

const RADIUS = 60;
const OMEGA = 0.95; // radians a second at full speed: a lap in about seven seconds
const COUNTDOWN = 3.5;

class FakeRace {
  time = 0;
  readonly karts: FakeKart[] = [];
  readonly racers: RacerSetup[] = [];
  readonly map: Record<number, number> = {};
  private events: RaceEvent[] = [];
  private nextEvent = 0;
  private firstFinish: number | null = null;
  result: RaceResult | null = null;
  tick = 0;

  constructor(
    readonly track: TrackDef,
    readonly laps: number,
    players: { slot: number; name: string; local: LocalPlayerSetup | null }[],
    bots: boolean,
    racers: number,
  ) {
    const botNames = ["Bolt", "Dash", "Cleo", "Rex", "Pixel", "Moxie", "Gus"];
    let id = 0;
    for (const p of players) {
      this.add(id++, p.slot, p.name, PLAYER_COLOURS[p.slot % PLAYER_COLOURS.length]!, p.local);
    }
    for (let b = 0; bots && id < Math.min(racers, MAX_RACERS); b++) {
      this.add(id++, null, botNames[b % botNames.length]!, BOT_COLOURS[b % BOT_COLOURS.length]!, null);
    }
  }

  private add(id: number, slot: number | null, name: string, colour: string, local: LocalPlayerSetup | null): void {
    this.racers.push({ id, name, colour, player: slot, ...(slot === null ? { skill: 0.5 } : {}) });
    if (slot !== null) this.map[id] = slot;
    this.karts.push({
      id,
      slot,
      local,
      pace: 0.78 + ((id * 37) % 15) / 100,
      angle: -id * 0.045,
      speed: 0,
      steer: 0,
      lapStart: COUNTDOWN,
      best: null,
      finished: null,
    });
  }

  private emit(event: { type: RaceEvent["type"] } & Record<string, unknown>): void {
    this.events.push({ ...event, id: this.nextEvent++, tick: this.tick } as unknown as RaceEvent);
  }

  step(dt: number, now: number): void {
    const before = this.time;
    this.time += dt;
    this.tick = Math.round(this.time / TICK);
    for (const n of [3, 2, 1, 0] as const) {
      const at = COUNTDOWN - n;
      if (before < at && this.time >= at) this.emit({ type: "countdown", n });
    }
    const racing = this.time >= COUNTDOWN;
    for (const kart of this.karts) {
      const input = kart.local ? kart.local.control.sample(now) : null;
      const ask = input ? (input.brake > 0.5 ? 0 : input.throttle) : kart.pace;
      const target = racing && kart.finished === null ? ask : racing ? 0.7 : 0;
      kart.speed += (target - kart.speed) * Math.min(1, dt * (target < kart.speed ? 3 : 1.6));
      kart.steer += ((input ? input.steer : 0) - kart.steer) * Math.min(1, dt * 8);
      const progressBefore = kart.angle;
      kart.angle += kart.speed * OMEGA * dt;
      // Laps: one per full turn. A lap's time is the time since the last line.
      const lapsBefore = Math.floor(progressBefore / (Math.PI * 2));
      const lapsNow = Math.floor(kart.angle / (Math.PI * 2));
      if (racing && lapsNow > lapsBefore && lapsNow >= 1) {
        const lapTime = this.time - kart.lapStart;
        kart.best = kart.best === null ? lapTime : Math.min(kart.best, lapTime);
        kart.lapStart = this.time;
        if (lapsNow >= this.laps && kart.finished === null) {
          kart.finished = this.time - COUNTDOWN;
          this.firstFinish ??= this.time;
          this.emit({ type: "finish", kart: kart.id, place: this.karts.filter((k) => k.finished !== null).length, time: kart.finished });
        } else if (kart.finished === null) {
          this.emit({ type: "lap", kart: kart.id, lap: lapsNow + 1 });
          if (lapsNow + 1 === this.laps) this.emit({ type: "final-lap", kart: kart.id });
        }
      }
    }
    // The race ends when every player has finished, or 25 s after the first one did.
    const players = this.karts.filter((kart) => kart.slot !== null);
    const everyone = players.length > 0 && players.every((kart) => kart.finished !== null);
    const late = this.firstFinish !== null && this.time - this.firstFinish > 25;
    if (!this.result && racing && (everyone || late)) this.result = this.standings();
  }

  /** Karts best first: finished by their time, the rest by how far they got. */
  private order(): FakeKart[] {
    return [...this.karts].sort((a, b) => {
      if (a.finished !== null && b.finished !== null) return a.finished - b.finished;
      if (a.finished !== null) return -1;
      if (b.finished !== null) return 1;
      return b.angle - a.angle;
    });
  }

  private standings(): RaceResult {
    return {
      standings: this.order().map((kart, i) => ({ kart: kart.id, place: i + 1, time: kart.finished, bestLap: kart.best })),
    };
  }

  view(): RaceView {
    const order = this.order();
    const racing = this.time >= COUNTDOWN;
    const karts: KartView[] = this.karts.map((kart) => {
      const radius = RADIUS + kart.steer * 3 + (kart.id % 3) * 1.5 - 1.5;
      const lap = Math.floor(kart.angle / (Math.PI * 2));
      return {
        id: kart.id,
        surface: "road",
        trick: 0,
        rescue: 0,
        x: radius * Math.sin(kart.angle),
        y: 0,
        z: radius * Math.cos(kart.angle),
        heading: kart.angle + Math.PI / 2 - kart.steer * 0.12,
        speed: kart.speed * OMEGA * RADIUS,
        steer: kart.steer,
        drift: 0,
        driftLevel: 0,
        boost: 0,
        spin: 0,
        hop: 0,
        offroad: false,
        item: null,
        itemUses: 0,
        rolling: false,
        place: order.indexOf(kart) + 1,
        lap: kart.finished !== null ? this.laps + 1 : Math.max(1, Math.min(this.laps, lap + 1)),
        lapProgress: (((kart.angle / (Math.PI * 2)) % 1) + 1) % 1,
        wrongWay: false,
        finished: kart.finished,
      };
    });
    const events = this.events;
    this.events = [];
    return {
      tick: this.tick,
      phase: this.result ? "finished" : racing ? "racing" : "countdown",
      countdown: Math.max(0, COUNTDOWN - this.time),
      time: Math.max(0, this.time - COUNTDOWN),
      laps: this.laps,
      track: this.track,
      racers: this.racers,
      karts,
      things: [],
      events,
    };
  }
}

class FakeSession implements Session {
  readonly device = `device-${Math.random().toString(36).slice(2, 8)}`;
  private state: LobbyState;
  private readonly listeners = new Set<(lobby: LobbyState) => void>();
  private readonly closers = new Set<(reason: SessionClosed) => void>();
  private locals: LocalPlayerSetup[] = [];
  private ready = false;
  private remote: { name: string; ready: boolean } | null = null;
  private race: FakeRace | null = null;
  private lastNow: number | null = null;
  private timers: number[] = [];
  private ended = false;
  readonly link = { connected: true, rtt: 24 as number | null, players: 1 };

  constructor(
    readonly role: Session["role"],
    private readonly code: string | null,
    private readonly hostDevice: string,
  ) {
    this.state = {
      code,
      host: hostDevice === "" ? this.device : hostDevice,
      players: [],
      settings: { track: TRACKS[0]!.id, laps: 3, bots: true, racers: 6 },
      phase: "lobby",
      result: null,
      karts: {},
    };
    if (role === "host") this.after(1400, () => this.pretendGuestArrives());
    if (role === "guest") this.remote = { name: "Maya", ready: true };
  }

  private after(ms: number, run: () => void): void {
    this.timers.push(window.setTimeout(run, ms));
  }

  // --- the lobby ---------------------------------------------------------------------------------

  lobby(): LobbyState {
    return this.state;
  }

  onLobby(listener: (lobby: LobbyState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onClosed(listener: (reason: SessionClosed) => void): () => void {
    this.closers.add(listener);
    return () => this.closers.delete(listener);
  }

  private close(reason: SessionClosed): void {
    if (this.ended) return;
    this.ended = true;
    for (const listener of [...this.closers]) listener(reason);
  }

  /** Rebuilds the players: the host's first (when we are a guest), then ours, then the pretend guest's. */
  private publish(patch: Partial<LobbyState> = {}): void {
    const players: LobbyState["players"] = [];
    let slot = 0;
    const hostLabel = this.role === "guest" ? this.hostDevice : this.device;
    if (this.role === "guest" && this.remote) {
      players.push({
        slot: slot++,
        name: this.remote.name,
        colour: PLAYER_COLOURS[0]!,
        device: this.hostDevice,
        screen: this.hostDevice,
        control: "wheel",
        ready: this.remote.ready,
      });
    }
    for (const local of this.locals) {
      players.push({
        slot,
        name: local.name,
        colour: PLAYER_COLOURS[slot % PLAYER_COLOURS.length]!,
        device: this.device,
        // Shown here, or on the host's big screen.
        screen: local.screen === "host" && this.role === "guest" ? this.hostDevice : this.device,
        control: local.control.kind,
        ready: this.ready,
      });
      slot++;
    }
    if (this.role === "host" && this.remote) {
      players.push({
        slot,
        name: this.remote.name,
        colour: PLAYER_COLOURS[slot % PLAYER_COLOURS.length]!,
        device: "device-sam",
        screen: "device-sam",
        control: "wheel",
        ready: this.remote.ready,
      });
      slot++;
    }
    this.link.players = players.length;
    this.state = { ...this.state, host: hostLabel, players, ...patch };
    for (const listener of [...this.listeners]) listener(this.state);
  }

  setLocalPlayers(players: LocalPlayerSetup[]): void {
    this.locals = players;
    this.publish();
    // A guest gets to know the room a moment after arriving.
    if (this.role === "guest") {
      if (this.code === "LEFT") this.after(3000, () => this.close("host-left"));
      if (this.code === "DROP") this.after(3000, () => this.close("network"));
    }
  }

  setReady(ready: boolean): void {
    this.ready = ready;
    this.publish();
    // A fake host starts the race a little after a guest is ready, so the flow can be seen.
    if (this.role === "guest" && ready && !this.race && this.code !== "LEFT" && this.code !== "DROP") {
      this.after(6000, () => {
        if (this.state.phase === "lobby" && this.ready) this.begin();
      });
    }
  }

  configure(settings: Partial<LobbySettings>): void {
    if (this.role === "guest") return;
    this.state = { ...this.state, settings: { ...this.state.settings, ...settings } };
    this.publish();
  }

  private pretendGuestArrives(): void {
    if (this.ended || this.state.phase !== "lobby") return;
    this.remote = { name: "Sam", ready: true };
    this.publish();
  }

  // --- the race ----------------------------------------------------------------------------------

  start(): void {
    if (this.role === "guest") return;
    if (this.state.phase === "racing") return;
    if (!this.state.players.length || !this.state.players.every((player) => player.ready)) return;
    this.begin();
  }

  private begin(): void {
    const { settings } = this.state;
    const racers = this.state.players.map((player) => ({
      slot: player.slot,
      name: player.name,
      local: player.device === this.device ? (this.locals[this.localIndex(player.slot)] ?? null) : null,
    }));
    this.race = new FakeRace(trackById(settings.track), settings.laps, racers, settings.bots, settings.racers);
    this.lastNow = null;
    this.publish({ phase: "racing", result: null, karts: { ...this.race.map } });
  }

  /** Which of our own players a lobby slot is: the Nth, in order. */
  private localIndex(slot: number): number {
    return this.state.players.filter((player) => player.device === this.device && player.slot < slot).length;
  }

  backToLobby(): void {
    if (this.role === "guest") return;
    this.race = null;
    this.publish({ phase: "lobby", result: null, karts: {} });
  }

  frame(now: number): RaceView | null {
    const race = this.race;
    if (!race || this.state.phase === "results") return null;
    const dt = this.lastNow === null ? 0 : clamp((now - this.lastNow) / 1000, 0, 0.1);
    this.lastNow = now;
    race.step(dt, now);
    const view = race.view();
    if (race.result && this.state.phase === "racing") this.publish({ phase: "results", result: race.result });
    return view;
  }

  views(): number[] {
    const race = this.race;
    if (!race) return [];
    const shown = this.state.players.filter((player) => player.device === this.device && player.screen === this.device);
    return shown.map((player) => Number(Object.entries(race.map).find(([, slot]) => slot === player.slot)?.[0])).filter((id) => Number.isFinite(id));
  }

  leave(): void {
    this.ended = true;
    for (const timer of this.timers) window.clearTimeout(timer);
    this.listeners.clear();
    this.closers.clear();
    this.race = null;
  }
}

// --- the code -----------------------------------------------------------------------------------------------

const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const randomCode = (): string => Array.from({ length: 4 }, () => LETTERS[Math.floor(Math.random() * LETTERS.length)]).join("");

/** What the screens last asked a session maker for, so a test can see that `?net=local` arrived. */
declare global {
  interface Window {
    __fakeSessionOptions?: { how: "host" | "join" | "solo"; options: SessionOptions };
  }
}

export function createFakeServices(): Services {
  // A second track on request (?tracks=2), to see the lobby's menu.
  const tracks = TRACKS.map(({ id, name }) => ({ id, name }));
  if (params().get("tracks") === "2") tracks.push({ id: "canyon-run", name: "Canyon Run" });
  const asked = (how: "host" | "join" | "solo", options: SessionOptions) => {
    window.__fakeSessionOptions = { how, options };
  };
  return {
    async host(options: SessionOptions) {
      asked("host", options);
      await wait(200);
      return new FakeSession("host", randomCode(), "");
    },
    async join(code: string, options: SessionOptions) {
      asked("join", options);
      await wait(350);
      if (code === "ZZZZ") throw new SessionFailure("not-found");
      if (code === "FULL") throw new SessionFailure("full");
      return new FakeSession("guest", code, "device-maya");
    },
    async solo(options: SessionOptions) {
      asked("solo", options);
      return new FakeSession("solo", null, "");
    },
    renderer: (canvas, hudRoot) => new FakeRenderer(canvas, hudRoot),
    controls: { wheel: fakeWheel, keyboard: fakeKeyboard, gamepad: fakeGamepad },
    camera: fakeCamera(),
    preview: fakePreview,
    tracks,
  };
}
