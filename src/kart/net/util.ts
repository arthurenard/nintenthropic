/**
 * Small helpers the net code shares: a listener list, number clamps, and the
 * seeded generator the tests and the lobby's choices use (the sim has its
 * own; the net must not depend on it).
 */

/** A list of listeners. `add` hands back the function that removes it again. */
export class Emitter<T> {
  private listeners = new Set<(value: T) => void>();

  add(listener: (value: T) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(value: T): void {
    // A copy, so a listener may remove itself (or add another) while we call.
    for (const listener of [...this.listeners]) listener(value);
  }

  get size(): number {
    return this.listeners.size;
  }

  clear(): void {
    this.listeners.clear();
  }
}

export function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

export function lerp(a: number, b: number, f: number): number {
  return a + (b - a) * f;
}

/** An angle brought into -π..π. */
export function wrapAngle(angle: number): number {
  let a = angle % (2 * Math.PI);
  if (a > Math.PI) a -= 2 * Math.PI;
  else if (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

/** Blends two angles the short way round. */
export function lerpAngle(a: number, b: number, f: number): number {
  return a + wrapAngle(b - a) * f;
}

/** A small seeded generator (mulberry32): the same seed, the same numbers, anywhere. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A short random token for device and link ids. */
export function token(random: () => number, length = 8): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < length; i++) out += alphabet[Math.floor(random() * alphabet.length)];
  return out;
}
