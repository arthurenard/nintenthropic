/**
 * Loads a game's glTF models and textures. Meshes may be Draco-compressed:
 * the glTF build of three's decoder (a third smaller than the general one),
 * whose files Vite serves and emits from three itself, runs in two workers.
 *
 * Downloaded bytes are kept for the life of the page, and every request
 * parses them afresh: a restarted game gets its own objects (a game disposes
 * what it loaded when it ends) without waiting on the network twice.
 */
import { SRGBColorSpace, TextureLoader, type Texture } from "three";
import { DRACOLoader, DRACO_GLTF_CONFIG } from "three/addons/loaders/DRACOLoader.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { AssetLoader, LoadedAsset } from "./types";
import { fetchBytes, siteUrl } from "./fetch";

export class Assets implements AssetLoader {
  private readonly gltfLoader: GLTFLoader;
  private readonly textureLoader = new TextureLoader();
  private readonly bytes = new Map<string, Promise<ArrayBuffer>>();
  private readonly draco: DRACOLoader;

  constructor() {
    this.draco = new DRACOLoader().setDecoderPath(DRACO_GLTF_CONFIG).setWorkerLimit(2);
    this.gltfLoader = new GLTFLoader().setDRACOLoader(this.draco);
  }

  async gltf(url: string, onProgress?: (fraction: number) => void): Promise<LoadedAsset> {
    const href = siteUrl(url);
    let pending = this.bytes.get(href);
    if (!pending) {
      pending = fetchBytes(href, onProgress);
      this.bytes.set(href, pending);
      // A failed download is not remembered: Try Again really tries again.
      pending.catch(() => this.bytes.delete(href));
    }
    const data = await pending;
    onProgress?.(1);
    const base = href.slice(0, href.lastIndexOf("/") + 1);
    const gltf = await this.gltfLoader.parseAsync(data, base);
    return { scene: gltf.scene, animations: gltf.animations };
  }

  /** A colour texture (sRGB), such as a sky. */
  async texture(url: string): Promise<Texture> {
    const texture = await this.textureLoader.loadAsync(siteUrl(url));
    texture.colorSpace = SRGBColorSpace;
    return texture;
  }

  dispose(): void {
    this.draco.dispose();
  }
}
