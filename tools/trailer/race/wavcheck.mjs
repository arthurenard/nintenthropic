/**
 * Levels of a clip's race.wav, by analysis only (never played): overall RMS and peak, and the RMS and peak of each half second.
 *   node tools/trailer/race/wavcheck.mjs gp-go [gp-drift ...]
 */
import { readFileSync } from "node:fs";
import { levels } from "./audio.mjs";
import { OUT } from "./lib.mjs";

for (const id of process.argv.slice(2)) {
  const buf = readFileSync(`${OUT}/clips/${id}/race.wav`);
  const format = buf.readUInt16LE(20);
  const channels = buf.readUInt16LE(22);
  const rate = buf.readUInt32LE(24);
  const bits = buf.readUInt16LE(34);
  const n = (buf.length - 44) / (channels * 4);
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    left[i] = buf.readFloatLE(44 + i * 8);
    right[i] = buf.readFloatLE(48 + i * 8);
  }
  const lv = levels(left, right);
  console.log(`${id}: format ${format} (3 = float), ${channels} ch, ${rate} Hz, ${bits} bit, ${n} samples = ${(n / rate).toFixed(3)} s; rms ${lv.rmsDb} dBFS, peak ${lv.peakDb} dBFS, clipped ${lv.clipped}`);
  console.log("  per half second (rms/peak dBFS): " + lv.perHalfSecond.map((r) => `${r.t.toFixed(1)}s ${r.rms}/${r.peak}`).join("  "));
}
