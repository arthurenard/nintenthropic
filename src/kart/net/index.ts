/**
 * The room layer of Grip Prix: `hostSession`, `joinSession` and `soloSession`
 * make a `Session` (contract.ts); the transports are what they talk over.
 */
export { hostSession } from "./host";
export { joinSession, VERSION_MISMATCH } from "./guest";
export { soloSession } from "./solo";
export { defaultTransport, type NetOptions } from "./options";
export { CODE_ALPHABET, joinCodeFrom, joinUrl, makeCode, parseCode } from "./codes";
export { PROTOCOL_VERSION } from "./protocol";
export { localTransport } from "./local";
export { peerTransport } from "./peer";
export { MemoryNetwork } from "./memory";
export type { Channel, Link, Transport, TransportFactory } from "./transport";
export { TransportError } from "./transport";
