/**
 * Downloads with real progress: the loading screen says "Getting ready… 45%"
 * with numbers that mean something, so every large file the app needs comes
 * through here and reports the bytes it has.
 */

export class DownloadError extends Error {
  constructor(
    readonly url: string,
    readonly status: number | null,
    /** Nothing arrived for STALL_AFTER, and the download was given up. */
    readonly stalled = false,
  ) {
    super(
      stalled
        ? `Couldn’t download ${url} (nothing arrived for ${STALL_AFTER / 1000} s)`
        : status === null
          ? `Couldn’t download ${url}`
          : `Couldn’t download ${url} (${status})`,
    );
    this.name = "DownloadError";
  }
}

/**
 * A download that receives nothing for this long has stalled, ms. A
 * connection that goes quiet mid-file (a captive portal, a dropped Wi-Fi, a
 * server that stops answering) otherwise leaves "Getting ready… 45%" on the
 * screen for good. Slow is fine: any bytes at all start the wait again.
 */
export const STALL_AFTER = 20_000;

/** Resolves a path relative to where the site is served (it may live under a
 * sub-path, as on GitHub Pages). */
export function siteUrl(path: string): string {
  return new URL(path, document.baseURI).href;
}

/**
 * The whole file, calling `onProgress` with 0..1 as it arrives. Without a
 * Content-Length (a compressed response), `expected` - a size known ahead -
 * stands in, so the bar still moves. Gives up with a DownloadError once
 * nothing has arrived for `stallAfter` ms.
 */
export async function fetchBytes(
  url: string,
  onProgress?: (fraction: number) => void,
  expected = 0,
  stallAfter = STALL_AFTER,
): Promise<ArrayBuffer> {
  const abort = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let stalled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  // The watch starts before the request (a server that never answers) and
  // starts again with every piece that arrives.
  const watch = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      stalled = true;
      abort.abort();
      // A stream the abort does not reach (not every body is tied to the
      // request's signal) is cancelled too, so the read below returns.
      reader?.cancel().catch(() => {});
    }, stallAfter);
  };
  const failed = () => new DownloadError(url, null, stalled);
  watch();
  try {
    let response: Response;
    try {
      response = await fetch(url, { signal: abort.signal });
    } catch {
      throw failed();
    }
    if (!response.ok) throw new DownloadError(url, response.status);
    const length = Number(response.headers.get("Content-Length")) || expected;
    if (!response.body) {
      let bytes: ArrayBuffer;
      try {
        bytes = await response.arrayBuffer();
      } catch {
        throw failed();
      }
      onProgress?.(1);
      return bytes;
    }
    const stream = response.body.getReader();
    reader = stream;
    const chunks: Uint8Array[] = [];
    let received = 0;
    onProgress?.(0);
    for (;;) {
      let part: ReadableStreamReadResult<Uint8Array>;
      try {
        part = await stream.read();
      } catch {
        throw failed();
      }
      // A cancelled stream ends as if it were done: it is not.
      if (stalled) throw failed();
      if (part.done) break;
      watch();
      chunks.push(part.value);
      received += part.value.byteLength;
      if (length > 0) onProgress?.(Math.min(0.999, received / length));
    }
    const bytes = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    onProgress?.(1);
    return bytes.buffer;
  } finally {
    clearTimeout(timer);
  }
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
