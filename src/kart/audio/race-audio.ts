/**
 * Grip Prix's sound, for one screen of up to four local players.
 *
 * Wire it once per race screen:
 *
 *     const audio = createRaceAudio(ctx.audio, { volumes: { music: 0.8, effects: 1 } });
 *     await audio.load(track.theme, setProgress);      // the kart sounds, and the track's music
 *     // every animation frame, with the view the renderer draws:
 *     audio.frame(view, localKarts, dt);
 *
 * and ``music("menu")``, ``music("results-win")`` and so on on the other
 * screens. It turns every RaceEvent into its sound, runs the loops that
 * belong to a kart's state (engines pitched by speed, the drift squeal, the
 * surface, a seeker's whistle, the rescue drone), counts the race in, starts
 * the music at "Go" and switches it to its faster final-lap version when the
 * first local kart begins its last lap.
 *
 * It needs the Web Audio engine (src/audio) for steerable loops and music;
 * with any other AudioBus (a silent one, a test double) the effects still play
 * as plain cues and loops, and the music is skipped.
 */
import type { AudioBus } from "../../engine/types";
import { loadSoundPack } from "../../audio";
import type { Pack } from "../../audio";
import type { LoopControl, LoopParams, SteerableAudio } from "../../audio/types";
import type { KartView, RaceEvent, RaceView } from "../contract";
import {
  ENGINE_CUES,
  PLAYER_PITCH,
  SURFACE_CUES,
  crowdTrim,
  driftTarget,
  ease,
  engineTarget,
  surfaceTarget,
} from "./engines";
import { type Order, ordersFor } from "./events";
import { type KartSound, type MusicKind, type TrackTheme, SOUND_CUES, pieceFor } from "./kinds";
import { type MusicRenderer, createMusicRenderer } from "./music/loader";
import { type MusicTrack, MusicPlayer, beatTimes, sliderGain } from "./music/player";
import { type PieceId, THEME_PIECES } from "./music/pieces";
import { MUSIC_SAMPLE_RATE, type RenderedMusic } from "./music/render";
import { type LocalKart, type Scene, falloff, hearThing, listenerAt, localOf } from "./scene";

export type { KartSound, MusicKind, TrackTheme } from "./kinds";
export type { LocalKart } from "./scene";

export interface RaceAudioOptions {
  /** Where music is synthesised: "auto" uses a Worker when the page can. */
  render?: "auto" | "worker" | "main";
  /** The two sliders, 0..1 each (a slider's position: half way is a quarter of the power). Default 1 and 1. */
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
  /** Sounds started in the last frame. */
  fired: number;
  /** The music playing, by piece id ("meadow", "meadow-final"), or null. */
  music: string | null;
  paused: boolean;
}

/** At most this many engines at once (the four players' and the nearest others'). */
const MAX_ENGINES = 6;
/** How far another kart's engine carries, metres. */
const ENGINE_RADIUS = 75;
/** Most one-shots started in one frame, and of any one cue. */
const MAX_ORDERS = 8;
const MAX_PER_CUE = 2;
/** Another kart's loops (drift squeal, drone) are heard within this many metres. */
const LOOP_RADIUS = 45;
const MAX_SEEKERS = 3;

interface EngineVoice {
  timbre: number;
  engine: LoopControl;
  idle: LoopControl | null;
  growl: LoopControl | null;
  growlQuietFor: number;
  rate: number;
  vols: { engine: number; idle: number; growl: number };
  sent: { rate: number; engine: number; idle: number; growl: number; pan: number; distance: number };
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
  private finishAt = -10;
  private readonly flooded = new Set<number>();
  private readonly seen: number[] = [];
  private readonly seenSet = new Set<number>();

  // Loops by state.
  private readonly engines = new Map<number, EngineVoice>();
  private readonly drifts = new Map<number, Looper>();
  private readonly surfaces = new Map<number, Looper>();
  private readonly seekers = new Map<number, Looper & { lastDistance: number }>();
  private readonly drones = new Map<number, Looper>();
  private readonly rolls = new Map<number, { next: number; count: number }>();
  private readonly lastProgress = new Map<number, number>();
  private readonly puckHeading = new Map<number, { heading: number; t: number }[]>();
  private readonly lastBounce = new Map<number, number>();
  private fired = 0;

  // Music.
  private loadedTheme: TrackTheme | null = null;
  private readonly tracks = new Map<string, MusicTrack>();
  private readonly inflight = new Map<string, Promise<MusicTrack | null>>();
  private wanted: { piece: PieceId; key: string } | null = null;
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
      this.wanted = null;
      this.playingKey = null;
      this.player.stop(0.8);
      return;
    }
    const piece = pieceFor(kind, this.loadedTheme);
    if (!piece) return;
    const key = piece;
    if (this.playingKey === key || this.wanted?.key === key) return;
    this.wanted = { piece, key };
    this.finalSwitched = false;
    void this.track(piece, false).then((track) => {
      if (!track || this.disposed || !this.wanted || this.wanted.key !== key) return;
      this.playingKey = key;
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
    this.wanted = null;
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
      this.wanted = { piece: theme as PieceId, key };
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
      this.wanted = { piece: theme as PieceId, key };
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
    return sliderGain(this.volumes.effects);
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
    if (order.duck && this.player) this.player.duck(order.duck.depth, order.duck.hold);
    this.fired++;
  }

  stats(): RaceAudioStats {
    return {
      engines: this.engines.size,
      drifts: this.drifts.size,
      surfaces: this.surfaces.size,
      seekers: this.seekers.size,
      drones: this.drones.size,
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
    const scene: Scene = { locals: local.filter((l) => karts.has(l.kart)), karts, laps: view.laps };

    this.phases(view);
    this.events(view.events, scene);
    if (this.bus.muted) {
      this.lastPhase = view.phase;
      return;
    }
    this.engineLoops(scene, step);
    this.stateLoops(view, scene, step);
    this.roulette(scene);
    this.startFlood(view, scene);
    // The duck squeaks on its own `duck` event now (sim/eggs.ts), once per kart: the old drive-by squeak would sound twice.
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
      this.flooded.clear();
      this.rolls.clear();
      this.lastProgress.clear();
      this.puckHeading.clear();
      this.finishAt = -10;
      if (this.playingKey === `${this.loadedTheme}-final` && this.wanted) {
        // The last race ended in its final-lap music: the next one starts from the normal version.
        this.playingKey = null;
        this.wanted = null;
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
      if (e.type === "finish" && localOf(scene, e.kart)) this.finishAt = this.clock;
    }
    // The most important first; no more than a handful at once, and no cue more than twice.
    orders.sort((a, b) => b.priority - a.priority);
    const count = new Map<string, number>();
    let started = 0;
    for (const o of orders) {
      if (started >= MAX_ORDERS && o.priority < 3) continue;
      const n = count.get(o.cue) ?? 0;
      if (n >= MAX_PER_CUE && o.priority < 3) continue;
      count.set(o.cue, n + 1);
      this.start(o);
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
    const wanted: { id: number; local: LocalKart | null; distance: number; pan: number; index: number }[] = scene.locals.map((l, index) => ({ id: l.kart, local: l, distance: 0, pan: l.pan, index }));
    const others: typeof wanted = [];
    for (const k of scene.karts.values()) {
      if (localOf(scene, k.id)) continue;
      const who = listenerAt(scene, k.x, k.z);
      if (who && who.distance <= ENGINE_RADIUS) others.push({ id: k.id, local: null, distance: who.distance, pan: who.pan, index: -1 });
    }
    others.sort((a, b) => a.distance - b.distance);
    wanted.push(...others.slice(0, Math.max(0, MAX_ENGINES - wanted.length)));

    const keep = new Set(wanted.map((w) => w.id));
    for (const [id, voice] of this.engines) {
      if (keep.has(id)) continue;
      voice.engine.stop();
      voice.idle?.stop();
      voice.growl?.stop();
      this.engines.delete(id);
    }
    const trim = crowdTrim(scene.locals.length);
    for (const w of wanted) {
      const k = scene.karts.get(w.id)!;
      const target = engineTarget(k);
      const own = w.local !== null;
      const timbre = own ? w.index % ENGINE_CUES.length : (w.id + 2) % ENGINE_CUES.length;
      const pitch = own ? PLAYER_PITCH[w.index % PLAYER_PITCH.length]! : 0.95 + 0.012 * (w.id % 8);
      // Others are quieter, by their distance as well as by the air.
      const level = own ? trim : 0.7 * falloff(w.distance, ENGINE_RADIUS) * 0.8;
      let v = this.engines.get(w.id);
      if (!v) {
        const first = { rate: target.rate * pitch, volume: 0, pan: w.pan, distance: w.distance };
        v = {
          timbre,
          engine: this.loop(ENGINE_CUES[timbre]!, first),
          idle: this.loop("kart_idle", { ...first, rate: 0.92 + 0.07 * timbre }),
          growl: null,
          growlQuietFor: 0,
          rate: target.rate,
          vols: { engine: 0, idle: 0, growl: 0 },
          sent: { rate: -1, engine: -1, idle: -1, growl: -1, pan: 9, distance: -1 },
        };
        this.engines.set(w.id, v);
      }
      // Smooth the target: a guest's karts jump between snapshots.
      v.rate = ease(v.rate, target.rate, dt, 0.05);
      v.vols.engine = ease(v.vols.engine, target.engine, dt, 0.06);
      v.vols.idle = ease(v.vols.idle, target.idle, dt, 0.1);
      v.vols.growl = ease(v.vols.growl, target.growl, dt, 0.1);
      const fx = this.fx;
      const rate = v.rate * pitch;
      const engineVol = v.vols.engine * level * fx;
      const idleVol = v.vols.idle * level * fx;
      const growlVol = v.vols.growl * level * fx;
      const s = v.sent;
      const moved = Math.abs(rate - s.rate) > 0.004 || Math.abs(w.pan - s.pan) > 0.02 || Math.abs(w.distance - s.distance) > 0.5;
      if (moved || changed(engineVol, s.engine)) v.engine.set({ rate, volume: engineVol, pan: w.pan, distance: w.distance });
      if (v.idle && (moved || changed(idleVol, s.idle))) v.idle.set({ rate: (0.92 + 0.07 * v.timbre) * (1 + 0.25 * (rate / pitch - 0.64)), volume: idleVol, pan: w.pan, distance: w.distance });
      // The growl loop exists only around a boost.
      if (target.growl > 0 && !v.growl) v.growl = this.loop("kart_growl", { rate: rate * 0.85, volume: 0, pan: w.pan, distance: w.distance });
      if (v.growl) {
        if (growlVol > 0.004) {
          v.growlQuietFor = 0;
          v.growl.set({ rate: rate * 0.85, volume: growlVol, pan: w.pan, distance: w.distance });
        } else if (target.growl === 0) {
          v.growlQuietFor += dt;
          if (v.growlQuietFor > 0.6) {
            v.growl.stop();
            v.growl = null;
          }
        }
      }
      s.rate = rate;
      s.engine = engineVol;
      s.idle = idleVol;
      s.growl = growlVol;
      s.pan = w.pan;
      s.distance = w.distance;
    }
  }

  // --- loops that follow state ------------------------------------------------------------------------------------------------------

  private stateLoops(view: RaceView, scene: Scene, dt: number): void {
    const fx = this.fx;
    const drifts = new Set<number>();
    const surfaces = new Set<number>();
    const drones = new Set<number>();
    for (const k of view.karts) {
      const own = localOf(scene, k.id);
      const who = own ? { local: own, distance: 0, pan: own.pan } : listenerAt(scene, k.x, k.z);
      if (!who) continue;
      const near = own ? 1 : falloff(who.distance, LOOP_RADIUS);

      // The drift's squeal.
      const d = driftTarget(k);
      if (d.on && near > 0.05) {
        drifts.add(k.id);
        const volume = d.volume * near * (own ? 1 : 0.7) * fx;
        this.drive(this.drifts, k.id, "kart_drift", { rate: d.rate, volume, pan: who.pan, distance: who.distance }, dt);
      }

      // The ground: only under the player's own wheels.
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
    this.release(this.drifts, drifts);
    this.release(this.surfaces, surfaces);
    this.release(this.drones, drones);

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
    for (const v of this.engines.values()) {
      v.engine.stop();
      v.idle?.stop();
      v.growl?.stop();
    }
    this.engines.clear();
    for (const map of [this.drifts, this.surfaces, this.seekers, this.drones] as Map<number, Looper>[]) {
      for (const l of map.values()) l.loop.stop();
      map.clear();
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

  // --- the item roulette, the flooded start, the duck ------------------------------------------------------------------------------------------

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

  /** The engine floods when a driver floors it too early: the sim holds the kart still, and the engine coughs. */
  private startFlood(view: RaceView, scene: Scene): void {
    if (view.phase !== "racing" || view.time < 0.25 || view.time > 0.9) return;
    for (const l of scene.locals) {
      if (this.flooded.has(l.kart)) continue;
      const k = scene.karts.get(l.kart)!;
      if (k.speed < 0.35 && k.boost <= 0 && k.rescue <= 0) {
        this.flooded.add(l.kart);
        this.start({ cue: "kart_flood", volume: 1, pan: l.pan, distance: 0, rate: 1, delay: 0, priority: 3 });
      } else if (view.time > 0.4) {
        this.flooded.add(l.kart);
      }
    }
  }

  /** Driving past the rubber duck squeaks it, once a lap. */
  private duckSqueaks(view: RaceView, scene: Scene): void {
    const duck = view.track.duck;
    if (!duck) return;
    for (const l of scene.locals) {
      const k = scene.karts.get(l.kart)!;
      const before = this.lastProgress.get(l.kart);
      this.lastProgress.set(l.kart, k.lapProgress);
      if (before === undefined) continue;
      // Crossed its place along the lap this frame (and not by wrapping round the start line).
      const crossed = before < duck.at && k.lapProgress >= duck.at && k.lapProgress - before < 0.05;
      if (crossed) this.start({ cue: "kart_duck", volume: 0.8, pan: l.pan, distance: 0, rate: 1, delay: 0, priority: 2 });
    }
  }
}

/** The sound of a Grip Prix race. ``bus`` is Handy's audio engine (``ctx.audio``). */
export function createRaceAudio(bus: AudioBus, options: RaceAudioOptions = {}): RaceAudio {
  return new RaceAudioImpl(bus, options);
}
