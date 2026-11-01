// Proves a checkout reads hands exactly as another does: the same random plays (1 to 4 players, fists, open hands, item
// flicks, claps, cheers, hands lost and found, strangers walking through, hands crossing into a neighbour's column, tracker
// misses) are run through the LaneTracker, the wheel controls and the sim's samples, and everything that comes out is hashed.
// Run on two checkouts by tools/perf/input.mjs --same, the hashes must be equal. EQUIV_DUMP=file writes the whole output as
// lines instead (to find the first difference). __SRC__ is the checkout's src/; this is not part of the type-checked tree.
import { writeFileSync } from "node:fs";
import { makeLaneTracker } from "__SRC__/tracking/tracker";
import { tileRects } from "__SRC__/tracking/tiles";
import { wheelControl } from "__SRC__/kart/input/control";
import { WheelReader } from "__SRC__/kart/input/wheel";
import { handFrame, wheelHands, type SynthHand } from "__SRC__/kart/input/testHands";
import type { FromWorker, ToWorker } from "__SRC__/tracking/protocol";
import type { HandFrame, SeenHand } from "__SRC__/tracking/types";

const WIDTH = 1920;
const HEIGHT = 1080;
const FPS = 30;

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let hash = 2166136261;
const lines: string[] = [];
const dump = process.env.EQUIV_DUMP;
function feed(text: string): void {
  if (dump) lines.push(text);
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619) >>> 0;
}

class FakeWorker {
  listener: ((event: MessageEvent<FromWorker>) => void) | null = null;
  addEventListener(_type: "message", listener: (event: MessageEvent<FromWorker>) => void): void {
    this.listener = listener;
  }
  postMessage(_message: ToWorker): void {}
  terminate(): void {}
  answer(message: FromWorker): void {
    this.listener?.({ data: message } as MessageEvent<FromWorker>);
  }
}
class FakeFrame {
  constructor(
    readonly source: unknown,
    readonly init: unknown,
  ) {}
  close(): void {}
}
(globalThis as { VideoFrame?: unknown }).VideoFrame = FakeFrame;

const palmX = (hand: SeenHand): number => [0, 5, 9, 13, 17].reduce((sum, i) => sum + hand.landmarks[i]!.x, 0) / 5;

/** One play: random hands for `players` players for `seconds`, as the workers would answer, through everything. */
function play(players: number, seed: number, seconds: number): void {
  const random = rng(seed * 7919 + players);
  const aspect = WIDTH / HEIGHT;
  const tiles = players > 1 ? tileRects(players, WIDTH, HEIGHT) : [{ x: 0, y: 0, width: WIDTH, height: HEIGHT }];
  const workers = Array.from({ length: players }, () => new FakeWorker());
  let callback: ((now: number, metadata: { captureTime: number }) => void) | null = null;
  const video = {
    videoWidth: WIDTH,
    videoHeight: HEIGHT,
    requestVideoFrameCallback: (cb: typeof callback) => {
      callback = cb;
      return 1;
    },
    cancelVideoFrameCallback: () => {},
  } as unknown as HTMLVideoElement;
  const tracker = makeLaneTracker(workers.map((worker, i) => ({ worker: worker as unknown as Worker, delegate: i ? "CPU" : ("GPU" as const) })));
  let clock = 1000;
  const controls = Array.from({ length: players }, (_, i) => wheelControl(tracker, { seat: players > 1 ? { index: i, of: players } : null, aspect, now: () => clock }));
  // A reader fed the published frames directly too, with a whole-picture seat, to cover the one-player path whatever `players` is.
  const whole = new WheelReader({ aspect });
  tracker.subscribe((frame: HandFrame) => {
    feed(`F${JSON.stringify(frame)}`);
    whole.push(frame, clock);
  });
  tracker.start(video);
  // Per player: when their hands are lost until, and how they hold them.
  const state = Array.from({ length: players }, () => ({ lostUntil: 0, openUntil: 0, flickUntil: 0, cheerUntil: 0, clapUntil: 0, wander: 0 }));
  let tick = 1000;
  const frames = seconds * FPS;
  for (let k = 0; k < frames; k++) {
    const t = k / FPS;
    const at = 1000 + (k * 1000) / FPS;
    const hands: SynthHand[] = [];
    for (let i = 0; i < players; i++) {
      const s = state[i]!;
      if (random() < 0.01) s.lostUntil = t + 0.1 + random() * 1.2;
      if (random() < 0.012) s.openUntil = t + 0.2 + random() * 1.5;
      if (random() < 0.01) s.clapUntil = t + 0.25;
      if (random() < 0.012) s.flickUntil = t + 0.2 + random() * 0.4;
      if (random() < 0.004) s.cheerUntil = t + 0.9;
      if (random() < 0.004) s.wander = (random() - 0.5) * 0.3;
      if (t < s.lostUntil) continue;
      const cheer = t < s.cheerUntil;
      const open = t < s.openUntil || cheer;
      const span = (0.9 / players) * aspect * (0.35 + 0.1 * Math.sin(t)) + (t < s.clapUntil ? -0.1 : 0);
      const pair = wheelHands({
        angle: 40 * Math.sin(t * (0.8 + i * 0.3) + i) + (random() - 0.5) * 6,
        centre: [(i + 0.5) / players + s.wander * (i === players - 1 ? 0.5 : 1), (cheer ? 0.2 : 0.5) + 0.1 * Math.sin(t * 2 + i)],
        span: Math.max(0.05, span),
        fingers: open ? "open" : "fist",
        aspect,
        left: t < s.flickUntil && !open ? { fingers: "open" } : undefined,
      });
      hands.push(...pair);
    }
    // A stranger walking through now and then.
    if (random() < 0.05) hands.push(...wheelHands({ angle: 0, centre: [random(), 0.5], span: 0.1, aspect }).slice(0, 1));
    const frame = handFrame(hands, at, { aspect, jitter: 0.002, seed: seed + k });
    // Shuffle the hands (the tracker's order is its own).
    const shuffled = [...frame.hands].sort(() => random() - 0.5);
    const camera = { ...frame, hands: shuffled };
    clock = at;
    const due = callback!;
    callback = null;
    due(at, { captureTime: at });
    // Each worker answers, in a random order, with the hands of its tile (a hand missed now and then).
    const order = workers.map((_, i) => i).sort(() => random() - 0.5);
    for (const i of order) {
      if (random() < 0.15) continue;
      const tile = tiles[i]!;
      const mine = camera.hands
        .filter((hand) => palmX(hand) * WIDTH >= tile.x - 0.01 * WIDTH && palmX(hand) * WIDTH < tile.x + tile.width + 0.01 * WIDTH)
        .filter(() => random() > 0.04)
        .map((hand) => ({ ...hand, landmarks: hand.landmarks.map((p) => ({ x: (p.x * WIDTH - tile.x) / tile.width, y: p.y, z: (p.z * WIDTH) / tile.width })) }));
      clock = at + 8 + i * 3;
      workers[i]!.answer({ type: "result", sequence: k, capturedAt: at, hands: mine.slice(0, 2), inference: 20, face: false });
    }
    const until = at + 1000 / FPS;
    while (tick < until) {
      clock = tick;
      controls.forEach((control, i) => {
        feed(`S${i}${JSON.stringify(control.sample())}`);
        feed(`W${i}${JSON.stringify(control.wheel)}${JSON.stringify(control.fingers)}`);
      });
      feed(`O${JSON.stringify(whole.sample(clock))}`);
      tick += 1000 / 60;
    }
  }
  controls.forEach((control) => control.dispose());
  tracker.dispose();
}

const plays = Number(process.env.PLAYS ?? 12);
for (const players of [1, 2, 3, 4]) {
  for (let seed = 1; seed <= plays; seed++) play(players, seed, 12);
  console.log(`${players} players: hash ${hash.toString(16)}`);
}
console.log(`all: hash ${hash.toString(16)}`);
if (dump) writeFileSync(dump, lines.join("\n"));
