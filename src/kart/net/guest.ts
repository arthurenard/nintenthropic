/**
 * A device that joined someone else's room. It does not run the race: it
 * keeps a copy of the sim only to *predict* its own karts, and draws everyone
 * else from what the host sends.
 *
 * Each frame (`frame(now)`) the guest
 *   1. turns the time since the last frame into whole 1/60 s ticks (at most 5);
 *      each tick it samples its controls, numbers the input, sends it with the
 *      five before it (so one lost packet costs nothing), and steps its own
 *      karts ahead with `predict` — they answer the wheel at once, whatever
 *      the line's delay;
 *   2. builds the picture: other karts ~70 ms behind the newest snapshot
 *      (more when snapshots arrive unevenly), gliding between two (view.ts);
 *      its own karts as predicted.
 *
 * When a snapshot arrives the host's word wins: `restore` it, then replay the
 * inputs the host has not applied yet (the snapshot says which it has) with
 * `predict`, landing where the guest would have been had it known all along.
 * The difference from where it was drawn is not shown as a jump: it is eased
 * out over 100 ms.
 */
import {
  IDLE_INPUT,
  MAX_PLAYERS,
  TICK,
  type DriveInput,
  type DriverControl,
  type LobbySettings,
  type LobbyState,
  type LocalPlayerSetup,
  type Race,
  type RaceSetup,
  type RaceSnapshot,
  type RaceView,
  type Session,
  type SessionClosed,
} from "../contract";
import { raceTrack } from "../track/mirror";
import { TickClock } from "./clock";
import { EventFeed } from "./feed";
import { defaultTransport, pageHidden, settle, type NetOptions, type Settled } from "./options";
import {
  INPUTS_PER_PACKET,
  PROTOCOL_VERSION,
  decode,
  decodeInput,
  encode,
  encodeInput,
  isPhoto,
  unpackState,
  type StartInfo,
  type ToGuest,
  type ToHost,
  type WireInput,
  type WirePlayer,
} from "./protocol";
import { DEFAULT_SETTINGS, ScreenKarts, kartsOnScreen } from "./roster";
import { TransportError, type Link, type Transport } from "./transport";
import { Emitter, clamp, lerp, lerpAngle, token, wrapAngle } from "./util";
import { DisplayClock, LagMeter, SnapshotBuffer, pictureOf } from "./view";

const MAX_TICKS_PER_FRAME = 5;
const MAX_TICKS_HIDDEN = 90;
/** Inputs kept for replay: two seconds of ticks, far more than any sane delay. */
const HISTORY = 120;
/** How long a visible correction takes to ease out, ms. */
const CORRECTION_MS = 100;
/** A prediction this far (metres) from the host's is a teleport or a respawn, not a drift: jump, do not glide. */
const SNAP_DISTANCE = 3;
const PING_MS = 1000;
/** Nothing from the host for this long (ms): the line has gone. */
const SILENCE_MS = 8000;
/**
 * Nothing from the host for this long (ms), not even an answer to a ping (one goes every second): the line is quiet,
 * and `link.connected` says so, so the screens can say they are waiting rather than freeze without a word.
 */
const QUIET_MS = 2500;
/** The host did not answer our hello within this long (ms). */
const WELCOME_MS = 10000;
const FALLBACK_MS = 100;
const NO_FRAME_MS = 250;

interface Pose {
  x: number;
  y: number;
  z: number;
  heading: number;
}

const NO_OFFSET: Pose = { x: 0, y: 0, z: 0, heading: 0 };

/** One of this device's karts. */
interface Own {
  kart: number;
  control: DriverControl | undefined;
  /** The number of the last input sent. */
  seq: number;
  /** Inputs the host has not told us it applied yet, oldest first. */
  history: { seq: number; wire: WireInput; input: DriveInput }[];
  /** Where it is drawn, less where it is predicted: eases to nothing. */
  offset: Pose;
  /** When `offset` was set, ms. */
  since: number;
  /** The prediction at the last two ticks: a frame is drawn between them, so a fast screen glides. */
  prev: Pose;
  curr: Pose;
}

const poseOf = (k: Pose): Pose => ({ x: k.x, y: k.y, z: k.z, heading: k.heading });

function lerpPose(a: Pose, b: Pose, f: number): Pose {
  return { x: lerp(a.x, b.x, f), y: lerp(a.y, b.y, f), z: lerp(a.z, b.z, f), heading: lerpAngle(a.heading, b.heading, f) };
}

function placeholderLobby(code: string): LobbyState {
  return {
    code,
    host: "",
    players: [],
    settings: { ...DEFAULT_SETTINGS },
    phase: "lobby",
    result: null,
    karts: {},
  };
}

export class GuestSession implements Session {
  readonly role = "guest";
  private myDevice: string;
  private env: Settled;
  private transport: Transport;
  private link_: Link | null = null;
  private open = false;

  private lobbyState: LobbyState;
  private local: LocalPlayerSetup[] = [];
  private ready = false;

  private race: Race | null = null;
  /** The race's seed, which names it on the wire. */
  private raceId = 0;
  private clock = new TickClock();
  private own = new Map<number, Own>();
  /** Our karts this screen draws: the ones worth predicting. */
  private shown: number[] = [];
  private onScreen = new ScreenKarts();
  /** Our copy of the race as `predict` or `restore` last left it: drawn from many times between ticks, so made once. */
  private picture: RaceView | null = null;
  private buffer = new SnapshotBuffer();
  private display = new DisplayClock();
  private lag = new LagMeter();
  private feed = new EventFeed();
  private lastFrameNow: number | null = null;
  /** How far into a tick the frame stood when the host stopped the race: it stays there. */
  private frozenAt = 0;
  /** The last hands-lost flags sent, to send only a change. */
  private lostSent = "";
  /** This device's karts in the race being run or just run (they outlive it, for its photos). */
  private ownKarts = new Set<number>();
  /** Finish-line photos of ours waiting for the race to be decided, by kart; the karts whose photo has gone. */
  private photosOut = new Map<number, string>();
  private photosSent = new Set<number>();
  /** The host has said how the race ended: our photos may go. */
  private decided = false;
  private photoListeners = new Emitter<{ kart: number; race: number; photo: string }>();

  private rtt_: number | null = null;
  private heard = 0;
  private lastPing = -Infinity;
  private startedAt: number;

  private lobbyListeners = new Emitter<LobbyState>();
  private closeListeners = new Emitter<SessionClosed>();
  private closedWith: SessionClosed | null = null;
  private stopTimer: (() => void) | null = null;
  private lastFrameAt = -Infinity;
  private onHide = () => this.leave();

  constructor(
    private code: string,
    options: NetOptions,
  ) {
    this.env = settle(options);
    this.myDevice = this.env.device ?? `d-${token(this.env.random)}`;
    this.lobbyState = placeholderLobby(code);
    this.transport = (options.transport ?? defaultTransport)();
    this.startedAt = this.env.now();
    this.stopTimer = this.env.schedule(() => this.fallback(), FALLBACK_MS);
    globalThis.addEventListener?.("pagehide", this.onHide);
    void this.connect();
  }

  get device(): string {
    return this.myDevice;
  }

  get link(): Session["link"] {
    const heardLately = this.env.now() - this.heard < QUIET_MS;
    return { connected: this.open && !this.closedWith && heardLately, rtt: this.rtt_, players: this.lobbyState.players.length };
  }

  // ─── Getting in ───────────────────────────────────────────────────────────

  private async connect(): Promise<void> {
    let link: Link;
    try {
      link = await this.transport.connect(this.code);
    } catch (error) {
      this.close(error instanceof TransportError && error.kind === "not-found" ? "not-found" : "network");
      return;
    }
    if (this.closedWith) {
      link.close();
      return;
    }
    this.link_ = link;
    this.heard = this.env.now();
    link.onMessage((_channel, data) => this.onMessage(data));
    // A link that ends without the host's "leave" first is a lost connection, not a host who chose to go.
    link.onClose(() => this.close("network"));
    this.sendToHost({
      t: "hello",
      v: PROTOCOL_VERSION,
      device: this.myDevice,
      n: this.local.length > 0 ? this.local.length : this.env.players,
    });
  }

  private sendToHost(message: ToHost, channel: "reliable" | "unreliable" = "reliable"): void {
    this.link_?.send(channel, encode(message));
  }

  private onMessage(data: string): void {
    const message = decode(data) as ToGuest | null;
    if (!message || this.closedWith) return;
    this.heard = this.env.now();
    try {
      this.handle(message);
    } catch (error) {
      console.warn("Grip Prix: ignoring a bad message", error);
    }
  }

  private handle(message: ToGuest): void {
    switch (message.t) {
      case "welcome":
        // The host speaks another version of the game: better to say so now than misread it mid-race.
        if (message.v !== PROTOCOL_VERSION) return this.close("version");
        this.myDevice = message.device;
        this.open = true;
        this.lobbyState = message.lobby;
        // What the screens set before the line was up.
        if (this.local.length > 0) this.sendConfigure();
        if (this.ready) this.sendToHost({ t: "ready", ready: true });
        this.lobbyListeners.emit(this.lobbyState);
        return;
      case "reject":
        return this.close(message.reason === "full" ? "full" : message.reason === "started" ? "started" : "version");
      case "lobby": {
        const wasPaused = !!this.lobbyState.pause;
        this.lobbyState = message.lobby;
        // The host called the race off, or went back to the lobby.
        if (message.lobby.phase !== "racing" && this.race) this.endRace();
        // The host stopped the race: hold the picture where it is. Picked up again: the time spent stopped is not owed.
        if (!wasPaused && message.lobby.pause) this.frozenAt = this.clock.fraction;
        if (wasPaused && !message.lobby.pause) {
          this.clock.reset();
          this.lastFrameNow = null;
        }
        this.lobbyListeners.emit(this.lobbyState);
        return;
      }
      case "start":
        this.begin(message.start);
        return;
      case "snap":
        if (message.r === this.raceId) this.onSnapshot(message.state, message.acks);
        return;
      case "events":
        this.feed.push(message.events);
        return;
      case "results":
        this.endRace();
        this.lobbyState = message.lobby;
        this.decided = true;
        this.sendPhotos();
        this.lobbyListeners.emit(this.lobbyState);
        return;
      case "photo":
        if (message.r === this.raceId && typeof message.kart === "number" && !this.ownKarts.has(message.kart) && isPhoto(message.jpeg)) {
          this.photoListeners.emit({ kart: message.kart, race: this.raceId, photo: message.jpeg });
        }
        return;
      case "pong": {
        const sample = this.env.now() - message.at;
        this.rtt_ = this.rtt_ === null ? sample : lerp(this.rtt_, sample, 0.3);
        return;
      }
      case "leave":
        this.close("host-left");
        return;
      default:
        return;
    }
  }

  // ─── Session: the lobby ───────────────────────────────────────────────────

  lobby(): LobbyState {
    return this.lobbyState;
  }

  onLobby(listener: (lobby: LobbyState) => void): () => void {
    return this.lobbyListeners.add(listener);
  }

  onClosed(listener: (reason: SessionClosed) => void): () => void {
    if (this.closedWith) {
      const reason = this.closedWith;
      queueMicrotask(() => listener(reason));
    }
    return this.closeListeners.add(listener);
  }

  setLocalPlayers(players: LocalPlayerSetup[]): void {
    this.local = players.slice(0, MAX_PLAYERS);
    if (this.open && this.race === null) this.sendConfigure();
  }

  private sendConfigure(): void {
    const players = this.local.map((p): WirePlayer => ({ name: p.name, control: p.control.kind, screen: p.screen, character: p.character, golden: p.golden }));
    this.sendToHost({ t: "configure", players });
  }

  setReady(ready: boolean): void {
    this.ready = ready;
    if (this.open) this.sendToHost({ t: "ready", ready });
  }

  /** Whose hands are gone, in the order of `setLocalPlayers`: sent to the host when it changes. */
  setHandsLost(lost: readonly boolean[]): void {
    const flags = this.local.map((_, i) => lost[i] === true);
    const text = flags.map((flag) => (flag ? "1" : "0")).join("");
    if (text === this.lostSent) return;
    this.lostSent = text;
    if (this.open) this.sendToHost({ t: "lost", lost: flags });
  }

  // ─── The finish-line photos ───────────────────────────────────────────────

  sharePhoto(kart: number, photo: string): void {
    if (this.closedWith || !this.ownKarts.has(kart) || this.photosSent.has(kart) || !isPhoto(photo)) return;
    this.photosOut.set(kart, photo);
    if (this.decided) this.sendPhotos();
  }

  /** Our photos to the host, which passes them on: only once the race is decided, so nobody still racing waits behind them. */
  private sendPhotos(): void {
    if (!this.open) return;
    for (const [kart, jpeg] of this.photosOut) {
      this.sendToHost({ t: "photo", r: this.raceId, kart, jpeg });
      this.photosSent.add(kart);
    }
    this.photosOut.clear();
  }

  onPhoto(listener: (photo: { kart: number; race: number; photo: string }) => void): () => void {
    return this.photoListeners.add(listener);
  }

  /** Only the host chooses, and stops and starts the race. */
  configure(_settings: Partial<LobbySettings>): void {}
  start(): void {}
  restart(): void {}
  backToLobby(): void {}
  pause(): boolean {
    return false;
  }
  resume(): void {}

  // ─── Session: the race ────────────────────────────────────────────────────

  /** The host has started: build our copy of the race and our karts. */
  private begin(start: StartInfo): void {
    const setup: RaceSetup = { track: raceTrack(start.track, start.mirror), laps: start.laps, seed: start.seed, racers: start.racers };
    const race = this.env.createRace(setup);
    this.race = race;
    this.raceId = start.seed;
    this.lobbyState = start.lobby;
    this.buffer.clear();
    this.display.reset();
    this.lag.reset();
    this.feed.clear();
    this.clock.reset();
    this.lastFrameNow = null;
    this.lostSent = "";
    // Until the first snapshot there is only the grid as it begins.
    const grid = pictureOf(race);
    this.picture = null;
    this.buffer.push(0, grid);

    const mine = start.lobby.players.filter((p) => p.device === this.myDevice).map((p) => p.slot);
    this.own.clear();
    for (const [kartText, slot] of Object.entries(start.lobby.karts)) {
      const index = mine.indexOf(slot);
      if (index < 0) continue;
      const kart = Number(kartText);
      const placed = grid.karts.find((k) => k.id === kart);
      const at = placed ? poseOf(placed) : NO_OFFSET;
      this.own.set(kart, {
        kart,
        control: this.local[index]?.control,
        seq: 0,
        history: [],
        offset: NO_OFFSET,
        since: 0,
        prev: at,
        curr: at,
      });
    }
    this.ownKarts = new Set(this.own.keys());
    this.photosOut.clear();
    this.photosSent.clear();
    this.decided = false;
    // Only karts drawn here are worth predicting; the others (on the big screen) are just driven.
    const onScreen = new Set(kartsOnScreen(start.lobby, this.myDevice));
    this.shown = [...this.own.keys()].filter((k) => onScreen.has(k));
    this.lobbyListeners.emit(this.lobbyState);
  }

  private endRace(): void {
    this.race = null;
    this.picture = null;
    this.own.clear();
    this.shown = [];
    this.buffer.clear();
  }

  views(): number[] {
    return this.onScreen.of(this.lobbyState, this.myDevice);
  }

  frame(now: number): RaceView | null {
    if (this.closedWith) return null;
    this.lastFrameAt = this.env.now();
    this.advance(now, MAX_TICKS_PER_FRAME);
    const race = this.race;
    const newest = this.buffer.newest;
    if (!race || !newest || this.lobbyState.phase !== "racing") return null;

    // While the host has the race stopped, the picture holds still: time does not pass.
    const stopped = !!this.lobbyState.pause;
    const dt = this.lastFrameNow === null || stopped ? 0 : Math.max(0, now - this.lastFrameNow) / 1000;
    this.lastFrameNow = now;
    const base = this.buffer.at(this.display.advance(dt, newest.time, this.lag.lag));
    if (!base) return null;

    let karts = base.karts;
    if (this.shown.length > 0) {
      const predicted = this.ours(race).karts;
      const t = this.env.now();
      const into = stopped ? this.frozenAt : this.clock.fraction;
      karts = base.karts.map((snapshot) => {
        const own = this.own.get(snapshot.id);
        const mine = own ? predicted.find((k) => k.id === snapshot.id) : undefined;
        if (!own || !mine || !this.shown.includes(snapshot.id)) return snapshot;
        const at = this.drawnAt(own, into, t);
        return {
          // The race's own facts (place, lap, finish) are the host's; how the kart is moving is ours.
          ...snapshot,
          x: at.x,
          y: at.y,
          z: at.z,
          heading: at.heading,
          speed: mine.speed,
          steer: mine.steer,
          drift: mine.drift,
          driftLevel: mine.driftLevel,
          course: mine.course,
          draft: mine.draft,
          trick: mine.trick,
          boost: mine.boost,
          spin: mine.spin,
          hop: mine.hop,
          offroad: mine.offroad,
          item: mine.item,
          itemUses: mine.itemUses,
          rolling: mine.rolling,
        };
      });
    }
    return { ...base, karts, events: this.feed.drain() };
  }

  /**
   * Where one of our karts is drawn: its prediction `into` the way from the
   * tick before the last to the last (so a 120 Hz screen moves every frame),
   * plus whatever correction from the host is still easing out.
   */
  private drawnAt(own: Own, into: number, t: number): Pose {
    const at = lerpPose(own.prev, own.curr, into);
    const left = 1 - ease((t - own.since) / CORRECTION_MS);
    return {
      x: at.x + own.offset.x * left,
      y: at.y + own.offset.y * left,
      z: at.z + own.offset.z * left,
      heading: at.heading + own.offset.heading * left,
    };
  }

  /** Our copy of the race as it stands: asked for once after it changes, however many frames are drawn from it. */
  private ours(race: Race): RaceView {
    return (this.picture ??= race.view());
  }

  private fallback(): void {
    const now = this.env.now();
    if (pageHidden() || now - this.lastFrameAt > NO_FRAME_MS) this.advance(now, MAX_TICKS_HIDDEN);
  }

  private advance(now: number, maxTicks: number): void {
    if (this.closedWith) return;
    this.housekeeping();
    const race = this.race;
    if (!race || this.lobbyState.phase !== "racing") return;
    // The host has stopped the race: no inputs go out, nothing is predicted.
    if (this.lobbyState.pause) return;
    const ticks = this.clock.ticks(now, maxTicks);
    for (let i = 0; i < ticks; i++) this.localTick(race, now);
  }

  /** One tick of our drivers: sample, number, send, and run our own karts ahead. */
  private localTick(race: Race, now: number): void {
    const predicted = new Map<number, DriveInput>();
    const packet: [number, WireInput[]][] = [];
    for (const own of this.own.values()) {
      const wire = encodeInput(++own.seq, own.control ? own.control.sample(now) : IDLE_INPUT);
      // Both ends use the input as it was rounded for the wire, so they agree on it.
      const input = decodeInput(wire);
      own.history.push({ seq: own.seq, wire, input });
      if (own.history.length > HISTORY) own.history.shift();
      packet.push([own.kart, own.history.slice(-INPUTS_PER_PACKET).map((h) => h.wire)]);
      if (this.shown.includes(own.kart)) predicted.set(own.kart, input);
    }
    if (packet.length > 0) this.sendToHost({ t: "in", r: this.raceId, k: packet }, "unreliable");
    if (predicted.size > 0) {
      race.predict([...predicted.keys()], predicted);
      this.picture = null;
      for (const k of this.ours(race).karts) {
        const own = this.own.get(k.id);
        if (!own || !predicted.has(k.id)) continue;
        own.prev = own.curr;
        own.curr = poseOf(k);
      }
    }
  }

  /** The host's snapshot: take its word, replay what it has not heard yet, and ease out the difference. */
  private onSnapshot(sent: RaceSnapshot, acks: Record<number, number>): void {
    const race = this.race;
    if (!race || !sent || typeof sent.tick !== "number") return;
    if (!this.buffer.accepts(sent.tick)) return;
    const state = unpackState(sent);
    if (!state) return;

    const t = this.env.now();
    const shown = this.shown.map((k) => this.own.get(k)!);
    // Where each of our karts is being drawn right now.
    const before = new Map<number, Pose>();
    const into = this.lobbyState.pause ? this.frozenAt : this.clock.fraction;
    for (const own of shown) before.set(own.kart, this.drawnAt(own, into, t));

    race.restore(state);
    this.picture = null;
    const restored = pictureOf(race);
    this.buffer.push(state.tick, restored);
    this.lag.note(state.tick * TICK, t / 1000);

    for (const own of this.own.values()) {
      const ack = acks?.[own.kart] ?? 0;
      while (own.history.length > 0 && own.history[0]!.seq <= ack) own.history.shift();
    }
    if (shown.length === 0) return;

    // Replay what the host has not applied: step k of every kart's backlog together.
    const steps = Math.max(...shown.map((o) => o.history.length));
    for (let i = 0; i < steps; i++) {
      const inputs = new Map<number, DriveInput>();
      for (const own of shown) {
        const entry = own.history[i];
        if (entry) inputs.set(own.kart, entry.input);
      }
      race.predict([...inputs.keys()], inputs);
    }

    // With nothing to replay, our copy is as the host left it: the picture just taken.
    this.picture = steps > 0 ? null : restored;
    for (const k of this.ours(race).karts) {
      const own = this.own.get(k.id);
      const was = before.get(k.id);
      if (!own || !was) continue;
      const corrected = poseOf(k);
      const moved = {
        x: corrected.x - own.curr.x,
        y: corrected.y - own.curr.y,
        z: corrected.z - own.curr.z,
        heading: wrapAngle(corrected.heading - own.curr.heading),
      };
      own.since = t;
      if (Math.hypot(moved.x, moved.z) > SNAP_DISTANCE) {
        // A teleport or a respawn, not a drift: jump, do not glide.
        own.prev = own.curr = corrected;
        own.offset = NO_OFFSET;
        continue;
      }
      // The host's word moves where the kart is; the picture it was gliding through moves with it, so the
      // motion carries on unbroken, and what is left between where it was drawn and where it is now eases out.
      own.prev = { x: own.prev.x + moved.x, y: own.prev.y + moved.y, z: own.prev.z + moved.z, heading: own.prev.heading + moved.heading };
      own.curr = corrected;
      const at = lerpPose(own.prev, own.curr, into);
      own.offset = { x: was.x - at.x, y: was.y - at.y, z: was.z - at.z, heading: wrapAngle(was.heading - at.heading) };
    }
  }

  // ─── Upkeep ───────────────────────────────────────────────────────────────

  private housekeeping(): void {
    const now = this.env.now();
    if (!this.open) {
      if (now - this.startedAt > WELCOME_MS) this.close("network");
      return;
    }
    if (now - this.heard > SILENCE_MS) return this.close("network");
    if (now - this.lastPing >= PING_MS) {
      this.lastPing = now;
      this.sendToHost({ t: "ping", at: now });
    }
  }

  // ─── Leaving ──────────────────────────────────────────────────────────────

  leave(): void {
    if (this.closedWith) return;
    this.sendToHost({ t: "leave" });
    this.close("left");
  }

  private close(reason: SessionClosed): void {
    if (this.closedWith) return;
    this.closedWith = reason;
    this.open = false;
    this.stopTimer?.();
    this.stopTimer = null;
    globalThis.removeEventListener?.("pagehide", this.onHide);
    this.link_?.close();
    this.transport.close();
    this.endRace();
    this.closeListeners.emit(reason);
  }
}

/** Smoothstep: 0 at the start, 1 at the end, gentle at both. */
function ease(f: number): number {
  const x = clamp(f, 0, 1);
  return x * x * (3 - 2 * x);
}

/** Joins the room with this code. Failures arrive as `onClosed`: "not-found", "full", "network"... */
export function joinSession(code: string, options: NetOptions): Session {
  return new GuestSession(code.toUpperCase(), options);
}
