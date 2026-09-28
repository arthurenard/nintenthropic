/**
 * Loading a game's art: its glTF models and textures, each through the
 * engine's protected download (GameContext.assets: real progress, a stalled
 * download given up after 20 s), weighed together into one progress bar.
 *
 * Every file is required. In production a file that does not load fails the
 * game's load with a DownloadError, which the page shows as "Couldn’t Load
 * the Game" with Try Again: a toy world is not a graceful way to fail in
 * front of a player. In development and tests a game may stand a
 * placeholder in for a missing file, built in code to the same contract.
 *
 * The placeholders must never reach a production download, so the game
 * (not this module) imports them, behind a check the bundler settles:
 *
 *     const kit = import.meta.env.MODE === "production" ? null : await import("./placeholder/index");
 *
 * and hands them over as `standIns`. With stand-ins to hand, only the files
 * that are really there are fetched; a dev server answers a missing path with
 * its index page, so "there" means a 200 that is not HTML.
 */
import type { Texture } from "three";
import { DownloadError } from "../fetch";
import type { GameContext, LoadedAsset } from "../types";

export interface ArtFile {
  /** Under the site's root: "assets/western/town.glb". */
  path: string;
  kind: "gltf" | "texture";
  /** Its share of the progress bar, roughly its size: the weights need not add to 1. */
  weight: number;
}

export interface ArtOptions {
  /** The game's name, for the console. */
  label: string;
  /**
   * Another folder to load from (a dev harness's ?assetBase=, to try an
   * export in progress): paths under `root` are looked for there instead.
   */
  base?: string | null;
  /** The folder the paths share, which `base` replaces: "assets/western/". */
  root?: string;
  /** Stand-ins will be offered for what is missing: probe for the files first. Never in production. */
  standIns?: boolean;
}

/** Is the file really there? A dev server answers a missing path with its index page. */
async function exists(href: string): Promise<boolean> {
  try {
    const res = await fetch(href, { method: "HEAD", cache: "no-cache" });
    if (!res.ok) return false;
    const type = res.headers.get("content-type") ?? "";
    return !type.includes("text/html");
  } catch {
    return false;
  }
}

/**
 * One game's art, file by file, reporting into one progress bar. `real`
 * says which files came from disk (the rest were stood in for; never in
 * production), for the dev harness and the tests.
 */
export class Art<N extends string> {
  readonly real: Record<N, boolean>;
  private readonly done: Record<N, number>;
  private readonly names: N[];

  constructor(
    private readonly ctx: GameContext,
    private readonly files: Readonly<Record<N, ArtFile>>,
    private readonly options: ArtOptions,
    private readonly onProgress: (fraction: number) => void,
  ) {
    this.names = Object.keys(files) as N[];
    this.real = Object.fromEntries(this.names.map((n) => [n, true])) as Record<N, boolean>;
    this.done = Object.fromEntries(this.names.map((n) => [n, 0])) as Record<N, number>;
  }

  /** Where a file is fetched from. */
  url(name: N): string {
    const path = this.files[name].path;
    const { base, root } = this.options;
    if (base && root && path.startsWith(root)) return `${base}${path.slice(root.length)}`;
    if (base && !root) return `${base}${path}`;
    const site = (import.meta.env?.BASE_URL as string | undefined) ?? "/";
    return `${site}${path}`;
  }

  /** With stand-ins to hand, finds out which files are really there, so only those are fetched. */
  async probe(): Promise<void> {
    if (!this.options.standIns) return;
    const present = await Promise.all(this.names.map((n) => exists(this.url(n))));
    this.names.forEach((n, i) => (this.real[n] = present[i] as boolean));
  }

  /** A file is done (or stands done: a variant not needed this time). */
  finish(name: N): void {
    this.done[name] = 1;
    this.report();
  }

  private report(): void {
    let sum = 0;
    for (const n of this.names) sum += this.files[n].weight * this.done[n];
    this.onProgress(Math.min(0.99, sum));
  }

  /** A file that would not load, as the page expects to hear of it. */
  private failed(href: string, err: unknown): DownloadError {
    if (err instanceof DownloadError) return err;
    console.warn(`${this.options.label}: ${href} would not load.`, err);
    return new DownloadError(href, null);
  }

  /**
   * A model. If it is missing or will not load, `standIn` (outside
   * production only) makes its placeholder; without one the load fails.
   */
  async gltf(name: N, standIn?: (() => LoadedAsset) | null): Promise<LoadedAsset> {
    const href = this.url(name);
    if (this.real[name]) {
      try {
        const asset = await this.ctx.assets.gltf(href, (f) => {
          this.done[name] = f;
          this.report();
        });
        this.finish(name);
        return asset;
      } catch (err) {
        if (!standIn) throw this.failed(href, err);
        console.warn(`${this.options.label}: ${this.files[name].path} would not load; using the placeholder.`, err);
        this.real[name] = false;
      }
    }
    if (!standIn) throw new DownloadError(href, null);
    const asset = standIn();
    this.finish(name);
    return asset;
  }

  /** A colour texture (a sky, a poster), with the same terms as gltf(). */
  async texture(name: N, standIn?: (() => Texture) | null): Promise<Texture> {
    const href = this.url(name);
    if (this.real[name]) {
      try {
        const texture = await this.ctx.assets.texture(href);
        this.finish(name);
        return texture;
      } catch (err) {
        if (!standIn) throw this.failed(href, err);
        console.warn(`${this.options.label}: ${this.files[name].path} would not load; using the placeholder.`, err);
        this.real[name] = false;
      }
    }
    if (!standIn) throw new DownloadError(href, null);
    const texture = standIn();
    this.finish(name);
    return texture;
  }
}
