/**
 * The device that runs the race. Its race is the truth: guests send what
 * their drivers do, the host steps the sim, and tells everyone what happened.
 *
 * One class serves two roles, because the only difference is whether anybody
 * can connect: `hostSession` listens on a transport under a room code;
 * `soloSession` (solo.ts) is the same host with no transport at all.
 *
 * Each frame (`frame(now)`) the host
 *   1. turns the time since the last frame into whole 1/60 s ticks (at most 5),
 *   2. for each tick gathers one input per player kart — this device's controls
 *      sampled right now, a guest's taken from its queue, a departed guest's
 *      from the autopilot — and steps the race,
 *   3. every second tick sends every guest a snapshot (30 Hz, unreliable) with
 *      the last input of theirs it applied, and the events since the last
 *      batch (reliable),
 *   4. returns the view to draw.
 * When the tab is hidden no frames come, so a timer runs the same advance.
 */
import {
  IDLE_INPUT,
  MAX_RACERS,
  TICK_HZ,
  type DriveInput,
  type DriverControl,
  type LobbySettings,
  type LobbyState,
  type LocalPlayerSetup,
  type Race,
  type RaceEvent,
  type RaceResult,
  type RaceView,
  type Session,
  type SessionClosed,
} from "../contract";
import { TrackGeometry } from "../track/geometry";
import { Autopilot } from "./autopilot";
import { TickClock } from "./clock";
import { makeCode } from "./codes";
import { EventFeed } from "./feed";
import { defaultTransport, pageHidden, settle, type NetOptions, type Settled } from "./options";
import {
  INPUTS_PER_PACKET,
  PROTOCOL_VERSION,
  decode,
  decodeInput,
  encode,
  encodeSnapshot,
  type ToGuest,
  type ToHost,
  type WirePlayer,
} from "./protocol";
import { DEFAULT_SETTINGS, Roster, cleanPlayer, kartsOnScreen, mergeSettings } from "./roster";
import { buildSetup } from "./setup";
import { TransportError, type Link, type Transport } from "./transport";
import { Emitter, clamp, token } from "./util";

/** A snapshot goes out every this many ticks: 60 / 2 = 30 a second. */
const SNAPSHOT_EVERY = 2;
/** At most this many ticks in one frame; a device that fell behind skips ahead rather than racing to catch up. */
const MAX_TICKS_PER_FRAME = 5;
/** The same, for the timer that runs the race while the tab is hidden (its callbacks come about once a second). */
const MAX_TICKS_HIDDEN = 90;
/** A guest's queue longer than this is cut to the newest `QUEUE_KEEP`: better to skip than to drive late. */
const QUEUE_MAX = 4;
const QUEUE_KEEP = 2;
/** With no new input for this many ticks (half a second) a guest's kart stops being driven: coasts. */
const HOLD_TICKS = TICK_HZ / 2;
/** A guest we have heard nothing from for this long (ms) has gone. */
const SILENCE_MS = 8000;
/** A link that has not said hello within this long (ms) is dropped. */
const HELLO_MS = 5000;
/** The fallback timer's period, ms; and how long without a frame counts as "no frames are coming". */
const FALLBACK_MS = 100;
const NO_FRAME_MS = 250;
/** How often the slow housekeeping runs, ms. */
const HOUSEKEEPING_MS = 250;

interface Guest {
  device: string;
  link: Link;
  /** When we last heard from it, ms. */
  heard: number;
}

/** A guest's kart: the inputs that came in, waiting their turn. */
interface Remote {
  kart: number;
  device: string;
  queue: { seq: number; input: DriveInput }[];
  /** The highest seq ever queued: anything at or below it is a repeat. */
  highest: number;
  /** The seq of the input applied last, which is what the guest is told. */
  applied: number;
  last: DriveInput;
  /** Ticks in a row with nothing to take. */
  empty: number;
}

export class HostSession implements Session {
  readonly device: string;
  private env: Settled;
  private transport: Transport | null;

  private roster: Roster;
  private settings: LobbySettings = { ...DEFAULT_SETTINGS };
  private phase: LobbyState["phase"] = "lobby";
  private result: RaceResult | null = null;
  private kartSlots: Record<number, number> = {};
  private code: string | null = null;
  private lobbyCache: LobbyState | null = null;
  private local: LocalPlayerSetup[] = [];

  private guests = new Map<string, Guest>();
  /** Every open link: its device once it has said hello, null before. */
  private links = new Map<Link, { device: string | null; since: number }>();

  private race: Race | null = null;
  private clock = new TickClock();
  private remote = new Map<number, Remote>();
  private controls = new Map<number, DriverControl>();
  private autopilots = new Map<number, Autopilot>();
  private geometry: TrackGeometry | null = null;
  private feed = new EventFeed();
  private outEvents: RaceEvent[] = [];
  private sinceSnapshot = 0;
  /** The tick the race was decided at, once it is. */
  private endedAt: number | null = null;

  private lobbyListeners = new Emitter<LobbyState>();
  private closeListeners = new Emitter<SessionClosed>();
  private closedWith: SessionClosed | null = null;
  private stopTimer: (() => void) | null = null;
  private lastFrameAt = -Infinity;
  private lastHousekeeping = -Infinity;
  private onHide = () => this.leave();

  /** The host has no line of its own to measure, so there is no round trip to show. */
  get link(): Session["link"] {
    return { connected: !this.closedWith, rtt: null, players: this.roster.count };
  }

  constructor(
    readonly role: "host" | "solo",
    options: NetOptions,
    transport: Transport | null,
  ) {
    this.env = settle(options);
    this.transport = transport;
    this.device = this.env.device ?? `d-${token(this.env.random)}`;
    this.roster = new Roster(this.device);
    this.roster.reserve(this.device, this.env.players);

    this.stopTimer = this.env.schedule(() => this.fallback(), FALLBACK_MS);
    globalThis.addEventListener?.("pagehide", this.onHide);
    if (transport) void this.open(transport);
  }

  // ─── The room ─────────────────────────────────────────────────────────────

  /** Takes a room code (drawing again if one is taken) and starts letting guests in. */
  private async open(transport: Transport): Promise<void> {
    transport.onIncoming((link) => this.accept(link));
    transport.onError(() => {
      // The broker is gone. Guests already here are connected to us directly and carry on;
      // with none, a room nobody can find is no room.
      if (this.guests.size === 0 && this.phase === "lobby") this.close("network");
    });
    for (let attempt = 0; attempt < 12; attempt++) {
      const code = makeCode(this.env.random);
      try {
        await transport.listen(code);
      } catch (error) {
        if (this.closedWith) return;
        if (error instanceof TransportError && error.kind === "taken") continue;
        this.close("network");
        return;
      }
      if (this.closedWith) return;
      this.code = code;
      this.changed();
      return;
    }
    this.close("network");
  }

  private accept(link: Link): void {
    if (this.closedWith) {
      link.close();
      return;
    }
    this.links.set(link, { device: null, since: this.env.now() });
    link.onMessage((_channel, data) => this.onMessage(link, data));
    link.onClose(() => this.onLinkClosed(link));
  }

  private send(link: Link, message: ToGuest, channel: "reliable" | "unreliable" = "reliable"): void {
    link.send(channel, encode(message));
  }

  private broadcast(message: ToGuest, except?: string): void {
    const text = encode(message);
    for (const guest of this.guests.values()) if (guest.device !== except) guest.link.send("reliable", text);
  }

  private onMessage(link: Link, data: string): void {
    const entry = this.links.get(link);
    const message = decode(data) as ToHost | null;
    if (!entry || !message) return;
    try {
      if (entry.device === null) {
        if (message.t === "hello") this.onHello(link, message);
        return;
      }
      const guest = this.guests.get(entry.device);
      if (!guest) return;
      guest.heard = this.env.now();
      this.onGuestMessage(guest, message);
    } catch (error) {
      // One guest's malformed message must not stop the race for everyone.
      console.warn("Grip Prix: ignoring a bad message", error);
    }
  }

  private onHello(link: Link, hello: Extract<ToHost, { t: "hello" }>): void {
    const refuse = (reason: "full" | "version" | "started") => {
      this.links.delete(link);
      this.send(link, { t: "reject", reason });
      link.close();
    };
    if (hello.v !== PROTOCOL_VERSION) return refuse("version");
    if (this.phase === "racing") return refuse("started");
    const want = clamp(Math.round(Number(hello.n) || 1), 1, 2);
    let device = typeof hello.device === "string" ? hello.device.slice(0, 32) : "";
    if (!device || device === this.device || this.guests.has(device)) device = `d-${token(this.env.random)}`;
    if (!this.roster.reserve(device, want)) return refuse("full");

    this.links.set(link, { device, since: this.env.now() });
    this.guests.set(device, { device, link, heard: this.env.now() });
    this.lobbyCache = null;
    this.send(link, { t: "welcome", v: PROTOCOL_VERSION, device, lobby: this.lobby() });
    this.changed(device);
  }

  private onGuestMessage(guest: Guest, message: ToHost): void {
    switch (message.t) {
      case "configure":
        if (this.phase === "racing" || !Array.isArray(message.players)) return;
        this.roster.set(
          guest.device,
          message.players.slice(0, 2).map((p, i) => cleanPlayer(p, `Player ${i + 1}`)),
        );
        this.changed();
        return;
      case "ready":
        this.roster.setReady(guest.device, message.ready === true);
        this.changed();
        return;
      case "in":
        this.onInputs(guest.device, message.k);
        return;
      case "ping":
        this.send(guest.link, { t: "pong", at: message.at });
        return;
      case "leave":
        this.dropGuest(guest.device);
        return;
      default:
        return;
    }
  }

  private onLinkClosed(link: Link): void {
    if (this.closedWith) return;
    const entry = this.links.get(link);
    this.links.delete(link);
    if (entry?.device) this.dropGuest(entry.device);
  }

  /** A guest is gone (said so, hung up, or went silent): free its seats; in a race its karts carry on by themselves. */
  private dropGuest(device: string): void {
    if (this.closedWith) return;
    const guest = this.guests.get(device);
    if (!guest) return;
    this.guests.delete(device);
    this.links.delete(guest.link);
    guest.link.close();
    const slots = this.roster.remove(device);
    if (this.phase === "racing" && this.race) {
      for (const [kartText, slot] of Object.entries(this.kartSlots)) {
        if (!slots.includes(slot)) continue;
        const kart = Number(kartText);
        const presses = this.remote.get(kart)?.last.itemPresses ?? 0;
        this.remote.delete(kart);
        delete this.kartSlots[kart];
        this.autopilots.set(kart, new Autopilot((this.geometry ??= TrackGeometry.build(this.race.setup.track)), presses));
      }
    }
    this.changed();
  }

  // ─── Session: the lobby ───────────────────────────────────────────────────

  lobby(): LobbyState {
    this.lobbyCache ??= {
      code: this.code,
      host: this.device,
      players: this.roster.players(),
      settings: { ...this.settings },
      phase: this.phase,
      result: this.result,
      karts: { ...this.kartSlots },
    };
    return this.lobbyCache;
  }

  /** The lobby changed: tell this device's listeners and every guest (but `except`). */
  private changed(except?: string): void {
    this.lobbyCache = null;
    const lobby = this.lobby();
    this.lobbyListeners.emit(lobby);
    this.broadcast({ t: "lobby", lobby }, except);
  }

  onLobby(listener: (lobby: LobbyState) => void): () => void {
    return this.lobbyListeners.add(listener);
  }

  onClosed(listener: (reason: SessionClosed) => void): () => void {
    // A session that closed before anyone listened (a room that could not be opened) still says so.
    if (this.closedWith) {
      const reason = this.closedWith;
      queueMicrotask(() => listener(reason));
    }
    return this.closeListeners.add(listener);
  }

  setLocalPlayers(players: LocalPlayerSetup[]): void {
    if (this.phase === "racing") return;
    this.local = players.slice(0, 2);
    this.roster.set(
      this.device,
      this.local.map((p): WirePlayer => ({ name: p.name, control: p.control.kind, screen: p.screen })),
    );
    this.changed();
  }

  setReady(ready: boolean): void {
    this.roster.setReady(this.device, ready);
    this.changed();
  }

  configure(settings: Partial<LobbySettings>): void {
    if (this.phase === "racing") return;
    this.settings = mergeSettings(this.settings, settings, MAX_RACERS);
    this.changed();
  }

  start(): void {
    if (this.closedWith || this.phase === "racing") return;
    const players = this.roster.players();
    if (players.length === 0) return;

    const seed = Math.floor(this.env.random() * 2 ** 32) >>> 0;
    const { setup, karts } = buildSetup(players, this.settings, seed);
    this.race = this.env.createRace(setup);
    this.geometry = null;
    this.kartSlots = karts;
    this.phase = "racing";
    this.result = null;
    this.endedAt = null;
    this.remote.clear();
    this.controls.clear();
    this.autopilots.clear();
    this.feed.clear();
    this.outEvents = [];
    this.sinceSnapshot = 0;
    this.clock.reset();

    const mine = this.roster.slotsOf(this.device);
    for (const [kartText, slot] of Object.entries(karts)) {
      const kart = Number(kartText);
      const device = this.roster.deviceOfSlot(slot)!;
      if (device === this.device) {
        const control = this.local[mine.indexOf(slot)]?.control;
        if (control) this.controls.set(kart, control);
      } else {
        this.remote.set(kart, { kart, device, queue: [], highest: 0, applied: 0, last: IDLE_INPUT, empty: 0 });
      }
    }

    this.lobbyCache = null;
    const lobby = this.lobby();
    this.broadcast({
      t: "start",
      start: { track: this.settings.track, laps: setup.laps, seed, racers: setup.racers, lobby },
    });
    this.lobbyListeners.emit(lobby);
  }

  backToLobby(): void {
    if (this.closedWith || this.phase === "lobby") return;
    this.endRace();
    this.phase = "lobby";
    this.result = null;
    this.kartSlots = {};
    this.changed();
  }

  private endRace(): void {
    this.race = null;
    this.remote.clear();
    this.controls.clear();
    this.autopilots.clear();
    this.endedAt = null;
  }

  // ─── Session: the race ────────────────────────────────────────────────────

  frame(now: number): RaceView | null {
    if (this.closedWith) return null;
    this.lastFrameAt = this.env.now();
    this.advance(now, MAX_TICKS_PER_FRAME);
    const race = this.race;
    if (this.phase !== "racing" || !race) return null;
    return { ...race.view(), events: this.feed.drain() };
  }

  views(): number[] {
    return kartsOnScreen(this.lobby(), this.device);
  }

  /** The timer's turn: when the tab is hidden (or frames have stopped for any reason) run what frames would have. */
  private fallback(): void {
    const now = this.env.now();
    if (pageHidden() || now - this.lastFrameAt > NO_FRAME_MS) this.advance(now, MAX_TICKS_HIDDEN);
  }

  private advance(now: number, maxTicks: number): void {
    if (this.closedWith) return;
    this.housekeeping();
    const race = this.race;
    if (this.phase !== "racing" || !race) return;

    const ticks = this.clock.ticks(now, maxTicks);
    for (let i = 0; i < ticks; i++) this.tickOnce(race, now);
    if (ticks > 0) {
      this.sinceSnapshot += ticks;
      if (this.sinceSnapshot >= SNAPSHOT_EVERY) {
        this.sinceSnapshot = 0;
        this.sendSnapshot(race);
      }
      this.flushEvents();
      // The race is decided: a moment more to see the finish, then the results.
      if (this.endedAt !== null && race.tick - this.endedAt >= this.env.resultsDelay * TICK_HZ) this.conclude(race);
    }
  }

  /** One tick of the race: every player kart gets one input and the sim steps. */
  private tickOnce(race: Race, now: number): void {
    const inputs = new Map<number, DriveInput>();
    for (const [kart, control] of this.controls) inputs.set(kart, control.sample(now));
    for (const remote of this.remote.values()) inputs.set(remote.kart, this.takeRemote(remote));
    if (this.autopilots.size > 0) {
      const karts = race.view().karts;
      for (const [kart, pilot] of this.autopilots) {
        const view = karts.find((k) => k.id === kart);
        if (view) inputs.set(kart, pilot.drive(view));
      }
    }
    race.step(inputs);
    for (const event of race.takeEvents()) {
      this.feed.push([event]);
      this.outEvents.push(event);
    }
    // Asking for the result is not free in every sim: ten times a second is plenty.
    if (this.endedAt === null && race.tick % 6 === 0 && race.result()) this.endedAt = race.tick;
  }

  /** This tick's input for a guest's kart. */
  private takeRemote(remote: Remote): DriveInput {
    // Too many waiting: we are behind, and driving through old inputs would only make it worse.
    if (remote.queue.length > QUEUE_MAX) remote.queue.splice(0, remote.queue.length - QUEUE_KEEP);
    const next = remote.queue.shift();
    if (next) {
      remote.applied = next.seq;
      remote.last = next.input;
      remote.empty = 0;
      this.env.onApply?.(remote.kart, next.seq, next.input);
      return next.input;
    }
    remote.empty++;
    // Hold the last input through a hiccup; after half a second of nothing, let go of the wheel.
    if (remote.empty > HOLD_TICKS) {
      return { steer: 0, throttle: 0, brake: 0, drift: false, itemPresses: remote.last.itemPresses };
    }
    return remote.last;
  }

  /** A guest's input packet: queue each input we have not seen, in order. */
  private onInputs(device: string, packets: unknown): void {
    if (!Array.isArray(packets) || this.phase !== "racing") return;
    for (const packet of packets as unknown[]) {
      if (!Array.isArray(packet)) continue;
      const [kart, inputs] = packet as [unknown, unknown];
      const remote = typeof kart === "number" ? this.remote.get(kart) : undefined;
      if (!remote || remote.device !== device || !Array.isArray(inputs)) continue;
      for (const wire of (inputs as unknown[]).slice(-INPUTS_PER_PACKET * 2)) {
        if (!Array.isArray(wire)) continue;
        const seq = Number(wire[0]);
        // Each input is queued once: a repeat (the packets overlap on purpose) or a late one is skipped.
        if (!Number.isInteger(seq) || seq <= remote.highest) continue;
        remote.highest = seq;
        remote.queue.push({ seq, input: decodeInput(wire as number[]) });
      }
    }
  }

  private sendSnapshot(race: Race): void {
    if (this.guests.size === 0) return;
    const state = JSON.stringify(race.snapshot());
    for (const guest of this.guests.values()) {
      const acks: Record<number, number> = {};
      for (const remote of this.remote.values()) if (remote.device === guest.device) acks[remote.kart] = remote.applied;
      guest.link.send("unreliable", encodeSnapshot(state, acks));
    }
  }

  private flushEvents(): void {
    if (this.outEvents.length === 0) return;
    if (this.guests.size > 0) this.broadcast({ t: "events", events: this.outEvents });
    this.outEvents = [];
  }

  /** The race is over for good: the last picture, the standings, and the room goes to the results. */
  private conclude(race: Race): void {
    this.sendSnapshot(race);
    this.flushEvents();
    this.result = race.result() ?? { standings: [] };
    this.phase = "results";
    this.race = null;
    this.endedAt = null;
    this.lobbyCache = null;
    const lobby = this.lobby();
    this.broadcast({ t: "results", result: this.result, lobby });
    this.lobbyListeners.emit(lobby);
  }

  // ─── Upkeep ───────────────────────────────────────────────────────────────

  private housekeeping(): void {
    const now = this.env.now();
    if (now - this.lastHousekeeping < HOUSEKEEPING_MS) return;
    this.lastHousekeeping = now;
    for (const [link, entry] of this.links) {
      if (entry.device === null && now - entry.since > HELLO_MS) {
        this.links.delete(link);
        link.close();
      }
    }
    for (const guest of [...this.guests.values()]) if (now - guest.heard > SILENCE_MS) this.dropGuest(guest.device);
  }

  // ─── Leaving ──────────────────────────────────────────────────────────────

  leave(): void {
    if (this.closedWith) return;
    this.broadcast({ t: "leave" });
    this.close("left");
  }

  private close(reason: SessionClosed): void {
    if (this.closedWith) return;
    this.closedWith = reason;
    this.stopTimer?.();
    this.stopTimer = null;
    globalThis.removeEventListener?.("pagehide", this.onHide);
    for (const link of this.links.keys()) link.close();
    this.links.clear();
    this.guests.clear();
    this.transport?.close();
    this.endRace();
    this.closeListeners.emit(reason);
  }
}

/** Hosts a room: a device that runs the race, with a code others can join. */
export function hostSession(options: NetOptions): Session {
  const transport = (options.transport ?? defaultTransport)();
  return new HostSession("host", options, transport);
}
