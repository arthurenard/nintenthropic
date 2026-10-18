/**
 * The browser the shooter clips are captured in: headless Chrome, muted, on the
 * GPU, loading the clip page from the dev server on port 4901.
 */
import { chromium } from "@playwright/test";

export const ORIGIN = "http://127.0.0.1:4901";

export async function launch() {
  return chromium.launch({
    channel: "chrome",
    headless: true,
    // Never a sound: the browser is muted, and nothing here plays audio.
    args: ["--mute-audio", "--use-angle=metal", "--ignore-gpu-blocklist", "--enable-gpu-rasterization", "--disable-renderer-backgrounding", "--disable-background-timer-throttling"],
  });
}
