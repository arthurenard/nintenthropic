/**
 * Loads a game's glTF models and textures. Meshes may be Draco-compressed:
 * the glTF build of three's decoder (a third smaller than the general one),
 * whose files Vite serves and emits from three itself, runs in two workers.
 *
 * Downloaded bytes are kept for the life of the page, and every request
 * parses them afresh: a restarted game gets its own objects (a game disposes
 * what it loaded when it ends) without waiting on the network twice. What a
 * game's own teardown misses (a mesh parked out of the scene in a pool, a
 * texture held only by a shader) is let go by release(), which the host calls
 * when the game is put away.
 */
import { SRGBColorSpace, TextureLoader, type Texture } from "three";
import { DRACOLoader, DRACO_GLTF_CONFIG } from "three/addons/loaders/DRACOLoader.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { AssetLoader, LoadedAsset } from "./types";
import { fetchBytes, siteUrl } from "./fetch";
import { disposablesUnder, type Disposable } from "./world/scene";

export class Assets implements AssetLoader {
  private readonly gltfLoader: GLTFLoader;
  private readonly textureLoader = new TextureLoader();
  private readonly bytes = new Map<string, Promise<ArrayBuffer>>();
  private readonly draco: DRACOLoader;
  /**
   * The GPU-side resources of everything parsed since the last release():
   * listed as it arrives, because a game takes pieces out of its scenes
   * (the debris library keeps its parts loose), and a walk of the scene
   * later would no longer find them.
   */
  private readonly loaded = new Set<Disposable>();

  constructor() {
    this.draco = new DRACOLoader().setDecoderPath(DRACO_GLTF_CONFIG).setWorkerLimit(2);
    this.gltfLoader = new GLTFLoader().setDRACOLoader(this.draco);
  }

  /** A file's bytes, downloaded once for the life of the page (with fetchBytes' progress and stall watch). */
  private download(href: string, onProgress?: (fraction: number) => void): Promise<ArrayBuffer> {
    let pending = this.bytes.get(href);
    if (!pending) {
      pending = fetchBytes(href, onProgress);
      this.bytes.set(href, pending);
      // A failed download is not remembered: Try Again really tries again.
      pending.catch(() => this.bytes.delete(href));
    }
    return pending;
  }

  async gltf(url: string, onProgress?: (fraction: number) => void): Promise<LoadedAsset> {
    const href = siteUrl(url);
    const data = await this.download(href, onProgress);
    onProgress?.(1);
    const base = href.slice(0, href.lastIndexOf("/") + 1);
    const gltf = await this.gltfLoader.parseAsync(data, base);
    disposablesUnder(gltf.scene, this.loaded);
    return { scene: gltf.scene, animations: gltf.animations };
  }

  /**
   * A colour texture (sRGB), such as a sky. Its bytes come through
   * fetchBytes like every other download, so a stalled one gives up rather
   * than hold the loading bar forever; the image is then decoded from them.
   */
  async texture(url: string): Promise<Texture> {
    const href = siteUrl(url);
    const data = await this.download(href);
    const type = /\.webp$/i.test(href) ? "image/webp" : /\.png$/i.test(href) ? "image/png" : /\.jpe?g$/i.test(href) ? "image/jpeg" : "";
    const local = URL.createObjectURL(new Blob([data], type ? { type } : {}));
    try {
      const texture = await this.textureLoader.loadAsync(local);
      texture.colorSpace = SRGBColorSpace;
      this.loaded.add(texture);
      return texture;
    } finally {
      URL.revokeObjectURL(local);
    }
  }

  /**
   * Lets go of the GPU memory of everything loaded since the last call: the
   * geometries, materials and textures of every glTF scene (the pieces a game
   * cloned share them, so this frees those too) and every texture. Called
   * when a game is put away; a second call finds nothing left to do.
   */
  release(): void {
    for (const item of this.loaded) item.dispose();
    this.loaded.clear();
  }

  dispose(): void {
    this.release();
    this.draco.dispose();
  }
}
