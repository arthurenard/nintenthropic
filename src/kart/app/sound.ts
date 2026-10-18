/**
 * Grip Prix's sound behind the screens' `SoundService`: the arcade's Web
 * Audio engine (made once, on the page's first gesture), one `RaceAudio`
 * (src/kart/audio) for the menus' music and the interface's sounds, and a
 * fresh one for every race.
 *
 * Super Claude Bros. has one sound preference, on or off, which the arcade shares
 * (`prefs.muted`), and a master volume (the arcade's Settings). The race page
 * adds Music and Effects sliders, remembered here. With sound off nothing is
 * made: no engine, no music rendered, no code fetched, until it is turned on.
 *
 * The audio code is fetched when sound wakes, not with the page, so the start
 * screen never waits for it.
 */
import { loadPreferences, prefs } from "../../app/prefs";
import type { AudioEngine } from "../../audio/index";
import type { KartSound, MusicKind, RaceAudio, RaceAudioOptions } from "../audio";
import { localKarts } from "../audio/scene";
import type { AudioBus } from "../../engine/types";
import { loadLevels, saveLevels } from "./prefs";
import type { RaceSound, SoundLevels, SoundReport, SoundService } from "./services";

type MakeAudio = (bus: AudioBus, options?: RaceAudioOptions) => RaceAudio;

export class KartSounds implements SoundService {
  private engine: AudioEngine | null = null;
  private make: MakeAudio | null = null;
  private waking: Promise<void> | null = null;
  /** Interface sounds and the menus' music. */
  private menu: RaceAudio | null = null;
  /** The menu music asked for, which may be before sound is awake. */
  private wanted: MusicKind | null = null;
  private off = prefs.muted;
  private sliders = loadLevels();
  /** The races being heard, so a slider moves them all. */
  private readonly races = new Set<RaceAudio>();

  get muted(): boolean {
    return this.off;
  }

  setMuted(muted: boolean): void {
    this.off = muted;
    prefs.muted = muted;
    this.engine?.setMuted(muted);
    // Turning sound on is a gesture, and the first time it makes the engine.
    if (!muted) this.wake();
  }

  levels(): SoundLevels {
    return { ...this.sliders };
  }

  setLevels(levels: Partial<SoundLevels>): void {
    this.sliders = { ...this.sliders, ...levels };
    saveLevels(this.sliders);
    this.menu?.setVolumes(this.sliders);
    for (const race of this.races) race.setVolumes(this.sliders);
  }

  wake(): void {
    if (this.off || this.waking) return;
    this.waking = this.start().catch((error: unknown) => console.warn("Grip Prix sound is unavailable.", error));
  }

  private async start(): Promise<void> {
    const [{ createAudioBus, loadSoundPack }, { createRaceAudio }] = await Promise.all([import("../../audio/index"), import("../audio")]);
    const engine = await createAudioBus({ muted: this.off, volume: loadPreferences().volume });
    this.engine = engine;
    this.make = createRaceAudio;
    this.menu = createRaceAudio(engine, { volumes: this.sliders });
    // The interface's sounds are ready before the first button asks for one.
    void loadSoundPack(engine, "kart");
    this.menu.music(this.wanted);
  }

  music(kind: MusicKind | null): void {
    this.wanted = kind;
    this.menu?.music(kind);
  }

  play(sound: KartSound): void {
    this.menu?.play(sound);
  }

  race(): RaceSound {
    const sounds = this;
    let audio: RaceAudio | null = null;
    let theme: Parameters<RaceSound["load"]>[0] | null = null;
    let progress: ((fraction: number) => void) | undefined;
    let loading: Promise<void> | null = null;
    let paused = false;
    let done = false;

    /** Starts the race's sounds and music once there is both a track and an audio to load them into. */
    const begin = (): void => {
      if (!audio || !theme || loading) return;
      loading = audio.load(theme, progress).catch((error: unknown) => console.warn("Grip Prix sound: the race's sounds did not load.", error));
    };
    /** The race's audio, made as soon as sound is awake (at once if it already is). */
    const bind = (): void => {
      if (audio || done || !sounds.engine || !sounds.make) return;
      audio = sounds.make(sounds.engine, { volumes: sounds.sliders });
      sounds.races.add(audio);
      if (paused) audio.pause();
      begin();
    };
    bind();
    // Sound off at the start of the race, turned on during it: it joins in when it can.
    void sounds.waking?.then(bind);

    return {
      async load(forTheme, onProgress) {
        theme = forTheme;
        progress = onProgress;
        sounds.wake();
        begin();
        await sounds.waking;
        bind();
        if (loading) await loading;
        else onProgress?.(1);
      },
      frame(view, views, dt) {
        if (!audio) bind();
        audio?.frame(view, localKarts(views), dt);
      },
      pause() {
        paused = true;
        audio?.pause();
      },
      resume() {
        paused = false;
        audio?.resume();
      },
      dispose() {
        done = true;
        if (!audio) return;
        sounds.races.delete(audio);
        audio.dispose();
        audio = null;
      },
    };
  }

  report(): SoundReport {
    const race = [...this.races][0]?.stats() ?? null;
    const menu = this.menu?.stats() ?? null;
    return {
      awake: this.engine !== null,
      muted: this.off,
      music: race?.music ?? menu?.music ?? null,
      engines: race?.engines ?? 0,
      paused: race?.paused ?? false,
    };
  }
}

/** Sound that makes none: for the screens' tests, where there is nothing to hear. */
export function silentSound(): SoundService {
  let muted = true;
  let sliders: SoundLevels = { music: 0.8, effects: 1 };
  return {
    get muted() {
      return muted;
    },
    setMuted: (value) => void (muted = value),
    levels: () => ({ ...sliders }),
    setLevels: (levels) => void (sliders = { ...sliders, ...levels }),
    wake() {},
    music() {},
    play() {},
    race: () => ({ load: async (_theme, progress) => progress?.(1), frame() {}, pause() {}, resume() {}, dispose() {} }),
    report: () => ({ awake: false, muted, music: null, engines: 0, paused: false }),
  };
}
