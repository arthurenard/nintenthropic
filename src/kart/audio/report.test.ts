/**
 * A review aid, not a test: when KART_AUDIO_REPORT names a directory this
 * renders every cue of the kart pack and every piece of music offline (in
 * Node, so nothing is ever played), writes a waveform-and-spectrogram PNG for
 * each and a text summary of their levels. KART_AUDIO_ONLY narrows it to
 * names containing that text. Without the variable it does nothing.
 *
 *   KART_AUDIO_REPORT=/tmp/kart npx vitest run src/kart/audio/report.test.ts
 */
import { describe, it } from "vitest";
import { cuesInPack } from "../../audio/cues/table";
import { renderTake } from "../../audio/render";
import { drawSpectrogram, drawWaveform, estimatePitch, meanOf, peakOfBuffer, rmsOf, spectralCentroid, stack, toDb, type Picture } from "./analysis";
import { FINAL_LAP } from "./music/loader";
import { PIECES, THEME_PIECES } from "./music/pieces";
import { MUSIC_SAMPLE_RATE, renderPiece } from "./music/render";

interface NodeApi {
  fs: { mkdirSync(p: string, o: { recursive: true }): void; writeFileSync(p: string, d: Uint8Array | string): void };
  zlib: { deflateSync(d: Uint8Array): Uint8Array };
}

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const OUT = env.KART_AUDIO_REPORT;
const ONLY = env.KART_AUDIO_ONLY ?? "";

function crc32(bytes: Uint8Array): number {
  let c: number;
  let crc = 0xffffffff;
  for (let n = 0; n < bytes.length; n++) {
    c = (crc ^ bytes[n]!) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function png(pic: Picture, zlib: NodeApi["zlib"]): Uint8Array {
  const { width, height, data } = pic;
  const raw = new Uint8Array((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    raw.set(data.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  }
  const chunk = (type: string, body: Uint8Array): Uint8Array => {
    const out = new Uint8Array(12 + body.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, body.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(body, 8);
    view.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)));
    return out;
  };
  const header = new Uint8Array(13);
  const hv = new DataView(header.buffer);
  hv.setUint32(0, width);
  hv.setUint32(4, height);
  header[8] = 8;
  header[9] = 6;
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

describe.skipIf(!OUT)("report", () => {
  it("renders the kart sounds and music to pictures", async () => {
    const fs = (await import("node:fs" as string)) as NodeApi["fs"];
    const zlib = (await import("node:zlib" as string)) as NodeApi["zlib"];
    fs.mkdirSync(`${OUT}/cues`, { recursive: true });
    fs.mkdirSync(`${OUT}/music`, { recursive: true });
    const lines: string[] = [];
    const sr = 44100;
    for (const cue of cuesInPack("kart")) {
      if (!cue.includes(ONLY)) continue;
      const t0 = performance.now();
      const take = renderTake(cue, 0, { sampleRate: sr, seed: 1 });
      const ms = performance.now() - t0;
      const ch = take.channels[0]!;
      const pic = stack([drawWaveform(ch, 900, 110), drawSpectrogram(ch, sr, 900, 220, 16000)]);
      fs.writeFileSync(`${OUT}/cues/${cue}.png`, png(pic, zlib));
      const pitch = estimatePitch(ch, sr, Math.floor(ch.length * 0.3), Math.min(4096, Math.floor(ch.length * 0.3)), 60, 3000);
      lines.push(
        `${cue.padEnd(22)} ${(ch.length / sr).toFixed(2).padStart(5)}s peak ${toDb(peakOfBuffer(ch)).toFixed(1).padStart(6)} rms ${toDb(rmsOf(ch)).toFixed(1).padStart(6)} ` +
          `dc ${meanOf(ch).toExponential(1)} centroid ${spectralCentroid(ch, sr).toFixed(0).padStart(5)} pitch ${pitch.toFixed(0).padStart(4)} ${ms.toFixed(0)}ms`,
      );
    }
    for (const id of Object.keys(PIECES)) {
      if (!id.includes(ONLY)) continue;
      for (const final of [false, true]) {
        if (final && !(THEME_PIECES as readonly string[]).includes(id)) continue;
        const r = renderPiece(PIECES[id as keyof typeof PIECES], { sampleRate: MUSIC_SAMPLE_RATE, ...(final ? FINAL_LAP : {}) });
        const ch = r.left;
        const pic = stack([drawWaveform(ch, 1200, 90), drawSpectrogram(ch, r.sampleRate, 1200, 200, 12000)]);
        fs.writeFileSync(`${OUT}/music/${id}${final ? "-final" : ""}.png`, png(pic, zlib));
        const parts = Object.entries(r.stats.parts).map(([k, v]) => `${k} ${v.toFixed(1)}`).join(", ");
        lines.push(
          `music ${id}${final ? "-final" : ""}`.padEnd(22) +
            ` ${r.duration.toFixed(1)}s rms ${r.stats.rmsDb.toFixed(1)} peak ${r.stats.peakDb.toFixed(1)} render ${r.stats.renderMs.toFixed(0)}ms ` +
            `centroid ${spectralCentroid(ch, r.sampleRate).toFixed(0)} [${parts}] ${r.stats.warnings.join("; ")}`,
        );
      }
    }
    fs.writeFileSync(`${OUT}/summary.txt`, lines.join("\n") + "\n");
    console.info(lines.join("\n"));
  }, 600_000);
});
