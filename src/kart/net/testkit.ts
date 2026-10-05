/**
 * Test scaffolding: a whole room in one process. A `World` owns a pretend
 * network and a clock, makes sessions on them, and `run`s frames at 60 Hz,
 * each session getting its `frame(now)` once per frame like a browser's
 * animation loop would. Nothing here uses a real timer.
 */
import {
  IDLE_INPUT,
  type DriveInput,
  type DriverControl,
  type LocalPlayerSetup,
  type RaceView,
  type Session,
} from "../contract";
import { createFakeRace } from "./fakeRace";
import { hostSession } from "./host";
import { joinSession } from "./guest";
import { MemoryNetwork, type Conditions } from "./memory";
import type { NetOptions } from "./options";
import { soloSession } from "./solo";
import { seeded } from "./util";

/** A control that gives whatever `fn` says at each sample. */
export function scripted(fn: (now: number, n: number) => Partial<DriveInput>, kind: DriverControl["kind"] = "keyboard"): DriverControl & {
  samples: number;
} {
  const control = {
    kind,
    wheel: null,
    samples: 0,
    sample(now: number): DriveInput {
      return { ...IDLE_INPUT, ...fn(now, control.samples++) };
    },
    dispose() {},
  };
  return control;
}

/** Holds the throttle down and the wheel straight: a driver who just drives. */
export const straight = () => scripted(() => ({ throttle: 1 }));

export function player(name: string, control: DriverControl = straight(), screen: "here" | "host" = "here"): LocalPlayerSetup {
  return { name, control, screen };
}

// Node has it; the browser type definitions this project compiles against do not.
declare const setImmediate: (run: () => void) => unknown;

/** Lets promises settle: connects resolve in microtasks after the network's clock moves. */
export async function settle(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

/** The kart a named player drives in the race being run, from a session's lobby. */
export function kartOf(session: Session, name: string): number {
  const lobby = session.lobby();
  const slot = lobby.players.find((p) => p.name === name)?.slot;
  const kart = Object.entries(lobby.karts).find(([, s]) => s === slot)?.[0];
  if (kart === undefined) throw new Error(`no kart for ${name}`);
  return Number(kart);
}

export class World {
  readonly net: MemoryNetwork;
  /** The shared clock, milliseconds. */
  now = 1000;
  readonly sessions: Session[] = [];
  /** Every view each session returned, in order (set `keep` to false to skip). */
  readonly views = new Map<Session, RaceView[]>();
  keep = true;
  private seed = 100;

  constructor(conditions: Partial<Conditions> = {}, seed = 7) {
    this.net = new MemoryNetwork({ conditions, seed });
  }

  options(extra: Partial<NetOptions> = {}): NetOptions {
    const random = seeded(this.seed++);
    return {
      createRace: createFakeRace,
      transport: () => this.net.transport(),
      now: () => this.now,
      random,
      schedule: () => () => {},
      resultsDelay: 0,
      ...extra,
    };
  }

  private add<T extends Session>(session: T): T {
    this.sessions.push(session);
    this.views.set(session, []);
    return session;
  }

  host(extra: Partial<NetOptions> = {}): Session {
    return this.add(hostSession(this.options(extra)));
  }

  guest(code: string, extra: Partial<NetOptions> = {}): Session {
    return this.add(joinSession(code, this.options(extra)));
  }

  solo(extra: Partial<NetOptions> = {}): Session {
    return this.add(soloSession(this.options(extra)));
  }

  /** Runs `seconds` of frames at 60 Hz; `each` is called after every frame. */
  async run(seconds: number, each?: (world: World) => void): Promise<void> {
    const frame = 1000 / 60;
    const frames = Math.round((seconds * 1000) / frame);
    for (let i = 0; i < frames; i++) {
      this.now += frame;
      this.net.advance(frame);
      await settle();
      for (const session of this.sessions) {
        const view = session.frame(this.now);
        if (view && this.keep) this.views.get(session)!.push(view);
      }
      each?.(this);
    }
  }

  /** Runs until `done()` (checked every frame) or `limit` seconds have passed; returns whether it was done. */
  async until(done: () => boolean, limit = 60): Promise<boolean> {
    const frame = 1000 / 60;
    for (let i = 0; i < Math.round((limit * 1000) / frame); i++) {
      if (done()) return true;
      await this.run(1 / 60);
    }
    return done();
  }

  /** The last view a session returned. */
  last(session: Session): RaceView | undefined {
    return this.views.get(session)?.at(-1);
  }
}
