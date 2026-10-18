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
 *      from the autopilot if the sim could not take the kart over — and steps
 *      the race,
 *   3. every second tick sends every guest a snapshot (30 Hz, unreliable) with
 *      the last input of theirs it applied, and after every frame that ran a
 *      tick, the events since the last batch (reliable),
 *   4. returns the view to draw.
 * When the tab is hidden no frames come, so a timer runs the same advance.
 */
import {
  IDLE_INPUT,
  MAX_PLAYERS,
  MAX_RACERS,
  TICK_HZ,
  type DriveInput,
  type DriverControl,
  type LobbySettings,
  type LobbyState,
  type LocalPlayerSetup,
  type PauseState,
  type Race,
  type RaceEvent,
  type RaceResult,
  type RaceView,
  type Session,
  type SessionClosed,
} from "../contract";
import { GP_RESULTS_MS, GP_STANDINGS_MS, GrandPrixRun, cupById } from "../grandprix";
import { TrackGeometry } from "../track/geometry";
import { raceTrack } from "../track/mirror";
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
import { DEFAULT_SETTINGS, Roster, cleanPlayer, kartsOnScreen, mergeSettings, sharesHostScreen } from "./roster";
import { buildSetup } from "./setup";
import { TransportError, type Link, type Transport } from "./transport";
import { Emitter, clamp, token } from "./util";
import { blendViews, cloneView } from "./view";

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
/** After "Resume": this long, ms, of 3-2-1 before the race moves again. */
const RESUME_MS = 3000;

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
  /** A Grand Prix under way (through its podium), and when (ms) its results or standings came up. */
  private gp: GrandPrixRun | null = null;
  private gpSince = 0;
  private kartSlots: Record<number, number> = {};
  private code: string | null = null;
  private lobbyCache: LobbyState | null = null;
  private local: LocalPlayerSetup[] = [];

  private guests = new Map<string, Guest>();
  /** Every open link: its device once it has said hello, null before. */
  private links = new Map<Link, { device: string | null; since: number }>();

  private race: Race | null = null;
  /** The race's seed, which names it on the wire. */
  private raceId = 0;
  private clock = new TickClock();
  private remote = new Map<number, Remote>();
  private controls = new Map<number, DriverControl>();
  /** Only for a race whose sim cannot hand a kart over to its own bot (`Race.handOver`). */
  private autopilots = new Map<number, Autopilot>();
  private geometry: TrackGeometry | null = null;
  /** The last two ticks' pictures: a frame is drawn between them, by how far into the next tick it is. */
  private prevView: RaceView | null = null;
  private currView: RaceView | null = null;
  /** The race stopped for the whole room, and when its 3-2-1 ends (ms) once it has been resumed. */
  private paused: PauseState | null = null;
  private resumeAt: number | null = null;
  /** How far between the two pictures the frame stood when the race was stopped: it stays there. */
  private frozenAt = 1;
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

  /** One message to one guest, on the reliable channel (snapshots, the only unreliable ones, go out in `sendSnapshot`). */
  private send(link: Link, message: ToGuest): void {
    link.send("reliable", encode(message));
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
    // A race under way, or a Grand Prix between its races: the cup's points belong to the players who began it.
    if (this.phase === "racing" || this.gp) return refuse("started");
    const want = clamp(Math.round(Number(hello.n) || 1), 1, MAX_PLAYERS);
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
          message.players.slice(0, MAX_PLAYERS).map((p, i) => cleanPlayer(p, `Player ${i + 1}`)),
        );
        this.changed();
        return;
      case "ready":
        this.roster.setReady(guest.device, message.ready === true);
        this.changed();
        return;
      case "lost":
        if (this.phase === "racing" && Array.isArray(message.lost) && this.roster.setLost(guest.device, message.lost.map((flag) => flag === true))) {
          this.changed();
        }
        return;
      case "in":
        if (message.r === this.raceId) this.onInputs(guest.device, message.k);
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
    // Their points stay in the cup, and their kart is a bot from the next race on.
    this.gp?.leave(slots);
    if (this.phase === "racing" && this.race) {
      for (const [kartText, slot] of Object.entries(this.kartSlots)) {
        if (!slots.includes(slot)) continue;
        const kart = Number(kartText);
        const presses = this.remote.get(kart)?.last.itemPresses ?? 0;
        this.remote.delete(kart);
        delete this.kartSlots[kart];
        // The sim drives it from here as it does a bot; a stand-in race without that gets the net's own simple pilot.
        if (this.race.handOver) this.race.handOver(kart);
        else this.autopilots.set(kart, new Autopilot((this.geometry ??= TrackGeometry.build(this.race.setup.track)), presses));
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
      grandPrix: this.gp ? this.gp.state() : null,
      result: this.result,
      karts: { ...this.kartSlots },
      race: this.raceId,
      pause: this.paused,
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
    this.local = players.slice(0, MAX_PLAYERS);
    this.roster.set(
      this.device,
      this.local.map((p): WirePlayer => ({ name: p.name, control: p.control.kind, screen: p.screen, character: p.character, golden: p.golden })),
    );
    this.changed();
  }

  setReady(ready: boolean): void {
    this.roster.setReady(this.device, ready);
    this.changed();
  }

  configure(settings: Partial<LobbySettings>): void {
    // A cup is run on the settings it began with.
    if (this.phase === "racing" || this.gp) return;
    this.settings = mergeSettings(this.settings, settings, MAX_RACERS);
    this.roster.setDisplay(this.settings.display);
    this.changed();
  }

  start(): void {
    // A Grand Prix goes on by itself (or by `next`), not by a start.
    if (this.closedWith || this.phase === "racing" || this.gp) return;
    const players = this.roster.players();
    // Everyone's wheel has to be level and seen: nobody is left on the grid waiting for their hands.
    if (players.length === 0 || !players.every((player) => player.ready)) return;
    this.launch(players);
  }

  restart(): void {
    if (this.closedWith) return;
    const players = this.roster.players();
    if (players.length === 0) return;
    if (this.gp) {
      // On the podium: the same cup again from its first race. In a race: that race again. Between races: nothing to redo.
      if (this.phase === "podium") this.gp = null;
      else if (this.phase !== "racing") return;
      this.launch(players);
      return;
    }
    if (this.phase !== "racing" && this.phase !== "results") return;
    this.launch(players);
  }

  /** The host's: moves a Grand Prix on from its results to the standings, and from them to the next race or the podium. */
  next(): void {
    const gp = this.gp;
    if (this.closedWith || !gp) return;
    if (this.phase === "results") {
      this.phase = "standings";
      this.gpSince = this.env.now();
      this.changed();
    } else if (this.phase === "standings") {
      if (gp.last) {
        this.phase = "podium";
        this.gpSince = this.env.now();
        this.changed();
      } else {
        const players = this.roster.players();
        if (players.length === 0) return;
        gp.advance();
        this.launch(players);
      }
    }
  }

  /** The Grand Prix's own clock: results and standings give way by themselves after a few seconds. */
  private gpTick(): void {
    if (!this.gp) return;
    const waited = this.env.now() - this.gpSince;
    if ((this.phase === "results" && waited >= GP_RESULTS_MS) || (this.phase === "standings" && waited >= GP_STANDINGS_MS)) this.next();
  }

  /** The grid for the race about to start, and the Grand Prix it belongs to (begun here on a cup's first race). */
  private grid(players: LobbyState["players"], seed: number): ReturnType<typeof buildSetup> {
    if (this.settings.mode !== "grand-prix" && !this.gp) return buildSetup(players, this.settings, seed);
    if (!this.gp || this.gp.race === 0) {
      // A cup's first race (or its restart): the room's grid, which the cup then keeps.
      const cup = this.gp?.cup ?? cupById(this.settings.cup).id;
      const track = raceTrack(cupById(cup).tracks[0]!, this.settings.mirror);
      const built = buildSetup(players, this.settings, seed, track);
      this.gp = GrandPrixRun.begin(cup, built.setup.racers);
      return built;
    }
    // The cup's later races: the players as they are now, every bot as it was, the leader on pole.
    const track = raceTrack(this.gp.track, this.settings.mirror);
    const here = buildSetup(players, { ...this.settings, bots: false }, seed, track);
    const racers = this.gp.grid(here.setup.racers);
    const karts: Record<number, number> = {};
    for (const racer of racers) if (racer.player !== null) karts[racer.id] = racer.player;
    return { setup: { ...here.setup, racers }, karts };
  }

  /** Builds the grid and the race and tells everyone to begin: a first start, a race again, a restart. */
  private launch(players: LobbyState["players"]): void {
    const seed = Math.floor(this.env.random() * 2 ** 32) >>> 0;
    const { setup, karts } = this.grid(players, seed);
    this.race = this.env.createRace(setup);
    this.raceId = seed;
    this.geometry = null;
    this.kartSlots = karts;
    this.phase = "racing";
    this.result = null;
    this.endedAt = null;
    this.paused = null;
    this.resumeAt = null;
    this.roster.clearLost();
    this.prevView = this.currView = cloneView(this.race.view());
    this.frozenAt = 1;
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
      start: {
        track: this.gp ? this.gp.track : this.settings.track,
        mirror: this.settings.mirror === true,
        laps: setup.laps,
        seed,
        racers: setup.racers,
        lobby,
      },
    });
    this.lobbyListeners.emit(lobby);
  }

  backToLobby(): void {
    if (this.closedWith || this.phase === "lobby") return;
    this.endRace();
    this.phase = "lobby";
    this.gp = null;
    this.result = null;
    this.kartSlots = {};
    this.paused = null;
    this.resumeAt = null;
    this.roster.clearLost();
    this.changed();
  }

  /**
   * Stops the race like a console's pause. Practice always stops (nobody else
   * is racing); a room stops only if it is watched on this screen by players
   * who have no screen of their own to carry on with. Otherwise the others
   * race on, and a pause is only this screen's.
   */
  pause(): boolean {
    if (this.closedWith || this.phase !== "racing" || !this.race) return false;
    if (this.role === "host" && !sharesHostScreen(this.lobby())) return false;
    if (!this.paused) {
      this.frozenAt = this.clock.fraction;
      this.paused = { by: this.device, resume: null };
      this.resumeAt = null;
      this.changed();
    }
    return true;
  }

  /** Picks the race up again after a pause: three seconds of 3-2-1 first, in which nothing moves. */
  resume(): void {
    if (!this.paused || this.paused.resume !== null) return;
    this.resumeAt = this.env.now() + RESUME_MS;
    this.paused = { ...this.paused, resume: 3 };
    this.changed();
  }

  setHandsLost(lost: readonly boolean[]): void {
    if (this.closedWith || this.phase !== "racing") return;
    if (this.roster.setLost(this.device, lost)) this.changed();
  }

  /** The pause's own clock: the 3-2-1 after a resume, and the end of the pause. */
  private pauseTick(now: number): void {
    const paused = this.paused;
    if (!paused || this.resumeAt === null) return;
    const left = this.resumeAt - now;
    if (left <= 0) {
      this.paused = null;
      this.resumeAt = null;
      // The time spent stopped is not owed to the race.
      this.clock.reset();
      this.changed();
      return;
    }
    const count = Math.ceil(left / 1000);
    if (count !== paused.resume) {
      this.paused = { ...paused, resume: count };
      this.changed();
    }
  }

  private endRace(): void {
    this.race = null;
    this.prevView = this.currView = null;
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
    // Drawn at this frame's own time: some of the way from the tick before the last to the last. A screen that
    // refreshes at 120 Hz then moves every frame, not every other one; the price is under one tick of lateness.
    const prev = this.prevView ?? this.currView;
    const curr = this.currView ?? (this.currView = cloneView(race.view()));
    const view = prev ? blendViews(prev, curr, this.paused ? this.frozenAt : this.clock.fraction) : curr;
    return { ...view, events: this.feed.drain() };
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
    this.gpTick();
    const race = this.race;
    if (this.phase !== "racing" || !race) return;
    // Stopped for the room: nothing moves (the pause's own clock still counts a 3-2-1 down).
    if (this.paused) return this.pauseTick(this.env.now());

    const ticks = this.clock.ticks(now, maxTicks);
    for (let i = 0; i < ticks; i++) {
      // The picture before the last tick, kept to draw between it and the one after.
      if (i === ticks - 1) this.prevView = ticks === 1 && this.currView ? this.currView : cloneView(race.view());
      this.tickOnce(race, now);
    }
    if (ticks > 0) {
      this.currView = cloneView(race.view());
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
      guest.link.send("unreliable", encodeSnapshot(state, this.raceId, acks));
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
    // The standings carry names and colours, so a screen that never saw the grid can still read them.
    const result = race.result() ?? { standings: [] };
    this.result = {
      standings: result.standings.map((row) => {
        const racer = race.setup.racers.find((candidate) => candidate.id === row.kart);
        return racer ? { ...row, name: racer.name, colour: racer.colour } : row;
      }),
    };
    this.phase = "results";
    this.gp?.record(this.result, race.setup.racers);
    this.gpSince = this.env.now();
    this.paused = null;
    this.roster.clearLost();
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
