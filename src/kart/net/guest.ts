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
 *   2. builds the picture: other karts ~70 ms behind the newest snapshot,
 *      gliding between two (view.ts); its own karts as predicted.
 *
 * When a snapshot arrives the host's word wins: `restore` it, then replay the
 * inputs the host has not applied yet (the snapshot says which it has) with
 * `predict`, landing where the guest would have been had it known all along.
 * The difference from where it was drawn is not shown as a jump: it is eased
 * out over 100 ms.
 */
import {
  IDLE_INPUT,
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
import { trackById } from "../track/tracks";
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
  type StartInfo,
  type ToGuest,
  type ToHost,
  type WireInput,
  type WirePlayer,
} from "./protocol";
import { DEFAULT_SETTINGS, kartsOnScreen } from "./roster";
import { TransportError, type Link, type Transport } from "./transport";
import { Emitter, clamp, lerp, token, wrapAngle } from "./util";
import { DisplayClock, SnapshotBuffer, cloneView } from "./view";

/**
 * "The host speaks another version of the game". The contract's SessionClosed
 * has no such reason yet (it wants a "version"); until it does, the screens
 * can test for this string.
 */
export const VERSION_MISMATCH: SessionClosed = "version";

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
  private buffer = new SnapshotBuffer();
  private display = new DisplayClock();
  private feed = new EventFeed();
  private lastFrameNow: number | null = null;

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
    return { connected: this.open && !this.closedWith, rtt: this.rtt_, players: this.lobbyState.players.length };
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
        if (message.v !== PROTOCOL_VERSION) return this.close(VERSION_MISMATCH);
        this.myDevice = message.device;
        this.open = true;
        this.lobbyState = message.lobby;
        // What the screens set before the line was up.
        if (this.local.length > 0) this.sendConfigure();
        if (this.ready) this.sendToHost({ t: "ready", ready: true });
        this.lobbyListeners.emit(this.lobbyState);
        return;
      case "reject":
        return this.close(message.reason === "full" ? "full" : message.reason === "started" ? "started" : VERSION_MISMATCH);
      case "lobby":
        this.lobbyState = message.lobby;
        // The host called the race off, or went back to the lobby.
        if (message.lobby.phase !== "racing" && this.race) this.endRace();
        this.lobbyListeners.emit(this.lobbyState);
        return;
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
        this.lobbyListeners.emit(this.lobbyState);
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
    this.local = players.slice(0, 2);
    if (this.open && this.race === null) this.sendConfigure();
  }

  private sendConfigure(): void {
    const players = this.local.map((p): WirePlayer => ({ name: p.name, control: p.control.kind, screen: p.screen }));
    this.sendToHost({ t: "configure", players });
  }

  setReady(ready: boolean): void {
    this.ready = ready;
    if (this.open) this.sendToHost({ t: "ready", ready });
  }

  /** Only the host chooses. */
  configure(_settings: Partial<LobbySettings>): void {}
  start(): void {}
  backToLobby(): void {}

  // ─── Session: the race ────────────────────────────────────────────────────

  /** The host has started: build our copy of the race and our karts. */
  private begin(start: StartInfo): void {
    const setup: RaceSetup = { track: trackById(start.track), laps: start.laps, seed: start.seed, racers: start.racers };
    const race = this.env.createRace(setup);
    this.race = race;
    this.raceId = start.seed;
    this.lobbyState = start.lobby;
    this.buffer.clear();
    this.display.reset();
    this.feed.clear();
    this.clock.reset();
    this.lastFrameNow = null;
    // Until the first snapshot there is only the grid as it begins.
    this.buffer.push(0, cloneView(race.view()));

    const mine = start.lobby.players.filter((p) => p.device === this.myDevice).map((p) => p.slot);
    this.own.clear();
    for (const [kartText, slot] of Object.entries(start.lobby.karts)) {
      const index = mine.indexOf(slot);
      if (index < 0) continue;
      const kart = Number(kartText);
      this.own.set(kart, {
        kart,
        control: this.local[index]?.control,
        seq: 0,
        history: [],
        offset: NO_OFFSET,
        since: 0,
      });
    }
    // Only karts drawn here are worth predicting; the others (on the big screen) are just driven.
    const onScreen = new Set(kartsOnScreen(start.lobby, this.myDevice));
    this.shown = [...this.own.keys()].filter((k) => onScreen.has(k));
    this.lobbyListeners.emit(this.lobbyState);
  }

  private endRace(): void {
    this.race = null;
    this.own.clear();
    this.shown = [];
    this.buffer.clear();
  }

  views(): number[] {
    return kartsOnScreen(this.lobbyState, this.myDevice);
  }

  frame(now: number): RaceView | null {
    if (this.closedWith) return null;
    this.lastFrameAt = this.env.now();
    this.advance(now, MAX_TICKS_PER_FRAME);
    const race = this.race;
    const newest = this.buffer.newest;
    if (!race || !newest || this.lobbyState.phase !== "racing") return null;

    const dt = this.lastFrameNow === null ? 0 : Math.max(0, now - this.lastFrameNow) / 1000;
    this.lastFrameNow = now;
    const base = this.buffer.at(this.display.advance(dt, newest.time));
    if (!base) return null;

    let karts = base.karts;
    if (this.shown.length > 0) {
      const predicted = new Map(race.view().karts.map((k) => [k.id, k]));
      const t = this.env.now();
      karts = base.karts.map((snapshot) => {
        const own = this.own.get(snapshot.id);
        const mine = predicted.get(snapshot.id);
        if (!own || !mine || !this.shown.includes(snapshot.id)) return snapshot;
        const left = 1 - ease((t - own.since) / CORRECTION_MS);
        return {
          // The race's own facts (place, lap, finish) are the host's; how the kart is moving is ours.
          ...snapshot,
          x: mine.x + own.offset.x * left,
          y: mine.y + own.offset.y * left,
          z: mine.z + own.offset.z * left,
          heading: mine.heading + own.offset.heading * left,
          speed: mine.speed,
          steer: mine.steer,
          drift: mine.drift,
          driftLevel: mine.driftLevel,
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

  private fallback(): void {
    const now = this.env.now();
    if (pageHidden() || now - this.lastFrameAt > NO_FRAME_MS) this.advance(now, MAX_TICKS_HIDDEN);
  }

  private advance(now: number, maxTicks: number): void {
    if (this.closedWith) return;
    this.housekeeping();
    const race = this.race;
    if (!race || this.lobbyState.phase !== "racing") return;
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
    if (predicted.size > 0) race.predict([...predicted.keys()], predicted);
  }

  /** The host's snapshot: take its word, replay what it has not heard yet, and ease out the difference. */
  private onSnapshot(state: RaceSnapshot, acks: Record<number, number>): void {
    const race = this.race;
    if (!race || !state || typeof state.tick !== "number") return;
    if (!this.buffer.accepts(state.tick)) return;

    const t = this.env.now();
    const shown = this.shown.map((k) => this.own.get(k)!);
    // Where each of our karts is being drawn right now.
    const before = new Map<number, Pose>();
    if (shown.length > 0) {
      for (const k of race.view().karts) {
        const own = this.own.get(k.id);
        if (!own || !this.shown.includes(k.id)) continue;
        const left = 1 - ease((t - own.since) / CORRECTION_MS);
        before.set(k.id, {
          x: k.x + own.offset.x * left,
          y: k.y + own.offset.y * left,
          z: k.z + own.offset.z * left,
          heading: k.heading + own.offset.heading * left,
        });
      }
    }

    race.restore(state);
    this.buffer.push(state.tick, cloneView(race.view()));

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

    for (const k of race.view().karts) {
      const own = this.own.get(k.id);
      const was = before.get(k.id);
      if (!own || !was) continue;
      const offset: Pose = {
        x: was.x - k.x,
        y: was.y - k.y,
        z: was.z - k.z,
        heading: wrapAngle(was.heading - k.heading),
      };
      own.offset = Math.hypot(offset.x, offset.z) > SNAP_DISTANCE ? NO_OFFSET : offset;
      own.since = t;
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
