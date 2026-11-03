/**
 * The real transport: WebRTC data channels, introduced to each other by a
 * PeerJS broker (PeerJS's public one unless `VITE_PEER_*` names another), and
 * connected with the ICE servers the site hands out (ice.ts: STUN, and a
 * relay when the site has one, so devices on different networks still meet).
 *
 * The host registers under `grip-prix-v1-<CODE>`. A guest opens one PeerJS
 * data connection to it, and the two ends add a second channel to the same
 * WebRTC connection themselves, one per channel of a `Link`:
 *
 *   "r"  PeerJS's own: reliable, ordered
 *   "u"  a negotiated channel (both ends make it with the same id, so neither
 *        waits for the other): unordered, never resent (`maxRetransmits: 0`)
 *
 * PeerJS has no lossy mode (its `reliable: false` only drops the ordering),
 * and a snapshot or an input resent after it is stale is worse than none: the
 * next one replaces it, and resending crowds the line exactly when it is bad.
 * One WebRTC connection rather than PeerJS's one per channel also means one
 * path to find through the routers (and one relay, where one is needed), so
 * a guest connects sooner and less often fails halfway. To keep a bad line
 * from piling stale messages up, an unreliable send is skipped when that
 * channel already has more than 32 KB waiting.
 *
 * A guest of the old shape (two PeerJS connections, before protocol 7) is let
 * in far enough to be told the room speaks another version.
 *
 * PeerJS is imported when a room is first hosted or joined, so a practice
 * race (which never gets here) never downloads it.
 *
 * The unit tests (transport.test.ts) drive it with a stand-in `Peer`; the real
 * thing can be tried by hand with src/kart/net/dev.html, and the relay alone
 * by opening the page with `?relay=only`.
 */
import type { DataConnection, Peer, PeerJSOption } from "peerjs";
import { peerIdFor } from "./codes";
import { DIRECT, STUN, iceServers, relayOnlyFromUrl } from "./ice";
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
  /** The ICE servers to connect with (ice.ts's `iceServers` by default). */
  ice?: () => Promise<RTCIceServer[]>;
  /** Connect through a relay or not at all (`?relay=only` by default). */
  relayOnly?: boolean;
}

export { STUN };
const BACKLOG = 32 * 1024;
/** The id both ends give the lossy channel. PeerJS's own channel takes 0 or 1. */
const LOSSY_ID = 7;

/** The lossy channel on a PeerJS connection's WebRTC connection, made the same way at both ends; null if it cannot be. */
function lossyChannel(conn: DataConnection): RTCDataChannel | null {
  try {
    return conn.peerConnection?.createDataChannel("u", { negotiated: true, id: LOSSY_ID, ordered: false, maxRetransmits: 0 }) ?? null;
  } catch {
    return null;
  }
}

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

/** A PeerJS error as the net reports it: a room nobody hosts is "not-found", a code in use "taken", anything else "network". */
function failure(error: { type?: string; message?: string }): TransportError {
  switch (error.type) {
    case "peer-unavailable":
      return new TransportError("not-found", "There is no race with that code.");
    case "unavailable-id":
      return new TransportError("taken", "That room code is already in use.");
    default:
      return new TransportError("network", error.message ?? "Could not reach the signalling server.");
  }
}

class PeerLink extends LinkBase {
  /** `u` is the lossy channel; without one (it could not be made), unreliable messages go the reliable way. */
  constructor(
    peer: string,
    private r: DataConnection,
    private u: RTCDataChannel | null,
  ) {
    super(peer);
    r.on("data", (data: unknown) => {
      if (typeof data === "string") this.deliver("reliable", data);
    });
    r.on("close", () => {
      this.finish({ reason: "closed" });
      this.drop();
    });
    r.on("error", (error: Error) => {
      this.finish({ reason: "error", message: error.message });
      this.drop();
    });
    // The lossy channel ends with the connection it rides on, which says so: nothing to hear from it but messages.
    if (u) {
      u.onmessage = (event: MessageEvent) => {
        if (typeof event.data === "string") this.deliver("unreliable", event.data);
      };
    }
  }

  send(channel: Channel, data: string): void {
    if (!this.open || !this.r.open) return;
    try {
      if (channel === "reliable" || !this.u) {
        void this.r.send(data);
        return;
      }
      if (this.u.readyState !== "open" || this.u.bufferedAmount > BACKLOG) return;
      this.u.send(data);
    } catch {
      /* the channel closed under us: the connection's close event will say so */
    }
  }

  protected hangUp(): void {
    this.drop();
  }

  private drop(): void {
    try {
      this.u?.close();
    } catch {
      /* already closed */
    }
    // `flush` lets a "leave" just sent go out before the channel shuts.
    try {
      this.r.close({ flush: true });
    } catch {
      /* already closed */
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
  /** Old-shape guests' second connections, held only until they have been told the version is wrong. */
  private strays = new Set<DataConnection>();
  private links = new Set<PeerLink>();
  private closed = false;
  private timeout: number;

  constructor(private options: PeerOptions) {
    this.timeout = options.timeout ?? 15000;
  }

  private async make(id: string | undefined): Promise<Peer> {
    const load = this.options.load ?? (() => import("peerjs") as unknown as Promise<PeerModule>);
    const ice = this.options.ice ?? (() => iceServers());
    // The servers are asked for while PeerJS loads: neither waits on the other.
    const [loaded, servers] = await Promise.all([load().catch(() => null), ice().catch(() => DIRECT)]);
    if (!loaded) throw new TransportError("network", "Could not load the networking code. Check your connection.");
    const broker = { ...brokerFromEnv(), ...this.options.broker };
    const config: RTCConfiguration = { iceServers: servers };
    if (this.options.relayOnly ?? relayOnlyFromUrl()) config.iceTransportPolicy = "relay";
    const settings: PeerJSOption = { ...broker, debug: 0, config };
    return new loaded.Peer(id, settings);
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

  /** A guest's connection arrives: once it is open, add the lossy channel, and the link is ready. */
  private accept(conn: DataConnection): void {
    const meta = conn.metadata as { link?: unknown; ch?: unknown } | null | undefined;
    if (!meta || typeof meta.link !== "string" || (meta.ch !== "r" && meta.ch !== "u")) {
      conn.close();
      return;
    }
    if (meta.ch === "u") {
      // An old-shape guest's second connection: its link waits for this one to open before it says hello (and hears
      // that the room speaks another version), and nothing comes over it.
      this.strays.add(conn);
      const timer = setTimeout(() => conn.close(), this.timeout);
      conn.on("close", () => {
        clearTimeout(timer);
        this.strays.delete(conn);
      });
      return;
    }
    const timer = setTimeout(() => conn.close(), this.timeout);
    conn.on("open", () => {
      clearTimeout(timer);
      const link = new PeerLink(conn.peer, conn, lossyChannel(conn));
      this.links.add(link);
      this.incoming.emit(link);
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
        const r = peer.connect(host, {
          serialization: "raw",
          reliable: true,
          label: "r",
          metadata: { link: linkId, ch: "r" },
        });
        r.on("open", () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          const link = new PeerLink(host, r, lossyChannel(r));
          this.links.add(link);
          resolve(link);
        });
        r.on("error", (error) => fail(failure(error)));
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
    for (const conn of this.strays) conn.close();
    this.strays.clear();
    // Linger a moment so the last messages (a "leave") flush before the broker drops us.
    const peer = this.peer;
    if (peer) setTimeout(() => peer.destroy(), 300);
  }
}
