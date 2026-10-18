import { Vector3, type PerspectiveCamera } from "three";
import type { AudioBus, CueOptions } from "../types";
import type { V3 } from "../rules/raymath";

const local = new Vector3();

interface LoopEntry {
  cue: string;
  options: CueOptions;
  stop: (() => void) | null;
}

/**
 * The game's side of the AudioBus: cues placed in the world (pan and
 * distance worked out from the camera), and loops that survive a pause —
 * they are stopped while paused and started again on resume.
 */
export class Sound {
  private readonly loops = new Map<string, LoopEntry>();
  private paused = false;
  /** How hurt the player is, as last set: restored on resume. */
  private hurt = 0;

  constructor(
    private readonly bus: AudioBus,
    private readonly camera: PerspectiveCamera,
  ) {}

  play(cue: string, options?: CueOptions): void {
    this.bus.play(cue, options);
  }

  /** A cue from a point in the world. */
  at(cue: string, pos: V3, volume = 1, rate = 1, delay = 0): void {
    this.bus.play(cue, this.place(pos, { volume, rate, delay }));
  }

  /** Fill pan and distance for a sound at `pos`. */
  place(pos: V3, options: CueOptions): CueOptions {
    local.set(pos.x, pos.y, pos.z);
    this.camera.worldToLocal(local);
    const horiz = Math.hypot(local.x, local.z);
    options.pan = horiz > 1e-3 ? Math.max(-1, Math.min(1, local.x / horiz)) : 0;
    options.distance = local.length();
    return options;
  }

  /** Start (or keep) a named loop. */
  loop(key: string, cue: string, options: CueOptions = {}): void {
    if (this.loops.has(key)) return;
    const entry: LoopEntry = { cue, options, stop: null };
    if (!this.paused) entry.stop = this.bus.loop(cue, options);
    this.loops.set(key, entry);
  }

  loopAt(key: string, cue: string, pos: V3, volume = 1): void {
    if (this.loops.has(key)) return;
    this.loop(key, cue, this.place(pos, { volume }));
  }

  stopLoop(key: string): void {
    const entry = this.loops.get(key);
    if (!entry) return;
    entry.stop?.();
    this.loops.delete(key);
  }

  hasLoop(key: string): boolean {
    return this.loops.has(key);
  }

  pause(): void {
    if (this.paused) return;
    this.paused = true;
    for (const e of this.loops.values()) {
      e.stop?.();
      e.stop = null;
    }
    // A far shot still on its way, an echo still to come back: the world
    // has stopped, and what it was about to say goes with it.
    this.bus.hush?.();
    // Being hurt brings a heartbeat and a muffle with it; a paused game is
    // not being hurt, so neither carries on over the pause menu.
    this.bus.setFilter("hurt", 0);
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    for (const e of this.loops.values()) e.stop = this.bus.loop(e.cue, e.options);
    this.bus.setFilter("hurt", this.hurt);
  }

  filter(name: "hurt" | "slowmo", amount: number): void {
    if (name === "hurt") {
      this.hurt = amount;
      if (this.paused) return; // taken up again on resume
    }
    this.bus.setFilter(name, amount);
  }

  stopAll(): void {
    for (const e of this.loops.values()) e.stop?.();
    this.loops.clear();
  }
}
