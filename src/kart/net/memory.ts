/**
 * A pretend network inside one process, for unit tests. It has its own clock
 * (`advance(ms)` moves it), so a test says exactly how long passes and
 * nothing depends on real timers; and its lines have a latency, a jitter and
 * a loss, so the room's code can be shown to cope with a bad connection.
 *
 * Like the real thing, the reliable channel never loses or reorders (a
 * message is held back behind earlier ones, as TCP would), and the unreliable
 * one does both: each message is delayed on its own and may be dropped.
 */
import { LinkBase, TransportError, type Channel, type Link, type Transport } from "./transport";
import { Emitter, seeded } from "./util";

export interface Conditions {
  /** One-way delay, milliseconds. */
  latency: number;
  /** Up to this much more delay, at random, per message. */
  jitter: number;
  /** 0..1: the share of unreliable messages that never arrive. */
  loss: number;
}

interface Scheduled {
  at: number;
  order: number;
  run: () => void;
}

export class MemoryNetwork {
  /** The network's own clock, milliseconds. */
  now = 0;
  conditions: Conditions;
  private queue: Scheduled[] = [];
  private order = 0;
  private random: () => number;
  /** Room code → the host's transport. */
  readonly rooms = new Map<string, MemoryTransport>();

  constructor(options: { seed?: number; conditions?: Partial<Conditions> } = {}) {
    this.random = seeded(options.seed ?? 1);
    this.conditions = { latency: 0, jitter: 0, loss: 0, ...options.conditions };
  }

  /** Changes the line from now on (a test can make it worse half way). */
  setConditions(patch: Partial<Conditions>): void {
    this.conditions = { ...this.conditions, ...patch };
  }

  /** A transport for one device. */
  transport(): MemoryTransport {
    return new MemoryTransport(this);
  }

  /** Runs `run` after `delay` ms of network time. */
  schedule(delay: number, run: () => void): void {
    this.queue.push({ at: this.now + Math.max(0, delay), order: this.order++, run });
  }

  /** Moves the clock on, delivering everything that falls due, in order. */
  advance(ms: number): void {
    const target = this.now + ms;
    for (;;) {
      let next = -1;
      for (let i = 0; i < this.queue.length; i++) {
        const item = this.queue[i]!;
        if (item.at > target) continue;
        const best = next < 0 ? null : this.queue[next]!;
        if (!best || item.at < best.at || (item.at === best.at && item.order < best.order)) next = i;
      }
      if (next < 0) break;
      const [item] = this.queue.splice(next, 1);
      this.now = Math.max(this.now, item!.at);
      item!.run();
    }
    this.now = target;
  }

  /** The delay for one message under today's conditions. */
  delay(): number {
    return this.conditions.latency + this.random() * this.conditions.jitter;
  }

  lost(): boolean {
    return this.random() < this.conditions.loss;
  }
}

class MemoryLink extends LinkBase {
  remote: MemoryLink | null = null;
  /** Reliable messages leave in order: none may arrive before the one sent before it. */
  private lastReliable = 0;

  constructor(
    private network: MemoryNetwork,
    peer: string,
  ) {
    super(peer);
  }

  send(channel: Channel, data: string): void {
    if (!this.open || !this.remote) return;
    const remote = this.remote;
    const network = this.network;
    if (channel === "reliable") {
      const at = Math.max(network.now + network.delay(), this.lastReliable);
      this.lastReliable = at;
      network.schedule(at - network.now, () => remote.receive(channel, data));
    } else {
      if (network.lost()) return;
      network.schedule(network.delay(), () => remote.receive(channel, data));
    }
  }

  receive(channel: Channel, data: string): void {
    this.deliver(channel, data);
  }

  protected hangUp(): void {
    const remote = this.remote;
    if (!remote) return;
    // Behind everything already sent, like a reliable message.
    const at = Math.max(this.network.now + this.network.delay(), this.lastReliable);
    this.lastReliable = at;
    this.network.schedule(at - this.network.now, () => remote.finish({ reason: "closed" }));
  }

  /** The line fails: both sides hear "error" at once (a test's way to pull the plug). */
  sever(): void {
    const remote = this.remote;
    this.finish({ reason: "error", message: "severed" });
    remote?.finish({ reason: "error", message: "severed" });
  }
}

let nextName = 1;

export class MemoryTransport implements Transport {
  readonly name = `mem${nextName++}`;
  private incoming = new Emitter<Link>();
  private errors = new Emitter<TransportError>();
  private room: string | null = null;
  private links = new Set<MemoryLink>();
  private closed = false;

  constructor(private network: MemoryNetwork) {}

  async listen(code: string): Promise<void> {
    if (this.closed) throw new TransportError("network", "The transport is closed.");
    if (this.network.rooms.has(code)) throw new TransportError("taken", `Room ${code} is already in use.`);
    this.network.rooms.set(code, this);
    this.room = code;
  }

  connect(code: string): Promise<Link> {
    const network = this.network;
    return new Promise((resolve, reject) => {
      const base = network.conditions.latency;
      const host = network.rooms.get(code);
      if (this.closed || !host || host.closed) {
        network.schedule(base * 2, () => reject(new TransportError("not-found", `No room ${code}.`)));
        return;
      }
      const mine = new MemoryLink(network, host.name);
      const theirs = new MemoryLink(network, this.name);
      mine.remote = theirs;
      theirs.remote = mine;
      this.links.add(mine);
      host.links.add(theirs);
      network.schedule(base, () => host.incoming.emit(theirs));
      network.schedule(base * 2, () => resolve(mine));
    });
  }

  onIncoming(listener: (link: Link) => void): void {
    this.incoming.add(listener);
  }

  /** A pretend network has no broker to lose, so this never fires. */
  onError(listener: (error: TransportError) => void): void {
    this.errors.add(listener);
  }

  /** Cuts every link without a goodbye, as a lost connection would. */
  sever(): void {
    for (const link of this.links) link.sever();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.room && this.network.rooms.get(this.room) === this) this.network.rooms.delete(this.room);
    for (const link of this.links) link.close();
    this.links.clear();
  }
}
