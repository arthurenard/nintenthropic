/**
 * The three transports, held to the same promises: a room code can be taken
 * once, a missing room is "not found", both channels reach the other side,
 * hanging up is heard, and a message that comes before a listener is waiting
 * for it. The memory transport also proves its lossy line is lossy.
 */
import { afterEach, describe, expect, it } from "vitest";
import { localTransport } from "./local";
import { MemoryNetwork } from "./memory";
import { STUN, brokerFromEnv, peerTransport, type PeerModule } from "./peer";
import { settle } from "./testkit";
import { TransportError, type Channel, type Link, type Transport } from "./transport";

async function after(network: MemoryNetwork, ms: number): Promise<void> {
  for (let t = 0; t < ms; t += 5) {
    network.advance(5);
    await settle();
  }
}

/** Hosts "ROOM" and connects one guest; resolves both ends of the link. */
async function pair(host: Transport, guest: Transport, advance: () => Promise<void>): Promise<{ onHost: Link; onGuest: Link }> {
  let onHost: Link | undefined;
  host.onIncoming((link) => (onHost = link));
  await host.listen("ROOM");
  const pending = guest.connect("ROOM");
  // Whatever moves time (the network's clock, or the real one) moves it until the guest has its link.
  let onGuest: Link | undefined;
  void pending.then((link) => (onGuest = link));
  for (let i = 0; i < 200 && !(onHost && onGuest); i++) await advance();
  if (!onHost || !onGuest) throw new Error("no link");
  return { onHost, onGuest };
}

describe("the memory transport", () => {
  it("takes a code once and says 'not found' for one nobody holds", async () => {
    const network = new MemoryNetwork({ conditions: { latency: 10 } });
    const a = network.transport();
    await a.listen("ROOM");
    await expect(network.transport().listen("ROOM")).rejects.toMatchObject({ kind: "taken" });
    const lost = network.transport().connect("NOPE");
    const outcome = lost.then(
      () => "linked",
      (error: TransportError) => error.kind,
    );
    await after(network, 100);
    expect(await outcome).toBe("not-found");
    // Closing the host gives the code back.
    a.close();
    await network.transport().listen("ROOM");
  });

  it("carries both channels both ways, a latency late", async () => {
    const network = new MemoryNetwork({ conditions: { latency: 50 } });
    const { onHost, onGuest } = await pair(network.transport(), network.transport(), () => after(network, 20));
    const got: string[] = [];
    onHost.onMessage((channel, data) => got.push(`host:${channel}:${data}`));
    onGuest.onMessage((channel, data) => got.push(`guest:${channel}:${data}`));
    onGuest.send("reliable", "a");
    onGuest.send("unreliable", "b");
    onHost.send("reliable", "c");
    await after(network, 45);
    expect(got).toEqual([]);
    await after(network, 10);
    expect(got.sort()).toEqual(["guest:reliable:c", "host:reliable:a", "host:unreliable:b"]);
  });

  it("holds what arrives before anyone is listening", async () => {
    const network = new MemoryNetwork({ conditions: { latency: 5 } });
    const { onHost, onGuest } = await pair(network.transport(), network.transport(), () => after(network, 20));
    onGuest.send("reliable", "early 1");
    onGuest.send("reliable", "early 2");
    await after(network, 50);
    const got: string[] = [];
    onHost.onMessage((_channel, data) => got.push(data));
    expect(got).toEqual(["early 1", "early 2"]);
  });

  it("keeps the reliable channel ordered and whole, and lets the other lose and reorder", async () => {
    const network = new MemoryNetwork({ seed: 4, conditions: { latency: 20, jitter: 80, loss: 0.3 } });
    const { onHost, onGuest } = await pair(network.transport(), network.transport(), () => after(network, 20));
    const reliable: number[] = [];
    const unreliable: number[] = [];
    onHost.onMessage((channel, data) => (channel === "reliable" ? reliable : unreliable).push(Number(data)));
    for (let i = 0; i < 300; i++) {
      onGuest.send("reliable", String(i));
      onGuest.send("unreliable", String(i));
      await after(network, 5);
    }
    await after(network, 300);
    expect(reliable).toEqual(Array.from({ length: 300 }, (_, i) => i));
    expect(unreliable.length).toBeLessThan(260);
    expect(unreliable.length).toBeGreaterThan(140);
    expect(unreliable.some((n, i) => i > 0 && n < unreliable[i - 1]!)).toBe(true); // reordered
    expect(new Set(unreliable).size).toBe(unreliable.length); // never twice
  });

  it("tells the other side when a link closes, after what was sent before", async () => {
    const network = new MemoryNetwork({ conditions: { latency: 10, jitter: 30 } });
    const { onHost, onGuest } = await pair(network.transport(), network.transport(), () => after(network, 20));
    const log: string[] = [];
    onHost.onMessage((_c, data) => log.push(data));
    onHost.onClose((close) => log.push(`closed:${close.reason}`));
    onGuest.send("reliable", "bye");
    onGuest.close();
    onGuest.send("reliable", "after close");
    expect(onGuest.open).toBe(false);
    await after(network, 200);
    expect(log).toEqual(["bye", "closed:closed"]);
    expect(onHost.open).toBe(false);
  });
});

describe("the BroadcastChannel transport", () => {
  const open: Transport[] = [];
  afterEach(() => {
    for (const t of open.splice(0)) t.close();
  });
  const make = () => {
    const t = localTransport();
    open.push(t);
    return t;
  };
  const real = () => new Promise<void>((resolve) => setTimeout(resolve, 20));

  it("takes a code once, finds the room, and carries messages both ways", async () => {
    const host = make();
    await host.listen("QUAD");
    await expect(make().listen("QUAD")).rejects.toMatchObject({ kind: "taken" });

    const { onHost, onGuest } = await pair(host, make(), real);
    const got: string[] = [];
    onHost.onMessage((channel, data) => got.push(`host:${channel}:${data}`));
    onGuest.onMessage((channel, data) => got.push(`guest:${channel}:${data}`));
    onGuest.send("reliable", "hello");
    onHost.send("unreliable", "welcome");
    await real();
    expect(got.sort()).toEqual(["guest:unreliable:welcome", "host:reliable:hello"]);

    const closed: string[] = [];
    onHost.onClose((close) => closed.push(close.reason));
    onGuest.close();
    await real();
    expect(closed).toEqual(["closed"]);
  });

  it("says 'not found' when nobody hosts the code", async () => {
    await expect(make().connect("NONE")).rejects.toMatchObject({ kind: "not-found" });
  });
});

/** A stand-in for PeerJS: a broker in a Map, and connections that hand data across at once. */
function fakePeerJs() {
  const peers = new Map<string, FakePeer>();
  // Real PeerJS answers over a socket: never before the caller has had time to listen.
  const later = (run: () => void) => void setTimeout(run, 0);
  let nextId = 1;

  class Emitter {
    private handlers = new Map<string, ((...args: never[]) => void)[]>();
    on(event: string, handler: (...args: never[]) => void) {
      this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
      return this;
    }
    emit(event: string, ...args: unknown[]) {
      for (const handler of this.handlers.get(event) ?? []) (handler as (...a: unknown[]) => void)(...args);
    }
  }

  class FakeConn extends Emitter {
    open = false;
    other: FakeConn | null = null;
    dataChannel = { bufferedAmount: 0 };
    constructor(
      readonly peer: string,
      readonly metadata: unknown,
      readonly options: { reliable?: boolean; serialization?: string; label?: string },
    ) {
      super();
    }
    send(data: unknown) {
      const other = this.other;
      later(() => other?.emit("data", data));
    }
    close() {
      if (!this.open) return;
      this.open = false;
      const other = this.other;
      later(() => {
        this.emit("close");
        if (other?.open) other.close();
      });
    }
  }

  class FakePeer extends Emitter {
    id: string;
    open = false;
    destroyed = false;
    constructor(
      id: string | undefined,
      readonly settings: Record<string, unknown>,
    ) {
      super();
      this.id = id ?? `anon${nextId++}`;
      later(() => {
        if (peers.has(this.id)) {
          this.emit("error", { type: "unavailable-id", message: `ID ${this.id} is taken` });
          return;
        }
        peers.set(this.id, this);
        this.open = true;
        this.emit("open", this.id);
      });
    }
    connect(id: string, options: { metadata?: unknown; reliable?: boolean; serialization?: string; label?: string }) {
      const mine = new FakeConn(id, options.metadata, options);
      later(() => {
        const remote = peers.get(id);
        if (!remote) {
          this.emit("error", { type: "peer-unavailable", message: `Could not connect to peer ${id}` });
          return;
        }
        const theirs = new FakeConn(this.id, options.metadata, options);
        mine.other = theirs;
        theirs.other = mine;
        remote.emit("connection", theirs);
        later(() => {
          mine.open = theirs.open = true;
          theirs.emit("open");
          mine.emit("open");
        });
      });
      return mine;
    }
    destroy() {
      this.destroyed = true;
      this.open = false;
      peers.delete(this.id);
    }
  }
  const module = { Peer: FakePeer } as unknown as PeerModule;
  return { module, peers };
}

describe("the PeerJS transport (against a stand-in for PeerJS)", () => {
  const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 5));

  it("registers the host as grip-prix-v1-<CODE>, with the STUN server and the broker settings", async () => {
    const fake = fakePeerJs();
    const settings: Record<string, unknown>[] = [];
    const load = async () => ({
      Peer: class extends (fake.module.Peer as unknown as new (id?: string, s?: Record<string, unknown>) => object) {
        constructor(id?: string, s?: Record<string, unknown>) {
          super(id, s);
          settings.push(s ?? {});
        }
      },
    }) as unknown as PeerModule;
    const host = peerTransport({ load, broker: { host: "broker.example", port: 9000, path: "/rooms", key: "k" } });
    await host.listen("WXYZ");
    expect([...fake.peers.keys()]).toEqual(["grip-prix-v1-WXYZ"]);
    expect(settings[0]).toMatchObject({
      host: "broker.example",
      port: 9000,
      path: "/rooms",
      key: "k",
      config: { iceServers: [{ urls: STUN }] },
    });
    host.close();
  });

  it("reports a code in use as 'taken' and an unknown room as 'not-found'", async () => {
    const fake = fakePeerJs();
    const load = async () => fake.module;
    const a = peerTransport({ load });
    await a.listen("ABCD");
    await expect(peerTransport({ load }).listen("ABCD")).rejects.toMatchObject({ kind: "taken" });
    await expect(peerTransport({ load }).connect("ZZZZ")).rejects.toMatchObject({ kind: "not-found" });
    a.close();
  });

  it("reports a failure to load PeerJS as a network trouble", async () => {
    const load = async () => {
      throw new Error("offline");
    };
    await expect(peerTransport({ load }).listen("ABCD")).rejects.toMatchObject({ kind: "network" });
    await expect(peerTransport({ load }).connect("ABCD")).rejects.toMatchObject({ kind: "network" });
  });

  it("joins a guest's two connections into one link, with a reliable and an unordered channel", async () => {
    const fake = fakePeerJs();
    const load = async () => fake.module;
    const host = peerTransport({ load });
    const links: Link[] = [];
    host.onIncoming((link) => links.push(link));
    await host.listen("ROOM");

    const guest = peerTransport({ load });
    const onGuest = await guest.connect("ROOM");
    await flush();
    expect(links).toHaveLength(1);
    const onHost = links[0]!;

    const seen: [string, Channel, string][] = [];
    onHost.onMessage((channel, data) => seen.push(["host", channel, data]));
    onGuest.onMessage((channel, data) => seen.push(["guest", channel, data]));
    onGuest.send("reliable", "r");
    onGuest.send("unreliable", "u");
    onHost.send("reliable", "R");
    onHost.send("unreliable", "U");
    await flush();
    expect(seen).toEqual(
      expect.arrayContaining([
        ["host", "reliable", "r"],
        ["host", "unreliable", "u"],
        ["guest", "reliable", "R"],
        ["guest", "unreliable", "U"],
      ]),
    );

    // A guest who hangs up is heard on the host's end of the link.
    const closed: string[] = [];
    onHost.onClose((close) => closed.push(close.reason));
    onGuest.close();
    await flush();
    expect(closed).toEqual(["closed"]);
    expect(onHost.open).toBe(false);
    host.close();
    guest.close();
  });

  it("drops an unreliable message when that channel is badly backed up", async () => {
    const fake = fakePeerJs();
    const load = async () => fake.module;
    const host = peerTransport({ load });
    const links: Link[] = [];
    host.onIncoming((link) => links.push(link));
    await host.listen("ROOM");
    const onGuest = await peerTransport({ load }).connect("ROOM");
    await flush();
    const got: string[] = [];
    links[0]!.onMessage((_c, data) => got.push(data));
    const conns = (onGuest as unknown as { u: { dataChannel: { bufferedAmount: number } } }).u;
    conns.dataChannel.bufferedAmount = 10 * 1024 * 1024;
    onGuest.send("unreliable", "stale");
    onGuest.send("reliable", "kept");
    conns.dataChannel.bufferedAmount = 0;
    onGuest.send("unreliable", "fresh");
    await flush();
    expect(got).toEqual(["kept", "fresh"]);
  });

  it("takes nothing from VITE_PEER_* when none of them is set", () => {
    // Nothing is set in the test environment: the library's own defaults apply.
    expect(brokerFromEnv()).toEqual({});
  });
});
