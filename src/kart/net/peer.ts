/**
 * The real transport: WebRTC data channels, introduced to each other by a
 * PeerJS broker (PeerJS's public one unless `VITE_PEER_*` names another).
 *
 * The host registers under `grip-prix-v1-<CODE>`. A guest opens two
 * PeerJS data connections to it, one per channel of a `Link`:
 *
 *   "r"  reliable, ordered
 *   "u"  unordered (`reliable: false`)
 *
 * PeerJS has no lossy mode: its "unreliable" connection only drops the
 * ordering, so a lost packet is still resent and the rest wait behind it only
 * on the reliable one. That already keeps snapshots from queueing behind lobby
 * chatter. To keep a bad line from piling stale snapshots up, a send is
 * skipped when that channel already has more than 32 KB waiting.
 *
 * PeerJS is imported when a room is first hosted or joined, so a practice
 * race (which never gets here) never downloads it.
 *
 * Not exercised against a live broker by the tests: peer.test.ts drives it
 * with a stand-in `Peer`. Try it for real with src/kart/net/dev.html.
 */
import type { DataConnection, Peer, PeerJSOption } from "peerjs";
import { peerIdFor } from "./codes";
import { LinkBase, TransportError, type Channel, type Link, type Transport } from "./transport";
import { Emitter, seeded, token } from "./util";

/** The slice of PeerJS this file uses, so a test can stand in for it. */
export interface PeerModule {
  Peer: new (id?: string, options?: PeerJSOption) => Peer;
}

export interface PeerOptions {
  /** Loads PeerJS (a dynamic import by default; a test passes a stand-in). */
  load?: () => Promise<PeerModule>;
  /** Overrides for the broker; `VITE_PEER_*` fill in what is left. */
  broker?: { host?: string; port?: number; path?: string; key?: string; secure?: boolean };
  /** How long to wait for a connection to open, milliseconds. */
  timeout?: number;
}

export const STUN = "stun:stun.l.google.com:19302";
const BACKLOG = 32 * 1024;

/** The broker settings from the environment (Vite's `import.meta.env`), only what is set. */
export function brokerFromEnv(): NonNullable<PeerOptions["broker"]> {
  const env = (import.meta as { env?: Record<string, string | undefined> }).env ?? {};
  const out: NonNullable<PeerOptions["broker"]> = {};
  if (env.VITE_PEER_HOST) out.host = env.VITE_PEER_HOST;
  if (env.VITE_PEER_PORT) out.port = Number(env.VITE_PEER_PORT);
  if (env.VITE_PEER_PATH) out.path = env.VITE_PEER_PATH;
  if (env.VITE_PEER_KEY) out.key = env.VITE_PEER_KEY;
  if (env.VITE_PEER_SECURE) out.secure = env.VITE_PEER_SECURE !== "0" && env.VITE_PEER_SECURE !== "false";
  return out;
}

/** A PeerJS error as the net reports it: not-found and network are the two a player can act on. */
function failure(error: { type?: string; message?: string }, fallback: "network" | "taken" = "network"): TransportError {
  switch (error.type) {
    case "peer-unavailable":
      return new TransportError("not-found", "There is no race with that code.");
    case "unavailable-id":
      return new TransportError("taken", "That room code is already in use.");
    default:
      return new TransportError(fallback, error.message ?? "Could not reach the signalling server.");
  }
}

interface Pairing {
  r?: DataConnection;
  u?: DataConnection;
  timer: ReturnType<typeof setTimeout>;
}

class PeerLink extends LinkBase {
  constructor(
    peer: string,
    private r: DataConnection,
    private u: DataConnection,
  ) {
    super(peer);
    for (const conn of [r, u]) {
      conn.on("data", (data: unknown) => {
        if (typeof data === "string") this.deliver(conn === r ? "reliable" : "unreliable", data);
      });
      conn.on("close", () => {
        this.finish({ reason: "closed" });
        this.drop();
      });
      conn.on("error", (error: Error) => {
        this.finish({ reason: "error", message: error.message });
        this.drop();
      });
    }
  }

  send(channel: Channel, data: string): void {
    if (!this.open) return;
    const conn = channel === "reliable" ? this.r : this.u;
    if (!conn.open) return;
    if (channel === "unreliable" && (conn.dataChannel?.bufferedAmount ?? 0) > BACKLOG) return;
    try {
      void conn.send(data);
    } catch {
      /* the channel closed under us: its close event will say so */
    }
  }

  protected hangUp(): void {
    this.drop();
  }

  private drop(): void {
    // `flush` lets a "leave" just sent go out before the channel shuts.
    for (const conn of [this.r, this.u]) {
      try {
        conn.close({ flush: true });
      } catch {
        /* already closed */
      }
    }
  }
}

export function peerTransport(options: PeerOptions = {}): Transport {
  return new PeerTransport(options);
}

class PeerTransport implements Transport {
  private incoming = new Emitter<Link>();
  private errors = new Emitter<TransportError>();
  private peer: Peer | null = null;
  private pairing = new Map<string, Pairing>();
  private links = new Set<PeerLink>();
  private closed = false;
  private timeout: number;

  constructor(private options: PeerOptions) {
    this.timeout = options.timeout ?? 15000;
  }

  private async make(id: string | undefined): Promise<Peer> {
    const load = this.options.load ?? (() => import("peerjs") as unknown as Promise<PeerModule>);
    let module: PeerModule;
    try {
      module = await load();
    } catch {
      throw new TransportError("network", "Could not load the networking code. Check your connection.");
    }
    const broker = { ...brokerFromEnv(), ...this.options.broker };
    const settings: PeerJSOption = { ...broker, debug: 0, config: { iceServers: [{ urls: STUN }] } };
    return new module.Peer(id, settings);
  }

  async listen(code: string): Promise<void> {
    const peer = await this.make(peerIdFor(code));
    if (this.closed) {
      peer.destroy();
      throw new TransportError("network", "The transport is closed.");
    }
    this.peer = peer;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new TransportError("network", "The signalling server did not answer.")),
        this.timeout,
      );
      peer.on("open", () => {
        clearTimeout(timer);
        resolve();
      });
      peer.on("error", (error) => {
        clearTimeout(timer);
        const e = failure(error);
        // Before it opened, any error means we do not hold the room.
        if (!peer.open) {
          peer.destroy();
          reject(e);
        } else this.errors.emit(e);
      });
    });
    peer.on("connection", (conn) => this.accept(conn));
    peer.on("disconnected", () => this.errors.emit(new TransportError("network", "Lost the signalling server.")));
  }

  /** A guest's connection arrives: wait for its twin, then the link is ready. */
  private accept(conn: DataConnection): void {
    const meta = conn.metadata as { link?: unknown; ch?: unknown } | null | undefined;
    if (!meta || typeof meta.link !== "string" || (meta.ch !== "r" && meta.ch !== "u")) {
      conn.close();
      return;
    }
    const key = `${conn.peer}/${meta.link}`;
    let pairing = this.pairing.get(key);
    if (!pairing) {
      const timer = setTimeout(() => {
        const half = this.pairing.get(key);
        this.pairing.delete(key);
        half?.r?.close();
        half?.u?.close();
      }, this.timeout);
      pairing = { timer };
      this.pairing.set(key, pairing);
    }
    const held = pairing;
    const channel = meta.ch;
    conn.on("open", () => {
      held[channel] = conn;
      if (held.r?.open && held.u?.open) {
        clearTimeout(held.timer);
        this.pairing.delete(key);
        const link = new PeerLink(conn.peer, held.r, held.u);
        this.links.add(link);
        this.incoming.emit(link);
      }
    });
  }

  async connect(code: string): Promise<Link> {
    const peer = await this.make(undefined);
    if (this.closed) {
      peer.destroy();
      throw new TransportError("network", "The transport is closed.");
    }
    this.peer = peer;
    const host = peerIdFor(code);
    const linkId = token(seeded(Math.floor(Math.random() * 2 ** 32)), 10);
    return new Promise<Link>((resolve, reject) => {
      let settled = false;
      const fail = (error: TransportError) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        peer.destroy();
        reject(error);
      };
      const timer = setTimeout(() => fail(new TransportError("network", "The race did not answer.")), this.timeout);
      // Errors for the room (not found) and for the broker both arrive on the peer.
      peer.on("error", (error) => fail(failure(error)));
      peer.on("open", () => {
        const open = (ch: "r" | "u") =>
          peer.connect(host, {
            serialization: "raw",
            reliable: ch === "r",
            label: ch,
            metadata: { link: linkId, ch },
          });
        const r = open("r");
        const u = open("u");
        let ready = 0;
        const check = () => {
          if (++ready < 2 || settled) return;
          settled = true;
          clearTimeout(timer);
          const link = new PeerLink(host, r, u);
          this.links.add(link);
          resolve(link);
        };
        r.on("open", check);
        u.on("open", check);
        r.on("error", (error) => fail(failure(error)));
        u.on("error", (error) => fail(failure(error)));
      });
    });
  }

  onIncoming(listener: (link: Link) => void): void {
    this.incoming.add(listener);
  }

  onError(listener: (error: TransportError) => void): void {
    this.errors.add(listener);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const link of this.links) link.close();
    this.links.clear();
    for (const half of this.pairing.values()) {
      clearTimeout(half.timer);
      half.r?.close();
      half.u?.close();
    }
    this.pairing.clear();
    // Linger a moment so the last messages (a "leave") flush before the broker drops us.
    const peer = this.peer;
    if (peer) setTimeout(() => peer.destroy(), 300);
  }
}
