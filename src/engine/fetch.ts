/**
 * Downloads with real progress: the loading screen says "Getting ready… 45%"
 * with numbers that mean something, so every large file the app needs comes
 * through here and reports the bytes it has.
 */

export class DownloadError extends Error {
  constructor(
    readonly url: string,
    readonly status: number | null,
  ) {
    super(status === null ? `Couldn’t download ${url}` : `Couldn’t download ${url} (${status})`);
    this.name = "DownloadError";
  }
}

/** Resolves a path relative to where the site is served (it may live under a
 * sub-path, as on GitHub Pages). */
export function siteUrl(path: string): string {
  return new URL(path, document.baseURI).href;
}

/**
 * The whole file, calling `onProgress` with 0..1 as it arrives. Without a
 * Content-Length (a compressed response), `expected` - a size known ahead -
 * stands in, so the bar still moves.
 */
export async function fetchBytes(
  url: string,
  onProgress?: (fraction: number) => void,
  expected = 0,
): Promise<ArrayBuffer> {
  let response: Response;
  try {
    response = await fetch(url);
  } catch {
    throw new DownloadError(url, null);
  }
  if (!response.ok) throw new DownloadError(url, response.status);
  const length = Number(response.headers.get("Content-Length")) || expected;
  if (!response.body || !onProgress) {
    const bytes = await response.arrayBuffer();
    onProgress?.(1);
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  onProgress(0);
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    if (length > 0) onProgress(Math.min(0.999, received / length));
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  onProgress(1);
  return bytes.buffer;
}

/**
 * Several parts of one wait, each weighted by roughly how long it takes, as
 * one fraction: the loading bar fills once, steadily, rather than restarting
 * for every file.
 */
export class Progress {
  private readonly parts = new Map<string, { weight: number; done: number }>();

  constructor(private readonly onChange: (fraction: number) => void) {}

  /** A part of the wait; returns the callback that reports its own 0..1. */
  part(name: string, weight: number): (fraction: number) => void {
    this.parts.set(name, { weight, done: 0 });
    this.report();
    return (fraction) => {
      const part = this.parts.get(name);
      if (!part) return;
      part.done = Math.min(1, Math.max(part.done, fraction));
      this.report();
    };
  }

  get fraction(): number {
    let total = 0;
    let done = 0;
    for (const part of this.parts.values()) {
      total += part.weight;
      done += part.weight * part.done;
    }
    return total > 0 ? done / total : 0;
  }

  private report(): void {
    this.onChange(this.fraction);
  }
}
