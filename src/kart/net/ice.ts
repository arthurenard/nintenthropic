/**
 * The ICE servers a room's connections are made with: whatever the site's
 * api/ice.json hands out (STUN, and a relay login when the site has a TURN
 * key: see api/ice.ts), asked once a page and kept for half the login's life.
 *
 * When it cannot be had (a dev server, which has no api/; a page offline; an
 * answer slower than four seconds) it is STUN alone, which still connects
 * devices that can reach each other directly, as on one Wi-Fi. A failure is
 * not kept: the next room asks again.
 */
import type { IceAnswer } from "../../../api/ice";

export const STUN = "stun:stun.l.google.com:19302";
/** STUN alone: what a room uses without the site's answer. */
export const DIRECT: RTCIceServer[] = [{ urls: STUN }];
const WAIT_MS = 4000;

export interface IceOptions {
  fetch?: typeof fetch;
  /** The clock, milliseconds since the epoch. */
  now?: () => number;
  /** Where to ask; api/ice.json next to the page by default. */
  url?: string;
}

let kept: { servers: RTCIceServer[]; until: number } | null = null;
/** Whether the last servers had a relay among them. */
let relayed = false;
let asking: Promise<RTCIceServer[]> | null = null;

/** Forgets what was kept (for the tests). */
export function forgetIce(): void {
  kept = null;
  asking = null;
  relayed = false;
}

/** True when this page's rooms connect with a relay, so players need not share a network (the screens say which). */
export function relayReady(): boolean {
  return relayed;
}

/** The answer's servers, if it is one: each with STUN or TURN addresses, and a login only as text. */
export function readAnswer(body: unknown): { servers: RTCIceServer[]; ttl: number } | null {
  const answer = body as Partial<IceAnswer> | null;
  if (!Array.isArray(answer?.iceServers) || typeof answer.ttl !== "number" || !(answer.ttl > 0)) return null;
  const servers: RTCIceServer[] = [];
  for (const entry of answer.iceServers as unknown[]) {
    const e = entry as Partial<RTCIceServer> | null;
    const urls = typeof e?.urls === "string" ? [e.urls] : Array.isArray(e?.urls) ? e.urls : [];
    if (urls.length === 0 || !urls.every((u) => typeof u === "string" && /^(stun|turns?):/.test(u))) return null;
    if (e?.username !== undefined && typeof e.username !== "string") return null;
    if (e?.credential !== undefined && typeof e.credential !== "string") return null;
    const server: RTCIceServer = { urls };
    if (e?.username !== undefined) server.username = e.username;
    if (e?.credential !== undefined) server.credential = e.credential;
    servers.push(server);
  }
  return servers.length > 0 ? { servers, ttl: answer.ttl } : null;
}

function defaultUrl(): string | null {
  return typeof document === "undefined" ? null : new URL("api/ice.json", document.baseURI).href;
}

async function ask(options: IceOptions): Promise<RTCIceServer[]> {
  const url = options.url ?? defaultUrl();
  const fetcher = options.fetch ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  relayed = false;
  if (!url || !fetcher) return DIRECT;
  try {
    // A POST, so the browser says which page is asking (api/ice.ts answers only the game's own).
    const reply = await fetcher(url, { method: "POST", signal: AbortSignal.timeout(WAIT_MS) });
    const read = reply.ok ? readAnswer(await reply.json()) : null;
    if (!read) return DIRECT;
    kept = { servers: read.servers, until: now() + (read.ttl * 1000) / 2 };
    relayed = read.servers.some((s) => [s.urls].flat().some((u) => u.startsWith("turn")));
    return read.servers;
  } catch {
    return DIRECT;
  }
}

/** The servers to connect with (never throws; STUN alone at worst). */
export function iceServers(options: IceOptions = {}): Promise<RTCIceServer[]> {
  const now = options.now ?? Date.now;
  if (kept && now() < kept.until) return Promise.resolve(kept.servers);
  asking ??= ask(options).finally(() => (asking = null));
  return asking;
}

/** True when the page was opened with `?relay=only`: connect through the relay or not at all (to try the relay). */
export function relayOnlyFromUrl(): boolean {
  return typeof location !== "undefined" && new URLSearchParams(location.search).get("relay") === "only";
}
