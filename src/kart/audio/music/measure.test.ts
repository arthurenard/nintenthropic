// @ts-nocheck (a Node-only harness: the project does not carry the Node typings)
/**
 * Offline renders and measurements of every piece, for listening later and for
 * checking the production by numbers. Nothing is played. It only runs when
 * MUSIC_OUT names a folder:
 *
 *   MUSIC_OUT=/some/folder npx vitest run src/kart/audio/music/measure.test.ts
 *
 * and writes a 16-bit WAV per piece (and per final-lap version) with
 * summary.json beside them: loudness, peak, crest, how the energy falls over
 * five bands, the spectral centroid, the render time, the stereo width.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { describe, it, vi } from "vitest";
import { fft, rmsOf, spectralCentroid, toDb } from "../analysis";
import { FINAL_LAP } from "./loader";
import { PIECES } from "./pieces";
import { renderPiece, type RenderedMusic } from "./render";

vi.setConfig({ testTimeout: 240_000 });

const OUT = process.env.MUSIC_OUT;
const SR = Number(process.env.MUSIC_SR ?? 32000);

function wav16(left: Float32Array, right: Float32Array, sr: number): Buffer {
  const n = left.length;
  const buf = Buffer.alloc(44 + n * 4);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * 4, 4);
  buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * 4, 28);
  buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(left[i]! * 32767))), 44 + i * 4);
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(right[i]! * 32767))), 46 + i * 4);
  }
  return buf;
}

/** Share of the energy in five bands: below 120 Hz, 120-500, 500-2k, 2k-6k, above 6k. */
function bands(mono: Float32Array, sr: number): number[] {
  const size = 4096;
  const edges = [120, 500, 2000, 6000];
  const acc = [0, 0, 0, 0, 0];
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  const hop = size * 4;
  for (let s = 0; s + size <= mono.length; s += hop) {
    for (let i = 0; i < size; i++) {
      re[i] = mono[s + i]! * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size));
      im[i] = 0;
    }
    fft(re, im);
    for (let k = 1; k < size / 2; k++) {
      const f = (k * sr) / size;
      const p = re[k]! * re[k]! + im[k]! * im[k]!;
      let b = 0;
      while (b < edges.length && f >= edges[b]!) b++;
      acc[b]! += p;
    }
  }
  const total = acc.reduce((a, b) => a + b, 0) || 1;
  return acc.map((v) => Math.round((1000 * v) / total) / 10);
}

function summarise(id: string, r: RenderedMusic): Record<string, unknown> {
  const mono = new Float32Array(r.left.length);
  let diff = 0;
  let sum = 0;
  for (let i = 0; i < mono.length; i++) {
    mono[i] = 0.5 * (r.left[i]! + r.right[i]!);
    diff += (r.left[i]! - r.right[i]!) ** 2;
    sum += (r.left[i]! + r.right[i]!) ** 2;
  }
  return {
    id,
    seconds: Math.round(r.duration * 10) / 10,
    rmsDb: Math.round(r.stats.rmsDb * 10) / 10,
    peakDb: Math.round(r.stats.peakDb * 10) / 10,
    crestDb: Math.round((r.stats.peakDb - r.stats.rmsDb) * 10) / 10,
    limiterDb: Math.round((r.stats.limiterDb ?? 0) * 10) / 10,
    bandsPct: bands(mono, r.sampleRate),
    centroidHz: Math.round(spectralCentroid(mono, r.sampleRate)),
    sideToMidDb: Math.round(toDb(Math.sqrt(diff / (sum || 1))) * 10) / 10,
    firstSecondDb: Math.round(toDb(rmsOf(r.left, 0, r.sampleRate)) * 10) / 10,
    renderMs: Math.round(r.stats.renderMs),
    megabytes: Math.round(((r.left.length * 8) / 1e6) * 10) / 10,
    parts: Object.fromEntries(Object.entries(r.stats.parts).map(([k, v]) => [k, Math.round(v * 10) / 10])),
    comet: r.comet ? { seconds: Math.round((r.comet.left.length / r.sampleRate) * 100) / 100 } : undefined,
    stinger: r.stinger ? { seconds: Math.round((r.stinger.left.length / r.sampleRate) * 100) / 100 } : undefined,
  };
}

describe.skipIf(!OUT)("offline renders", () => {
  it("renders every piece and its final-lap version and measures them", () => {
    mkdirSync(OUT!, { recursive: true });
    const only = process.env.MUSIC_ONLY?.split(",");
    const summary: Record<string, unknown>[] = [];
    for (const id of Object.keys(PIECES)) {
      if (only && !only.includes(id)) continue;
      for (const final of [false, true]) {
        const race = !!PIECES[id as keyof typeof PIECES].race;
        if (final && !race) continue;
        const r = renderPiece(PIECES[id as keyof typeof PIECES], { sampleRate: SR, ...(final ? FINAL_LAP : {}) });
        const name = final ? `${id}-final` : id;
        writeFileSync(`${OUT}/${name}.wav`, wav16(r.left, r.right, r.sampleRate));
        if (r.stinger) writeFileSync(`${OUT}/${name}-stinger.wav`, wav16(r.stinger.left, r.stinger.right, r.sampleRate));
        if (r.comet && !final) writeFileSync(`${OUT}/${id}-comet.wav`, wav16(r.comet.left, r.comet.right, r.sampleRate));
        summary.push(summarise(name, r));
      }
    }
    writeFileSync(`${OUT}/summary.json`, JSON.stringify(summary, null, 1));
  });
});
