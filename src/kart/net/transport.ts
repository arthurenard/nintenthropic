/**
 * The one shape every way of reaching another device takes, so the room's
 * logic (host.ts, guest.ts) is written once and tested without a network.
 *
 * A transport has a name for each side of a room: the host `listen`s under a
 * room code, a guest `connect`s to it. What they get is a `Link`: a pair of
 * channels to one other device.
 *
 *   reliable    ordered, nothing lost: the lobby, the start, events, results
 *   unreliable  unordered, may lose: inputs and snapshots, which are replaced
 *               by the next one anyway (and a late one is worse than none)
 *
 * Messages are strings (the protocol is JSON); transports never look inside.
 */

export type Channel = "reliable" | "unreliable";

export interface LinkClose {
  /** "closed": either side hung up; "error": the channel failed. */
  reason: "closed" | "error";
  message?: string;
}

export interface Link {
  /** The other device's address on this transport. */
  readonly peer: string;
  /** Both channels are open and neither side has hung up. */
  readonly open: boolean;
  /** Drops silently when the link is closed, and (unreliable only) when the line is too backed up to be worth it. */
  send(channel: Channel, data: string): void;
  /**
   * The one listener for what arrives. Messages that came before it was set
   * are kept and handed over then, in order. Set this before `onClose`.
   */
  onMessage(listener: (channel: Channel, data: string) => void): void;
  /** Called once when the link ends, however it ends. */
  onClose(listener: (close: LinkClose) => void): void;
  /** Hangs up. Messages already sent still get there (reliable ones, at least). */
  close(): void;
}

/** Why a transport could not do what was asked. */
export type TransportFailure =
  /** `listen`: that room code is in use. */
  | "taken"
  /** `connect`: nobody is hosting that code. */
  | "not-found"
  /** The broker or the line failed. */
  | "network";

export class TransportError extends Error {
  constructor(
    readonly kind: TransportFailure,
    message: string,
  ) {
    super(message);
    this.name = "TransportError";
  }
}

export interface Transport {
  /** Host: take the room `code`. Rejects with `TransportError("taken" | "network")`. */
  listen(code: string): Promise<void>;
  /** Guest: reach room `code`. Resolves once both channels are open; rejects with `TransportError("not-found" | "network")`. */
  connect(code: string): Promise<Link>;
  /** Host: a guest has connected (both channels open). Set before `listen`. */
  onIncoming(listener: (link: Link) => void): void;
  /** The broker or the line to it failed after the transport was up (existing links may carry on). */
  onError(listener: (error: TransportError) => void): void;
  /** Hangs up every link and gives the room code back. */
  close(): void;
}

/** Makes a transport (one per session). */
export type TransportFactory = () => Transport;

/**
 * The part of a `Link` every transport shares: holding what arrives until a
 * listener is set (a link opens before anyone has had time to listen), and
 * saying "closed" exactly once.
 */
export abstract class LinkBase implements Link {
  private messageListener: ((channel: Channel, data: string) => void) | null = null;
  private closeListener: ((close: LinkClose) => void) | null = null;
  private held: { channel: Channel; data: string }[] = [];
  private ended: LinkClose | null = null;
  private reported = false;

  constructor(readonly peer: string) {}

  get open(): boolean {
    return this.ended === null;
  }

  abstract send(channel: Channel, data: string): void;
  protected abstract hangUp(): void;

  /** Called by the transport when a message arrives. */
  protected deliver(channel: Channel, data: string): void {
    if (this.ended) return;
    if (this.messageListener) this.messageListener(channel, data);
    else this.held.push({ channel, data });
  }

  /** Called by the transport when the link is over. Safe to call twice. */
  protected finish(close: LinkClose): void {
    if (this.ended) return;
    this.ended = close;
    this.report();
  }

  private report(): void {
    if (this.reported || !this.ended || !this.closeListener) return;
    // Anything still held is delivered first: it arrived before the end.
    if (this.messageListener) this.flush();
    this.reported = true;
    this.closeListener(this.ended);
  }

  private flush(): void {
    const held = this.held;
    this.held = [];
    for (const { channel, data } of held) this.messageListener?.(channel, data);
  }

  onMessage(listener: (channel: Channel, data: string) => void): void {
    this.messageListener = listener;
    this.flush();
  }

  onClose(listener: (close: LinkClose) => void): void {
    this.closeListener = listener;
    this.report();
  }

  close(): void {
    if (this.ended) return;
    this.ended = { reason: "closed" };
    this.hangUp();
    this.report();
  }
}
