/**
 * The transport for several tabs of one browser (`?net=local`): development
 * without a network, and the end-to-end tests. BroadcastChannel reaches every
 * same-origin tab and nothing else, which is exactly a room's worth.
 *
 * A shared "lobby" channel is only for finding each other (is the code taken?
 * who hosts it?). Once a guest is accepted, the two tabs talk on a channel of
 * their own, so a third tab never sees (or pays for) their traffic.
 *
 * BroadcastChannel is reliable and ordered, so both of a link's channels ride
 * on the one; nothing is ever lost. That makes this transport kinder than
 * the real one: the net's tolerance for loss is proven on the memory
 * transport, not here.
 */
import { LinkBase, TransportError, type Channel, type Link, type Transport } from "./transport";
import { Emitter, seeded, token } from "./util";

const LOBBY = "grip-prix-local-v1";

/** How long to wait for a reply from another tab before deciding nobody is there. */
const PROBE_MS = 150;
const KNOCK_MS = 600;

type Find =
  | { k: "probe"; code: string; from: string }
  | { k: "taken"; code: string; to: string }
  | { k: "knock"; code: string; from: string; link: string }
  | { k: "accept"; code: string; to: string; link: string };

type Wire = { k: "d"; c: Channel; d: string } | { k: "bye" };

class LocalLink extends LinkBase {
  private channel: BroadcastChannel;

  constructor(peer: string, id: string) {
    super(peer);
    this.channel = new BroadcastChannel(`${LOBBY}:${id}`);
    this.channel.onmessage = (event: MessageEvent) => {
      const wire = event.data as Wire;
      if (wire.k === "d") this.deliver(wire.c, wire.d);
      else if (wire.k === "bye") {
        this.finish({ reason: "closed" });
        this.channel.close();
      }
    };
  }

  send(channel: Channel, data: string): void {
    if (!this.open) return;
    this.channel.postMessage({ k: "d", c: channel, d: data } satisfies Wire);
  }

  protected hangUp(): void {
    this.channel.postMessage({ k: "bye" } satisfies Wire);
    this.channel.close();
  }
}

export function localTransport(): Transport {
  return new LocalTransport();
}

class LocalTransport implements Transport {
  private me = token(seeded(Math.floor(Math.random() * 2 ** 32)), 10);
  private find = new BroadcastChannel(LOBBY);
  private incoming = new Emitter<Link>();
  private errors = new Emitter<TransportError>();
  private room: string | null = null;
  private links = new Set<LocalLink>();
  private onFind: ((message: Find) => void) | null = null;
  private closed = false;

  constructor() {
    this.find.onmessage = (event: MessageEvent) => {
      const message = event.data as Find;
      // Hosting: answer whoever asks about our code.
      if (this.room && message.k === "probe" && message.code === this.room && message.from !== this.me) {
        this.find.postMessage({ k: "taken", code: this.room, to: message.from } satisfies Find);
      } else if (this.room && message.k === "knock" && message.code === this.room) {
        const link = new LocalLink(message.from, message.link);
        this.links.add(link);
        this.find.postMessage({ k: "accept", code: this.room, to: message.from, link: message.link } satisfies Find);
        this.incoming.emit(link);
      }
      this.onFind?.(message);
    };
  }

  listen(code: string): Promise<void> {
    if (this.closed) return Promise.reject(new TransportError("network", "The transport is closed."));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.onFind = null;
        this.room = code;
        resolve();
      }, PROBE_MS);
      this.onFind = (message) => {
        if (message.k === "taken" && message.code === code) {
          clearTimeout(timer);
          this.onFind = null;
          reject(new TransportError("taken", `Room ${code} is already in use.`));
        }
      };
      this.find.postMessage({ k: "probe", code, from: this.me } satisfies Find);
    });
  }

  connect(code: string): Promise<Link> {
    if (this.closed) return Promise.reject(new TransportError("network", "The transport is closed."));
    return new Promise((resolve, reject) => {
      const id = token(seeded(Math.floor(Math.random() * 2 ** 32)), 12);
      const timer = setTimeout(() => {
        this.onFind = null;
        reject(new TransportError("not-found", `No room ${code} in this browser.`));
      }, KNOCK_MS);
      this.onFind = (message) => {
        if (message.k === "accept" && message.to === this.me && message.link === id) {
          clearTimeout(timer);
          this.onFind = null;
          const link = new LocalLink(code, id);
          this.links.add(link);
          resolve(link);
        }
      };
      this.find.postMessage({ k: "knock", code, from: this.me, link: id } satisfies Find);
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
    this.room = null;
    for (const link of this.links) link.close();
    this.links.clear();
    this.find.close();
  }
}
