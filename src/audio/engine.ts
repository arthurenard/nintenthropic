/**
 * The Web Audio engine: one AudioContext, and the graph every sound plays
 * through.
 *
 *   voices ─► sfx bus ──┐
 *   voices ─► world bus ├─► muffle (low-pass) ─► duck ─┐
 *   reverb return ──────┘                              │
 *   voices ─► ui bus ──────────────────────────────────┼─► master (volume, mute) ─► limiter ─► soft clip ─► speakers
 *   heartbeat, death ─► self bus ──────────────────────┘
 *
 * A voice is one take of a cue: its source, the air's low-pass for its
 * distance, its level and pan, a send to the town's reverb, and up to five
 * copies of the same take started later, darker and elsewhere in the stereo
 * field — the street's echoes (routing.ts decides every number). "Hurt"
 * closes the muffle and ducks the world while a heartbeat, which bypasses
 * both, races with the damage; "slowmo" drops every voice's rate, closes the
 * muffle further, swells the reverb and sets off a low boom.
 */
import type { CueOptions } from "../engine/types";
import { CUES, type BusName, type CueSpec, type Pack } from "./cues/table";
import { townImpulse } from "./impulse";
import { ENVELOPE_BLOCK, type GenerationReport, type LoadedTake, SoundLibrary } from "./library";
import {
  DUST_CREEK,
  type StreetSpace,
  type VoiceInfo,
  admit,
  airCutoff,
  distanceGain,
  echoTaps,
  hurtMix,
  pickTake,
  reverbSend,
  slowmoEngaged,
  slowmoMix,
  travelTime,
  variedRate,
  volumeGain,
} from "./routing";
import type { AudioEngine, LoopControl, LoopParams, SteerableAudio } from "./types";

/** At most this many one-shot voices at once (loops and heartbeats are apart). */
export const MAX_VOICES = 24;
/** Headroom before the limiter. */
const MIX_GAIN = 0.9;
/** The reverb's return level. */
const REVERB_RETURN = 0.55;

interface Voice extends VoiceInfo {
  /** Not slowed by slow motion (the slow-motion boom itself). */
  exempt: boolean;
  sources: AudioBufferSourceNode[];
  rates: number[];
  nodes: AudioNode[];
  out: GainNode;
  endsAt: number;
}

interface LoopState {
  cue: string;
  stopped: boolean;
  source: AudioBufferSourceNode | null;
  baseRate: number;
  nodes: AudioNode[];
  gain: GainNode | null;
}

const db = (x: number): number => Math.pow(10, x / 20);
const clamp = (x: number, lo: number, hi: number): number => (Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : lo);

export class WebAudioEngine implements AudioEngine, SteerableAudio {
  readonly ctx: AudioContext;
  readonly library: SoundLibrary;
  private readonly buses: Record<BusName, GainNode>;
  private readonly muffle: BiquadFilterNode;
  private readonly duck: GainNode;
  private readonly master: GainNode;
  private readonly reverbIn: GainNode;
  private readonly reverbReturn: GainNode;
  private music: GainNode | null = null;
  private voices: Voice[] = [];
  private readonly loops = new Set<LoopState>();
  /** Loops not slowed by slow motion (steady cues, the interface). */
  private readonly steadyLoops = new WeakSet<LoopState>();
  private readonly lastStart = new Map<string, number>();
  private readonly lastTake = new Map<string, number>();
  private readonly warned = new Set<string>();
  private space: StreetSpace = { ...DUST_CREEK };
  private hurt = 0;
  private slowmo = 0;
  private rate = 1;
  private nextBeat = 0;
  private beatTimer: ReturnType<typeof setInterval> | null = null;
  private suspendTimer: ReturnType<typeof setTimeout> | null = null;
  private nextId = 1;
  private _muted: boolean;
  private _volume: number;
  private closed = false;
  private readonly wake = (): void => this.resumeIfWanted();
  private readonly onVisibility = (): void => {
    if (typeof document !== "undefined" && document.hidden) void this.ctx.suspend().catch(() => {});
    else this.resumeIfWanted();
  };

  constructor(ctx: AudioContext, options: { muted: boolean; volume?: number; seed?: number; workers?: number }) {
    this.ctx = ctx;
    this._muted = options.muted;
    this._volume = clamp(options.volume ?? 1, 0, 1);
    this.library = new SoundLibrary(ctx, options.seed ?? 1, options.workers);

    this.master = ctx.createGain();
    this.master.gain.value = options.muted ? 0 : this.level;
    // The limiter: fast and hard above −1.5 dBFS, so a single shot passes
    // untouched (its transient is the point) and only a big wave's pile-up
    // of shots is caught, rather than clipped.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -1.5;
    limiter.knee.value = 2;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.15;
    // And behind it a soft clip, in case anything outruns the limiter's attack.
    const clip = ctx.createWaveShaper();
    clip.curve = softClipCurve();
    this.master.connect(limiter).connect(clip).connect(ctx.destination);

    this.muffle = ctx.createBiquadFilter();
    this.muffle.type = "lowpass";
    this.muffle.frequency.value = 20000;
    this.muffle.Q.value = 0.7;
    this.duck = ctx.createGain();
    this.muffle.connect(this.duck).connect(this.master);

    this.buses = {
      sfx: ctx.createGain(),
      world: ctx.createGain(),
      ui: ctx.createGain(),
      self: ctx.createGain(),
    };
    this.buses.sfx.connect(this.muffle);
    this.buses.world.connect(this.muffle);
    this.buses.ui.connect(this.master);
    // Inside the player's head: the heartbeat and the death are not muffled by being hurt.
    this.buses.self.connect(this.master);

    // The town's reverb: a synthesised impulse, returned under the muffle so
    // being hurt dulls it too.
    const convolver = ctx.createConvolver();
    convolver.normalize = false;
    const [l, r] = townImpulse(ctx.sampleRate);
    const ir = ctx.createBuffer(2, l.length, ctx.sampleRate);
    ir.copyToChannel(l as Float32Array<ArrayBuffer>, 0);
    ir.copyToChannel(r as Float32Array<ArrayBuffer>, 1);
    convolver.buffer = ir;
    this.reverbIn = ctx.createGain();
    this.reverbReturn = ctx.createGain();
    this.reverbReturn.gain.value = REVERB_RETURN;
    this.reverbIn.connect(convolver).connect(this.reverbReturn).connect(this.muffle);

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", this.onVisibility);
      for (const type of ["pointerdown", "keydown", "touchend"]) {
        window.addEventListener(type, this.wake, { capture: true, passive: true });
      }
      window.addEventListener("pageshow", this.wake);
    }
    ctx.onstatechange = () => {
      // Safari "interrupts" a context (a call, another tab playing); ask again.
      if (ctx.state !== "running") this.resumeIfWanted();
    };
    if (options.muted) void ctx.suspend().catch(() => {});
    else this.resumeIfWanted();
  }

  get muted(): boolean {
    return this._muted;
  }

  /** Mute or unmute (the app remembers the choice). Muted, the context is suspended to save the battery. */
  setMuted(muted: boolean): void {
    if (this.closed || muted === this._muted) return;
    this._muted = muted;
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(this.master.gain.value, now);
    if (this.suspendTimer !== null) clearTimeout(this.suspendTimer);
    this.suspendTimer = null;
    if (muted) {
      this.master.gain.setTargetAtTime(0, now, 0.02);
      this.stopHeart();
      this.suspendTimer = setTimeout(() => {
        if (this._muted) void this.ctx.suspend().catch(() => {});
      }, 150);
    } else {
      this.resumeIfWanted();
      this.master.gain.setTargetAtTime(this.level, now, 0.02);
      this.applyFilters();
    }
  }

  get volume(): number {
    return this._volume;
  }

  /**
   * The master volume, 0..1 as the slider sets it (the app remembers it).
   * Apart from mute: a muted engine keeps its volume for when it is unmuted.
   * Glides over a few milliseconds, so dragging the slider never clicks.
   */
  setVolume(volume: number): void {
    const next = clamp(volume, 0, 1);
    if (this.closed || next === this._volume) return;
    this._volume = next;
    if (this._muted) return;
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(this.master.gain.value, now);
    this.master.gain.setTargetAtTime(this.level, now, 0.02);
  }

  /** The master gain when not muted: the mix's headroom times the volume. */
  private get level(): number {
    return MIX_GAIN * volumeGain(this._volume);
  }

  /** Synthesise a pack's sounds now (a game's ``load`` calls this through loadSoundPack). */
  load(pack: Pack, onProgress?: (fraction: number) => void): Promise<void> {
    return this.library.load(pack, onProgress);
  }

  /** How long synthesis took, per pack. */
  get generation(): readonly GenerationReport[] {
    return this.library.reports;
  }

  /** Change the street the listener stands in (for a game with other walls). */
  setSpace(space: Partial<StreetSpace>): void {
    this.space = { ...this.space, ...space };
  }

  play(cue: string, options: CueOptions = {}): void {
    this.playInternal(cue, options, false);
  }

  loop(cue: string, options: CueOptions = {}): () => void {
    const spec = this.spec(cue);
    if (!spec || this.closed) return () => {};
    const state: LoopState = { cue, stopped: false, source: null, baseRate: 1, nodes: [], gain: null };
    this.loops.add(state);
    const begin = (): void => {
      if (state.stopped || this.closed) return;
      const takes = this.library.get(cue);
      if (!takes) return;
      const k = pickTake(takes.length, this.lastTake.get(cue) ?? -1, Math.random());
      this.lastTake.set(cue, k);
      const take = takes[k]!;
      const ctx = this.ctx;
      const now = ctx.currentTime;
      const d = options.distance ?? 0;
      const src = ctx.createBufferSource();
      src.buffer = take.buffer;
      src.loop = true;
      state.baseRate = clamp(variedRate(options.rate ?? 1, spec.vary ?? 0.02, Math.random()), 0.25, 4);
      const steady = !!spec.steady || spec.bus === "ui";
      if (steady) this.steadyLoops.add(state);
      src.playbackRate.value = state.baseRate * (steady ? 1 : this.rate);
      const gain = ctx.createGain();
      const target = db(spec.level) * Math.max(0, options.volume ?? 1) * distanceGain(d);
      const fadeIn = spec.fadeIn ?? 0.3;
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(target, now + Math.max(0.01, fadeIn));
      const pan = ctx.createStereoPanner();
      pan.pan.value = clamp(options.pan ?? 0, -1, 1);
      let head: AudioNode = src;
      const nodes: AudioNode[] = [src, gain, pan];
      if (airCutoff(d) < 19000) {
        const air = ctx.createBiquadFilter();
        air.type = "lowpass";
        air.frequency.value = airCutoff(d);
        air.Q.value = 0.5;
        head = head.connect(air);
        nodes.push(air);
      }
      head.connect(gain).connect(pan).connect(this.buses[spec.bus]);
      // Start somewhere inside the loop, so two of the same never phase.
      src.start(now + Math.max(0, options.delay ?? 0), Math.random() * take.buffer.duration);
      state.source = src;
      state.gain = gain;
      state.nodes = nodes;
    };
    if (this.library.get(cue)) begin();
    else void this.library.request(cue).then(begin);
    return () => {
      if (state.stopped) return;
      state.stopped = true;
      this.loops.delete(state);
      const { source, gain, nodes } = state;
      if (!source || !gain) return;
      const now = this.ctx.currentTime;
      const fadeOut = Math.max(0.02, spec.fadeOut ?? 0.3);
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(0, now + fadeOut);
      source.stop(now + fadeOut + 0.02);
      source.onended = () => nodes.forEach((n) => n.disconnect());
    };
  }

  /**
   * A loop that can be steered while it plays (see LoopControl): the same
   * voice as ``loop`` (fades, a random start inside the loop, the air's
   * low-pass for its distance) with its rate, level, pan and distance left
   * open to change. It is not slowed by slow motion: a steered loop is the
   * game's instrument, and the game sets its pitch itself.
   */
  controlledLoop(cue: string, options: CueOptions = {}): LoopControl {
    const spec = this.spec(cue);
    if (!spec || this.closed) return { set: () => {}, stop: () => {} };
    let stopped = false;
    const params: Required<LoopParams> = {
      rate: options.rate ?? 1,
      volume: Math.max(0, options.volume ?? 1),
      pan: clamp(options.pan ?? 0, -1, 1),
      distance: Math.max(0, options.distance ?? 0),
    };
    /** What the playing nodes were last told, so a set that changes nothing schedules nothing. */
    const applied = { rate: Number.NaN, level: Number.NaN, pan: Number.NaN, distance: Number.NaN };
    let live: { src: AudioBufferSourceNode; gain: GainNode; pan: StereoPannerNode; air: BiquadFilterNode; nodes: AudioNode[] } | null = null;
    const target = (): number => db(spec.level) * params.volume * distanceGain(params.distance);
    const begin = (): void => {
      if (stopped || this.closed) return;
      const takes = this.library.get(cue);
      if (!takes) return;
      const k = pickTake(takes.length, this.lastTake.get(cue) ?? -1, Math.random());
      this.lastTake.set(cue, k);
      const take = takes[k]!;
      const ctx = this.ctx;
      const now = ctx.currentTime;
      const src = ctx.createBufferSource();
      src.buffer = take.buffer;
      src.loop = true;
      src.playbackRate.value = clamp(params.rate, 0.1, 8);
      const air = ctx.createBiquadFilter();
      air.type = "lowpass";
      air.frequency.value = airCutoff(params.distance);
      air.Q.value = 0.5;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(target(), now + Math.max(0.01, spec.fadeIn ?? 0.1));
      const pan = ctx.createStereoPanner();
      pan.pan.value = params.pan;
      src.connect(air).connect(gain).connect(pan).connect(this.buses[spec.bus]);
      src.start(now + Math.max(0, options.delay ?? 0), Math.random() * take.buffer.duration);
      live = { src, gain, pan, air, nodes: [src, air, gain, pan] };
      applied.rate = clamp(params.rate, 0.1, 8);
      applied.level = target();
      applied.pan = params.pan;
      applied.distance = params.distance;
    };
    if (this.library.get(cue)) begin();
    else void this.library.request(cue).then(begin);
    return {
      set: (next, glide = 0.06) => {
        // Field by field, allocating nothing, and only what changed goes to
        // the nodes: a race steers a couple of dozen of these every frame.
        if (Number.isFinite(next.rate)) params.rate = next.rate as number;
        if (Number.isFinite(next.volume)) params.volume = Math.max(0, next.volume as number);
        if (Number.isFinite(next.pan)) params.pan = clamp(next.pan as number, -1, 1);
        if (Number.isFinite(next.distance)) params.distance = Math.max(0, next.distance as number);
        if (!live || stopped) return;
        const now = this.ctx.currentTime;
        const tau = Math.max(0.005, glide / 3);
        const rate = clamp(params.rate, 0.1, 8);
        const level = target();
        if (rate !== applied.rate) live.src.playbackRate.setTargetAtTime((applied.rate = rate), now, tau);
        if (level !== applied.level) live.gain.gain.setTargetAtTime((applied.level = level), now, tau);
        if (params.pan !== applied.pan) live.pan.pan.setTargetAtTime((applied.pan = params.pan), now, tau);
        if (params.distance !== applied.distance) live.air.frequency.setTargetAtTime(airCutoff((applied.distance = params.distance)), now, tau);
      },
      stop: () => {
        if (stopped) return;
        stopped = true;
        if (!live) return;
        const { src, gain, nodes } = live;
        const now = this.ctx.currentTime;
        const fadeOut = Math.max(0.02, spec.fadeOut ?? 0.15);
        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(gain.gain.value, now);
        gain.gain.linearRampToValueAtTime(0, now + fadeOut);
        src.stop(now + fadeOut + 0.02);
        src.onended = () => nodes.forEach((n) => n.disconnect());
        live = null;
      },
    };
  }

  /**
   * The bus for a game's own long pieces (rendered music). It joins the
   * master like the interface does, past the muffle and the duck: being
   * hurt in one game must not dull another's score, and the volume slider,
   * mute and the limiter all still apply.
   */
  musicBus(): AudioNode {
    if (!this.music) {
      this.music = this.ctx.createGain();
      this.music.gain.value = 1;
      this.music.connect(this.master);
    }
    return this.music;
  }

  setFilter(name: "hurt" | "slowmo", amount: number): void {
    if (this.closed) return;
    const x = clamp(amount, 0, 1);
    if (name === "hurt") {
      this.hurt = x;
    } else if (name === "slowmo") {
      const before = this.slowmo;
      this.slowmo = x;
      if (slowmoEngaged(before, x)) this.playInternal("slowmo_boom", {}, true);
    } else {
      this.warnOnce(`filter:${String(name)}`, `Handheld audio: no filter named "${String(name)}"`);
      return;
    }
    this.applyFilters();
  }

  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    this.stopHeart();
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.onVisibility);
      for (const type of ["pointerdown", "keydown", "touchend"]) window.removeEventListener(type, this.wake, { capture: true });
      window.removeEventListener("pageshow", this.wake);
    }
    this.library.dispose();
    void this.ctx.close().catch(() => {});
  }

  // --- internals -------------------------------------------------------------------------

  private spec(cue: string): CueSpec | undefined {
    const spec = Object.prototype.hasOwnProperty.call(CUES, cue) ? CUES[cue] : undefined;
    if (!spec) this.warnOnce(cue, `Handheld audio: no sound named "${cue}"`);
    return spec;
  }

  private warnOnce(key: string, message: string): void {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    console.warn(message);
  }

  private resumeIfWanted(): void {
    if (this.closed || this._muted) return;
    if (typeof document !== "undefined" && document.hidden) return;
    if (this.ctx.state !== "running") void this.ctx.resume().catch(() => {});
  }

  private playInternal(cue: string, o: CueOptions, exemptFromSlowmo: boolean): void {
    const spec = this.spec(cue);
    if (!spec || this.closed || this._muted) return;
    // A hidden tab's context is suspended: a sound queued now would burst out on return.
    if (typeof document !== "undefined" && document.hidden) return;
    let takes = this.library.get(cue);
    if (!takes) {
      // Not synthesised yet. A shot, a hit, anything short or vital is made
      // on the spot (5-15 ms: a frame, once, beats a missing gunshot); a
      // long garnish is fetched and played if it arrives soon enough.
      if (!spec.loop && (spec.expect[1] <= 2 || (spec.priority ?? 1) >= 3)) {
        const one = this.library.renderNow(cue);
        takes = one ? [one] : undefined;
      }
      if (!takes) {
        // Lateness by the wall clock: the audio clock stands still while
        // the context is suspended, and a sound asked for then is stale.
        const asked = performance.now();
        void this.library.request(cue).then(() => {
          const late = (performance.now() - asked) / 1000;
          if (late < 0.35) this.playInternal(cue, { ...o, delay: Math.max(0, (o.delay ?? 0) - late) }, exemptFromSlowmo);
        });
        return;
      }
    }
    this.startVoice(cue, spec, takes, o, exemptFromSlowmo);
  }

  private startVoice(cue: string, spec: CueSpec, takes: LoadedTake[], o: CueOptions, exemptFromSlowmo: boolean): void {
    // Slow motion slows the world, not the interface, and not the sounds
    // made to accompany it (the death, the boom), which would sink below
    // what a laptop can play.
    const exempt = exemptFromSlowmo || !!spec.steady || spec.bus === "ui";
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const d = Math.max(0, o.distance ?? 0);
    const when = now + Math.max(0, o.delay ?? 0) + (spec.travel ? travelTime(d) : 0);
    // Two of the same sound in one frame are one sound (and +6 dB of it).
    const last = this.lastStart.get(cue);
    if (spec.minGap && last !== undefined && Math.abs(when - last) < spec.minGap) return;

    this.voices = this.voices.filter((v) => v.endsAt > now);
    const priority = spec.priority ?? 1;
    const { steal, drop } = admit(this.voices, { cue, priority }, now, MAX_VOICES, spec.maxInstances ?? 8);
    for (const id of steal) this.release(id, now);
    if (drop) return;

    const k = pickTake(takes.length, this.lastTake.get(cue) ?? -1, Math.random());
    const take = takes[k]!;
    this.lastTake.set(cue, k);
    this.lastStart.set(cue, when);

    const volume = Math.max(0, o.volume ?? 1);
    const varyDb = (spec.varyGain ?? 1) * (2 * Math.random() - 1);
    const level = db(spec.level + varyDb) * volume;
    const baseRate = clamp(variedRate(o.rate ?? 1, spec.vary ?? 0.03, Math.random()), 0.25, 4);
    const rate = baseRate * (exempt ? 1 : this.rate);
    const pan = clamp(o.pan ?? 0, -1, 1);

    const out = ctx.createGain();
    out.connect(this.buses[spec.bus]);
    const nodes: AudioNode[] = [out];
    const sources: AudioBufferSourceNode[] = [];

    // The direct sound: source → air → level → pan.
    const src = ctx.createBufferSource();
    src.buffer = take.buffer;
    src.playbackRate.value = rate;
    let head: AudioNode = src;
    nodes.push(src);
    const cutoff = airCutoff(d);
    if (cutoff < 19000) {
      const air = ctx.createBiquadFilter();
      air.type = "lowpass";
      air.frequency.value = cutoff;
      air.Q.value = 0.5;
      head = head.connect(air);
      nodes.push(air);
    }
    const gain = ctx.createGain();
    // Feedback is held to the level it has near by; the air and the walls still say how far.
    const loudness = distanceGain(spec.feedback ? Math.min(d, spec.feedback) : d);
    gain.gain.value = level * loudness;
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    head.connect(gain).connect(panner).connect(out);
    nodes.push(gain, panner);
    sources.push(src);

    // The reverb send, taken before distance attenuation (far is wetter).
    if (spec.reverb) {
      const send = ctx.createGain();
      send.gain.value = level * reverbSend(spec.reverb, d);
      head.connect(send).connect(this.reverbIn);
      nodes.push(send);
    }

    // The street's echoes: the same take again, later, darker, from the walls.
    let tail = 0;
    if (spec.echo) {
      for (const tap of echoTaps(d, pan, this.space)) {
        const echo = ctx.createBufferSource();
        echo.buffer = take.buffer;
        echo.playbackRate.value = rate;
        const lp = ctx.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.value = tap.cutoff;
        lp.Q.value = 0.5;
        const g = ctx.createGain();
        g.gain.value = level * spec.echo * tap.gain;
        const p = ctx.createStereoPanner();
        p.pan.value = tap.pan;
        echo.connect(lp).connect(g).connect(p).connect(out);
        echo.start(when + tap.delay);
        nodes.push(echo, lp, g, p);
        sources.push(echo);
        tail = Math.max(tail, tap.delay);
      }
    }
    src.start(when);

    const duration = take.buffer.duration;
    const voice: Voice = {
      id: this.nextId++,
      cue,
      priority,
      start: when,
      gain: level * loudness,
      playbackRate: rate,
      envelope: take.envelope,
      block: ENVELOPE_BLOCK,
      duration,
      exempt,
      sources,
      rates: sources.map(() => baseRate),
      nodes,
      out,
      endsAt: when + tail + duration / rate + 0.05,
    };
    let live = sources.length;
    for (const s of sources) {
      s.onended = () => {
        if (--live === 0) {
          for (const n of nodes) n.disconnect();
          this.voices = this.voices.filter((v) => v !== voice);
        }
      };
    }
    this.voices.push(voice);
  }

  /** Fade a voice out fast and let it go (stolen for a newer sound). */
  private release(id: number, now: number): void {
    const voice = this.voices.find((v) => v.id === id);
    if (!voice) return;
    this.voices = this.voices.filter((v) => v !== voice);
    voice.out.gain.cancelScheduledValues(now);
    voice.out.gain.setValueAtTime(voice.out.gain.value, now);
    voice.out.gain.setTargetAtTime(0, now, 0.015);
    for (const s of voice.sources) {
      try {
        s.stop(now + 0.1);
      } catch {
        // Already stopped.
      }
    }
  }

  private applyFilters(): void {
    const now = this.ctx.currentTime;
    const h = hurtMix(this.hurt);
    const s = slowmoMix(this.slowmo);
    this.muffle.frequency.setTargetAtTime(Math.min(h.cutoff, s.cutoff), now, 0.06);
    this.muffle.Q.setTargetAtTime(h.q, now, 0.06);
    this.duck.gain.setTargetAtTime(h.duck, now, 0.08);
    this.reverbReturn.gain.setTargetAtTime(REVERB_RETURN * s.reverb, now, 0.2);
    if (Math.abs(s.rate - this.rate) > 1e-4) {
      const stretch = this.rate / s.rate;
      this.rate = s.rate;
      for (const v of this.voices) {
        if (v.exempt) continue;
        // What is left of it now plays slower (or faster), so it ends later (or sooner).
        if (v.endsAt > now) v.endsAt = now + (v.endsAt - now) * stretch;
        v.playbackRate /= stretch;
        v.sources.forEach((src, k) => src.playbackRate.setTargetAtTime(v.rates[k]! * this.rate, now, 0.12));
      }
      for (const loop of this.loops) {
        if (!this.steadyLoops.has(loop)) loop.source?.playbackRate.setTargetAtTime(loop.baseRate * this.rate, now, 0.12);
      }
    }
    if (h.beatGain > 0 && !this._muted) this.startHeart();
  }

  /**
   * The hurt heartbeat. Beats are scheduled one by one a little ahead of
   * time (not a looping buffer), so the tempo follows the damage without
   * the pitch following it too.
   */
  private startHeart(): void {
    if (this.beatTimer !== null) return;
    this.nextBeat = 0;
    this.beatTimer = setInterval(() => this.tickHeart(), 50);
    this.tickHeart();
  }

  private stopHeart(): void {
    if (this.beatTimer !== null) clearInterval(this.beatTimer);
    this.beatTimer = null;
  }

  private tickHeart(): void {
    const h = hurtMix(this.hurt);
    if (h.beatGain <= 0 || this._muted || this.closed) {
      this.stopHeart();
      return;
    }
    const takes = this.library.get("heartbeat_beat");
    if (!takes) {
      void this.library.request("heartbeat_beat");
      return;
    }
    const now = this.ctx.currentTime;
    if (this.nextBeat < now) this.nextBeat = now + 0.03;
    const spec = CUES["heartbeat_beat"]!;
    while (this.nextBeat < now + 0.2) {
      const take = takes[pickTake(takes.length, this.lastTake.get("heartbeat_beat") ?? -1, Math.random())]!;
      const src = this.ctx.createBufferSource();
      src.buffer = take.buffer;
      // Its pitch stays put in slow motion (a slowed heartbeat is below what
      // small speakers can play); its tempo slows instead.
      src.playbackRate.value = h.beatRate;
      const g = this.ctx.createGain();
      g.gain.value = db(spec.level) * h.beatGain;
      src.connect(g).connect(this.buses.self);
      src.onended = () => {
        src.disconnect();
        g.disconnect();
      };
      src.start(this.nextBeat);
      this.nextBeat += 60 / h.bpm / this.rate;
    }
  }
}

/** Linear to 0.9, then a tanh knee that approaches (never reaches) 1. */
function softClipCurve(): Float32Array<ArrayBuffer> {
  const n = 2048;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (2 * i) / (n - 1) - 1;
    const m = Math.abs(x);
    const y = m <= 0.9 ? m : 0.9 + 0.1 * Math.tanh((m - 0.9) / 0.1);
    curve[i] = Math.sign(x) * y;
  }
  return curve;
}
