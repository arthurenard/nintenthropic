/**
 * What a session is built from. Everything outside the pure logic is injected
 * (the sim, the transport, the clock, the dice, the timer), so the tests run a
 * whole room in one process, on a clock they move by hand.
 */
import type { CreateRace, DriveInput } from "../contract";
import { localTransport } from "./local";
import { peerTransport } from "./peer";
import type { Transport, TransportFactory } from "./transport";

export interface NetOptions {
  /** The sim: sim/race.ts's `createRace`. */
  createRace: CreateRace;
  /** Makes the transport; `defaultTransport` (PeerJS, or BroadcastChannel with `?net=local`) if left out. */
  transport?: TransportFactory;
  /** The clock, milliseconds (`performance.now`, which is what `requestAnimationFrame` hands `frame`). */
  now?: () => number;
  /** Dice, 0..1 (`Math.random`): room codes, seeds, device ids. */
  random?: () => number;
  /**
   * Runs `run` every `ms` until the returned function is called. The session
   * uses it for the work that must go on when no frames come (a hidden tab,
   * the lobby); the default is `setInterval`.
   */
  schedule?: (run: () => void, ms: number) => () => void;
  /** How many players this device brings to begin with, 1 or 2 (their seats are held at once). Default 1. */
  players?: 1 | 2;
  /** This device's id (a random one if left out). */
  device?: string;
  /** Host: seconds of race to keep running after it is decided, so the finish is seen, before the results. Default 3. */
  resultsDelay?: number;
  /** Host: called for every guest input the host applies (a debugging aid). */
  onApply?: (kart: number, seq: number, input: DriveInput) => void;
}

/** PeerJS, or BroadcastChannel when the page was opened with `?net=local`. */
export function defaultTransport(): Transport {
  const net = typeof location !== "undefined" ? new URLSearchParams(location.search).get("net") : null;
  return net === "local" ? localTransport() : peerTransport();
}

export interface Settled {
  createRace: CreateRace;
  transport: TransportFactory;
  now: () => number;
  random: () => number;
  schedule: (run: () => void, ms: number) => () => void;
  players: 1 | 2;
  device: string | undefined;
  resultsDelay: number;
  onApply: ((kart: number, seq: number, input: DriveInput) => void) | undefined;
}

export function settle(options: NetOptions): Settled {
  return {
    createRace: options.createRace,
    transport: options.transport ?? defaultTransport,
    now: options.now ?? (() => performance.now()),
    random: options.random ?? Math.random,
    schedule:
      options.schedule ??
      ((run, ms) => {
        const id = setInterval(run, ms);
        return () => clearInterval(id);
      }),
    players: options.players === 2 ? 2 : 1,
    device: options.device,
    resultsDelay: options.resultsDelay ?? 3,
    onApply: options.onApply,
  };
}

/** True when the tab is in the background and the browser has stopped sending animation frames. */
export function pageHidden(): boolean {
  return typeof document !== "undefined" && document.hidden === true;
}
