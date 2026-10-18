/**
 * The guns: the player's revolver and its mechanics, the gang's revolvers and
 * rifles, and the bullets that pass by. These carry the gunfight, so they are
 * built in the most layers: an edge, a crack, a body, a sub, a tail.
 *
 * Space is mostly left to the engine: the street's slap-back and the town's
 * reverb are added at play time (see ../routing.ts), so the same shot sounds
 * close in the player's hand and 40 m away in a window.
 */
import { biquad, highpass, lowpass, svf } from "../dsp/filters";
import { type Mono, adsr, normalize, perc, shapeBy } from "../dsp/signal";
import { addMetal, addMode, bandNoise, click, decayInPlace, white } from "../dsp/sources";
import type { Take } from "../dsp/take";
import { burst, nWave, saturate, scatter, thump } from "./kit";

/**
 * The player's revolver, heard from behind it: a .45 with a black-powder
 * load. An edge (the blast's front, a sharp N-wave and a bright click), a
 * crack of broadband noise, the *whoomph* of the powder in the mids, a
 * falling boom and a sub for the chest, then a rolling low tail. The first
 * 40 ms are driven into a soft saturation, as the real thing overloads every
 * microphone it meets; that density is what makes it read as loud.
 */
export function revolverShot(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(t.L(1.25));
  // The blast: edge, crack and powder, driven together into saturation.
  const head = t.canvas(0.25);
  t.put(head, nWave(t, t.j(0.00045, 0.2)), 0, t.g(1.0));
  t.put(head, click(t.sr, r, 0.004, 900, t.c(15000)), 0, t.g(1.0));
  t.put(head, burst(t, 0.2, 280 * t.p, t.c(9000), 0.0003, t.d(0.02), 2, -1), 0, t.g(1.0));
  t.put(head, burst(t, 0.18, 420 * t.p, t.c(2400), 0.0012, t.d(0.034), 2), 0.001, t.g(0.7));
  saturate(head, 2.6);
  t.put(out, head, 0, 1);
  // The body stays clean: saturating a low sine only squares it into mud
  // and buries the crack under it.
  t.put(out, thump(t, 0.22, 170 * t.p, 55 * t.p, 0.0015, t.d(0.05), 0.45), 0.001, t.g(0.42));
  t.put(out, burst(t, 0.25, 50, 320 * t.p, 0.002, t.d(0.06), 4), 0.001, t.g(0.45));
  t.put(out, thump(t, 0.35, 58 * t.p, 38 * t.p, 0.004, t.d(0.08), 0.6), 0.003, t.g(0.28));
  // The tail: the blast rolling off the ground and the nearest walls, a slow
  // low wash that rises over 25 ms and dies far slower than the crack.
  const tail = bandNoise(t.n(1.1), t.sr, r, 80, t.c(1600), 2);
  biquad(tail, t.sr, "lowshelf", 200, 0.7, 2);
  normalize(tail);
  adsr(tail, t.sr, 0.025, 0.08, 0.7, 0.6);
  decayInPlace(tail, t.sr, 0, t.d(0.24));
  t.put(out, tail, 0.012, t.g(0.2));
  // A whisper of the frame ringing: steel, not a synth.
  addMetal(out, t.sr, r, 0.001, 3150 * t.p, t.d(0.03), 0.012);
  return out;
}

/**
 * A gang member's revolver, heard from down the street: the crack is still
 * there but duller, the powder's pop sits higher, the sub is mostly gone,
 * and the rolling tail is longer (distance is mostly reverberation). The
 * engine darkens and delays it further by the real distance.
 */
export function banditShot(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(t.L(1.5));
  const head = t.canvas(0.25);
  t.put(head, nWave(t, t.j(0.0004, 0.2)), 0, t.g(0.5));
  t.put(head, burst(t, 0.16, 350 * t.p, t.c(6000), 0.0004, t.d(0.02), 2, -2), 0, t.g(1.0));
  t.put(head, burst(t, 0.16, 500 * t.p, t.c(2600), 0.001, t.d(0.035), 2), 0.001, t.g(0.9));
  saturate(head, 1.8);
  t.put(out, head, 0, 1);
  t.put(out, thump(t, 0.2, 230 * t.p, 75 * t.p, 0.001, t.d(0.045), 0.5), 0.001, t.g(0.35));
  t.put(out, burst(t, 0.3, 50, 320, 0.002, t.d(0.08), 4), 0.002, t.g(0.4));
  const tail = bandNoise(t.n(1.35), t.sr, r, 90, t.c(1100), 2);
  normalize(tail);
  adsr(tail, t.sr, 0.035, 0.1, 0.75, 0.7);
  decayInPlace(tail, t.sr, 0, t.d(0.36));
  t.put(out, tail, 0.015, t.g(0.4));
  // Two soft reports off the nearest facades, already fused into the shot.
  for (const at of [t.j(0.045, 0.3), t.j(0.1, 0.25)]) {
    const slap = burst(t, 0.08, 200, t.c(1800), 0.001, t.d(0.02), 2);
    t.put(out, slap, at, t.g(0.22) * r.sign());
  }
  return out;
}

/**
 * A lever-action rifle: a harder, brighter crack than a revolver, a deeper
 * and longer boom, a long tail, and the lever worked a moment later.
 */
export function rifleShot(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(t.L(1.7));
  const head = t.canvas(0.3);
  t.put(head, nWave(t, t.j(0.0005, 0.2)), 0, t.g(1.0));
  t.put(head, click(t.sr, r, 0.003, 1500, 15000), 0, t.g(1.1));
  t.put(head, burst(t, 0.14, 600 * t.p, t.c(10000), 0.0003, t.d(0.016), 2, 1), 0, t.g(1.0));
  t.put(head, burst(t, 0.2, 300 * t.p, t.c(2000), 0.001, t.d(0.04), 2), 0.001, t.g(0.6));
  saturate(head, 2.4);
  t.put(out, head, 0, 1);
  t.put(out, thump(t, 0.28, 165 * t.p, 46 * t.p, 0.0015, t.d(0.065), 0.45), 0.001, t.g(0.45));
  t.put(out, thump(t, 0.4, 52 * t.p, 34 * t.p, 0.004, t.d(0.1), 0.6), 0.003, t.g(0.28));
  const tail = bandNoise(t.n(1.5), t.sr, r, 80, t.c(1800), 2);
  normalize(tail);
  adsr(tail, t.sr, 0.03, 0.1, 0.7, 0.7);
  decayInPlace(tail, t.sr, 0, t.d(0.34));
  t.put(out, tail, 0.01, t.g(0.38));
  // The lever, down and up: two steel clacks, a little quieter than the room.
  const lever = t.j(0.42, 0.15);
  leverClack(out, t, lever, 1800, 0.05);
  leverClack(out, t, lever + t.j(0.12, 0.2), 2300, 0.065);
  return out;
}

function leverClack(out: Mono, t: Take, at: number, base: number, gain: number): void {
  t.put(out, click(t.sr, t.rng, 0.003, base * 0.5, 9000), at, gain);
  addMetal(out, t.sr, t.rng, at, base * t.p, t.d(0.012), gain * 0.9);
}

/**
 * The hammer falling on an empty chamber: the trigger's small tick, then the
 * hammer's snap a few milliseconds later — a bright steel strike with a
 * short ring and a knock of the frame. Small, dry, final.
 */
export function revolverDry(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(0.3);
  t.put(out, click(t.sr, r, 0.002, 2500, 12000), 0, t.g(0.25));
  const at = t.j(0.009, 0.3);
  t.put(out, click(t.sr, r, 0.004, 1200, t.c(14000)), at, t.g(1.0));
  const snap = bandNoise(t.n(0.02), t.sr, r, 1500, t.c(9000), 2);
  svf(snap, t.sr, "bp", 2700 * t.p, 3);
  normalize(snap);
  decayInPlace(snap, t.sr, 0.0002, 0.0035);
  t.put(out, snap, at, t.g(0.9));
  addMetal(out, t.sr, r, at, 2450 * t.p, t.d(0.014), 0.45, [1, 1.52, 2.4, 3.1]);
  t.put(out, burst(t, 0.04, 150, 900, 0.0005, 0.006, 2), at, t.g(0.5));
  return out;
}

/**
 * Thumbing the hammer back on a single-action: the hand and pawl scraping
 * round the cylinder, two thin clicks as the hammer passes its notches, and
 * the heavy seat of full cock as the bolt drops into the cylinder. Four
 * different pieces of steel, so it reads as a mechanism and not one click
 * three times.
 */
export function revolverCock(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(t.L(0.3));
  // The pawl pushing the cylinder round: a short scrape with a hollow body.
  const scrape = white(t.n(t.L(0.07)), r);
  highpass(scrape, t.sr, 1100 * t.p, 2);
  svf(scrape, t.sr, "bp", (u) => (1500 + 700 * u) * t.p, 2.5);
  normalize(scrape);
  adsr(scrape, t.sr, 0.02, 0.03, 0.8, 0.015);
  t.put(out, scrape, 0.004, t.g(0.28));
  // Two thin notch clicks.
  let at = t.j(0.022, 0.3);
  for (let k = 0; k < 2; k++) {
    const tick = bandNoise(t.n(0.01), t.sr, r, 2200 * t.p, t.c(14000), 2);
    svf(tick, t.sr, "bp", 3300 * t.p * r.range(0.95, 1.05), 4);
    normalize(tick);
    decayInPlace(tick, t.sr, 0.0001, 0.0022);
    t.put(out, tick, at, t.g(0.55 + 0.1 * k));
    addMetal(out, t.sr, r, at, 3400 * t.p * r.range(0.96, 1.04), t.d(0.006), 0.2);
    at += t.j(0.03, 0.3);
  }
  // Full cock: the bolt drops into the cylinder notch — heavier and lower.
  const seat = at + t.j(0.045, 0.25);
  const home = bandNoise(t.n(0.02), t.sr, r, 350 * t.p, t.c(7000), 2);
  svf(home, t.sr, "bp", 950 * t.p, 2.2);
  normalize(home);
  decayInPlace(home, t.sr, 0.0002, 0.005);
  t.put(out, home, seat, t.g(1.0));
  t.put(out, click(t.sr, r, 0.003, 1200 * t.p, t.c(11000)), seat, t.g(0.75));
  addMetal(out, t.sr, r, seat, 2150 * t.p, t.d(0.016), 0.45);
  // The spring's thin ring between the click and the seat.
  addMode(out, t.sr, seat + 0.002, 5400 * t.p, 0.05, t.d(0.022), r.range(0, 6));
  addMode(out, t.sr, seat + 0.002, 5418 * t.p, 0.05, t.d(0.018), r.range(0, 6));
  t.put(out, burst(t, 0.03, 120, 700, 0.0005, t.d(0.006), 4), seat, t.g(0.5));
  return out;
}

/**
 * The reload: the loading gate flicked open, the cylinder spun with the
 * thumb — a ratchet of clicks slowing as it coasts — and the snap of the
 * gate shut and the hammer eased. About 0.9 s, the length of the reload.
 */
export function reloadSpin(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(t.L(1.0));
  // The gate: a short bright slide and a tick.
  const slide = white(t.n(0.05), r);
  svf(slide, t.sr, "bp", (u) => (2600 + 1600 * u) * t.p, 3);
  normalize(slide);
  adsr(slide, t.sr, 0.008, 0.02, 0.6, 0.015);
  t.put(out, slide, 0, t.g(0.35));
  t.put(out, click(t.sr, r, 0.003, 2000, 12000), 0.045, t.g(0.6));
  addMetal(out, t.sr, r, 0.045, 3900 * t.p, t.d(0.008), 0.3);
  // The spin: clicks whose rate falls from ~30 Hz as the cylinder coasts.
  const start = t.j(0.1, 0.15);
  const stop = start + t.L(0.52);
  const rate0 = r.range(26, 34);
  const rate1 = r.range(7, 10);
  let at = start;
  while (at < stop) {
    const u = (at - start) / (stop - start);
    const level = 0.5 * (1 - 0.5 * u) * r.range(0.75, 1.1);
    t.put(out, click(t.sr, r, 0.0018, 2500, 13000), at, level * 0.8);
    addMode(out, t.sr, at, 4700 * t.p * r.range(0.98, 1.02), level * 0.35, 0.004, r.range(0, 6));
    addMode(out, t.sr, at, 7300 * t.p * r.range(0.98, 1.02), level * 0.15, 0.0025, r.range(0, 6));
    const rate = rate0 * Math.pow(rate1 / rate0, u);
    at += (1 / rate) * r.range(0.93, 1.07);
  }
  // Under the ratchet, the whir of the cylinder on its pin.
  const whir = white(t.n(stop - start), r);
  svf(whir, t.sr, "bp", 1800 * t.p, 1.5);
  normalize(whir);
  shapeBy(whir, (u) => Math.sin(Math.PI * Math.min(1, u * 1.15)) * (1 - 0.6 * u));
  t.put(out, whir, start, t.g(0.06));
  // The snap shut: the heaviest event, then the frame's knock.
  const snap = stop + t.j(0.08, 0.2);
  const home = bandNoise(t.n(0.025), t.sr, r, 300 * t.p, t.c(8000), 2);
  svf(home, t.sr, "bp", 1100 * t.p, 2);
  normalize(home);
  decayInPlace(home, t.sr, 0.0002, 0.006);
  t.put(out, home, snap, t.g(1.1));
  t.put(out, click(t.sr, r, 0.004, 900, t.c(12000)), snap, t.g(0.9));
  addMetal(out, t.sr, r, snap, 1950 * t.p, t.d(0.02), 0.55);
  t.put(out, burst(t, 0.05, 90, 600, 0.0005, t.d(0.01), 4), snap, t.g(0.7));
  return out;
}

/**
 * A bullet passing the ear: the supersonic crack — the shock wave's N-wave,
 * a fraction of a millisecond, and its bounce off the ground just after —
 * then the air torn behind it, a band of noise sweeping down as it recedes.
 */
export function bulletWhiz(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(t.L(0.55));
  t.put(out, nWave(t, t.j(0.0003, 0.25)), 0.002, t.g(1.0));
  t.put(out, nWave(t, t.j(0.0003, 0.25)), 0.002 + t.j(0.0035, 0.4), t.g(0.45));
  t.put(out, click(t.sr, r, 0.002, 3000, 16000), 0.002, t.g(0.5));
  // The tear: noise band-passed around a centre falling with the Doppler shift.
  const len = t.n(t.L(0.4));
  const tear = white(len, r);
  const hi = t.c(5200) * t.p;
  const lo = hi * r.range(0.22, 0.32);
  svf(tear, t.sr, "bp", (u) => lo + (hi - lo) * Math.pow(1 - u, 2.2), 2.2);
  normalize(tear);
  shapeBy(tear, (u) => Math.min(1, u * 40) * Math.exp(-u * 5.5));
  t.put(out, tear, 0.004, t.g(0.55));
  // A thin whistle inside it: the bullet's own tone, tumbling a little.
  const whistle = white(len, r);
  svf(whistle, t.sr, "bp", (u) => (lo + (hi - lo) * Math.pow(1 - u, 2.2)) * 0.7, 18);
  normalize(whistle);
  const flutter = r.range(90, 160);
  shapeBy(whistle, (u) => Math.min(1, u * 30) * Math.exp(-u * 7) * (0.7 + 0.3 * Math.sin(2 * Math.PI * flutter * u * 0.4)), 8);
  t.put(out, whistle, 0.006, t.g(0.22));
  return out;
}

/**
 * The ricochet: a spark off stone or iron, then the whine — a deformed bullet
 * tumbling away, its pitch falling as it recedes and wobbling as it turns,
 * which is where the *pyeeow* comes from. Airy rather than a pure tone: the
 * whine is noise tuned narrow around the pitch, with a thin sine inside.
 */
export function ricochet(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(t.L(0.95));
  t.put(out, click(t.sr, r, 0.003, 1500, 14000), 0, t.g(1.1));
  t.put(out, burst(t, 0.05, 2000, t.c(11000), 0.0003, 0.007), 0, t.g(0.7));
  t.put(out, burst(t, 0.05, 300, 2200, 0.0005, 0.01), 0, t.g(0.45));
  scatter(out, t, 4, 0.01, 0.12, 1500, 7000, 0.18);
  const len = t.n(t.L(r.range(0.55, 0.8)));
  const f0 = r.range(2300, 3500) * t.p;
  const end = r.range(0.3, 0.42);
  const tumble = r.range(24, 42);
  const fm = r.range(0.015, 0.03);
  const freq = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const u = i / len;
    // The pitch falls from the moment it leaves the surface — steadily, as
    // an exponential — which is what the ear knows as a ricochet.
    const recede = Math.pow(end, Math.pow(u, 0.85));
    freq[i] = f0 * recede * (1 + fm * Math.sin((2 * Math.PI * tumble * i) / t.sr));
  }
  const tone = new Float32Array(len);
  let ph = 0;
  for (let i = 0; i < len; i++) {
    tone[i] = Math.sin(ph) + 0.22 * Math.sin(2 * ph + 0.7);
    ph += (2 * Math.PI * freq[i]!) / t.sr;
  }
  // The air around the tone: noise tuned tightly to it (a narrow band, and
  // low-passed so the band-pass's shallow skirts do not leak hiss).
  const air = svf(white(len, r), t.sr, "bp", freq, 30);
  lowpass(air, t.sr, 6000, 2);
  normalize(air);
  const whine = new Float32Array(len);
  const am = r.range(0.2, 0.4);
  for (let i = 0; i < len; i++) {
    const u = i / len;
    const spin = 1 - am + am * Math.sin((2 * Math.PI * tumble * i) / t.sr + 1);
    // Louder as it leaves the surface, then falling away with the distance.
    const env = Math.min(1, u * 25) / (1 + 3.5 * u);
    whine[i] = (0.65 * tone[i]! + 0.6 * air[i]!) * spin * env;
  }
  perc(whine, t.sr, 0.01, 10);
  lowpass(whine, t.sr, 9000, 2);
  t.put(out, whine, t.j(0.012, 0.3), t.g(0.6));
  return out;
}
