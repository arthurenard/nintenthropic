// The page's side of reading N players on one camera, end to end in node: the LaneTracker (tracker.ts) handed a camera
// frame at 30 a second, N stand-in workers answering with the hands of their tile, N wheelControls (the real glue)
// reading what is published, the sim sampling each at 60 Hz and the race / HUD asking each one's status (`.wheel`) once
// per animation frame. CPU time of the process (the machine is shared) and bytes allocated (no scavenge in a run).
// Run by tools/perf/input.mjs, which bundles it against a checkout's src/ (__SRC__ is that checkout's); it is not part of the
// type-checked tree.
import { Session } from "node:inspector";
import { makeLaneTracker } from "__SRC__/tracking/tracker";
import { tileRects } from "__SRC__/tracking/tiles";
import { wheelControl } from "__SRC__/kart/input/control";
import { handFrame, wheelHands, type SynthHand } from "__SRC__/kart/input/testHands";
import type { FromWorker, ToWorker } from "__SRC__/tracking/protocol";
import type { SeenHand } from "__SRC__/tracking/types";

const SECONDS = Number(process.env.SECONDS ?? 6);
const FPS = 30;
const PASSES = Number(process.env.PASSES ?? 25);
const ONLY = process.env.ONLY ? process.env.ONLY.split(",").map(Number) : [1, 2, 3, 4];
const WIDTH = 1920;
const HEIGHT = 1080;

class FakeWorker {
  frames = 0;
  listener: ((event: MessageEvent<FromWorker>) => void) | null = null;
  addEventListener(_type: "message", listener: (event: MessageEvent<FromWorker>) => void): void {
    this.listener = listener;
  }
  postMessage(message: ToWorker): void {
    if (message.type === "frame") this.frames++;
  }
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

const palmX = (hand: SeenHand): number => [0, 5, 9, 13, 17].reduce((sum, i) => sum + hand.landmarks[i]!.x, 0) / 5;

/** Per camera frame, per tile: the hands in that tile's own picture, as a worker would answer. */
function answers(players: number): SeenHand[][][] {
  const aspect = WIDTH / HEIGHT;
  const tiles = players > 1 ? tileRects(players, WIDTH, HEIGHT) : [{ x: 0, y: 0, width: WIDTH, height: HEIGHT }];
  const out: SeenHand[][][] = [];
  for (let k = 0; k < SECONDS * FPS; k++) {
    const t = k / FPS;
    const hands: SynthHand[] = [];
    for (let i = 0; i < players; i++) {
      const open = (Math.floor(t / 2) + i) % 5 === 4;
      hands.push(
        ...wheelHands({
          angle: 25 * Math.sin(t * 1.3 + i * 1.7),
          centre: [(i + 0.5) / players, 0.55],
          span: Math.min(0.5, (0.3 * 4) / players / 2 + 0.1),
          fingers: open ? "open" : "fist",
          aspect,
        }),
      );
    }
    const frame = handFrame(hands, 1000 + (k * 1000) / FPS, { aspect, jitter: 0.002 });
    out.push(
      tiles.map((tile) =>
        frame.hands
          .filter((hand) => palmX(hand) * WIDTH >= tile.x && palmX(hand) * WIDTH < tile.x + tile.width)
          .map((hand) => ({
            ...hand,
            landmarks: hand.landmarks.map((p) => ({ x: (p.x * WIDTH - tile.x) / tile.width, y: p.y, z: (p.z * WIDTH) / tile.width })),
          })),
      ),
    );
  }
  return out;
}

type Mode = "bare" | "push" | "input" | "status";

function run(players: number, per: SeenHand[][][], mode: Mode) {
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
  const tracker =
    players > 1
      ? makeLaneTracker(workers.map((worker, i) => ({ worker: worker as unknown as Worker, delegate: i ? "CPU" : ("GPU" as const) })))
      : makeLaneTracker([{ worker: workers[0] as unknown as Worker, delegate: "GPU" }]);
  let clock = 1000;
  const controls = mode === "bare" ? [] : Array.from({ length: players }, (_, i) => wheelControl(tracker, { seat: players > 1 ? { index: i, of: players } : null, aspect: WIDTH / HEIGHT, now: () => clock }));
  tracker.start(video);
  let tick = 1000;
  let sink = 0;
  const cpu0 = process.cpuUsage();
  const heap0 = process.memoryUsage().heapUsed;
  for (let k = 0; k < per.length; k++) {
    const at = 1000 + (k * 1000) / FPS;
    clock = at;
    // The camera delivers a frame: every lane is handed its column.
    const due = callback!;
    callback = null;
    due(at, { captureTime: at });
    // Each worker answers, one after another, a little later.
    workers.forEach((worker, i) => {
      clock = at + 8 + i * 4;
      worker.answer({ type: "result", sequence: k, capturedAt: at, hands: per[k]![i]!, inference: 20, face: false });
    });
    if (mode === "bare" || mode === "push") continue;
    const until = at + 1000 / FPS;
    while (tick < until) {
      clock = tick;
      for (const control of controls) {
        sink += control.sample().steer;
        if (mode === "status") sink += control.wheel.steer;
      }
      tick += 1000 / 60;
    }
  }
  const cpu1 = process.cpuUsage(cpu0);
  const heap1 = process.memoryUsage().heapUsed;
  if (sink === 0.123) console.log(sink);
  controls.forEach((control) => control.dispose());
  tracker.dispose();
  return { cpu: (cpu1.user + cpu1.system) / 1000, bytes: heap1 - heap0 };
}

(globalThis as { VideoFrame?: unknown }).VideoFrame = FakeFrame;
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor((xs.length - 1) / 2)]!;

/** HEAPPROF=1: where the garbage comes from (the sampling heap profiler, young garbage included). */
async function allocations(work: () => void): Promise<void> {
  const session = new Session();
  session.connect();
  const post = (method: string, params?: object) => new Promise<any>((resolve, reject) => session.post(method, params, (error, result) => (error ? reject(error) : resolve(result))));
  await post("HeapProfiler.enable");
  await post("HeapProfiler.startSampling", { samplingInterval: 64, includeObjectsCollectedByMinorGC: true, includeObjectsCollectedByMajorGC: true });
  work();
  const { profile } = await post("HeapProfiler.stopSampling");
  const by = new Map<string, number>();
  let total = 0;
  const walk = (node: any): void => {
    const key = `${node.callFrame.functionName || "(anon)"} ${String(node.callFrame.url).split("/").pop()}:${node.callFrame.lineNumber + 1}`;
    by.set(key, (by.get(key) ?? 0) + node.selfSize);
    total += node.selfSize;
    node.children.forEach(walk);
  };
  walk(profile.head);
  for (const [key, bytes] of [...by].sort((a, b) => b[1] - a[1]).slice(0, 22)) console.log(`${((100 * bytes) / total).toFixed(1).padStart(5)}%  ${(bytes / 1024).toFixed(0).padStart(7)} KB  ${key}`);
  console.log(`total ${(total / 1024).toFixed(0)} KB`);
}

if (process.env.HEAPPROF) {
  const players = ONLY[0]!;
  const per = answers(players);
  const mode = (process.env.MODES ?? "status") as Mode;
  run(players, per, mode);
  await allocations(() => {
    for (let p = 0; p < 3; p++) run(players, per, mode);
  });
  process.exit(0);
}

for (const players of ONLY) {
  const per = answers(players);
  const line: string[] = [];
  for (const mode of (process.env.MODES ? process.env.MODES.split(",") : ["bare", "push", "input", "status"]) as Mode[]) {
    run(players, per, mode); // warm
    const rows: ReturnType<typeof run>[] = [];
    for (let p = 0; p < PASSES; p++) {
      (globalThis as { gc?: () => void }).gc?.();
      rows.push(run(players, per, mode));
    }
    const cpu = rows.map((r) => r.cpu / SECONDS);
    const bytes = rows.map((r) => r.bytes / SECONDS / 1024);
    line.push(`${mode}: cpu ${median(cpu).toFixed(3)} (min ${Math.min(...cpu).toFixed(3)}) ms/s, ${median(bytes).toFixed(0)} KB/s`);
  }
  console.log(`${players} player${players > 1 ? "s" : ""}: ${line.join(" | ")}`);
}
