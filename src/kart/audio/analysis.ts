/**
 * Looking at sound without hearing it: levels, spectra and pictures of a
 * buffer. The dev page draws these on a canvas and the tests (and the PNGs
 * written for review) use the same functions, so what a developer sees is
 * what is measured. Pure TypeScript, no Web Audio.
 */

/** In-place radix-2 FFT of ``re``/``im`` (length a power of two). */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]!;
      re[i] = re[j]!;
      re[j] = tr;
      const ti = im[i]!;
      im[i] = im[j]!;
      im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const xr = re[b]! * cr - im[b]! * ci;
        const xi = re[b]! * ci + im[b]! * cr;
        re[b] = re[a]! - xr;
        im[b] = im[a]! - xi;
        re[a]! += xr;
        im[a]! += xi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

export interface Spectrogram {
  /** Magnitude in dB (relative to full scale) for each frame, bins 0..size/2. */
  frames: Float32Array[];
  binHz: number;
  hopSeconds: number;
}

/** A short-time spectrogram with a Hann window. */
export function spectrogram(samples: Float32Array, sr: number, size = 1024, hop = 512): Spectrogram {
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  const window = new Float64Array(size);
  for (let i = 0; i < size; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size);
  const frames: Float32Array[] = [];
  for (let start = 0; start + size <= samples.length; start += hop) {
    for (let i = 0; i < size; i++) {
      re[i] = samples[start + i]! * window[i]!;
      im[i] = 0;
    }
    fft(re, im);
    const bins = new Float32Array(size / 2 + 1);
    for (let k = 0; k <= size / 2; k++) {
      const mag = (2 * Math.hypot(re[k]!, im[k]!)) / size / 0.5;
      bins[k] = 20 * Math.log10(mag + 1e-9);
    }
    frames.push(bins);
  }
  return { frames, binHz: sr / size, hopSeconds: hop / sr };
}

/** The power-weighted mean frequency of a buffer, Hz: a one-number measure of brightness. */
export function spectralCentroid(samples: Float32Array, sr: number, size = 2048): number {
  const hop = size;
  let num = 0;
  let den = 0;
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  for (let start = 0; start + size <= samples.length; start += hop) {
    for (let i = 0; i < size; i++) {
      re[i] = samples[start + i]! * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size));
      im[i] = 0;
    }
    fft(re, im);
    for (let k = 1; k < size / 2; k++) {
      const p = re[k]! * re[k]! + im[k]! * im[k]!;
      num += p * k * (sr / size);
      den += p;
    }
  }
  return den > 0 ? num / den : 0;
}

export function rmsOf(samples: Float32Array, from = 0, to = samples.length): number {
  let s = 0;
  for (let i = from; i < to; i++) s += samples[i]! * samples[i]!;
  return Math.sqrt(s / Math.max(1, to - from));
}

export const toDb = (x: number): number => 20 * Math.log10(Math.max(x, 1e-9));

export function peakOfBuffer(samples: Float32Array): number {
  let p = 0;
  for (let i = 0; i < samples.length; i++) p = Math.max(p, Math.abs(samples[i]!));
  return p;
}

export function meanOf(samples: Float32Array): number {
  let s = 0;
  for (let i = 0; i < samples.length; i++) s += samples[i]!;
  return s / Math.max(1, samples.length);
}

/**
 * The strongest periodicity of a stretch of signal, Hz, by autocorrelation
 * (searching ``lo``..``hi``): a way to check that a sound has the pitch it was
 * written with. 0 when nothing periodic stands out.
 */
export function estimatePitch(samples: Float32Array, sr: number, from: number, length: number, lo = 60, hi = 2000): number {
  const minLag = Math.floor(sr / hi);
  const maxLag = Math.min(Math.floor(sr / lo), length - 1);
  let best = 0;
  let bestLag = 0;
  let energy = 0;
  for (let i = 0; i < length; i++) energy += samples[from + i]! * samples[from + i]!;
  if (energy < 1e-9) return 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let c = 0;
    for (let i = 0; i + lag < length; i++) c += samples[from + i]! * samples[from + i + lag]!;
    if (c > best) {
      best = c;
      bestLag = lag;
    }
  }
  return bestLag > 0 && best > 0.25 * energy ? sr / bestLag : 0;
}

// --- pictures --------------------------------------------------------------------------------------------

export interface Picture {
  width: number;
  height: number;
  /** RGBA, row by row. */
  data: Uint8ClampedArray;
}

function blank(width: number, height: number, r: number, g: number, b: number): Picture {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = 255;
  }
  return { width, height, data };
}

/** A waveform: the min and max of each column, centre line and ±1 guides. */
export function drawWaveform(samples: Float32Array, width: number, height: number): Picture {
  const pic = blank(width, height, 18, 20, 28);
  const set = (x: number, y: number, r: number, g: number, b: number): void => {
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    const o = (y * width + x) * 4;
    pic.data[o] = r;
    pic.data[o + 1] = g;
    pic.data[o + 2] = b;
  };
  const mid = (height - 1) / 2;
  for (let x = 0; x < width; x++) set(x, Math.round(mid), 60, 64, 80);
  const per = samples.length / width;
  for (let x = 0; x < width; x++) {
    let lo = 0;
    let hi = 0;
    const a = Math.floor(x * per);
    const b = Math.max(a + 1, Math.floor((x + 1) * per));
    for (let i = a; i < b && i < samples.length; i++) {
      const v = samples[i]!;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    const y0 = Math.round(mid - hi * mid);
    const y1 = Math.round(mid - lo * mid);
    for (let y = y0; y <= y1; y++) set(x, y, 120, 200, 255);
  }
  return pic;
}

/** A spectrogram picture, frequency up (linear to ``maxHz``), time right, dark to bright by dB. */
export function drawSpectrogram(samples: Float32Array, sr: number, width: number, height: number, maxHz = 12000, floorDb = -90): Picture {
  const size = 1024;
  const hop = Math.max(64, Math.floor((samples.length - size) / width));
  const spec = spectrogram(samples, sr, size, hop);
  const pic = blank(width, height, 0, 0, 0);
  const maxBin = Math.min(size / 2, Math.floor(maxHz / spec.binHz));
  for (let x = 0; x < width; x++) {
    const frame = spec.frames[Math.min(spec.frames.length - 1, Math.floor((x / width) * spec.frames.length))];
    if (!frame) continue;
    for (let y = 0; y < height; y++) {
      const bin = Math.min(maxBin, Math.floor(((height - 1 - y) / height) * maxBin));
      const db = frame[bin]!;
      const u = Math.min(1, Math.max(0, (db - floorDb) / -floorDb));
      // A heat ramp: black, violet, orange, white.
      const r = Math.min(255, Math.max(0, 255 * (u * 2.2 - 0.3)));
      const g = Math.min(255, Math.max(0, 255 * (u * 2.2 - 1.0)));
      const bl = Math.min(255, Math.max(0, 255 * (Math.sin(u * Math.PI) * 0.9 + (u > 0.85 ? (u - 0.85) * 4 : 0))));
      const o = (y * width + x) * 4;
      pic.data[o] = r;
      pic.data[o + 1] = g;
      pic.data[o + 2] = bl;
    }
  }
  return pic;
}

/** Stack pictures of the same width top to bottom with a thin gap. */
export function stack(pictures: Picture[], gap = 4): Picture {
  const width = Math.max(...pictures.map((p) => p.width));
  const height = pictures.reduce((a, p) => a + p.height, 0) + gap * (pictures.length - 1);
  const out = blank(width, height, 40, 40, 50);
  let y = 0;
  for (const p of pictures) {
    out.data.set(p.data, y * width * 4);
    y += p.height + gap;
  }
  return out;
}
