/**
 * What a menu screen stands on. Most stand on the sky (menu.css's `.menu-sky`), the driver's own screen on a bright studio
 * (CSS only), and the screens that belong to a track (the lobby, the results, the standings) on that track's postcard,
 * blurred, dimmed and veiled, so the cards over it keep their contrast. Choosing another track crossfades to its postcard:
 * the new picture comes in over the old one, which goes only once it has come, so the screen never dips to the sky between.
 *
 * Where the postcard is missing (a track whose picture was never made, or a slow or failed fetch) the sky stays, and the
 * page does not change its glass. The page's state is `body[data-backdrop="photo"]` while a postcard shows.
 */
import { postcardUrl } from "./trackArt";

/** How long a picture takes to fade in, ms (the CSS transition of `.menu-photo img`). */
const FADE = 900;

export class Backdrop {
  private readonly layers: HTMLImageElement[] = [];
  /** The layer in view, or -1. */
  private front = -1;
  /** The track asked for last (a postcard may still be on its way), or null. */
  private wanted: string | null = null;
  private timer = 0;

  constructor(private readonly box: HTMLElement) {
    for (let i = 0; i < 2; i++) {
      const image = document.createElement("img");
      image.alt = "";
      image.decoding = "async";
      image.width = 960;
      image.height = 540;
      image.draggable = false;
      this.box.append(image);
      this.layers.push(image);
    }
  }

  /** Shows this track's postcard behind the screen; null goes back to the sky. */
  set(trackId: string | null): void {
    if (trackId === this.wanted) return;
    this.wanted = trackId;
    window.clearTimeout(this.timer);
    if (!trackId) {
      this.clear();
      return;
    }
    const next = this.front === 0 ? 1 : 0;
    const layer = this.layers[next]!;
    layer.classList.remove("on", "drop");
    layer.onload = () => {
      // A newer choice has been made while this one came: it is not wanted any more.
      if (this.wanted !== trackId) return;
      this.bring(next);
    };
    layer.onerror = () => {
      if (this.wanted !== trackId) return;
      // No postcard for this track: the sky, whatever was showing goes.
      this.clear();
    };
    layer.src = postcardUrl(trackId);
    // Already in the cache, or decoded: `onload` may not come again for the same address.
    if (layer.complete && layer.naturalWidth > 0) this.bring(next);
  }

  private bring(index: number): void {
    const old = this.front;
    const layer = this.layers[index]!;
    layer.style.zIndex = "2";
    layer.classList.add("on");
    this.front = index;
    document.body.dataset.backdrop = "photo";
    if (old >= 0 && old !== index) {
      const gone = this.layers[old]!;
      gone.style.zIndex = "1";
      // The old picture leaves once the new one has fully come, at once (a fade-out would dip to the sky).
      this.timer = window.setTimeout(() => {
        gone.classList.add("drop");
        gone.classList.remove("on");
      }, FADE + 60);
    }
  }

  private clear(): void {
    delete document.body.dataset.backdrop;
    this.front = -1;
    for (const layer of this.layers) {
      layer.classList.remove("on", "drop");
      layer.style.zIndex = "";
    }
  }
}
