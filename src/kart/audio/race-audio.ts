/**
 * Grip Prix's sound, for one screen of up to four local players.
 *
 * Wire it once per race screen:
 *
 *     const audio = createRaceAudio(ctx.audio, { volumes: { music: 0.8, effects: 1 } });
 *     await audio.load(track.theme, setProgress);      // the kart sounds, and the track's music
 *     // every animation frame, with the view the renderer draws:
 *     audio.frame(view, localKarts(session.views()), dt);
 *
 * and ``music("menu")``, ``music("results-win")`` and so on on the other
 * screens. It turns every RaceEvent into its sound, runs the loops that
 * belong to a kart's state (each engine in two layers pitched by its revs,
 * the rasp of its load, the idle and the boost's growl; the drift's squeal
 * and its sparks' fizz, the ground under the wheels, the wind, a seeker's
 * whistle, the rescue drone), bends other karts' engines as they go by,
 * plays the track's place very quietly underneath, counts the race in,
 * starts the music at "Go", ducks it under the big moments and switches it
 * to its faster final-lap version when the first local kart begins its last
 * lap.
 *
 * It needs the Web Audio engine (src/audio) for steerable loops and music;
 * with any other AudioBus (a silent one, a test double) the effects still play
 * as plain cues and loops, and the music is skipped.
 */
import type { AudioBus } from "../../engine/types";
import { loadSoundPack } from "../../audio";
import type { Pack } from "../../audio";
import { volumeGain } from "../../audio/routing";
import type { LoopControl, LoopParams, SteerableAudio } from "../../audio/types";
import type { KartView, RaceEvent, RaceView } from "../contract";
import { AMBIENCE, BED_PANS, SpotClock, rng } from "./ambience";
import {
  ENGINE_LAYERS,
  ENGINE_RADIUS,
  type EngineFamily,
  GRIT_RATE,
  IDLE_RATE,
  PLAYER_PITCH,
  REV_HI,
  REV_LO,
  SURFACE_CUES,
  crowdTrim,
  doppler,
  driftTarget,
  ease,
  engineFamily,
  engineTarget,
  engineWork,
  gritShare,
  layerMix,
  rivalLevel,
  surfaceTarget,
  windTarget,
} from "./engines";
import { type Order, ordersFor } from "./events";
import { type KartSound, type MusicKind, type TrackTheme, SOUND_CUES, pieceFor } from "./kinds";
import { type MusicRenderer, createMusicRenderer } from "./music/loader";
import { type MusicTrack, MusicPlayer, beatTimes } from "./music/player";
import { type PieceId, THEME_PIECES } from "./music/pieces";
import { MUSIC_SAMPLE_RATE, type RenderedMusic } from "./music/render";
import { type LocalKart, type Scene, falloff, hearThing, listenerAt, localOf } from "./scene";

export type { KartSound, MusicKind, TrackTheme } from "./kinds";
export type { LocalKart } from "./scene";

export interface RaceAudioOptions {
  /** Where music is synthesised: "auto" uses a Worker when the page can. */
  render?: "auto" | "worker" | "main";
  /** The two sliders, 0..1 each (a slider's position is squared: half way is a quarter of the level, about 12 dB down). Default 1 and 1. */
  volumes?: { music?: number; effects?: number };
  /** Stand-ins for tests. */
  renderer?: MusicRenderer;
  player?: MusicPlayerLike;
  makeTrack?: (rendered: RenderedMusic) => MusicTrack;
}

/** What RaceAudio needs of a music player. */
export type MusicPlayerLike = Pick<MusicPlayer, "play" | "switchTo" | "stop" | "duck" | "setVolume" | "setPaused" | "dispose" | "current">;

export interface RaceAudio {
  /**
   * Prepare for a race on a track of this theme: synthesise the kart sounds
   * (the "kart" pack), render the theme's music and start rendering its
   * final-lap version in the background. Resolves when the race could start;
   * ``onProgress`` reports 0..1.
   */
  load(theme: TrackTheme, onProgress?: (fraction: number) => void): Promise<void>;
  /**
   * Once per animation frame while a race is on screen. ``view`` is what the
   * renderer draws (its events are heard once each), ``local`` the karts this
   * screen shows with where each sits in the stereo field (-1 left .. 1
   * right), ``dt`` real seconds since the last frame.
   */
  frame(view: RaceView, local: readonly LocalKart[], dt: number): void;
  /** Play this music (null for none), crossfading from what plays. "race" is the theme given to ``load``. */
  music(kind: MusicKind | null): void;
  /** Start rendering these pieces now so they are ready when asked for (the menu while a race plays...). */
  preload(...kinds: MusicKind[]): void;
  /** A sound a screen asks for by name (the interface, the duck, the horn...). */
  play(sound: KartSound, options?: { pan?: number; volume?: number }): void;
  /** The pause menu: engines fall silent, the music is muffled and quieter. */
  pause(): void;
  resume(): void;
  /** The sliders, 0..1; either may be left out. */
  setVolumes(volumes: { music?: number; effects?: number }): void;
  /** What is going on, for the dev page and tests. */
  stats(): RaceAudioStats;
  dispose(): void;
}

export interface RaceAudioStats {
  engines: number;
  drifts: number;
  surfaces: number;
  seekers: number;
  drones: number;
  /** The wind round the player's own karts. */
  winds: number;
  /** Engine loops running (two layers crossing over, the rasp, the idle, the growl), over every kart heard. */
  engineLoops: number;
  /** The place's beds running. */
  ambience: number;
  /** Sounds started in the last frame. */
  fired: number;
  /** The music playing, by piece id ("meadow", "meadow-final"), or null. */
  music: string | null;
  paused: boolean;
}

/** At most this many karts' engines at once (the four players' and the nearest others'), and at most this many others. */
const MAX_ENGINES = 6;
const MAX_RIVALS = 4;
/** Most one-shots started in one frame, and of any one cue. */
const MAX_ORDERS = 8;
const MAX_PER_CUE = 2;
/** Another kart's loops (drift squeal, drone) are heard within this many metres. */
const LOOP_RADIUS = 45;
const MAX_SEEKERS = 3;
/** Other karts' drift squeals heard at once, besides the local karts' own. */
const MAX_OTHER_DRIFTS = 3;
/** Seconds between two notes for a kart's place changing (karts side by side swap places back and forth). */
const PLACE_GAP = 0.6;

/** Below this a loop is not worth running. */
const AUDIBLE = 0.003;

/**
 * One steerable loop that starts when it is first heard and is let go once it
 * has been silent for ``hold`` seconds, telling the audio engine only what has
 * moved since it last told it.
 */
class Layer {
  loop: LoopControl | null = null;
  private quietFor = 0;
  private readonly sent = { rate: -1, volume: -1, pan: 9, distance: -1 };

  constructor(
    private readonly open: (cue: string, params: Required<LoopParams>) => LoopControl,
    readonly cue: string,
    private readonly hold = 0.5,
  ) {}

  get running(): boolean {
    return this.loop !== null;
  }

  drive(volume: number, rate: number, pan: number, distance: number, dt: number): void {
    if (volume > AUDIBLE) {
      this.quietFor = 0;
      if (!this.loop) {
        this.loop = this.open(this.cue, { rate, volume, pan, distance });
        this.remember(rate, volume, pan, distance);
        return;
      }
    } else {
      if (!this.loop) return;
      this.quietFor += dt;
      if (this.quietFor > this.hold) {
        this.stop();
        return;
      }
    }
    const s = this.sent;
    const moved =
      Math.abs(rate - s.rate) > 0.0015 * s.rate ||
      Math.abs(volume - s.volume) > 0.002 + 0.03 * s.volume ||
      (volume <= AUDIBLE && s.volume > AUDIBLE) ||
      Math.abs(pan - s.pan) > 0.01 ||
      Math.abs(distance - s.distance) > 0.25;
    if (!moved) return;
    this.loop!.set({ rate, volume, pan, distance });
    this.remember(rate, volume, pan, distance);
  }

  stop(): void {
    this.loop?.stop();
    this.loop = null;
    this.quietFor = 0;
    this.sent.rate = -1;
  }

  private remember(rate: number, volume: number, pan: number, distance: number): void {
    this.sent.rate = rate;
    this.sent.volume = volume;
    this.sent.pan = pan;
    this.sent.distance = distance;
  }
}

interface EngineVoice {
  family: EngineFamily;
  /** The kart's own pitch offset (two players with one engine are still two karts). */
  pitch: number;
  lo: Layer;
  hi: Layer;
  grit: Layer;
  idle: Layer;
  growl: Layer;
  /** Where the kart was a frame ago, for its acceleration and the road's slope. */
  last: { speed: number; x: number; y: number; z: number };
  slope: number;
  /** How hard the engine works, -1..1, eased. */
  work: number;
  /** The eased targets. */
  revs: number;
  engine: number;
  rasp: number;
  idling: number;
  growling: number;
  doppler: number;
  /** A phase for its little unsteadiness, so no two engines wander together. */
  phase: number;
  /** Lifting off after pulling: the exhaust may pop (the player's own karts). */
  armed: boolean;
  poppedAt: number;
  /** Another kart: which side of its listener it was on, ahead (1) or behind (-1), and when it last swished by. */
  side: number;
  passedAt: number;
}

interface Looper {
  loop: LoopControl;
  cue: string;
  rate: number;
  volume: number;
}

/** Fallback for a bus that cannot steer loops: restart a plain loop when it has moved far enough. */
function plainLoop(bus: AudioBus, cue: string, initial: LoopParams): LoopControl {
  let params = { rate: 1, volume: 1, pan: 0, distance: 0, ...initial };
  let stop: (() => void) | null = null;
  /** The parameters the running loop was started with. */
  let started = params;
  let stopped = false;
  const start = (): void => {
    if (stopped || params.volume <= 0.02) return;
    started = params;
    stop = bus.loop(cue, params);
  };
  start();
  return {
    set(next) {
      params = { ...params, ...next };
      if (params.volume <= 0.02) {
        stop?.();
        stop = null;
        return;
      }
      if (!stop) {
        start();
        return;
      }
      const moved =
        Math.abs(params.rate - started.rate) / started.rate > 0.12 ||
        Math.abs(params.volume - started.volume) > 0.3 ||
        Math.abs(params.pan - started.pan) > 0.4;
      if (moved) {
        stop();
        start();
      }
    },
    stop() {
      stopped = true;
      stop?.();
      stop = null;
    },
  };
}

/** Has a level moved enough to be worth telling the loop? Always when it reaches silence. */
const changed = (now: number, sent: number): boolean => Math.abs(now - sent) > 0.004 || (now < 0.002 && sent >= 0.002);

const isSteerable = (bus: AudioBus): bus is AudioBus & SteerableAudio => {
  const b = bus as Partial<SteerableAudio>;
  return typeof b.controlledLoop === "function" && typeof b.musicBus === "function" && !!b.ctx;
};

class RaceAudioImpl implements RaceAudio {
  private readonly steer: SteerableAudio | null;
  private readonly player: MusicPlayerLike | null;
  private readonly renderer: MusicRenderer | null;
  private readonly makeTrack: ((r: RenderedMusic) => MusicTrack) | null;
  private volumes = { music: 1, effects: 1 };
  private clock = 0;
  private paused = false;
  private disposed = false;

  // Per-race state.
  private lastPhase: RaceView["phase"] | null = null;
  private trackId: string | null = null;
  private raceMusicStarted = false;
  private finalSwitched = false;
  private readonly seen: number[] = [];
  private readonly seenSet = new Set<number>();

  // Loops by state.
  private readonly engines = new Map<number, EngineVoice>();
  private readonly drifts = new Map<number, Looper>();
  /** The sparks' fizz under the player's own drifts. */
  private readonly sparks = new Map<number, Layer>();
  private readonly surfaces = new Map<number, Looper>();
  private readonly seekers = new Map<number, Looper & { lastDistance: number }>();
  private readonly drones = new Map<number, Looper>();
  private readonly winds = new Map<number, Looper>();
  /** The place each of the player's own karts was last heard at. */
  private readonly places = new Map<number, { place: number; at: number }>();
  private readonly rolls = new Map<number, { next: number; count: number }>();
  private readonly puckHeading = new Map<number, { heading: number; t: number }[]>();
  private readonly lastBounce = new Map<number, number>();
  private fired = 0;

  // The place: its beds (two of each, apart in the stereo field) and the far-off happenings.
  private ambienceTheme: TrackTheme | null = null;
  private beds: { layer: Layer; rate: number; volume: number; pan: number }[] = [];
  private spots: SpotClock | null = null;

  /** The music's duck now: how deep, and until when on this clock (a lighter one does not cut a deeper one short). */
  private duckDepth = 1;
  private duckUntil = -1;

  // Music.
  private loadedTheme: TrackTheme | null = null;
  private readonly tracks = new Map<string, MusicTrack>();
  private readonly inflight = new Map<string, Promise<MusicTrack | null>>();
  /** The track last asked for ("meadow", "meadow-final"), while it renders and then plays. */
  private wantedKey: string | null = null;
  private playingKey: string | null = null;
  private pendingFinal = false;

  constructor(
    private readonly bus: AudioBus,
    options: RaceAudioOptions,
  ) {
    this.steer = isSteerable(bus) ? bus : null;
    // Music is made at the device's own rate (44.1 or 48 kHz) so playing it needs no resampling; a stand-in context gets the default.
    const deviceRate = (this.steer?.ctx as Partial<BaseAudioContext> | undefined)?.sampleRate;
    const musicRate = deviceRate ? Math.min(48000, Math.max(MUSIC_SAMPLE_RATE, deviceRate)) : MUSIC_SAMPLE_RATE;
    this.renderer = options.renderer ?? (this.steer || options.player ? createMusicRenderer(options.render ?? "auto", musicRate) : null);
    if (options.player) {
      this.player = options.player;
    } else if (this.steer) {
      try {
        this.player = new MusicPlayer(this.steer.ctx, this.steer.musicBus());
      } catch (error) {
        console.warn("Grip Prix audio: no music player", error);
        this.player = null;
      }
    } else {
      this.player = null;
    }
    const steer = this.steer;
    this.makeTrack =
      options.makeTrack ??
      (steer
        ? (r) => {
            const buffer = steer.ctx.createBuffer(2, r.loopSamples, r.sampleRate);
            buffer.copyToChannel(r.left as Float32Array<ArrayBuffer>, 0);
            buffer.copyToChannel(r.right as Float32Array<ArrayBuffer>, 1);
            return { id: r.id + (r.transpose ? "-final" : ""), buffer, beats: beatTimes(r.bars), duration: r.loopSamples / r.sampleRate };
          }
        : null);
    if (options.volumes) this.setVolumes(options.volumes);
  }

  // --- loading and music ------------------------------------------------------------------------------------

  async load(theme: TrackTheme, onProgress?: (fraction: number) => void): Promise<void> {
    if (this.disposed) return;
    this.loadedTheme = theme;
    let pack = 0;
    let music = this.renderer && this.makeTrack ? 0 : 1;
    const report = (): void => onProgress?.(Math.min(1, 0.4 * pack + 0.6 * music));
    const piece = theme as PieceId;
    const jobs: Promise<unknown>[] = [
      loadSoundPack(this.bus, "kart" satisfies Pack, (f) => {
        pack = f;
        report();
      }),
    ];
    if (this.renderer && this.makeTrack) {
      jobs.push(
        this.track(piece, false, (f) => {
          music = f;
          report();
        }).then(() => {
          music = 1;
          report();
        }),
      );
    }
    await Promise.all(jobs);
    onProgress?.(1);
    // The final-lap version renders in the background: a lap or two of racing is time enough.
    if (this.renderer && this.makeTrack && (THEME_PIECES as readonly string[]).includes(theme)) void this.track(piece, true);
    this.evict(theme);
  }

  music(kind: MusicKind | null): void {
    if (this.disposed || !this.player) return;
    if (kind === null) {
      this.wantedKey = null;
      this.playingKey = null;
      this.player.stop(0.8);
      return;
    }
    const piece = pieceFor(kind, this.loadedTheme);
    if (!piece) return;
    if (this.playingKey === piece || this.wantedKey === piece) return;
    this.wantedKey = piece;
    this.finalSwitched = false;
    void this.track(piece, false).then((track) => {
      if (!track || this.disposed || this.wantedKey !== piece) return;
      this.playingKey = piece;
      this.player!.play(track, 0.9);
      if (this.pendingFinal && piece === this.loadedTheme) this.switchToFinal();
    });
  }

  preload(...kinds: MusicKind[]): void {
    if (this.disposed || !this.renderer || !this.makeTrack) return;
    for (const kind of kinds) {
      const piece = pieceFor(kind, this.loadedTheme);
      if (piece) void this.track(piece, false);
    }
  }

  /** A piece's track, rendering it if need be (once, whoever asks). */
  private track(piece: PieceId, final: boolean, onProgress?: (fraction: number) => void): Promise<MusicTrack | null> {
    const key = final ? `${piece}-final` : piece;
    const have = this.tracks.get(key);
    if (have) return Promise.resolve(have);
    const going = this.inflight.get(key);
    if (going) return going;
    if (!this.renderer || !this.makeTrack) return Promise.resolve(null);
    const job = this.renderer
      .render(piece, final, onProgress)
      .then((rendered) => {
        if (this.disposed) return null;
        const track = this.makeTrack!(rendered);
        this.tracks.set(key, track);
        return track;
      })
      .catch((error: unknown) => {
        console.warn(`Grip Prix audio: could not make the music for "${key}"`, error);
        return null;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, job);
    return job;
  }

  /** Forget the tracks of other themes: a race's music is tens of megabytes. */
  private evict(theme: string): void {
    const keep = new Set([theme, `${theme}-final`, "menu", "results", "results-win", "podium", this.playingKey]);
    for (const key of [...this.tracks.keys()]) if (!keep.has(key)) this.tracks.delete(key);
  }

  /** "Go": the race's music from its first bar, whatever played before. */
  private startRaceMusic(): void {
    if (this.raceMusicStarted) return;
    this.raceMusicStarted = true;
    this.playingKey = null;
    this.wantedKey = null;
    this.music("race");
  }

  private switchToFinal(): void {
    if (this.finalSwitched && !this.pendingFinal) return;
    const theme = this.loadedTheme;
    if (!theme || !this.player) return;
    this.finalSwitched = true;
    const key = `${theme}-final`;
    const ready = this.tracks.get(key);
    if (ready && this.playingKey === theme) {
      this.pendingFinal = false;
      this.playingKey = key;
      this.wantedKey = key;
      this.player.switchTo(ready);
      return;
    }
    if (this.playingKey !== theme) {
      // The race music has not started (still rendering): the final-lap version, if it comes, is the one to start with.
      this.pendingFinal = true;
      return;
    }
    // Not made yet: switch the moment it is.
    this.pendingFinal = true;
    void this.track(theme as PieceId, true).then((track) => {
      if (!track || this.disposed || !this.pendingFinal || this.playingKey !== theme) return;
      this.pendingFinal = false;
      this.playingKey = key;
      this.wantedKey = key;
      this.player!.switchTo(track);
    });
  }

  // --- the sliders, pause, play -------------------------------------------------------------------------------------

  setVolumes(volumes: { music?: number; effects?: number }): void {
    const clean = (v: number | undefined, old: number): number => (v === undefined || !Number.isFinite(v) ? old : Math.min(1, Math.max(0, v)));
    this.volumes = { music: clean(volumes.music, this.volumes.music), effects: clean(volumes.effects, this.volumes.effects) };
    this.player?.setVolume(this.volumes.music);
  }

  private get fx(): number {
    return volumeGain(this.volumes.effects);
  }

  pause(): void {
    if (this.paused || this.disposed) return;
    this.paused = true;
    this.player?.setPaused(true);
    this.stopLoops();
  }

  resume(): void {
    if (!this.paused || this.disposed) return;
    this.paused = false;
    this.player?.setPaused(false);
  }

  play(sound: KartSound, options: { pan?: number; volume?: number } = {}): void {
    if (this.disposed) return;
    const cue = SOUND_CUES[sound];
    const big = sound === "finish-win" || sound === "finish-ok" || sound === "final-lap";
    this.start({ cue, volume: options.volume ?? 1, pan: options.pan ?? 0, distance: 0, rate: 1, delay: 0, priority: 3, ...(big ? { duck: { depth: 0.4, hold: 2.2 } } : {}) });
  }

  private start(order: Order): void {
    const volume = order.volume * this.fx;
    if (volume < 0.004) return;
    this.bus.play(order.cue, { volume, pan: order.pan, rate: order.rate, delay: order.delay, distance: order.distance });
    if (order.duck) this.duck(order.duck.depth, order.duck.hold);
    this.fired++;
  }

  /** Pull the music down under a big moment, unless a deeper duck is already holding it down. */
  private duck(depth: number, hold: number): void {
    if (!this.player) return;
    if (this.clock < this.duckUntil && depth > this.duckDepth) return;
    this.duckDepth = depth;
    this.duckUntil = this.clock + hold;
    this.player.duck(depth, hold);
  }

  stats(): RaceAudioStats {
    return {
      engines: this.engines.size,
      drifts: this.drifts.size,
      surfaces: this.surfaces.size,
      seekers: this.seekers.size,
      drones: this.drones.size,
      winds: this.winds.size,
      engineLoops: [...this.engines.values()].reduce((a, v) => a + [v.lo, v.hi, v.grit, v.idle, v.growl].filter((l) => l.running).length, 0),
      ambience: this.beds.filter((b) => b.layer.running).length,
      fired: this.fired,
      music: this.playingKey,
      paused: this.paused,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.stopLoops();
    this.disposed = true;
    this.player?.dispose();
    this.renderer?.dispose();
    this.tracks.clear();
    this.inflight.clear();
  }

  // --- the frame -----------------------------------------------------------------------------------------------------------

  frame(view: RaceView, local: readonly LocalKart[], dt: number): void {
    if (this.disposed) return;
    this.fired = 0;
    const step = Math.min(0.25, Math.max(0, Number.isFinite(dt) ? dt : 0));
    this.clock += step;
    if (this.paused) return;
    if (this.bus.muted) {
      // Nothing to hear: let go of the loops, but keep the race's bookkeeping in step.
      this.stopLoops();
    }

    const karts = new Map<number, KartView>();
    for (const k of view.karts) karts.set(k.id, k);
    const scene: Scene = { locals: local.filter((l) => karts.has(l.kart)), karts, laps: view.laps, racers: view.racers };

    this.phases(view);
    this.events(view.events, scene);
    if (this.bus.muted) {
      this.lastPhase = view.phase;
      return;
    }
    this.engineLoops(scene, step);
    this.stateLoops(view, scene, step);
    this.ambience(view.track.theme, step);
    this.ownMoments(view, scene);
    this.roulette(scene);
    this.finalLapFallback(view, scene);
    this.lastPhase = view.phase;
  }

  /** Race boundaries: a new countdown resets per-race state; "Go" starts the music. */
  private phases(view: RaceView): void {
    if (view.track.id !== this.trackId || (view.phase === "countdown" && this.lastPhase !== "countdown")) {
      this.trackId = view.track.id;
      this.raceMusicStarted = false;
      this.finalSwitched = false;
      this.pendingFinal = false;
      this.rolls.clear();
      this.places.clear();
      this.puckHeading.clear();
      if (this.playingKey === `${this.loadedTheme}-final` && this.wantedKey) {
        // The last race ended in its final-lap music: the next one starts from the normal version.
        this.playingKey = null;
        this.wantedKey = null;
      }
    }
    if (view.phase === "racing" && !this.raceMusicStarted) this.startRaceMusic();
    if (view.phase !== "countdown" && this.lastPhase === null) this.startRaceMusic();
  }

  private events(events: readonly RaceEvent[], scene: Scene): void {
    const orders: Order[] = [];
    for (const e of events) {
      if (this.seenSet.has(e.id)) continue;
      this.seenSet.add(e.id);
      this.seen.push(e.id);
      if (this.seen.length > 256) this.seenSet.delete(this.seen.shift()!);
      orders.push(...ordersFor(e, scene));
      if (e.type === "final-lap" && localOf(scene, e.kart) && !this.finalSwitched) this.switchToFinal();
    }
    // The most important first; no more than a handful at once, and no cue more than twice.
    orders.sort((a, b) => b.priority - a.priority);
    const count = new Map<string, number>();
    let started = 0;
    // Four players make four times the happenings: their everyday sounds come down a little (to 0.71 for four), what
    // must be heard does not.
    const many = Math.pow(Math.max(1, scene.locals.length), -0.25);
    for (const o of orders) {
      if (started >= MAX_ORDERS && o.priority < 3) continue;
      const n = count.get(o.cue) ?? 0;
      if (n >= MAX_PER_CUE && o.priority < 3) continue;
      count.set(o.cue, n + 1);
      this.start(o.distance === 0 && o.priority < 3 ? { ...o, volume: o.volume * many } : o);
      started++;
    }
  }

  /** In case the final-lap event was missed (a dropped packet): a local kart on its last lap is enough. */
  private finalLapFallback(view: RaceView, scene: Scene): void {
    if (this.finalSwitched || view.phase !== "racing" || view.laps < 2) return;
    for (const l of scene.locals) {
      const k = scene.karts.get(l.kart)!;
      if (k.lap === view.laps && k.finished === null) {
        this.switchToFinal();
        return;
      }
    }
  }

  // --- engines --------------------------------------------------------------------------------------------------------------------

  private loop(cue: string, params: LoopParams): LoopControl {
    return this.steer ? this.steer.controlledLoop(cue, params) : plainLoop(this.bus, cue, params);
  }

  private engineLoops(scene: Scene, dt: number): void {
    // Who gets an engine: every local kart, then the nearest others in earshot.
    const wanted: { id: number; local: LocalKart | null; distance: number; pan: number; index: number; listener: number }[] = scene.locals.map((l, index) => ({
      id: l.kart, local: l, distance: 0, pan: l.pan, index, listener: l.kart,
    }));
    const others: typeof wanted = [];
    for (const k of scene.karts.values()) {
      if (localOf(scene, k.id)) continue;
      const who = listenerAt(scene, k.x, k.z);
      if (who && who.distance <= ENGINE_RADIUS) others.push({ id: k.id, local: null, distance: who.distance, pan: who.pan, index: -1, listener: who.local.kart });
    }
    others.sort((a, b) => a.distance - b.distance);
    wanted.push(...others.slice(0, Math.max(0, Math.min(MAX_RIVALS, MAX_ENGINES - wanted.length))));

    const keep = new Set(wanted.map((w) => w.id));
    for (const [id, voice] of this.engines) {
      if (keep.has(id)) continue;
      this.silence(voice);
      this.engines.delete(id);
    }
    const trim = crowdTrim(scene.locals.length);
    const fx = this.fx;
    let rank = 0;
    for (const w of wanted) {
      const k = scene.karts.get(w.id)!;
      const own = w.local !== null;
      let v = this.engines.get(w.id);
      if (!v) {
        const character = scene.racers?.find((r) => r.id === w.id)?.character;
        const family = engineFamily(character, own ? w.index : w.id);
        const open = (cue: string, params: Required<LoopParams>): LoopControl => this.loop(cue, params);
        v = {
          family,
          pitch: own ? PLAYER_PITCH[w.index % PLAYER_PITCH.length]! : 0.96 + 0.011 * (w.id % 8),
          lo: new Layer(open, ENGINE_LAYERS[family].lo),
          hi: new Layer(open, ENGINE_LAYERS[family].hi),
          grit: new Layer(open, "kart_engine_grit"),
          idle: new Layer(open, "kart_idle", 1),
          growl: new Layer(open, "kart_growl", 0.6),
          last: { speed: k.speed, x: k.x, y: k.y, z: k.z },
          slope: 0,
          work: 0,
          revs: engineTarget(k).revs,
          engine: 0,
          rasp: 0,
          idling: 0,
          growling: 0,
          doppler: 1,
          phase: (w.id * 2.399963) % (2 * Math.PI),
          armed: false,
          poppedAt: -9,
          side: 0,
          passedAt: -9,
        };
        this.engines.set(w.id, v);
      } else if (dt > 0) {
        // How hard the engine works: the kart's acceleration (in speed, whichever way it goes) and the climb under it.
        const grounded = k.hop < 0.1 && k.rescue <= 0;
        const run = Math.hypot(k.x - v.last.x, k.z - v.last.z);
        const slope = grounded && run > 0.02 && run < 4 ? Math.max(-0.5, Math.min(0.5, (k.y - v.last.y) / run)) : 0;
        v.slope = ease(v.slope, slope, dt, 0.25);
        v.work = ease(v.work, engineWork((Math.abs(k.speed) - Math.abs(v.last.speed)) / dt, v.slope), dt, 0.15);
        v.last.speed = k.speed;
        v.last.x = k.x;
        v.last.y = k.y;
        v.last.z = k.z;
      }
      const target = engineTarget(k, v.work);
      // Smooth the targets (a guest's karts jump between snapshots): revs climb faster than they fall.
      v.revs = ease(v.revs, target.revs, dt, target.revs > v.revs ? 0.07 : 0.12);
      v.engine = ease(v.engine, target.engine, dt, 0.06);
      v.rasp = ease(v.rasp, target.grit, dt, 0.08);
      v.idling = ease(v.idling, target.idle, dt, 0.1);
      v.growling = ease(v.growling, target.growl, dt, 0.1);
      if (!own) {
        const listener = scene.karts.get(w.listener);
        v.doppler = ease(v.doppler, listener ? doppler(k, listener) : 1, dt, 0.08);
        if (listener) this.passBy(v, k, listener, w.pan);
      }
      // A little unsteadiness, as a real engine never holds a note quite still.
      const t = this.clock;
      const unsteady = 1 + 0.004 * Math.sin(2 * Math.PI * 1.7 * t + v.phase) + 0.0025 * Math.sin(2 * Math.PI * 4.3 * t + 2 * v.phase);
      const pitch = v.revs * v.pitch * v.doppler * unsteady;
      const level = (own ? trim : rivalLevel(w.distance, rank++)) * fx;
      const mix = layerMix(v.revs);
      // A motor does not idle: standing still, it hums low on its own low layer instead.
      const standby = IDLE_RATE[v.family] > 0 ? 0 : 0.4 * v.idling;
      v.lo.drive(level * (v.engine * mix.lo + standby), pitch / REV_LO, w.pan, w.distance, dt);
      v.hi.drive(level * v.engine * mix.hi, pitch / REV_HI, w.pan, w.distance, dt);
      // The rasp, the idle and the growl: the player's own karts in full, others only their idle on the grid and their boost.
      const firing = GRIT_RATE[v.family];
      v.grit.drive(own ? level * v.rasp * gritShare(v.family) * Math.min(1, 0.4 + v.engine) : 0, Math.min(2.4, pitch * firing), w.pan, w.distance, dt);
      const idleRate = IDLE_RATE[v.family];
      v.idle.drive(idleRate > 0 ? level * v.idling : 0, idleRate * v.pitch * (1 + 0.25 * (v.revs - 0.64)), w.pan, w.distance, dt);
      v.growl.drive(level * v.growling * (own ? 1 : 0.6), pitch * 0.85 * (firing / 0.84), w.pan, w.distance, dt);
      if (own) this.backfire(v, k, w.pan, trim);
    }
  }

  /** Lifting off hard after pulling at high revs, the player's own exhaust spits a few pops (at most one burst in two and a half seconds). */
  private backfire(v: EngineVoice, k: KartView, pan: number, trim: number): void {
    if (v.family === "electric") return;
    if (v.work > 0.15 && v.revs > 1.2) v.armed = true;
    const steady = k.hop < 0.1 && k.spin <= 0 && k.rescue <= 0 && Math.abs(k.speed) > 10;
    if (v.armed && v.work < -0.3 && steady && this.clock - v.poppedAt > 2.5) {
      v.armed = false;
      v.poppedAt = this.clock;
      const rate = { light: 1.15, middle: 1, heavy: 0.82, electric: 1 }[v.family];
      this.start({ cue: "kart_backfire", volume: 0.7 * trim, pan, distance: 0, rate, delay: 0, priority: 1 });
    }
  }

  /** A kart going by close and fast swishes past: when it crosses from behind its listener to ahead (or back) within a few metres. */
  private passBy(v: EngineVoice, k: KartView, listener: KartView, pan: number): void {
    const dx = k.x - listener.x;
    const dz = k.z - listener.z;
    const ahead = dx * Math.sin(listener.heading) + dz * Math.cos(listener.heading);
    const beside = Math.abs(-dx * Math.cos(listener.heading) + dz * Math.sin(listener.heading));
    const side = ahead >= 0 ? 1 : -1;
    const crossed = v.side !== 0 && side !== v.side;
    v.side = side;
    const closing = Math.abs(k.speed - listener.speed);
    if (!crossed || beside > 6 || closing < 3 || Math.abs(listener.speed) < 6 || this.clock - v.passedAt < 1.5) return;
    v.passedAt = this.clock;
    this.start({ cue: "kart_pass", volume: Math.min(1, 0.45 + 0.08 * closing) * (1 - beside / 9), pan, distance: beside, rate: Math.min(1.25, 0.9 + 0.025 * closing), delay: 0, priority: 0 });
  }

  private silence(v: EngineVoice): void {
    for (const layer of [v.lo, v.hi, v.grit, v.idle, v.growl]) layer.stop();
  }

  // --- loops that follow state ------------------------------------------------------------------------------------------------------

  private stateLoops(view: RaceView, scene: Scene, dt: number): void {
    const fx = this.fx;
    const drifts = new Set<number>();
    const surfaces = new Set<number>();
    const drones = new Set<number>();
    const squeals: { id: number; own: boolean; distance: number; params: Required<LoopParams> }[] = [];
    for (const k of view.karts) {
      const own = localOf(scene, k.id);
      const who = own ? { local: own, distance: 0, pan: own.pan } : listenerAt(scene, k.x, k.z);
      if (!who) continue;
      const near = own ? 1 : falloff(who.distance, LOOP_RADIUS);

      // The drift's squeal (heard below, for the nearest few), and under the player's own its sparks' fizz.
      const d = driftTarget(k);
      if (d.on && near > 0.05) {
        const volume = d.volume * near * (own ? 1 : 0.7) * fx;
        squeals.push({ id: k.id, own: !!own, distance: who.distance, params: { rate: d.rate, volume, pan: who.pan, distance: who.distance } });
      }
      if (own) {
        let fizz = this.sparks.get(k.id);
        if (!fizz && d.sparks > 0) this.sparks.set(k.id, (fizz = new Layer((cue, p) => this.loop(cue, p), "kart_drift_sparks", 0.3)));
        fizz?.drive(d.sparks * fx * crowdTrim(scene.locals.length), d.sparkRate, own.pan, 0, dt);
      }

      // The ground: only under the player's own wheels (the road's roll included).
      if (own) {
        const s = surfaceTarget(k);
        if (s.surface && s.volume > 0.01) {
          surfaces.add(k.id);
          const cue = SURFACE_CUES[s.surface];
          const have = this.surfaces.get(k.id);
          if (have && have.cue !== cue) {
            have.loop.stop();
            this.surfaces.delete(k.id);
          }
          this.drive(this.surfaces, k.id, cue, { rate: s.rate, volume: s.volume * fx * crowdTrim(scene.locals.length), pan: own.pan, distance: 0 }, dt);
        }
      }

      // The rescue drone carrying a fallen kart.
      if (k.rescue > 0 && near > 0.05) {
        drones.add(k.id);
        this.drive(this.drones, k.id, "kart_drone", { rate: 1, volume: near * (own ? 1 : 0.8) * fx, pan: who.pan, distance: who.distance }, dt);
      }
    }
    // Every local kart's squeal, and the nearest few others': a whole pack drifting round a hairpin is a choir otherwise.
    squeals.sort((a, b) => (a.own === b.own ? a.distance - b.distance : a.own ? -1 : 1));
    for (const s of squeals.slice(0, scene.locals.length + MAX_OTHER_DRIFTS)) {
      drifts.add(s.id);
      this.drive(this.drifts, s.id, "kart_drift", s.params, dt);
    }
    this.release(this.drifts, drifts);
    for (const [id, fizz] of this.sparks) {
      if (fizz.running || localOf(scene, id)) continue;
      this.sparks.delete(id);
    }
    this.release(this.surfaces, surfaces);
    this.release(this.drones, drones);

    // The wind round the player's own karts: started once it is worth hearing, kept until it has all but gone.
    const winds = new Set<number>();
    for (const l of scene.locals) {
      const k = scene.karts.get(l.kart)!;
      const w = windTarget(k);
      if (w.volume > (this.winds.has(l.kart) ? 0.01 : 0.05)) {
        winds.add(l.kart);
        this.drive(this.winds, l.kart, "kart_wind", { rate: w.rate, volume: w.volume * fx * crowdTrim(scene.locals.length), pan: l.pan, distance: 0 }, dt);
      }
    }
    this.release(this.winds, winds);

    // Homing pucks whistle on their way; any puck's bounce off a wall is heard.
    const seekers: { id: number; distance: number; pan: number }[] = [];
    const live = new Set<number>();
    for (const thing of view.things) {
      if (!thing.active) continue;
      const who = hearThing(scene, thing);
      if (!who) continue;
      if (thing.kind === "seeker") {
        if (who.distance < 90) seekers.push({ id: thing.id, distance: who.distance, pan: who.pan });
      } else if (thing.kind === "puck") {
        live.add(thing.id);
        this.puckBounce(thing.id, thing.heading, who.distance, who.pan);
      }
    }
    for (const id of [...this.puckHeading.keys()]) if (!live.has(id)) this.puckHeading.delete(id);
    seekers.sort((a, b) => a.distance - b.distance);
    const heard = new Set<number>();
    for (const s of seekers.slice(0, MAX_SEEKERS)) {
      heard.add(s.id);
      const have = this.seekers.get(s.id);
      // A little doppler: the whistle rises as it comes closer and falls as it goes.
      const closing = have ? (have.lastDistance - s.distance) / Math.max(dt, 1 / 120) : 0;
      const rate = 1 + 0.1 * Math.max(-1, Math.min(1, closing / 40));
      const volume = (0.35 + 0.65 * falloff(s.distance, 90)) * fx;
      const loop = this.drive(this.seekers, s.id, "kart_seeker", { rate, volume, pan: s.pan, distance: s.distance }, dt);
      (loop as Looper & { lastDistance: number }).lastDistance = s.distance;
    }
    this.release(this.seekers, heard);
  }

  /**
   * What happens to the player's own karts that no event says: a place won or lost (two notes up or down, at most one
   * every PLACE_GAP seconds a kart, and not in the shuffle off the grid). (A hard landing's thud comes with the sim's
   * `land` event: events.ts.)
   */
  private ownMoments(view: RaceView, scene: Scene): void {
    for (const l of scene.locals) {
      const k = scene.karts.get(l.kart)!;
      const heard = this.places.get(l.kart);
      if (heard && k.place !== heard.place && view.phase === "racing" && view.time > 2 && k.finished === null && this.clock - heard.at >= PLACE_GAP) {
        const up = k.place < heard.place;
        this.start({ cue: up ? "kart_place_up" : "kart_place_down", volume: up ? 1 : 0.8, pan: l.pan, distance: 0, rate: 1, delay: 0, priority: up ? 2 : 1 });
        heard.at = this.clock;
      }
      if (heard) heard.place = k.place;
      else this.places.set(l.kart, { place: k.place, at: -9 });
    }
  }

  /** Start a looper if it is not running, else move it. Returns it. */
  private drive<T extends Looper>(map: Map<number, T>, id: number, cue: string, params: Required<LoopParams>, dt: number): T {
    let l = map.get(id);
    if (!l) {
      l = { loop: this.loop(cue, params), cue, rate: params.rate, volume: params.volume, lastDistance: params.distance } as unknown as T;
      map.set(id, l);
      return l;
    }
    l.rate = ease(l.rate, params.rate, dt, 0.05);
    l.volume = ease(l.volume, params.volume, dt, 0.05);
    l.loop.set({ rate: l.rate, volume: l.volume, pan: params.pan, distance: params.distance });
    return l;
  }

  private release<T extends Looper>(map: Map<number, T>, keep: Set<number>): void {
    for (const [id, l] of map) {
      if (keep.has(id)) continue;
      l.loop.stop();
      map.delete(id);
    }
  }

  private stopLoops(): void {
    for (const v of this.engines.values()) this.silence(v);
    this.engines.clear();
    for (const map of [this.drifts, this.surfaces, this.seekers, this.drones, this.winds] as Map<number, Looper>[]) {
      for (const l of map.values()) l.loop.stop();
      map.clear();
    }
    for (const fizz of this.sparks.values()) fizz.stop();
    this.sparks.clear();
    for (const bed of this.beds) bed.layer.stop();
    this.beds = [];
    this.ambienceTheme = null;
    this.spots = null;
  }

  // --- the place -----------------------------------------------------------------------------------------------------

  /** The track's place, very quietly under it all: its beds, and now and then something far off. */
  private ambience(theme: TrackTheme, dt: number): void {
    const place = AMBIENCE[theme];
    if (!place) return;
    if (this.ambienceTheme !== theme) {
      for (const bed of this.beds) bed.layer.stop();
      this.ambienceTheme = theme;
      this.beds = place.beds.flatMap((b) => BED_PANS.map((pan) => ({ layer: new Layer((cue, p) => this.loop(cue, p), b.cue, 0.2), rate: b.rate, volume: b.volume, pan })));
      this.spots = new SpotClock(place.spots, rng(0x5eed + theme.length * 977), this.clock);
    }
    const fx = this.fx;
    for (const bed of this.beds) bed.layer.drive(bed.volume * fx, bed.rate, bed.pan, 0, dt);
    for (const spot of this.spots?.tick(this.clock) ?? []) {
      this.start({ cue: spot.cue, volume: spot.volume, pan: spot.pan, distance: spot.distance, rate: spot.rate, delay: 0, priority: 0 });
    }
  }

  /** A puck turning sharply in a short time has hit a wall. */
  private puckBounce(id: number, heading: number, distance: number, pan: number): void {
    const history = this.puckHeading.get(id) ?? [];
    history.push({ heading, t: this.clock });
    while (history.length > 1 && this.clock - history[0]!.t > 0.15) history.shift();
    this.puckHeading.set(id, history);
    if (history.length < 2) return;
    // Total turning across the window, however the angle wraps.
    let turn = 0;
    for (let i = 1; i < history.length; i++) {
      let d = history[i]!.heading - history[i - 1]!.heading;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      turn += Math.abs(d);
    }
    if (turn > 0.7 && this.clock - (this.lastBounce.get(id) ?? -9) > 0.25) {
      this.lastBounce.set(id, this.clock);
      const reach = falloff(distance, 55);
      if (reach > 0.03) this.start({ cue: "kart_puck_bounce", volume: 0.9 * reach, pan, distance, rate: 1, delay: 0, priority: 2 });
    }
  }

  // --- the item roulette ------------------------------------------------------------------------------------------

  /** Ticks while the item box's roulette turns (slowing, rising in pitch), and a chime when it lands. */
  private roulette(scene: Scene): void {
    for (const l of scene.locals) {
      const k = scene.karts.get(l.kart)!;
      const r = this.rolls.get(l.kart);
      if (k.rolling) {
        if (!r) {
          this.rolls.set(l.kart, { next: this.clock, count: 0 });
          continue;
        }
        if (this.clock >= r.next) {
          this.start({ cue: "kart_roulette_tick", volume: 0.85, pan: l.pan, distance: 0, rate: Math.min(1.6, 0.85 + 0.035 * r.count), delay: 0, priority: 2 });
          r.count++;
          r.next = this.clock + 0.055 + 0.011 * r.count;
        }
      } else if (r) {
        this.rolls.delete(l.kart);
        if (k.item !== null) this.start({ cue: "kart_item_ready", volume: 1, pan: l.pan, distance: 0, rate: 1, delay: 0, priority: 3 });
      }
    }
  }
}

/** The sound of a Grip Prix race. ``bus`` is the shared audio engine (``ctx.audio``). */
export function createRaceAudio(bus: AudioBus, options: RaceAudioOptions = {}): RaceAudio {
  return new RaceAudioImpl(bus, options);
}
