/**
 * Loads Grip Prix's modelled worlds (public/assets/kart/world-<theme>.glb) inside Node, with no browser: for tests only,
 * never imported by the game, so none of it reaches the bundle.
 *
 * The files are Draco-compressed. In a page three's DRACOLoader decodes them in a Web Worker; here a stand-in "worker"
 * runs the very same worker source (the decoder and its glue) in this thread, so the geometry that comes out is what the
 * game gets. The scene is then filed by name the way art.ts files it, for a test to hand back through `vi.mock` of art.ts.
 */
import type { Object3D } from "three";
import { DRACOLoader, DRACO_GLTF_CONFIG } from "three/addons/loaders/DRACOLoader.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { contractName } from "../../../engine/world/names";
import type { TrackTheme } from "../../track/geometry";

interface Files {
  readFileSync(path: string): { buffer: ArrayBuffer; byteOffset: number; byteLength: number; toString(encoding: string): string };
}
interface Urls {
  fileURLToPath(url: string): string;
}
interface Blobs {
  resolveObjectURL(url: string): Blob | undefined;
}

type Callbacks = Record<number, { resolve(value: unknown): void; reject(value: unknown): void }>;

/** One worker's worth of the Draco decoder, run in this thread. It speaks the DRACOLoader's protocol (init, decode). */
class InlineWorker {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  /** The bookkeeping DRACOLoader keeps on each of its workers. */
  _callbacks: Callbacks = {};
  _taskCosts: Record<number, number> = {};
  _taskLoad = 0;
  private readonly receive: (message: unknown) => void;

  constructor(source: string) {
    // The worker's own `self`: the typed arrays it names, and a postMessage that answers the loader.
    const self = {
      postMessage: (message: unknown) => {
        queueMicrotask(() => this.onmessage?.({ data: message }));
      },
      Float32Array,
      Int8Array,
      Int16Array,
      Int32Array,
      Uint8Array,
      Uint16Array,
      Uint32Array,
    };
    // `onmessage` is declared here so the worker's assignment lands on it and not on the global; `process`, `require`
    // and `window` are hidden so the decoder's glue takes its browser-worker path.
    const body = `var onmessage; var process; var require; var window; var importScripts;\n${source}\nreturn (data) => onmessage({ data });`;
    this.receive = new Function("self", body)(self) as (message: unknown) => void;
  }

  postMessage(message: unknown): void {
    this.receive(message);
  }

  terminate(): void {}
}

/** What DRACOLoader keeps inside (not in its type definitions). */
interface Internals {
  decoderConfig: Record<string, unknown>;
  workerPool: unknown[];
  workerSourceURL: string;
  _initDecoder(): Promise<void>;
}

/** The node:fs, node:url and node:buffer calls this needs, imported at run time so the browser-facing type check needs no Node types. */
async function nodeModules(): Promise<{ fs: Files; urls: Urls; blobs: Blobs }> {
  return {
    fs: (await import("node:fs" as string)) as Files,
    urls: (await import("node:url" as string)) as Urls,
    blobs: (await import("node:buffer" as string)) as Blobs,
  };
}

/** A DRACOLoader that reads its decoder from disk and runs it in place. */
function nodeDraco(node: { fs: Files; urls: Urls; blobs: Blobs }): DRACOLoader {
  const draco = new DRACOLoader().setDecoderPath(DRACO_GLTF_CONFIG as never).setWorkerLimit(1);
  const inside = draco as unknown as Internals & { _loadLibrary(url: string, responseType: string): Promise<string | ArrayBuffer>; _getWorker(taskID: number, taskCost: number): Promise<InlineWorker> };
  inside._loadLibrary = (url, responseType) => {
    const bytes = node.fs.readFileSync(node.urls.fileURLToPath(url));
    return Promise.resolve(responseType === "text" ? bytes.toString("utf8") : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  };
  // The one in-process worker, made once however many decodes ask for it at the same time.
  let worker: Promise<InlineWorker> | null = null;
  inside._getWorker = (taskID, taskCost) => {
    worker ??= inside._initDecoder().then(async () => {
      const blob = node.blobs.resolveObjectURL(inside.workerSourceURL);
      if (!blob) throw new Error("the Draco worker's source is gone");
      const made = new InlineWorker(await blob.text());
      // A copy of the config: the worker hangs its own callback on it.
      made.postMessage({ type: "init", decoderConfig: { ...inside.decoderConfig } });
      made.onmessage = (event) => {
        const message = event.data as { type: string; id: number };
        if (message.type === "decode") made._callbacks[message.id]!.resolve(message);
        else if (message.type === "error") made._callbacks[message.id]!.reject(message);
      };
      inside.workerPool.push(made);
      return made;
    });
    return worker.then((w) => {
      w._taskCosts[taskID] = taskCost;
      w._taskLoad += taskCost;
      return w;
    });
  };
  return draco;
}

/** The named nodes of one theme's world file, keyed by contract name ("landmark.<kind>", "scenery.<kind>.<n>"), as art.ts files them. */
export async function loadWorldArt(theme: TrackTheme): Promise<Map<string, Object3D>> {
  const node = await nodeModules();
  const draco = nodeDraco(node);
  const loader = new GLTFLoader().setDRACOLoader(draco);
  const file = node.urls.fileURLToPath(new URL(`../../../../public/assets/kart/world-${theme}.glb`, import.meta.url).href);
  const bytes = node.fs.readFileSync(file);
  const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const { scene } = await loader.parseAsync(data, "");
  const nodes = new Map<string, Object3D>();
  scene.traverse((o) => {
    const name = contractName(o);
    if (name && (name.startsWith("landmark.") || name.startsWith("scenery."))) nodes.set(name, o);
  });
  draco.dispose();
  return nodes;
}
