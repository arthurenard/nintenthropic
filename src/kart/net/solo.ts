/**
 * Practice: a room with no one else. It is the host (host.ts) without a
 * transport, so nothing in it can touch the network, and PeerJS is never
 * even downloaded.
 */
import type { Session } from "../contract";
import { HostSession } from "./host";
import type { NetOptions } from "./options";

export function soloSession(options: NetOptions): Session {
  return new HostSession("solo", options, null);
}
