/**
 * The podium on its own (src/kart/render/podium.html): three winners, the
 * trophies, confetti, the camera swinging. For judging the ceremony's look.
 *
 *   ?calm=1       reduced motion
 *   &t=4          jump the clock ahead this many seconds (for a still picture)
 */
import { loadKartArt } from "./art";
import { createPodium } from "./podium";

const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const params = new URLSearchParams(location.search);
// The modelled art first (what of it exists), as the game loads it before a race.
loadKartArt("meadow").then(start, start);

function start(): void {
  const podium = createPodium(canvas, { reduceMotion: params.get("calm") === "1" });
  podium.show([
    { name: "Kit", colour: "#FF453A" },
    { name: "Mochi", colour: "#0A84FF" },
    { name: "Pebble", colour: "#FF9F0A" },
  ]);
  const fit = () => podium.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1);
  fit();
  window.addEventListener("resize", fit);
  let last = performance.now();
  const ahead = Number(params.get("t") ?? 0);
  for (let t = 0; t < ahead; t += 1 / 30) podium.frame(1 / 30);
  function loop(now: number): void {
    podium.frame((now - last) / 1000);
    last = now;
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
  (window as unknown as { __grip: unknown }).__grip = { podium };
}
